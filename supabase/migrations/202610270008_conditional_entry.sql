-- A confirmed conditional-candidate entry creates/reuses its canonical event and
-- actual bet in one transaction. Browser-authenticated writes cannot provide
-- source_candidate; only the server's service_role RPC can.

alter table public.bets add column source_candidate jsonb;

create function public.guard_bet_source_candidate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.source_candidate is not null then
    if new.source_candidate is distinct from old.source_candidate
      or new.owner_id is distinct from old.owner_id or new.sport_id is distinct from old.sport_id
      or new.event_id is distinct from old.event_id or new.market is distinct from old.market
      or new.selection is distinct from old.selection
      or new.source_message_id is distinct from old.source_message_id
      or new.source_recommendation_id is distinct from old.source_recommendation_id then
      raise exception 'Conditional source snapshots are immutable' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.source_candidate is not null then
    -- This function intentionally remains SECURITY INVOKER. current_user is the
    -- effective database role; auth.role() alone is a request claim.
    if current_user <> 'service_role' then
      raise exception 'Verified source snapshots require the service role' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Conditional source snapshots can only be set on insert' using errcode = '22023';
    end if;
    if new.source_recommendation_id is not null or new.source_message_id is null then
      raise exception 'Conditional source snapshots must be message-bound with no recommendation' using errcode = '22023';
    end if;
    if jsonb_typeof(new.source_candidate) is distinct from 'object'
      or new.source_candidate->>'version' is distinct from '1'
      or new.source_candidate->>'provenance' is distinct from 'manual_confirmed_conditional'
      or new.source_candidate->'source'->>'kind' is distinct from 'conditional_candidate'
      or new.source_candidate->'source'->>'messageId' is distinct from new.source_message_id::text
      or new.source_candidate->>'eventKey' is null
      or new.source_candidate->>'market' is distinct from new.market
      or new.source_candidate->>'selection' is distinct from new.selection then
      raise exception 'Conditional source snapshot does not match the bet' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger bets_source_candidate_guard
before insert or update of owner_id, sport_id, source_candidate, source_message_id, source_recommendation_id, event_id, market, selection
on public.bets for each row execute function public.guard_bet_source_candidate();

