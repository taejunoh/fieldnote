-- Run after 004/006 inside a rollback-only transaction.
begin;
do $$
declare o uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); s uuid; other_s uuid; e uuid; m uuid; foreign_m uuid; r uuid; b uuid; snapshot jsonb; frozen jsonb; evaluation_id uuid; successor_id uuid; second_r uuid; root_row public.recommendation_evaluations;
begin
 insert into auth.users(id,email) values(o,'record-fixture@example.invalid'),(other_owner,'other-record-fixture@example.invalid');
 insert into public.sports(owner_id,slug) values(o,'mlb') returning id into s;
 insert into public.sports(owner_id,slug) values(other_owner,'mlb') returning id into other_s;
 insert into public.events(owner_id,sport_id,event_key,label,starts_at) values(o,s,'fixture-event','Synthetic fixture','2026-10-01T18:00:00Z') returning id into e;
 snapshot := '{"checked_at":"2026-10-01T12:00:00Z","analysis_record":{"events":[{"event_key":"fixture-event","starts_at":"2026-10-01T18:00:00Z"}],"recommendations":[{"item_key":"pick","event_key":"fixture-event","market":"moneyline","selection":"Home","decision":"BET","suggested_units":1,"price_gate":"-110"}]}}';
 insert into public.messages(owner_id,sport_id,role,content,metadata,created_at) values(o,s,'assistant','Original fixture response',snapshot,'2026-10-01T12:00:01Z') returning id into m;
 insert into public.messages(owner_id,sport_id,role,content) values(other_owner,other_s,'assistant','Foreign response') returning id into foreign_m;
 insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision,suggested_units,price_gate,source_message_id,recommendation_item_key) values(o,s,e,'moneyline','Home','BET',1,'-110',m,'pick') returning id into r;
 begin
  insert into public.mistake_notes(owner_id,sport_id,title,lesson,source_message_id) values(o,s,'invalid','invalid',foreign_m);
  raise exception 'Foreign source accepted';
 exception when sqlstate '22023' then null; end;
 insert into public.bets(owner_id,sport_id,event_id,market,selection,source_message_id,source_recommendation_id,entry_confirmed_at) values(o,s,e,'moneyline','Home',m,r,now()) returning id into b;
 if (select executed_price is not null or stake_units is not null from public.bets where id=b) then raise exception 'Invented fill'; end if;
 insert into public.mistake_notes(owner_id,sport_id,event_id,title,lesson,source_message_id,source_recommendation_id,source_bet_id,request_key) values(o,s,e,'Reviewed lesson','Original assumptions require recheck',m,r,b,'note-fixture-key');
 frozen:=jsonb_build_object('version',1,'source_message_id',m,'checked_at',snapshot->'checked_at','delivered_at','2026-10-01T12:00:01Z','historical_delivery',false,'recommendation',snapshot->'analysis_record'->'recommendations'->0,'event',snapshot->'analysis_record'->'events'->0);
 begin
  insert into public.recommendation_evaluations(owner_id,sport_id,recommendation_id,source_message_id,request_key,frozen_recommendation,evaluation_input) values(o,s,r,m,'invalid-frozen-key',jsonb_set(frozen,'{recommendation,selection}','"Away"'),'{"outcome":"won","outcomeSourceUrl":"https://league.example/result","outcomeCheckedAt":"2026-10-01T22:00:00Z"}');
  raise exception 'Forged frozen source accepted';
 exception when sqlstate '22023' then null; end;
 insert into public.recommendation_evaluations(owner_id,sport_id,recommendation_id,source_message_id,request_key,frozen_recommendation,evaluation_input) values(o,s,r,m,'valid-frozen-key',frozen,'{"outcome":"won","outcomeSourceUrl":"https://league.example/result","outcomeCheckedAt":"2026-10-01T22:00:00Z"}') returning id into evaluation_id;
 insert into public.recommendation_evaluations(owner_id,sport_id,recommendation_id,source_message_id,request_key,frozen_recommendation,evaluation_input,supersedes_evaluation_id) values(o,s,r,m,'corrected-frozen-key',frozen,'{"outcome":"lost","outcomeSourceUrl":"https://league.example/result","outcomeCheckedAt":"2026-10-01T22:00:00Z"}',evaluation_id) returning id into successor_id;
 begin
  insert into public.recommendation_evaluations(owner_id,sport_id,recommendation_id,source_message_id,request_key,frozen_recommendation,evaluation_input,supersedes_evaluation_id) values(o,s,r,m,'stale-frozen-key',frozen,'{"outcome":"won","outcomeSourceUrl":"https://league.example/result","outcomeCheckedAt":"2026-10-01T22:00:00Z"}',evaluation_id);
  raise exception 'Two successors accepted';
 exception when unique_violation then null; end;
 insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision) values(o,s,e,'moneyline','Away','PASS') returning id into second_r;
 begin
  insert into public.recommendation_evaluations(owner_id,sport_id,recommendation_id,source_message_id,request_key,frozen_recommendation,evaluation_input,supersedes_evaluation_id) values(o,s,second_r,m,'cross-rec-frozen-key',frozen,'{"outcome":"won","outcomeSourceUrl":"https://league.example/result","outcomeCheckedAt":"2026-10-01T22:00:00Z"}',evaluation_id);
  raise exception 'Cross-recommendation predecessor accepted';
 exception when sqlstate '22023' then null; end;
 if (select evaluation_input->>'outcome' from public.recommendation_evaluations where id=evaluation_id)<>'won' then raise exception 'Correction rewrote original outcome'; end if;
 update public.events set starts_at='2026-10-01T19:00:00Z' where id=e;
 if (select frozen_recommendation->'event'->>'starts_at' from public.recommendation_evaluations where id=evaluation_id)<>'2026-10-01T18:00:00Z' then raise exception 'Frozen event mutated'; end if;
 begin update public.recommendation_evaluations set evaluation_input='{}' where id=evaluation_id; raise exception 'Evaluation mutable'; exception when sqlstate '22023' then null; end;
 select * into root_row from public.recommendation_evaluations where id=evaluation_id;
 if (select count(*) from public.recommendation_evaluation_successors(root_row))<>1 then raise exception 'Root successor relationship missing'; end if;
 if (select count(*) from public.recommendation_evaluation_successors((select leaf_row from public.recommendation_evaluations leaf_row where id=successor_id)))<>0 then raise exception 'Leaf incorrectly has successor'; end if;
 perform set_config('request.jwt.claim.sub',other_owner::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.recommendation_evaluation_successors(root_row)) then raise exception 'Computed relationship leaked foreign owner'; end if;
 if exists(select 1 from public.recommendation_evaluations where id=evaluation_id) then raise exception 'RLS leaked evaluation'; end if;
 execute 'reset role';
end $$;
rollback;
