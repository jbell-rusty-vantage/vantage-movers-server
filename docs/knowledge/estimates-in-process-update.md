---
okf_version: "0.2"
type: Reference
title: Estimates in Process update cycle
description: Verified Follow-Up Estimates collection, canonical identity preview, durable 90-day refresh, receipt apply and freshness. Leads and Advertising remains available.
tags: [granot-lifecycle, sales-outreach-desk, automation]
status: draft
stale_after: 2027-01-13
resource: src/services/granotHttpCollector/
applies_to:
  - src/services/granotHttpCollector/index.ts
  - src/services/granotHttpCollector/estimatesInProcess.ts
  - src/services/granotHttpCollector/estimatesCollection.ts
  - src/services/granotHttpCollector/estimatesIdentityPlanning.ts
  - src/models/GranotEstimatesOpenDate.ts
  - src/services/granotHttpCollector/estimatesCron.ts
  - src/services/granotHttpCollector/runWorkflow.ts
  - src/services/granotHttpCollector/lifecycleStatement.ts
  - src/services/granotHttpCollector/formWorkflow.ts
  - src/routes/granot-automation.routes.ts
  - src/routes/granot-automation-cron.routes.ts
  - src/models/GranotAutomationRun.ts
  - src/services/granotLifecycle/leadDesiredState.ts
  - src/services/granotLifecycle/identity.ts
  - src/services/salesOutreach/subjects/feed.ts
  - src/services/salesOutreach/contacts/receiverFill.ts
  - src/services/salesOutreach/engine/evaluate.ts
owners: [team:main-server]
sources:
  - id: owner
    resource: granot-priorities-and-rep-desk.md
    title: Owner read and priority meanings, 13 October 2026
  - id: collector
    resource: services/granot-http-collector.md
    title: The Leads and Advertising automation this cycle leaves in place
  - id: apply
    resource: granot-lifecycle/automation-apply.md
    title: Receipt apply the new rows must enter
generated:
  by: process:owner-instructions
  at: 2026-10-13T18:10:00Z
---

# Estimates in Process update cycle

Owner request **13 October 2026**. Parse Granot **Estimates in Process → Follow-Up Estimates**, then update the matched lead and let outreach react. The running Leads & Advertising automation stays available for when that path is still needed.

This page is the build contract. The collector, the `estimates_in_process` operation, the New York hour cron, the priority 2 and 3 one-call-a-day workflow, and the stop on outbound-call assignment are in the code. Checked-in lifecycle effect flags stay off, and deployment changes are recorded separately in [release evidence](../granot-estimates-reliability/RELEASE.md). The proved read, the priority meanings, and the rep-desk presentation live in [granot-priorities-and-rep-desk.md](granot-priorities-and-rep-desk.md).

## Leave the other automation in place

`collectGranotReport` keeps walking Leads & Advertising: network login, user login, `mprep~repmenuwc`, the date filter, `adverlistwc` source links, then Booked Jobs and Follow Up Estimates **per source label**. `parseSection` keeps requiring headers `job_no` and `customer` and a numeric `no` column. `form_leads` and `call_leads` runs, the source catalog, run-groups, and `GRANOT_AUTOMATION_APPLY_ENABLED` stay on that path.

Estimates in Process is a second collector and a third run operation. It shares the login, the account lease, the statement sealer, and `applyAutomationPlanAction`. It does not grow a mode flag inside `collectGranotReport`. A copied session URL is not a substitute for that function.

| Stays | File |
| --- | --- |
| Leads & Advertising collect | `src/services/granotHttpCollector/index.ts` `collectGranotReport` |
| Source-report parser and the numeric `no` row rule | `parseSection` / `parseGranotSourceReport` |
| Form and Call planners | `formWorkflow.ts`, `planCallWorkflow` in `runWorkflow.ts` |
| Source catalog and Registry compatibility | `sourceCatalog.ts` |
| Admin create for `form_leads` and `call_leads`, which still require `source_ids` or `source_labels` | `granot-automation.routes.ts` |
| Existing collector, workflow, catalog, statement, and route tests | the files named in [granot-http-collector.md](services/granot-http-collector.md) |

