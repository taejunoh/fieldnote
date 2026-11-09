-- Preserve historical Responses jobs while making new gateway jobs independently claimable.
alter table public.analysis_jobs
  add column provider text not null default 'openllms',
  add column model text not null default 'gpt-6-astra',
  add column effort text not null default 'xhigh',
  add column current_attempt_id uuid,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz,
  add column available_at timestamptz not null default now(),
  add column provider_metadata jsonb not null default '{}'::jsonb;

update public.analysis_jobs set provider = 'openai';

alter table public.analysis_jobs drop constraint analysis_jobs_status_check;
alter table public.analysis_jobs add constraint analysis_jobs_status_check
  check (status in ('queued','running','completed','failed','interrupted','waiting_quota','relogin_required'));
alter table public.analysis_jobs add constraint analysis_jobs_provider_check
  check (provider in ('openai','openllms'));
alter table public.analysis_jobs add constraint analysis_jobs_gateway_effort_check
  check (provider <> 'openllms' or effort in ('medium','xhigh'));
alter table public.analysis_jobs add constraint analysis_jobs_gateway_lease_check
  check (status <> 'running' or provider <> 'openllms' or
    (current_attempt_id is not null and lease_owner is not null and lease_expires_at is not null));

create table public.analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  owner_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'running' check
    (status in ('running','completed','failed','interrupted','waiting_quota','relogin_required','retryable')),
  worker_id text not null,
  started_at timestamptz not null default now(),
  execution_started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  provider_response_id text,
  error text,
  usage jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  foreign key (job_id, owner_id) references public.analysis_jobs(id, owner_id) on delete cascade,
  unique (job_id, attempt_number),
  unique (job_id, id)
);

alter table public.analysis_jobs add constraint analysis_jobs_current_attempt_fk
  foreign key (id, current_attempt_id) references public.analysis_attempts(job_id, id);

create index analysis_jobs_claim_queue on public.analysis_jobs(available_at, created_at, id)
  where status = 'queued' and provider = 'openllms';
create index analysis_jobs_expired_lease on public.analysis_jobs(lease_expires_at, id)
  where status = 'running' and provider = 'openllms';
create index analysis_attempts_job_history on public.analysis_attempts(job_id, attempt_number desc);

alter table public.analysis_attempts enable row level security;
create policy owner_select on public.analysis_attempts for select to authenticated
  using (owner_id = auth.uid());
grant select on public.analysis_attempts to authenticated;
grant select, insert, update, delete on public.analysis_attempts to service_role;

-- An expired lease has an unknown upstream outcome. Never automatically replay it.
create function public.claim_gateway_job(
  p_worker_id text, p_lease_seconds integer default 120
) returns setof public.analysis_jobs language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if nullif(btrim(p_worker_id), '') is null then raise exception 'Worker ID required'; end if;
  if p_lease_seconds not between 15 and 3600 then raise exception 'Invalid lease duration'; end if;

  with expired as (
    select id from public.analysis_jobs
    where provider = 'openllms' and status = 'running' and lease_expires_at <= v_now
    order by lease_expires_at, id for update skip locked limit 100
  ), changed as (
    update public.analysis_jobs j set
      status = 'interrupted', error = 'Worker lease expired; upstream outcome unknown',
      lease_owner = null, lease_expires_at = null, updated_at = v_now
    from expired e where j.id = e.id returning j.current_attempt_id
  )
  update public.analysis_attempts a set
    status = 'interrupted', finished_at = v_now,
    error = 'Worker lease expired; upstream outcome unknown'
  where a.id in (select current_attempt_id from changed) and a.status = 'running';

  select * into v_job from public.analysis_jobs
  where provider = 'openllms' and status = 'queued' and user_message_id is not null
    and available_at <= v_now
  order by available_at, created_at, id for update skip locked limit 1;
  if not found then return; end if;

  insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, heartbeat_at)
    values(v_attempt_id, v_job.id, v_job.owner_id, v_job.attempt, p_worker_id, v_now);
  update public.analysis_jobs set
    status = 'running', current_attempt_id = v_attempt_id,
    lease_owner = p_worker_id,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    heartbeat_at = v_now, error = null, updated_at = v_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end $$;

