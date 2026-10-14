# Pool desk, shared call coverage and authorization design

> **October 14 local continuation:** live Pool discovery and the shared-duty prototype are now complete. Use [current findings](POOL-FINDINGS-2026-10-14.md) and [current approval proposal](POOL-APPROVAL-2026-10-14.md). They supersede the historical access blockers, collection scope and unresolved code9 meaning below. Production Pool implementation remains gated.

**Status: proposed for Owner approval; design only.** October 14, 2026. The coordinator opened Phase 2 after both Phase 1 merges and deployed-read verification at 03:07:37 UTC. This design was inspected against server `beadfd11872acad0eede2774148fa11db651178c` and the shipped Admin desk. It grants no production mutation, reconciliation, enrollment, configuration change or feature implementation.

Authority: [overnight Owner brief](../knowledge/overnight-rep-desk-and-pool.md), current [desk contracts](../sales-outreach-desk/CONTRACTS.md) and [lifecycle](../knowledge/sales-outreach-lifecycle.md). The lifecycle and capture packet contain historical deployment statements; current source and the October 13/14 amendments govern the shipped baseline. The companion [Pool model](POOL-MODEL.md) owns canonical membership, provenance and matching; [collection and Sheets design](POOL-COLLECTION-AND-SHEETS.md) specifies durable sheet exclusion and collection freshness. Discovery findings must establish actual Pool identity/membership before any proposed permission or obligation can be enabled.

Evidence checked in current source: [ordinary detail authorization](../../src/services/salesOutreach/reads/detail.ts), [trusted desk actors](../../src/services/salesOutreach/auth.ts), [desk membership](../../src/services/salesOutreach/roster/rule.ts), [provider qualification](../../src/services/salesOutreach/engine/credit.ts), [goal count scopes](../../src/services/salesOutreach/contacts/repDay.ts), [working calendar](../../src/services/salesOutreach/engine/calendar.ts), [one-ordinary-call evaluation](../../src/services/salesOutreach/engine/evaluate.ts) and [role-scoped live filtering](../../src/services/salesOutreach/live/stream.ts). Existing ordinary APIs currently do not grant shared Pool access.

## Intended behavior and boundary

All authorized Reps, Owner and Managers see the **same eligible Pool Leads**, regardless of `receiver_agent`. One Pool Lead has **one shared daily call requirement**, which any eligible Rep can satisfy. Ten viewers seeing one Lead create one requirement, not ten. Completing it changes the shared state for all readers. Existing assignment remains a separate canonical fact; claiming, viewing or helping a Pool Lead never assigns its receiver.

Recommend reusing verified canonical FormLead/CallLead opportunities with explicit Pool membership, rather than constructing another Lead for each rep or each collector row. A verified Pool membership supplies the shared entitlement and work mode. A raw priority 9, browser filter, Granot selector, shared phone or newly scraped row supplies neither. Identity ambiguity, official Booking/Cancellation, Bad/Duplicate Lead and stronger closure gates are handled before shared access or work is activated. The model records blocked/review candidates separately; they do not become callable Pool rows automatically. Codes 2/3 remain ordinary Daily and priority 9 remains excluded from Phase 1 potential dollars.

A prospective Pool period can replace ordinary routine mode on an eligible open opportunity only under an approved transition policy. It must not run a second parallel ordinary daily quota for each receiver or viewer. Existing closed ordinary subjects and periods remain closed. Finding the same job in Pool is not authorization to reopen them. Original received age, accepted-fact ordering, restrictions, completed contact history, manual receiver protection and prior miss attribution remain intact.

## Server permissions before UI

The current ordinary detail read rechecks the canonical receiver before serialization; a foreign Rep id receives indistinguishable 404. Preserve that boundary. Add an explicit Pool entitlement predicate and dedicated Pool reads, rather than removing the receiver predicate from every desk read.

| Operation | Rep | Owner / Manager | Generic Admin |
| --- | --- | --- | --- |
| Ordinary queue/detail | Existing own-assignment scope | Existing coordination scope | Existing denial |
| Pool queue/detail | Current verified active Pool membership, regardless of receiver | Same current Pool reads, plus authorized review context | Denied |
| Pool advisory claim / own release | Proposed capability for eligible current desk Rep | Optional coordination release with reason/audit | Denied |
| Change Pool membership, reconcile identity, admit candidate, reopen a closed Lead | Denied | Owner only, after separately approved model/run; Manager does not inherit this authority | Denied |
| Claim as another Agent, edit earned call credit or mark a call complete in browser | Denied | Denied; provider correction follows existing audited evidence repair | Denied |
| Ordinary assignment or schedule commands | Existing authority only | Existing authority only | Existing denial |

