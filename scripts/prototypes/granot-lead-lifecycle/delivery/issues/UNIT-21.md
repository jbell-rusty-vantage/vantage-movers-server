# Unit 21 — RingCentral Call Log lease, telemetry, overlap safety, and 30-minute cadence

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 20.** This is the lease/schedule half of S14. It adds one renewable state lease around the existing Call Log run, preserves the 12-hour rolling lookback, advances the cursor only after complete success, emits bounded run/adoption/conflict/throttle telemetry, and changes the Vercel cadence to every 30 minutes only after convergence and overlap proof is green.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 17, 27, 33–37, 38/S14, and 39–41; especially the exact state fields and claim/cursor rule in Section 17, metric names in Section 33, AC-17 in Section 36, and rollout step 8.
- **Acceptance ownership:** full AC-17. Unit 20 owns AC-14–16 and adoption/duplicate semantics; this unit must consume those results without changing their candidate, transaction, or duplicate rules.
- **Approved split:** Unit 21 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 20 owns adoption-before-duplicate and its flag. Unit 21 alone owns the Call Log state lease, overlap winner, terminal run telemetry, cursor-on-full-success proof, RingCentral cadence documentation, and the final `vercel.json` change.
- **Execution:** delivery runbook; server `AGENTS.md`, `CLOUD_AGENTS.md`, `.cursor/rules/ringcentral-integration.mdc`, `.cursor/rules/project-organization.mdc`, and applicable RingCentral behavior/runbook docs; verified Unit 20 completion report and repository state; current Call Log sync service/state store, cron route, RingCentral config, metrics/Operational Events, processed-call ledger, and `vercel.json`.

The final specification wins on conflict. A cron request is only a trigger; Mongo state determines the sole lease winner. Provider responses, process memory, Vercel overlap assumptions, and logs are not coordination authority.

## 2. Objective

