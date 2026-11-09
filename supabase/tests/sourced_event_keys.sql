-- Run after 202609250004_sourced_event_keys.sql in psql. All fixture data rolls back.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport uuid;
  v_job uuid;
  v_bad_job uuid;
  v_attempt uuid := gen_random_uuid();
  v_bad_attempt uuid := gen_random_uuid();
  v_user_message uuid;
  v_message uuid;
  v_url text := 'https://www.wnba.com/playoffs/2026/matchups';
  v_key text;
  v_metadata jsonb;
  v_count integer;
begin
  v_key := 'wnba:2026-09-25:atl@lv:src-' || left(encode(extensions.digest(v_url, 'sha256'), 'hex'), 32);
  insert into auth.users(id, email) values(v_owner, 'sourced-key-fixture@example.invalid');
  insert into public.sports(owner_id, slug) values(v_owner, 'wnba') returning id into v_sport;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'sourced-key-good', 'chat', 'openllms') returning id into v_job;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'Analyze fixture', v_job) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_job;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, execution_started_at)
    values(v_attempt, v_job, v_owner, 1, 'sourced-key-worker', clock_timestamp());
  update public.analysis_jobs set status = 'running', current_attempt_id = v_attempt,
    lease_owner = 'sourced-key-worker', lease_expires_at = clock_timestamp() + interval '5 minutes'
    where id = v_job;
  v_metadata := jsonb_build_object(
    'terminalStatus', 'completed', 'verified', true, 'searched', true,
    'checked_at', '2026-09-25T12:00:00Z',
    'sources', jsonb_build_array(jsonb_build_object('url', v_url)),
    'analysis_record', jsonb_build_object(
      'version', 1, 'sport', 'wnba',
      'events', jsonb_build_array(jsonb_build_object(
        'event_key', v_key, 'label', 'Atlanta at Las Vegas', 'starts_at', null,
        'source_url', v_url, 'analysis_status', 'WATCH')),
      'recommendations', jsonb_build_array(jsonb_build_object(
        'item_key', 'main', 'event_key', v_key, 'market', 'Spread',
        'selection', 'Atlanta', 'decision', 'PASS',
        'suggested_units', 0, 'price_gate', null))));
  v_message := public.finalize_gateway_job(v_job, v_attempt,
    'sourced-key-worker', 'Fixture analysis', v_metadata, 'fixture-response');
  select count(*) into v_count from public.events
    where owner_id = v_owner and event_key = v_key and source_ref = v_url and analysis_status = 'WATCH';
  if v_count <> 1 then raise exception 'Source-derived event was not saved'; end if;
  select count(*) into v_count from public.recommendations
    where analysis_job_id = v_job and recommendation_item_key = 'main'
      and source_message_id = v_message and decision = 'PASS' and suggested_units = 0;
  if v_count <> 1 then raise exception 'Zero-unit recommendation was not saved'; end if;
  select count(*) into v_count from public.bets where owner_id = v_owner;
  if v_count <> 0 then raise exception 'Analysis wrote a bet'; end if;
  begin
    perform public.finalize_gateway_job(v_job, v_attempt, 'sourced-key-worker', 'Duplicate', v_metadata, 'fixture-response');
    raise exception 'Duplicate finalize accepted';
  exception when sqlstate '55000' then null;
  end;

  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'sourced-key-bad', 'chat', 'openllms') returning id into v_bad_job;
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user', 'Analyze bad fixture', v_bad_job) returning id into v_user_message;
  update public.analysis_jobs set user_message_id = v_user_message where id = v_bad_job;
  insert into public.analysis_attempts(id, job_id, owner_id, attempt_number, worker_id, execution_started_at)
    values(v_bad_attempt, v_bad_job, v_owner, 1, 'sourced-key-worker', clock_timestamp());
  update public.analysis_jobs set status = 'running', current_attempt_id = v_bad_attempt,
    lease_owner = 'sourced-key-worker', lease_expires_at = clock_timestamp() + interval '5 minutes'
    where id = v_bad_job;
  begin
    perform public.finalize_gateway_job(v_bad_job, v_bad_attempt, 'sourced-key-worker', 'Bad hash',
      jsonb_set(v_metadata, '{analysis_record,events,0,event_key}', '"wnba:2026-09-25:atl@lv:src-00000000000000000000000000000000"'::jsonb));
    raise exception 'Mismatched hash accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.finalize_gateway_job(v_bad_job, v_bad_attempt, 'sourced-key-worker', 'Unofficial source',
      jsonb_set(jsonb_set(v_metadata, '{analysis_record,events,0,source_url}', '"https://wnba.com.evil.example/game"'::jsonb),
        '{sources,0,url}', '"https://wnba.com.evil.example/game"'::jsonb));
    raise exception 'Unofficial source accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.finalize_gateway_job(v_bad_job, v_bad_attempt, 'sourced-key-worker', 'Uncited source',
      jsonb_set(v_metadata, '{sources,0,url}', '"https://www.wnba.com/other"'::jsonb));
    raise exception 'Uncited source accepted';
  exception when sqlstate '22023' then null;
  end;
  select count(*) into v_count from public.messages where analysis_job_id = v_bad_job and role = 'assistant';
  if v_count <> 0 then raise exception 'Rejected record left a message'; end if;
end $$;
rollback;
