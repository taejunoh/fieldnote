-- Add only the FIFA-listed CBF official website to soccer source admission.
-- Guard the exact production function SHA and exact soccer branch; replace only that branch.
do $migration$
declare
  v_definition text;
  v_expected_definition_sha256 text := 'd85ac898dca3afb52e07d0a2020377c6e533d545013d1097148f02e19987fb0d';
  v_old text := $host$    when 'soccer' then p_url ~* '^https://(fifa\.com|www\.fifa\.com|uefa\.com|www\.uefa\.com|mlssoccer\.com|www\.mlssoccer\.com|premierleague\.com|www\.premierleague\.com|dcunited\.com|www\.dcunited\.com|atlasfc\.com\.mx|www\.atlasfc\.com\.mx|clubpuebla\.com|www\.clubpuebla\.com|tuzos\.com\.mx|www\.tuzos\.com\.mx|clubsantos\.mx|www\.clubsantos\.mx|bundesliga\.com|www\.bundesliga\.com|laliga\.com|www\.laliga\.com|acmonza\.com|www\.acmonza\.com|ogcnice\.com|www\.ogcnice\.com|chicagostars\.com|www\.chicagostars\.com|reignfc\.com|www\.reignfc\.com|thorns\.com|www\.thorns\.com|federacaopr\.com\.br|www\.federacaopr\.com\.br|atletico\.com\.br|www\.atletico\.com\.br)(:443)?([/?#]|$)'$host$;
  v_new text;
begin
  v_definition := pg_get_functiondef('public.official_event_source_allowed(text,text)'::regprocedure);

  if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v_expected_definition_sha256 then
    raise exception 'Expected production official-source function SHA before CBF migration';
  end if;

  if strpos(v_definition, v_old) = 0
     or length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'Expected current soccer source-host branch exactly once';
  end if;

  v_new := replace(v_old, $anchor$www\.atletico\.com\.br)(:443)$anchor$, $replacement$www\.atletico\.com\.br|www\.cbf\.com\.br)(:443)$replacement$);
  if v_new = v_old or strpos(v_new, '|www\.cbf\.com\.br') = 0 then
    raise exception 'CBF host branch replacement did not produce the exact expected addition';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$migration$;
