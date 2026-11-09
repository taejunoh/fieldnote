-- Extend only the deployed CFB official-source host list. Preserve the
-- installed function body and every non-CFB source rule verbatim.
do $migration$
declare
  v_definition text;
  v_old text := $host$when 'cfb' then p_url ~* '^https://(ncaa\.com|www\.ncaa\.com|collegefootballplayoff\.com|www\.collegefootballplayoff\.com|dsuhornets\.com|www\.dsuhornets\.com|virginiasports\.com|www\.virginiasports\.com|uconnhuskies\.com|www\.uconnhuskies\.com|pennathletics\.com|www\.pennathletics\.com|tulsahurricane\.com|www\.tulsahurricane\.com|goairforcefalcons\.com|www\.goairforcefalcons\.com|gostanford\.com|www\.gostanford\.com)(:443)?([/?#]|$)'$host$;
  v_new text := $host$when 'cfb' then p_url ~* '^https://(ncaa\.com|www\.ncaa\.com|collegefootballplayoff\.com|www\.collegefootballplayoff\.com|dsuhornets\.com|www\.dsuhornets\.com|virginiasports\.com|www\.virginiasports\.com|uconnhuskies\.com|www\.uconnhuskies\.com|pennathletics\.com|www\.pennathletics\.com|tulsahurricane\.com|www\.tulsahurricane\.com|goairforcefalcons\.com|www\.goairforcefalcons\.com|gostanford\.com|www\.gostanford\.com|conferenceusa\.com|www\.conferenceusa\.com)(:443)?([/?#]|$)'$host$;
begin
  v_definition := pg_get_functiondef('public.official_event_source_allowed(text,text)'::regprocedure);

  if strpos(v_definition, v_old) = 0
     or length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'Expected current CFB official-source host policy exactly once';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$migration$;
