**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/ringcentral/`  
**Domain terms used:** Call Qualification, Call Lead Ingestion, Call Lead, Duplicate Lead, Caller Match Key, Operational Event, Main Site

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
 ingest when qualified + terminal                    ingest each qualified record
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

**Route:** `GET|POST /api/cron/ringcentral-call-log-sync` (Vercel cron, `CRON_SECRET`). Gated by `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`.

Each run:

1. **Window:** `resolveWindowStart` — max of cursor overlap (`lastSyncTo - overlap`, default 15m) and rolling lookback floor (default 12h); first run uses initial lookback (default 30m). Guards long calls and RingCentral finalization lag.
2. **Fetch:** Detailed inbound voice Call Log, paginated (250/page, max 20 pages).
3. **Vet:** `vetRingCentralCallLogRecord` per record — same business rule as evaluator; exposes `rejectionReasons[]`.
4. **Ingest:** Qualified rows → `RingCentralQualifiedCall` with `ingestionSource: "call_log_sync"`, `qualificationReason: "call_log_inbound_target_answered_over_120s"`, `answeredAt = startTime`, `terminalAt = start + duration`.
5. **Cursor:** Advances only on success; errors leave window for retry. Re-scans are safe — ingest idempotency skips already-processed sessions/logs.

**Local script:** `pnpm ringcentral:call-log:sync:run`.

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

Granot Call creation and RingCentral adoption/normal creation share a hashed Source Granularity + normalized-phone scope fence in `ringcentral_convergence_locks`. The lock contains no raw phone. Both paths ensure the lock row before opening their canonical transaction, update it inside the transaction before checking the counterpart, and re-read/replan on revision or idempotency races. This closes the absent-row race where Granot and RingCentral could otherwise each create a Lead.

More than one candidate is never guessed. `markRingCentralConvergenceConflict` atomically revalidates the full candidate set, sets every still-eligible row to `conflict` with reason `multiple_adoption_candidates` and a bounded call-identity hash, records canonical Change/outbox evidence, then allows the qualified call to continue through normal ingest. A failed conflict transaction is a technical failure, not a silent fallback. Zero/ineligible candidates also continue through normal create/shadow/dry-run behavior without mutating an existing Lead.

### Duplicate correctness

The existing business rule remains exact Source Granularity + normalized phone + a different non-duplicate Call Lead in the earlier-only 90-day window: timestamp is `>= call time - 90 days` and `< call time`. The lower 90-day boundary is inclusive; future/same-time rows are not prior Leads. Source Company alone is never the boundary.

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

Duplicate Call Leads still persist and **Sheet Sync** to `Duplicate Calls` tab (see [`call-lead.service.md`](call-lead.service.md)).

**Config note:** `duplicateWindowHours` in `ringcentral-config.ts` (`RINGCENTRAL_DUPLICATE_WINDOW_HOURS`, default 24) is debug metadata only — not used by the duplicate guard (hardcoded 90 days).

### Adoption rollout, rollback, and processed-ledger index

- `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` is the checked-in fail-closed default. False skips candidate/conflict mutation and preserves the prior qualified-call path.
- Enabling the flag attempts convergence before duplicate classification, but Lead adoption/conflict mutations still require RingCentral write mode `create`. Shadow/dry-run may evaluate the bounded outcome and then continue their normal non-mutating path.
- Roll out separately only after the unique sparse `callLogId` processed-ledger index is verified and focused/replica proofs pass. Keep the existing `RINGCENTRAL_CREATE_CALL_LEADS` / shadow posture independent.
- Roll back first by setting the adoption flag false. Never detach committed RingCentral evidence, reset convergence, rewrite Granot origin/snapshots, delete conflicts/ledger/Command/Change/outbox evidence, decrement revisions, or automatically reverse duplicate classification.

`lead_adopted` and `lead_adopted_duplicate` are terminal ledger statuses. Adoption requires both unique processed-ledger race fences: sparse unique `telephonySessionId` and sparse unique `callLogId`. Runtime index bootstrap does not create the call-log index inside an adoption transaction; adoption fails closed if either fence is missing.

`pnpm migration:ringcentral:processed-call-indexes -- --report|--apply|--verify` owns the call-log refinement. Report is default and emits only collision counts, hashes, masked IDs, and null/empty sparse-placeholder counts. Apply refuses collisions, unsets non-identifying call-log/session placeholders, and requires the standard explicit database/apply authorization plus matching `RINGCENTRAL_COLLECTION_MODE`; verify fails when collisions/placeholders remain or the required index is absent. Unit 20 added the migration but did **not** authorize or perform a production apply.

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
- RingCentral Mongo collections use `_test` suffix unless `RINGCENTRAL_COLLECTION_MODE=production`.

## Debug / local tooling

| Tool | Purpose |
|------|---------|
| `GET /api/dev/ringcentral/*` | Candidates, sessions, decisions, processed calls, config |
| `pnpm ringcentral:webhook:monitor` | Live webhook inspection |
| `pnpm ringcentral:workflow:test` | End-to-end qualification scenarios |
| `pnpm ringcentral:call-log:sync:run` | Manual cron run + artifact JSON |

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
| `scripts/migrations/ringcentral-processed-call-indexes.ts` | Report/apply/verify unique call-log race fence |
| `shadow-call-leads-store.ts` | Shadow-mode staging |
| `leads/callLead.service.ts` | `createRingCentralCallLead` — Mongo + Sheet Sync |
| [`call-lead.service.md`](call-lead.service.md) | Call Lead create semantics, CPL, sheet tabs |
| [`rules/ringcentral-integration.mdc`](../rules/ringcentral-integration.mdc) | Env, webhooks, cron wiring |
| [`rules/ringcentral-call-lead-candidates.mdc`](../rules/ringcentral-call-lead-candidates.mdc) | Pipeline boundaries |

## Tests

- `call-candidate.test.ts` — evaluator, source resolution, webhook normalization
- `call-session-aggregator.test.ts` — multi-party session decisions
- `callLeadConvergence.test.ts` / `.replica.test.ts` — exact selection, canonical adoption/conflict, atomicity, rollback, and races
- `ringcentral-call-lead-ingest.service.test.ts` — adoption-before-duplicate and continued non-adoption behavior
- `ringcentral-duplicate-guard.test.ts` — adopted-ID, unresolved-candidate, scope, and prior-window exclusions
- `processed-calls-store.test.ts` and migration tests — terminal statuses and identity fences
