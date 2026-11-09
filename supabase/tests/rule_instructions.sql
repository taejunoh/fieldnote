-- Run after 202609300001_atomic_rule_instructions.sql; this leaves no fixture data.
begin;

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000301', 'rule-instruction-fixture@example.invalid'),
  ('00000000-0000-4000-8000-000000000302', 'rule-instruction-other@example.invalid');
insert into public.sports(id, owner_id, slug) values
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000301', 'mlb'),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000301', 'soccer'),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000302', 'mlb');
insert into public.analysis_jobs(
  id, owner_id, sport_id, request_key, kind, provider, status, attempt, error
) values (
  '00000000-0000-4000-8000-000000000307',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000303',
  'failed-rule-retry', 'message', 'openllms', 'failed', 2, 'preserved failure'
);
insert into public.analysis_attempts(
  id, job_id, owner_id, attempt_number, worker_id, status, finished_at, error
) values (
  '00000000-0000-4000-8000-000000000306',
  '00000000-0000-4000-8000-000000000307',
  '00000000-0000-4000-8000-000000000301',
  2, 'fixture-worker', 'failed', clock_timestamp(), 'attempt failure'
);
update public.analysis_jobs set current_attempt_id = '00000000-0000-4000-8000-000000000306'
  where id = '00000000-0000-4000-8000-000000000307';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000301', true);

do $$
declare
  v_owner uuid := auth.uid();
  v_sport uuid := '00000000-0000-4000-8000-000000000303';
  v_other_sport uuid := '00000000-0000-4000-8000-000000000304';
  v_result jsonb;
  v_replay jsonb;
  v_rule_id uuid;
  v_manual_rule_id uuid;
  v_attempt_id uuid := '00000000-0000-4000-8000-000000000306';
  v_message_id uuid;
  v_ack_id uuid;
  v_job uuid := '00000000-0000-4000-8000-000000000307';
  v_event_count integer;
  v_recommendation_count integer;
  v_bet_count integer;
  v_mistake_count integer;
  v_message_count integer;
  v_criteria_count integer;
