-- Run after 202609250001_atomic_criteria_versions.sql; this transaction leaves no fixture data.
begin;

insert into auth.users(id, email)
  values('00000000-0000-4000-8000-000000000091', 'criteria-fixture@example.invalid');
insert into public.sports(id, owner_id, slug) values
  ('00000000-0000-4000-8000-000000000092', '00000000-0000-4000-8000-000000000091', 'mlb'),
  ('00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000091', 'nfl');
insert into public.messages(id, owner_id, sport_id, role, content) values
  ('00000000-0000-4000-8000-000000000094', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092', 'user', 'MLB correction'),
  ('00000000-0000-4000-8000-000000000095', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000093', 'user', 'NFL correction'),
  ('00000000-0000-4000-8000-000000000096', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092', 'assistant', 'Assistant response');
insert into public.criteria_versions(id, owner_id, sport_id, title, content, status) values
  ('00000000-0000-4000-8000-000000000097', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092', 'Original', 'Old rule', 'adopted'),
  ('00000000-0000-4000-8000-000000000098', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092', 'Proposal', 'Draft rule', 'proposed');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000091', true);

do $$
declare
  v_sport uuid := '00000000-0000-4000-8000-000000000092';
  v_previous uuid := '00000000-0000-4000-8000-000000000097';
  v_rule public.criteria_versions%rowtype;
begin
  begin
    perform public.create_criteria_version(v_sport, 'Missing', 'Rule', 'adopted',
      '00000000-0000-4000-8000-000000000099');
    raise exception 'Missing predecessor was accepted';
  exception when others then
    if sqlerrm <> 'Previous rule not found' then raise; end if;
  end;

  begin
    perform public.create_criteria_version(v_sport, 'Draft correction', 'Rule', 'adopted',
      '00000000-0000-4000-8000-000000000098');
    raise exception 'Non-adopted predecessor was accepted';
  exception when others then
    if sqlerrm <> 'Previous rule is not adopted' then raise; end if;
  end;

  begin
    perform public.create_criteria_version(v_sport, 'Foreign source', 'Rule', 'adopted',
      v_previous, '00000000-0000-4000-8000-000000000095');
    raise exception 'Foreign-sport source message was accepted';
  exception when others then
    if sqlerrm <> 'Source user message not found' then raise; end if;
  end;

  begin
    perform public.create_criteria_version(v_sport, 'Assistant source', 'Rule', 'adopted',
      v_previous, '00000000-0000-4000-8000-000000000096');
    raise exception 'Assistant source message was accepted';
  exception when others then
    if sqlerrm <> 'Source user message not found' then raise; end if;
  end;

  if (select status from public.criteria_versions where id = v_previous) <> 'adopted' then
    raise exception 'Failed correction changed predecessor status';
  end if;

  v_rule := public.create_criteria_version(v_sport, 'Corrected', 'New rule', 'adopted',
    v_previous, '00000000-0000-4000-8000-000000000094');
  if v_rule.status <> 'adopted' or v_rule.supersedes_id <> v_previous
     or v_rule.source_message_id <> '00000000-0000-4000-8000-000000000094'
     or (select status from public.criteria_versions where id = v_previous) <> 'superseded' then
    raise exception 'Correction was not persisted atomically with its source';
  end if;

  begin
    perform public.create_criteria_version(v_sport, 'Stale correction', 'Rule', 'adopted', v_previous);
    raise exception 'Superseded predecessor was accepted';
  exception when others then
    if sqlerrm <> 'Previous rule is not adopted' then raise; end if;
  end;
end $$;

rollback;
