-- Rollback-only fixtures for the observed official soccer club source domains.
begin;
do $$
declare
  v_url text;
begin
  foreach v_url in array array[
    'https://www.dcunited.com/match/fixture',
    'https://www.atlasfc.com.mx/partidos/fixture',
    'https://www.clubpuebla.com/partidos/fixture',
    'https://tuzos.com.mx/partidos/fixture',
    'https://www.clubsantos.mx/partidos/fixture'
  ] loop
    if not public.official_event_source_allowed('soccer', v_url) then
      raise exception 'Observed official soccer club host was rejected: %', v_url;
    end if;
  end loop;

  if not public.official_event_source_allowed('soccer', 'https://dcunited.com/match/fixture')
     or not public.official_event_source_allowed('soccer', 'https://WWW.ATLASFC.COM.MX:443/partidos/fixture') then
    raise exception 'Registered-domain apex/www normalization or default HTTPS port changed';
  end if;

  if public.official_event_source_allowed('soccer', 'https://sub.dcunited.com/match/fixture') then
    raise exception 'Arbitrary soccer club subdomain was accepted';
  end if;
  if public.official_event_source_allowed('soccer', 'https://dcunited.com.evil.example/match/fixture') then
    raise exception 'Malicious soccer club hostname suffix was accepted';
  end if;
  if public.official_event_source_allowed('soccer', 'https://user@www.dcunited.com/match/fixture') then
    raise exception 'Soccer source URL with userinfo was accepted';
  end if;
  if public.official_event_source_allowed('soccer', 'https://www.dcunited.com:444/match/fixture') then
    raise exception 'Nondefault soccer source port was accepted';
  end if;
  if public.official_event_source_allowed('soccer', 'http://www.dcunited.com/match/fixture') then
    raise exception 'Non-HTTPS soccer source URL was accepted';
  end if;
  if public.official_event_source_allowed('mlb', 'https://www.dcunited.com/match/fixture') then
    raise exception 'Soccer club source was accepted for another sport';
  end if;
  if not public.official_event_source_allowed('soccer', 'https://www.uefa.com/uefachampionsleague/fixtures-results/') then
    raise exception 'Existing official soccer source host was rejected';
  end if;
end $$;
rollback;
