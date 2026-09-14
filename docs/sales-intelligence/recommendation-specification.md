# Lead and sales intelligence — recommended specification

Status: proposed, grounded in live read-only investigation. Date: September 11, 2026.

**Sept 14 cut:** Number Activity and outreach are now the first product. See [number-activity-consolidation.md](number-activity-consolidation.md). That file renames Sales Opportunity off the Lead plane and freezes the official state machines. This document remains the evidence base, capture design, storage, APIs, and phased acceptance.

This is a recommendation for review, not a declaration that the proposed workflows have shipped. Existing Services and the shared glossary remain authoritative. New terms below are explicitly proposed additions. No production business records, subscriptions, assignments, or deployments were changed by this investigation.

## 1. Recommendation

Build a durable record of customer-number activity alongside the existing Lead Lifecycle. Give every actionable sales opportunity an accountable Agent and a next action. The Owner should be able to answer: **What needs attention, why, who owns it, what actually happened, and how certain are we?**

Start with the Owner workspace in the Admin Dashboard. Add a Sales workspace to the existing extension after identity mapping and server-side access controls are ready. A separate sales web app is optional; it should use the same server commands and projections.

Use deterministic code for identity, chronology, contact eligibility, assignment, SLAs, financial attribution, and the first priority policy. Use inexpensive AI for extracting conversation evidence: callback promises, objections, intent, next steps, and contradictions. An autonomous LLM agent is not required to prevent opportunities from drifting away. A constrained extraction pipeline is desirable once audio coverage and model access are established.

The most valuable first release is **complete observed activity + ownership + due follow-up**, rather than a complex lead score.

## 2. What the prototype established

The fixed Call Log window is September 4, 2026 20:07:37.937 UTC through September 11, 2026 20:07:37.937 UTC (16:07:37 EDT at both ends). Sixteen pages returned 3,938 records with no remaining page. Mongo reads were projected snapshots, not a transactionally consistent cross-system snapshot.

| Evidence | Observed result | Design implication |
| --- | --- | --- |
| Account directory | 53 extensions: 24 User, 23 Department, and six other system extensions; 61 company numbers | Filter human users from queues, IVRs, voicemail, and announcements. |
| Vantage roster | 20 Agents, 14 active; six Extension Users | RingCentral user, Agent, and Extension User are separate identities. |
| Stored records | 5,644 Form Leads, 1,540 Call Leads, 691 Bookings, one Lead Conversation | Extend existing records and Services; do not build another CRM. |
| External activity | 3,919 sessions with one external number; 1,336 distinct external numbers | Number tracking is useful independently of Lead creation. Nineteen sessions were excluded from this prototype's external-number classification. |
| Form Lead phone evidence | 2,678 sessions | Most of the observed activity can be contextualized with Form Leads. Phone equality is evidence, not proof of one opportunity. |
| Call Lead phone evidence | 560 sessions | Repeated interactions belong on the timeline; they need not create another sales work item. These sessions can overlap the Form Lead set. |
| Ambiguity | 135 sessions had multiple Lead candidates | Explicit ambiguity is necessary. Never pick the newest Lead merely because it is convenient. |
| Numbers without a Lead | 382 | Retain number-only history; distinguish sales prospects from service, vendors, spam, wrong numbers, and unknown intent. |
| Existing Call Qualification | 911 inbound records; 232 matched a configured RingCentral Inbound Number; 53 qualified; all 53 had exact stored Call Lead identity | The observed problem is broader intelligence coverage, not evidence of broken qualified-call ingestion. |
| Recent Form Leads | 347 in the window; 318 currently open, non-duplicate, and not Bad Leads | Define an eligible opportunity cohort before judging outreach. |
| Outreach review | Seven eligible Form Leads had no observed call after ingestion; 16 had no observed outbound call | Separate targeted phone-filter requests returned zero records for all seven primary numbers. Review these; do not assert no contact occurred anywhere. |
| Receiver evidence | 151 of the 318 eligible Form Leads had no `receiver_agent` | A durable assignment process would close an accountability gap; a missing receiver does not prove a verbal assignment never happened. |
| Recording metadata | 3,328 distinct recording IDs in records/legs | Sufficient potential volume for conversation intelligence; recording presence does not guarantee retrievable content. |
| Audio probes | Eight IDs: five content reads returned 206 audio, two 404, one 429; one complete MP3 downloaded successfully | Model media state separately and retry transient failures. Do not infer why a particular recording is absent from a 404. |
| Recording authority | `ReadCompanyCallRecording` permission check returned false | Current playable samples do not prove company-wide audio access. Resolve this before claiming complete rep conversation coverage. |
| Presence | Account and own-extension reads returned 403 | Availability is unknown today; requesting account data does not grant every feature permission. |
| RingSense / ACE | Insights endpoint returned 403; `ReadRingSenseInsights` check false | Native transcripts/insights are not available to this integration as configured. Licensing remains unverified. |
| Analytics | `groupBy: Users` succeeded; 25 rows with call counters and live-talk/ringing/hold segments | Useful provider metrics exist. One historical Analytics identity is absent from the current directory. Preserve historical identities. |
| Subscriptions | Listing returned no subscriptions visible to this app/user | Inspect intended production app and subscription ownership before enabling real-time guarantees. This does not prove the entire account has no subscriptions. |
| AI Gateway | After the user supplied a funded key, Whisper and GPT 5.6 Luna processed two recordings successfully | One provider-connected call was a voicemail; the other revealed a potential recurring employee-relocation opportunity. Sentence-linked findings remain review suggestions. Earlier free-tier failures are historical. |

