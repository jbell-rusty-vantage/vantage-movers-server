# 01 — Call & Sales Intelligence specification

Execution update September 19: [SPRINT-PLAN](workspace/SPRINT-PLAN.md) changes delivery order and adopts the supplied design export into the existing Admin dashboard. Local Admin/API integration comes first.

Owner send destination (September 19): an Owner Rep Nudge may target any current User extension on the stored directory snapshot for that RingCentral account. A reviewed Rep Identity Link is not required to send. Attribution, metrics, auto-assignment, and “outbound by a reviewed Sales Rep” analysis still require reviewed identity. Never automatic. Never the customer.

Status: build contract, not shipped. Revised September 17, 2026 after the Owner interview. [Pack index](README.md) · [Agent/envelope contract](10-intelligence-agent-contract.md) · [Delivery workspace](workspace/README.md).

## 1. The Owner question

What needs outreach, why, what actually happened, which Lead and Booking it relates to, who is responsible, and what the Owner can do next. Number Activity remains searchable even without a Lead. Completeness, explicit outcomes, and traceable responsibility are the product, not a guessed lead score.

## 2. Scope

First release includes all-direction call capture; Number Activity and conservative Number↔Lead attachment; Outreach, multiple follow-ups, assignment, notes and closure; Attention plus Needs review; recordings/transcription; an AI SDK agent using Vantage MCP; automatically applied permitted intelligence with later Owner correction; reviewed Agent/RingCentral links; Owner Rep Nudge; and Owner-only Search, Reps, Coverage, and live updates.

Call Qualification remains inbound, answered, mapped RingCentral Inbound Number, at least 120 seconds, and caller phone present. It is separate from recording-analysis eligibility, which has no minimum duration for the eligible cases in §7. Do not widen Call Lead Ingestion, Duplicate Lead, CPL, Form Fill, Booking, Cancellation, Customer upsert, or Agent Allocation.

No Sales Opportunity object, rep portal, assignment offers, presence-weighted allocation, live call control, autonomous messages, or filesystem/Eve agent is required. Customer messaging stays in the existing Lead Message workflow. Official record changes open existing Vantage workflows with context.

### 2.1 Record scope and design boundary

This operational feature uses current Vantage records (Admin logical `production` scope). The dashboard's `historical` and `combined` scopes refer to a separate legacy data store, not test mode, and are not CSI subjects in v1. Reject those scope values explicitly rather than silently reading/writing current records. Historical RingCentral call backfill within the current dataset remains supported; it is unrelated to the legacy Admin database selector. Test/Preview isolation uses server `TEST_MODE`/`TEST_MONGO_DATABASE_NAME`, never a browser toggle, and must stay consistent across workers, MCP, reads and writes.

The `vantage-sales-intelligence` design export is present and was source-inspected September 19. Its components, tokens and UX explanations are adaptation inputs for the existing Admin dashboard. It does not change data scope, server rules, permissions or required actions. See [07](07-claude-design-brief.md) for the design intake and [11](11-codebase-alignment-audit.md) for verified integration points.

## 3. Proposed glossary (CONTEXT.md format)

Add to workspace `CONTEXT.md` under a new `### Call & Sales Intelligence` heading once reviewed. Each entry is written in the glossary's own format.

**Contact Number**:
A normalized external telephone endpoint (E.164) whose observed call activity survives the absence of a Lead. It is not a Customer, not a RingCentral Inbound Number, and not proof of one household.
_Avoid_: Customer phone (when meaning the endpoint record), caller (when meaning the record), number-lead

**Call Interaction**:
One canonical telephony session observed from RingCentral (account + `telephonySessionId`, with `sessionId` and Call Log record aliases), with its parties, legs, direction, timing, provider result, recording pointer, and provenance. Owner-hidden implementation term; feeds Number Activity.
_Avoid_: Call (in Owner copy), call record, Call Lead

**Number Activity**:
The searchable, chronological timeline of Call Interactions, Lead Messages, Lead Conversations, Follow-ups, and Owner actions on one Contact Number. What the Sales Intelligence dashboard searches.
_Avoid_: Call history (ambiguous with RingCentral Call Log), number timeline (implementation term)

