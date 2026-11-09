-- New proof mechanism; v1 requests preserve their original fingerprint and audit shape.
create or replace function public.official_event_source_allowed(p_sport text, p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(case p_sport
    when 'mlb' then p_url ~* '^https://(mlb\.com|www\.mlb\.com)(:443)?([/?#]|$)'
    when 'nfl' then p_url ~* '^https://(nfl\.com|www\.nfl\.com)(:443)?([/?#]|$)'
    when 'cfb' then p_url ~* '^https://(ncaa\.com|www\.ncaa\.com|collegefootballplayoff\.com|www\.collegefootballplayoff\.com|dsuhornets\.com|www\.dsuhornets\.com|virginiasports\.com|www\.virginiasports\.com|uconnhuskies\.com|www\.uconnhuskies\.com|pennathletics\.com|www\.pennathletics\.com|tulsahurricane\.com|www\.tulsahurricane\.com|goairforcefalcons\.com|www\.goairforcefalcons\.com|gostanford\.com|www\.gostanford\.com)(:443)?([/?#]|$)'
    when 'soccer' then p_url ~* '^https://(fifa\.com|www\.fifa\.com|uefa\.com|www\.uefa\.com|mlssoccer\.com|www\.mlssoccer\.com|premierleague\.com|www\.premierleague\.com|dcunited\.com|www\.dcunited\.com|atlasfc\.com\.mx|www\.atlasfc\.com\.mx|clubpuebla\.com|www\.clubpuebla\.com|tuzos\.com\.mx|www\.tuzos\.com\.mx|clubsantos\.mx|www\.clubsantos\.mx|bundesliga\.com|www\.bundesliga\.com|laliga\.com|www\.laliga\.com|acmonza\.com|www\.acmonza\.com|ogcnice\.com|www\.ogcnice\.com|chicagostars\.com|www\.chicagostars\.com|reignfc\.com|www\.reignfc\.com|thorns\.com|www\.thorns\.com)(:443)?([/?#]|$)'
    when 'tennis' then p_url ~* '^https://(atptour\.com|www\.atptour\.com|wtatennis\.com|www\.wtatennis\.com|itftennis\.com|www\.itftennis\.com|wtafiles\.wtatennis\.com|japanopentennis\.com|www\.japanopentennis\.com|protennislive\.com|www\.protennislive\.com)(:443)?([/?#]|$)'
    when 'wnba' then p_url ~* '^https://(wnba\.com|www\.wnba\.com)(:443)?([/?#]|$)'
    when 'nhl' then p_url ~* '^https://(nhl\.com|www\.nhl\.com|frontend\.d3\.nhle\.com)(:443)?([/?#]|$)'
    else false
  end, false);
$$;

revoke all on function public.official_event_source_allowed(text, text) from public, anon, authenticated;
grant execute on function public.official_event_source_allowed(text, text) to service_role;


-- Same anchored grammar as recommendation-key-recovery.ts: one terminal game ID,
-- optional two-letter language prefix, and either short or dated matchup path.
create function public.completed_analysis_nhl_gamecenter_id(p_url text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
 select substring(p_url from '^https://(?:nhl\.com|www\.nhl\.com|frontend\.d3\.nhle\.com)/(?:[a-z]{2}/)?gamecenter/(?:[a-z][a-z0-9-]*/[0-9]{4}/[0-9]{2}/[0-9]{2}/)?([0-9]{10})/?$');
$$;
revoke all on function public.completed_analysis_nhl_gamecenter_id(text) from public,anon,authenticated;
grant execute on function public.completed_analysis_nhl_gamecenter_id(text) to service_role;

-- The pinned digest is the independently reviewed authority. No caller may mint
-- another proof by supplying a matching self-calculated digest.
create function public.completed_analysis_independent_source_manifest(p_envelope jsonb,p_job uuid,p_message uuid,p_raw_sha text,p_checked timestamptz,p_scope jsonb,p_original jsonb,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare manifest jsonb; doc jsonb; binding jsonb; fetched timestamptz;
begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or (p_envelope-array['version','manifest_json','manifest_sha256'])<>'{}'
  or not p_envelope ?& array['version','manifest_json','manifest_sha256'] or p_envelope->'version' is distinct from '1'::jsonb
  or jsonb_typeof(p_envelope->'manifest_json') is distinct from 'string'
  or p_envelope->>'manifest_sha256' is distinct from 'ec37a6dcbe176dac4fdec9828b4fc5b0045ce8e52d77b3017ca6ed5e677798e2'
  or encode(extensions.digest(p_envelope->>'manifest_json','sha256'),'hex') is distinct from p_envelope->>'manifest_sha256' then
  raise exception 'Unapproved independent source manifest' using errcode='22023'; end if;
 manifest := (p_envelope->>'manifest_json')::jsonb;
 if p_job::text is distinct from manifest->>'job_id' or p_message::text is distinct from manifest->>'message_id'
  or manifest->>'job_id' is distinct from '5c0cbeef-6c15-4a51-9418-12031a088a6b' or manifest->>'message_id' is distinct from '02472f0b-af35-49e8-ad30-4bbefd6f3593'
  or p_raw_sha is distinct from manifest->>'raw_sha256' or p_raw_sha is distinct from '4f42583180bb523ca307e9a561d87a3573f2042e423a9fb69283aea586ebdeea'
  or p_checked is distinct from (manifest->>'original_checked_at')::timestamptz or p_scope->>'sport' is distinct from 'tennis'
  or p_scope->>'date_et' is distinct from manifest->>'date_et' or p_original->>'sport' is distinct from 'tennis'
  or jsonb_array_length(p_original->'events')<>8 or jsonb_array_length(manifest->'events')<>8 or jsonb_array_length(manifest->'documents')<>3
  or exists(select 1 from jsonb_array_elements(p_original->'events') e where e->>'analysis_status' in ('BET','GO','EARLY GO'))
  or exists(select 1 from jsonb_array_elements(p_original->'recommendations') r where r->>'decision' in ('BET','GO','EARLY GO') or coalesce((r->>'suggested_units')::numeric,0)>0) then
  raise exception 'Independent source target/actionability differs' using errcode='22023'; end if;
 for doc in select value from jsonb_array_elements(manifest->'documents') loop
  fetched := (doc->>'fetched_at')::timestamptz;
  if doc->>'source_url' is distinct from doc->>'final_url' or doc->'http_status' is distinct from '200'::jsonb or doc->>'media_type' is distinct from 'application/pdf'
   or coalesce(doc->>'content_sha256','') !~ '^[a-f0-9]{64}$' or (doc->>'content_bytes')::integer<=0 or doc->>'scope' is distinct from 'schedule_pair_and_date'
   or not public.official_event_source_allowed('tennis',doc->>'source_url') or fetched<=p_checked or fetched>clock_timestamp() then
   raise exception 'Independent document proof differs' using errcode='22023'; end if;
 end loop;
 for binding in select value from jsonb_array_elements(manifest->'events') loop
  if (select count(*) from jsonb_array_elements(p_original->'events') e where e->>'event_key'=binding->>'event_key')<>1
   or not exists(select 1 from jsonb_array_elements(p_original->'events') e where e->>'event_key'=binding->>'event_key' and e->>'label'=binding->>'label' and e->>'source_url'=binding->>'source_url' and e->'starts_at'=binding->'original_starts_at')
   or binding->'original_searched_membership' is distinct from to_jsonb(exists(select 1 from jsonb_array_elements(p_sources) s where s->>'url'=binding->>'source_url'))
   or not exists(select 1 from jsonb_array_elements(manifest->'documents') d where d->>'source_url'=binding->>'source_url') then
   raise exception 'Independent event/source binding differs' using errcode='22023'; end if;
 end loop;
 return manifest;
end $$;
revoke all on function public.completed_analysis_independent_source_manifest(jsonb,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.completed_analysis_independent_source_manifest(jsonb,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb) to service_role;

create or replace function public.repair_completed_analysis(
 p_job_id uuid, p_attempt_id uuid, p_message_id uuid,
 p_expected_job_metadata jsonb, p_expected_attempt_metadata jsonb,
 p_expected_message_metadata jsonb, p_expected_input_snapshot jsonb, p_repair jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
 j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; m public.messages%rowtype;
 s text; raw text; body text; coverage_body text; raw_hash text; fingerprint text; audit jsonb; prior jsonb; meta jsonb;
 rec jsonb; original jsonb; normalized jsonb; e jsonb; r jsonb; o jsonb; v jsonb;
 report jsonb; original_report jsonb; correction jsonb; coverage jsonb; key_map jsonb := '{}';
 keys jsonb := '{}'; items jsonb := '{}'; events_map jsonb := '{}'; event_id uuid;
 old_key text; new_key text; url text; status text; adopted boolean; checked timestamptz;
 i integer; n integer; assessed integer; missing jsonb; target jsonb; short_id text;
 source_set jsonb; independent_proofs jsonb; independent_manifest jsonb; verified_at text; new_fields jsonb := '{}'; recommendation_corrections jsonb := '[]'; key_match text[];
 patch jsonb; heading_corrections jsonb; supplements jsonb; expected_supplements jsonb := '[]'; provenance jsonb; event_count integer := 0; recommendation_count integer := 0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into j from public.analysis_jobs where id=p_job_id for update;
 if not found or j.provider <> 'openllms' or j.status <> 'completed' or j.result_type='conversation'
  or j.current_attempt_id is distinct from p_attempt_id or j.result_message_id is distinct from p_message_id then
  raise exception 'Stale completed analysis link' using errcode='55000'; end if;
 select * into a from public.analysis_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or a.status <> 'completed' or a.owner_id is distinct from j.owner_id or a.execution_started_at is null or a.finished_at is null then
  raise exception 'Invalid completed attempt' using errcode='55000'; end if;
 select * into m from public.messages where id=p_message_id for update;
 if not found or m.role <> 'assistant' or m.owner_id is distinct from j.owner_id or m.sport_id is distinct from j.sport_id or m.analysis_job_id is distinct from j.id then
  raise exception 'Invalid completed assistant result' using errcode='55000'; end if;
 select slug into s from public.sports where id=j.sport_id and owner_id=j.owner_id;
 raw := m.metadata->>'original_model_response';
 if nullif(btrim(raw),'') is null or nullif(m.metadata->>'checked_at','') is null or jsonb_typeof(m.metadata->'sources') is distinct from 'array'
  or jsonb_array_length(m.metadata->'sources')=0 or jsonb_typeof(a.input_snapshot) is distinct from 'object' or nullif(a.input_snapshot->>'context','') is null then
  raise exception 'Missing immutable repair provenance' using errcode='22023'; end if;
 for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
  if meta->>'original_model_response' is distinct from raw or meta->>'checked_at' is distinct from m.metadata->>'checked_at'
   or meta->'sources' is distinct from m.metadata->'sources' or meta->>'type' is distinct from 'analysis' or meta->>'result_type'='conversation'
   or meta->>'terminalStatus' is distinct from 'completed' or meta->'verified' is distinct from 'true'::jsonb or meta->'searched' is distinct from 'true'::jsonb
   or coalesce(meta#>'{input_snapshot,common_policy}','null') is distinct from coalesce(a.input_snapshot->'common_policy','null') then
   raise exception 'Immutable result provenance differs' using errcode='22023'; end if;
 end loop;
 if a.sources is distinct from m.metadata->'sources' then raise exception 'Attempt searched sources differ' using errcode='22023'; end if;
 raw_hash := encode(extensions.digest(raw,'sha256'),'hex');
 if coalesce(p_repair->>'version','') not in ('official-source-coverage-v1','official-source-coverage-v2') or coalesce(p_repair->>'repair_key','') !~ '^[a-zA-Z0-9:_-]{1,120}$'
  or p_repair->>'raw_sha256' is distinct from raw_hash then raise exception 'Invalid repair identity' using errcode='22023'; end if;
 if a.input_snapshot is distinct from p_expected_input_snapshot
  or (j.provider_metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs']) is distinct from (p_expected_job_metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs'])
  or (a.provider_metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs']) is distinct from (p_expected_attempt_metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs'])
  or (m.metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs']) is distinct from (p_expected_message_metadata-array['analysis_record','extraction_status','extraction_failure','coverage','coverage_report','recommendations_persisted','repair_citation_supplements','analysis_record_provenance','repair_heading_corrections','completed_analysis_repairs']) then
  raise exception 'Immutable repair snapshot differs' using errcode='55000'; end if;
 fingerprint := encode(extensions.digest(p_repair::text,'sha256'),'hex');
 -- Locks serialize callers; the original immutable inputs and links were checked first.
 select value into prior from jsonb_array_elements(coalesce(m.metadata->'completed_analysis_repairs','[]')) where value->>'repair_key'=p_repair->>'repair_key';
 if prior is not null then
  if prior->>'request_sha256' is distinct from fingerprint or prior->>'raw_sha256' is distinct from raw_hash
   or not coalesce(j.provider_metadata->'completed_analysis_repairs','[]') @> jsonb_build_array(prior)
   or not coalesce(a.provider_metadata->'completed_analysis_repairs','[]') @> jsonb_build_array(prior) then
   raise exception 'Repair key payload conflict' using errcode='22023'; end if;
 end if;
 if prior is null and (j.provider_metadata is distinct from p_expected_job_metadata or a.provider_metadata is distinct from p_expected_attempt_metadata
  or m.metadata is distinct from p_expected_message_metadata or a.input_snapshot is distinct from p_expected_input_snapshot) then
  raise exception 'Stale completed analysis snapshot' using errcode='55000'; end if;
 checked := (m.metadata->>'checked_at')::timestamptz;
 adopted := a.input_snapshot->'common_policy' is not null and a.input_snapshot->'common_policy' <> 'null';
 body := split_part(raw,'```analysis-record',1);
 body := split_part(body,'```analysis-coverage',1) || split_part(split_part(body,'```analysis-coverage',2),E'\n```',2);
 original := substring(raw from '```analysis-record[[:space:]]*\n([\s\S]*?)\n```[[:space:]]*$')::jsonb;
 rec := p_repair->'analysis_record';
 if original is null or jsonb_typeof(original) is distinct from 'object' or original->'version' is distinct from '1'::jsonb or original->>'sport' is distinct from s
  or (original - array['version','sport','events','recommendations']) <> '{}' or jsonb_typeof(original->'events') is distinct from 'array'
  or jsonb_typeof(original->'recommendations') is distinct from 'array' or jsonb_array_length(original->'events')>20 or jsonb_array_length(original->'recommendations')>20 then
  raise exception 'Invalid saved analysis record' using errcode='22023'; end if;
 original_report := split_part(regexp_replace(split_part(raw,'```analysis-coverage',2),'^[ \t]*\r?\n',''),E'\n```',1)::jsonb;
 if original_report is null or original_report is distinct from coalesce(prior->'original_coverage_report',m.metadata->'coverage_report') then raise exception 'Saved coverage provenance differs' using errcode='22023'; end if;
 source_set := m.metadata->'sources';
 if p_repair->>'version'='official-source-coverage-v2' then
  independent_proofs := p_repair->'independent_source_verifications';
  if jsonb_typeof(independent_proofs) is distinct from 'array' or jsonb_array_length(independent_proofs)>1
   or jsonb_typeof(p_repair->'recommendation_key_corrections') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(original->'events') action_event where action_event->>'analysis_status' in ('BET','GO','EARLY GO'))
   or exists(select 1 from jsonb_array_elements(original->'recommendations') action_rec where action_rec->>'decision' in ('BET','GO','EARLY GO') or coalesce((action_rec->>'suggested_units')::numeric,0)>0) then
   raise exception 'Invalid non-actionable recovery payload' using errcode='22023'; end if;
  if jsonb_array_length(independent_proofs)=1 then
   independent_manifest := public.completed_analysis_independent_source_manifest(independent_proofs->0,j.id,m.id,raw_hash,checked,(a.input_snapshot->>'context')::jsonb->'analysis_scope',original,source_set);
   select d->>'fetched_at' into verified_at from jsonb_array_elements(independent_manifest->'documents') d order by (d->>'fetched_at')::timestamptz desc limit 1;
   select source_set || coalesce(jsonb_agg(jsonb_build_object('url',d->>'source_url')),'[]') into source_set from jsonb_array_elements(independent_manifest->'documents') d;
  end if;
  if p_repair->>'source_verified_at' is distinct from verified_at or p_repair->>'source_verification_scope' is distinct from (case when independent_manifest is null then null else 'schedule_pair_and_date' end) then
   raise exception 'Independent verification summary differs' using errcode='22023'; end if;
  new_fields := jsonb_build_object('job_id',j.id,'attempt_id',a.id,'message_id',m.id,'recommendation_key_corrections',p_repair->'recommendation_key_corrections','independent_source_verifications',independent_proofs,'source_verified_at',verified_at,'source_verification_scope',p_repair->'source_verification_scope');
 elsif p_repair ?| array['recommendation_key_corrections','independent_source_verifications','source_verified_at','source_verification_scope'] then
  raise exception 'New recovery proof requires v2' using errcode='22023';
 end if;
 heading_corrections := p_repair->'repair_heading_corrections';
 if jsonb_typeof(heading_corrections) is distinct from 'array' or jsonb_array_length(heading_corrections)>1 then raise exception 'Invalid heading corrections' using errcode='22023'; end if;
 coverage_body := body;
 if jsonb_array_length(heading_corrections)=1 then
  coverage_body := public.completed_analysis_repair_heading_body(body,original_report,original_report->'scope',raw_hash,heading_corrections->0);
 end if;
 supplements := p_repair->'repair_citation_supplements';
 if jsonb_typeof(supplements) is distinct from 'array' or jsonb_array_length(supplements)>20 then raise exception 'Invalid citation supplements' using errcode='22023'; end if;
 normalized := jsonb_build_object('version',1,'sport',s,'events','[]'::jsonb,'recommendations','[]'::jsonb);
 for e in select value from jsonb_array_elements(original->'events') loop
  if jsonb_typeof(e) is distinct from 'object' or (e-array['event_key','label','starts_at','source_url','analysis_status']) <> '{}'
   or not e ?& array['event_key','label','starts_at','source_url','analysis_status'] or jsonb_typeof(e->'event_key') is distinct from 'string'
   or jsonb_typeof(e->'label') is distinct from 'string' or length(btrim(e->>'label')) not between 1 and 200
   or jsonb_typeof(e->'source_url') is distinct from 'string' or length(e->>'source_url')>2000 then raise exception 'Invalid saved event' using errcode='22023'; end if;
  old_key := e->>'event_key'; url := e->>'source_url';
  -- Match WHATWG's authority case/default HTTPS port normalization. Any other
  -- normalization is rejected conservatively by comparison with the TS derivation.
  url := regexp_replace(url,'^(https://)([^/?#]+)', 'https://' || lower(substring(url from '^https://([^/?#]+)')));
  url := regexp_replace(url,'^(https://[^/?#:]+):443([/?#]|$)','\1\2');
  if url ~ '^https://[^/?#]+$' then url := url || '/'; end if;
  -- Missing citations are materialized only from the exact saved inventory
  -- binding and an already visible event label. Control JSON is not body proof.
  if strpos(body,e->>'source_url')=0 and strpos(body,url)=0 then
   if s<>'nhl' or not public.official_event_source_allowed(s,url)
    or not exists(select 1 from jsonb_array_elements(source_set) q where q->>'url'=url)
    or (select count(*) from jsonb_array_elements(original_report->'inventory') q where q->>'event_key'=old_key)<>1
    or not exists(select 1 from jsonb_array_elements(original_report->'inventory') q where q->>'event_key'=old_key and q->>'label'=e->>'label' and q->>'source_url'=e->>'source_url')
    or strpos(' '||btrim(lower(regexp_replace(normalize(body,NFKC),'[^[:alnum:]]+',' ','g')))||' ',' '||btrim(lower(regexp_replace(normalize(e->>'label',NFKC),'[^[:alnum:]]+',' ','g')))||' ')=0 then
    raise exception 'Missing original inventory citation binding' using errcode='22023'; end if;
   expected_supplements := expected_supplements || jsonb_build_array(jsonb_build_object('event_key',old_key,'label',e->>'label','source_url',url,'reason','original_inventory_citation'));
  end if;
  new_key := old_key;
  if old_key ~ ':src(-[a-f0-9]{32})?$' then
   if not public.official_event_source_allowed(s,url) then
    raise exception 'Uncited official event source' using errcode='22023'; end if;
   new_key := regexp_replace(old_key,':src(-[a-f0-9]{32})?$',':src-' || left(encode(extensions.digest(url,'sha256'),'hex'),32));
   if old_key !~ ':src$' and old_key<>new_key then raise exception 'Source event hash mismatch' using errcode='22023'; end if;
  end if;
  if new_key !~ ('^'||s||':[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9][a-z0-9-]{1,39}@[a-z0-9][a-z0-9-]{1,39}:(id-[a-z0-9]{3,40}|src-[a-f0-9]{32})$')
   or split_part(split_part(new_key,':',3),'@',1)=split_part(split_part(new_key,':',3),'@',2)
   or to_char(split_part(new_key,':',2)::date,'YYYY-MM-DD')<>split_part(new_key,':',2) or keys ? new_key
   or not exists(select 1 from jsonb_array_elements(source_set) q where q->>'url'=url) then raise exception 'Invalid sourced event' using errcode='22023'; end if;
  status := e->>'analysis_status';
  if adopted then status := case status when 'GO' then 'BET' when 'EARLY GO' then 'BET' when 'LEAN' then 'WATCH' else status end; end if;
  if status is null or status not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')
   or (e->'starts_at'<>'null' and (jsonb_typeof(e->'starts_at')<>'string' or (e->>'starts_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'))
   or (status='BET' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz<=checked))
   or (not adopted and status='EVALUATION INCOMPLETE' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz>checked)) then raise exception 'Invalid event judgment/time' using errcode='22023'; end if;
  e := e || jsonb_build_object('event_key',new_key,'source_url',url,'label',btrim(e->>'label'),'analysis_status',status);
  normalized := jsonb_set(normalized,'{events}',normalized->'events'||jsonb_build_array(e));
  keys := keys || jsonb_build_object(new_key,true); key_map := key_map || jsonb_build_object(old_key,new_key);
 end loop;
 if supplements is distinct from expected_supplements then raise exception 'Citation supplements differ from original bindings' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(original->'recommendations') loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['item_key','event_key','market','selection','decision','suggested_units','price_gate','timing','direction_note'])<>'{}'
   or not r ?& array['item_key','event_key','market','selection','decision','suggested_units','price_gate']
   or coalesce(r->>'item_key','') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' or items ? (r->>'item_key')
   or jsonb_typeof(r->'market') is distinct from 'string' or length(btrim(r->>'market')) not between 1 and 120
   or jsonb_typeof(r->'selection') is distinct from 'string' or length(btrim(r->>'selection')) not between 1 and 120
   or (r->'price_gate'<>'null' and (jsonb_typeof(r->'price_gate')<>'string' or length(btrim(r->>'price_gate'))>120))
   or (r->'suggested_units'<>'null' and (jsonb_typeof(r->'suggested_units')<>'number' or (r->>'suggested_units')::numeric not between 0 and 100)) then raise exception 'Invalid saved recommendation' using errcode='22023'; end if;
  new_key := coalesce(key_map->>(r->>'event_key'),r->>'event_key'); status := r->>'decision';
  if not keys ? new_key and p_repair->>'version'='official-source-coverage-v2' and s='nhl' then
   key_match := regexp_match(new_key,'^nhl:([0-9]{4}-[0-9]{2})-([0-9]{10})$');
   if key_match is not null then
    if (select count(*) from jsonb_array_elements(normalized->'events') q where q->>'event_key' ~ ('^nhl:'||key_match[1]||'-[0-9]{2}:[a-z0-9-]+@[a-z0-9-]+:id-'||key_match[2]||'$'))=1 then
     select value into target from jsonb_array_elements(normalized->'events') q where q->>'event_key' ~ ('^nhl:'||key_match[1]||'-[0-9]{2}:[a-z0-9-]+@[a-z0-9-]+:id-'||key_match[2]||'$');
     url := target->>'source_url';
     if split_part(target->>'event_key',':',2)=((a.input_snapshot->>'context')::jsonb#>>'{analysis_scope,date_et}')
      and (substring(url from '/([0-9]{4}/[0-9]{2}/[0-9]{2})/') is null or replace(substring(url from '/([0-9]{4}/[0-9]{2}/[0-9]{2})/'),'/','-')=split_part(target->>'event_key',':',2))
      and public.official_event_source_allowed('nhl',url)
      and public.completed_analysis_nhl_gamecenter_id(url)=key_match[2]
      and strpos(body,url)>0 and exists(select 1 from jsonb_array_elements(m.metadata->'sources') q where q->>'url'=url)
      and strpos(' '||btrim(lower(regexp_replace(normalize(body,NFKC),'[^[:alnum:]]+',' ','g')))||' ',' '||btrim(lower(regexp_replace(normalize(target->>'label',NFKC),'[^[:alnum:]]+',' ','g')))||' ' )>0 then
      recommendation_corrections := recommendation_corrections || jsonb_build_array(jsonb_build_object('reason','unique_official_game_id','raw_sha256',raw_hash,'item_key',r->>'item_key','from',new_key,'to',target->>'event_key'));
      new_key := target->>'event_key';
     end if;
    end if;
   end if;
  end if;
  if adopted then status := case status when 'GO' then 'BET' when 'EARLY GO' then 'BET' when 'LEAN' then 'WATCH' else status end; end if;
  select value into e from jsonb_array_elements(normalized->'events') where value->>'event_key'=new_key;
  if e is null or status is null or status not in ('WATCH','WAIT','BET','PASS','PAPER','EVALUATION INCOMPLETE')
   or (status='BET' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz<=checked))
   or (not adopted and status='EVALUATION INCOMPLETE' and (e->>'starts_at' is null or (e->>'starts_at')::timestamptz>checked))
   or (adopted and status='BET' and coalesce((r->>'suggested_units')::numeric,-1) not in (0.25,0.5,1,2))
   or (adopted and status<>'BET' and coalesce((r->>'suggested_units')::numeric,0)<>0)
   or (r ? 'timing' and (not adopted or r->>'timing' is distinct from 'early' or status<>'BET'))
   or (r ? 'direction_note' and (not adopted or jsonb_typeof(r->'direction_note')<>'string' or length(btrim(r->>'direction_note')) not between 1 and 240)) then raise exception 'Invalid recommendation judgment/time/units' using errcode='22023'; end if;
  if adopted and r->>'decision'='EARLY GO' then r := r || '{"timing":"early"}'; end if;
  if adopted and r->>'decision'='LEAN' then r := r || jsonb_build_object('direction_note',coalesce(nullif(btrim(r->>'direction_note'),''),btrim(r->>'selection'))); end if;
  if r ? 'direction_note' then r := r || jsonb_build_object('direction_note',btrim(r->>'direction_note')); end if;
  r := r || jsonb_build_object('event_key',new_key,'decision',status,'market',btrim(r->>'market'),'selection',btrim(r->>'selection'),'price_gate',btrim(r->>'price_gate'));
  normalized := jsonb_set(normalized,'{recommendations}',normalized->'recommendations'||jsonb_build_array(r)); items := items || jsonb_build_object(r->>'item_key',true);
 end loop;
 if p_repair->>'version'='official-source-coverage-v2' and (p_repair->'recommendation_key_corrections' is distinct from recommendation_corrections or (recommendation_corrections='[]' and independent_manifest is null)) then raise exception 'Recommendation correction proof differs or v2 no-op' using errcode='22023'; end if;
 if rec is distinct from normalized then raise exception 'Derived record differs from saved raw judgments' using errcode='22023'; end if;
 -- The report may change only by one explicit, raw-bound orphan key correction.
 report := p_repair->'coverage_report'; coverage := p_repair->'coverage'; correction := p_repair->'correction';
 v := original_report;
 if correction is not null and correction<>'null' then
  old_key := correction->>'from'; new_key := correction->>'to'; short_id := substring(old_key from '^ten:([a-z0-9-]+)$');
  if s<>'tennis' or correction->>'raw_sha256' is distinct from raw_hash or short_id is null or new_key is null or new_key <> 'tennis:'||(original_report#>>'{scope,date_et}')||':'||short_id
   or (select count(*) from jsonb_array_elements(original_report->'assessments') q where q->>'event_key'=old_key)<>1
   or exists(select 1 from jsonb_array_elements(original_report->'assessments') q where q->>'event_key'=new_key)
   or (select count(*) from jsonb_array_elements(original_report->'inventory') q where q->>'event_key'=new_key)<>1
   or exists(select 1 from jsonb_array_elements(original_report->'inventory') q where q->>'event_key'=old_key)
   or (select count(*) from jsonb_array_elements(original_report->'inventory') q where lower(right(q->>'event_key',length(short_id)+1))=':'||lower(short_id))<>1 then raise exception 'Invalid explicit coverage correction' using errcode='22023'; end if;
  select value into target from jsonb_array_elements(original_report->'inventory') where value->>'event_key'=new_key;
  if public.completed_analysis_repair_coverage_identity(coverage_body,target->>'label',short_id) is distinct from true then raise exception 'Missing correction identity evidence' using errcode='22023'; end if;
  select jsonb_agg(case when value->>'event_key'=old_key then jsonb_set(value,'{event_key}',to_jsonb(new_key)) else value end order by ord) into v
   from jsonb_array_elements(original_report->'assessments') with ordinality as q(value,ord);
  v := jsonb_set(original_report,'{assessments}',v);
 end if;
 if report is distinct from v or report->'scope' is distinct from (a.input_snapshot->>'context')::jsonb->'analysis_scope'
  or coverage->'scope' is distinct from report->'scope' or coalesce(coverage->>'status','') not in ('incomplete','unverified')
  or not coalesce(coverage->'reasons','[]') ? 'independent_schedule_verification_unavailable'
  or (report->'inventory_complete'='false' and (coverage->>'status'<>'incomplete' or not coalesce(coverage->'reasons','[]') ? 'inventory_declared_incomplete')) then raise exception 'Invalid repaired coverage' using errcode='22023'; end if;
 select count(distinct value->>'event_key') into n from jsonb_array_elements(report->'inventory');
 select count(distinct q->>'event_key') into assessed from jsonb_array_elements(report->'assessments') q where exists(select 1 from jsonb_array_elements(report->'inventory') inv where inv->>'event_key'=q->>'event_key');
 select coalesce(jsonb_agg(value->'event_key' order by ord),'[]') into missing from jsonb_array_elements(report->'inventory') with ordinality q(value,ord) where not exists(select 1 from jsonb_array_elements(report->'assessments') ass where ass->>'event_key'=value->>'event_key');
 if coverage->'listed_count' is distinct from to_jsonb(n) or coverage->'assessed_count' is distinct from to_jsonb(assessed) or coverage->'missing_event_keys' is distinct from missing then raise exception 'Invalid repaired coverage counts' using errcode='22023'; end if;
 perform 1 from public.recommendations where analysis_job_id=j.id for update;
 provenance := jsonb_build_object('kind','saved_response_repair','raw_sha256',raw_hash,'citation_supplements_materialized',jsonb_array_length(supplements)>0);
 patch := jsonb_build_object('analysis_record',rec,'extraction_status','complete','coverage',coverage,'coverage_report',report,'recommendations_persisted',jsonb_array_length(rec->'recommendations')>0,'repair_citation_supplements',supplements,'analysis_record_provenance',provenance,'repair_heading_corrections',heading_corrections,'repair_heading_corrections',heading_corrections);
 if prior is not null then
  for meta in select unnest(array[j.provider_metadata,a.provider_metadata,m.metadata]) loop
   if exists(select 1 from jsonb_each(patch) q where meta->q.key is distinct from q.value) or meta ? 'extraction_failure' then raise exception 'Repaired derived metadata drift' using errcode='22023'; end if;
  end loop;
 end if;
 if exists(select 1 from public.recommendations q where q.analysis_job_id=j.id and (q.recommendation_item_key is null or not items ? q.recommendation_item_key)) then
  raise exception 'Unexpected existing recommendation item' using errcode='22023'; end if;
 -- Validate every existing unique item before any insertion; event judgments are preserved.
 for r in select value from jsonb_array_elements(rec->'recommendations') loop
  select value into e from jsonb_array_elements(rec->'events') where value->>'event_key'=r->>'event_key';
  if prior is not null and not exists(select 1 from public.recommendations q where q.analysis_job_id=j.id and q.recommendation_item_key=r->>'item_key') then raise exception 'Repaired recommendation missing' using errcode='22023'; end if;
  if exists(select 1 from public.recommendations q left join public.events ev on ev.id=q.event_id where q.analysis_job_id=j.id and q.recommendation_item_key=r->>'item_key'
   and (q.owner_id is distinct from j.owner_id or q.sport_id is distinct from j.sport_id or ev.owner_id is distinct from j.owner_id or ev.sport_id is distinct from j.sport_id or ev.event_key is distinct from r->>'event_key'
    or q.market is distinct from r->>'market' or q.selection is distinct from r->>'selection' or q.decision is distinct from r->>'decision'
    or q.suggested_units is distinct from (r->>'suggested_units')::numeric or q.price_gate is distinct from r->>'price_gate'
    or q.source_message_id is distinct from m.id or q.source_ref is distinct from e->>'source_url' or q.source_document_id is not null or q.created_at is distinct from m.created_at)) then
   raise exception 'Existing recommendation conflicts with repair' using errcode='22023'; end if;
 end loop;
 if prior is not null then return jsonb_build_object('status','already_repaired','message_id',m.id,'raw_sha256',raw_hash); end if;
 for e in select value from jsonb_array_elements(rec->'events') loop
  insert into public.events(owner_id,sport_id,event_key,label,starts_at,source_ref,analysis_status,updated_at)
   values(j.owner_id,j.sport_id,e->>'event_key',e->>'label',(e->>'starts_at')::timestamptz,e->>'source_url',e->>'analysis_status',m.created_at)
   on conflict(owner_id,sport_id,event_key) do nothing;
  get diagnostics i = row_count; event_count := event_count+i;
  select id into event_id from public.events where owner_id=j.owner_id and sport_id=j.sport_id and event_key=e->>'event_key';
  events_map := events_map || jsonb_build_object(e->>'event_key',event_id);
 end loop;
 for r in select value from jsonb_array_elements(rec->'recommendations') loop
  select value into e from jsonb_array_elements(rec->'events') where value->>'event_key'=r->>'event_key';
  insert into public.recommendations(owner_id,sport_id,event_id,market,selection,decision,suggested_units,price_gate,analysis_job_id,recommendation_item_key,source_message_id,source_ref,created_at)
   values(j.owner_id,j.sport_id,(events_map->>(r->>'event_key'))::uuid,r->>'market',r->>'selection',r->>'decision',(r->>'suggested_units')::numeric,r->>'price_gate',j.id,r->>'item_key',m.id,e->>'source_url',m.created_at)
   on conflict(analysis_job_id,recommendation_item_key) where analysis_job_id is not null and recommendation_item_key is not null do nothing;
  get diagnostics i = row_count; recommendation_count := recommendation_count+i;
  if exists(select 1 from public.recommendations q left join public.events ev on ev.id=q.event_id where q.analysis_job_id=j.id and q.recommendation_item_key=r->>'item_key'
   and (q.owner_id is distinct from j.owner_id or q.sport_id is distinct from j.sport_id or ev.owner_id is distinct from j.owner_id or ev.sport_id is distinct from j.sport_id or ev.event_key is distinct from r->>'event_key'
    or q.market is distinct from r->>'market' or q.selection is distinct from r->>'selection' or q.decision is distinct from r->>'decision'
    or q.suggested_units is distinct from (r->>'suggested_units')::numeric or q.price_gate is distinct from r->>'price_gate'
    or q.source_message_id is distinct from m.id or q.source_ref is distinct from e->>'source_url' or q.source_document_id is not null or q.created_at is distinct from m.created_at)) then
   raise exception 'Concurrent recommendation conflicts with repair' using errcode='22023'; end if;

 end loop;
 audit := jsonb_build_object('repair_key',p_repair->>'repair_key','version',p_repair->>'version','repaired_at',clock_timestamp(),'raw_sha256',raw_hash,'request_sha256',fingerprint,
  'original_extraction_failure',m.metadata->'extraction_failure','original_coverage',m.metadata->'coverage','original_coverage_report',original_report,'correction',correction,'repair_citation_supplements',supplements,'analysis_record_provenance',provenance,'repair_heading_corrections',heading_corrections,
  'original_derived_metadata',jsonb_build_object(
    'job',jsonb_build_object('extraction_status',j.provider_metadata->'extraction_status','extraction_failure',j.provider_metadata->'extraction_failure','coverage',j.provider_metadata->'coverage'),
    'attempt',jsonb_build_object('extraction_status',a.provider_metadata->'extraction_status','extraction_failure',a.provider_metadata->'extraction_failure','coverage',a.provider_metadata->'coverage'),
    'message',jsonb_build_object('extraction_status',m.metadata->'extraction_status','extraction_failure',m.metadata->'extraction_failure','coverage',m.metadata->'coverage')),

  'record_event_count',jsonb_array_length(rec->'events'),'record_recommendation_count',jsonb_array_length(rec->'recommendations'),'inserted_events',event_count,'inserted_recommendations',recommendation_count);
 audit := audit || new_fields;
 update public.messages set metadata=(metadata-'extraction_failure')||patch||jsonb_build_object('completed_analysis_repairs',coalesce(metadata->'completed_analysis_repairs','[]')||jsonb_build_array(audit)) where id=m.id;
 update public.analysis_attempts set provider_metadata=(provider_metadata-'extraction_failure')||patch||jsonb_build_object('completed_analysis_repairs',coalesce(provider_metadata->'completed_analysis_repairs','[]')||jsonb_build_array(audit)) where id=a.id;
 update public.analysis_jobs set provider_metadata=(provider_metadata-'extraction_failure')||patch||jsonb_build_object('completed_analysis_repairs',coalesce(provider_metadata->'completed_analysis_repairs','[]')||jsonb_build_array(audit)) where id=j.id;
 return jsonb_build_object('status','repaired','message_id',m.id,'raw_sha256',raw_hash,'inserted_events',event_count,'inserted_recommendations',recommendation_count);
end $$;
revoke all on function public.repair_completed_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.repair_completed_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
