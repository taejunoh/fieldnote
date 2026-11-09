-- Run after 202610010001_local_entry_ack.sql. All fixtures roll back.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000401','entry-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000402','entry-other@example.invalid');
create temporary table fixture_sports(slug text primary key) on commit drop;
insert into fixture_sports(slug) values ('mlb'),('nfl'),('cfb'),('soccer'),('tennis'),('nba'),('wnba'),('nhl');
grant select on fixture_sports to authenticated;
insert into public.sports(owner_id,slug)
 select '00000000-0000-4000-8000-000000000401'::uuid, slug from fixture_sports;
insert into public.sports(id,owner_id,slug) values
 ('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000402','wnba');
insert into public.analysis_jobs(id,owner_id,sport_id,request_key,kind,provider,status,attempt,error)
 select '00000000-0000-4000-8000-000000000404',owner_id,id,'recovery','message','openllms','failed',7,'preserved source failure'
 from public.sports where owner_id='00000000-0000-4000-8000-000000000401' and slug='wnba';
insert into public.analysis_attempts(id,job_id,owner_id,attempt_number,worker_id,status,finished_at,error)
 select case when n=7 then '00000000-0000-4000-8000-000000000405'::uuid else gen_random_uuid() end,
 '00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000401',n,'fixture','failed',clock_timestamp(),'preserved source failure'
 from generate_series(1,7) n;
insert into public.messages(id,owner_id,sport_id,role,content,analysis_job_id)
 select '00000000-0000-4000-8000-000000000406',owner_id,sport_id,'user','들어갔어',id
 from public.analysis_jobs where id='00000000-0000-4000-8000-000000000404';
update public.analysis_jobs set current_attempt_id='00000000-0000-4000-8000-000000000405',
 user_message_id='00000000-0000-4000-8000-000000000406' where id='00000000-0000-4000-8000-000000000404';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000401',true);
do $$
declare
 v_sport uuid;
 v_result jsonb;
 v_replay jsonb;
 v_text text;
 v_count integer;
 v_attempts jsonb;
 v_criteria_count integer;
 v_job uuid := '00000000-0000-4000-8000-000000000404';