Make `runRingCentralCallLogSync` safe when two webhook/cron/manual invocations overlap. Atomically acquire the `key:"account"` state lease for five minutes, renew it while work remains, fence terminal writes by the winning owner, and leave the high-water cursor unchanged on every partial/failed/lease-lost run. Preserve the rolling 12-hour scan and Unit 20 idempotent convergence behavior. Record PII-safe runtime/adoption/conflict/throttle telemetry, then—only after fake-clock, integration, overlap, convergence, duplicate, and cursor tests pass—change `/api/cron/ringcentral-call-log-sync` from `0 */2 * * *` to `*/30 * * * *` and update its operational documentation.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` / `granot-lead-lifecycle` only.
- **Blocked by:** verified Unit 20 completion with AC-14–16, adoption-before-duplicate, processed-ledger atomicity, normal-ingest continuation, and duplicate tests green. Unit 20 is not implemented at issue-authoring time; do not infer completion from its authored contract.
- Reverify both webhook and Call Log paths use Unit 20's shared `ingestRingCentralQualifiedCall`/convergence seam and that Call Log summaries expose bounded adopted/conflict/throttled outcomes without raw caller data.
- Before any runtime write, require `TEST_MODE=true`, an explicit disposable database, `RINGCENTRAL_COLLECTION_MODE=test`, disabled external Sheet/CRM effects, synthetic call/route fixtures, and a known RingCentral write/adoption posture. Provider calls, production collection access, flag changes, deployment, or a cadence change outside the source file are not authorized.
- Preserve unrelated/user changes. No commit, push, deploy, production mutation/index apply, live call inspection, or external send.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify at implementation start because Unit 20 must land first:

- `call-log-sync-state.store.ts` stores one intended `key:"account"` document with camelCase cursor/run fields, but it has no lease fields, atomic claim/renew/release API, fencing owner check, or declared unique key index.
- `runRingCentralCallLogSync` reads the cursor, scans/fetches/ingests, and calls `recordCallLogSyncSuccess` only after its loop. Errors leave `lastSyncTo` unchanged, but overlapping invocations can both run provider work and write terminal state.
- `resolveWindowStart` uses the earlier of `lastSyncTo - overlap` and `now - rollingLookback`; `RINGCENTRAL_CALL_LOG_SYNC_ROLLING_LOOKBACK_MINUTES` defaults to `12 * 60`. This 12-hour floor is locked and must not shrink with the cadence.
- The state records fetched/qualified/lead-action counts and a free-form `lastError`; Section 17 additionally requires exact snake_case lease/runtime/adoption/conflict/throttle fields. Error persistence must become bounded/sanitized without exposing provider/contact content.
- The cron route already requires `CRON_SECRET` and safely skips when `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` is false, but it has no distinct lease-contention result.
- `vercel.json` still schedules `/api/cron/ringcentral-call-log-sync` as `0 */2 * * *`. This is correct until all Unit 20 and Unit 21 proof passes.
- Lifecycle metrics are currently process-local helpers and Operational Events are the durable operational source; no existing RingCentral lease/runtime metric implementation satisfies Section 33 yet.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo's Call Log state/cursor and processed-call ledger are authoritative. A Vercel invocation, local lock, or in-memory flag cannot elect the winner.
- **Invariants 5–7:** this unit introduces no Lead/Booking/Cancellation write path. Unit 20 effects remain canonical/idempotent; contention or replay creates no extra Change, outbox work, or Lead.
- **Invariants 8–10:** telemetry and coordination identity stay separate from call/Lead provenance; lease/run data cannot rewrite Ingestion Origin, Source Scope, CPL, immutable Granot evidence, or immutable RingCentral caller evidence.
- Cursor movement means the entire bounded run succeeded. Provider pagination, vetting, adoption/conflict persistence, normal ingest, ledger persistence, or lease ownership failure before finalization means no cursor advance.
- One lease winner is required even on first-run/upsert races. A stale owner cannot renew, finalize, clear, or overwrite the new owner's state.
- The 30-minute cadence is the last code change in this unit and is never used to compensate for an unsafe cursor, missing lease, false duplicate, or failing convergence test.

## 6. Deliverables and exact contract

### 6.1 State document and one-winner lease

Evolve the existing `key:"account"` state in place. Retain current cursor/history fields for compatibility; add the exact Section 17 fields:

```ts
lease_owner?: string;
leased_until?: Date;
lease_acquired_at?: Date;
last_runtime_ms?: number;
last_adopted_count?: number;
last_adoption_conflict_count?: number;
last_throttled_count?: number;
```

Use a bounded opaque per-invocation owner ID containing no host credential or customer/provider value. Acquire atomically using `key = "account" AND (leased_until missing OR <= now)`, setting the owner, `leased_until = now + 5 minutes`, and `lease_acquired_at = now`.

- Upsert may initialize the singleton, but first-run races still yield one winner. Add/verify the issue-author-required unique `{ key: 1 }` index named `ringcentral_call_log_sync_state_key_unique`; this is the narrow fail-closed mechanism needed to make the specification's singleton claim safe.
- A failed claim returns bounded `lease_held`, increments `ringcentral_call_log_lease_contention_total`, and performs no provider request, route observation, ingest, cursor/terminal-state overwrite, Lead effect, or notification candidate.
- Acquisition over an expired lease is allowed and records recovery telemetry without erasing prior terminal facts. Never wait or spin inside the request.

### 6.2 Renewal, fencing, and loss behavior

Renew to `now + 5 minutes` before expiry and before a potentially long provider pagination/ingest phase. Every renewal and terminal state update is fenced by `{ key:"account", lease_owner:owner, leased_until:{ $gt: now } }`.

- A renewal matching zero documents means lease loss. Stop starting new pages/records and do not write success, error, counters, or cursor as the former owner. Already committed Unit 20 effects remain valid and idempotent when rescanned.
- Final success/error clears all three lease fields only through the owner fence. An old owner's `finally` cannot clear a successor's lease.
- Process termination needs no cleanup; expiry is recovery. A caught failure attempts one fenced terminal error/release update. If that loses the fence, record only a PII-safe lease-lost event.
- Inject clock/owner/store dependencies so acquisition, renewal, expiry, takeover, and finalization are deterministic in tests.

### 6.3 Cursor and rolling-window contract

Compute `windowTo` after lease acquisition and `windowFrom` from state observed by that winner. Preserve:

```text
normal run: min(lastSyncTo - configured overlap, now - 12h rolling lookback)
first run:  min(now - configured initial lookback, now - 12h rolling lookback)
```

`lastSyncFrom`/`lastSyncTo` advance only in the fenced full-success update after every page and qualified-record ingest completes. No advance is permitted for pagination failure, unrecovered throttling, vetting/route failure, Unit 20 adoption/conflict/ledger failure, normal-ingest failure, lease loss, or terminal write failure. Repeated 12-hour scans remain safe through processed-call/adoption idempotency; do not replace them with a 30-minute window.

### 6.4 Run result and telemetry

Extend the summary/state finalization with bounded Unit 20 outcomes:

- runtime in whole nonnegative milliseconds -> `last_runtime_ms` and `ringcentral_call_log_runtime_ms`;
- adopted outcomes -> `last_adopted_count` and `ringcentral_adoptions_total{outcome}` with a closed outcome set;
- adoption conflicts -> `last_adoption_conflict_count` and the bounded adoption metric/event family;
- provider throttles/retries observed by the client -> `last_throttled_count` (zero when none); and
- failed claims -> `ringcentral_call_log_lease_contention_total`.

Retain fetched/candidate/qualified/ingest/lead/duplicate counts. Emit PII-safe `started`, `completed`, `failed`, `lease_contended`, `lease_recovered`, and `lease_lost` events with owner hash/masked run ID, window timestamps, duration, counts, and error code/class only. Never persist/log caller phone/name, raw call payload, provider body, credentials, tokens, headers, or free-form customer-bearing errors. Unit 30 may aggregate/alert later; this unit emits the Section 33 RingCentral source data now.

### 6.5 Cron route, schedule, and documentation

Keep `CRON_SECRET` and `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`. Map contention to `{ ok:true, skipped:true, reason:"lease_held" }`; normal overlap is not HTTP 500. Genuine failure remains safe and non-sensitive.

After all tests—including Unit 20 AC-14–16 regression—pass, change only the Call Log entry in `vercel.json` to `*/30 * * * *`. Update `.cursor/rules/ringcentral-integration.mdc`, `.cursor/rules/project-organization.mdc` if its map changes, and RingCentral runbook/business-logic docs with lease, expiry, fencing, cursor, rolling-window, telemetry, cadence, and rollback rules.

## 7. Explicitly out of scope

- Unit 20 candidate selection, adoption window, caller evidence, conflict mutation, duplicate rule, ledger transaction, or adoption flag semantics.
- RingCentral qualification, route resolution, webhook session behavior, provider auth/retry policy, 90-day duplicate rule, or Lead write mode.
- Shrinking the 12-hour lookback, per-page/record cursor advancement, or treating partial completion as success.
- Lifecycle cases, Booking/Release commands, Admin lifecycle UI, discrepancies, Referral, email, or Unit 30's complete health/alert surface.
- A generic lock framework, background daemon, provider send, live call inspection, historical replay, or production deployment/enablement.
- Raw payload, caller/contact data, tokens, credentials, or unmasked IDs in state, metrics, logs, tests, reports, or handoff.

## 8. Flags and runtime posture

- Preserve defaults/gates including `RINGCENTRAL_CALL_LOG_SYNC_ENABLED=false`, `RINGCENTRAL_CREATE_CALL_LEADS=false`, collection mode `test`, and Unit 20's checked-in adoption flag false.
- The lease is coordination, not an effect flag: any enabled Call Log invocation claims before work; a disabled route does not claim.
- Preserve Granot lifecycle defaults: processing true, shadow true, and all Lead/Booking/Release/Referral/email effects false. This unit enables no lifecycle effect.
- Source code ends at the new cadence only after proof. No deployment or production flag change is authorized.

## 9. Migration and indexes

State fields are additive and need no row backfill; absent lease fields mean claimable and absent telemetry means not yet observed. Do not rename/bulk-rewrite current cursor fields.

The unique singleton key is an index change. Extend Section 34.5 tooling:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

Report duplicate/missing/non-`account` state rows and exact definitions with PII-safe IDs/counts. Create the unique index only after zero collisions. Report/verify are read-only; apply is separately authorized and idempotent. If multiple `account` rows exist, stop and report; never choose/delete/merge automatically.

## 10. Acceptance criteria

- [ ] **AC-17:** two overlapping invocations produce exactly one winner; the loser performs no provider/ingest/cursor work and records bounded contention.
- [ ] **AC-17:** only a complete successful winner advances the cursor; failed, partial, throttled-incomplete, and lease-lost work leave it unchanged.
- [ ] **AC-17:** expiry permits one successor, renewal prevents premature takeover, and stale-owner renewal/finalization/clear fails its fence.
- [ ] **AC-17:** the rolling lookback remains exactly 12 hours by default for first/prior-cursor runs and at 30-minute cadence.
- [ ] Unit 20 AC-14–16 remain green under overlap/rescan; replay creates no second Lead/Change/outbox.
- [ ] Runtime/adopted/conflict/throttled/contention telemetry uses exact Section 33 names, bounded labels, and no sensitive content.
- [ ] The unique key index is collision-reported/verified and prevents two singleton rows.
- [ ] `vercel.json` changes last and only the Call Log entry becomes `*/30 * * * *`.

## 11. Required tests and commands

Name production-interface tests with `AC-17`. Required proof:

- fake-clock store tests for first claim/upsert, simultaneous claimers, exact expiry, renewal, takeover, stale-owner fencing, safe release, and singleton collision;
- service tests for claim-before-work, loser no-op, renewal during long work, stop-on-loss, error cleanup, counters, and sanitized errors/events;
- cursor/window tests for every failure stage, terminal write failure, first/prior cursor, overlap, and the 12-hour floor;
- replica/integration tests with concurrent real state updates and idempotent Unit 20 adoption/ledger/normal-ingest results;
- cron route tests for disabled, lease-held, success, safe failure, auth, and the exact `vercel.json` entry;
- metric/event privacy tests.

Run from `vantage-main-server` using landed filenames:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/ringcentral/call-log-sync-state.store.test.ts src/services/ringcentral/call-log-sync.service.test.ts src/routes/ringcentral-cron.routes.test.ts src/services/ringcentral/callLeadConvergence.test.ts src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts src/services/ringcentral/ringcentral-duplicate-guard.test.ts
TEST_MODE=true RINGCENTRAL_COLLECTION_MODE=test SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=21
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck
```

