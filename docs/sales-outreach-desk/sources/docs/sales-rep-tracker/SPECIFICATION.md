# Sales rep tracker and Owner control plane specification

Prepared 29 September 2026 from the checked-out Vantage code and documentation. This document specifies proposed implementation; it does not claim deployment or live Granot validation. The companion [agent prompt](AGENT-PROMPT.md) is ready to give to an implementation agent.

## 1. Product outcome and scope

Build a shared, real-time sales workspace around the existing Outreach record. A Rep can move assigned Outreach into My Tracker, work calls, record outcomes and notes, enrich the Case File from Granot, follow Owner instructions, and pursue personal goals. The Owner sees every Rep's workload and activity, current calls, move details, progress against instructions, potential earnings, and the distribution of lead cost.

The satisfying loop is: receive work → choose a job → reach out → record outcome → capture a useful summary → fulfill the next action → see progress. The Owner can intervene on the same record without switching to a separate messaging product.

Include storage, APIs, authorization, recovery, and UI. Exclude a new dialer, payroll disbursement, automatic Granot edits, new call qualification rules, or automatic official Bookings/Cancellations. Internal messaging is in-app; external SMS/email delivery is not implied.

## 2. What already exists

These findings describe source inspected for this specification. Some Service summaries lag current routes; use the executable access checks and their tests when reconciling discrepancies.

| Area | Existing foundation | Required extension |
|---|---|---|
| Outreach | One record per subject; strict `responsible_agent_id`, independent follow-ups, closure, notes, revisioned commands, Case File page, My Outreach/Closed/Overview | Tracker membership, Rep activity controls, summaries, instructions, goals |
| Rep access | Signed dashboard Rep identity bound to an Agent; scoped reads; Reps can complete, snooze, or re-date their own follow-ups within restrictions | Explicitly authorize new Rep commands without granting Owner commands |
| Calls | RingCentral Call Interactions, reviewed temporal Rep identity, `live_call`, Owner `call_progress`, activity coverage | Rep-reported call attempts with source labels and deterministic reconciliation |
| Owner views | `/overview/team`, `/overview/activity`, `/overview/outcomes`, roster, per-Rep drills | Live working panel, instructions, goal progress, assignment-cost breakdown |
| Real time | CSI version-2 SSE invalidation; scoped Rep topics; authoritative refetch; reconnect/visibility recovery | Watch new committed collections and add safe topics and scoped read models |
| Granot | HTTP network/user login, Cheerio report-table parsing, session retry, durable automation runs | Verified individual Job Page retrieval and complete supported-section parsing |
| Case File | Existing assembler, frozen analysis evidence, human Case File tab, Granot report move summary | Durable Job Page snapshots and capability-gated human view, following the existing proposal |
| Daily Operations | Mongo event/day projections, New York day totals, Lead Message counts, SSE | Reuse selected metrics in the control plane; Rep-safe projections |
| Cost | Stored `cpl`, `spendBasis`, cohort aggregation by current `receiver_agent` | Separate distribution by current Outreach assignment, with transfer history |
| Sales credit | Official Booking `agent_allocations[].binder_amount` and distinct-booking metrics | Configured compensation policy and auditable earnings; no verified payroll ledger found in the inspected slice |
| Messaging | Owner Rep Nudge is explicit external messaging with history; `NotificationDelivery` is operational email delivery | Durable in-app threads, actionable instructions, per-recipient unread state |

### Explicit amendments to prior contracts

1. Outreach Intelligence's one-list decision remains: **My Tracker is a mode/filter of My Outreach**, backed by the same record and full-page route. Moving an item out of the default sales outreach view means changing membership, not closing or copying it. The Owner's All Outreach still includes it.
2. Existing Rep permissions do not currently authorize general start/end call or record-note commands. This specification adds narrowly scoped Rep attempt, note, tracking, and Granot-refresh commands. Do not expose the Owner command dispatcher wholesale.
3. The previous Case File track was reserved and unbuilt. This request brings it into scope, subject to its retrieval and identity release gates.
4. Existing lead-cost analytics use Receiver agent, not Assigned rep. Preserve those reports; introduce a separate assignment-cost view with its own label and reconciliation.
5. Binder allocation remains sales credit. Actual earnings need a separately configured compensation rule.

Mongo remains the system of record under ADR-0001. The existing Granot proposal records an ADR-0003 `leadno` versus Tracking Reference drift: reverify current payload/tests and amend the ADR before finalizing identity changes; do not silently rewrite the running identity contract.

## 3. Product defaults

These are proposed decisions that make the requested behavior implementable. They are not assertions about current business policy.

