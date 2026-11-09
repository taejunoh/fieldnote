-- Run against a disposable Supabase-compatible PostgreSQL database after the
-- conditional-entry migration. Fixture writes are rolled back.
begin;
create temporary table conditional_entry_fixture(owner_id uuid, other_owner_id uuid, sport_id uuid, other_sport_id uuid, job_id uuid, message_id uuid, raw_text text, event_key text, existing_event_id uuid);
do $$
declare o uuid:=gen_random_uuid(); o2 uuid:=gen_random_uuid(); s uuid; s2 uuid; j uuid; m uuid; e uuid; a uuid:=gen_random_uuid(); raw text:='fixture original source response'; meta jsonb; input_snap jsonb;
begin
  insert into auth.users(id,email) values(o,'ce@example.invalid'),(o2,'ce2@example.invalid');
  insert into public.sports(owner_id,slug) values(o,'mlb') returning id into s;
  insert into public.sports(owner_id,slug) values(o2,'mlb') returning id into s2;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider,model,effort,status)
    values(o,s,'conditional-fixture-job','message','openllms','gpt-6-astra','xhigh','completed') returning id into j;
  meta:=jsonb_build_object('original_model_response',raw,'checked_at','2026-10-27T12:00:00.123456Z','sources','[]'::jsonb,
    'type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,
    'response_purpose_status','valid','response_purpose',jsonb_build_object('intent','current_analysis'));
  insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id,created_at)
    values(o,s,'assistant','fixture',meta,j,'2026-10-27T12:01:00.654321Z') returning id into m;
  input_snap:=jsonb_build_object('version',1,'context','{"sport":"mlb","current_job_kind":"message"}','instructions','fixture input instructions',
    'requested',jsonb_build_object('model','gpt-6-astra','effort','xhigh','mode','default_standard'),
    'execution_time','2026-10-27T11:59:00Z','context_sha256',encode(extensions.digest('{"sport":"mlb","current_job_kind":"message"}','sha256'),'hex'),
    'instructions_sha256',encode(extensions.digest('fixture input instructions','sha256'),'hex'),'source_document_refs','[]'::jsonb,'attempt_id',a);
  meta:=meta||jsonb_build_object('input_snapshot',input_snap);
  update public.messages set metadata=meta where id=m;
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,finished_at,provider_metadata)
    values(a,j,o,1,'completed','conditional-fixture-worker','2026-10-27T12:01:00.654321Z',meta) returning id into a;
  update public.analysis_attempts set input_snapshot=input_snap where id=a;
  update public.analysis_jobs set result_message_id=m,current_attempt_id=a,provider_metadata=meta,result_type='analysis' where id=j;
  insert into public.events(owner_id,sport_id,event_key,label,starts_at,game_status,analysis_status,notes,source_ref)
    values(o,s,'mlb:2026-10-27:other@team:id-existing01','Existing','2026-10-27T14:00:00Z','scheduled','WATCH','keep','existing-source') returning id into e;
  insert into conditional_entry_fixture values(o,o2,s,s2,j,m,raw,'mlb:2026-10-27:home@away:id-fixture001',e);
end $$;
grant select on conditional_entry_fixture to service_role, authenticated;
grant usage on schema extensions to service_role, authenticated;
grant execute on function extensions.digest(text,text) to service_role, authenticated;
grant select,insert,update,delete on public.events,public.bets,public.messages,public.analysis_jobs,public.sports to service_role;
grant select,insert,update,delete on public.events,public.bets to authenticated;
create function public.test_conditional_late_failure() returns trigger language plpgsql as $$
begin if new.request_key='conditional-late-001' then raise exception 'injected'; end if; return new; end $$;
create trigger test_conditional_late_failure before insert on public.bets for each row execute function public.test_conditional_late_failure();
set local role service_role;
do $$
declare
  f conditional_entry_fixture%rowtype; m public.messages%rowtype; snap jsonb; r jsonb; replay jsonb;
  e0 public.events%rowtype; e1 public.events%rowtype;
