-- Metadata-only saved-result recovery. Never inserts native financial/projection rows.
-- Stronger than three mutable metadata audits: a private immutable ledger binds all identities
-- while preserving job/attempt metadata and generation timestamps byte-for-byte.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.saved_evaluation_repairs (
 job_id uuid not null, attempt_id uuid not null, original_attempt_id uuid not null,
 message_id uuid not null, owner_id uuid not null, repair_key text not null,
 fingerprint text not null, raw_sha256 text not null, sources_sha256 text not null, content_sha256 text not null,
 expected_metadata jsonb not null, applied_metadata jsonb not null, patch jsonb not null,
 old_metadata_sha256 text not null, applied_metadata_sha256 text not null,
 prior_validation jsonb, repaired_at timestamptz not null default clock_timestamp(),
 primary key(job_id,repair_key)
);
alter table private.saved_evaluation_repairs enable row level security;
revoke all on private.saved_evaluation_repairs from public,anon,authenticated,service_role;
create function private.guard_saved_evaluation_audit() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Evaluation repair audit is append-only' using errcode='22023'; end $$;
create trigger saved_evaluation_audit_immutable before update or delete on private.saved_evaluation_repairs
 for each row execute function private.guard_saved_evaluation_audit();
revoke all on function private.guard_saved_evaluation_audit() from public,anon,authenticated,service_role;

