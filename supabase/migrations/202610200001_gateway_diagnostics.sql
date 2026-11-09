-- Bounded, allowlisted diagnostics only. No prompts, bodies, headers or raw errors.
create function public.gateway_diagnostic_value_valid(v jsonb, rule jsonb)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare t text := jsonb_typeof(v); s text := v #>> '{}'; kind text := rule #>> '{}'; stamp timestamptz;
begin
  if v is null or t = 'null' then return false; end if;
  if jsonb_typeof(rule) = 'array' then return t = 'string' and rule ? s; end if;
  if kind = 'boolean' then return t = 'boolean'; end if;
  if kind in ('version','sequence','ordinal','uint','http','ws') then
    if t <> 'number' or s !~ '^[0-9]+$' then return false; end if;
    return case kind when 'version' then s::numeric = 1
      when 'sequence' then s::numeric between 1 and 16 when 'ordinal' then s::numeric between 1 and 2
      when 'uint' then s::numeric between 0 and 2147483647
      when 'http' then s::numeric between 100 and 599 when 'ws' then s::numeric between 1000 and 4999 end;
  end if;
  if t <> 'string' then return false; end if;
  if kind = 'uuid' then return s ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; end if;
  if kind = 'build' then return s = 'unknown' or s ~ '^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'; end if;
  if kind = 'request_token' then return s ~ '^[A-Za-z0-9_-]{1,128}$'; end if;
  if kind = 'response' then return s ~ '^[A-Za-z0-9_.:-]{1,128}$'; end if;
  if kind = 'fingerprint' then return s ~ '^[0-9a-f]{64}$'; end if;
  if kind = 'time' then
    if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then return false; end if;
    begin
      stamp := s::timestamptz;
      return to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = s;
    exception when others then return false; end;
  end if;
  return false;
end $$;

create function public.gateway_diagnostics_valid(d jsonb, job_id uuid, attempt_id uuid, seq integer)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  root_rules jsonb := '{"schema_version":"version","sequence":"sequence","job_id":"uuid","attempt_id":"uuid","phase":["transport_started","transport_ended","retry_planned","finished"],"updated_at":"time","worker_build_id":"build","worker_instance_id":"uuid","transports":"transports"}'::jsonb;
  transport_rules jsonb := '{"transport_attempt":"ordinal","request_id":"uuid","started_at":"time","gateway_request_id":"uuid","upstream_request_id":"request_token","upstream_response_id":"response","gateway_build_id":"build","ended_at":"time","last_event_at":"time","last_heartbeat_at":"time","elapsed_ms":"uint","last_event_age_ms":"uint","event_count":"uint","gateway_http_status":"http","upstream_http_status":"http","websocket_close_code":"ws","close_frame_received":"boolean","websocket_message_too_big":"boolean","websocket_protocol_error":"boolean","heartbeat_outcome":["owned","lost","check_failed"],"upstream_http_protocol":["HTTP/1.1","HTTP/2.0"],"upstream_transport":["http","ws"],"stage":["worker_gateway_fetch","worker_gateway_read","upstream_dial","upstream_create_write","upstream_read","json_decode","downstream_write","worker_control","terminal"],"upstream_terminal_status":["completed","incomplete","failed","cancelled","interrupted"],"downstream_delivery_outcome":["completed","write_failed","cancelled","unknown"],"error_origin":["worker_gateway","gateway_upstream","gateway_downstream","worker_control"],"root_cause":["deadline_exceeded","context_cancelled","unexpected_eof","connection_reset","connection_closed","connection_refused","dns_error","tls_error","http_rejected","websocket_close","message_too_big","protocol_error","json_error","scanner_token_too_long","unknown"],"close_reason_code":["empty","normal_shutdown","server_restart","overloaded","unrecognized"],"cancellation_origin":["worker_deadline","gateway_deadline","lease_lost","downstream_disconnect","shutdown","unknown"],"retry_decision":["retry","stop"],"retry_reason":["eligible_transport","attempt_limit","excluded_error","deadline","lease_lost","ownership_check_failed","cancelled"],"last_event_type":["response.created","response.in_progress","response.completed","response.incomplete","response.failed","response.cancelled","response.output_item.added","response.output_item.done","response.output_text.delta","response.output_text.done","response.content_part.added","response.content_part.done","response.refusal.delta","response.refusal.done","response.function_call_arguments.delta","response.function_call_arguments.done","response.reasoning_summary_text.delta","response.reasoning_summary_text.done","response.web_search_call.in_progress","response.web_search_call.searching","response.web_search_call.completed","error","other"],"safe_message_code":["deadline_exceeded","context_cancelled","unexpected_eof","connection_reset","connection_closed","connection_refused","dns_error","tls_error","http_rejected","websocket_close","message_too_big","protocol_error","json_error","scanner_token_too_long","unknown"],"error_fingerprint":"fingerprint","cause_chain":"causes"}'::jsonb;
  cause_rules jsonb := '{"type":["eof","context","syscall","net","dns","tls","json","websocket","scanner","undici","http","unknown"],"code":["EOF","UNEXPECTED_EOF","ECONNRESET","ECONNREFUSED","EPIPE","ETIMEDOUT","ECONNABORTED","ENOTFOUND","EAI_AGAIN","ERR_TLS_CERT_ALTNAME_INVALID","CERT_HAS_EXPIRED","DEPTH_ZERO_SELF_SIGNED_CERT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET","UND_ERR_ABORTED","context_cancelled","deadline_exceeded","scanner_token_too_long","upstream_timeout","upstream_transport_error","upstream_eof","server_error","rate_limit_exceeded","invalid_prompt","cancelled","upstream_error","max_output_tokens","content_filter","ERR_CANCELED","UND_ERR_RESPONSE_STATUS_CODE","ABORT_ERR","HTTP_REJECTED","WS_CLOSE","WS_PROTOCOL","WS_MESSAGE_TOO_BIG","JSON_SYNTAX","JSON_TYPE","SCANNER_TOO_LONG","DEADLINE_EXCEEDED","CONTEXT_CANCELED","UNKNOWN","usage_limit_reached","invalid_request_error","insufficient_quota","context_length_exceeded","model_not_found"]}'::jsonb;
  k text; v jsonb; tr jsonb; c jsonb; ordinals integer[] := '{}'; ordinal integer;
