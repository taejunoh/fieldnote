-- Synthetic fixtures only. Caller wraps migrations and this test in BEGIN/ROLLBACK.
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000091','repair@example.invalid');
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
-- Missing function is the expected first RED failure before the migration is written.
do $$
declare f record; j uuid := '20000000-0000-4000-8000-000000000091'; a uuid := '30000000-0000-4000-8000-000000000091'; m uuid := '40000000-0000-4000-8000-000000000091'; before_event jsonb; changed jsonb; auth_role text; scenario text; changed_metadata jsonb; changed_raw text;
begin
 select * into f from repair_fixture;
 foreach auth_role in array array['','anon','authenticated'] loop
  perform set_config('request.jwt.claim.role',auth_role,true);
  begin
   perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
   raise exception 'Unauthorized role accepted';
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.role','service_role',true);
 if has_function_privilege('anon','public.repair_completed_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.repair_completed_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Repair execute grants unsafe'; end if;
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata||'{"stale":true}',f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Stale metadata accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.repair_completed_analysis(j,'30000000-0000-4000-8000-000000000092',m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Stale attempt accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.repair_completed_analysis(j,a,'40000000-0000-4000-8000-000000000092',f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Stale message accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,jsonb_set(f.payload,'{analysis_record,recommendations,0,selection}','"Fabricated"'));
  raise exception 'Fabricated raw judgment accepted';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,jsonb_set(f.payload,'{correction}','{"from":"ten:p03","to":"tennis:2026-10-20:p04","raw_sha256":"bad"}'));
  raise exception 'Wrong coverage correction accepted';
 exception when sqlstate '22023' then null; end;
 begin
  changed := jsonb_set(f.payload,'{repair_citation_supplements}',jsonb_build_array(jsonb_build_object('event_key',f.payload#>>'{analysis_record,events,0,event_key}','label','Boston at New York','source_url','https://frontend.d3.nhle.com/game','reason','original_inventory_citation')));
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,changed);
  raise exception 'Unused citation supplement accepted';
 exception when sqlstate '22023' then null; end;
 -- Materialized citations are explicit audit data, never a raw-control citation bypass.
 foreach scenario in array array['bound','unbound_url','control_only'] loop
  begin
   changed_raw := replace(f.metadata->>'original_model_response','Boston at New York https://frontend.d3.nhle.com/game',case when scenario='control_only' then 'No visible event identity' else 'Boston at New York' end);
   changed_metadata := f.metadata||jsonb_build_object('original_model_response',changed_raw);
   changed := f.payload||jsonb_build_object('repair_key','citation-fixture-v1','raw_sha256',encode(extensions.digest(changed_raw,'sha256'),'hex'),'repair_citation_supplements',jsonb_build_array(jsonb_build_object('event_key','nhl:2026-10-20:bos@nyr:src','label','Boston at New York','source_url',case when scenario='unbound_url' then 'https://www.nhl.com/substituted' else 'https://frontend.d3.nhle.com/game' end,'reason','original_inventory_citation')));
   update public.analysis_jobs set provider_metadata=changed_metadata where id=j;
   update public.analysis_attempts set provider_metadata=changed_metadata where id=a;
   update public.messages set metadata=changed_metadata where id=m;
   begin
    perform public.repair_completed_analysis(j,a,m,changed_metadata,changed_metadata,changed_metadata,f.snapshot,changed);
    if scenario<>'bound' then raise exception 'Unproven citation supplement accepted'; end if;
    if (select metadata->'repair_citation_supplements' from public.messages where id=m) is distinct from changed->'repair_citation_supplements'
      or (select metadata->'original_model_response' from public.messages where id=m) is distinct from changed_metadata->'original_model_response' then raise exception 'Citation audit/raw preservation failed'; end if;
   exception when sqlstate '22023' then if scenario='bound' then raise; end if; end;
   raise exception 'rollback citation fixture' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 insert into public.events(owner_id,sport_id,event_key,label,starts_at,source_ref,analysis_status,game_status,notes,updated_at)
  values('00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091',f.payload#>>'{analysis_record,events,0,event_key}','Already settled event','2026-10-20T11:00:00Z','https://example.invalid/prior','PASS','final','Preserved historical decision','2026-10-20T11:30:00Z');
 select to_jsonb(ev) into before_event from public.events ev where owner_id='00000000-0000-4000-8000-000000000091';
 insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision,analysis_job_id,recommendation_item_key,source_message_id,source_ref,created_at)
  select '00000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091',(before_event->>'id')::uuid,'Moneyline','Conflict','WAIT',j,'main',m,'https://frontend.d3.nhle.com/game','2026-10-20T12:00:00Z';
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Conflicting recommendation accepted';
 exception when sqlstate '22023' then null; end;
 if (select metadata from public.messages where id=m) <> f.metadata then raise exception 'Conflict partially repaired message'; end if;
 delete from public.recommendations where analysis_job_id=j;
 foreach changed in array array[f.payload] loop
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,changed);
 end loop;
 if (select to_jsonb(ev) from public.events ev where id=(before_event->>'id')::uuid) <> before_event then raise exception 'Existing event fields changed'; end if;
 if (select count(*) from public.recommendations where analysis_job_id=j) <> 1 then raise exception 'Missing repaired recommendation'; end if;
 if (select count(*) from public.messages where analysis_job_id=j and role='assistant') <> 1 then raise exception 'Duplicate message'; end if;
 if exists(select 1 from public.bets where owner_id='00000000-0000-4000-8000-000000000091') then raise exception 'Repair created bets'; end if;
 if (select metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs'] from public.messages where id=m) <> f.metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs'] then raise exception 'Protected metadata changed'; end if;
 if (select to_jsonb(t)-'metadata' from public.messages t where id=m) <> f.message_before-'metadata' or
    (select to_jsonb(t)-'provider_metadata' from public.analysis_jobs t where id=j) <> f.job_before-'provider_metadata' or
    (select to_jsonb(t)-'provider_metadata' from public.analysis_attempts t where id=a) <> f.attempt_before-'provider_metadata' then raise exception 'Immutable row fields changed'; end if;
 -- Repeating must reject altered or missing persisted decisions and derived metadata.
 begin
  update public.recommendations set selection='Drifted' where analysis_job_id=j;
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Repeat accepted drifted recommendation';
 exception when sqlstate '22023' then null; end;
 begin
  delete from public.recommendations where analysis_job_id=j;
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Repeat accepted deleted recommendation';
 exception when sqlstate '22023' then null; end;
 begin
  update public.messages set metadata=jsonb_set(metadata,'{coverage,status}','"complete"') where id=m;
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Repeat accepted derived metadata drift';
 exception when sqlstate '22023' then null; end;
 -- Same payload repeats before stale metadata CAS and leaves the audit untouched.
 perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
 if jsonb_array_length((select metadata->'completed_analysis_repairs' from public.messages where id=m)) <> 1 then raise exception 'Repeat appended audit'; end if;
 begin
  perform public.repair_completed_analysis(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,jsonb_set(f.payload,'{analysis_record,recommendations,0,selection}','"Fabricated"'));
  raise exception 'Changed repeat accepted';
 exception when sqlstate '22023' then null; end;
end $$;
rollback;

-- Identity proof independently parses only visible headings and real table rows.
begin;
do $$
declare body text := E'### Section — Doha 1항목\n\n| 경기 | 상태 |\n| --- | --- |\n| P03 Alpha–Beta | deferred |';
begin
 if public.completed_analysis_repair_coverage_identity(body,'Doha Alpha–Beta','p03') is distinct from true then raise exception 'Exact section table proof rejected'; end if;
 if public.completed_analysis_repair_coverage_identity(replace(body,E'\n',E'\n    '),'Doha Alpha–Beta','p03') is distinct from false then raise exception 'Indented code row accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(replace(body,E'\n',E'\n\t'),'Doha Alpha–Beta','p03') is distinct from false then raise exception 'Tab code row accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(body,'Doha Alpha–Beta','p03',3) is distinct from false then raise exception 'Wrong required row index accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(body,'Doha Alpha–Beta','p03',4) is distinct from true then raise exception 'Exact required row index rejected'; end if;
 if public.completed_analysis_repair_coverage_identity(replace(body,'Doha','Dubai'),'Doha Alpha–Beta','p03') is distinct from false then raise exception 'Wrong heading accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(replace(body,'Alpha–Beta','Alpha–Gamma'),'Doha Alpha–Beta','p03') is distinct from false then raise exception 'Wrong pair accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(body||E'\n| P03 Alpha–Beta | duplicate |','Doha Alpha–Beta','p03') is distinct from false then raise exception 'Duplicate ID accepted'; end if;
 if public.completed_analysis_repair_coverage_identity(E'```text\n'||body||E'\n```','Doha Alpha–Beta','p03') is distinct from false then raise exception 'Fenced row accepted'; end if;
end $$;
rollback;

-- The transactional correction changes exactly one orphan assessment key and
-- revalidates the original visible section evidence even on identical retry.
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000092','repair-tennis@example.invalid');
insert into public.sports(id,owner_id,slug) values ('10000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000092','tennis');
do $$
declare
 j uuid := '20000000-0000-4000-8000-000000000092'; a uuid := '30000000-0000-4000-8000-000000000092'; m uuid := '40000000-0000-4000-8000-000000000092';
 body text := E'### Section — Doha 1항목\n\n| 경기 | 상태 |\n| --- | --- |\n| P03 Alpha–Beta | deferred |';
 r jsonb := '{"version":1,"sport":"tennis","events":[],"recommendations":[]}';
 c jsonb := '{"version":1,"scope":{"version":1,"sport":"tennis","date_et":"2026-10-20","timezone":"America/New_York","mode":"daily","competitions":["ATP"],"basis":"default","notes":[]},"inventory":[{"event_key":"tennis:2026-10-20:p03","label":"Doha Alpha–Beta","starts_at":null,"competition":"ATP","source_url":"https://www.atptour.com/schedule"}],"assessments":[{"event_key":"ten:p03","disposition":"deferred","reason":"Await evidence"}],"schedule_sources":[],"inventory_complete":false,"limitations":["original limitation"]}';
 raw text; input jsonb; meta jsonb; p jsonb; corrected jsonb; scenario text; changed_raw text; changed_meta jsonb; changed jsonb; heading jsonb; from_heading text; row_text text;
begin
 raw := body||E'\n```analysis-coverage\n'||c::text||E'\n```\n```analysis-record\n'||r::text||E'\n```';
 input := jsonb_build_object('context',jsonb_build_object('analysis_scope',c->'scope')::text,'common_policy',null);
 meta := jsonb_build_object('type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,'sources',jsonb_build_array(jsonb_build_object('url','https://www.atptour.com/schedule')),'checked_at','2026-10-20T12:00:00Z','original_model_response',raw,'input_snapshot',jsonb_build_object('common_policy',null),'coverage_report',c,'coverage',jsonb_build_object('scope',c->'scope'),'extraction_failure',jsonb_build_object('code','unofficial_source'));
 insert into public.analysis_jobs(id,owner_id,sport_id,request_key,kind,status,provider,provider_metadata,created_at,updated_at) values(j,'00000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000092','repair-tennis-fixture','analyze','completed','openllms',meta,'2026-10-20T10:00:00Z','2026-10-20T12:00:00Z');
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,started_at,execution_started_at,finished_at,provider_metadata,input_snapshot,sources) values(a,j,'00000000-0000-4000-8000-000000000092',1,'completed','test','2026-10-20T10:30:00Z','2026-10-20T11:00:00Z','2026-10-20T12:00:00Z',meta,input,meta->'sources');
 insert into public.messages(id,owner_id,sport_id,role,content,metadata,analysis_job_id,created_at) values(m,'00000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000092','assistant','Saved tennis answer',meta,j,'2026-10-20T12:00:00Z');
 update public.analysis_jobs set current_attempt_id=a,result_message_id=m where id=j;
 corrected := jsonb_set(c,'{assessments,0,event_key}','"tennis:2026-10-20:p03"');
 p := jsonb_build_object('version','official-source-coverage-v1','repair_key','tennis-fixture-v1','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex'),'analysis_record',r,'coverage',jsonb_build_object('status','incomplete','scope',c->'scope','listed_count',1,'assessed_count',1,'missing_event_keys','[]'::jsonb,'reasons',jsonb_build_array('inventory_declared_incomplete','original limitation','independent_schedule_verification_unavailable')),'coverage_report',corrected,'correction',jsonb_build_object('from','ten:p03','to','tennis:2026-10-20:p03','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex')),'repair_citation_supplements','[]'::jsonb,'repair_heading_corrections','[]'::jsonb);
 foreach scenario in array array['heading','pair','spaces','tabs'] loop
  begin
   changed_raw := case scenario when 'heading' then replace(raw,'Section — Doha','Section — Dubai') when 'spaces' then replace(raw,E'\n|',E'\n    |') when 'tabs' then replace(raw,E'\n|',E'\n\t|') else replace(raw,'P03 Alpha–Beta','P03 Alpha–Gamma') end;
   changed_meta := meta||jsonb_build_object('original_model_response',changed_raw);
   changed := p||jsonb_build_object('raw_sha256',encode(extensions.digest(changed_raw,'sha256'),'hex'));
   changed := jsonb_set(changed,'{correction,raw_sha256}',changed->'raw_sha256');
   update public.analysis_jobs set provider_metadata=changed_meta where id=j;
   update public.analysis_attempts set provider_metadata=changed_meta where id=a;
   update public.messages set metadata=changed_meta where id=m;
   begin
    perform public.repair_completed_analysis(j,a,m,changed_meta,changed_meta,changed_meta,input,changed);
    raise exception 'Incorrect visible correction identity accepted';
   exception when sqlstate '22023' then null; end;
   raise exception 'rollback negative fixture' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 -- Approved historical evidence may reconcile only this exact heading.
 foreach scenario in array array['approved','swapped_row','wrong_pair','wrong_group','code_row'] loop
  begin
   from_heading := '### Section — FormerDoha 1항목'; row_text := '| P03 Alpha–Beta | deferred |';
   changed_raw := replace(raw,'### Section — Doha 1항목',from_heading);
   if scenario='code_row' then changed_raw := replace(changed_raw,E'\n|',E'\n    |'); row_text := '    '||row_text; end if;
   changed_meta := meta||jsonb_build_object('original_model_response',changed_raw);
   heading := jsonb_build_object('reason','approved_historical_tournament_heading','raw_sha256',encode(extensions.digest(changed_raw,'sha256'),'hex'),'sport','tennis','date_et','2026-10-20','competition','ATP',
    'original_heading',jsonb_build_object('line_index',0,'text',from_heading,'sha256',encode(extensions.digest(from_heading,'sha256'),'hex')),'canonical_heading','### Section — Doha 1항목',
    'events',jsonb_build_array(jsonb_build_object('event_key','tennis:2026-10-20:p03','label','Doha Alpha–Beta','competition','ATP','source_url','https://www.atptour.com/schedule','short_id','p03','pair','Alpha–Beta','row',jsonb_build_object('line_index',4,'text',row_text,'sha256',encode(extensions.digest(row_text,'sha256'),'hex')))),
    'authority',jsonb_build_object('url','https://www.atptour.com/en/tournaments/doha/123/overview','observed_at','2026-10-20T12:00:00Z','evidence_kind','official_page_via_search_index','direct_fetch_verified',false,'evidence_sha256',repeat('a',64)),'approved_plan_sha256',repeat('b',64));
   if scenario='swapped_row' then heading := jsonb_set(heading,'{events,0,row}',jsonb_build_object('line_index',2,'text','| 경기 | 상태 |','sha256',encode(extensions.digest('| 경기 | 상태 |','sha256'),'hex'))); end if;
   if scenario='wrong_pair' then heading := jsonb_set(heading,'{events,0,pair}','"Alpha–Gamma"'); end if;
   if scenario='wrong_group' then heading := jsonb_set(heading,'{canonical_heading}','"### Section — Dubai 1항목"'); end if;
   changed := p||jsonb_build_object('raw_sha256',encode(extensions.digest(changed_raw,'sha256'),'hex'),'repair_heading_corrections',jsonb_build_array(heading));
   changed := jsonb_set(changed,'{correction,raw_sha256}',changed->'raw_sha256');
   update public.analysis_jobs set provider_metadata=changed_meta where id=j;
   update public.analysis_attempts set provider_metadata=changed_meta where id=a;
   update public.messages set metadata=changed_meta where id=m;
   begin
    perform public.repair_completed_analysis(j,a,m,changed_meta,changed_meta,changed_meta,input,changed);
    if scenario<>'approved' then raise exception 'Unproven historical heading overlay accepted'; end if;
    perform public.repair_completed_analysis(j,a,m,changed_meta,changed_meta,changed_meta,input,changed);
    if (select metadata->>'original_model_response' from public.messages where id=m) is distinct from changed_raw
     or (select metadata#>'{completed_analysis_repairs,0,repair_heading_corrections}' from public.messages where id=m) is distinct from jsonb_build_array(heading) then raise exception 'Heading audit/raw preservation failed'; end if;
   exception when sqlstate '22023' then if scenario='approved' then raise; end if; end;
   raise exception 'rollback overlay fixture' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 perform public.repair_completed_analysis(j,a,m,meta,meta,meta,input,p);
 perform public.repair_completed_analysis(j,a,m,meta,meta,meta,input,p);
 if (select metadata->'coverage_report' from public.messages where id=m) is distinct from corrected
  or (select metadata->>'original_model_response' from public.messages where id=m) is distinct from raw
  or (select metadata#>'{completed_analysis_repairs,0,original_coverage_report}' from public.messages where id=m) is distinct from c
  or (select jsonb_array_length(metadata->'completed_analysis_repairs') from public.messages where id=m)<>1 then raise exception 'Correction provenance or repeat failed'; end if;
end $$;
rollback;