- **Tracking:** the currently assigned Rep can Track/Return to outreach; the Owner can do either and can assign first. A Rep cannot claim somebody else's or unassigned work without an explicit future claim policy.
- **Time:** America/New_York business dates; calendar week Monday–Sunday; calendar month; UTC instants for events. Goal windows are explicit, start-inclusive/end-exclusive, with the displayed time zone.
- **Call targets:** “Call 15 leads today” counts distinct eligible Leads with a completed outbound attempt during the target window, not 15 button presses or 15 tries to one Lead. Offer an explicitly labelled Attempts target for repeat attempts. Number-only Outreach can count toward Attempts but not distinct Leads.
- **Outcomes:** Answered, Rejected, No answer, Busy, Failed, Abandoned. Rejected means the customer declined during this attempt; it does not mean a Booking was cancelled or an instruction was rejected. Answered and Rejected encourage a summary, but allow “Add later.”
- **Read status:** reading is separate from acknowledgment and fulfillment. Free-form actionable instructions require explicit completion; structured instructions can complete from matching committed evidence.
- **Money:** show known opportunity value, booked binder credit, estimated commission, earned commission, and paid commission as different values. Configure rates and recognition rules before displaying earnings as money made. Paid commission requires payment evidence and may be unavailable in this scope.
- **Lead-cost visibility:** Owner only, preserving current Case File permission boundaries. Reps see their own performance and goals, not other Reps' income or company cost details.
- **New Leads:** Reps see scoped new/assigned Lead numbers in real time. Company-wide counts remain Owner-only unless a later explicit aggregate-only permission is introduced.

## 4. User experience

### Rep workspace

Retain My Outreach, Closed, Overview, and Guide. Inside My Outreach, expose **All my work / Sales outreach / My Tracker** as mutually clear modes, preserving existing search and filters. A tracked job can still require attention. Server totals and list drills must agree.

My Tracker cards show customer identity, Job Number, assigned Rep, move date, origin/destination, move distance with units and source when known, Granot freshness, current attempt state, next action, unread instruction count, and available opportunity value. Keep no-Lead and no-Granot states useful.

Selecting a card opens the existing `/sales-intelligence/outreach/{id}` page. Extend its Work rail with a large **Reaching out** action, attempt timer/status, outcome actions, summary composer, next action, Owner instructions, and Granot URL/Refresh control. Keep Case File, Conversations, and Analysis distinct. Notes expand inline for both roles and preserve author/time/edit history.

Rep Overview shows calls attempted, distinct Leads contacted/attempted as separately labelled measures, answered/rejected outcomes, active calls, current opportunity value, booked deals/credit, configured earnings, goals in progress, completed goals, and scoped new Leads. Every metric has a period, source/coverage state, and a drill into its contributors.

### Owner workspace

Extend the existing Overview into the control plane, retaining links to Daily Operations. Its first screen answers: what happened today, who is working now, which jobs need intervention, and what is the financial exposure?

Use a day strip for Leads today, texts sent/held/failed, completed attempts, provider-confirmed calls, official Bookings, and goal completions. Below it, show live Rep rows/cards with current customer/job, reported versus verified call state, elapsed time, outcomes, target progress, assigned workload and cost. Selecting a Rep opens the existing Rep drill with Tracker mode and an instruction composer.

The Owner can expand an Outreach activity row to see notes, attempt history, Granot sections, move route/date/distance, potential value, and outstanding instructions. **Send instructions** creates a durable actionable item addressed to a Rep. Assignment plus instruction can be submitted together atomically. General encouragement is a message, not automatically a task.

Provide company → Source Company → Source Granularity → Rep breakdowns for day/week/month assignment cost, with Unassigned, unpriced counts, transfer explanations, and drillable Leads. Do not animate a reassignment as new company spending.

### Purposeful motion and accessibility

After the server confirms a transition, slide Track into My Tracker with an Undo that performs an authorized inverse command; use a neutral return animation for Return to outreach. Official Booking may use a short positive completion animation; rejection/failed attempts use restrained feedback; official cancellation uses a quiet state change. An attempt result does not itself remove the Outreach card.

Goal achievement gets a brief progress completion animation and a persistent achievement entry. Animate only a newly observed achievement ID; reconnecting or opening another tab must not replay celebrations. Use short motion, no sound by default, reduced-motion alternatives, keyboard access, visible focus, semantic live announcements, and no color-only meaning. Live updates must not move focus, overwrite drafts, or reorder the card under the pointer.

## 5. Tracking, attempts, and notes

### Tracking state

