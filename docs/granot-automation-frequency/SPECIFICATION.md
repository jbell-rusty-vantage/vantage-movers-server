# Granot update cadence, Lead updates and Outreach convergence

Owner-approved direction: November 4, 2026. Final implementation specification; not a claim that this behavior has been built, deployed or qualified at the new frequency. Entry point: [README](README.md). Execution: [implementation plan](IMPLEMENTATION-PLAN.md).

## 1. Outcome and scope

Refresh Granot Follow-Up Estimates hourly during the Owner's daytime window and every two hours overnight, then converge existing Lead and Sales Outreach Desk state through the same canonical lifecycle used by Granot webhooks. Preserve current admission, matching, authority and financial policy. Prove ordering through committed state, durable jobs and evidence coverage, rather than relative cron start minutes.

Implement the schedule/freshness changes and two demonstrated pair propagation fixes: a durable related-Form refresh when a sibling marker changes, and correct Sheet update nomination for an existing paired Call already delivered to Duplicate Calls. Preserve existing periodic recovery and bounded processing.

This work does not add Call creation, change qualification/billing admission, remove pairs, reopen closed Desk periods, replay every intermediate Priority, backfill pre-November-1 reporting memberships, discover every historical Granot estimate, change RingCentral polling, or deploy by implication. Ordinary valid Calls still belong in Master Leads Calls. **A saved Form Fill Call must not be newly projected into normal Calls by any touched path.** Classification convergence can briefly precede/follow concurrent Form/Call arrivals under the existing Form Fill work contract; zero transient visibility before classification is saved is not promised.

## 2. Authoritative existing contracts

- [Glossary](../../../CONTEXT.md): Source Company, Source Granularity, Form Fill, Call Qualification, Lead, Booking and Cancellation.
- [Call billing/admission](../call-lead-billing.md) and [Call Service](../knowledge/services/call-lead.md): new Calls, approved historical exceptions, effective duplicate/bad disposition and exclusive Sheet routing.
- [Collector](../knowledge/services/granot-http-collector.md), [Estimates contract](../knowledge/estimates-in-process-update.md), [automation apply](../knowledge/granot-lifecycle/automation-apply.md).
- [Capture](../knowledge/granot-lifecycle/capture.md), [identity](../knowledge/granot-lifecycle/identity.md), [desired state](../knowledge/granot-lifecycle/desired-state.md), [processor](../knowledge/granot-lifecycle/processor.md), [drainer](../knowledge/granot-lifecycle/drainer.md).
- [Desk Service](../knowledge/services/sales-outreach-desk.md), [Outreach lifecycle](../knowledge/sales-outreach-lifecycle.md), [Number Activity capture](../knowledge/services/number-activity-capture.md).
- [November 1/general backfill release](../lead-reporting-retirement/RELEASE.md), [final source reconciliation](../lead-reporting-retirement/FINAL-RECONCILIATION-2026-11-03.md), [Form Fill convergence review](../call-billing-review-2026-11-04.md).

Where old documentation says Form Fill is attribution-only or the scheduled window is yesterday-through-today, current code, the November billing contract and this approved packet prevail. Update those statements when implementing; do not rewrite unrelated locked contracts.

## 3. Schedule, scope and durable identity

### 3.1 Exact New York slots

Keep `/api/cron/granot-estimates-in-process` at `0 * * * *` in `vercel.json`. Admit ALL slots in America/New_York at:

`00, 02, 04, 06, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22`.

08:00 and 20:00 are included. This is 18 slots on an ordinary New York day. Spring-forward has no 02:00 slot, so 17; fall-back repeats unscheduled 01:00, so 18. These are local business-clock semantics, not a constant elapsed interval on DST days. Use the same pure schedule functions for admission, expected-slot calculation, freshness and Pool refresh. No separate hard-coded expected-hour list in a reader.

Preserve current ALL slot keys `MM/DD/YYYY:<NY hour>` and deterministic child IDs derived from slot + date window + lane/selection. Existing 08/13/18 manifests and pending children must recover unchanged after rollout. There is no repeated scheduled local hour in this schedule. Duplicate invocation during the same admitted hour must reuse the first scope, children, plan and receipts; it must not recollect a completed child under the same operation identity.

