#!/bin/sh
set -eu
DB_NAME="${1:-fieldnote_conditional_entry_sql_20261027}"
case "$DB_NAME" in
  fieldnote_conditional_entry_sql_*) ;;
  *) echo "Refusing non-disposable database name: $DB_NAME" >&2; exit 2 ;;
esac
PSQL="/opt/homebrew/bin/psql"
TMP_A=$(mktemp)
TMP_B=$(mktemp)
trap 'rm -f "$TMP_A" "$TMP_B"' EXIT
"$PSQL" -h /tmp -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/conditional_entry_concurrency_fixture.sql" >/dev/null
CALL="set role service_role; select jsonb_build_object('alreadyRecorded',r->>'alreadyRecorded','eventCreated',r->>'eventCreated','betId',r#>>'{bet,id}') from public.conditional_entry_concurrency_fixture f cross join lateral (select public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-concurrent-001',true,f.snapshot,null,null)) x(r)"
"$PSQL" -h /tmp -U postgres -d "$DB_NAME" -Atq -c "$CALL" >"$TMP_A" &
PID_A=$!
"$PSQL" -h /tmp -U postgres -d "$DB_NAME" -Atq -c "$CALL" >"$TMP_B" &
PID_B=$!
wait "$PID_A"
wait "$PID_B"
printf 'connection A: '; cat "$TMP_A"
printf 'connection B: '; cat "$TMP_B"
COUNTS=$("$PSQL" -h /tmp -U postgres -d "$DB_NAME" -Atq -c "select (select count(*) from public.bets b join public.conditional_entry_concurrency_fixture f using(owner_id) where b.request_key='conditional-concurrent-001')||'|'||(select count(*) from public.events e join public.conditional_entry_concurrency_fixture f using(owner_id) where e.event_key=f.event_key)")
[ "$COUNTS" = "1|1" ] || { echo "expected one bet and one event; got $COUNTS" >&2; exit 1; }
echo "same-key concurrency counts: $COUNTS"
CONFLICT="set role service_role; select public.record_conditional_entry(f.owner_id,f.sport_id,'conditional-concurrent-001',true,jsonb_set(f.snapshot,'{eventKey}',to_jsonb('mlb:2026-10-29:conflict@payload:id-conflict001'::text)),null,null) from public.conditional_entry_concurrency_fixture f"
if CONFLICT_ERROR=$("$PSQL" -h /tmp -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "$CONFLICT" 2>&1); then
  echo "changed-payload replay unexpectedly succeeded" >&2
  exit 1
fi
printf '%s\n' "$CONFLICT_ERROR" | rg -q 'ERROR:[[:space:]]+23505:' || { echo "changed-payload replay failed with an unexpected SQLSTATE" >&2; exit 1; }
ORPHANS=$("$PSQL" -h /tmp -U postgres -d "$DB_NAME" -Atq -c "select count(*) from public.events e join public.conditional_entry_concurrency_fixture f using(owner_id) where e.event_key='mlb:2026-10-29:conflict@payload:id-conflict001'")
[ "$ORPHANS" = "0" ] || { echo "changed replay left an event: $ORPHANS" >&2; exit 1; }
echo "changed-payload replay: SQLSTATE 23505; new-event count $ORPHANS"
echo "synthetic fixture remains only in disposable database $DB_NAME; drop that database to remove it"

