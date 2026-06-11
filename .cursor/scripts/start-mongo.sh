#!/usr/bin/env bash
# Starts the local MongoDB as a single-node replica set in the foreground.
#
# The API's write paths (form leads, bookings, cancellations) use
# multi-document transactions via `withTransaction`, which require a replica
# set; a standalone mongod would fail those writes. Replica-set *initiation*
# is handled idempotently by start-api.sh once mongod is reachable.
set -euo pipefail

DATA_DIR="${MONGO_DATA_DIR:-/home/ubuntu/.local-mongo/data}"
mkdir -p "$DATA_DIR"

exec mongod \
  --replSet rs0 \
  --dbpath "$DATA_DIR" \
  --bind_ip 127.0.0.1 \
  --port 27017