The number-review prototype also identifies 34 numbers whose latest unanswered inbound session has no later outbound session observed, after conservatively diverting numbers with any Booking/Cancellation context. This is a candidate queue, not a definitive missed-callback count: a later inbound conversation, other channels, old Bookings, or changed contact details need interpretation.

The median first outbound delay among the 302 eligible Form Leads with an observed outbound call was about 252 wall-clock minutes; p90 was about 1,025 minutes. These are exploratory measurements, **not business-hours SLA metrics or rep rankings**. Overnight arrivals, imported timestamps, and time outside this RingCentral account are not adjusted.

## 3. Domain boundaries and vocabulary

The following existing meanings stay intact:

* A Form Lead or Call Lead is a domain sales record. A call is not automatically a Call Lead.
* Call Qualification remains inbound, mapped, answered, at least 120 seconds, with a caller phone, through the existing shared ingest gate.
* Duplicate Lead and Form Fill continue to mean their existing source-attribution rules. Cross-source phone grouping never changes CPL or duplicate classification.
* Booking and Cancellation remain official records governed by existing commands. A transcript saying “booked” is a claim, not an official Booking.
* Agent Allocation is a share of Booking Binder. It is not assignment of a Lead to a rep.
* The recorded receiver, caller/handler, current assignee, and Agent receiving Binder credit may be different people.
* Granot Observation Receipts, Observations, and Job Number identity retain their existing authority. The extension supplies observations; it does not own identity or lifecycle invariants.

Proposed additional concepts:

| Proposed term | Meaning |
| --- | --- |
| Contact Number | A normalized external telephone endpoint whose observed activity survives the absence of a Lead. It is not proof of a unique person or household. |
| Sales Opportunity | A bounded unit of sales work associated with one or more Contact Numbers and zero or more explicitly linked Leads. It can begin number-only. Owner review can split or connect opportunities. |
| Call Interaction | Canonical observed communication session with provider identifiers, parties, legs, timing, outcomes, and provenance. |
| Rep Identity Link | Reviewed, effective-dated connection between an Agent, RingCentral user extension, optional Granot username, and optional Extension User. |
| Sales Assignment | Durable ownership of a Sales Opportunity, including offer, acceptance, reassignment, and release history. |
| Follow-up | An explicit next action with responsible Agent, due time, disposition, and supporting evidence. |
| Intelligence Finding | Versioned extracted or calculated evidence with source references, uncertainty, and review state. |

Review these names before adding them to `CONTEXT.md`. They deliberately avoid overloading Lead, Agent Allocation, Customer, or RingCentral Inbound Number.

## 4. Identity and matching

### Contact Numbers and opportunities

Normalize with a country-aware E.164 policy and store original provider values separately. Do not silently treat every digit string as a US number. Internal extensions, withheld callers, malformed values, service codes, and company-owned numbers require explicit classifications.

A Contact Number may appear on multiple Leads, across Source Granularities, and in different moves over time. One Sales Opportunity can also have multiple numbers. Phone equality supports a number-level timeline; it does not automatically merge Customers or Leads.

Record each number-to-Lead edge with the exact field that provided evidence: live operational phone, Ingested Contact Snapshot, Granot Contact Snapshot, or immutable RingCentral original caller. Preserve observation time, source, valid interval where known, and supersession. A later snapshot must not rewrite what an earlier call meant.

Recommended matching precedence:

1. Existing exact provider call/session identity on a Call Lead.
2. Existing reviewed interaction/opportunity attachment.
3. An authorized explicit Sales Assignment/call initiation context tied to a unique opportunity, corroborated by provider evidence.
4. Unique phone-and-time candidate within an eligible opportunity, using source and Job Number evidence where available. Record as a suggestion until the agreed automatic-match policy is validated.
5. Multiple candidates: keep the call on its Contact Number timeline and open an identity review item. No arbitrary tie-breaker.
6. No candidate: retain number-only activity and intent `unknown`; do not manufacture a Form Lead or bypass Call Qualification.

Do not inherit advertiser attribution from whichever outbound caller-ID number a rep used. RingCentral Inbound Number assignments are effective-dated inbound attribution. The Contact Number timeline may span sources, while source attribution remains on each Lead.

