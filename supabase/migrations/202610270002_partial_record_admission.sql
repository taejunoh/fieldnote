-- Additive, service-only partial admission. Existing finalizer/recovery contracts
-- and source allowlists remain unchanged. No new sources or judgments are made.
create function public.derive_partial_analysis_record(
 p_raw text, p_sport text, p_sources jsonb, p_checked timestamptz, p_adopted boolean
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 -- Exact ECMAScript String.trim whitespace set. BMP-only record text below
 -- makes PostgreSQL character lengths equal the runtime UTF-16 length limits.
 trim_chars text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
 original jsonb; normalized jsonb; accepted jsonb; admission jsonb;
 e jsonb; r jsonb; linked jsonb; item record; body text; old_key text; new_key text; url text; host text; port text; status text; code text;
 keys jsonb := '{}'; raw_keys jsonb := '{}'; items jsonb := '{}'; rejected_keys jsonb := '{}';
 rejected_events jsonb := '[]'; rejected_recs jsonb := '[]'; accepted_keys jsonb := '[]'; accepted_items jsonb := '[]';
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_checked is null or p_adopted is null or p_sport not in ('mlb','nfl','cfb','soccer','tennis','wnba','nhl')
  or jsonb_typeof(p_sources) is distinct from 'array' or nullif(btrim(p_raw,trim_chars),'') is null
  or array_length(regexp_split_to_array(p_raw,'```analysis-record'),1)<>2 then raise exception 'Invalid extraction envelope' using errcode='22023'; end if;
 original := substring(p_raw from '```analysis-record[[:space:]]*\n([\s\S]*?)\n```[[:space:]]*$')::jsonb;
 body := regexp_replace(split_part(p_raw,'```analysis-record',1),'```analysis-coverage[^\n]*\n[\s\S]*?\n```','','g');
 if nullif(btrim(body,trim_chars),'') is null or original is null or jsonb_typeof(original) is distinct from 'object'
  or original->'version' is distinct from '1'::jsonb or original->>'sport' is distinct from p_sport
  or (original-array['version','sport','events','recommendations'])<>'{}'
  or jsonb_typeof(original->'events') is distinct from 'array' or jsonb_typeof(original->'recommendations') is distinct from 'array'
  or jsonb_array_length(original->'events')>20 or jsonb_array_length(original->'recommendations')>20 then raise exception 'Invalid saved record schema' using errcode='22023'; end if;
 -- This historical recovery supports BMP record strings only. Astral text is
 -- rejected atomically, including in source-rejected rows, rather than using
 -- PostgreSQL codepoint lengths where runtime Zod counts UTF-16 code units.
 -- The full original response/prose is not restricted or rewritten.
 if original::text ~ ('['||chr(65536)||'-'||chr(1114111)||']') then raise exception 'Unsupported non-BMP record string' using errcode='22023'; end if;
 normalized := jsonb_build_object('version',1,'sport',p_sport,'events','[]'::jsonb,'recommendations','[]'::jsonb);
 -- All structural, identity, timing and unit errors remain atomic, including in
 -- rows that will later fail source admission. Never hide a bad BET by filtering.
 for e in select value from jsonb_array_elements(original->'events') loop
  if jsonb_typeof(e) is distinct from 'object' or (e-array['event_key','label','starts_at','source_url','analysis_status'])<>'{}'
   or not e ?& array['event_key','label','starts_at','source_url','analysis_status']
   or jsonb_typeof(e->'event_key') is distinct from 'string' or length(e->>'event_key')>160
   or jsonb_typeof(e->'label') is distinct from 'string' or length(btrim(e->>'label',trim_chars)) not between 1 and 200
   or jsonb_typeof(e->'source_url') is distinct from 'string' or length(e->>'source_url') not between 1 and 2000
   or e->>'source_url' !~ '^https?://[^[:space:]/?#]+([/?#]|$)' then raise exception 'Invalid saved event schema' using errcode='22023'; end if;
  old_key := e->>'event_key'; url := e->>'source_url';
  -- Fail closed outside a deliberately small WHATWG-valid URL subset. In
  -- particular, invalid ports/hosts must not become soft source rejections.
  -- IPv6, credentials, IDN/punycode, percent escapes, dot path segments and
  -- URL-escaped punctuation require a different reviewed recovery path.
  -- Reject these on every original row before filtering: otherwise WHATWG
  -- canonical collisions/hash failures could be hidden as source exclusions.
  -- Normal runtime URL parsing remains unchanged.
  if url !~ '^https?://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(:[0-9]{1,5})?([/?#][A-Za-z0-9._~!$&()*+,;=:@/?#-]*)?$'
   or strpos(url,chr(92))>0 then raise exception 'Unsupported or invalid source URL' using errcode='22023'; end if;
  host := substring(url from '^https?://([^/:?#]+)');
  port := substring(url from '^https?://[^/:?#]+:([0-9]+)');
  if length(host)>253 or lower(host) ~ '(^|\.)xn--' or (port is not null and (port::integer>65535 or port ~ '^0[0-9]')) then raise exception 'Invalid source URL authority' using errcode='22023'; end if;
  if split_part(split_part(regexp_replace(url,'^https?://[^/?#]+',''),'?',1),'#',1) ~ '(^|/)\.{1,2}(/|$)' then raise exception 'Unsupported URL dot path segment' using errcode='22023'; end if;
  -- PostgreSQL accepts space separators, 24:00, and other forms rejected by
  -- the runtime datetime schema. Validate the original string before casting.
  if e->'starts_at'<>'null' then
   if jsonb_typeof(e->'starts_at')<>'string' or e->>'starts_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then raise exception 'Invalid ISO event time' using errcode='22023'; end if;
   begin
    if to_char(left(e->>'starts_at',10)::date,'YYYY-MM-DD')<>left(e->>'starts_at',10) then raise exception 'Invalid calendar date' using errcode='22023'; end if;
    perform (e->>'starts_at')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid calendar event time' using errcode='22023'; end;
  end if;
  if old_key !~ ('^'||p_sport||':[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9][a-z0-9-]{1,39}@[a-z0-9][a-z0-9-]{1,39}:(id-[a-z0-9]{3,40}|src(-[a-f0-9]{32})?)$')
   or split_part(split_part(old_key,':',3),'@',1)=split_part(split_part(old_key,':',3),'@',2)
   or to_char(split_part(old_key,':',2)::date,'YYYY-MM-DD')<>split_part(old_key,':',2) or raw_keys ? old_key then raise exception 'Invalid or duplicate event key' using errcode='22023'; end if;
  -- Conservative WHATWG authority/default-port normalization. The submitted
  -- accepted record must match this server derivation exactly.
  url := regexp_replace(url,'^(https?://)([^/?#]+)',substring(url from '^(https?://)')||lower(substring(url from '^https?://([^/?#]+)')));
  url := regexp_replace(url,'^(https://[^/?#:]+):443([/?#]|$)','\1\2');
  url := regexp_replace(url,'^(http://[^/?#:]+):80([/?#]|$)','\1\2');
  if url ~ '^https?://[^/?#]+($|[?#])' then url := regexp_replace(url,'^(https?://[^/?#]+)(.*)$','\1/\2'); end if;
  new_key := old_key;
  if old_key ~ ':src(-[a-f0-9]{32})?$' then
   new_key := regexp_replace(old_key,':src(-[a-f0-9]{32})?$',':src-'||left(encode(extensions.digest(url,'sha256'),'hex'),32));
   if old_key !~ ':src$' and old_key<>new_key then raise exception 'Source event hash mismatch' using errcode='22023'; end if;
  end if;
  if keys ? new_key then raise exception 'Canonical event collision' using errcode='22023'; end if;
  status := e->>'analysis_status';
  if p_adopted then status := case status when 'GO' then 'BET' when 'EARLY GO' then 'BET' when 'LEAN' then 'WATCH' else status end; end if;
  if status is null or status not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')
   or (e->'starts_at'<>'null' and (jsonb_typeof(e->'starts_at')<>'string' or e->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'))
   or (status='BET' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz<=p_checked))
   or (not p_adopted and status='EVALUATION INCOMPLETE' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz>p_checked)) then raise exception 'Invalid event judgment/time' using errcode='22023'; end if;
  if e->>'starts_at' is not null then perform (e->>'starts_at')::timestamptz; end if;
  normalized := jsonb_set(normalized,'{events}',normalized->'events'||jsonb_build_array(e||jsonb_build_object('event_key',new_key,'source_url',url,'label',btrim(e->>'label',trim_chars),'analysis_status',status)));
  keys := keys||jsonb_build_object(new_key,true); raw_keys := raw_keys||jsonb_build_object(old_key,new_key);
 end loop;
 for r in select value from jsonb_array_elements(original->'recommendations') loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['item_key','event_key','market','selection','decision','suggested_units','price_gate','timing','direction_note'])<>'{}'
   or not r ?& array['item_key','event_key','market','selection','decision','suggested_units','price_gate']
   or jsonb_typeof(r->'item_key') is distinct from 'string' or r->>'item_key' !~ '^[a-z0-9][a-z0-9_-]{0,39}$' or items ? (r->>'item_key')
   or jsonb_typeof(r->'event_key') is distinct from 'string' or length(r->>'event_key')>160
   or jsonb_typeof(r->'market') is distinct from 'string' or length(btrim(r->>'market',trim_chars)) not between 1 and 120
   or jsonb_typeof(r->'selection') is distinct from 'string' or length(btrim(r->>'selection',trim_chars)) not between 1 and 120
   or (r->'price_gate'<>'null' and (jsonb_typeof(r->'price_gate')<>'string' or length(btrim(r->>'price_gate',trim_chars))>120))
   or (r->'suggested_units'<>'null' and (jsonb_typeof(r->'suggested_units')<>'number' or (r->>'suggested_units')::numeric not between 0 and 100)) then raise exception 'Invalid saved recommendation schema' using errcode='22023'; end if;
  new_key := coalesce(raw_keys->>(r->>'event_key'),r->>'event_key');
  select value into linked from jsonb_array_elements(normalized->'events') where value->>'event_key'=new_key;
  status := r->>'decision';
  if p_adopted then status := case status when 'GO' then 'BET' when 'EARLY GO' then 'BET' when 'LEAN' then 'WATCH' else status end; end if;
  if linked is null or status is null or status not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')
   or (status='BET' and (linked->>'starts_at' is null or (linked->>'starts_at')::timestamptz<=p_checked))
   or (not p_adopted and status='EVALUATION INCOMPLETE' and (linked->>'starts_at' is null or (linked->>'starts_at')::timestamptz>p_checked))
   or (p_adopted and status='BET' and coalesce((r->>'suggested_units')::numeric,-1) not in (0.25,0.5,1,2))
   or (p_adopted and status<>'BET' and coalesce((r->>'suggested_units')::numeric,0)<>0)
   or (r ? 'timing' and (not p_adopted or r->>'timing' is distinct from 'early' or status<>'BET'))
   or (r ? 'direction_note' and (not p_adopted or jsonb_typeof(r->'direction_note')<>'string' or length(btrim(r->>'direction_note',trim_chars)) not between 1 and 240)) then raise exception 'Invalid recommendation link/judgment/time/units' using errcode='22023'; end if;
  if p_adopted and r->>'decision'='EARLY GO' then r := r||'{"timing":"early"}'::jsonb; end if;
  if p_adopted and r->>'decision'='LEAN' then r := r||jsonb_build_object('direction_note',coalesce(nullif(btrim(r->>'direction_note',trim_chars),''),btrim(r->>'selection',trim_chars))); end if;
  if r ? 'direction_note' then r := r||jsonb_build_object('direction_note',btrim(r->>'direction_note',trim_chars)); end if;
  normalized := jsonb_set(normalized,'{recommendations}',normalized->'recommendations'||jsonb_build_array(r||jsonb_build_object('event_key',new_key,'decision',status,'market',btrim(r->>'market',trim_chars),'selection',btrim(r->>'selection',trim_chars),'price_gate',btrim(r->>'price_gate',trim_chars))));
  items := items||jsonb_build_object(r->>'item_key',true);
 end loop;
 accepted := jsonb_build_object('version',1,'sport',p_sport,'events','[]'::jsonb,'recommendations','[]'::jsonb);
 for item in select value,ordinality-1 as idx from jsonb_array_elements(normalized->'events') with ordinality loop
  e := item.value; r := original->'events'->item.idx::integer; code := null;
  if not exists(select 1 from jsonb_array_elements(p_sources) q where q->>'url'=e->>'source_url') then code := 'unverified_source';
  elsif r->>'event_key' ~ ':src(-[a-f0-9]{32})?$' then
   if not public.official_event_source_allowed(p_sport,e->>'source_url') then code := 'unofficial_source';
   elsif strpos(body,r->>'source_url')=0 and strpos(body,e->>'source_url')=0 then code := 'uncited_source'; end if;
  end if;
  if code is not null then
   rejected_keys := rejected_keys||jsonb_build_object(e->>'event_key',true);
   rejected_events := rejected_events||jsonb_build_array(jsonb_build_object('index',item.idx,'event_key',r->>'event_key','code',code,'path','events.'||item.idx||'.source_url'));
  else
   accepted := jsonb_set(accepted,'{events}',accepted->'events'||jsonb_build_array(e)); accepted_keys := accepted_keys||jsonb_build_array(e->>'event_key');
  end if;
 end loop;
 for item in select value,ordinality-1 as idx from jsonb_array_elements(normalized->'recommendations') with ordinality loop
  r := item.value; e := original->'recommendations'->item.idx::integer;
  if rejected_keys ? (r->>'event_key') then
   rejected_recs := rejected_recs||jsonb_build_array(jsonb_build_object('index',item.idx,'item_key',e->>'item_key','event_key',e->>'event_key','code','rejected_event_dependency','path','recommendations.'||item.idx||'.event_key'));
  else
   accepted := jsonb_set(accepted,'{recommendations}',accepted->'recommendations'||jsonb_build_array(r)); accepted_items := accepted_items||jsonb_build_array(r->>'item_key');
  end if;
 end loop;
 admission := jsonb_build_object('version',1,'raw_sha256',encode(extensions.digest(p_raw,'sha256'),'hex'),'input_event_count',jsonb_array_length(original->'events'),'input_recommendation_count',jsonb_array_length(original->'recommendations'),'accepted_event_keys',accepted_keys,'accepted_recommendation_item_keys',accepted_items,'rejected_events',rejected_events,'rejected_recommendations',rejected_recs);
 return jsonb_build_object('analysis_record',accepted,'record_admission',admission);
