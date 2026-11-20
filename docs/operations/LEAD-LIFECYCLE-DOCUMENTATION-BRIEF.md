# Lead lifecycle documentation brief (Owner directive, November 20)

The Owner directed: "ALL LOGIC for how FORM leads, duplicate forms, call leads, duplicate calls, bad calls, bad forms get minted and go throughout their lifecycle MUST BE DOCUMENTED COMPLETELY COMPREHENSIVELY AND PER THE MOST RECENT CODE." Agents must not miss any logic.

This is Track B of the next session. It runs alongside Track A, the [November 20 handoff](NEXT-SESSION.md#start-here--november-20-handoff). Track B documents. It changes no runtime code and no production data.

## Output

Create a Reference pack at `docs/knowledge/lead-lifecycle/` and link it from `docs/index.md`.

| File | Must cover |
|---|---|
| `README.md` | The state model and how to use the pack. It includes one diagram from minting to every terminal state, and a precedence summary for the reporting tabs. |
| `form-leads.md` | Every Form minting path. Normalization, source and granularity assignment, CPL pricing at creation, Form duplicate detection, bad Form rules, updates and deletion. |
| `call-leads.md` | Call minting. Only the RingCentral inbound queue qualification may mint or qualify a Call (Owner directive 2026-11-03). Cover the elapsed-time threshold and answer rules, adoption and convergence, and final-result recording and the watermark. Cover the preserved historical and Best Relocation admissions, overnight missed-call handling, updates and deletion. |
| `duplicates-and-form-fill.md` | The Form duplicate rule. The 90-day Call repeat rule (`ringcentral-duplicate-guard.ts`). The Form Fill rule (`form_fill`, `detectFormFill`, `drainFormFillWork.ts`, `repairCallFormFillForReporting`, `markCallLeadFormFill`). How each flag routes a Lead to Duplicate Forms or Duplicate Calls, and how it affects billing and CPL. |
| `bad-leads.md` | Every path that makes a Form or Call bad, and how it reaches Bad Form Leads or Bad Call Leads. Include the external Best Relocation review, the overnight missed call, any manual or Admin path, and how a bad flag is reversed. |
| `granot-effects.md` | Everything Granot does to a Lead. Job-number link, priority, receiver, `synchronizeLeadFromGranot`, `createLeadFromGranot` (Forms only; never a Call), Record Links, the Form→Call sibling mirror (`mirrorFormLeadToCallSibling`) and its eligibility gate. Scheduled runs versus webhooks versus the extension. |
| `bookings-and-cancellations.md` | How a Lead becomes booked or cancelled: Booking from Lead, leadless and referral Bookings, employee booking reconciliation and attachment, the cancellation mirror. The flags they write and how official records stay reportable without a Lead. |
| `reporting-and-sheets.md` | The complete routing table. Every combination of `duplicate`, `form_fill`, `bad_lead`, `created_on_unmatched`, `no_sync`, `booked`, `cancelled`, the external review and qualification maps to a destination tab, a billable value and the CPL used. Also cover tab-to-tab moves, stale-row removal, tombstones and the managed versus operator cells on the six Master Leads tabs and two Master Booked tabs. |
| `downstream-consumers.md` | What each lifecycle state means to Sales Outreach Desk eligibility and admission, Pool, Daily Operations, Insights and Analytics lead spend, the Numbers Lead link and the Job Number timeline. |
| `COVERAGE.md` | The completeness proof. See the method below. |

Each rule cites `file:function` and the line range at a named `main` commit SHA. Each rule states its precedence, its time window, and its timezone or business-day clock. Each rule states its idempotency or replay key, and what Sheet Sync, Outreach and Daily Operations effects it emits.

## Sources of truth, in order

1. Code on `main`. Read the code first. The existing Service docs can be wrong, as the November 19 and 20 reviews showed. Verify every statement copied from them.
2. Owner directives in the workspace `AGENTS.md` and `CONTEXT.md`. These are locked: RingCentral-only Call qualification and billing, preserved historical qualification, the Best Relocation final reconciliation and its exceptions, the Form/Call pair and sibling rules, and official Bookings and Cancellations staying reportable.
3. Existing docs: `docs/knowledge/services/form-lead.md`, `call-lead.md`, `ringcentral-call-lead-qualification.md`, `booked-call-lead-reconciliation.md`, `bookings.md`, `cancelled-lead.md`, `cancellation-mirror.md`, `employee-bookings.md`, `ingestion.md`, `google-sheets.md`, `sheet-sync.md`, `docs/call-lead-billing.md`, and `docs/knowledge/granot-lifecycle/*`. For the Form/Call pair and sibling rules, the workspace `AGENTS.md` entries dated 2026-10-28 and 2026-10-29 are authoritative. The `job-number-pending-investigation/` pack they cite is no longer in the workspace; recover it from history only if needed.

When code and an Owner directive disagree, record a finding. Do not change the code in Track B, and never soften a locked rule to match code.

## Completeness method (mandatory)

Track B is complete only when `COVERAGE.md` has zero unclassified rows in all four inventories.

1. **Entry points.** List every route, cron, queue consumer, worker, extension endpoint and operator script that can mint or change a Form or Call Lead.
   - **Starting seeds:**
     - `createFormLead` (`domainCommands/leads.ts`, `existingWrites.ts`, `routes/v1.routes.ts`), with Form duplicate logic in `leads/duplicateLead.service.ts` and `leads/formLead.service.ts`;
     - `createCallLead` (`domainCommands/leads.ts`, `leads/callLead.service.ts`);
     - `createLeadFromGranot` (`granotLifecycle/createLeadFromGranot.ts`);
     - `createAndAttachReconciliationFormLead` (`employeeBookings/bookingLeadAttachment.service.ts`);
     - `adoptRingCentralCall`.
   - **Completeness check:** confirm the list against `src/app.ts` route registration and `vercel.json` crons.
2. **Commands.** Give every canonical command a row: trigger, preconditions, fields written, emitted EntityChange paths, Sheet, Outreach and Daily Operations effects, and its idempotency key. On November 20 the code named these 29 commands, plus `createLeadFromGranot` through its own constant:
   - Creation: `createFormLead`, `createCallLead`, `adoptRingCentralCall`.
   - Updates and Granot: `updateSourceOwnedLead`, `synchronizeLeadFromGranot`, `mirrorFormLeadToCallSibling`, `fillReceiverFromRepCall`, `recoverCallLeadMoveDate`.
   - RingCentral and Form Fill: `markCallLeadFormFill`, `repairCallFormFillForReporting`, `recordRingCentralFinalCallLogResult`, `markRingCentralConvergenceConflict`.
   - Deletion: `deleteFormLead`, `deleteCallLead`, `deleteBookedLead`, `deleteCancelledLead`.
   - Bookings: `createBookingFromLead`, `createLeadlessBooking`, `createExistingReferralBooking`, `submitEmployeeBooking`, `attachBookingToLead`, `autoAttachBookingLead`, `resolveBookingLeadReconciliation`, `updateBooking`, `updateBookedLead`.
   - Cancellations: `createCancellation`, `updateCancelledLead`.
   - Regenerate the list with `git grep -hoE 'command_name: "[A-Za-z]+"' -- src ':!*.test.ts' | sort -u`. **This grep is incomplete**, because some names are defined through constants. Also union it with the distinct `command_name` values that production has recorded on Form and Call `entity_changes` (read-only aggregate). On November 20 production also showed these commands:
     - `confirmGranotBooking`: 144 Call and 229 Form revisions, latest on November 19.
     - `admitBestRelocationFinalCallV1` and `reconcileExternalSheetReviewV1`: the November 4 Best Relocation reconciliation.
     - `fillReceiverAgentFromAnsweredCall`, `backfillReceiverAgent` and `backfillDeskReceiverFromGranot`.
     - `createLeadFromGranot` on 8 Call Leads, last on September 3. That is before Granot Call creation was retired.

     Document each name as current, historical-only or retired, and say which reader still depends on its records.
3. **Field writers.** For each lifecycle field, list every non-test writer. Generate the list with `git grep`, then classify each hit as documented or not a lifecycle write.
   - **Fields:** `duplicate`, `form_fill`, `bad_lead`, `created_on_unmatched`, `no_sync`, `booked`, `cancelled`, `job_no` and `normalized_job_no`, `granot_priority`, `receiver_agent` and `receiver_agent_source`, `granot_form_sibling`, `ringcentral.qualification_reason`, `ringcentral.final_result*`, `external_sheet_review`, `external_call_admission`, `cpl` and `cpl_resolution_status`, `local`, `move_date`, `sheet_sync.*`, `domain_revision`.
   - **November 20 rough counts of writing files:**

     | Field | Files | Field | Files |
     |---|---:|---|---:|
     | `normalized_job_no` | 56 | `bad_lead` | 12 |
     | `duplicate` | 51 | `granot_priority` | 12 |
     | `cancelled` | 31 | `form_fill` | 11 |
     | `booked` | 29 | `no_sync` | 9 |
     | `receiver_agent` | 19 | `external_sheet_review` | 4 |
     | `created_on_unmatched` | 14 | `qualification_reason` | 3 |
     |  |  | `granot_form_sibling` | 3 |

     Treat these counts as a floor.
   - **Also include:** writes via `$set`, `updateOne` and `updateMany`, aggregation pipelines, Mongoose document assignment, and ops scripts that remain supported.
4. **Readers that decide routing or money.** Cover every function that decides a tab, billability, CPL, Desk eligibility or Calls reporting.
   - **Starting seeds:** `callLeadReportingDisposition.ts` (`reportingEligibleCallLeadFilter`, `billableCallLeadFilter`), the Form equivalent, `expectedSheetTabs.ts`, `sheetSync` planners, `hasReportingEligibleCall` and `hasQualifiedRingCentralCall` (`leads/callLeadAdmission.ts`), Insights pricing (`insights/facts.ts`), and Outreach `subjects/eligibility.ts`.
   - **Requirement:** the routing table in `reporting-and-sheets.md` must reproduce each function's result for every flag combination.

**Lifecycle transitions.** For each state, document every way in and out, with the Sheet consequence: which tab is upserted, which stale tab row is removed, and the tombstone. Cover these moves at least:
- Form becomes or stops being a duplicate.
- Call gains or loses `form_fill`.
- Call becomes a 90-day repeat.
- Bad Form or Bad Call, and its reversal.
- Booked, cancelled, then re-booked.
- Job linked, job changed, Lead deleted, duplicate repair.
- Granot priority 5 as booked.
- The overnight missed call.

**Form Fill rule as confirmed by the Owner, November 20.** A Call Lead is created only when it qualifies through the RingCentral inbound queue: the elapsed-time threshold of at least 120 s, and a phone number. Its routing then depends on Form matches:

- **Matching Form:** the Call gets `form_fill: true` when a non-duplicate Form Lead has the same normalized phone under the same overarching `lead_source_company`. When the canonical company is absent, the legacy `source_company` slug is used instead.
- **No time window:** the match works in both directions. `hasFormFillForCallLead` runs at Call creation. `markMatchingCallLeadsWithFormFill` flips qualified Calls when a later Form arrives (`leads/duplicateLead.service.ts`).
- **Tab:** a Form Fill Call routes to Duplicate Calls and is not billable.
- **Granot updates:** the Call can still receive Granot updates throughout its lifecycle and stays on Duplicate Calls.

**Owner's reference case.** Call Lead `6ae907f26f28ecf54e7aff42`, read-only trace on November 20:
- **Qualification:** `call_log_inbound_target_elapsed_at_least_120s`, 689.246 s.
- **Flags:** `form_fill: true`, `duplicate: false`, `created_on_unmatched: false`.
- **Job and booking:** job 5567003, booked. It appears on Duplicate Calls, attributed to TBM Prime Inbounds.
- **History:**
  1. `createCallLead` on 2026-11-02 at 22:00 UTC.
  2. Three `synchronizeLeadFromGranot` updates. They applied directly to the Call, not through the sibling mirror, and `granot_form_sibling` is empty.
  3. `confirmGranotBooking` on November 3, which set `booked`.
  4. `recordRingCentralFinalCallLogResult`.

The pack must explain both job paths: Granot updating a Call that it matched directly, and the Form→Call sibling mirror.

**Excluded Leads that still have rows.** Document what happens to a Lead whose disposition becomes or already is `excluded`, and to any existing Sheet row it has. On November 20, five legacy June 9, 2026 Calls (`legacy_unknown`, no admission) still had rows: four on Calls and one on Duplicate Calls. Re-delivery leaves them in place. See [the review](SERVICE-REVIEW-2026-11-20.md#sheet-sync). The production reconciliation must count every such row.

**Worked examples.** Include at least one per tab, traced from minting to the visible Sheet row with real field values. Use anonymized identities, never customer phone numbers or names. Required examples:
- A Form Fill Call on Duplicate Calls that then receives its Form's job through the mirror.
- A 90-day repeat Call.
- An overnight missed Call on Bad Call Leads.
- A leadless official Booking.

## Verification (mandatory)

1. **Independent re-derivation.** A verifier agent that wrote none of the pack re-derives every locked-contract rule and a random 25% of other rules from code. It reports mismatches as file:line. Fix each mismatch and re-verify.
2. **Executable rules.** List the unit and replica tests that encode each routing and minting rule. Name every rule without a test as a gap.
   - Run the offline tests: `node --import tsx --import ./ops/test-setup.ts --test <files>`.
   - If a disposable loopback replica is available, run the lifecycle replica suites (`*.replica.test.ts`, see `CLOUD_AGENTS.md`).
3. **Production reconciliation, read-only.**
   - Count production Leads per computed disposition, using the documented table as a query. Compare each count with the Mongo ID count on the matching Master Leads or Master Booked tab.
   - Explain every difference.
   - Read Sheets with values and `spreadsheets.get` only, and Mongo with find and aggregate only. Record the time and counts.
4. **Track A interaction.** Track A changes the Granot sibling catch-up and Record Link logic. After Track A merges, re-verify `granot-effects.md` and `duplicates-and-form-fill.md` against the merged code.
   - The mirror must keep its gate: the Call is reporting-eligible under `hasReportingEligibleCall` (`leads/callLeadAdmission.ts`). That means RingCentral inbound queue qualification, or a preserved historical or trusted final-import Best Relocation admission. It is also not a 90-day repeat `duplicate` and not `created_on_unmatched`.
   - It must keep updating a Form Fill Call in place on Duplicate Calls.

## Agent organization

Run one coordinator and four parallel readers, each told to read code before docs:

1. Form minting, Form duplicates and bad Forms.
2. Call minting, RingCentral qualification and final result, the 90-day repeat, Form Fill and bad Calls.
3. Granot effects and Bookings and Cancellations on both Lead types.
4. Downstream routing: Sheet Sync tabs, billing and CPL, Outreach, Daily Operations, Insights, Numbers and the timeline.

Then run one independent verifier. The coordinator integrates and owns `COVERAGE.md`. Give each reader the inventory commands above and the rule that an unclassified hit blocks completion.

## Exit criteria

- `COVERAGE.md` shows zero unclassified entry points, commands, field writers or routing readers, at a named SHA.
- The routing table covers every flag combination, and the production reconciliation explains every count difference.
- The verifier signs off, with every mismatch fixed.
- `form-lead.md`, `call-lead.md` and `ringcentral-call-lead-qualification.md` are corrected and point to the pack. `docs/index.md` links the pack.
- Every finding that conflicts with an Owner directive is listed for the Owner, without code changes.
- The pack is merged through a PR, with the docs-only diff.
