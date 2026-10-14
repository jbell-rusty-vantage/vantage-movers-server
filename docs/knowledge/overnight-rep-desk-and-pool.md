---
okf_version: "0.2"
type: Reference
title: Overnight rep metrics, outreach presentation, then Pool prototype
description: "Owner execution brief: complete and merge rep binder metrics and outreach move-date/interaction presentation, then deliver a read-only Pool discovery prototype and approval-ready design."
tags: [sales-outreach-desk, granot-lifecycle, agent-handoff]
status: draft
stale_after: 2027-01-14
resource: src/services/salesOutreach/
applies_to:
  - src/services/salesOutreach/reads/
  - src/services/salesOutreach/live/
  - src/services/granotHttpCollector/estimatesInProcess.ts
owners: [team:main-server]
sources:
  - id: previous-rep-spec
    resource: granot-priorities-and-rep-desk.md
    title: Earlier rep presentation and Granot discovery documentation
  - id: lifecycle
    resource: sales-outreach-lifecycle.md
    title: Existing cadence and admission behavior
  - id: allocation
    resource: services/agent-allocation.md
    title: Official booking allocation and binder credit
---

# Overnight execution brief

> **October 14 continuation:** [live Pool findings](../rep-desk-and-pool/POOL-FINDINGS-2026-10-14.md) and [approval-ready proposal](../rep-desk-and-pool/POOL-APPROVAL-2026-10-14.md) supersede the historical Pool access/date-window/parser assumptions below. Priority9 is Pool; production shared workflow remains unimplemented and approval-gated.

This is the Owner's latest task, recorded October 13, 2026 America/New_York (October 14 UTC). Execute in **two ordered phases**. Phase 1 is authorized implementation, verification and merge to `main` in both repositories where needed. Phase 2 is authorized discovery/prototyping and an approval-ready Pool design, ending **before production Pool mutations or feature implementation**. Do not stop after writing a plan for Phase 1. Do not claim completion with unmerged changes.

## Start and precedence

Fetch the latest `origin/main` in `vantage-movers-server` and `vantage-admin`; use clean branches/worktrees and preserve unrelated work. Read AGENTS.md, CLOUD_AGENTS.md, applicable .cursor rules and the Service documents below. This Owner brief supersedes older presentation requirements **only where explicitly changed**. Do not rewrite locked lifecycle policy to accommodate unrelated work.

Older docs requested **This week / This month**; this task requests **Last week / Last month**. Older docs offered an assigned-lead count because no binder money source was established. The Owner has now clarified: **“It's on the booking attached to the lead.”** Use that attached Booking as the authoritative money source. Neither a count nor a fabricated estimate fulfills the potential-dollar requirement.

Prior Estimates rollout is complete and deployed. At handoff, server main is `065cf0205eb36a37e0ebbaeaf6aa5b148222da18`, admin main is `db93ec999910ef1cb94998949a9aeda085ff0c07`; fetch rather than pinning work to those SHAs. Owner-authorized production configuration revision 26 maps codes **2 and 3 to daily**. Verification found 224 open code-2/3 subjects all Daily/current, 66 existing subjects with prospective re-decision and preserved history, and 159 eligible dated enrollments with zero mismatches. Preserve this work, official Booking gates, receiver protection and cadence history.

## Phase 1 — complete, test and merge the rep desk and outreach changes

### Official booked binder metrics

Give each Rep their own binder credit from **official Bookings**, visible on their rep desk. Owner and Manager may view the same metrics when viewing that Rep; a Rep cannot read another Rep's metrics by changing an agent id.

Show these four monetary totals in the existing desk visual style:

| Label | New York calendar definition |
| --- | --- |
| Today | Current New York calendar date |
| Last Week | Entire previous Monday–Sunday week, not this week, rolling seven days or previous week-to-date |
| Last Month | Entire previous calendar month, not this month or rolling thirty days |
| All Time | All official booking dates, with no arbitrary historical window, ranking cap or first-page limit |

Example: on October 13, 2026, Last Week is October 5–11 and Last Month is September 1–30. Test January/year boundaries and daylight saving transitions. `book_date` is a stored calendar-date value: inspect existing storage/query conventions before constructing date bounds; do not timezone-shift a date-only booking into another day.

