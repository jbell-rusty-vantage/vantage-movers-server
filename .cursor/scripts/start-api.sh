#!/usr/bin/env bash
# The cross-platform launcher strips inherited credentials, excludes .env/token
# caches, verifies the replica, and verifies /db before declaring readiness.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --import tsx ops/local-runtime.ts start