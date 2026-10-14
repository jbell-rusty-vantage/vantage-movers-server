# Phase 1 local integration evidence — October 14, 2026 UTC

All records in this proof are synthetic. Mongo is the existing Docker `csi01` replica at `127.0.0.1:27189`, database `testvantagemovers_phase1`; the API `/db` reported that exact host/name. Provider credentials are stripped by `ops/local-integration/env.ts`, `.env` is never loaded, `TEST_MODE=true`, and Sheets are disabled. Admin uses `testvantage_admin_phase1_e2e` on loopback with five disposable e2e users. No production Mongo, customer messaging, provider calls, or Pool discovery was involved.

## Canonical money reads: passed

`ops/local-integration/phase1-metrics-proof.ts` seeds guarded synthetic canonical Lead/Booking fixtures after the existing pilot/policy seed and reads `readRepMetrics` through the real Mongo adapter. Re-run with `--verify-only` to avoid a second insertion.

| Check | Observed result |
| --- | --- |
| Stable Agent allocation id, stale name snapshot, split cents | Own Today `$85.01`; the `$100.01` split Booking gives Avery `$50.01` |
| Previous complete Monday–Sunday | October 5–11: `$75` |
| Previous complete calendar month | September 1–30: `$125` |
| All Time without a historical floor | `$495.01`, including 1999 and future calendar fixtures |
| Cancelled official Booking gross allocation | Included in booked gross; excluded from assigned potential |
| Current assignment independent of historical closing allocations | Attached Booking totals give `$1,000.01` on Avery's current eligible Leads |
| Genuine stored zero | Linked known amount; distinct from missing total |
| Priorities 7/8/9 | Their linked totals contribute nothing to potential |
| Cross-model duplicate link with reciprocal Form anchor | Counted once; other model reports mismatched coverage |
| Missing/dangling/amount coverage | Partial: 8 unlinked (pilot included), 1 dangling, 1 missing amount, 1 mismatched reciprocal link |
| January/year boundary | January 1, 2027: Today `$7`, Last Month `$3`; December calendar window; current potential unchanged |
| Real browser BFF read | Rep `/rep-metrics` returned the same schema/values; foreign Agent query returned 403 |

The assigned metric is the known **attached Booking total** under current receiver ownership; it is not earned commission, a guessed amount, a page count, or an unbooked-only forecast.

## Actual replica change stream: passed

`ops/local-integration/phase1-live-proof.ts` watches the real combined database change stream, including Mongo's `$map`/allowlist projection. The final rerun installed and verified all four declared EntityChange indexes, including unique `{ entity.model, entity.id, revision_after }`; a duplicate revision receipt was rejected with Mongo error `11000`. It proves committed binder updates, old/new allocation arrays plus a distinct current assignee, actual reassignment before/after, actual cancellation mutations confined to each Rep's own scope, and foreign Rep isolation. An aborted aggregate-plus-receipt transaction emits no metric hint and changes neither stored revision nor receipt count. Hints contain the topic and scoped ids only, without money/customer/entity values.

The final helpers read the aggregate inside the transaction, guard its actual `domain_revision` with CAS, advance it by one, stamp change metadata, and insert a schema-validated immutable EntityChange with matching adjacent revisions, complete provenance, and sorted matching fields. No fixed `1 → 2` receipts remain in the final proof. The live helper restores booking money/allocations, source assignment, and cancellation pointers through the same revisioned transaction seam; an already-restored fixture is a no-op.

Before index installation, explicit guarded cleanup removed **16 legacy synthetic proof receipts** from `testvantagemovers_phase1` only. Cleanup requires that exact disposable database on loopback, one of the two local proof command names, and missing provenance actor or initiator; corrected receipts are preserved. A repeat cleanup deleted **0**, retaining all 15 corrected receipts. Two consecutive bump/restore cycles advanced Booking revisions `3 → 4 → 5 → 6 → 7`, and a fifth restore was a no-op. After browser verification, the audit found 11 contiguous Booking receipts ending at aggregate revision 11, two Form receipts ending at revision 3, and two Cancellation receipts ending at revision 2; `last_change_id` matched each final receipt. Booking `$100.01`, allocations `$50.01/$50.00`, and displayed money were restored. Machine-readable indexed evidence is [phase1-indexed-proof.json](phase1-indexed-proof.json).