create function public.repair_saved_evaluation(
 p_job_id uuid,p_attempt_id uuid,p_original_attempt_id uuid,p_message_id uuid,p_owner_id uuid,
 p_repair_key text,p_fingerprint text,p_expected_raw_sha256 text,p_expected_source_map_sha256 text,
 p_expected_content_sha256 text,p_expected_metadata jsonb,p_patch jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 j public.analysis_jobs%rowtype; a public.analysis_attempts%rowtype; c public.gateway_completions%rowtype;
 m public.messages%rowtype; prior private.saved_evaluation_repairs%rowtype;
 presentation jsonb; span jsonb; report jsonb; market jsonb; original_report jsonb; original_market jsonb; normalized_market jsonb; check_row jsonb; source_url jsonb;
 original_blocks text[]; fence_count integer; original_index integer:=0; candidate_index integer; matched boolean; v_start integer; v_end integer; previous_end integer:=0; total_bytes integer:=0; raw_bytes bytea;
 applied jsonb; before_message jsonb; after_message jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_repair_key is null or length(p_repair_key) not between 1 and 160
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or p_expected_raw_sha256 is null or p_expected_raw_sha256 !~ '^[a-f0-9]{64}$'
  or p_expected_source_map_sha256 is null or p_expected_source_map_sha256 !~ '^[a-f0-9]{64}$'
  or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_expected_metadata) is distinct from 'object' then raise exception 'Invalid repair identity' using errcode='22023'; end if;
 select * into j from public.analysis_jobs where id=p_job_id for update;
 if not found or j.owner_id is distinct from p_owner_id or j.provider<>'openllms' or j.status<>'completed'
  or j.current_attempt_id is distinct from p_attempt_id or j.result_message_id is distinct from p_message_id
  then raise exception 'Completed job link mismatch' using errcode='55000'; end if;
 select * into a from public.analysis_attempts where id=p_attempt_id for update;
 if not found or a.job_id is distinct from j.id or a.owner_id is distinct from p_owner_id or a.status<>'completed'
  then raise exception 'Completed attempt link mismatch' using errcode='55000'; end if;
 select * into m from public.messages where id=p_message_id for update;
 if not found or m.owner_id is distinct from p_owner_id or m.analysis_job_id is distinct from j.id
  or m.sport_id is distinct from j.sport_id or m.role<>'assistant' then raise exception 'Message link mismatch' using errcode='55000'; end if;
 select * into c from public.gateway_completions where job_id=j.id for update;
 if not found or c.owner_id is distinct from p_owner_id or c.original_attempt_id is distinct from p_original_attempt_id
  or c.raw_sha256 is distinct from p_expected_raw_sha256 or c.sources_sha256 is distinct from p_expected_source_map_sha256
  or m.metadata->>'original_model_response' is distinct from c.completion->'result'->>'text'
  or m.metadata->'sources' is distinct from c.completion->'result'->'sources'
  or m.metadata->>'checked_at' is distinct from c.completion->>'checked_at'
  or m.metadata->'input_snapshot'->>'attempt_id' is distinct from c.original_attempt_id::text
  or m.metadata->'input_snapshot'->>'context_sha256' is distinct from c.input_snapshot->>'context_sha256'
  or m.metadata->'input_snapshot'->>'instructions_sha256' is distinct from c.input_snapshot->>'instructions_sha256'
  or encode(extensions.digest(m.content,'sha256'),'hex') is distinct from p_expected_content_sha256
  then raise exception 'Immutable completion evidence mismatch' using errcode='22023'; end if;
 -- Full stored JSONB equality, never a JavaScript JSON serialization hash CAS.
 select * into prior from private.saved_evaluation_repairs where job_id=j.id and repair_key=p_repair_key;
 if found then
  if prior.attempt_id is distinct from a.id or prior.original_attempt_id is distinct from c.original_attempt_id
   or prior.message_id is distinct from m.id or prior.owner_id is distinct from p_owner_id
   or prior.fingerprint is distinct from p_fingerprint or prior.raw_sha256 is distinct from c.raw_sha256
   or prior.sources_sha256 is distinct from c.sources_sha256 or prior.content_sha256 is distinct from p_expected_content_sha256
   or prior.expected_metadata is distinct from p_expected_metadata or prior.patch is distinct from p_patch
   or prior.applied_metadata is distinct from m.metadata
   or prior.applied_metadata_sha256 is distinct from encode(extensions.digest(m.metadata::text,'sha256'),'hex')
   then raise exception 'Repair key collision or changed applied state' using errcode='22023'; end if;
  return jsonb_build_object('status','already_repaired','message_id',m.id,'raw_sha256',c.raw_sha256);
 end if;
 if m.metadata is distinct from p_expected_metadata then raise exception 'Message metadata CAS mismatch' using errcode='40001'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or not (p_patch ?& array['evaluation_report','evaluation_validation','evaluation_quarantined_markets','evaluation_presentation'])
  or (p_patch-array['evaluation_report','evaluation_validation','evaluation_quarantined_markets','evaluation_presentation'])<>'{}'::jsonb
  or jsonb_typeof(p_patch->'evaluation_quarantined_markets') is distinct from 'array'
  or jsonb_array_length(p_patch->'evaluation_quarantined_markets')>20
  or octet_length(p_patch::text)>262144 then raise exception 'Forbidden repair patch' using errcode='22023'; end if;
 presentation:=p_patch->'evaluation_presentation';
 if jsonb_typeof(presentation) is distinct from 'object' or presentation->'version' is distinct from '1'::jsonb
  or not (presentation ?& array['version','context','reason','raw_sha256','reviewedTables'])
  or (presentation-array['version','context','reason','raw_sha256','reviewedTables'])<>'{}'::jsonb
  or coalesce(presentation->>'context','') not in ('current','historical','unavailable')
  or jsonb_typeof(presentation->'reason') is distinct from 'string' or length(presentation->>'reason') not between 1 and 500
  or presentation->>'raw_sha256' is distinct from c.raw_sha256
  or jsonb_typeof(presentation->'reviewedTables') is distinct from 'array'
  then raise exception 'Invalid presentation' using errcode='22023'; end if;
 if jsonb_array_length(presentation->'reviewedTables')>12 then raise exception 'Too many excerpts' using errcode='22023'; end if;
 raw_bytes:=convert_to(c.completion->'result'->>'text','UTF8');
 for span in select value from jsonb_array_elements(presentation->'reviewedTables') loop
  if jsonb_typeof(span) is distinct from 'object' or not (span ?& array['start','end','excerpt_sha256'])
   or (span-array['start','end','excerpt_sha256'])<>'{}'::jsonb
   or jsonb_typeof(span->'start') is distinct from 'number' or jsonb_typeof(span->'end') is distinct from 'number'
   or (span->>'start') !~ '^[0-9]{1,9}$' or (span->>'end') !~ '^[0-9]{1,9}$'
   then raise exception 'Invalid excerpt bounds' using errcode='22023'; end if;
  v_start:=(span->>'start')::integer; v_end:=(span->>'end')::integer;
  total_bytes:=total_bytes+v_end-v_start;
  if v_start<previous_end or total_bytes>24000 or v_start<0 or v_end<=v_start or v_end>octet_length(raw_bytes) or v_end-v_start>24000
   or encode(extensions.digest(substring(raw_bytes from v_start+1 for v_end-v_start),'sha256'),'hex') is distinct from span->>'excerpt_sha256'
   then raise exception 'Excerpt proof mismatch' using errcode='22023'; end if;
  perform convert_from(substring(raw_bytes from v_start+1 for v_end-v_start),'UTF8');
  previous_end:=v_end;
 end loop;
 if (presentation->>'context'='historical' and (jsonb_array_length(presentation->'reviewedTables')=0 or p_patch->'evaluation_report'<>'null'::jsonb))
  or (presentation->>'context'<>'historical' and jsonb_array_length(presentation->'reviewedTables')<>0)
  then raise exception 'Historical context mismatch' using errcode='22023'; end if;
 if jsonb_typeof(p_patch->'evaluation_validation') is distinct from 'object'
  or p_patch->'evaluation_validation'->'version' is distinct from '1'::jsonb
  or coalesce(p_patch->'evaluation_validation'->>'status','') not in ('valid','partial','invalid','unavailable')
  then raise exception 'Invalid validation shape' using errcode='22023'; end if;
 if p_patch->'evaluation_report'='null'::jsonb then
  if presentation->>'context'='current' or p_patch->'evaluation_validation'->>'status' in ('valid','partial') then raise exception 'False accepted evaluation' using errcode='22023'; end if;
 else
  if presentation->>'context'<>'current' or p_patch->'evaluation_validation'->>'status' not in ('valid','partial')
   or jsonb_typeof(p_patch->'evaluation_report') is distinct from 'object'
   or p_patch->'evaluation_report'->'version' is distinct from '1'::jsonb
   or jsonb_typeof(p_patch->'evaluation_report'->'markets') is distinct from 'array'
   or jsonb_array_length(p_patch->'evaluation_report'->'markets')>20
   then raise exception 'Invalid report shape' using errcode='22023'; end if;
 end if;
 report:=p_patch->'evaluation_report';
 if report<>'null'::jsonb then
  if not (report ?& array['version','sport','date_et','scope','scope_note','truncated','markets'])
   or (report-array['version','sport','date_et','scope','scope_note','truncated','markets'])<>'{}'::jsonb
   or report->>'sport' is distinct from (select slug from public.sports where id=j.sport_id and owner_id=j.owner_id)
   or coalesce(report->>'date_et','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or report->>'scope' is distinct from 'selected_markets'
   or jsonb_typeof(report->'scope_note') is distinct from 'string' or length(report->>'scope_note') not between 1 and 1200
   or jsonb_typeof(report->'truncated') is distinct from 'boolean'
   then raise exception 'Invalid report envelope' using errcode='22023'; end if;
  -- A parsed report may only quote original markets in original order. The ONLY value
  -- conversion permitted is finite JSON market.line number -> equivalent numeric string.
  -- Raw text is data parsed as JSON, never interpolated into SQL or evaluated as code.
  select count(*) into fence_count from regexp_matches(c.completion->'result'->>'text','^[ \t]{0,3}```analysis-evaluation[^\n]*','gn');
  original_blocks:=regexp_match(c.completion->'result'->>'text','^[ \t]{0,3}```analysis-evaluation[^\r\n]*\r?\n([\s\S]*?)^[ \t]{0,3}```[ \t]*(?:\r?\n|$)','n');
  if fence_count<>1 or original_blocks is null or octet_length(original_blocks[1])>98304 then raise exception 'Exactly one bounded saved evaluation required' using errcode='22023'; end if;
  begin original_report:=original_blocks[1]::jsonb;
  exception when invalid_text_representation then raise exception 'Saved evaluation is not JSON' using errcode='22023'; end;
  if jsonb_typeof(original_report) is distinct from 'object'
   or jsonb_typeof(original_report->'markets') is distinct from 'array'
   or jsonb_array_length(original_report->'markets')>20
   or (report-'markets') is distinct from (original_report-'markets')
   then raise exception 'Report envelope differs from saved evaluation' using errcode='22023'; end if;
  for market in select value from jsonb_array_elements(report->'markets') loop
   if jsonb_typeof(market) is distinct from 'object'
    or not (market ?& array['event_key','label','market','selection','line','original_decision','state','observed_price','price_condition','suggested_units','thesis','countercase','critical_checks','uncertainty'])
    or (market-array['event_key','label','market','selection','line','original_decision','state','observed_price','price_condition','suggested_units','thesis','countercase','critical_checks','uncertainty'])<>'{}'::jsonb
    or jsonb_typeof(market->'event_key') is distinct from 'string'
    or jsonb_typeof(market->'label') is distinct from 'string'
    or jsonb_typeof(market->'market') is distinct from 'string'
    or jsonb_typeof(market->'selection') is distinct from 'string'
    or jsonb_typeof(market->'line') not in ('string','null')
    or coalesce(market->>'original_decision','') not in ('GO','EARLY GO','BET','WAIT','PASS','WATCH','PAPER','LEAN','EVALUATION INCOMPLETE')
    or coalesce(market->>'state','') not in ('valuation_complete','information_wait','research_incomplete','not_evaluated')
    or jsonb_typeof(market->'observed_price') not in ('object','null')
    or jsonb_typeof(market->'price_condition') not in ('string','null')
    or jsonb_typeof(market->'suggested_units') not in ('number','null')
    or jsonb_typeof(market->'thesis') is distinct from 'string'
    or jsonb_typeof(market->'countercase') is distinct from 'string'
    or jsonb_typeof(market->'critical_checks') is distinct from 'array'
    or jsonb_typeof(market->'uncertainty') is distinct from 'object'
    then raise exception 'Invalid report market' using errcode='22023'; end if;
   matched:=false;
   for candidate_index in original_index..jsonb_array_length(original_report->'markets')-1 loop
    original_market:=original_report->'markets'->candidate_index;
    normalized_market:=original_market;
    if jsonb_typeof(original_market->'line')='number' and jsonb_typeof(market->'line')='string'
     and length(market->>'line')<=200 and market->>'line' ~ '^-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
     -- PostgreSQL numeric can exceed JS finite numbers: reject overflowing float values.
     begin
      if (original_market->>'line')::double precision not in ('Infinity'::double precision,'-Infinity'::double precision)
       and (original_market->>'line')::numeric=(market->>'line')::numeric then
       normalized_market:=jsonb_set(original_market,'{line}',market->'line');
      end if;
     exception when numeric_value_out_of_range then
      raise exception 'Nonfinite saved market line' using errcode='22023';
     end;
    end if;
    if market=normalized_market then matched:=true; original_index:=candidate_index+1; exit; end if;
   end loop;
   if not matched then raise exception 'Market differs from ordered immutable saved subset' using errcode='22023'; end if;
   if jsonb_typeof(market->'observed_price')='object' then
    source_url:=market->'observed_price'->'source_url';
    if jsonb_typeof(source_url) is distinct from 'string' or not exists(
     select 1 from jsonb_array_elements(c.completion->'result'->'sources') retained
     where jsonb_typeof(retained->'url')='string' and split_part(retained->>'url','#',1)=split_part(source_url#>>'{}','#',1)
    ) then raise exception 'Observed price URL not retained' using errcode='22023'; end if;
   end if;
   for check_row in select value from jsonb_array_elements(market->'critical_checks') loop
    if jsonb_typeof(check_row) is distinct from 'object' or jsonb_typeof(check_row->'source_urls') is distinct from 'array'
     then raise exception 'Invalid saved source checks' using errcode='22023'; end if;
    for source_url in select value from jsonb_array_elements(check_row->'source_urls') loop
     if jsonb_typeof(source_url) is distinct from 'string' or not exists(
      select 1 from jsonb_array_elements(c.completion->'result'->'sources') retained
      where jsonb_typeof(retained->'url')='string' and split_part(retained->>'url','#',1)=split_part(source_url#>>'{}','#',1)
     ) then raise exception 'Critical check URL not retained' using errcode='22023'; end if;
    end loop;
   end loop;
  end loop;
 end if;
 applied:=m.metadata||p_patch;
 before_message:=to_jsonb(m)-'metadata';
 update public.messages set metadata=applied where id=m.id;
 select to_jsonb(x)-'metadata' into after_message from public.messages x where id=m.id;
 if before_message is distinct from after_message then raise exception 'Repair changed immutable message columns' using errcode='22023'; end if;
 insert into private.saved_evaluation_repairs(job_id,attempt_id,original_attempt_id,message_id,owner_id,repair_key,fingerprint,raw_sha256,sources_sha256,content_sha256,expected_metadata,applied_metadata,patch,old_metadata_sha256,applied_metadata_sha256,prior_validation)
 values(j.id,a.id,c.original_attempt_id,m.id,p_owner_id,p_repair_key,p_fingerprint,c.raw_sha256,c.sources_sha256,p_expected_content_sha256,m.metadata,applied,p_patch,encode(extensions.digest(m.metadata::text,'sha256'),'hex'),encode(extensions.digest(applied::text,'sha256'),'hex'),m.metadata->'evaluation_validation');
 return jsonb_build_object('status','repaired','message_id',m.id,'raw_sha256',c.raw_sha256);
end $$;
revoke all on function public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb) to service_role;
