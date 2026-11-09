-- Completed provider evidence is private, immutable, and independent of retry attempts.
-- Rollback: deploy the prior worker, then drop the three RPCs, guard and table.
-- No existing finalizer, source admission validator or historical repair contract is changed.
create table public.gateway_completions (
  job_id uuid primary key,
  owner_id uuid not null,
  original_attempt_id uuid not null,
  completion jsonb not null check (jsonb_typeof(completion) = 'object'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  raw_sha256 text generated always as (encode(extensions.digest(completion->'result'->>'text','sha256'),'hex')) stored,
  sources_sha256 text generated always as (encode(extensions.digest((completion->'result'->'sources')::text,'sha256'),'hex')) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(job_id,owner_id) references public.analysis_jobs(id,owner_id) on delete cascade,
  foreign key(job_id,original_attempt_id) references public.analysis_attempts(job_id,id)
);
alter table public.gateway_completions enable row level security;
revoke all on public.gateway_completions from public,anon,authenticated,service_role;
grant select,insert on public.gateway_completions to service_role;

create function public.guard_gateway_completion_immutable()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Completed provider evidence is immutable' using errcode='22023'; end $$;
create trigger gateway_completion_immutable before update on public.gateway_completions
for each row execute function public.guard_gateway_completion_immutable();
revoke all on function public.guard_gateway_completion_immutable() from public,anon,authenticated;

create function public.save_gateway_completion(p_job_id uuid,p_attempt_id uuid,p_worker_id text,p_completion jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; c public.gateway_completions%rowtype;
  r jsonb := p_completion->'result'; t timestamptz; v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into j from public.analysis_jobs where id=p_job_id for update;
  if not found or j.provider<>'openllms' or j.status<>'running' or j.current_attempt_id is distinct from p_attempt_id
    or j.lease_owner is distinct from p_worker_id or j.lease_expires_at is null or j.lease_expires_at<=v_now then return false; end if;
  select * into a from public.analysis_attempts where id=p_attempt_id and job_id=j.id and owner_id=j.owner_id for update;
  if not found or a.worker_id is distinct from p_worker_id or a.status<>'running' or a.execution_started_at is null
    or a.input_snapshot='{}'::jsonb then return false; end if;
  if jsonb_typeof(p_completion) is distinct from 'object' or p_completion->>'version' is distinct from '1'
    or (p_completion - array['version','result','checked_at']) <> '{}'::jsonb
    or jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'text') is distinct from 'string'
    or jsonb_typeof(r->'sources') is distinct from 'array' or jsonb_typeof(r->'searched') is distinct from 'boolean'
    or jsonb_typeof(r->'verified') is distinct from 'boolean' or jsonb_typeof(r->'usage') is distinct from 'object'
    or not (r ? 'upstreamResponseId') or jsonb_typeof(r->'upstreamResponseId') not in ('null','string')
    or (r ? 'safeDiagnostics' and r->'safeDiagnostics' ? 'terminalStatus' and r->'safeDiagnostics'->>'terminalStatus' is distinct from 'completed')
    or coalesce(p_completion->>'checked_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    or octet_length(p_completion::text)>8388608 then raise exception 'Invalid completed provider result' using errcode='22023'; end if;
  t := (p_completion->>'checked_at')::timestamptz;
  if t<a.execution_started_at-interval '1 second' or t>v_now+interval '30 seconds'
    or a.input_snapshot->>'context_sha256' is distinct from encode(extensions.digest(a.input_snapshot->>'context','sha256'),'hex')
    or a.input_snapshot->>'instructions_sha256' is distinct from encode(extensions.digest(a.input_snapshot->>'instructions','sha256'),'hex')
    or a.input_snapshot->'requested'->>'model' is distinct from j.model
    or a.input_snapshot->'requested'->>'effort' is distinct from j.effort then raise exception 'Completion input or time does not match execution' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(r->'sources') x where jsonb_typeof(x) is distinct from 'object'
    or jsonb_typeof(x->'title') is distinct from 'string' or jsonb_typeof(x->'url') is distinct from 'string'
    or x->>'url' !~ '^https?://') then raise exception 'Invalid original sources' using errcode='22023'; end if;
  if r->>'verified'='true' and (r->>'searched'<>'true' or jsonb_array_length(r->'sources')=0 or nullif(btrim(r->>'text'),'') is null)
    then raise exception 'Invalid verification claim' using errcode='22023'; end if;
  select * into c from public.gateway_completions where job_id=j.id;
  if found then
    if c.owner_id is distinct from j.owner_id or c.original_attempt_id is distinct from a.id or c.completion is distinct from p_completion
      or c.input_snapshot is distinct from a.input_snapshot then raise exception 'Conflicting completion checkpoint' using errcode='22023'; end if;
    return true;
  end if;
  insert into public.gateway_completions(job_id,owner_id,original_attempt_id,completion,input_snapshot)
    values(j.id,j.owner_id,a.id,p_completion,a.input_snapshot);
  return true;
end $$;

create function public.load_gateway_completion(p_job_id uuid,p_attempt_id uuid,p_worker_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare j public.analysis_jobs%rowtype; c public.gateway_completions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into j from public.analysis_jobs where id=p_job_id for update;
  if not found or j.provider<>'openllms' or j.status<>'running' or j.current_attempt_id is distinct from p_attempt_id
    or j.lease_owner is distinct from p_worker_id or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
    or not exists(select 1 from public.analysis_attempts a where a.id=p_attempt_id and a.job_id=j.id and a.owner_id=j.owner_id and a.worker_id=p_worker_id and a.status='running')
    then raise exception 'Stale or expired completion reader' using errcode='55000'; end if;
  select * into c from public.gateway_completions where job_id=j.id and owner_id=j.owner_id;
  if not found then return null; end if;
  return c.completion || jsonb_build_object('original_attempt_id',c.original_attempt_id,'input_snapshot',c.input_snapshot);
end $$;

-- Atomic wrapper preserves all existing analysis/conversation admission checks.
-- A committed retry may only acknowledge byte-identical content and matching original evidence.
create function public.finalize_gateway_completion(
  p_job_id uuid,p_attempt_id uuid,p_worker_id text,p_content text,p_metadata jsonb,p_provider_response_id text,p_conversation boolean
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; c public.gateway_completions%rowtype;
  m public.messages%rowtype; result_id uuid; delivered timestamptz := clock_timestamp(); historical boolean; metadata jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into j from public.analysis_jobs where id=p_job_id for update;
  if not found or j.provider<>'openllms' or j.current_attempt_id is distinct from p_attempt_id
    then raise exception 'Stale completion publisher' using errcode='55000'; end if;
  select * into a from public.analysis_attempts where id=p_attempt_id and job_id=j.id and owner_id=j.owner_id for update;
  if not found or a.worker_id is distinct from p_worker_id or a.execution_started_at is null
    then raise exception 'Stale completion worker' using errcode='55000'; end if;
  select * into c from public.gateway_completions where job_id=j.id and owner_id=j.owner_id;
  if not found then raise exception 'Completed provider checkpoint required' using errcode='22023'; end if;
  if p_conversation is null or jsonb_typeof(p_metadata) is distinct from 'object' or p_metadata ? 'delivery'
    or p_metadata->>'terminalStatus' is distinct from 'completed'
    or p_metadata->>'original_model_response' is distinct from c.completion->'result'->>'text'
    or encode(extensions.digest(p_metadata->>'original_model_response','sha256'),'hex') is distinct from c.raw_sha256
    or p_metadata->'sources' is distinct from c.completion->'result'->'sources'
    or encode(extensions.digest((p_metadata->'sources')::text,'sha256'),'hex') is distinct from c.sources_sha256
    or p_metadata->'verified' is distinct from c.completion->'result'->'verified'
    or p_metadata->'searched' is distinct from c.completion->'result'->'searched'
    or p_metadata->>'checked_at' is distinct from c.completion->>'checked_at'
    or p_provider_response_id is distinct from c.completion->'result'->>'upstreamResponseId'
    or p_metadata->'input_snapshot'->>'attempt_id' is distinct from c.original_attempt_id::text
    or p_metadata->'input_snapshot'->>'context_sha256' is distinct from c.input_snapshot->>'context_sha256'
    or p_metadata->'input_snapshot'->>'instructions_sha256' is distinct from c.input_snapshot->>'instructions_sha256'
    then raise exception 'Publication differs from immutable completed evidence' using errcode='22023'; end if;
  if j.status='completed' then
    select * into m from public.messages where id=j.result_message_id and analysis_job_id=j.id and owner_id=j.owner_id and sport_id=j.sport_id and role='assistant';
    if not found or a.status<>'completed' or m.content is distinct from p_content or (m.metadata-'delivery') is distinct from p_metadata
      or j.response_id is distinct from p_provider_response_id
      or j.result_type is distinct from (case when p_conversation then 'conversation' else 'analysis' end)
      then raise exception 'Conflicting committed completion acknowledgment' using errcode='22023'; end if;
    return m.id;
  end if;
  if j.status<>'running' or a.status<>'running' or j.lease_owner is distinct from p_worker_id
    or j.lease_expires_at is null or j.lease_expires_at<=delivered then raise exception 'Stale or expired completion publisher' using errcode='55000'; end if;
  historical := c.original_attempt_id<>p_attempt_id;
  -- A first delivery after a stored event's start is also historical, even on the original attempt.
  if jsonb_typeof(p_metadata->'analysis_record'->'events')='array' then
    historical := historical or exists(select 1 from jsonb_array_elements(p_metadata->'analysis_record'->'events') e
      where nullif(e->>'starts_at','') is not null and (e->>'starts_at')::timestamptz<=delivered);
  end if;
  metadata := p_metadata || jsonb_build_object('delivery',jsonb_build_object('delivered_at',delivered,
    'original_checked_at',c.completion->>'checked_at','historical_delivery',historical));
  if p_conversation then
    result_id := public.finalize_gateway_conversation_job(p_job_id,p_attempt_id,p_worker_id,p_content,metadata,p_provider_response_id);
  else
    result_id := public.finalize_gateway_job(p_job_id,p_attempt_id,p_worker_id,p_content,metadata,p_provider_response_id);
    -- These rows are new, atomically inserted by this invocation, never existing history.
    update public.recommendations set created_at=(c.completion->>'checked_at')::timestamptz where analysis_job_id=j.id;
  end if;
  -- PostgreSQL now() is transaction-start time; delivery is the actual publication time.
  update public.messages set created_at=delivered where id=result_id;
  return result_id;
end $$;

revoke all on function public.save_gateway_completion(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.load_gateway_completion(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finalize_gateway_completion(uuid,uuid,text,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.save_gateway_completion(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.load_gateway_completion(uuid,uuid,text) to service_role;
grant execute on function public.finalize_gateway_completion(uuid,uuid,text,text,jsonb,text,boolean) to service_role;
