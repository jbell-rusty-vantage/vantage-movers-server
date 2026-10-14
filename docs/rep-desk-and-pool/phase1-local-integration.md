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

`ops/local-integration/phase1-live-proof.ts` watches the real combined database change stream, including Mongo's `$map`/allowlist projection. It proves committed binder updates, old/new allocation arrays plus current assignee, reassignment before/after, cancellation broadcasts confined to each Rep's own scope, and foreign Rep isolation. An aborted transaction inserting an EntityChange emits no metric hint. Hints contain the topic and scoped ids only, without money/customer/entity values. The script restores the fixture's binder total and allocations on success and in cleanup.

## Reproduction

Use the existing loopback replica; do not start a competing container. Run the synthetic pilot seed for the database above, the existing CSI indexes, the desk index operator and approved policy operator through the local guard, and enroll/evaluate the pilot. The API needs a disposable `SALES_INTELLIGENCE_DEPLOYMENT_ID=phase1-local` as well as local API/signing/cron placeholders for its job ledger. Then run:

```sh
node --import tsx ops/local-integration/phase1-metrics-proof.ts --database=testvantagemovers_phase1
node --import tsx ops/local-integration/phase1-live-proof.ts --database=testvantagemovers_phase1
node --import tsx ops/local-integration/phase1-queue-fixtures.ts --database=testvantagemovers_phase1
```

The queue fixture explicitly seeds synthetic projection interaction ages and today/yesterday/unknown move dates after evaluation. It does not claim that RingCentral captured those interactions. Browser fixtures use October 13, 2026 New York and should be rebuilt/adjusted for another day. `phase1-browser-mutation.ts` changes only the synthetic `PHASE1-today` Booking and commits an EntityChange for live rendering checks; `--restore` resets `$100.01`.

Admin: real API `http://127.0.0.1:3107`, no mock mode, UI `http://localhost:3100`. This linked-dependency worktree required `next dev --webpack` because Turbopack refused a node_modules symlink outside its project root. System Chromium `/usr/bin/chromium` was selected in a scratch Playwright config; no browser download or browser mock was needed. The tracked test is Admin `tests/e2e/phase1.integration.spec.ts`, enabled by `E2E_PHASE1=1`.

These helper files create no deployment configuration or migration. Rollback is stopping the two local dev processes and dropping only the named disposable test databases through guarded local cleanup. Production index deployment and merge evidence are recorded separately by the Phase 1 owner.
