create or replace function public.create_criteria_version(
  p_sport_id uuid,
  p_title text,
  p_content text,
  p_status text,
  p_supersedes_id uuid default null,
  p_source_message_id uuid default null
) returns public.criteria_versions
language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_previous_status text;
  v_rule public.criteria_versions%rowtype;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_title is null or btrim(p_title) = '' or p_content is null or btrim(p_content) = ''
     or p_status is null or p_status not in ('adopted', 'proposed') then
    raise exception 'Invalid rule' using errcode = '22023';
  end if;

  if p_supersedes_id is not null then
    select status into v_previous_status
      from public.criteria_versions
      where id = p_supersedes_id and owner_id = v_owner and sport_id = p_sport_id
      for update;
    if not found then
      raise exception 'Previous rule not found' using errcode = 'P0002';
    end if;
    if p_status = 'adopted' and v_previous_status <> 'adopted' then
      raise exception 'Previous rule is not adopted' using errcode = 'P0001';
    end if;
  end if;

  if p_source_message_id is not null and not exists (
    select 1 from public.messages
      where id = p_source_message_id and owner_id = v_owner
        and sport_id = p_sport_id and role = 'user'
  ) then
    raise exception 'Source user message not found' using errcode = 'P0002';
  end if;

  if p_supersedes_id is not null and p_status = 'adopted' then
    update public.criteria_versions set status = 'superseded'
      where id = p_supersedes_id and owner_id = v_owner and sport_id = p_sport_id;
  end if;

  insert into public.criteria_versions (
    owner_id, sport_id, title, content, status, supersedes_id, source_message_id
  ) values (
    v_owner, p_sport_id, btrim(p_title), btrim(p_content), p_status,
    p_supersedes_id, p_source_message_id
  ) returning * into v_rule;
  return v_rule;
end $$;

revoke all on function public.create_criteria_version(uuid,text,text,text,uuid,uuid) from public;
grant execute on function public.create_criteria_version(uuid,text,text,text,uuid,uuid) to authenticated;
