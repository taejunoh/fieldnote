-- Synthetic fixtures only. Caller wraps migrations and this test in BEGIN/ROLLBACK.
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000091','repair@example.invalid');
insert into public.sports(id,owner_id,slug) values ('10000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000091','nhl');
do $$
declare candidate text;
begin
 foreach candidate in array array[
  'https://www.nhl.com/2026020166/gamecenter/2026020999',
  'https://www.nhl.com/gamecenter/2026020166/2026020999',
  'https://www.nhl.com/gamecenter/2026020999?game=2026020166',
  'https://www.nhl.com/gamecenter/2026020166/2026020166'
 ] loop
  if public.completed_analysis_nhl_gamecenter_id(candidate) is not null then raise exception 'Ambiguous NHL source accepted'; end if;
 end loop;
 foreach candidate in array array[
  'https://www.nhl.com/gamecenter/2026020166',
  'https://www.nhl.com/gamecenter/mtl-vs-chi/2026/10/23/2026020166',
  'https://www.nhl.com/sv/gamecenter/mtl-vs-chi/2026/10/23/2026020166'
 ] loop
  if public.completed_analysis_nhl_gamecenter_id(candidate) is distinct from '2026020166' then raise exception 'Canonical NHL source rejected'; end if;
 end loop;
end $$;
create temporary table repair_fixture(payload jsonb, metadata jsonb, snapshot jsonb, message_before jsonb, job_before jsonb, attempt_before jsonb);
do $$
declare
 j uuid := '20000000-0000-4000-8000-000000000091'; a uuid := '30000000-0000-4000-8000-000000000091'; m uuid := '40000000-0000-4000-8000-000000000091';
 r jsonb; c jsonb; x jsonb; raw text; input jsonb; p jsonb;