Both collectors take the same account lease, `granot:automation:account`. One Granot login at a time.

## The cycle

Same pipeline the HTTP automation already uses. Preview matches and writes nothing. A sealed plan is checksum-locked. Owner approval selects actions. Each selected action becomes one `granot_http_automation` receipt and enters `claimAndProcessOrPoll`. The lead write is `synchronizeLeadFromGranot`.

```
collectEstimatesInProcess
  → verify scope, selectors, pagination and totals
  → canonical normalization + Registry policy + identity preview
  → seal complete statement and provider response time (schema v2, lead_snapshot_apply)
  → awaiting_approval
  → applyAutomationPlanAction
  → claimAndProcessOrPoll
  → synchronizeLeadFromGranot
  → EntityChange
  → sales-outreach lead-change feed
```

Apply still must not call `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`. Preview still creates no receipt. `syncCallLeadEnrichment` remains the CSV writer. This cycle does not send rows there.

Checked-in lifecycle defaults stay processing and shadow true, and all eight effect flags false. Tests may pass live gates as arguments the way the existing lifecycle replica tests do. The checked-in defaults stay off.

## Read

Reuse the two-page login already in `collectGranotReportOnce` (cookie jar plus the session id). After the user POST lands on `mv~mainmenuwc~{session}~LOGIN`, open Estimates in Process. Do not request `mprep` on this operation.

| Step | Request |
| --- | --- |
| Network Login | `GET /wc.dll?mp~NetLogonWc~VANTAGE`, then POST `LOGON_USER` and `PASSWORD`. Drop `SAVEPASS`. |
| User Login | POST `USERNAME`, `PASSWORD`, `LOGON=Login`. |
| Estimates form | `GET /wc.dll?mv~estprocesswc~{session}` |
| Follow-Up Estimates | POST `/wc.dll?mv~estprocessret~{session}` |

Set the posted names explicitly. A radio label that contains the word “to” must not be treated as the To date. That mistake posted a date into `STATUS` and returned All Estimates.

| Field | Value this cycle posts |
| --- | --- |
| `STATUS` | `V9` Follow-Up Estimates |
| `TYPEDTE` | `OPEN` Open Date. `from` / `to` on the run are `DATE1` / `DATE2`, real `MM/DD/YYYY`, `to >= from`. |
| `FUSTATUS` | `10` all priorities |
| `USER` | empty, all users |
| `DEPT` | `ALL` |
| `TYPE` | `V1` all move types |
| `SORT` | `V6` priority |

`STATUS=V15` (Today’s Recent 50 Estimates Priority 0) is a different query. This cycle does not post it. Booked Jobs on this form (`STATUS=V5` and the other booked radios) are a later slice. This cycle posts Follow-Up Estimates only, so every sealed action is `lead_snapshot_apply`. The statement must not carry `event_type: "Booked"`.

The cron is registered hourly in UTC and runs at 8:00, 13:00, and 18:00 America/New_York. Every slot covers the trailing 90 inclusive Open Dates in durable runs of at most seven days, plus older months with verified provider Open Date evidence. Manual runs accept `from` and `to`. Open Date is not last-modified time; unknown older Leads require discovery backfill, not guessed ingestion-date coverage.

## Parse

New parser. `parseSection` drops every Estimates row, because this table has no `no` column.

Proved columns: `job_no`, `open_date`, `type`, `follow_up`, `user`, `customer`, `email`, `phone1`, `phone2`, `from_city`, `from_state`, `from_zip`, `to_city`, `to_state`, `to_zip`, `miles`, `move_date`, `cf`, `lbs`, `rate`, `estimate`, `ref_no`, `source`.

