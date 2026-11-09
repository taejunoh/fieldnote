-- Additive provenance only. Existing raw messages, recommendations and tickets remain unchanged.
alter table public.bets add column source_message_id uuid references public.messages(id), add column source_recommendation_id uuid references public.recommendations(id);
alter table public.mistake_notes add column source_message_id uuid references public.messages(id), add column source_recommendation_id uuid references public.recommendations(id), add column source_bet_id uuid references public.bets(id);

create function public.validate_record_lineage() returns trigger language plpgsql set search_path=public as $$
declare linked_event uuid; bet_id uuid;
begin
 if new.event_id is not null and not exists(select 1 from public.events where id=new.event_id and owner_id=new.owner_id and sport_id=new.sport_id) then raise exception 'Event owner/sport mismatch' using errcode='22023'; end if;
 if new.source_message_id is not null and not exists(select 1 from public.messages m where m.id=new.source_message_id and m.owner_id=new.owner_id and m.sport_id=new.sport_id) then raise exception 'Source message owner/sport mismatch' using errcode='22023'; end if;
 if new.source_recommendation_id is not null then
  select event_id into linked_event from public.recommendations where id=new.source_recommendation_id and owner_id=new.owner_id and sport_id=new.sport_id;
  if not found or linked_event is distinct from new.event_id then raise exception 'Source recommendation relationship mismatch' using errcode='22023'; end if;
 end if;
 if tg_table_name='mistake_notes' then
  bet_id := (to_jsonb(new)->>'source_bet_id')::uuid;
  if bet_id is not null then
   select event_id into linked_event from public.bets where id=bet_id and owner_id=new.owner_id and sport_id=new.sport_id;
   if not found or linked_event is distinct from new.event_id then raise exception 'Source bet relationship mismatch' using errcode='22023'; end if;
  end if;
 end if;
 return new;
end $$;
create trigger bets_source_lineage before insert or update on public.bets for each row execute function public.validate_record_lineage();
create trigger notes_source_lineage before insert or update on public.mistake_notes for each row execute function public.validate_record_lineage();
