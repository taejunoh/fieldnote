-- Rollback-only verification of NBA slug registration and reviewable import.
begin;
do $fixture$
declare
  v_owner uuid := gen_random_uuid();
  v_hash text := encode(extensions.digest('NBA synthetic fixture', 'sha256'), 'hex');
  v_result jsonb;
begin
  insert into auth.users(id, email)
    values (v_owner, 'nba-fixture-' || v_owner || '@example.invalid');
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  insert into public.sports(owner_id, slug) values (v_owner, 'nba');

  v_result := public.commit_import(
    'nba',
    'nba-synthetic.md',
    v_hash,
    'NBA synthetic fixture; no private ledger content.',
    '{"rules":[],"events":[],"recommendations":[],"bets":[],"mistakeNotes":[],"summary":"Synthetic NBA import fixture"}'::jsonb
  );
  if v_result->>'importedDocumentId' is null then
    raise exception 'NBA import did not return its retained document';
  end if;
  if not exists (select 1 from public.sports where owner_id = v_owner and slug = 'nba') then
    raise exception 'NBA sport row was not saved';
  end if;
  if not exists (select 1 from public.imported_documents where owner_id = v_owner and filename = 'nba-synthetic.md') then
    raise exception 'NBA raw source document was not retained';
  end if;
end $fixture$;
rollback;