Store an optional actual `scheduled_at` instant on new manifests if needed for reliable deadline comparison. Supply it from the slot calculation and freeze it with the manifest, not worker start time. Old manifests remain readable; derive their original scheduled instant from the immutable slot/creation context with an explicit compatibility helper. Do not rewrite historical keys or require a data migration/index solely for this addition.

### 3.2 Date scope

Retain Follow-Up Estimates `STATUS=V9`, `TYPEDTE=OPEN`, ALL priority selector 10, and existing user/department/type selectors. Every ALL slot declares the trailing 90 inclusive New York Open Dates, split into at-most-seven-day children, plus older months with verified `granot_estimates_open_dates` evidence. Freeze the complete window manifest before dispatch. Never use ingestion time as Open Date or replace this with a changed-in-the-last-hour filter.

Complete pagination/headers/totals/explicit emptiness and provider response timestamps remain required. Incomplete scans fail closed. Unobserved older scope remains an explicit limitation. A row disappearing from Follow-Up Estimates is not a Booking, Cancellation or terminalization command.

### 3.3 Pool and worker scope

Retain correlated Pool refresh after each ALL slot when Pool is enabled. Keep historical Pool discovery once daily at 06:00 New York from its existing history floor. At 06:00, **ALL, its correlated Pool refresh, and daily Pool discovery are all distinct duties**; a single-choice helper must not make one hide another. The Pool refresh waits for complete ALL collection of its own frozen windows, not completion of all Lead effects. Its expected-slot reader must include the 06:00 refresh; discovery has its own daily expected-slot reader. Disabled Pool neither creates duties nor blocks ALL recovery; do not report disabled Pool as an overdue enabled duty.

Keep the shared Granot account lease, fenced claims, fair least-recent-attempt scheduling, 120-second planning/apply budgets and 25-action apply batches. Do not fan out concurrent Granot logins, add sleeps, call RingCentral from Granot collection, or make provider completion one cross-service transaction.

The base load is at least 234 ALL children per ordinary day (13 ×18), plus older months, enabled Pool refresh and discovery. It is six times the prior base 39. This arithmetic is not measured capacity. Capacity qualification is required before calling the cadence operationally healthy.

## 4. Lead matching, authority and reporting

### 4.1 Existing Leads and Call admission

Ordinary new Call creation remains qualified RingCentral ingestion only. Estimates never creates a missing Lead. Granot webhooks cannot create a Call. Protected Best Relocation final import remains completed and retired; keep its bounded admission and 69-ID historical compatibility unchanged.

An existing historical Call may receive a sound canonical lifecycle update without a new RingCentral event. Do not introduce a raw RingCentral-only condition into shared matched-Lead enrichment or fabricate qualification. Existing reporting-admission checks still govern billing, sibling eligibility and delivery; an enriched unsupported historical Call remains excluded from Calls reporting. This does not widen the separate legacy CSV APIs or resurrect external ingestion.

Keep the canonical ladders: Form Record Link → exact ref/Mongo-ID compatibility → unique source-scoped contact; Call Record Link → equivalent Job within resolved Call Source Granularity → unique non-repeat-duplicate caller phone in that Granularity. Current and immutable ingested Call phone are identity evidence; Granot contact phone and Phone 2 are not new Call fallback keys. Company-level Form Fill is a separate cross-channel comparison. Ambiguous matches, foreign scope and conflicting nonempty Jobs are held. Bad exact Forms retain Priority-only authority; duplicate Forms are ineligible.

### 4.2 Desired state

| Field/effect | Accepted valid newer snapshot |
| --- | --- |
| Job | Fill missing, never replace a conflicting Job; preserve prefix equivalence and existing Record Link ownership |
| Priority | Accept actual valid canonical code, including 0 and Pool 9; never manufacture a code from missing/malformed evidence |
| Receiver | Exactly one active Agent assertion; protect manual/nonempty source-less assignments; retain current latest-wins flag/time rules |
| Quoted | Priority 1/5 may set true, never reset false |
| Granot contact | Priority 1/5 → `granot_contact_snapshot`; primary caller/submitted contact and immutable ingestion snapshots stay protected |
| Locations/cubic feet/Granot move-service fields | Existing broad enrichment at Priority 1/5; Vantage move size remains protected |
| Move date | Form at Priority 1/5; Call supplied valid date at any valid Priority, under full matching authority |
| Source/CPL/admission/official Booking-Cancellation facts | Never inferred or rewritten by Lead snapshot enrichment |

