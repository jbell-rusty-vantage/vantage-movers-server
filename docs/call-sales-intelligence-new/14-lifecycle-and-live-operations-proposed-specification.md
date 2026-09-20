# 14 — Lead Lifecycle history and live Sales Intelligence

Status: **Proposed specification; not implemented or a replacement for the accepted CSI contract.**
Date: September 20, 2026.
Scope: connect Job Number history, Number Activity, analyzed recordings and Outreach; add meaningful Sales Intelligence activity to Daily Operations.

## 1. Recommendation

Build one server-owned lifecycle read that composes existing evidence. Make it available from a Form Lead, Call Lead, Booking and Job Number. Preserve Number Activity as the complete history of a Contact Number, with explicit attribution on each interaction. A phone number is not a Job Number, and its entire history is not automatically one Lead's history.

Put a compact **Sales Intelligence** panel on `/daily`, with selected events in Arrivals. Keep `/sales-intelligence` as the detailed workspace for Needs Attention, numbers, recordings, analysis, Outreach and Owner commands. Both surfaces read the same server projections and open the same evidence. There should not be a second implementation of Outreach policy in Daily Operations.

Use MongoDB for durable facts and projection work, the existing queue for wake-ups, Redis for Daily Operations wake-ups, and SSE for browser delivery. No new infrastructure or LLM pass is necessary to combine these views. “Live” in this proposal means call activity and post-call intelligence becoming visible as they are committed. Streaming transcription and in-call coaching are outside this proposal.

## 2. What the code supports today

This review inspected the local working trees, including ongoing uncommitted CSI changes. It did not probe production MongoDB, Redis, provider grants or deployed revisions. Recheck the listed seams after the optimization loop finishes. Main server was on `main`; only this proposal and its navigation link are added by this task.

| Area | Verified implementation | Implication |
| --- | --- | --- |
| Job Number timeline | [`module.ts`](../../src/services/jobNumberTimeline/module.ts), [`mongo-evidence-loader.ts`](../../src/services/jobNumberTimeline/mongo-evidence-loader.ts), [`types.ts`](../../src/services/jobNumberTimeline/types.ts) compose official and operational evidence with dual clocks, limitations and server-evaluated outcome. The interface requires Job Number. | Reuse its official outcome and evidence semantics. Add Lead-first entry so history works before Granot assigns a Job Number. |
| Number Activity | [`timeline.ts`](../../src/services/numberActivity/timeline.ts) merges interactions, messages, conversations and Outreach history with keyset pagination. Conversation rows contain recording/state references, not analysis bodies. | This is a strong starting point, but is number-scoped, not a job-scoped evidence chain. |
| Number↔Lead identity | [`NumberLeadAttachment.ts`](../../src/models/NumberLeadAttachment.ts), [`sources.ts`](../../src/services/salesIntelligence/attachment/sources.ts), [`suggest.ts`](../../src/services/salesIntelligence/attachment/suggest.ts) retain evidence windows and resolve attribution at the interaction. Exact provider identity is account-scoped. | Reuse `resolveAtInteraction`; a number-level Attached chip alone cannot authorize every call for a Lead. |
| Outreach history | [`outreach/timeline.ts`](../../src/services/salesIntelligence/outreach/timeline.ts) joins audit events using number attachments and Outreach subjects. Its attachment query includes all edge states. | Do not reuse this number-wide union as the authoritative Lead lifecycle filter. Preserve each row's actual subject and attribution. |
| Analysis | [`analysis/apply.ts`](../../src/services/salesIntelligence/analysis/apply.ts), [`ownerReads.ts`](../../src/services/salesIntelligence/analysis/ownerReads.ts), [analysis Service](../knowledge/services/sales-intelligence-analysis.md), [surface inventory](13-number-analysis-surfaces.md) expose runs, findings, evidence and effects. Conversation analysis can apply permitted changes; number synthesis writes a summary and findings. | Show source recording → run → finding → actual effect → follow-up. A submitted finding is not proof that Outreach changed. |
| Existing job context for AI | [`analysis/operational.ts`](../../src/services/salesIntelligence/analysis/operational.ts) already calls the Job Number timeline module with bounded evidence reads. | Some analysis already has lifecycle context. The missing product piece is a coherent Owner read and navigation, not an entirely new AI integration. |
| CSI live transport | [`live.ts`](../../src/services/salesIntelligence/live.ts) watches committed Mongo changes, coalesces them and emits `invalidation` with `refetch: all`. It emits a clock frame every 15 seconds and reconnects after a bounded lifetime. | It refreshes views; it is not a durable business-event feed. The cursor is advisory, not historical replay. |
| Attention | [`outreach/attention.ts`](../../src/services/salesIntelligence/outreach/attention.ts) publishes immutable snapshots with a five-minute expiry; GET does not compute or write a new snapshot. [`outreach/worker.ts`](../../src/services/salesIntelligence/outreach/worker.ts) runs repair/clock work and publishes Attention. | Browser refetch alone cannot make an overdue queue fresh. Refresh the underlying projection on changes and deadlines. |
| Daily Operations | [`kinds.ts`](../../src/services/dailyOperations/kinds.ts), [`recordDailyOperationsFact.ts`](../../src/services/dailyOperations/recordDailyOperationsFact.ts), [`liveStream.ts`](../../src/services/dailyOperations/liveStream.ts), [`rebuild.ts`](../../src/services/dailyOperations/rebuild.ts) provide Mongo events/day counters, Redis wake-ups, SSE and rebuild. No CSI kinds are in the current catalog. | Extend the existing panel/event contract. Add durable projection recovery rather than only a best-effort callback. |
| Live Admin | [`workspace.tsx`](../../../vantage-admin/components/sales-intelligence/workspace.tsx) displays number analysis, attachments, Outreach and timeline. [`daily-shell.tsx`](../../../vantage-admin/components/daily/daily-shell.tsx) owns Daily panels, Arrivals and snapshot resync. | Extend these production integration surfaces first. |
| Referenced standalone app | [`sales-intelligence-page-client.tsx`](../../../vantage-sales-intelligence/app/(dashboard)/sales-intelligence/sales-intelligence-page-client.tsx) mounts its own HTTP/live adapters. [`salesIntelligenceLive.ts`](../../../vantage-sales-intelligence/lib/api/salesIntelligenceLive.ts) listens for named `interaction`, `analysis`, etc. events, whereas the inspected server emits `invalidation`. | Align its transport and DTO contract before reuse. The Admin BFF forwards SSE without translating these event names; the standalone adapter cannot be assumed compatible. |

