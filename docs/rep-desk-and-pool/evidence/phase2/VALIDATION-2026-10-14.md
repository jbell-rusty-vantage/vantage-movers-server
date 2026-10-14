# Local Priority Pool completion checks

October 14, 2026; branch `codex/priority-pool-prototype-2026-10-14`.

- Server HEAD/origin main: `ac1520d5e910c94d3c1c0de57196e01d6084eeba`. Admin HEAD/origin main: `897c7da61a52327babd769339de8c3621f9b79ad`.
- `node --import tsx ops/pool-prototype/prototype.test.ts`: 17 named checks, 17 passed, zero failed. Existing provider-shaped parser assertions include Pool labels, primary Job line and timestamped Open Date.
- `pnpm exec tsc --noEmit --incremental`: exit0 after the final inspection helper changes. Both in-memory `.mjs` modules also pass `node --check`.
- Deterministic synthetic replay checked: shared A/B completion; assigned B fulfillment with caller-only A outbound; same-event replay remains one event; distinct simultaneous B event remains a second real call but one duty; next NY day returns due.
- Evidence arithmetic checked: source/month totals843;602 valid canonical matches +241 holds =843;843 distinct observed Job inventory entries; shared lease released; domain mutations0.
- Corrected canonical history:72 non9→9 EntityChanges across71 Leads. Each joined receipt exists and is completed; each Observation and latest applied Decision exists; every Decision records `sheet_sync_requested`; every transition Lead has entity-associated synced Sheet Sync jobs. Coalescing prevents claiming one outbox job per change. The original ObjectId/string join error is explicitly corrected in the capture metadata and findings.
- Browser checks: A calls P1; B sees completed P1 assigned to B with actual caller A; replay preserves counts; distinct simultaneous call counted separately; next NY day due; inactive viewer receives no queue data. Final screenshot `pool-prototype-complete.png` shows B's completed view.
- Redaction scan on current live/follow-up/replay evidence found no email marker, provider/session URL, cookie/password/session-token field or spreadsheet identifier. Files contain masked keys and business metadata only.
- New findings/proposal/prototype relative links resolve. `git diff --check` passes. No change to `src/`, `api/` or `vercel.json`. Admin retains only its pre-existing `.quality.config.json` modification; server's two pre-existing user changes are untouched.

The browser/reducer is a local simulator, not production authorization/concurrency/SSE certification. The real provider reads wrote only the shared automation lease. No feature implementation, production data reconciliation, Pool admission, cron/configuration change, customer communication, commit, push or deployment occurred. Production work stops at the Owner approval gate in `POOL-APPROVAL-2026-10-14.md`.
