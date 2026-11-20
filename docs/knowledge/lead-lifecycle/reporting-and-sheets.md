---
okf_version: "0.2"
type: Reference
title: Lead reporting routing and Sheet Sync
description: The complete routing table from Form Lead and Call Lead state to Master Sheets tab, billable value and CPL, plus how Sheet Sync moves, removes and re-delivers rows.
tags: [lead-lifecycle, sheet-sync, form-lead, call-lead, billing]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/leads/callLeadReportingDisposition.ts
  - src/services/leads/callLeadAdmission.ts
  - src/services/leads/externalSheetReview.ts
  - src/services/ringcentral/callLeadQualification.ts
  - src/services/googleSheets/**
  - src/services/sheetSync/**
  - src/services/insights/pricing.ts
  - src/services/analytics/leadCost.service.ts
  - api/queues/sheet-sync-consumer.ts
  - src/routes/sheet-sync-cron.routes.ts
  - ops/capacity/repair-formula-phone-cells-2026-11-20.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/sheetSync/drainer/jobPlanner.ts
  - id: disposition
    resource: src/services/leads/callLeadReportingDisposition.ts
  - id: targets
    resource: src/services/googleSheets/leadReportingTargets.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Lead reporting routing and Sheet Sync

This page answers one question for every Form Lead and Call Lead: which Master Sheets tab should hold its row, is it billable, and what CPL prices it. It then explains how Sheet Sync gets the row there, and what it leaves behind.

Everything below is read from code at `9955430d`. Line ranges are from that commit. Sibling pages own how each flag is *set*: [form-leads.md](form-leads.md), [call-leads.md](call-leads.md), [duplicates-and-form-fill.md](duplicates-and-form-fill.md), [bad-leads.md](bad-leads.md), [granot-effects.md](granot-effects.md), [bookings-and-cancellations.md](bookings-and-cancellations.md). This page owns how the flags are *read* for reporting. What the same states mean to the Desk, Insights, Daily Operations, Numbers and the timeline is in [downstream-consumers.md](downstream-consumers.md).

## Locked Owner directives that this page applies

- **Call Lead billing, 2026-11-03:** "only RingCentral inbound queue qualification may create a Call Lead or make it eligible for Calls reporting and lead billing." Preserved historical RingCentral qualification and the Best Relocation inventory and final import are the only other admissions. Official Booking and Cancellation rows remain reportable.
- **Master Leads Calls tab, 2026-11-20:** "No backfill or major change on the Master Leads Calls tab. The Owner handles removals and inspection there manually. Rule: only RingCentral-queue-qualified Call Leads get minted and take part in the lifecycle." This page therefore documents current behavior for excluded rows and proposes no Sheet Sync change that would remove Calls-tab rows automatically. See [Excluded Leads and their existing rows](#excluded-leads-and-their-existing-rows).

## The eight tabs

Sheet Sync writes only the two Master Sheets. Source Company Sheets import from them. Source targets exist in code but are written only when `shouldWriteSourceLeadSheets()` is on (`src/services/googleSheets/targets.ts:getLeadTargets` L15–L49).

| Workbook | Tab (`SHEET_TAB_NAMES`) | Target key | Holds | Managed headers |
|---|---|---|---|---|
| Master Leads | Forms | `master_forms` | Form Leads, normal | `FORM_SHEET_HEADERS` (22) |
| Master Leads | Duplicate Forms | `master_duplicates` | Form Leads with `duplicate: true` | `FORM_SHEET_HEADERS` |
| Master Leads | Bad Form Leads | `master_bad_leads` | Bad Form Leads | `FORM_SHEET_HEADERS` |
| Master Leads | Calls | `master_calls` | billable Call Leads | `CALL_SHEET_HEADERS` (15) |
| Master Leads | Duplicate Calls | `master_duplicate_calls` | 90-day repeats, Form Fill, external duplicates | `CALL_SHEET_HEADERS` |
| Master Leads | Bad Call Leads | `master_bad_calls` | Bad Calls | `CALL_SHEET_HEADERS` |
| Master Booked | Booked Deals | `master_booked` | every Booking | `BOOKED_SHEET_HEADERS` (15) |
| Master Booked | Cancelled Deals | `master_cancelled` | every Cancellation | `CANCELLED_SHEET_HEADERS` (9) |

**Source:** `src/config/domain/sheets.ts` `SHEET_TAB_NAMES` L11–L20, headers L52–L75, L101–L117, L119–L135, L137–L147; `src/services/googleSheets/leadReportingTargets.ts:CALL_REPORTING_TARGETS` L6–L10 @ `9955430d`.

The old titles `Duplicates`, `Bad Leads` and `Bad Calls` were renamed on November 3 (`6febe214`) by numeric sheet ID, so their rows survived the rename (`src/services/googleSheets/tabMigration.ts:planLeadTabMigration`). Code still accepts the old Form titles for reads and deletes (`src/services/googleSheets/tabs.ts:RENAMED_FORM_TABS` L30–L33, `resolveCompatibleSheetTitle` L37–L51; `leadReportingTargets.ts:allFormLeadTargets` L54–L62).

## Routing table

### Call Leads

The Call decision is one pure function, `getCallLeadReportingDecision`. The planner adds two checks in front of it.

**Source:** `src/services/leads/callLeadReportingDisposition.ts:getCallLeadReportingDecision` L18–L39, `isOvernightCallArrival` L9–L16; `src/services/sheetSync/drainer/jobPlanner.ts:planSourceLead` L128–L194; `src/services/sheetSync/noSyncLead.ts:noSyncAppliesToNormalTabs` L13–L34; `src/services/googleSheets/expectedSheetTabs.ts:planExpectedSheetTabs` L142–L204 @ `9955430d`. **Time window:** none, except the overnight rule's America/New_York hour. **Idempotency:** pure functions of the saved Lead; every re-delivery recomputes them.

**Precedence, highest first.** The first matching row wins.

| # | Condition | Disposition | Tab | Billable | Sheet Sync action on re-delivery |
|---|---|---|---|---|---|
| 1 | `no_sync === true`, `duplicate !== true`, and the decision is **not** `duplicate_calls` or `bad_call_leads` (this includes excluded and Unmatched Calls without `duplicate: true`) | `calls` or `excluded` (unchanged) | none | unchanged by No-Sync: `calls` stays billable | Delete the row from all three Call tabs. No upsert. |
| 2 | `created_on_unmatched === true` | `excluded`, reason `created_on_unmatched` | none | false | Nothing. No upsert, no delete. |
| 3 | No reporting admission: `hasReportingEligibleCall` is false | `excluded`, reason `missing_call_reporting_admission` | none | false | Nothing. No upsert, no delete. |
| 4 | `duplicate === true` (90-day repeat), or `form_fill === true`, or a trusted external review of kind `duplicate_call` | `duplicate_calls` | Duplicate Calls | false | Upsert Duplicate Calls, then delete Calls and Bad Call Leads rows. |
| 5 | A trusted external review of kind `bad_call`, or an overnight missed call (below) | `bad_call_leads` | Bad Call Leads | false | Upsert Bad Call Leads, then delete Calls and Duplicate Calls rows. |
| 6 | Otherwise | `calls` | Calls | **true** | Upsert Calls, then delete Duplicate Calls and Bad Call Leads rows. |

Notes on the precedence:

- Rows 2 and 3 are checked together in the decision function, and both reason codes are recorded when both apply. Row 1 is checked first by the planner, so `no_sync` still deletes the rows of an excluded or Unmatched Call, unless that Call has `duplicate: true` (`noSyncLead.ts` L29 returns false for any duplicate before the disposition is read; `jobPlanner.ts` L141–L166 run before L167–L171).
- Rows 4 and 5 keep every reason. A duplicate that is also bad stays on Duplicate Calls and keeps `external_bad_call` or `overnight_missed_call` in `reason_codes` (L36–L38). Production shows this: 3 Calls carry `repeat_call_duplicate+external_bad_call`.
- **Overnight missed call** (row 5) needs all of: `ringcentral.final_result` trimmed and lower-cased equals `missed`; `final_result_observed_at` is a valid Date; `final_result_call_log_id` is non-blank and equals `ringcentral.call_log_id`; `ringcentral.start_time` is a Date whose America/New_York hour is in [01, 07); and `final_result_answered === false` (L29–L35). The clock is `ringcentral.start_time` only. It never falls back to `createdAt` or a wall-clock string. If `final_result_answered === true` the decision records `conflicting_final_result`, and the Call stays on Calls and billable.
- `booked`, `cancelled`, Job Number, priority and receiver never change the Call tab or billability. The truth table below confirms this for every combination.
- No-Sync never changes billability. A No-Sync qualified Call is billable and has no row (`callLeadReportingDisposition.test.ts`, "No-Sync does not change billing").
- A Call that carries a trusted `bad_form` review (schema-valid only with a `Forms` or `Local Forms` tab source, sheet IDs 0 and 584355266; `leads/externalSheetReview.ts` L6, L21–L22) defeats No-Sync through `hasFormBadProjection` (`noSyncLead.ts` L30). Its tab is then decided by rows 2–6. No production Call carries one.

**Reporting admission** (`hasReportingEligibleCall`, `src/services/leads/callLeadAdmission.ts` L52–L61). Any one of three admits a Call:

| Admission | Test | Source |
|---|---|---|
| RingCentral inbound queue qualification (saved, including preserved historical) | `ringcentral.ingestion_source` is `call_log_sync` or `webhook`; `qualification_reason` is `call_log_inbound_target_elapsed_at_least_120s` or the older `call_log_inbound_target_answered_over_120s`; `duration_seconds` is a finite number ≥ 120; `telephony_session_id` or `call_log_id` is a non-blank string | `src/services/ringcentral/callLeadQualification.ts:hasQualifiedRingCentralCall` L11–L18 |
| Best Relocation historical inventory | `_id` is one of the 69 IDs in `LEGACY_BEST_RELOCATION_CALL_IDS` (manifest `best-relocation-legacy-reporting-v1`), `source_company: "best_relocation_leads"`, `lead_source_company` = `6a4d240f3117eacd97823868`, `source_granularity_id` = `6a4d240f04c6e063cb6621f3` | `callLeadAdmission.ts:hasLegacyBestRelocationCall` L43–L49 |
| Best Relocation final import | `external_call_admission` parses under `externalCallAdmissionSchema` (policy `best-relocation-final-import-v1`, tracker workbook, `source_sheet_id` 1191420872, tab `Calls`, Date `source_arrival_at` and `applied_at`, 24-hex run and receipt IDs), and the Lead has `source_company: "best_relocation_leads"` and its company and feed match the fact | `callLeadAdmission.ts:externalCallAdmissionSchema` L16–L29, `hasReportingEligibleCall` L57–L60 |

A Call with a RingCentral reason but 119 s, or any other reason string, is not admitted. ISO-string dates never admit (BSON Date checks only).

**Trusted external review** (`src/services/leads/externalSheetReview.ts:externalSheetReviewSchema` L7–L24, `hasTrustedExternalSheetReview` L28–L31). Only the November 3 Best Relocation reconciliation command wrote it (see [bad-leads.md](bad-leads.md)). The kind must agree with the reason (`duplicate_call` ↔ `external_form_fill` or `external_duplicate`; `bad_call` ↔ `external_bad_call`) and with the source tab (`Calls` for Call kinds). A forged or partial object is ignored.

### Call routing truth table

A throwaway script imported the pure functions from the worktree and evaluated 4,800 Call combinations. The inputs were: 6 admission states (none, queue-qualified, 119 s, wrong reason, BR inventory, BR final import) × `created_on_unmatched` × `duplicate` × `form_fill` × 5 review states (none, external Form Fill, external duplicate, bad call, forged) × 5 final-result states (none, overnight missed, overnight missed but answered, daytime missed, overnight missed on another call log) × `no_sync` × `booked`/`cancelled`. No database was used.

- `booked`/`cancelled` changed no outcome.
- `billableCallLeadFilter()` and `billableCallLeadExpression()` agreed with `getCallLeadReportingDecision().billable` in all 4,800 cases, and `reportingEligibleCallLeadFilter()` agreed with `hasReportingEligibleCall()`, under an in-memory evaluator of their Mongo syntax. The two loopback-Mongo agreement tests in `callLeadAdmission.test.ts` skip offline, so this is the offline evidence.

| Combinations | Admitted | Unmatched | Disposition | Billable | `planExpectedSheetTabs` | Planner action | Insights price status |
|---:|---|---|---|---|---|---|---|
| 48 | yes | no | calls | true | Calls | upsert Calls, delete others | priced |
| 48 | yes | no | calls | true | skip `no_sync` | delete all Call tabs | priced |
| 1,020 | yes | no | duplicate_calls | false | Duplicate Calls | upsert Duplicate Calls, delete others | duplicate ($0) |
| 84 | yes | no | bad_call_leads | false | Bad Call Leads | upsert Bad Call Leads, delete others | nonbillable ($0) |
| 900 | yes | yes | excluded | false | skip `created_on_unmatched` | nothing | no fact |
| 300 | yes | yes | excluded | false | skip `no_sync` | delete all Call tabs | no fact |
| 900 | no | no | excluded | false | skip `missing_call_qualification` | nothing | no fact |
| 300 | no | no | excluded | false | skip `no_sync` | delete all Call tabs | no fact |
| 900 | no | yes | excluded | false | skip `created_on_unmatched` | nothing | no fact |
| 300 | no | yes | excluded | false | skip `no_sync` | delete all Call tabs | no fact |

### Form Leads

**No Form `excluded` disposition exists in code.** Form routing has no admission gate: every Form Lead that exists is routed. `form_fill` and `created_on_unmatched` are Call fields; on a Form they change nothing (confirmed by the truth table).

**Source:** `src/services/googleSheets/leadReportingTargets.ts:hasFormBadProjection` L25–L27, `formLeadTargets` L32–L39, `staleFormTargetKeys` L42–L46; `jobPlanner.ts:planSourceLead` L141–L182; `noSyncLead.ts` L13–L34 @ `9955430d`.

| # | Condition | Tab | Insights billable | Sheet Sync action on re-delivery |
|---|---|---|---|---|
| 1 | Bad: `bad_lead` is truthy (any reason, including `legacy_bad_tab`) or a trusted `bad_form` review | Bad Form Leads | `!duplicate` (a non-duplicate Bad Form is priced) | Upsert Bad Form Leads, then delete Forms, Duplicate Forms and legacy `Duplicates` rows. `no_sync` and `duplicate` do not change the tab. |
| 2 | `duplicate === true` | Duplicate Forms | false | Upsert Duplicate Forms, then delete Bad Form Leads and legacy `Bad Leads` rows. **The Forms row is not deleted.** |
| 3 | `no_sync === true` | none | true | Delete the row from every Form tab, including legacy titles. No upsert. |
| 4 | Otherwise | Forms | true | Upsert Forms, then delete Bad Form Leads and legacy `Bad Leads` rows. **A Duplicate Forms row is not deleted.** |

Precedence: Bad wins over duplicate and No-Sync. Duplicate wins over No-Sync. The Bad Form tab is exclusive (`formLeadTargets` comment: "Bad Forms have one exclusive destination, including duplicate/booked Forms").

Form truth table, 512 combinations (`duplicate` × 4 `bad_lead` values × 4 review states × `no_sync` × `booked` × `form_fill` × `created_on_unmatched`):

| Combinations | Bad | Duplicate | No-Sync | Tab | Planner deletes | Insights price |
|---:|---|---|---|---|---|---|
| 16 | no | no | no | Forms | Bad Form Leads | priced |
| 16 | no | no | yes | none | every Form tab | priced |
| 16 | no | yes | no | Duplicate Forms | Bad Form Leads | duplicate ($0) |
| 16 | no | yes | yes | Duplicate Forms | Bad Form Leads | duplicate ($0) |
| 224 | yes | no | either | Bad Form Leads | Forms, Duplicate Forms | priced |
| 224 | yes | yes | either | Bad Form Leads | Forms, Duplicate Forms | duplicate ($0) |

**The Forms ↔ Duplicate Forms asymmetry is intentional in code.** The test "Form Duplicate upserts Duplicates and does not delete leftover Forms" (`jobPlanner.test.ts` L478–L490) pins it, and the comment on `staleFormTargetKeys` reads "Preserve ordinary Form duplicate behavior". A Form that becomes a duplicate keeps its old Forms row. A Form that stops being a duplicate keeps its old Duplicate Forms row. Only a deletion tombstone, No-Sync or a Bad Form move removes those rows.

### Billable value and the CPL used

Sheets have no CPL column. CPL matters only to billing and spend reports. Detail is in [downstream-consumers.md](downstream-consumers.md#insights-and-analytics-lead-spend).

| State | Insights, Today and Desk live price (`src/services/insights/pricing.ts:priceLead` L33–L42, `src/services/insights/facts.ts:toLeadFact` L133–L160) | Legacy Analytics lead cost (`src/services/analytics/leadCost.service.ts` L22–L44) |
|---|---|---|
| Call `calls` | The feed's CPL Schedule amount for the Lead's New York business day (`priced`); `unpriced` if no single period covers the day; `no_feed` if no feed | Sums the stamped `cpl`; filter `billableCallLeadFilter()` plus `created_on_unmatched ≠ true` |
| Call `duplicate_calls` | $0, status `duplicate` | Not counted |
| Call `bad_call_leads` | $0, status `nonbillable` | Not counted |
| Call `excluded` (including Unmatched) | No Lead fact at all | Not counted |
| Form, not duplicate (normal, No-Sync or Bad) | The feed's CPL for the day (`priced`) | Sums stamped `cpl`; filter `duplicate ≠ true` |
| Form, duplicate (including a duplicate Bad Form) | $0, status `duplicate` | Not counted |

The stamped `cpl` is set at creation by the CPL resolver (see [form-leads.md](form-leads.md) and [call-leads.md](call-leads.md)). It is not recomputed when a Lead turns duplicate, Form Fill or bad. The live price ignores the stamp. A Bad Form is billable in both reports; whether that matches Owner intent is an open question for the Owner.

### Booked Deals and Cancelled Deals

Every Booking is expected on Booked Deals and every Cancellation on Cancelled Deals, with no flag gate (`expectedSheetTabs.ts` L179–L202; `jobPlanner.ts:planBookedLead` L196–L214, `planBookingChain` L216–L245, `planCancellationChain` L247–L268).

- A cancelled Booking stays on Booked Deals with `cancelled` in its Cancelled cell. Its Cancellation also has a Cancelled Deals row. Nothing moves a Booking off Booked Deals except its deletion tombstone.
- A Leadless Booking or Referral Booking has a Booked Deals row with a blank Mongo Lead ID cell. A Booking whose Lead is an excluded Call still has its row. This keeps official Bookings reportable (Owner directive 2026-11-03). Production on November 20: 142 leadless Booked Deals rows, and 32 Booked Deals rows whose Lead is an excluded Call.
- A Booking Chain also re-delivers the attached Lead through the same Lead planner, so the Lead's tab rules above apply in the same drain.
- A Cancellation Chain re-delivers the Booking Chain (Booking plus Lead), then the Cancellation row.

## Delivery pipeline

**Intent.** A domain write stores a Sheet Sync job in `sheet_sync_jobs` inside its own transaction in `queued` mode (`src/services/sheetSync/sheetSyncCoordinator.ts:persistSheetSyncIntent` L105–L113), then publishes a queue wake-up after commit (`finalizeSheetSync` L123–L134). `legacy` mode runs the same routing through `waitUntil` (`src/services/sheetSync/sheetSyncSourceLookup.ts:syncSourceLead` L119–L159; `src/services/googleSheets/googleSheets.service.ts:syncFormLeadToSheets` L38–L53, `syncCallLeadToSheets` L55–L74). Production runs `queued`.

| Job resource | Coalescing key | Re-delivers |
|---|---|---|
| `source_lead` | `source_lead:<Model>:<id>` | one Form or Call Lead |
| `booked_lead` | `booked_lead:<id>` | the Booked Deals row only |
| `booking_chain` | `booking_chain:<id>` | the Booked Deals row, then the Lead |
| `cancellation_chain` | `cancellation_chain:<id>` | the Booking Chain, then the Cancelled Deals row |
| `delete_source_lead`, `delete_booked_lead`, `delete_cancelled_lead` | `delete_…:<id>` | tombstone deletes |

**Source:** `src/config/domain/sheetSync.ts:buildCoalescingKey` L314–L336, `priorityForJob` L286–L306; `src/services/sheetSync/sheetSyncOutbox.service.ts:upsertActiveJob` L80–L131 @ `9955430d`.

- **Idempotency / replay key:** the coalescing key. A new intent merges into an active `pending` or `retrying` job with the same key: `due_at` only moves earlier, priority only rises, and `target_hints` reset to `[]`. A job in `processing` is not merged; a fresh `pending` job is created and replays against current Mongo state.
- **Time window and clock:** debounce `SHEET_SYNC_DEBOUNCE_WINDOW_MS` (default 3 s; UTC instants). Retry back-off starts at 30 s and doubles to 15 min; the job is terminal after `SHEET_SYNC_MAX_ATTEMPTS` (default 8) (`runSheetSyncDrain.ts` L33–L34, `markJobFailure` L581–L603; `sheetSync.ts:getSheetSyncDrainGuardrails` L239–L250).
- **Drain triggers:** cron `/api/cron/sheet-sync-drain` every 5 minutes (`vercel.json`; `src/routes/sheet-sync-cron.routes.ts` L22–L31); the queue consumer `api/queues/sheet-sync-consumer.ts` on topic `sheet-sync-events*`; Admin retry `POST /api/v1/admin/sheet-sync/retry` (`src/services/admin/adminSheetSync.service.ts:retrySheetSyncJobs` L122–L159, which resets the selected jobs to `pending` with `attempts: 0`). One global lease allows one drain at a time.
- **Planning replays current state.** The planner reloads the Lead and plans from its current flags, never from the intent's operation name. A stale retry hint cannot drop the current destination or its stale-row deletes (`jobPlanner.ts` L176–L178, L187–L189).
- **Writer fence:** during a tab-topology migration, the durable lease `lead-reporting:tab-migration` blocks every Master Leads write. Claimed jobs are released without consuming attempts (`src/services/sheetSync/writerFence.ts` L4–L41; `runSheetSyncDrain.ts` L198–L201). Booked and Cancelled targets are not fenced.
- **Effects:** no Outreach or EntityChange effect. Sheet Sync writes only `sheet_sync` metadata with a plain `updateOne`, and the Outreach Lead-change feed reads EntityChanges. Daily Operations gets one `sheet_sync.completed` fact per synced job and one `sheet_sync.failed` fact per failure (`runSheetSyncDrain.ts:recordJobCompletedFact` L609–L611, `recordJobFailureEvent` L618–L640; `src/services/dailyOperations/recordDomainFacts.ts:recordSheetSyncDailyOperationsFact` L589).

### Batch writer

**Source:** `src/services/sheetSync/drainer/batchWriter.ts:writeBatchedTargets` L58–L80, `processTabGroup` L99–L177, `applyDeletes` L252–L308, `rowRemovalRequests` L312–L345; `src/services/sheetSync/drainer/tabRowMap.ts:buildTabRowMap` L17–L67 @ `9955430d`.

1. All upserts run first, grouped per tab. Each tab is read once (the header row plus the Mongo ID column) into a map of Mongo ID → row number.
2. An upsert whose Mongo ID is on the tab rewrites that row in place. Otherwise it is appended. **The stored `sheet_sync.row_number` never addresses a write**; it is a hint only.
3. If the same Mongo ID appears on more than one row of the destination tab, the extra rows are removed after a successful upsert (duplicate-row repair, L155–L174).
4. A delete runs only when every upsert of the same Lead succeeded. A failed or deferred destination turns that Lead's deletes into `deferred` with `destination_upsert_pending` (L68–L76). The retry re-plans from Mongo.
5. Upserts use `valueInputOption: "USER_ENTERED"`.

## Stale-row removal

Stale-row removal is the delete half of a re-delivery. It happens **only after the destination upsert succeeded** in the same drain.

| Lead | Stale targets planned | Key list passed to `getDeleteTargets` |
|---|---|---|
| Call, routed | the two Call tabs other than the destination (`jobPlanner.ts` L190–L192) | `staleCallTargetKeys` (`leadReportingTargets.ts` L14–L17) |
| Form, Bad | Forms, Duplicate Forms, legacy `Duplicates` | `master_forms`, `source_forms`, `master_duplicates`, `source_duplicates` |
| Form, not Bad | Bad Form Leads, legacy `Bad Leads` | `master_bad_leads`, `source_bad_leads` |
| No-Sync (Form or Call) | every tab of its type | all reporting keys of its type |
| Call, excluded or Unmatched (no No-Sync) | none | — |

`getDeleteTargets` (`src/services/googleSheets/targets.ts` L51–L84) always includes the planned fallback targets, whether or not the Lead's `sheet_sync` lists them, and adds any `sheet_sync` entry whose target is in the key list. The batch writer then finds the row by Mongo ID on the live tab. A row already gone is a successful no-op.

The removal step reads the row before deleting it (`rowRemovalRequests`):

- The Mongo ID cell must still equal the Lead's ID, or the delete fails with `sheet_delete_identity_changed`.
- If any protected range covers the row, the delete fails with `sheet_delete_protected_row`. The check ignores editors and warning-only protections, so a whole-tab or whole-column protection blocks every removal on that tab. No tab had a protected range on November 20.
- If the row has **operator content**, the row stays and only its managed cells are cleared, including the Mongo ID. Otherwise the row is deleted. See [Managed and operator cells](#managed-and-operator-cells).

## Tombstones

Deleting a Form Lead, Call Lead, Booking or Cancellation through its canonical delete path stores a tombstone job and cancels any pending upsert job for the same entity (`sheetSyncOutbox.service.ts:enqueueSheetSyncTombstone` L184–L252). Tombstones skip the debounce and have delete priority.

- **Previous targets:** the deleted record's `sheet_sync` entries (`buildTombstonePreviousTargets` L146–L157). A Call tombstone also adds both duplicate and non-duplicate fallback targets (`src/services/leads/callLead.service.ts:rememberBothCallSheetTabsForTombstone` L717–L768, `tombstoneBothCallSheetTabs` L770–L793). A Form tombstone uses its `sheet_sync` (`src/services/leads/formLead.service.ts:tombstoneSheetSync` L1005–L1029).
- **Planner:** for `delete_source_lead` the planner also adds every Call tab (for a Call) or every Form tab and legacy title (for a Form) from `source_company`, and fans each Call target out to all three Call titles (`jobPlanner.ts:planTombstone` L277–L337). So a Lead deletion removes its row from every tab of its type, whatever its disposition, including an excluded Call. Target hints never narrow a `delete_source_lead`.
- **Precedence:** a tombstone cancels the same entity's pending upsert (`superseded_by_delete_tombstone`).
- **Idempotency:** key `delete_source_lead:<Model>:<id>`; a row already gone is synced as a no-op.
- **Effects:** Sheet: delete only. The Outreach, Daily Operations and EntityChange effects belong to the delete command ([form-leads.md](form-leads.md), [call-leads.md](call-leads.md), [bookings-and-cancellations.md](bookings-and-cancellations.md)).

## Re-delivery semantics

- Sheet Sync never scans the tabs on its own. It reads a tab only while delivering a job for some Lead on it. **A row removed or moved by hand is not noticed until that Lead's next intent.** There is no periodic full resync.
- On that next intent, the writer looks the Lead up by Mongo ID. If the row is missing, it **appends a new row** at the bottom and stores the new row number. If the Lead's row sits on a tab it does not belong to, the stale-row rules above decide whether it is removed.
- Consequence for the Calls tab directive: when the Owner removes a **billable** Call's row from Calls by hand, the row comes back on the Call's next intent (a Granot update, booking, cancellation, Form Fill change, receiver fill or final-result write). A manual removal is durable only for a Call that no longer routes to Calls. On November 20 the coordinator found 55 billable Calls and 4 Form Fill Calls whose `sheet_sync` says `synced` while their Mongo ID is absent from the expected tab.
- `ops/capacity/repair-formula-phone-cells-2026-11-20.ts` (L22–L87) used exactly this path. It enqueued ordinary `source_lead` jobs with operation `sheet_phone_text_repair` and `created_by: "script"`, and the drainer rewrote each row from Mongo. It writes no Lead field itself.

## Excluded Leads and their existing rows

Only Call Leads can be excluded. A Call is `excluded` when it has no reporting admission or is an Unmatched Call Lead.

| Case | What re-delivery does | Source |
|---|---|---|
| Excluded, `no_sync` not set | Plans nothing: no upsert, **no delete**. Any existing row on Calls, Duplicate Calls or Bad Call Leads stays as it is. The job completes as `synced` with no writes. | `jobPlanner.ts` L167–L171; `runSheetSyncDrain.ts` L181–L186, L222–L228 |
| Excluded with `no_sync: true` | Deletes its rows from all three Call tabs, unless the Call has `duplicate: true`; then it plans nothing and the rows stay. | `noSyncLead.ts` L28–L33; `jobPlanner.ts` L141–L171 |
| Excluded, then deleted through `deleteCallLead` | The tombstone removes every Call-tab row. | [Tombstones](#tombstones) |
| Becomes excluded later | Current writers do not do this: saved admission evidence is not removed and `created_on_unmatched` is no longer set (see [call-leads.md](call-leads.md)). A Call starts excluded or never is. | — |

**Why 209 excluded Call rows exist** (November 20 scan at 12:38 New York: 203 on Calls, 6 on Duplicate Calls). Before `6febe214` (November 3, 2026) the planner sent every non-Unmatched Call to Calls or Duplicate Calls by its `duplicate` flag alone, with no admission check. Those rows were written then. Since November 3 an excluded Call plans nothing, so its old row stays. By group: 119 TBM Leads, 79 Top 10 and 2 TBM Prime `legacy_unknown` Calls on Calls; 2 Top 10 `vantage_admin` (manual) Calls on Calls; 1 TBM `granot_lead_created` Call on Calls; and 6 `legacy_unknown` Calls on Duplicate Calls. All carry `missing_call_reporting_admission`. Billing and reporting filters already exclude them.

The five legacy June 9 Calls left after the formula-phone repair (Calls rows 234, 235, 246, 247 and Duplicate Calls row 23) belong to this population.

**Owner decision, November 20.** The Owner handles removals and inspection on the Calls tab manually, with no backfill. The review's open option to "have Sheet Sync remove the rows of any Lead whose disposition is `excluded`" is superseded by that directive for the Calls tab. Canonical deletion and `no_sync` would also remove rows in code; both are Owner choices and are not proposed here.

## No-Sync

`no_sync === true` keeps an ordinary Lead off the normal tabs. Missing, `false` or `null` stay syncable (`noSyncLead.ts:isNoSyncLead` L9–L11). It does not apply to any Lead with `duplicate: true` (Form or Call, including an excluded Call), a Bad Form, or a Call routed to Duplicate Calls or Bad Call Leads (L28–L33). When it applies, the planner deletes every row of the Lead's type and upserts nothing. No-Sync changes neither Call billing nor the Form Insights price. Booked Deals still writes for the Lead's Booking. Writers of `no_sync` are documented in [form-leads.md](form-leads.md) and [call-leads.md](call-leads.md).

## Managed and operator cells

Each tab's managed columns are its header list, in order. Sheet Sync overwrites the whole managed range `A:<last managed column>` on every upsert.

| Tab group | Managed headers |
|---|---|
| Forms, Duplicate Forms, Bad Form Leads | Timestamp, Name, Pickup Zip, Destination Zip, Pickup State, Delivery State, Local, Move Date, Phone Number, Email, Quoted, Cubic Feet, Booked, OVER 2000, OVER 4000, Booked Date, Cancelled, Mongo ID, Ref No, Source Company, Bad Lead, Sales Rep |
| Calls, Duplicate Calls, Bad Call Leads | Timestamp, Job No, Phone Number, Duration, Booked, Booked Date, Over 2000, Over 4000, Cancelled, Local, Cubic Feet, Mongo ID, Source Company, FormFill, Sales Rep |
| Booked Deals | Timestamp, Agent, SplitAgent, Binder Amount, Split, Book Date, Job No, Customer Name, Deposit Amount, Merchant, Source, Mongo ID, Mongo Lead ID, Local, Cancelled |
| Cancelled Deals | Timestamp, Agent, Cancel Date, Job No, Customer Name, Refund Amount, Source, Mongo ID, Lead Mongo ID |

**Source:** `src/config/domain/sheets.ts` L52–L147; projections `src/services/googleSheets/projections/formLeadRow.ts:formLeadToRow` L22–L49, `callLeadRow.ts:callLeadToRow` L15–L35, `bookedLeadRow.ts:bookedLeadToRow` L17–L37, `cancelledLeadRow.ts:cancelledLeadToRow` L4–L18 @ `9955430d`.

Cell rules:

- **Phone cells are text.** `textCell` adds a leading apostrophe to any value starting with `=`, `+`, `-` or `@` (`projections/cells.ts:textCell` L16–L19). Form and Call phone cells use it since PR #240 (`70581961`). Before that fix, an E.164 phone was stored as a formula and showed without its `+`, or as `#ERROR!`. The imported Best Relocation note in the Form `Bad Lead` cell is always apostrophe-prefixed (`formLeadRow.ts:formBadReasonCell` L55–L63).
- Form Name and Email, and the Booked Deals Customer Name, are written raw. A value starting with `=`, `+`, `-` or `@` would be parsed by Sheets (a minor finding).
- `FormFill` on the Call tabs is `TRUE`/`FALSE` from `form_fill`. `Sales Rep` is `receiver_agent_name_snapshot`, so a receiver change shows only after the Lead's next delivery. `Source Company` prefers the CRM label snapshot, then the feed label snapshot, then the company label.
- A Form `Bad Lead` cell shows the reason label (for example `D/C number` or `Legacy Bad Tab`), or the imported note.

**Operator content** (`batchWriter.ts:rowRemovalRequests` L328–L337) is anything on the row that Sheet Sync did not write: a value in a column whose header is not a managed header (columns to the right and blank-header columns), or a note, rich-text run or data-validation rule in any cell. Since PR #237 a formula in a managed column counts as managed, because Google stores a `USER_ENTERED` `+…` phone as a formula. Operator content never blocks an upsert. It only changes a removal into "clear the managed cells, keep the row".

**Header refusal.** Before writing, the tab's header row must contain exactly one `Mongo ID`, and must start with the full managed header list in order. Otherwise delivery to that tab fails with `sheet_identity_header_rewrite_unsafe` (when headers are ensured) or `sheet_identity_projection_layout_unsafe`, and the job retries (`batchWriter.ts` L116–L143; `tabRowMap.ts` L41–L53). A release that adds a managed column must update the tab headers first. A brand-new empty tab is initialized.

## Sheet Sync metadata (`sheet_sync`)

Each Form Lead, Call Lead, Booking and Cancellation stores `sheet_sync`: one entry per target with `spreadsheet_id`, `tab_name`, `row_number`, `status`, `last_synced_at`, `last_error` and `updated_since_last_sync` (`src/models/FormLead.ts` L115, `CallLead.ts` L173, `BookedLead.ts` L93).

- **Writer (queued):** `runSheetSyncDrain.ts:persistDocSheetSync` L421–L483 and `persistSheetSyncMetadata` L485–L502. Per document it removes entries for targets deleted in this drain, then merges one entry per upsert outcome: `synced` with the row number, `pending` when deferred, `failed` with the error. It writes a plain `updateOne({ _id }, { $set: { sheet_sync } })`. If that write fails, the job's synced outcomes turn into failures so the job retries.
- **Writer (legacy):** `src/services/sheetSync/sheetSyncPersistence.ts:syncAndStore` L40–L52.
- **Precedence:** the last plan of a document in a drain wins (`persistDocSheetSync` L430–L436).
- **Idempotency:** a replay recomputes the same entries from the live row map.
- **Effects:** no EntityChange, no `domain_revision` bump, no Outreach or Daily Operations effect.
- **Readers:** the planner's row hints, `getDeleteTargets`, tombstone snapshots, `hasSyncedCallsRow` in the Form→Call sibling mirror ([granot-effects.md](granot-effects.md)), and Admin Sheet contains (`src/services/googleSheets/sheetContains.ts`).
- An entry is removed only when its target's delete succeeds in a drain. Until a Lead is re-delivered, its entries describe its last delivery, which may be under older routing. Before the November 20 cleanup, 592 Bad Forms still listed `Forms` and `Bad Leads`.

## Lifecycle transitions and their Sheet consequence

Each row is what the next delivery does once the flag is saved. The owning page says which command saves the flag and whether it queues the delivery.

| Transition | Upserted | Stale row removed | Notes |
|---|---|---|---|
| Form becomes a duplicate | Duplicate Forms | Bad Form Leads only | The Forms row stays (intentional). |
| Form stops being a duplicate | Forms | Bad Form Leads only | The Duplicate Forms row stays. |
| Form becomes Bad | Bad Form Leads | Forms and Duplicate Forms, after the upsert succeeds | — |
| Bad Form reversed (`bad_lead` cleared, no trusted review) | Forms or Duplicate Forms | Bad Form Leads, legacy `Bad Leads` | — |
| Call gains `form_fill` | Duplicate Calls | Calls, Bad Call Leads | Not billable from then on. |
| Call loses `form_fill` (no other duplicate reason) | Calls or Bad Call Leads | the other two | Billable again if it lands on Calls. |
| Call becomes a 90-day repeat (`duplicate: true`) | Duplicate Calls | Calls, Bad Call Leads | — |
| Overnight missed final result recorded (`recordRingCentralFinalCallLogResult` queues `source_lead`, `src/services/domainCommands/ringcentralFinalResult.ts` L150–L153) | Bad Call Leads, unless a duplicate reason holds | Calls, Duplicate Calls | Production had zero overnight-missed Bad Calls on November 20; all 19 Bad Call Leads rows are external reviews. |
| Booked, cancelled, re-booked | the same tab; the Booked, Booked Date and Cancelled cells change. The chain jobs upsert the Booked Deals and Cancelled Deals rows. | none on Master Leads | A Booking deletion tombstones its Booked Deals row and its Cancellation's row. |
| Job linked or changed (Granot) | the same tab; the Job No cell changes (Call tabs only; Form tabs have no Job No cell) | none | — |
| Granot priority 5 | the same tab; there is no priority cell | none | Booked state comes only from a Booking (`confirmGranotBooking`). |
| Lead deleted | — | every tab of its type (tombstone) | — |
| Duplicate repair (same Mongo ID on two rows of one tab) | the first row | the extra rows | Only after a successful upsert. |
| No-Sync set / cleared | none / its routed tab | every tab / none | — |

## Production populations, November 20

Read-only scans: the coordinator's tab scan at 12:38:49 New York and reconciliation at 12:44:45 New York, plus R4 reads at 12:49–12:50 New York. Mongo IDs only; no contact data.

| Population | Count | Mechanism from code |
|---|---:|---|
| Excluded Calls with rows | 209 (203 Calls, 6 Duplicate Calls) | Written before `6febe214`; excluded Calls plan nothing since. See [above](#excluded-leads-and-their-existing-rows). |
| Bad Forms also on Forms | 592 at 12:38; 0 after 13:01 | See [The November 3 Bad Form transition and the November 20 cleanup](#the-november-3-bad-form-transition-and-the-november-20-cleanup). |
| Non-Bad Forms only on Bad Form Leads | 5 | No `bad_lead` write appears in their history, and their `sheet_sync` lists only Forms. No code path writes a non-Bad Form to Bad Form Leads, so the rows were most likely moved by hand. The next delivery would append a Forms row and delete the Bad Form Leads row (or clear its managed cells if it carries operator content). |
| Non-duplicate Form on Duplicate Forms | 1 | A `legacy_unknown` Form. Its October 14 re-delivery left the Duplicate Forms row in place, as the asymmetry above predicts. |
| Form Fill Call on Calls | 1 | A June 12 `legacy_unknown` Call last delivered July 6. Before November 3 Calls routed by `duplicate` only, so Form Fill Calls went to Calls. It has had no intent since. The next delivery would move it to Duplicate Calls. |
| Planner skips | 210 `missing_call_qualification`, 2 `created_on_unmatched`, 1 Form `no_sync` | Expected to have no row. |
| Billable Calls and Form Fill Calls missing from their tab | 55 + 4 | `sheet_sync` says synced, and the row was removed by hand. Sheet Sync re-appends it on the Lead's next intent. |
| Booked Deals and Cancelled Deals gaps | 3 cancelled Bookings absent from Booked Deals; 4 August 20 Cancellations absent from Cancelled Deals; 1 Booked Deals row whose Mongo ID is in no collection | Code expects a cancelled Booking on Booked Deals **and** its Cancellation on Cancelled Deals. Only a tombstone removes either row. An absent row was therefore never delivered or was removed by hand, and a row with no record belongs to a record deleted outside the canonical delete path or before the outbox existed. The coordinator owns the per-record explanation. |
| Cancelled Deals rows whose Lead is gone | 25 | A Cancellation keeps `lead_ref` after its Lead is deleted, and its row is still expected. |

### The November 3 Bad Form transition and the November 20 cleanup

**Before November 3.** Until `6febe214` (November 3, 2026, 15:54 New York) a Bad Form was written to **both** its primary tab (Forms or Duplicates) and the old `Bad Leads` tab. The old planner upserted the primary, then also upserted `Bad Leads` when `bad_lead` was set, and deleted the `Bad Leads` row only when `bad_lead` was cleared (`git show 6febe214^:src/services/sheetSync/drainer/jobPlanner.ts` L192–L229). Dual membership was the designed behavior.

**November 3.** `6febe214` made Bad Form Leads exclusive: the current planner upserts Bad Form Leads and then removes the Forms and Duplicate Forms rows (`leadReportingTargets.ts:formLeadTargets` L32–L39, `staleFormTargetKeys` L42–L46). The same release renamed the tabs by numeric sheet ID, so both old rows of every Bad Form survived. No backfill re-delivered the existing Bad Forms. Each one kept its Forms row until a new intent for that Lead ran the new plan.

**State before the cleanup** (R4 read at 12:49 New York, November 20). 592 Bad Forms had a row on both Forms and Bad Form Leads. All 592 listed `Forms` and `Bad Leads` in `sheet_sync`, last synced on or before 2026-10-30. 417 had their last `sheet_sync_jobs` job before November 3, and the rest had no job on record.

**Cleanup, November 20, 12:48–13:01 New York (Owner-directed, run by the session coordinator).** An operator script queued one ordinary `source_lead` job per Lead, with operation `bad_form_primary_cleanup` and `created_by: "script"`, for the 592 Bad Forms that still had a Forms row. None was booked or cancelled. The drainer ran the ordinary re-delivery plan described above: upsert Bad Form Leads, then remove the Forms row after the upsert succeeded. The script wrote no Lead field. Only Sheet Sync's own `sheet_sync` metadata changed.

- All 592 jobs synced. Every Forms row was removed, and each Lead is on Bad Form Leads exactly once.
- Forms went from 8,406 to 7,814 rows. Bad Form Leads stayed at 1,040 rows.
- A repeat dry run found 0 remaining.
- Evidence (script and JSON): `vantage-main-server/.tmp/bad-form-cleanup-2026-11-20/` in the main checkout. That folder is not in the repository.
- `bad_form_primary_cleanup` is an operation label on the job only. No code path branches on it, because the planner ignores the operation name.

## Worked examples

| Tab | Example |
|---|---|
| Forms | [form-leads.md](form-leads.md) |
| Duplicate Forms | [form-leads.md](form-leads.md) |
| Bad Form Leads | [form-leads.md](form-leads.md), [bad-leads.md](bad-leads.md) |
| Calls | [Example A](#example-a-a-billable-call-on-calls) below |
| Duplicate Calls (Form Fill, then the Form's job) | [duplicates-and-form-fill.md](duplicates-and-form-fill.md); the Owner's reference Call `6ae907f26f28ecf54e7aff42` |
| Duplicate Calls (90-day repeat) | [duplicates-and-form-fill.md](duplicates-and-form-fill.md) |
| Bad Call Leads (overnight missed) | [bad-leads.md](bad-leads.md) |
| Booked Deals (Leadless Booking) | [bookings-and-cancellations.md](bookings-and-cancellations.md) |
| Cancelled Deals | [Example B](#example-b-a-cancellation-on-cancelled-deals) below |

### Example A: a billable Call on Calls

Read-only production read at 12:50 New York on November 20. Customer A, phone `+1555555xxxx`.

1. **Minting.** The RingCentral inbound queue saw a call to the TBM Prime inbound target that started at 14:13:28 UTC on 2026-11-15 (09:13 New York) and lasted 1,013.37 s. `createCallLead` ran at 15:00:17 UTC (revision 1) with `ringcentral.ingestion_source: "call_log_sync"`, `qualification_reason: "call_log_inbound_target_elapsed_at_least_120s"`, feed `tbm_prime_leads_call`, `ingestion_origin: "ringcentral"`, `duplicate: false`, `form_fill: false`, `no_sync: false`, a stamped `cpl` of 205 and `cpl_resolution_status: "resolved"`. The call log was already final, so `final_result: "Accepted"` with `final_result_answered: true` arrived with creation.
2. **Decision.** Admitted by queue qualification; not Unmatched, not a duplicate, no Form Fill, no review, not missed. Disposition `calls`, billable.
3. **Sheet.** Job `call_lead.create` (`source_lead`) synced at 15:00:17.5 UTC and appended the row to Calls.
4. **Granot.** `synchronizeLeadFromGranot` at 15:30:46 UTC (revision 2) wrote the Job Number, `granot_priority: "5"` and the receiver (`receiver_agent_source: "granot_username_match"`). Job `call_lead.update` rewrote the same Calls row in place, filling the Job No and Sales Rep cells.
5. **Booking.** `confirmGranotBooking` at 13:18:23 UTC on 2026-11-16 created the Booking and set `booked` on the Call (revision 3). The Booking's row is on Booked Deals. The Calls row's Booked and Booked Date cells changed, and the Call stayed on Calls.
6. **Repair.** A `sheet_phone_text_repair` job synced at 15:52:53 UTC on 2026-11-20 and rewrote the row with a text phone cell. `sheet_sync` holds one entry: `master_calls`, tab `Calls`, `status: "synced"`.
7. **Money.** Insights prices it at the feed's CPL for business day 2026-11-15. Legacy Analytics sums the stamped 205.

### Example B: a Cancellation on Cancelled Deals

Read-only production read at 12:50 New York on November 20. Customer B.

1. **Form Lead.** `createFormLead` at 07:18:50 UTC on 2026-10-12, feed `tbm_leads_form`, `ingestion_origin: "wordpress_form"`, `duplicate: false`. Forms row.
2. **Granot and receiver.** `synchronizeLeadFromGranot` set the Job Number at 07:20:46 UTC. `fillReceiverFromRepCall` set the receiver at 14:36:20 UTC. Later Granot syncs set priority and move facts. Each re-delivered the Forms row in place.
3. **Booking.** `confirmGranotBooking` at 17:13:26 UTC on 2026-10-16 created the Booking (revision 1) and set `booked` on the Form (revision 7). The Booking Chain wrote the Booked Deals row and rewrote the Forms row with `booked`.
4. **Cancellation.** `createCancellation` at 16:43:24 UTC on 2026-11-01 created the Cancellation (cancel date 2026-10-20) and set `cancelled` on the Booking (revision 2) and on the Form (revision 8). The Cancellation Chain rewrote the Booked Deals row with `cancelled`, rewrote the Forms row with `cancelled` (last synced 16:45:05 UTC), and appended Cancelled Deals row 48.
5. **Result.** The Form stays on Forms. The Booking stays on Booked Deals, marked cancelled. The Cancellation is on Cancelled Deals. Nothing was removed.

## Tests that encode these rules

All ran offline at `9955430d`: 110 tests across 18 files, 108 pass, 2 skip (the loopback-Mongo agreement tests).

- `src/services/leads/callLeadReportingDisposition.test.ts`: the overnight clock and DST, precedence, No-Sync billing, checker mapping.
- `src/services/leads/callLeadAdmission.test.ts`: the 69-ID inventory, forged and ISO-string stamps, queue qualification for any source.
- `src/services/googleSheets/leadReportingTargets.test.ts`, `expectedSheetTabs.test.ts`: planner and contains agree; Bad Form exclusivity; Booked and Cancelled targets.
- `src/services/sheetSync/drainer/jobPlanner.test.ts`: the Form duplicate asymmetry, Bad Form moves, No-Sync deletes, the Unmatched empty plan, tombstone fan-out.
- `src/services/sheetSync/drainer/drainer.test.ts`, `deliveryRecovery.test.ts`, `deliveryRequests.test.ts`, `metadataPersistence.test.ts`: delete fencing, duplicate-row repair, operator content, formula phones, metadata.
- `src/services/googleSheets/projections/projections.test.ts`: row shapes and `textCell`.
- `src/services/insights/insights.test.ts`: Bad Calls are zero-cost and duplicates $0 in Insights.

**Gaps:** no test pins that an excluded Call's existing row is left in place (only that its plan is empty). No test covers header refusal (`sheet_identity_header_rewrite_unsafe`), formula escaping of the Form Name and Email cells, or the re-append of a hand-removed row on the next intent.
