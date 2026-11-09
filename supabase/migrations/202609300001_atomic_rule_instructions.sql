create table public.rule_instruction_heads (
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  command_key text not null check (command_key in (
    'default_recommended_units', 'preferred_sources', 'pre_game_hypothetical_assessment'
  )),
  criteria_version_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, sport_id, command_key),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (criteria_version_id, owner_id) references public.criteria_versions(id, owner_id)
);

create table public.rule_instruction_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport_id uuid not null,
  request_key text not null,
  command_key text not null check (command_key in (
    'default_recommended_units', 'preferred_sources', 'pre_game_hypothetical_assessment'
  )),
  raw_text text not null,
  user_message_id uuid not null,
  assistant_message_id uuid not null,
  criteria_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, sport_id, request_key),
  foreign key (sport_id, owner_id) references public.sports(id, owner_id) on delete cascade,
  foreign key (user_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (assistant_message_id, owner_id) references public.messages(id, owner_id),
  foreign key (criteria_version_id, owner_id) references public.criteria_versions(id, owner_id)
);

alter table public.rule_instruction_heads enable row level security;
alter table public.rule_instruction_requests enable row level security;

-- Analysis jobs and local rule requests share one namespace for idempotency keys.
-- Both sides take the same transaction lock before checking the other table.
create function public.lock_idempotency_key(p_owner_id uuid, p_sport_id uuid, p_key text)
returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':' || p_sport_id::text || ':' || p_key, 0
  ))
$$;

create function public.reject_rule_instruction_job_key_collision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_idempotency_key(new.owner_id, new.sport_id, new.request_key);
  if exists (
    select 1 from public.rule_instruction_requests r
    where r.owner_id = new.owner_id and r.sport_id = new.sport_id
      and r.request_key = new.request_key
  ) then
    raise exception 'Idempotency key is already used by a rule instruction' using errcode = '23505';
  end if;
  return new;
end $$;

create trigger analysis_jobs_rule_instruction_key_guard
before insert or update of owner_id, sport_id, request_key on public.analysis_jobs
for each row execute function public.reject_rule_instruction_job_key_collision();

create function public.advance_rule_instruction_head()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'adopted' and new.supersedes_id is not null then
    update public.rule_instruction_heads set
      criteria_version_id = new.id, updated_at = clock_timestamp()
    where owner_id = new.owner_id and sport_id = new.sport_id
      and criteria_version_id = new.supersedes_id;
  end if;
  return new;
end $$;

create trigger criteria_versions_advance_rule_instruction_head
after insert on public.criteria_versions
for each row execute function public.advance_rule_instruction_head();

