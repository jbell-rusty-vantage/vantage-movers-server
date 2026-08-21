#!/usr/bin/env bash
# Starts the local MongoDB as a single-node replica set in the foreground.
#
# The API's write paths (form leads, bookings, cancellations) use
# multi-document transactions via `withTransaction`, which require a replica
# set; a standalone mongod would fail those writes. Replica-set *initiation*
# is handled idempotently by start-api.sh / ensure-cloud-runtime.sh once
# mongod is reachable.
#
# If ensure-cloud-runtime.sh already forked mongod, this terminal stays
# attached by watching the existing process instead of binding port 27017 twice.
set -euo pipefail

DATA_DIR="${MONGO_DATA_DIR:-/home/ubuntu/.local-mongo/data}"
mkdir -p "$DATA_DIR"

mongo_ping() {
  mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1
}

if mongo_ping; then
  echo "[start-mongo] mongod already listening on 127.0.0.1:27017; attaching..."
  while mongo_ping; do
    sleep 10
  done
  echo "[start-mongo] existing mongod stopped" >&2
  exit 1
fi

exec mongod \
  --replSet rs0 \
  --dbpath "$DATA_DIR" \
  --bind_ip 127.0.0.1 \
  --port 27017