The Daily Operations Service and index point to `docs/daily-operations/daily-operations-specification.md`, which was absent in this checkout. Daily recommendations here are grounded in the implementation and Admin context, not an assumed reading of that missing file. Some existing documentation describes older UI states; source files were used to verify the above observations.

## 3. Product experience

### 3.1 A lifecycle view from any official record

Add **Lifecycle** to Lead and Booking detail, and an **Open lifecycle** link from Number Activity and Daily Operations. Keep the existing `/job-timeline?job=` entry. Before a Job Number exists, open by typed Lead reference; once assigned, the same Lead history remains accessible.

The header shows official status, Lead identity, Job Number when known, Booking/Cancellation links, related Contact Numbers, responsible Agent, next action, coverage and last refresh. Official outcome and Outreach state are separate fields: “Booked” can coexist with historical overdue work. An AI statement such as “customer booked” cannot establish official Booked status.

The main history interleaves Lead creation/enrichment, calls, confirmation messages, conversation analysis, Outreach actions, official Booking and Cancellation. Group a call and its recordings into one expandable activity. Keep analysis completion as a separately timed event linked back to that activity, so late analysis is visible when it actually becomes available.

Filters: All, Calls & recordings, Outreach, Official records. A separate **Other history on this number** section holds ambiguous or unrelated calls. It is discoverable but excluded from the selected lifecycle's totals and factual summary.

### 3.2 Recording and analysis detail

Expand a call to see:

- Direction, start/end time, duration, provider outcome, Agent identity evidence and attribution label.
- Each recording and processing status: available, processing, paused, failed or unavailable, using actual stored reasons.
- Redacted transcript and the current published conversation analysis through existing authorized detail reads.
- What the customer wanted, commitments, dates/money, outcome and discrepancies when provided by the current analysis schema.
- Follow-ups proposed/applied/completed, and blocked or stale effects with their reason. Link each effect to its finding, run and actual target.
- Owner corrections and the distinction between current analysis and prior runs.

Fetch a short-lived recording URL only on Play. Do not persist signed URLs in event cards, browser query caches or projections. Retention and purge fences apply to every new read; preserve non-content tombstones where evidence is no longer available.

