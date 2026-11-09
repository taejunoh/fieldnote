begin;
do $$
declare
 o uuid:=gen_random_uuid(); s uuid; j uuid; a uuid:=gen_random_uuid(); m uuid;
 raw text:=E'Saved historical\n| market | decision |\n|---|---|\n| A | PASS |';
 meta jsonb; patch jsonb; h text; sh text; ch text; fp text:=repeat('a',64); result jsonb;
 before_job jsonb; before_attempt jsonb; before_message jsonb; before_completion jsonb; bad jsonb; n integer;
begin
 if has_function_privilege('anon','public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb)','EXECUTE')
 then raise exception 'Incorrect RPC roles'; end if;
 if has_table_privilege('service_role','private.saved_evaluation_repairs','INSERT') or has_table_privilege('authenticated','private.saved_evaluation_repairs','SELECT') then raise exception 'Audit exposed'; end if;
 insert into auth.users(id,email) values(o,'saved-evaluation-fixture@example.invalid');
 insert into public.sports(owner_id,slug) values(o,'cfb') returning id into s;
 insert into public.analysis_jobs(owner_id,sport_id,request_key,kind) values(o,s,'saved-evaluation','analyze_today') returning id into j;
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,status,input_snapshot) values(a,j,o,1,'offline','completed','{"context_sha256":"context","instructions_sha256":"instructions"}');
 insert into public.gateway_completions(job_id,owner_id,original_attempt_id,completion,input_snapshot)
 values(j,o,a,jsonb_build_object('result',jsonb_build_object('text',raw,'sources','[]'::jsonb),'checked_at','2026-10-29T00:00:00Z'),'{"context_sha256":"context","instructions_sha256":"instructions"}');
 select raw_sha256,sources_sha256 into h,sh from public.gateway_completions where job_id=j;
 meta:=jsonb_build_object('original_model_response',raw,'sources','[]'::jsonb,'checked_at','2026-10-29T00:00:00Z','input_snapshot',jsonb_build_object('attempt_id',a,'context_sha256','context','instructions_sha256','instructions'),'analysis_record','{"events":[],"recommendations":[]}'::jsonb,'evaluation_validation','{"status":"unavailable"}'::jsonb);
 insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id) values(o,s,'assistant','Original display',meta,j) returning id into m;
 update public.analysis_jobs set status='completed',current_attempt_id=a,result_message_id=m where id=j;
 ch:=encode(extensions.digest('Original display','sha256'),'hex');
 patch:=jsonb_build_object('evaluation_report',null,'evaluation_quarantined_markets','[]'::jsonb,'evaluation_validation','{"version":1,"status":"unavailable","reasons":["evaluation_report_absent"],"counts":{"valuation_complete":0,"information_wait":0,"research_incomplete":0,"not_evaluated":0}}'::jsonb,'evaluation_presentation',jsonb_build_object('version',1,'context','historical','reason','saved_historical_analysis_no_current_recommendation','raw_sha256',h,'reviewedTables',jsonb_build_array(jsonb_build_object('start',0,'end',octet_length(raw),'excerpt_sha256',h))));
 select to_jsonb(x) into before_job from public.analysis_jobs x where id=j;
 select to_jsonb(x) into before_attempt from public.analysis_attempts x where id=a;
 select to_jsonb(x)-'metadata' into before_message from public.messages x where id=m;
 select to_jsonb(x) into before_completion from public.gateway_completions x where job_id=j;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch);raise exception 'Auth accepted'; exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.role','service_role',true);
 begin perform public.repair_saved_evaluation(j,a,a,m,gen_random_uuid(),'key',fp,h,sh,ch,meta,patch);raise exception 'Owner accepted'; exception when sqlstate '55000' then null;end;
 begin perform public.repair_saved_evaluation(j,gen_random_uuid(),a,m,o,'key',fp,h,sh,ch,meta,patch);raise exception 'Link accepted'; exception when sqlstate '55000' then null;end;
 begin perform public.repair_saved_evaluation(j,a,gen_random_uuid(),m,o,'key',fp,h,sh,ch,meta,patch);raise exception 'Checkpoint attempt accepted'; exception when sqlstate '22023' then null;end;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,repeat('b',64),sh,ch,meta,patch);raise exception 'Raw accepted'; exception when sqlstate '22023' then null;end;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,repeat('b',64),ch,meta,patch);raise exception 'Sources accepted'; exception when sqlstate '22023' then null;end;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,repeat('b',64),meta,patch);raise exception 'Body accepted'; exception when sqlstate '22023' then null;end;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta||'{"changed":true}',patch);raise exception 'CAS accepted'; exception when sqlstate '40001' then null;end;
 foreach bad in array array[patch||'{"analysis_record":{}}'::jsonb,jsonb_set(patch,'{evaluation_presentation,reviewedTables,0,end}','99999'),jsonb_set(patch,'{evaluation_presentation,reviewedTables,0,excerpt_sha256}',to_jsonb(repeat('b',64))),jsonb_set(patch,'{evaluation_report}','{"version":1,"markets":false}')]
 loop
  begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,bad);raise exception 'Bad patch accepted'; exception when sqlstate '22023' then null;end;
 end loop;
 bad:=jsonb_set(jsonb_set(jsonb_set(patch,'{evaluation_presentation,context}','"current"'),'{evaluation_presentation,reviewedTables}','[]'),'{evaluation_validation,status}','"valid"');
 bad:=jsonb_set(bad,'{evaluation_report}','{"version":1,"markets":[true]}'::jsonb);
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,bad);raise exception 'Unsafe report row accepted'; exception when sqlstate '22023' then null;end;
 bad:=jsonb_set(jsonb_set(jsonb_set(patch,'{evaluation_presentation,context}','"current"'),'{evaluation_presentation,reviewedTables}','[]'),'{evaluation_validation,status}','"valid"');
 bad:=jsonb_set(bad,'{evaluation_report}','{"version":1,"sport":"cfb","date_et":"2026-10-29","scope":"selected_markets","scope_note":"Invented report without raw fence","truncated":false,"markets":[]}'::jsonb);
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,bad);raise exception 'Synthetic unfenced report accepted'; exception when sqlstate '22023' then null;end;
 update public.analysis_jobs set status='failed' where id=j;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch);raise exception 'Failed accepted'; exception when sqlstate '55000' then null;end;
 update public.analysis_jobs set status='completed' where id=j;
 -- Snapshot again after test-only status changes (updated_at triggers may fire).
 select to_jsonb(x) into before_job from public.analysis_jobs x where id=j;
 result:=public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch);
 if result->>'status'<>'repaired' then raise exception 'Repair failed'; end if;
 result:=public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch);
 if result->>'status'<>'already_repaired' then raise exception 'No-op failed'; end if;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',repeat('b',64),h,sh,ch,meta,patch);raise exception 'Collision accepted'; exception when sqlstate '22023' then null;end;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch||'{"other":1}');raise exception 'Same fingerprint changed payload accepted'; exception when sqlstate '22023' then null;end;
 update public.messages set metadata=metadata||'{"newer":true}' where id=m;
 begin perform public.repair_saved_evaluation(j,a,a,m,o,'key',fp,h,sh,ch,meta,patch);raise exception 'Changed applied state accepted'; exception when sqlstate '22023' then null;end;
 update public.messages set metadata=meta||patch where id=m;
 begin delete from private.saved_evaluation_repairs where job_id=j;raise exception 'Audit deleted'; exception when sqlstate '22023' then null;end;
 if before_job is distinct from (select to_jsonb(x) from public.analysis_jobs x where id=j)
 or before_attempt is distinct from (select to_jsonb(x) from public.analysis_attempts x where id=a)
 or before_message is distinct from (select to_jsonb(x)-'metadata' from public.messages x where id=m)
 or before_completion is distinct from (select to_jsonb(x) from public.gateway_completions x where job_id=j) then raise exception 'Immutable rows changed';end if;
 select count(*) into n from private.saved_evaluation_repairs where job_id=j;
 if n<>1 or exists(select 1 from public.recommendations where analysis_job_id=j) or exists(select 1 from public.events where owner_id=o) or exists(select 1 from public.bets where owner_id=o) or exists(select 1 from public.mistake_notes where owner_id=o) or exists(select 1 from public.criteria_versions where owner_id=o) then raise exception 'Unexpected audit/native mutations';end if;
