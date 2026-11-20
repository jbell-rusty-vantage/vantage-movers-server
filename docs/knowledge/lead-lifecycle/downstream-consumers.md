---
okf_version: "0.2"
type: Reference
title: Lead lifecycle downstream consumers
description: What each Form Lead and Call Lead lifecycle state means to the Sales Outreach Desk, Pool, Daily Operations, Insights and Analytics lead spend, the Numbers Lead link and the Job Number timeline, as coded at main 9955430d.
tags: [lead-lifecycle, form-lead, call-lead, sales-outreach, daily-operations, insights, cpl]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/salesOutreach/subjects/**
  - src/services/salesOutreach/pool/**
  - src/services/salesOutreach/commands/assignment.ts
  - src/services/salesOutreach/commands/store.ts
  - src/services/salesOutreach/contacts/receiverFill.ts
  - src/services/salesOutreach/contacts/mongoStore.ts
  - src/services/salesOutreach/reads/repMetrics.ts
  - src/services/dailyOperations/**
  - src/services/insights/**
  - src/services/analytics/**
  - src/services/numberActivity/leadLink.ts
  - src/services/numberActivity/leadLinkJobs.ts
  - src/services/numberActivity/leadContactNumber.ts
  - src/services/numberActivity/allNumbers.ts
  - src/services/salesIntelligence/repIdentity/accounts.ts
  - src/services/jobNumberTimeline/**
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/salesOutreach/subjects/eligibility.ts
  - id: insights
    resource: src/services/insights/facts.ts
  - id: daily-operations
    resource: src/services/dailyOperations/recordDomainFacts.ts
  - id: lead-link
    resource: src/services/numberActivity/leadLink.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Lead lifecycle downstream consumers

This page says what each Lead lifecycle state means to the systems that read Leads after they are minted. It covers the Sales Outreach Desk, Pool, Daily Operations, Insights and Analytics lead spend, the Numbers Lead link and the Job Number timeline. The Master Sheets routing is in [reporting-and-sheets.md](reporting-and-sheets.md). Minting is in [form-leads.md](form-leads.md) and [call-leads.md](call-leads.md).

All line ranges are at `main` = `9955430d`. Production reads were read-only on November 20, 2026, between 12:46 and 12:57 New York.

**The main rule.** None of these consumers decides a Lead's state. Each one reads the flags that the Lead commands wrote. Most of them do not use the Master Sheets disposition (`getCallLeadReportingDecision`). Only Insights, the Analytics lead cost and the receiver report do. So a Call Lead that the Sheets treat as Duplicate Calls or Bad Call Leads can still be a working Desk subject. That is intended for Form Fill, and it is a [finding](#findings) for unqualified Calls.

## Summary by state

"Desk" is `evaluateDeskEligibility`. "Insights" is the live-priced Insights lead fact. "Daily Ops" is the live creation fact and the day rebuild. "Numbers" is the Lead link candidate set.

### Form Leads

| Form state | Desk | Pool | Daily Ops | Insights lead spend | Legacy Analytics lead cost | Numbers lead link |
|---|---|---|---|---|---|---|
| Normal Form | Eligible. A Form with no job keeps its cadence. | Eligible only with accepted Granot priority 9 and every Pool check | `form_lead.created`; counts in `leads.form`, `leads.total` | Billable, priced at the feed's live CPL for the New York day | Counted at stamped `cpl` | Candidate; mints a Contact Number when `FORM_LEAD_NUMBERS` is on |
| Duplicate Form (`duplicate: true`) | Excluded (`duplicate`). An existing subject goes to `review` and owes nothing. | Refused | `form_lead.duplicate` if duplicate at creation; counts in `leads.duplicate_form` only | Not billable, $0, status `duplicate` | Excluded | Not a candidate; never mints; an Owner pin is refused |
| Bad Form (`bad_lead` set) | Closed (`bad_lead`), permanently | Refused | No separate kind. Counted as `form_lead.created` and in `leads.form` | **Billable, priced at full live CPL** (see [finding F3](#findings)) | Counted at stamped `cpl` | Not a candidate; never mints. An Owner pin is allowed. |
| Bad Form by trusted external review only (`external_sheet_review.kind = bad_form`, no `bad_lead`) | Not read: eligible | Not read | Not read | Not read: billable and priced | Not read | Candidate |
| No-Sync Form (`no_sync: true`) | Not read: eligible | Not read | Not read: counted normally | Not read: billable and priced | Not read: counted | Not read: candidate |
| Booked Form (`booked` set) | Closed (`official_booking`) | Refused (`official_booking`) | Booking facts are separate (`booking.*`) | Billable; the booking feeds the cohort | Counted | Candidate; snapshot `state: booked` |
| Cancelled Form (`cancelled` set) | Closed (`official_cancellation`), unless `booked` closed it first | Refused | `cancellation.created` from the cancellation command | Billable; the cancellation feeds the refund metrics | Counted | Candidate; snapshot `state: cancelled` |

### Call Leads

| Call state (Sheets disposition) | Desk | Pool | Daily Ops | Insights lead spend | Legacy Analytics lead cost | Numbers lead link |
|---|---|---|---|---|---|---|
| Calls (qualified, billable) | Eligible once it has a Job Number; excluded `job_number_pending` until then | Eligible only with priority 9 and every Pool check | `call_lead.created`; counts in `leads.call`, `leads.total` | Billable, live CPL | Counted at stamped `cpl` | Candidate; a Call always mints its Contact Number |
| Duplicate Calls by the 90-day repeat (`duplicate: true`) | Excluded (`duplicate`) | Refused | `call_lead.duplicate` if duplicate at creation; `leads.duplicate_call` only | Not billable, $0 `duplicate` | Excluded | Not a candidate; never mints |
| Duplicate Calls by Form Fill (`form_fill: true`) | **Not read: eligible** (Owner design) | Not read | **Counted as `call_lead.created`** in `leads.call` | Not billable, $0 `duplicate` | Excluded | Candidate |
| Duplicate Calls by trusted external review (`duplicate_call`) | Not read: eligible | Not read | Not read | Not billable, $0 `duplicate` | Excluded | Candidate |
| Bad Call Leads (external `bad_call`, or overnight missed) | **Not read: eligible.** Calls carry no `bad_lead`. | Not read | Not read: counted in `leads.call` | Not billable, $0 `nonbillable`; counted in `bad_calls` | Excluded | Candidate; mints |
| Call with `granot_form_sibling` (job mirrored from its Form) | Excluded (`form_lead_holds_job`); the Form's subject is the one cadence | Not a second job holder | Not read | Not read (priced by its own disposition) | Not read | Candidate |
| Excluded: no RingCentral qualification and no preserved admission | **Not read: eligible if it has a job** (see [finding F1](#findings)) | Not read | Rebuild counts it in `leads.call` (see [finding F2](#findings)) | Not a fact (filtered before pricing) | Excluded | Candidate; mints |
| Excluded: `created_on_unmatched` (Unmatched Call Lead) | Excluded (`unmatched_booking_anchor`) | Refused | `call_lead.unmatched`; `leads.unmatched_call` only | Not a fact | Excluded | Candidate |
| No-Sync Call | Not read | Not read | Not read | Billing follows its disposition | Billing follows its disposition | Not read |
| Booked / cancelled Call | Closed (`official_booking` / `official_cancellation`) | Refused | `booking.*` / `cancellation.*` facts | Billing follows its disposition | Follows its disposition | Candidate; snapshot state |

## Sales Outreach Desk

### Eligibility (P05h)

**Rule D1 — desk eligibility.** `evaluateDeskEligibility` returns the first matching outcome, in this order:

1. `closed: official_booking` when `booked` is set.
2. `closed: official_cancellation` when `cancelled` is set.
3. `closed: bad_lead` when `bad_lead` is a non-empty string. Only Form Leads carry it.
4. `excluded: duplicate` when `duplicate === true`. This covers Duplicate Forms and the 90-day repeat Call.
5. `excluded: unmatched_booking_anchor` for a Call Lead with `created_on_unmatched`.
6. `excluded: form_lead_holds_job` for a Call Lead with `granot_form_sibling.form_lead_id`.
7. `excluded: job_number_pending` for a Call Lead with neither `normalized_job_no` nor `job_no`.
8. `review: legacy_closed_reopening_required` when the loader marks a legacy closure. Today nothing sets it.
9. Otherwise `eligible`.

`no_sync` and `form_fill` are not read. The Desk projection (`DESK_LEAD_PROJECTION`) loads only `ringcentral.original_caller.normalized_phone_number` from `ringcentral`, as a phone fallback (`leadFacts.ts` L79). It loads no qualification or admission field, and not `external_call_admission` or `external_sheet_review`. So RingCentral qualification, the Bad Call dispositions and the external review never reach the Desk.

| | |
|---|---|
| Source | `src/services/salesOutreach/subjects/eligibility.ts:evaluateDeskEligibility` L39–L53, `hasJobNumber` L55; `src/services/salesOutreach/subjects/leadFacts.ts:DESK_LEAD_PROJECTION` L56–L86, `toDeskLeadFacts` L101–L134 |
| Precedence | Closures beat exclusions. Exclusions beat review. A closed subject never reopens (`subjectStatusOf` L210–L236). |
| Time window | None. Current facts only. |
| Idempotency | Pure function of the Lead's current facts. |
| Effects | Sheet: none. Outreach: decides subject status and periods (below). Daily Operations: none. EntityChange: none (the Desk never writes EntityChange). |

**What exclusion does to an existing subject.** `desiredPeriodOf` still plans a period from the priority decision, but `subjectStatusOf` adds the exclusion reason and sets `status: review`. A `review` subject owes no routine work. So a Form that becomes a duplicate, or a Call that gets `granot_form_sibling` or loses its job, keeps its subject in `review` with that reason. A closure (`booked`, `cancelled`, `bad_lead`) opens a `closed` period with `transition_key` `closure:<reason>:<ref>`, and the subject stays closed forever.

| | |
|---|---|
| Source | `src/services/salesOutreach/subjects/subjectBuilder.ts:desiredPeriodOf` L136–L177, `subjectStatusOf` L210–L236 |
| Precedence | `current_status: closed` wins over everything. |
| Idempotency | The closure transition key is deterministic per closure reference, so a replay opens nothing new. |
| Effects | Outreach only. |

### Admission: intake and expansion

**Rule D2 — intake (`kind: intake`).** A Lead that is not yet a subject is admitted once by its creation job when all of these hold:

- It is not import-suppressed. `outreach_automation_suppressed` is set on Best Relocation final-import Leads. The suppression lifts only after a later accepted Granot observation (`isImportOutreachSuppressed`).
- The intake gate is on and the Lead was created after `transition.intake_admission_at`.
- `ingestion_origin` is not `legacy_import` or `legacy_unknown`.
- Its received time is not before the gate. A missing or unreliable received time does not refuse; the subject is admitted held.
- It is `eligible` under Rule D1, the priority policy is available, and the priority is not a closed workflow.

Refusals are stored as the job result, for example `excluded:job_number_pending` or `historical_import`.

**Rule D3 — expansion (`kind: expansion`, cohort `admission:<New York date>`).** A later change to a non-subject Lead that wrote an admission decision path nominates an `admission` job, only while `transition.expansion_admission_enabled` is on and the migration is not paused. The decision paths are `granot_priority`, `last_accepted_granot_observation`, `duplicate`, `booked`, `cancelled`, `bad_lead`, `created_on_unmatched`, `timestamp`, `normalized_job_no`, `move_date`, `ingestion_origin`, `lead_source_company` and `source_granularity_id`. The job admits the Lead when the enrollment classifier puts it `in_scope` under the backfill scope. A Lead created after the intake gate is deferred to intake until its creation job settles.

| | |
|---|---|
| Source | `src/services/salesOutreach/subjects/sync.ts:intakeAdmissionOf` L365–L399 (`HISTORICAL_ORIGINS` L363), `expansionAdmissionOf` L442–L472, `admissionHoldOf` L281–L294; `src/services/salesOutreach/subjects/importAdmission.ts:isImportOutreachSuppressed` L9–L15; `src/services/salesOutreach/subjects/feed.ts:ADMISSION_DECISION_PATHS` L147–L161, `nominateLeadChanges` L215–L243; `src/services/salesOutreach/enrollment/classify.ts:classifyEnrollmentCandidate` L62–L101 |
| Precedence | Import suppression, then the intake gate, then legacy origin, then eligibility. Expansion never runs intake. |
| Time window | Intake: created after `intake_admission_at` (UTC instant from configuration). Expansion: the backfill scope's lookback or an upcoming move. Cohort date is the America/New_York business day of the admission. |
| Idempotency | Job dedupe keys `sod:lead-change:<model>:<id>:r<revision>` (intake and ordinary refresh) and `…:admission:r<revision>` (expansion). One subject per Lead. |
| Effects | Outreach: creates the subject and its first period, requests evaluation, may nominate `outreach_contact_change` re-derive work. Sheet, Daily Operations, EntityChange: none. |

**Measured, 12:47 New York.** 489 Call Lead subjects (129 active, 150 review, 210 closed). Every one whose Call still exists has saved RingCentral queue qualification, including 36 whose Call has `ingestion_origin: legacy_unknown`. One active subject points at a Call Lead that no longer exists. So no unqualified Call is a Desk subject today. Form Lead subjects: 1,741 active, 1,624 closed.

### The Lead-change feed and the revision reconcile

**Rule D4 — Lead-change tail.** The `sales-outreach-lead-changes` cron (every minute) reads `entity_changes` for Form and Call Leads by `(applied_at, _id)`, with a 2-minute overlap re-scan. It nominates an `outreach_lead_change` job for:

- every change of a Lead that is already a subject;
- a creation (`revision_before === 0` and a create command or no command name) while the intake gate is open;
- a decision-path change of a non-subject Lead while expansion (`admission`) or Pool admission is open.

A `mirrorFormLeadToCallSibling` change on a Call that touches `granot_form_sibling` also nominates a `related_form` job for the Form Lead (`sod:lead-change:FormLead:<form>:related:CallLead:<call>:change:<change>`). That job only refreshes an existing open Form subject. The job reads the Lead as it is now, so an old revision's job is a no-op.

**Rule D5 — revision reconcile.** The `sales-outreach-revision-reconcile` cron (every 5 minutes) pages open subjects (up to 50 pages of 100). When the Lead's `domain_revision` differs from `lead_revision_seen`, it nominates the ordinary job. When the decision fingerprint differs, it nominates a decision job (capped per run, default 300). A subject held for `ambiguous_identity` gets a hold re-check once per 15-minute UTC bucket. This is the net for any Lead write that bumped `domain_revision` without an EntityChange. It does not cover Leads that are not subjects.

| | |
|---|---|
| Source | `src/services/salesOutreach/subjects/feed.ts:leadChangeJobInput` L86–L94, `relatedFormJobInput` L96–L104, `touchesFormSibling` L106–L108, `nominateLeadChanges` L215–L243, `runTailPass` L459–L502, `scanOutreachLeadChangesUntilCaughtUp` L532–L588, `reconcileOutreachRevisions` L630–L708; `src/services/salesOutreach/subjects/leadChangeJob.ts:triggerOfJob` L41, `refreshLeadForOutreach` L53–L86, `runOutreachLeadChangeJob` L106–L152 |
| Precedence | An existing subject is always refreshed; admission paths apply only to non-subjects. |
| Time window | Tail: no window, cursor plus 120 s overlap. Reconcile: every 5 minutes; hold buckets are 15-minute UTC buckets. |
| Idempotency | One job identity per Lead revision; overlap and replays dedupe on `dedupe_key`. |
| Effects | Outreach only. The Desk never writes the Lead or an EntityChange in these paths. |

### Receiver writes from the Desk

**Rule D6 — `sales_outreach_assignment` (Owner or Manager reassignment).** `PATCH /api/v1/sales-outreach/outreach/:id/assignment` runs `assignSubject`. It refuses a Rep, a closed subject, a stale `expected_revision` and a stale Desk copy (`assignment_changed`, after refreshing the subject). The target must be an Agent with a reviewed `sales_rep` link, or `null` to unassign. It writes the Lead through `LeadChangeRecorder` with command name `sales_outreach_assignment`:

- assign: `$set receiver_agent`, `receiver_agent_name_snapshot`, `receiver_agent_source: "manual"`, `receiver_agent_source_value: "sales_outreach_desk:<role>"`, `receiver_agent_set_at`, `updatedAt`;
- unassign: `$set receiver_agent_source: "manual"`, `receiver_agent_source_value`, `receiver_agent_set_at`, `updatedAt`; `$unset receiver_agent`, `receiver_agent_name_snapshot`.

A `manual` receiver is never replaced by Granot latest-wins. The same transaction updates the subject's assignment, appends the CSI audit row and enqueues the lead-change and evaluation jobs.

| | |
|---|---|
| Source | `src/services/salesOutreach/commands/assignment.ts:assignSubject` L123–L220, `deskAssignmentContext` L96–L108; `src/services/salesOutreach/commands/store.ts:writeLeadAssignment` L158–L186; route `src/routes/sales-outreach.routes.ts` L397–L410 |
| Precedence | `manual` beats Granot and call-inferred receivers. Same Agent with `manual` already set is a no-op. |
| Time window | None. |
| Idempotency | CSI command ledger: `idempotency_key` `sales-outreach:<role>:<actor>:<key>`, command id = SHA-256 of role, actor and key. Lead `domain_revision` CAS through `LeadChangeRecorder`. |
| Effects | EntityChange on the Lead (`receiver_agent*` paths). Outreach: lead-change job `…:r<revision>` and evaluation job `…:assignment:l<revision>`; live stream publish. **Sheet: none.** No Sheet Sync intent is written, so the "Sales Rep" cell (`receiver_agent_name_snapshot`) stays stale until the next delivery of that Lead (see [finding F5](#findings)). Daily Operations: none. |

Production: zero `sales_outreach_assignment` EntityChanges and one `manual` receiver on each Lead model at 12:46 New York.

**Rule D7 — `fillReceiverFromRepCall` (call-inferred receiver).** When contact derivation (`outreach_contact_change`) finds a confirmed or awaiting-confirmation `inbound_answered` call by a reviewed rep, uniquely associated with one Desk subject, and that subject is Unassigned and not in Pool, it writes the subject's Lead receiver through `writeReceiverAgent`: `receiver_agent`, `receiver_agent_name_snapshot`, `receiver_agent_source: "ringcentral_rep_call"`, `receiver_agent_set_at`, `receiver_agent_source_value` (the call interaction id). It only fills an empty receiver (`expected_receiver: null`). An outbound attempt never fills it.

| | |
|---|---|
| Source | `src/services/salesOutreach/contacts/receiverFill.ts:isRepCallOnSubject` L26–L35, `receiverFillCandidates` L38–L48; `src/services/salesOutreach/contacts/mongoStore.ts:writeRepCallReceivers` L153–L188; `src/services/leads/receiverAgentWrite.ts:writeReceiverAgent` L37–L66 |
| Precedence | Only an empty receiver. Granot's matching user later replaces the placeholder; `manual` wins over both. Pool membership blocks it. |
| Idempotency | Conditional update on `receiver_agent: null`; context key `ringcentral:receiver-rep-call:<lead>:<interaction>`; the latest qualifying call per subject (ties by larger source id). |
| Effects | EntityChange (`fillReceiverFromRepCall`); **Sheet: `source_lead` job enqueued** (`form_lead.update` / `call_lead.update`), so the Sales Rep cell updates in place on the Lead's current tab. Outreach: the subject feed re-syncs it. Daily Operations: none. |

Production: 124 Call and 606 Form EntityChanges, last on November 12 and November 19 (production `entity_changes` read, 2026-11-20 12:37 New York; see [COVERAGE.md](COVERAGE.md#production-command-names-read-only-2026-11-20-1237-new-york)).

The older receiver backfills `fillReceiverAgentFromAnsweredCall` (47 Call revisions, last October 4), `backfillReceiverAgent` (12 Call, 96 Form, September 25) and `backfillDeskReceiverFromGranot` (3 Call, 6 Form, October 5) have no code on `main`. They are historical-only records; the Desk and the Lead link read only their resulting `receiver_agent` values.

**Rule D8 — `account_agent` (Accounts connect, change or disconnect).** `POST /api/v1/admin/sales-intelligence/accounts/:extension_id/agent` writes `RepIdentityLink` rows, not Leads. In the same transaction it nominates Desk re-syncs for every open subject the old or new Agent receives or is assigned, and a `rep_sms_remap` job. It is **not a Lead lifecycle write**. It changes only which Lead receivers count as desk reps.

| | |
|---|---|
| Source | `src/services/salesIntelligence/repIdentity/accounts.ts:commandAccountAgent` L207–L307 |
| Idempotency | `accounts-agent:<account>:<extension>:<link id>:<revision>:<payload hash>` |
| Effects | Lead: none. Outreach: subject re-sync jobs. Sheet, Daily Operations, EntityChange on Leads: none. |

Production: 5 command executions, all on October 6.

### Other Desk readers

- **Rep metrics potential** counts a Lead when it is not a duplicate, not cancelled, not bad, not `created_on_unmatched`, and its priority is not 7, 8 or 9. Bookings and priority 5 still count. `src/services/salesOutreach/reads/repMetrics.ts:isPotentialMetricLead` L149–L151.
- **Ambiguous identity** counts only non-duplicate Leads per `normalized_job_no` (`loadSubjectPageContext` L35–L48, `hasAmbiguousIdentity` L51–L52).

## Pool

**Rule P1 — Pool candidate.** A Lead can enter shared Pool work only when every check passes, in this order:

1. The Lead exists and is `eligible` under Rule D1.
2. Its subject is not closed.
3. Its accepted Granot priority is `9` with an accepted observation.
4. It has `normalized_job_no`, `lead_source_company` and `source_granularity_id`, both active, and the feed's channel matches the Lead type (`form` or `call`).
5. Exactly one coherent active Granot Record Link anchors this Lead and source, not disputed and not booked.
6. No Booking points at the Lead or its job.
7. Exactly one identity holds the job: non-duplicate Forms plus non-duplicate Calls **without** `granot_form_sibling`.
8. The accepted observation and its synchronization decision agree (priority 9, valid, same job, live, completed), and the Granot CRM source policy routes this Lead type.

Automatic admission also needs `pool.admission_enabled`, and it skips import-suppressed Leads. `refreshPoolLead` runs inside every non-related `outreach_lead_change` job. When a member stops being a candidate, it exits with the refusal reason.

| | |
|---|---|
| Source | `src/services/salesOutreach/pool/admission.ts:inspectPoolCandidates` L64–L181, `activatePoolCandidate` L213–L223, `writePoolCandidate` L225–L254, `refreshPoolLead` L257–L273; `src/services/salesOutreach/pool/policy.ts:poolEnabled` L12 |
| Precedence | Desk eligibility first; then closure, priority, source, Record Link, Booking, identity, evidence, source policy. |
| Time window | Pool duty days on the configured America/New_York working calendar (`poolDutyWindow` L33–L50). |
| Idempotency | Membership row per Lead with `revision` CAS; episodes append; `lead_revision_seen` and `accepted_observation_id` decide whether anything changed. |
| Effects | Outreach (Pool work, subject sync, duty recompute, live invalidation). Lead, Sheet, Daily Operations, EntityChange: none. |

## Daily Operations

**Rule O1 — Lead creation facts.** Daily Operations records one fact when a Lead is created, after the creating transaction commits:

| Created Lead | Kind | Metric touches | Dedupe key |
|---|---|---|---|
| Form, not duplicate | `form_lead.created` | `leads.form`, `leads.total`, `hourly.leads`, plus origin and source company | `form_lead:<id>:created` |
| Form, duplicate at creation | `form_lead.duplicate` | `leads.duplicate_form` | `form_lead:<id>:duplicate` |
| Call, `created_on_unmatched` | `call_lead.unmatched` | `leads.unmatched_call` | `call_lead:<id>:unmatched` |
| Call, 90-day duplicate at creation | `call_lead.duplicate` | `leads.duplicate_call` | `call_lead:<id>:duplicate` |
| Call, otherwise (including Form Fill) | `call_lead.created` | `leads.call`, `leads.total`, `hourly.leads`, plus origin and source company | `call_lead:<id>:created` |

A ZIP that resolves no state adds `exception.zip_missing` (`exception:zip_missing:<model>:<id>`). Form Fill, bad, No-Sync and the Sheets disposition are not read. A Form reused by an existing-Lead path (`reusedExistingLead`) records nothing. The fact's day and hour are the America/New_York day and hour of the Lead's real arrival instant (`leadArrivalInstant`, the `leadInstant` rule).

Who emits:

- `createFormLead`: `completeFormLeadIngestion` (`src/services/leads/formLead.service.ts` L235–L312, call at L309).
- `createLeadFromGranot`: `granot.minted`, then the Form fact (`src/services/granotLifecycle/createLeadFromGranot.ts:createLeadFromGranot`, calls at L193 and L204).
- `createCallLead`: `completeCallLeadIngestion` (`src/services/leads/callLead.service.ts` L130–L145, call at L143).
- RingCentral adoption conflict: `exception.adoption_conflict` (`src/services/ringcentral/ringcentral-call-lead-ingest.service.ts` L269).

No fact is recorded when a Lead later becomes or stops being a duplicate, gets Form Fill, becomes bad, or is deleted.

| | |
|---|---|
| Source | `src/services/dailyOperations/recordDomainFacts.ts:recordFormLeadDailyOperationsFact` L174–L228, `recordCallLeadDailyOperationsFact` L230–L287; `src/services/dailyOperations/kinds.ts:DAILY_OPERATIONS_KIND_CATALOG` L57–L82; `src/services/dailyOperations/recordDailyOperationsFact.ts:recordDailyOperationsFact` L184–L248; `src/services/dailyOperations/leadDay.ts:leadArrivalInstant` L18–L22 |
| Precedence | Unmatched beats duplicate beats created. |
| Time window | The New York business day of the arrival instant. |
| Idempotency | Unique `dedupe_key`; a duplicate insert is a no-op. After-commit and never throws. The [review](../../operations/SERVICE-REVIEW-2026-11-20.md) notes facts are skipped on an idempotent command replay. |
| Effects | Daily Operations event and day counters only. |

**Rule O2 — Booking and Cancellation facts.** `booking.created` (or `booking.employee_pending`) with dedupe `booking:<id>:created`, and `cancellation.created` with `cancellation:<id>:created`. Emitters: `finalizeBookedLeadCreateAfterCommit` (`src/services/bookings/bookedLead.service.ts` L408, call L441), `runExistingCreateLeadlessBooking` L339 (call L381), `runExistingCreateReferralBooking` L411 (call L449), `runExistingCreateCancellation` L461 (call L541) in `src/services/domainCommands/existingWrites.ts`, `submitEmployeeBooking` (`src/services/employeeBookings/submitEmployeeBooking.service.ts` L344, L368), Granot `confirmBooking` (`src/services/granotLifecycle/bookingConfirmation.ts` L154) and `confirmCancellation` (`src/services/granotLifecycle/bookingOwnerCommands.ts` L197). Booking reconciliation records `intake.opened` / `intake.refreshed` (`src/services/granotLifecycle/bookingReconciliation.ts` L314). Detail is in [bookings-and-cancellations.md](bookings-and-cancellations.md).

**Rule O3 — day rebuild.** A rebuild of an open day scans Form and Call Leads by stored `timestamp` (widened by six hours), keeps rows whose arrival day is the day, and counts them with `applyLeadCounters`: unmatched Calls to `unmatched_call`; current `duplicate` Leads to `duplicate_form` / `duplicate_call`; every other Lead to `leads.total`, `leads.form` / `leads.call`, origin, source company and the hour. It reads only `duplicate` and `created_on_unmatched`. So a Lead whose `duplicate` flag changed after creation is counted differently by the live fact and by a rebuild, and an unqualified or Form Fill Call counts as a Call Lead.

| | |
|---|---|
| Source | `src/services/dailyOperations/rebuild.ts:applyLeadRows` L226–L252, `defaultAggregateOpenDay` L254–L359, `applyLeadCounters` L399–L438; `src/services/dailyOperations/leadDay.ts:leadTimestampScanRange` L29–L31 |
| Precedence | Unmatched, then duplicate, then counted. |
| Time window | America/New_York business day. |
| Idempotency | Day-revision CAS on replace. |
| Effects | Daily Operations day document only. |

**Rule O4 — day close and capacity snapshot.** `daily-operations-close` (hourly at :05) closes every open day before today in New York (`src/services/dailyOperations/closeDay.ts:closeDailyOperationsDay` L22–L35). `capacity-snapshot` (daily 08:45 UTC) records storage capacity. Neither reads or writes a Lead's lifecycle fields.

**Sheet Sync facts.** The drainer records `sheet_sync.completed` and `sheet_sync.failed` per job (dedupe `sheet_sync:<job>:<outcome>`). See [reporting-and-sheets.md](reporting-and-sheets.md).

## Insights and Analytics lead spend

### Insights (live CPL)

**Rule I1 — which Leads are lead facts.** `loadLeadFacts` reads every Form Lead in the timestamp scan, and only the Call Leads matching `reportingEligibleCallLeadFilter()` (saved RingCentral queue qualification, the closed 69-ID Best Relocation historical manifest, or the trusted final-import admission). `toLeadFact` then drops any Call whose `getCallLeadReportingDecision` is `excluded` (this also drops `created_on_unmatched`) and any Lead with no readable arrival day.

**Rule I2 — billable and price.**

- Call: `duplicate` = disposition `duplicate_calls` (90-day repeat, Form Fill or trusted external duplicate). `billable` = the decision's `billable`. `bad_call` = disposition `bad_call_leads`.
- Form: `duplicate` = `duplicate === true`. `billable = !duplicate`. **`bad_lead`, the external bad-Form review and `no_sync` are not read.** A Bad Form is billable at its feed's full live CPL.
- `priceLead`: not billable and not duplicate → `nonbillable` $0. No feed → `no_feed` $0. Duplicate → `duplicate` $0. Otherwise the one CPL period of the Lead's feed covering its New York business day → `priced`; none or overlapping → `unpriced` $0, still counted.

Every spend surface (Analytics, allocation cost per receiver, daily lead spend, Money spend) counts only `isBillableLeadFact` Leads and sums `price.amount`. Money spend also counts `duplicates` and `bad_calls` separately. The receiver for the allocation report is the Lead's `receiver_agent`.

| | |
|---|---|
| Source | `src/services/insights/facts.ts:LEAD_PROJECTION` L83–L104, `toLeadFact` L133–L160, `loadLeadFacts` L227–L242, `isBillableLeadFact` L310, `isBadCallLeadFact` L313; `src/services/insights/pricing.ts:priceForDay` L27–L31, `priceLead` L33–L42; `src/services/insights/otherReports.ts:buildAllocationReport` L141–L210, `buildLeadSpendDay` L214–L257, `buildMoneySpend` L290–L366; `src/services/insights/analyticsReport.ts:aggregateLeads` L62–L84 |
| Precedence | Excluded Calls never become facts. For Calls, duplicate wins over bad (the disposition's own precedence). Not billable wins over feed and price. |
| Time window | The Lead's America/New_York business day (`leadInstant`); CPL periods are inclusive-start, exclusive-end business dates, read live on every request. |
| Idempotency | Read-only. |
| Effects | None (read-only, raw collection reads). |

The stamped `Lead.cpl` and `cpl_resolution_status` are not read by Insights. They feed the legacy Analytics reports and the CPL correction job.

### Legacy Analytics (stamped CPL)

**Rule I3 — `getLeadCost` (the `/api/v1/admin/analytics/overview` lead cost).** Sums stamped `cpl` grouped by source company and feed.

- Forms: `duplicate ≠ true`. Bad and No-Sync Forms are included.
- Calls: `billableCallLeadFilter()` plus `created_on_unmatched ≠ true`. So only billable Calls: reporting-eligible, not unmatched, not 90-day duplicate, not Form Fill, not trusted external duplicate or bad, not overnight missed.
- A billable Lead with no stamped `cpl` is counted in `unresolved_count`.

**Rule I4 — receiver performance.** `getReceiverAgentPerformance` and its trend and source breakdown restrict Calls to `reportingEligibleCallLeadFilter()` and mark a Call billable with `billableCallLeadExpression()` and a stamped `cpl`. Forms are billable when `duplicate ≠ true` and `cpl` is stamped.

**Rule I5 — legacy summary counts.** `getSummary` (also used by the overview) counts **every** Form and Call Lead matching the date and source filters, with no duplicate, unmatched or reporting-eligibility filter. Its `call_leads`, `total_leads` and `booking_rate` therefore include unqualified and unmatched Calls (see [finding F2](#findings)). `sourcePerformance` and `geographicAnalytics` also use the unfiltered `leadMatchForQuery`.

| | |
|---|---|
| Source | `src/services/analytics/leadCost.service.ts:billableFormLeadMatch` L22–L32, `billableCallLeadMatch` L34–L44, `getLeadCost` L140–L153; `src/services/analytics/receiverAgentPerformance.service.ts:leadRowsForType` L82–L206; `src/services/analytics/summary.service.ts:getSummary` L12–L58; `src/services/analytics/analyticsFilters.ts:leadMatch` L91–L110 |
| Precedence | The shared Call filters decide; Forms use `duplicate` only. |
| Time window | The query's `timestamp` range as stored. |
| Idempotency | Read-only. |
| Effects | None. |

Production, 12:57 New York (approximate qualification test, read-only): 1,794 Call Leads with saved queue qualification, 52 with the final-import admission, 60 Best Relocation Calls without either (the historical manifest covers up to 69 IDs), 210 other Calls without qualification, and 2 Unmatched Call Leads. Forms: 8,181 normal, 598 bad, 264 duplicate, 1 No-Sync.

## Numbers Lead link

**Rule N1 — candidates.** A Contact Number's Lead link candidates are the Form and Call Leads whose indexed normalized phone paths equal the number, plus Call Leads whose `ringcentral.telephony_session_id` matches one of the number's newest 200 calls on the configured RingCentral account. A candidate must have `duplicate ≠ true`, an empty `bad_lead`, and must not be in the Owner's `lead_link.excluded`. Form Fill, `created_on_unmatched`, No-Sync, RingCentral qualification and the Bad Call dispositions are not read. So Form Fill Calls, Bad Call Leads, Unmatched Call Leads and unqualified Calls can all be a number's Lead.

**Rule N2 — which Lead.** Automatic: the newest candidate by `timestamp` (else `createdAt`), ties by id; up to 10 others. An Owner pin holds until a candidate arrives after `lead_link.set_at`. The snapshot copies `name`, `job_no`, `receiver_agent*` and `state` (`cancelled`, else `booked`, else `open`).

**Rule N3 — minting.** The `lead_link` job mints the Lead's Contact Number: a Call Lead always, a Form Lead only behind `FORM_LEAD_NUMBERS` or force. A duplicate or a Lead with `bad_lead` never mints (`duplicate` / `bad_lead` skip).

**Rule N4 — triggers.** A Lead EntityChange nominates the Lead's `lead_link` job when it is a creation, or it touched `phone_number`, `normalized_phone_number`, `ingested_contact_snapshot`, `granot_contact_snapshot`, `ringcentral`, `current_contact_provenance`, `duplicate`, `bad_lead`, `booked`, `cancelled`, `timestamp`, `name`, `job_no`, `normalized_job_no`, `receiver_agent` or `receiver_agent_name_snapshot`. Job recovery scans `entity_changes` every minute as the durable net.

**Rule N5 — `number_lead_link` (Owner pin or unlink).** `POST /api/v1/admin/sales-intelligence/numbers/:id/lead`. A pin accepts any non-duplicate Lead (a Bad Lead can be pinned) and removes it from `excluded`. An unlink adds the Lead to `excluded` and turns the link automatic when it was the number's Lead. Then it recomputes. It writes the `contact_numbers` row only (`lead`, `other_leads`, `lead_link`, `search_terms`, `revision`). **It is not a Lead lifecycle write.**

| | |
|---|---|
| Source | `src/services/numberActivity/leadLink.ts:leadState` L96–L98, `planLeadLink` L123–L151, `isEligible` L164, `loadLeadCandidates` L168–L198, `recomputeLeadLink` L259–L294; `src/services/numberActivity/leadContactNumber.ts:leadNumberE164s` L88–L94; `src/services/numberActivity/leadLinkJobs.ts:LEAD_LINK_PATHS` L42–L44, `changeTriggersLeadLink` L45–L47; `src/services/numberActivity/allNumbers.ts:commandNumberLead` L332–L379 |
| Precedence | Owner unlink beats automatic; Owner pin beats automatic until a newer candidate. Duplicate ends a pin. |
| Time window | None (newest by stored arrival). |
| Idempotency | `lead_link` job keyed by the Lead fingerprint; `number_lead_link` key `numbers-lead:<number>:<revision>:<payload hash>` with `revision` CAS. |
| Effects | Contact Number row; a change wakes the Desk (`outreach_lead_change` `…:link:<number>:r<revision>`). Lead, Sheet, Daily Operations, Lead EntityChange: none. |

Production: zero `number_lead_link` command executions retained at 12:46 New York.

## Job Number timeline

**Rule T1 — read-only, keyed by job.** `GET` on the admin timeline routes normalizes the typed Job Number and loads every row carrying an equivalent `normalized_job_no`: Granot observations (with transport evidence), Record Links, Bookings, booking and release cases and discrepancies, synchronization decisions and receipts, and the Leads they point at. It writes nothing.

**Rule T2 — which Lead the timeline follows.** The first that applies: the active Record Link's `lead_ref`; a Booking's `lead_ref` and `lead_model`; the newest applied or created synchronization decision target; else, for an older job with no Record Link, the single Form or Call Lead holding the job. When both a Form Lead and its sibling Call Lead hold the job and no Record Link exists, that last fallback finds two Leads and resolves none.

The timeline does not read the Sheets disposition, `form_fill`, `bad_lead` or the RingCentral qualification. It shows a RingCentral `source_received` event for processed calls with status `lead_created`, `lead_created_duplicate`, `lead_adopted` or `lead_adopted_duplicate`, carrying the processed call's `duplicate` value. Granot `createLeadFromGranot`, `synchronizeLeadFromGranot` and `updateSourceOwnedLead` changes that wrote `job_no` or `normalized_job_no` become job-number events.

| | |
|---|---|
| Source | `src/services/jobNumberTimeline/module.ts:createJobNumberTimelineModule` L16–L61; `src/services/jobNumberTimeline/mongo-evidence-loader.ts:findUniqueJobLead` L236–L243, `loadJobNumberTimelineRows` L245–L649; `src/services/jobNumberTimeline/assemble.ts:CREATE_COMMANDS` L33–L37, `UPDATE_COMMANDS` L38–L41, `QUALIFIED_PROCESSED_CALL_STATUSES` L44–L49, `resolveLead` L196–L236; route `src/routes/job-number-timeline-admin.routes.ts` |
| Precedence | Record Link, then Booking, then decision, then unique Lead. |
| Time window | None. |
| Idempotency | Read-only. |
| Effects | None. |

> Pending re-verification against the Track A merge (scheduled sibling catch-up / Record Link). Documented at 9955430d. Rule T2 and Pool check 5 depend on Record Link establishment.

## Entry points in this area

| Entry point | Schedule or route | Changes a Lead? |
|---|---|---|
| `/api/cron/sales-outreach-lead-changes` | every minute | No. Reads Leads; writes subjects, periods, Pool. |
| `/api/cron/sales-outreach-revision-reconcile` | every 5 minutes | No. Nominates jobs only. |
| `/api/cron/sales-outreach-evaluate` | every minute | No. |
| `/api/cron/sales-outreach-contact-events` and the `outreach_contact_change` queue stage | every minute | **Yes**: `fillReceiverFromRepCall` (Rule D7). |
| `PATCH /api/v1/sales-outreach/outreach/:id/assignment` | Owner or Manager | **Yes**: `sales_outreach_assignment` (Rule D6). |
| `POST /api/v1/admin/sales-intelligence/numbers/:id/lead` | Owner | No (Contact Number only). |
| `POST /api/v1/admin/sales-intelligence/accounts/:extension_id/agent` | Owner | No (rep identity only). |
| `/api/cron/sales-intelligence-job-recovery` and the `sales-intelligence-events` queue | every minute | Only through the `outreach_contact_change` stage (Rule D7). `lead_link` writes Contact Numbers. |
| `/api/cron/daily-operations-close` | hourly at :05 | No. |
| `/api/cron/capacity-snapshot` | 08:45 UTC daily | No. |
| `ops/sales-outreach/call-lead-form-siblings.ts` (`pnpm granot:call-lead-form-siblings --apply`) | operator | **Yes**: runs `mirrorFormLeadToCallSibling` per Form ([granot-effects.md](granot-effects.md)). |
| `ops/sales-outreach/call-leads-without-job.ts` | operator | No. Nominates Desk jobs. |
| `ops/sales-outreach/seed-synthetic-pilot.ts`, `ops/insights/seed-synthetic.ts` | test databases only | Insert synthetic Leads; refuse production. |

## Findings

These are also listed in [COVERAGE.md](COVERAGE.md#owner-directive-findings).

- **F1. The Desk does not read RingCentral qualification.** Owner directive, November 20: "only RingCentral-queue-qualified Call Leads get minted and take part in the lifecycle." `evaluateDeskEligibility` (eligibility.ts L39–L53) and `DESK_LEAD_PROJECTION` (leadFacts.ts L56–L86) never load a RingCentral qualification field or `external_call_admission` (the projection reads only the caller phone fallback from `ringcentral`). An unqualified Call with a job and a non-legacy origin could be admitted by expansion. Intake refuses only `legacy_import` and `legacy_unknown` origins (sync.ts L363, L377). Measured: no unqualified Call is a subject today.
- **F2. Unqualified Calls still count in some Call totals.** Owner directive, November 3: "only RingCentral inbound queue qualification may create a Call Lead or make it eligible for Calls reporting and lead billing." The Daily Operations rebuild counts every non-duplicate, matched Call in `leads.call` (rebuild.ts L399–L438). The legacy `getSummary` counts every Call Lead (summary.service.ts L15). Billing filters are correct in both places.
- **F3. Bad Forms are priced at full live CPL in Insights.** `toLeadFact` sets `billable = !duplicate` for Forms (facts.ts L139–L140). The legacy lead cost also includes them (leadCost.service.ts L22–L32). No locked directive says whether a Bad Form is billable. This is an Owner question.
- **F4. Bad Call Leads and Form Fill Calls remain working Desk subjects.** This follows the November 4 review: Form Fill is a reporting disposition, and an overnight missed call does not set `bad_lead`. Recorded so the Owner sees that "Bad Call Leads" means Sheets and billing only.
- **F5. A Desk reassignment does not refresh the Sheet row.** `writeLeadAssignment` (store.ts L158–L186) changes `receiver_agent_name_snapshot`, which is the "Sales Rep" column, but writes no Sheet Sync intent. `writeReceiverAgent` (receiverAgentWrite.ts L61–L64) does. The cell stays stale until the Lead's next delivery.
- **F6. Live and rebuilt Daily Operations counts can disagree** for a Lead whose `duplicate` flag changes after creation. The live fact is fixed at creation; the rebuild reads current flags.