Label `ContactNumber.running_summary` **Number summary**. It can span multiple Leads or moves. Do not relabel it “Job summary.” A future job-specific AI summary would need separately scoped evidence and acceptance; it is not needed for this delivery.

### 3.3 Live placement

On `/daily`, add one Sales Intelligence category panel with two clearly labeled parts:

1. **Needs attention now:** current snapshot counts and a small ranked list linking into Sales Intelligence. Start with Unworked, Overdue and Needs review; show assignment and next due action on rows. Overlapping reasons are not additive totals.
2. **Today’s activity:** selected, durable events with like-hour comparisons where defined below.

Arrivals includes missed inbound calls, applied analysis with actionable consequences, new overdue episodes, restrictions, important reviews and explicit Owner actions. Routine call completion and analysis completion remain in the panel/full stream by default. Queue retries, model tokens, leases and unchanged number summaries belong in processing/coverage detail.

Add a **Live activity** view to `/sales-intelligence` using the same projected event IDs and filters. Do not make the user choose between two competing streams. Detail and actions stay in Sales Intelligence; Daily offers visibility and navigation. Preserve explicit Owner authorization for Rep Nudges; never turn an event into an automatic message.

## 4. Identity and correlation contract

The lifecycle is a read composition, not a new Sales Opportunity or CRM record.

```text
Form Lead / Call Lead ── official relationship ── Booking ── Cancellation
        │                                         │
        └──────────── normalized Job Number ───────┘
        │
 Number↔Lead evidence, evaluated at each call
        │
 Contact Number ── Call Interaction ── Lead Conversation / recording
        │                                    │
        │                          Intelligence Run → Finding → Effect
        │                                                    │
        └──────── Outreach subject → Follow-up ←─────────────┘
```

1. Resolve the requested Lead/Booking/Job Number using official links and the existing normalization rules. Keep multiple matching Leads visible; never silently pick one or merge their Outreach records.
2. Load related Contact Numbers using attachment edges, then evaluate each canonical interaction through `resolveAtInteraction`. Preserve Exact, Likely, Unsure and Confirmed by you. Existing policy allows a unique Likely attribution; do not silently tighten the accepted effects policy or present Likely as Exact.
3. Include a uniquely attributed interaction in that Lead's history with its certainty. Ambiguous, rejected, competing or out-of-window evidence belongs only in number context. A later phone edit never backdates ownership of earlier calls.
4. Join recordings through canonical interaction/conversation references and account-scoped provider recording identity. Exclude merge tombstones. Multiple recordings remain children of one interaction, not extra calls.
5. Join Outreach by its actual typed subject and follow-up references. A Number Review stays number-scoped until an existing authorized workflow changes its relationship; a shared phone alone does not move its commitments onto a Lead.
6. Join findings/effects through run, conversation, source interaction and target IDs. An effect's target subject remains authoritative even when the number currently has different attachments.
7. A Leadless Booking still has an official lifecycle. Its matching phone can offer number context, but cannot invent a Lead or automatically attach the Booking. Follow Exact Job Booking Attach and existing reconciliation commands.
8. Keep both “attribution used when applied” and “current attribution” available after an Owner correction. Rebuild display projections; do not rewrite historical effects to pretend they originally applied elsewhere.

A cancelled/rebooked Job Number retains its official history and independent events. Calls after Booking remain visible when attributable, but do not reopen sales Outreach merely because a recording exists. Preserve existing official closure and Owner precedence rules.

## 5. Server read boundary

Add a composition module, proposed `src/services/salesIntelligence/lifecycle/`, that consumes stable reads from Job Number timeline, Number Activity, attachment, Outreach and analysis. Business policies stay in their owning modules. In particular, keep the existing official timeline module independent of CSI: the AI already consumes it, so feeding synthesized AI history back into that same evidence source risks circular evidence and duplicated context.

Proposed Owner-only endpoint: `GET /api/v1/admin/sales-intelligence/lifecycle`.

- Exactly one selector: `lead_model` + `lead_id`, `booking_id`, or `job_no`.
- Optional existing Source Company/Source Granularity filters apply on the server; no filter may be bypassed through a linked number.
- `cursor`, `limit` (default 50, max 200), and an allowlisted event-family filter.
- Response: version, resolved subjects, official outcome, Outreach summaries, number-context links, items, next cursor, `as_of`, per-source freshness/coverage, and explicit limitations.
- Each item: stable ID, family/kind, `occurred_at`, `recorded_at`, source reference/revision, activity ID, typed subject, attribution evidence/certainty, safe display fields and typed links. Current-state badges must not overwrite the historical event's meaning.