begin
  v_result := public.apply_rule_instruction(v_sport, 'rule-local-1', 'default_recommended_units',
    '앞으로 유닛은 0.25u로 해줘', '기본 권장 유닛',
    '앞으로 분석의 기본 권장 유닛은 0.25u로 제안한다.',
    '알겠습니다. 기본 권장 유닛을 0.25u로 저장했습니다.');
  v_rule_id := (v_result->'rule'->>'id')::uuid;
  v_message_id := (v_result->'message'->>'id')::uuid;
  v_ack_id := (v_result->'assistantMessage'->>'id')::uuid;
  if v_result->>'replayed' <> 'false'
    or v_result->'message'->>'content' <> '앞으로 유닛은 0.25u로 해줘'
    or v_result->'rule'->>'source_message_id' <> v_message_id::text
    or v_result->'rule'->>'source_ref' <> 'rule-instruction:default_recommended_units'
    or v_result->'rule'->>'status' <> 'adopted'
    or v_result->'message'->'metadata'->>'type' <> 'rule_instruction'
    or v_result->'assistantMessage'->'metadata'->>'type' <> 'rule_instruction' then
    raise exception 'Rule request did not store raw source, adopted criterion, and deterministic acknowledgment';
  end if;
  if v_result->'assistantMessage'->>'id' is distinct from v_ack_id::text then
    raise exception 'Rule acknowledgment ID was not returned';
  end if;
  v_replay := public.apply_rule_instruction(v_sport, 'rule-local-1', 'default_recommended_units',
    '앞으로 유닛은 0.25u로 해줘', '기본 권장 유닛', 'Changed request content', 'Changed acknowledgment');
  if v_replay->>'replayed' <> 'true'
    or v_replay->'message'->>'id' <> v_message_id::text
    or v_replay->'assistantMessage'->>'id' <> v_ack_id::text
    or v_replay->'rule'->>'id' <> v_rule_id::text then
    raise exception 'Idempotent replay did not return original rows';
  end if;

  begin
    perform public.apply_rule_instruction(v_sport, 'rule-local-1', 'preferred_sources',
      '출처는 공식 사이트 우선으로 확인해줘', '출처', 'Source rule', 'Stored');
    raise exception 'Different content reused a request key';
  exception when sqlstate '23505' then null;
  end;

  begin
    perform public.apply_rule_instruction('00000000-0000-4000-8000-000000000305', 'foreign-owner',
      'preferred_sources', '출처는 공식 사이트 우선으로 확인해줘', '출처', 'Source rule', 'Stored');
    raise exception 'Foreign-owner sport was accepted';
  exception when others then
    if sqlerrm <> 'Sport not found' then raise; end if;
  end;
  begin
    perform public.apply_rule_instruction(v_other_sport, 'wrong-sport-source', 'preferred_sources',
      '출처는 공식 사이트 우선으로 확인해줘', '출처', 'Source rule', 'Stored');
  exception when others then raise; end;

  -- A later request for the same setting supersedes the adopted rule atomically.
  v_result := public.apply_rule_instruction(v_sport, 'rule-local-2', 'default_recommended_units',
    '앞으로 유닛은 0.25u로 해줘', '기본 권장 유닛', 'Updated adopted version', 'Saved');
  if (select status from public.criteria_versions where id = v_rule_id) <> 'superseded'
    or v_result->'rule'->>'status' <> 'adopted'
    or v_result->'rule'->>'supersedes_id' <> v_rule_id::text then
    raise exception 'Same command did not supersede its previous adopted version';
  end if;
  v_rule_id := (v_result->'rule'->>'id')::uuid;
  select id into v_manual_rule_id from public.create_criteria_version(
    v_sport, 'Manually edited units', 'Manual correction', 'adopted', v_rule_id
  );
  v_result := public.apply_rule_instruction(v_sport, 'rule-local-3', 'default_recommended_units',
    '앞으로 유닛은 0.25u로 해줘', '기본 권장 유닛', 'Third adopted version', 'Saved');
  if (select status from public.criteria_versions where id = v_manual_rule_id) <> 'superseded'
    or v_result->'rule'->>'supersedes_id' <> v_manual_rule_id::text then
    raise exception 'Manual adopted edit was not kept in the command supersession chain';
  end if;

  -- Local request keys reject an analysis job insert, and an existing job key rejects local mode.
  begin
    insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
      values(v_owner, v_sport, 'rule-local-1', 'message', 'openllms');
    raise exception 'Analysis job accepted a local request key';
  exception when sqlstate '23505' then null;
  end;
  insert into public.analysis_jobs(owner_id, sport_id, request_key, kind, provider)
    values(v_owner, v_sport, 'analysis-key-1', 'message', 'openllms');
  begin
    perform public.apply_rule_instruction(v_sport, 'analysis-key-1', 'preferred_sources',
      '출처는 공식 사이트 우선으로 확인해줘', '출처', 'Source rule', 'Stored');
    raise exception 'Local request accepted an analysis job key';
  exception when sqlstate '23505' then null;
  end;

  -- A failed recognized message resolves locally while preserving job/attempt history.
  insert into public.messages(owner_id, sport_id, role, content, analysis_job_id)
    values(v_owner, v_sport, 'user',
      '알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.',
      v_job) returning id into v_message_id;
  update public.analysis_jobs set user_message_id = v_message_id where id = v_job;
  v_result := public.apply_rule_instruction(v_sport, 'failed-rule-retry',
    'pre_game_hypothetical_assessment',
    (select content from public.messages where id = v_message_id), '가상 재평가',
    '재평가는 사전 정보에 기반한 가상 평가다.', '저장했습니다.', v_job);
  if v_result->'job'->>'status' <> 'failed'
    or v_result->'job'->>'attempt' <> '2'
    or v_result->'job'->>'dismissed_attempt' <> '2'
    or v_result->'job'->>'error' is null
    or v_result->'job'->'provider_metadata'->'resolution'->>'type' <> 'rule_instruction' then
    raise exception 'Local retry changed job state or failed to record its resolution';
  end if;
  if (select status from public.analysis_attempts where id = v_attempt_id) <> 'failed'
    or (select error from public.analysis_attempts where id = v_attempt_id) <> 'attempt failure'
    or (select error from public.analysis_jobs where id = v_job) <> 'preserved failure' then
    raise exception 'Local retry changed failed job or attempt history';
  end if;
  v_replay := public.apply_rule_instruction(v_sport, 'failed-rule-retry',
    'pre_game_hypothetical_assessment',
    (select content from public.messages where id = v_message_id), '가상 재평가',
    'Different text ignored on replay', 'Different ack ignored on replay', v_job);
  if v_replay->'assistantMessage'->>'id' <> v_result->'assistantMessage'->>'id'
    or v_replay->'job'->>'attempt' <> '2' then
    raise exception 'Repeated local retry duplicated acknowledgment or changed attempt';
  end if;
  update public.analysis_jobs set status = 'completed' where id = v_job;
  begin
    perform public.apply_rule_instruction(v_sport, 'failed-rule-retry',
      'pre_game_hypothetical_assessment',
      (select content from public.messages where id = v_message_id), '가상 재평가',
      'ignored', 'ignored', v_job);
    raise exception 'Completed local retry was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Job is not retryable' then raise; end if;
  end;
  update public.analysis_jobs set status = 'queued' where id = v_job;
  begin
    perform public.apply_rule_instruction(v_sport, 'failed-rule-retry',
      'pre_game_hypothetical_assessment',
      (select content from public.messages where id = v_message_id), '가상 재평가',
      'ignored', 'ignored', v_job);
    raise exception 'Queued local retry was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Job is not retryable' then raise; end if;
  end;

  select count(*) into v_event_count from public.events where owner_id = v_owner;
  select count(*) into v_recommendation_count from public.recommendations where owner_id = v_owner;
  select count(*) into v_bet_count from public.bets where owner_id = v_owner;
  select count(*) into v_mistake_count from public.mistake_notes where owner_id = v_owner;
  if v_event_count <> 0 or v_recommendation_count <> 0 or v_bet_count <> 0 or v_mistake_count <> 0 then
    raise exception 'Rule instruction wrote analysis or betting records';
  end if;

  -- A rejected invalid request leaves no partial user/assistant messages or criterion.
  select count(*) into v_message_count from public.messages where owner_id = v_owner;
  select count(*) into v_criteria_count from public.criteria_versions where owner_id = v_owner;
  begin
    perform public.apply_rule_instruction(v_sport, 'invalid-rule', 'preferred_sources',
      'invalid', '', 'invalid', 'invalid');
    raise exception 'Invalid rule instruction was accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.messages where owner_id = v_owner) <> v_message_count
    or (select count(*) from public.criteria_versions where owner_id = v_owner) <> v_criteria_count then
    raise exception 'Failed rule instruction left partial rows';
  end if;
end $$;

rollback;