**Number↔Lead Attachment**:
An evidence edge between one Contact Number and one Form Lead or Call Lead, with the exact field that supplied the evidence and its state (Candidate, Ambiguous, Attached, Rejected). Phone equality is a candidate, not a merge.
_Avoid_: Lead match, merge, linked lead (when the state matters)

**Number Review**:
Sales work on a Contact Number with no applicable Vantage Lead, opened by the Owner or the accepted missed-inbound/clear-commitment rules. Carries Outreach state without creating a Lead.
_Avoid_: Lead, opportunity, number-only lead

**Outreach**:
The state of sales work on one eligible Lead or Number Review: Unworked, Open, Waiting on Customer, Identity Review, or Closed with a reason. Overdue, No Owner, and Cooldown are derived signals, not states.
_Avoid_: Lead status (Granot priority), follow-up status, score

**Follow-up**:
One next action on an Outreach Record, originating from an Owner command, a clear conversation commitment/request, or a system default. Carries action kind, optional due time, responsible Agent when known, outcome, and provenance. Several may be active at once.
_Avoid_: Task, reminder, callback (when meaning the record)

**Intelligence Finding**:
A versioned, citation-backed extraction from one Lead Conversation transcript (intent, promised callback, objection, quoted amount, booking claim, contact restriction). The server may automatically apply its permitted Outreach effects without prior review. Never authorizes official Lead, Booking, Cancellation, or contact-field mutations. Owner corrections take precedence.
_Avoid_: Insight, AI summary (when meaning a specific finding), fact

**Rep Identity Link**:
A reviewed, effective-dated map between one Agent and one RingCentral User extension, optionally an Extension User and a Granot username. Required before rep metrics, automatic assignment from a conversation or promise, and “outbound by a reviewed Sales Rep” analysis. Not required for an Owner Rep Nudge.
_Avoid_: Agent mapping (unqualified), extension (when meaning the link)

**Owner Rep Nudge**:
An explicit Owner command that sends one internal message to one current User extension on the stored directory snapshot for that RingCentral account, over RingCentral Team Messaging, SMS to that User's RingCentral DID, or company pager, about one Outreach Record. The Owner chooses the User. A reviewed Agent match is not required. Never the customer, never automatic.
_Avoid_: Notification, alert, SMS (unqualified), Lead Message

**Contact-Type Signal**:
The evidence-based classification of a provider-connected Call Interaction as Voicemail, Human Conversation, or Unknown. Provider `Call connected` alone is Unknown.
_Avoid_: Answered, connected (when meaning a human spoke)

**Coverage Watermark**:
The instant up to which all-direction call history is known complete for this RingCentral account, plus any known gaps. Anything after it reads "not yet observed", never "nothing happened".
_Avoid_: Sync time, last run

## 4. What hangs off what

Contact Number → Number Activity → Call Interactions, Lead Conversations, Lead Messages, Owner actions and follow-ups. Number↔Lead attachment edges expose Form/Call Leads and read-only Booking/Cancellation context. One Outreach Record exists per Lead or Number Review. An Outreach Record has multiple follow-ups, one overall responsible Agent, and append-only action history. Each follow-up may have a different responsible Agent.

Conversation evidence → immutable analysis run → typed Intelligence Findings, summary, suggestions, Owner-instruction assessments, and server effect ledger. A Needs review item explains a specific unresolved decision. It is not a new Outreach state. Rep Identity Links map Agents to RingCentral users; assignment is not Agent Allocation or Lead receiver provenance.

## 5. The four state machines

### 5.1 Contact Number classification and channel restrictions

Classification: `unknown`, `customer`, `company`, `non_customer`. Directory evidence may classify an unknown company number; an Attached edge may classify an unknown customer number. Only the Owner or an explicit provider block-list policy may classify non-customer. AI intent is a review suggestion, not automatic classification.

Keep eligibility (`allowed`, `temporarily_blocked`, `suppressed`, `unknown`) separate from classification. Add channel-scoped restriction records. A clear spoken restriction immediately pauses the affected channel and opens Needs review; it does not close Outreach. “Don't call before Friday” is temporary; “don't call again” pauses calls pending Owner resolution; neither automatically prohibits texting. Owner-set permanent suppression remains in force. A restriction can block an Owner-planned action without rewriting that action. No dial/nudge-to-call suggestion while calling is blocked. Paused work remains visible for review.