begin
 if has_table_privilege('authenticated','public.local_conversation_requests','INSERT')
   or has_function_privilege('anon','public.apply_entry_confirmation_ack(uuid,text,text,uuid)','EXECUTE') then
   raise exception 'Local request grants allow unauthorized writes';
 end if;
 select jsonb_agg(to_jsonb(a) order by attempt_number) into v_attempts from public.analysis_attempts a where job_id=v_job;
 for v_sport in select id from public.sports where owner_id=auth.uid() loop
   v_result := public.apply_entry_confirmation_ack(v_sport,'local','들어갔어');
   v_replay := public.apply_entry_confirmation_ack(v_sport,'local','들어갔어');
   if v_result->>'replayed' <> 'false' or v_replay->>'replayed' <> 'true'
     or v_replay->'assistantMessage'->>'id' <> v_result->'assistantMessage'->>'id'
     or v_result->'assistantMessage'->'metadata'->>'verified' <> 'false'
     or v_result->'assistantMessage'->'metadata'->>'searched' <> 'false'
     or v_result->'assistantMessage'->'metadata'->>'analysis_mode' <> 'none'
     or v_result->'assistantMessage'->'metadata'->>'user_message_id' <> v_result->'message'->>'id'
     or v_result->'message'->>'content' <> '들어갔어' then
     raise exception 'All-sport acknowledgment or replay failed';
   end if;
   begin
     perform public.apply_entry_confirmation_ack(v_sport,'local','들어갔어요');
     raise exception 'Different raw message reused key';
   exception when sqlstate '23505' then null; end;
   begin
     insert into public.analysis_jobs(owner_id,sport_id,request_key,kind,provider)
       values(auth.uid(),v_sport,'local','message','openllms');
     raise exception 'Job reused local key';
   exception when sqlstate '23505' then null; end;
   begin
     perform public.apply_rule_instruction(v_sport,'local','default_recommended_units','앞으로 유닛은 0.25u로 해줘','units','units','saved');
     raise exception 'Rule reused local key';
   exception when sqlstate '23505' then null; end;
 end loop;
 select sport_id into v_sport from public.analysis_jobs where id=v_job;
 for v_text in select unnest(array['들어갔어요','진입했어','진입했어요','베팅했어','베팅했어요',E'  진입\t완료！  ','베팅 완료']) loop
   perform public.apply_entry_confirmation_ack(v_sport,'phrase-'||v_text,v_text);
 end loop;
 for v_text in select unnest(array['들어갔어. 분석해줘','들어갔어!!','들어갔어?','진입 완료 경기 분석','들어갔어'||chr(8203),'']) loop
   begin
     perform public.apply_entry_confirmation_ack(v_sport,'invalid-'||v_text,v_text);
     raise exception 'Mixed or invalid phrase accepted';
   exception when sqlstate '22023' then null; end;
 end loop;
 begin
   perform public.apply_entry_confirmation_ack('00000000-0000-4000-8000-000000000403','foreign','들어갔어');
   raise exception 'Foreign sport accepted';
 exception when sqlstate 'P0002' then null; end;
 perform public.apply_rule_instruction(v_sport,'rule-existing','default_recommended_units','앞으로 유닛은 0.25u로 해줘','units','units','saved');
 select count(*) into v_criteria_count from public.criteria_versions where owner_id=auth.uid();
 begin
   perform public.apply_entry_confirmation_ack(v_sport,'rule-existing','들어갔어');
   raise exception 'Local ACK reused existing rule key';
 exception when sqlstate '23505' then null; end;
 begin
   perform public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어');
   raise exception 'Existing job key accepted without recovery';
 exception when sqlstate '23505' then null; end;
 begin
   perform public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어요',v_job);
   raise exception 'Tampered recovery raw accepted';
 exception when sqlstate '23505' then null; end;
 v_result := public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어',v_job);
 v_replay := public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어',v_job);
 if v_result->'message'->>'id' <> '00000000-0000-4000-8000-000000000406'
   or v_result->'job'->>'status' <> 'failed' or v_result->'job'->>'attempt' <> '7'
   or v_result->'job'->>'dismissed_attempt' <> '7'
   or v_result->'job'->>'error' <> 'preserved source failure'
   or v_result->'job'->'provider_metadata'->'resolution'->>'resolvedAttemptId' <> '00000000-0000-4000-8000-000000000405'
   or v_result->'assistantMessage'->>'id' <> v_replay->'assistantMessage'->>'id'
   or v_attempts is distinct from (select jsonb_agg(to_jsonb(a) order by attempt_number) from public.analysis_attempts a where job_id=v_job) then
   raise exception 'Recovery altered history or duplicated original messages';
 end if;
 for v_text in select unnest(array['queued','running','completed']) loop
   -- A running OpenLLMs row must carry a valid lease before testing RPC rejection.
   update public.analysis_jobs set status=v_text,
     lease_owner=case when v_text='running' then 'fixture-worker' else null end,
     lease_expires_at=case when v_text='running' then clock_timestamp()+interval '5 minutes' else null end
     where id=v_job;
   begin
     perform public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어',v_job);
     raise exception 'Nonfailed recovery accepted';
   exception when sqlstate '22023' then null; end;
 end loop;
 update public.analysis_jobs set status='failed',lease_owner=null,lease_expires_at=null where id=v_job;
 if (select count(*) from public.analysis_jobs where owner_id=auth.uid()) <> 1
   or (select count(*) from public.criteria_versions where owner_id=auth.uid()) <> v_criteria_count
   or exists(select 1 from public.events where owner_id=auth.uid())
   or exists(select 1 from public.recommendations where owner_id=auth.uid())
   or exists(select 1 from public.bets where owner_id=auth.uid()) then
   raise exception 'Acknowledgment changed analysis jobs, criteria, or ledger';
 end if;
 select count(*) into v_count from public.local_conversation_requests;
 if v_count <> (select count(*) from fixture_sports) + 8 then
   raise exception 'Unexpected local request count: %',v_count;
 end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000402',true);
 if exists(select 1 from public.local_conversation_requests) then raise exception 'Owner RLS leaked local requests'; end if;
 begin
   perform public.apply_entry_confirmation_ack(v_sport,'recovery','들어갔어',v_job);
   raise exception 'Other owner recovered job';
 exception when sqlstate 'P0002' then null; end;
end $$;
rollback;
