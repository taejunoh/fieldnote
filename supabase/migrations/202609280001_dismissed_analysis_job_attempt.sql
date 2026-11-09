alter table public.analysis_jobs
  add column dismissed_attempt integer;

alter table public.analysis_jobs
  add constraint analysis_jobs_dismissed_attempt_check
  check (dismissed_attempt is null or dismissed_attempt > 0);
