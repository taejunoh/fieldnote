-- Synthetic fixtures only; run in a transaction with pending migrations and ROLLBACK.
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare raw text; rec jsonb; result jsonb;
begin
 rec := '{"version":1,"sport":"soccer","events":[{"event_key":"soccer:2026-10-27:aa@bb:id-123","label":"A at B","starts_at":"2026-10-27T17:00:00Z","source_url":"https://www.fifa.com/match/123","analysis_status":"BET"},{"event_key":"soccer:2026-10-27:cc@dd:id-456","label":"C at D","starts_at":"2026-10-27T17:00:00Z","source_url":"https://www.fifa.com/match/456","analysis_status":"WAIT"}],"recommendations":[{"item_key":"good","event_key":"soccer:2026-10-27:aa@bb:id-123","market":"1X2","selection":"A","decision":"BET","suggested_units":0.5,"price_gate":"-170","timing":"early"},{"item_key":"badsource","event_key":"soccer:2026-10-27:cc@dd:id-456","market":"1X2","selection":"C","decision":"WAIT","suggested_units":0,"price_gate":null}]}'::jsonb;
 raw := 'A at B https://www.fifa.com/match/123 C at D https://www.fifa.com/match/456' || E'\n```analysis-record\n' || rec::text || E'\n```';
 result := public.derive_partial_analysis_record(raw,'soccer','[{"url":"https://www.fifa.com/match/123"}]','2026-10-27T15:48:00Z',true);
 if jsonb_array_length(result#>'{analysis_record,events}')<>1 or jsonb_array_length(result#>'{analysis_record,recommendations}')<>1 or result#>>'{record_admission,rejected_events,0,code}'<>'unverified_source' or result#>>'{record_admission,rejected_recommendations,0,code}'<>'rejected_event_dependency' then raise exception 'Source partial derivation failed'; end if;
end $$;

insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000097','partial-test@example.invalid');
insert into public.sports(id,owner_id,slug) values ('10000000-0000-4000-8000-000000000097','00000000-0000-4000-8000-000000000097','soccer');
create temporary table partial_fixture(metadata jsonb,snapshot jsonb,payload jsonb);
do $$
declare j uuid:='20000000-0000-4000-8000-000000000097'; a uuid:='30000000-0000-4000-8000-000000000097'; m uuid:='40000000-0000-4000-8000-000000000097';
 rec jsonb; raw text; x jsonb; input jsonb; derived jsonb; payload jsonb; answer jsonb;
begin
 rec := '{"version":1,"sport":"soccer","events":[{"event_key":"soccer:2026-10-27:aa@bb:id-123","label":"A at B","starts_at":"2026-10-27T17:00:00Z","source_url":"https://www.fifa.com/match/123","analysis_status":"BET"},{"event_key":"soccer:2026-10-27:cc@dd:id-456","label":"C at D","starts_at":"2026-10-27T17:00:00Z","source_url":"https://www.fifa.com/match/456","analysis_status":"WAIT"}],"recommendations":[{"item_key":"good","event_key":"soccer:2026-10-27:aa@bb:id-123","market":"1X2","selection":"A","decision":"BET","suggested_units":0.5,"price_gate":"-170","timing":"early"},{"item_key":"badsource","event_key":"soccer:2026-10-27:cc@dd:id-456","market":"1X2","selection":"C","decision":"WAIT","suggested_units":0,"price_gate":null}]}'::jsonb;
 raw := 'A at B https://www.fifa.com/match/123 C at D https://www.fifa.com/match/456' || E'\n```analysis-record\n' || rec::text || E'\n```';
 input := jsonb_build_object('context','{"sport":"soccer","analysis_scope":{"date_et":"2026-10-27"}}','common_policy',jsonb_build_object('version','synthetic'));
 x := jsonb_build_object('type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,'sources','[{"url":"https://www.fifa.com/match/123"}]'::jsonb,'checked_at','2026-10-27T15:48:00Z','original_model_response',raw,'input_snapshot',jsonb_build_object('common_policy',input->'common_policy'),'coverage',jsonb_build_object('status','incomplete'),'extraction_status','incomplete','recommendations_persisted',false,'extraction_failure',jsonb_build_object('code','unverified_source','path','events.1.source_url','message','Not searched'));
 insert into public.analysis_jobs(id,owner_id,sport_id,request_key,kind,status,provider,provider_metadata,created_at,updated_at) values(j,'00000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000097','partial-fixture','analyze_today','completed','openllms',x,'2026-10-27T15:00:00Z','2026-10-27T15:48:00Z');
 insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,started_at,execution_started_at,finished_at,provider_metadata,input_snapshot,sources) values(a,j,'00000000-0000-4000-8000-000000000097',1,'completed','test','2026-10-27T15:00:00Z','2026-10-27T15:01:00Z','2026-10-27T15:48:00Z',x,input,x->'sources');
 insert into public.messages(id,owner_id,sport_id,role,content,metadata,analysis_job_id,created_at) values(m,'00000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000097','assistant','Immutable original answer',x,j,'2026-10-27T15:48:00Z');
 update public.analysis_jobs set current_attempt_id=a,result_message_id=m where id=j;
 derived := public.derive_partial_analysis_record(raw,'soccer',x->'sources','2026-10-27T15:48:00Z',true);
 payload := derived||jsonb_build_object('version','source-admission-partial-v1','repair_key','synthetic-partial-1','raw_sha256',encode(extensions.digest(raw,'sha256'),'hex'));
 insert into partial_fixture values(x,input,payload);

 begin
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x||'{"changed":true}',input,payload);
  raise exception 'Stale metadata accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input||'{"changed":true}',payload);
  raise exception 'Stale input accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input,jsonb_set(payload,'{analysis_record,recommendations,0,suggested_units}','1'));
  raise exception 'Changed original units accepted';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input,jsonb_set(payload,'{record_admission,rejected_events}','[]'));
  raise exception 'Forged rejection audit accepted';
 exception when sqlstate '22023' then null; end;
 begin
  insert into public.events(owner_id,sport_id,event_key,label) values('00000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000097','soccer:2026-10-27:aa@bb:id-123','Existing judgment');
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input,payload);
  raise exception 'Existing event was attached or modified';
 exception when sqlstate '55000' then null; end;
 begin
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,status,provider) values('00000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000097','active-partial-fixture','analyze_today','queued','openllms');
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input,payload);
  raise exception 'Owner active accepted';
 exception when sqlstate '55000' then null; end;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.repair_completed_analysis_partial(j,a,m,x,x,x,input,payload);
  raise exception 'Non-service caller accepted';
 exception when sqlstate '42501' then null; end;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('lock_timeout','2s',true);
 answer := public.repair_completed_analysis_partial(j,a,m,x,x,x,input,payload);
 if not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation='public.analysis_jobs'::regclass and mode='ShareRowExclusiveLock' and granted) then raise exception 'Recovery does not hold job creation/claim exclusion lock'; end if;
 if current_setting('lock_timeout')<>'2s' then raise exception 'Recovery leaked its lock timeout setting'; end if;
 if answer->>'status'<>'partially_repaired' or (select count(*) from public.events where owner_id='00000000-0000-4000-8000-000000000097')<>1 or (select count(*) from public.recommendations where analysis_job_id=j)<>1 then raise exception 'Partial RPC counts failed'; end if;
 answer := public.repair_completed_analysis_partial(j,a,m,x,x,x,input,payload);
 if answer->>'status'<>'already_repaired' then raise exception 'Partial replay not idempotent'; end if;
 if (select content from public.messages where id=m)<>'Immutable original answer' or (select metadata->>'original_model_response' from public.messages where id=m)<>raw or (select metadata->'sources' from public.messages where id=m)<>x->'sources' then raise exception 'Original provenance changed'; end if;
 if exists(select 1 from public.events where owner_id='00000000-0000-4000-8000-000000000097' and (game_status<>'unknown' or result_source_url is not null or result_checked_at is not null or updated_at<>'2026-10-27T15:48:00Z')) then raise exception 'Event history changed'; end if;
 if exists(select 1 from public.recommendations where analysis_job_id=j and (created_at<>'2026-10-27T15:48:00Z' or suggested_units<>0.5 or source_ref<>'https://www.fifa.com/match/123')) then raise exception 'Recommendation history changed'; end if;
