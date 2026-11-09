-- Rollback-only regression for terminal policy provenance and explicit retry history.
-- Run in an isolated/idle test database after 202610060002_common_policy_attempts.sql.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport uuid;
  v_job uuid;
  v_message uuid;
  v_claim public.analysis_jobs%rowtype;
  v_retry public.analysis_jobs%rowtype;
  v_first_attempt uuid;
  v_policy jsonb := jsonb_build_object('id', gen_random_uuid(), 'version_date', '2026-10-06', 'content_hash', repeat('a', 64));
  v_next_policy jsonb := jsonb_build_object('id', gen_random_uuid(), 'version_date', '2026-10-07', 'content_hash', repeat('b', 64));
  v_snapshot jsonb := jsonb_build_object('version', 1, 'context', 'Private exact context', 'instructions', 'Exact instructions',
    'requested', jsonb_build_object('model', 'gpt-6-astra', 'effort', 'xhigh', 'mode', 'default_standard'),
    'execution_time', '2026-10-06T12:00:00Z', 'context_sha256', repeat('c', 64), 'instructions_sha256', repeat('d', 64), 'source_document_refs', '[]'::jsonb);
  v_current_snapshot jsonb;
  v_metadata jsonb;
begin
  if exists (select 1 from public.analysis_jobs where provider = 'openllms' and status in ('queued','running')) then
    raise exception 'Policy attempt fixture requires an idle test database';
  end if;
  insert into auth.users(id, email) values(v_owner, 'policy-attempt-fixture@example.invalid');
  insert into public.sports(owner_id, slug) values(v_owner, 'mlb') returning id into v_sport;
  -- Claim-driven expiry must copy the captured attempt revision, or explicit null before loading input.
  for n in 1..2 loop
    insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
      values(v_owner,v_sport,'policy-attempt-expiry-'||n,'message','openllms') returning id into v_job;
    insert into public.messages(owner_id,sport_id,role,content,analysis_job_id)
      values(v_owner,v_sport,'user','Fixture request',v_job) returning id into v_message;
    update public.analysis_jobs set user_message_id=v_message where id=v_job;
    perform set_config('request.jwt.claim.role','service_role',true);
    select * into v_claim from public.claim_gateway_job('policy-attempt-worker',120);
    if v_claim.id is distinct from v_job then raise exception 'Fixture claim failed'; end if;
    v_current_snapshot := '{}'::jsonb;
    if n = 1 then
      v_current_snapshot := v_snapshot || jsonb_build_object('common_policy',v_policy);
      if not public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'policy-attempt-worker',v_current_snapshot) then
        raise exception 'Fixture snapshot failed';
      end if;
      -- A job's leftover metadata cannot replace the current attempt's captured revision.
      update public.analysis_jobs set provider_metadata=jsonb_build_object('common_policy',v_next_policy) where id=v_job;
    else
      -- A stale reference without captured input must not claim a policy was loaded.
      update public.analysis_jobs set provider_metadata=jsonb_build_object('common_policy',v_policy) where id=v_job;
      update public.analysis_attempts set provider_metadata=jsonb_build_object('common_policy',v_policy) where id=v_claim.current_attempt_id;
    end if;
    update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job;
    perform public.claim_gateway_job('policy-attempt-reaper',120);
    select provider_metadata into v_metadata from public.analysis_attempts where id=v_claim.current_attempt_id;
    if (select status from public.analysis_jobs where id=v_job) <> 'interrupted'
      or v_metadata->'common_policy' is distinct from (case when n=1 then v_policy else 'null'::jsonb end)
      or (select provider_metadata->'common_policy' from public.analysis_jobs where id=v_job) is distinct from v_metadata->'common_policy'
      or (select input_snapshot from public.analysis_attempts where id=v_claim.current_attempt_id) is distinct from v_current_snapshot then
      raise exception 'Expired claim lost captured policy, explicit absence, or exact snapshot';
    end if;
  end loop;
  -- Owner retry can expire a running attempt directly; it must retain that attempt's revision.
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  v_retry := public.retry_gateway_job(v_job);
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into v_claim from public.claim_gateway_job('policy-retry-worker',120);
  v_first_attempt := v_claim.current_attempt_id;
  v_current_snapshot := v_snapshot || jsonb_build_object('common_policy',v_policy);
  perform public.save_gateway_input_snapshot(v_job,v_first_attempt,'policy-retry-worker',v_current_snapshot);
  update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job;
  perform set_config('request.jwt.claim.role','authenticated',true);
  v_retry := public.retry_gateway_job(v_job);
  if (select status from public.analysis_attempts where id=v_first_attempt) <> 'interrupted'
    or (select provider_metadata->'common_policy' from public.analysis_attempts where id=v_first_attempt) is distinct from v_policy
    or v_retry.current_attempt_id is not null or v_retry.provider_metadata <> '{}'::jsonb then
    raise exception 'Expired owner retry lost old policy audit or retained stale job state';
  end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into v_claim from public.claim_gateway_job('policy-new-worker',120);
  perform public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'policy-new-worker',v_snapshot || jsonb_build_object('common_policy',v_next_policy));
  if not public.fail_gateway_job(v_job,v_claim.current_attempt_id,'policy-new-worker','failed','Fixture failure','{}'::jsonb) then
    raise exception 'Current failure rejected';
  end if;
  if (select provider_metadata->'common_policy' from public.analysis_attempts where id=v_claim.current_attempt_id) is distinct from v_next_policy
    or (select provider_metadata->'common_policy' from public.analysis_jobs where id=v_job) is distinct from v_next_policy
    or (select provider_metadata->'common_policy' from public.analysis_attempts where id=v_first_attempt) is distinct from v_policy
    or (select input_snapshot from public.analysis_attempts where id=v_first_attempt) is distinct from v_current_snapshot then
    raise exception 'New retry rewrote prior attempt policy or failure omitted snapshot policy';
  end if;
  if has_function_privilege('authenticated','public.claim_gateway_job(text,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.retry_gateway_job(uuid)','EXECUTE') then
    raise exception 'Worker/user grants changed';
  end if;
  -- Before context load failure is explicit null; failed snapshot save retains the loaded in-memory reference.
  for n in 1..2 loop
    insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
      values(v_owner,v_sport,'policy-attempt-failure-'||n,'message','openllms') returning id into v_job;
    insert into public.messages(owner_id,sport_id,role,content,analysis_job_id)
      values(v_owner,v_sport,'user','Fixture request',v_job) returning id into v_message;
    update public.analysis_jobs set user_message_id=v_message where id=v_job;
    select * into v_claim from public.claim_gateway_job('policy-failure-worker',120);
    v_metadata := case when n=1 then '{}'::jsonb else jsonb_build_object('common_policy',v_next_policy,'code','input_snapshot_save_failed') end;
    perform public.fail_gateway_job(v_job,v_claim.current_attempt_id,'policy-failure-worker','failed','Fixture no-input failure',v_metadata);
    if (select provider_metadata->'common_policy' from public.analysis_attempts where id=v_claim.current_attempt_id)
      is distinct from (case when n=1 then 'null'::jsonb else v_next_policy end)
      or (select provider_metadata->'common_policy' from public.analysis_jobs where id=v_job)
      is distinct from (case when n=1 then 'null'::jsonb else v_next_policy end)
      or (select input_snapshot from public.analysis_attempts where id=v_claim.current_attempt_id) <> '{}'::jsonb then
      raise exception 'No-input failure fabricated a policy or lost supplied loaded revision';
    end if;
  end loop;
end $$;
rollback;
