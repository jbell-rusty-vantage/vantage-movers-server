# Local integration (real Admin ↔ real server, no production)

These helpers run the Admin against this server on the local Docker replica `csi01`
(`127.0.0.1:27189`) instead of mock mode. Every helper takes `--database=<name>`. It refuses any
name that doesn't start with `test`, and it only connects to the loopback replica.

1. **Seed a test database.** For the desk pilot:
   `node --import tsx ops/sales-outreach/seed-synthetic-pilot.ts --database=testvantagemovers_sodpilot [--reset]`
2. **Indexes.**
   - Desk: `ops/sales-outreach/build-indexes.ts --target=<db> --apply`.
   - CSI ledger/audit and registry: `node --import tsx ops/local-integration/csi-indexes.ts --database=<db>`.
   - The desk policy: `ops/sales-outreach/install-approved-policy.ts`.
3. **Serve the API.** Run `CRON_SECRET=… VANTAGE_API_SECRET=… VANTAGE_ADMIN_PROXY_SIGNING_SECRET=… node --import tsx ops/local-integration/serve.ts --database=<db>`. It listens on `127.0.0.1:3107` (override with `PORT`), with provider credentials stripped and `.env` ignored.
4. **Run the Admin.** Run `next dev -p 3100` with `VANTAGE_API_BASE_URL=http://127.0.0.1:3107`, the same two secrets and `OUTREACH_DESK_MOCK` unset. Browse `http://localhost:3100`, not 127.0.0.1.
5. **Clean up.** Run `node --import tsx ops/local-integration/drop-database.ts --database=<db>`.

The exact desk run (P2) is in the Admin repo at `docs/sales-outreach-desk/workspace/evidence/INTEGRATION.md`. The All Numbers run is in `ALL-NUMBERS-INTEGRATION.md`, in the same folder.
