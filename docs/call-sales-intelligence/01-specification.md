# 01 — Call & Sales Intelligence specification

Status: implementation-ready. Date: September 14, 2026. Pack index: [`README.md`](README.md).

## 1. The Owner question

> What needs outreach, why, how old is the last contact, which Lead (if any) it attaches to, how sure we are, and who should I ping about it.

The answer must be searchable by phone number, name, Job Number, or Agent, and it must update in real time as calls happen. Completeness and ownership beat a clever lead score.

## 2. Scope

### In scope (first release)

- All-direction RingCentral call history (inbound, outbound, missed, short, voicemail, transferred, internal), normalized into **Call Interactions** and grouped by **Contact Number** into a searchable **Number Activity** timeline.
- Conservative **Number↔Lead attachment** edges (Candidate / Ambiguous / Attached / Rejected) with Owner review.
- **Outreach** state on every eligible Form Lead or Call Lead, and on Owner-created **Number Reviews**, with **Follow-ups** and derived **Overdue / No Owner** signals.
- **Rep Identity Links**: Agent ↔ RingCentral User extension, reviewed by the Owner.
- **Owner Rep Nudge**: explicit Owner command that posts to a mapped Sales Rep over RingCentral Team Messaging (primary), SMS-to-rep-DID, or company pager.
- Conversation processing on **sales-relevant** recordings: bounded media fetch → private Blob → transcription → redaction → versioned **Intelligence Findings**, all review-only. Extends `lead_conversations`.
- Owner dashboard `/sales-intelligence` with Attention, Numbers, Reps, and Coverage views, a live feed, and full-text search.
- Capability and coverage honesty on every screen.

### Out of scope (explicitly)

- A Sales Opportunity CRM object, rep worklists, assignment offers, presence-weighted allocation (later phase, same server routes).
- Any change to Call Qualification, Call Lead Ingestion, Duplicate Lead, CPL, Form Fill, Booking, Cancellation, Customer upsert, or Agent Allocation.
- Live call control (hang up, barge, transfer), autonomous SMS/Team Messaging/pager, ACE / RingSense (not licensed), customer-facing messages from this system (Lead Message on Twilio stays the only customer SMS).

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
Owner work on a Contact Number that has no Vantage Lead. Carries Outreach state without creating a Lead.
_Avoid_: Lead, opportunity, number-only lead

**Outreach**:
The state of sales work on one eligible Lead or Number Review: Unworked, Open, Waiting on Customer, Identity Review, or Closed with a reason. Overdue, No Owner, and Cooldown are derived signals, not states.
_Avoid_: Lead status (Granot priority), follow-up status, score

**Follow-up**:
An explicit next action on an Outreach Record: action kind, due time, responsible Agent when known, disposition, and evidence.
_Avoid_: Task, reminder, callback (when meaning the record)

**Intelligence Finding**:
A versioned, citation-backed extraction from one Lead Conversation transcript (intent, promised callback, objection, quoted amount, booking claim, contact restriction). Always a review suggestion; never writes a Booking, contact field, or due date on its own.
_Avoid_: Insight, AI summary (when meaning a specific finding), fact

**Rep Identity Link**:
A reviewed, effective-dated map between one Agent and one RingCentral User extension, optionally an Extension User and a Granot username. Required before any rep nudge or rep metric.
_Avoid_: Agent mapping (unqualified), extension (when meaning the link)

**Owner Rep Nudge**:
An explicit Owner command that sends one internal message to one mapped Sales Rep over RingCentral Team Messaging, SMS to the rep's RingCentral DID, or company pager, about one Outreach Record. Never the customer, never automatic.
_Avoid_: Notification, alert, SMS (unqualified), Lead Message

**Contact-Type Signal**:
The evidence-based classification of a provider-connected Call Interaction as Voicemail, Human Conversation, or Unknown. Provider `Call connected` alone is Unknown.
_Avoid_: Answered, connected (when meaning a human spoke)