Read eligibility follows the trusted actor/active desk-account boundary. Completion eligibility is stricter: the calling Agent needs reviewed provider identity at event time and all contact-evidence gates. Current Agent desk eligibility supports `outreach_desk=auto/on/off`, with `auto` based on Granot username or reviewed RingCentral link; it is not equivalent to confirmed callable provider identity. A permitted reader with no reviewed RingCentral association can see Pool and its honest coverage state but cannot invent provider credit. Owner/Manager read authority alone also does not earn a call credit.

Every queue request must enforce the membership predicate in the database, across search, move-date filters, sorting, counts and pagination. Every detail/claim request must re-read membership and Lead eligibility before serializing or writing. Cursors bind scope, filters, actor permission version and membership/projection revision. Reassignment alone does not revoke Pool access; membership exit, authoritative closure or actor revocation does. On exit, a Rep who is also the receiver may use the existing ordinary detail through its normal entitlement; another Rep receives 404. Do not silently continue serving the former Pool panel from a cached broad Lead endpoint.

Extend exact BFF method/path allowlists and signed actor forwarding with server contracts. Never trust a posted role, arbitrary `agent_id`, `receiver_agent`, `pool=true` or a client-supplied membership id as proof of entitlement. Cross-model ids must resolve to the canonical opportunity, not whichever collection returns first. Pool read access does not grant generic Lead CRUD, another Rep's binder metric, full private ordinary history or another customer's shared-number history.

## Proposed read contract and desk composition

These routes and names are proposals, not deployed endpoints:

- `GET /sales-outreach/pool/queue`: complete authorized Pool scope, existing search/priority-compatible presentation, move-date ranges/Unknown and server `move_date` ordering. Receiver may be displayed or searched as a fact; it never narrows the default shared entitlement. One canonical opportunity appears once.
- `GET /sales-outreach/pool/leads/:membership_id`: current membership/eligibility, callable contact/display facts, shared requirement, restrictions, current human-plan summary and uniquely associated Pool contact history. Revalidate the canonical opportunity behind the membership id. Do not require an ordinary outreach subject to exist as a condition for a valid approved Pool design.
- Later proposed `POST .../claim` / `DELETE .../claim`: idempotent, revision-checked advisory coordination only. No endpoint dials, sends a text, changes Granot, or marks the call fulfilled.

Expose `pool_queue` / `pool_detail` read readiness and role-scoped claim capability in desk capabilities. Until the backend advertises readiness, the future filter is unavailable; a UI tab alone never unlocks records. Version the server/admin DTOs and strict query schemas together, with generated examples and BFF tests.

Recommended row/detail fields:

| Group | Proposed contents and meaning |
| --- | --- |
| Identity | Membership id, canonical Lead model/id, opportunity key, display job/name/contact; no guessed match |
| Membership | Active interval, source/verification basis, policy version, revision, as-of; no raw credentialed collector payload |
| Work | `business_day`, shared `requirement_id`, required=1 or explicitly waived/not-required, completed=0/1 or unknown, open/due/close instants, status and verification/coverage reasons |
| Completion | Canonical event id, confirmed event time, completing/handling Agent display identity and attribution basis; one shared fulfillment |
| Coordination | Advisory claim holder, acquisition/expiry, revision; distinguish a claim from provider-confirmed completion |
| Presentation | Existing date-only move date and qualifying Last interaction timestamp; CallLead move date stays null |
| Safety | Active call restrictions, pending evidence, membership/eligibility state and available commands in words |

Keep unknown counts null and display Pending/Unavailable explicitly. A call being captured or a stale claim is not Done. If provider coverage cannot prove a passed deadline, show Due—not yet verified using the existing verification convention, rather than a fabricated red missed call. Timestamp tooltips and relative move/interaction labels reuse Phase 1 presentation; ticking time cannot advance server-confirmed filter/cadence state.

Add a future **Pool** filter beside New/Quoted/Other in My view, with the same row/card and selected-lead panel style. A selected Rep in Owner/Manager My view changes ordinary assigned work and that Rep's own metrics; Pool remains shared. Preserve ordinary `lead=` selection; use an explicit Pool selection discriminator/id (for example `pool_lead=` with `work_scope=pool`) so a Pool membership id cannot be interpreted as an ordinary subject id. URL reload/navigation keeps Pool search, move filters and server sort. Clear or explicitly mark selection when it leaves the authorized scope.

