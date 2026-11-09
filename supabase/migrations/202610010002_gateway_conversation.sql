-- Completed legacy NULL results continue to mean analysis.
alter table public.analysis_jobs add column result_type text
  check (result_type in ('analysis','conversation'));

-- Owners can enqueue jobs; only a trusted finalizer may classify a completed conversation.
create function public.guard_gateway_conversation_result()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.result_type = 'conversation' then
    if auth.role() is distinct from 'service_role' then
      raise exception 'Service role required for conversation results' using errcode = '42501';
    end if;
    if new.kind <> 'message' or new.provider <> 'openllms' or new.status <> 'completed'
      or new.result_message_id is null or not exists (
        select 1 from public.messages m where m.id = new.result_message_id
          and m.owner_id = new.owner_id and m.sport_id = new.sport_id
          and m.analysis_job_id = new.id and m.role = 'assistant'
          and m.metadata->>'type' = 'conversation' and m.metadata->>'result_type' = 'conversation'
      ) then
      raise exception 'Invalid completed conversation result' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and old.result_type = 'conversation'
    and (new.result_type is distinct from old.result_type or new.result_message_id is distinct from old.result_message_id)
    and auth.role() is distinct from 'service_role' then
    raise exception 'Completed conversation classification is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger analysis_jobs_conversation_result_guard before insert or update on public.analysis_jobs
  for each row execute function public.guard_gateway_conversation_result();
revoke all on function public.guard_gateway_conversation_result() from public,anon,authenticated;