create function public.record_conditional_entry(
  p_owner_id uuid,
  p_sport_id uuid,
  p_request_key text,
  p_confirmed boolean,
  p_source_candidate jsonb,
  p_stake_units numeric,
  p_executed_price integer
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_message public.messages%rowtype;
  v_job public.analysis_jobs%rowtype;
  v_attempt public.analysis_attempts%rowtype;
  v_event public.events%rowtype;
  v_bet public.bets%rowtype;
  v_raw text;
  v_context jsonb;
  v_source jsonb;
  v_event_created boolean := false;
  v_inserted_id uuid;
  v_sport_slug text;
  v_now timestamptz := clock_timestamp();
  v_expected_event_key text;
begin
  if current_user <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_confirmed is distinct from true
    or p_owner_id is null or p_sport_id is null
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,100}$'
    or jsonb_typeof(p_source_candidate) is distinct from 'object'
    or p_stake_units is not null and (p_stake_units <= 0 or p_stake_units > 99999.999 or p_stake_units <> trunc(p_stake_units, 3))
    or p_executed_price is not null and abs(p_executed_price::bigint) < 100 then
    raise exception 'Invalid conditional entry' using errcode = '22023';
  end if;

  v_source := p_source_candidate->'source';
  if p_source_candidate->>'version' is distinct from '1'
    or p_source_candidate->>'provenance' is distinct from 'manual_confirmed_conditional'
    or (p_source_candidate - array['version','provenance','createdAt','sourceUrl','statusAtAssessment','source','eventKey','match','market','selection','originalDecision','suggestedUnits','priceGate','schedule','checkedAt','deliveredAt']) <> '{}'::jsonb
    or jsonb_typeof(v_source) is distinct from 'object'
    or (v_source - array['kind','sourceKind','jobId','messageId','itemKey','rawSha256','candidateSha256']) <> '{}'::jsonb
    or not (v_source ?& array['kind','sourceKind','jobId','messageId','itemKey','rawSha256','candidateSha256'])
    or v_source->>'kind' is distinct from 'conditional_candidate'
    or v_source->>'sourceKind' is null or v_source->>'sourceKind' not in ('original_block','reviewed_overlay')
    or v_source->>'jobId' is null or v_source->>'messageId' is null
    or v_source->>'itemKey' is null
    or coalesce(v_source->>'rawSha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(v_source->>'candidateSha256','') !~ '^[a-f0-9]{64}$'
    or p_source_candidate->>'eventKey' is null
    or p_source_candidate->>'eventKey' !~ '^(mlb|nfl|cfb|soccer|tennis|nba|wnba|nhl):[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9][a-z0-9-]+@[a-z0-9][a-z0-9-]+:(id-[a-z0-9]{3,40}|src-[a-f0-9]{32})$'
    or nullif(btrim(p_source_candidate->>'match'),'') is null
    or nullif(btrim(p_source_candidate->>'market'),'') is null
    or nullif(btrim(p_source_candidate->>'selection'),'') is null
    or p_source_candidate->>'originalDecision' is null or p_source_candidate->>'originalDecision' not in ('BET','GO','EARLY GO')
    or jsonb_typeof(p_source_candidate->'suggestedUnits') is distinct from 'number'
    or jsonb_typeof(p_source_candidate->'schedule') is distinct from 'object'
    or ((p_source_candidate->'schedule') - array['precision','dateEt','at','label']) <> '{}'::jsonb
    or not (p_source_candidate->'schedule' ?& array['precision','dateEt','at','label'])
    or p_source_candidate->'schedule'->>'precision' is null or p_source_candidate->'schedule'->>'precision' not in ('not_before','estimated','date_only','unknown')
    or nullif(p_source_candidate->>'checkedAt','') is null
    or nullif(p_source_candidate->>'deliveredAt','') is null
    or nullif(p_source_candidate->>'createdAt','') is null
    or nullif(p_source_candidate->>'sourceUrl','') is null
    or p_source_candidate->>'statusAtAssessment' is null or p_source_candidate->>'statusAtAssessment' not in ('scheduled','unknown') then
    raise exception 'Invalid conditional source snapshot' using errcode = '22023';
  end if;

  -- Serialize by the bets table's actual uniqueness scope (owner + request key),
  -- including attempts that accidentally supply different sport IDs.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_request_key, 0));
  select * into v_bet from public.bets
    where owner_id = p_owner_id and request_key = p_request_key for update;
  if found then
    if v_bet.sport_id is distinct from p_sport_id
      or v_bet.source_candidate is distinct from p_source_candidate
      or v_bet.stake_units is distinct from p_stake_units
      or v_bet.executed_price is distinct from p_executed_price then
      raise exception 'Idempotency key already records a different entry' using errcode = '23505';
    end if;
    select * into v_event from public.events where id = v_bet.event_id and owner_id = p_owner_id and sport_id = p_sport_id;
    return jsonb_build_object('bet',to_jsonb(v_bet),'alreadyRecorded',true,'eventCreated',false);
  end if;

  select * into v_job from public.analysis_jobs j
  where j.id = (v_source->>'jobId')::uuid and j.owner_id = p_owner_id and j.sport_id = p_sport_id
    and j.status = 'completed' and j.result_message_id = (v_source->>'messageId')::uuid
  for update;
  if not found then raise exception 'Verified source job unavailable' using errcode = 'P0002'; end if;
  select * into v_attempt from public.analysis_attempts a
  where a.id = v_job.current_attempt_id and a.job_id = v_job.id and a.owner_id = p_owner_id and a.status = 'completed'
  for update;
  if not found then raise exception 'Verified source attempt unavailable' using errcode = 'P0002'; end if;
  v_context := (v_attempt.input_snapshot->>'context')::jsonb;
  if v_job.kind not in ('message','analyze_today','recheck_lineup','check_status')
    or v_job.result_type is distinct from 'analysis'
    or v_attempt.input_snapshot->>'attempt_id' is distinct from v_attempt.id::text
    or v_attempt.input_snapshot->>'context_sha256' is distinct from encode(extensions.digest(v_attempt.input_snapshot->>'context','sha256'),'hex')
    or v_attempt.input_snapshot->>'instructions_sha256' is distinct from encode(extensions.digest(v_attempt.input_snapshot->>'instructions','sha256'),'hex')
    or v_context->>'sport' is distinct from (select s.slug from public.sports s where s.id=p_sport_id and s.owner_id=p_owner_id)
    or v_context->>'current_job_kind' is distinct from v_job.kind
    or v_attempt.provider_metadata->>'type' is distinct from 'analysis'
    or v_attempt.provider_metadata->>'result_type' is distinct from 'analysis'
    or v_attempt.provider_metadata->>'terminalStatus' is distinct from 'completed'
    or v_attempt.provider_metadata->>'verified' is distinct from 'true'
    or v_attempt.provider_metadata->>'searched' is distinct from 'true'
    or v_attempt.provider_metadata->'input_snapshot'->>'attempt_id' is distinct from v_attempt.id::text
    or v_attempt.provider_metadata->'input_snapshot'->>'context_sha256' is distinct from v_attempt.input_snapshot->>'context_sha256'
    or v_attempt.provider_metadata->'input_snapshot'->>'instructions_sha256' is distinct from v_attempt.input_snapshot->>'instructions_sha256'
    or v_attempt.provider_metadata->'input_snapshot'->'common_policy' is distinct from v_attempt.input_snapshot->'common_policy'
    or v_attempt.provider_metadata->>'hypothetical' = 'true'
    or coalesce(v_attempt.provider_metadata->>'analysis_purpose',v_attempt.provider_metadata->>'purpose') in ('hypothetical','retrospective_hypothetical')
    or v_attempt.provider_metadata->'response_purpose'->>'intent' in ('hypothetical','conversation','clarification')
    or (v_job.kind = 'message' and (v_attempt.provider_metadata->>'response_purpose_status' is distinct from 'valid'
      or v_attempt.provider_metadata->'response_purpose'->>'intent' is null
      or v_attempt.provider_metadata->'response_purpose'->>'intent' not in ('current_analysis','mixed'))) then
    raise exception 'Source job is not an eligible analysis result' using errcode = '22023';
  end if;

  select * into v_message from public.messages m
  where m.id = (v_source->>'messageId')::uuid and m.owner_id = p_owner_id and m.sport_id = p_sport_id
    and m.analysis_job_id = v_job.id and m.role = 'assistant'
  for update;
  if not found then raise exception 'Verified source message unavailable' using errcode = 'P0002'; end if;

  select slug into v_sport_slug from public.sports where id = p_sport_id and owner_id = p_owner_id;
  if v_sport_slug is null or split_part(p_source_candidate->>'eventKey',':',1) is distinct from v_sport_slug then
    raise exception 'Conditional event key does not match sport' using errcode = '22023';
  end if;

  v_raw := v_message.metadata->>'original_model_response';
  if v_raw is null
    or v_attempt.provider_metadata->>'type' is distinct from v_message.metadata->>'type'
    or v_attempt.provider_metadata->>'result_type' is distinct from v_message.metadata->>'result_type'
    or v_attempt.provider_metadata->>'terminalStatus' is distinct from v_message.metadata->>'terminalStatus'
    or v_attempt.provider_metadata->>'verified' is distinct from v_message.metadata->>'verified'
    or v_attempt.provider_metadata->>'searched' is distinct from v_message.metadata->>'searched'
    or v_attempt.provider_metadata->>'original_model_response' is distinct from v_raw
    or v_attempt.provider_metadata->>'checked_at' is distinct from v_message.metadata->>'checked_at'
    or v_attempt.provider_metadata->'sources' is distinct from v_message.metadata->'sources'
    or v_attempt.provider_metadata->>'response_purpose_status' is distinct from v_message.metadata->>'response_purpose_status'
    or v_attempt.provider_metadata->'response_purpose' is distinct from v_message.metadata->'response_purpose'
    or v_attempt.provider_metadata->>'analysis_purpose' is distinct from v_message.metadata->>'analysis_purpose'
    or v_attempt.provider_metadata->>'purpose' is distinct from v_message.metadata->>'purpose'
    or v_attempt.provider_metadata->>'hypothetical' is distinct from v_message.metadata->>'hypothetical'
    or v_attempt.provider_metadata->'input_snapshot' is distinct from v_message.metadata->'input_snapshot'
    or v_attempt.provider_metadata->'common_policy' is distinct from v_message.metadata->'common_policy'
    or v_attempt.input_snapshot->'common_policy' is distinct from v_message.metadata->'common_policy'
    or v_attempt.provider_metadata->'delivery' is distinct from v_message.metadata->'delivery'
    or v_job.provider_metadata->>'original_model_response' is distinct from v_raw
    or v_job.provider_metadata->>'type' is distinct from v_message.metadata->>'type'
    or v_job.provider_metadata->>'result_type' is distinct from v_message.metadata->>'result_type'
    or v_job.provider_metadata->>'terminalStatus' is distinct from v_message.metadata->>'terminalStatus'
    or v_job.provider_metadata->>'verified' is distinct from v_message.metadata->>'verified'
    or v_job.provider_metadata->>'searched' is distinct from v_message.metadata->>'searched'
    or v_job.provider_metadata->>'checked_at' is distinct from v_message.metadata->>'checked_at'
    or v_job.provider_metadata->>'response_purpose_status' is distinct from v_message.metadata->>'response_purpose_status'
    or v_job.provider_metadata->'response_purpose' is distinct from v_message.metadata->'response_purpose'
    or v_job.provider_metadata->>'analysis_purpose' is distinct from v_message.metadata->>'analysis_purpose'
    or v_job.provider_metadata->>'purpose' is distinct from v_message.metadata->>'purpose'
    or v_job.provider_metadata->>'hypothetical' is distinct from v_message.metadata->>'hypothetical'
    or v_job.provider_metadata->'input_snapshot' is distinct from v_message.metadata->'input_snapshot'
    or v_job.provider_metadata->'common_policy' is distinct from v_message.metadata->'common_policy'
    or v_job.provider_metadata->'delivery' is distinct from v_message.metadata->'delivery'
    or v_message.metadata->>'hypothetical' = 'true'
    or coalesce(v_message.metadata->>'analysis_purpose',v_message.metadata->>'purpose') in ('hypothetical','retrospective_hypothetical')
    or v_message.metadata->'response_purpose'->>'intent' in ('hypothetical','conversation','clarification')
    or encode(extensions.digest(v_raw,'sha256'),'hex') is distinct from v_source->>'rawSha256'
    or p_source_candidate->>'checkedAt' !~ '^\d{4}-\d{2}-\d{2}T'
    or (p_source_candidate->>'checkedAt')::timestamptz is distinct from (v_message.metadata->>'checked_at')::timestamptz
    or p_source_candidate->>'deliveredAt' !~ '^\d{4}-\d{2}-\d{2}T'
    or (p_source_candidate->>'deliveredAt')::timestamptz is distinct from
      coalesce((v_message.metadata#>>'{delivery,delivered_at}')::timestamptz,v_message.created_at)
    or p_source_candidate->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T'
    or (p_source_candidate->>'createdAt')::timestamptz is distinct from v_message.created_at
    or p_source_candidate->>'sourceUrl' !~ '^https://[^[:space:]]+$' then
    raise exception 'Conditional source changed or timestamp mismatch' using errcode = '22023';
  end if;

  -- The source ref is a fixed manual marker; original citations live only in
  -- source_candidate so the event is not mistaken for a new analysis citation.
  insert into public.events(owner_id,sport_id,event_key,label,starts_at,game_status,analysis_status,notes,source_ref)
  values(p_owner_id,p_sport_id,p_source_candidate->>'eventKey',p_source_candidate->>'match',null,'unknown',
    'EVALUATION INCOMPLETE',
    'Manual event registration. Schedule and source record data are incomplete; the original conditional judgment is preserved on the confirmed bet.',
    'manual-confirmed:conditional:' || v_message.id::text || ':' || (v_source->>'candidateSha256'))
  on conflict (owner_id,sport_id,event_key) do nothing
  returning id into v_inserted_id;
  v_event_created := v_inserted_id is not null;

  if v_event_created then
    select * into v_event from public.events where id = v_inserted_id;
  else
    select * into v_event from public.events where owner_id = p_owner_id and sport_id = p_sport_id
      and event_key = p_source_candidate->>'eventKey' for update;
    if not found then raise exception 'Canonical event unavailable' using errcode = 'P0002'; end if;
  end if;

  insert into public.bets(owner_id,sport_id,event_id,market,selection,request_key,
    stake_units,executed_price,entry_confirmed_at,source_message_id,source_recommendation_id,
    source_candidate,result,profit_units)
  values(p_owner_id,p_sport_id,v_event.id,p_source_candidate->>'market',p_source_candidate->>'selection',p_request_key,
    p_stake_units,p_executed_price,v_now,v_message.id,null,p_source_candidate,'unknown',null)
  returning * into v_bet;

  return jsonb_build_object('bet',to_jsonb(v_bet),'alreadyRecorded',false,'eventCreated',v_event_created);
end $$;

revoke all on function public.record_conditional_entry(uuid,uuid,text,boolean,jsonb,numeric,integer) from public, anon, authenticated;
grant execute on function public.record_conditional_entry(uuid,uuid,text,boolean,jsonb,numeric,integer) to service_role;
