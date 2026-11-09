-- Rollback-only fixtures. Run after the common operating policy migration.
begin;
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000081', 'common-policy-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000082', 'common-policy-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
do $$
declare
 a public.common_policy_versions%rowtype;
 b public.common_policy_versions%rowtype;
 original text := E' \n한글\r\n ';
begin
 a := public.adopt_common_policy('Original', '2026-10-06', original, null);
 if a.content <> original or a.content_hash <> 'cce7ed417855816db21b3dc8766629b879db230c8d10696bc135a801c2fc37e1' then
  raise exception 'Exact content/hash not preserved';
 end if;
 b := public.adopt_common_policy('Original', '2026-10-06', original, a.id);
 if a.id <> b.id or (select count(*) from public.common_policy_versions) <> 1 then raise exception 'Duplicate revision'; end if;
 begin
  perform public.adopt_common_policy('Stale', '2026-10-06', 'Changed', null);
  raise exception 'Stale null head accepted';
 exception when sqlstate 'P0001' then if sqlerrm <> 'Common policy revision conflict' then raise; end if; end;
 b := public.adopt_common_policy('Changed', '2026-10-06', 'New body', a.id);
 if b.supersedes_id <> a.id or (select count(*) from public.common_policy_versions where status = 'adopted') <> 1
  or not exists(select 1 from public.common_policy_versions where id = a.id and content = original and status = 'superseded') then
  raise exception 'History not preserved'; end if;
 begin
  perform public.adopt_common_policy('Changed', '2026-10-06', 'New body', a.id);
  raise exception 'Stale revision accepted';
 exception when sqlstate 'P0001' then if sqlerrm <> 'Common policy revision conflict' then raise; end if; end;
 begin
  update public.common_policy_versions set content = 'Mutated' where id = a.id;
  raise exception 'Direct write accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000082', true);
 if exists(select 1 from public.common_policy_versions) then raise exception 'Other owner can read'; end if;
 begin
  perform public.adopt_common_policy('Cross owner', '2026-10-06', 'New body', b.id);
  raise exception 'Foreign owner predecessor accepted';
 exception when sqlstate 'P0001' then if sqlerrm <> 'Common policy revision conflict' then raise; end if; end;
 perform public.adopt_common_policy('Other', '2026-10-06', 'Owner B', null);
 perform set_config('request.jwt.claim.sub', '', true);
 begin
  perform public.adopt_common_policy('Anonymous', '2026-10-06', 'Body', null);
  raise exception 'Missing auth accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
 begin
  insert into public.common_policy_versions(owner_id,title,version_date,content,content_hash,status,supersedes_id)
   select '00000000-0000-4000-8000-000000000082', 'Foreign', '2026-10-06', 'Body', repeat('a',64), 'proposed', id
   from public.common_policy_versions where owner_id = '00000000-0000-4000-8000-000000000081' and status = 'adopted';
  raise exception 'Foreign-owner provenance FK absent';
 exception when foreign_key_violation then null; end;
 if has_table_privilege('authenticated', 'public.common_policy_versions', 'INSERT')
  or has_table_privilege('authenticated', 'public.common_policy_versions', 'UPDATE')
  or has_table_privilege('authenticated', 'public.common_policy_versions', 'DELETE')
  or has_table_privilege('anon', 'public.common_policy_versions', 'SELECT')
  or not has_table_privilege('service_role', 'public.common_policy_versions', 'SELECT') then raise exception 'Unsafe grants'; end if;
 begin
  update public.common_policy_versions set content = 'Admin mutation';
  raise exception 'Immutable body guard absent';
 exception when sqlstate '22023' then if sqlerrm <> 'Common policy revisions are immutable' then raise; end if; end;
end $$;
rollback;
