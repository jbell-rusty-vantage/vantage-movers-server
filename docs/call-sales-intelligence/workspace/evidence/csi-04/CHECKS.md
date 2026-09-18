# CSI-04 verification

Executed September 17, 2026 on `sales-intelligence` over baseline `1925c32` (CSI-02 review resolved; CSI-03 uncommitted in the same patch). Provider directory pages and webhook/Call Log payloads are synthetic (`src/services/numberActivity/fixtures.ts`); nothing below is a live RingCentral capability proof.

| Check | Command / scope | Result / artifact |
| --- | --- | --- |
| Server typecheck | `pnpm exec tsc --noEmit` | Exit 0; [typecheck.txt](typecheck.txt) (empty — no diagnostics). |
| CSI-04 unit tests | `directorySync.test.ts`, `rebuild.test.ts`, `reads.test.ts`, `sales-intelligence-admin.routes.test.ts` | 14/14 (part of the focused run below): directory normalize/digest/fetcher; recount + incremental match; search term/cursor/filter; timeline order/keyset/merge; DTO fixtures vs CSI-01 subset; Owner guard/flag-off/idempotency; v1 mount order. |
| Focused server suite (CSI-01 + CSI-02 + CSI-03 + CSI-04) | Command below | 109/109, 0 skipped; [focused-server-tests.txt](focused-server-tests.txt). |
| CSI-04 reads replica | `pnpm test:csi:reads:replica` | 10/10 including outer test; [csi04-reads-replica-tests.txt](csi04-reads-replica-tests.txt). |
| CSI-04 numbers replica | `pnpm test:csi:numbers:replica` | 7/7 including outer test; [csi04-numbers-replica-tests.txt](csi04-numbers-replica-tests.txt). |
| CSI-03 replica regression | `pnpm test:csi:fanout:replica` | 11/11; [csi03-replica-regression.txt](csi03-replica-regression.txt). |
| CSI-02 replica regression | `pnpm test:csi:capture:replica` | 12/12; [csi02-replica-regression.txt](csi02-replica-regression.txt). |
| CSI-01 replica regression | `pnpm test:csi:replica` | 15/15; [csi01-replica-regression.txt](csi01-replica-regression.txt). |
| Unchanged qualification suites | Command below | 102 pass, 0 fail, 3 skipped (pre-existing opt-in `GRANOT_LIFECYCLE_REPLICA_TESTS`); [qualification-suites.txt](qualification-suites.txt). |
| Patch hygiene | `git diff --check` | Clean (CRLF warnings only on files that already had them). |

```powershell
node --import tsx --import ./scripts/test-setup.ts --test "src/validation/intelligence/*.test.ts" "src/services/salesIntelligence/foundation.test.ts" "src/routes/sales-intelligence-boundary.routes.test.ts" "src/routes/sales-intelligence-cron.routes.test.ts" "src/routes/sales-intelligence-admin.routes.test.ts" "src/middleware/requireApiSecret.test.ts" "src/models/LeadConversation.test.ts" "src/services/conversations/*.test.ts" "src/services/numberActivity/*.test.ts" "src/services/ringcentral/webhook-subscription-lifecycle.test.ts" "api/queues/sales-intelligence-consumer.test.ts"
```

```powershell
node --import tsx --import ./scripts/test-setup.ts --test "src/services/ringcentral/*.test.ts" "src/routes/ringcentral-cron.routes.test.ts" "src/routes/ringcentral-webhook.routes.test.ts"
```

## Replica environment

Same disposable Docker MongoDB 8.0 single-node replica as CSI-02/03 (`csi01`, loopback 27189; recipe in [csi-02/CHECKS.md](../csi-02/CHECKS.md)). Runners `scripts/test-csi-reads.ts` and `scripts/test-csi-numbers.ts` refuse any other host, ignore `.env`, and select a fresh `testvantagemovers_csi04r<random>` / `testvantagemovers_csi04<random>` database that each test drops in its `finally`. Directory provider reads are fakes; no production database, provider, queue, subscription or messaging action occurred.

## What the database proofs cover

**Reads (`test-csi-reads.replica.test.ts`):** search keyset completeness through a nine-number same-instant cluster at limit 2 (pages concatenate to the full ordered set, no skips/duplicates); E.164 / suffix / anchored name term / regex-literal matching; hygiene hides non-external kinds by default and shows only those when on (`?hygiene=false` does not invert; `0`/`off` rejected in the unit suite); attachment linked/unlinked and activity-range filters; timeline total order with same-millisecond cross-kind ties, canonical-row dedupe (tombstone never listed), recordings counted per `recordings[]` entry, Lead Messages without body text, conversations account-scoped (foreign-account same recording id excluded), cursor pagination complete at limits 1/2/3/5, `extraSources` hook for Team C; detail connections + fresh recount matching rollups (4 interaction rows including tombstone, recount 3); coverage honest with no sync state, then watermark + open gap + webhook capability + dataset-scoped `ai_paused` + failing-webhook `unavailable`; every read ran under a before/after byte snapshot of ten collections (`readsProvenReadOnly >= 40`).

**Directory / rebuild / routes (`test-csi-numbers.replica.test.ts`):** empty lookup before the first snapshot; digest-deduplicated append; A→B→A advances `taken_at` on digest A so lookup is current and no third document is created; bound exercised as 3 (oldest pruned); `loadDirectoryLookup` reads the newest; one of two concurrent syncs is `lease_held`; throttle and account-mismatch write no snapshot and release the lease; flag-off skip; projection of a webhook through the synced snapshot resolves user/queue roles; directory cron auth/flag/lease through the real router; Owner rebuild command is ledger-idempotent (`REVISION_CONFLICT` / replay / `IDEMPOTENCY_CONFLICT`) and does not rebuild inline; worker restores corrupted rollups/search terms excluding the merge tombstone and matching a fresh `recountNumber`; no-op second rebuild bumps no revision and writes no audit; expired-lease holder cannot complete after a successor; `enqueueRebuildAll` fans out one pending job per number, drain completes them, and a retry of the same all-job after a live revision bump reuses the per-number jobs (`jobs_created: 0`); `dispatchCsiWakeup` runs the rebuild handler; real Owner route stack: suffix search, full customer number on detail, timeline omits the tombstone, reads mutate nothing, 202 enqueue + replay + conflict, missing `Idempotency-Key` is 400, flag-off is 404 `FEATURE_DISABLED`.

## What is not proven here

Live RingCentral directory API shapes beyond the fields read, production snapshot volume (bound of 30 exercised as 3), Vercel Queue delivery of rebuild wake-ups, production cron invocation, Team C Outreach/nudge timeline events (the `TimelineSource` hook is proven with a synthetic extra source), Team C attachment/outreach DTO mappers (detail returns empty `outreach_records` and connection counts), multi-node replica failover.
