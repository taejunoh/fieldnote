-- Rollback-only regressions for the Conference USA CFB source exception.
begin;
do $$
declare
  v_url text;
begin
  foreach v_url in array array[
    'https://conferenceusa.com/news/2026/10/26/football-fb-weekday-cusa-wraps-up-in-week-nine.aspx',
    'https://www.conferenceusa.com/schedule.aspx?schedule=4520',
    'https://conferenceusa.com:443/sports/football',
    'https://www.conferenceusa.com:443/sports/football'
  ] loop
    if not public.official_event_source_allowed('cfb', v_url) then
      raise exception 'Official Conference USA CFB host was rejected: %', v_url;
    end if;
  end loop;

  foreach v_url in array array[
    'http://conferenceusa.com/sports/football',
    'https://user@conferenceusa.com/sports/football',
    'https://conferenceusa.com:444/sports/football',
    'https://sub.conferenceusa.com/sports/football',
    'https://conferenceusa.com.evil.example/sports/football'
  ] loop
    if public.official_event_source_allowed('cfb', v_url) then
      raise exception 'Unsafe or lookalike CFB source was accepted: %', v_url;
    end if;
  end loop;

  if public.official_event_source_allowed('mlb', 'https://conferenceusa.com/sports/football') then
    raise exception 'Conference USA source was accepted for another sport';
  end if;

  if not public.official_event_source_allowed('cfb', 'https://ncaa.com/football')
     or not public.official_event_source_allowed('cfb', 'https://www.dsuhornets.com/sports/football/schedule')
     or not public.official_event_source_allowed('nba', 'https://www.nba.com/schedule')
     or not public.official_event_source_allowed('soccer', 'https://www.uefa.com/fixtures-results/') then
    raise exception 'Existing official source behavior changed';
  end if;
end $$;
rollback;