The panel shows “Shared call today”, “Done by <Rep> at <time>”, “Working with <Rep> until <time>”, or the exact pending/blocked reason. Never say each viewer owes their own one call. Show safe current receiver information without an assignment action for a Rep. Restrict historical detail to facts needed for this shared opportunity; ordinary-period history and Owner review evidence stay behind their existing permissions. There is no new Pool binder allocation or shared monetary total: official own allocation remains unchanged, and code 9 contributes no assigned potential unless the Owner separately revises that metric rule.

## One shared requirement and concurrent work

Use a stable logical daily slot keyed by **canonical opportunity + New York business date + `pool_call`**. Store policy and membership versions as provenance, not extra uniqueness dimensions that create another quota. Separate immutable membership intervals describe when Pool applies. Leaving and returning on the same date cannot create a second Pool daily slot or erase its fulfillment. See [Pool model](POOL-MODEL.md) for persistence/index proposals.

Recommend an advisory claim lease (initial proposal: two minutes, explicit own renewal/release). A transaction or conditional unique write elects one visible holder; concurrent acquisition returns a revision conflict and current holder. It is not a dial prohibition or a receiver lock. Another eligible Rep's real qualifying call still fulfills shared work, even if that Rep did not claim or a different Rep holds the claim. Expiry, tab close, Lead exit and completion release coordination without changing required work or historical attribution. Claims must not indefinitely hide a due Lead; losing heartbeat returns it to available state.

Provider completion follows this sequence:

1. Resolve one canonical account-scoped call interaction and its real event time, reviewed outbound initiator or inbound handler, and unique opportunity association. Retain existing final Call Log confirmation and restriction checks. An open tab/claim or client “called” assertion is not evidence.
2. Locate the membership interval and ordinary work mode effective **at the call time**, plus the shared daily slot/window and spacing anchor. A late capture after membership exit may validly update the earlier interval; it cannot grant renewed current read access or reopen a closed period.
3. In a committed, revision-guarded transaction, persist/deduplicate the event-to-requirement effect and recompute shared fulfillment. One canonical call can fulfill at most one applicable ordinary requirement across Pool/assigned modes. Retries, transfer legs and duplicate webhook/Call Log receipts produce no extra completion.
4. Record the actual caller/handler as the completion attribution, independently of the advisory claimant and receiver. Publish committed invalidation to every authorized Pool reader and the affected individual goal reads.

For two distinct qualifying calls made simultaneously, retain both real events but shared completed remains **one**. Choose the earliest qualifying event by confirmed business event time with canonical event-id tie-breaker, not first browser click or first webhook arrival. A later provider correction may change the completion attribution or make it pending; audit and re-evaluate the same slot, without manufacturing an additional daily quota. Two real outbound calls can each count once to their respective initiators under the configured goal scope; that is two actual calls, not two shared requirement completions.

## Qualification and individual goal credit

Recommend reuse of `engine/credit.ts` classification, permitted contact windows, real event timestamps, reviewed identity, unique opportunity association, canonical dedup and 60-minute cadence spacing. Extend the association seam to an approved eligible Pool membership; do not pretend every Pool Lead is already an ordinary subject. Preserve original classifier decisions and provider confirmation evidence.

| Evidence | Shared Pool daily call | Individual outbound goal |
| --- | --- | --- |
| Confirmed external actual outbound attempt by reviewed eligible Rep, answered/unanswered/busy/voicemail | One if its active interval/window/spacing/restrictions qualify | One to initiating Rep under the effective count scope |
| Confirmed external inbound actually answered/handled by reviewed eligible Rep | Recommend one under the same cadence gates; Owner must approve this Pool interpretation | Zero |
| Duplicate/transfer/monitoring/internal leg, missed inbound, in-progress call, API/button error without actual attempt | No completion | No new credit |
| Missing/ambiguous provider identity or awaiting Call Log confirmation | Pending; no guessed completion | Pending/no guessed credit |
| Ambiguous/missing opportunity association with otherwise confirmed reviewed outbound evidence | No guessed Pool completion | Existing `all_outbound` may count the actual attempt once as Other outbound; never infer Pool or New/Quoted association |
| SMS, email, Granot notes, dashboard click, claim | No call completion | Zero |
| Contact contrary to active call restriction | No completion; preserve evidence/blocked state | Zero |

Last interaction remains a separate display fact: confirmed missed inbound and eligible sent/inbound SMS can update it without satisfying the Pool call. The display must not label that timestamp as proof that today's call is done.

