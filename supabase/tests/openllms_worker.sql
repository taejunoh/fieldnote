-- Run after 202609230002_openllms_worker.sql inside a transaction and roll back.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport uuid;
  v_other_sport uuid;
  v_job_1 uuid;
  v_job_2 uuid;
  v_job_3 uuid;
  v_claim_1 public.analysis_jobs%rowtype;
  v_claim_2 public.analysis_jobs%rowtype;
  v_claim_3 public.analysis_jobs%rowtype;
  v_unready_claim public.analysis_jobs%rowtype;
  v_retry public.analysis_jobs%rowtype;
  v_message uuid;
  v_user_message uuid;
  v_count integer;
begin
  insert into auth.users(id, email) values(v_owner, 'gateway-fixture@example.invalid');
  insert into public.sports(owner_id, slug) values(v_owner, 'mlb') returning id into v_sport;
  insert into public.sports(owner_id, slug) values(v_owner, 'nfl') returning id into v_other_sport;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'gateway-fixture-1', 'chat', 'openllms') returning id into v_job_1;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_other_sport, 'gateway-fixture-2', 'chat', 'openllms') returning id into v_job_2;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'gateway-fixture-3', 'chat', 'openllms') returning id into v_job_3;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'First request', v_job_1) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_job_1;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_other_sport, 'user', 'Second request', v_job_2) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_job_2;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into v_claim_1 from public.claim_gateway_job('fixture-worker', 120);
  select * into v_claim_2 from public.claim_gateway_job('fixture-worker', 120);
  if v_claim_1.id is null or v_claim_2.id is null or v_claim_1.id = v_claim_2.id
    or v_claim_1.current_attempt_id is null or v_claim_2.current_attempt_id is null
    or v_claim_1.id = v_job_3 or v_claim_2.id = v_job_3 then
    raise exception 'Claims were not distinct';
  end if;
  select * into v_unready_claim from public.claim_gateway_job('fixture-worker', 120);
  if v_unready_claim.id is not null then
    raise exception 'Claim accepted job before user message was linked';
  end if;
  v_job_1 := v_claim_1.id;
  v_job_2 := v_claim_2.id;
  if public.heartbeat_gateway_job(v_job_1, v_claim_2.current_attempt_id, 'fixture-worker') then
    raise exception 'Heartbeat accepted wrong attempt';
  end if;
  if not public.heartbeat_gateway_job(v_job_1, v_claim_1.current_attempt_id,
      'fixture-worker', 120, true) then
    raise exception 'Heartbeat rejected current attempt';
  end if;
  begin
    perform public.finalize_gateway_job(v_job_1, v_claim_1.current_attempt_id,
      'fixture-worker', 'Unverified', '{"terminalStatus":"completed","verified":false}'::jsonb);
    raise exception 'Finalizer accepted unverified result';
  exception when others then
    if sqlerrm <> 'Only verified completed gateway results may be finalized' then raise; end if;
  end;
  begin
    perform public.finalize_gateway_job(v_job_1, v_claim_1.current_attempt_id,
      'fixture-worker', 'Missing metadata');
    raise exception 'Finalizer accepted missing verification metadata';
  exception when others then
    if sqlerrm <> 'Only verified completed gateway results may be finalized' then raise; end if;
  end;

  v_message := public.finalize_gateway_job(v_job_1, v_claim_1.current_attempt_id,
    'fixture-worker', 'Fixture result',
    '{"terminalStatus":"completed","verified":true,"sources":[{"url":"https://example.invalid"}]}'::jsonb,
    'fixture-response');
  if v_message is null then raise exception 'Finalizer returned no message'; end if;
  begin
    perform public.finalize_gateway_job(v_job_1, v_claim_1.current_attempt_id,
      'fixture-worker', 'Duplicate', '{"terminalStatus":"completed","verified":true}'::jsonb);
    raise exception 'Finalizer accepted completed attempt';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.finalize_analysis_job(v_job_1, 'legacy-response', 'Bypass');
    raise exception 'Legacy finalizer accepted gateway job';
  exception when sqlstate '55000' then null;
  end;
  select count(*) into v_count from public.messages
    where analysis_job_id = v_job_1 and role = 'assistant';
  if v_count <> 1 then raise exception 'Assistant message was duplicated'; end if;

  if not public.fail_gateway_job(v_job_2, v_claim_2.current_attempt_id,
      'fixture-worker', 'interrupted', 'Outcome unknown') then
    raise exception 'Current attempt failure was rejected';
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_retry := public.retry_gateway_job(v_job_2);
  if v_retry.status <> 'queued' or v_retry.attempt <> 2
    or v_retry.current_attempt_id is not null then
    raise exception 'Explicit retry did not queue a new attempt';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into v_retry from public.claim_gateway_job('fixture-worker-2', 120);
  if v_retry.id is distinct from v_job_2 or v_retry.current_attempt_id = v_claim_2.current_attempt_id then
    raise exception 'Retry did not create a fresh attempt';
  end if;
  if public.fail_gateway_job(v_job_2, v_claim_2.current_attempt_id,
      'fixture-worker', 'failed', 'Stale') then
    raise exception 'Old attempt changed retried job';
  end if;
  select count(*) into v_count from public.analysis_attempts where job_id = v_job_2;
  if v_count <> 2 then raise exception 'Attempt history missing'; end if;
  if not public.fail_gateway_job(v_job_2, v_retry.current_attempt_id,
      'fixture-worker-2', 'failed', 'Fixture failure') then
    raise exception 'Fresh attempt failure was rejected';
  end if;

  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'Third request', v_job_3) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_job_3;
  select * into v_claim_3 from public.claim_gateway_job('fixture-worker-3', 120);
  if v_claim_3.id is distinct from v_job_3 then raise exception 'Third job was not claimed'; end if;
  begin
    perform public.fail_gateway_job(v_job_3, v_claim_3.current_attempt_id,
      'fixture-worker-3', 'queued', 'Unknown outcome');
    raise exception 'Unconfirmed automatic retry was accepted';
  exception when others then
    if sqlerrm <> 'Automatic retry requires confirmed safe pre-execution failure' then raise; end if;
  end;
  update public.analysis_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
    where id = v_job_3;
  perform public.claim_gateway_job('fixture-worker-4', 120);
  if (select status from public.analysis_jobs where id = v_job_3) <> 'interrupted'
    or (select status from public.analysis_attempts where id = v_claim_3.current_attempt_id) <> 'interrupted' then
    raise exception 'Expired lease was not preserved as interrupted';
  end if;
  if has_function_privilege('authenticated',
      'public.claim_gateway_job(text,integer)', 'EXECUTE') then
    raise exception 'Authenticated user can claim gateway work';
  end if;
  if not has_function_privilege('authenticated',
      'public.retry_gateway_job(uuid)', 'EXECUTE') then
    raise exception 'Authenticated user cannot request explicit retry';
  end if;
end $$;

-- Exercise the user RPC with the real authenticated database role.
select owner_id::text as fixture_owner, id::text as fixture_job
  from public.analysis_jobs where request_key in ('gateway-fixture-1','gateway-fixture-2')
    and status = 'failed' \gset
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true) as role_setting \gset
select set_config('request.jwt.claim.sub', :'fixture_owner', true) as owner_setting \gset
select 1 / (case when (public.retry_gateway_job(:'fixture_job'::uuid)).status = 'queued'
  then 1 else 0 end) as authenticated_retry_succeeded;