Use an unambiguous order `(occurred_at DESC, family ASC, stable_id DESC)`. Bind the cursor to selector/filter digest and a read watermark. New arrivals refresh the head and show a “New activity” control while older pages remain navigable. Deduplicate by source event identity, not description or timestamp. Return a resync-required response when the binding is no longer valid; never silently reuse another subject's cursor.

The current official timeline caps display at 250 events and is a multi-query best-effort read. The Number Activity conversation source scans at most 2,000 recording-bearing interactions. Do not claim complete history merely by concatenating these bounded outputs. First delivery must surface these limits; complete paginated history requires bounded source adapters or a rebuildable index with tested continuation. Add query indexes based on actual filters and explain plans, not a collection scan inside each page request.

Reads must never trigger provider calls, transcription, inference, attachment or projection repair. CSI unavailable must leave the existing official timeline usable and identify the unavailable section. Keep trusted Owner authorization, deployment/dataset boundaries and current redaction contracts on all routes and links.

## 6. Durable live event contract

Use existing CSI audit facts where they accurately describe a committed semantic change. Add missing durable facts at the owning transaction boundary; a Mongo change notification is only a wake-up. Project an allowlist into Daily Operations rather than exposing raw audit `prior/current` documents.

Add a `sales_intelligence` lane and a versioned CSI mapping to the Daily Operations kind catalog. The following names are proposed new kinds, not existing runtime enums:

| Proposed kind | Emitted when | Identity and default placement |
| --- | --- | --- |
| `sales.call_completed` | A canonical external interaction first becomes terminal | Interaction ID; panel; actual provider outcome, never imply Spoke |
| `sales.missed_inbound` | A canonical inbound interaction is determined unanswered | Interaction ID; Arrivals + panel; link resulting callback episode when present |
| `sales.analysis_available` | Conversation application publishes a current completed run | Run ID; panel; historical reanalysis visibly labeled |
| `sales.followup_created` | A follow-up is committed | Follow-up + creation fact; Arrivals when actionable; include Owner/AI/system origin |
| `sales.followup_completed` | A follow-up completion commits | Follow-up + completion revision; panel; exact disposition and evidence |
| `sales.overdue_started` | An eligible action/first-action deadline enters an overdue episode | Subject/action + deadline version + episode; Arrivals |
| `sales.overdue_resolved` | That episode is resolved, cancelled, closed or rescheduled | Episode + resolution revision; panel; preserve the actual reason |
| `sales.restriction_changed` | A contact restriction is applied, corrected or lifted | Restriction + semantic revision; Arrivals |
| `sales.review_opened` | A new actionable review is committed | Review ID; Arrivals; repeated observations update detail, not duplicate cards |
| `sales.owner_corrected` | An Owner correction commits | Instruction/command + revision; panel with evidence link |
| `sales.rep_nudge_sent` | Provider-confirmed delivery outcome is durably recorded | Nudge + outcome revision; panel; requesting a send is not success |

Both completion and missed-inbound facts can describe the same call; call-volume metrics count the canonical interaction once. Group related rows by activity ID; do not hide their independent fact identities. Later provider corrections create explicit correction facts and trigger metric repair instead of silently rewriting previously displayed outcomes.

Every projection input carries source event ID, schema/mapping version, dataset/deployment, source subject, related IDs, occurred/recorded times, origin (`live`, `backfill`, `owner_reanalysis`, `repair`) and a stable semantic dedupe key. References establish navigation; the server reauthorizes detail reads. Avoid copied transcript excerpts, full analysis text, raw phone payloads and signed media URLs in the durable event ledger.

### 6.1 Delivery and recovery

Commit a projection-work item alongside the source semantic fact in Mongo. Reuse CSI job/lease infrastructure where possible, adding a dedicated allowlisted stage and handler. The worker maps that fact to a Daily Operations event with a stable dedupe key. Wake via the queue after commit; cron repairs pending work. Mark delivery complete only after the projected event is durably present. Audit backfill can seed work using the same keys.

The current Daily writer inserts the event, increments the day and publishes Redis separately, and suppresses errors. A crash after insertion can leave a missing counter increment; a duplicate retry returns before incrementing. Therefore simply adding an after-commit call is insufficient for reliable CSI metrics. For CSI, implement an atomic event/counter/projection-receipt transaction, or a revision-fenced authoritative recount before marking projection work complete. Prefer the atomic adapter for these new kinds; preserve the existing closed-day policy explicitly. Redis publishing remains after Mongo commit and may safely fail.