For `all_outbound`, a verified Pool outbound attempt contributes through the existing confirmed outbound total, once. The current `contacts/repDay.ts` also counts confirmed reviewed attempts without an eligible ordinary subject as Other outbound; preserve that broader evidence basis independently of whether Pool association is established. Under `eligible_new_quoted`, Pool is outside that existing definition; **do not silently broaden the headline or its alternate count**. Recommend retaining both current scopes unchanged at initial rollout and showing a separate Pool-call breakdown. If the Owner wants Pool to count in a narrower headline, approve a new named/effective-dated scope and test historical snapshots explicitly. Pool completion, claimant, receiver and initiating Rep are four distinct facts; a transfer participant or receiver receives no duplicate goal credit.

## Calendar, entry, exit and closed history

Recommend the existing configured **America/New_York working calendar**, including explicit closed dates and permitted ordinary contact hours. The working calendar belongs to the shared requirement, not each viewer's goal schedule, attendance or device timezone. A Rep's absence/zero-goal day does not multiply, pause or reset it. Current per-Rep roster defaults include all seven ISO weekdays; that individual-goal default does not select the shared working calendar. Read the installed shared calendar rather than hard-coding Monday–Friday from historical prose. Owner must choose whether “daily” literally includes every calendar date or follows the configured working calendar before activation.

The default is one shared call slot per canonical Lead per New York working day. Missed-date history is audit history only: it creates no additional Pool catch-up quota, accumulated debt or per-viewer ordinary obligation. Discovery, admission and first activation create no retroactive debt. Existing ordinary New/Quoted and codes 2/3 Daily catch-up policies are unchanged. The following proposed transition/evidence rules require approval:

- Enter before a working day's opening: open one duty at opening. Enter during permitted hours: prospective one duty only if the approved late-entry rule allows enough time; recommend the existing 19:30 partial-day cutoff, otherwise next working day. No new initial-response clock or earlier noon miss.
- Enter after a qualifying same-date ordinary call: recommend approved same-date coverage transfer that reduces remaining Pool work without rewriting its earlier fulfillment or adding another goal credit. A call before the membership interval is not independently called a Pool completion. The transfer references the original confirmed event and transition authority.
- Exit to another nonterminal priority: end the active Pool interval at accepted fact time, preserve history and completion, supersede unfinished future Pool work, then open an appropriate new ordinary period prospectively using existing transition rules. Never resume a closed old ordinary period. Returning to Pool on the same day reuses its logical slot; any cross-mode remaining quota needs the approved coverage-transfer rule.
- Official Booking/Cancellation, Bad Lead or authoritative closure: close/end Pool work with the real reason. A later priority-9 row does not undo it. A preserved manual receiver is not overwritten to make a Lead shareable.
- Active call restrictions: shared blocked/waived state follows existing channel authority; no restriction-caused misses. Explicit human callbacks remain one plan per opportunity and retain their restriction/precedence rules. Reps obtain no new schedule-edit permission solely from shared read access.
- Missed shared work is attributable to Pool/team responsibility, not duplicated against every viewer or assigned receiver. Preserve genuine shared missed-date history with honest provider coverage, but resume with at most the next applicable day's one shared slot. A miss never creates another Pool call or carries an ordinary per-Rep catch-up quota into Pool. Approval choices concern history, restriction waiver/resume and corrected evidence only. Additional Pool catch-up calls would depart from the fixed one-call daily requirement and require a new Owner policy request; they are not recommended by this design.

Historical evidence corrections can remove an apparent miss only when the verified call actually satisfied its original window. An after-deadline call does not rewrite a genuine missed deadline. Closed periods, membership history and source-fact ordering are retained. Approved identity repair may require reviewing which canonical opportunity owns an existing day slot; it is not permission for an automatic merge or historical quota rewrite.

## Live, cache revocation and failure recovery

Reuse the current single Outreach Desk SSE connection. Propose an additive `outreach_pool` topic and membership/requirement revision hints. Its watch pipeline and in-process adapter must deliver safe shared-topic invalidation to **all currently authorized Pool readers**, regardless of receiver. The current Rep `agent_ids` filter alone would miss other viewers; updating only the caller or receiver is insufficient. Do not broaden ordinary `outreach_desk` or money hints to every Rep.

Committed entry/exit/eligibility/claim/contact/correction events invalidate Pool queue, shared detail and Pool counts. Ordinary/money/goal keys are separately invalidated only when their own facts change. On a membership exit, send a safe Pool-scope eviction/refetch hint without privileged ordinary content; the detail read then revalidates and returns 404 for a former reader. Global Pool revision hints can omit entity ids when those ids would reveal a no-longer-authorized Lead. Initial connect/reconnect/clock, unavailable cursor and unknown version force a full **authorized scoped** resnapshot. NY rollover and offline visible polling retain current recovery behavior; no second connection.

