-- Rollback-only fixtures for the observed official soccer league and club domains.
begin;
do $$
declare
  v_host text;
  v_url text;
begin
  foreach v_host in array array[
    'bundesliga.com', 'laliga.com', 'acmonza.com', 'ogcnice.com',
    'chicagostars.com', 'reignfc.com', 'thorns.com'
  ] loop
    foreach v_url in array array[
      format('https://%s/match/fixture', v_host),
      format('https://www.%s/match/fixture', v_host),
      format('https://%s:443/match/fixture', v_host),
      format('https://www.%s:443/match/fixture', v_host)
    ] loop
      if not public.official_event_source_allowed('soccer', v_url) then
        raise exception 'Observed official soccer host was rejected: %', v_url;
      end if;
    end loop;
  end loop;

  if not public.official_event_source_allowed('soccer', 'https://www.premierleague.com/match/fixture')
     or not public.official_event_source_allowed('soccer', 'https://www.dcunited.com/match/fixture')
     or not public.official_event_source_allowed('soccer', 'https://www.atlasfc.com.mx/partidos/fixture')
     or not public.official_event_source_allowed('soccer', 'https://www.clubpuebla.com/partidos/fixture')
     or not public.official_event_source_allowed('soccer', 'https://tuzos.com.mx/partidos/fixture')
     or not public.official_event_source_allowed('soccer', 'https://www.clubsantos.mx/partidos/fixture') then
    raise exception 'Existing official soccer host was rejected';
  end if;

  foreach v_url in array array[
    'http://www.bundesliga.com/match/fixture',
    'https://user@www.laliga.com/match/fixture',
    'https://www.acmonza.com:444/match/fixture',
    'https://sub.ogcnice.com/match/fixture',
    'https://chicagostars.com.evil.example/match/fixture'
  ] loop
    if public.official_event_source_allowed('soccer', v_url) then
      raise exception 'Unsafe or unregistered soccer source was accepted: %', v_url;
    end if;
  end loop;

  if public.official_event_source_allowed('mlb', 'https://www.thorns.com/match/fixture') then
    raise exception 'Soccer host was accepted for another sport';
  end if;
  if not public.official_event_source_allowed('cfb', 'https://www.dsuhornets.com/sports/football/schedule')
     or not public.official_event_source_allowed('soccer', 'https://www.uefa.com/fixtures-results/') then
    raise exception 'CFB or legacy soccer host behavior changed';
  end if;
end $$;
rollback;