**Coverage Watermark**:
The instant up to which all-direction call history is known complete for this RingCentral account, plus any known gaps. Anything after it reads "not yet observed", never "nothing happened".
_Avoid_: Sync time, last run

## 4. What hangs off what

```
Contact Number  (endpoint identity, classification, contact eligibility)
      │
      ├── Number Activity           searchable timeline (derived view over the rows below)
      │     ├── Call Interaction(s)          call_interactions
      │     ├── Lead Message(s)              lead_messages   (official, Twilio, same digits)
      │     ├── Lead Conversation(s)         lead_conversations (when audio exists)
      │     └── Owner actions / Follow-ups   outreach_records.events[], followups
      │
      └── Number↔Lead Attachment edges       number_lead_attachments   0..N Form Leads / Call Leads
            └── Booking / Cancellation context via those Leads (read-only)

Outreach Record  (one per eligible Lead, or one per Number Review)
      ├── subject: Lead (FormLead | CallLead)  or  Number Review (Contact Number)
      ├── state machine §5.3
      ├── Follow-up(s)
      ├── Sales Assignment (later phase; field reserved)
      └── Owner Rep Nudge(s)  (audit rows; never a side effect)

Rep Identity Link   Agent ↔ RingCentral User extension  (+ Extension User, Granot username)
```

Customer upsert, Agent Allocation, receiver_agent, Sheet Sync, and CPL are untouched.

## 5. The four official machines

Keep them orthogonal. Never encode one in another.

### 5.1 Contact Number classification

Field: `contact_numbers.classification`. Sibling attribute: `contact_eligibility` with `reason`.

| State | Meaning | Set by |
| --- | --- | --- |
| `unknown` | Observed; intent not decided. Default. | System on first observation |
| `customer` | Reviewed or strongly evidenced household/customer phone. | System when any Attached edge exists, or Owner |
| `company` | Vantage / RingCentral owned: DID, queue, IVR, extension. | System from directory sync; Owner |
| `non_customer` | Vendor, spam, wrong party, robocall, other. | Owner; system only from an explicit provider block list |

Transitions: any → any by Owner command `classify_number` with reason. System may only move `unknown → customer` (Attached edge) or `unknown → company` (directory match). System never moves anything to `non_customer`.

Contact eligibility (`contact_eligibility.state`): `allowed` (default) / `temporarily_blocked` (with `until`) / `suppressed` / `unknown`. Set by Owner command or a reviewed Finding (`contact_restriction`) that the Owner accepts. **A high urgency must never override `suppressed`.** Suppressed numbers never appear in the Attention dial order and never receive a nudge suggestion.

### 5.2 Number↔Lead attachment

One row per (Contact Number, Lead model, Lead id). Field: `number_lead_attachments.state`.

| State | Meaning |
| --- | --- |
| `candidate` | Unique phone/time suggestion from a live phone, Ingested Contact Snapshot, Granot Contact Snapshot, or `ringcentral.original_caller`. Safe to show, unsafe to merge. |
| `ambiguous` | This Contact Number has ≥ 2 candidate Leads whose evidence windows overlap. No newest-wins. |
| `attached` | Exact stored Call Lead identity (`ringcentral.telephony_session_id` / `session_id` / `call_log_id`), RingCentral Call Adoption, or Owner attach. |
| `rejected` | Owner said this number is not that Lead. Never re-suggested for that pair. |

`unlinked` is not a row; it is the absence of rows for a Contact Number.

Matching precedence (deterministic, in `attachment/suggest.ts`):

1. Exact provider session / call-log id on a Call Lead → `attached` (`evidence.source = "call_lead_ringcentral_identity"`).
2. Existing reviewed attachment → unchanged.
3. Authorized call-initiation context tied to one Lead, corroborated by the provider (later phase; reserved `evidence.source = "assignment_context"`).
4. Unique phone-and-time candidate → `candidate`. Window: Lead `timestamp` − 36 h through +14 d for Form Leads; Call Lead `timestamp` ± 12 h.
5. Multiple candidates whose windows overlap → every one `ambiguous`; Outreach on those Leads → `identity_review`.
6. No candidate → no row. Number-only activity stays first-class. Never manufacture a Form Lead or bypass Call Qualification.

