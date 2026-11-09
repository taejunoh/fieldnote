-- Register NBA as its own sport and accept only NBA-owned current sources.
-- WNBA remains a separate league with a separate source-host allowlist.
alter table public.sports drop constraint if exists sports_slug_check;
alter table public.sports
  add constraint sports_slug_check
  check (slug in ('mlb','nfl','cfb','soccer','tennis','nba','wnba','nhl'));

-- The original functions are intentionally copied forward through their
-- installed definitions so all existing validation and RLS behavior stays
-- byte-for-byte intact except for the accepted sport tuple.
do $migration$
declare
  v_old text := $tuple$('mlb','nfl','cfb','soccer','tennis','wnba','nhl')$tuple$;
  v_new text := $tuple$('mlb','nfl','cfb','soccer','tennis','nba','wnba','nhl')$tuple$;
  v_definition text;
  v_function regprocedure;
begin
  foreach v_function in array array[
    'public.commit_import(text,text,text,text,jsonb)'::regprocedure,
    'public.derive_partial_analysis_record(text,text,jsonb,timestamp with time zone,boolean)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if strpos(v_definition, v_old) = 0 then
      raise exception 'Expected sport allowlist was not found in %', v_function;
    end if;
    execute replace(v_definition, v_old, v_new);
  end loop;
end $migration$;

-- NBA.com serves schedules and box scores. The NBA injury-report CDN is an
-- exact host exception; arbitrary subdomains and WNBA sources stay rejected.
do $migration$
declare
  v_old text := $host$when 'wnba' then p_url ~* '^https://(wnba\.com|www\.wnba\.com)(:443)?([/?#]|$)'$host$;
  v_new text := $host$when 'nba' then p_url ~* '^https://(nba\.com|www\.nba\.com|ak-static\.cms\.nba\.com)(:443)?([/?#]|$)'
    when 'wnba' then p_url ~* '^https://(wnba\.com|www\.wnba\.com)(:443)?([/?#]|$)'$host$;
  v_definition text;
begin
  v_definition := pg_get_functiondef('public.official_event_source_allowed(text,text)'::regprocedure);
  if strpos(v_definition, v_old) = 0 then
    raise exception 'Expected WNBA source policy was not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end $migration$;
