-- Attach policy provenance at every terminal transition, including worker death/lease expiry.
-- Use the immutable current attempt input rather than looking up a newly adopted policy.
-- Queue/lease/finalizer functions and their existing locking, grants and fencing stay intact.
create function public.capture_attempt_common_policy_audit()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.provider_metadata := new.provider_metadata || jsonb_build_object(
    'common_policy', coalesce(
      new.input_snapshot->'common_policy',
      -- A failed snapshot save can still report the policy already loaded in memory.
      -- Expiry leaves metadata unchanged and must not reuse an earlier/stale reference.
      case when new.provider_metadata is distinct from old.provider_metadata
        then new.provider_metadata->'common_policy' end,
      'null'::jsonb
    )
  );
  return new;
end $$;

create trigger analysis_attempts_common_policy_audit
  before update on public.analysis_attempts
  for each row when (old.status = 'running' and new.status <> 'running')
  execute function public.capture_attempt_common_policy_audit();

create function public.capture_job_common_policy_audit()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_policy jsonb;
begin
  select a.input_snapshot->'common_policy' into v_policy
    from public.analysis_attempts a
    where a.id = old.current_attempt_id and a.job_id = old.id and a.owner_id = old.owner_id;
  new.provider_metadata := new.provider_metadata || jsonb_build_object(
    'common_policy', coalesce(
      v_policy,
      case when new.provider_metadata is distinct from old.provider_metadata
        then new.provider_metadata->'common_policy' end,
      'null'::jsonb
    )
  );
  return new;
end $$;

create trigger analysis_jobs_common_policy_audit
  before update on public.analysis_jobs
  for each row when (old.provider = 'openllms' and old.status = 'running'
    and new.status in ('completed','failed','interrupted','waiting_quota','relogin_required'))
  execute function public.capture_job_common_policy_audit();

revoke all on function public.capture_attempt_common_policy_audit() from public, anon, authenticated;
revoke all on function public.capture_job_common_policy_audit() from public, anon, authenticated;