### 5.2 Number↔Lead attachment

States: `candidate`, `ambiguous`, `attached`, `rejected`; absence of edges is unlinked. Exact stored Call Lead provider session/Call Log identity permits deterministic attachment. Reviewed attachments stay unchanged. Unique phone/time evidence gives Candidate, not a merge; overlapping candidates give Ambiguous, never newest-wins. Owner attach/reject/detach happens here; official Lead or Booking reconciliation happens in its existing workflow.

Retain matching windows: Form Lead timestamp −36 hours/+14 days; Call Lead ±12 hours. Include live contact, Ingested Contact Snapshot, Granot Contact Snapshot, and original caller evidence with source/time provenance. Never infer advertiser attribution from an outbound caller ID. Automation never overrides a reviewed attachment or re-suggests a rejected pair. A later snapshot must not rewrite historical call identity. Attribution is resolved for each interaction/action using its event time and evidence window, not by counting all lifetime edges on the number. A single eligible Candidate may support attributed work with Likely certainty; Ambiguous may be analyzed at number level but cannot cause Lead-specific follow-up effects. Multiple non-overlapping historical moves can share a number without blocking current work. A unique current Attached edge outranks unreviewed candidates; competing Attached edges applicable to the same event require Owner review. An exact session match authorizes that interaction, not every later call forever.

### 5.3 Outreach

| State | Meaning |
| --- | --- |
| `unworked` | Eligible work with no attributable outbound attempt, inbound human conversation, or Owner mark-worked since its trigger. |
| `open` | Work started; active rep/Owner actions may exist. No active next step is a visible exception. |
| `waiting_on_customer` | Clear customer commitment with a resolved deadline, or an explicit Owner wait, and no independent action requiring Open. |
| `identity_review` | Lead-specific work is blocked by ambiguous attachment; retain prior state and follow-ups. |
| `closed` | Official eligibility reason or explicit Owner closure. AI cannot close or reopen it. |

Form/Call Leads create one Outreach Record. Duplicate, Bad Lead, Booked, Cancelled and No-Sync Leads have Closed records with the official reason. On official flag changes, close deterministically, including when the record was in identity review; resolving identity must never restore an obsolete pre-closure state. Closed never reopens automatically. Owner reopen rechecks live eligibility; it cannot override an official Booking or permanent suppression merely by changing Outreach state.

Mapped unanswered inbound traffic with no eligible Lead can create a Number Review. A clear sales request or rep commitment found on other eligible analyzed traffic can also create one. Respect existing Owner closure and current eligibility. Do not create a Number Review to evade ambiguous Lead identity or an officially closed related Lead; retain number-level evidence and a review item instead. Rejected unrelated attachments do not prevent genuine number-only review.

| Trigger | Transition/effect |
| --- | --- |
| Attributable outbound attempt, including voicemail/no answer | Unworked → Open; record exact outcome. Does not establish human contact. |
| Attributable inbound human conversation with Sales Rep | Unworked → Open; record customer-initiated contact and actual rep. Clears No call yet. |
| Owner Mark as worked | Unworked → Open; optional note; no mandatory next step and no implied customer contact. |
| Clear customer promise with resolved time | Open → Waiting on Customer, unless other active work or Owner instruction requires Open. |
| Customer calls while waiting | End the matching customer wait. If missed, create callback-needed work; keep the same assigned rep. |
| Customer wait expires | Open with due follow-up; day-only wait returns to Attention at next sales opening. |
| Official eligibility flag changes | Close with mirrored reason. Preserve history; cancel remaining active obligations with that closure reason. |
| Owner Close | Close with reason, cancel active follow-ups atomically, retain their history. |
| New missed call/request after closure | Needs review; preserve Closed. Owner may reopen after eligibility checks. |

Human conversation evidence sets `last_meaningful_contact_at`; unanswered attempts, voicemail, provider-connected unknown, and delivered automated texts do not. Unknown evidence is never silently promoted to conversation.

