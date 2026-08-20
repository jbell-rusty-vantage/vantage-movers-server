# AGENTS.md

## Cursor Cloud specific instructions

`vantage_movers_server` is a TypeScript Express REST API (Vercel serverless in prod, run
directly via `tsx` in dev). MongoDB is the source of truth; Google Sheets / Granot CRM /
RingCentral are external side-effect targets that are not needed for core local development.

Standard commands live in `package.json` `scripts` (e.g. `pnpm dev`, `pnpm typecheck`,
`pnpm test`). Notes below are only the non-obvious caveats for running this in the cloud VM.

### Declarative environment (`.cursor/environment.json`)
- The Cloud Agent environment is defined in code at `.cursor/environment.json`. It is
  **Dockerfile-backed** (`.cursor/Dockerfile`: Ubuntu 24.04 + Node 22 + pnpm 10.13.1 +
  MongoDB 8.0), so the Dockerfile is the source of truth and any saved snapshot is a no-op.
- On each agent start it runs `pnpm install`, then `start`
  (`.cursor/scripts/ensure-cloud-runtime.sh`: fork local `mongod` if needed, initiate `rs0`,
  write a local `.env` if missing) and two `terminals`:
  `.cursor/scripts/start-mongo.sh` (attach to / start the MongoDB replica set) and
  `.cursor/scripts/start-api.sh` (wait for PRIMARY, export local-only overrides, then
  `pnpm dev`). So **MongoDB and the API on `http://localhost:3000` come up automatically** —
  the manual steps below are a reference/fallback (e.g. when not using this environment, or
  when restarting a service by hand).
- This personal Cursor Cloud environment is currently **dashboard-managed**
  (`environmentJsonPath` is null). Saving the proposed install/start scripts, or merging a
  repo-file `.cursor/environment.json` and starting from that revision, is what future agents
  pick up. Editing the file in this VM does not rebuild the already-running agent.

### Local environment / `.env`
- All `pnpm dev` and `pnpm db:*`/script commands load `node --env-file=.env`, so a `.env`
  file at the repo root is **required** — without it scripts fail and `connectMongo()` throws
  `MONGO_URI is not set`. `.env` is gitignored. `.cursor/scripts/ensure-cloud-runtime.sh` and
  `start-api.sh` write local-only defaults when the file is missing: `TEST_MODE=true`, local
  `MONGO_URI`, `VANTAGE_API_SECRET`, and `SHEET_SYNC_MODE=disabled`.
- **Dashboard secrets do not win for the API process.** This personal Cloud environment
  currently injects Atlas `MONGO_URI` plus `TEST_MODE=false`, `SHEET_SYNC_MODE=queued`, and
  RingCentral create/webhook/sync flags. `node --env-file=.env` does **not** override those
  already-set variables. `start-api.sh` therefore **exports** local overrides before
  `pnpm dev`: local replica-set `MONGO_URI`, `TEST_MODE=true` (`testvantagemovers` only),
  `SHEET_SYNC_MODE=disabled`, source-sheet writes off, and RingCentral write/sync flags off.
  Do not start `pnpm dev` from a raw shell in this environment — it would use Atlas and the
  live `vantagemovers` database. Never point Cloud agents at `vantagemovers` or
  `historicalvantagemovers`.
- `VANTAGE_API_SECRET` guards every `/api/v1/*` route; send it as the `x-api-secret` header.
  Requests without it return `401`; if it is unset the routes return `500`. The injected
  dashboard secret is reused when present; otherwise the start script uses `local-dev-secret`.
- `SHEET_SYNC_MODE=disabled` skips the Google Sheets side-effect sync, so core lead/booking
  CRUD works without any Google service-account credentials. To exercise the real sheet sync
  you must supply `GOOGLE_SERVICE_ACCOUNT_JSON` (or `_BASE64`) plus the `*_SHEET_ID` env vars.
- `TEST_MODE=true` points Mongo at the `testvantagemovers` database (vs the live
  `vantagemovers`) and makes sheet env vars resolve to their `TEST_*` variants — keep it on
  locally to avoid touching live-named data.

### MongoDB (must be running, and must be a replica set)
- Cloud agents should use the **local** MongoDB 8.0 replica set, not the injected Atlas
  `MONGO_URI`. Data dir: `/home/ubuntu/.local-mongo/data` (kept outside the repo).
- The write paths (e.g. `POST /api/v1/form-leads`) use multi-document transactions via
  `withTransaction`, which **require a replica set** — a standalone `mongod` will fail those
  writes. `ensure-cloud-runtime.sh` starts a single-node `rs0` and initiates it if needed:
  - `mongod --replSet rs0 --dbpath /home/ubuntu/.local-mongo/data --bind_ip 127.0.0.1 --port 27017`
  - There is no systemd in this VM; if `start` / the `mongod` terminal is not running, start
    it with `bash .cursor/scripts/ensure-cloud-runtime.sh`.
- Verify readiness with `GET /db` (expects `{ ok: true, readyState: 1, name: "testvantagemovers" }`).
  If `name` is `vantagemovers` or the host is `*.mongodb.net`, stop the API — it is pointed at
  Atlas, not local Mongo.

### Running and verifying the API
- `pnpm dev` serves the Express app on `http://localhost:3000` (`scripts/dev-server.ts`).
- Unauthenticated probes for quick health checks: `GET /` (banner), `GET /health`, `GET /db`.
- Hello-world smoke test (create + read a form lead):
  - `curl -X POST localhost:3000/api/v1/form-leads -H 'x-api-secret: <secret>' -H 'Content-Type: application/json' -d '{"source_company":"main_site","name":"Test User","phone_number":"5551234567","pickup_zip":"10001","destination_zip":"94105","move_size":"Studio","ref_no":"smoke"}'`
  - `move_size` must be one of `Studio | 1 Bedroom | 2 Bedrooms | 3 Bedrooms | 4 Bedrooms | 5+ Bedrooms | Office`.
  - The created id is at `data.lead._id`; read back with `GET /api/v1/form-leads/:id`.

### Tests / typecheck
- `pnpm test` (Node's built-in runner over `src/**/*.test.ts`) and `pnpm typecheck` (`tsc --noEmit`)
  are pure/offline — they do **not** need MongoDB or any external services.
