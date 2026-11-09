-- Run in an isolated test database with no real queued jobs.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport_1 uuid;
  v_sport_2 uuid;
  v_job public.analysis_jobs%rowtype;
  v_first public.analysis_jobs%rowtype;
  v_second public.analysis_jobs%rowtype;
  v_same public.analysis_jobs%rowtype;
  v_message uuid;
begin
  insert into auth.users(id, email) values(v_owner, 'concurrency-fixture@example.invalid');
  insert into public.sports(owner_id, slug) values(v_owner, 'mlb') returning id into v_sport_1;
  insert into public.sports(owner_id, slug) values(v_owner, 'nfl') returning id into v_sport_2;
  for n in 1..3 loop
    insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider, available_at)
      values(v_owner, case when n = 3 then v_sport_2 else v_sport_1 end,
        'concurrency-fixture-' || n, 'chat', 'openllms', now() - make_interval(secs => 4 - n))
      returning * into v_job;
    insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
      values(v_owner, v_job.sport_id, 'user', 'Fixture request', v_job.id) returning id into v_message;
    update public.analysis_jobs set user_message_id = v_message where id = v_job.id;
  end loop;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into v_first from public.claim_gateway_job('fixture-slot-1', 120);
  select * into v_second from public.claim_gateway_job('fixture-slot-2', 120);
  if v_first.sport_id is distinct from v_sport_1 or v_second.sport_id is distinct from v_sport_2 then
    raise exception 'Busy sport blocked another sport or same-sport jobs overlapped';
  end if;
  select * into v_same from public.claim_gateway_job('fixture-slot-3', 120);
  if v_same.id is not null then raise exception 'Same sport claimed while running'; end if;
  if not public.fail_gateway_job(v_first.id, v_first.current_attempt_id, 'fixture-slot-1', 'failed', 'Fixture completion') then
    raise exception 'Could not release first sport';
  end if;
  select * into v_same from public.claim_gateway_job('fixture-slot-3', 120);
  if v_same.sport_id is distinct from v_sport_1 or v_same.id = v_first.id then
    raise exception 'Next same-sport job was not claimable after completion';
  end if;
end $$;
rollback;