begin
  if d is null or jsonb_typeof(d) <> 'object' or octet_length(d::text) > 16384
    or seq is null or seq not between 1 and 16 or job_id is null or attempt_id is null then return false; end if;
  if not d ?& array['schema_version','sequence','job_id','attempt_id','phase','updated_at','worker_build_id','worker_instance_id','transports'] then return false; end if;
  for k,v in select * from jsonb_each(d) loop
    if not root_rules ? k then return false; end if;
    if k <> 'transports' and not public.gateway_diagnostic_value_valid(v,root_rules->k) then return false; end if;
  end loop;
  if (d->>'job_id')::uuid <> job_id or (d->>'attempt_id')::uuid <> attempt_id or (d->>'sequence')::integer <> seq then return false; end if;
  if jsonb_typeof(d->'transports') <> 'array' or jsonb_array_length(d->'transports') > 2 then return false; end if;
  for tr in select * from jsonb_array_elements(d->'transports') loop
    if jsonb_typeof(tr) <> 'object' or not tr ?& array['transport_attempt','request_id','started_at'] then return false; end if;
    for k,v in select * from jsonb_each(tr) loop
      if not transport_rules ? k then return false; end if;
      if k = 'cause_chain' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 4 then return false; end if;
        for c in select * from jsonb_array_elements(v) loop
          if jsonb_typeof(c) <> 'object' or not c ? 'type' or (c - array['type','code']) <> '{}'::jsonb then return false; end if;
          if not public.gateway_diagnostic_value_valid(c->'type',cause_rules->'type') then return false; end if;
          if c ? 'code' and not public.gateway_diagnostic_value_valid(c->'code',cause_rules->'code') then return false; end if;
        end loop;
      elsif not public.gateway_diagnostic_value_valid(v,transport_rules->k) then return false;
      end if;
    end loop;
    ordinal := (tr->>'transport_attempt')::integer;
    if ordinal <> coalesce(array_length(ordinals,1),0) + 1 then return false; end if;
    ordinals := array_append(ordinals,ordinal);
  end loop;
  return true;
end $$;

