-- Rollback-only fixtures for the observed official CFB school source domains.
begin;
do $$
declare
  v_host text;
  v_url text;
begin
  foreach v_host in array array[
    'dsuhornets.com', 'virginiasports.com', 'uconnhuskies.com', 'pennathletics.com',
    'tulsahurricane.com', 'goairforcefalcons.com', 'gostanford.com'
  ] loop
    foreach v_url in array array[
      format('https://%s/sports/football/schedule', v_host),
      format('https://www.%s/sports/football/schedule', v_host),
      format('https://%s:443/sports/football/schedule', v_host),
      format('https://www.%s:443/sports/football/schedule', v_host)
    ] loop
      if not public.official_event_source_allowed('cfb', v_url) then
        raise exception 'Observed official CFB host was rejected: %', v_url;
      end if;
    end loop;
  end loop;

  if not public.official_event_source_allowed('cfb', 'https://ncaa.com/football')
     or not public.official_event_source_allowed('cfb', 'https://www.collegefootballplayoff.com:443/schedule') then
    raise exception 'Existing official CFB source host was rejected';
  end if;

  foreach v_url in array array[
    'http://www.dsuhornets.com/sports/football/schedule',
    'https://user@www.dsuhornets.com/sports/football/schedule',
    'https://www.dsuhornets.com:444/sports/football/schedule',
    'https://sub.dsuhornets.com/sports/football/schedule',
    'https://dsuhornets.com.evil.example/sports/football/schedule'
  ] loop
    if public.official_event_source_allowed('cfb', v_url) then
      raise exception 'Unsafe or unregistered CFB source was accepted: %', v_url;
    end if;
  end loop;

  if public.official_event_source_allowed('mlb', 'https://www.dsuhornets.com/sports/football/schedule') then
    raise exception 'CFB school source was accepted for another sport';
  end if;
  if not public.official_event_source_allowed('mlb', 'https://www.mlb.com/schedule')
     or not public.official_event_source_allowed('soccer', 'https://www.uefa.com/fixtures-results/') then
    raise exception 'Existing non-CFB official source behavior changed';
  end if;
end $$;
rollback;
