---
type: Service
title: RingCentral Call Lead Qualification
description: Qualify inbound RingCentral calls (120s answered) and promote them through shared ingest.
tags: [ringcentral, call-lead, qualification]
status: draft
stale_after: 2026-09-20
resource: src/services/ringcentral/
applies_to:
  - src/services/ringcentral/
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/ringcentral/
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-conversion
  at: 2026-09-02T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/ringcentral/`  
**Domain terms used:** [Call Qualification](../../../../CONTEXT.md), [Call Lead Ingestion](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [RingCentral Call Adoption](../../../../CONTEXT.md), [Source Granularity](../../../../CONTEXT.md), [Operational Event](../../../../CONTEXT.md), [Main Site](../../../../CONTEXT.md)

# RingCentral Call Lead Qualification

**Role:** **Call Qualification** rules decide which Ring Central inbound calls become Call Leads, then promote them through one shared ingest path. `ingestRingCentralQualifiedCall` is the only RingCentral promotion gate: it may adopt one exact pending Granot-created Call Lead or create/shadow/dry-run a RingCentral-origin Call Lead. Routes, webhooks, cron, and scripts do neither directly.

**Hybrid strategy:** Real-time **webhook** session tracking (best-effort duration) + scheduled **Call Log sync** (polling safety net). Both paths build a `RingCentralQualifiedCall` and hand it to ingest so **Call Qualification**, idempotency, Duplicate Lead classification, and write mode stay identical.

**System of Record:** MongoDB `call_leads`, canonical Command/Change evidence, Sheet Sync outbox, and `ringcentral_processed_calls` are authoritative for materialized outcomes. Ring Central Call Log is authoritative for cron qualification timing; webhook candidates are operational state until terminal + ingest.

## Core **Call Qualification** rule

Shared constant: `CALL_LEAD_MINIMUM_ANSWERED_SECONDS = 120` (`call-candidate-evaluator.ts`).

A call qualifies when **all** are true:

| Criterion | Webhook (`call-candidate-evaluator`) | Cron (`call-log-vetting.ts`) |
|-----------|--------------------------------------|------------------------------|
| Direction | `Inbound` | `Inbound` |
| Target route | `to.phoneNumber` resolves in the cached Operations Registry snapshot at call start | Same — scan record + legs against one run snapshot |
| Answered | Party/session `answered` with `answeredAt` | `result` in answered set (`Accepted`, `Completed`, `Connected`, …) |
| Duration | `answeredAt` → `terminalAt` (or `now` if still live) ≥ 120s | `duration` / `durationMs` / leg max ≥ 120s |
| Caller phone | Normalized `from` present | Caller from inbound leg / record `from` |

**Inbound mapping:** `ringcentral_inbound_routes` plus effective-dated `ringcentral_inbound_route_assignments`. The webhook uses the shared cached snapshot; each Call Log run loads one immutable snapshot. `call-lead-sources.ts` is M5 migration/test seed data only.

**Party semantics:** On inbound candidate events, `from` = customer caller, `to` = RingCentral number/queue. Telephony sessions have multiple parties — qualify on **party direction** and aggregate at session level for webhooks.

## Pipeline overview

```
                    ┌─────────────────────────────────────┐
                    │  ingestRingCentralQualifiedCall      │
                    │  (idempotency → adopt → duplicate    │
                    │   → create/shadow/dry-run)            │
                    └────────────────▲────────────────────┘
                                     │
          ┌──────────────────────────┴──────────────────────────┐
          │                                                     │
   Webhook path                                          Call Log cron
          │                                                     │
 normalize party event                              fetch Detailed Inbound
          │                                                     │
 upsert per-party candidate                          vetRingCentralCallLogRecord
          │                                                     │
 evaluateRingCentralCallCandidate (per party)                  │
          │                                                     │
 aggregateRingCentralCallSession (all parties)                  │
          │                                                     │
   ingest when qualified + terminal                    ingest oldest-first in one run