Recovery must handle commit-order skew. Do not rely solely on a high-water `(recorded_at, _id)` scan of audit records: timestamps/IDs can precede transaction commit. Transactional pending work is the primary recovery source. Any secondary scan uses overlap, idempotency and periodic reconciliation.

Daily live delivery reads durable Mongo events after Redis wake-up, retaining Mongo polling/resync when Redis is down. CSI keeps its existing `invalidation` protocol for current-state queries. Both clients must resync on reconnect, visibility return, scope change and cursor expiry. SSE does not carry authoritative counts. Keep one subscription owner per mounted surface, bounded coalescing and slow-client disconnect behavior.

### 6.2 Time alone must update Attention

Add a coalesced Attention refresh request after relevant committed changes: interaction attribution, follow-up, assignment, restriction, review, analysis effect and official closure. Publish only complete snapshots, using existing size/time guards.

Schedule the next relevant deadline in durable work. On delivery, re-read current revisions and derive eligibility using existing Outreach policy; obsolete deadlines produce no event. Compare prior persisted derived signal with the new signal and emit one overdue episode transition. A bounded periodic scan is recovery for missed wake-ups, staffing-boundary changes and policy changes. A browser clock frame only asks for new server data; it cannot create a new Attention snapshot.

Keep snapshot IDs and `as_of` visible. While refresh is incomplete or expired, show Pending/Updating or Stale, not zero actionable work. Old pages remain bound to their immutable snapshot until expiry; restart pagination explicitly then.

## 7. Metrics and time semantics

Daily Operations currently shows **percentage changes**, not statistical percentiles. Keep its today versus yesterday-by-now comparison for comparable activity counts. Use New York business dates and existing timezone helpers, including DST tests.

| Metric | Unit and clock | Comparison |
| --- | --- | --- |
| Calls completed | Distinct canonical external terminal interactions, by end time | Yesterday by same local time; direction filters available |
| Missed inbound calls | Distinct canonical unanswered inbound interactions, by end time | Same coverage-qualified comparison |
| Conversations analyzed | Distinct conversations first successfully published, by publication time | Reanalysis counted separately; never inflate first-analysis count |
| Follow-ups created/completed | Distinct committed action transitions, by transition time | Report separately; completed does not mean Spoke |
| Unworked / Overdue / Needs review now | Current server-derived subject/action population, with explicit unit | Current gauge; no like-hour percentage until historical comparable snapshots exist |

Unknown or incomplete capture is not zero. If yesterday's denominator is zero, show “No comparable baseline”; if coverage differs materially, show counts with a coverage warning and suppress a misleading percentage. Proposed first-call median/p90 and conversion metrics are later work requiring cohorts, staffed-time definitions and historical coverage; they are not part of this release.

The lifecycle orders calls by call time and analysis availability by publication time. Live activity orders by newly recorded arrival time and shows the original occurrence time. Backfilled calls go into historical number/lifecycle history and historical metric repair, not today's call count or normal Arrivals. Historical analysis and Owner reanalysis can appear in a separately labeled processing filter, but must not impersonate a new customer call or a fresh sales commitment.

Closed Daily days currently refuse counter increments and strip metric touches from late facts. Preserve that behavior in v1 and expose late/coverage limitations. A later authorized historical rebuild can recompute versioned comparable metrics; do not silently change yesterday's baseline during normal live ingestion.

## 8. Performance, scope and rollout

Proposed targets to measure, not claims about production: a committed event reaches an open visible browser within five seconds at p95; a deadline changes Attention within one minute at p95; first lifecycle page loads within two seconds at p95 under the agreed test dataset. Provider recording readiness, transcription and model time are separate latency components with visible states, not hidden in a “real time” promise.

Reuse current source indexes where suitable. Candidate new indexes cover projection work by status/available time, event source dedupe, lifecycle subject/time pagination and pending deadline/revision. Bound related-number fan-out and return explicit partial coverage when exceeded. Avoid one query per card for transcripts/runs; fetch summaries in bounded batches and load details on expansion.

No model call is required by page opens, SSE events, Daily metrics or Attention refresh. The optimization loop retains control over analysis admission, prompts, budgets and scheduling. A run changing its output schema must not break operational event cards: cards derive from versioned server effects and published run references.

