create extension if not exists pgcrypto;

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check (slug in ('mlb','nfl','cfb','soccer','tennis','wnba','nhl')),
  created_at timestamptz not null default now(),
  unique (owner_id, slug),
  unique (id, owner_id)
);

create table public.imported_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  filename text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  raw_text text not null,
  draft jsonb not null,
  imported_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  unique (owner_id, sport_id, sha256),
  unique (id, owner_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  analysis_job_id uuid,
  source_document_id uuid,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id),
  unique (id, owner_id)
);

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  request_key text not null,
  kind text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  user_message_id uuid,
  response_id text,
  result_message_id uuid,
  error text,
  attempt integer not null default 1 check (attempt > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (user_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (result_message_id, owner_id) references public.messages(id, owner_id),
  unique (owner_id, sport_id, request_key),
  unique (id, owner_id)
);
alter table public.messages add constraint messages_analysis_job_owner_fk foreign key (analysis_job_id, owner_id) references public.analysis_jobs(id, owner_id);
alter table public.messages add constraint messages_one_role_per_job unique (analysis_job_id, role);

create table public.criteria_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  title text not null,
  content text not null,
  status text not null check (status in ('adopted','proposed','superseded')),
  supersedes_id uuid,
  source_document_id uuid,
  source_ref text,
  source_message_id uuid,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id),
  foreign key (source_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (supersedes_id, owner_id) references public.criteria_versions(id, owner_id),
  unique (id, owner_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  event_key text not null,
  label text not null,
  starts_at timestamptz,
  game_status text not null default 'unknown' check (game_status in ('unknown','scheduled','live','final','postponed')),
  analysis_status text not null default 'WATCH' check (analysis_status in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')),
  notes text,
  source_document_id uuid,
  source_ref text,
  result_source_url text,
  result_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id),
  unique (owner_id, sport_id, event_key),
  unique (id, owner_id)
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  event_id uuid,
  market text not null,
  selection text not null,
  decision text not null check (decision in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')),
  suggested_units numeric(8,3),
  price_gate text,
  analysis_job_id uuid,
  source_document_id uuid,
  source_ref text,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (event_id, owner_id) references public.events(id, owner_id),
  foreign key (analysis_job_id, owner_id) references public.analysis_jobs(id, owner_id),
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id)
);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  event_id uuid not null,
  market text not null,
  selection text not null,
  request_key text,
  stake_units numeric(8,3),
  executed_price integer,
  entry_confirmed_at timestamptz,
  source_document_id uuid,
  source_ref text,
  result text not null default 'unknown' check (result in ('unknown','won','lost','push','void')),
  profit_units numeric(9,3),
  result_source_url text,
  result_checked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (event_id, owner_id) references public.events(id, owner_id),
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id),
  unique (owner_id, request_key),
  check (profit_units is null or (stake_units is not null and executed_price is not null and result in ('won','lost','push','void')))
);

create table public.mistake_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  event_id uuid,
  request_key text,
  title text not null,
  decision_at_time text,
  outcome text,
  outcome_source_url text,
  lesson text not null,
  source_document_id uuid,
  source_ref text,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (event_id, owner_id) references public.events(id, owner_id),
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id),
  unique (owner_id, request_key)
);

create table public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  content text not null,
  source_message_ids uuid[] not null default '{}',
  source_document_id uuid,
  source_ref text,
  created_at timestamptz not null default now(),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (source_document_id, owner_id) references public.imported_documents(id, owner_id)
);

do $$
declare tbl text;
begin
  foreach tbl in array array['sports','imported_documents','messages','analysis_jobs','criteria_versions','events','recommendations','bets','mistake_notes','conversation_summaries'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = auth.uid())', tbl);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = auth.uid())', tbl);
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', tbl);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = auth.uid())', tbl);
  end loop;
end $$;

