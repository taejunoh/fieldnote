-- Synthetic fixtures only. Caller wraps migrations and this test in BEGIN/ROLLBACK.
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000091','guarded-repair@example.invalid');
insert into public.sports(id,owner_id,slug) values ('10000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000091','nhl');
create temporary table repair_fixture(payload jsonb, metadata jsonb, snapshot jsonb, message_before jsonb, job_before jsonb, attempt_before jsonb);
do $$
declare
 j uuid := '20000000-0000-4000-8000-000000000091'; a uuid := '30000000-0000-4000-8000-000000000091'; m uuid := '40000000-0000-4000-8000-000000000091';
 r jsonb; c jsonb; x jsonb; raw text; input jsonb; p jsonb;
begin
 r := '{"version":1,"sport":"nhl","events":[{"event_key":"nhl:2026-10-20:bos@nyr:src","label":"Boston at New York","starts_at":null,"source_url":"https://frontend.d3.nhle.com/game","analysis_status":"WAIT"}],"recommendations":[{"item_key":"main","event_key":"nhl:2026-10-20:bos@nyr:src","market":"Moneyline","selection":"Boston","decision":"WAIT","suggested_units":null,"price_gate":null}]}'::jsonb;
 c := '{"version":1,"scope":{"version":1,"sport":"nhl","date_et":"2026-10-20","timezone":"America/New_York","mode":"daily","competitions":["NHL"],"basis":"default","notes":[]},"inventory":[],"assessments":[],"schedule_sources":[],"inventory_complete":false,"limitations":[]}'::jsonb;
 c := jsonb_set(c,'{inventory}',jsonb_build_array((r#>'{events,0}')-array['analysis_status']||jsonb_build_object('competition','NHL')));
 c := jsonb_set(c,'{assessments}',jsonb_build_array(jsonb_build_object('event_key',r#>>'{events,0,event_key}','disposition','deferred','reason','Wait')));
 raw := 'Boston at New York https://frontend.d3.nhle.com/game' || E'\n```analysis-coverage\n' || c::text || E'\n```\n```analysis-record\n' || r::text || E'\n```';
 input := jsonb_build_object('context',jsonb_build_object('analysis_scope',c->'scope')::text,'common_policy',null);
 x := jsonb_build_object('type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,'sources',jsonb_build_array(jsonb_build_object('url','https://frontend.d3.nhle.com/game')),'checked_at','2026-10-20T12:00:00Z','original_model_response',raw,'input_snapshot',jsonb_build_object('common_policy',null),'coverage_report',c,'coverage',jsonb_build_object('scope',c->'scope'),'extraction_failure',jsonb_build_object('code','unofficial_source'));
 insert into public.analysis_jobs(id,owner_id,sport_id,request_key,kind,status,provider,provider_metadata,created_at,updated_at) values(j,'00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','repair-fixture','analyze','completed','openllms',x,'2026-10-20T10:00:00Z','2026-10-20T12:00:00Z');
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,started_at,execution_started_at,finished_at,provider_metadata,input_snapshot,sources) values(a,j,'00000000-0000-4000-8000-000000000091',1,'completed','test','2026-10-20T10:30:00Z','2026-10-20T11:00:00Z','2026-10-20T12:00:00Z',x,input,x->'sources');
 insert into public.messages(id,owner_id,sport_id,role,content,metadata,analysis_job_id,created_at) values(m,'00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','assistant','Saved answer',x,j,'2026-10-20T12:00:00Z');
 update public.analysis_jobs set current_attempt_id=a,result_message_id=m where id=j;
 r := jsonb_set(r,'{events,0,event_key}',to_jsonb('nhl:2026-10-20:bos@nyr:src-' || left(encode(extensions.digest('https://frontend.d3.nhle.com/game','sha256'),'hex'),32)));
 r := jsonb_set(r,'{recommendations,0,event_key}',r#>'{events,0,event_key}');
 p := jsonb_build_object('version','official-source-coverage-v1','repair_key','fixture-v1','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex'),'analysis_record',r,'coverage',jsonb_build_object('status','incomplete','scope',c->'scope','listed_count',1,'assessed_count',1,'missing_event_keys','[]'::jsonb,'reasons',jsonb_build_array('inventory_declared_incomplete','independent_schedule_verification_unavailable')),'coverage_report',c,'correction',null,'repair_citation_supplements','[]'::jsonb,'repair_heading_corrections','[]'::jsonb);
 insert into repair_fixture select p,x,input,(select to_jsonb(t) from public.messages t where id=m),(select to_jsonb(t) from public.analysis_jobs t where id=j),(select to_jsonb(t) from public.analysis_attempts t where id=a);
end $$;

-- Preserve saved coverage up front: this wrapper forbids using native repair to revise it.
do $$
declare f record; metadata jsonb;
begin
 select * into f from repair_fixture;
 metadata:=f.metadata||jsonb_build_object('coverage',f.payload->'coverage','evaluation_validation',jsonb_build_object('version',1,'status','unavailable'));
 update public.messages set metadata=f.metadata||jsonb_build_object('coverage',f.payload->'coverage','evaluation_validation',jsonb_build_object('version',1,'status','unavailable')) where id='40000000-0000-4000-8000-000000000091';
 update public.analysis_jobs set provider_metadata=metadata where id='20000000-0000-4000-8000-000000000091';
 update public.analysis_attempts set provider_metadata=metadata where id='30000000-0000-4000-8000-000000000091';
 update repair_fixture f set metadata=(select m.metadata from public.messages m where m.id='40000000-0000-4000-8000-000000000091');
end $$;
-- Injection is confined to this rolled-back synthetic fixture. The real legacy RPC runs.
create function pg_temp.inject_guarded_native_repair_drift() returns trigger language plpgsql as $$
declare scenario text:=current_setting('test.guarded_repair_scenario',true);
begin
 if tg_table_name='messages' then
  if scenario='body' then new.content:=new.content||' changed';end if;
  if scenario='message_time' then new.created_at:=new.created_at+interval '1 minute';end if;
  if scenario='sources' then new.metadata:=new.metadata||'{"sources":[]}'::jsonb;end if;
  if scenario='evaluation' then new.metadata:=new.metadata||'{"evaluation_report":{"forged":true}}'::jsonb;end if;
  if scenario='coverage' then new.metadata:=new.metadata||'{"coverage":{"forged":true}}'::jsonb;end if;
  if scenario='criteria' then insert into public.criteria_versions(owner_id,sport_id,title,content,status) values(new.owner_id,new.sport_id,'Injected change','Fixture drift','proposed');end if;
 elsif tg_table_name='analysis_jobs' and scenario='job_time' then new.updated_at:=new.updated_at+interval '1 minute';
 elsif tg_table_name='analysis_attempts' and scenario='attempt_time' then new.finished_at:=new.finished_at+interval '1 minute';end if;
 return new;
end $$;
create trigger guarded_native_drift_message before update on public.messages for each row execute function pg_temp.inject_guarded_native_repair_drift();
create trigger guarded_native_drift_job before update on public.analysis_jobs for each row execute function pg_temp.inject_guarded_native_repair_drift();
create trigger guarded_native_drift_attempt before update on public.analysis_attempts for each row execute function pg_temp.inject_guarded_native_repair_drift();
do $$
declare f record; scenario text; response jsonb;
 j uuid:='20000000-0000-4000-8000-000000000091';a uuid:='30000000-0000-4000-8000-000000000091';m uuid:='40000000-0000-4000-8000-000000000091';
 job_before jsonb;attempt_before jsonb;message_before jsonb;
begin
 select * into f from repair_fixture;
 if has_function_privilege('anon','public.repair_completed_analysis_guarded(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.repair_completed_analysis_guarded(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.repair_completed_analysis_guarded(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Unsafe wrapper grants';end if;
 select to_jsonb(x) into job_before from public.analysis_jobs x where id=j;
 select to_jsonb(x) into attempt_before from public.analysis_attempts x where id=a;
 select to_jsonb(x) into message_before from public.messages x where id=m;
 -- Actual SQL role permission denial, with local synthetic JWT role context only.
 perform set_config('role','authenticated',true);
 begin perform public.repair_completed_analysis_guarded(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);raise exception 'Authenticated execute accepted';exception when insufficient_privilege then null;end;
 perform set_config('role','postgres',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.repair_completed_analysis_guarded(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);raise exception 'Runtime auth accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.role','service_role',true);
 foreach scenario in array array['body','message_time','sources','evaluation','coverage','criteria','job_time','attempt_time'] loop
  perform set_config('test.guarded_repair_scenario',scenario,true);
  begin perform public.repair_completed_analysis_guarded(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);raise exception 'Protected drift accepted';exception when sqlstate '22023' then null;end;
  if (select to_jsonb(x) from public.analysis_jobs x where id=j) is distinct from job_before
   or (select to_jsonb(x) from public.analysis_attempts x where id=a) is distinct from attempt_before
   or (select to_jsonb(x) from public.messages x where id=m) is distinct from message_before
   or exists(select 1 from public.recommendations where analysis_job_id=j)
   or exists(select 1 from public.events where owner_id='00000000-0000-4000-8000-000000000091')
   or exists(select 1 from public.criteria_versions where owner_id='00000000-0000-4000-8000-000000000091') then raise exception 'Rejected inner mutation escaped rollback';end if;
 end loop;
 perform set_config('test.guarded_repair_scenario','',true);
 -- Execute through the real service database role; no superuser function call bypass.
 perform set_config('role','service_role',true);
 response:=public.repair_completed_analysis_guarded(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
 if response->>'status'<>'repaired' then raise exception 'Valid native-only repair failed';end if;
 response:=public.repair_completed_analysis_guarded(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
 if response->>'status'<>'already_repaired' then raise exception 'Guarded repeat failed';end if;
 perform set_config('role','postgres',true);
 if (select count(*) from public.recommendations where analysis_job_id=j)<>1 then raise exception 'Native recommendation absent';end if;
 if exists(select 1 from public.bets where owner_id='00000000-0000-4000-8000-000000000091')
  or exists(select 1 from public.mistake_notes where owner_id='00000000-0000-4000-8000-000000000091')
  or exists(select 1 from public.criteria_versions where owner_id='00000000-0000-4000-8000-000000000091') then raise exception 'Protected financial tables mutated';end if;
end $$;
rollback;