Delivery order:

1. **Rebaseline and freeze DTOs.** After optimization, verify changed analysis fields, deployed host, transport adapters and current Attention publication. Establish fixtures with multiple Leads sharing a number, one Lead using multiple numbers, and a Leadless Booking.
2. **Lifecycle composition.** Ship read-only Lead/Booking/Job entry, event-level attribution, recording/run/effect links, visible coverage and number-context separation. Embed in Admin details and link from existing number view. Preserve existing official timeline route and AI input contract.
3. **Durable CSI events and deadline projection.** Add transactional projection work, idempotent mapping, counter consistency, due-episode transitions and prompt Attention refresh. Shadow-compare counts and source coverage before showing Daily cards.
4. **Daily and CSI live surfaces.** Add lane/panel/Arrivals filters, shared navigation, activity view, snapshot freshness and corrected standalone transport if that app is deployed. Extend Daily schemas, day seeds, snapshot/rebuild, colors, lane counts, full-stream overlay and client validators together.
5. **Recovery and release proof.** Exercise failures below, inspect query plans and latency, then enable independently controlled lifecycle/live projection/UI flags. Rollback hides new surfaces/stops projection consumers without discarding source facts; resumed workers replay safely. No provider grants or deployment changes are performed by this proposal.

## 9. Acceptance scenarios

1. A Form Lead without a Job Number shows arrival, attributable outbound call, recording, analysis and follow-up. When Job Number and Booking arrive, the same prior history appears from both Lead and Job entry.
2. Two moves share a number. The first move's recording and number-wide summary do not become the second move's official facts. Likely/ambiguous attribution is visible; rejected edges do not attach events.
3. One Lead has an ingested phone and a later Granot phone. Both histories are discoverable; the later phone does not acquire earlier calls outside its evidence window.
4. A call is captured via webhook and reconcile, transferred, then merged. The history has one canonical call and its real recordings; replay and corrections do not double call counts.
5. Conversation analysis creates a callback. The UI links recording → run → finding → applied effect → follow-up. A blocked effect displays its reason and never claims an action was created.
6. An Owner corrects a deadline while old analysis/deadline work is pending. Revision checks preserve the correction, and stale work produces no false overdue transition.
7. No new call arrives as a commitment becomes overdue. Server deadline processing refreshes Attention and emits exactly one episode event; repeated scans do not spam Arrivals.
8. An official Booking closes relevant sales Outreach under existing policy. Later analysis cannot reopen it or replace official status. A cancellation remains its own official fact.
9. Redis is unavailable, the queue wake-up is lost, or a worker crashes after event insertion. Pending Mongo work recovers, the UI resyncs, and authoritative counts equal a rebuild without duplicate cards.
10. Reconnect, hidden-tab return, expired cursor and New York midnight preserve correct day/filter/snapshot boundaries. Delayed commits behind a scan watermark are eventually projected.
11. Backfill imports last month's recordings and reanalysis republishes a run. Today's call count stays unchanged; new processing is honestly labeled and prior evidence remains navigable.
12. Retention starts during detail loading. Copied projections cannot expose removed transcripts, summaries or media. Purged evidence is unavailable, not an empty successful analysis.
13. Partial capture, the official 250-event cap, the number conversation scan bound, an unavailable CSI section and an expired Attention snapshot each produce a specific limitation instead of a false complete/zero result.
14. An Admin/non-Owner, wrong dataset, invalid linked object or forged selector cannot read recordings, lifecycle detail, SSE or execute Owner commands. Deep links do not confer authorization.
15. Both UI hosts consume the actual server `invalidation` protocol, and both open the same typed evidence references. Test with real adapters rather than only demo data.

## 10. Decisions proposed for adoption

- Daily Operations is the live overview; Sales Intelligence remains the detailed work surface.
- Lifecycle composition is server-owned, starts at Lead identity and reuses official Job Number semantics.
- Number history remains broader than any one Lead/Job; attribution is per interaction.
- Current Number summary is labeled as such; no additional job-summary inference is required.
- Durable semantic events and server deadline processing complement the existing invalidation stream.
- Mongo owns recovery and metrics; Redis and queues accelerate delivery.

These are recommendations for the next implementation phase. Accepted contracts in [01](01-specification.md), [03](03-server-pipeline-and-jobs.md), [04](04-server-routes.md) and [10](10-intelligence-agent-contract.md) remain authoritative until this delta is adopted.