begin
 r := '{"version":1,"sport":"nhl","events":[{"event_key":"nhl:2026-10-20:bos@nyr:id-2026020991","label":"Boston at New York","starts_at":null,"source_url":"https://www.nhl.com/gamecenter/bos-vs-nyr/2026/10/20/2026020991","analysis_status":"WAIT"}],"recommendations":[{"item_key":"main","event_key":"nhl:2026-10-20:bos@nyr:id-2026020991","market":"Moneyline","selection":"Boston","decision":"WAIT","suggested_units":null,"price_gate":null}]}'::jsonb;
 c := '{"version":1,"scope":{"version":1,"sport":"nhl","date_et":"2026-10-20","timezone":"America/New_York","mode":"daily","competitions":["NHL"],"basis":"default","notes":[]},"inventory":[],"assessments":[],"schedule_sources":[],"inventory_complete":false,"limitations":[]}'::jsonb;
 c := jsonb_set(c,'{inventory}',jsonb_build_array((r#>'{events,0}')-array['analysis_status']||jsonb_build_object('competition','NHL')));
 c := jsonb_set(c,'{assessments}',jsonb_build_array(jsonb_build_object('event_key',r#>>'{events,0,event_key}','disposition','deferred','reason','Wait')));
 r := jsonb_set(r,'{recommendations,0,event_key}',to_jsonb('nhl:2026-10-2026020991'::text));
 raw := 'Boston at New York https://www.nhl.com/gamecenter/bos-vs-nyr/2026/10/20/2026020991' || E'\n```analysis-coverage\n' || c::text || E'\n```\n```analysis-record\n' || r::text || E'\n```';
 input := jsonb_build_object('context',jsonb_build_object('analysis_scope',c->'scope')::text,'common_policy',null);
 x := jsonb_build_object('type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,'sources',jsonb_build_array(jsonb_build_object('url','https://www.nhl.com/gamecenter/bos-vs-nyr/2026/10/20/2026020991')),'checked_at','2026-10-20T12:00:00Z','original_model_response',raw,'input_snapshot',jsonb_build_object('common_policy',null),'coverage_report',c,'coverage',jsonb_build_object('scope',c->'scope'),'extraction_failure',jsonb_build_object('code','unofficial_source'));
 insert into public.analysis_jobs(id,owner_id,sport_id,request_key,kind,status,provider,provider_metadata,created_at,updated_at) values(j,'00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','repair-fixture','analyze','completed','openllms',x,'2026-10-20T10:00:00Z','2026-10-20T12:00:00Z');
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,started_at,execution_started_at,finished_at,provider_metadata,input_snapshot,sources) values(a,j,'00000000-0000-4000-8000-000000000091',1,'completed','test','2026-10-20T10:30:00Z','2026-10-20T11:00:00Z','2026-10-20T12:00:00Z',x,input,x->'sources');
 insert into public.messages(id,owner_id,sport_id,role,content,metadata,analysis_job_id,created_at) values(m,'00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','assistant','Saved answer',x,j,'2026-10-20T12:00:00Z');
 update public.analysis_jobs set current_attempt_id=a,result_message_id=m where id=j;
 r := jsonb_set(r,'{recommendations,0,event_key}',r#>'{events,0,event_key}');
 p := jsonb_build_object('version','official-source-coverage-v2','recommendation_key_corrections',jsonb_build_array(jsonb_build_object('reason','unique_official_game_id','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex'),'item_key','main','from','nhl:2026-10-2026020991','to','nhl:2026-10-20:bos@nyr:id-2026020991')),'independent_source_verifications','[]'::jsonb,'source_verified_at',null,'source_verification_scope',null,'repair_key','fixture-v1','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex'),'analysis_record',r,'coverage',jsonb_build_object('status','incomplete','scope',c->'scope','listed_count',1,'assessed_count',1,'missing_event_keys','[]'::jsonb,'reasons',jsonb_build_array('inventory_declared_incomplete','independent_schedule_verification_unavailable')),'coverage_report',c,'correction',null,'repair_citation_supplements','[]'::jsonb,'repair_heading_corrections','[]'::jsonb);
 insert into repair_fixture select p,x,input,(select to_jsonb(t) from public.messages t where id=m),(select to_jsonb(t) from public.analysis_jobs t where id=j),(select to_jsonb(t) from public.analysis_attempts t where id=a);
end $$;

do $$
declare f record; result jsonb; audit jsonb; j uuid := '20000000-0000-4000-8000-000000000091'; a uuid := '30000000-0000-4000-8000-000000000091'; m uuid := '40000000-0000-4000-8000-000000000091';
begin
 select * into f from repair_fixture;
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,jsonb_set(f.payload,'{recommendation_key_corrections,0,to}','"nhl:2026-10-20:bos@nyr:id-2026020992"'));
  raise exception 'Incorrect key correction accepted';
 exception when sqlstate '22023' then null; end;
 result := public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
 if result->>'status'<>'repaired' then raise exception 'V2 repair failed'; end if;
 select metadata#>'{completed_analysis_repairs,0}' into audit from public.messages where id=m;
 if audit->'recommendation_key_corrections' is distinct from f.payload->'recommendation_key_corrections' or audit->>'job_id' is distinct from j::text or audit->>'message_id' is distinct from m::text then raise exception 'Recovery audit differs'; end if;
 if (select metadata->>'original_model_response' from public.messages where id=m) is distinct from f.metadata->>'original_model_response' then raise exception 'Raw response changed'; end if;
 result := public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
 if result->>'status'<>'already_repaired' then raise exception 'V2 repeat was not idempotent'; end if;
 begin
  perform public.completed_analysis_independent_source_manifest('{"version":1,"manifest_json":"{}","manifest_sha256":"ec37a6dcbe176dac4fdec9828b4fc5b0045ce8e52d77b3017ca6ed5e677798e2"}',j,m,'bad',now(),'{}','{}','[]');
  raise exception 'Forged manifest accepted';
 exception when sqlstate '22023' then null; end;
 if public.official_event_source_allowed('tennis','https://www.japanopentennis.com/op.pdf') is distinct from true or public.official_event_source_allowed('tennis','https://protennislive.com/op.pdf') is distinct from true or public.official_event_source_allowed('tennis','https://evil.protennislive.com/op.pdf') then raise exception 'Tennis host policy differs'; end if;
end $$;
rollback;
