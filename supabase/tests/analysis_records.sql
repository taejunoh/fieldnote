-- Run after 202609250002_analysis_records.sql in psql. This fixture rolls back.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport uuid;
  v_job uuid;
  v_bad_job uuid;
  v_user_message uuid;
  v_attempt uuid := gen_random_uuid();
  v_bad_attempt uuid := gen_random_uuid();
  v_message uuid;
  v_key text := 'mlb:2026-09-25:bos@nyy:id-123456';
  v_metadata jsonb;
  v_count integer;
begin
  insert into auth.users(id, email) values(v_owner, 'analysis-record-fixture@example.invalid');
  insert into public.sports(owner_id, slug) values(v_owner, 'mlb') returning id into v_sport;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'analysis-record-ok', 'chat', 'openllms') returning id into v_job;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'Analyze fixture', v_job) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_job;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, execution_started_at)
    values(v_attempt, v_job, v_owner, 1, 'analysis-record-worker', clock_timestamp());
  update public.analysis_jobs set status = 'running', current_attempt_id = v_attempt,
    lease_owner = 'analysis-record-worker', lease_expires_at = clock_timestamp() + interval '5 minutes'
    where id = v_job;
  v_metadata := jsonb_build_object(
    'terminalStatus', 'completed', 'verified', true, 'searched', true,
    'checked_at', '2026-09-25T12:00:00Z',
    'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.invalid/game')),
    'analysis_record', jsonb_build_object(
      'version', 1, 'sport', 'mlb',
      'events', jsonb_build_array(jsonb_build_object(
        'event_key', v_key, 'label', 'Boston at New York', 'starts_at', null,
        'source_url', 'https://example.invalid/game', 'analysis_status', 'PASS')),
      'recommendations', jsonb_build_array(jsonb_build_object(
        'item_key', 'main', 'event_key', v_key, 'market', 'Moneyline',
        'selection', 'Boston', 'decision', 'WAIT',
        'suggested_units', null, 'price_gate', null))));
  v_message := public.finalize_gateway_job(v_job, v_attempt,
    'analysis-record-worker', 'Fixture analysis', v_metadata, 'fixture-response');
  if v_message is null then raise exception 'No assistant message returned'; end if;
  select count(*) into v_count from public.messages where id = v_message and role = 'assistant';
  if v_count <> 1 then raise exception 'Assistant message missing or duplicated'; end if;
  select count(*) into v_count from public.events
    where owner_id = v_owner and sport_id = v_sport and event_key = v_key and analysis_status = 'PASS';
  if v_count <> 1 then raise exception 'Event not saved with explicit display status'; end if;
  select count(*) into v_count from public.recommendations
    where analysis_job_id = v_job and recommendation_item_key = 'main'
      and source_message_id = v_message and decision = 'WAIT';
  if v_count <> 1 then raise exception 'Recommendation or source attribution missing'; end if;
  select count(*) into v_count from public.bets where owner_id = v_owner;
  if v_count <> 0 then raise exception 'Analysis wrote a bet'; end if;
  begin
    perform public.finalize_gateway_job(v_job, v_attempt,
      'analysis-record-worker', 'Duplicate', v_metadata, 'fixture-response');
    raise exception 'Duplicate finalize accepted';
  exception when sqlstate '55000' then null;
  end;

  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'analysis-record-bad', 'chat', 'openllms') returning id into v_bad_job;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'Analyze bad fixture', v_bad_job) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_bad_job;
  insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, execution_started_at)
    values(v_bad_attempt, v_bad_job, v_owner, 1, 'analysis-record-worker', clock_timestamp());
  update public.analysis_jobs set status = 'running', current_attempt_id = v_bad_attempt,
    lease_owner = 'analysis-record-worker', lease_expires_at = clock_timestamp() + interval '5 minutes'
    where id = v_bad_job;
  begin
    perform public.finalize_gateway_job(v_bad_job, v_bad_attempt,
      'analysis-record-worker', 'Should roll back',
      jsonb_set(v_metadata, '{analysis_record,events,0,source_url}', '"https://unverified.invalid/game"'::jsonb));
    raise exception 'Unverified event source accepted';
  exception when sqlstate '22023' then null;
  end;
  select count(*) into v_count from public.messages where analysis_job_id = v_bad_job and role = 'assistant';
  if v_count <> 0 then raise exception 'Malformed finalize left an assistant message'; end if;
  if (select status from public.analysis_jobs where id = v_bad_job) <> 'running' then
    raise exception 'Malformed finalize changed job state';
  end if;
end $$;
rollback;
