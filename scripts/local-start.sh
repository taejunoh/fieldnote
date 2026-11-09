#!/bin/bash
set -Eeuo pipefail
umask 077
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
STATE_DIR="${HOME}/Library/Application Support/SportsDesk"
PID_FILE="${STATE_DIR}/supervisor.pid"
SUPABASE_PROJECT="allinsimple-edge"
LOCAL_NETWORK="local-network"
APP_PID=""
WORKER_PID=""
TEMP_OUTPUT=""
APP_ONLY=false
case "${1:-}" in
  "") ;;
  --app-only) APP_ONLY=true ;;
  *) echo "Usage: $0 [--app-only]" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo "Usage: $0 [--app-only]" >&2; exit 2; }

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if ! mkdir "$STATE_DIR/active" 2>/dev/null; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "AllinSimple Desk is already running (supervisor PID $old_pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
  rmdir "$STATE_DIR/active" 2>/dev/null || true
  mkdir "$STATE_DIR/active"
fi
printf '%s\n' "$$" > "$PID_FILE"

# shellcheck disable=SC2329 # Called through the EXIT trap.
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  for child in "$APP_PID" "$WORKER_PID"; do
    if [[ -n "$child" ]] && kill -0 "$child" 2>/dev/null; then
      kill -TERM "$child" 2>/dev/null || true
    fi
  done
  for child in "$APP_PID" "$WORKER_PID"; do
    if [[ -n "$child" ]]; then wait "$child" 2>/dev/null || true; fi
  done
  [[ -n "$TEMP_OUTPUT" ]] && rm -f "$TEMP_OUTPUT"
  if [[ "$(cat "$PID_FILE" 2>/dev/null || true)" == "$$" ]]; then rm -f "$PID_FILE"; fi
  rmdir "$STATE_DIR/active" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

fail() { echo "local-start: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"; }
wait_http() {
  local url="$1" label="$2"
  for _ in {1..60}; do
    if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$label is healthy."
      return 0
    fi
    sleep 2
  done
  fail "$label did not become healthy within 120 seconds."
}

cd "$ROOT"
if [[ "$APP_ONLY" == false ]]; then
  need docker
  need supabase
fi
need curl
need npm
need lsof
[[ -d node_modules ]] || fail "node_modules is missing; install dependencies first."
[[ -f .env.local ]] || fail ".env.local is missing."

# Read settings through Next's dotenv loader, but only emit validation status.
node <<'NODE'
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const fail = (message) => { console.error(`local-start: ${message}`); process.exit(1); };
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENLLMS_BASE_URL", "OPENLLMS_API_KEY"];
if (required.some((key) => !process.env[key]?.trim())) fail("Required local environment settings are missing.");
let supabase;
let gateway;
try {
  supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  gateway = new URL(process.env.OPENLLMS_BASE_URL);
} catch { fail("A local service URL is invalid."); }
if (!supabase || supabase.protocol !== "http:" || !["127.0.0.1:54321", "localhost:54321"].includes(supabase.host)) fail("NEXT_PUBLIC_SUPABASE_URL must point to local Supabase on port 54321.");
if (!gateway || gateway.protocol !== "http:" || !["127.0.0.1:8080", "localhost:8080"].includes(gateway.host) || !/^\/r\/[^/]+\/v1\/?$/.test(gateway.pathname)) fail("OPENLLMS_BASE_URL must point to a local gateway route on port 8080.");
NODE

if [[ "$APP_ONLY" == true ]]; then
  # Attach only the app and worker to services already managed separately.
  # Do not create, rebind, stop, or restart any Docker service in this mode.
  wait_http "http://127.0.0.1:54321/auth/v1/health" "Existing local Supabase"
  wait_http "http://127.0.0.1:8080/health" "Existing local gateway"
else

docker info >/dev/null 2>&1 || fail "Docker Desktop is not ready."

# Validate any existing Supabase stack before making local Docker changes.
network_binding=""
if docker network inspect "$LOCAL_NETWORK" >/dev/null 2>&1; then
  network_binding="$(docker network inspect --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}' "$LOCAL_NETWORK" 2>/dev/null || true)"
  [[ "$network_binding" == "127.0.0.1" ]] || fail "Docker network '$LOCAL_NETWORK' is not configured for loopback-only port bindings."