create or replace function public.finalize_gateway_job(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text,
  p_content text, p_metadata jsonb default '{}'::jsonb,
  p_provider_response_id text default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_attempt public.analysis_attempts%rowtype;
  v_message uuid;
  v_event_id uuid;
  v_events jsonb := '{}'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_record jsonb := p_metadata->'analysis_record';
  v_event jsonb;
  v_recommendation jsonb;
  v_sport text;
  v_source_host text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_metadata->>'terminalStatus' is distinct from 'completed'
    or p_metadata->>'verified' is distinct from 'true' then
    raise exception 'Only verified completed gateway results may be finalized';
  end if;
  if nullif(btrim(p_content), '') is null then raise exception 'Assistant content required'; end if;

  select * into v_job from public.analysis_jobs where id = p_job_id for update;
  if not found or v_job.provider <> 'openllms' or v_job.status <> 'running'
    or v_job.current_attempt_id is distinct from p_attempt_id
    or v_job.lease_owner is distinct from p_worker_id or v_job.lease_expires_at <= v_now then
    raise exception 'Stale or expired gateway attempt' using errcode = '55000';
  end if;
  select * into v_attempt from public.analysis_attempts
    where id = p_attempt_id and job_id = p_job_id and status = 'running' for update;
  if not found or v_attempt.execution_started_at is null then
    raise exception 'Gateway execution was not marked started' using errcode = '55000';
  end if;

  if v_record is not null then
    select slug into v_sport from public.sports where id = v_job.sport_id and owner_id = v_job.owner_id;
    if jsonb_typeof(v_record) is distinct from 'object' or v_record->>'version' is distinct from '1'
      or v_record->>'sport' is distinct from v_sport
      or jsonb_typeof(v_record->'events') is distinct from 'array'
      or jsonb_typeof(v_record->'recommendations') is distinct from 'array'
      or jsonb_typeof(p_metadata->'sources') is distinct from 'array'
      or nullif(p_metadata->>'checked_at', '') is null then
      raise exception 'Invalid analysis record' using errcode = '22023';
    end if;
    if jsonb_array_length(v_record->'events') > 20
      or jsonb_array_length(v_record->'recommendations') > 20 then
      raise exception 'Analysis record exceeds item limit' using errcode = '22023';
    end if;
  end if;

  insert into public.messages(owner_id, sport_id, role, content, metadata, analysis_job_id)
    values(v_job.owner_id, v_job.sport_id, 'assistant', p_content, p_metadata, p_job_id)
    on conflict (analysis_job_id, role) do nothing returning id into v_message;
  if v_message is null then
    raise exception 'Assistant message already exists for this job' using errcode = '23505';
  end if;

  if v_record is not null then
    for v_event in select value from jsonb_array_elements(v_record->'events') loop
      if jsonb_typeof(v_event) <> 'object'
        or v_event->>'event_key' !~ ('^' || v_sport || ':[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9][a-z0-9-]+@[a-z0-9][a-z0-9-]+:(id-[a-z0-9]{3,40}|src-[a-f0-9]{32})$')
        or nullif(btrim(v_event->>'label'), '') is null
        or v_event->>'analysis_status' is null
        or v_event->>'analysis_status' not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')
        or v_events ? (v_event->>'event_key')
        or not exists (select 1 from jsonb_array_elements(p_metadata->'sources') as s
          where s->>'url' = v_event->>'source_url') then
        raise exception 'Invalid sourced event' using errcode = '22023';
      end if;
      if v_event->>'event_key' ~ ':src-[a-f0-9]{32}$' then
        v_source_host := lower(substring(v_event->>'source_url' from '^https://([A-Za-z0-9.-]+)/'));
        if v_source_host is null or not (
          (v_sport = 'mlb' and v_source_host in ('mlb.com', 'www.mlb.com')) or
          (v_sport = 'nfl' and v_source_host in ('nfl.com', 'www.nfl.com')) or
          (v_sport = 'cfb' and v_source_host in ('ncaa.com', 'www.ncaa.com', 'collegefootballplayoff.com', 'www.collegefootballplayoff.com')) or
          (v_sport = 'soccer' and v_source_host in ('fifa.com', 'www.fifa.com', 'uefa.com', 'www.uefa.com', 'mlssoccer.com', 'www.mlssoccer.com', 'premierleague.com', 'www.premierleague.com')) or
          (v_sport = 'tennis' and v_source_host in ('atptour.com', 'www.atptour.com', 'wtatennis.com', 'www.wtatennis.com', 'itftennis.com', 'www.itftennis.com')) or
          (v_sport = 'wnba' and v_source_host in ('wnba.com', 'www.wnba.com')) or
          (v_sport = 'nhl' and v_source_host in ('nhl.com', 'www.nhl.com'))
        ) or v_event->>'event_key' is distinct from regexp_replace(
          v_event->>'event_key', ':src-[a-f0-9]{32}$',
          ':src-' || left(encode(extensions.digest(v_event->>'source_url', 'sha256'), 'hex'), 32)
        ) then
          raise exception 'Invalid official source event key' using errcode = '22023';
        end if;
      end if;
      if v_event->>'analysis_status' = 'BET' and
        (nullif(v_event->>'starts_at', '') is null
          or (v_event->>'starts_at')::timestamptz <= (p_metadata->>'checked_at')::timestamptz) then
        raise exception 'BET event requires a future start' using errcode = '22023';
      end if;
      insert into public.events(owner_id, sport_id, event_key, label, starts_at, source_ref, analysis_status)
        values(v_job.owner_id, v_job.sport_id, v_event->>'event_key',
          v_event->>'label', (v_event->>'starts_at')::timestamptz,
          v_event->>'source_url', v_event->>'analysis_status')
        on conflict (owner_id, sport_id, event_key) do update set
          label = excluded.label,
          starts_at = coalesce(public.events.starts_at, excluded.starts_at),
          source_ref = excluded.source_ref,
          updated_at = v_now
        returning id into v_event_id;
      v_events := jsonb_set(v_events, array[v_event->>'event_key'], to_jsonb(v_event_id::text));
    end loop;

    for v_recommendation in select value from jsonb_array_elements(v_record->'recommendations') loop
      v_event_id := (v_events->>(v_recommendation->>'event_key'))::uuid;
      if v_event_id is null
        or v_recommendation->>'item_key' !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        or v_items ? (v_recommendation->>'item_key')
        or nullif(btrim(v_recommendation->>'market'), '') is null
        or nullif(btrim(v_recommendation->>'selection'), '') is null
        or v_recommendation->>'decision' is null
        or v_recommendation->>'decision' not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE') then
        raise exception 'Invalid recommendation' using errcode = '22023';
      end if;
      if v_recommendation->>'decision' = 'BET' and not exists (
        select 1 from jsonb_array_elements(v_record->'events') as e
          where e->>'event_key' = v_recommendation->>'event_key'
            and nullif(e->>'starts_at', '') is not null
            and (e->>'starts_at')::timestamptz > (p_metadata->>'checked_at')::timestamptz
      ) then
        raise exception 'BET recommendation requires a future start' using errcode = '22023';
      end if;
      insert into public.recommendations(
        owner_id, sport_id, event_id, market, selection, decision,
        suggested_units, price_gate, analysis_job_id, recommendation_item_key,
        source_message_id, source_ref
      ) values (
        v_job.owner_id, v_job.sport_id, v_event_id,
        v_recommendation->>'market', v_recommendation->>'selection',
        v_recommendation->>'decision',
        (v_recommendation->>'suggested_units')::numeric,
        v_recommendation->>'price_gate', p_job_id,
        v_recommendation->>'item_key', v_message,
        (select source_ref from public.events where id = v_event_id)
      ) on conflict (analysis_job_id, recommendation_item_key) where analysis_job_id is not null and recommendation_item_key is not null do nothing;
      v_items := jsonb_set(v_items, array[v_recommendation->>'item_key'], 'true'::jsonb);
    end loop;
  end if;

  update public.analysis_attempts set
    status = 'completed', finished_at = v_now,
    provider_response_id = p_provider_response_id,
    usage = coalesce(p_metadata->'usage', '{}'::jsonb),
    sources = coalesce(p_metadata->'sources', '[]'::jsonb),
    provider_metadata = p_metadata
  where id = p_attempt_id;
  update public.analysis_jobs set
    status = 'completed', result_type = 'analysis', response_id = p_provider_response_id,
    result_message_id = v_message, error = null,
    lease_owner = null, lease_expires_at = null,
    provider_metadata = p_metadata, updated_at = v_now
  where id = p_job_id;
  return v_message;
end $$;

-- Conversation completion has the same atomic lease lifecycle but no analysis record writes.
create function public.finalize_gateway_conversation_job(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text,
  p_content text, p_metadata jsonb default '{}'::jsonb,
  p_provider_response_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_attempt public.analysis_attempts%rowtype;
  v_message uuid;
  v_purpose jsonb := p_metadata->'response_purpose';
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_metadata) is distinct from 'object'
    or p_metadata->>'type' is distinct from 'conversation'
    or p_metadata->>'result_type' is distinct from 'conversation'
    or p_metadata->>'terminalStatus' is distinct from 'completed'
    or jsonb_typeof(p_metadata->'verified') is distinct from 'boolean'
    or jsonb_typeof(p_metadata->'searched') is distinct from 'boolean'
    or jsonb_typeof(p_metadata->'sources') is distinct from 'array'
    or p_metadata ?| array['analysis_record','analysis_coverage','coverage','analysis_scope']
    or jsonb_typeof(v_purpose) is distinct from 'object'
    or v_purpose->>'version' is distinct from '1'
    or coalesce(v_purpose->>'intent','') not in ('conversation','clarification')
    or coalesce(v_purpose->>'basis','') not in ('general','stored_context','fresh_web')
    or v_purpose->'requires_fresh_data' is distinct from 'false'::jsonb
    or jsonb_typeof(v_purpose->'referenced_message_ids') is distinct from 'array'
    or coalesce(p_metadata->>'response_purpose_status','') not in ('valid','invalid')
    or v_purpose - array['version','intent','basis','referenced_message_ids','requires_fresh_data'] <> '{}'::jsonb
    or nullif(btrim(p_content),'') is null
    or p_content ~* '```[[:space:]]*analysis[-_](record|coverage)' then
    raise exception 'Invalid conversation result' using errcode = '22023';
  end if;
  if v_purpose->>'basis' = 'fresh_web' and (
    p_metadata->'searched' is distinct from 'true'::jsonb
    or p_metadata->'verified' is distinct from 'true'::jsonb
    or jsonb_array_length(p_metadata->'sources') = 0) then
    raise exception 'Fresh web conversation requires verified sources' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_purpose->'referenced_message_ids') r
    where jsonb_typeof(r) is distinct from 'string') then
    raise exception 'Invalid conversation references' using errcode = '22023';
  end if;
  -- Raw original_model_response is audit text, deliberately excluded from payload rejection.
  select * into v_job from public.analysis_jobs where id = p_job_id for update;
  if not found or v_job.provider <> 'openllms' or v_job.status <> 'running'
    or v_job.current_attempt_id is distinct from p_attempt_id
    or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_expires_at is null or v_job.lease_expires_at <= v_now then
    raise exception 'Stale or expired gateway attempt' using errcode = '55000';
  end if;
  if v_job.kind <> 'message' then
    raise exception 'Only message jobs may finish as conversation' using errcode = '22023';
  end if;
  select * into v_attempt from public.analysis_attempts
    where id = p_attempt_id and job_id = p_job_id and status = 'running' for update;
  if not found or v_attempt.execution_started_at is null
    or v_attempt.owner_id is distinct from v_job.owner_id
    or v_attempt.worker_id is distinct from p_worker_id
    or v_attempt.attempt_number is distinct from v_job.attempt then
    raise exception 'Gateway execution was not marked started' using errcode = '55000';
  end if;
  insert into public.messages(owner_id,sport_id,role,content,metadata,analysis_job_id)
    values(v_job.owner_id,v_job.sport_id,'assistant',p_content,p_metadata,p_job_id)
    on conflict (analysis_job_id,role) do nothing returning id into v_message;
  if v_message is null then
    raise exception 'Assistant message already exists for this job' using errcode = '23505';
  end if;
  update public.analysis_attempts set status='completed',finished_at=v_now,
    provider_response_id=p_provider_response_id,usage=coalesce(p_metadata->'usage','{}'::jsonb),
    sources=p_metadata->'sources',provider_metadata=p_metadata where id=p_attempt_id;
  update public.analysis_jobs set status='completed',result_type='conversation',
    response_id=p_provider_response_id,result_message_id=v_message,error=null,
    lease_owner=null,lease_expires_at=null,provider_metadata=p_metadata,updated_at=v_now where id=p_job_id;
  return v_message;
end $$;
revoke all on function public.finalize_gateway_conversation_job(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finalize_gateway_conversation_job(uuid,uuid,text,text,jsonb,text) to service_role;