### 5.4 Conversation processing

Retain `discovered`, `media_stored`, `transcribed`, `complete`, `no_recording`, `unavailable`, `failed`, `dead_letter`. Separate analysis run/job state from the conversation's latest successful version: rerunning does not erase the previous completed analysis. Recording availability, transcription, analysis and application status are separately visible.

Recording not yet present is pending discovery, not proof none will exist. Permission denied/throttled/budget-limited are Unavailable with retry reason. Reconcile delayed recordings. Definitive absent/expired media is No recording. Contact type is `unknown`, `voicemail`, or `human_conversation`; short duration or provider-connected alone never proves voicemail or human contact.

## 6. Attribution, responsibility, and follow-ups

An attributable call uses a single eligible Candidate/Attached Lead edge or the Number Review's own number, occurs after the work trigger, includes evidence of an actual user extension handling the call, and is not internal/monitoring/queue fan-out alone. Missing/ambiguous evidence stays visible without counting as work. Inbound human contact counts; inbound ringing/missed calls do not.

Owner assignment persists until the Owner changes it. If unassigned, one reliably identified Sales Rep in the first human conversation can become responsible, with provenance. A clear promise by a reliably mapped rep may also fill an unassigned record. Multiple possible reps do not produce guessed ownership. Do not copy or mutate `receiver_agent`, Agent records, or Booking allocations.

Follow-ups are multiple, independently versioned actions: call, text via Lead Message, send estimate, check availability, review, wait, reconcile identity, or other with description. Due time may be null: show Due date needed in Needs review, never overdue. Each has responsible Agent, origin (Owner / rep promise / customer request / system), source evidence, explicit assignment provenance, and outcome. A model's own strategy suggestion is not active work until Owner Apply.

Overall assignment differs from action responsibility. If Alex owns Outreach and Jordan promises a callback, Jordan owns that callback unless the Owner assigned that specific callback otherwise. Preserve Promised by Jordan / Assigned to Jordan / Outreach owned by Alex. Unknown promising identity leaves the action unassigned even if the overall record has an owner; surface that action's missing responsibility.

A relevant subsequent attempt fulfills a simple callback promise even when unsuccessful: No answer, Left voicemail, Spoke with customer, or Connected—contact unknown. It does not complete unrelated tasks or reset Going cold. Clear later confirmation may complete a uniquely matched action, e.g. Completed based on customer confirmation. Clear rescheduling revises only that action with history. Ambiguous completion/rescheduling opens review. Owner corrections cannot be undone by later extraction.

Owner notes add attributed context; they never silently mutate work. Owner correction updates the affected action immediately, then re-analysis updates summary and agreement. Whole-analysis and individual confirmation apply to exact versions and do not replay effects. Closing does not erase history; reopening does not silently revive cancelled obligations.

## 7. Analysis qualification and missing evidence

Analyze recorded inbound/outbound calls of any duration when at least one applies:

1. Single Candidate/Attached Form Lead or Call Lead context (including closed/Booked/Cancelled Leads).
2. Owner-opened Number Review.
3. Inbound to a mapped RingCentral sales number, even without a Lead.
4. Outbound by a reviewed Sales Rep, even without a Lead or Number Review.
5. Ambiguous Lead context, for number-level analysis only; Lead-specific effects remain blocked.

Internal/company calls and known non-customer numbers are excluded from automatic sales analysis. Owner may explicitly request analysis of available evidence with an audited exception; that does not lift contact restrictions. Both customer and rep voicemail messages receive full analysis. No 45/90/120-second threshold gates these cases. Duration can affect queue priority/cost, not eligibility. Unmapped, otherwise unqualified traffic remains searchable and in Coverage hygiene.

Capture and operational tracking work without audio or AI. Missing recording, transcript pending, unknown contact type, delayed history, failed analysis, and budget pause are explicit. Analyze closed work for context; new commitments create review, never automatic reopening. Backfill checks newer evidence before activating historical obligations. Details and effects: [10](10-intelligence-agent-contract.md).

## 8. Attention order and clocks

