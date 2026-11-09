-- Local-only rollback fixture: original evidence, service-only access, fencing and publication.
do $$
declare
  o uuid := gen_random_uuid(); s uuid; j uuid; u uuid; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); m uuid; again uuid;
  checked text := to_char(clock_timestamp() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  snapshot jsonb; payload jsonb; saved jsonb; meta jsonb; rec jsonb; event_key text; other_owner uuid := gen_random_uuid();
begin
  if to_regprocedure('public.save_gateway_completion(uuid,uuid,text,jsonb)') is null then raise exception 'Missing completion checkpoint RPC'; end if;
  if has_table_privilege('authenticated','public.gateway_completions','SELECT') or has_table_privilege('anon','public.gateway_completions','SELECT') then raise exception 'Private completion table exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.gateway_completions'::regclass) then raise exception 'Completion RLS disabled'; end if;
  if has_function_privilege('authenticated','public.load_gateway_completion(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.save_gateway_completion(uuid,uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.finalize_gateway_completion(uuid,uuid,text,text,jsonb,text,boolean)','EXECUTE') then raise exception 'Completion RPC exposed'; end if;
  insert into auth.users(id,email) values(o,'completion-fixture@example.invalid'),(other_owner,'completion-other@example.invalid');
  insert into public.sports(owner_id,slug) values(o,'mlb') returning id into s;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind) values(o,s,'completion-fixture','analyze_today') returning id into j;
  insert into public.messages(owner_id,sport_id,role,content,analysis_job_id) values(o,s,'user','fixture request',j) returning id into u;
  snapshot := jsonb_build_object('version',1,'context','{"sport":"mlb"}','instructions','immutable instructions',
    'requested',jsonb_build_object('model','gpt-6-astra','effort','xhigh','mode','default_standard'),
    'execution_time',checked,'context_sha256',encode(extensions.digest('{"sport":"mlb"}','sha256'),'hex'),
    'instructions_sha256',encode(extensions.digest('immutable instructions','sha256'),'hex'),'source_document_refs','[]'::jsonb);
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at,input_snapshot)
    values(a,j,o,1,'original-worker',clock_timestamp()-interval '2 hours',snapshot);
  update public.analysis_jobs set user_message_id=u,status='running',current_attempt_id=a,lease_owner='original-worker',lease_expires_at=clock_timestamp()+interval '10 minutes' where id=j;
  event_key := 'mlb:2026-10-27:away@home:src-' || left(encode(extensions.digest('https://www.mlb.com/schedule','sha256'),'hex'),32);
  rec := jsonb_build_object('version',1,'sport','mlb','events',jsonb_build_array(jsonb_build_object(
    'event_key',event_key,'label','Away at Home','starts_at',(checked::timestamptz+interval '30 minutes')::text,
    'source_url','https://www.mlb.com/schedule','analysis_status','BET')),
    'recommendations',jsonb_build_array(jsonb_build_object('item_key','original-pick','event_key',event_key,'market','moneyline','selection','Away','decision','BET','suggested_units',0.5,'price_gate','-110')));
  payload := jsonb_build_object('version',1,'checked_at',checked,'result',jsonb_build_object(
    'text',E'original completed answer https://www.mlb.com/schedule\n```analysis-record\n'||rec::text||E'\n```','sources',jsonb_build_array(jsonb_build_object('title','Official','url','https://www.mlb.com/schedule')),
    'searched',true,'verified',true,'upstreamResponseId','response-original','usage',jsonb_build_object('inputTokens',100,'outputTokens',200)));
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin perform public.save_gateway_completion(j,a,'original-worker',payload); raise exception 'Authenticated checkpoint accepted'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.role','service_role',true);
  if public.save_gateway_completion(j,a,'wrong-worker',payload) or public.save_gateway_completion(j,b,'original-worker',payload) then raise exception 'Stale worker checkpoint accepted'; end if;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
  if public.save_gateway_completion(j,a,'original-worker',payload) then raise exception 'Expired checkpoint accepted'; end if;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes' where id=j;
  if not public.save_gateway_completion(j,a,'original-worker',payload) or not public.save_gateway_completion(j,a,'original-worker',payload) then raise exception 'Idempotent checkpoint failed'; end if;
  begin perform public.save_gateway_completion(j,a,'original-worker',jsonb_set(payload,'{result,text}','"rewritten"')); raise exception 'Changed checkpoint accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.save_gateway_completion(j,a,'original-worker',jsonb_set(payload,'{checked_at}',to_jsonb(clock_timestamp()::text))); raise exception 'Changed check time accepted'; exception when sqlstate '22023' then null; end;
  begin update public.gateway_completions set completion=jsonb_set(payload,'{result,text}','"direct rewrite"') where job_id=j; raise exception 'Direct rewrite accepted'; exception when sqlstate '22023' then null; end;
  if not public.fail_gateway_job(j,a,'original-worker','interrupted','save failed','{}') then raise exception 'Fixture failure rejected'; end if;
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at,input_snapshot)
    values(b,j,o,2,'recovery-worker',clock_timestamp(),snapshot);
  update public.analysis_jobs set status='running',attempt=2,current_attempt_id=b,lease_owner='recovery-worker',lease_expires_at=clock_timestamp()+interval '10 minutes' where id=j;
  saved := public.load_gateway_completion(j,b,'recovery-worker');
  if saved->'result' is distinct from payload->'result' or saved->>'checked_at' is distinct from checked
    or saved->>'original_attempt_id' is distinct from a::text or saved->'input_snapshot' is distinct from snapshot then raise exception 'Recovered original evidence differs'; end if;
  begin perform public.load_gateway_completion(j,a,'original-worker'); raise exception 'Stale reader accepted'; exception when sqlstate '55000' then null; end;
  meta := jsonb_build_object('terminalStatus','completed','type','analysis','result_type','analysis','verified',true,'searched',true,
    'original_model_response',payload->'result'->>'text','sources',payload->'result'->'sources','checked_at',checked,
    'input_snapshot',jsonb_build_object('attempt_id',a,'context_sha256',snapshot->>'context_sha256','instructions_sha256',snapshot->>'instructions_sha256'),'analysis_record',rec);
  begin perform public.finalize_gateway_completion(j,b,'recovery-worker','display answer',meta || '{"original_model_response":"rewritten"}', 'response-original',false); raise exception 'Rewritten raw evidence accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.finalize_gateway_completion(j,b,'recovery-worker','display answer',meta || '{"sources":[]}', 'response-original',false); raise exception 'Rewritten source evidence accepted'; exception when sqlstate '22023' then null; end;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
  begin perform public.finalize_gateway_completion(j,b,'recovery-worker','display answer',meta,'response-original',false); raise exception 'Expired publisher accepted'; exception when sqlstate '55000' then null; end;
  update public.analysis_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes' where id=j;
  m := public.finalize_gateway_completion(j,b,'recovery-worker','display answer',meta,'response-original',false);
  again := public.finalize_gateway_completion(j,b,'recovery-worker','display answer',meta,'response-original',false);
  if m is distinct from again or (select count(*) from public.messages where analysis_job_id=j and role='assistant') <> 1 then raise exception 'Publication duplicated'; end if;
  if (select count(*) from public.recommendations where analysis_job_id=j) <> 1 then raise exception 'Recommendation publication duplicated'; end if;
  if (select created_at from public.recommendations where analysis_job_id=j) is distinct from checked::timestamptz then raise exception 'Original judgment time changed'; end if;
  if exists(select 1 from public.bets where owner_id=o) then raise exception 'Recommendation created actual bet'; end if;
  if (select created_at from public.messages where id=m) <= checked::timestamptz then raise exception 'Actual delivery backdated'; end if;
  if (select metadata->'delivery'->>'historical_delivery' from public.messages where id=m) is distinct from 'true' then raise exception 'Historical delivery not marked'; end if;
  if (select metadata->>'checked_at' from public.messages where id=m) is distinct from checked then raise exception 'Original check time changed'; end if;
  begin perform public.finalize_gateway_completion(j,b,'recovery-worker','different display',meta,'response-original',false); raise exception 'Conflicting acknowledgment accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.finalize_gateway_completion(j,a,'original-worker','display answer',meta,'response-original',false); raise exception 'Stale committed acknowledgment accepted'; exception when sqlstate '55000' then null; end;
