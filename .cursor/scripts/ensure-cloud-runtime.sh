#!/usr/bin/env bash
# Bounded Linux bootstrap: local replica only; never reads or writes .env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
DATA_DIR=/home/ubuntu/.local-mongo/data
LOG_FILE=/home/ubuntu/.local-mongo/mongod.log
API_LOG=/home/ubuntu/.local-mongo/api.log
for dependency in node mongod mongosh timeout; do
  command -v "$dependency" >/dev/null || { echo "[bootstrap] missing $dependency" >&2; exit 1; }
done
if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  echo '[bootstrap] Node 24 is required to match CI; rebuild the Cloud image.' >&2
  exit 1
fi
mkdir -p "$DATA_DIR"
mongo_ping() {
  timeout 5s mongosh --norc --quiet 'mongodb://127.0.0.1:27017/?directConnection=true' --eval 'db.runCommand({ping:1})' >/dev/null 2>&1
}
if ! mongo_ping; then
  echo '[bootstrap] starting local rs0 on 127.0.0.1:27017'
  timeout 15s mongod --replSet rs0 --dbpath "$DATA_DIR" --bind_ip 127.0.0.1 --port 27017 --logpath "$LOG_FILE" --fork
fi
timeout 10s mongosh --norc --quiet 'mongodb://127.0.0.1:27017/?directConnection=true' --eval '
  try { rs.status(); }
  catch (e) {
    if (e.codeName === "NotYetInitialized" || e.code === 94) {
      rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]});
    } else { throw e; }
  }
'
ready=false
for _ in $(seq 1 15); do
  if node --import tsx ops/local-runtime.ts mongo >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo '[bootstrap] local PRIMARY identity was not verified; refusing API launch.' >&2
  exit 1
fi
# An existing API is never accepted from /health alone. This read verifies DB
# identity only; it cannot attest the environment of an independently started API.
if node --import tsx ops/local-runtime.ts verify >/dev/null 2>&1; then
  echo '[bootstrap] existing API /db identity verified; its launch environment is not attested.'
  exit 0
fi
nohup bash "$ROOT/.cursor/scripts/start-api.sh" >>"$API_LOG" 2>&1 &
api_pid=$!
for _ in $(seq 1 30); do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "[bootstrap] API launcher stopped; inspect $API_LOG" >&2
    exit 1
  fi
  if node --import tsx ops/local-runtime.ts verify >/dev/null 2>&1; then
    echo '[bootstrap] local API and replica identity verified.'
    exit 0
  fi
  sleep 1
done
kill "$api_pid" 2>/dev/null || true
echo "[bootstrap] API readiness timed out; inspect $API_LOG" >&2
exit 1