Proposed record fields: `tracking {mode: outreach|tracked, started_at, started_by, revision}` plus audited transitions. Reuse the existing Outreach identity and `responsible_agent_id`; do not create a second Lead/job. Closed records remain in Closed with their tracking history. Reassignment transfers operational responsibility and preserves history; former Rep access follows existing scope rules, not tracker membership.

### Rep-reported attempt state

Create a durable attempt record with dataset, Outreach ID, Lead reference when present, Agent ID, trusted actor, start/end instants, outcome, optional summary, revision, evidence source, optional Call Interaction link, and correction history.

`Reaching out → in_progress → completed(outcome)`; Abandoned is terminal and earns no progress. A stale manual attempt becomes `needs_resolution`, never a fabricated call completion. Proposed stale threshold: four hours, consistent with the current live-call horizon; configurable through existing policy mechanisms. Permit one active manually started attempt per Rep; use a unique/fenced server constraint and offer Resume/End existing attempt on conflict.

- Reaching out commits first, immediately becomes visible to the Owner, and says **Rep reports reaching out** until telephony evidence exists. It does not place a phone call.
- Answered/Rejected are “end attempt and record outcome” actions. A long connected call can remain in progress until the Rep ends it; provider connection supplies the verified on-call indicator.
- No answer and Busy are completed attempts. Failed and Abandoned do not count toward the default distinct-Lead goal. A summary edit cannot create a second attempt or progress contribution.
- Never overwrite `live_call`, fabricate Call Interactions, or overload Owner `call_progress`. Present both sources and disagreement honestly.
- Associate manual attempts with provider calls only through exact, unique account/Rep/Number/time evidence using reviewed temporal Rep identity. Ambiguity stays unlinked. One provider interaction must not be counted twice because a manual record also references it.
- Default goal progress may include completed Rep-reported attempts, clearly labelled. A `provider_verified` goal excludes them until matched. Reconciliation merges evidence under the same contribution identity instead of awarding twice.
- Record restriction/closure checks before starting. Do-not-contact and other existing call blockers apply to Reps. Official closure wins racing commands. Notes remain permitted only as authorized by current scope.

Notes are bounded plain text, authored and timestamped; render escaped. Separate rep summary, general note, Owner instruction, Granot note, and AI summary by type and source. Do not let a note reset meaningful-contact clocks or satisfy evidence-based obligations. Existing follow-up completion must still go through its canonical service.

## 6. Internal messaging and notifications

Proposed records: `InternalThread`, `InternalMessage`, `SalesInstruction`, and recipient delivery/read state. Use Outreach-linked threads and Rep-level threads for targets such as “Call 15 leads today.” Author and recipients derive from trusted identities. The Owner can address eligible roster Reps; Reps can reply to the Owner in authorized threads.

An instruction has recipient, optional Outreach/follow-up reference, body, due time/window, typed completion rule, expected revision, state, and completion evidence. States: `open`, `in_progress`, `fulfilled`, `cancelled`, `expired`; `acknowledged_at` and read state are separate. “Overdue” is a derived display state until the instruction's completion window actually expires. A decline/request-for-help is a reply that alerts the Owner, not silent cancellation.

| Instruction | Fulfillment rule |
|---|---|
| Call this Lead | Eligible completed attempt on the exact referenced Lead after issuance, by the instructed Rep, within its window |
| Call 15 Leads today | 15 unique qualifying Lead contributions during the stated window; choose Include today's earlier work explicitly, default off |
| Complete this follow-up | Successful canonical completion of the referenced follow-up |
| Refresh Granot | Successful verified publication of the specified job's new retrieval result, not queue acceptance |
| Add summary | Saved nonblank summary on the referenced completed attempt |
| Free-form action | Rep explicitly submits completion with a note; basis is `rep_confirmation`, visible to Owner |

Show remaining work and evidence, e.g. `11 of 15 · 4 left`. Counts come from server contributions; changing instruction wording never changes its goal rule. Editing a target/window is a versioned command with a visible recalculation. Cancelled instructions earn no further progress. Expired ones retain achieved progress without pretending success.

Notifications are durable per recipient with a unique `(recipient,event,notification_kind)` identity. Persist unread state independently from the socket. Provide unread/all and actionable/completed filters. Mark-read uses a specific item or sequence watermark; a concurrently arriving item after the watermark remains unread. Mark all read does not fulfill work.

Create notifications for assignment, actionable instruction, reply/summary requiring attention, completion, failed Granot work, and achieved goal. Active-call activity belongs primarily in the live feed; avoid flooding the inbox with every timer tick. Fulfillment resolves the corresponding actionable notification while preserving unread completion updates for the Owner. New comments on fulfilled work can still be unread.

