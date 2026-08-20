#!/usr/bin/env bash
# Per-boot Cloud Agent runtime reconciliation.
#
# Starts local mongod (replica set rs0) if it is not already listening, waits
# until the node is PRIMARY, and writes a gitignored local `.env` when missing.
#
# This script must return after readiness. The API itself is started by the
# `api` terminal (start-api.sh). Dashboard secrets may inject Atlas MONGO_URI
# with TEST_MODE=false; start-api.sh overrides those for the Node process.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DATA_DIR="${MONGO_DATA_DIR:-/home/ubuntu/.local-mongo/data}"
LOG_FILE="${MONGO_LOG_FILE:-/home/ubuntu/.local-mongo/mongod.log}"
mkdir -p "$DATA_DIR" "$(dirname "$LOG_FILE")"

mongo_ping() {
  mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1
}

if ! mongo_ping; then
  echo "[ensure-cloud-runtime] starting mongod replica set rs0..."
  mongod \
    --replSet rs0 \
    --dbpath "$DATA_DIR" \
    --bind_ip 127.0.0.1 \
    --port 27017 \
    --logpath "$LOG_FILE" \
    --fork
fi

echo "[ensure-cloud-runtime] waiting for mongod to accept connections..."
for _ in $(seq 1 60); do
  if mongo_ping; then
    break
  fi
  sleep 1
done
if ! mongo_ping; then
  echo "[ensure-cloud-runtime] mongod did not become reachable on 127.0.0.1:27017" >&2
  exit 1
fi

echo "[ensure-cloud-runtime] ensuring rs0 replica set is initiated..."
mongosh --quiet --host 127.0.0.1 --port 27017 --eval '
  try {
    rs.status();
  } catch (e) {
    if (e.codeName === "NotYetInitialized" || e.code === 94) {
      rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] });
    } else {
      throw e;
    }
  }
'

echo "[ensure-cloud-runtime] waiting for PRIMARY..."
for _ in $(seq 1 60); do
  state="$(mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'try { rs.status().myState } catch (e) { 0 }' 2>/dev/null | tail -1 || true)"
  if [ "$state" = "1" ]; then
    break
  fi
  sleep 1
done
state="$(mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'try { rs.status().myState } catch (e) { 0 }' 2>/dev/null | tail -1 || true)"
if [ "$state" != "1" ]; then
  echo "[ensure-cloud-runtime] replica set did not reach PRIMARY" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "[ensure-cloud-runtime] no .env found; writing local-only Cloud defaults..."
  cat > .env <<EOF
# Local Cloud Agent environment (gitignored). Auto-generated.
# Dashboard secrets may still inject Atlas + TEST_MODE=false into the process
# environment; start-api.sh exports local overrides before pnpm dev.
PORT=3000
TEST_MODE=true
MONGO_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
VANTAGE_API_SECRET=local-dev-secret
SHEET_SYNC_MODE=disabled
WRITE_SOURCE_LEAD_SHEETS=false
RINGCENTRAL_CREATE_CALL_LEADS=false
RINGCENTRAL_SHADOW_CALL_LEADS=false
RINGCENTRAL_WEBHOOK_ENABLED=false
RINGCENTRAL_CALL_LOG_SYNC_ENABLED=false
RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED=false
RINGCENTRAL_COLLECTION_MODE=test
SHEET_SYNC_QUEUE_LOCAL_PUBLISH=false
EOF
fi

echo "[ensure-cloud-runtime] local Mongo replica set is PRIMARY on 127.0.0.1:27017"

api_health() {
  curl -sf --max-time 2 "http://127.0.0.1:3000/health" >/dev/null 2>&1
}

if api_health; then
  echo "[ensure-cloud-runtime] API already healthy on http://localhost:3000"
  exit 0
fi

# Dashboard-managed environments only run `start` (not repo `terminals`), so
# bring the API up in the background and wait until /health succeeds.
API_LOG="${API_LOG_FILE:-/home/ubuntu/.local-mongo/api.log}"
echo "[ensure-cloud-runtime] starting API in background (logs: $API_LOG)..."
nohup bash "$ROOT/.cursor/scripts/start-api.sh" >>"$API_LOG" 2>&1 &

echo "[ensure-cloud-runtime] waiting for API /health..."
for _ in $(seq 1 60); do
  if api_health; then
    echo "[ensure-cloud-runtime] API healthy on http://localhost:3000"
    exit 0
  fi
  sleep 1
done

echo "[ensure-cloud-runtime] API did not become healthy on http://localhost:3000" >&2
exit 1