Each Outreach item appears once in its highest-priority applicable category. Display all additional reasons and outstanding actions. Needs review is a visible group/filter alongside the seven; an actionable row also shows its review badges without duplicating the item in the default list. Review-only subjects use a stable subject key. Counts distinguish distinct items from reason totals.

| Priority | Owner category | Rule |
| --- | --- | --- |
| 1 | Promised callbacks overdue | An active rep-promised callback is past its deadline. Owner-confirmed or AI-origin is eligible; prior confirmation is not required. |
| 2 | No call yet after form submission | Eligible Form Lead remains Unworked; visible immediately, overdue after 30 staffed minutes. |
| 3 | Missed calls with no callback | Outstanding unanswered inbound; visible immediately, overdue after 15 staffed minutes. Repeat misses never extend original deadline. |
| 4 | Follow-ups due | Any active dated action due now, including customer-requested callbacks and expired waits; ownership is not required. |
| 5 | Being worked, but no next step | Open with no active follow-up/wait. Undated actions count as steps but need date review. |
| 6 | Open work nobody owns | Active Outreach or an outstanding action lacks required responsibility. |
| 7 | Going cold | Two sales days without human conversation (default 1440 staffed minutes); start at Lead arrival or Number Review trigger if none. Exclude work with a future agreed follow-up or active customer wait until due. |

Needs review includes ambiguous identity, unclear commitment/date, missing action responsibility, possible missing Booking/payment discrepancy, closure recommendation, restriction, model disagreement with an Owner instruction, and new requests on closed work. Ordinary unconfirmed assertions are not automatically review tasks. Resolve by the actual Owner action (attach/reject, date/assign, confirm/correct, reconcile, close/reopen, or resolve restriction), or audited dismissal when no action is needed. Same unresolved cause refreshes one item; new evidence after resolution can reopen it with history.

Settings defaults: America/New_York, Mon–Sat 08:00–20:00; first action 30 staffed minutes; missed callback 15 staffed minutes; Going cold two sales days; AI cap $80/month. All Owner-editable in Coverage with version/audit. Canonical cold threshold is `going_cold_staffed_minutes=1440` (24 staffed hours, two 12-hour sales days in the accepted initial schedule). Store this numeric threshold separately from the weekly calendar so unequal daily shifts are unambiguous. Coverage shows both the familiar days label for the default schedule and the actual staffed-hour threshold; editing weekly hours does not silently change the threshold. Show staffed and wall-clock age. Calendar changes do not silently rewrite existing scheduled promises. Default-deadline policy versions are stamped on each obligation; future triggers use the new policy.

Exact spoken times override sales hours, even Sunday at 2. Resolve using the call timestamp and explicit timezone, otherwise Eastern with the assumption shown. Day-only customer promises wait through that day's sales closing and return to Attention at the next sales opening. An explicit day with no configured hours, ambiguous AM/PM, past/contradictory date, or DST ambiguity needs review rather than a fabricated exact time. Clearly interpretable rep/customer-requested day-only actions use end-of-sales-day with that system default visible; uncertain wording remains undated. No “+48 hours” invented wait.

Within a category, earliest relevant deadline/oldest trigger first, then stable id. Existing cooldown default (3 unsuccessful attributable attempts in rolling 24 hours) remains a visible recommendation, not a new state, and never hides a due explicit promise. Closed, identity-blocked, or channel-blocked work is never presented as ready to call. Evidence gaps qualify every absence statement; historical incompleteness must not be described as proof that nobody called.

## 9. Invariants