create or replace function public.commit_import(
  p_sport_slug text, p_filename text, p_sha256 text, p_raw_text text, p_draft jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid := auth.uid(); v_sport uuid; v_doc uuid; v_row jsonb; v_event uuid;
  v_counts jsonb := '{"rules":0,"events":0,"recommendations":0,"bets":0,"mistakeNotes":0}'::jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_sport_slug not in ('mlb','nfl','cfb','soccer','tennis','wnba','nhl') then raise exception 'Invalid sport'; end if;
  insert into public.sports(owner_id,slug) values(v_owner,p_sport_slug)
    on conflict(owner_id,slug) do update set slug = excluded.slug returning id into v_sport;
  select id into v_doc from public.imported_documents where owner_id=v_owner and sport_id=v_sport and sha256=p_sha256;
  if v_doc is not null then return jsonb_build_object('importedDocumentId',v_doc,'alreadyImported',true,'counts',v_counts); end if;
  insert into public.imported_documents(owner_id,sport_id,filename,sha256,raw_text,draft)
    values(v_owner,v_sport,p_filename,p_sha256,p_raw_text,p_draft) returning id into v_doc;
  for v_row in select value from jsonb_array_elements(coalesce(p_draft->'rules','[]'::jsonb)) loop
    insert into public.criteria_versions(owner_id,sport_id,title,content,status,source_document_id,source_ref)
    values(v_owner,v_sport,v_row->>'title',v_row->>'content',coalesce(v_row->>'status','adopted'),v_doc,v_row->>'sourceRef');
    v_counts := jsonb_set(v_counts,'{rules}',to_jsonb((v_counts->>'rules')::int+1));
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_draft->'events','[]'::jsonb)) loop
    insert into public.events(owner_id,sport_id,event_key,label,game_status,analysis_status,notes,source_document_id,source_ref)
    values(v_owner,v_sport,v_row->>'eventKey',v_row->>'label',coalesce(v_row->>'gameStatus','unknown'),coalesce(v_row->>'analysisStatus','WATCH'),v_row->>'notes',v_doc,v_row->>'sourceRef')
    on conflict(owner_id,sport_id,event_key) do nothing;
    v_counts := jsonb_set(v_counts,'{events}',to_jsonb((v_counts->>'events')::int+1));
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_draft->'recommendations','[]'::jsonb)) loop
    select id into v_event from public.events where owner_id=v_owner and sport_id=v_sport and event_key=v_row->>'eventKey';
    insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision,suggested_units,price_gate,source_document_id,source_ref)
    values(v_owner,v_sport,v_event,v_row->>'market',v_row->>'selection',v_row->>'decision',nullif(v_row->>'suggestedUnits','')::numeric,v_row->>'priceGate',v_doc,v_row->>'sourceRef');
    v_counts := jsonb_set(v_counts,'{recommendations}',to_jsonb((v_counts->>'recommendations')::int+1));
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_draft->'bets','[]'::jsonb)) loop
    select id into v_event from public.events where owner_id=v_owner and sport_id=v_sport and event_key=v_row->>'eventKey';
    if v_event is null then raise exception 'Bet requires an event'; end if;
    insert into public.bets(owner_id,sport_id,event_id,market,selection,stake_units,executed_price,source_document_id,source_ref,result,profit_units)
    values(v_owner,v_sport,v_event,v_row->>'market',v_row->>'selection',nullif(v_row->>'stakeUnits','')::numeric,nullif(v_row->>'executedPrice','')::integer,v_doc,v_row->>'sourceRef',coalesce(v_row->>'result','unknown'),nullif(v_row->>'profitUnits','')::numeric);
    v_counts := jsonb_set(v_counts,'{bets}',to_jsonb((v_counts->>'bets')::int+1));
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_draft->'mistakeNotes','[]'::jsonb)) loop
    select id into v_event from public.events where owner_id=v_owner and sport_id=v_sport and event_key=v_row->>'eventKey';
    insert into public.mistake_notes(owner_id,sport_id,event_id,title,decision_at_time,outcome,lesson,source_document_id,source_ref)
    values(v_owner,v_sport,v_event,v_row->>'title',v_row->>'decisionAtTime',v_row->>'outcome',v_row->>'lesson',v_doc,v_row->>'sourceRef');
    v_counts := jsonb_set(v_counts,'{mistakeNotes}',to_jsonb((v_counts->>'mistakeNotes')::int+1));
  end loop;
  if nullif(p_draft->>'summary','') is not null then
    insert into public.conversation_summaries(owner_id,sport_id,content,source_document_id,source_ref)
    values(v_owner,v_sport,p_draft->>'summary',v_doc,coalesce(p_draft->>'summarySourceRef','Imported handoff summary'));
  end if;
  return jsonb_build_object('importedDocumentId',v_doc,'alreadyImported',false,'counts',v_counts);
end $$;

create or replace function public.finalize_analysis_job(
  p_job_id uuid, p_response_id text, p_content text, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_job public.analysis_jobs%rowtype; v_message uuid;
begin
  select * into v_job from public.analysis_jobs
    where id=p_job_id and (owner_id=auth.uid() or auth.role()='service_role') for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status='completed' then return v_job.result_message_id; end if;
  insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id)
    values(v_job.owner_id,v_job.sport_id,'assistant',p_content,p_metadata,p_job_id)
    on conflict (analysis_job_id,role) do nothing
    returning id into v_message;
  if v_message is null then select id into v_message from public.messages where analysis_job_id=p_job_id and role='assistant'; end if;
  update public.analysis_jobs set status='completed',response_id=p_response_id,result_message_id=v_message,error=null,updated_at=now() where id=p_job_id;
  return v_message;
end $$;

create index messages_sport_recent on public.messages(sport_id,created_at desc);
create index events_sport_recent on public.events(sport_id,updated_at desc);
create index summaries_sport_recent on public.conversation_summaries(sport_id,created_at desc);
create unique index summaries_source_messages_unique on public.conversation_summaries(owner_id,sport_id,source_message_ids) where cardinality(source_message_ids) > 0;
create index notes_sport_recent on public.mistake_notes(sport_id,created_at desc);

grant select, insert, update, delete on public.sports, public.imported_documents, public.messages,
  public.analysis_jobs, public.criteria_versions, public.events, public.recommendations,
  public.bets, public.mistake_notes, public.conversation_summaries to authenticated, service_role;
revoke all on function public.commit_import(text,text,text,text,jsonb) from public;
revoke all on function public.finalize_analysis_job(uuid,text,text,jsonb) from public;
grant execute on function public.commit_import(text,text,text,text,jsonb) to authenticated;
grant execute on function public.finalize_analysis_job(uuid,text,text,jsonb) to authenticated, service_role;