end $$;

-- Fatal validation must inspect every original row before source filtering.
do $$
declare f record; original jsonb; altered jsonb; raw text; response jsonb; n integer; ws text;
begin
 select * into f from partial_fixture;
 original:=substring(f.metadata->>'original_model_response' from '```analysis-record[[:space:]]*\n([\s\S]*?)\n```[[:space:]]*$')::jsonb;
 for n in 1..35 loop
  altered:=original;
  case n
   when 1 then altered:=jsonb_set(altered,'{recommendations,1,suggested_units}','1');
   when 2 then altered:=jsonb_set(altered,'{events,1,analysis_status}','"BET"'); altered:=jsonb_set(altered,'{events,1,starts_at}','"2026-10-27T14:00:00Z"');
   when 3 then altered:=jsonb_set(altered,'{events,1,event_key}',altered#>'{events,0,event_key}');
   when 4 then altered:=jsonb_set(altered,'{recommendations,1,item_key}',altered#>'{recommendations,0,item_key}');
   when 5 then altered:=jsonb_set(altered,'{recommendations,1,event_key}','"soccer:2026-10-27:zz@xx:id-999"');
   when 6 then altered:=jsonb_set(altered,'{events,1,event_key}','"soccer:2026-10-27:cc@dd:src-00000000000000000000000000000000"');
   when 7 then altered:=jsonb_set(altered,'{events,1,extra}','true');
   when 8 then altered:=jsonb_set(altered,'{sport}','"nhl"');
   when 9 then altered:=jsonb_set(altered,'{events,0,starts_at}','null');
   when 10 then altered:=jsonb_set(altered,'{recommendations,1,timing}','"early"');
   when 11 then altered:=jsonb_set(altered,'{events,1,event_key}','"soccer:2026-10-27:aa@aa:id-999"');
   when 12 then altered:=jsonb_set(altered,'{recommendations,1,price_gate}','[]');
   when 13 then altered:=jsonb_set(altered,'{events,1,starts_at}','"2026-10-27 17:00:00Z"');
   when 14 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com:bad/match/456"');
   when 15 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com:65536/match/456"');
   when 16 then altered:=jsonb_set(altered,'{events,1,starts_at}','"2026-02-30T17:00:00Z"');
   when 17 then altered:=jsonb_set(altered,'{events,1,starts_at}','"2026-10-27T24:00:00Z"');
   when 18 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://[broken/match/456"');
   when 19 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://999.999.999.999/match/456"');
   -- Punycode is outside the SQL recovery subset even when runtime URL parsing accepts it.
   when 20 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://xn--a.com/match/456"');
   when 21 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/../match/456"');
   when 22 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/%2e%2E/match/456"');
   when 23 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com:0443/match/456"');
   when 24 then altered:=jsonb_set(altered,'{events,1,source_url}',to_jsonb('https://www.fifa.com/match/456?q='||chr(39)));
   when 25 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/./match/456"');
   when 26 then altered:=jsonb_set(altered,'{events,1,source_url}',to_jsonb('https://www.fifa.com/match/'||chr(34)||'456'));
   when 27 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/."');
   when 28 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/..?q=x"');
   when 29 then altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/.#fragment"');
   when 30 then altered:=jsonb_set(altered,'{events,1,label}',to_jsonb(chr(9)));
   when 31 then altered:=jsonb_set(altered,'{recommendations,1,market}',to_jsonb(chr(9)));
   when 32 then altered:=jsonb_set(altered,'{events,1,label}',to_jsonb(chr(160)));
   when 33 then altered:=jsonb_set(altered,'{events,1,label}',to_jsonb(repeat(chr(128512),150)));
   when 34 then altered:=jsonb_set(altered,'{recommendations,1,selection}',to_jsonb(chr(65279)));
   when 35 then altered:=jsonb_set(altered,'{recommendations,1,direction_note}',to_jsonb(chr(8232)));
  end case;
  raw:='Original body'||E'\n```analysis-record\n'||altered::text||E'\n```';
  begin
   perform public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources','2026-10-27T15:48:00Z',true);
   raise exception 'Fatal case % was filtered instead of rejected',n;
  exception when sqlstate '22023' then null; end;
 end loop;
 -- All ECMAScript trim characters normalize exactly, including price_gate,
 -- whose empty trimmed string is valid (unlike label/market/selection/note).
 foreach n in array array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] loop
  ws:=chr(n); altered:=jsonb_set(original,'{events,0,label}',to_jsonb(ws||'A at B'||ws));
  altered:=jsonb_set(altered,'{recommendations,0,market}',to_jsonb(ws||'1X2'||ws));
  altered:=jsonb_set(altered,'{recommendations,0,selection}',to_jsonb(ws||'A'||ws));
  altered:=jsonb_set(altered,'{recommendations,0,direction_note}',to_jsonb(ws||'note'||ws));
  altered:=jsonb_set(altered,'{recommendations,0,price_gate}',to_jsonb(ws));
  raw:='Original body'||E'\n```analysis-record\n'||altered::text||E'\n```';
  response:=public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources','2026-10-27T15:48:00Z',true);
  if response#>>'{analysis_record,events,0,label}'<>'A at B' or response#>>'{analysis_record,recommendations,0,market}'<>'1X2'
   or response#>>'{analysis_record,recommendations,0,selection}'<>'A' or response#>>'{analysis_record,recommendations,0,direction_note}'<>'note'
   or response#>>'{analysis_record,recommendations,0,price_gate}'<>'' then raise exception 'JS trim normalization mismatch for codepoint %',n; end if;
 end loop;
 begin
  raw:=chr(9)||chr(160)||E'\n```analysis-record\n'||original::text||E'\n```';
  perform public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources','2026-10-27T15:48:00Z',true);
  raise exception 'Whitespace-only answer accepted';
 exception when sqlstate '22023' then null; end;
 -- A canonical collision among source-rejected rows must still fail atomically.
 -- Runtime WHATWG removes /a/../; the narrow SQL path rejects that unsupported
 -- form before source filtering rather than silently admitting the good row.
 altered:=jsonb_set(original,'{events,1,event_key}','"soccer:2026-10-27:cc@dd:src"');
 altered:=jsonb_set(altered,'{events,1,source_url}','"https://www.fifa.com/a/../match/456"');
 altered:=jsonb_set(altered,'{recommendations,1,event_key}','"soccer:2026-10-27:cc@dd:src"');
 altered:=jsonb_set(altered,'{events}',altered->'events'||jsonb_build_array((original#>'{events,1}')||jsonb_build_object('event_key','soccer:2026-10-27:cc@dd:src-'||left(encode(extensions.digest('https://www.fifa.com/match/456','sha256'),'hex'),32))));
 raw:='Original body'||E'\n```analysis-record\n'||altered::text||E'\n```';
 begin
  perform public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources','2026-10-27T15:48:00Z',true);
  raise exception 'Canonical collision in rejected events was hidden';
 exception when sqlstate '22023' then null; end;
 -- Same source eligibility order: captured membership, src host, src citation.
 altered:=original;
 altered:=jsonb_set(altered,'{events,1,event_key}','"soccer:2026-10-27:cc@dd:src"');
 altered:=jsonb_set(altered,'{recommendations,1,event_key}','"soccer:2026-10-27:cc@dd:src"');
 raw:='A at B https://www.fifa.com/match/123'||E'\n```analysis-record\n'||altered::text||E'\n```';
 response:=public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources'||'[{"url":"https://www.fifa.com/match/456"}]','2026-10-27T15:48:00Z',true);
 if response#>>'{record_admission,rejected_events,0,code}'<>'uncited_source' then raise exception 'Uncited classification changed'; end if;
 altered:=jsonb_set(altered,'{events,1,source_url}','"https://example.invalid/match/456"');
 raw:='A at B https://www.fifa.com/match/123 https://example.invalid/match/456'||E'\n```analysis-record\n'||altered::text||E'\n```';
 response:=public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources'||'[{"url":"https://example.invalid/match/456"}]','2026-10-27T15:48:00Z',true);
 if response#>>'{record_admission,rejected_events,0,code}'<>'unofficial_source' then raise exception 'Host classification changed'; end if;
 response:=public.derive_partial_analysis_record(raw,'soccer',f.metadata->'sources','2026-10-27T15:48:00Z',true);
 if response#>>'{record_admission,rejected_events,0,code}'<>'unverified_source' then raise exception 'Source classification priority changed'; end if;
end $$;

do $$
declare f record; j uuid:='20000000-0000-4000-8000-000000000097'; a uuid:='30000000-0000-4000-8000-000000000097'; m uuid:='40000000-0000-4000-8000-000000000097';
begin
 select * into f from partial_fixture;
 begin
  update public.recommendations set price_gate='forged' where analysis_job_id=j;
  perform public.repair_completed_analysis_partial(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Row drift accepted on replay';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.repair_completed_analysis_partial(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,jsonb_set(f.payload,'{analysis_record,recommendations,0,price_gate}','"forged"'));
  raise exception 'Payload drift accepted on replay';
 exception when sqlstate '22023' then null; end;
 begin
  update public.messages set metadata=jsonb_set(metadata,'{record_admission,rejected_events}','[]') where id=m;
  perform public.repair_completed_analysis_partial(j,a,m,f.metadata,f.metadata,f.metadata,f.snapshot,f.payload);
  raise exception 'Admission drift accepted on replay';
 exception when sqlstate '22023' then null; end;
 if has_function_privilege('anon','public.repair_completed_analysis_partial(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.repair_completed_analysis_partial(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') or not has_function_privilege('service_role','public.repair_completed_analysis_partial(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Partial recovery ACL changed'; end if;
 if has_function_privilege('authenticated','public.derive_partial_analysis_record(text,text,jsonb,timestamptz,boolean)','EXECUTE') then raise exception 'Derivation ACL changed'; end if;
end $$;