Granot invalid/missing fields do not authorize blind clearing. Preserve existing semantic comparisons and normalization. Priority 5 is not an official Booking. Actual Booked/Release evidence retains reconciliation/Owner-command authority.

### 4.3 Form Fill versus sibling

An admitted Call with Form Fill is an effective Duplicate Call at zero billing, even when repeat-call `duplicate=false`. The reporting decision remains `callLeadReportingDisposition.ts`; actual target selection stays in the canonical Sheet planner. Normal Calls, Duplicate Calls and Bad Call Leads are not three independent copies to append.

Preserve verified Form-first sibling mirroring after live Form `applied`, `linked`, `created` and `already_current` results. Match equivalent Job first, else a unique jobless admitted non-repeat-duplicate non-anchor Call by phone in the same canonical Company within 45 days. Preserve protected receivers, different Jobs and another Form's existing sibling marker. Re-read current Form/Call state in the canonical command; never mirror an old observation patch blindly. The Form retains Record Link ownership and preferred Booking context. The Call's own accepted-observation clock is not forged by the mirror.

Fix the delivery seam: sibling Job/receiver changes to a Call already synced in **Duplicate Calls** currently may nominate no Sheet job because `hasSyncedCallsRow` recognizes only `master_calls`. Add `form_fill` and `external_sheet_review` to the sibling Call type/projection, preserving its existing ID/company/feed/RC/external-admission fields so canonical disposition has complete evidence. Recognize saved synced rows in the current canonical Call reporting destinations, including applicable exception destinations, then enqueue ordinary `call_lead.update` through the shared planner. Respect effective No-Sync delivery semantics (normal Calls may be hidden; exception destinations retain their existing policy). Do not append a normal Calls row as a workaround or force physical membership for never-delivered records. A Priority-only mirror need not write Sheets if it changes no exported field.

## 5. One lifecycle, channel-specific ingress

Both channels converge here:

```text
webhook authenticated capture ── queue / lifecycle drainer ─┐
                                                         ├─ normalization → Registry policy → identity
Estimates collect/lock/system approval → action receipt ──┘
  → captured-time comparison → canonical desired state / Decision
  → synchronizeLeadFromGranot → EntityChange + permitted Sheet intent
  → current Form sibling mirror (when applicable)
  → Outreach subject refresh → period/evidence evaluation
```

| Aspect | Granot webhook | Scheduled Estimates |
| --- | --- | --- |
| Authentication | Shared-secret proof; route determines event class | Cron secret; sealed system approval; existing lifecycle gates |
| Observation time | Vantage webhook arrival at capture | Actual collected provider-response time sealed with row |
| Idempotency | Each delivery is a distinct receipt; canonical state prevents duplicate business effects | Same channel operation ID replays; same ID/different evidence conflicts; next slot gets new evidence |
| Unmatched | Existing event-specific pending-match clock may apply | Unmatched preview is held, not an approved action receipt; next snapshot can match after RC creates the Call |
| Extra routes | Lead Created, Priority Updated, actual Booked/Release | Follow-Up Lead snapshots only; no Booked/Release assertion |

The shared matcher/planner/command must enforce the same authority when normalized evidence is comparable. Do not duplicate policy in routes or call legacy direct Form/Call/Booked writers from automation. Preserve separately gated Form creation on eligible webhook `lead_created`; this work does not broaden or disable it.

Actual Booked/Release webhook evidence may open/refresh a booking reconciliation case and return before Lead synchronization. Do not force it through a second Lead update to mimic a Follow-Up snapshot. A Priority-only snapshot must not manufacture that case or official financial records.

Temporal ordering is **last observed by Vantage**, using `captured_at` then Observation ID. It is not provider-modification ordering: an old provider event first delivered as a webhook after a newer snapshot can have a newer arrival time. Reject truly older-captured evidence applied late, but do not claim all delayed provider events are detected as old. Provider-version ordering is outside this change without verified Granot evidence.

## 6. Exact update, no-op and recovery meanings