Authorizations are checked on every read/mutation and after reassignment. Historical notifications may remain as sanitized receipts, but must not disclose a record the recipient can no longer access. A thread participant list is not a permanent bypass of Outreach scope.

## 7. Goals, earnings, and fair counting

Rep personal goals and Owner-assigned targets use one contribution engine, with different creator/ownership permissions. A personal goal supports calls/attempts, distinct Leads attempted, official deals, and earnings over a chosen time window. Preserve met-goal history and show concrete contributors, remaining amount, deadline, and coverage.

Store goal metric, target, unit/currency, window, Agent, creator, evidence requirement, revision, status, and contribution-rule version. Progress is a sum/count of deduplicated eligible contributions; `remaining = max(target - progress, 0)`. Overachievement remains visible. One event can legitimately contribute to a personal goal and an Owner instruction; never increment the same goal twice for retries or transport replay.

For a deal goal, count each official Booking once for the Rep with a nonzero allocation; team deals count distinct Bookings. Label split credit. A Granot Priority 5, tracked job, quote, or call result is not an official deal. Cancellation removes net-deal credit and produces a reversal entry. Attribution follows Booking allocations at the credited event/revision, not the Outreach assignee at read time.

Build a versioned Owner-managed compensation rule supporting a percentage of the Rep's official binder allocation, optional fixed amount per credited Booking, effective dates, currency, recognition event, and cancellation/adjustment treatment. No default numerical rate. Represent money in minor units with explicit rounding. Reuse allocation splitting rules; do not split a split allocation again. Missing or overlapping rules must yield unconfigured/invalid status, not guessed earnings.

For the initial proposed recognition model, commission is earned at official Booking creation and reversed/recalculated on official Cancellation or allocation correction. The Owner must configure this model and actual rates before activation. A different recognition event requires an explicit policy version. Preserve historical rule snapshots and adjustment entries; do not silently reprice old earnings after a rate edit. Payment is separate and remains unknown without a payment record.

Opportunity amounts are distinct: Granot quoted move value is observed gross value; potential binder is shown only if supported by explicit evidence; projected Rep commission requires both a supported basis and configured rule. Owner profit needs a cost/margin model and must otherwise read **Not configured**. Use no arbitrary probability weighting. Show known total plus unknown count, currency, source, and observation time; deduplicate by verified move/job identity. Jobs missing that identity cannot be assumed unique in a company total.

Achievement notifications are emitted once per achievement transition. Reversals or corrections can put a goal below target and mark the achievement adjusted; keep historical achievement evidence and show the correction instead of silently erasing it or replaying confetti. Expiry uses the goal's calendar rules, including DST.

## 8. Granot Job Page acquisition and Case File integration

Adopt the existing [Granot Case File recommendation](../case-file-granot-recommendation-2026-09-29.md), especially its complete field/coverage matrix and storage model. The production collector currently parses report tables. Follow-up investigation using the user-supplied agent credentials verified individual Charges-page acquisition for P5565230 in two fresh sessions: reuse the collector's network login and user login, then POST the actual main-page QSEARCH form with the Job Number. [The sample and retrieval check](GRANOT-TEST-EVIDENCE.md) and [live comparison](granot-live-check.json) record the evidence. The old tokenized URL failed across sessions; general job/template coverage, account/Record Link verification, and second-job isolation remain unverified.

### Acquisition flow

1. Authorized Rep opens an assigned Outreach and provides a Granot Case File URL, or clicks Refresh for an already verified Job Number. Owner can do this across authorized records. Follow-up-only involvement does not grant new job attachment authority.
2. Server validates access and locator syntax, extracts only reviewed safe job/navigation hints, and creates a durable parse job. A tokenized URL is not durable identity. Do not log or echo session tokens.
3. Reuse/refactor the existing authenticated HTTP session boundary. Credentials are server-only `GRANOT_NETWORK_USERNAME`, `GRANOT_NETWORK_PASSWORD`, `GRANOT_USERNAME`, `GRANOT_PASSWORD`, as documented in the environment inventory. Rep UI shows authentication/setup failure, never secrets.
4. Reauthenticate if needed, then resolve/open the job through a verified read-only navigation sequence in that session. The observed path for P5565230 is the main-page `mv~searchret~<fresh-session>~QSEARCH` form with `VALUE=P5565230`; it directly returned Charges HTML. Discover that form from the authenticated page and validate the returned job rather than replaying the old URL. If a URL provides only a session token and no recoverable job identity, use the linked Outreach Job Number or request the Job Number; never treat the token as that identity. Enforce configured host/account, allowed operations, redirect safety, limits, account lease, bounded retry/backoff, and redacted diagnostics. An allowlisted host alone is insufficient: Granot has state-changing GET actions.
5. Verify account, job identity, Record Link/Lead/source scope, and current Outreach authority. Phone equality alone never attaches a job. A mismatch goes to an Owner-visible conflict; no publication to the wrong Case File.
6. Parse deterministic HTML with Cheerio, including input values, selected options, checkbox presence/state, tables, and textarea contents. Do not run embedded scripts, submit editing forms, or treat a login page as an empty job.
7. Persist immutable sanitized evidence/snapshots and upsert the current verified head for `(dataset, configured account, resolved job, section)`. Publish the human Case File view after rechecking permission and identity revisions. Emit committed invalidation and job-result notifications.

