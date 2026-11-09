#!/bin/bash
set -Eeuo pipefail
umask 077
START_MODE="${1:-}"
case "$START_MODE" in
  ""|--app-only) ;;
  *) echo "Usage: $0 [--app-only]" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo "Usage: $0 [--app-only]" >&2; exit 2; }

[[ "$(uname -s)" == "Darwin" ]] || { echo "LaunchAgent installation is supported on macOS only." >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
AGENT_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/SportsDesk"
PLIST="$AGENT_DIR/com.sportsdesk.local.plist"
UID_VALUE="$(id -u)"

mkdir -p "$AGENT_DIR" "$LOG_DIR"
chmod 700 "$LOG_DIR"
python3 - "$ROOT" "$PLIST" "$LOG_DIR" "$START_MODE" <<'PY'
import os
import plistlib
import sys

root, plist_path, log_dir, start_mode = sys.argv[1:]
label = "com.sportsdesk.local"
arguments = ["/bin/bash", os.path.join(root, "scripts", "local-start.sh")]
if start_mode == "--app-only":
    arguments.append(start_mode)
agent = {
    "Label": label,
    "ProgramArguments": arguments,
    "WorkingDirectory": root,
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
    "StandardOutPath": os.path.join(log_dir, "launchd.stdout.log"),
    "StandardErrorPath": os.path.join(log_dir, "launchd.stderr.log"),
}
with open(plist_path, "wb") as f:
    plistlib.dump(agent, f, sort_keys=True)
os.chmod(plist_path, 0o600)
PY

launchctl bootout "gui/$UID_VALUE/com.sportsdesk.local" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl enable "gui/$UID_VALUE/com.sportsdesk.local"
echo "Installed and started the Sports Desk LaunchAgent."
echo "Use scripts/local-stop.sh to stop it; remove it with launchctl bootout gui/$UID_VALUE/com.sportsdesk.local."
