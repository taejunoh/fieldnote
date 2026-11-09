-- Add the requested Astra high default while retaining queued xhigh jobs.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'analysis_jobs'
      and c.conname = 'analysis_jobs_gateway_effort_check'
  ) then
    raise exception 'Expected analysis_jobs_gateway_effort_check before widening supported efforts';
  end if;
end;
$$;

alter table public.analysis_jobs drop constraint analysis_jobs_gateway_effort_check;
alter table public.analysis_jobs add constraint analysis_jobs_gateway_effort_check
  check (provider <> 'openllms' or effort in ('medium','high','xhigh'));