### Exact data and coverage

Cover verified sections for job/customer identity, contacts, source and Rep, pickup/delivery addresses and dates/windows, route/distance, service/move type, volume/weight/size, inventory items and quantities, rates/charges/discounts, estimate/payment/balance, access conditions, packing/storage/other services, notes/remarks, and operational/carrier details where actually retrieved. Preserve row-level values and units; do not flatten a charge table into one estimate or omit inventory because it is embedded in Charges.

Each field retains raw display where relevant, typed value when verified, source locator, parser version, observation time, and state: present/blank/unknown/unavailable/invalid/redacted. Section coverage is complete-for-page/partial/not-requested/not-available/failed/unsupported. No inferred address, distance, amount, date, or service flag may be presented as parsed fact. Distinguish Granot-reported miles from a separately sourced route calculation; unknown distance stays unknown.

Upsert means one current verified head with versioned history. A failed or older-finishing job cannot erase/replace newer valid evidence. Equal content can reuse a snapshot while recording successful retrieval/freshness; explicit blank in a newer complete section can clear that source field. A missing/failed section retains its older successful evidence with stale/partial labels. Fence competing publishes by request generation and source revision where available; do not use completion time as proof of source recency.

The human Case File composes existing Lead facts, Granot evidence, conversations, notes, instructions, and labelled analysis. Preserve original contact provenance and conflicts; no bulk Lead overwrite. Parsing alone never changes official Booking/Cancellation, creates a Lead, corrects a Record Link, or bypasses the approved lifecycle apply boundary. If new evidence is admitted to AI analysis, freeze the exact evidence references in the run and retain existing budget/admission rules.

### Required retrieval proof

Before enabling live acquisition, reproduce safe lookup in a fresh session for one authorized job, navigate a second job in the same session, and reopen the first in another session. Test wrong identity, expired auth, expired pasted link, schema drift, partial tabs, and original-response versus rendered-DOM differences. Capture sanitized fixtures and expected extraction values. All supported page sections must have fixtures and coverage assertions. Unsupported sections are visible limitations, not an assertion that “all Granot information” was fetched.

If safe Job Page retrieval cannot be established, keep the rest of the tracker shippable and the Granot capability honestly unavailable. Do not replace the promised parser with fabricated data or call report-table parsing complete Job Page support.

## 9. Daily metrics and lead-cost semantics

Reuse Daily Operations' authoritative facts. Its formal specification is physically at `vantage-main-server/internal_hidden_docs/daily-operations/daily-operations-specification.md` in this checkout; some catalog links still point to `docs/daily-operations/`.

| Metric | Definition |
|---|---|
| Leads today | Daily Operations: non-duplicate Form + Call Leads created on New York day, excluding Unmatched Call Leads |
| Texts sent | Existing Lead Message accepted-immediately/sent/delivered counting; no double count through delivery transitions; held/queued/failed separate |
| Bookings today | Daily Operations official Booking writes today; this differs from book-date sales reports |
| Calls | Existing activity read counts canonical terminal external interactions with reviewed attribution and coverage; show Rep-reported attempts separately |
| Current calls | Existing `live_call` plus separately labelled active Rep attempt/Owner call state; one row can show disagreement |
| Receiver-attributed spend | Preserve `overview/spend.ts`: stored CPL over the existing Lead cohort, by current `receiver_agent`; duplicate/no_sync exclusions and unpriced handling preserved |
| Assigned lead cost | New distribution of that same cost cohort by current canonical Outreach `responsible_agent_id`; no Outreach/unassigned → Unassigned; tracking membership does not change eligibility |
| Goal/earnings progress | Durable contributions under sections 6–7, with period and evidence policy shown |

Do not force Daily Operations Lead totals to equal the spend cohort: their exclusions and purposes differ. Explain the difference in metric help/drills.

