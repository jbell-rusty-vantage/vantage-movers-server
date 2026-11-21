# Local and Cloud agent setup

Use Node **24** and pnpm **10.13.1**, matching the existing CI workflows. Start at the [task guide](docs/operations/README.md); the [Sheet Sync runbook](docs/operations/sheet-sync.md) is the first supported end-to-end operator workflow.

## Clean checkout: diagnose and prove a service

Run from the repository root in PowerShell or Bash:

```text
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm vantage -- help
pnpm vantage -- doctor --json
pnpm vantage -- test sheet-sync --suite fast --json
pnpm test:vantage
pnpm typecheck
```

No `.env`, private owner files or provider credentials are needed. Help works without Mongo. Doctor reports an unavailable local replica as a failure, never healthy/zero. Fast tests prove faked service behavior; they do not replace the real replica proof below. Default `pnpm test` is mostly offline, but individual tests can explicitly skip missing prerequisites; report those skips and use the service wrapper when zero skips are required.

Start Node from a trusted shell: startup-level `NODE_OPTIONS` can execute before any JavaScript safeguard. The supported CLI and launcher strip inherited credentials, Mongo targets, arbitrary flags, Node startup options and dotenv settings **from child processes**. They do not make arbitrary legacy scripts safe.

## Local replica on Windows or Linux

A real single-node replica is required for transactional writes. Standalone Mongo and replicas advertising other members are refused. With Docker installed/running and no existing listener on port 27017, create a dedicated synthetic fixture:

```text
docker run --name vantage-local-mongo -p 127.0.0.1:27017:27017 -d mongo:8.0 --replSet rs0 --bind_ip_all
docker exec vantage-local-mongo mongosh --norc --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
node --import tsx ops/local-runtime.ts mongo
```

Wait for election and repeat the last read-only command if necessary. Expected result: verified `rs0`, `127.0.0.1:27017`, database `testvantagemovers_agent`. If a container or port already exists, inspect its ownership and identity; do not remove or reconfigure unrelated fixtures. Resume this container with `docker start vantage-local-mongo`; stop it with `docker stop vantage-local-mongo`. Data remains in that container. No production connection is needed.

For the Sheet Sync durable proof, use a **separate** fixture:

```text
docker run --name vantage-sheet-replica -p 127.0.0.1:27129:27129 -d mongo:8.0 --port 27129 --replSet sheetRecoveryProof --bind_ip_all
docker exec vantage-sheet-replica mongosh --norc --quiet --port 27129 --eval 'rs.initiate({_id:"sheetRecoveryProof",members:[{_id:0,host:"127.0.0.1:27129"}]})'
pnpm vantage -- doctor --profile sheet-replica --json
pnpm vantage -- test sheet-sync --suite replica --json
```

The harness writes and drops only its owned `testvantagemovers_sheetrecovery<PID>` database. Never put unrelated fixtures there. Providers are faked; the tests exercise real Mongo persistence, uncertainty and recovery. Stop the named container when finished. See the [runbook](docs/operations/sheet-sync.md) for proof interpretation.

## Launch and verify the local API

```text
pnpm dev
```

In another terminal:

```text
pnpm dev:identity
```

The launcher checks the fixed replica's PRIMARY identity **before importing the app**, starts a single child bound to `127.0.0.1:3000`, and verifies `GET /db` before declaring readiness. The response must have `ok:true`, `readyState:1`, `host:"127.0.0.1"`, and both `name` and `expectedName` equal to `testvantagemovers_agent`. A healthy `/health` alone is insufficient. An occupied API port causes refusal; stop the known existing launcher rather than attaching blindly. Ctrl+C stops the owned child.

The child uses an allowlisted environment, `TEST_MODE=true`, the isolated database, Sheets/messaging/RC feature disablement, and the synthetic API secret `local-dev-secret`. It reads neither the checkout's `.env` nor its RingCentral file-token cache: dotenv targets the OS null device and the API runs from a temporary empty working directory. The launcher never creates or overwrites `.env`.

This is **credential isolation, not a network sandbox**. Some explicit provider routes (including Form-to-Granot submission policy) can attempt HTTP without valid credentials. Use only synthetic data, verify `/db` before any separately scoped local write, and use faked service harnesses for provider effects. This guide performs no API write or seed. A new local database has no Operations Registry/source setup, so generic Form create is not an executable smoke test.

The legacy `dev:granot`, `dev:vercel`, `db:*` and operational scripts retain their own environment/side-effect contracts; they are outside this safe onboarding path. Do not use them merely to bypass a refusal.

## Claude Code on the web

See [CLOUD-SESSIONS.md](docs/operations/CLOUD-SESSIONS.md). The environment's setup script is `ops/cloud-session/setup.sh`, which installs Node 24 and pnpm 10.13.1. The repository's SessionStart hook (`.claude/settings.json` → `ops/cloud-session/session-start.sh`) runs only when `CLAUDE_CODE_REMOTE=true`. It installs dependencies and starts loopback Docker replicas `csi01` (27189) and `rs0` (27017). It never reads `.env` or contacts production.

## Cursor Cloud

[environment.json](.cursor/environment.json) uses the [Dockerfile](.cursor/Dockerfile): Ubuntu 24.04, Node 24, pnpm 10.13.1 and MongoDB 8.0. Install uses the frozen lockfile. [Bootstrap](.cursor/scripts/ensure-cloud-runtime.sh) starts a local `rs0` in `/home/ubuntu/.local-mongo/data`, initiates only an uninitialized replica with that identity, waits within bounded retries, and starts the same isolated API launcher. Mongo is not forwarded as a public Cloud port.

Bootstrap never writes `.env`. The API log is `/home/ubuntu/.local-mongo/api.log`. Existing API acceptance checks `/db`, and explicitly cannot attest the environment of an independently launched process. Restart through `pnpm dev` when that provenance is unknown. The Mongo terminal observes identity; the API terminal runs the identity probe.

Changes to a Dockerfile require a rebuilt environment. A dashboard-managed Cursor environment does not automatically adopt repository configuration; select this repository's environment definition/rebuild before claiming these safeguards are active. The [qualification record](docs/operations/QUALIFICATION-2026-11-17.md) distinguishes local Windows/Linux rehearsal from an actual hosted Cloud Agent launch.