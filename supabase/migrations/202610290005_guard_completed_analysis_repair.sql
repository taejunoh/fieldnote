-- Atomic preservation wrapper around the existing saved-response native repair.
-- Uses the caller's legitimate service-role JWT; never changes request claims or triggers.
-- The legacy RPC remains responsible for exact CAS, original raw/source admission,
-- item identity, source membership, and repeat/collision checks. This wrapper adds
-- a stricter promise: native/provenance repair cannot revise saved evaluation,
-- coverage, generation columns, or bets/notes/criteria. Any drift rolls back the inner RPC.
create function public.repair_completed_analysis_guarded(
 p_job_id uuid,p_attempt_id uuid,p_message_id uuid,
 p_expected_job_metadata jsonb,p_expected_attempt_metadata jsonb,
 p_expected_message_metadata jsonb,p_expected_input_snapshot jsonb,p_repair jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; m public.messages%rowtype;
 j_after public.analysis_jobs%rowtype; a_after public.analysis_attempts%rowtype; m_after public.messages%rowtype;
 protected_financial_before jsonb; protected_financial_after jsonb; response jsonb;
 -- Confirmed against the existing legacy repair's exact patch/removal/audit list.
 -- coverage/coverage_report deliberately stay protected even though legacy can repair them.
 allowed_metadata_fields text[]:=array['analysis_record','extraction_status','extraction_failure',
  'recommendations_persisted','repair_citation_supplements','analysis_record_provenance',
  'repair_heading_corrections','completed_analysis_repairs'];
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 select * into j from public.analysis_jobs where id=p_job_id for update;
 if not found or j.provider<>'openllms' or j.status<>'completed' or j.result_type='conversation'
  or j.current_attempt_id is distinct from p_attempt_id or j.result_message_id is distinct from p_message_id
  then raise exception 'Stale completed analysis link' using errcode='55000';end if;
 select * into a from public.analysis_attempts where id=p_attempt_id for update;
 if not found or a.job_id is distinct from j.id or a.owner_id is distinct from j.owner_id or a.status<>'completed'
  then raise exception 'Invalid completed attempt link' using errcode='55000';end if;
 select * into m from public.messages where id=p_message_id for update;
 if not found or m.role<>'assistant' or m.analysis_job_id is distinct from j.id
  or m.owner_id is distinct from j.owner_id or m.sport_id is distinct from j.sport_id
  then raise exception 'Invalid completed message link' using errcode='55000';end if;
 -- Snapshot entire owner-scoped protected tables; equality includes all columns and row counts.
 select jsonb_build_object(
  'bets',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.bets x where x.owner_id=j.owner_id),'[]'::jsonb),
  'notes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.mistake_notes x where x.owner_id=j.owner_id),'[]'::jsonb),
  'criteria',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.criteria_versions x where x.owner_id=j.owner_id),'[]'::jsonb)
 ) into protected_financial_before;
 -- Static dispatch only. Caller auth.role() naturally remains service_role inside legacy code.
 response:=public.repair_completed_analysis(p_job_id,p_attempt_id,p_message_id,
  p_expected_job_metadata,p_expected_attempt_metadata,p_expected_message_metadata,p_expected_input_snapshot,p_repair);
 select * into j_after from public.analysis_jobs where id=j.id;
 if not found then raise exception 'Native repair deleted job' using errcode='22023';end if;
 select * into a_after from public.analysis_attempts where id=a.id;
 if not found then raise exception 'Native repair deleted attempt' using errcode='22023';end if;
 select * into m_after from public.messages where id=m.id;
 if not found then raise exception 'Native repair deleted message' using errcode='22023';end if;
 if (to_jsonb(j)-'provider_metadata') is distinct from (to_jsonb(j_after)-'provider_metadata')
  or (to_jsonb(a)-'provider_metadata') is distinct from (to_jsonb(a_after)-'provider_metadata')
  or (to_jsonb(m)-'metadata') is distinct from (to_jsonb(m_after)-'metadata')
  then raise exception 'Native repair changed protected row columns or timestamps' using errcode='22023';end if;
 -- Protects original_model_response, sources, checked_at, coverage, evaluation_report,
 -- evaluation_validation, evaluation_quarantined_markets, evaluation_presentation,
 -- input provenance and every unknown/new metadata field by default, on ALL three rows.
 if (j.provider_metadata-allowed_metadata_fields) is distinct from (j_after.provider_metadata-allowed_metadata_fields)
  or (a.provider_metadata-allowed_metadata_fields) is distinct from (a_after.provider_metadata-allowed_metadata_fields)
  or (m.metadata-allowed_metadata_fields) is distinct from (m_after.metadata-allowed_metadata_fields)
  then raise exception 'Native repair changed protected evaluation, source, or coverage metadata' using errcode='22023';end if;
 select jsonb_build_object(
  'bets',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.bets x where x.owner_id=j.owner_id),'[]'::jsonb),
  'notes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.mistake_notes x where x.owner_id=j.owner_id),'[]'::jsonb),
  'criteria',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.criteria_versions x where x.owner_id=j.owner_id),'[]'::jsonb)
 ) into protected_financial_after;
 if protected_financial_before is distinct from protected_financial_after then
  raise exception 'Native repair changed protected bets, notes, or criteria' using errcode='22023';end if;
 return response;
end $$;
revoke all on function public.repair_completed_analysis_guarded(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.repair_completed_analysis_guarded(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