Sum the Rep's own **`agent_allocations[].binder_amount` by stable Agent id**, not total booking binder per participant or name snapshot. Respect the existing split/cents allocation rules; never duplicate the total across both agents. Granot priority 5, a scraped estimate, a reconciliation case or a Lead.booked flag alone is not an official Booking. Preserve the documented cancellation policy (the earlier rep spec retains cancelled bookings in gross booked binder, matching Insights); label the gross basis clearly and do not silently invent net/refund deductions.

### Potential money on currently assigned Leads

Show **potential binder dollars on currently assigned eligible Leads**, reflecting the current canonical assignment/receiver and manual-assignment protection. Cover both FormLead and CallLead as applicable; compute across the complete eligible assignment scope, not just the loaded outreach page or only enrolled outreach subjects.

**Authoritative source, explicitly clarified by the Owner: the booking attached to the Lead.** Both `FormLead.booked` and `CallLead.booked` reference `BookedLead`; `BookedLead.total_binder_amount` stores the booking binder, with a compatibility `binder_amount` virtual, while `agent_allocations[].binder_amount` stores the individual allocated slices. Inspect canonical linkage and existing readers before implementing the join. Use the attached Booking's stored binder amount, not a new rate, quote boolean, cubic feet, CPL, Granot estimate or guessed payout percentage.

The two displays measure different things: official booked credit uses the Rep's own allocation and booking-date windows; **current assigned-lead potential uses the binder amount on the attached Booking for Leads currently assigned to that Rep**, independent of historical booking-agent credit. Use the booking total for this assigned-lead amount, unless an existing authoritative assigned-lead binder contract defines a more specific amount. Explain the basis clearly; do not multiply the total across duplicate links or infer the Rep's earned commission from current assignment. A lead reassignment changes the potential ownership, not historical official booking allocations.

**Explicit Owner rule: priorities 7, 8 and 9 contribute nothing to potential money.** Apply it even if some priority-9 records remain open under current unmapped cadence. This is a metric exclusion; it does not authorize globally closing code 9 or changing Pool semantics. Exclude duplicate/bad/ineligible/cancelled records under existing rules and deduplicate by canonical Lead/Booking identity, including cross-model duplicate links. Do not silently restrict the eligible assignment scope to just one outreach page.

**Do not exclude a Lead merely because its `booked` reference supplies the attached Booking:** doing so would eliminate the very monetary source the Owner specified. The term potential here is the Owner's assigned-lead metric; do not redefine it as strictly unbooked-only money or assert that official booked credit and assigned-lead totals are mutually exclusive. If actual linkage/state evidence exposes an ambiguity, describe the concrete case and resolve it against the clarified requirement rather than inventing a second monetary model.

Handle missing/dangling Booking links or missing amounts explicitly: an unlinked Lead has no established binder amount, not an invented $0 forecast. Show the known linked-binder total plus clear missing-link/amount coverage where needed; distinguish genuine stored zero from unknown. An open-lead count can accompany dollars, not replace them. No new potential-binder rate or formula is needed for valid attached Bookings, and this task does not authorize creating placeholder Bookings to populate the metric.

### Live feel

Refresh binder and potential figures after relevant committed official Booking create/update/delete, allocation/binder/book-date changes, cancellation changes under the chosen documented basis, Lead assignment/priority/eligibility/amount changes, and New York date rollover. Reuse the existing outreach live connection/cache invalidation and add only the necessary role-scoped topics/read contracts. Do not copy Daily Operations metric-touch machinery or open a second live connection. Provide honest loading, unavailable, partial and stale states; do not imply real-time updates without connected refresh/recovery behavior. Test reconnect/refetch and rep isolation. Use Daily Operations as a UX reference, not a dependency on its Owner-only API.

### Move-date filtering and server sorting

In outreach search/view, expose **Future** and **Past** move-date filters and **Move date** sorting. Search, priority, workflow, rep scope, date filters and pagination must compose correctly; selection should survive URL navigation and refresh.

Keep the earlier documented semantics: **Future includes today and later; Past is through yesterday**, measured using the current New York calendar date. Treat null/unknown dates separately; do not classify them as Past or Future. Preserve/provide an explicit Unknown option and clear empty states. Reuse the existing `move_date_from` / `move_date_to` presets where possible.