end $$;
revoke all on function public.derive_partial_analysis_record(text,text,jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.derive_partial_analysis_record(text,text,jsonb,timestamptz,boolean) to service_role;

create function public.repair_completed_analysis_partial(
 p_job_id uuid, p_attempt_id uuid, p_message_id uuid,
 p_expected_job_metadata jsonb, p_expected_attempt_metadata jsonb,
 p_expected_message_metadata jsonb, p_expected_input_snapshot jsonb, p_repair jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; m public.messages%rowtype;
 s text; raw text; raw_hash text; fingerprint text; checked timestamptz; adopted boolean;
 derived jsonb; rec jsonb; admission jsonb; patch jsonb; audit jsonb; prior jsonb; meta jsonb;
 e jsonb; r jsonb; ev uuid; events_map jsonb:='{}'; event_ids jsonb:='[]'; rec_ids jsonb:='[]'; rid uuid;
 previous_lock_timeout text;
 stored_events jsonb; stored_recs jsonb; changed_fields text[]:=array['analysis_record','extraction_status','recommendations_persisted','record_admission','analysis_record_provenance','completed_analysis_repairs'];
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 -- Serialize this short, service-only recovery with job INSERT/claim UPDATE.
 -- A row lock/owner-idle EXISTS alone cannot protect against a new job phantom.
 -- Bound lock acquisition; never wait indefinitely behind normal worker work.
 previous_lock_timeout:=current_setting('lock_timeout');
 perform set_config('lock_timeout','5s',true);
 lock table public.analysis_jobs in share row exclusive mode;
 select * into j from public.analysis_jobs where id=p_job_id for update;
 if not found or j.provider is distinct from 'openllms' or j.status is distinct from 'completed' or j.result_type='conversation'
  or j.current_attempt_id is distinct from p_attempt_id or j.result_message_id is distinct from p_message_id then raise exception 'Stale completed analysis link' using errcode='55000'; end if;
 select * into a from public.analysis_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or a.status is distinct from 'completed' or a.owner_id is distinct from j.owner_id or a.execution_started_at is null or a.finished_at is null then raise exception 'Invalid completed attempt' using errcode='55000'; end if;
 select * into m from public.messages where id=p_message_id for update;
 if not found or m.role is distinct from 'assistant' or m.owner_id is distinct from j.owner_id or m.sport_id is distinct from j.sport_id or m.analysis_job_id is distinct from j.id then raise exception 'Invalid completed result' using errcode='55000'; end if;
 if exists(select 1 from public.analysis_jobs where owner_id=j.owner_id and status in ('queued','running')) then raise exception 'Owner has active work' using errcode='55000'; end if;
 select slug into s from public.sports where id=j.sport_id and owner_id=j.owner_id;
 raw:=m.metadata->>'original_model_response'; checked:=(m.metadata->>'checked_at')::timestamptz;
 if nullif(btrim(raw),'') is null or checked is null or jsonb_typeof(m.metadata->'sources') is distinct from 'array'
  or jsonb_typeof(a.input_snapshot) is distinct from 'object' or nullif(a.input_snapshot->>'context','') is null
  or checked<a.execution_started_at or checked>a.finished_at or checked>m.created_at then raise exception 'Missing immutable provenance' using errcode='22023'; end if;
 for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
  if meta->>'original_model_response' is distinct from raw or meta->>'checked_at' is distinct from m.metadata->>'checked_at'
   or meta->'sources' is distinct from m.metadata->'sources' or meta->>'type' is distinct from 'analysis' or meta->>'result_type'='conversation'
   or meta->>'terminalStatus' is distinct from 'completed' or meta->'verified' is distinct from 'true'::jsonb or meta->'searched' is distinct from 'true'::jsonb
   or coalesce(meta#>'{input_snapshot,common_policy}','null') is distinct from coalesce(a.input_snapshot->'common_policy','null') then raise exception 'Immutable result provenance differs' using errcode='22023'; end if;
 end loop;
 if a.sources is distinct from m.metadata->'sources' or a.input_snapshot is distinct from p_expected_input_snapshot then raise exception 'Immutable attempt changed' using errcode='55000'; end if;
 raw_hash:=encode(extensions.digest(raw,'sha256'),'hex');
 if jsonb_typeof(p_repair) is distinct from 'object' or (p_repair-array['version','repair_key','raw_sha256','analysis_record','record_admission'])<>'{}'
  or p_repair->>'version' is distinct from 'source-admission-partial-v1' or coalesce(p_repair->>'repair_key','') !~ '^[a-zA-Z0-9:_-]{1,120}$'
  or p_repair->>'raw_sha256' is distinct from raw_hash then raise exception 'Invalid partial repair identity' using errcode='22023'; end if;
 fingerprint:=encode(extensions.digest(p_repair::text,'sha256'),'hex');
 select value into prior from jsonb_array_elements(coalesce(m.metadata->'completed_analysis_repairs','[]')) where value->>'repair_key'=p_repair->>'repair_key';
 if prior is null then
  if j.provider_metadata is distinct from p_expected_job_metadata or a.provider_metadata is distinct from p_expected_attempt_metadata or m.metadata is distinct from p_expected_message_metadata then raise exception 'Stale completed metadata' using errcode='55000'; end if;
  for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
   if meta->>'extraction_status' is distinct from 'incomplete' or meta ? 'analysis_record' or meta->'recommendations_persisted' is distinct from 'false'::jsonb
    or coalesce(meta->'completed_analysis_repairs','[]')<>'[]'::jsonb then raise exception 'Only previously empty failed extraction can be repaired' using errcode='22023'; end if;
  end loop;
 else
  if prior->>'version' is distinct from 'source-admission-partial-v1' or prior->>'request_sha256' is distinct from fingerprint or prior->>'raw_sha256' is distinct from raw_hash
   or not coalesce(j.provider_metadata->'completed_analysis_repairs','[]') @> jsonb_build_array(prior)
   or not coalesce(a.provider_metadata->'completed_analysis_repairs','[]') @> jsonb_build_array(prior) then raise exception 'Repair key conflict' using errcode='22023'; end if;
  if (j.provider_metadata-changed_fields) is distinct from (p_expected_job_metadata-changed_fields)
   or (a.provider_metadata-changed_fields) is distinct from (p_expected_attempt_metadata-changed_fields)
   or (m.metadata-changed_fields) is distinct from (p_expected_message_metadata-changed_fields) then raise exception 'Immutable metadata changed on replay' using errcode='55000'; end if;
 end if;
 adopted:=a.input_snapshot->'common_policy' is not null and a.input_snapshot->'common_policy'<>'null'::jsonb;
 derived:=public.derive_partial_analysis_record(raw,s,m.metadata->'sources',checked,adopted);
 rec:=derived->'analysis_record'; admission:=derived->'record_admission';
 if rec is distinct from p_repair->'analysis_record' or admission is distinct from p_repair->'record_admission'
  or jsonb_array_length(rec->'events')=0 or jsonb_array_length(admission->'rejected_events')=0 then raise exception 'Partial subset differs from server derivation' using errcode='22023'; end if;
 for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
  if meta#>>'{extraction_failure,code}' is distinct from admission#>>'{rejected_events,0,code}' or meta#>>'{extraction_failure,path}' is distinct from admission#>>'{rejected_events,0,path}' then raise exception 'Original failure does not match source rejection' using errcode='22023'; end if;
 end loop;
 patch:=jsonb_build_object('analysis_record',rec,'record_admission',admission,'extraction_status','partial','recommendations_persisted',jsonb_array_length(rec->'recommendations')>0,'analysis_record_provenance',jsonb_build_object('kind','saved_response_partial_repair','raw_sha256',raw_hash,'original_checked_at',m.metadata->>'checked_at'));
 if prior is not null then
  for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
   if exists(select 1 from jsonb_each(patch) q where meta->q.key is distinct from q.value) or meta->'completed_analysis_repairs' is distinct from jsonb_build_array(prior) then raise exception 'Partial metadata drift' using errcode='22023'; end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into stored_events from public.events t where id in(select value::text::uuid from jsonb_array_elements_text(prior->'inserted_event_ids'));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into stored_recs from public.recommendations t where analysis_job_id=j.id;
  if encode(extensions.digest(stored_events::text,'sha256'),'hex') is distinct from prior->>'inserted_events_sha256' or encode(extensions.digest(stored_recs::text,'sha256'),'hex') is distinct from prior->>'inserted_recommendations_sha256' then raise exception 'Partial repaired row drift' using errcode='22023'; end if;
  perform set_config('lock_timeout',previous_lock_timeout,true);
  return jsonb_build_object('status','already_repaired','message_id',m.id,'raw_sha256',raw_hash);
 end if;
 -- No upsert into existing judgments. A concurrent unique-key collision aborts
 -- the whole transaction instead of changing or attaching to another record.
 if exists(select 1 from public.recommendations where analysis_job_id=j.id) or exists(select 1 from public.events t where owner_id=j.owner_id and sport_id=j.sport_id and event_key in(select value->>'event_key' from jsonb_array_elements(rec->'events'))) then raise exception 'Existing record conflicts with partial repair' using errcode='55000'; end if;
 for e in select value from jsonb_array_elements(rec->'events') loop
  insert into public.events(owner_id,sport_id,event_key,label,starts_at,source_ref,analysis_status,updated_at) values(j.owner_id,j.sport_id,e->>'event_key',e->>'label',(e->>'starts_at')::timestamptz,e->>'source_url',e->>'analysis_status',m.created_at) returning id into ev;
  events_map:=events_map||jsonb_build_object(e->>'event_key',ev); event_ids:=event_ids||jsonb_build_array(ev);
 end loop;
 for r in select value from jsonb_array_elements(rec->'recommendations') loop
  select value into e from jsonb_array_elements(rec->'events') where value->>'event_key'=r->>'event_key';
  insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision,suggested_units,price_gate,analysis_job_id,recommendation_item_key,source_message_id,source_ref,created_at)
   values(j.owner_id,j.sport_id,(events_map->>(r->>'event_key'))::uuid,r->>'market',r->>'selection',r->>'decision',(r->>'suggested_units')::numeric,r->>'price_gate',j.id,r->>'item_key',m.id,e->>'source_url',m.created_at) returning id into rid;
  rec_ids:=rec_ids||jsonb_build_array(rid);
 end loop;
 select jsonb_agg(to_jsonb(t) order by t.id) into stored_events from public.events t where id in(select value::text::uuid from jsonb_array_elements_text(event_ids));
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into stored_recs from public.recommendations t where analysis_job_id=j.id;
 audit:=jsonb_build_object('version','source-admission-partial-v1','repair_key',p_repair->>'repair_key','repaired_at',clock_timestamp(),'original_checked_at',m.metadata->>'checked_at','raw_sha256',raw_hash,'request_sha256',fingerprint,'job_id',j.id,'attempt_id',a.id,'message_id',m.id,'record_event_count',jsonb_array_length(rec->'events'),'record_recommendation_count',jsonb_array_length(rec->'recommendations'),'record_admission',admission,'original_extraction_failure',m.metadata->'extraction_failure','inserted_event_ids',event_ids,'inserted_recommendation_ids',rec_ids,'inserted_events_sha256',encode(extensions.digest(stored_events::text,'sha256'),'hex'),'inserted_recommendations_sha256',encode(extensions.digest(stored_recs::text,'sha256'),'hex'));
 update public.messages set metadata=metadata||patch||jsonb_build_object('completed_analysis_repairs',jsonb_build_array(audit)) where id=m.id;
 update public.analysis_attempts set provider_metadata=provider_metadata||patch||jsonb_build_object('completed_analysis_repairs',jsonb_build_array(audit)) where id=a.id;
 update public.analysis_jobs set provider_metadata=provider_metadata||patch||jsonb_build_object('completed_analysis_repairs',jsonb_build_array(audit)) where id=j.id;
 perform set_config('lock_timeout',previous_lock_timeout,true);
 return jsonb_build_object('status','partially_repaired','message_id',m.id,'raw_sha256',raw_hash,'inserted_events',jsonb_array_length(rec->'events'),'inserted_recommendations',jsonb_array_length(rec->'recommendations'));
end $$;
revoke all on function public.repair_completed_analysis_partial(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.repair_completed_analysis_partial(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