fi
supabase_ids="$(docker ps -q --filter "label=com.supabase.cli.project=${SUPABASE_PROJECT}" 2>/dev/null || true)"
if [[ -n "$supabase_ids" ]]; then
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    bindings="$(docker inspect --format '{{range $port, $entries := .HostConfig.PortBindings}}{{range $entries}}{{if eq .HostIp ""}}__unspecified__ {{else}}{{.HostIp}} {{end}}{{end}}{{end}}' "$container" 2>/dev/null || true)"
    for binding in $bindings; do
      [[ "$binding" == "127.0.0.1" || "$binding" == "::1" ]] || fail "A Supabase service is running with a non-loopback published port. Set Docker Desktop to localhost-only port binding or use an isolated Supabase stack before enabling automatic startup."
    done
    networks="$(docker inspect --format '{{range $network, $_ := .NetworkSettings.Networks}}{{$network}} {{end}}' "$container" 2>/dev/null || true)"
    [[ " $networks " == *" ${LOCAL_NETWORK} "* ]] || fail "A Supabase service is already running outside '$LOCAL_NETWORK'. After taking and verifying a backup, stop that stack and rerun this command to bind it safely."
  done <<< "$supabase_ids"
fi
# Supabase binds published ports to 127.0.0.1 when this bridge option is set.
if [[ -z "$network_binding" ]]; then
  docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$LOCAL_NETWORK" >/dev/null || fail "Could not create the loopback-only Docker network."
fi
TEMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/allinsimple-supabase.XXXXXX")"
chmod 600 "$TEMP_OUTPUT"
if ! supabase start --network-id "$LOCAL_NETWORK" --workdir "$ROOT" >"$TEMP_OUTPUT" 2>&1; then
  fail "Supabase could not start. Its CLI output was suppressed to keep generated local keys out of terminal logs."
fi
rm -f "$TEMP_OUTPUT"
TEMP_OUTPUT=""
wait_http "http://127.0.0.1:54321/auth/v1/health" "Local Supabase"

# Docker Desktop may ignore the bridge's default bind option. Verify the
# published listeners after recreation instead of trusting network metadata.
supabase_ids="$(docker ps -q --filter "label=com.supabase.cli.project=${SUPABASE_PROJECT}" 2>/dev/null || true)"
for container in $supabase_ids; do
  bindings="$(docker inspect --format '{{range $port, $entries := .HostConfig.PortBindings}}{{range $entries}}{{if eq .HostIp ""}}__unspecified__ {{else}}{{.HostIp}} {{end}}{{end}}{{end}}' "$container" 2>/dev/null || true)"
  for binding in $bindings; do
    if [[ "$binding" != "127.0.0.1" && "$binding" != "::1" ]]; then
      supabase stop --workdir "$ROOT" >/dev/null 2>&1 || true
      fail "Docker published a Supabase port outside loopback despite the private bridge. Supabase was stopped to avoid leaving its data services exposed."
    fi
  done
done

# An empty bootstrap token keeps the one-time gateway bootstrap endpoint disabled.
export OPENLLMS_BOOTSTRAP_TOKEN=""
TEMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/allinsimple-gateway.XXXXXX")"
chmod 600 "$TEMP_OUTPUT"
if ! docker compose -f gateway/compose.yaml up -d >"$TEMP_OUTPUT" 2>&1; then
  fail "The local gateway could not start; container output was suppressed to avoid leaking environment values."
fi
rm -f "$TEMP_OUTPUT"
TEMP_OUTPUT=""
wait_http "http://127.0.0.1:8080/health" "Local gateway"
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "Building the production app..."
  npm run build
fi

if lsof -nP -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "Port 3000 is already occupied; stop the existing listener before starting the production app."
fi
./node_modules/.bin/next start -H 127.0.0.1 >"$STATE_DIR/app.log" 2>&1 &
APP_PID=$!
./node_modules/.bin/tsx scripts/analysis-worker.ts >"$STATE_DIR/worker.log" 2>&1 &
WORKER_PID=$!
wait_http "http://127.0.0.1:3000/" "Production app"
echo "AllinSimple Desk is running at http://127.0.0.1:3000."
echo "The analysis worker runs independent sports concurrently (default 2, configured by ANALYSIS_CONCURRENCY) and restarts after a crash. Press Ctrl-C to stop the app and worker."

# The worker's own loop retries transient failures. Restart the process if it exits;
# if Next exits, exit so launchd can restart the complete local service.
process_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -n "$state" && "$state" != Z* && "$state" != *Z* ]]
}
while process_running "$APP_PID"; do
  if ! process_running "$WORKER_PID"; then
    wait "$WORKER_PID" 2>/dev/null || true
    WORKER_PID=""
    sleep 2
    ./node_modules/.bin/tsx scripts/analysis-worker.ts >>"$STATE_DIR/worker.log" 2>&1 &
    WORKER_PID=$!
  fi
  sleep 2
done
wait "$APP_PID"
fail "The production app exited; launchd will restart the service when installed as an agent."