Add **server-side Move date sort, soonest first, nulls last**, with a stable tie-breaker and cursor-compatible order over the complete result set. Add an appropriate projection index if required, using the existing deployment/migration process. Do not sort only the loaded browser page. Mirror the sort in server/admin schemas, URL parsing, queue and relevant Team sort menus. Preserve existing assignment visibility and cadence: a passed/future move date is a filter/label, not a new closure or enrollment rule.

Use the authoritative existing `display.move_date` date-only field. The prior spec deliberately keeps Call Lead move date null even if a raw document has a date; inspect current contracts and retain that boundary. This task does not authorize filling Call Lead move_date from Granot or changing collection policy.

### Outreach card/row and lead panel content

Expose the same information in the existing outreach row/card and lead panel without creating an unrelated new layout:

- Move date in X days; **Today** for zero days; X days ago for past dates; **No move date** for unknown. Calculate calendar-day differences in New York, not 24-hour milliseconds across DST.
- **Last interaction** X hours/days ago, with sensible just-now/minute handling and an exact timestamp available for clarity. Use **No interaction** for null and avoid negative relative labels for future/clock-skew timestamps. Refresh relative labels while the page stays open and handle date rollover.

The current column is labeled Last outreach; rename it to **Last interaction** consistently. Preserve the existing definition of `last_interaction_at`: qualifying confirmed outbound_attempt, inbound_answered, inbound_missed, sms_sent and sms_inbound. Do not start counting failed/unconfirmed/automation SMS, Granot notes or dashboard clicks. Preserve the existing server Last interaction sort and contact-credit rules.

### Phase 1 acceptance and completion gate

Verify dollar/date/split aggregation over all records, rep/Owner/Manager permissions and cross-rep denial; current assignment changes; exclusions for 7/8/9; missing/dangling Booking links, real zero and unknown amounts; midnight/week/month/year/DST boundaries; live invalidation/reconnect; move-date ordering with ties/nulls over multiple pages; combined search/filters and URL round trips; relative time/null presentation; unchanged cadence, closed periods and Call Lead move-date policy.

Run required typecheck/lint, meaningful focused/unit and local-replica checks, and relevant UI/browser/DTO validation. Check relevant full CI and review findings. Update matching Service docs and mirrored contracts, open scoped PRs and **merge Phase 1 to `origin/main` in both repositories as needed**; refresh/reconcile both worktrees against main afterward. Verify the normal deployment workflow and deployed reads/UI when credentials/capabilities permit; report actual evidence and any limit, never assume a green merge proves the UI. No separate production data backfill or policy PATCH is authorized by this brief. If a required migration/write needs additional approval under repository policy, prepare the concrete safe change before requesting it.

Only proceed to Phase 2 after Phase 1 is complete and merged. The attached Booking money source is already specified; investigate and implement that join rather than treating the earlier missing-formula concern as a blocker. Surface any actual unresolved linkage/eligibility ambiguity with evidence without disguising incomplete work as complete.

## Phase 2 — Pool discovery, prototype and approval-ready recommendation

After Phase 1 merge, fetch new `origin/main` and work against that completed desk. **Do not implement or merge the Pool feature, or mutate production Pool Leads, before Owner approval.** Read-only discovery scripts/tests and design documents are in scope; keep experiments local, safe and reviewable.

### Business requirements to design

All Reps, Owner and managers must see Pool Leads **regardless of receiver_agent/assigned rep**. Add a future **Pool** filter next to New/Quoted/Other. A Pool Lead has **one daily call requirement that any eligible Rep can fulfill**, shared across Reps, not a separate requirement per viewer. Design simultaneous work, completion deduplication, caller attribution, permissions, call qualification, working-day/calendar rules, and transitions into/out of Pool. Preserve ordinary assigned-lead behavior.

The Owner proposes conservative **current month through the current New York day** discovery through Estimates in Process, Priority Pool, Submit, accumulating idempotently. The earlier proved form documentation identifies **FUSTATUS=9 as Pool** and FUSTATUS=10 as ALL. Verify that against the current actual form and returned rows; record evidence. Do not assume that documented selector value by itself proves canonical Lead priority/membership semantics or the returned row representation. Codes 2/3 Daily are not Pool. Priority 9's exclusion from Phase 1 potential dollars remains in force until separately revised.

### Collector and lifecycle context

The newer Estimates path is a separate entry path inside the existing HTTP collector module, sharing authentication/account lease. It runs at **08:00, 13:00 and 18:00 America/New_York**, Open Date yesterday through today; Granot webhooks remain active. The older Leads & Advertising path stays intact. The new table has no old numeric `no` column; blindly reusing the old parser drops its rows.