```

## 1. Qualification evaluator (`call-candidate-evaluator.ts`)

Pure function `evaluateRingCentralCallCandidate(candidate, now)` — no I/O, no lead creation.

### Decision statuses

| `decisionStatus` | `wouldCreateCallLead` | Typical `decisionReason` |
|------------------|----------------------|---------------------------|
| `rejected` | false | `not_inbound`, `target_number_not_matched`, `not_answered`, `under_120_seconds` |
| `candidate` | false | `inbound_target_waiting_for_answer` — still ringing |
| `pending_buffer` | false | `answered_but_under_120_seconds` — live call, not terminal yet |
| `needs_review` | false | `missing_caller_phone_number`, `answered_missing_answered_at` |
| `qualified` | true | `inbound_target_answered_over_120s` (+ `_webhook_elapsed_best_effort` when no `terminalAt`) |

**Webhook nuance:** Under 120s while call is still active → `pending_buffer` (wait for more events). Under 120s after terminal → `rejected` (`under_120_seconds`).

**Duration math:** `estimateAnsweredDurationSeconds(answeredAt, terminalAt, now)` — uses `terminalAt ?? now` for in-flight calls.

**Terminal statuses:** `isLikelyTerminalRingCentralStatus` — `Disconnected`, `Gone`, `Finished`, `Voicemail`, `Missed`, `NoCall`.

Qualified output includes `leadPreview` (source, phones, session ids, duration, `qualificationReason: "inbound_target_answered_over_120s"`).

## 2. Webhook path (session aggregation → ingest)

**Route:** `POST /api/webhooks/ringcentral` (`ringcentral-webhook.routes.ts`).

Per webhook batch:

1. Capture raw event (always, even when processing disabled).
2. If `RINGCENTRAL_WEBHOOK_ENABLED` — normalize party events, upsert candidates (`call-candidate-store`), evaluate each party.
3. For each touched `telephonySessionId` — `processRingCentralCallSession` → `aggregateRingCentralCallSession` (`call-session-aggregator.ts`).

### Session aggregation (`call-session-aggregator.ts`)

Collapses multi-party sessions into one synthetic candidate, then runs the shared evaluator.

**Canonical party priority (best first):** inbound + target-matched → `queueCall` → answered → longest duration → most recently updated.

**Lifecycle timing:** Answered parties drive `answeredAt`; terminal when lifecycle party is terminal or all parties terminal. `ingestEligible = wouldCreateCallLead && terminal` — webhooks **do not ingest live calls** still in `pending_buffer`.

**Ingest trigger:** `ingestSessionLead` builds `RingCentralQualifiedCall` with `ingestionSource: "webhook"`, `callLogId: null`.

Optional future hardening: `RINGCENTRAL_WEBHOOK_CALL_LOG_VALIDATE` — confirm qualified webhook sessions against Call Log before ingest (config flag exists; off by default).

## 3. Call Log cron (`call-log-sync.service.ts`)

**Route:** `GET|POST /api/cron/ringcentral-call-log-sync` (Vercel cron every 30 minutes, `CRON_SECRET`). Gated by `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`. The route is a trigger and mapper only; it coordinates nothing.

Each run:

1. **Claim:** Atomically acquire the `key: "account"` state lease (`leased_until` missing or `<= now`) for five minutes. A cron request is only a trigger — **Mongo state elects the single winner.** A failed claim performs no provider request, route observation, ingest, cursor write, or Lead effect; it returns `{ ok: true, skipped: true, reason: "lease_held" }` and increments `ringcentral_call_log_lease_contention_total`. A disabled route never claims. Runs never wait or spin.
2. **Window:** `resolveWindowStart` — `windowTo` is the winner's claim instant; `windowFrom` is the earlier of the cursor overlap (`lastSyncTo - overlap`, default 15m) and the rolling lookback floor (default 12h), so the floor always wins for a recent cursor. First run uses the initial lookback (default 30m) under the same floor. The 12-hour floor is locked and does **not** shrink with the cron cadence; it guards long calls and RingCentral finalization lag.
3. **Fetch:** Detailed inbound voice Call Log, one page at a time (250/page, max 20 pages). A `429` is counted into `last_throttled_count` and rethrown — provider retry policy is unchanged. The run collects every page before ingest.
4. **Order:** Sort collected records by Call Log `startTime` oldest-first (missing `startTime` last). RingCentral pages newest-first; Duplicate Lead classification is earlier-only, so the same cron run must persist the earlier call before the later callback. A later page-fetch failure now happens before any ingest from that run.
5. **Vet:** `vetRingCentralCallLogRecord` per record — same business rule as evaluator; exposes `rejectionReasons[]`.
6. **Ingest:** Qualified rows → `RingCentralQualifiedCall` with `ingestionSource: "call_log_sync"`, `qualificationReason: "call_log_inbound_target_answered_over_120s"`, `answeredAt = startTime`, `terminalAt = start + duration`.
7. **Renew:** The lease is renewed to `now + 5m` before the long pagination/ingest phase and while work remains. Every renewal and terminal write is fenced by `{ key, lease_owner, leased_until: { $gt: now } }`. A zero-document renewal means the lease was lost: the run stops starting new pages/records and writes no success, error, counter, or cursor as the former owner. Already committed effects stay valid and are idempotent on the next rescan.
8. **Cursor:** `lastSyncFrom`/`lastSyncTo` advance **only** in the fenced full-success update after every page and qualified record completes. Pagination failure, unrecovered throttling, vetting/route failure, adoption/conflict/ledger failure, normal-ingest failure, lease loss, or terminal-write fence loss all leave the cursor untouched, so the next run retries the same range. Re-scans are safe — ingest idempotency skips already-processed sessions/logs.

**Lease and telemetry state** (`ringcentral_call_log_sync_state(_test)`, one `key: "account"` row):

| Field | Meaning |
|-------|---------|
| `lease_owner`, `leased_until`, `lease_acquired_at` | Five-minute renewable run lease. Absent means claimable; expiry is the only recovery (a terminated process needs no cleanup). |
| `last_runtime_ms` | Whole nonnegative run milliseconds. |
| `last_adopted_count`, `last_adoption_conflict_count` | Bounded Unit 20 adoption outcomes observed by the run. |
| `last_throttled_count` | Provider throttles observed by the client; `0` when none. |
| `lastError` | A bounded code from a closed set (`route_snapshot_failed`, `provider_request_failed`, `provider_throttled`, `ingest_failed`, `state_write_failed`, `lease_lost`, `unknown_error`) — never a provider body or caller value. |

The singleton needs the unique `{ key: 1 }` index `ringcentral_call_log_sync_state_key_unique`; it is what makes a first-run race yield one winner instead of two rows. Runtime never creates it and **fails closed when it is absent**; deployment is `pnpm migration:granot-lifecycle:indexes -- --report | --apply --confirm-production=<db> | --verify`. // pragma: allowlist secret

**Metrics (final-spec Section 33):** `ringcentral_call_log_runtime_ms`, `ringcentral_adoptions_total{outcome}` (`adopted|conflict|not_found|ineligible|disabled`), `ringcentral_call_log_lease_contention_total`. **Events:** `started`, `completed`, `failed`, `lease_contended`, `lease_recovered`, `lease_lost` — masked owner hash, window timestamps, duration, counts, and error code only. No caller phone/name, raw call payload, provider body, credential, token, or header ever enters state, metrics, logs, or events.

**Cadence and rollback:** `vercel.json` runs `/api/cron/ringcentral-call-log-sync` at `*/30 * * * *`. Roll back by restoring `0 */2 * * *` first, then `RINGCENTRAL_CALL_LOG_SYNC_ENABLED=false`, then (only if adoption is unsafe) `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false`. Keep the additive lease/telemetry fields and the unique safety index. Do not rewind a successful cursor without a reviewed recovery plan.

**Local script:** `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts`.

## 4. Shared ingest (`ringcentral-call-lead-ingest.service.ts`) — promotion gate

`ingestRingCentralQualifiedCall(call)` — **the only** RingCentral path that may adopt a Granot-created Call Lead, create a RingCentral-origin `call_leads` row, write a shadow row, or record a dry-run result.

### Order of operations

```
1. findProcessedCall(telephonySessionId | sessionId | callLogId)
   └─ any terminal create/adopt/shadow result → skipped_already_processed

