-- A PostgreSQL POSIX regex prefers the longest opener-indent match unless bounded
-- repetition is made reluctant. Pin the exact live RPC and change only that atom.
do $migration$
declare
  v_definition text;
  v_updated text;
  v_old text := $needle$original_blocks:=regexp_match(c.completion->'result'->>'text','^[ \t]{0,3}```analysis-evaluation$needle$;
  v_new text := $needle$original_blocks:=regexp_match(c.completion->'result'->>'text','^[ \t]{0,3}?```analysis-evaluation$needle$;
begin
  v_definition := pg_get_functiondef('public.repair_saved_evaluation(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure);
  if encode(extensions.digest(v_definition, 'sha256'), 'hex') <> '7dc734938ea3875bc62f1652e48177730d2c70b7e04107c3e4a6c821c2774eb5' then
    raise exception 'Unexpected saved evaluation RPC definition';
  end if;
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'Saved evaluation regex target mismatch';
  end if;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition or replace(v_updated, v_new, v_old) <> v_definition then
    raise exception 'Saved evaluation regex replacement mismatch';
  end if;
  execute v_updated;
end;
$migration$;
