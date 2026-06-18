# RingCentral Call Lead Qualification (`ringcentral/`)

**Role:** Decide which RingCentral inbound calls qualify as billable call leads, then promote them through one shared ingest path. Mongo `call_leads` are created only via `ingestRingCentralQualifiedCall` — never from routes, webhooks, cron, or scripts directly.

**Hybrid strategy:** Real-time **webhook** session tracking (best-effort duration) + scheduled **Call Log** sync (authoritative records). Both paths build a `RingCentralQualifiedCall` and hand it to ingest so qualification rules, idempotency, duplicates, and write mode stay identical.

**Source of truth for leads:** Mongo `call_leads` (when write mode is `create`). RingCentral Call Log is authoritative for cron qualification timing; webhook candidates are operational state until terminal + ingest.

## Core qualification rule

Shared constant: `CALL_LEAD_MINIMUM_ANSWERED_SECONDS = 120` (`call-candidate-evaluator.ts`).

A call qualifies when **all** are true:

| Criterion | Webhook (`call-candidate-evaluator`) | Cron (`call-log-vetting.ts`) |
|-----------|--------------------------------------|------------------------------|
| Direction | `Inbound` | `Inbound` |
| Target toll-free | `to.phoneNumber` matches `RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE` | Same — scan record + legs |
| Answered | Party/session `answered` with `answeredAt` | `result` in answered set (`Accepted`, `Completed`, `Connected`, …) |
| Duration | `answeredAt` → `terminalAt` (or `now` if still live) ≥ 120s | `duration` / `durationMs` / leg max ≥ 120s |
| Caller phone | Normalized `from` present | Caller from inbound leg / record `from` |

**Inbound mapping:** `call-lead-sources.ts` — four toll-frees → `sourceLabel` + `sourceCompany` (`main_site`, `top10_leads`, `tbm_leads`, `tbm_prime_leads`). Filter in code after account-wide webhook subscription (queue/IVR legs may use non-toll-free `to` numbers).

**Party semantics:** On inbound candidate events, `from` = customer caller, `to` = RingCentral number/queue. Telephony sessions have multiple parties — qualify on **party direction** and aggregate at session level for webhooks.

## Pipeline overview

```
                    ┌─────────────────────────────────────┐
                    │  ingestRingCentralQualifiedCall     │
                    │  (idempotency → duplicate → write)  │
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

`ingestRingCentralQualifiedCall(call)` — **the only** RingCentral path that may create real `call_leads`, shadow records, or dry-run ledger entries.

### Order of operations

```
1. findProcessedCall(telephonySessionId | callLogId)
   └─ already lead_created / lead_created_duplicate / shadow_recorded → skipped_already_processed

2. classifyRingCentralCallLeadDuplicate (ringcentral-duplicate-guard.ts)
   └─ same caller phone + source within RINGCENTRAL_DUPLICATE_WINDOW_HOURS (default 24h)
      excluding current telephonySessionId; only matches non-duplicate prior leads

3. resolveRingCentralLeadWriteMode (ringcentral-config.ts)
   └─ create | shadow | dry_run

4. Write + upsertProcessedCall ledger (ringcentral_processed_calls)
```

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
| `lead_created_duplicate` | Lead created with `duplicate: true`, `cpl: 0` |
| `shadow_recorded` | Shadow collection write |
| `dry_run` | Ledger recorded, no lead |
| `skipped_already_processed` | Idempotent skip |

### Idempotency vs business duplicate

| Concern | Mechanism | Purpose |
|---------|-----------|---------|
| **Idempotency** | `ringcentral_processed_calls` + unique sparse `ringcentral.telephony_session_id` on `call_leads` | Same call (webhook + cron, or double webhook) must not insert twice |
| **Business duplicate** | `classifyRingCentralCallLeadDuplicate` | Different call, same caller+source within window → `duplicate: true`, zero CPL |

Duplicate leads still persist and sync to `Duplicate Calls` tab (see `call-lead.service.md`).

### Operational events

| Event | When |
|-------|------|
| `ringcentral.call_lead.created` | Real lead, non-duplicate |
| `ringcentral.call_lead.duplicate_created` | Real lead, duplicate |
| `ringcentral.call_lead.skipped_already_processed` | Idempotent skip |
| `ringcentral.call_log_sync.completed` / `.failed` | Cron run outcome |
| `ringcentral.webhook.ingest_failed` | Ingest threw on qualified session |

## Invariants

- Never create RingCentral `call_leads` outside `ingestRingCentralQualifiedCall`.
- Never bypass `evaluateRingCentralCallCandidate` / `vetRingCentralCallLogRecord` for the 120s rule.
- Webhook ingest requires **qualified + terminal** session; cron ingest uses finalized Call Log duration.
- Target-number gating always uses `resolveRingCentralInboundSource` — do not hardcode source companies in routes.
- Analytics reconcile (`analytics-reconcile.service.ts`) is count-level comparison only — **must not** create leads.
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
| `ringcentral-config.ts` | Feature flags, write mode, sync windows |
| `processed-calls-store.ts` | Ingest idempotency ledger |
| `shadow-call-leads-store.ts` | Shadow-mode staging |
| `leads/callLead.service.ts` | `createRingCentralCallLead` — Mongo + sheet sync |
| `call-lead.service.md` | Call lead create semantics, CPL, sheet tabs |
| `rules/ringcentral-integration.mdc` | Env, webhooks, cron wiring |
| `rules/ringcentral-call-lead-candidates.mdc` | Pipeline boundaries |

## Tests

- `call-candidate.test.ts` — evaluator, source resolution, webhook normalization
- `call-session-aggregator.test.ts` — multi-party session decisions
- `bookedCallLeadReconciliation` tests are unrelated; RingCentral ingest has integration coverage via workflow test script and service unit tests on evaluator/aggregator.
