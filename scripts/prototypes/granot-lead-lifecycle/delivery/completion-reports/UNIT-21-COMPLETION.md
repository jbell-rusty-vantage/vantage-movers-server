# Unit 21 — RingCentral Call Log lease, telemetry, overlap safety, and 30-minute cadence

**Status:** Complete
**Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle` (only repository touched)

## Authority and prerequisites

Implemented final-spec Sections 1–7, 17 (lease/cursor/telemetry half), 27, 33, 34.5, 35–37, 38/S14, and 39–41; Invariants 1, 5–10; and full ownership of **AC-17**.

Unit 20 was reverified in repository state before any edit, not from its prose report:

- `callLeadConvergence.service.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, and `processed-calls-store.ts` are landed, and the ingest order is processed-call idempotency → adoption → duplicate → create/shadow/dry-run.
- Both the webhook path (`call-session-aggregator.ts`) and the Call Log path build a `RingCentralQualifiedCall` and call the same `ingestRingCentralQualifiedCall` seam.
- `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` exists and is default false.
- Unit 20's AC-14/15/16 replica suite was re-run as regression inside this unit's replica command: **10 subtests, all green.**

S14 is completed by this unit. It does **not** dependency-unblock Unit 22; Unit 22 follows Units 07/14–15/18.

## Behavior delivered

### One-winner state lease

- `call-log-sync-state.store.ts` evolved the existing `key:"account"` singleton **in place**. All current cursor/history fields are retained; the exact Section 17 fields were added: `lease_owner`, `leased_until`, `lease_acquired_at`, `last_runtime_ms`, `last_adopted_count`, `last_adoption_conflict_count`, `last_throttled_count`.
- Claim is atomic on `key = "account" AND (leased_until missing OR <= now)`, expressed as `leased_until: { $not: { $gt: now } }` so a missing, null, or expired lease is claimable and a live one is not. A matched claim sets owner, `leased_until = now + 5m`, and `lease_acquired_at`; an absent singleton is created by a single `insertOne`, so a first-run race resolves through the unique key index as a duplicate-key contention rather than a second singleton row.
- Owner identity is a bounded opaque per-invocation `rcls_<32 hex>` value containing no host, credential, provider, or customer data. Everything user-visible uses `maskLeaseOwner()` (12-hex SHA-256 prefix).
- A failed claim returns `lease_held` and performs **no** provider request, route observation, ingest, cursor/terminal write, Lead effect, or notification candidate. It never waits or spins.
- Acquisition over an expired lease is allowed, is reported as `recovered`, and preserves all prior terminal facts.

### Renewal, fencing, and loss

- The lease is renewed to `now + 5m` before the long pagination/ingest phase (forced) and whenever the renew interval (2 minutes) has elapsed between pages and records.
- Every renewal, success, error, and release is fenced by `{ key:"account", lease_owner: owner, leased_until: { $gt: now } }`. A zero-document match is lease loss.
- On loss the run stops starting new pages/records and writes no success, error, counter, or cursor as the former owner. A caught failure attempts exactly **one** fenced terminal error/release update; if that loses the fence, only a PII-safe `lease_lost` event is recorded.
- Process termination needs no cleanup — expiry is the recovery path.
- Clock, owner factory, state store, provider fetch, vetting, ingest, and event sink are all injectable, so acquisition, renewal, expiry, takeover, and finalization are deterministic in tests.

### Cursor and rolling window

