-- Run with psql -v ON_ERROR_STOP=1 inside a transaction; always ROLLBACK.
-- Run only against an isolated local/test database: claim_gateway_job exercises real lease reaping.
-- All fixture/reaper writes are rolled back with the surrounding transaction.
do $$
declare
  o uuid := gen_random_uuid(); s uuid; j uuid; a uuid := gen_random_uuid();
  other_a uuid := gen_random_uuid(); d jsonb; bad jsonb; actual text;
  lease timestamptz := clock_timestamp() + interval '10 minutes';
  candidate jsonb;
begin
  if to_regprocedure('public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb)') is null then
    raise exception 'Missing durable diagnostics checkpoint RPC';
  end if;
  if has_function_privilege('anon','public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb)','EXECUTE') then
    raise exception 'Checkpoint execute privileges are unsafe';
  end if;
  insert into auth.users(id,email) values(o,'diagnostics-fixture@example.invalid');
  insert into public.sports(owner_id,slug) values(o,'nfl') returning id into s;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider,provider_metadata)
    values(o,s,'diagnostics-fixture','chat','openllms','{"sibling":"retained"}') returning id into j;
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at,provider_metadata)
    values(a,j,o,1,'diagnostics-worker',clock_timestamp(),'{"sibling":"retained"}');
  update public.analysis_jobs set status='running',current_attempt_id=a,lease_owner='diagnostics-worker',lease_expires_at=lease where id=j;
  d := jsonb_build_object('schema_version',1,'sequence',1,'job_id',j,'attempt_id',a,
    'phase','transport_started','updated_at','2026-10-20T00:00:00.000Z','worker_build_id','unknown',
    'worker_instance_id',gen_random_uuid(),'transports',jsonb_build_array(jsonb_build_object(
      'transport_attempt',1,'request_id',gen_random_uuid(),'started_at','2026-10-20T00:00:00.000Z')));
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.record_gateway_diagnostics(j,a,'diagnostics-worker',1,d);
    raise exception 'Authenticated checkpoint accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.role','service_role',true);
  if public.record_gateway_diagnostics(j,a,'wrong-worker',1,d) <> 'fenced' then raise exception 'Wrong worker accepted'; end if;
  if public.record_gateway_diagnostics(j,other_a,'diagnostics-worker',1,d || jsonb_build_object('attempt_id',other_a)) <> 'fenced' then raise exception 'Wrong attempt accepted'; end if;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',1,d) <> 'applied' then raise exception 'Checkpoint not applied'; end if;
  if (select lease_expires_at from public.analysis_jobs where id=j) <> lease then raise exception 'Checkpoint extended lease'; end if;
  if (select provider_metadata->'diagnostics' from public.analysis_jobs where id=j) <> d
    or (select provider_metadata->'diagnostics' from public.analysis_attempts where id=a) <> d
    or (select provider_metadata->>'sibling' from public.analysis_jobs where id=j) <> 'retained'
    or (select provider_metadata->>'sibling' from public.analysis_attempts where id=a) <> 'retained' then raise exception 'Checkpoint metadata not preserved'; end if;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',1,d) <> 'unchanged' then raise exception 'Identical checkpoint changed'; end if;
  begin
    perform public.record_gateway_diagnostics(j,a,'diagnostics-worker',1,d || '{"phase":"finished"}');
    raise exception 'Conflicting checkpoint accepted';
  exception when invalid_parameter_value then null; end;
  d := d || '{"sequence":2,"phase":"transport_ended"}';
  d := jsonb_set(d,'{transports,0}',d#>'{transports,0}' || '{"upstream_request_id":"req_fixture_123","elapsed_ms":2147483647,"event_count":0,"gateway_http_status":200,"upstream_http_status":503,"root_cause":"unexpected_eof","cause_chain":[{"type":"undici","code":"UND_ERR_SOCKET"},{"type":"eof","code":"UNEXPECTED_EOF"}],"close_frame_received":false,"retry_decision":"retry","retry_reason":"eligible_transport"}'::jsonb);
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',2,d) <> 'applied' then raise exception 'New checkpoint rejected'; end if;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',1,jsonb_set(d,'{sequence}','1')) <> 'stale' then raise exception 'Stale checkpoint accepted'; end if;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    d || '{"message":"SECRET"}',jsonb_set(d,'{transports,0,headers}','{"authorization":"SECRET"}'),
    jsonb_set(d,'{transports,0,cause_chain}','[{"type":"net","message":"SECRET"}]'),
    jsonb_set(d,'{transports,0,root_cause}','"SECRET"'),jsonb_set(d,'{transports,0,upstream_request_id}','"unsafe token"'),jsonb_set(d,'{transports,0,elapsed_ms}','1.5'),
    jsonb_set(d,'{transports,0,request_id}','"bad"'),jsonb_set(d,'{transports,0,transport_attempt}','2'),
    jsonb_set(d,'{transports,0,elapsed_ms}','2147483648'),jsonb_set(d,'{transports,0,event_count}','-1'),
    jsonb_set(d,'{transports,0,gateway_http_status}','600'),jsonb_set(d,'{transports,0,websocket_close_code}','999'),
    jsonb_set(d,'{transports,0,close_frame_received}','"false"'),
    jsonb_set(d,'{transports,0,cause_chain}','[{"type":"net"},{"type":"net"},{"type":"net"},{"type":"net"},{"type":"net"}]'),jsonb_set(d,'{updated_at}','"2026-02-30T00:00:00.000Z"'),
    d || '{"sequence":17}',d || '{"sequence":"2"}',d || '{"schema_version":2}',d || '{"transports":[{},{},{}]}',
    jsonb_set(d,'{transports,0,cause_chain}','[{"type":"net","code":"SECRET"}]'),
    d || jsonb_build_object('message',repeat('x',17000)),d || jsonb_build_object('job_id',gen_random_uuid()),
    d || '{"worker_build_id":"secret"}',jsonb_set(d,'{transports,0,ended_at}','null')
  )) loop
    begin
      perform public.record_gateway_diagnostics(j,a,'diagnostics-worker',2,bad);
      raise exception 'Unsafe diagnostics accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  update public.analysis_attempts set worker_id='other-worker' where id=a;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',2,d) <> 'fenced' then raise exception 'Attempt worker mismatch accepted'; end if;
  update public.analysis_attempts set worker_id='diagnostics-worker' where id=a;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',2,d) <> 'fenced' then raise exception 'Expired lease accepted'; end if;
  -- SIGKILL-equivalent: the actual reaper runs after checkpoint and lease expiry.
  perform public.claim_gateway_job('diagnostics-reaper',120);
  if (select status from public.analysis_jobs where id=j) <> 'interrupted'
    or (select status from public.analysis_attempts where id=a) <> 'interrupted' then raise exception 'Actual reaper did not interrupt fixture'; end if;
  if (select provider_metadata->'diagnostics' from public.analysis_jobs where id=j) <> d
    or (select provider_metadata->'diagnostics' from public.analysis_attempts where id=a) <> d then raise exception 'Expiry lost checkpoint'; end if;
  -- Exercise actual failure and successful finalizer replacement paths on fixture rows.
  update public.analysis_jobs set status='running',lease_owner='diagnostics-worker',lease_expires_at=lease where id=j;
  update public.analysis_attempts set status='running' where id=a;
  if not public.fail_gateway_job(j,a,'diagnostics-worker','failed','Fixture failure',
    jsonb_build_object('diagnostics',d || '{"sequence":1,"phase":"finished"}')) then raise exception 'Failure fixture rejected'; end if;
  if (select provider_metadata->'diagnostics' from public.analysis_jobs where id=j) <> d
    or (select provider_metadata->'diagnostics' from public.analysis_attempts where id=a) <> d then raise exception 'Stale terminal input replaced newer checkpoint'; end if;
  update public.analysis_jobs set status='running',lease_owner='diagnostics-worker',lease_expires_at=lease where id=j;
  update public.analysis_attempts set status='running' where id=a;
  d := d || '{"sequence":3,"phase":"finished"}';
  perform public.finalize_gateway_job(j,a,'diagnostics-worker','Fixture result',
    '{"terminalStatus":"completed","verified":true,"sources":[]}'::jsonb || jsonb_build_object('diagnostics',d));
  if (select provider_metadata->'diagnostics' from public.analysis_jobs where id=j) <> d
    or (select provider_metadata->'diagnostics' from public.analysis_attempts where id=a) <> d then raise exception 'Completion lost checkpoint'; end if;
  select provider_metadata into candidate from public.analysis_jobs where id=j;
  select provider_metadata into bad from public.analysis_attempts where id=a;
  if public.record_gateway_diagnostics(j,a,'diagnostics-worker',3,d) <> 'fenced' then raise exception 'Completed checkpoint not fenced'; end if;
  if (select provider_metadata->'diagnostics' from public.analysis_jobs where id=j) <> d
    or (select provider_metadata->'diagnostics' from public.analysis_attempts where id=a) <> d then raise exception 'Fenced checkpoint changed terminal metadata'; end if;
  if (select provider_metadata from public.analysis_jobs where id=j) <> candidate
    or (select provider_metadata from public.analysis_attempts where id=a) <> bad then raise exception 'Fenced checkpoint changed terminal metadata siblings'; end if;
end $$;

-- Verify actual database roles, rather than relying only on JWT claims or ACL inspection.
set local role anon;
do $$ begin
  begin
    perform public.record_gateway_diagnostics(null,null,null,null,null);
    raise exception 'anon executed checkpoint';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.record_gateway_diagnostics(null,null,null,null,null);
    raise exception 'authenticated executed checkpoint';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin
    perform public.record_gateway_diagnostics(null,null,null,null,null);
    raise exception 'service checkpoint accepted invalid arguments';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
