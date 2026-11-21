#!/usr/bin/env bash
# Claude Code SessionStart hook (registered in .claude/settings.json).
#
# Cloud sessions only: does nothing unless CLAUDE_CODE_REMOTE=true, so local
# Windows/Linux sessions are unaffected.
#
# 1. Installs dependencies with the frozen lockfile.
# 2. Starts the local MongoDB 8.0 test replicas in Docker, bound to loopback only:
#      csi01 on 127.0.0.1:27189 (replica suites: TEST_MONGO_DATABASE_NAME=testvantagemovers_<suffix>)
#      rs0   on 127.0.0.1:27017 (pnpm dev / pnpm vantage local profile)
# Never reads or writes .env and never contacts production.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 0
log() { echo "[vantage-session] $*"; }

if command -v pnpm >/dev/null; then
  pnpm install --frozen-lockfile --reporter=silent && log "dependencies installed" || log "pnpm install failed"
else
  log "pnpm missing: the environment setup script (ops/cloud-session/setup.sh) did not run"
fi

command -v docker >/dev/null || { log "docker unavailable; replica tests cannot run"; exit 0; }
if ! docker info >/dev/null 2>&1; then
  (sudo -n dockerd >/tmp/dockerd.log 2>&1 &) 2>/dev/null || (dockerd >/tmp/dockerd.log 2>&1 &) || true
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker info >/dev/null 2>&1 || { log "dockerd not running; see /tmp/dockerd.log"; exit 0; }

start_replica() { # name port set
  local name=$1 port=$2 set=$3
  if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      docker start "$name" >/dev/null
    else
      docker run -d --name "$name" -p "127.0.0.1:${port}:${port}" mongo:8.0 \
        --replSet "$set" --port "$port" --bind_ip_all >/dev/null
    fi
  fi
  for _ in $(seq 1 30); do
    docker exec "$name" mongosh --quiet --port "$port" --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$name" mongosh --quiet --port "$port" --eval "
    try { rs.status() } catch (e) {
      if (e.code === 94 || e.codeName === 'NotYetInitialized') {
        rs.initiate({_id:'$set',members:[{_id:0,host:'127.0.0.1:$port'}]})
      } else { throw e }
    }" >/dev/null 2>&1
  for _ in $(seq 1 30); do
    [ "$(docker exec "$name" mongosh --quiet --port "$port" --eval 'db.hello().isWritablePrimary' 2>/dev/null)" = "true" ] && { log "$name PRIMARY on 127.0.0.1:$port"; return 0; }
    sleep 1
  done
  log "$name did not become PRIMARY"
}

start_replica csi01 27189 csi01
start_replica vantage-local-mongo 27017 rs0
exit 0
