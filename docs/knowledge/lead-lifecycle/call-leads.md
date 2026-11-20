---
okf_version: "0.2"
type: Reference
title: Call Leads
description: How a Call Lead is minted from RingCentral inbound queue qualification, adopted, given its final result, admitted for reporting, updated and deleted, at main 9955430d.
tags: [lead-lifecycle, call-lead, ringcentral]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/ringcentral/call-qualification.ts
  - src/services/ringcentral/callLeadQualification.ts
  - src/services/ringcentral/call-log-vetting.ts
  - src/services/ringcentral/call-log-sync.service.ts
  - src/services/ringcentral/webhook-call-log-qualification.ts
  - src/services/ringcentral/ringcentral-call-lead-ingest.service.ts
  - src/services/ringcentral/callLeadConvergence.service.ts
  - src/services/ringcentral/ringcentral-duplicate-guard.ts
  - src/services/domainCommands/ringcentralFinalResult.ts
  - src/services/domainCommands/existingWrites.ts
  - src/services/leads/callLead.service.ts
  - src/services/leads/callLeadAdmission.ts
  - src/services/leads/legacyBestRelocationCalls.ts
  - src/services/leads/receiverAgentWrite.ts
  - src/services/granotLifecycle/callLeadMoveDateRepair.ts
  - src/services/salesOutreach/contacts/mongoStore.ts
  - src/routes/ringcentral-webhook.routes.ts
  - src/routes/ringcentral-cron.routes.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/ringcentral/ringcentral-call-lead-ingest.service.ts
  - id: lead
    resource: src/services/leads/callLead.service.ts
  - id: admission
    resource: src/services/leads/callLeadAdmission.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Call Leads

This page covers how a **Call Lead** is minted, qualified, adopted, given its final RingCentral result, admitted for reporting, updated and deleted. Every rule cites code at `main` `9955430d`. Line ranges are from that commit.

Sibling pages: [README.md](README.md) (state model), [duplicates-and-form-fill.md](duplicates-and-form-fill.md) (90-day repeat and Form Fill), [bad-leads.md](bad-leads.md) (Bad Calls), [granot-effects.md](granot-effects.md) (Granot on Calls), [reporting-and-sheets.md](reporting-and-sheets.md) (the full routing table), [downstream-consumers.md](downstream-consumers.md).

## Locked Owner rules

These are locked. Code that disagrees is a finding, not a reason to soften the rule.