Current Estimates request: GET `wc.dll?mv~estprocesswc~<session>` then POST `wc.dll?mv~estprocessret~<session>`; STATUS=V9, TYPEDTE=OPEN, DATE1/DATE2, FUSTATUS=10, USER empty, DEPT=ALL, TYPE=V1, SORT=V6. Current collector fixes ALL; implement a read-only Pool prototype based on verified form controls, not a guessed alternate endpoint. Existing priority parser extracts numeric `Prior: <digits>` from follow_up. Confirm Pool output, source routing and identity fields.

Measured historical requests of 90/45/15 days returned no recognized Follow-Up table; seven-day partitions succeeded. This is observed behavior, not a universal hard limit. Partition current-month discovery if necessary, handle pagination, prove completeness, distinguish an empty result from schema drift, and avoid truncation. Shared account lease applies to every Granot login/collector, including prototypes.

Review arbitrary priority changes and routine date-window efficiency. Open Date is not a proven modified-since cursor: a yesterday/today scan cannot guarantee capturing changes to older open Leads. Recommend overlapping recent runs and an appropriately bounded rotating sweep, with quantified traffic, freshness, retry/recovery and safe no-op rules. Do not skip solely because a job or priority was seen before; receiver and other facts can change. Preserve accepted-fact ordering, prospective cadence, 2 ↔ 3 same-workflow periods and closed/no-reopen behavior.

### Match before recommending a model

Compare normalized Job Number and existing canonical identity across **both Lead models**, duplicates/cross-model collisions and official Booking anchors. Report unique exact matches, ambiguous/multiple matches, cross-model matches, unmatched rows and insufficient identity. Inspect examples where a Pool row matches an existing Lead with another priority. Do not assume Pool jobs are all unique or create a second Lead for a known job.

Recommend reusing an existing Lead with explicit Pool semantics, separate membership/workflow representation, or a new model based on evidence. Cover ownership, indices, source attribution, admission, canonical mutations, shared call completion, transitions, assignment protection, query permissions, DTOs, live invalidation, UI and rollback. A UI filter alone cannot grant shared Rep access safely.

**No Pool creation may sync to Master Leads.** Specify a durable exclusion rule and what happens on later transitions or matches to an existing synced Lead; do not merely skip one enqueue. Ordinary backfill updates already use canonical source_lead sheet sync; Sales Rep is exported, while the managed sheet currently has no Granot priority column. This brief does not authorize adding sheet columns or changing ordinary sync.

**Approval gate:** any strategy reconciling Pool rows with existing Leads requires Owner approval. Until approval, do not create, reprioritize, reassign, enroll, sync, deduplicate or reconcile production Pool records; do not alter production cadence configuration or effect flags. Return a concrete reviewable recommendation rather than asking for abstract permission before investigating.

### Phase 2 deliverables and stopping point

Return an actual discovery/matching prototype with verified selector/parser findings, completeness evidence and a redacted collision summary; a data model and transition design; shared daily-call and visibility specification; potential-money interaction and sheet exclusion strategy; recommended collection windows/cadence findings; implementation phases, meaningful acceptance tests, migration/rollout/rollback plan; and the exact Owner decisions required. Save an approval-ready specification/summary and identify its location/branch. Stop at Owner approval **before Pool feature implementation or production mutations**.

## Source map for both phases

All paths are relative to the named repository. Inspect actual current implementations before editing.

### vantage-movers-server