| Situation | Required result |
| --- | --- |
| Exact terminal automation replay | Reuse saved receipt/result; no recapture, duplicate business command or fresh period |
| Pending receipt | Preserve operation identity and original time; retry only under canonical due/lease rules |
| Older captured tuple | Stale; no desired-state effect or temporal advance |
| Fresh observation, business fields unchanged, link current | `already_current`; may advance accepted temporal metadata; no business Lead revision/EntityChange/Sheet intent |
| Fresh observation needing only a link | Canonical association effect, not falsely called a complete no-op |
| Real permitted difference | Atomic Lead revision, Decision/EntityChange and permitted delivery intent; downstream current-facts refresh |
| Missing/conflicting/invalid identity or suppressed gates | Held/suppressed result, not success or forced effect |

Fresh no-op Estimates observations still use existing bounded repair for open subjects/Pool. They can change subject accepted-observation metadata and cause subject revisions/evaluations. **Do not promise zero Desk work.** They must not create a new period, reset deadlines/age, send another confirmation, duplicate contact credit or fabricate billing rows. Avoid a raw-row-hash skip that ignores changes to target state, Registry or assignment protection.

A Lead no-op is not proof that Sheets, its sibling or every downstream projection is current. Keep committed effects, queue nomination, child status, complete collection and completed synchronization distinct. Existing best-effort sibling callback can time out/fail after the primary commit; a later Form observation can heal it. Do not label that post-commit callback exactly-once or durably retried by terminal automation replay.

The five-minute heartbeat recovers persisted manifests/missing children and recoverable runs. It does not reconstruct an entirely missed trigger before manifest insertion or blindly retry terminal failed runs. Later full snapshots reconcile current in-scope state; they do not reconstruct every intermediate provider change. Preserve retention and existing retry clocks.

## 7. Outreach and RingCentral coordination

### 7.1 Required causal order, independent clocks

Keep current RC, capture, SMS and Outreach cron schedules/gates. The distinct paths are:

```text
Granot commit → EntityChange tail / accepted Estimates repair
  → outreach_lead_change → current subject+period transaction → outreach_evaluate

RC capture commit → contact-change wake / durable contact sweep
  → deterministic Call/SMS contact event → outreach_evaluate + rep-day recount
```

Neither provider must wait on the other. Do not schedule RC at :00, Granot at :01 and evaluation at :02 as a correctness mechanism; a run can queue, retry, fail or overlap. Preserve RC's existing internal ISync/reconcile token-chain lease and reserved reconcile minutes, independent of the Granot account lease.

| Existing lane | Current trigger / responsibility |
| --- | --- |
| `ringcentral-call-log-sync` | Every 30 minutes; qualified inbound Call Lead ingestion recovery, not Desk confirmation |
| `sales-intelligence-call-log-isync` | Every minute, [07:45,20:30) New York; yields on reconcile minutes |
| `sales-intelligence-call-log-reconcile` | Minutes 3,8,…58 UTC, all day; all-direction capture/coverage |
| `sales-intelligence-call-log-sweep` | 07:40 UTC daily; existing drift recovery |
| `sales-intelligence-rep-sms-poll` | Minute trigger with existing staffed/mailbox gates |
| `sales-intelligence-job-recovery` | Every minute; durable job recovery |
| `sales-outreach-lead-changes` | Every minute; durable EntityChange tail and Lead-change drain |
| `sales-outreach-contact-events` | Every minute; contact sweep/derivation and recount |
| `sales-outreach-evaluate` | Every minute; clock/coverage repair and evaluation drain |
| `sales-outreach-revision-reconcile` | Every five minutes; missed revisions/configuration/held-subject recovery |

RC provider request volume must not grow merely because Granot runs more often. More Granot activity can increase shared Mongo/Desk queue pressure; measure that downstream pressure rather than raise Heavy API polling.

### 7.2 Coverage and event-time credit

Preserve `cadenceCallCoverage = min(capture_known_complete_through − configured settlement allowance, derived_known_complete_through)`. Goals intentionally use observed coverage under their existing rule. SMS uses current reviewed mailbox coverage. Keep settlement, provisional-call limits, staffed windows, rate gates and coverage tolerances unchanged.

Evaluation before RC confirmation/contact derivation cannot establish a miss beyond evidence coverage. Passed deadlines remain due/unverified or existing pending-evidence states; later capture/derivation re-evaluates them. A provider outage is not a rep failure. Contact credit uses actual contact event time and applicable periods, not cron/job start time. Preserve number-link and past-effective period re-derivation, including their existing 14-day/50-per-kind bounds; this is not unlimited historical replay.

