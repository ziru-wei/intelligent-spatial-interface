#!/bin/zsh
# Everything the Mac does for the Vision Pro app.
#
#   visionos/tools/mac.sh prepare [space=atlas]   once, and after editing the space's layout; then build the app again in Xcode
#       exports the space (export-space.mjs), bakes the scan's colours and points (bake_surface_colors.py), and writes the app's connection
#       SpaceData/<space>/agent.json: this Mac's address (<LocalHostName>.local, which survives IP changes) and the token the server
#       asks of other machines (agent-config.local.json visionToken, made once). Nothing is typed on the headset.
#   visionos/tools/mac.sh run [space=atlas]       the agent: the server on the local network (agent API only, with the token) and the
#       bridge answering the space's live session. Ctrl-C stops both. Run again to restart: the previous run is stopped first.
set -e
cd "$(dirname "$0")/../.."
ROOT=$PWD; EDITOR=$ROOT/editor; SPACE=${2:-atlas}; PORT=8766
SESSION=./spaces/$SPACE/scenarios/vision-live/session.json

case "$1" in
  prepare)
    node visionos/tools/export-space.mjs "$SPACE"
    "$EDITOR/.venv-mesh/bin/python" visionos/tools/bake_surface_colors.py "$SPACE"
    "$EDITOR/.venv/bin/python" - "$EDITOR/agent-config.local.json" "$ROOT/visionos/SpaceData/$SPACE/agent.json" "http://$(scutil --get LocalHostName).local:$PORT" "$SESSION" <<'EOF'
import json, secrets, sys
from pathlib import Path
config_path, out, server, session = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
config = json.loads(config_path.read_text()) if config_path.is_file() else {}
if not isinstance(config.get('visionToken'), str) or len(config['visionToken']) < 16:
    config['visionToken'] = secrets.token_urlsafe(24); config_path.write_text(json.dumps(config, indent=2))
out.write_text(json.dumps(dict(server=server, token=config['visionToken'], session=session), indent=2))
print(f'App connection: {server} (written to {out.relative_to(Path.cwd())})')
EOF
    echo "Done. Build and run visionos/SpatialTakeVision.xcodeproj on the Vision Pro."
    ;;
  run)
    cd "$EDITOR"
    # A previous run (or the editor's own server on this port) is replaced: its server.py on the port and the bridges for this
    # session, nothing else.
    for pid in $(lsof -t -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
      if ps -o command= -p $pid | grep -q "scripts/server.py"; then echo "Stopping the previous server (pid $pid)"; kill $pid; fi
    done
    for pid in $(pgrep -f "agent-bridge.mjs.*--session $SESSION"); do echo "Stopping a previous bridge (pid $pid)"; kill $pid; done
    for i in {1..30}; do lsof -t -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.2; done
    if lsof -t -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $PORT is still in use by something else:"; lsof -nP -iTCP:$PORT -sTCP:LISTEN; exit 1
    fi
    .venv/bin/python scripts/server.py $PORT --lan &
    SERVER=$!
    trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
    until curl -s -o /dev/null http://127.0.0.1:$PORT/; do
      kill -0 $SERVER 2>/dev/null || { echo "The server did not start."; exit 1; }
      sleep 0.3
    done
    node scripts/agent-bridge.mjs --url http://127.0.0.1:$PORT --session "$SESSION"
    ;;
  *)
    echo "usage: visionos/tools/mac.sh prepare|run [space]"; exit 1 ;;
esac