For assignment cost, each eligible Lead appears once, keyed by Lead model and ID. Resolve canonical Lead Outreach; never allocate the same Lead again through Number Review or another attachment. Multiple/conflicting canonical assignments are an explicit unresolved bucket, not arbitrary attribution. Require `company = sum(rep buckets) + unassigned + unresolved` to the cent for every selected cohort. Group first by actual Source Company/Source Granularity IDs, using label snapshots for display.

On A → B assignment, subtract that Lead's cost from A and add to B; company total stays unchanged. Record transfer history with prior/new Agent, actor, time, and Lead/Outreach revision. Day/week/month filters select **Lead creation cohorts**, then show their current assignment as of the response. This means an old month's distribution can change on reassignment; label it “Current assignment of Leads received in this period.” A separate assignment-event history answers who held the work at a past time. Never present current assignment as historical attribution.

Preserve `spendBasis` treatment of rate/legacy/unpriced/zero; no reprice from today's CPL Schedule. Represent incomplete pricing as a known subtotal plus unpriced Lead count. New Leads, CPL corrections, Receiver changes, and Outreach assignment changes must invalidate relevant cost projections; today's CSI watch list alone does not cover all Lead mutations.

For rep-safe daily counts use server filters, not client filtering of the Owner payload. Reuse underlying Daily Operations services/facts rather than granting Reps the Owner `/daily` API or duplicating event ingestion.

## 10. Server and API design

Proposed models are implementation guidance, not currently shipped contracts. Reuse an existing collection/service when semantics match; do not overload `NotificationDelivery`, Owner Rep Nudge, or Owner instruction protections with incompatible in-app state.

| Aggregate | Required durable facts |
|---|---|
| Outreach tracking | Existing record identity, mode, responsibility, revision, audit |
| Sales attempt | Actor/Agent, subject, start/end/outcome, summary, evidence link, correction history |
| Internal thread/message | Scope, participants, immutable author/time/body revision, subject |
| Sales instruction | Recipient, typed rule/window, state, contribution/evidence references |
| Recipient notification | Event identity, recipient, read watermark/time, action state, safe deep link |
| Goal/contribution | Metric/target/window, dedupe identity, rule version, adjustment/achievement history |
| Compensation/earnings | Effective policy, allocation/Booking source revision, recognized and reversal entries |
| Granot retrieval/evidence | Fenced durable job, verified identity, snapshots, section heads, coverage |
| Assignment cost projection | Cohort/source/Agent buckets, versions/watermark, reconcilable contributors |

All writes validate trusted actor, scope, current revision, restrictions, and allowed transition. Use `Idempotency-Key`, strict Zod schemas, dataset fences, unique constraints, and the existing command ledger. Persist command result/audit plus durable downstream intent together. Worker effects are repeat-safe, leased, bounded, observable, and repairable. Browser callbacks and socket delivery are not reliable work queues.

Existing base is `/api/v1/admin/sales-intelligence`. Keep `/attention`, `/attention/capabilities`, `/outreach/:id`, `/outreach/:id/timeline`, `/outreach/:id/commands`, `/overview/team`, `/overview/activity`, `/overview/outcomes`, `/roster`, and `/live`. Preserve their current envelopes and authorization semantics.

Proposed additions under that base:

| Surface | Contract intent |
|---|---|
| `POST /outreach/:id/tracking` | Track/return with expected revision |
| `POST /outreach/:id/attempts` | Start; return attempt ID, revision, authoritative state |
| `POST /attempts/:id/commands` | Finish/correct/add summary; explicit command allowlist |
| `POST /outreach/:id/notes` | Scoped authored note without Owner privileges |
| `GET/POST /threads`, `GET/POST /threads/:id/messages` | Authorized conversation discovery/history/reply |
| `POST /instructions`, `POST /instructions/:id/commands` | Create/acknowledge/complete/edit/cancel with role rules |
| `GET /notifications`, `POST /notifications/read` | Cursor history, unread totals, item/watermark read |
| `GET/POST /goals`, `POST /goals/:id/commands` | Own personal goals or Owner-assigned targets |
| `GET /overview/tracker`, `GET /overview/assignment-cost` | Live attempt/goal/performance and Owner cost projections |
| `POST /outreach/:id/granot-refresh`, `GET /granot-refreshes/:id` | Async URL-assisted/known-job retrieval; no browser secrets |
| `GET /outreach/:id/case-file` | Authorized composed human view with field provenance/coverage |
| `GET/POST /compensation-policies`, `GET /earnings` | Owner configuration; own earnings reads for Rep |

Exact route names may follow existing conventions after review. Return authoritative updated state, revision, server time, allowed actions, and projection status/watermark. Lists use bounded cursor pagination, indexed filters, deterministic sorting, and honest pending/stale states. Unauthorized record reads remain nondisclosing; errors preserve drafts. Revision conflicts require refetch and intentional retry.