create function public.record_gateway_diagnostics(
  p_job_id uuid, p_attempt_id uuid, p_worker_id text, p_sequence integer, p_diagnostics jsonb
) returns text language plpgsql security invoker set search_path = public as $$
declare j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; stamp timestamptz; old_d jsonb; old_seq integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if nullif(btrim(p_worker_id),'') is null or not public.gateway_diagnostics_valid(p_diagnostics,p_job_id,p_attempt_id,p_sequence) then
    raise exception 'Invalid gateway diagnostics' using errcode = '22023';
  end if;
  select * into j from public.analysis_jobs where id=p_job_id for update;
  if not found then return 'fenced'; end if;
  select * into a from public.analysis_attempts where id=p_attempt_id and job_id=p_job_id for update;
  stamp := clock_timestamp(); -- Ownership must remain live after waiting for both row locks.
  if not found or j.provider <> 'openllms' or j.status <> 'running'
    or j.current_attempt_id is distinct from p_attempt_id or j.lease_owner is distinct from p_worker_id
    or j.lease_expires_at is null or j.lease_expires_at <= stamp
    or a.status <> 'running' or a.worker_id is distinct from p_worker_id then return 'fenced'; end if;
  old_d := a.provider_metadata->'diagnostics';
  if old_d is not null then
    old_seq := (old_d->>'sequence')::integer;
    if p_sequence < old_seq then return 'stale'; end if;
    if p_sequence = old_seq then
      if old_d = p_diagnostics and j.provider_metadata->'diagnostics' = p_diagnostics then return 'unchanged'; end if;
      raise exception 'Conflicting gateway diagnostics sequence' using errcode = '22023';
    end if;
  end if;
  update public.analysis_jobs set provider_metadata=jsonb_set(provider_metadata,'{diagnostics}',p_diagnostics) where id=p_job_id;
  update public.analysis_attempts set provider_metadata=jsonb_set(provider_metadata,'{diagnostics}',p_diagnostics) where id=p_attempt_id;
  return 'applied';
end $$;

-- Existing finalizers replace metadata. Retain the last checkpoint on terminal transitions.
-- Row locks already held by those RPCs serialize this against checkpoint writes.
-- Fresh attempts/retries do not inherit old diagnostics.
create function public.retain_gateway_diagnostics()
returns trigger language plpgsql security invoker set search_path = public as $$
declare old_d jsonb := old.provider_metadata->'diagnostics'; new_d jsonb := new.provider_metadata->'diagnostics'; jid uuid; aid uuid;
begin
  if tg_table_name = 'analysis_jobs' then jid := old.id; aid := old.current_attempt_id;
  else jid := old.job_id; aid := old.id; end if;
  if new_d is not null then
    if not public.gateway_diagnostic_value_valid(new_d->'sequence','"sequence"'::jsonb) then
      raise exception 'Invalid terminal gateway diagnostics' using errcode = '22023';
    end if;
    if not public.gateway_diagnostics_valid(new_d,jid,aid,(new_d->>'sequence')::integer) then
      raise exception 'Invalid terminal gateway diagnostics' using errcode = '22023';
    end if;
  end if;
  if old_d is null then return new; end if;
  if new_d is null then
    new.provider_metadata := new.provider_metadata || jsonb_build_object('diagnostics',old_d);
  elsif (new_d->>'sequence')::integer < (old_d->>'sequence')::integer then
    new.provider_metadata := new.provider_metadata || jsonb_build_object('diagnostics',old_d);
  end if;
  return new;
end $$;
create trigger analysis_jobs_retain_gateway_diagnostics before update on public.analysis_jobs
for each row when (old.provider='openllms' and old.status='running' and new.status<>'running'
  and new.current_attempt_id is not distinct from old.current_attempt_id)
execute function public.retain_gateway_diagnostics();
create trigger analysis_attempts_retain_gateway_diagnostics before update on public.analysis_attempts
for each row when (old.status='running' and new.status<>'running')
execute function public.retain_gateway_diagnostics();

revoke all on function public.gateway_diagnostic_value_valid(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.gateway_diagnostics_valid(jsonb,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.retain_gateway_diagnostics() from public,anon,authenticated;
revoke all on function public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.gateway_diagnostic_value_valid(jsonb,jsonb) to service_role;
grant execute on function public.gateway_diagnostics_valid(jsonb,uuid,uuid,integer) to service_role;
grant execute on function public.record_gateway_diagnostics(uuid,uuid,text,integer,jsonb) to service_role;
