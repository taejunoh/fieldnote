-- Reviewed, immutable paper evaluations. This table never updates actual bets.
create table public.recommendation_evaluations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 sport_id uuid not null,
 recommendation_id uuid not null references public.recommendations(id),
 source_message_id uuid not null references public.messages(id),
 supersedes_evaluation_id uuid references public.recommendation_evaluations(id),
 request_key text not null check(length(request_key) between 8 and 100),
 frozen_recommendation jsonb not null,
 evaluation_input jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(sport_id,owner_id) references public.sports(id,owner_id),
 unique(owner_id,request_key),

 check(jsonb_typeof(frozen_recommendation)='object' and jsonb_typeof(evaluation_input)='object'),
 check(evaluation_input ? 'outcome' and evaluation_input->>'outcome' in ('won','lost','push','void')),
 check(evaluation_input ? 'outcomeSourceUrl' and evaluation_input->>'outcomeSourceUrl' ~ '^https://[^/[:space:]]+')
);
create unique index recommendation_evaluation_root on public.recommendation_evaluations(owner_id,recommendation_id) where supersedes_evaluation_id is null;
create unique index recommendation_evaluation_successor on public.recommendation_evaluations(supersedes_evaluation_id) where supersedes_evaluation_id is not null;
alter table public.recommendation_evaluations enable row level security;
grant select,insert on public.recommendation_evaluations to authenticated,service_role;
create policy owner_select on public.recommendation_evaluations for select to authenticated using(owner_id=auth.uid());
create policy owner_insert on public.recommendation_evaluations for insert to authenticated with check(owner_id=auth.uid());

create function public.freeze_recommendation_evaluation() returns trigger language plpgsql set search_path=public as $$
declare r public.recommendations; m public.messages; original jsonb; original_event jsonb; expected jsonb; previous public.recommendation_evaluations;
begin
 if tg_op<>'INSERT' then raise exception 'Recommendation evaluations are immutable' using errcode='22023'; end if;
 select * into r from public.recommendations where id=new.recommendation_id and owner_id=new.owner_id and sport_id=new.sport_id;
 if not found then raise exception 'Recommendation owner/sport mismatch' using errcode='22023'; end if;
 if new.supersedes_evaluation_id is not null then
  select * into previous from public.recommendation_evaluations where id=new.supersedes_evaluation_id and owner_id=new.owner_id and sport_id=new.sport_id and recommendation_id=new.recommendation_id;
  if not found or previous.source_message_id is distinct from new.source_message_id or previous.frozen_recommendation is distinct from new.frozen_recommendation then raise exception 'Evaluation predecessor or frozen source mismatch' using errcode='22023'; end if;
 else
 if r.source_message_id is distinct from new.source_message_id then raise exception 'Recommendation/source relationship mismatch' using errcode='22023'; end if;
 select * into m from public.messages where id=new.source_message_id and owner_id=new.owner_id and sport_id=new.sport_id;
 if not found or m.role<>'assistant' then raise exception 'Source assistant message unavailable' using errcode='22023'; end if;
 select value into original from jsonb_array_elements(m.metadata->'analysis_record'->'recommendations') where value->>'item_key'=r.recommendation_item_key;
 if original is null or original->>'market' is distinct from r.market or original->>'selection' is distinct from r.selection or original->>'decision' is distinct from r.decision or original->>'price_gate' is distinct from r.price_gate or coalesce((original->>'suggested_units')::numeric,0) is distinct from coalesce(r.suggested_units,0) then raise exception 'Original recommendation unavailable or changed' using errcode='22023'; end if;
 select value into original_event from jsonb_array_elements(m.metadata->'analysis_record'->'events') where value->>'event_key'=original->>'event_key';
 if original_event is null then raise exception 'Original event unavailable' using errcode='22023'; end if;
 expected:=jsonb_build_object('version',1,'source_message_id',m.id,'checked_at',m.metadata->'checked_at','delivered_at',coalesce(nullif(m.metadata->'delivery'->'delivered_at','null'::jsonb),to_jsonb(m.created_at)),'historical_delivery',coalesce(m.metadata->'delivery'->'historical_delivery'='true'::jsonb,false),'recommendation',original,'event',original_event);
 -- ISO timestamp strings may use a different equivalent offset representation.
 if (new.frozen_recommendation-'delivered_at') is distinct from (expected-'delivered_at') or (new.frozen_recommendation->>'delivered_at')::timestamptz is distinct from (expected->>'delivered_at')::timestamptz then raise exception 'Frozen snapshot must match original source' using errcode='22023'; end if;
 end if;
 if new.evaluation_input->>'outcomeCheckedAt' is null or (new.evaluation_input->>'outcomeCheckedAt')::timestamptz > clock_timestamp() then raise exception 'Invalid outcome evidence time' using errcode='22023'; end if;
 new.created_at:=clock_timestamp();
 return new;
end $$;
create trigger recommendation_evaluation_freeze before insert or update on public.recommendation_evaluations for each row execute function public.freeze_recommendation_evaluation();

-- Explicit reverse relationship: a self-FK alone cannot safely disambiguate parent/child embedding.
create function public.recommendation_evaluation_successors(source_row public.recommendation_evaluations)
returns setof public.recommendation_evaluations language sql stable security invoker set search_path=public as $$
 select e.* from public.recommendation_evaluations e
 where e.supersedes_evaluation_id=(source_row).id and e.owner_id=(source_row).owner_id;
$$;
revoke all on function public.recommendation_evaluation_successors(public.recommendation_evaluations) from public,anon;
grant execute on function public.recommendation_evaluation_successors(public.recommendation_evaluations) to authenticated,service_role;
