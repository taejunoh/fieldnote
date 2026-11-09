-- Synthetic, committed fixture used only by conditional_entry_concurrency.sh.
create table if not exists public.conditional_entry_concurrency_fixture(
  owner_id uuid, sport_id uuid, job_id uuid, message_id uuid, raw_text text, snapshot jsonb, event_key text
);
grant select on public.conditional_entry_concurrency_fixture to service_role;
grant usage on schema extensions to service_role;
grant execute on function extensions.digest(text,text) to service_role;
delete from public.conditional_entry_concurrency_fixture;
do $$
declare
  o uuid:=gen_random_uuid(); s uuid; j uuid; m uuid; a uuid:=gen_random_uuid();
  raw text:='synthetic concurrency fixture response'; created timestamptz:=clock_timestamp();
  checked timestamptz:=clock_timestamp()-interval '1 minute';
  context_text text:='{"sport":"mlb","current_job_kind":"message"}';
  input_snapshot jsonb; metadata jsonb; source_snapshot jsonb; event_key text;
begin
  insert into auth.users(id,email) values(o,o::text||'@example.invalid');
  insert into public.sports(owner_id,slug) values(o,'mlb') returning id into s;
  insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider,model,effort,status,result_type)
    values(o,s,'conditional-concurrency-job','message','openllms','gpt-6-astra','xhigh','completed','analysis') returning id into j;
  input_snapshot:=jsonb_build_object('version',1,'context',context_text,'instructions','fixture instructions',
    'requested',jsonb_build_object('model','gpt-6-astra','effort','xhigh','mode','default_standard'),
    'execution_time',checked,'context_sha256',encode(extensions.digest(context_text,'sha256'),'hex'),
    'instructions_sha256',encode(extensions.digest('fixture instructions','sha256'),'hex'),
    'source_document_refs','[]'::jsonb,'attempt_id',a);
  metadata:=jsonb_build_object('type','analysis','result_type','analysis','terminalStatus','completed','verified',true,'searched',true,
    'original_model_response',raw,'checked_at',checked,'sources','[]'::jsonb,
    'response_purpose_status','valid','response_purpose',jsonb_build_object('intent','current_analysis'),
    'input_snapshot',input_snapshot);
  insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id,created_at)
    values(o,s,'assistant','synthetic fixture',metadata,j,created) returning id into m;
  insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,status,worker_id,finished_at,provider_metadata,input_snapshot)
    values(a,j,o,1,'completed','conditional-concurrency-worker',created,metadata,input_snapshot);
  update public.analysis_jobs set current_attempt_id=a,result_message_id=m,provider_metadata=metadata where id=j;
  event_key:='mlb:'||to_char(checked at time zone 'UTC','YYYY-MM-DD')||':fixturehome@fixtureaway:id-concurrent01';
  source_snapshot:=jsonb_build_object('version',1,'provenance','manual_confirmed_conditional',
    'source',jsonb_build_object('kind','conditional_candidate','sourceKind','original_block','jobId',j,'messageId',m,
      'itemKey','concurrent-fixture','rawSha256',encode(extensions.digest(raw,'sha256'),'hex'),'candidateSha256',repeat('c',64)),
    'eventKey',event_key,'match','Fixture Home vs Fixture Away','market','moneyline','selection','Fixture Home',
    'originalDecision','GO','suggestedUnits',1,'priceGate','-110 or better',
    'schedule',jsonb_build_object('precision','estimated','dateEt',to_char(checked at time zone 'UTC','YYYY-MM-DD'),'at',null,'label','Estimated'),
    'checkedAt',to_jsonb(checked)#>>'{}','deliveredAt',to_jsonb(created)#>>'{}','createdAt',to_jsonb(created)#>>'{}',
    'sourceUrl','https://example.invalid/fixture','statusAtAssessment','unknown');
  insert into public.conditional_entry_concurrency_fixture values(o,s,j,m,raw,source_snapshot,event_key);
end $$;