end $$;
-- A well-typed patch is still forbidden to invent or alter saved judgments.
do $$
declare
 o uuid:=gen_random_uuid(); s uuid; j uuid; a uuid:=gen_random_uuid(); m uuid; raw text;
 market jsonb; saved_report jsonb; accepted jsonb; patch jsonb; meta jsonb; h text; sh text; ch text;
 bad jsonb; result jsonb; fp text:=repeat('a',64); sources jsonb:='[{"url":"https://example.invalid/source","title":"Retained"}]';
begin
 market:='{"event_key":"cfb:fixture","label":"Away at Home","market":"spread","selection":"Home","line":-3.5,"original_decision":"PASS","state":"information_wait","observed_price":{"value":"-110","source_url":"https://example.invalid/source#quote","checked_at":"2026-10-29T00:00:00Z"},"price_condition":"-105 or better","suggested_units":null,"thesis":"Saved thesis","countercase":"Saved countercase","critical_checks":[{"category":"participants","status":"confirmed","evidence":"Saved retained evidence","source_urls":["https://example.invalid/source"],"checked_at":"2026-10-29T00:00:00Z"}],"uncertainty":{"impact":"Saved impact","scenario":"Saved scenario","reopen_trigger":"Saved trigger"}}';
 saved_report:=jsonb_build_object('version',1,'sport','cfb','date_et','2026-10-29','scope','selected_markets','scope_note','Saved selected markets','truncated',false,'markets',jsonb_build_array(market, jsonb_set(market,'{observed_price,source_url}','"https://unretained.invalid/source"'),jsonb_set(market,'{critical_checks,0,source_urls}','["https://unretained.invalid/source"]')));
 raw:=E'Saved prose\n```analysis-evaluation\n'||saved_report::text||E'\n```';
 insert into auth.users(id,email) values(o,'saved-evaluation-forgery@example.invalid');
 insert into public.sports(owner_id,slug) values(o,'cfb') returning id into s;
 insert into public.analysis_jobs(owner_id,sport_id,request_key,kind) values(o,s,'saved-forgery','analyze_today') returning id into j;
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,status,input_snapshot) values(a,j,o,1,'offline','completed','{}');
 insert into public.gateway_completions(job_id,owner_id,original_attempt_id,completion,input_snapshot) values(j,o,a,jsonb_build_object('result',jsonb_build_object('text',raw,'sources',sources),'checked_at','2026-10-29T00:00:00Z'),'{}');
 select raw_sha256,sources_sha256 into h,sh from public.gateway_completions where job_id=j;
 meta:=jsonb_build_object('original_model_response',raw,'sources',sources,'checked_at','2026-10-29T00:00:00Z','input_snapshot',jsonb_build_object('attempt_id',a));
 insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id) values(o,s,'assistant','Saved display',meta,j) returning id into m;
 update public.analysis_jobs set status='completed',current_attempt_id=a,result_message_id=m where id=j;
 ch:=encode(extensions.digest('Saved display','sha256'),'hex');
 accepted:=jsonb_set(saved_report,'{markets}',jsonb_build_array(jsonb_set(market,'{line}','"-3.5"')));
 patch:=jsonb_build_object('evaluation_report',accepted,'evaluation_quarantined_markets','[]'::jsonb,'evaluation_validation','{"version":1,"status":"partial"}'::jsonb,'evaluation_presentation',jsonb_build_object('version',1,'context','current','reason','partial','raw_sha256',h,'reviewedTables','[]'::jsonb));
 foreach bad in array array[
  jsonb_set(patch,'{evaluation_report,markets,0,original_decision}','"BET"'),
  jsonb_set(patch,'{evaluation_report,markets,0,observed_price,value}','"+999"'),
  jsonb_set(patch,'{evaluation_report,markets,0,suggested_units}','100'),
  jsonb_set(patch,'{evaluation_report,markets,0,line}','"-7.5"'),
  jsonb_set(patch,'{evaluation_report,markets}',jsonb_build_array(jsonb_set(saved_report->'markets'->1,'{line}','"-3.5"'))),
  jsonb_set(patch,'{evaluation_report,markets}',jsonb_build_array(jsonb_set(saved_report->'markets'->2,'{line}','"-3.5"'))),
  jsonb_set(patch,'{evaluation_report,markets}',(accepted->'markets')||(accepted->'markets')||(accepted->'markets')),
  jsonb_set(patch,'{evaluation_report,scope_note}','"Invented envelope"')
 ] loop
  begin perform public.repair_saved_evaluation(j,a,a,m,o,'forgery',fp,h,sh,ch,meta,bad);raise exception 'Forged saved report accepted';exception when sqlstate '22023' then null;end;
 end loop;
 result:=public.repair_saved_evaluation(j,a,a,m,o,'forgery',fp,h,sh,ch,meta,patch);
 if result->>'status'<>'repaired' then raise exception 'Original normalized subset rejected';end if;
end $$;
rollback;