### 7.3 Pair convergence fix

A Form Lead-change refresh can run before the post-commit sibling marker lands and hold its first period for ambiguous Job ownership. The Call marker EntityChange refreshes the Call, while the Form may wait for the existing 15–20-minute held-subject backstop. Close this latency gap through the **durable Outreach EntityChange tail**:

- On a bounded tail page, identify Call changes touching `granot_form_sibling`; resolve valid current Form relations with one batched projection read in the tail's transaction. EntityChange reference-only fields do not contain the full marker after-value: do not assume it is present.
- Enqueue `outreach_lead_change` for each referenced Form with a distinct related-refresh trigger and a key containing Form ref plus causal Call EntityChange ID. Do not reuse a previously completed Form revision key.
- Persist nomination with the tail cursor transaction; retry/replay dedupes. Store related-job `input_refs: [formId, callId]`; validate both references and confirm the current Call marker still points to that Form before consuming. Do not parse relation authority out of the dedupe string. A related refresh may update only an existing active/review Form subject, not enroll, expand or reopen one.
- Reuse current configuration, subject CAS and evaluator nomination. Preserve existing periodic recovery. An active Form's unchanged period stays unchanged; the main benefit is clearing the held/no-period Form promptly after verified ownership resolves.

Once a verified sibling marker exists, the Form is the one work item and job-holder count. The Call is excluded from a separate cadence by that marker, not by Sheet placement. Form Fill alone does not close/merge a subject or authorize a new Form link.

### 7.4 Rapid Priority semantics to preserve and expose

The Desk reconciles **current Lead facts**, not every intermediate EntityChange snapshot. Same workflow means no period restart (including 2↔3 when both map to Daily). Real workflow transitions close/open according to the accepted fact's effective time and enrollment boundary. The latest accepted observation supplies that time, not a provider last-modified clock or guaranteed first semantic-change instant.

Closed periods and closed subjects remain final under current contracts; a later Priority 0/1 does not silently reopen them. Characterize both interleavings of 0→5→0:

- Desk refresh consumes 5 before the final 0: the subject remains closed; displayed Priority may later be 0.
- Both writes precede the Desk refresh: it can consume only final 0 and retain the original New period.

This is an existing consequential current-state/irreversible-closure boundary, demonstrated in the investigation with the in-memory subject store. Higher refresh frequency does not make it a lossless event log. Do not change it by moving cron minutes, adding sleeps, replaying old snapshots into current Leads, or introducing reopening. Guaranteed transition history or reopening requires a separate explicit product contract. Include both outcomes in acceptance evidence so the limitation cannot be mistaken for a qualification claim.

## 8. Freshness that works with hourly slots

The current `latest expected slot age >90 minutes` check cannot detect sustained hourly failure because that age resets hourly. Replace it with a schedule-based due-coverage check using the same schedule helper:

1. Compute the latest expected slot at `now`, and the latest scheduled slot at or before `now −90 minutes` (the latest slot whose collection grace has elapsed). Use the actual schedule across overnight and DST gaps.
2. Track latest **fully collected slot** by its scheduled instant, not whichever child completed last, plus latest fully synchronized slot independently. All declared children must count; freezing scope is authoritative.
3. Emit `late_slot` when no complete collection exists for that grace-elapsed slot or a later scheduled slot. A later full refresh may supersede a missed refresh for current-state coverage; it is not evidence that the missed trigger ran. No history is an explicit unknown/no-complete state.
4. Preserve failed/partial/held/synchronization-pending diagnostics separately. A completed scan of suppressed/held work must not be described as all business updates applied. Synchronization delay must remain observable even when collection is complete.
5. Return additive expected/grace-elapsed slot instants, last complete collected/synchronized slot identity/instant and lag values as needed; retain existing DTO fields. For disabled Pool, return disabled/not-expected rather than an overdue lane. Readers never create work or mutate manifests.

Test 09:40 and 10:40 with no successful hourly slots; later hourly scheduling must not erase lateness. Also test early morning before 08:00, 20→22 overnight, missing latest manifest, a partial old slot followed by a newer complete slot, failed children, disabled Pool, 06:00 triple duty, year/month boundary and both DST dates. Old manifests/runs must remain diagnosable after deployment/rollback.

