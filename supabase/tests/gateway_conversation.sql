-- Run after 202610010002_gateway_conversation.sql; no fixture data survives.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_sport uuid;
  v_slug text;
  v_job uuid;
  v_attempt uuid;
  v_message uuid;
  v_other_sport uuid;
  v_other_job uuid;
  v_other_attempt uuid := gen_random_uuid();
  v_latest uuid;
  v_metadata jsonb := '{"type":"conversation","result_type":"conversation","terminalStatus":"completed","verified":false,"searched":false,"sources":[],"response_purpose":{"version":1,"intent":"conversation","basis":"stored_context","referenced_message_ids":[],"requires_fresh_data":false},"response_purpose_status":"valid","original_model_response":"audit ```analysis-record malformed"}'::jsonb;
  v_bad jsonb;
  v_fresh jsonb;
  v_count integer;
  v_sports text[] := array['mlb','nfl','cfb','soccer','tennis','nba','wnba','nhl'];
begin
  if has_function_privilege('authenticated','public.finalize_gateway_conversation_job(uuid,uuid,text,text,jsonb,text)','EXECUTE')
    or has_function_privilege('anon','public.finalize_gateway_conversation_job(uuid,uuid,text,text,jsonb,text)','EXECUTE')
    or not has_function_privilege('service_role','public.finalize_gateway_conversation_job(uuid,uuid,text,text,jsonb,text)','EXECUTE') then
    raise exception 'Conversation finalizer grants are incorrect';
  end if;
  insert into auth.users(id,email) values(v_owner,'conversation-owner@example.invalid'),(v_other,'conversation-other@example.invalid');
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into public.sports(owner_id,slug) values(v_other,'mlb') returning id into v_other_sport;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
    values(v_other,v_other_sport,'other-owner','message','openllms') returning id into v_other_job;
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at)
    values(v_other_attempt,v_other_job,v_other,1,'conversation-worker',clock_timestamp());
  update public.analysis_jobs set status='running',current_attempt_id=v_other_attempt,
    lease_owner='conversation-worker',lease_expires_at=clock_timestamp()+interval '5 minutes' where id=v_other_job;
  for v_slug in select unnest(v_sports) loop
    v_metadata := jsonb_set(v_metadata,'{searched}',to_jsonb(v_slug='soccer'));
    v_metadata := jsonb_set(v_metadata,'{verified}','false'::jsonb);
    v_metadata := jsonb_set(v_metadata,'{sources}','[]'::jsonb);
    v_metadata := jsonb_set(v_metadata,'{response_purpose,basis}','"stored_context"'::jsonb);
    insert into public.sports(owner_id,slug) values(v_owner,v_slug) returning id into v_sport;
    insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider,status,created_at)
      values(v_owner,v_sport,'legacy-analysis','quick','openllms','completed',clock_timestamp()-interval '1 hour') returning id into v_latest;
    insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
      values(v_owner,v_sport,'conversation','message','openllms') returning id into v_job;
    v_attempt := gen_random_uuid();
    insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at)
      values(v_attempt,v_job,v_owner,1,'conversation-worker',clock_timestamp());
    update public.analysis_jobs set status='running',current_attempt_id=v_attempt,
      lease_owner='conversation-worker',lease_expires_at=clock_timestamp()+interval '5 minutes' where id=v_job;
    -- All rejected calls must leave the running job/attempt and messages intact.
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'wrong-worker','대화',v_metadata);
      raise exception 'Foreign worker finalized conversation';
    exception when sqlstate '55000' then null; end;
    begin
      perform public.finalize_gateway_conversation_job(v_job,gen_random_uuid(),'conversation-worker','대화',v_metadata);
      raise exception 'Wrong attempt finalized conversation';
    exception when sqlstate '55000' then null; end;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_other_attempt,'conversation-worker','대화',v_metadata);
      raise exception 'Cross-owner attempt finalized conversation';
    exception when sqlstate '55000' then null; end;
    update public.analysis_attempts set worker_id='foreign-worker' where id=v_attempt;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','대화',v_metadata);
      raise exception 'Mismatched attempt worker finalized conversation';
    exception when sqlstate '55000' then null; end;
    update public.analysis_attempts set worker_id='conversation-worker' where id=v_attempt;
    update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','대화',v_metadata);
      raise exception 'Expired lease finalized conversation';
    exception when sqlstate '55000' then null; end;
    update public.analysis_jobs set lease_expires_at=clock_timestamp()+interval '5 minutes' where id=v_job;
    update public.analysis_attempts set execution_started_at=null where id=v_attempt;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','대화',v_metadata);
      raise exception 'Unstarted execution finalized conversation';
    exception when sqlstate '55000' then null; end;
    update public.analysis_attempts set execution_started_at=clock_timestamp() where id=v_attempt;
    v_fresh := jsonb_set(v_metadata,'{response_purpose,basis}','"fresh_web"'::jsonb)
      || '{"searched":true,"verified":true,"sources":[{"url":"https://example.invalid/explanation"}]}'::jsonb;
    for v_bad in select value from jsonb_array_elements(jsonb_build_array(
      v_metadata||'{"analysis_record":{"events":[{}]}}'::jsonb,
      jsonb_set(v_metadata,'{response_purpose,basis}','"fresh_web"'::jsonb),
      v_fresh||'{"searched":false}'::jsonb,
      v_fresh||'{"verified":false}'::jsonb,
      v_fresh||'{"sources":[]}'::jsonb,
      v_metadata||'{"coverage":{}}'::jsonb,
      v_metadata||'{"analysis_coverage":{}}'::jsonb,
      v_metadata||'{"analysis_scope":{}}'::jsonb,
      jsonb_set(v_metadata,'{response_purpose,requires_fresh_data}','true'::jsonb),
      jsonb_set(v_metadata,'{response_purpose,referenced_message_ids}','[{}]'::jsonb),
      v_metadata||'{"response_purpose":{"purpose":"fresh_analysis"}}'::jsonb,
      v_metadata||'{"terminalStatus":"failed"}'::jsonb,
      v_metadata||'{"verified":"false"}'::jsonb)) loop
      begin
        perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','대화',v_bad);
        raise exception 'Contradictory conversation metadata accepted';
      exception when sqlstate '22023' then null; end;
    end loop;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','```analysis-record'||chr(10)||'{}',v_metadata);
      raise exception 'Machine analysis payload accepted';
    exception when sqlstate '22023' then null; end;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker',' ',v_metadata);
      raise exception 'Blank conversation accepted';
    exception when sqlstate '22023' then null; end;
    perform set_config('request.jwt.claim.role','authenticated',true);
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','대화',v_metadata);
      raise exception 'Authenticated caller finalized conversation';
    exception when sqlstate '42501' then null; end;
    begin
      update public.analysis_jobs set status='completed',result_type='conversation' where id=v_job;
      raise exception 'Authenticated caller bypassed conversation finalizer';
    exception when sqlstate '42501' then null; end;
    perform set_config('request.jwt.claim.role','service_role',true);
    if exists(select 1 from public.messages where analysis_job_id=v_job and role='assistant')
      or (select status from public.analysis_jobs where id=v_job) <> 'running'
      or (select status from public.analysis_attempts where id=v_attempt) <> 'running' then
      raise exception 'Rejected calls mutated conversation state';
    end if;
    -- A genuinely sourced general explanation remains conversation and preserves the analysis card.
    if v_slug='soccer' then
      v_metadata := v_fresh;
    end if;
    v_message := public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','함께 이야기해요.',v_metadata,'conversation-response');
    if (select result_type from public.analysis_jobs where id=v_job) <> 'conversation'
      or (select status from public.analysis_attempts where id=v_attempt) <> 'completed'
      or (select metadata from public.messages where id=v_message) <> v_metadata
      -- 202610060002 deliberately adds the unavailable-policy audit marker to terminal jobs.
      or (select provider_metadata from public.analysis_jobs where id=v_job) <> (v_metadata || '{"common_policy":null}'::jsonb) then
      raise exception 'Conversation completion altered truthful metadata or state';
    end if;
    begin
      perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','duplicate',v_metadata);
      raise exception 'Double completion accepted';
    exception when sqlstate '55000' then null; end;
    if (select id from public.analysis_jobs where owner_id=v_owner and sport_id=v_sport and status='completed'
      and (result_type is null or result_type='analysis') order by created_at desc limit 1) <> v_latest then
      raise exception 'Conversation replaced latest analysis';
    end if;
  end loop;
  if (select count(*) from public.messages where owner_id=v_owner and role='assistant') <> cardinality(v_sports)
    or exists(select 1 from public.events where owner_id=v_owner)
    or exists(select 1 from public.recommendations where owner_id=v_owner)
    or exists(select 1 from public.bets where owner_id=v_owner)
    or exists(select 1 from public.criteria_versions where owner_id=v_owner) then
    raise exception 'Conversation duplicated messages or wrote analysis/ledger data';
  end if;
  -- Latest analysis finalizer keeps its verified result gate and records analysis classification.
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
    values(v_owner,v_sport,'analysis-finalize','quick','openllms') returning id into v_job;
  v_attempt := gen_random_uuid();
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at)
    values(v_attempt,v_job,v_owner,1,'conversation-worker',clock_timestamp());
  update public.analysis_jobs set status='running',current_attempt_id=v_attempt,
    lease_owner='conversation-worker',lease_expires_at=clock_timestamp()+interval '5 minutes' where id=v_job;
  begin
    perform public.finalize_gateway_conversation_job(v_job,v_attempt,'conversation-worker','quick analysis',v_metadata);
    raise exception 'Quick analysis used conversation finalizer';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.finalize_gateway_job(v_job,v_attempt,'conversation-worker','unverified',v_metadata);
    raise exception 'Analysis finalizer accepted unverified conversation';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Only verified completed gateway results may be finalized' then raise; end if;
  end;
  v_message := public.finalize_gateway_job(v_job,v_attempt,'conversation-worker','verified analysis',
    '{"terminalStatus":"completed","verified":true,"searched":true,"sources":[]}'::jsonb);
  if (select result_type from public.analysis_jobs where id=v_job) <> 'analysis' then
    raise exception 'Analysis finalizer omitted classification';
  end if;
end $$;
rollback;