create function public.heartbeat_gateway_job(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text,
  p_lease_seconds integer default 120, p_execution_started boolean default false
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_now timestamptz := clock_timestamp(); v_attempt uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_lease_seconds not between 15 and 3600 then raise exception 'Invalid lease duration'; end if;
  update public.analysis_jobs set
    heartbeat_at = v_now,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    updated_at = v_now
  where id = p_job_id and provider = 'openllms' and status = 'running'
    and current_attempt_id = p_attempt_id and lease_owner = p_worker_id
    and lease_expires_at > v_now
  returning current_attempt_id into v_attempt;
  if v_attempt is null then return false; end if;
  update public.analysis_attempts set
    heartbeat_at = v_now,
    execution_started_at = case when p_execution_started then coalesce(execution_started_at, v_now)
      else execution_started_at end
  where id = p_attempt_id and job_id = p_job_id and status = 'running';
  return true;
end $$;

-- The worker must have seen an explicit completed terminal event and verified citations.
create function public.finalize_gateway_job(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text,
  p_content text, p_metadata jsonb default '{}'::jsonb,
  p_provider_response_id text default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_attempt public.analysis_attempts%rowtype;
  v_message uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_metadata->>'terminalStatus' is distinct from 'completed'
    or p_metadata->>'verified' is distinct from 'true' then
    raise exception 'Only verified completed gateway results may be finalized';
  end if;
  if nullif(btrim(p_content), '') is null then raise exception 'Assistant content required'; end if;

  select * into v_job from public.analysis_jobs where id = p_job_id for update;
  if not found or v_job.provider <> 'openllms' or v_job.status <> 'running'
    or v_job.current_attempt_id is distinct from p_attempt_id
    or v_job.lease_owner is distinct from p_worker_id or v_job.lease_expires_at <= v_now then
    raise exception 'Stale or expired gateway attempt' using errcode = '55000';
  end if;
  select * into v_attempt from public.analysis_attempts
    where id = p_attempt_id and job_id = p_job_id and status = 'running' for update;
  if not found or v_attempt.execution_started_at is null then
    raise exception 'Gateway execution was not marked started' using errcode = '55000';
  end if;

  insert into public.messages(owner_id, sport_id, role, content, metadata, analysis_job_id)
    values(v_job.owner_id, v_job.sport_id, 'assistant', p_content, p_metadata, p_job_id)
    on conflict (analysis_job_id, role) do nothing returning id into v_message;
  if v_message is null then
    raise exception 'Assistant message already exists for this job' using errcode = '23505';
  end if;
  update public.analysis_attempts set
    status = 'completed', finished_at = v_now,
    provider_response_id = p_provider_response_id,
    usage = coalesce(p_metadata->'usage', '{}'::jsonb),
    sources = coalesce(p_metadata->'sources', '[]'::jsonb),
    provider_metadata = p_metadata
  where id = p_attempt_id;
  update public.analysis_jobs set
    status = 'completed', response_id = p_provider_response_id,
    result_message_id = v_message, error = null,
    lease_owner = null, lease_expires_at = null,
    provider_metadata = p_metadata, updated_at = v_now
  where id = p_job_id;
  return v_message;
end $$;

create function public.fail_gateway_job(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text,
  p_status text, p_error text, p_metadata jsonb default '{}'::jsonb
) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_delay integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_status not in ('failed','interrupted','waiting_quota','relogin_required','queued') then
    raise exception 'Invalid gateway failure status';
  end if;
  if nullif(btrim(p_error), '') is null then raise exception 'Failure reason required'; end if;
  if p_status = 'queued' and p_metadata->>'retry_safe' is distinct from 'true' then
    raise exception 'Automatic retry requires confirmed safe pre-execution failure';
  end if;
  v_delay := coalesce((p_metadata->>'retry_after_seconds')::integer, 0);
  if v_delay not between 0 and 86400 then raise exception 'Invalid retry delay'; end if;

  select * into v_job from public.analysis_jobs where id = p_job_id for update;
  if not found or v_job.provider <> 'openllms' or v_job.status <> 'running'
    or v_job.current_attempt_id is distinct from p_attempt_id
    or v_job.lease_owner is distinct from p_worker_id or v_job.lease_expires_at <= v_now then
    return false;
  end if;
  update public.analysis_attempts set
    status = case when p_status = 'queued' then 'retryable' else p_status end,
    finished_at = v_now, error = p_error,
    provider_response_id = p_metadata->>'upstreamResponseId',
    usage = coalesce(p_metadata->'usage', '{}'::jsonb),
    sources = coalesce(p_metadata->'sources', '[]'::jsonb),
    provider_metadata = p_metadata
  where id = p_attempt_id and job_id = p_job_id and status = 'running';
  update public.analysis_jobs set
    status = p_status, error = p_error,
    response_id = p_metadata->>'upstreamResponseId',
    provider_metadata = p_metadata,
    attempt = case when p_status = 'queued' then attempt + 1 else attempt end,
    current_attempt_id = case when p_status = 'queued' then null else current_attempt_id end,
    available_at = case when p_status = 'queued' then v_now + make_interval(secs => v_delay)
      else available_at end,
    lease_owner = null, lease_expires_at = null, updated_at = v_now
  where id = p_job_id;
  return true;
end $$;

-- Explicit user retry is the only way to replay an attempt with an unknown outcome.
create function public.retry_gateway_job(p_job_id uuid)
  returns public.analysis_jobs language plpgsql security definer set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_job from public.analysis_jobs
    where id = p_job_id and owner_id = auth.uid() and provider = 'openllms' for update;
  if not found then raise exception 'Gateway job not found'; end if;
  if v_job.status = 'running' and v_job.lease_expires_at <= v_now then
    update public.analysis_attempts set
      status = 'interrupted', finished_at = v_now,
      error = 'Worker lease expired; upstream outcome unknown'
    where id = v_job.current_attempt_id and status = 'running';
  elsif v_job.status not in ('failed','interrupted','waiting_quota','relogin_required') then
    raise exception 'Job is not retryable';
  end if;
  update public.analysis_jobs set
    status = 'queued', attempt = attempt + 1,
    current_attempt_id = null, lease_owner = null, lease_expires_at = null,
    heartbeat_at = null, available_at = v_now,
    response_id = null, error = null, provider_metadata = '{}'::jsonb,
    updated_at = v_now
  where id = p_job_id returning * into v_job;
  return v_job;
end $$;

-- Keep historical Responses jobs finalizable, but never let this old RPC bypass fencing.
create or replace function public.finalize_analysis_job(
  p_job_id uuid, p_response_id text, p_content text, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_job public.analysis_jobs%rowtype; v_message uuid;
begin
  select * into v_job from public.analysis_jobs
    where id = p_job_id and (owner_id = auth.uid() or auth.role() = 'service_role') for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.provider = 'openllms' or v_job.current_attempt_id is not null then
    raise exception 'Gateway jobs require fenced finalization' using errcode = '55000';
  end if;
  if v_job.status = 'completed' then return v_job.result_message_id; end if;
  insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id)
    values(v_job.owner_id,v_job.sport_id,'assistant',p_content,p_metadata,p_job_id)
    on conflict (analysis_job_id,role) do nothing returning id into v_message;
  if v_message is null then
    select id into v_message from public.messages where analysis_job_id = p_job_id and role = 'assistant';
  end if;
  update public.analysis_jobs set
    status = 'completed', response_id = p_response_id,
    result_message_id = v_message, error = null, updated_at = now()
  where id = p_job_id;
  return v_message;
end $$;

revoke all on function public.claim_gateway_job(text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_gateway_job(uuid,uuid,text,integer,boolean) from public, anon, authenticated;
revoke all on function public.finalize_gateway_job(uuid,uuid,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.fail_gateway_job(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.retry_gateway_job(uuid) from public, anon;
grant execute on function public.claim_gateway_job(text,integer) to service_role;
grant execute on function public.heartbeat_gateway_job(uuid,uuid,text,integer,boolean) to service_role;
grant execute on function public.finalize_gateway_job(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.fail_gateway_job(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.retry_gateway_job(uuid) to authenticated;