### Real-time contract and budgets

Extend existing SSE topic invalidation, retaining version compatibility and full resync on reconnect. Add topic mappings for attempts, inbox/instructions, goals/earnings, Case File, and cost; update Rep topic allowlists only for authorized surfaces. Payloads remain safe invalidation metadata; business data comes from scoped reads. Reauthorize on stream renewal and purge no-longer-authorized cached records on assignment changes.

The current Attention publisher runs every three minutes; invalidate-only cannot make that snapshot immediate. Live attempt, instruction, goal, tracking, and assignment panels must read current authoritative/projection data or merge revisioned server overlays without breaking snapshot pagination. Do not claim real-time behavior from changing a badge while the list remains wrong for minutes.

Proposed acceptance budgets under representative load: committed human action visible to both online parties at p95 ≤2 seconds; assignment-cost change ≤5 seconds; counts recover within one authoritative resync after reconnect. Retain a bounded visible-page fallback (existing 30-second pattern). Show last update/stale status if delivery is degraded. Measure with 50 roster Agents and 10,000 Outreach records, avoiding per-Agent queries. Granot acquisition is asynchronous and shows honest queued/running/completed/failed states, with no invented fixed completion promise.

## 11. Delivery slices

1. **Foundations and authority:** current-code audit, data contracts, explicit permission amendments, indices, migration/backfill plan, metric fixtures. No production mutations in discovery.
2. **Working tracker:** membership, Rep attempts/outcomes/summaries, Owner live panel, notes, scoped SSE and reconnect proof. End-to-end work with real persistence.
3. **Internal messaging:** threads, instructions, recipient unread state, durable fulfillment, notifications, reassignment behavior.
4. **Goals and performance:** contribution engine, personal/Owner targets, achievement/correction history, real activity/Booking integration, compensation configuration and earnings.
5. **Granot Case File:** safe retrieval proof, authenticated HTTP adapter, Cheerio section inventory, durable upsert/history, identity conflicts, human Case File integration. Parser fixtures can progress while access evidence is pending.
6. **Owner economics and day view:** Daily Operations reuse, assignment-cost totals/transfers, source breakdowns, live scoped new Leads, opportunity/earnings transparency.
7. **Polish and release:** mobile/keyboard/reduced motion, representative-load timings, multi-session acceptance, failure/recovery evidence, migration/rollback rehearsal and documentation.

Deploy additive server contracts before consuming admin changes. Backfill tracking as outreach mode without inventing attempts, instructions, read receipts, or historical earnings. Rebuild projections from durable evidence with reconciliation reports. New collections need explicit indexes/retention and safe rollback; old clients must tolerate additions. Preserve snapshots and audit on rollback. Live Granot acquisition and compensation activation each require their own satisfied prerequisites, not a global claim that every slice is production-ready.

## 12. Acceptance scenarios

1. A Rep tracks an assigned Outreach. It disappears from Sales outreach mode, appears once in My Tracker, stays in Owner All Outreach, and retains the same Case File and history. Return/Undo is auditable and revision-safe.
2. Reaching out from two tabs creates one active attempt. Owner sees it within the latency budget, correctly labelled as Rep-reported. Repeated requests and reconnection create no duplicate activity.
3. Rep finishes Answered with a summary; Owner expands it live. An edit updates the summary without counting another call. Rejected remains an attempt outcome, not a Cancellation.
4. A provider call arrives later and uniquely matches the attempt. Verified totals and goals do not double count; an ambiguous match remains unlinked and visible.
5. An abandoned browser session leaves a stale attempt requiring resolution. It does not count as a completed call or keep a Rep “on a call” forever.
6. Owner sends “Call 15 Leads today.” Reading/acknowledging leaves progress zero; four eligible distinct Leads leave 11. Repeating one Lead does not progress the distinct-Lead target. Fifteen emits one Owner completion notification.
7. A free-form instruction is completed with a note; action state resolves, evidence says Rep confirmation, and the Owner receives an unread completion. A reply alone does not fulfill it.
8. Mark all read races with a new message. The new message remains unread. Disconnect/reconnect restores notifications, work state, and correct totals without repeated celebration.
9. A Rep sets calls, deals, and earnings goals. Official split Booking credit follows allocations; missing compensation shows setup state. Cancellation/correction reverses contributions with history.
10. A $40 eligible Lead moves from Rep A to B. A decreases $40, B increases $40, company/source totals remain unchanged for every cohort containing it. Receiver-attributed analytics and Lead fields remain unchanged.
11. Duplicate/no_sync/unpriced/known-zero Leads behave according to the metric contract. Unknown money/coverage is never painted as a verified zero.
12. A pasted Granot URL creates a durable job; authenticated safe lookup verifies the intended job and upserts its sections. Reparse changes the current view without duplicating the job or erasing old evidence.
13. Wrong account/job, expired session/link, redirected action URL, login HTML, malformed money, partial page, and older completion are safely handled. Failed retrieval does not remove valid prior data or write official records.
14. A Rep is reassigned mid-call or mid-fetch. Current permissions fence publication/mutations; historical evidence retains attribution; no new access is granted by a cached UI or message link. Owner can resolve stranded work with audit.
15. Reps cannot read another Rep's earnings, inbox, costs, or unrelated jobs by changing IDs/query parameters. Follow-up-only access cannot start arbitrary work or refresh a different Granot job.
16. Owner Daily metrics agree with existing sources for the same period/definitions; Rep numbers use scoped reads. Goal counters, active-call rows, assignment costs, and new Lead counts recover after missed invalidations.
17. Day/week/month and goal boundaries work across midnight and DST. Missing capture periods remain partial/unknown. Server clocks determine eligibility.
18. Desktop and 390px layouts preserve drafts/focus through live updates. Reduced motion conveys all state transitions; closure and goal animations occur only after successful committed transitions.