2. attemptRingCentralCallLeadConvergence
   └─ only when RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true
   └─ mutates only in create write mode

3. classifyRingCentralCallLeadDuplicate
   └─ for adoption, exclude the adopted Lead and same physical call
   └─ otherwise classify the normal non-adoption path

4. create only when adoption did not succeed, or shadow/dry-run per write mode

5. persist the processed-call ledger result
```

### Exact Granot-created adoption candidate

`callLeadConvergence.service.ts` owns candidate selection. A qualified call is adoptable only when it has a valid `startTime` and normalized caller phone and the query returns exactly one row satisfying every condition:

- exact active-route `source_granularity_id`;
- exact normalized caller phone against immutable `ingested_contact_snapshot.normalized_phone_number`;
- `ingestion_origin:"granot_lead_created"` and `ringcentral_convergence.state:"pending"`;
- no nonempty `ringcentral.telephony_session_id`, `session_id`, or `call_log_id`; and
- Lead `createdAt` inclusively between call start minus 12 hours and call start plus 12 hours.

The post-load phone equality check is defensive; deterministic sorting never chooses among multiple rows. Missing call start/phone and zero rows do not mutate an existing Lead. A Job-number-only / `not_applicable` Lead has no immutable phone and is never a candidate.

Exactly one candidate is adopted through the canonical `adoptRingCentralCall` command after the transaction revalidates the candidate, revision, active route assignment, source scope, phone, window, and candidate count. Adoption atomically:

- preserves `ingestion_origin:"granot_lead_created"`, the Granot contact snapshot, source scope, CPL provenance, and originating Observation reference;
- attaches complete verified RingCentral identity, route, timing, qualification, target, and source-label evidence;
- stores immutable `ringcentral.original_caller` (`phone_number`, normalized phone, capture time), separate from mutable top-level contact facts;
- sets convergence to `adopted`, performs business duplicate classification, records one revision/Entity Change and `call_lead.update` outbox intent; and
- writes the processed-call ledger in the same Mongo transaction.

Granot Call creation and RingCentral ingest share a hashed Source Granularity + normalized-phone scope fence in `ringcentral_convergence_locks`. Owner language uses [Caller Match Key](../../../../CONTEXT.md); the locked implementation key is exact Source Granularity + normalized phone — never Source Company alone. The lock contains no raw phone.

The Granot fence is **always on** when the Observation has a normalized phone: `ensureRingCentralConvergenceScopeLock` before the create transaction and `acquireRingCentralConvergenceScopeLock` + `findPreCreationRingCentralConvergenceCandidates` inside it. `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` does **not** gate those Granot sites. Job-only Observations skip both sites (residual hole; do not invent a phone).

The ingest-side lock in `ringcentral-call-lead-ingest.service.ts` still runs **only** when `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` is true. [RingCentral Call Adoption](../../../../CONTEXT.md) mutations stay flagged. Do not describe the ingest lock as always on. Concurrent one-Lead safety is required with adoption on and RingCentral write mode `create`; adoption off plus a later qualifying create can mint a twin. Mapped inbound Granot CRM Sources stay `link_only`; if an Owner later puts `create_if_missing` on a source with RingCentral assignments, enable the adoption companion first.

More than one candidate is never guessed. `markRingCentralConvergenceConflict` atomically revalidates the full candidate set, sets every still-eligible row to `conflict` with reason `multiple_adoption_candidates` and a bounded call-identity hash, records canonical Change/outbox evidence, then allows the qualified call to continue through normal ingest. A failed conflict transaction is a technical failure, not a silent fallback. Zero/ineligible candidates also continue through normal create/shadow/dry-run behavior without mutating an existing Lead.

### Duplicate correctness

The existing business rule remains exact Source Granularity + normalized phone + a different non-duplicate Call Lead in the earlier-only 90-day window: timestamp is `>= call time - 90 days` and `< call time`. The lower 90-day boundary is inclusive; future/same-time rows are not prior Leads. Source Company alone is never the boundary. Call Log sync therefore ingests a run oldest-first so a same-batch callback can see the earlier Lead. A later call that arrives first on the webhook path, then an earlier call on a later cron run, can still miss; that residual is outside this sort.

For adoption, the guard excludes the adopted Lead ID and the current telephony session. It also excludes unresolved `granot_lead_created` rows in `pending` or `conflict` when no RingCentral session/call-log identity is attached; those rows alone cannot cause a false duplicate. An adopted Granot-created Lead from another physical call and eligible legacy/current Call Leads remain ordinary prior candidates. A true duplicate retains the existing `duplicate:true` and zero-CPL behavior.

### Write modes (env priority: `create` > `shadow` > `dry_run`)

| Mode | Flag | Effect |
|------|------|--------|
| `create` | `RINGCENTRAL_CREATE_CALL_LEADS=true` | `createRingCentralCallLead` → real `call_leads` + sheet sync |
| `shadow` | `RINGCENTRAL_SHADOW_CALL_LEADS=true` (create off) | `insertShadowCallLead` staging collection |
| `dry_run` | both off (default testing posture) | Ledger only, no lead row |

### Ingest actions

| `action` | Meaning |
|----------|---------|
| `lead_created` | New non-duplicate call lead |
| `lead_created_duplicate` | Call Lead created with Duplicate Lead flag, `cpl: 0` |
| `lead_adopted` | Qualified call atomically adopted into one Granot-created Call Lead |
| `lead_adopted_duplicate` | Adopted Lead also matched a different prior qualifying Call Lead |
| `shadow_recorded` | Shadow collection write |
| `dry_run` | Ledger recorded, no lead |
| `skipped_already_processed` | Idempotent skip |

### Idempotency vs business duplicate

| Concern | Mechanism | Purpose |
|---------|-----------|---------|
| **Idempotency** | `ringcentral_processed_calls` unique sparse session and call-log identity indexes + unique sparse `ringcentral.telephony_session_id` on `call_leads` | Same physical call (webhook + cron, concurrent cron, or double webhook) has one terminal winner |
| **Business Duplicate Lead** | `classifyRingCentralCallLeadDuplicate` (earlier-only 90-day window per glossary) | Different prior call, same caller + exact Source Granularity → Duplicate Lead, zero CPL |

Duplicate Call Leads still persist and **Sheet Sync** to `Duplicate Calls` tab (see [`call-lead.md`](./call-lead.md)).

**Config note:** `duplicateWindowHours` in `ringcentral-config.ts` (`RINGCENTRAL_DUPLICATE_WINDOW_HOURS`, default 24) is debug metadata only — not used by the duplicate guard (hardcoded 90 days).

### Adoption rollout, rollback, and processed-ledger index

- `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` is the checked-in fail-closed default. False skips candidate/conflict mutation and preserves the prior qualified-call path.
- Enabling the flag attempts convergence before duplicate classification, but Lead adoption/conflict mutations still require RingCentral write mode `create`. Shadow/dry-run may evaluate the bounded outcome and then continue their normal non-mutating path.
- Roll out separately only after the unique sparse `callLogId` processed-ledger index is verified and focused/replica proofs pass. Keep the existing `RINGCENTRAL_CREATE_CALL_LEADS` / shadow posture independent.
- Roll back first by setting the adoption flag false. Never detach committed RingCentral evidence, reset convergence, rewrite Granot origin/snapshots, delete conflicts/ledger/Command/Change/outbox evidence, decrement revisions, or automatically reverse duplicate classification.

`lead_adopted` and `lead_adopted_duplicate` are terminal ledger statuses. Adoption requires both unique processed-ledger race fences: sparse unique `telephonySessionId` and sparse unique `callLogId`. Runtime index bootstrap does not create the call-log index inside an adoption transaction; adoption fails closed if either fence is missing.

`pnpm migration:ringcentral:processed-call-indexes -- --report|--apply|--verify` owns the call-log refinement. Report is default and emits only collision counts, hashes, masked IDs, and null/empty sparse-placeholder counts. Apply refuses collisions, unsets non-identifying call-log/session placeholders, and requires the standard explicit database/apply authorization plus matching `RINGCENTRAL_COLLECTION_MODE`; verify fails when collisions/placeholders remain or the required index is absent. Unit 20 added the migration but did **not** authorize or perform a production apply. // pragma: allowlist secret

### Operational events

| Event | When |
|-------|------|
| `ringcentral.call_lead.created` | Real lead, non-duplicate |
| `ringcentral.call_lead.duplicate_created` | Real lead, duplicate |
| `ringcentral.call_lead.adopted` | Qualified call adopted into a Granot-created Lead |
| `ringcentral.call_lead.adopted_duplicate` | Adopted Lead matched a different prior qualifying Lead |
| `ringcentral.call_lead.skipped_already_processed` | Idempotent skip |
| `ringcentral.call_log_sync.completed` / `.failed` | Cron run outcome |
| `ringcentral.webhook.ingest_failed` | Ingest threw on qualified session |

## Invariants

- Never create Ring Central Call Leads outside `ingestRingCentralQualifiedCall` (**Call Lead Ingestion** gate).
- Never select adoption candidates in routes, session aggregation, Call Log sync, clients, or the duplicate guard; `callLeadConvergence.service.ts` owns the exact candidate and canonical adoption/conflict operations.
- Never bypass `evaluateRingCentralCallCandidate` / `vetRingCentralCallLogRecord` for the 120s **Call Qualification** rule.
- Webhook ingest requires **qualified + terminal** session; cron ingest uses finalized Call Log duration.
- Target-number gating always uses `resolveRingCentralInboundRoute(snapshot, phone, callStartedAt)`. There is no static fallback.
- **Analytics** reconcile (`analytics-reconcile.service.ts`) is count-level comparison only — **must not** create Call Leads.
- RingCentral Mongo collections use `_test` suffix unless `RINGCENTRAL_COLLECTION_MODE=production`. // pragma: allowlist secret

## Debug / local tooling

| Tool | Purpose |
|------|---------|
| `GET /api/dev/ringcentral/*` | Candidates, sessions, decisions, processed calls, config |
| `pnpm ringcentral:webhook:monitor` | Live webhook inspection |
| `pnpm ringcentral:workflow:test` | End-to-end qualification scenarios |
| `scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts` (via `tsx`) | Manual cron run + artifact JSON, including masked lease owner, runtime, and cursor-advanced |

## Related modules

| Module | Role |
|--------|------|
| `call-candidate-store.ts` | Per-party candidate upsert + decision persistence |
| `call-session-store.ts` | Session aggregate persistence + `processRingCentralCallSession` |
| `call-log-vetting.ts` | Call Log record qualification (cron) |
| `ringcentral-duplicate-guard.ts` | Business duplicate window |
| `callLeadConvergence.service.ts` | Exact candidate selection and canonical adoption/conflict |
| `ringcentral-config.ts` | Feature flags, write mode, sync windows |
| `processed-calls-store.ts` | Ingest idempotency ledger |
| `call-log-sync-state.store.ts` | Singleton cursor + five-minute renewable run lease with owner-fenced writes |
| `ringcentral-metrics.ts` | Section 33 RingCentral runtime/adoption/contention metrics |
| `scripts/migrations/ringcentral-processed-call-indexes.ts` | Report/apply/verify unique call-log race fence |
| `scripts/migrations/granot-lifecycle-indexes.ts` | Report/apply/verify the unique Call Log sync state singleton key index |
| `shadow-call-leads-store.ts` | Shadow-mode staging |
| `leads/callLead.service.ts` | `createRingCentralCallLead` — Mongo + Sheet Sync |
| [`call-lead.md`](./call-lead.md) | Call Lead create semantics, CPL, sheet tabs |
| [`ringcentral-integration.mdc`](../../../.cursor/rules/ringcentral-integration.mdc) | Env, webhooks, cron wiring |
| [`ringcentral-call-lead-candidates.mdc`](../../../.cursor/rules/ringcentral-call-lead-candidates.mdc) | Pipeline boundaries |

## Tests

- `call-candidate.test.ts` — evaluator, source resolution, webhook normalization
- `call-session-aggregator.test.ts` — multi-party session decisions
- `callLeadConvergence.test.ts` / `.replica.test.ts` — exact selection, canonical adoption/conflict, atomicity, rollback, and races
- `ringcentral-call-lead-ingest.service.test.ts` — adoption-before-duplicate and continued non-adoption behavior
- `ringcentral-duplicate-guard.test.ts` — adopted-ID, unresolved-candidate, scope, and prior-window exclusions
- `processed-calls-store.test.ts` and migration tests — terminal statuses and identity fences
- `call-log-sync-state.store.test.ts` — AC-17 lease claim/expiry/renewal/takeover/fencing/release and singleton collision (Mongo assertions are replica-gated)
- `call-log-sync.service.test.ts` — AC-17 claim-before-work, loser no-op, renewal, stop-on-loss, cursor-on-full-success only, 12-hour floor, telemetry privacy, and oldest-first same-run ingest
- `call-log-sync-lease.replica.test.ts` — AC-17 real concurrent runs, cursor immobility on failure, expiry takeover, and rescan idempotency
- `ringcentral-cron.routes.test.ts` — auth, disabled skip, `lease_held` skip, safe failure, and the exact `vercel.json` entry