- `docs/knowledge/granot-priorities-and-rep-desk.md`: original binder, move-date, last-interaction spec and proved Pool selector. Apply precedence above; its pre-PATCH production-state statements are historical.
- `docs/knowledge/services/agent-allocation.md`, `bookings.md`, `insights.md`: official booking truth, allocation/cents/date/cancellation conventions. `docs/knowledge/services/daily-operations.md`: live UX/reference, not a replacement Rep auth boundary.
- `docs/knowledge/sales-outreach-lifecycle.md`, `services/sales-outreach-desk.md`, `docs/sales-outreach-desk/`: cadence, permissions, contracts and approved decisions. Read nested AGENTS guidance when editing those workspaces.
- `src/models/BookedLead.ts`, `FormLead.ts`, `CallLead.ts`; `src/services/agents/agentAllocation.service.ts`; `src/services/insights/{facts,metrics,period,otherReports}.ts`; `src/services/domainCommands/bookings.ts`: investigate binder source, stable-id aggregation and committed change signals. Existing owner-only Insights is not a Rep endpoint to expose wholesale.
- `src/services/salesOutreach/reads/{service,queue,queueQuery,queueCursor,deskStore,detail,present}.ts`; `src/validation/v1/salesOutreachReads.ts`; `src/routes/sales-outreach.routes.ts`; `src/models/salesOutreach/`: read boundaries, filters, pagination/projection/index contracts.
- `src/services/salesOutreach/live/{stream,publish}.ts`; `src/models/salesOutreach/liveEvents.ts`: reuse role-scoped live behavior and committed invalidation.
- `src/services/salesOutreach/subjects/{policyMapping,periodPlanner,sync,feed}.ts`; `contacts/receiverFill.ts`; `engine/evaluate.ts`; `enrollment/{classify,service,admissions}.ts`: priority/assignment/admission/cadence and interaction semantics to preserve.
- `docs/knowledge/estimates-in-process-update.md`, `services/granot-http-collector.md`: newer Estimates build contract and older collector documentation; some rollout-status statements are historical.
- `src/services/granotHttpCollector/estimatesInProcess.ts`: new request/parser/row adapter and Registry partitioning; `index.ts`: older collector plus shared sessions; `estimatesCron.ts`: New York hours/date window; `runWorkflow.ts`: durable runs, sealed plans, lease and recovery; `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`: existing planning/matching/canonical receipt seam.
- `src/routes/granot-automation.routes.ts`, `granot-automation-cron.routes.ts`; `src/models/GranotAutomationRun.ts`; `vercel.json`: run API, cron registration and durability. Existing reviewed-Estimates Owner apply is not approval for Pool apply.
- `src/services/granotLifecycle/{identity,leadDesiredState,sourcePolicy,automationCompatibility}.ts`; `src/routes/granot-webhook.routes.ts`: canonical identity, protected Lead effects, source eligibility and complementary webhook path.
- `src/services/sheetSync/{noSyncLead,sheetSyncCoordinator,sheetSyncOutbox.service}.ts`: explicit no-sync and normal canonical sheet outbox behavior.
- Existing Estimates collector/cron/reviewed/pending-apply unit and replica tests, outreach reads/queue/live tests, `subjects/priorityPeriods.test.ts`, and `ops/sales-outreach/*replica.ts`: extend meaningful regressions rather than rewriting expectations to match a bug.

### vantage-admin

- `components/outreach-desk/views/{my-view,team-view,lead-panel}.tsx`: Rep metrics, queue/tabs/card/row and panel presentation.
- `components/outreach-desk/outreach-desk-copy.ts`; `lib/format.ts`; `data/{desk-url,use-desk-url,use-desk-reads,use-desk-live}.ts`: wording, dates/relative time, URL state, reads and shared live connection.
- `components/automations/granot-updates/`: current Estimates date/check/approval UI context.
- `lib/insights/allocation.ts` and existing insights money/date display utilities: reuse formatting conventions without inheriting Owner-only access.
- `tests/outreach-desk/` and mirrored server schemas/policy contracts: client/server agreement, permissions, navigation, fixtures and browser regressions. Update both sides coherently.

## Operating boundaries and final handoff

Use managed credentials and authenticated APIs; never print secrets or read secret .env files. Never experiment against production Mongo. Rehearse with the approved local replica, TEST_MODE=true/testvantagemovers and external writes disabled; confirm environment before running scripts. Do not send messages to customers/Reps, seed paid sources, create official Bookings for testing, scrape Booked Jobs/V15, implement automatic three-day priority moves or change unrelated UI/policy.

User authorization covers Phase 1 implementation and merge; do not ask again merely to perform that work. Honor explicit repository approval gates for separate irreversible production actions, with concrete changes ready to review. Phase 2 approval boundary is mandatory. If blocked, state the specific missing dependency and continue independent authorized work rather than claiming success.

Final response must distinguish **Phase 1 shipped/merged** from **Phase 2 ready for approval**. Include PRs/merge SHAs, validation and deployment evidence, the attached-Booking potential-dollar source and coverage, unresolved decisions, and links to the Pool prototype findings/model/recommendation. Persist evidence and specifications in tracked documentation so another session can continue without this chat.
