-- Closed, report-only conversation acknowledgments never create analysis or ledger rows.
create table public.local_conversation_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  request_key text not null,
  raw_text text not null,
  user_message_id uuid not null,
  assistant_message_id uuid not null,
  existing_job_id uuid,
  resolved_attempt integer,
  resolved_attempt_id uuid,
  created_at timestamptz not null default now(),
  primary key (owner_id, sport_id, request_key),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (user_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (assistant_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (existing_job_id, owner_id) references public.analysis_jobs(id, owner_id),
  foreign key (existing_job_id, resolved_attempt_id) references public.analysis_attempts(job_id, id),
  check ((existing_job_id is null and resolved_attempt is null and resolved_attempt_id is null)
    or (existing_job_id is not null and resolved_attempt is not null and resolved_attempt > 0 and resolved_attempt_id is not null))
);
alter table public.local_conversation_requests enable row level security;
create policy owner_select on public.local_conversation_requests for select to authenticated
  using (owner_id = auth.uid());
revoke all on public.local_conversation_requests from public, anon, authenticated;
grant select on public.local_conversation_requests to authenticated;

-- Every writer takes the existing owner/sport/key lock; protect the namespace in both directions.
create function public.guard_local_conversation_key()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_idempotency_key(new.owner_id, new.sport_id, new.request_key);
  if tg_table_name = 'local_conversation_requests' then
    if exists (select 1 from public.rule_instruction_requests r where
      r.owner_id = new.owner_id and r.sport_id = new.sport_id and r.request_key = new.request_key)
      or exists (select 1 from public.analysis_jobs j where
        j.owner_id = new.owner_id and j.sport_id = new.sport_id and j.request_key = new.request_key
        and j.id is distinct from new.existing_job_id) then
      raise exception 'Idempotency key is already used' using errcode = '23505';
    end if;
  elsif exists (select 1 from public.local_conversation_requests r where
    r.owner_id = new.owner_id and r.sport_id = new.sport_id and r.request_key = new.request_key) then
    raise exception 'Idempotency key is already used by a local conversation' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger local_conversation_key_guard before insert or update of owner_id, sport_id, request_key
  on public.local_conversation_requests for each row execute function public.guard_local_conversation_key();
create trigger rule_local_conversation_key_guard before insert or update of owner_id, sport_id, request_key
  on public.rule_instruction_requests for each row execute function public.guard_local_conversation_key();
create trigger job_local_conversation_key_guard before insert or update of owner_id, sport_id, request_key
  on public.analysis_jobs for each row execute function public.guard_local_conversation_key();

create function public.apply_entry_confirmation_ack(
  p_sport_id uuid, p_request_key text, p_raw_text text, p_existing_job_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_normalized text;
  v_existing public.local_conversation_requests%rowtype;
  v_job public.analysis_jobs%rowtype;
  v_user public.messages%rowtype;
  v_assistant public.messages%rowtype;
  v_metadata jsonb;
  v_replayed boolean := false;
  v_ack constant text := '진입하셨다는 보고를 대화에 기록했어요. 실제 베팅 내역은 아직 등록하지 않았어요. 경기·선택, 실제 체결 배당, 금액을 알려 주세요.';
begin
  if auth.role() is distinct from 'authenticated' or v_owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_normalized := btrim(regexp_replace(normalize(p_raw_text, NFC), U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g'));
  v_normalized := btrim(regexp_replace(v_normalized, '[.!。！]$', ''));
  if nullif(btrim(p_request_key), '') is null or v_normalized is null or v_normalized not in
    ('들어갔어','들어갔어요','진입했어','진입했어요','베팅했어','베팅했어요','진입 완료','베팅 완료') then
    raise exception 'Invalid entry confirmation' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sports where id = p_sport_id and owner_id = v_owner) then
    raise exception 'Sport not found' using errcode = 'P0002';
  end if;
  perform public.lock_idempotency_key(v_owner, p_sport_id, p_request_key);
  select * into v_existing from public.local_conversation_requests
    where owner_id = v_owner and sport_id = p_sport_id and request_key = p_request_key for update;
  v_replayed := found;
  if v_replayed and (v_existing.raw_text is distinct from p_raw_text
    or v_existing.existing_job_id is distinct from p_existing_job_id) then
    raise exception 'Idempotency key was already used for a different message' using errcode = '23505';
  end if;
  if exists (select 1 from public.rule_instruction_requests where owner_id = v_owner
    and sport_id = p_sport_id and request_key = p_request_key) then
    raise exception 'Idempotency key is already used by a rule instruction' using errcode = '23505';
  end if;
  if p_existing_job_id is null then
    if exists (select 1 from public.analysis_jobs where owner_id = v_owner
      and sport_id = p_sport_id and request_key = p_request_key) then
      raise exception 'Idempotency key is already used by an analysis job' using errcode = '23505';
    end if;
  else
    select * into v_job from public.analysis_jobs where id = p_existing_job_id
      and owner_id = v_owner and sport_id = p_sport_id for update;
    if not found or v_job.request_key is distinct from p_request_key or v_job.kind <> 'message'
      or v_job.provider <> 'openllms' or v_job.status <> 'failed' or v_job.user_message_id is null
      or v_job.result_message_id is not null or v_job.current_attempt_id is null then
      raise exception 'Job is not a matching failed message' using errcode = '22023';
    end if;
    if exists (select 1 from public.messages where analysis_job_id = v_job.id and role = 'assistant') then
      raise exception 'Job already has an assistant message' using errcode = '22023';
    end if;
    if not exists (select 1 from public.analysis_attempts where id = v_job.current_attempt_id
      and job_id = v_job.id and owner_id = v_owner and attempt_number = v_job.attempt
      and status = 'failed' and finished_at is not null) then
      raise exception 'Job current attempt is not failed' using errcode = '22023';
    end if;
    select * into v_user from public.messages where id = v_job.user_message_id
      and owner_id = v_owner and sport_id = p_sport_id and role = 'user'
      and analysis_job_id = v_job.id for update;
    if not found or v_user.content is distinct from p_raw_text then
      raise exception 'Idempotency key was already used for a different message' using errcode = '23505';
    end if;
    if v_replayed and (v_existing.user_message_id <> v_user.id
      or v_existing.resolved_attempt <> v_job.attempt
      or v_existing.resolved_attempt_id <> v_job.current_attempt_id) then
      raise exception 'Resolved attempt changed' using errcode = '23505';
    end if;
    if not v_replayed and v_job.provider_metadata ? 'resolution' then
      raise exception 'Job already has a resolution' using errcode = '23505';
    end if;
  end if;
  if v_replayed then
    select * into v_user from public.messages where id = v_existing.user_message_id and owner_id = v_owner;
    select * into v_assistant from public.messages where id = v_existing.assistant_message_id and owner_id = v_owner;
  else
    v_metadata := jsonb_build_object('type','entry_confirmation_ack','verified',false,
      'searched',false,'analysis_mode','none','raw_text',p_raw_text,'request_key',p_request_key,
      'origin_job_id',p_existing_job_id);
    if p_existing_job_id is null then
      insert into public.messages(owner_id,sport_id,role,content,metadata)
        values(v_owner,p_sport_id,'user',p_raw_text,v_metadata) returning * into v_user;
    else
      update public.messages set metadata = coalesce(metadata,'{}'::jsonb) || v_metadata
        where id = v_user.id and owner_id = v_owner returning * into v_user;
    end if;
    v_metadata := v_metadata || jsonb_build_object('user_message_id',v_user.id);
    insert into public.messages(owner_id,sport_id,role,content,metadata)
      values(v_owner,p_sport_id,'assistant',v_ack,v_metadata) returning * into v_assistant;
    insert into public.local_conversation_requests(owner_id,sport_id,request_key,raw_text,
      user_message_id,assistant_message_id,existing_job_id,resolved_attempt,resolved_attempt_id)
      values(v_owner,p_sport_id,p_request_key,p_raw_text,v_user.id,v_assistant.id,p_existing_job_id,
        case when p_existing_job_id is null then null else v_job.attempt end,
        case when p_existing_job_id is null then null else v_job.current_attempt_id end);
    if p_existing_job_id is not null then
      update public.analysis_jobs set dismissed_attempt = attempt,
        provider_metadata = coalesce(provider_metadata,'{}'::jsonb) || jsonb_build_object('resolution',
          jsonb_build_object('type','entry_confirmation_ack','messageId',v_assistant.id,
            'userMessageId',v_user.id,'resolvedAttempt',v_job.attempt,'resolvedAttemptId',v_job.current_attempt_id)),
        updated_at = clock_timestamp()
      where id = v_job.id and owner_id = v_owner and attempt = v_job.attempt
        and current_attempt_id = v_job.current_attempt_id and status = 'failed' returning * into v_job;
    end if;
  end if;
  return jsonb_build_object('replayed',v_replayed,'message',to_jsonb(v_user),
    'assistantMessage',to_jsonb(v_assistant),'acknowledgment',v_assistant.content,
    'job',case when p_existing_job_id is null then null else to_jsonb(v_job) end);
end $$;
revoke all on function public.guard_local_conversation_key() from public, anon, authenticated;
revoke all on function public.apply_entry_confirmation_ack(uuid,text,text,uuid) from public, anon;
grant execute on function public.apply_entry_confirmation_ack(uuid,text,text,uuid) to authenticated;