## Reproduction

Use the existing loopback replica; do not start a competing container. Run the synthetic pilot seed for the database above, the existing CSI indexes, the desk index operator and approved policy operator through the local guard, and enroll/evaluate the pilot. The API needs a disposable `SALES_INTELLIGENCE_DEPLOYMENT_ID=phase1-local` as well as local API/signing/cron placeholders for its job ledger. Then run:

```sh
node --import tsx ops/local-integration/phase1-metrics-proof.ts --database=testvantagemovers_phase1
node --import tsx ops/local-integration/phase1-entity-change-indexes.ts --database=testvantagemovers_phase1
node --import tsx ops/local-integration/phase1-live-proof.ts --database=testvantagemovers_phase1
node --import tsx ops/local-integration/phase1-queue-fixtures.ts --database=testvantagemovers_phase1
```

The queue fixture explicitly seeds synthetic projection interaction ages and today/yesterday/unknown move dates after evaluation. It does not claim that RingCentral captured those interactions. Browser fixtures use October 13, 2026 New York and should be rebuilt/adjusted for another day. `phase1-browser-mutation.ts` changes only the synthetic `PHASE1-today` Booking and commits an EntityChange for live rendering checks; `--restore` resets `$100.01`.

Admin: real API `http://127.0.0.1:3107`, no mock mode, UI `http://localhost:3100`. The guarded Admin launcher is `node scripts/phase1-local-admin.mjs`; it refuses checkout `.env` files and strips provider credentials. A linked node_modules root initially caused a Turbopack filesystem panic and webpack hydration failures. Copying the same already-installed packages into the worktree with hardlinks resolved the filesystem layout issue; package versions and application source stayed unchanged. System Chromium `/usr/bin/chromium` is selected by the tracked `tests/e2e/phase1-local.config.ts` (override `E2E_CHROMIUM_PATH` for another existing executable); no browser download or DTO/browser response mock was needed.

## Real indexed browser walk: 3/3 passed (51 seconds)

The final walk used the real login, BFF, server read adapters, local replica with all declared EntityChange indexes, and SSE. The first test verifies the exact money DTO, Rep foreign-Agent 403, all four labels, partial coverage, Today/Past/Unknown presentation, latest interaction/no interaction wording, Future's today inclusion, URL persistence across reload, complete two-row server cursor traversal, and search + priority + workflow + date composition. The second verifies Owner and Manager viewing Avery, their Team move-date filtering, and generic Admin 403. The third verifies a committed revisioned binder/allocation event refreshes the card, then closes the stream through the app's hidden-page lifecycle, commits a change while closed, and verifies reopening/refetch recovers the missed amount. Its fixture is restored in `finally`. Scoped ESLint passed on all Phase 1 helper TypeScript files with the repository's existing correctness rules (the normal lint glob omits these ops scripts).

Playwright's `setOffline` did not tear down an already-established SSE in this Chromium. The recovery proof therefore uses the actual app stream close/reopen lifecycle; document visibility is controlled in the browser, while all responses, mutations and stream traffic remain real. A separate simulated transport-offline caption is not claimed as proven.

```sh
E2E_PHASE1=1 E2E_BASE_URL=http://localhost:3100 \
E2E_ADMIN_AUTH_DB_NAME=testvantage_admin_phase1_e2e \
E2E_REP_AGENT_ID=d9e98cc15237c848c5c8732b \
E2E_REP2_AGENT_ID=360f2f6456d420c391c73535 \
node node_modules/@playwright/test/cli.js test --config=tests/e2e/phase1-local.config.ts
```

Seven screenshots and their browser evidence README are tracked in the Admin repository under `docs/rep-desk-and-pool/phase1-local-evidence/`. The money card and queue screenshots were visually inspected; all dates/interaction ages come from the synthetic local fixtures. Rep call goals/freshness remain Pending/Unknown/Not connected because no provider capture was run.

These helper files create no deployment configuration or migration. Rollback is stopping the two local dev processes and dropping only the named disposable test databases through guarded local cleanup. Production index deployment and merge evidence are recorded separately by the Phase 1 owner.