Read direct cells of the results table. A cell that contains a nested table is not a header. The first proof concatenated the whole nested table into one header and wrote customer rows into a temp file. Keep customer, email, phone, and street address inside the statement that the lifecycle already redacts from admin plan details. Tests use synthetic fixture values. Logs, collection summaries, and fixtures checked into git stay free of live customer data.

A data row has a `job_no`. The totals line has miles, cubic feet, pounds, rate, and estimate filled and no job number. Drop it. Phone 2 is not a match key.

Priority is not a column: it is the single unambiguous `prior:` value inside `follow_up`. Numeric codes 0–9 are retained. The observed label `prior: Pool` maps to 9 only alongside a verified provider Pool=9 selector. `FUSTATUS=10` means ALL, never a row priority. Missing, malformed and conflicting priority markers remain held. This is parser support only; Pool membership, rep-workflow and deeper inspection remain separate work.

`cf` is cubic feet. The normalizer reads `est_cf` or `estimated_cubic_feet`. The adapted row stores cubic feet on `est_cf`.

## Statement keys

Adapt each kept row into the keys `buildGranotStatementFromCollectedRow` and `mapEnrichmentRow` already understand, then group rows into `GranotSourceCollection`s by the row’s `source` cell. `buildLifecycleApply` with section `followUpEstimates` produces `lead_snapshot_apply`.

| Estimates cell | Adapted value |
| --- | --- |
| `job_no` | `job_no` |
| `phone1` | `phone` |
| `email` | `email` |
| `customer` | `customer` (the builder also sets `customer_name`) |
| `user` | `user`. Preview mapping may also set `granot_crm_username` from `user`. The statement builder deletes `granot_crm_username` and keeps `user` for Agent assertion. |
| `follow_up` `prior:` digit | `prior` and `priority` |
| `source` | `source` |
| `from_city`, `from_state` | `from` as `City, ST` when both are present, which `parseGranotCityState` splits back into `from_city` / `from_state`. A test must show the statement city equals the cell. |
| `from_zip` | `from_zip` |
| `to_city`, `to_state` | `to` as `City, ST` |
| `to_zip` | `to_zip` |
| `cf` | `est_cf` |
| `move_date` | `move_date` |
| `ref_no` | `ref_no` |
| `type` | `type` |
| `estimate` | `estimate` when the cell is present. Evidence only. The planner’s forbidden paths already include `estimate`. |

`open_date` stays off `move_date`. `phone2`, `miles`, `lbs`, and `rate` are not match keys and are not lead writes.

## Canonical Estimates preview

Production Estimates preview uses `planEstimatesIdentities` in `estimatesIdentityPlanning.ts`: build the complete statement, normalize it, resolve the exact observed source through cached Registry policy, and run the same `resolveLeadIdentity` ladder used at apply. The legacy Form/Call preview classifiers no longer gate Estimates approval. Existing injected legacy adapters remain for partition/sealing tests; Leads & Advertising keeps its existing planners.

Matched valid snapshots become approvable lifecycle checks, including apparent no-ops and sparse rows matched by Record Link or equivalent Job Number. Every action retains its raw statement, provider `collection_captured_at`, operation identity and explicit `expected_target` where matched. Apply rechecks identity, source, temporal and assignment authority. Missing/ambiguous/deferred sources, malformed rows and unmatched/conflicting identity remain held. Missing or unresolved Granot usernames are visible warnings, not guessed assignments. Unmatched Estimates snapshots never create a Lead.

## Call Leads

A RingCentral Call Lead starts with a phone number and a source company. The job number is filled by this cycle when the lead has none.

The write-time match is the Call ladder in [identity.md](granot-lifecycle/identity.md), after a successful source-scoped policy. Source Company alone is not the key. The key is Source Granularity plus the rung below.

1. Active Record Link by normalized Job Number. A unique link returns here and skips the phone rung.
2. Prefix-equivalent `CallLead.normalized_job_no` inside that Source Granularity. A unique job returns here and skips the phone rung.
3. The same Source Granularity plus normalized phone, on current `normalized_phone_number` and `ingested_contact_snapshot.normalized_phone_number`. Call phone lookup does not read `granot_contact_snapshot`.