1. Capture/intelligence never imports or changes Call Qualification/ingestion/convergence invariants or its sync cursor.
2. No official Lead, Booking, Cancellation, Customer or Agent write originates from an intelligence analysis. Attachments are this feature's own evidence edges.
3. The AI SDK agent reads through scoped MCP and submits one envelope. Main-server rules apply allowed effects automatically; Owner review is not a gate.
4. Exact citation-location/entailment verification is deferred; schema, scope, chronology, idempotency, live revisions and Owner precedence are enforced now.
5. Owner assignment/correction/closure is durable. Model agreement/disagreement is visible against the exact instruction version; silence is Cannot determine.
6. An explicit Owner command is required to send a Rep Nudge. Never automatic and never sent to the customer. The destination is a current User extension on the stored directory snapshot for that RingCentral account. A reviewed Rep Identity Link is not required to send. A name match, a `proposed` link, or an unmatched directory row never invents a destination; the Owner picks the User.
7. Same stored facts plus clock/policy produce the same Attention derivation; the model never emits rank or Outreach state.
8. Mongo is the system of record; queues wake durable jobs, scheduled workers recover them. Duplicate/out-of-order delivery cannot duplicate effects or regress terminal interactions.
9. Raw STT stays transient; persisted evidence is redacted; media is private. Provider recording URLs/tokens never enter stored transcripts, logs, or queue payloads.
10. Every read carries as-of time and coverage. Unknown/denied/incomplete never becomes a false zero.

## 10. Owner language and actions

Use explicit outcome wording throughout. Provider-connected is not Spoke. Say Customer left voicemail or Rep left voicemail when supported; otherwise Voicemail—speaker unknown. Absence copy says No call observed in available history, with coverage. Certainty labels remain Exact / Likely / Unsure / Confirmed by you.

Action set: Set callback date, Set/add next step, Assign Outreach or individual action to Agent, Message rep, Mark as worked, Start the call, End the call, Close/reopen, Add note, confirm/reject attachment, Confirm analysis, confirm/correct/retract assertion, Re-analyze original evidence, Re-analyze current context, and open existing Lead/Booking workflows. Start the call / End the call write Call state on the Outreach Record only; they are not a new official Outreach state. AI-applied / Owner-set / Confirmed by you / Corrected by you are distinct provenance labels. Analysis confirmation means the Owner reviewed it; it does not certify an official Booking or payment.

## 11. Delivery boundary

[03](03-server-pipeline-and-jobs.md) owns triggers/queues/workers; [10](10-intelligence-agent-contract.md) owns the envelope and application protocol; [workspace](workspace/README.md) owns team assignments, dependencies, contracts, and acceptance evidence. This pack specifies work; live subscriptions, recording grants, production flags, model selection, and deployments still require capability checks during implementation. The September 14 capability denial is historical evidence, not a fresh production probe.

## 12. Precise action lifecycle rules

**Snooze:** preserves contractual `due_at` and provenance; only `attention_due_at = max(base_attention_due_at, snoozed_until)` changes for a dated action. Undated actions cannot be snoozed into a fabricated deadline: reject snooze with INVALID_INPUT and offer Set date; Due date needed remains visible. The Owner sees Due Friday / Snoozed until Monday. Until snooze expires, suppress that action's overdue/due ranking and call-nudge suggestion, but retain its contractual-overdue indicator in detail. Other due actions, missing identity/ownership, new missed calls and restrictions are unaffected. A future snoozed action also prevents Going cold for that action plan. Cancelling/completing the action ends snooze; editing contractual date requires the explicit date command. Snooze cannot lift a restriction or reopen work.

**Missed-call episodes:** maintain one open `system_default` callback obligation per subject/number since the first unresolved miss. Each additional miss appends evidence; the earliest trigger/deadline remains. A subsequent attributable outbound attempt or an attributable inbound human conversation resolves that episode with the actual outcome. The next missed call after resolution creates a new episode. Unknown provider connection alone does not resolve an episode. A callback fulfilling a particular rep promise may also resolve the current missed episode if the same actual call is relevant to both; both completion effects are recorded.

**Customer waits:** `waiting_on_customer` requires a future, unfulfilled wait and no independent rep action requiring Open. A due wait remains an open `wait` action with `wait_expired_at`, reason Customer call not observed, and next-opening `attention_due_at` for day-only promises; state becomes Open. Do not immediately put it back into Waiting or invent a new rep promise. A subsequent customer call completes the matching customer-wait action even if missed; missed outcome opens the episode above. Distinct active actions remain untouched.

**No recording/manual reality:** Mark as worked never marks Spoke. An Owner who can attest to a call's actual outcome may explicitly record its contact type with reason/evidence; this is an audited call-evidence correction, distinct from work status. Later model disagreement is shown and cannot overwrite it. This makes inbound human attribution usable even when audio is unavailable.
