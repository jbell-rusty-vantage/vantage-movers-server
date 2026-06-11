# AGENTS.md

## Cursor Cloud specific instructions

`vantage_movers_server` is a TypeScript Express REST API (Vercel serverless in prod, run
directly via `tsx` in dev). MongoDB is the source of truth; Google Sheets / Granot CRM /
RingCentral are external side-effect targets that are not needed for core local development.

Standard commands live in `package.json` `scripts` (e.g. `pnpm dev`, `pnpm typecheck`,
`pnpm test`). Notes below are only the non-obvious caveats for running this in the cloud VM.

### Local environment / `.env`
- All `pnpm dev` and `pnpm db:*`/script commands load `node --env-file=.env`, so a `.env`
  file at the repo root is **required** — without it scripts fail and `connectMongo()` throws
  `MONGO_URI is not set`. `.env` is gitignored. A working local `.env` is already present in
  the VM snapshot with: `TEST_MODE=true`, local `MONGO_URI`, `VANTAGE_API_SECRET`, and
  `SHEET_SYNC_MODE=disabled`.
- `VANTAGE_API_SECRET` guards every `/api/v1/*` route; send it as the `x-api-secret` header.
  Requests without it return `401`; if it is unset the routes return `500`.
- `SHEET_SYNC_MODE=disabled` skips the Google Sheets side-effect sync, so core lead/booking
  CRUD works without any Google service-account credentials. To exercise the real sheet sync
  you must supply `GOOGLE_SERVICE_ACCOUNT_JSON` (or `_BASE64`) plus the `*_SHEET_ID` env vars.
- `TEST_MODE=true` points Mongo at the `testvantagemovers` database (vs the live
  `vantagemovers`) and makes sheet env vars resolve to their `TEST_*` variants — keep it on
  locally to avoid touching live-named data.

### MongoDB (must be running, and must be a replica set)
- There is no managed Atlas connection locally. A local MongoDB 8.0 server is installed in the
  snapshot with its data dir at `/home/ubuntu/.local-mongo/data` (kept outside the repo).
- The write paths (e.g. `POST /api/v1/form-leads`) use multi-document transactions via
  `withTransaction`, which **require a replica set** — a standalone `mongod` will fail those
  writes. Start it as a single-node replica set; the `rs0` config is already initiated in the
  persisted data dir, so no re-initiate is needed:
  - `mongod --replSet rs0 --dbpath /home/ubuntu/.local-mongo/data --bind_ip 127.0.0.1 --port 27017`
  - There is no systemd in this VM, so start `mongod` yourself (e.g. in a tmux session); it is
    not auto-started by the update script.
- Verify readiness with `GET /db` (expects `{ ok: true, readyState: 1, name: "testvantagemovers" }`).

### Running and verifying the API
- `pnpm dev` serves the Express app on `http://localhost:3000` (`scripts/dev-server.ts`).
- Unauthenticated probes for quick health checks: `GET /` (banner), `GET /health`, `GET /db`.
- Hello-world smoke test (create + read a form lead):
  - `curl -X POST localhost:3000/api/v1/form-leads -H 'x-api-secret: <secret>' -H 'Content-Type: application/json' -d '{"source_company":"main_site","name":"Test User","phone_number":"5551234567","pickup_zip":"10001","destination_zip":"94105","move_size":"Studio","ref_no":"smoke"}'`
  - `move_size` must be one of `Studio | 2 Bedrooms | 3 Bedrooms | 4 Bedrooms | 5+ Bedrooms | Office`.
  - The created id is at `data.lead._id`; read back with `GET /api/v1/form-leads/:id`.

### Tests / typecheck
- `pnpm test` (Node's built-in runner over `api/**/*.test.ts`) and `pnpm typecheck` (`tsc --noEmit`)
  are pure/offline — they do **not** need MongoDB or any external services.