A lead that has a phone and no job misses rungs 1 and 2, matches on rung 3, and then the planner fills `job_no` and `normalized_job_no`. That fill is the job attach. Letter prefixes on the same digit core agree (`P5562366` and `5562366`). A nonempty stored job that is not equivalent is `job_number_conflict`. The planner returns before priority, receiver, and snapshots. The stored job stays.

A unique job already stored on a different Call Lead in that granularity sticks to that lead and does not fall through to the phone lead. Leave that ladder as it is.

Estimates preview and apply both use the canonical Source Granularity identity ladder. Phone-based attachment requires an eligible qualified non-duplicate Call Lead. Duplicate siblings do not create false competing eligible matches; genuine multiple eligible matches or a different established Job remain held. Legacy `previewCallLeadEnrichment` remains on the other collector path.

This cycle matches leads that already exist. `lead_snapshot_apply` receipts have no `route_event_class: "lead_created"`. The processor mints a lead only for that class. Estimates rows must not set `event_type` to `lead_created`, must not call `createLeadFromGranot`, and must not create a Call Lead for an unmatched phone. Unmatched rows finish `pending_match` or `unmatched` under the existing policy clock.

Live phone, name, and email stay. Qualified contact is `granot_contact_snapshot` only, and only inside the gate in the next section. `ingested_contact_snapshot` is never planned.

Form rows on the same page use the Form ladder (Record Link, `ref_no`, ObjectId-shaped ref, then source-scoped contact). The form planner still does not create Form Leads.

## What the matched lead actually receives

The planner in `leadDesiredState.ts` is the authority. This slice sends it a complete statement. It does not widen the planner.

| Field | When it is planned |
| --- | --- |
| `granot_priority` | Every temporally accepted valid priority. The digit from `prior:` is the canonical value (`canonicalizePriority`). |
| `job_no`, `normalized_job_no` | The lead has no `normalized_job_no`, and the incoming job normalizes. |
| `receiver_agent` | One active Agent for the `user` cell, a valid priority, and `receiverFillableByGranot`. With deployed `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS=true` for the reviewed reassignment rule, a temporally accepted observation may replace an automatic Granot assignment; manual and source-less receivers remain protected. Checked-in default off permits only an empty receiver or replacement of a `ringcentral_rep_call` placeholder. Source written is `granot_username_match`. The same Agent is not re-stamped. |
| `quoted` true, `granot_contact_snapshot`, move fields | Priority canonical `"1"` or `"5"` only (`BROAD_ENRICHMENT_PRIORITIES`). `quoted` is never set false. |

`planQualifiedMove` writes `pickup_city`, `pickup_zip`, `pickup_state`, `delivery_city`, `delivery_state`, destination zip (`delivery_zip` on a Call Lead, `destination_zip` on a Form Lead), `cubic_feet` from `estimated_cubic_feet`, `local` / `long_distance` when both states normalize, `granot_move_size`, and `granot_service_type`. `move_date` is planned on a Form Lead only.

Priority 0 is the common new-assignment code on this page. A priority 0 follow-up updates priority, fills a missing job, and can set `receiver_agent`. It does not receive `granot_contact_snapshot`, cubic feet, or move date. Keeping snapshots means the 1/5 rows still go through this planner, which already plans those snapshots. Widening that set, or writing `move_date` onto a Call Lead, is a later change to the locked planner. It is not part of making this page parse.

An `outbound_attempt` on an unassigned subject no longer writes `receiver_agent`. An `inbound_answered` still can, with source `ringcentral_rep_call`. A later Estimates apply replaces that stored source when the Granot user resolves to a different Agent. An Owner `manual` assignment stays.

## Outreach

Priority and receiver go out in the same `synchronizeLeadFromGranot`. The lead-change tail is `GET` / cron `/api/cron/sales-outreach-lead-changes`.