1. **Call Lead billing, 2026-11-03.** "Only RingCentral inbound queue qualification may create a Call Lead or make it eligible for Calls reporting and lead billing." A Form/Call sibling must already have qualified. Enrichment, a matching contact, a Granot job, booking status or an old Sheet row never qualifies a Call. Manual and external-sheet Call creation and Granot Call `create_if_missing` are removed. Legitimate saved historical RingCentral qualification is preserved without perfect modern provenance. Official Booking and Cancellation rows remain reportable.
2. **Best Relocation exceptions, 2026-11-03.** The closed 69-record historical inventory (`best-relocation-legacy-reporting-v1`) and the one-time trusted final import admission are the only non-RingCentral Call admissions. The final reconciliation is complete. External ingestion and Granot creation are retired.
3. **Master Leads Calls tab, 2026-11-20 (relayed by the coordinator).** "No backfill or major change on the Master Leads Calls tab. The Owner handles removals and inspection there manually. Rule: only RingCentral-queue-qualified Call Leads get minted and take part in the lifecycle." This pack never proposes a backfill or repair of the Calls tab. Existing excluded rows are Owner-managed (see [Excluded Calls that still have rows](#excluded-calls-that-still-have-rows)).

## State model at a glance

```
RingCentral inbound call (webhook wake or 30-min Call Log scan)
  └─ vetRingCentralCallLogRecord: Inbound, mapped route, finished, ≥120 s parent elapsed, caller phone, identity
       └─ ingestRingCentralQualifiedCall
            ├─ already processed → skip (may record final result)
            ├─ adoption flag on + exactly one pending Granot-created Call → adoptRingCentralCall
            ├─ adoption flag on + several → markRingCentralConvergenceConflict, then continue
            └─ 90-day repeat classification → createCallLead (beginRingCentralCallLeadIngestion)
                 └─ form_fill at create, CPL at create (0 when duplicate), ringcentral.* facts, final result
Reporting: getCallLeadReportingDecision → excluded | calls | duplicate_calls | bad_call_leads
```

## 1. Mint paths

There is exactly one mint path: `new CallLead(...)` inside `beginRingCentralCallLeadIngestion` (`src/services/leads/callLead.service.ts` L206–L257). A repository-wide search for `new CallLead(`, `CallLead.create(`, `insertMany` and `bulkWrite` on `call_leads` finds no other runtime writer. The only other inserts are synthetic seeds in `ops/insights/seed-synthetic.ts` and replica harnesses under `ops/sales-outreach/*.replica.ts` (test-harness).

| Rule | Detail |
|---|---|
| **Source** | `src/services/leads/callLead.service.ts:beginRingCentralCallLeadIngestion` L206–L257 @ `9955430d` |
| **Precondition** | `hasQualifiedRingCentralCall(input.ringcentral)` and both `ringcentral.route_assignment_id` and `ringcentral.route_id` present, else `V1ServiceError(409, "RingCentral inbound queue qualification is required")` (L210–L212). |
| **Caller** | Only `ingestRingCentralQualifiedCall` (`src/services/ringcentral/ringcentral-call-lead-ingest.service.ts` L366–L369) in write mode `create`. The injectable adapter `ingestRingCentralCallLead` (L295–L316) is used only when a test injects `createLead`. |
| **Precedence** | Idempotency skip and adoption run first; create happens only when neither succeeded. |
| **Time window / clock** | No window. `timestamp` is `toFloridaTimestamp(input.timestamp)` (L223): the New York wall-clock of the call start, stored as if it were UTC. `ringcentral.start_time` keeps the true UTC instant. |
| **Idempotency** | `ringcentral_processed_calls` terminal row looked up by telephony session, session or Call Log id (ingest L156–L189); the unique sparse index on `ringcentral.telephony_session_id` (`src/models/CallLead.ts` L215–L218); duplicate-key race returns `skipped_already_processed` (ingest L394–L425). The create EntityChange is not an idempotent canonical command: it carries a fresh `command_execution_id` (L259–L289). |
| **Fields written** | Source assignment (`source_company`, `lead_source_company`, `source_granularity_id`, `source_granularity_key`, label snapshots; L318–L330), `phone_number`, `duration`, `start_time`, `end_time`, `timestamp`, `form_fill` (L216–L223), `duplicate` (from the guard, L332–L334), CPL snapshot (L225–L231, L351–L361), `ingestion_origin: "ringcentral"`, `ingested_contact_snapshot`, `quoted: false` (L363–L375), `no_sync: false` (`noSyncOnCreate("ringcentral")`, `leadIngestionProvenance.ts` L171–L179), and `ringcentral.*` (L377–L398). |
| **EntityChange** | `createCallLead` on `CallLead`, `before: null`, all set paths (L267–L289). Production: 423 rows, 2026-09-01 → 2026-11-20 15:30 UTC (`commands.json`). |
| **Sheet Sync** | `call_lead.create` intent persisted in the transaction when `no_sync !== true` (L250–L254); `completeCallLeadIngestion` projects after commit (L130–L146). The planner upserts the one disposition tab and deletes stale Call tabs (`sheetSync/drainer/jobPlanner.ts` L181–L193). An excluded Call plans no write (L171). |
| **Outreach** | The create EntityChange is consumed by the Outreach Lead-change feed ([downstream-consumers.md](downstream-consumers.md)). |
| **Daily Operations** | `recordCallLeadDailyOperationsFact` (`dailyOperations/recordDomainFacts.ts` L230–L262): `call_lead.unmatched`, `call_lead.duplicate` or `call_lead.created`, dedupe key `call_lead:<id>:<suffix>`. |
| **Form Fill** | The EntityChange paths include `phone_number`, `source_*`, `duplicate` and `ringcentral`, so `persistEntityChangeMutations` also schedules a `form_fill_work` row for the Call (`domainCommands/entityChange.ts` L418–L421). See [duplicates-and-form-fill.md](duplicates-and-form-fill.md#form-fill-rule). |

### Closed creation paths (cite the guard)

| Path | Guard @ `9955430d` | Production evidence |
|---|---|---|
| Manual / Admin / API create | No `POST /api/v1/call-leads` route (`src/routes/v1.routes.ts` L545–L576 lists only browse, search, previews, PATCH and DELETE). `runExistingCreateCallLead` throws 409 (`domainCommands/existingWrites.ts` L169–L177). `ingestCallLead` and `beginCallLeadIngestion` throw 409 (`callLead.service.ts` L118–L128). `createCallLeadSchema` survives only as a validation schema (`validation/v1/leads.validation.ts` L284–L295). | 5 `vantage_admin` Calls exist (Sept 1–2, before closure). |
| External-sheet Call creation (Best Relocation tracker ingestion) | Removed with its routes, queue consumer and services in `226dba24` (2026-11-18). `api/queues/best-relocation-ingestion-consumer.ts` and `src/routes/ingestion.routes.ts` no longer exist. | 43 `best_relocation_sheet` Calls from the Nov 4 final run. |
| Granot Call `create_if_missing` / `createLeadFromGranot` on a Call | `createLeadFromGranot` throws `CreateLeadFromGranotRaceError("policy")` when `lead_model === "CallLead"` (`granotLifecycle/createLeadFromGranot.ts` L163). Source policy validation rejects `create_if_missing` on any Call route: "Only RingCentral can create Call Leads. Use link_only for Call routes." (`models/granotCrmSourceSemantics.ts` L112–L114). The planner mints only Form Leads (`granotLifecycle/leadDesiredState.ts` L263–L284). | 8 `createLeadFromGranot` Call rows, 2026-09-02 19:24 → 2026-09-03 14:48 UTC; 7 still carry `ingestion_origin: "granot_lead_created"`. |
| Booking-placeholder Call / created on unmatched booking | No writer sets `created_on_unmatched: true` anywhere in `src/`, `api/` or `ops/` (only the schema default `false`, `models/CallLead.ts` L133). | 2 Calls with `created_on_unmatched: true` (Sept 8, no origin, no Sheet row). |

## 2. RingCentral queue qualification

### 2.1 The qualification predicate

| Rule | Detail |
|---|---|
| **Source** | `src/services/ringcentral/call-qualification.ts:qualifyRingCentralCall` L19–L36; `call-log-vetting.ts:vetRingCentralCallLogRecord` L58–L129, `readParentElapsedSeconds` L131–L139 @ `9955430d` |
| **Direction** | Parent record `direction === "Inbound"` (else `not_inbound`). |
| **Mapped inbound number** | The target `to.phoneNumber` on the parent record, or on a leg with the same caller and no other telephony session, must resolve through the effective-dated Operations Registry route snapshot at the call start: `resolveRingCentralInboundRoute(snapshot, normalized, startTime)` (`findTarget` L185–L205). The resolution supplies the Source Company slug, canonical `company_id`, `granularity_id` (the **Source Granularity**), labels, `route_id` and `assignment_id`. No static fallback: `call-lead-sources.ts` is a migration/test seed only (L1–L69). Unmapped → `target_number_not_matched`. |
| **Elapsed time** | Parent elapsed time ≥ 120 s (`CALL_LEAD_MINIMUM_ELAPSED_SECONDS`, L3). Precise `durationMs/1000` wins; rounded `duration` is used only when `durationMs` is absent, and exactly `120` rounded seconds is treated as unknown (L131–L139). Answering is optional. Legs are never summed and never supply the duration (L83–L85). Else `under_120_seconds`. |
| **Caller phone** | Normalized parent `from.phoneNumber` present (else `missing_caller_phone_number`). No caller substitution from legs. |
| **Finished record** | `root.finished === true` (else `call_completion_unconfirmed`), `type === "Voice"`, a start time, and a Call Log id or telephony session id (L98–L106). |
| **Precedence** | All reasons must be absent (`qualifies: rejectionReasons.length === 0`). |
| **Time window / clock** | Route effective dating uses the call start instant (UTC). |
| **Idempotency** | A rejected record writes nothing; the next scan re-vets it. |
| **Effects** | None until ingest. Route observation is recorded for matched targets (`call-log-sync.service.ts` L462–L471; webhook route L447–L474). |

The qualified descriptor is built by `qualifiedCallFromCallLog` (`call-log-vetting.ts` L149–L183): `qualificationReason: "call_log_inbound_target_elapsed_at_least_120s"`, `answeredAt: null`, `terminalAt = start + elapsed`, and `finalCallLogResult` from the parent `result` with `answered` taken from the parent or a same-session leg (L86–L88).

### 2.2 Saved qualification (`ringcentral.qualification_reason`) and preserved history

| Rule | Detail |
|---|---|
| **Source** | `src/services/ringcentral/callLeadQualification.ts:hasQualifiedRingCentralCall` L11–L18, `qualifiedCallLeadFilter` L21–L36 @ `9955430d` |
| **Accepted saved facts** | `ringcentral.ingestion_source ∈ {call_log_sync, webhook}` (`manual` is rejected); `ringcentral.qualification_reason ∈ {call_log_inbound_target_elapsed_at_least_120s, call_log_inbound_target_answered_over_120s}`; numeric `ringcentral.duration_seconds ≥ 120`; and a non-blank string `ringcentral.telephony_session_id` or `ringcentral.call_log_id`. |
| **Two reason values** | `call_log_inbound_target_answered_over_120s` is the older, pre-route-ID format written before the 2026-10-20 "answer optional" amendment. `call_log_inbound_target_elapsed_at_least_120s` is the current value written by both transports (`call-log-vetting.ts` L175). Both are accepted (L4–L7). This is the "preserved historical qualification" rule: no `route_id`, `route_assignment_id`, `start_time` or final result is required on a saved Call. |
| **Who writes the reason** | Create (`callLead.service.ts` L385, from ingest L310) and adoption (`callLeadConvergence.service.ts` L553). No other writer. `ringcentral` is a forbidden public patch field (`models/granotLifecycleSchemas.ts` L380–L400), so PATCH cannot set it. |
| **Precedence** | First branch of `hasReportingEligibleCall` (`leads/callLeadAdmission.ts` L52–L56). |
| **Production (coordinator read 2026-11-20 12:50 NY)** | 1,794 Calls pass `qualifiedCallLeadFilter`: 1,614 with the older reason (1,047 `legacy_unknown`, 562 `ringcentral`, 5 `granot_lead_created`) and 180 with the current reason (all `ringcentral`). |

### 2.3 Webhook transport

| Rule | Detail |
|---|---|
| **Source** | `src/routes/ringcentral-webhook.routes.ts:POST /api/webhooks/ringcentral` L73–L214, `processSessionsAndIngest` L397–L445, `ingestSessionLead` L476–L493; `src/services/ringcentral/webhook-call-log-qualification.ts:qualifyWebhookCallFromCallLog` L13–L39 @ `9955430d` |
| **Gate** | `RINGCENTRAL_WEBHOOK_ENABLED` (default true, `ringcentral-config.ts` L105). Disabled → capture only, no ingest. |
| **Wake** | A mapped session (`targetMatched`) whose start is at least 120 s ago by wall clock, touched by an event with status `Disconnected`, `Gone`, `Finished`, `Voicemail`, `Missed` or `NoCall`. |
| **Authorization** | The party/session preview never authorizes creation. `qualifyWebhookCallFromCallLog` reads Detailed Call Log for that exact `telephonySessionId`; an incomplete page returns no records; exactly one record must pass `vetRingCentralCallLogRecord`, else `awaiting_final_call_log` with no write. |
| **Descriptor** | `ingestionSource: "webhook"`, same reason as cron. |
| **Idempotency / effects** | As shared ingest. Errors return `ingest_failed` and the cron recovers. |

### 2.4 Scheduled Call Log sync

| Rule | Detail |
|---|---|
| **Source** | `src/routes/ringcentral-cron.routes.ts` L47–L85; `src/services/ringcentral/call-log-sync.service.ts:runRingCentralCallLogSync` L164–L414, `processRecord` L454–L502, `resolveWindowStart` L569–L584 @ `9955430d` |
| **Trigger** | Vercel cron `/api/cron/ringcentral-call-log-sync`, `*/30 * * * *` (`vercel.json`), `CRON_SECRET`, gated by `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`. |
| **Window / clock** | UTC instants. `windowTo` = lease claim instant; `windowFrom` = earlier of `lastSyncTo − overlap` (default 15 min) and `windowTo − 12 h` rolling floor; first run uses `windowTo − lookback` (default 30 min) under the same floor. |
| **Order** | Records are sorted oldest-first before ingest (L310, L432) so the 90-day guard sees an earlier same-run call. |
| **Idempotency** | Mongo lease (one winner) and processed-call ledger; the cursor advances only after full success. |
| **Effects** | Each qualified record → `ingestRingCentralQualifiedCall(..., "call_log_sync")`. Because the 12-hour floor rescans recent history, an already-processed call is re-vetted every run for about 12 hours; that is how later final-result observations reach existing Calls (§4). |

The other RingCentral crons do not touch Call Leads: `ringcentral-analytics-reconcile` stores an answered-call diagnostic rollup only (`analytics-reconcile.service.ts`), and the `sales-intelligence-call-log-*` crons maintain call interactions for the Desk; they read Leads and never create one.

### 2.5 Shared ingest

| Rule | Detail |
|---|---|
| **Source** | `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts:ingestRingCentralQualifiedCall` L149–L517 @ `9955430d` |
| **Order** | (1) processed-call ledger terminal → skip, but first record a final result when the write mode is `create` (L156–L189); (2) convergence (L213–L275); (3) 90-day classification with the call start as the clock (L277–L287); (4) create, shadow or dry-run by write mode (L289–L452); (5) ledger (L370–L389 inside the create transaction; L454–L472 otherwise). |
| **Write mode** | `create` when `RINGCENTRAL_CREATE_CALL_LEADS=true`, else `shadow` when `RINGCENTRAL_SHADOW_CALL_LEADS=true`, else `dry_run` (`ringcentral-config.ts` L120–L131, L233–L241). Shadow writes `shadow_call_leads`; dry run writes only the ledger. |
| **Ledger statuses** | Terminal: `lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`, `shadow_recorded` (`processed-calls-store.ts` L67–L73). Production ledger (read 2026-11-20 17:50 UTC): 1,546 `lead_created`, 243 `lead_created_duplicate`, 5 `lead_adopted`. |
| **Structured logs** | `ringcentral.ingest.skipped_already_processed`, `ringcentral.ingest.processed`, `ringcentral.call_lead.created` / `.duplicate_created`, `ringcentral.granot_adoption.adopted` / `.conflict`, `ringcentral.call_lead.convergence_*`. |

## 3. Adoption and convergence

> Granot Call creation is retired (§1), so new adoption candidates can no longer appear. The code path remains for any still-pending Granot-created Call.

| Rule | `adoptRingCentralCall` | `markRingCentralConvergenceConflict` |
|---|---|---|
| **Source** | `callLeadConvergence.service.ts:attemptRingCentralCallLeadConvergence` L285–L415, `adoptRingCentralCall` L417–L442, `applyAdoption` L473–L649 | `markRingCentralConvergenceConflict` L444–L471, `applyConflict` L651–L762 |
| **Gate** | `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` (default false, `ringcentral-config.ts` L138–L140) and write mode `create` for mutations. | Same. |
| **Candidate** | `findCandidates` L194–L213: same `source_granularity_id` as the resolved route, `ingestion_origin: "granot_lead_created"`, `ringcentral_convergence.state: "pending"`, immutable `ingested_contact_snapshot.normalized_phone_number` equal to the caller, no saved RingCentral identity, `createdAt` within call start ± 12 h (`ADOPTION_WINDOW_MS` L35). Exactly one → adopt. | Two or more → conflict. |
| **Writes** | `$set` `duration`, `start_time`, `end_time`, `duplicate` (re-classified with the adopted Lead excluded), CPL snapshot only when duplicate (zero), full `ringcentral.*` including `qualification_reason`, `route_id`, `original_caller`, and `ringcentral_convergence.state: "adopted"`, guarded by expected `domain_revision` and pending state (L506–L593). Non-duplicate adoption keeps the Granot-created CPL. No `form_fill` write; the `ringcentral` change schedules Form Fill work (§1). | `ringcentral_convergence.state: "conflict"`, `conflict_reason: "multiple_adoption_candidates"`, `conflict_call_identity_hash` on every candidate (L713–L728). The call then continues to normal create. |
| **Precedence** | Before 90-day classification and before create. The adopted Lead is excluded from its own duplicate check. | Conflict never chooses a candidate. |
| **Idempotency** | Canonical command, `idempotency_key: ringcentral:adopt:<telephonySessionId or callLogId>`, payload checksum over target and call (L843–L874, L972–L978); transaction revalidates candidate, revision and route; ledger `lead_adopted(_duplicate)` in the same transaction. | `ringcentral:convergence-conflict:<identity>`. |
| **Effects** | EntityChange `adoptRingCentralCall`; Sheet `call_lead.update` outbox; ledger row. Final result is then recorded through §4 (ingest L218–L221). | EntityChange per candidate; `call_lead.update` per candidate; Daily Operations `exception.adoption_conflict` with dedupe `exception:adoption_conflict:ringcentral:<identity>` (ingest L265–L274; `recordDomainFacts.ts` L621–L631). |

**Production.** 5 `adoptRingCentralCall` revisions, all 2026-09-02 (`commands.json`); 0 conflicts. Example (anonymized, read 2026-11-20 17:51 UTC): a Top10 Inbounds Call was created by `createLeadFromGranot` at 19:24:22 UTC with `ringcentral_convergence.state: "pending"`. The caller's call had started at 19:09:50 UTC and lasted 867 s. The 19:30 Call Log run adopted it at 19:30:17 UTC with changed paths `ringcentral` and `ringcentral_convergence`. It kept `ingestion_origin: "granot_lead_created"`, CPL 190 (`resolved`) and `duplicate: false`, and gained `qualification_reason: call_log_inbound_target_answered_over_120s` (the older format, Sept 2). It is reporting-eligible through §2.2 and sits on Calls. Two Granot-created Calls remain `pending`: one is in the Best Relocation historical inventory; the other has no admission and is one of the excluded rows below.

## 4. Final result and the watermark (`ringcentral.final_result*`)

| Rule | Detail |
|---|---|
| **Source** | `src/services/domainCommands/ringcentralFinalResult.ts:planRingCentralFinalResultUpdate` L23–L60, `loadCall` L62–L77, `persistRingCentralFinalCallLogResult` L88–L165 @ `9955430d` |
| **At create** | The four fields `final_result`, `final_result_observed_at`, `final_result_call_log_id`, `final_result_answered` are written at create from the vetted record (ingest L312–L317; `callLead.service.ts` L387–L390). `final_result_observed_at` is the Call Log read time, not the call time. |
| **Later observation** | `persistRingCentralFinalCallLogResult` runs when the call is already processed (ingest L168–L170), after adoption (L218–L221) and after a duplicate-key race (L412–L414). It needs a saved qualified Call with the same telephony session or Call Log id, a matching observation Call Log id, and a valid start. |
| **Watermark** | `ringcentral.final_result_observed_at`. An observation at or before the saved watermark is ignored (L38–L39). Same facts, newer time → watermark-only `updateOne` in a transaction, with no command record, no EntityChange, no `domain_revision` change and no Sheet intent (L118–L131). Changed facts → canonical `recordRingCentralFinalCallLogResult` (L132–L157). |
| **Fields written by the command** | `ringcentral.final_result`, `final_result_observed_at`, `final_result_answered`, `final_result_call_log_id`, `ringcentral.call_log_id`, and `ringcentral.start_time` only when missing (L49–L59). Never qualification, source, duplicate, caller or Granot facts. |
| **Precedence** | Equal-time disagreement keeps the first saved fact. |
| **Idempotency** | `ringcentral:final-result:<leadId>:<revision>:<sha256(id, revision, patch)>`; expected revision rechecked inside the transaction; up to two retries on revision conflict. |
| **Effects** | EntityChange `recordRingCentralFinalCallLogResult` with the changed `ringcentral.*` paths; Sheet `call_lead.update` (which can move a Call to Bad Call Leads, see [bad-leads.md](bad-leads.md#overnight-missed-call)); Outreach sees the EntityChange; no Daily Operations fact. |
| **Production** | 16 command rows, all 2026-11-03 21:30–22:26 UTC: the November 1 general Call backfill (`ops/best-relocation-retirement/callBackfill.ts:applyCallBackfill` L288–L338). Since then every new Call carries its result at create, so the command has not been needed. 101 Calls have a final result; 1,693 qualified Calls (mostly before Nov 3) have neither `ringcentral.start_time` nor a final result. |

## 5. Reporting admission: what is an admitted Call

`hasReportingEligibleCall` (`src/services/leads/callLeadAdmission.ts` L52–L61) and its Mongo twin `reportingEligibleCallLeadFilter` (L64–L103) admit a Call when any one holds:

| Branch | Rule | Production (coordinator, 2026-11-20 12:50 NY) |
|---|---|---|
| Saved RingCentral qualification | §2.2 | 1,794 |
| Best Relocation historical inventory | `hasLegacyBestRelocationCall` (L43–L49): `_id` in the closed 69-ID list `LEGACY_BEST_RELOCATION_CALL_IDS` (`legacyBestRelocationCalls.ts`, manifest `best-relocation-legacy-reporting-v1`, captured 2026-11-03T21:43:54.101Z, count 69, SHA-256 of the sorted IDs), `source_company: "best_relocation_leads"`, and canonical company/feed IDs `6a4d240f3117eacd97823868` / `6a4d240f04c6e063cb6621f3`. No Lead write. Expansion needs a reviewed policy change. | 69 |
| Trusted final import admission | `external_call_admission` parses under `externalCallAdmissionSchema` (L16–L29): policy `best-relocation-final-import-v1`, tracker workbook, sheet id 1191420872, tab `Calls`, stable row id, 64-hex content hash, company/feed IDs, `source_arrival_at`, run and receipt IDs, `applied_at`; and the Lead's slug and company/feed match. Immutable after insert (`models/externalCallAdmissionSchema.ts` L21–L32). | 43 |
| None | excluded | 212 |

`getCallLeadReportingDecision` (`leads/callLeadReportingDisposition.ts` L18–L39) checks admission first, then `created_on_unmatched`. Either failure returns `disposition: "excluded"`, `billable: false`, reasons `missing_call_reporting_admission` and/or `created_on_unmatched`. Only an admitted, matched Call goes on to the duplicate/Form Fill/bad routing. The full routing table is owned by [reporting-and-sheets.md](reporting-and-sheets.md).

### Trusted final import admission (`admitBestRelocationFinalCallV1`)

- **Status: historical-only.** The command lived in `src/services/domainCommands/bestRelocationFinalCall.ts` and was removed with the external ingestion in `226dba24` (2026-11-18). No code at `9955430d` can write `external_call_admission`; the model guard rejects any later change.
- **What it did (from `226dba24^`):** an operator-only command with no HTTP or worker path. It required `provenance.origin: "external_sheet_ingestion"`, `source_connection_key: "best_relocation"`, an Owner initiator, a payload checksum, and an action present byte-for-byte in the approved frozen plan. It adopted an existing Call before creating one, required explicit checksum approval for any new normal Call, wrote `external_call_admission`, and set `form_fill` through `hasFormFillForCallLead`.
- **Production:** 52 command rows on 2026-11-04 01:02–01:04 UTC; 43 `best_relocation_sheet` Calls carry the admission. Readers that still depend on it: `hasReportingEligibleCall`, the reporting filters, Insights facts (`insights/facts.ts` L90), the sibling gate (`granotLifecycle/callLeadFormSibling.ts` L108, L121) and Sheet transports.
- `reconcileExternalSheetReviewV1` (the external review writer, 3 Call and 168 Form rows on Nov 4) was removed in the same commit. See [bad-leads.md](bad-leads.md#trusted-imported-bad-call-review).

## 6. CPL at creation

| Rule | Detail |
|---|---|
| **Source** | `callLead.service.ts:priceTheLead` L351–L361 → `leads/leadCplResolution.ts:resolveLeadCplSnapshot` L27–L67 @ `9955430d` |
| **Inputs** | Source Granularity, stored business timestamp, and `duplicate`. `form_fill` is not an input. |
| **Result** | `resolved` → rate amount and period; `duplicate_zero` → `cpl: 0`, base period kept; `missing_rate` → fallback amount, `lead.cpl.missing_rate` reported after commit (L152–L170); `not_applicable`. |
| **Consequence** | A 90-day repeat stores `cpl: 0`. A Form Fill Call keeps its full CPL in Mongo (the reference Call stores `cpl: 205`) but is not billable, because billing reads the disposition, not the stored CPL. |
| **Repricing** | Adoption reprices only to zero for a duplicate (convergence L520–L526). PATCH reprices when the source, `timestamp` or `duplicate` is patched (L570–L594). The CPL-corrections drain is covered in [reporting-and-sheets.md](reporting-and-sheets.md). |

## 7. Receiver fills

| Command | Status | Source | Rule |
|---|---|---|---|
| `fillReceiverFromRepCall` | current | `salesOutreach/contacts/mongoStore.ts:writeRepCallReceivers` L153–L189 → `leads/receiverAgentWrite.ts:writeReceiverAgent` L37–L66 | A Desk subject with no assigned agent and a Lead with an empty `receiver_agent` takes the reviewed rep of its latest confirmed `inbound_answered` call (`contacts/receiverFill.ts`). Skipped while shared Pool work covers the event. Compare-and-set on `receiver_agent: null`; writes `receiver_agent`, `receiver_agent_name_snapshot`, `receiver_agent_source: "ringcentral_rep_call"`, `receiver_agent_set_at`, `receiver_agent_source_value` (the call interaction id). Idempotency key `ringcentral:receiver-rep-call:<leadId>:<interactionId>`. EntityChange `fillReceiverFromRepCall`; Sheet `call_lead.update` (SalesRep column). A matching Granot user later replaces it. Production: 124 Call / 606 Form rows, last 2026-11-12 (Call). |
| `fillReceiverAgentFromAnsweredCall` | historical-only | Was `src/services/salesIntelligence/outreach/receiverAssignment.ts` (added `ac4c0db4`, removed in the slimming `9007f43f`, 2026-10-04). | Filled an empty Call receiver with source `ringcentral_answered`. 47 rows, 2026-09-25 → 2026-10-04. 52 Calls still carry `ringcentral_answered`; Granot and the sibling mirror treat it as always replaceable (`leadDesiredState.ts` L117; `callLeadFormSibling.ts` L42). `ringCentralAnsweredContext` (`receiverAgentWrite.ts` L82–L85) has no caller. |
| `backfillReceiverAgent` | historical-only | Was `scripts/backfill-receiver-agent.lib.ts` (untracked dev tooling, removed from git in `0382631c`). | One-time backfill, 12 Call / 96 Form rows on 2026-09-25. |
| `backfillDeskReceiverFromGranot` | historical-only | No tracked code at any commit (`git log -S` finds only the brief). | One-time operator backfill, 3 Call / 6 Form rows at 2026-10-05 21:30:26 UTC, the same instant as the first `fillReceiverFromRepCall` rows (Desk seeding). |

The ordinary Granot receiver writes (`synchronizeLeadFromGranot`, sibling mirror) are in [granot-effects.md](granot-effects.md). A manual receiver comes from PATCH (§9) with source `manual` unless the caller supplies one.

## 8. `recoverCallLeadMoveDate`

| Rule | Detail |
|---|---|
| **Status** | historical-only (one Owner-approved run). Code remains: `granotLifecycle/callLeadMoveDateRepair.ts:callMoveDateRecovery` L22–L31, `recoverCallMoveDate` L55–L94; runner `ops/sales-outreach/call-lead-move-dates.ts`. |
| **Precondition** | Open Desk subject (`active`/`review`), not booked, cancelled, duplicate or `created_on_unmatched`, `move_date` empty, a job number, and a stamped accepted Granot observation for the same job with a valid move date. |
| **Writes** | `move_date` only, guarded by `domain_revision` and `move_date: null`. |
| **Idempotency** | `call-move-date:<leadId>:<observationId>`, run id `call-move-dates-2026-10-15`. |
| **Effects** | EntityChange `recoverCallLeadMoveDate` (`move_date`); Outreach refresh and evaluation in the same transaction plus live publication; no Sheet intent (move date is not a Call Sheet column); no Daily Operations fact. Production: 149 rows on 2026-10-15. |

## 9. Updates: PATCH `/api/v1/call-leads/:id` (`updateSourceOwnedLead`)

| Rule | Detail |
|---|---|
| **Source** | `routes/v1.routes.ts` L556–L571 → `domainCommands/existingWrites.ts:runExistingUpdateSourceOwnedLead` L179– → `callLead.service.ts:correctCallLead` L425–L465 @ `9955430d` |
| **Allowed fields** | `updateCallLeadSchema` (`validation/v1/leads.validation.ts` L256–L282, L297–L304): source fields, `timestamp`, `job_no`, contact, `duration`, times, location, `cubic_feet`, `over_*`, receiver fields, **`duplicate`** and `no_sync`. Not `form_fill`, `created_on_unmatched`, `ringcentral`, `external_*`, `ringcentral_convergence` or revisions (`omitForbiddenLeadLifecycleFields`, `granotLifecycleSchemas.ts` L380–L400). |
| **Guards** | `duplicate: true` on a booked Call → `ConflictError` (L494–L508). The 90-day guard is not re-run. |
| **Effects** | Reprice when source, `timestamp` or `duplicate` changes; receiver `manual` default; save, refresh the attached Booking chain and persist `call_lead.update` (L467–L480). EntityChange `updateSourceOwnedLead`. A `phone_number`/source/`duplicate` change schedules Form Fill work. Production: 8 Call rows, last 2026-09-06; one set `duplicate` (2026-09-03). |
| **Lifecycle meaning** | PATCH can move a qualified Call between Calls and Duplicate Calls by setting `duplicate`, and can hide it with `no_sync`. It can never qualify or admit a Call. See finding R2-F4. |

Granot updates (`synchronizeLeadFromGranot`, `confirmGranotBooking`, the sibling mirror) are documented in [granot-effects.md](granot-effects.md) and [bookings-and-cancellations.md](bookings-and-cancellations.md).

## 10. Deletion (`deleteCallLead`)

| Rule | Detail |
|---|---|
| **Source** | `routes/v1.routes.ts` L572–L576 → `existingWrites.ts:runExistingDeleteCallLead` L710–L739 → `callLead.service.ts:beginCallLeadRemoval` L663–L715 @ `9955430d` |
| **Precondition** | Lead exists; a booked Call needs `cascade=true` (L751–L768), which deletes the Booking chain in the same transaction. |
| **Writes** | `deleteOne` of the Call; EntityChange path `$deleted` (deleted mutation) plus any cascaded Booking mutations. |
| **Idempotency** | Canonical command idempotency key from the caller's context. |
| **Sheet Sync** | Queued mode: tombstone `delete_source_lead` / `delete_call_lead` with previous targets from `sheet_sync` plus Calls and Duplicate Calls fallbacks (L717–L749, L770–L794). The drainer expands any Call target to all three Call tabs, including Bad Call Leads (`jobPlanner.ts` L288–L308). Legacy mode: `deleteCallLeadFromSheets`. |
| **Outreach / Daily Operations** | Deleted EntityChange reaches the Lead-change feed; no Daily Operations fact. |
| **Form Fill** | Deleting a Call removes it; deleting a Form never clears `form_fill` on a Call (see [duplicates-and-form-fill.md](duplicates-and-form-fill.md#when-the-form-goes-away)). |
| **Production** | 2 rows, 2026-11-03 15:49 UTC (one with a cascaded `deleteBookedLead`). |

## Excluded Calls that still have rows

Read-only coordinator scan, 2026-11-20 12:38 NY: 209 Sheet rows on Master Leads belong to Calls whose disposition is `excluded` (203 on Calls, 6 on Duplicate Calls), reason `missing_call_reporting_admission`.

| Population | Why excluded | Why the row stays |
|---|---|---|
| 206 `legacy_unknown` Calls created 2026-06-09 → 06-17 | No `ringcentral` metadata at all, not in the 69-ID inventory, no external admission. | They were written to Sheets under the pre-November rules. Today the planner returns no writes for an excluded Call (`jobPlanner.ts` L171), so no upsert and no stale-row delete is ever planned for them. Re-delivery leaves the rows in place. |
| 2 `vantage_admin` Calls, 2026-09-01 and 09-02 | Manual Admin creates (now closed), no RingCentral facts, not in the inventory. | Same. |
| 1 `granot_lead_created` Call, 2026-09-02 | Created by Granot `create_if_missing` (now closed), still `ringcentral_convergence.state: "pending"`, never adopted. Its ±12 h adoption window has long passed. | Same. |

A narrow exception: an excluded Call with `no_sync: true` would have every Call row deleted, because the No-Sync branch runs before the excluded check (`jobPlanner.ts` L141–L167; `sheetSync/noSyncLead.ts` L13–L34). Production has no `no_sync: true` Calls.

Server reporting excludes all of these from billing, Insights and the sibling gate with no date cutoff. The Owner decided (Nov 20) not to remove pre-November-3 Calls or their rows retroactively, and directed that the Calls tab gets no backfill or major change; removals and inspection there are manual. These rows are an Owner item only. This pack proposes no repair.

## Tests

| Rule | Tests |
|---|---|
| Qualification predicate, both reasons | `ringcentral/callLeadQualification.test.ts`, `ringcentral/call-log-vetting.test.ts` |
| Webhook final confirmation | `ringcentral/webhook-call-log-qualification.test.ts` |
| Shared ingest order, adoption before duplicate | `ringcentral/ringcentral-call-lead-ingest.service.test.ts`, `ringcentral/callLeadConvergence.test.ts` (replica: `callLeadConvergence.replica.test.ts`) |
| Call Log sync window, lease, oldest-first | `ringcentral/call-log-sync.service.test.ts` (replica: `call-log-sync-lease.replica.test.ts`) |
| Mint guard, closed create paths | `leads/callLead.service.test.ts`, `granotLifecycle/createLeadFromGranot.test.ts`, `models/GranotCrmSource.test.ts`, `validation/v1.validation.test.ts` |
| Admission branches | `leads/callLeadAdmission.test.ts` |
| Final result watermark | `domainCommands/ringcentralFinalResult.test.ts`, `ops/best-relocation-retirement/callBackfill.test.ts` |
| Move date recovery | `granotLifecycle/callLeadMoveDateRepair.test.ts` (replica: `ops/sales-outreach/call-lead-move-dates.replica.ts`) |
| Excluded Call plans no Sheet write | `sheetSync/drainer/jobPlanner.test.ts` |

Run results are in the coverage file `R2-tests.tsv`.
