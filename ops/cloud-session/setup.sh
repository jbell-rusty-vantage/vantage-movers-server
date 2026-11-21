#!/usr/bin/env bash
# Claude Code on the web: environment setup script for vantage-movers-server.
#
# Paste this file's contents into the cloud environment's "Setup script" field
# (claude.ai/code > environment settings), or run it as root from the clone.
# Runs as root before Claude starts. Must exit 0. Keep it under ~5 minutes so the
# environment image is cached; it is rebuilt when this script or the allowed
# hosts change, and about every 7 days.
#
# Installs the toolchain CI uses: Node 24 (latest 24.x, checksum-verified) and
# pnpm 10.13.1. Pre-pulls the MongoDB 8.0 image used for local replica tests.
# Writes no credentials and never creates .env.
#
# Required network access (Limited + these hosts): nodejs.org.
# Docker Hub and registry.npmjs.org are on the default allowlist.
set -euo pipefail

NODE_MAJOR=24
PNPM_VERSION=10.13.1
MONGO_IMAGE=mongo:8.0

log() { echo "[vantage-setup] $*"; }

install_node() {
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" = "$NODE_MAJOR" ]; then
    log "node $(node --version) already installed"
    return
  fi
  local base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  local arch; arch="$(uname -m)"
  case "$arch" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) log "unsupported arch $arch"; exit 1 ;; esac
  local sums file tmp
  tmp="$(mktemp -d)"
  sums="$(curl -fsSL --retry 3 "$base/SHASUMS256.txt")"
  file="$(printf '%s\n' "$sums" | awk -v a="linux-${arch}.tar.xz" '$2 ~ a"$" {print $2; exit}')"
  [ -n "$file" ] || { log "no Node ${NODE_MAJOR} linux-${arch} tarball listed"; exit 1; }
  curl -fsSL --retry 3 -o "$tmp/$file" "$base/$file"
  (cd "$tmp" && printf '%s\n' "$sums" | grep " $file\$" | sha256sum -c -)
  rm -rf /opt/node24 && mkdir -p /opt/node24
  tar -xJf "$tmp/$file" -C /opt/node24 --strip-components=1
  for bin in node npm npx corepack; do ln -sf "/opt/node24/bin/$bin" "/usr/local/bin/$bin"; done
  rm -rf "$tmp"
  hash -r
  log "installed node $(node --version)"
}

install_pnpm() {
  if command -v pnpm >/dev/null && [ "$(pnpm --version)" = "$PNPM_VERSION" ]; then
    log "pnpm $PNPM_VERSION already installed"
    return
  fi
  npm install --global "pnpm@${PNPM_VERSION}"
  ln -sf /opt/node24/bin/pnpm /usr/local/bin/pnpm 2>/dev/null || true
  hash -r
  log "installed pnpm $(pnpm --version)"
}

prepull_mongo() {
  command -v docker >/dev/null || { log "docker not available; replica tests will be skipped"; return; }
  if ! docker info >/dev/null 2>&1; then
    (dockerd >/tmp/dockerd-setup.log 2>&1 &) || true
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  if docker info >/dev/null 2>&1; then
    docker pull -q "$MONGO_IMAGE" >/dev/null && log "pulled $MONGO_IMAGE" || log "could not pull $MONGO_IMAGE (session start will retry)"
  else
    log "dockerd did not start; see /tmp/dockerd-setup.log"
  fi
}

install_node
install_pnpm
prepull_mongo
log "done"