- A lead that is already a desk subject is re-synced on the change, including a receiver-only change. `assigned_agent_id` follows `receiver_agent` only while that Agent has a reviewed `sales_rep` link (`subjectBuilder.ts`). Otherwise the subject stays unassigned.
- A lead that is not yet a subject is nominated for expansion admission only while `transition.expansion_admission_enabled` is on. `granot_priority` and `normalized_job_no` are in `ADMISSION_DECISION_PATHS`. `receiver_agent` is not. Putting priority in the same revision is what admits the new subject. Leave that path list as it is.
- `move_date` is also an admission path. Call Leads do not receive `move_date` from this planner, so a Call Lead admission from this cycle comes from priority or from the new job number.

FINAL-01 and the configuration fixtures map codes 2 and 3 to workflow `daily`: one ordinary call each working day, the subject stays open, and a future move date does not close or hide the lead. That workflow is not Quoted. It is not in the new/quoted goal set. The three-day move from priority 0 to priority 2 stays a rep action in Granot. The persisted `cadence.priority_map` remains authoritative; deployment/backfill does not derive working-day goals or silently rewrite cadence configuration.

## Run shape

Add operation `estimates_in_process` beside `form_leads` and `call_leads`.

| | `form_leads` / `call_leads` | `estimates_in_process` |
| --- | --- | --- |
| Collector | `collectGranotReport` | `collectEstimatesInProcess` |
| Sources on the create body | `source_ids` or `source_labels`, still required | Absent. The page is the source list. Sending either is a validation error. |
| Date window | existing `from` / `to` | same `MM/DD/YYYY` rules |
| Workflow | `preview` or `apply` | same |
| Model enum | `GranotAutomationRun.operation` today | add this value. The two existing values stay. |

`planRun` branches to the new collector only when the operation is `estimates_in_process`. The `form_leads` / `call_leads` branch keeps calling `collectGranotReport` and one planner.

Preview runs complete with no approval. An Owner-created apply run with at least one approvable action stops at `awaiting_approval`, and `GRANOT_AUTOMATION_APPLY_ENABLED` remains that gate for `form_leads`, `call_leads`, and an Owner-created `estimates_in_process` apply.

The cron is the exception. `ALL /api/cron/granot-estimates-in-process` is guarded by `CRON_SECRET` the same way the other cron routes are, and `vercel.json` schedules it `0 * * * *` (UTC). The handler returns `{ ok: true, skipped: true, reason: "outside_estimates_hours" }` unless the current America/New_York hour is 8, 13, or 18. Each slot schedules Follow-Up Estimates for the trailing 90 inclusive Open Dates plus verified older provider-date months, all users and all priorities. Windows of at most seven days have deterministic slot-and-window run IDs; retries preserve the same immutable plan and lifecycle operation identities. The create body sets `request_snapshot.auto_apply`. `planRun` then writes status `applying` and an approval of every approvable action, with the system actor `granot-estimates-in-process-cron` (`actor_role` `system`, `origin` `vantage_admin`). That origin is what `granot_http_automation` capture requires. The same actor is the only extra initiator `assertGranotLifecycleContext` accepts, and only on channel `granot_http_automation`. The processor actor stays `granot-lifecycle-processor`. One worker invocation plans and, when the run is `applying`, applies in the same lease. That apply skips `GRANOT_AUTOMATION_APPLY_ENABLED`. It does not skip the lifecycle lead-write gates. When those gates are off, the processor persists the suppressed decision. A run with nothing approvable completes without an approval.

## Test database, then a live read

Unit tests mock HTML. They do not call `eagle.hellomoving.com`.

Local integration uses `TEST_MODE=true` and an isolated `TEST_MONGO_DATABASE_NAME=testvantagemovers_<suffix>` on the loopback replica set. Tests do not connect to Atlas or production. Collector tests use synthetic provider HTML. Guarded live provider reads and signed API backfill operations are separate from CI and recorded in the release evidence.