Opportunity creation initially requires an eligible new Lead or Owner review of a number-only sales candidate. Multiple Leads sharing a phone enter a candidate-link review rather than automatically creating several competing work items. An explicit new move, a different Job Number, or Owner confirmation can start a separate opportunity. There should be no universal “one number = one lifetime opportunity” rule.

### Rep identity

Use `(RingCentral account_id, extension_id)` as the provider identity, never display name. Store effective intervals so renamed, departed, and reassigned extensions remain interpretable. Directory `Enabled` does not establish that the person is an Active Agent or working now.

The prototype found only ten simple one-candidate name matches. Examples such as Joshua/Josh and Roy/Roys require review; two Tyler extensions demonstrate why first-name matching is unsafe. Some current RingCentral users are absent from the Agent roster. Queue membership proves routing configuration, not sales eligibility.

Owner mapping screen: show all four identity namespaces, proposed candidates, evidence, unlinked active users, effective dates, and conflicts. Enforce no overlapping conflicting mappings for the same account/extension. An Agent may have multiple verified extensions. An Extension User mapping must be verified before exposing a personal worklist; an email equality candidate alone must not grant access.

## 5. Capture and reconstruction

Capture inbound **and outbound** calls, including short, missed, failed, voicemail, transferred, and internal sessions. Classify sales relevance after capture. Keep intelligence capture separate from the existing Call Qualification side effects so a richer call history cannot increase CPL-bearing Leads accidentally.