On a confirmed 403/404, remove revoked detail and rows immediately. On uncertain transport failure, show stale/unknown status and disable claims rather than suggesting current completion or permission. A visible stale timestamp is not authorization to continue displaying a known-revoked record. Actor deactivation/access loss closes the stream and clears shared caches, as it does ordinary desk reads. Reconnect must not restore a prior Pool selection until current membership authorizes it.

## Exact Owner decisions before implementation

The fixed requirements are shared visibility regardless of receiver, one daily shared call, no automatic receiver change, no Pool Master Leads sync, priority-9 potential exclusion and the production approval gate. These need no new abstract confirmation. The following concrete decisions remain:

| Decision | Recommendation to approve | Effect / alternative requiring explicit choice |
| --- | --- | --- |
| Canonical admission and reconciliation | Verified canonical Lead reuse plus explicit membership; review ambiguous/closed/official-Booking matches | Approve actual discovered match classes and allowed mutations from the model; no blanket priority-9 admission |
| Daily calendar | Existing configured NY working calendar/closed dates | Literal every-calendar-day duty needs a separate closed-date/contact-window policy |
| What satisfies a call | Existing confirmed outbound-attempt and answered-inbound cadence rules | Outbound-only or answered-conversation-only Pool rules change qualification and need named policy/version |
| Late entry | Existing partial-day cutoff, prospective start, no preactivation debt | Decide whether the first requirement starts immediately or next working day; define the exact cutoff/window |
| Same-date enter/exit/reentry | One logical Pool slot plus explicit cross-mode coverage transfer; no duplicate ordinary duty | Decide treatment of earlier qualifying non-Pool calls and any additional New quota after Pool exit |
| Missed/blocked work and resume evidence | One shared daily slot; missed history is audit-only, with no extra Pool debt quota; restriction waiver/resume retained | Confirm history/waiver/corrected-evidence treatment only. Additional catch-up calls require a new policy request beyond this design |
| Individual goals | Preserve `all_outbound` and `eligible_new_quoted`; show Pool breakdown | Pool-inclusive narrowed goal scope needs a new effective-dated definition and frozen-history rules |
| Concurrent work | Advisory two-minute renewable lease, real provider completion valid without lease | Approve lease duration/renewal and Manager release authority; a hard dial lock is a different product decision |
| Shared human plans | Preserve current plan/restrictions; initial Pool Rep capability read/claim only | Decide who may set/replace callbacks on shared Leads; no blanket inheritance of Owner coordination commands |
| Activation and rollout | Exact reviewed pilot membership/cutover manifest, report/shadow/verify, then approved expansion | Owner approves canonical effects, Master Leads suppression/transition behavior and rollback before apply |

## Acceptance and rollout contract

After those decisions are recorded, implement server membership/authorization/association first, then mirrored DTO/BFF/live contracts, then the existing Admin layout. Start with an approved exact-id synthetic/local pilot and report-only production evidence. Production activation is a separate reviewed operation, not a consequence of merging this document.

Required acceptance cases include: three Reps with different receivers see one identical Pool row and shared daily slot; a foreign ordinary Lead remains 404; generic Admin/unlinked actor denied; forged Pool ids/queries cannot broaden access; search/filter/count/cursor composition over all results; absent/ambiguous identity held; no new duplicate canonical Lead; two simultaneous claims elect one advisory holder; expiry and actual nonclaimant call still complete; duplicate receipts/transfer legs do not multiply completion/credit; distinct simultaneous calls preserve individual credit without a second requirement; provider correction and late capture respect event-time membership; entry/exit/reentry share the same logical day slot; closed subjects never reopen; missed Pool dates create no extra quota or per-viewer debt; existing ordinary codes 2/3 Daily catch-up is unchanged; restrictions/callbacks and late-entry boundary are preserved; NY midnight/DST/closed dates and differing individual attendance do not multiply work; all readers receive live completion/revocation; reconnect/hidden/offline/cursor recovery refetch authorized scope; revoked caches disappear; code-9 potential stays excluded; Master Leads suppression holds across all source/duplicate/bad/transition routing (model-owned).

Rollback disables future Pool admission/claims/shared authorization through persisted versioned policy and stops presenting callable shared work. Preserve immutable membership, call evidence, fulfilled slots, prior attribution and sheet-suppression provenance; do not reopen old periods, restore stale assignment or replay suppressed exports. Any transition back to assigned work requires the approved prospective rule. No new environment flag, production backfill, provider subscription, customer message or feature code is included here.
