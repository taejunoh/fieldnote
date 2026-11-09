#!/bin/bash
set -Eeuo pipefail

STATE_DIR="${HOME}/Library/Application Support/SportsDesk"
PID_FILE="${STATE_DIR}/supervisor.pid"
LABEL="com.sportsdesk.local"

if [[ "$(uname -s)" == "Darwin" ]] && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
  kill -TERM "$pid"
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "Supervisor PID $pid is still stopping; no forced kill was sent." >&2
    exit 1
  fi
  echo "AllinSimple Desk app and worker stopped."
else
  rm -f "$PID_FILE"
  rmdir "$STATE_DIR/active" 2>/dev/null || true
  echo "AllinSimple Desk app and worker are not running."
fi
echo "Supabase and gateway containers remain running."
