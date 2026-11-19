#!/usr/bin/env bash
# Cloud bootstrap owns Mongo startup/init. This terminal only observes identity.
set -euo pipefail
cd "$(dirname "$0")/../.."
echo '[mongo] observing the replica started by ensure-cloud-runtime.sh'
while node --import tsx ops/local-runtime.ts mongo; do sleep 10; done
echo '[mongo] replica identity unavailable; run bash .cursor/scripts/ensure-cloud-runtime.sh' >&2
exit 1