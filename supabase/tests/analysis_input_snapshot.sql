-- Run after 202609300002_analysis_input_snapshot.sql in a transaction and roll back.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sport uuid;
  v_job uuid;
  v_message uuid;
  v_claim public.analysis_jobs%rowtype;
  v_snapshot jsonb := '{"version":1,"context":"private exact context","instructions":"exact instructions","requested":{"model":"gpt-6-astra","effort":"xhigh","mode":"default_standard"},"execution_time":"2026-09-30T12:00:00Z","context_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","instructions_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","source_document_refs":[]}'::jsonb;
  v_saved jsonb;
begin
  if has_function_privilege('authenticated', 'public.save_gateway_input_snapshot(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.save_gateway_input_snapshot(uuid,uuid,text,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.save_gateway_input_snapshot(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'Snapshot RPC grants are not service-only';
  end if;
  insert into auth.users(id,email) values(v_owner,'snapshot-fixture@example.invalid');
  insert into public.sports(owner_id,slug) values(v_owner,'mlb') returning id into v_sport;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider,model,effort)
    values(v_owner,v_sport,'snapshot-fixture','message','openllms','gpt-6-astra','xhigh') returning id into v_job;
  insert into public.messages(owner_id,sport_id,role,content,analysis_job_id)
    values(v_owner,v_sport,'user','Fixture request',v_job) returning id into v_message;
  update public.analysis_jobs set user_message_id=v_message where id=v_job;
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into v_claim from public.claim_gateway_job('snapshot-worker',120);
  if v_claim.id is distinct from v_job then raise exception 'Fixture claim failed'; end if;
  if public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'other-worker',v_snapshot)
    or public.save_gateway_input_snapshot(v_job,gen_random_uuid(),'snapshot-worker',v_snapshot) then
    raise exception 'Snapshot accepted stale attempt or other worker';
  end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'snapshot-worker',v_snapshot);
    raise exception 'Authenticated caller bypassed snapshot role check';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.role','service_role',true);
  update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job;
  if public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'snapshot-worker',v_snapshot) then
    raise exception 'Expired lease saved a snapshot';
  end if;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()+interval '120 seconds' where id=v_job;
  if not public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'snapshot-worker',v_snapshot) then
    raise exception 'Current lease snapshot rejected';
  end if;
  if public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'snapshot-worker',v_snapshot || '{"context":"overwritten"}') then
    raise exception 'Snapshot was overwritten';
  end if;
  select input_snapshot into v_saved from public.analysis_attempts where id=v_claim.current_attempt_id;
  if v_saved is distinct from v_snapshot then raise exception 'Exact snapshot differs'; end if;
  if not public.fail_gateway_job(v_job,v_claim.current_attempt_id,'snapshot-worker','failed','Fixture failure','{"code":"fixture"}') then
    raise exception 'Fixture failure failed';
  end if;
  select input_snapshot into v_saved from public.analysis_attempts where id=v_claim.current_attempt_id;
  if v_saved is distinct from v_snapshot then raise exception 'Failed attempt destroyed audit snapshot'; end if;
  if public.save_gateway_input_snapshot(v_job,v_claim.current_attempt_id,'snapshot-worker',v_snapshot) then
    raise exception 'Terminal attempt accepted snapshot';
  end if;
end $$;
