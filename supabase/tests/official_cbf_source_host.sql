-- Rollback-only parity checks for the exact official CBF soccer host.
begin;
do $$
begin
  if not public.official_event_source_allowed(
    'soccer', 'https://www.cbf.com.br/football/fixtures/test-match'
  ) or not public.official_event_source_allowed('soccer', 'https://www.cbf.com.br:443/futebol-brasileiro/jogos/fixture') then
    raise exception 'FIFA-listed exact CBF website was rejected';
  end if;

  if public.official_event_source_allowed('soccer', 'https://cbf.com.br/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('soccer', 'https://sub.www.cbf.com.br/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('soccer', 'https://www.cbf.com.br.evil.example/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('soccer', 'https://www.cbf.com.br@evil.example/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('soccer', 'https://www.cbf.com.br:444/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('soccer', 'http://www.cbf.com.br/futebol-brasileiro/jogos/fixture')
     or public.official_event_source_allowed('nfl', 'https://www.cbf.com.br/futebol-brasileiro/jogos/fixture') then
    raise exception 'Nonexact, unsafe, cross-sport, or non-HTTPS CBF host was accepted';
  end if;

  if not public.official_event_source_allowed('soccer', 'https://www.fifa.com/')
     or not public.official_event_source_allowed('soccer', 'https://www.federacaopr.com.br/campeonato/profissional/fixture')
     or not public.official_event_source_allowed('soccer', 'https://www.atletico.com.br/partidas/fixture/') then
    raise exception 'Existing soccer official hosts changed';
  end if;

  if not public.official_event_source_allowed('tennis', 'https://www.toray-ppo.com/result/fixture.pdf')
     or public.official_event_source_allowed('tennis', 'https://www.erstebank-open.com/en/scores/schedule')
     or public.official_event_source_allowed('tennis', 'https://www.swissindoorsbasel.ch/en/tournament/match-schedule/') then
    raise exception 'Old production tennis host policy changed';
  end if;
end $$;
rollback;