Transitions:

| From | To | Trigger |
| --- | --- | --- |
| (none) | `candidate` | suggest run finds exactly one Lead in window |
| (none) | `attached` | exact identity |
| `candidate` | `ambiguous` | a second overlapping candidate appears |
| `ambiguous` | `candidate` | Owner rejects the other candidates |
| `candidate` / `ambiguous` | `attached` | Owner command `attach_lead` |
| any | `rejected` | Owner command `reject_lead` |
| `attached` | — | terminal for automation; Owner may `detach` (records new `rejected` row, keeps history) |

Rules: do not reuse `findBestCallLeadMatchByPhone` (newest-wins). Do not inherit advertiser attribution from the outbound caller-ID a rep used. A later Granot snapshot must not rewrite what an earlier call meant (store `observed_at`).

### 5.3 Outreach (the important machine)

Field: `outreach_records.state`. One record per subject. Subject is `{ kind: "lead", model, id }` or `{ kind: "number_review", contact_number_id }`.

**Eligibility** for automatic Lead records: Form Lead or Call Lead that is not Duplicate, not Bad Lead, not Booked, not Cancelled, not `no_sync`. Booked/Cancelled/Duplicate/Bad Leads still get a record, created directly in `closed` with the matching reason, so the timeline can explain itself.

| State | Meaning | Required fields |
| --- | --- | --- |
| `unworked` | Actionable, and no attributable outbound after the trigger (Lead arrival or unanswered inbound). | `trigger_at`, `first_action_due_at` |
| `open` | Outreach started (attributable outbound or explicit Owner open). | `next_action` (kind + `due_at`) — absence is an exception, surfaced as `no_next_action` |
| `waiting_on_customer` | Last meaningful contact happened; ball in their court after a reviewed promise or explicit wait. | `wait_until`, `wait_reason` |
| `identity_review` | Unsafe to work until attachment resolves. | `blocking_attachment_ids[]` |
| `closed` | Explicit reason. | `closed_reason` ∈ `booked`, `cancelled`, `lost`, `duplicate`, `bad_lead`, `suppressed`, `not_sales`, `no_sync`, `owner_dismissed` |

Transitions:

| From | To | Trigger | Actor |
| --- | --- | --- | --- |
| (create) | `unworked` | eligible Lead stored; or unanswered inbound on a number with no open record; or Owner `open_number_review` | system / Owner |
| (create) | `closed` | ineligible Lead stored (reason mirrors the flag) | system |
| `unworked` | `open` | first **attributable outbound** Call Interaction observed after `trigger_at` (see §6 attribution); or Owner `mark_worked` | system / Owner |
| `unworked` | `identity_review` | attachment becomes `ambiguous` | system |
| `open` | `waiting_on_customer` | Owner accepts a Finding of kind `promised_callback` or `customer_will_call`; or Owner `set_waiting` | Owner |
| `waiting_on_customer` | `open` | any inbound from the number, or `wait_until` passes | system |
| `identity_review` | previous state | attachment resolves (all edges `attached`/`rejected`/single `candidate`) | system |
| `open` / `unworked` / `waiting_on_customer` | `closed` | official Booking or Cancellation attaches to the subject Lead; Duplicate / Bad Lead / `no_sync` flag set; Owner `close` with reason | system / Owner |
| `closed` | `open` | Owner `reopen` with reason (never automatic) | Owner |

Derived signals (computed at read time by `outreach/derive.ts`, versioned by `policy_version`, never stored as state):