## 9. Acceptance journeys

These are required behavior proofs, not permission for live mutations:

- **A1 schedule/replay:** exact 18 ordinary/17 spring/18 fall New York slots; boundaries; unchanged 08/13/18 identity; duplicate cron delivery and interrupted dispatch preserve manifests/children/actions.
- **A2 freshness/Pool:** sustained hourly misses, partial versus fully collected versus synchronized, failed/held work, overnight/DST, disabled Pool and independent 06:00 duties/dependencies.
- **A3 shared update:** comparable webhook Priority Update and automation snapshot produce equivalent allowed business state; repeat delivery/next-slot no-op creates no extra business mutation; old-captured apply loses after a newer winner. Keep ingress timestamps/event-specific policies distinct.
- **A4 historical Calls:** supported old RC evidence and approved Best Relocation history synchronize without restamping; existing unsupported historical identity may enrich but remains unbillable/unprojected; unmatched observation creates zero Calls. Retired import is not reopened.
- **A5 reporting/pair:** Form Fill stays effective Duplicate Calls; Form keeps Record Link/Booking preference; one cadence. Existing Duplicate-Calls-only delivery metadata receives updated exported Job/receiver through canonical projection with no normal Calls append; No-Sync and unadmitted cases remain correct. No bulk historical repair.
- **A6 related refresh:** force Form refresh before marker; marker tail nomination and replay clear an existing held Form without duplicate enrollment/period. Crash before cursor commit rolls back both cursor and nomination; crash after commit recovers; retired/changed relation and absent/closed Form do not reopen/admit.
- **A7 cross-order contacts:** permute Granot commit, subject sync, RC webhook awaiting confirmation, Call Log confirmation, contact derivation and evaluation. Event-time call/SMS credit converges once, manual assignment stays protected, outbound attempt never assigns, and number-link/period re-derive preserves quota/spacing credit.
- **A8 evidence outage:** deadline passes while RC is unavailable or provisional/derivation incomplete; no verified miss beyond coverage. Later confirmation heals via existing wake/sweep without a Granot retry. Incomplete provider windows never advance coverage.
- **A9 period semantics:** repeated same Priority and same-workflow changes preserve period IDs/deadlines; real transitions and rapid A→B→A preserve current policy; cover both transient closure interleavings above. Fresh no-op subject bookkeeping is allowed without duplicate cadence/contact obligations or messages.
- **A10 recovery:** queue nomination lost/worker interrupted, stale revisions, existing pending receipts and terminal replay. Best-effort mirror limitations remain honestly distinct from the new durable related-Form wake.

Use synthetic provider payloads and disposable loopback replica databases. Required boundary cases need real transaction/outbox/cursor assertions, not mocked counts alone. Read-only production observation is optional for release evidence; never use production credentials to run tests.

## 10. Historical boundary, release and completion language

The Owner's general Call backfill began November 1, 2026 New York midnight (`2026-11-01T04:00:00Z`) and has a frozen through-watermark. This plausibly explains older physical Calls rows retained despite saved Form Fill. Follow-up inventory at 21:55 New York found all 74 such rows created before November 1, including 36 saved siblings; none has saved original arrival, so the audit cannot independently reconstruct every backfill inclusion decision. Do not classify pre-cutoff retention as failure of the scoped backfill or expand its scope here.

The runtime reporting rule has no pre-November exemption. A legitimately touched historical Lead may project under current policy through existing commands. Do not proactively reclassify/move every old row, rewrite admission or terminalize missing data. Best Relocation Source Company activation remains the Owner's separate action.

Implementation completion requires the patch, focused unit proofs, required disposable transaction journeys, updated owning docs and a release/rollback handoff. Integration, deployment and live qualification are separate statuses. New frequency is qualified only after representative full ALL collection, allowed synchronization and downstream Desk/contact progress clear with headroom, including the 06:00 Pool overlap. Record children/requests/held-failed work, oldest queued age, accepted-change→Desk latency and RC/derivation/evaluation watermarks without contacts.

Rollback restores prior 08/13/18 admission while preserving all existing manifests, receipt identity, queued work, accepted facts, pair markers and financial history. Do not delete evidence, reset periods, purge work or rerun ingestion to roll back cadence.