Use landed equivalents if filenames differ. An in-memory lock cannot prove Mongo behavior. Never run apply without separate authorization.

## 12. Live/staging verification

In isolated test/staging with synthetic calls/routes, test collections, and external effects disabled: launch two invocations, prove one winner/one skip, observe renewal, force pre-finalization failure, expire/take over, and verify cursor/ledger/Lead counts. Rescan the same 12-hour window and prove Unit 20 idempotency/no false duplicate/second Lead. Inspect bounded counts, masked IDs, timestamps, metric labels, and causal refs only.

Production rollout is separate: apply/verify the singleton index, record gates/cursor/schedule, deploy lease behavior at two-hour cadence, observe a normal interval/overlap probe, then deploy 30-minute cadence last. Stop on two winners, failed-run cursor movement, lease held over 10 minutes, false duplicate, second Lead, missing causal refs, unrecovered throttle, PII exposure, or unexplained volume.

## 13. Rollback

Restore `0 */2 * * *` first. If needed set `RINGCENTRAL_CALL_LOG_SYNC_ENABLED=false`; if adoption is unsafe also disable Unit 20's adoption flag. Keep additive lease/state fields and the unique safety index. Do not rewind a successful cursor without a reviewed recovery plan.

Never detach metadata, reset convergence, delete ledger rows, erase lease/run evidence, rewrite origin/snapshots, remove Commands/Changes/outbox evidence, or reverse committed Leads/duplicates automatically.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-21-COMPLETION.md` using Runbook Section 13. Include Unit 20 proof; repository/branch; state/lease/index/API/telemetry/schedule/docs files; claim/renew/fence/cursor/window contracts; invariants/AC-17; index report/apply/verify; flags/cadence before/after; focused/full/replica results; masked winner/expiry/renewal/failure/takeover evidence; Unit 20 regression/idempotency/privacy/forbidden-effect proof; rollout actions; risks; final Git status; and external-action statement.

Successful implementation completes S14. It does not dependency-unblock Unit 22; Unit 22 follows Units 07/14–15/18.
