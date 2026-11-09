-- Owner-global policy revisions; historical sport criteria remain untouched.
create table public.common_policy_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) <= 200 and btrim(title) <> ''),
  version_date date not null check (version_date between date '0001-01-01' and date '9999-12-31'),
  content text not null check (octet_length(content) <= 131072 and content ~ '[^[:space:]]'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('adopted', 'proposed', 'superseded')),
  supersedes_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, owner_id),
  foreign key (supersedes_id, owner_id) references public.common_policy_versions(id, owner_id)
);
create unique index common_policy_one_adopted_per_owner
  on public.common_policy_versions(owner_id) where status = 'adopted';
create index common_policy_owner_history on public.common_policy_versions(owner_id, created_at desc);
alter table public.common_policy_versions enable row level security;
create policy common_policy_owner_select on public.common_policy_versions
  for select to authenticated using (owner_id = auth.uid());
revoke all on public.common_policy_versions from public, anon, authenticated, service_role;
grant select on public.common_policy_versions to authenticated, service_role;

-- Content and provenance never change. Only adoption can retire the current head.
create function public.guard_common_policy_immutability() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or not (old.status = 'adopted' and new.status = 'superseded') then
    raise exception 'Common policy revisions are immutable' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger common_policy_immutable before update on public.common_policy_versions
  for each row execute function public.guard_common_policy_immutability();
revoke all on function public.guard_common_policy_immutability() from public, anon, authenticated, service_role;

create function public.adopt_common_policy(
  p_title text,
  p_version_date date,
  p_content text,
  p_expected_version_id uuid
) returns public.common_policy_versions
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_owner uuid := auth.uid();
  v_current public.common_policy_versions%rowtype;
  v_new public.common_policy_versions%rowtype;
begin
  if v_owner is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_title is null or btrim(p_title) = '' or length(p_title) > 200
    or p_version_date is null or p_version_date < date '0001-01-01' or p_version_date > date '9999-12-31'
    or p_content is null or p_content !~ '[^[:space:]]' or octet_length(p_content) > 131072 then
    raise exception 'Invalid common policy' using errcode = '22023';
  end if;
  -- The owner row provides serialization even before the first revision exists.
  perform 1 from auth.users where id = v_owner for update;
  if not found then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_current from public.common_policy_versions
    where owner_id = v_owner and status = 'adopted' for update;
  if v_current.id is distinct from p_expected_version_id then
    raise exception 'Common policy revision conflict' using errcode = 'P0001';
  end if;
  if v_current.id is not null and v_current.title = p_title and v_current.version_date = p_version_date
    and v_current.content = p_content then return v_current; end if;
  if v_current.id is not null then
    update public.common_policy_versions set status = 'superseded'
      where id = v_current.id and owner_id = v_owner;
  end if;
  insert into public.common_policy_versions(owner_id,title,version_date,content,content_hash,status,supersedes_id)
    values(v_owner,p_title,p_version_date,p_content,
      encode(extensions.digest(convert_to(p_content, 'UTF8'), 'sha256'), 'hex'),'adopted',v_current.id)
    returning * into v_new;
  return v_new;
end $$;
revoke all on function public.adopt_common_policy(text,date,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.adopt_common_policy(text,date,text,uuid) to authenticated;