begin
  if current_user<>'service_role' then raise exception 'not running as service_role'; end if;
  select * into f from conditional_entry_fixture;
  select * into m from public.messages where id=f.message_id;
  snap:=jsonb_build_object('version',1,'provenance','manual_confirmed_conditional',
    'source',jsonb_build_object('kind','conditional_candidate','sourceKind','original_block','jobId',f.job_id,'messageId',f.message_id,'itemKey','candidate-1','rawSha256',encode(extensions.digest(f.raw_text,'sha256'),'hex'),'candidateSha256',repeat('a',64)),
    'eventKey',f.event_key,'match','Home vs Away','market','moneyline','selection','Home','originalDecision','GO','suggestedUnits',1,'priceGate','-110 or better',
    'schedule',jsonb_build_object('precision','estimated','dateEt','2026-10-27','at','2026-10-27T16:00:00-04:00','label','Estimated'),
    'checkedAt',m.metadata->>'checked_at','deliveredAt',to_jsonb(m.created_at)#>>'{}','createdAt',to_jsonb(m.created_at)#>>'{}','sourceUrl','https://example.invalid/source','statusAtAssessment','unknown');
  r:=public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-save-001',true,snap,null,null);
  if r->>'alreadyRecorded'<>'false' or r->>'eventCreated'<>'true' or r#>>'{bet,stake_units}' is not null or r#>>'{bet,executed_price}' is not null or r#>>'{bet,result}'<>'unknown' or r#>>'{bet,profit_units}' is not null or r#>>'{bet,source_recommendation_id}' is not null or r#>>'{bet,source_message_id}'<>f.message_id::text then raise exception 'missing event / NULL actual result invalid: %',r; end if;
  if not exists(select 1 from public.events where owner_id=f.owner_id and event_key=f.event_key and starts_at is null and game_status='unknown' and analysis_status='EVALUATION INCOMPLETE' and notes like 'Manual event registration.%') then raise exception 'manual event incomplete marker missing'; end if;
  replay:=public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-save-001',true,snap,null,null);
  if replay->>'alreadyRecorded'<>'true' or replay#>>'{bet,id}' is distinct from r#>>'{bet,id}' then raise exception 'exact replay failed'; end if;
  begin update public.bets set source_candidate=jsonb_set(snap,'{originalDecision}',to_jsonb('BET'::text)) where id=(r#>>'{bet,id}')::uuid; raise exception 'snapshot mutation accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-save-001',true,snap,1,null); raise exception 'changed replay accepted'; exception when sqlstate '23505' then null; end;

  select * into e0 from public.events where id=f.existing_event_id;
  snap:=jsonb_set(snap,'{eventKey}',to_jsonb(e0.event_key));
  r:=public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-existing-001',true,snap,0.125,-110);
  select * into e1 from public.events where id=f.existing_event_id;
  if r->>'eventCreated'<>'false' or e0 is distinct from e1 or r#>>'{bet,stake_units}'<>'0.125' or r#>>'{bet,executed_price}'<>'-110' then raise exception 'existing event changed / actuals lost'; end if;
  r:=public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-existing-002',true,snap,null,null);
  if r->>'alreadyRecorded'<>'false' then raise exception 'distinct request key rejected'; end if;

  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-negative-001',true,snap,-1,null); raise exception 'negative stake accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-scale-001',true,snap,0.0001,null); raise exception 'rounded stake accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.record_conditional_entry(f.other_owner_id,f.sport_id,'conditional-owner-001',true,snap,null,null); raise exception 'wrong owner accepted'; exception when sqlstate 'P0002' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.other_sport_id,'conditional-sport-001',true,snap,null,null); raise exception 'wrong sport accepted'; exception when sqlstate 'P0002' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-job-001',true,jsonb_set(snap,'{source,jobId}',to_jsonb(gen_random_uuid())),null,null); raise exception 'wrong job accepted'; exception when sqlstate 'P0002' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-message-001',true,jsonb_set(snap,'{source,messageId}',to_jsonb(gen_random_uuid())),null,null); raise exception 'wrong message accepted'; exception when sqlstate 'P0002' then null; end;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-falsehash-001',true,jsonb_set(snap,'{source,rawSha256}',to_jsonb(repeat('b',64))),null,null); raise exception 'wrong raw hash accepted'; exception when sqlstate '22023' then null; end;

  update public.messages set metadata=jsonb_set(metadata,'{original_model_response}',to_jsonb('changed raw'::text)) where id=f.message_id;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-hash-001',true,snap,null,null); raise exception 'raw hash mismatch accepted'; exception when sqlstate '22023' then null; end;
  -- Owner-writable job and message edited together still cannot replace the
  -- service-written completed attempt's original provider evidence.
  update public.analysis_jobs set provider_metadata=jsonb_set(provider_metadata,'{original_model_response}',to_jsonb('changed raw'::text)) where id=f.job_id;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-forged-pair-001',true,snap,null,null); raise exception 'matching forged job/message raw accepted'; exception when sqlstate '22023' then null; end;
  update public.analysis_jobs set provider_metadata=jsonb_set(provider_metadata,'{original_model_response}',to_jsonb(f.raw_text)) where id=f.job_id;
  update public.messages set metadata=jsonb_set(metadata,'{original_model_response}',to_jsonb(f.raw_text)) where id=f.message_id;
  -- Even if mutable copies erase a hypothetical marker, the immutable attempt
  -- retains and enforces it.
  update public.analysis_attempts set provider_metadata=jsonb_set(provider_metadata,'{response_purpose,intent}',to_jsonb('hypothetical'::text)) where job_id=f.job_id;
  update public.analysis_jobs set provider_metadata=jsonb_set(provider_metadata,'{response_purpose,intent}',to_jsonb('current_analysis'::text)) where id=f.job_id;
  update public.messages set metadata=jsonb_set(metadata,'{response_purpose,intent}',to_jsonb('current_analysis'::text)) where id=f.message_id;
  begin perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-hypothetical-001',true,snap,null,null); raise exception 'attempt hypothetical marker bypassed'; exception when sqlstate '22023' then null; end;
  update public.analysis_attempts set provider_metadata=jsonb_set(provider_metadata,'{response_purpose,intent}',to_jsonb('current_analysis'::text)) where job_id=f.job_id;
  update public.analysis_jobs set provider_metadata=jsonb_set(provider_metadata,'{response_purpose,intent}',to_jsonb('current_analysis'::text)) where id=f.job_id;
  update public.messages set metadata=jsonb_set(metadata,'{response_purpose,intent}',to_jsonb('current_analysis'::text)) where id=f.message_id;

  snap:=jsonb_set(snap,'{eventKey}',to_jsonb('mlb:2026-10-28:latehome@lateaway:id-late001'::text));
  begin
    perform public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-late-001',true,snap,null,null);
  exception when sqlstate 'P0001' then null;
  end;
  if exists(select 1 from public.bets where owner_id=f.owner_id and request_key='conditional-late-001') then raise exception 'late failure was not injected'; end if;
  if exists(select 1 from public.events where owner_id=f.owner_id and sport_id=f.sport_id and event_key='mlb:2026-10-28:latehome@lateaway:id-late001') then raise exception 'late failure left orphan event'; end if;