Use account telephony-session webhooks for low-latency evidence, plus paginated Detailed Call Log reconciliation for finalized history. Events can arrive out of sequence and transfers can cross session boundaries. RingCentral documents these limits; treat webhooks as observations and reconcile, rather than assuming one terminal event proves completeness. [Telephony notifications](https://developers.ringcentral.com/guide/voice/telephony-session-notifications).

Persist account-scoped UUID/event identity, session ID, party ID, sequence, event time, received time, and a payload fingerprint. Duplicate delivery is harmless. Maintain per-party sequence handling, preserve late facts, and do not roll a terminal projection back to ringing because a delayed event arrived. Provider UUID plus payload fallback is an ingestion deduplication key; it is not the same key as a Call Interaction.

Canonical interaction identity prefers account + telephonySessionId, with account + sessionId fallback and separate Call Log record aliases. Never collapse a customer's different calls merely by phone and time. Preserve cross-session transfer references when supplied, and mark missing transfer linkage unknown.

Persist Call Log records keyed by account + record ID and reconcile `lastModifiedTime`/payload changes. Distinguish ringing attempts, connected participants, monitoring participants, transfer legs, and external customer parties. A record or leg marked connected may represent a machine answer; use `provider_connected` until conversation evidence supports a human conversation. Detailed legs are essential for routing interpretation. [Detailed Call Log](https://developers.ringcentral.com/guide/voice/call-log/details).

Recommended collection cadence: webhook-driven immediate capture; a separate all-direction reconciliation worker about every five minutes subject to the shared provider quota; daily deeper repair. Reuse the existing 12-hour safety-floor principle initially, but measure the extra all-direction API load. Backfill fixed daily windows with overlap, page checkpoints, and explicit complete/partial manifests. Fetch older available history in bounded batches, preferably 60–90 days initially, subject to actual retention and volume. This investigation only establishes a seven-day baseline.

The new worker must not change the existing qualified-call cron cursor or its 30-minute cadence implicitly. Either share fetched records through a deliberate refactor owned by the existing Service, or keep independent cursors with one coordinated provider rate budget. Production ingestion receives quota priority over research/backfill/media.

Advance a window's completed watermark only after every page and durable write succeeds. Store per-page progress for resumability; do not represent a truncated scan as complete. Reconciliation inserts/updates idempotently; historical corrections rebuild affected opportunity and rep-day projections. Apply deletes/retention purges separately from business-history corrections.

## 6. Closing the follow-up gap

Model dimensions separately rather than one overloaded status:

* Opportunity sales state: open, won, lost, service-only, identity-review.
* Contact eligibility: allowed, temporarily blocked, suppressed, unknown; include reason and evidence.
* Ownership: unassigned, offered, accepted, released; retain history.
* Next action: call, review, wait for customer, reconcile identity, or none with an explicit closure reason.

Every open actionable opportunity must have either an accepted Agent and a dated next action, an outstanding assignment offer with expiry, or a visible unassigned/review item. “No next action” is itself an exception, not an invisible null.

Sales Assignment commands:

| Command | Required behavior |
| --- | --- |
| Offer | Validate Agent eligibility and opportunity state; create offer and expiry; store recommendation evidence if used. |
| Accept | Recheck identity, expected revision, offer status, and capacity; atomically establish one owner. |
| Reassign | Owner supplies reason; close previous interval, cancel/supersede pending offer, preserve due actions, create the new assignment. |
| Release | Record actor/reason; return open work to visible unassigned state. |
| Complete follow-up | Capture disposition and evidence, then create the next action or an explicit close/wait decision. |
| Snooze | Require due time and reason; remain visible in scheduled work. |

Calls made outside the assignment UI still attach as activity when identity permits. They do not silently steal ownership or change Binder credit. Show “another Agent contacted this opportunity” as evidence for coordination.

Proposed initial policy defaults, requiring business review before enforcement:

* First action due within five staffed minutes after an eligible Form Lead arrives; outside hours, at the next staffed opening.
* Unanswered inbound sales candidate due within five staffed minutes; unknown-intent calls enter triage first.
* Assignment offer expiry after two staffed minutes; reoffer or escalate visibly.
* Accepted opportunity without a next action escalates after fifteen staffed minutes.
* No automated repeated-call schedule in the first release. Agents/Owner set the next attempt within permitted contact rules.

Store UTC instants, the governing IANA timezone, staffing calendar, and policy version. The Owner's reporting timezone is America/New_York; the customer's permitted contact time may differ. Missing timezone, contact permission, wrong-number evidence, customer opt-out, and uncertain identity can block calling. Do not let a high score override a suppression. A Booked or Cancelled Lead may still need service contact, but is removed from automatic sales reactivation unless a reviewed new opportunity exists.

## 7. Outreach priority and allocation recommendations

Keep **urgency** separate from **likelihood of sale**. The initial urgency policy is transparent and deterministic; probability-of-sale ranking remains experimental until outcome labels and assignment history are reliable.

Suggested order: overdue customer-promised callback; overdue first action; recent unanswered inbound sales request; due active follow-up; unassigned open opportunity; older reactivation candidate. Identity uncertainty routes to review. Repeated recent attempts trigger a cooldown, not an urgency reward.

A versioned rule may output `{band, reason_codes, due_at, evidence_refs, policy_version, computed_at, expires_at}`. Proposed score weights are tuning parameters, not trained predictions. Show the reasons and source timestamps in the UI.

Assignment recommendations first apply hard eligibility: verified Rep Identity Link, Active Agent, sales role/skills, current shift, fresh explicit availability, capacity, contact eligibility, and no incompatible accepted assignment. Presence alone is insufficient: an app can be “Available” while the rep is away. Combine presence, call state, declared work availability, queue eligibility if relevant, and freshness.

If presence is unavailable or stale, label it unknown. Suggest Owner selection or require a rep to accept a short-lived offer based on fresh app availability; do not pretend the API established online status.

Among eligible reps, use continuity with the current relationship, workload, language/move-type fit, and then cautiously weighted historical outcomes. Return up to three candidates with reasons and exclusions. Include capacity snapshots and a short recommendation expiry; acceptance revalidates them atomically. Empty eligible set produces an escalation, not a fabricated best rep.

Performance should start with a low weight. Small cohorts use shrinkage toward the team baseline and show sample size. Compare similar Source Granularity, Move Type, lead age, and assignment cohorts. Reserve a configurable exploration share or round-robin tie-break so high-ranked reps do not receive all good Leads and manufacture a self-confirming ranking. Evaluate recommendations in shadow mode before offering them to the Owner.

A Sales Assignment does not transfer a live telephone call. RingCentral supports live transfer operations, but those are a separate optional integration using active session/party IDs and user intent. This investigation did not initiate or transfer calls. Start with explicit ownership and a dial action; add call control only when the rep experience needs it. [Warm transfers](https://developers.ringcentral.com/guide/voice/warm-transfer).

## 8. Rep performance specification

The Owner page should distinguish activity, responsiveness, outcomes, and evidence coverage.

| Metric | Definition / denominator |
| --- | --- |
| Outbound attempts | Distinct external Call Interactions initiated by the rep; exclude internal routing and monitoring. |
| Unique numbers attempted | Distinct Contact Numbers among those attempts; alongside attempts per opportunity to reveal repetition. |
| Provider-connected rate | Provider-connected external attempts / eligible external attempts. Explicitly not human-conversation rate. |
| Human conversation rate | Evidence-confirmed human conversations / calls with usable classification evidence; show unknown and unrecorded counts separately. |
| Live-talk duration | Provider Analytics live-talk segments or validated participant intervals; never sum overlapping legs or whole-session durations across reps. |
| First-action latency | First attributable action after arrival/assignment, with wall-clock and staffed-time views; exclude or separately classify incomplete history. |
| Follow-up adherence | Actions completed by due time / due actions under that rep's accepted ownership, respecting snooze policy and staffing calendar. |
| Assignment acceptance | Accepted offers / actionable offers delivered, with expired/declined reasons. |
| Booking conversion | Official Bookings / eligible assigned opportunity cohort after a defined maturation window; count each opportunity once. Show pending immature cohorts. |
| Binder credit | Sum the Agent's official `agent_allocations[].binder_amount`; preserve split semantics. |
| Cancellation rate | Official cancellations / relevant Booking cohort, with observation window and maturity shown. |
| Coaching findings | Reviewed conversation findings with recording/evidence links; no ungrounded personality or emotion score. |

Keep receiver-attribution analytics and Booking Agent Allocation reports unchanged. Define a new assignment-cohort report instead of retrospectively treating receiver fields as assignment acceptance. “Who contacted,” “who owned,” and “who closed” should be separately selectable attribution views. Multi-Agent assist activity is useful but does not rewrite financial credit.

RingCentral User Analytics supplies aggregated counters and segment timing. Use it for cross-checking and provider-level activity, not caller-level Lead attachment. Analytics rows can include historical/deleted identities, and metric scopes differ from the external-only prototype. Do not require totals to match without aligning filters and semantics. [Aggregate Analytics](https://developers.ringcentral.com/guide/analytics/aggregate).

## 9. Conversation intelligence

Extend `lead_conversations` and its private audio flow. It already has recording uniqueness, optional Lead attachment, redacted transcript, summary, processing states, and Owner-only reads. Do not create a competing conversation store or put transcript text directly on Leads.

Recommended processing:

1. Discover recording identity from finalized interactions; deduplicate by provider/account/recording ID. Review whether the existing provider+recording uniqueness needs account scope before multi-account support.
2. Check entitlement and retrieve media server-side. Persist a private Blob object or process in memory according to retention policy. Never store expiring RingCentral `contentUri` as durable identity.
3. Transcribe once with an allowlisted inexpensive speech model. Record model/version, media digest, language, duration, segments if available, and uncertainty. Queue long audio separately; use overlapping chunks if necessary and deduplicate boundary text.
4. Redact before transcript persistence or summarization. Existing deterministic redaction is a baseline, not complete coverage of spoken card numbers or identifiers. Add targeted handling and review before broad payment-call processing. Raw STT text must remain transient, as required by the existing Service.
5. Extract a validated JSON schema using GPT 5.6 Luna or another explicitly allowlisted cheap model. Treat transcript contents as untrusted data; no tools or business-write capability.
6. Validate evidence citations against transcript segment IDs/text; reject unsupported claims, malformed dates, missing speaker grounding, and overconfident outputs. Model self-reported confidence is not calibration.
7. Publish versioned findings. Proposed callbacks, suppressions, or contradictions enter review/controlled policy processing; they do not create official Bookings or mutate contact data.

Extraction schema should include intent, human/machine/unknown contact, move facts explicitly stated, objections, promised next steps, callback phrase and resolved date candidate, quoted amounts with meaning, booking claim, contact restriction evidence, and uncertainty. Each item carries segment/time references, speaker attribution confidence, and supporting text. Resolve “tomorrow” using call time and a known timezone; an ambiguous timezone stays unresolved.

For summaries across calls, preserve chronology and disagreement: “Customer said X on Tuesday; changed to Y on Friday.” Recompute from the evidence set with a version/digest, rather than recursively summarizing summaries. A review correction supersedes the finding and invalidates dependent recommendations.

Do not run costly AI on every ring attempt. Prioritize calls with usable recordings and sales relevance: substantive connected calls, customer callback promises, unresolved follow-ups, and a small unbiased evaluation sample. Very short calls can still contain a meaningful callback or opt-out; duration alone must not permanently exclude them.

The native alternative is ACE/RingSense, whose API can expose existing insights for licensed users. Current permissions prevent evaluating its quality here. Confirm licensing, processing coverage, retention, and actual cost before choosing it over the Gateway path. Do not assume API scope alone purchases or enables ACE. [ACE API](https://developers.ringcentral.com/guide/ai/ace).

### Cost controls

At the live public Gateway catalog snapshot, Whisper was listed at $0.0001/second ($0.006/minute); Grok STT at $0.000028/second ($0.00168/minute). Standard Luna short-context token rates were $0.20/M input and $1.20/M output. These are catalog estimates, not an invoice or an available entitlement for this key. Exact catalog snapshots live in the prototype artifacts. [Gateway model catalog](https://ai-gateway.vercel.sh/v1/models), [speech-to-text documentation](https://vercel.com/docs/ai-gateway/modalities/speech-to-text).

Illustrative 1,000 five-minute recordings/month: Whisper $30 or Grok STT $8.40, plus about $2.16 for Luna at 6,000 input and 800 output tokens per call. This excludes retries, chunk overlap, infrastructure, storage, and pricing changes. Model quality has not been benchmarked on these calls, so cheaper is not automatically better.

Reserve estimated cost atomically before each job, reconcile actual usage, and enforce per-recording and monthly ceilings. Reuse successful transcript/model-input digests; block expensive fallbacks. A budget or provider failure leaves metadata, assignment, and follow-up workflows operational with `intelligence_unavailable` visible. The funded prototype processed 15.38 minutes of audio and two extraction passes for approximately $0.10 in known successful usage. One failed schema-validation attempt has unrecorded token usage; exact billed usage was not queried. See [AI experiment](ai-experiment.md).

The initial extraction had seven non-verbatim quote checks out of 23. The revised format returns sentence IDs and lets code attach the original sentences; all 11 findings passed schema and ID checks. This does not prove semantic correctness: one finding included an early-December detail absent from its cited sentences. Require evidence-support review, distinguish customer requests from rep commitments and completed actions, and never create a Booking or follow-up deadline solely from an unreviewed model statement. Sentence IDs in this smoke test are not speaker diarization or audio timestamps.

## 10. Storage and Vercel execution

MongoDB remains the system of record, consistent with ADR-0001. Redis is useful for cache, fresh presence with TTL, rate-budget coordination, and UI wake-ups. It must not be the only copy of assignments, follow-ups, evidence, or job state. Reuse the existing Vercel Queue + durable Mongo intent + cron-drainer pattern.

Proposed collections, subject to the final model review:

| Collection | Key data and indexes |
| --- | --- |
| `contact_numbers` | Account/tenant + normalized number unique; classification, first/last observed, suppression state. |
| `contact_number_links` | Number + Lead/opportunity + evidence source + interval; indexes by number, Lead, and review state. |
| `call_interactions` | Account + canonical session unique; aliases, parties, outcome, source revisions; indexes by number/start, extension/start, and modified time. |
| `ringcentral_call_records` | Account + Call Log ID unique; normalized facts, provider modified time, ingestion manifest. |
| `rep_identity_links` | Agent and provider identity with effective intervals; conflict prevention through serialized commands. |
| `sales_opportunities` | Linked evidence, sales state, current assignment reference, next due action, revision; indexes by state/due and Agent/due. |
| `sales_assignments` | Append-only history plus current marker; partial unique index for one current assignment per opportunity; revision fencing. |
| `sales_followups` | Opportunity, Agent, action, due time, disposition; indexes by Agent/status/due and opportunity/status. |
| `intelligence_findings` | Conversation + extraction version + evidence digest unique; reviewed status, supersession links. |
| `sales_intelligence_jobs` | Stage, attempt, lease owner/expiry, next attempt, estimated/actual cost, bounded error; due-work index. |
| `sales_rep_day_projections` | Agent + business date + policy version unique; refreshable facts and coverage. |
| `sales_intelligence_sync_state` | Account/stream cursor, fixed windows, page checkpoints, lease and completion state. |

Reuse the current webhook receipt mechanism where it can safely preserve all-direction evidence. Do not duplicate raw payload storage without a specific need. Keep sensitive payloads and audio out of logs and queue bodies; queue only durable IDs.

Commands run in Mongo transactions with expected revision and idempotency keys. A command writes state, append-only audit evidence, and an outbox intent atomically. Publish after commit. Queue delivery is at least once, so workers claim bounded leases and fence completion writes. Cron recovers lost wake-ups and expired leases. External AI/media calls stay outside database transactions. [Vercel Queues](https://vercel.com/docs/queues).

Split discovery, metadata fetch, media retrieval, transcription, extraction, matching, and projection into bounded jobs. Do not keep an Express request running for the entire pipeline. Long-call provider jobs can use submission/callback or separately resumed polling. Avoid loading large audio into public API request bodies; Vercel documents a 4.5 MB request/response payload limit and plan-dependent duration limits. Current documented Pro/Enterprise generally available maximum is 800 seconds with Fluid Compute; verify the actual deployed plan/configuration. [Function limits](https://vercel.com/docs/functions/limitations).

Honor `Retry-After` and provider rate-limit headers, with jitter and a global account/app budget. The current local helper used fixed backoff and the probe encountered a recording throttle; production should expose headers through the shared client and defer jobs rather than sleep inside a function. Coordinate token refresh across instances and reuse the existing production token store. [Call Log rate guidance](https://developers.ringcentral.com/guide/voice/call-log/best-practices).

Archive call metadata within actual provider retention; recording availability is finite. Retention windows and volume caps may vary, so do not promise historical completeness merely because a query returned 200. Store observed coverage and policy-driven deletion. [RingCentral archival](https://developers.ringcentral.com/guide/voice/call-log/archival).

## 11. Server API and client surfaces

Proposed server routes (names are provisional):

| Route | Purpose |
| --- | --- |
| `GET /api/v1/admin/sales-intelligence/overview` | Owner counters, exceptions, queue health, and coverage watermarks. |
| `GET /api/v1/admin/sales-intelligence/opportunities` | Cursor-paginated due/unassigned/review work with reason filters. |
| `GET /api/v1/admin/sales-intelligence/numbers/:id/timeline` | Number activity with Lead links and per-event evidence. |
| `GET /api/v1/admin/sales-intelligence/agents/:id` | Activity, assignment cohorts, outcomes, and coverage. |
| `POST /api/v1/admin/sales-intelligence/identity-links` | Owner-reviewed identity linkage with expected revision. |
| `POST /api/v1/admin/sales-intelligence/opportunities/:id/recommendations` | Read-only recommendation computation, returning evidence/version/expiry. |
| `POST /api/v1/admin/sales-intelligence/opportunities/:id/assignments` | Offer/reassign through one canonical command. |
| `GET /api/v1/sales/worklist` | Authenticated mapped rep's authorized work only. |
| `POST /api/v1/sales/assignments/:id/accept` | Atomic offer acceptance. |
| `POST /api/v1/sales/followups/:id/complete` | Disposition and next-action command. |

Every response should carry `as_of`, coverage interval, partial/unavailable capabilities, and policy/projection version where relevant. Commands include an idempotency key and expected revision; stale versions return a conflict and refreshed state.

Owner Admin Dashboard: proposed `/sales-intelligence`, with Attention, Numbers/Opportunities, Agents, and Coverage views. Attention is the default. Show due reason, age, Agent, last meaningful activity, next action, identity certainty, and source coverage. Detail opens the unified timeline, linked Leads, official Booking/Cancellation context, and Lead Conversations. Keep financial details sourced from existing APIs.

Daily Operations may add a count/link to actionable follow-ups; it should not be replaced or recast as this historical intelligence workspace. Workflow Observational remains integration health, not the sales work queue.

Sales extension: add “My follow-ups,” assignment acceptance, next action/disposition, and a number/Job Number context panel on supported Granot pages. The extension sends observed page evidence and requests server resolution; it does not choose identity matches, calculate authoritative rankings, or infer Agent permissions from DOM text. Handle stale page state and navigation. A shared device must not expose the previous user's work after session change.

Optional rep web app can be a restricted dashboard route using the same API. It is useful if reps spend little time in Granot, need mobile access, or cannot keep the extension open. Start with one rep surface based on observed workflow; avoid duplicating two separate assignment implementations.

## 12. Access, audit, retention, and operational visibility

Owner sees account-wide intelligence and mapping controls. A manager role is a separate explicit capability if needed; do not silently expand existing Admin access. Sales sees accepted/offered assignments and specifically authorized history. Customer Service sees service-relevant evidence through a defined policy, not sales performance by default.

Enforce row-level access on the server for list, detail, export, conversation, and audio endpoints. Browser hiding is not authorization. Extend the existing Owner-only conversation policy deliberately before releasing rep audio/transcripts. Account JWTs and Gateway secrets never reach clients. Audit audio access and issue short-lived private URLs with authorization rechecked before issuance.

Define retention separately for raw event payloads, normalized metadata, audio, redacted transcripts, extracted findings, and audit records. Proposed starting point for review: 30 days raw payloads, 90 days audio, 12 months redacted transcripts/findings, and 24 months normalized activity/assignment history; these are product retention proposals, not statements of legal requirements. Confirm recording consent, company policies, and contact restrictions before broad recording analysis. Deletion must propagate to derived text, caches, and storage while retaining a non-sensitive tombstone where permitted.

Owner health indicators: directory/mapping coverage, all-direction sync lag, complete windows, active subscription/expiry, webhook gap, unmatched/ambiguous identity counts, recording coverage by rep, denied permissions, STT backlog, AI budget, failed jobs, overdue follow-ups, and stale availability. Absence of data must read “unknown/not observed,” not zero performance.

Suggested launch targets: p95 webhook-to-visible metadata under 60 seconds; finalized Call Log reconciliation under ten minutes in normal quota conditions; assignment command under two seconds; no silent loss of accepted ownership on worker failure. These are proposed targets to load-test, not measured guarantees.

## 13. Delivery plan and acceptance gates

### Phase 0 — establish trustworthy coverage

Confirm actual RingCentral app/user identity, subscription owner, recording grants, presence permission, ACE license decision, and paid/available Gateway model access. Review the 24 user extensions against Agents/Extension Users and define staffing/contact rules. Preserve the current qualified-call ingestion path. Deliver mapping and capability screens, backfill manifests, and a reviewed data dictionary.

Acceptance: every sales-eligible extension is mapped or explicitly excluded; unknown permissions are visible; test recordings demonstrate intended cross-rep access; restored workers resume without lost records; all qualifying-call outcomes remain unchanged under replay.

### Phase 1 — Owner visibility and follow-up accountability

Deliver all-direction normalized call history, Contact Numbers, conservative Lead links, Sales Opportunities, explicit assignments/follow-ups, and the Owner Attention page. Backfill available history. Start urgency rules in review mode and validate gap candidates with the Owner.

Acceptance: replay and duplicate delivery do not double-count; pagination failure does not advance completeness; late call/Lead data refreshes affected work; shared/recycled/ambiguous numbers remain reviewable; every actionable opportunity is assigned/scheduled or visibly unassigned. Acceptance/reassignment races cannot produce two current owners. Suppressed numbers never get a call recommendation.

### Phase 2 — rep workflow and defensible performance

Deliver the chosen rep surface, offer acceptance, stale-availability handling, dispositions, and assignment-cohort metrics. Add recommendation suggestions based on eligibility, continuity, capacity, and modest performance weighting.

Acceptance: cross-rep ID guessing cannot expose another rep's records/audio; revoked users lose access; offline browser reconnect recovers current state; reports reconcile distinct Booking counts and Agent Allocation Binder; expired offers and recommendation versions are rejected safely.

### Phase 3 — conversation evidence

Enable bounded recording/STT/extraction jobs, evidence links, callback suggestions, and Owner corrections. Evaluate 50–100 representative calls across reps, inbound/outbound, short/long, voicemail, noise, transfers, multiple languages if relevant, and missing recordings. The investigation completed a two-recording smoke test, not this representative quality evaluation.

Acceptance: review-labelled extraction precision/recall by field, supported evidence citations, date-resolution tests, false callback/opt-out rates, intelligibility limits, redaction coverage, spend ceiling tests, and replay deduplication. Require a high-precision reviewed threshold for any finding that changes contact eligibility or due actions; keep such changes review-only until the threshold is agreed and demonstrated.

### Phase 4 — allocation optimization

Compare baseline assignment with recommendations in shadow mode, then an Owner-approved experiment. Measure staffed-time response, matured opportunity conversion, retained Binder, cancellations, workload distribution, and rep overrides. Use causal caution: historical high conversion may reflect better Lead allocation rather than greater skill.

Do not enable autonomous reallocation, calling, SMS, or live transfers as a side effect of this specification. Those are distinct product choices with their own user commands and validation.

## 14. Tests that matter

Use fixture-based replay for queue fan-out, duplicate legs, transfers across sessions, monitoring, answered voicemail, unknown callers, company-number calls, delayed events, duplicate webhook deliveries, and missing terminal events. Verify number normalization with US/international/internal/withheld inputs.

Identity tests must cover duplicate Leads in one Source Granularity, cross-source same phone, Form Fill, multiple moves on one number, alternate Granot contact, changed/renamed rep extensions, and deleted historical Analytics users. Existing Call Qualification/CPL/Booking tests must remain unchanged.

Concurrency tests: two accepts, accept versus reassignment, lost lease, queue retry, expired recommendation, and outbox publish failure after commit. Recovery tests: 429/401/403/404, partial page windows, recording availability delay, provider outage, depleted AI budget, failed extraction, Blob expiry, and deletion propagation.

Metrics tests should use distinct sessions, unioned participant intervals, split Binder, cancellations after the reporting window, immature opportunity cohorts, overnight staffing, DST transitions, and incomplete coverage. Never turn missing permission into a zero-valued rep metric.

## 15. Decisions for the next discussion

The evidence is sufficient to start Phase 0 and design Phase 1. The remaining business decisions are specific:

1. Which RingCentral users are sales reps, service staff, managers, dialer identities, or shared accounts? Are external/VICI dialer interactions outside this account a material coverage gap?
2. Does the Owner want offers that reps accept, direct assignments, or both? Who can reassign and under what timeout?
3. What are actual staffed hours, customer contact windows, follow-up expectations, and valid closure reasons?
4. Should a rep's primary surface be the Granot extension or a restricted web workspace?
5. What recording/transcript visibility and retention should each role have? Can full company recording and presence permissions be granted to the integration?
6. Does the account already license ACE for relevant reps, or should we fund the inexpensive Gateway path?
7. Which outcome is the allocation objective: timely contact, retained Binder, Booking conversion, or a balanced policy? Avoid optimizing raw dial volume.

No answer to these questions is required to understand or review the attached data prototype. They are implementation decisions, not gaps hidden behind a confident score.

## 16. Deliverables and reproducibility

See [prototype findings and runbook](prototype-findings.md). The local preview is `scripts/dev_ops/ringcentral/output/sales-intelligence/preview.html`; it includes real masked number timelines, the seven follow-up candidates, rep evidence, and capability limits. All source probes and raw artifacts remain under the repository's already-gitignored `scripts/dev_ops/` tree. These files are local deliverables and will not travel in a normal commit unless deliberately packaged.

This proposal extends the existing Call Qualification, Lead Conversation, Agent Allocation, Extension User, Granot lifecycle, domain-command, and queue/drainer patterns. It preserves MongoDB as the system of record. No identified ADR conflict requires changing those boundaries.