- `windowTo` is computed **after** acquisition (the winner's own claim instant); `windowFrom` comes from the state that same winner observed at claim time.
- Locked contract preserved exactly: normal run `min(lastSyncTo - overlap, now - 12h)`; first run `min(now - initial lookback, now - 12h)`.
- `lastSyncFrom`/`lastSyncTo` advance only inside the fenced full-success update after every page and qualified-record ingest completes. No advance on pagination failure, unrecovered throttling, vetting/route failure, adoption/conflict/ledger failure, normal-ingest failure, lease loss, or terminal-write fence loss.
- The 12-hour floor is unchanged and independent of cadence; repeated scans stay safe through processed-call idempotency.

### Telemetry

- Persisted: `last_runtime_ms` (whole nonnegative ms), `last_adopted_count`, `last_adoption_conflict_count`, `last_throttled_count` (zero when none). `lastError` became a bounded code from a closed 7-value set instead of a free-form message.
- Metrics (`ringcentral-metrics.ts`, exact Section 33 names): `ringcentral_call_log_runtime_ms`, `ringcentral_adoptions_total{outcome}` with the closed set `adopted|conflict|not_found|ineligible|disabled`, `ringcentral_call_log_lease_contention_total`. Unknown labels are dropped rather than recorded.
- Events: `started`, `completed`, `failed`, `lease_contended`, `lease_recovered`, `lease_lost` — masked owner hash, masked run ID, window timestamps, duration, bounded counts, and error code/class only.
- Retained fetched/candidate/qualified/ingest/lead/duplicate counts.
- `RingCentralIngestResult` gained a read-only `convergenceOutcome` so the Call Log summary can expose bounded adopted/conflict outcomes. It reports what Unit 20 already decided and changes no candidate, transaction, or duplicate rule.

### Route, schedule, documentation

- `ringcentral-cron.routes.ts` now exposes `createRingCentralCronRouter(deps)` (matching `granot-lifecycle-cron.routes.ts`) with the same default export. `CRON_SECRET` and `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` are unchanged; a disabled route never claims. Contention maps to `{ ok:true, skipped:true, reason:"lease_held" }`. Genuine failure returns a bounded, non-sensitive body and logs an error name only.
- `vercel.json` was changed **last**, after every other test was green, and only the Call Log entry: `0 */2 * * *` → `*/30 * * * *`.

## Files

### Production behavior

- `src/services/ringcentral/call-log-sync-state.store.ts` — lease fields, atomic claim, fenced renew/success/error/release, singleton index contract and fail-closed assertion, owner creation/masking, bounded error codes.
- `src/services/ringcentral/call-log-sync.service.ts` — claim-before-work, page-at-a-time pagination with renewal, throttle observation, fenced finalization, lease-loss handling, bounded telemetry/events, injectable dependencies, exported `resolveWindowStart`.
- `src/services/ringcentral/ringcentral-metrics.ts` — new; Section 33 RingCentral metrics with closed labels.
- `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts` — additive read-only `convergenceOutcome` on the ingest result.
- `src/routes/ringcentral-cron.routes.ts` — injectable factory, `lease_held` mapping, safe failure body.
- `vercel.json` — Call Log cron cadence only.

### Migration and index

- `scripts/migrations/granot-lifecycle-indexes.lib.ts` — `findCallLogSyncStateKeyCollisions`, `reportCallLogSyncStateRows`, `orderedCallLogSyncStateIndexCreates`, `verifyCallLogSyncStateIndexDefinitions`; script version `granot-lifecycle-indexes/9`.
- `scripts/migrations/granot-lifecycle-indexes.ts` — mode-aware state collection resolution, collision/row report, collision-gated unique create, read-only verify, manifest fields.

### Tests and harness

- `src/services/ringcentral/call-log-sync-state.store.test.ts` — new.
- `src/services/ringcentral/call-log-sync.service.test.ts` — new.
- `src/services/ringcentral/call-log-sync-lease.replica.test.ts` — new.
- `src/routes/ringcentral-cron.routes.test.ts` — new.
- `scripts/migrations/granot-lifecycle-indexes.test.ts` — AC-17 collision/report/index-contract cases.
- `scripts/test-granot-lifecycle-replica.ts` — registers `--unit=21` (store lease suite + Unit 21 replica suite + Unit 20 regression suite).

### Behavior documentation and rules

- `.cursor/businesslogic/ringcentral-call-lead-qualification.service.md` — rewritten Call Log cron section (claim, window, renewal, cursor, lease/telemetry state table, metrics/events, cadence and rollback), module/test/tooling tables. Also corrected two pre-existing drifts in that section: the window is the *earlier* of cursor-overlap and rolling floor, and the manual runner is a `tsx` invocation (no `pnpm ringcentral:*` script exists).
- `.cursor/rules/ringcentral-integration.mdc` — lease/fence/cursor/lookback/telemetry/route/index/cadence/rollback rules; globs extended to the lifecycle index migration and `vercel.json`.
- `.cursor/rules/project-organization.mdc` — RingCentral folder map updated for the state store, metrics module, and cron router factory.
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`.

*(A local edit to `scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts` prints the masked lease owner, runtime, and cursor-advanced flag. That path is gitignored, so it is a local operator convenience only.)*

## AC-to-proof coverage

| AC-17 clause | Proof |
|---|---|
| Two overlapping invocations produce exactly one winner; loser does no provider/ingest/cursor work and records bounded contention | `call-log-sync.service.test.ts` "the lease loser performs no provider, route, ingest, or state work" (asserts the exact call order `assert_index → acquire` and zero fetch/ingest/route/state calls, plus contention metric) and "two overlapping invocations produce exactly one winner"; `call-log-sync-lease.replica.test.ts` "two concurrent invocations produce one winner and one bounded skip" against real Mongo (one singleton row, one Lead, one ledger row, one provider fetch); `call-log-sync-state.store.test.ts` simultaneous-claimer cases (first-run race and existing-row race) |
| Only a complete successful winner advances the cursor; failed, partial, throttled-incomplete, and lease-lost work leave it unchanged | `call-log-sync.service.test.ts` "every failure stage leaves the cursor unchanged" (route snapshot, mid-pagination page 2, throttle, ingest), "terminal write failure loses the fence and moves no cursor", "losing the lease mid-run stops work and writes nothing", "a complete successful run advances the cursor exactly once"; replica "a failed run leaves the committed cursor exactly where it was" (real Mongo `lastSyncTo` byte-identical after a 429) |
| Expiry permits one successor, renewal prevents premature takeover, stale-owner renewal/finalization/clear fails its fence | `call-log-sync-state.store.test.ts` "a held lease blocks takeover until exact expiry" (blocked at `expiry-1ms`, admitted at exactly `leased_until`), "renewal extends the lease and prevents premature takeover", "a stale owner can neither renew, finalize, clear, nor release"; replica "an expired lease permits exactly one successor and no stale takeover" |
| Rolling lookback remains exactly 12 hours by default for first/prior-cursor runs and at 30-minute cadence | `call-log-sync.service.test.ts` first-run, 30-minute-cursor, and older-than-floor window tests |
| Unit 20 AC-14–16 remain green under overlap/rescan; replay creates no second Lead/Change/outbox | `callLeadConvergence.replica.test.ts` re-run under `--unit=21` (10 subtests green); replica "rescanning the same window creates no second Lead, Change, or outbox row" (second run reports `skipped_already_processed`, Lead/EntityChange/SheetSyncJob/ledger counts unchanged) |
| Runtime/adopted/conflict/throttled/contention telemetry uses exact Section 33 names, bounded labels, no sensitive content | `call-log-sync.service.test.ts` telemetry/counter assertions, "Call Log telemetry and events carry no caller or provider content", "emitted lease events expose only a masked owner and bounded fields", "the run summary itself exposes no caller data"; `call-log-sync-state.store.test.ts` bounded error-code and masked-owner cases; `ringcentral-cron.routes.test.ts` response privacy assertions |
| Unique key index is collision-reported/verified and prevents two singleton rows | `granot-lifecycle-indexes.test.ts` AC-17 collision/report/verify cases; `call-log-sync-state.store.test.ts` "the unique key index rejects a second singleton row" and the fail-closed assertion; live `--report` (0 collisions) and `--verify` (`call_log_sync_state_verify.ok = true`) against the disposable database |
| `vercel.json` changes last and only the Call Log entry becomes `*/30 * * * *` | `ringcentral-cron.routes.test.ts` "vercel.json schedules the Call Log sync every 30 minutes" also asserts the analytics entry is untouched; the diff of `vercel.json` is a single line, applied after every other suite was green (that test was the single intentional failure until then) |

## Invariants

- **1:** Mongo's state document and processed-call ledger are the only coordination authority. No Vercel assumption, in-memory lock, or provider response elects a winner.
- **5–7:** no new Lead/Booking/Cancellation write path. Contention, replay, and rescan create no extra Change, outbox work, or Lead (proven at replica level).
- **8–10:** lease/run identity is separate from call/Lead provenance. Nothing in this unit writes Ingestion Origin, Source Scope, CPL, Granot evidence, or RingCentral caller evidence.

## Migration and index posture

Section 34.5 tooling extended; commands run against the disposable `testvantagemovers` database with `RINGCENTRAL_COLLECTION_MODE=test` (collection `ringcentral_call_log_sync_state_test`):

```text
TEST_MODE=true RINGCENTRAL_COLLECTION_MODE=test SHEET_SYNC_MODE=disabled pnpm migration:granot-lifecycle:indexes -- --report
TEST_MODE=true RINGCENTRAL_COLLECTION_MODE=test SHEET_SYNC_MODE=disabled pnpm migration:granot-lifecycle:indexes -- --verify
```

- **Report:** exit 0. `script_version: granot-lifecycle-indexes/9`, `database_name: testvantagemovers`, `collision_count: 0`, `call_log_sync_state_key_collisions: []`, `call_log_sync_state_rows: {total 0, account 0, non_account 0, missing_key 0}`, exact contract `{ name: "ringcentral_call_log_sync_state_key_unique", key: { key: 1 }, unique: true }`. Manifests are written under the gitignored `scripts/output/granot-lifecycle-indexes/`.
- **Verify:** `call_log_sync_state_verify: { ok: true, missing: [], mismatched: [] }` — the Unit 21 index is present and exactly defined.
- **Verify exits nonzero for a pre-existing reason, not a Unit 21 regression.** The disposable test database is missing 19 index names from Units 06/10–13 (`granot_crm_source_*`, `synchronization_decision_*`, `granot_lifecycle_activation_key_unique`, `entity_change_*`, `form_lead_*`, `call_lead_*`). The previous manifest on this database, produced by script version `8` *before* any Unit 21 change, fails with the identical missing list. Those units applied their indexes only in their own scoped verification, never to this shared test database.
- **No `--apply` was run**, in this or any database. Apply remains separately authorized. The unique key index exists in the disposable test database only because the Unit 21 replica fixtures create it there.
- Runtime never creates the index: `assertCallLogSyncStateSingletonIndex()` fails the run closed when it is absent, matching the documented rollout order (apply/verify the index, then deploy lease behavior, then change cadence).
- State fields are additive with no row backfill; absent lease fields mean claimable and absent telemetry means not yet observed. No current cursor field was renamed or bulk-rewritten. Multiple `account` rows are reported and refused, never chosen, merged, or deleted.

## Flags and cadence, before and after

| Setting | Before | After |
|---|---|---|
| `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` (default) | false | false |
| `RINGCENTRAL_CREATE_CALL_LEADS` (default) | false | false |
| `RINGCENTRAL_SHADOW_CALL_LEADS` (default) | false | false |
| `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` (checked-in) | false | false |
| `RINGCENTRAL_COLLECTION_MODE` (default) | test | test |
| `RINGCENTRAL_CALL_LOG_SYNC_ROLLING_LOOKBACK_MINUTES` | 720 (12h) | 720 (12h) |
| Granot lifecycle processing / shadow | true / true | true / true |
| Granot Lead/Booking/Release/Referral/email effects | false | false |
| `vercel.json` Call Log cron | `0 */2 * * *` | `*/30 * * * *` |

No new effect flag was introduced: the lease is coordination, not an effect gate. No gate was broadened to pass a test. No deployment or production flag change was performed or authorized.

## Verification

Focused (issue command, landed filenames):

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/ringcentral/call-log-sync-state.store.test.ts \
  src/services/ringcentral/call-log-sync.service.test.ts \
  src/routes/ringcentral-cron.routes.test.ts \
  src/services/ringcentral/callLeadConvergence.test.ts \
  src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts \
  src/services/ringcentral/ringcentral-duplicate-guard.test.ts
```

- **59 tests: 58 passed, 0 failed, 1 skipped** (the skip is the replica-gated Mongo lease suite, which runs in the replica command below).

Replica (Mongo replica set, disposable database, external effects disabled):

```text
TEST_MODE=true MONGO_DB_NAME=testvantagemovers RINGCENTRAL_COLLECTION_MODE=test \
SHEET_SYNC_MODE=disabled RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true \
RINGCENTRAL_CREATE_CALL_LEADS=true RINGCENTRAL_SHADOW_CALL_LEADS=false \
pnpm test:granot-lifecycle:replica -- --unit=21
```

- **32 tests: 32 passed, 0 failed, 0 skipped** (Unit 21 lease/cursor/overlap/rescan + Unit 20 AC-14–16 regression).

Repository:

```text
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test
pnpm typecheck
git diff --check
```

- `pnpm test`: **1,405 tests; 1,352 passed, 0 failed, 53 skipped** (opt-in replica suites).
- `pnpm typecheck`: passed.
- `git diff --check`: passed (only CRLF advisories).
- The repository defines no separate `lint`, `compile`, or `build` script.

Concurrency claims are made at the replica level only. The service-level overlap test is explicitly labelled as a service-contract test, not Mongo proof.

## Masked synthetic verification evidence

All values below come from synthetic fixtures in the disposable test database and the injected-clock unit suite. No live call, customer payload, credential, or unmasked identifier was inspected.

| Observation | Evidence |
|---|---|
| Winner claim | owner masked `e0e92466da53`; `lease_acquired_at = 2026-08-18T12:00:00.000Z`, `leased_until = 2026-08-18T12:05:00.000Z` |
| Loser | `{ ok: true, skipped: true, reason: "lease_held" }`, zero provider fetches, zero ingests, `ringcentral_call_log_lease_contention_total = 1` |
| Renewal | fenced renewal at `+04:00` extends to `+09:00`; a competing claim at `+05:00` is refused |
| Exact expiry | claim at `leased_until - 1ms` refused; claim at exactly `leased_until` admitted with `recovered: true` |
| Takeover / stale owner | successor holds the lease; the stale owner's renew, success, error, and release all return `false` and the committed `lastSyncTo` and `lastRunStatus` are unchanged |
| Pre-finalization failure | injected `429`; `lastSyncTo` byte-identical to the prior committed value, `lastRunStatus: "error"`, `lastError: "provider_throttled"`, `last_throttled_count: 1`, lease cleared |
| Rescan idempotency | second run over the same 12-hour window: `skipped_already_processed: 1`, `lead_created: 0`, Lead count 1, EntityChange count unchanged, SheetSyncJob count unchanged, ledger rows 1 |
| Window | first run and 30-minute-cursor run both start at exactly `windowTo - 12h`; a 20-hour-old cursor keeps `lastSyncTo - 15m` |

## Privacy, security, and forbidden-effect proof

- Event, metric, state, log, and HTTP-response assertions explicitly reject caller phone, caller name, raw call payload, provider body, `Bearer`, tokens, credentials, headers, and free-form customer-bearing error text.
- `lastError` is a closed 7-code set; the failure event carries the code, not the message. The cron route no longer echoes an error message.
- Lease owner values never leave the process: only 12-hex digests appear in events, logs, summaries, and this report.
- Replica assertions prove no second Lead, Change, or Sheet outbox row from contention or replay. This unit introduces no Booking, Cancellation, reconciliation case, discrepancy, Referral, notification, or email path.
- Migration manifests contain masked identifiers and counts only.

## Rollout actions performed

None beyond the disposable test database. Production rollout remains: apply/verify the singleton index, record gates/cursor/schedule, deploy lease behavior at the two-hour cadence, observe a normal interval and an overlap probe, then deploy the 30-minute cadence last. Stop conditions remain two winners, failed-run cursor movement, lease held over 10 minutes, false duplicate, second Lead, missing causal refs, unrecovered throttle, PII exposure, or unexplained volume.

## Known risks and deferred work

- **The singleton index must be applied before the lease code is enabled in production.** Runtime fails closed without it, so deploying lease behavior ahead of the index apply would make the Call Log cron error every run. The rollout order above already prevents this; it is the single most important sequencing risk in this unit.
- `pnpm migration:granot-lifecycle:indexes -- --verify` still exits nonzero on the shared test database because of 19 index names from Units 06/10–13 that were never applied there. This predates Unit 21 (identical failure under script version 8) and is out of this unit's scope, but it means "verify green" cannot currently be used as a single gate on that database; check `call_log_sync_state_verify` specifically until an authorized apply reconciles the rest.
- `last_throttled_count` counts HTTP `429` responses observed by the Call Log run only. Provider auth/retry policy is deliberately unchanged (out of scope), so a throttle is not retried — it fails the run and holds the cursor, which is the safe direction.
- Unit 30 still owns the aggregated health projection, alert thresholds (including "lease held over 10 minutes"), and metric export. This unit emits the Section 33 RingCentral source data only; metrics remain process-local counters, consistent with the existing lifecycle metrics module.
- Adoption telemetry (`last_adopted_count` / `last_adoption_conflict_count`) is zero while `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` is false, which is the checked-in posture.

## Newly unblocked units

Unit 21 completes **S14**. It does **not** unblock Unit 22, which was already spec-unblocked by Units 07/14–15/18. No other unit's prerequisites change.

## Repository state and external actions

Final `git status --short` (`vantage-main-server`, branch `granot-lead-lifecycle`):

```text
 M .cursor/businesslogic/ringcentral-call-lead-qualification.service.md
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/ringcentral-integration.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/routes/ringcentral-cron.routes.ts
 M src/services/ringcentral/call-log-sync-state.store.ts
 M src/services/ringcentral/call-log-sync.service.ts
 M src/services/ringcentral/ringcentral-call-lead-ingest.service.ts
 M vercel.json
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-21-COMPLETION.md
?? src/routes/ringcentral-cron.routes.test.ts
?? src/services/ringcentral/call-log-sync-lease.replica.test.ts
?? src/services/ringcentral/call-log-sync-state.store.test.ts
?? src/services/ringcentral/call-log-sync.service.test.ts
?? src/services/ringcentral/ringcentral-metrics.ts
```

No other repository was touched. `vantage-admin` and `granot_sync_extensions_and_services` are out of scope for this unit and were not modified. All changes remain uncommitted; no predecessor or user work was discarded, reset, or cleaned up.

**No commit, push, deploy, production mutation, production index apply, production report/verify, live call or payload inspection, provider request, Registry change, external Sheet/CRM send, notification, email, flag enablement, or any other external action occurred.** The only runtime writes were to the disposable `testvantagemovers` database using synthetic fixtures (`+1555000xxxx` reserved-range numbers, `u21-` prefixed call identities), with `TEST_MODE=true`, `RINGCENTRAL_COLLECTION_MODE=test`, and `SHEET_SYNC_MODE=disabled`, all cleaned up by the test suites.