Use unit tests for eligibility and money/date math, integration tests for concurrent/idempotent writes and authorization, parser fixtures for source extraction, and browser tests with Owner plus two Rep sessions. Test worker retry/recovery and projection rebuilds. Run package-required checks; for meaningful main-server implementation work use `pnpm finish-work --provider codex` as required by its AGENTS.md, respecting the child-worker guard. Documentation-only preparation of this specification does not establish feature test completion.

## 13. Source index and remaining evidence

All paths below are workspace-relative and were used to ground this specification or identify exact implementation seams.

- Vocabulary and authority: `CONTEXT.md`; `docs/agents/domain.md`; `docs/adr/0001-mongodb-system-of-record.md`; server/admin `AGENTS.md` and environment inventories.
- Current product: `outreach-intelligence-workspace/SPECIFICATION.md`; `vantage-admin/CONTEXT.md`; `vantage-admin/.cursor/rules/project-organization.mdc`.
- Outreach: `vantage-main-server/docs/knowledge/services/sales-intelligence-outreach.md`; `src/services/salesIntelligence/followups/commands.ts`; `src/services/salesIntelligence/repScope.ts` (server-relative).
- Access and API: server `src/services/salesIntelligence/auth.ts`; `src/routes/sales-intelligence-admin.routes.ts`; `src/routes/sales-intelligence-rep-access.test.ts`.
- Live updates: server `src/services/salesIntelligence/live.ts`; `docs/knowledge/services/sales-intelligence-live.md`; admin `lib/query/salesIntelligence.ts`.
- Cost and performance: server `src/services/salesIntelligence/overview/{spend,activity,team,outcomes,repDays,commands}.ts`; `docs/knowledge/services/agent-allocation.md`; `src/models/{FormLead,CallLead,BookedLead}.ts`.
- Granot: `docs/case-file-granot-recommendation-2026-09-29.md`; server `docs/knowledge/services/granot-http-collector.md`; `src/services/granotHttpCollector/{index,runWorkflow,lifecycleStatement}.ts` and collector tests. The existing recommendation contains the detailed field inventory and source references for Case File assembly and Granot identity.
- Daily Operations: server `docs/knowledge/services/daily-operations.md`; `internal_hidden_docs/daily-operations/daily-operations-specification.md`; `src/services/dailyOperations/{snapshot,recordDailyOperationsFact,recordDomainFacts,liveStream}.ts`.
- Existing UI seams: admin `components/sales-intelligence/outreach/outreach-page.tsx`; `components/sales-intelligence/desk/`; `lib/api/salesIntelligence.ts`; `lib/api/salesIntelligenceOverview.ts`; `server/auth/`.
- Distinct existing email delivery record: server `src/models/NotificationDelivery.ts`; do not mistake it for a recipient inbox.

Outstanding evidence is localized: Granot second-job isolation, account/Record Link verification, and complete supported-template fixtures; configured compensation rates/recognition rules; deployed stream/load measurements. Authenticated retrieval for the supplied job now has live evidence in [Granot test evidence](GRANOT-TEST-EVIDENCE.md). User-authorized agent credentials were loaded only into the probe process; no credentials or session tokens were copied into the generated artifacts. No external messages were sent and no Granot editing actions were invoked. Remaining gaps do not prevent implementing the independently testable tracker, messaging, goals, or cost-distribution foundations.