create function public.apply_rule_instruction(
  p_sport_id uuid,
  p_request_key text,
  p_command_key text,
  p_raw_text text,
  p_title text,
  p_content text,
  p_acknowledgment text,
  p_existing_job_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_existing public.rule_instruction_requests%rowtype;
  v_request public.rule_instruction_requests%rowtype;
  v_job public.analysis_jobs%rowtype;
  v_user_message public.messages%rowtype;
  v_assistant_message public.messages%rowtype;
  v_rule public.criteria_versions%rowtype;
  v_previous_rule uuid;
  v_previous_status text;
  v_metadata jsonb;
begin
  if auth.role() <> 'authenticated' or v_owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_command_key not in (
      'default_recommended_units', 'preferred_sources', 'pre_game_hypothetical_assessment'
    ) or nullif(btrim(p_request_key), '') is null or nullif(btrim(p_raw_text), '') is null
    or nullif(btrim(p_title), '') is null or nullif(btrim(p_content), '') is null
    or nullif(btrim(p_acknowledgment), '') is null then
    raise exception 'Invalid rule instruction' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sports where id = p_sport_id and owner_id = v_owner) then
    raise exception 'Sport not found' using errcode = 'P0002';
  end if;

  perform public.lock_idempotency_key(v_owner, p_sport_id, p_request_key);
  select * into v_existing from public.rule_instruction_requests
    where owner_id = v_owner and sport_id = p_sport_id and request_key = p_request_key
    for update;

  if found then
    if v_existing.raw_text is distinct from p_raw_text
       or v_existing.command_key is distinct from p_command_key then
      raise exception 'Idempotency key was already used for a different message' using errcode = '23505';
    end if;
    if p_existing_job_id is not null then
      select * into v_job from public.analysis_jobs
        where id = p_existing_job_id and owner_id = v_owner and sport_id = p_sport_id
        for update;
      if not found or v_job.request_key <> p_request_key or v_job.kind <> 'message'
         or v_job.provider <> 'openllms' then
        raise exception 'Retry job does not match this rule instruction';
      end if;
      if v_job.status not in ('failed','interrupted','waiting_quota','relogin_required') then
        raise exception 'Job is not retryable';
      end if;
      if v_job.status in ('failed','interrupted','waiting_quota','relogin_required') then
        update public.analysis_jobs set dismissed_attempt = attempt,
          provider_metadata = coalesce(provider_metadata, '{}'::jsonb) || jsonb_build_object(
            'resolution', jsonb_build_object(
              'type', 'rule_instruction', 'commandKey', p_command_key,
              'messageId', v_existing.assistant_message_id,
              'resolvedAttempt', attempt
            )
          ), updated_at = clock_timestamp()
        where id = v_job.id and owner_id = v_owner and attempt = v_job.attempt
        returning * into v_job;
      end if;
    end if;
    update public.messages set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'type', 'rule_instruction', 'command_key', p_command_key
    ) where id = v_existing.user_message_id returning * into v_user_message;
    select * into v_assistant_message from public.messages where id = v_existing.assistant_message_id;
    select * into v_rule from public.criteria_versions where id = v_existing.criteria_version_id;
    return jsonb_build_object(
      'replayed', true, 'message', to_jsonb(v_user_message),
      'assistantMessage', to_jsonb(v_assistant_message), 'rule', to_jsonb(v_rule),
      'job', case when p_existing_job_id is null then null else to_jsonb(v_job) end
    );
  end if;

  if p_existing_job_id is null then
    perform public.lock_idempotency_key(v_owner, p_sport_id, p_request_key);
    if exists (select 1 from public.analysis_jobs j
      where j.owner_id = v_owner and j.sport_id = p_sport_id and j.request_key = p_request_key) then
      raise exception 'Idempotency key is already used by an analysis job' using errcode = '23505';
    end if;
  else
    select * into v_job from public.analysis_jobs
      where id = p_existing_job_id and owner_id = v_owner and sport_id = p_sport_id
      for update;
    if not found or v_job.request_key <> p_request_key or v_job.kind <> 'message'
       or v_job.provider <> 'openllms' or v_job.status not in
         ('failed','interrupted','waiting_quota','relogin_required') then
      raise exception 'Job is not retryable';
    end if;
    if v_job.user_message_id is null then raise exception 'Job has no user message'; end if;
    select * into v_user_message from public.messages
      where id = v_job.user_message_id and owner_id = v_owner and sport_id = p_sport_id and role = 'user'
      for update;
    if not found or v_user_message.content is distinct from p_raw_text then
      raise exception 'Idempotency key was already used for a different message' using errcode = '23505';
    end if;
    update public.messages set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'type', 'rule_instruction', 'command_key', p_command_key
    ) where id = v_user_message.id returning * into v_user_message;
  end if;

  perform public.lock_idempotency_key(
    v_owner, p_sport_id, 'rule-command:' || p_command_key
  );
  select criteria_version_id into v_previous_rule from public.rule_instruction_heads
    where owner_id = v_owner and sport_id = p_sport_id and command_key = p_command_key;
  if v_previous_rule is not null then
    select status into v_previous_status from public.criteria_versions
      where id = v_previous_rule and owner_id = v_owner and sport_id = p_sport_id
      for update;
    if not found or v_previous_status <> 'adopted' then
      raise exception 'Rule instruction head changed; retry the request' using errcode = '23505';
    end if;
  end if;
  if v_previous_rule is not null then
    update public.criteria_versions set status = 'superseded'
      where id = v_previous_rule and owner_id = v_owner and sport_id = p_sport_id and status = 'adopted';
  end if;

  if p_existing_job_id is null then
    insert into public.messages(owner_id, sport_id, role, content, metadata)
      values(v_owner, p_sport_id, 'user', p_raw_text,
        jsonb_build_object('type', 'rule_instruction', 'command_key', p_command_key))
      returning * into v_user_message;
  end if;
  insert into public.criteria_versions(
    owner_id, sport_id, title, content, status, supersedes_id, source_message_id, source_ref
  ) values (
    v_owner, p_sport_id, p_title, p_content, 'adopted', v_previous_rule,
    v_user_message.id, 'rule-instruction:' || p_command_key
  )
    returning * into v_rule;
  insert into public.rule_instruction_heads(owner_id, sport_id, command_key, criteria_version_id)
    values(v_owner, p_sport_id, p_command_key, v_rule.id)
    on conflict (owner_id, sport_id, command_key) do update
      set criteria_version_id = excluded.criteria_version_id, updated_at = clock_timestamp();

  v_metadata := jsonb_build_object('type', 'rule_instruction', 'command_key', p_command_key);
  insert into public.messages(owner_id, sport_id, role, content, metadata)
    values(v_owner, p_sport_id, 'assistant', p_acknowledgment, v_metadata)
    returning * into v_assistant_message;
  insert into public.rule_instruction_requests(
    owner_id, sport_id, request_key, command_key, raw_text,
    user_message_id, assistant_message_id, criteria_version_id
  ) values (
    v_owner, p_sport_id, p_request_key, p_command_key, p_raw_text,
    v_user_message.id, v_assistant_message.id, v_rule.id
  ) returning * into v_request;

  if p_existing_job_id is not null then
    update public.analysis_jobs set dismissed_attempt = attempt,
      provider_metadata = coalesce(provider_metadata, '{}'::jsonb) || jsonb_build_object(
        'resolution', jsonb_build_object(
          'type', 'rule_instruction', 'commandKey', p_command_key,
          'messageId', v_assistant_message.id, 'resolvedAttempt', attempt
        )
      ), updated_at = clock_timestamp()
    where id = p_existing_job_id and owner_id = v_owner and attempt = v_job.attempt
    returning * into v_job;
  end if;

  return jsonb_build_object(
    'replayed', false, 'message', to_jsonb(v_user_message),
    'assistantMessage', to_jsonb(v_assistant_message), 'rule', to_jsonb(v_rule),
    'job', case when p_existing_job_id is null then null else to_jsonb(v_job) end
  );
end $$;

revoke all on function public.lock_idempotency_key(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reject_rule_instruction_job_key_collision() from public, anon, authenticated;
revoke all on function public.apply_rule_instruction(uuid,text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.apply_rule_instruction(uuid,text,text,text,text,text,text,uuid) to authenticated;
