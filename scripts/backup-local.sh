#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/gateway/compose.yaml"
PROJECT_ID="allinsimple-edge"

usage() {
  cat <<'EOF'
Usage: scripts/backup-local.sh [DESTINATION_DIRECTORY]

Creates a private, timestamped backup directory containing the local Supabase
Postgres database and the openllms-data Docker volume. The destination must not
already exist. Keep the resulting directory private; it contains credentials.
EOF
}

fail() { printf 'backup-local: %s\n' "$1" >&2; exit 1; }
compose() { OPENLLMS_BOOTSTRAP_TOKEN='' docker compose -f "$COMPOSE_FILE" "$@"; }

if [[ $# -eq 1 && ( "$1" == -h || "$1" == --help ) ]]; then usage; exit 0; fi
[[ $# -le 1 ]] || { usage >&2; exit 2; }
if [[ $# -eq 1 && "$1" == -* ]]; then usage >&2; exit 2; fi
command -v docker >/dev/null 2>&1 || fail 'docker is required.'
command -v python3 >/dev/null 2>&1 || fail 'python3 is required for SQLite integrity checks.'
command -v shasum >/dev/null 2>&1 || fail 'shasum is required to create backup checksums.'
[[ -f "$COMPOSE_FILE" ]] || fail 'gateway/compose.yaml was not found.'

if [[ $# -eq 1 ]]; then
  DEST_PARENT="$(dirname "$1")"
  DEST_NAME="$(basename "$1")"
else
  DATA_ROOT="${XDG_DATA_HOME:-${HOME:?HOME or XDG_DATA_HOME must be set}/.local/share}"
  DEST_PARENT="$DATA_ROOT/allinsimple-edge/backups"
  DEST_NAME="local-$(date '+%Y%m%dT%H%M%S')"
fi
mkdir -p "$DEST_PARENT"
DEST="$(cd "$DEST_PARENT" && pwd)/$DEST_NAME"
case "$DEST/" in
  "$ROOT_DIR/"*) fail 'backup destinations inside the repository are refused because backups contain credentials.' ;;
esac
[[ ! -e "$DEST" ]] || fail 'destination already exists; choose a new directory.'
umask 077
mkdir -m 700 "$DEST"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/allinsimple-backup.XXXXXX")"
chmod 700 "$STAGE"
PAUSED_CONTAINER=''
COMPLETE=0
cleanup() {
  local result=$?
  if [[ -n "$PAUSED_CONTAINER" ]]; then
    docker unpause "$PAUSED_CONTAINER" >/dev/null 2>&1 || {
      printf 'backup-local: could not resume the openllms container; run docker unpause manually.\n' >&2
      result=1
    }
  fi
  rm -rf "$STAGE"
  if [[ $COMPLETE -ne 1 ]]; then rm -rf "$DEST"; fi
  exit "$result"
}
trap cleanup EXIT INT TERM

DB_CONTAINER="supabase_db_${PROJECT_ID}"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "local Supabase database container '$DB_CONTAINER' is not present. Start the local Supabase stack first."
DB_RUNNING="$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)"
[[ "$DB_RUNNING" == true ]] || fail 'local Supabase database container is not running.'

GATEWAY_OUTPUT="$(compose ps --status running -q openllms 2>/dev/null)"
[[ -n "$GATEWAY_OUTPUT" && "$GATEWAY_OUTPUT" != *$'\n'* ]] || fail 'expected exactly one running openllms service container from gateway/compose.yaml.'
GATEWAY_CONTAINER="$GATEWAY_OUTPUT"
GATEWAY_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$GATEWAY_CONTAINER" 2>/dev/null)"
[[ -n "$GATEWAY_VOLUME" ]] || fail 'could not identify the openllms /data Docker volume.'

mkdir -m 700 "$STAGE/openllms-data"
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres -Fc --no-owner --no-acl >"$STAGE/supabase.dump" || fail 'Postgres dump failed.'
[[ -s "$STAGE/supabase.dump" ]] || fail 'Postgres dump is empty.'
docker exec -i "$DB_CONTAINER" pg_restore --list <"$STAGE/supabase.dump" >/dev/null 2>&1 || fail 'Postgres dump integrity check failed.'

# Freeze writes while copying SQLite and its WAL files as one consistent snapshot.
docker pause "$GATEWAY_CONTAINER" >/dev/null || fail 'could not pause openllms for a consistent volume snapshot.'
PAUSED_CONTAINER="$GATEWAY_CONTAINER"
docker cp "$GATEWAY_CONTAINER:/data/." "$STAGE/openllms-data/" >/dev/null || fail 'could not copy the openllms data volume.'
[[ -s "$STAGE/openllms-data/llms.db" ]] || fail 'openllms volume does not contain /data/llms.db.'

if ! python3 - "$STAGE/openllms-data/llms.db" <<'PY'
import sqlite3
import sys

try:
    connection = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    result = connection.execute("PRAGMA integrity_check").fetchone()
    connection.close()
except Exception:
    raise SystemExit(1)
if result != ("ok",):
    raise SystemExit(1)
PY
then
  fail 'SQLite integrity check failed.'
fi

COPYFILE_DISABLE=1 tar -czf "$STAGE/openllms-data.tar.gz" --exclude='._*' --exclude='*/._*' -C "$STAGE" openllms-data || fail 'could not archive the openllms volume.'
tar -tzf "$STAGE/openllms-data.tar.gz" >/dev/null 2>&1 || fail 'openllms volume archive integrity check failed.'
rm -rf "$STAGE/openllms-data"
(
  cd "$STAGE"
  shasum -a 256 supabase.dump openllms-data.tar.gz > SHA256SUMS
)
cat >"$STAGE/manifest.txt" <<EOF
format=allinsimple-local-backup-v1
project_id=$PROJECT_ID
database=supabase.dump (PostgreSQL custom archive; pg_restore --list checked)
openllms=openllms-data.tar.gz (SQLite integrity_check and tar listing checked)
EOF

# Resume the gateway before publishing the completed backup.
docker unpause "$PAUSED_CONTAINER" >/dev/null || fail 'could not resume the openllms container.'
PAUSED_CONTAINER=''
cp -p "$STAGE/supabase.dump" "$DEST/supabase.dump"
cp -p "$STAGE/openllms-data.tar.gz" "$DEST/openllms-data.tar.gz"
cp -p "$STAGE/SHA256SUMS" "$DEST/SHA256SUMS"
cp -p "$STAGE/manifest.txt" "$DEST/manifest.txt"
chmod 600 "$DEST"/*
COMPLETE=1
printf 'Backup created and verified: %s\n' "$DEST"