| Signal | Definition |
| --- | --- |
| `overdue` | `unworked` and now > `first_action_due_at`; or `open` and now > `next_action.due_at`; or `waiting_on_customer` and now > `wait_until`. |
| `no_owner` | state ∈ {`unworked`,`open`,`waiting_on_customer`} and no `responsible_agent_id` and no `receiver_agent` on the subject Lead. |
| `no_next_action` | `open` and `next_action` is null. Shown as an exception. |
| `cooldown` | ≥ 3 attributable outbound attempts in the last 24 h with no Human Conversation. Suppresses "dial now" ranking; does not change state. |
| `last_meaningful_contact_at` | latest of: Human Conversation Call Interaction end, delivered Lead Message, inbound answered call. Voicemail is **not** meaningful contact. |
| `staffed_clock` | age measured in staffed minutes using `SALES_INTELLIGENCE_STAFFED_HOURS` (America/New_York). Wall-clock age is shown beside it. |
| `attention_rank` | ordering in §8. |

`first_action_due_at` = `trigger_at` + `SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES` in staffed time (default 30; Owner decision, see 06 §7).

### 5.4 Conversation intelligence processing

Extends `lead_conversations.state`. Existing values stay; two are added. No parallel store.

| State | Meaning | Owner label |
| --- | --- | --- |
| `discovered` | Recording id known from a Call Interaction. | "Recording found" |
| `media_stored` | Private Blob holds the audio. | "Audio saved" |
| `transcribed` | Redacted transcript persisted; findings pending. | "Transcript ready" |
| `complete` | Redacted transcript + versioned findings published. | "Reviewed by AI" |
| `no_recording` | Durable absence: provider 404 or never recorded. | "No recording" |
| `unavailable` (**new**) | Permission, throttle, or budget prevented processing; retry later. Follow-up still works. | "Audio not available yet" |
| `failed` | Terminal processing error. | "Could not process" |
| `dead_letter` | Exhausted attempts. | "Could not process" |

Orthogonal `contact_type` on both the Call Interaction and the Lead Conversation: `provider_connected` → `voicemail` / `human_conversation` / `unknown`. Set by `contactType/classify.ts` (deterministic rules first, cheap LLM second, §03). A provider-connected voicemail must **not** complete first-action.

## 6. Attribution rules (what counts as "we worked it")

An outbound Call Interaction is **attributable** to an Outreach Record when all hold:

