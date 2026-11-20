---
okf_version: "0.2"
type: Reference
title: Granot effects on Leads
description: Everything Granot does to a Form Lead or Call Lead at 9955430d, with each path's precedence, clock, replay key and Sheet, Outreach and Daily Operations effects.
tags: [lead-lifecycle, granot-lifecycle, form-lead, call-lead, sheet-sync]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/granotLifecycle/**
  - src/services/granotHttpCollector/scheduledLeadChange.ts
  - src/services/granotHttpCollector/estimatesIdentityPlanning.ts
  - src/services/granotHttpCollector/runWorkflow.ts
  - src/routes/granot-webhook.routes.ts
  - src/routes/granot-lifecycle-cron.routes.ts
  - src/routes/granot-automation-cron.routes.ts
  - src/routes/granot-lifecycle-admin.routes.ts
  - src/routes/extension-granot-apply.routes.ts
  - api/queues/granot-lifecycle-consumer.ts
  - api/queues/granot-automation-consumer.ts
  - ops/sales-outreach/call-lead-form-siblings.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/granotLifecycle/synchronizeLeadFromGranot.ts
  - id: sibling
    resource: src/services/granotLifecycle/callLeadFormSibling.ts
  - id: create
    resource: src/services/granotLifecycle/createLeadFromGranot.ts
  - id: planner
    resource: src/services/granotLifecycle/leadDesiredState.ts
  - id: scheduled
    resource: src/services/granotHttpCollector/scheduledLeadChange.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Granot effects on Leads

Granot is the CRM. It never qualifies a Call Lead, never sets `booked` or `cancelled`, and never mints a Call Lead. It can:

1. Write Granot fields onto a Lead it matched (`synchronizeLeadFromGranot`).
2. Mint a **Form Lead only** from a `lead_created` event (`createLeadFromGranot`).
3. Establish, attach, confirm or dispute a **Granot Record Link** (job ↔ Lead ↔ Booking).
4. Mirror a Form Lead's job, priority and receiver onto the same customer's qualified Call Lead (`mirrorFormLeadToCallSibling`).
5. Open a Booking or Release reconciliation case that the Owner later resolves. That is how a Lead becomes booked or cancelled: see [bookings-and-cancellations.md](bookings-and-cancellations.md).

All line ranges are at `9955430d`. Words follow the [glossary](../../../../CONTEXT.md). Tab routing is owned by [reporting-and-sheets.md](reporting-and-sheets.md); Desk effects by [downstream-consumers.md](downstream-consumers.md).

## 1. Entry points

| Entry point | Kind | Path into the Lead | Lead types |
|---|---|---|---|
| `POST /api/webhooks/granot/{lead-created,priority-updated,booking-status-changed}` (`routes/granot-webhook.routes.ts` L35–L52) | route | Captures a receipt, publishes a queue wake-up (L99). No Lead write in the request. | both |
| `api/queues/granot-lifecycle-consumer.ts` (`drainRequestedReceipt`) and cron `/api/cron/granot-lifecycle-drain` every 5 min (`routes/granot-lifecycle-cron.routes.ts` L28–L31) | queue, cron | `drainer.ts` → `granotObservationProcessor` → `processGranotObservation` | both |
| `PATCH /api/v1/form-leads/:id/granot-sync`, `POST /api/v1/call-leads/enrichment/sync`, `POST /api/v1/call-leads/booked-reconciliation/sync` (`routes/extension-granot-apply.routes.ts` L38–L119) | extension | `extensionApply.ts:applyExtensionGranotItem` captures a `browser_extension` receipt and runs the same processor synchronously (`claimAndProcessOrPoll`). Owner extension session required (L123+). | Form (PATCH), Call (both POSTs) |
| Cron `/api/cron/granot-estimates-in-process` hourly `0 * * * *` (`routes/granot-automation-cron.routes.ts` L47–L80, `vercel.json`) and `api/queues/granot-automation-consumer.ts` (`runGranotWorker`) | cron, queue | Preview: `estimatesIdentityPlanning.ts:planEstimatesIdentities`. Apply: `runWorkflow.ts` L540–L545 → `scheduledLeadChange.ts:applyScheduledLeadChange` (schema 3 runs) or `automationApply.ts:resumeCapturedAutomationAction` (a saved capture or a run below schema 3). | both |
| Owner routes `/api/v1/admin/granot-lifecycle/*` (`routes/granot-lifecycle-admin.routes.ts` L185–L502) | route | Discrepancy, booking-case, release-case and requeue commands (§7, and [bookings-and-cancellations.md](bookings-and-cancellations.md)). | both |
| `pnpm granot:call-lead-form-siblings --target=<db> [--apply]` (`ops/sales-outreach/call-lead-form-siblings.ts`) | script | Owner-approved backfill: runs `mirrorFormLeadToCallSibling` per Form Lead with origin `owner_backfill` (L111). Supported. | Call |
| `enrichment/callLeadEnrichment.service.ts:syncCallLeadEnrichment` L89–L250 | none | **No caller at 9955430d** (only re-exported by `services/callLeadEnrichment.service.ts` and `enrichment/index.ts`). It would write `job_no`, move fields and the receiver on a reporting-eligible Call through `lead.save`. Only the preview `POST /api/v1/call-leads/enrichment/preview` is routed. The extension sync route above replaced it. | Call (dead) |

Webhook versus scheduled versus extension, in one line each:

- **Webhook and extension** share one path: receipt → Observation → `processGranotObservation` → booking case, Form creation, or `synchronizeLeadFromGranot`, then the bounded post-commit steps (lead-link wake and sibling mirror).
- **Scheduled Estimates (schema 3, since `5137f06f`, November 19)** skip the receipt. `applyScheduledLeadChange` re-plans inside one transaction and applies only a real change.

## 2. What Granot may write on a matched Lead

**Source:** `granotLifecycle/authorizedDesiredState.ts` `GRANOT_LEAD_WRITE_PATHS` L7–L34, `FORBIDDEN_DESIRED_STATE_METADATA_PATHS` L74–L96, `assertAuthorizedLeadDesiredState` L150–L198; planner `leadDesiredState.ts:planMatchedLead` L316–L410.

Allowlist: `job_no`, `normalized_job_no`, `granot_priority`, `quoted` (never `false`), `receiver_agent`, `receiver_agent_source`, `receiver_agent_source_value`, `granot_contact_snapshot`, the six contact leaves, the move fields (`pickup_*`, `delivery_*`, `destination_zip` Form-only, `delivery_zip` Call-only, `move_date`, `cubic_feet`, `local`, `granot_move_size`, `granot_service_type`).

Forbidden in any Granot desired state: `booked`, `cancelled`, `cpl`, `lead_source_company`, `source_granularity_id`, `ingestion_origin`, `move_size`, the ingested snapshots, `estimate`, `payment`, `balance`, and all provenance metadata. **Granot sync can never book, cancel, re-price or re-source a Lead.** Granot also never writes `duplicate`, `form_fill`, `bad_lead`, `created_on_unmatched`, `no_sync` or `ringcentral.*`.

The planner only ever fills these paths:

| Field | Rule (`planMatchedLead`) | Lines | Form | Call |
|---|---|---|---|---|
| `granot_priority` | Set from a valid canonical priority unless the Observation has an `invalid_priority` issue. | L336–L342 | yes | yes |
| `job_no`, `normalized_job_no` (**Job Number link**) | Only into an **empty** `normalized_job_no`. A different existing job makes the whole plan `conflict / job_number_conflict` (L327–L334, `conflictingJob` L623–L630). Never on a `priority_only` target. | L344–L350 | yes | yes |
| `receiver_agent`, `receiver_agent_source = "granot_username_match"`, `receiver_agent_source_value` (+ `receiver_agent_name_snapshot`, `receiver_agent_set_at` stamped in the command L671–L674, L725–L730) | Needs a resolved active Agent, a valid priority and `receiverFillableByGranot` (L126–L135). Latest-wins off (default; env `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS`): only an empty receiver, or a different Agent over a `ringcentral_rep_call` placeholder. On: `receiverReplaceableByGranot` L149–L160 (never `manual` or source-less). Rechecked in the transaction (`synchronizeLeadFromGranot.ts` L334–L346) and the Agent must still be active (L732–L746). | L352–L364 | yes | yes |
| `quoted = true`, `granot_contact_snapshot`, move fields, `local` | **Broad enrichment only on priority 1 or 5** (`BROAD_ENRICHMENT_PRIORITIES` L95). Contact goes into the snapshot only (`planQualifiedContact` L412–L421): Granot never overwrites the Lead's current name, phone or email here. `local` = same origin and destination state → `local`, else `long_distance` (L446–L448). | L366–L378, L423–L451 | yes | yes |
| `move_date` | Form: inside broad enrichment (L440–L442). Call: any valid priority with a move date, not `priority_only` (L380–L384). The command skips an equal date read in its own transaction (`synchronizeLeadFromGranot.ts` L587). | as listed | 1/5 only | any valid |

Eligibility of the matched Lead (identity ladder, `identity.ts`):

- **Duplicate Form Lead:** ineligible. Identity returns `duplicate_form_lead_ineligible` (L694–L699), the plan becomes `unmatched` (`leadDesiredState.ts` L580–L585), and the command refuses it (`synchronizeLeadFromGranot.ts` L161–L163).
- **Bad Form Lead:** `priority_only` (`identity.ts` L705–L713). Only `granot_priority` may change (`synchronizeLeadFromGranot.ts` L324–L330).
- **Call Lead ladder** (`resolveCallLadder` L784–L835): active Record Link → same Source Granularity + equivalent job (`call_job_no_exact`) → same Source Granularity + phone (`source_scoped_contact`). Only the phone rung drops `duplicate` Calls (L893–L895); the command repeats that check (L164–L169). **The direct ladder does not test reporting eligibility, `form_fill`, `bad_lead` or `created_on_unmatched`.** A Form Fill Call is matched and updated like any other Call. A Granot job never qualifies a Call (Owner directive 2026-11-03); no Granot path writes qualification.

## 3. `synchronizeLeadFromGranot`

**Source:** `granotLifecycle/synchronizeLeadFromGranot.ts:synchronizeLeadFromGranot` L78–L101, `applySynchronizeLeadOperation` L145–L318.

| Aspect | Rule |
|---|---|
| Trigger | Processor `maybeSynchronizeMatchedLead` (`processor.ts` L969–L1173) for webhook and extension receipts; `applyScheduledLeadChange` (`scheduledLeadChange.ts` L124–L216) for scheduled runs. |
| Preconditions | Live mode, `lead_writes_enabled`, all eight effect gates (L81–L87). `domain_revision` equals the planned revision (L158–L160). The Observation is newer than `last_accepted_granot_observation` (L171–L177). |
| Precedence | Temporal winner first: an older or same Observation never wins (`granotTemporal.ts`). Then Record Link conflict beats any Lead change (L181–L184). A job already on the Lead beats a new job (plan conflict). Owner booking commands own `booked`. |
| Time window / clock | No window. Order by the Observation's `captured_at` (UTC instant). Pending matches retry on `nextPendingMatchDueAt` until `match_window_expired` (`leadDesiredState.ts` L293–L313). |
| Idempotency | Webhook/extension: key `granot:synchronize-lead:<observation_id>` (`authorizedDesiredState.ts` L256–L258) plus `expected_domain_revision` CAS (L676–L690). Scheduled: key `scheduled-estimate:<source id>`, deterministic Observation/Decision IDs hashed from the operation ID (`scheduledLeadChange.ts` L59–L104). |
| Fields written | `reportable` paths from §2, plus `last_accepted_granot_observation` always, `current_contact_provenance` / `granot_contact_revision` / `last_granot_contact_change` when contact leaves change, `current_move_provenance` when a move path changes (`buildLeadUpdate` L572–L645). With no Lead change and only a new link, only the temporal winner advances (L695–L723). |
| EntityChange | `synchronizeLeadFromGranot` on the Lead (`FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS`) and on the `GranotRecordLink` when established/attached (L277–L289). The revision stamp advances `domain_revision` (`domainCommands/entityChange.ts` L435–L466). A change to `phone_number`, `duplicate` and similar schedules Form Fill work (L418–L421); Granot sync does not write those paths in practice. |
| Sheet Sync | `source_lead` / `form_lead.update` or `call_lead.update`, enqueued in the transaction **only when a non-`granot_priority` reportable path changed** (L187–L191, L299–L307). Priority-only changes plan no Sheet work. The shared planner then upserts the Lead's current tab in place (a Form Fill Call stays on Duplicate Calls). |
| Outreach | The Lead EntityChange row feeds the Lead-change tail. `granot_priority`, `normalized_job_no`, `move_date` and `last_accepted_granot_observation` are admission decision paths (`salesOutreach/subjects/feed.ts` L147–L161). Scheduled runs also refresh Pool and the open subject in the same transaction when priority changed (`scheduledLeadChange.ts` L210–L212). |
| Daily Operations | `granot.linked` after commit for `applied` or `linked` only, dedupe `decision:<id>:granot.linked` (`finalizeSynchronizedLead` L119–L122; `dailyOperations/recordGranotFacts.ts` L140–L168). Skipped on an idempotent replay. |
| Outcomes | `applied`, `linked` (link only), `already_current` (equal-date-only work with an exact link, L195–L197), `conflict`. Anything else is a race and is re-planned up to 3 times (`processor.ts` L997, L1172). |

### Call move-date recovery (`recoverCallLeadMoveDate`)

**Source:** `granotLifecycle/callLeadMoveDateRepair.ts:callMoveDateRecovery` L22–L31, `recoverCallMoveDate` L55–L94; operator script `ops/sales-outreach/call-lead-move-dates.ts` (dry run by default, `--apply` behind the production-writer guard).

- Only a jobbed Call Lead with no `move_date`. The date comes from the newest valid accepted Observation of that Lead whose job is equivalent.
- Writes `move_date` only, CAS on `domain_revision` and `move_date: null` (L75–L76). EntityChange `recoverCallLeadMoveDate` (L78–L80); `move_date` is an Outreach admission path, and the command refreshes the open Desk subject. No Sheet job, no Daily Operations fact.
- Key `call-move-date:<lead>:<observation>`, run ID `call-move-dates-2026-10-15`. Production: 149 rows on 2026-10-15. Historical one-time repair; the script remains in the tree.

### Two ways a Call Lead gets a job

> Pending re-verification against the Track A merge (scheduled sibling catch-up / Record Link). Documented at 9955430d.

1. **Granot matched the Call directly.** The Granot source label resolves to a **call** Source Granularity, so the Call ladder runs and `synchronizeLeadFromGranot` writes `job_no`, priority, receiver and move facts onto the Call. `granot_form_sibling` stays empty. This is the Owner's reference Call `6ae907f26f28ecf54e7aff42` (TBM Prime Inbounds): `createCallLead` 2026-11-02 22:00:17 UTC; `synchronizeLeadFromGranot` 22:00:47 via `granot_webhook` (job, priority, receiver, contact snapshot, move fields, `quoted`); again 23:28:20 via `granot_http_automation` (snapshot and move provenance); again 2026-11-03 00:36:23 via `granot_webhook` (priority to 5); `confirmGranotBooking` 14:23:29 (`booked`); `recordRingCentralFinalCallLogResult` 22:26:10. No Form Lead holds its job. It stays on Duplicate Calls (row 310) because `form_fill: true`. Production read 2026-11-20 12:48 New York.
2. **The Form→Call sibling mirror.** Granot files the job under the Form source. The Form ladder resolves the Form Lead, and after the Form result the mirror (§5) copies the job onto the qualified Call Lead and stamps `granot_form_sibling`.

## 4. `createLeadFromGranot` (Form Leads only)

**Source:** `granotLifecycle/createLeadFromGranot.ts:createLeadFromGranot` L158–L212, `executeCreation` L214–L558, `createGranotFormLead` L581–L740, `reserveRecordLink` L741–L819. Planner: `leadDesiredState.ts:planNoMatch` L254–L314, `evaluateMinimumCreationData` L216–L252.

| Aspect | Rule |
|---|---|
| Call guard | `if (input.lead_model === "CallLead") throw new CreateLeadFromGranotRaceError("policy")` (L163). The snapshot rule allows creation only for `selected_lead_model === "FormLead"` and `route_event_class === "lead_created"` (L109–L115); `executeCreation` rejects any other model (L324–L330); the planner mints only Forms (`leadDesiredState.ts` L263–L284, L226–L229). |
| Preconditions | `lead_creation_enabled` and all gates including `lead_created_policy = create_if_missing` (L300–L316). A normalized job, a deterministic route, name + phone, both states and ZIPs and a move type (L216–L252). Identity finds no Lead and no candidate (L341–L350). Active company and an active **form** granularity (L352–L369). Payload checksum must match (L376–L389). |
| Fields written | A new Form Lead: `ingestion_origin: "granot_lead_created"` (L643), `job_no`, `normalized_job_no`, `granot_priority` (valid only), `quoted` (true on priority 1 or 5, L720–L723), contact and move from the Observation, both ingested and Granot snapshots, `last_accepted_granot_observation`, receiver from a resolved Agent with `receiver_agent_source: "granot_username_match"`, source assignment, `local`, and the CPL snapshot at the Observation's `captured_at` (L390–L393). `duplicate` keeps the model default `false`: this path runs no Form duplicate check (see [form-leads.md](form-leads.md)). |
| Record Link | Created or attached to the new Lead in the same transaction (`reserveRecordLink` L741–L819). |
| Idempotency | Key `granot:create-lead:<observation_id>` (L99–L101) and the payload checksum. |
| EntityChange | `createLeadFromGranot` on the Form Lead (revision 0) and the Record Link (L452–L475). Form-phone paths schedule Form Fill work, which can flip matching qualified Calls (see [duplicates-and-form-fill.md](duplicates-and-form-fill.md)). |
| Sheet Sync | `source_lead` / `form_lead.create` (L506–L514). |
| Outreach | Revision-0 `createLeadFromGranot` counts as intake creation (`subjects/feed.ts` L228–L230). |
| Daily Operations | `granot.minted` and the ordinary Form Lead fact after commit (L193–L205); missing-rate CPL alert when unresolved (L179–L181). |
| Time window | None. Clock: Observation `captured_at` for CPL and `timestamp`. |

Production (read 2026-11-20 17:37 UTC): 2,078 Form Lead creations, latest 2026-11-20 04:49 UTC. **8 historical `createLeadFromGranot` Call rows**, 2026-09-02 19:24 to 2026-09-03 14:48 UTC, from before Granot Call creation was retired. They are historical-only. Their Calls stay subject to the RingCentral-only reporting gate.

## 5. The Form→Call sibling mirror (`mirrorFormLeadToCallSibling`)

**Source:** `granotLifecycle/callLeadFormSibling.ts`: `eligibleSibling` L121, `planFormSiblingUpdate` L127–L173, `loadFormSiblingCandidates` L176–L193, `hasSyncedCallsRow` L198–L202, `mirrorFormLeadToCallSibling` L235–L277. Owner directive 2026-10-28/29 (workspace `AGENTS.md`).

### Eligibility gate

The Form must be non-duplicate, not bad, and hold `job_no` and `normalized_job_no` (L134). The Call must pass `eligibleSibling`:

- `hasReportingEligibleCall` (`leads/callLeadAdmission.ts` L52–L61): a saved RingCentral inbound queue qualification, **or** one of the 69 preserved Best Relocation historical IDs carrying the Best Relocation slug, company ID and Call feed ID (`hasLegacyBestRelocationCall` L43–L49), **or** a trusted final-import `external_call_admission` on a Lead with `source_company: "best_relocation_leads"` whose company and feed match the fact (L57–L60);
- **and** `duplicate !== true` (not a 90-day repeat);
- **and** `created_on_unmatched !== true`.

The loader also pre-filters with `reportingEligibleCallLeadFilter()` (L182, L188). `form_fill`, `bad_lead` and `no_sync` on the Call are **not** part of the gate. A Form Fill Call is the normal mirror target and is updated in place on Duplicate Calls.

### Target selection (precedence)

1. **Job rung:** eligible Calls holding an equivalent job. One wins with basis `job_no`; more than one → `multiple_call_siblings` (L135–L141).
2. **Phone rung** (only when no job candidate): eligible, jobless Calls in the same `lead_source_company` whose current or ingested phone matches any Form phone (current, ingested or Granot), created within **45 days** of the Form (`FORM_SIBLING_WINDOW_DAYS` L39, UTC instants, L143–L149). One wins with basis `phone_source_company`.
3. A Call already linked to a different Form → `sibling_of_other_form` (L151–L152).

### What it writes on the Call Lead

| Field | Rule |
|---|---|
| `job_no`, `normalized_job_no` | Only when the Call has no job (L155–L158). A different job is never overwritten. |
| `granot_priority` | When the Form's differs (L159). |
| `receiver_agent`, `receiver_agent_name_snapshot`, `receiver_agent_source` (the Form's, default `granot_username_match`), `receiver_agent_source_value`, `receiver_agent_set_at` | Only when the Form has a receiver with a non-empty name snapshot and its Agent differs from the Call's, and only over an empty receiver or an automatic one (`ringcentral_answered`, `ringcentral_rep_call`, `granot_username_match`); never over `manual` or a source-less receiver (L42, L160–L167). |
| `granot_form_sibling` `{form_lead_id, normalized_job_no, basis, linked_at}` | When missing or for another job (L168–L170). |

It never creates a Lead and never writes the Form Lead, a Record Link, a Decision, `booked` or the Call's `last_accepted_granot_observation`.

| Aspect | Rule |
|---|---|
| Idempotency | Key `granot-form-sibling:<form>:<call>:r<call revision>:<first 32 hex of the sha256 of the mirrored values>`; the hash leaves out `receiver_agent_set_at` and `granot_form_sibling` (L241–L246). It re-plans inside the transaction and CASes on the Call's `domain_revision` (L250–L261). |
| EntityChange | `mirrorFormLeadToCallSibling` on the Call Lead (L263–L265). |
| Sheet Sync | `source_lead` / `call_lead.update` only when the Call already has a synced row on Calls, Duplicate Calls or Bad Call Leads, its disposition is not `excluded`, effective No-Sync does not apply, **and** `job_no` or the receiver name changed (L198–L202, L267–L270). Priority-only mirrors plan no Sheet work. The planner keeps a Form Fill Call on Duplicate Calls. A never-delivered Call is not newly admitted. |
| Outreach | The tail recognizes this command touching `granot_form_sibling` and nominates a related-Form job `sod:lead-change:FormLead:<form>:related:CallLead:<call>:change:<change>` (`subjects/feed.ts` L95–L108). The Desk then excludes the Call as `form_lead_holds_job`. |
| Daily Operations | None. |
| Time window | 45 days between Form and Call creation, phone rung only. No window on the job rung. |

### When it runs

> Pending re-verification against the Track A merge (scheduled sibling catch-up / Record Link). Documented at 9955430d.

| Path | When | Bound |
|---|---|---|
| Processor (webhook, extension, pre-schema-3 automation receipts) | After any Form Lead result `applied`, `linked`, `created` or `already_current`, live writes only, not shadow mode, and only when the receipt loads and an initiator resolves; otherwise the mirror is skipped with no log (`processor.ts` L240–L258, L245–L253, `FORM_SIBLING_OUTCOMES` L274) | 2 s, never throws (`boundedLeadLinkWake` L277–L288, `LEAD_LINK_WAKE_TIMEOUT_MS` L271) |
| Scheduled direct apply (schema 3) | **Only after an `applied` Form change** (`scheduledLeadChange.ts` L153–L162, L197–L198, L227–L235) | **Unbounded, awaited, errors escape** |
| Owner backfill script | On demand | n/a |

Production (read 2026-11-20 12:47 New York): 52 `mirrorFormLeadToCallSibling` Call rows, 2026-10-29 02:13 to 2026-11-17 16:25 UTC. 39 are the October 29 Owner backfill (38 on Form Fill Calls); 8 came from `granot_http_automation` receipts and 5 from `granot_webhook` (priority only). 47 Call Leads carry `granot_form_sibling`.

## 6. Scheduled-run findings (current `main` behavior)

> Pending re-verification against the Track A merge (scheduled sibling catch-up / Record Link). Documented at 9955430d.

These are the November 20 review findings ([review](../../operations/SERVICE-REVIEW-2026-11-20.md#granot-runs-and-lead-updates)). They describe the code as it is.

1. **No Record Link for an already-current Lead.** Planning classifies every matched row whose plan is not `applied` as `unchanged` (`estimatesIdentityPlanning.ts` L159–L164). Apply skips anything but `applied` with changed paths (`scheduledLeadChange.ts` L153–L162). The webhook processor still links an `already_current` Lead (`processor.ts` L1029–L1034, and the decision-and-link transaction L408–L500).
2. **Sibling catch-up only after an applied Form change.** The scheduled path calls the mirror only after an applied Form change (`scheduledLeadChange.ts` L227–L235). A Call that qualifies after its Form already holds the job gets the job from the next webhook or Form change, not the hourly run. Measured November 20: 42 qualified, non-duplicate, jobless Calls in 30 days, none with a same-source Form sibling holding a job.
3. **Unbounded post-commit retries.** `wakeLeadLinksAfterChange` and the mirror are awaited with no time bound and errors escape (`scheduledLeadChange.ts` L226–L235). `runWorkflow.ts` L555–L558 turns the error into `EstimatesApplyRetry`, and the run retries that action first on every pass until the 24-hour run expiry. The command replays by its key, so the Lead is not written twice.

Minor: a Record Link conflict on the scheduled path returns `conflict` from the operation, which `SkippedChange` turns into a rollback (L197–L198, L217–L219). The dispute is never saved.

## 7. Granot Record Links

A Record Link (`models/GranotRecordLink.ts`) binds one active `normalized_job_no` (unique among `state: "active"`, L48–L51) to at most one Lead (`lead_ref`) and one Booking (`booking_ref`). It writes no Lead field.

| Action | Where | Effect |
|---|---|---|
| Establish | Sync with no active link (`synchronizeLeadFromGranot.ts` L368–L370, L493–L543); processor decision-only path for a job proposal (`processor.ts` L423–L470); `reserveRecordLink` on Form creation; `confirmGranotBooking` when no link exists | New active link, revision 0, EntityChange on the link. |
| Attach | Active link without `lead_ref` (L382–L384, L545–L569) | `$set lead_ref` (+ `source_scope`). |
| Confirm | Link already on this Lead (L385, L647–L662) | Observation pointers only; no EntityChange. |
| Conflict | Link on another Lead (`record_link_conflict`), another job, or another source scope (L371–L381) | `disputed: true`, `dispute_reason`, EntityChange on the link; Decision `conflict`; **no Lead write** (L406–L479). |
| Booking claim | `confirmGranotBooking`, `createReferralBooking` | `$set booking_ref`, clears `disputed` (see [bookings-and-cancellations.md](bookings-and-cancellations.md)). |
| Release | `deleteBookedLead` → `releaseLiveBookingClaims` | `$unset booking_ref`. |

### Discrepancy Owner commands (not Lead-mutating)

Routes `POST /api/v1/admin/granot-lifecycle/discrepancies/:id/{re-evaluate,correct-record-link,no-action}` (`granot-lifecycle-admin.routes.ts` L185–L207), Owner registry actor, one `Idempotency-Key` header, `executeIdempotentCanonicalCommand`, discrepancy CAS on `{state: "open", revision}`.

| Command | Source | Effect |
|---|---|---|
| `reEvaluateGranotDiscrepancy` | `discrepancyOwnerCommands.ts` L54–L104 | Reclassifies the newest evidence; may open or refresh a booking or release case. No Lead, no EntityChange. |
| `correctGranotRecordLink` | L106–L148 | Old link → `superseded` with `superseded_by`; new active link to the selected Lead, copying `booking_ref`. The selected Lead must already hold the job (L189–L193). **No Lead field changes**: no job moves, no `booked` change, and `BookedLead.lead_ref` is not updated. EntityChange on both links. |
| `resolveGranotDiscrepancyNoAction` | L41–L52 | Resolution `no_action`. |

Production: 4 `correctGranotRecordLink`, 3 `reEvaluateGranotDiscrepancy` and 8 `resolveGranotDiscrepancyNoAction` executions, all 2026-08-20. `granot_lifecycle.receipt.requeue` (`operations.ts:requeueDeadLetterReceipt` L229–L312) changes only a dead-letter receipt back to `pending`; it is not Lead-mutating.

## 8. Priority 5 means "booked in Granot", not booked

- **Lead:** `granot_priority: "5"` is stored like any priority, and it triggers broad enrichment (`quoted: true`, contact snapshot, move fields) exactly like priority 1 (`leadDesiredState.ts` L95, L366–L378). It never writes `booked` (forbidden path).
- **Desk:** the active configuration maps code `5` to workflow `closed`, closure reason `granot_booked` (configuration data; [downstream-consumers.md](downstream-consumers.md)).
- **Booking cases:** a case opens only on actual `booked` or `release` evidence (`bookingReconciliation.ts:classifyBookingReconciliation` L1106–L1210). Priority 5 is pairing evidence on the case (`bookingPriorityPairing.ts` L82–L132: `priority_5_then_booked`, `booked_carries_priority_5`, `booked_without_priority_5`) and the fallback latest action when a case has no booking evidence (`bookingIntakeLatestAction.ts` L16–L26).
- **Sheets:** priority is not a column or routing input; a priority-only change plans no Sheet job.

## 9. Worked example: a Form Fill Call on Duplicate Calls receives its Form's job through the mirror

Production read 2026-11-20 12:48 New York. Customer A, phone `+1555555xxxx`, source company `tbm_leads`.

| Time (UTC, 2026-11-17) | Event | Evidence |
|---|---|---|
| 15:33:44 | `createFormLead`, `ingestion_origin: wordpress_form`, `duplicate: false` | Forms row 8278 |
| 15:57:18 | `synchronizeLeadFromGranot` on the Form via `granot_webhook`: `job_no`, `normalized_job_no` (job 55677xx), `granot_priority`, receiver | Form revision 1 |
| 16:00:17 | `createCallLead` from the RingCentral queue: qualification `call_log_inbound_target_elapsed_at_least_120s`, `form_fill: true` (same phone, same company, non-duplicate Form), `duplicate: false`, `created_on_unmatched: false`, `no_sync: false` | Duplicate Calls row 360 |
| 16:25:43 | `mirrorFormLeadToCallSibling` via `granot_http_automation`, basis `phone_source_company`: `job_no`, `normalized_job_no`, `granot_priority` (7), receiver fields (`granot_username_match`), `granot_form_sibling` | Call revision 2 |

The Call kept `form_fill: true` and stayed on Duplicate Calls (row 360, `synced`), not billable. It was updated in place. That 16:25 run used the receipt path of a pre-schema-3 run (before `5137f06f`), where an `already_current` Form result also mirrors. Under schema 3 direct apply, the same catch-up would wait for an applied Form change or a webhook (finding 2).

## 10. Rules and tests

Executable coverage is rolled into [COVERAGE.md](COVERAGE.md#tests) (Appendix E).
