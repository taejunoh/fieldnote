begin;

do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
    into v_definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'analysis_jobs'
    and c.conname = 'analysis_jobs_gateway_effort_check';

  if v_definition is null
    or position('medium' in v_definition) = 0
    or position(chr(39) || 'high' || chr(39) in v_definition) = 0
    or position('xhigh' in v_definition) = 0
    or position('openllms' in v_definition) = 0 then
    raise exception 'Gateway effort constraint must permit medium, high, and xhigh for OpenLLMs';
  end if;

  create temporary table effort_constraint_probe (
    provider text not null,
    effort text not null,
    check (provider <> 'openllms' or effort in ('medium','high','xhigh'))
  ) on commit drop;
  insert into effort_constraint_probe values
    ('openllms', 'medium'), ('openllms', 'high'), ('openllms', 'xhigh'), ('openai', 'legacy');

  begin
    insert into effort_constraint_probe values ('openllms', 'low');
    raise exception 'Unsupported OpenLLMs effort unexpectedly passed';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
