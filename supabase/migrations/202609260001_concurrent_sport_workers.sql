-- Claim independent sports concurrently; serialize an owner's sport to preserve conversation order.
create index analysis_jobs_running_sport on public.analysis_jobs(owner_id, sport_id)
  where provider = 'openllms' and status = 'running';

create or replace function public.claim_gateway_job(
  p_worker_id text, p_lease_seconds integer default 120
) returns setof public.analysis_jobs language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_candidate public.analysis_jobs%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if nullif(btrim(p_worker_id), '') is null then raise exception 'Worker ID required'; end if;
  if p_lease_seconds not between 15 and 3600 then raise exception 'Invalid lease duration'; end if;

  -- Preserve expired attempts as interrupted, without replaying an unknown upstream outcome.
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

  for v_candidate in
    select j.* from public.analysis_jobs j
    where j.provider = 'openllms' and j.status = 'queued' and j.user_message_id is not null
      and j.available_at <= v_now
      and not exists (
        select 1 from public.analysis_jobs active
        where active.owner_id = j.owner_id and active.sport_id = j.sport_id
          and active.provider = 'openllms' and active.status = 'running'
      )
    order by j.available_at, j.created_at, j.id
  loop
    -- Lock only the current candidate. A locking FOR cursor can prefetch and lock
    -- other sports' jobs, preventing independent claims until this transaction ends.
    select * into v_job from public.analysis_jobs
      where id = v_candidate.id and provider = 'openllms' and status = 'queued'
        and user_message_id is not null and available_at <= v_now for update skip locked;
    if not found then continue; end if;
    -- A candidate snapshot alone permits two simultaneous claims of the same sport.
    -- Lock its stable sport row, then check again with a fresh READ COMMITTED snapshot.
    perform 1 from public.sports
      where id = v_job.sport_id and owner_id = v_job.owner_id for update skip locked;
    if not found then continue; end if;
    if exists (
      select 1 from public.analysis_jobs active
      where active.owner_id = v_job.owner_id and active.sport_id = v_job.sport_id
        and active.provider = 'openllms' and active.status = 'running'
    ) then continue; end if;

    insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, heartbeat_at)
      values(v_attempt_id, v_job.id, v_job.owner_id, v_job.attempt, p_worker_id, v_now);
    update public.analysis_jobs set
      status = 'running', current_attempt_id = v_attempt_id,
      lease_owner = p_worker_id,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      heartbeat_at = v_now, error = null, updated_at = v_now
    where id = v_job.id returning * into v_job;
    return next v_job;
    return;
  end loop;
end $$;

-- CREATE OR REPLACE preserves the existing service-role-only execute grant.