end $$;
reset role;
drop trigger test_conditional_late_failure on public.bets;
drop function public.test_conditional_late_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from conditional_entry_fixture),true);
do $$
declare f conditional_entry_fixture%rowtype; snapshot jsonb; event_id uuid; bet_id uuid;
begin
  select * into f from conditional_entry_fixture;
  select id into event_id from public.events where id=f.existing_event_id;
  snapshot:=jsonb_build_object('version',1,'provenance','manual_confirmed_conditional',
    'source',jsonb_build_object('kind','conditional_candidate','messageId',f.message_id),
    'market','moneyline','selection','Home','eventKey','mlb:2026-10-27:other@team:id-existing01');
  update public.bets set result='void' where owner_id=f.owner_id and request_key='conditional-save-001' returning id into bet_id;
  if bet_id is null or not exists(select 1 from public.bets where id=bet_id and result='void' and source_candidate is not null) then
    raise exception 'Authenticated result update was blocked or changed provenance';
  end if;
  update public.bets set result='unknown' where id=bet_id;
  bet_id:=null;
  begin
    insert into public.bets(owner_id,sport_id,event_id,market,selection,source_message_id,source_candidate)
      values(f.owner_id,f.sport_id,event_id,'moneyline','Home',f.message_id,snapshot);
    raise exception 'authenticated direct snapshot insert accepted';
  exception when sqlstate '42501' then null; end;
  insert into public.bets(owner_id,sport_id,event_id,market,selection,source_message_id)
    values(f.owner_id,f.sport_id,event_id,'moneyline','Home',f.message_id) returning id into bet_id;
  begin
    update public.bets set source_candidate=snapshot where id=bet_id;
    raise exception 'authenticated NULL-to-snapshot update accepted';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
do $$
begin
  if has_function_privilege('authenticated','public.record_conditional_entry(uuid,uuid,text,boolean,jsonb,numeric,integer)','execute') or has_function_privilege('anon','public.record_conditional_entry(uuid,uuid,text,boolean,jsonb,numeric,integer)','execute') or not has_function_privilege('service_role','public.record_conditional_entry(uuid,uuid,text,boolean,jsonb,numeric,integer)','execute') then raise exception 'conditional RPC grants are not service-only'; end if;
end $$;
rollback;