end $$;

do $$
declare
  o uuid := gen_random_uuid(); s uuid; j uuid; a uuid := gen_random_uuid(); checked text; snapshot jsonb; payload jsonb; meta jsonb; m uuid;
begin
  insert into auth.users(id,email) values(o,'completion-chat@example.invalid');
  insert into public.sports(owner_id,slug) values(o,'mlb') returning id into s;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind) values(o,s,'completion-chat','message') returning id into j;
  checked := to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  snapshot := jsonb_build_object('version',1,'context','{}','instructions','chat','execution_time',checked,
    'requested',jsonb_build_object('model','gpt-6-astra','effort','xhigh','mode','default_standard'),
    'context_sha256',encode(extensions.digest('{}','sha256'),'hex'),'instructions_sha256',encode(extensions.digest('chat','sha256'),'hex'),'source_document_refs','[]'::jsonb);
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,execution_started_at,input_snapshot)
    values(a,j,o,1,'chat-worker',clock_timestamp()-interval '1 second',snapshot);
  update public.analysis_jobs set status='running',current_attempt_id=a,lease_owner='chat-worker',lease_expires_at=clock_timestamp()+interval '10 minutes' where id=j;
  payload := jsonb_build_object('version',1,'checked_at',checked,'result',jsonb_build_object('text','natural chat','sources','[]'::jsonb,
    'searched',false,'verified',false,'upstreamResponseId','response-chat','usage','{"inputTokens":10,"outputTokens":10}'::jsonb));
  perform set_config('request.jwt.claim.role','service_role',true);
  if not public.save_gateway_completion(j,a,'chat-worker',payload) then raise exception 'Conversation checkpoint failed'; end if;
  meta := jsonb_build_object('terminalStatus','completed','type','conversation','result_type','conversation','verified',false,'searched',false,
    'sources','[]'::jsonb,'original_model_response','natural chat','checked_at',checked,
    'input_snapshot',jsonb_build_object('attempt_id',a,'context_sha256',snapshot->>'context_sha256','instructions_sha256',snapshot->>'instructions_sha256'),
    'response_purpose','{"version":1,"intent":"conversation","basis":"general","requires_fresh_data":false,"referenced_message_ids":[]}'::jsonb,'response_purpose_status','valid');
  begin perform public.finalize_gateway_completion(j,a,'chat-worker','natural chat',meta || '{"analysis_record":{"events":[],"recommendations":[]}}','response-chat',true); raise exception 'Conversation admitted analysis payload'; exception when sqlstate '22023' then null; end;
  m := public.finalize_gateway_completion(j,a,'chat-worker','natural chat',meta,'response-chat',true);
  if m is distinct from public.finalize_gateway_completion(j,a,'chat-worker','natural chat',meta,'response-chat',true) then raise exception 'Conversation acknowledgment duplicated'; end if;
  if (select metadata->'delivery'->>'historical_delivery' from public.messages where id=m) is distinct from 'false'
    or exists(select 1 from public.recommendations where analysis_job_id=j) then raise exception 'Conversation delivery boundaries changed'; end if;
end $$;
