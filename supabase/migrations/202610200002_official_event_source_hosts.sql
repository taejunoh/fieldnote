create or replace function public.official_event_source_allowed(p_sport text, p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(case p_sport
    when 'mlb' then p_url ~* '^https://(mlb\.com|www\.mlb\.com)(:443)?([/?#]|$)'
    when 'nfl' then p_url ~* '^https://(nfl\.com|www\.nfl\.com)(:443)?([/?#]|$)'
    when 'cfb' then p_url ~* '^https://(ncaa\.com|www\.ncaa\.com|collegefootballplayoff\.com|www\.collegefootballplayoff\.com)(:443)?([/?#]|$)'
    when 'soccer' then p_url ~* '^https://(fifa\.com|www\.fifa\.com|uefa\.com|www\.uefa\.com|mlssoccer\.com|www\.mlssoccer\.com|premierleague\.com|www\.premierleague\.com)(:443)?([/?#]|$)'
    when 'tennis' then p_url ~* '^https://(atptour\.com|www\.atptour\.com|wtatennis\.com|www\.wtatennis\.com|itftennis\.com|www\.itftennis\.com|wtafiles\.wtatennis\.com)(:443)?([/?#]|$)'
    when 'wnba' then p_url ~* '^https://(wnba\.com|www\.wnba\.com)(:443)?([/?#]|$)'
    when 'nhl' then p_url ~* '^https://(nhl\.com|www\.nhl\.com|frontend\.d3\.nhle\.com)(:443)?([/?#]|$)'
    else false
  end, false);
$$;

revoke all on function public.official_event_source_allowed(text, text) from public, anon, authenticated;
grant execute on function public.official_event_source_allowed(text, text) to service_role;

do $$
declare
  v_definition text;
  v_old text := $old$
        v_source_host := lower(substring(v_event->>'source_url' from '^https://([A-Za-z0-9.-]+)/'));
        if v_source_host is null or not (
          (v_sport = 'mlb' and v_source_host in ('mlb.com', 'www.mlb.com')) or
          (v_sport = 'nfl' and v_source_host in ('nfl.com', 'www.nfl.com')) or
          (v_sport = 'cfb' and v_source_host in ('ncaa.com', 'www.ncaa.com', 'collegefootballplayoff.com', 'www.collegefootballplayoff.com')) or
          (v_sport = 'soccer' and v_source_host in ('fifa.com', 'www.fifa.com', 'uefa.com', 'www.uefa.com', 'mlssoccer.com', 'www.mlssoccer.com', 'premierleague.com', 'www.premierleague.com')) or
          (v_sport = 'tennis' and v_source_host in ('atptour.com', 'www.atptour.com', 'wtatennis.com', 'www.wtatennis.com', 'itftennis.com', 'www.itftennis.com')) or
          (v_sport = 'wnba' and v_source_host in ('wnba.com', 'www.wnba.com')) or
          (v_sport = 'nhl' and v_source_host in ('nhl.com', 'www.nhl.com'))
        ) or v_event->>'event_key' is distinct from regexp_replace(
          v_event->>'event_key', ':src-[a-f0-9]{32}$',
          ':src-' || left(encode(extensions.digest(v_event->>'source_url', 'sha256'), 'hex'), 32)
        ) then
$old$;
  v_new text := $new$
        if not public.official_event_source_allowed(v_sport, v_event->>'source_url')
          or v_event->>'event_key' is distinct from regexp_replace(
          v_event->>'event_key', ':src-[a-f0-9]{32}$',
          ':src-' || left(encode(extensions.digest(v_event->>'source_url', 'sha256'), 'hex'), 32)
        ) then
$new$;
begin
  select pg_get_functiondef('public.finalize_gateway_job(uuid,uuid,text,text,jsonb,text)'::regprocedure)
    into v_definition;
  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Expected sourced-event validation block was not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end $$;
