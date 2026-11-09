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
    when 'soccer' then p_url ~* '^https://(fifa\.com|www\.fifa\.com|uefa\.com|www\.uefa\.com|mlssoccer\.com|www\.mlssoccer\.com|premierleague\.com|www\.premierleague\.com|dcunited\.com|www\.dcunited\.com|atlasfc\.com\.mx|www\.atlasfc\.com\.mx|clubpuebla\.com|www\.clubpuebla\.com|tuzos\.com\.mx|www\.tuzos\.com\.mx|clubsantos\.mx|www\.clubsantos\.mx)(:443)?([/?#]|$)'
    when 'tennis' then p_url ~* '^https://(atptour\.com|www\.atptour\.com|wtatennis\.com|www\.wtatennis\.com|itftennis\.com|www\.itftennis\.com|wtafiles\.wtatennis\.com)(:443)?([/?#]|$)'
    when 'wnba' then p_url ~* '^https://(wnba\.com|www\.wnba\.com)(:443)?([/?#]|$)'
    when 'nhl' then p_url ~* '^https://(nhl\.com|www\.nhl\.com|frontend\.d3\.nhle\.com)(:443)?([/?#]|$)'
    else false
  end, false);
$$;

revoke all on function public.official_event_source_allowed(text, text) from public, anon, authenticated;
grant execute on function public.official_event_source_allowed(text, text) to service_role;