1. Its external Contact Number has a `candidate` or `attached` edge to the subject Lead (or is the Number Review's number).
2. Its `started_at` ≥ `trigger_at`.
3. At least one connected User extension party exists (queue/IVR-only legs do not count).
4. It is not a Monitoring or internal-only leg.

Attributable outbound moves `unworked → open`. It does **not** set `last_meaningful_contact_at` unless `contact_type = human_conversation`.

Inbound from the customer after arrival is evidence on the timeline, not proof the form was worked; it does not move `unworked → open` (it can move `waiting_on_customer → open`).

Queue fan-out (`IP Phone Offline`, `Stopped` legs), transfers, and multiple connected users are routing observations. Ownership does not hop; the interaction stays on the number.

## 7. Scenarios → states

| Scenario | Outreach | Attachment | Number class | Conversation | Owner sees |
| --- | --- | --- | --- | --- | --- |
| Form Lead stored, no post-arrival outbound | `unworked` | candidate or none | customer | none | "Nobody has called this Form Lead yet" + age |
| Form Lead, inbound only after arrival | `unworked` | candidate | customer | maybe | "They called us; we have not called them back" |
| Outbound connected, decent duration, form-linked | `open` | candidate/attached | customer | discovered → complete | "Called back · 12 min · needs a next step" |
| Provider-connected voicemail | unchanged | unchanged | unchanged | contact_type voicemail | "Left voicemail" — still Unworked/Open |
| Human conversation, rep unsure of next step | `open` (Owner may set waiting) | unchanged | customer | complete + findings | findings card with Accept / Dismiss |
| Days pass | `open` + overdue | unchanged | unchanged | running summary Finding | row rises in Attention with age |
| Unanswered inbound, no later outbound, number has no Lead | `unworked` Number Review candidate (auto-created only when the inbound hit a mapped RingCentral Inbound Number; else Owner opens) | none | unknown | none | "Missed call · no callback observed" |
| Sales-sounding activity, no Vantage Lead | none until Owner `open_number_review` | none | unknown | optional | "No Lead on file" chip |
| Unmapped inbound DID | none | none | unknown | none | Coverage view hygiene count, not Attention |
| Ambiguous multi-lead phone | `identity_review` | ambiguous | customer | on the number | "Which Lead is this? Pick one" |
| Exact stored Call Lead identity | unchanged | attached | customer | — | Lead chip with "exact" certainty |
| Booked or Cancelled | `closed` | often attached | customer | coverage gap | "Booked · P5562444" — no reactivation |
| Transcript says "booked" but no Booking | unchanged | unchanged | unchanged | finding `booking_claim` | "Customer said booked — no Booking on file" (review) |
| Wrong number / opt-out finding accepted | `closed` (`not_sales`/`suppressed`) | unchanged | maybe non_customer | finding | eligibility chip "Do not call" |
| Owner nudges a rep | unchanged | — | — | — | nudge audit row on the timeline |
| Ingest stall | — | — | — | — | Coverage banner "History known through 14:32" |

## 8. Attention order

Default sort of the Attention view (`attention_rank` ascending):

1. Overdue promised callback (accepted Finding `promised_callback` with due passed).
2. Overdue first action after an eligible Form Lead (`unworked` + `overdue`).
3. Recent unanswered inbound sales candidate (`unworked` Number Review, ≤ 24 h).
4. Due Follow-up already owned (`open` + `next_action.due_at` ≤ now).
5. Open work with `no_next_action`.
6. Unassigned open work (`no_owner`).
7. Older reactivation (`open`, sorted by oldest `last_meaningful_contact_at`).

Within a band: older first. `identity_review` rows appear in their own "Needs identity" rail, never in the dial order. `suppressed` numbers never appear. `cooldown` rows drop to the bottom of their band.

## 9. Invariants (tests must pin these)

1. No module under `src/services/numberActivity/**` or `src/services/salesIntelligence/**` imports `ringcentral-call-lead-ingest.service`, `call-log-vetting`, or `callLeadConvergence.service`.
2. The all-direction worker never reads or writes `ringcentral_call_log_sync_state`.
3. No write path in this system creates or mutates `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `customers`, or `agents`. Read-only joins only.
4. No Finding, summary, or classification writes `outreach_records.state` without an Owner command, except the system transitions listed in §5.3.
5. An Owner Rep Nudge destination is always a Rep Identity Link's RingCentral identity. Validators reject any destination equal to a Contact Number, Form Lead phone, Call Lead phone, or Lead Message `to`.
6. Nudges are never enqueued by a worker, cron, or derive pass.
7. Raw STT text never reaches Mongo, logs, or queue bodies. Redaction runs before persist.
8. RingCentral `contentUri` and access tokens are never persisted.
9. Every list/detail DTO carries `as_of` and `coverage` (`known_through`, `gaps[]`, `capabilities{}`).
10. Duplicate webhook delivery, replayed Call Log pages, and concurrent workers produce the same Call Interaction rows (idempotent upserts keyed by canonical identity).
11. A later-arriving terminal event never rolls a Call Interaction back to a ringing projection; `projection_revision` only increases.
12. Missing permission → `capabilities.<x> = "denied"` in coverage, never a zero metric.

## 10. Owner language rules

- Say what happened, then what to do. Never print `snake_case`, provider status codes, or model names.
- "No observed outbound in this RingCentral account", never "nobody called".
- "Left voicemail" for provider-connected voicemail; "Spoke" only for `human_conversation`.
- Certainty words are fixed: **Exact** (attached by identity), **Likely** (single candidate), **Unsure** (ambiguous), **Confirmed by you** (Owner attach).
- Ages read "2 h 10 m ago (1 h 40 m staffed)".
- AI output is always labelled "AI suggestion — not verified" until the Owner accepts it; accepted findings read "Confirmed by you".
- Every non-working state says whether anything is being lost: "Calls are still being recorded; history after 14:32 will appear when the sync catches up."
