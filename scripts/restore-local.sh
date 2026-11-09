#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/restore-local.sh BACKUP_DIRECTORY

Validation only: verifies the backup checksums, PostgreSQL archive, and
openllms volume archive and SQLite database. It does not change local data.
See docs/local-backup.md for the manually reviewed restore procedure.
EOF
}

fail() { printf 'restore-local: %s\n' "$1" >&2; exit 1; }

if [[ $# -eq 1 && ( "$1" == -h || "$1" == --help ) ]]; then usage; exit 0; fi
[[ $# -eq 1 ]] || { usage >&2; exit 2; }
[[ "$1" != -* ]] || { usage >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || fail 'python3 is required for SQLite integrity checks.'
command -v pg_restore >/dev/null 2>&1 || fail 'pg_restore is required to inspect PostgreSQL archives.'
command -v shasum >/dev/null 2>&1 || fail 'shasum is required to verify backup checksums.'
[[ -d "$1" ]] || fail 'backup directory was not found.'
BACKUP_DIR="$(cd "$1" && pwd)"
[[ -f "$BACKUP_DIR/manifest.txt" && -f "$BACKUP_DIR/SHA256SUMS" && -f "$BACKUP_DIR/supabase.dump" && -f "$BACKUP_DIR/openllms-data.tar.gz" ]] || fail 'backup directory is incomplete.'
grep -Fxq 'format=allinsimple-local-backup-v1' "$BACKUP_DIR/manifest.txt" || fail 'unsupported backup format.'
grep -Fxq 'project_id=allinsimple-edge' "$BACKUP_DIR/manifest.txt" || fail 'backup belongs to a different project.'
[[ "$(wc -l <"$BACKUP_DIR/SHA256SUMS" | tr -d ' ')" == 2 ]] || fail 'checksum manifest must contain exactly two entries.'
(
  cd "$BACKUP_DIR"
  shasum -a 256 -c SHA256SUMS >/dev/null
) || fail 'backup checksum verification failed.'
pg_restore --list "$BACKUP_DIR/supabase.dump" >/dev/null 2>&1 || fail 'Postgres dump integrity check failed.'

TMP="$(mktemp -d "${TMPDIR:-/tmp}/allinsimple-restore-check.XXXXXX")"
chmod 700 "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

if ! python3 - "$BACKUP_DIR/openllms-data.tar.gz" "$TMP/openllms-data" <<'PY'
import os
import sys
import tarfile

archive, destination = sys.argv[1:]
root = os.path.abspath(destination)
try:
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        if not members:
            raise ValueError("empty archive")
        for member in members:
            name = member.name.rstrip("/")
            parts = name.split("/")
            if parts[-1].startswith("._"):
                continue
            if name != "openllms-data" and not name.startswith("openllms-data/"):
                raise ValueError("unexpected path")
            if name.startswith("/") or ".." in parts:
                raise ValueError("unsafe path")
            if not (member.isdir() or member.isfile()):
                raise ValueError("unsupported archive entry")
        os.makedirs(root, mode=0o700, exist_ok=True)
        for member in members:
            path = member.name.rstrip("/")
            if path.split("/")[-1].startswith("._"):
                continue
            if path == "openllms-data":
                continue
            relative = path.removeprefix("openllms-data/")
            target = os.path.abspath(os.path.join(root, relative))
            if os.path.commonpath((root, target)) != root:
                raise ValueError("unsafe destination")
            if member.isdir():
                os.makedirs(target, mode=0o700, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
                stream = source.extractfile(member)
                if stream is None:
                    raise ValueError("missing file data")
                with stream, open(target, "wb") as output:
                    while chunk := stream.read(1024 * 1024):
                        output.write(chunk)
except Exception:
    raise SystemExit(1)
PY
then
  fail 'openllms archive failed safety or integrity checks.'
fi
[[ -s "$TMP/openllms-data/llms.db" ]] || fail 'openllms archive does not contain llms.db.'
if ! python3 - "$TMP/openllms-data/llms.db" <<'PY'
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

printf 'Backup verified. No local data was changed.\n'
printf 'Automated restore is intentionally disabled; see docs/local-backup.md.\n'
