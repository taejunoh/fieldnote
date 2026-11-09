-- Exact private gateway input is durable before any upstream request.
-- Keep it separate from terminal provider_metadata so failure/finalization cannot erase it.
alter table public.analysis_attempts
  add column input_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_snapshot) = 'object');

create function public.save_gateway_input_snapshot(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text, p_snapshot jsonb
) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_attempt public.analysis_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot->>'version' is distinct from '1'
    or nullif(p_snapshot->>'context','') is null
    or nullif(p_snapshot->>'instructions','') is null
    or jsonb_typeof(p_snapshot->'requested') is distinct from 'object'
    or p_snapshot->'requested'->>'model' is distinct from 'gpt-6-astra'
    or p_snapshot->'requested'->>'mode' is distinct from 'default_standard'
    or p_snapshot->'requested'->>'effort' not in ('medium','xhigh')
    or coalesce(p_snapshot->>'context_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_snapshot->>'instructions_sha256','') !~ '^[a-f0-9]{64}$'
    or nullif(p_snapshot->>'execution_time','') is null
    or jsonb_typeof(p_snapshot->'source_document_refs') is distinct from 'array' then
    raise exception 'Invalid gateway input snapshot' using errcode = '22023';
  end if;
  select * into v_job from public.analysis_jobs where id=p_job_id for update;
  if not found or v_job.provider <> 'openllms' or v_job.status <> 'running'
    or v_job.current_attempt_id is distinct from p_attempt_id
    or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_expires_at is null or v_job.lease_expires_at <= v_now then
    return false;
  end if;
  if p_snapshot->'requested'->>'model' is distinct from v_job.model
    or p_snapshot->'requested'->>'effort' is distinct from v_job.effort then
    raise exception 'Snapshot settings differ from claimed job' using errcode = '22023';
  end if;
  select * into v_attempt from public.analysis_attempts
    where id=p_attempt_id and job_id=p_job_id for update;
  if not found or v_attempt.owner_id is distinct from v_job.owner_id
    or v_attempt.worker_id is distinct from p_worker_id or v_attempt.status <> 'running'
    or v_attempt.execution_started_at is not null or v_attempt.input_snapshot <> '{}'::jsonb then
    return false;
  end if;
  update public.analysis_attempts set input_snapshot=p_snapshot where id=p_attempt_id;
  return true;
end $$;

revoke all on function public.save_gateway_input_snapshot(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_gateway_input_snapshot(uuid,uuid,text,jsonb) to service_role;