Fixture shape: one totals row with cubic feet and no job number; one data row whose `follow_up` contains `prior: 0`; split city, state, and zip cells; `phone1`; `cf`; `user`; `source`. Include a nested table so a naive whole-table header fails the test. Synthetic names and `555-01xx` phones only.

## Files

New:

- `src/services/granotHttpCollector/estimatesInProcess.ts` — login reuse, `estprocesswc` / `estprocessret`, parser, column adapter, `collectEstimatesInProcess`.
- `src/services/granotHttpCollector/estimatesInProcess.test.ts` — parser, posted field names, statement keys.
- A replica test next to the existing automation apply tests for the lead and outreach assertions below.

Edit:

- `runWorkflow.ts` — verified Estimates collection, canonical identity preview, sealed capture time, fair bounded worker and freshness reads. The legacy operation branches stay.
- `granot-automation.routes.ts` — create-body variant for `estimates_in_process`.
- `GranotAutomationRun.ts` — operation enum gains `estimates_in_process`.

The canonical lifecycle remains the only write authority. Reliability changes make Call phone eligibility and preview agree with it and recheck qualification/non-duplicate authority at write time. Preserve quote/contact/move policy, manual assignment protection, immutable intake, booking/cancellation gates and `ADMISSION_DECISION_PATHS`. `collectGranotReport` and `parseSection` retain their separate report behavior. `receiverFill.ts` still excludes `outbound_attempt`; `inbound_answered` stays.

## Tests that define done

Parser and HTTP mock:

- Posted body is `STATUS=V9`, `TYPEDTE=OPEN`, the run’s `DATE1` / `DATE2`, `FUSTATUS=10`, empty `USER`, `DEPT=ALL`, `TYPE=V1`, `SORT=V6`.
- The Estimates collector does not request `mprep`.
- `collectGranotReport` still requests `mprep` and still does not request `estprocesswc`. The existing collector tests keep passing.
- A row with `prior: 0` yields statement `priority` `"0"`, `phone` from `phone1`, `est_cf` from `cf`, `user` preserved, `from_city` equal to the city cell.
- The totals row is absent.
- A row with no `prior:` digit does not invent a priority.

Call Lead on an isolated local replica database, flags only as test arguments:

- Seed a Call Lead with a normalized phone, a source company that resolves to one Call route, no job number, and an empty receiver. Seed one active Agent whose Granot username matches the row `user`, with a reviewed `sales_rep` link.
- Preview is `updateable` and creates no receipt.
- Approved apply writes `job_no` / `normalized_job_no`, `granot_priority` from the cell, and `receiver_agent` with source `granot_username_match`.
- Live phone, name, and email on that lead are unchanged.
- `EntityChange.changed_paths` includes `granot_priority` and `normalized_job_no`. With expansion admission on, `nominateLeadChanges` nominates that lead. An existing subject’s `assigned_agent_id` becomes that Agent.
- Priority `"0"` leaves `granot_contact_snapshot` and `cubic_feet` unset. Priority `"1"` sets `granot_contact_snapshot` and `cubic_feet`, and leaves Call Lead `move_date` unset.
- A second lead in the same granularity with a different stored job number conflicts, and that job is unchanged.
- A phone match on a different source company is not the target.
- An unmatched phone creates no Call Lead and no Form Lead.

Form coverage on the same fixture requires canonical Form-only routing and identity, with an explicit Form target. Sparse Record Link and prefix-equivalent Job matches must remain approvable through assembly, and cross-source/ambiguous targets must remain held.

## Later

Still not this implementation:

- Booked Jobs from this form, and `STATUS=V15`.
- The three-day move from priority 0 into priority 2. That stays a rep action in Granot. The desk does not write Granot priority.
- Move-date copy, move-date sort, the Future and Past labels, the Last interaction column rename, and both binder figures on My view.
- Snapshots or Call Lead `move_date` for priorities other than 1 and 5.
- Seeding Paid Overflow.
- Patching the priority map stored on the deployed database, and turning lifecycle effect flags on. FINAL-01 and the fixtures already map codes 2 and 3 to `daily`. An `inbound_answered` can still write `ringcentral_rep_call`. Checked-in flag defaults stay off.


## Reviewed bounded Estimates apply

An Owner may POST `/api/v1/admin/granot-automation/runs/:runId/apply-reviewed-estimates`
with `plan_checksum` and `selected_action_ids` after reviewing a completed Estimates
preview. The stored Open Date window must contain 1–90 inclusive real calendar dates
ending no later than today in America/New_York. The unexpired schema-v2 plan and checksum
are reused without recollecting only when selected actions retain verified provider capture times. Only selected approvable actions are authorized;
conflicts, unmatched rows, and unresolved sources cannot be selected. A fenced state
change promotes the preview to `workflow: apply`, sets `request_snapshot.auto_apply: true`,
and stores the signed Owner approval. The existing worker and lifecycle apply perform
the effects. This narrow path skips the ordinary automation flag, retains every
lifecycle gate, and cannot promote form/call runs. Ordinary `/approve` keeps its gate.

The recurring cron schedules the full declared scope at 8, 13, and 18 New York.
A deterministic run `_id` keyed by slot plus date window makes retries and concurrent
invocations reuse the same run, plan, and lifecycle operation IDs.
The existing Mongo `_id` index enforces uniqueness; no index migration is required.

## Reliability checks, timing and freshness (14 October 2026)

`estimatesCollection.ts` verifies enabled form controls, required direct headers and row alignment, explicit emptiness, same-session pagination and rendered transaction counts. Repeated, unsafe, out-of-window or unreconciled results fail closed. Large/incomplete multi-day renderings split adaptively; an incomplete single-day result cannot claim complete refresh. Blank individual fields differ from absent columns. `open_date` normalizes to a real date and retains original evidence; optional phone2 stays evidence, never a match key. Split city/state fields are retained even when their companion is blank.

Each row's actual provider response time is checksum-sealed as `collection_captured_at` and supplied as receipt `captured_at`. Delayed application never becomes a fresh observation. Existing pending lifecycle receipts are claimed directly with their stored operation/time; no recapture occurs. An already-approved legacy action without both an existing receipt and verified time finishes as `technical_failure` / `RUN_REPLAN_REQUIRED`; independent stored receipts still drain. New approval rejects missing-time selections and requires recollection.

Worker claims use one least-recent-attempt queue across fresh collection, approved actions and eligible retries. Apply yields after 25 actions or 120 seconds, preserving receipts; remaining fresh actions checkpoint `apply`, while pending-only runs use `waiting_match` and bounded one-minute readiness. The lifecycle receipt still owns its due clock. Terminal receipts never replay. Estimates collection/planning checks a shared 120-second budget, including login network hooks; a budget failure requests smaller windows and never claims complete coverage. Queue continuations have distinct delivery identities so repeated batches are not deduplicated away.

`granot_estimates_open_dates` stores only verified observed provider dates, with first/last observation times. Scheduled scans conservatively include every older observed month, without asserting target ownership or inventing an active-Lead rule. Complete manual backfill snapshots also extend this inventory. Unknown older scope remains an explicit coverage limitation.

Owner `GET /api/v1/admin/granot-automation/runs/freshness` returns `last_complete_coverage_at`, the latest expected New York slot, collected/completed/failed window counts, held rows and warnings. Collection completeness means every declared window collected successfully; `completed_windows` separately describes synchronization progress. A missing complete expected slot after 90 minutes produces `late_slot`; partial scans and held rows remain visible. Queued or collected does not mean all Lead state has converged. Release, backfill evidence and deployment flag changes belong in [release evidence](../granot-estimates-reliability/RELEASE.md). Josh's working-day goals remain a separate Owner configuration.
