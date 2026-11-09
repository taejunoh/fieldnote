-- Rollback-only fixtures for the exact official sourced-event host policy.
begin;
do $$
begin
  if not public.official_event_source_allowed(
    'nhl', 'https://frontend.d3.nhle.com/api/v1/gamecenter/fixture/landing'
  ) then raise exception 'Official NHL CDN host was rejected'; end if;
  if not public.official_event_source_allowed('nba', 'https://www.nba.com/schedule')
     or not public.official_event_source_allowed('nba', 'https://nba.com/schedule')
     or not public.official_event_source_allowed('nba', 'https://ak-static.cms.nba.com/referee/injury/fixture.pdf') then
    raise exception 'Official NBA schedule or injury-report host was rejected';
  end if;
  if not public.official_event_source_allowed(
    'tennis', 'https://wtafiles.wtatennis.com/pdf/draws/2026/fixture.pdf'
  ) then raise exception 'Official WTA files host was rejected'; end if;
  if not public.official_event_source_allowed('soccer', 'https://federacaopr.com.br/campeonato/profissional/2026/fixture/')
     or not public.official_event_source_allowed('soccer', 'https://www.federacaopr.com.br/campeonato/profissional/2026/fixture/')
     or not public.official_event_source_allowed('soccer', 'https://www.atletico.com.br/partidas/fixture/')
     or not public.official_event_source_allowed('soccer', 'https://atletico.com.br/partidas/fixture/')
     or not public.official_event_source_allowed('nfl', 'https://www.philadelphiaeagles.com/schedule/2026/')
     or not public.official_event_source_allowed('nfl', 'https://philadelphiaeagles.com/schedule/2026/')
     or not public.official_event_source_allowed('tennis', 'https://www.toray-ppo.com/result/fixture.pdf') then
    raise exception 'Observed official federation, club, or tournament host was rejected';
  end if;
  if not public.official_event_source_allowed(
    'nhl', 'https://FRONTEND.D3.NHLE.COM:443/game'
  ) then raise exception 'Default HTTPS port or host casing changed URL semantics'; end if;

  if public.official_event_source_allowed('nhl', 'https://www.nhle.com/game') then
    raise exception 'Unlisted www alias was accepted';
  end if;
  if public.official_event_source_allowed('nba', 'https://www.wnba.com/schedule')
     or public.official_event_source_allowed('wnba', 'https://www.nba.com/schedule')
     or public.official_event_source_allowed('nba', 'https://sub.ak-static.cms.nba.com/referee/injury/fixture.pdf')
     or public.official_event_source_allowed('nba', 'https://nba.com.evil.example/schedule') then
    raise exception 'NBA/ WNBA source policies were crossed or an arbitrary host was accepted';
  end if;
  if public.official_event_source_allowed('nhl', 'https://frontend.d3.nhle.com.evil.example/game') then
    raise exception 'Malicious hostname suffix was accepted';
  end if;
  if public.official_event_source_allowed('nhl', 'https://frontend.d3.nhle.com@evil.example/game') then
    raise exception 'Userinfo URL was accepted';
  end if;
  if public.official_event_source_allowed('nhl', 'https://frontend.d3.nhle.com:444/game') then
    raise exception 'Nondefault port was accepted';
  end if;
  if public.official_event_source_allowed('nhl', 'http://frontend.d3.nhle.com/game') then
    raise exception 'Non-HTTPS URL was accepted';
  end if;
  if public.official_event_source_allowed('tennis', 'https://cdn.wtafiles.wtatennis.com/draw.pdf') then
    raise exception 'Arbitrary subdomain was accepted';
  end if;
  if public.official_event_source_allowed('tennis', 'https://frontend.d3.nhle.com/game') then
    raise exception 'Cross-sport official host was accepted';
  end if;
  if public.official_event_source_allowed('soccer', 'https://sub.federacaopr.com.br/game')
     or public.official_event_source_allowed('soccer', 'https://federacaopr.com.br.evil.example/game')
     or public.official_event_source_allowed('soccer', 'https://sub.atletico.com.br/game')
     or public.official_event_source_allowed('nfl', 'https://sub.philadelphiaeagles.com/schedule')
     or public.official_event_source_allowed('tennis', 'https://sub.toray-ppo.com/result.pdf')
     or public.official_event_source_allowed('mlb', 'https://federacaopr.com.br/game')
     or public.official_event_source_allowed('soccer', 'https://philadelphiaeagles.com/schedule')
     or public.official_event_source_allowed('soccer', 'https://toray-ppo.com/result.pdf') then
    raise exception 'Unlisted subdomain, similar hostname, or cross-sport host was accepted';
  end if;
  if public.official_event_source_allowed(null, 'https://nhl.com/game') is distinct from false then
    raise exception 'Null sport did not return false';
  end if;
  if public.official_event_source_allowed('nhl', null) is distinct from false then
    raise exception 'Null URL did not return false';
  end if;
end $$;
rollback;
