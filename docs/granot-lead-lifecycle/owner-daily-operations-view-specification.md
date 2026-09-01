---
type: Specification
title: Owner Daily Operations View — server, conversations, realtime, and Admin UX
description: Implementation-ready specification for the Owner's daily operational dashboard — a 24h/48h tabbed view over Leads, Booking and Release Reconciliation cases, Completed Bookings and Cancellations, and Agent metrics — including the read model, how live updates are achieved on Vercel, and the durable conversation record whose automated pipeline is deferred pending Owner authorization on cost, retention, and PII.
tags:
  - granot
  - lead-lifecycle
  - owner-dashboard
  - ringcentral
  - transcription
  - realtime
status: draft
stale_after: 2026-11-19
generated:
  by: claude-opus-5
  at: 2026-08-19T00:00:00Z
sources:
  - id: sprint-progress
    resource: ./sprint-progress-through-unit-25.md
  - id: lifecycle-flags
    resource: ./lifecycle-activation-flags-and-source-policies.md
  - id: unit-status
    resource: ../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
  - id: lifecycle-projections
    resource: ../../src/services/granotLifecycle/projections.ts
  - id: lifecycle-admin-routes
    resource: ../../src/routes/granot-lifecycle-admin.routes.ts
  - id: rc-transcript-handoff
    resource: ../../scripts/dev_ops/ringcentral/call-lead-transcript-handoff.md
  - id: rc-form-matching
    resource: ../../scripts/dev_ops/ringcentral/FINDINGS-form-lead-phone-matching.md
  - id: admin-ux-proposal
    resource: ../../../vantage-admin/uxdocs/admin-operational-views-ux-proposal.md
  - id: admin-daily-view-stub
    resource: ../../../vantage-admin/uxdocs/owner-daily-view-planned.txt
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/ownerDaily/**
  - src/services/conversations/**
  - src/routes/owner-daily-admin.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
---

# Owner Daily Operations View — specification

This is the surface the Owner opens every morning and leaves open all day. It is
**one Admin page with tabs**, bounded by a **24-hour or 48-hour window**, that
answers four questions without the Owner navigating anywhere else:

1. What came in?
2. What is waiting on me?
3. What closed?
4. What did we actually say to these people?

Everything here is a **read/aggregate surface over facts other units already
own**, plus one new durable aggregate — the `LeadConversation` record — whose
**automated pipeline is deferred** (Section 5.0). What ships is the model, the
read path, and **one manually seeded real conversation** so the Owner can see
and judge the finished experience before authorizing recurring cost.

This document is the specification. It is not a unit and it authorizes nothing.
Unit numbering stays under
[`UNIT-STATUS.md`](../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md).
Flags, activation, and Best Relocation source policy stay under
[`lifecycle-activation-flags-and-source-policies.md`](./lifecycle-activation-flags-and-source-policies.md).

---

## 0. Read this first — nine challenges to the proposed feature

These are the places where the request as written would produce the wrong
product. Each has a recommendation so work is not blocked, and Section 12 lists
the ones that genuinely need an Owner decision.

### 0.1 Most of this view is dark on day one

Through Unit 25 the checked-in posture is **shadow with every effect flag
false**. Concretely, on the day this view ships against production defaults:

| Pane | What it would show today |
| --- | --- |
| Form Leads / Call Leads | Real data — these paths are live |
| Completed Bookings / Cancellations | Real data — these paths are live |
| Agent metrics | Real data |
| Granot event stream | Receipts and shadow Decisions only — no effects |
| Open Booking Reconciliation | **Empty.** `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` is false |
| Open Release Reconciliation | **Does not exist.** Units 26–27 are unbuilt |

An empty table is indistinguishable from a broken table. **Recommendation:**
every pane declares a `capability` and renders one of three states —
`available`, `not_activated` ("Booking Reconciliation is built but not enabled"), or
`not_built` ("Release Reconciliation lands in Unit 26"). The Daily View reads
these from the existing `granot-lifecycle/operations/health` projection
(flags plus Mongo-backed queue, outcome, and alert fields) and never guesses.
This is the same `capabilities` pattern
`GranotLifecycleCaseDetail` already uses.

### 0.2 "Open Release Reconciliation" is Release Reconciliation, and it is a hard dependency

Release Reconciliation is represented by the final case model. Related cancellation facts are:

- **Release Reconciliation** (Units 26–27) — Granot `release` evidence opening a
  case the Owner resolves by cancelling or updating a Booking. This is what the
  Owner is describing.
- `BookingLeadReconciliationCase` — the *employee booking* reconciliation case.
  Different workflow, already live, must not be conflated.
- Unit 29 discrepancies — official Cancellation vs Granot evidence. Later still.

**Recommendation:** the Release Reconciliation tab is specified here in full but is
capability-gated and ships **after Unit 26**. Do not block the rest of the Daily
View on it.

### 0.3 The 24h/48h window needs a named timestamp per pane, and Vantage has two kinds of time

Vantage records **activity time** and **business date** separately, and they
disagree routinely:

| Entity | Activity time (when Vantage learned it) | Business date (what the Owner typed) |
| --- | --- | --- |
| `FormLead` / `CallLead` | `timestamp`, `createdAt` | — |
| `BookedLead` | `timestamp`, `createdAt` | `book_date` |
| `CancelledLead` | `createdAt` | `cancel_date` |
| Granot evidence | receipt `captured_at` | — |

A Booking confirmed at 09:00 today can carry `book_date` of last Friday. If
"Completed Bookings, last 24h" filters on `book_date`, the Owner's own work
disappears from his own daily view.

**Recommendation (binding for this spec):** every pane is bounded by
**`activity_at`** — the moment Vantage recorded the fact — never by the
Owner-typed business date. Each pane declares its `activity_at` source in
Section 3.2. `book_date` and `cancel_date` are **displayed as columns** so the
Owner sees the discrepancy, and are **filterable**, but never bound the window.

**Timezone.** All displayed dates render in Florida time
(`America/New_York`, already implemented as `vantage-admin/lib/floridaTime.ts`).

**DECIDED 2026-08-19 — the window is rolling.** 24h or 48h back from `now`, not
"today" and "today + yesterday" in Florida time. The reasoning, recorded so it is
not relitigated:

- This is an **operational** view, not a reporting view. Its job is "what is
  happening now and what is waiting on me."
- A business-day window fails at the moment the Owner uses it most. At 8:00 AM a
  "today" board is nearly empty and files the overnight Call Leads under
  yesterday — exactly the leads he opened it to see.
- Rolling never has a 00:00 cliff where the board empties.
- The one thing a business-day window is genuinely better at — comparable
  day-over-day counts — is already served by `/analytics`, the `/` Overview, and
  the agent sales report.

If comparable daily numbers are wanted later, they are an analytics question and
belong there. **Do not add a third window mode to this view.** `window.ts` stays
a single function with one behaviour.

### 0.4 "Realtime" is not worth a persistent connection here — but the contract that enables it is

Full reasoning is Section 6. The short version:

The server is Express on Vercel serverless. Events are produced in *other*
invocations — the Granot webhook lambda, the lifecycle queue consumer, the cron.
There is no shared process memory, so an in-process `EventEmitter` fan-out is
**architecturally impossible** here and must not be attempted. Any push
mechanism needs a shared broker, which means either an open function holding a
Mongo tail (SSE), or an external pub/sub vendor.

For a **single Owner** watching a dashboard, a 3-second cursor poll is
perceptually identical to push, costs nothing, survives cold starts, reuses the
existing authenticated proxy and audit path, and needs zero new infrastructure.

**Recommendation:** ship the **cursor-poll live feed** as the product. Design
the endpoint as a `since`-watermark contract so that SSE — if it is ever
wanted — becomes a transport swap behind the same contract, not a redesign.
Section 4.4 specifies the SSE upgrade precisely enough to build later.

### 0.5 Do not build an event-sourcing projection for a dashboard

The tempting design is a new append-only `OwnerDailyEvent` collection written in
the same transaction as every fact. That is a large new write surface touching
lead ingest, booking commands, cancellation commands, and the lifecycle
processor — for a read feature.

The window is only 24–48 hours. A **read-time merge** over six collections, each
with an existing time index and `limit`, is six bounded indexed range scans.
That is fast, adds **zero write-path risk**, and the merge/cursor logic already
exists in `projections.ts` (`compareTimelineEntries`, `paginateTimeline`).

**Recommendation:** read-time merge. Revisit only if profiling on real volume
says otherwise. Reusing the observability `OperationalEvent` stream is also
rejected — it is a health stream (errors, PII policy scrubbing, noise), not a
business-fact stream, and mixing pollutes both.

### 0.6 The provenance chain the Owner wants already exists

"granot lead_created → ring central data attached → call made → lead booked" is
`GranotTimelinePage` from `projectGranotLeadTimeline` / `projectGranotJob`
(`src/services/granotLifecycle/projections.ts:95-180`). It already emits ordered,
typed, masked entries for `observation`, `decision`, `record_link_change`,
`entity_change`, `case`, `official_booking`, `official_cancellation`.

**Recommendation:** the Daily View **renders that existing projection**. Do not
build a second chain. The only additions are two new entry types — `conversation`
and `ringcentral_call` — appended to the same discriminated union with new
`type_priority` values. That keeps one chain, one cursor, one masking audit.

### 0.7 "Total booked" per agent is two different numbers

`receiver_agent` (who worked the lead) and `BookedLead.agent_allocations` (who
gets commission) are deliberately independent — the `CallLead` schema comment at
`src/models/CallLead.ts:148` says so explicitly. A single "total_booked" column
silently picks one and will be wrong for the other question.

**Recommendation:** the Agent tab shows both, named unambiguously —
`leads_received`, `received_leads_booked` (conversion of what they were given),
and `booking_credit` (allocation-weighted). Never one merged number.

### 0.8 The intake tabs should embed existing components, not reimplement them

Owner Booking commands (Units 24–25) already ship a complete workflow: case
detail, candidate browser with in-scope/out-of-scope search, `Idempotency-Key`,
revision guards, `409` draft preservation, out-of-scope override reason. The
Admin components exist under `vantage-admin/components/granot-lifecycle/`.

**Recommendation:** the Open Booking Reconciliation tab is a **filtered, window-bounded
list that hands off to the existing case detail**. Reimplementing candidate
search inside a drawer would fork the revision-guard and idempotency logic —
the exact code that must not be forked. This removes a large amount of work
from the estimate.

### 0.9 This is not two or three issues, and the conversation pipeline should not be one of them yet

Honest sizing is **six units plus two deferred**, Section 9.

The RingCentral conversation pipeline is the highest-value part of the request
and also the only part that carries recurring external cost, customer audio
retention, and a PCI exposure. Those are Owner and counsel decisions, not
engineering decisions, and they are not resolved.

**Decision taken (2026-08-19): the automated pipeline is deferred.** What ships
is the durable model, the read path, and one manually seeded real conversation
on a known booked Lead — enough for the Owner to judge the actual product
before authorizing recurring spend. The proven spikes stay in
`scripts/dev_ops/ringcentral/` as the implementation reference. Section 5
carries the deferred design in full so nothing is re-derived later.

---

## 1. Scope

**In scope.** One Admin route `/daily` with seven tabs; a new server read
domain `src/services/ownerDaily/`; a live-feed cursor endpoint; two new
timeline entry types; the `LeadConversation` model with its indexes; the
Owner-only conversation **read** routes; and one Owner-run seeding script that
produces a single real conversation record end to end.

**Deferred** (Section 5.0, gated on Owner and counsel decisions). Discovery
crons, the form-lead phone-window scanner, the rate limiter, the queue
consumer and state machine, the media janitor, cost accounting at scale, and
the attach / detach / retry Owner commands.

**Out of scope.** Any change to how Leads, Bookings, Cancellations, Booking
cases, or Decisions are *written*. Any change to lifecycle flags or activation.
Any Release/Referral/discrepancy command. Replacing the existing `/` Overview
page — Daily View sits **beside** it (see Section 12).

**Invariant.** The Daily View is a reader. Its only writes are (a) conversation
records in its own collection and (b) the Owner commands it delegates to
already-existing, already-gated endpoints.

---

## 2. Model changes

### 2.1 New: `LeadConversation` — the only new aggregate

Collection `lead_conversations`. Model `src/models/LeadConversation.ts`.

This is the durable record of one telephone conversation that has been matched
to a Lead, with its media pointer, transcript, and summary. It is **evidence,
not a Lead field** — a Lead can have several conversations, a conversation can
be found before its Lead is booked, and transcription can fail independently of
everything else. Storing it on the Lead would make all three of those facts
un-representable.

```ts
{
  // Identity — unique per provider recording. This is the idempotency key.
  provider: "ringcentral",
  provider_recording_id: String,        // RC recording.id — unique index
  call_log_id: String,                  // RC call-log id used to resolve it
  telephony_session_id: String | null,  // present for Call Leads, null for form callbacks

  // Attachment
  lead_ref: { model: "FormLead" | "CallLead", id: ObjectId } | null,
  booking_ref: ObjectId | null,         // BookedLead, denormalized at match time
  normalized_job_no: String | null,
  lead_source_company: ObjectId | null,
  source_granularity_id: ObjectId | null,
  receiver_agent: ObjectId | null,
  receiver_agent_name_snapshot: String | null,

  // How we got here — auditable, never guessed
  match_method:
    | "call_lead_telephony_session"     // highest confidence
    | "call_lead_call_log_id"
    | "form_lead_outbound_phone_window" // phone + time window, see 5.2
    | "owner_manual_attach",
  match_confidence: "high" | "medium",
  match_evidence: {                     // exactly what was queried
    queried_phone_national: String | null,
    window_from: Date | null,
    window_to: Date | null,
    candidate_count: Number,
    chosen_reason: String,
  },

  // Call facts, copied from RC at discovery
  direction: "Inbound" | "Outbound",
  rc_result: String,                    // "Accepted" | "Call connected" | "Voicemail" | ...
  started_at: Date,
  duration_seconds: Number,
  from_phone_masked: String,            // masked at write time, see 9.1
  to_phone_masked: String,

  // Media — pointer only, never a raw RC contentUri with a token
  media: {
    blob_pathname: String | null,       // vantage-stores private blob
    blob_url: String | null,
    bytes: Number | null,
    content_type: "audio/mpeg" | null,
    stored_at: Date | null,
    purged_at: Date | null,             // set by the janitor, 5.6
  } | null,

  // Derived text
  transcript: {
    text: String,                       // redacted at write time, 9.1
    model: String,
    chars: Number,
    redactions: Number,
    created_at: Date,
  } | null,
  summary: {
    text: String,                       // markdown, sectioned per 5.5
    model: String,
    prompt_version: String,             // bump when the prompt changes
    created_at: Date,
  } | null,

  // Durable work state — same shape as the Unit 08 drainer
  state:
    | "discovered"      // RC row + recording id known
    | "media_stored"    // mp3 in blob
    | "transcribed"
    | "complete"        // summarized
    | "no_recording"    // terminal, benign
    | "failed"          // retryable
    | "dead_letter",    // terminal, needs Owner
  attempts: Number,
  next_attempt_at: Date | null,
  claimed_by: String | null,
  claim_expires_at: Date | null,
  last_error: { code: String, message: String, at: Date } | null,

  // Cost accounting — the Owner is paying per minute, 5.7
  cost_cents: { stt: Number, summary: Number } | null,

  createdAt, updatedAt,
}
```

**Indexes.**

| Name | Key | Purpose |
| --- | --- | --- |
| `lead_conversation_recording_unique` | `{ provider, provider_recording_id }` unique | Idempotency — one record per recording |
| `lead_conversation_lead` | `{ "lead_ref.model": 1, "lead_ref.id": 1, started_at: -1 }` | Drawer: conversations for a Lead |
| `lead_conversation_booking` | `{ booking_ref: 1, started_at: -1 }` | Drawer: conversations for a Booking |
| `lead_conversation_work` | `{ state: 1, next_attempt_at: 1 }` | Drainer claim |
| `lead_conversation_window` | `{ started_at: -1, _id: -1 }` | Daily feed merge and Conversations tab |
| `lead_conversation_agent` | `{ receiver_agent: 1, started_at: -1 }` | Agent metrics |
| `lead_conversation_call_log` | `{ call_log_id: 1 }` | Re-resolve without a second RC call |

Indexes go through `scripts/migrations/` following the
`granot-lifecycle-indexes.ts` pattern — collision report first, explicit
authorized apply second, never an implicit `autoIndex`.

**Forward-declared fields.** The model lands in full even though the pipeline is
deferred. `state`, `attempts`, `next_attempt_at`, `claimed_by`,
`claim_expires_at`, `last_error`, `cost_cents`, and `media.purged_at` are
written by the deferred drainer and are unused by the seeding script beyond
setting `state: "complete"`. They are declared now because changing the shape of
a collection that already holds records is more expensive than declaring six
fields that sit null, and because the Admin drawer's state rendering should not
be rewritten when the pipeline arrives. `lead_conversation_work` is declared but
will match nothing until then.

### 2.2 Changed: nothing else

No field is added to `FormLead`, `CallLead`, `BookedLead`, or `CancelledLead`.
The join is `LeadConversation.lead_ref` → Lead, queried by index. This keeps the
aggregate-revision and immutability guards from Units 09/12 completely untouched,
which is the whole reason not to put a `conversation_id` on the Lead.

### 2.3 Extended: `GranotTimelineEntry`

Two new members of the existing discriminated union in
`src/services/granotLifecycle/projections.ts`, so the provenance chain gains
conversation evidence without a second chain:

```ts
| TimelineEntry<"ringcentral_call", 15, {
    telephony_session_id: string | null;
    call_log_id: string;
    direction: "Inbound" | "Outbound";
    duration_seconds: number;
    rc_result: string;
    adopted_lead: boolean;          // true when Unit 20 adoption attached it
  }>
| TimelineEntry<"conversation", 85, {
    conversation_id: string;
    state: LeadConversationState;
    match_method: string;
    match_confidence: "high" | "medium";
    has_transcript: boolean;
    has_summary: boolean;
    duration_seconds: number;
  }>
```

`type_priority` 15 places the physical call immediately after the Granot
observation that may have created the Lead (10) and before the priority effect
(20) — which is exactly the causal order the Owner asked to see. Priority 85
places the derived conversation after the entity change that booked the Lead
(80), because the summary is produced last.

`assertProjectionSafe` / `JOB_PROJECTION_FORBIDDEN_KEYS` must be extended to
cover the new payloads: **no transcript text, no summary text, and no unmasked
phone number in a timeline entry.** The timeline carries the pointer; the drawer
fetches the text through its own authorized endpoint.

---

## 3. Server read model

### 3.1 New service domain `src/services/ownerDaily/`

Per `project-organization.mdc`, routes stay thin and logic lives in a focused
service folder.

| File | Owns |
| --- | --- |
| `window.ts` | `resolveDailyWindow(mode)` → `{ from, to, mode, timezone }`. Single source of truth for 24h/48h and the 10-minute "super recent" sub-window. |
| `overview.service.ts` | The Overview tab payload — all counts and super-recent slices in **one** aggregate round. |
| `leads.service.ts` | Windowed Form/Call lead lists with search and filters. |
| `completed.service.ts` | Windowed Completed Bookings and Completed Cancellations. |
| `intakes.service.ts` | Thin adapter over `listGranotLifecycleCases` that applies the window and the capability gate. |
| `agentMetrics.service.ts` | The Agent tab. |
| `feed.service.ts` | The `since`-cursor live feed merge (Section 6). |
| `detail.service.ts` | Drawer payload: formatted entity state + timeline page + conversation refs. |
| `capabilities.ts` | Maps lifecycle flags + built-unit facts to per-pane `available` / `not_activated` / `not_built`. |
| `index.ts` | Barrel. |

### 3.2 The `activity_at` contract (binding)

| Pane | Collection | `activity_at` | Also displayed |
| --- | --- | --- | --- |
| Form Leads | `form_leads` | `timestamp` | `createdAt`, `ref_no` |
| Call Leads | `call_leads` | `timestamp` | `ringcentral.start_time` |
| Completed Bookings | `booked_leads` | `timestamp` | **`book_date`** |
| Completed Cancellations | `cancelled_leads` | `createdAt` | **`cancel_date`** |
| Open Booking Reconciliation | `granot_booking_reconciliation_cases` | `last_evidence_at` | `opened_at` |
| Open Release Reconciliation | Release cases (Unit 26) | `last_evidence_at` | `opened_at` |
| Granot events | `granot_observation_receipts` / `synchronization_decisions` | `captured_at` / `decided_at` | — |
| Conversations | `lead_conversations` | `started_at` | `createdAt` (when we found it) |

Every list response echoes `{ window: { mode, from, to, timezone, activity_field } }`
so the UI can state precisely what it is showing and a screenshot is
self-describing.

### 3.3 Routes

New focused router `src/routes/owner-daily-admin.routes.ts`, mounted **after the
`/api/v1` guard**, alongside `granot-lifecycle-admin.routes.ts`. Routes stay
policy-free; owner/read gating uses the existing
`requireRegistryOwnerActor` / `requireRegistryReadActor` helpers.

```text
GET  /api/v1/admin/owner-daily/overview          ?window=24h|48h
GET  /api/v1/admin/owner-daily/leads             ?window&kind=form|call&q&booked&source_id&cursor&limit
GET  /api/v1/admin/owner-daily/completed-bookings ?window&q&agent_id&merchant_id&cursor&limit
GET  /api/v1/admin/owner-daily/completed-cancellations ?window&q&reason&cursor&limit
GET  /api/v1/admin/owner-daily/intakes/booking   ?window&mode&cursor&limit
GET  /api/v1/admin/owner-daily/intakes/cancellation ?window&mode&cursor&limit    [Unit 26]
GET  /api/v1/admin/owner-daily/agents            ?window
GET  /api/v1/admin/owner-daily/conversations     ?window&state&has_summary&cursor&limit
GET  /api/v1/admin/owner-daily/feed              ?window&since=<cursor>&limit
GET  /api/v1/admin/owner-daily/detail/:kind/:id  ?window
GET  /api/v1/admin/owner-daily/capabilities
```

Conversation-specific routes live in their own router (Section 5.8) because
they carry transcript text and therefore a different PII posture.

All reads are **Owner-only**. Transcripts are verbatim customer conversations;
`canAccessDashboardPath` gains `/daily` to `OWNER_ONLY_PAGE_PREFIXES` and
`canProxyVantagePath` gains `/api/v1/admin/owner-daily` as an Owner-only prefix
for **all** methods, not just mutations.

### 3.4 Mongo retrieval — the Overview tab in one round

The Overview tab is the page the Owner stares at. It must be one request, and it
must not be seven sequential aggregates. Every count in it is derivable from a
single `$facet` per collection over the same window, executed with
`Promise.all` across collections:

```js
// form_leads and call_leads — one pipeline each
[
  { $match: { timestamp: { $gte: from, $lte: to } } },
  { $facet: {
      total:        [{ $count: "n" }],
      booked:       [{ $match: { booked: { $ne: null } } }, { $count: "n" }],
      super_recent: [
        { $match: { timestamp: { $gte: superRecentFrom } } },
        { $sort: { timestamp: -1, _id: -1 } },
        { $limit: 10 },
        { $project: { /* card fields only */ } },
      ],
      by_source: [
        { $group: { _id: "$lead_source_company", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 8 },
      ],
  }},
]
```

Each `$match` is served by an existing index — `form_leads` and `call_leads`
both index `{ source_granularity_id: 1, timestamp: 1, _id: 1 }` and
`{ lead_source_company: 1, createdAt: -1 }`. A bare 24h `timestamp` range needs
one addition per lead collection:

| Collection | Index to add | Reason |
| --- | --- | --- |
| `form_leads` | `{ timestamp: -1, _id: -1 }` | Unqualified window scan + stable cursor |
| `call_leads` | `{ timestamp: -1, _id: -1 }` | Same |
| `booked_leads` | `{ timestamp: -1, _id: -1 }` | Completed Bookings window |
| `cancelled_leads` | `{ createdAt: -1, _id: -1 }` | Completed Cancellations window |

These are non-unique, additive, and go through the migration script with a
collision report — same discipline as Unit 13 and Unit 23.

**Rule:** no `$lookup` in a Daily View pipeline. Source-company and agent labels
come from the snapshot fields already denormalized onto every document
(`source_company_label_snapshot`, `receiver_agent_name_snapshot`,
`agent_name_snapshot`). Joining at read time on the hot path is how this page
gets slow.

### 3.5 Cursor contract

Reused verbatim from `projections.ts`: an opaque base64 cursor over
`{ sort_value, id }`, sorted `activity_at DESC, _id DESC`. Ties break on `_id`.
Every list returns `{ items, next_cursor, window }`. Clients use
`useInfiniteQuery`. This is the same contract the Unit 23 case queue already
uses, so the Admin query layer needs no new concepts.

---

## 4. Realtime — how live updates actually work on Vercel

### 4.1 Why the obvious approach is impossible here

`vantage-main-server` is Express behind `api/index.ts` with
`rewrites: [{ source: "/(.*)", destination: "/api" }]`. Every request is a
serverless invocation. The producers of the events this dashboard wants to show
are **different invocations**:

- Granot webhook capture → `/api/webhooks/granot/*`
- Lifecycle processing → `api/queues/granot-lifecycle-consumer.ts`
- Booking commands → the Admin proxy
- RC call ingest → `/api/cron/ringcentral-call-log-sync`
- Conversation transcription → the new queue consumer

None of them share memory with an invocation that is holding a browser
connection. An in-process `EventEmitter`, a module-level `Set` of response
objects, or a `socket.io` server will appear to work in `pnpm dev` and will
silently deliver nothing in production. **Do not build one.**

Any push therefore needs a shared broker. There are exactly three:

| Broker | Mechanism | Verdict |
| --- | --- | --- |
| Mongo | SSE invocation polls or tails a change stream, pushes to the browser | Works. Moves the poll server-side; still holds a function open. |
| External pub/sub (Ably, Pusher, Upstash) | Producers publish; browser subscribes directly | Correct serverless push. New vendor, new secret, new outbound dependency in the webhook path. |
| The browser | Client polls a cursor endpoint | Works. No new infrastructure. |

### 4.2 Recommendation: cursor poll, with the SSE seam designed in

**Ship `GET /api/v1/admin/owner-daily/feed?since=<cursor>` and poll it.**

- TanStack Query `refetchInterval: 3000` while the tab is focused,
  `refetchIntervalInBackground: false`, backing off to 15s after 5 minutes of no
  Owner interaction and to 60s when the document is hidden.
- The response is `{ events, cursor, counts, window }` where `cursor` is a
  high-watermark, not a page cursor.
- Cost for one Owner at 3s: ~1,200 requests/hour. Each is a bounded indexed
  range query over 24h of data. This is a rounding error on Vercel.
- Latency: ≤3s. For a human watching a board, that is push.

This is not a compromise — it is the right tool. It also gets four things free
that SSE would have to re-earn: the existing authenticated `/api/proxy` path,
the audit log, automatic reconnection, and correct behaviour on a laptop that
sleeps.

### 4.3 The feed merge

`feed.service.ts` implements `since` as a **watermark, not a page cursor**:

```ts
listDailyFeed({ window, since, limit }) →
  Promise.all([
    receipts.find({ captured_at: { $gt: since, $gte: window.from } }).sort(...).limit(50),
    decisions.find({ decided_at: { $gt: since, ... } }).limit(50),
    formLeads.find({ timestamp: { $gt: since, ... } }).limit(50),
    callLeads.find({ timestamp: { $gt: since, ... } }).limit(50),
    bookedLeads.find({ timestamp: { $gt: since, ... } }).limit(50),
    cancelledLeads.find({ createdAt: { $gt: since, ... } }).limit(50),
    bookingCases.find({ last_evidence_at: { $gt: since, ... } }).limit(50),
    conversations.find({ updatedAt: { $gt: since, ... } }).limit(50),
  ])
  → normalize each to a common DailyFeedEvent
  → merge-sort by (event_at DESC, id DESC)
  → truncate to limit
  → cursor = event_at of the newest item (or `since` when empty)
```

Eight bounded indexed queries in parallel. On a first load `since` is absent and
the window floor bounds it; thereafter `since` is seconds old and every query
returns nothing.

`DailyFeedEvent` is one flat, maskable shape:

```ts
{
  id: string;                  // "<kind>:<mongo id>"
  kind: "granot_receipt" | "granot_decision" | "form_lead" | "call_lead"
      | "booking" | "cancellation" | "booking_intake" | "cancellation_intake"
      | "conversation";
  event_at: string;            // ISO
  headline: string;            // "Call lead — Best Relocation (Inbound, 8m)"
  masked_label: string;        // masked contact, via maskContactLabel
  job_no: string | null;
  href: string | null;         // deep link into the drawer
  badges: string[];            // ["booked"], ["shadow"], ["summary ready"]
}
```

**Idempotent by construction.** The client keys on `id`, so a duplicate delivery
after a clock skew or a retry replaces rather than appends. Never append blindly
to a list.

### 4.4 The SSE upgrade, if it is ever wanted

Specified so it is a transport swap, not a redesign:

1. **New Next.js route handler** `app/api/live/daily/route.ts` — *not* the
   existing `/api/proxy/[...path]`, which buffers through `requestVantageApi`
   and cannot stream. It authenticates with the same `requireAdmin()` and
   returns a `ReadableStream` with `content-type: text/event-stream`,
   `cache-control: no-store`, `x-accel-buffering: no`.
2. **It calls the same feed service** through a streaming server endpoint
   `GET /api/v1/admin/owner-daily/feed/stream`, which loops internally on a 2s
   interval, emits `event: daily` frames with `id: <cursor>`, and emits a
   `: keepalive` comment every 15s so intermediaries do not close it.
3. **`maxDuration`.** The function is declared in `vercel.json` with an explicit
   `maxDuration` and the loop **self-terminates 5 seconds before it**, sending a
   final `event: reconnect`. The browser's `EventSource` reconnects
   automatically and sends `Last-Event-ID`, which the server reads as `since`.
4. **The payload is byte-identical to the poll response.** Same
   `DailyFeedEvent`, same cursor semantics. The Admin `useDailyFeed()` hook
   chooses transport from one flag; every consuming component is unchanged.

**Do not** open a Mongo change stream per SSE invocation. Each connection would
hold a dedicated Atlas cursor across cold starts with resume-token handling, for
a latency gain of ~2s over the internal poll, on a page with one viewer.

---

## 5. RingCentral conversations — deferred pipeline, shipped proof

### 5.0 Deferral decision

**Decided 2026-08-19.** The automated conversation pipeline is **deferred**. It
is not blocked on engineering — the spikes prove every mechanism — it is blocked
on three decisions that are not the engineer's to make:

| Gate | Owner decision needed | Detail |
| --- | --- | --- |
| **Cost** | Authorize recurring STT spend | ~$90/month at 50 conversations/day, Section 5.8 |
| **Retention** | How long customer audio and transcripts are kept, and who may hear them | Section 5.7, Section 7.4 |
| **PII / consent** | Recording-consent posture, PCI exposure, third-party processor | Section 7 |

**What ships in the meantime:**

1. The `LeadConversation` model and its indexes (Section 2.1), so the shape is
   locked before any record exists.
2. The Owner-only conversation **read** routes (Section 5.9).
3. The Admin drawer conversation panel and Conversations tab, rendering whatever
   records exist.
4. **One manually seeded real conversation** on a known booked Lead, produced by
   an Owner-run script (Section 5.2).

That is enough for the Owner to look at a real transcript and a real summary of
a real call, attached to a real booked Lead, inside the real UI — which is the
only honest basis for deciding whether to pay for it at scale.

**What stays deferred:** discovery crons, the form-lead phone-window scanner,
the RC rate limiter, the queue consumer and state machine, the media janitor,
per-record cost accounting at scale, and the attach / detach / retry Owner
commands.

Sections 5.3–5.8 record the deferred design in full. They are **not** to be
implemented now; they exist so the design is not re-derived from scratch when
the gates clear. The reference implementation stays in
`scripts/dev_ops/ringcentral/` and `scripts/dev_ops/blob/`.

### 5.1 What is already proven

From `scripts/dev_ops/ringcentral/` (local spikes, not production code):

- **Call Lead → recording works.** `call_leads.ringcentral.call_log_id` →
  `GET /restapi/v1.0/account/~/call-log/{id}?view=Detailed` → `recording.id` +
  `contentUri` → mp3 with the same Bearer token. Live result: 8/8 booked RC call
  leads ≥180s had a recording.
- **Form Lead → recording works, with a format trap.** Form leads store no RC
  ids; the conversation is an **outbound** company-log row. The `phoneNumber`
  query parameter must be **10-digit national** (`3125137838`) — E.164 returns
  zero records every time, even when the call exists. Live result: 8/12 booked
  form leads had outbound rows, 6 had recordings.
- **STT + summary work.** `gpt-4o-mini-transcribe` for transcription,
  `gpt-4.1-nano` for a sectioned dashboard summary with CRM context attached so
  the model can flag CRM mismatches.
- **Private blob storage works.** `@vercel/blob` `put(..., { access: "private" })`
  into the `vantage-stores` store, with a JSON sidecar.

Three hard-won constraints carry into production:

| Constraint | Consequence for the design |
| --- | --- |
| Call Log is a RC **Heavy** endpoint; `429 CMN-301` is routine | Discovery must be leased, paced, and backed off — never a tight loop |
| An unfiltered outbound scan only sees the newest ~300 rows (~2 hours) | Form-lead discovery **must** filter by 10-digit phone plus a window |
| `result: "Voicemail"` can carry a long duration | Vet on `result` **and** byte size before paying for STT |

### 5.2 What ships now — the manual seed (SHIPPED SCOPE)

One Owner-run script produces one real `LeadConversation` document end to end.
It is a **`scripts/dev_ops/` operator tool, not runtime code**, and it is the
only thing that writes to `lead_conversations` until the gates clear.

`scripts/dev_ops/conversations/seed-known-conversation.ts`, run as
`pnpm ops:seed-conversation`.

**Inputs — all explicit, nothing discovered.**

```bash
pnpm ops:seed-conversation \
  --lead-model CallLead \
  --lead-id 6a761d3d7ceae445794c57bd \
  --call-log-id AL0AaWD26IINT41A \
  --confirm-write
```

The Owner names the Lead and the call log id. The script does **not** scan, does
not guess, and does not iterate. `--call-log-id` is required precisely so no RC
search happens — the whole rate-limit and match-ambiguity surface stays unbuilt.

**Steps.**

1. Load the Lead from the configured database. Refuse if `TEST_MODE` disagrees
   with the intended target; print the resolved database name and require
   `--confirm-write` before any write.
2. `GET /restapi/v1.0/account/~/call-log/{call_log_id}?view=Detailed` using the
   existing `src/services/ringcentral/client`. Read `recording.id` and
   `recording.contentUri`.
3. **Vet before spending** (Section 5.5): refuse when `duration_seconds < 60`,
   when `result` is `Voicemail` with implausibly small bytes, or when bytes are
   inconsistent with the stated duration.
4. Download the mp3 with the same Bearer token.
5. `put()` to the `vantage-stores` blob at
   `conversations/{provider_recording_id}.mp3`, `access: "private"`,
   `addRandomSuffix: false`, `multipart` above 4MB. Proven by
   `scripts/dev_ops/blob/upload-ringcentral-mp3.ts`.
6. Transcribe with the configured STT model.
7. **Redact the transcript deterministically before anything else touches it**
   (Section 7.3). The redacted text is what goes to the summarizer and what goes
   to Mongo. The raw transcript is never persisted, never logged, and never
   written to disk.
8. Summarize with the CRM context block and the six-section prompt
   (Section 5.6), reading Lead / Booking fields from Mongo.
9. Write **one** `LeadConversation` document: `match_method`
   `call_lead_call_log_id` (or `call_lead_telephony_session` when the Lead
   carries one), `match_confidence: "high"`, `state: "complete"`,
   `match_evidence.chosen_reason: "owner_seeded"`, and the real `cost_cents`.
   The unique index on `{ provider, provider_recording_id }` makes a re-run
   idempotent — a second run updates rather than duplicating.
10. Print the document id, the blob pathname, the redaction count, and the cost.

**Guards.**

- `--confirm-write` is mandatory. Without it the script performs steps 1–3 and
  prints what it *would* do, spending nothing.
- Refuses to run against more than one Lead per invocation. There is no
  `--all`, no `--limit`, no batch mode. Adding one is how a deferred cost
  decision gets made accidentally.
- Prints the estimated cost before step 6 and requires the run to be under a
  hard `--max-cost-cents` ceiling defaulting to 50.
- Writes nothing to the Lead, the Booking, or any lifecycle collection.

**Choosing the lead.** `FINDINGS-form-lead-phone-matching.md` and
`BOOKED-LEAD-TRANSCRIPT-SAMPLES.md` already name verified booked leads with
confirmed recordings and real conversation length. Pick an **inbound Call Lead**
for the first seed — the match is unambiguous, so the seed demonstrates the
product rather than the matching problem.

**A second, optional seed** of a booked *Form Lead* (outbound callback) is worth
doing once, because it is the case the Owner will find least intuitive and the
one whose match is only medium confidence. Same script, `--lead-model FormLead`,
with the call log id taken from the findings doc rather than discovered.

---

### 5.3 Match ladders (DEFERRED)

Deterministic, ordered, and recorded in `match_method` — the same discipline as
the Unit 14 identity ladders.

**Call Lead ladder.**

1. `ringcentral.telephony_session_id` present → resolve via `call_log_id` →
   `match_method: call_lead_telephony_session`, confidence `high`.
2. `ringcentral.call_log_id` present without a session id → `call_lead_call_log_id`,
   `high`.
3. Neither → no discovery. A Granot-created, RingCentral-unadopted Call Lead has
   no physical call to find. Do **not** fall back to a phone scan for Call Leads
   — Unit 20 adoption is the sanctioned path for attaching a physical call, and a
   phone scan here would attach a call adoption deliberately declined.

**Form Lead ladder.**

1. Normalize `phone_number` → E.164 → strip to **10-digit national**.
2. Window: `min(lead.timestamp, booking.book_date) - 36h` through
   `max(...) + 36h`, capped at 14 days. Callbacks land after book date.
3. `GET /account/~/call-log?direction=Outbound&type=Voice&view=Detailed&phoneNumber=<10digit>&dateFrom&dateTo`.
4. Confirm the **last 10 digits** against `to` / `from` in the response body
   (bodies return E.164) so a filter miss cannot attach the wrong customer.
5. Keep rows with a `recording` and `result` in `{Accepted, Call connected}`.
6. **One candidate** → `form_lead_outbound_phone_window`, confidence `medium`.
   **Several** → take the longest connected call, confidence `medium`, and
   record `candidate_count` in `match_evidence` so the Owner can see it was a
   choice. **Zero** → terminal `no_recording`; do not widen automatically.

Confidence is never `high` for a phone-window match. The Admin drawer renders a
medium-confidence conversation with a visible "matched by phone and time window"
note. The Owner can detach and re-attach manually
(`match_method: owner_manual_attach`).

### 5.4 Pipeline as a durable state machine (DEFERRED)

Reuse the Unit 08 pattern exactly: **Mongo is the work source, the queue is a
wake-up, a lease elects the winner.**

```text
discovered ──► media_stored ──► transcribed ──► complete
     │              │                │
     └──► no_recording (terminal, benign)
     └────────┴────────────────┴──► failed ──(attempts exhausted)──► dead_letter
```

**One stage per invocation.** The consumer claims a record under a five-minute
lease, advances exactly one stage, re-publishes `{ conversation_id }`, and
returns. A 25-minute mp3 through STT plus a summary in a single invocation risks
the function timeout and forces a full retry of work already paid for. One stage
per invocation makes every retry cheap and every timeout survivable.

**Triggers.**

| Trigger | Cadence | Scope |
| --- | --- | --- |
| `/api/cron/conversation-discovery` | `*/15 * * * *` | Call Leads in the last 24h with a `call_log_id` and no conversation record |
| `/api/cron/conversation-form-discovery` | `0 */2 * * *` | Booked Form Leads in the last 48h with no conversation record. Heavy: one RC call per lead. Hard cap per run. |
| Queue `conversation-events*` | on publish | Stage advance |
| Owner "Find conversation" | on demand | One Lead, bypasses the cadence, still leased |

The Owner on-demand button matters: it makes the feature useful the moment the
Owner cares about a specific lead, instead of making him wait for a cron.

**Rate limiting.** A shared token-bucket in front of every RC Call Log call,
sized well under the RC Heavy quota, with exponential backoff on `429 CMN-301`.
Discovery holds an account-level lease using the existing `durableWork` leases,
the same way `call-log-sync-state.store.ts` already fences Call Log sync — the
two must not contend.

### 5.5 Media handling

Every rule here applies to the shipped seeding script as well as the deferred
pipeline. They are the rules that keep a credential out of Mongo and keep the
Owner from paying for a voicemail.

- Download the mp3 with the same Bearer token that resolved the recording.
- **Vet before paying**: skip when `duration_seconds < 60`, when `result` is
  `Voicemail` and bytes are small, or when bytes are implausible for the stated
  duration. The prototype found a "2147s" voicemail dump of ~186KB.
- `put()` to the `vantage-stores` blob under
  `conversations/{provider_recording_id}.mp3`, `access: "private"`,
  `multipart` above 4MB, `addRandomSuffix: false` so the pathname is derivable.
- **Never store or log a raw RC `contentUri`** — it is credential-bearing. Store
  `call_log_id` and re-resolve. This matches the receipt-redaction rule the
  program already enforces on webhook secrets.
- Audio playback in Admin goes through a **short-lived server-issued signed URL**
  from an Owner-only endpoint, never a blob URL embedded in a list payload.

### 5.6 Transcription and summarization

Applies to the shipped seeding script and the deferred pipeline alike.

- STT `gpt-4o-mini-transcribe`; summary `gpt-4.1-nano`. Both model ids live in
  `src/config/domain/conversations.ts`, never inline, so they are swappable
  without touching the pipeline.
- The summary prompt attaches CRM context — job, source, agent, pickup,
  delivery, cubic feet, move date, book date, binder, deposit, call direction
  and duration — and instructs the model to prefer the transcript on
  disagreement. The proven section set:

  1. Conversation overview (3–5 sentences)
  2. What the customer wanted
  3. Quote / money / dates discussed
  4. Outcome and next steps
  5. Anything the agent promised or still needs
  6. **Mismatch vs CRM** — only when the transcript contradicts the record

  Section 6 is the highest-value line on the whole dashboard: it is the only
  place the system tells the Owner his own record is wrong.
- `prompt_version` is stored on every summary. Changing the prompt does not
  rewrite history; it changes what new summaries say, and old ones stay
  attributable.
- Summarization **never** writes to a Lead, Booking, or Cancellation. It is
  evidence. Acting on a mismatch is an Owner decision through an existing
  command.

### 5.7 Retention (DEFERRED — this is one of the gates)

Retention policy is an Owner decision, not a default. The proposal below is a
starting position for that decision, not a shipped behaviour. Section 7.4 covers
why the answer matters legally as well as operationally.

- Transcripts and summaries are small; audio is not.
- Proposed: keep audio for conversations whose Lead booked and for anything the
  Owner pins; purge everything else at **90 days**.
- Proposed: `/api/cron/conversation-media-janitor` (daily) purges qualifying
  blobs, sets `media.purged_at`, and leaves the text intact. The record stays;
  only the mp3 goes.
- RC's own retention is finite, so audio not stored is audio gone. If the Owner
  wants long-lived audio at all, storing by default and purging selectively is
  the right way round.
- **Counter-position worth weighing:** the lowest-risk policy is to store no
  audio at all, stream RC → STT in memory, and keep only the redacted transcript
  and summary. That removes the entire blob retention question, removes audio
  playback from the product, and is materially easier to defend. The seeded
  proof deliberately stores audio so the Owner can hear it once and decide
  whether playback is worth the exposure.

### 5.8 Cost — the number the deferral is about

Worth stating plainly before the Owner authorizes it:

| Item | Unit | ~20-minute call |
| --- | --- | --- |
| STT | ~$0.003/min | ~$0.06 |
| Summary | fractions of a cent | ~$0.00 |
| Blob storage | per GB-month | ~10MB |

At 50 conversations/day that is roughly **$3/day, ~$90/month** in STT, plus
modest storage. Two things make the real number uncertain enough to be worth
proving before committing:

- **Backfill.** Mongo holds ~187 booked call leads with RC ids. Transcribing the
  existing history is a one-time charge of roughly $10–15, not a recurring one —
  but it is a decision separate from the ongoing rate.
- **Form-lead discovery multiplies RC calls, not STT calls.** Each unbooked form
  lead scanned costs an RC Heavy request and finds nothing ~33% of the time
  (8 of 12 in the live sample had outbound rows, 6 had recordings). The spend is
  in rate-limit budget, not dollars.

`cost_cents` is recorded per conversation so the Conversations tab shows a
running window total and the number is never a surprise. The seeding script
prints the real cost of a single call, which is the most useful input the Owner
can have for this decision.

### 5.9 Conversation routes

Separate router `src/routes/conversations-admin.routes.ts` — separate because it
serves transcript text and therefore a stricter posture than the rest of the
Daily View.

**Shipped now (read only):**

```text
GET  /api/v1/admin/conversations/:id                     Owner. Full record incl. transcript + summary.
GET  /api/v1/admin/conversations/:id/audio-url           Owner. Short-lived signed blob URL. Audited.
GET  /api/v1/admin/conversations/by-lead/:model/:id      Owner. List for a Lead (no transcript text).
GET  /api/v1/admin/conversations                         Owner. Windowed list for the Conversations tab.
```

**Deferred (mutations):**

```text
POST /api/v1/admin/conversations/discover                Owner. Idempotency-Key. On-demand match for one Lead.
POST /api/v1/admin/conversations/:id/retry               Owner. Idempotency-Key. Requeue failed/dead_letter.
POST /api/v1/admin/conversations/:id/detach              Owner. Idempotency-Key. Wrong match — clears lead_ref, keeps record.
POST /api/v1/admin/conversations/:id/attach              Owner. Idempotency-Key. Manual attach to a chosen Lead.
```

Mutations follow the Unit 24/25 contract: exactly one `Idempotency-Key`,
`requireRegistryOwnerActor`, stored replay, `409` on a stale revision. The
`audio-url` endpoint writes an audit row on every issue — listening to a
customer call is an auditable act, and it is auditable from the first seeded
record, not from whenever the pipeline lands.

---

## 6. Admin UI/UX

### 6.1 Placement

**DECIDED 2026-08-19.** New route group `vantage-admin/app/(dashboard)/daily/`.
Daily View is **its own page and does not replace `/`.** The existing `/`
`HomeOverview` — Owner waiting intakes, this-week pulse, compact all-time, create
Booking/Cancellation — stays the `/` desk, so no other admin's landing experience
changes. It is not Daily View. Daily View is a **new sidebar item
above Form Leads**, because it is the Owner's first click of the day.

`vantage-admin/uxdocs/owner-daily-view-planned.txt` is replaced by a pointer to
this specification when the first unit lands.

### 6.2 Shell

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Daily Operations                              [ 24h │ 48h ]   ● Live · 2s ago │
│ Wed Aug 19, 6:12 AM – Thu Aug 20, 6:12 AM (Florida)                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Overview │ Leads │ Booking Reconciliation ② │ Release Reconciliation │ Bookings │ Cancels │  │
│ Agents │ Conversations ③                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The **window toggle is global** and lives in the URL (`?window=48h`), so every
  tab, every count, and every share of the link agrees.
- Tabs carry **badge counts of things needing action only** — open intakes,
  failed conversations. Never a badge for "leads exist".
- The **live indicator** is honest: `● Live · 2s ago`, degrading to
  `◌ Paused (background)` and `⚠ Reconnecting`. A dashboard that silently stops
  updating is worse than one that never claimed to.
- Tab state is URL state (`/daily?tab=leads&window=48h&open=call_lead:abc123`),
  so the Owner can bookmark and a support conversation can reference a link.

### 6.3 Overview tab

Three bands, densest at the top:

```text
┌─ NEEDS YOU ─────────────────────────────────────────────────────────────────┐
│  ⬤ 3 Booking cases open        ⬤ 1 Release case open    ⚠ 2 conversations   │
│    oldest 4h ago                  oldest 40m ago           failed            │
└─────────────────────────────────────────────────────────────────────────────┘
┌─ LAST 24 HOURS ─────────────────────────────────────────────────────────────┐
│  Form Leads 41   Call Leads 27   Bookings 9   Cancellations 2                │
│  ↑ 12 booked      ↑ 6 booked      $14,208 dep   $1,100 refund                │
└─────────────────────────────────────────────────────────────────────────────┘
┌─ LIVE (last 10 min) ────────────┬─ GRANOT EVENTS ────────────────────────────┐
│ 6:09  Call lead · Best Reloc.   │ 6:11  decision  matched · shadow  P5562401 │
│       (••) 4192 · 8m  [booked]  │ 6:09  receipt   lead_created      P5562401 │
│ 6:04  Form lead · Top10 Forms   │ 6:04  receipt   priority_updated  P5562388 │
│       (••) 7731                 │ 6:01  conv.     summary ready     P5562344 │
│ 5:58  Booking · P5562388 $1,064 │                                            │
└─────────────────────────────────┴────────────────────────────────────────────┘
```

**Needs You is first and always first.** The Owner's scarce resource is
attention on blocked work, not lead counts. When there is nothing waiting, the
band collapses to a single green line rather than disappearing — absence of a
band reads as a bug.

Both live columns are the same `DailyFeedEvent` list, filtered by `kind`. New
rows animate in with a brief highlight and **never reorder existing rows**.

### 6.4 Leads tab

Split by segmented control (`All / Form / Call`) rather than two tables — the
Owner scans one chronological stream and narrows when he has a reason to.

```text
[ All (68) │ Form (41) │ Call (27) ]   [Search name, phone, job, ref…]  [Booked ▾] [Source ▾]

Time   Kind  Name           Source              Job/Ref    Status        Conv.
6:09   Call  R•••• M••••    Best Relocation     P5562401   ● Booked      🎧 8m
6:04   Form  J•••• T••••    Top10 Forms         —          Open          —
5:52   Call  A•••• K••••    Best Relocation     P5562399   Open          ⏳ transcribing
```

- Row click opens the **right drawer** (Section 6.8).
- Contact is masked in the list via the existing `maskContactLabel`; the drawer
  shows full contact to an Owner.
- The `Conv.` column is the feature's front door: `🎧 8m` (ready), `⏳` (in
  flight), `—` (none found), `⚠` (failed, click to retry). Until the pipeline
  lands this column is `🎧` for seeded records and `—` for everything else —
  which is honest, and which is also the most direct way to show the Owner what
  he is deciding whether to buy.
- Search is server-side and debounced; filters are URL state.

### 6.5 Booking Reconciliation and Release Reconciliation tabs

These are the only tabs where the Owner **writes**. Per challenge 0.8 they are a
window-bounded, capability-gated list that hands off to the existing case
workflow:

```text
Opened  Job       Source            Evidence          Suggested lead        Age
6:02    P5562401  Best Relocation   Booked (2)        R•••• M•••• (high)    10m   [Open →]
4:41    P5562388  Top10 Forms       Priority 5 (1)    — (ambiguous)         1h31m [Open →]
```

`[Open →]` routes to the existing Unit 23 case detail at
`/ingestion/granot/lifecycle/cases/:id` with a `?return=/daily?tab=booking-intakes`
breadcrumb.

**This is deliberately not a drawer.** Confirming a Booking is data entry with
exact-cent allocations, revision guards, an `Idempotency-Key`, and a
draft-preserving `409` path. A cramped overlay is the wrong container for a form
whose failure mode is losing typed work, and duplicating that form would fork the
concurrency logic that must not be forked.

The candidate lead search the Owner asked for **already exists** there
(`cases/:case_id/candidates`, in-scope by default, out-of-scope requiring a
reason). It needs no new work.

When a capability is off, the tab renders the reason and a link to the flag's
health projection — not an empty table.

### 6.6 Bookings and Cancellations tabs

Windowed by `activity_at`, with the business date shown alongside so the gap is
visible:

```text
Recorded  Book date   Job       Customer      Agents          Binder    Deposit   Merchant
6:01 AM   Aug 12      P5562014  C•••• H•••    Patrick         $770      $814      Stripe
5:44 AM   Aug 19      P5562444  C•••• A•••    Jacob           $1,020    $1,064    Stripe
```

The `Recorded` vs `Book date` split is the entire reason for the `activity_at`
rule, and showing both makes the rule self-evident to the Owner instead of
surprising.

### 6.7 Agents tab

```text
Agent      Leads recv.   Recv. booked   Conv. rate   Booking credit   Conversations  Avg talk
Patrick    18            5              27.8%        $3,204           7              11m
Jacob      14            6              42.9%        $4,180           9              14m
```

- `Leads recv.` — leads with `receiver_agent = X` and `activity_at` in window.
- `Recv. booked` — of those, how many have a Booking. Conversion of what they
  were handed.
- `Booking credit` — sum of `agent_allocations.binder_amount` where the agent
  appears, on Bookings recorded in window. **A different question** (challenge
  0.7), labelled as such with a tooltip.
- `Conversations` / `Avg talk` — from `lead_conversations` by `receiver_agent`.
- Row click filters the Leads tab to that agent rather than opening a drawer —
  the useful next action is "show me their leads".

### 6.8 The detail drawer

The Owner asked whether to use an overlay or a side-by-side pane.
**Recommendation: right-side overlay drawer**, extending the existing
`components/ui/side-panel.tsx` from `max-w-3xl` to `max-w-4xl` with a
drag-resize handle persisted to local storage.

Reasoning: the drawer content is a formatted entity state, a provenance chain,
and a transcript — all tall and narrow-hostile. A split pane on a 1440px laptop
leaves the list too narrow to scan *and* the detail too narrow to read, which is
the worst of both. An overlay gives the detail real width and returns the full
list on close. Deep-linked via `?open=<kind>:<id>` so it survives refresh.

```text
┌─ Call Lead · P5562401 ──────────────────────────────────── [Open full ✕] ─┐
│ ┌ Details ┬ Provenance ┬ Conversation ┐                                   │
│                                                                            │
│  Robert Martinez · (402) 215-5590 · robert@…                              │
│  Best Relocation → best_relocation_leads_call                             │
│  Council Bluffs, IA 51501 → Cypress, TX 77433 · 300 cu ft                 │
│  Received 6:09 AM · Agent Patrick · CPL $42.00                            │
│  ● Booked P5562014 · $814 deposit · book date Aug 12                      │
├────────────────────────────────────────────────────────────────────────────┤
│  PROVENANCE                                                                │
│   ●  6:09:02  Granot observation      lead_created · Best Relocation       │
│   │  6:09:04  RingCentral call        Inbound 8m02s · Accepted             │
│   │  6:09:07  Decision                matched · granot_priority            │
│   │  6:09:07  Record link             established · P5562401               │
│   │  6:14:20  Entity change           booked, deposit_amount               │
│   ●  6:22:41  Conversation            summary ready · high confidence      │
├────────────────────────────────────────────────────────────────────────────┤
│  CONVERSATION  ▶ 8:02  Inbound · matched by telephony session (high)       │
│   Overview — Robert called about a 300 cu ft move from Council Bluffs…     │
│   Wanted — …                                                               │
│   Money & dates — …                                                        │
│   Outcome — …                                                              │
│   ⚠ Mismatch vs CRM — caller said Sept 4; record shows no move date.       │
│   [Show transcript ▾]                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Provenance** renders `GranotTimelinePage` directly — one component reused
  across Leads, Bookings, Cancellations, and the existing case detail.
- The **mismatch line is visually distinct** and sorts to the top of the summary.
- The transcript is collapsed by default: it is long, and it is the most
  sensitive text on the page.
- Audio loads its signed URL **only when the Owner presses play**, so opening a
  drawer is not an audited listen.
- `[Open full]` routes to the existing full record page for anything the drawer
  cannot hold.

### 6.9 Conversations tab

Per the Owner's own question — yes, it earns a tab, but as a **pipeline queue,
not a browser**. Summaries are read on the Lead. This tab exists for the
conversations that have no Lead yet, or that failed.

**With the pipeline deferred**, the tab ships read-only and will show the seeded
record(s) only. The filter chips, state column, and cost total all render
correctly against one record; `Needs attention` and `Unmatched` are simply empty
and say so. The `[Attach →]` and `[Retry]` actions are the deferred mutations —
render them **disabled with a "requires the conversation pipeline" tooltip**
rather than hiding them, so the tab's purpose is legible on day one.

The at-scale layout is unchanged when the pipeline lands:

```text
[ All │ ⚠ Needs attention (2) │ Unmatched (3) │ Complete (41) ]     Window cost: $2.84

Started  Dir   Duration  Matched to            State           Cost
6:09     In    8m02s     Call lead R•••• M•••  ● complete      $0.03
5:44     Out   17m25s    Form lead C•••• A•••  ⏳ transcribing  —
5:31     In    22m10s    — unmatched            ● complete      $0.07   [Attach →]
4:02     In    12m       Call lead A•••• K•••  ⚠ failed         —       [Retry]
```

Without this tab, a silently failing pipeline is invisible and the Owner's trust
in every summary degrades. The window cost total also keeps the spend honest.

### 6.10 Admin data layer

- `lib/api/ownerDaily.ts` — typed fetchers per endpoint, mirroring
  `lib/api/granotLifecycle.ts`.
- `lib/api/conversations.ts` — conversation fetchers and mutations.
- `lib/query/keys.ts` — new `queryKeys.ownerDaily.*` namespace keyed by
  `{ window, tab, filters }` so switching 24h↔48h is a clean cache boundary.
- `lib/query/ownerDailyFeed.ts` — **`useDailyFeed()`**, the single transport
  seam from Section 4.4. Every component consumes the hook; nothing consumes the
  transport.
- Lists use `useInfiniteQuery` on the existing cursor contract, per the standing
  Admin UX proposal.
- `canProxyVantagePath` and `canAccessDashboardPath` gain the Owner-only
  `/daily` and `/api/v1/admin/owner-daily` + `/api/v1/admin/conversations`
  entries — **all methods**, not just mutations.

---

## 7. Security, PII, and RingCentral recording policy

This section exists because the conversation feature is deferred **on these
grounds**, not on engineering grounds. It is written to be the input to that
decision.

**Framing.** RingCentral is already recording these calls today. This feature
does not create recordings. What it does is make them **durable outside
RingCentral, machine-readable, full-text searchable, and summarized by a third
party**. That is a materially different posture from "audio sits in the phone
system for 90 days", and it is the change that has to be justified — not the
recording itself.

### 7.1 Access control

| Rule | Where enforced |
| --- | --- |
| Transcripts, summaries, and audio are **Owner-only on every method**, not just mutations | `canProxyVantagePath` and `canAccessDashboardPath` gain `/api/v1/admin/conversations` and `/daily` as Owner-only prefixes; server-side `requireRegistryOwnerActor` on every conversation route |
| Employees with Admin logins must never reach transcript text | The Owner-only prefix is enforced in **both** the Admin BFF and the server. Two gates, because one is a single edit away from being wrong |
| Issuing an audio URL is an audited act | `/conversations/:id/audio-url` writes `writeAuditLog` on every issue. "Who listened to which customer call, when" must be answerable |
| Signed audio URLs are short-lived and single-purpose | Minutes, not hours. Never embedded in a list payload — issued only on an explicit play |
| Timeline entries carry **no** transcript or summary text | Extend `JOB_PROJECTION_FORBIDDEN_KEYS`; `assertProjectionSafe` covers the new entry types |
| List payloads carry **masked** contact only | `maskContactLabel`, already implemented |
| Summaries never mutate a Lead, Booking, or Cancellation | Conversation code has no domain-command dependency |

### 7.2 RingCentral account posture — verify before anything else

These are facts about the RingCentral account that the code cannot determine and
that change what is legal and possible. **Confirm each in the RC admin console
and record the answer here** before the pipeline is un-deferred.

| Question | Why it matters |
| --- | --- |
| Is recording **automatic** or **on-demand** per extension? | Automatic recording captures every call including ones no one intended to keep. On-demand means agents choose, which changes the consent story. |
| Is a **recording announcement / disclaimer** enabled, on which directions? | This is the operative consent mechanism for inbound. If it is off, the all-party consent question in 7.4 has no good answer. Inbound and outbound are configured separately — outbound callbacks to form leads are the ones most likely to be missing it. |
| What is the account's **recording retention period**? | Plan-dependent. This bounds how far back a backfill can reach and determines whether "not stored is gone". Verify the actual number rather than assuming. |
| Which API scopes are granted, and to which app? | The spikes need `ReadCallLog` and `ReadCallRecording`. `ReadCallRecording` on the account-wide call log is broad — it reaches **every extension's** calls, not just the JWT user's. |
| Is the JWT a **dedicated service identity**? | It should not be a person's account. A departing employee should not break the pipeline or retain access. |
| Are there call types that must **never** be transcribed? | HR calls, internal extension-to-extension, anything routed to a personal line. The account-wide call log returns all of them. A source/route allowlist is the mitigation. |

**Consequence for the design.** The account-wide call log is broader than this
feature's need. Discovery must be constrained to calls that resolve to a Lead in
a registered Source Granularity, never "all recordings in the window". That is
already how the match ladders work (Section 5.3) — it is worth stating as a
security property, not just a matching strategy.

### 7.3 PCI — the highest-severity finding in this document

Vantage agents take **deposits over the phone**. `BookedLead` carries
`deposit_amount`, `total_binder_amount`, and an active `Merchant`. It is
therefore near-certain that some recordings contain a spoken **card number,
expiry, and CVV**.

The consequences differ sharply by system:

- **Audio in RingCentral today** — already a PCI consideration, already the
  Owner's existing exposure, unchanged by this feature.
- **A transcript in Mongo** — a full PAN and CVV in queryable, indexable,
  backed-up, replicated text. This is a **materially worse** exposure than the
  audio, because it is searchable and because it propagates into every Mongo
  backup and every replica. Storing CVV after authorization is prohibited
  outright under PCI DSS regardless of encryption.

**Requirements, in priority order:**

1. **Fix it upstream first.** The correct remedy is to stop capturing card data
   in recordings at all — RingCentral supports pausing recording during payment
   capture, and taking deposits via a payment link rather than read aloud
   removes the problem entirely. This is worth doing **independently of this
   feature**, because it reduces exposure that already exists today.
2. **Redact deterministically before persistence.** `conversations/redaction.ts`
   runs on the transcript **before** the Mongo write and **before** the
   summarizer prompt. Targets: card numbers (13–19 digits, Luhn-validated,
   including digits spoken in groups), CVV in proximity to card context,
   expiry-shaped pairs, SSN, and bank routing/account numbers. Store the
   `redactions` count; a nonzero count on a call is a signal worth surfacing.
3. **Never trust the model to redact.** The regex pass is the control. A prompt
   instruction is defence in depth, not a control.
4. **Consider not storing transcripts for payment calls at all.** If redaction
   confidence is low, the safer product is: summary only, no verbatim transcript,
   for any call where `redactions > 0`.
5. **Redaction is tested, not assumed.** Section 10 requires synthetic
   transcripts containing card numbers, CVVs, and SSNs to persist redacted with
   a matching count. This test is a release gate, not a nicety.

The seeding script runs the same redactor, so the first real record proves the
control before there is a second.

### 7.4 Recording consent — the legal landscape

**This is not legal advice, and it is not the engineer's decision.** It is the
factual landscape so the Owner can take it to counsel with the right questions.

- **Federal** wiretap law (18 U.S.C. § 2511) is **one-party** consent.
- **Florida — where Vantage operates — is an all-party consent state**
  (Fla. Stat. § 934.03). This is the governing fact here, not a footnote.
- Roughly a dozen states are commonly cited as all-party, including California,
  Florida, Illinois, Maryland, Massachusetts, Michigan, Montana, Nevada,
  New Hampshire, Oregon, Pennsylvania, and Washington. **The precise list and
  its interpretation vary** by statute, by case law, and by whether the
  communication is oral or electronic. Do not treat this list as authoritative.
- **Interstate calls are the hard case, and they are the normal case here.** An
  interstate moving company calls customers in every state. The conservative and
  common practice is to apply the **stricter** state's rule, which for a Florida
  business means assuming all-party consent is required.

**Questions for counsel:**

1. Does the current RC recording announcement satisfy all-party consent for
   **inbound** calls? For **outbound callbacks** to form leads?
2. Does consent to *record* extend to **transcription, storage outside the phone
   system, and processing by a third-party AI provider**? Or is that a separate
   disclosure?
3. Does the privacy policy at `vantage-admin/app/privacy-policy` cover call
   recording, transcription, and third-party AI processing? It likely predates
   all three.
4. Are there state-specific retention or deletion obligations, or customer
   rights of access/deletion, that attach once the recording is durable outside
   RingCentral?
5. Does making recordings full-text searchable change the discovery/litigation
   posture in a way the Owner should weigh?

**Engineering position:** the pipeline stays deferred until questions 1–3 have
answers. Questions 4–5 shape retention policy (Section 5.7) rather than blocking
the build.

### 7.5 Third-party AI processing

Sending customer audio to OpenAI makes OpenAI a **subprocessor of customer
personal data**. That is a contractual and disclosure matter, not just a
technical one.

| Requirement | Status |
| --- | --- |
| **Organization account, not a personal API key** | ⚠️ **Not met.** `call-lead-transcript-handoff.md` records the spikes running on a personal key in `.env`. Acceptable for a spike; unacceptable for production customer data. Production requires a company-owned org account. |
| **Data Processing Agreement in place** | Open. Required before any production customer audio is sent. |
| **Training opt-out confirmed** | API data is not used for training by default, but confirm the current terms for the account and the specific endpoints rather than assuming. |
| **Retention posture confirmed** | Default abuse-monitoring retention applies unless Zero Data Retention is approved for the account. Confirm ZDR eligibility **specifically for the audio transcription endpoint** — endpoint eligibility varies. |
| **Provider path decided** | Direct OpenAI or Vercel AI Gateway. The spikes hit free-tier `429`s on Gateway and fell back to direct. Whichever is chosen, the DPA and retention questions apply to that path. |
| **Sub-processor disclosed in the privacy policy** | Open — see 7.4 question 3. |
| **Key scoping and rotation** | Production key stored as a Vercel environment secret, scoped to the project, rotatable without a code change. Never in a committed `.env`. |

**Data minimisation that costs nothing:** the summarizer prompt attaches CRM
context (job, source, agent, route, money, dates). It does **not** need the
customer's full name, email, or phone to produce a useful summary. Send the
redacted transcript plus the move/quote context; withhold direct identifiers.
The summary is displayed next to the Lead record, which already supplies
identity to the reader.

### 7.6 Credentials and secrets

| Rule | Where enforced |
| --- | --- |
| RC `contentUri` is credential-bearing and is **never stored, logged, or returned** | `conversations/media.ts` — persist `call_log_id` and re-resolve on demand |
| RC tokens use the existing store, not a file token cache | `RC_TOKEN_STORE=file` is a local spike affordance; production uses `mongo-token-store.ts` |
| Blob objects are `access: "private"` | Already proven by `upload-ringcentral-mp3.ts`; a public blob URL for a customer call is unrecoverable once indexed |
| No live RC payload, real transcript, or real customer audio in the repository | Unit 01 fixture rule. `ringcentral-recording-samples/` stays gitignored |
| Errors and logs carry ids, never transcript text | Same redaction discipline the webhook capture path already applies to secrets |

### 7.7 What the deferral actually buys

The deferral is not delay for its own sake. Until 7.2 is answered, 7.3 item 1 is
done, and 7.4 questions 1–3 have counsel answers, an automated pipeline would be
continuously accumulating searchable customer card data and recorded speech under
an unverified consent posture. **One manually seeded record, on a known booked
lead, with the redactor and the audit trail live, proves the product without
accumulating that exposure.** That is the whole reason for the shape of
Section 5.2.

---

## 8. Performance budget

| Endpoint | Budget (p95) | Basis |
| --- | --- | --- |
| `/owner-daily/overview` | 400ms | 4 parallel `$facet` pipelines over ≤48h, indexed |
| `/owner-daily/feed` | 150ms | 8 parallel `$gt` watermark queries, near-empty steady state |
| `/owner-daily/leads` | 300ms | One indexed range scan, `limit` 50 |
| `/owner-daily/detail/:kind/:id` | 500ms | Entity + timeline page + conversation refs |
| `/conversations/:id` | 200ms | Single document |

If `/feed` exceeds budget at real volume, the first remedy is narrowing which
`kind`s the client subscribes to per tab — **not** the event-sourcing projection
rejected in challenge 0.5.

---

## 9. Unit breakdown

Sequenced so each unit is independently shippable and the Owner sees value at
the end of the first one.

| Unit | Capability | Depends on | Notes |
| --- | --- | --- | --- |
| **A** | `ownerDaily` window contract, capabilities projection, Overview service + tab, four window indexes | Units 22–25 landed | First Owner-visible value. Read-only. |
| **B** | Leads, Completed Bookings, Completed Cancellations tabs; detail drawer; provenance chain reuse | A | Extends `GranotTimelinePage` rendering to Admin |
| **C** | Live feed cursor endpoint + `useDailyFeed()` + live indicator | A | Poll transport. SSE seam designed, not built. |
| **D** | `LeadConversation` model + index migration, redactor, Owner-only read routes, seeding script, one real seeded conversation | A | **Shipped scope of the conversation feature.** Section 5.2. No cron, no queue, no discovery. |
| **E** | Conversations tab (read-only) + drawer conversation panel + audited signed audio URL | D | Renders whatever records exist — one, at first |
| **F** | Agent metrics tab | A | `receiver_agent` and allocation metrics side by side. Conversation columns render zero until D seeds records. |
| **G** | Booking Reconciliation tab (gated) + Release Reconciliation tab | A, **Unit 26 for cancellations** | Lists + handoff only |
| *(H)* | **DEFERRED** — automated conversation pipeline: match ladders, discovery crons, RC rate limiter, queue consumer + state machine, media janitor, attach/detach/retry commands | D, E, **and Section 7 gates cleared** | Sections 5.3–5.8. Requires Owner cost authorization, retention policy, and counsel answers on 7.4 questions 1–3. |
| *(I)* | *Optional* SSE transport swap | C | Only if 3s polling is measurably insufficient |

**Why D is shaped this way.** The original plan split conversation *matching*
from *transcription* so the matching could be proven at zero cost. With the
pipeline deferred, matching is not being built at all — so D collapses to the
parts that carry no recurring cost and no accumulating exposure: the schema, the
redactor, the read path, and one record produced by hand. The Owner gets to see
the finished product on real data, and the system accumulates exactly one
transcript while the Section 7 questions are open.

**Do not merge H back in early.** The moment a discovery cron exists, the cost
and retention decisions have been made by default rather than by the Owner.

---

## 10. Verification

Following the program's existing discipline:

- **Focused tests** per service, `*.test.ts`, alongside the code.
- **Replica tests** (`*.replica.test.ts`, `pnpm test:granot-lifecycle:replica`)
  for anything transactional or leased — the conversation drainer's claim,
  lease expiry, and one-winner concurrency.
- **Masking tests**: `assertProjectionSafe` must reject a timeline entry
  containing transcript text, summary text, or an unmasked phone. This is a
  regression guard, not a nicety.
- **Redaction tests**: synthetic transcripts with card numbers, CVVs, and SSNs
  must persist redacted, with the `redactions` count matching.
- **Window tests**: a Booking with `book_date` two weeks ago and `timestamp` now
  **must** appear in the 24h Completed Bookings pane. This encodes challenge 0.3
  as a test.
- **Capability tests**: with `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` false, the
  Booking Reconciliation pane returns `not_activated` and never an empty list.
- **Fixtures** stay credential-redacted synthetic, per Unit 01. No live RC
  payload, no real customer transcript, enters the repository.
- **Seeding-script guards** are tested: no `--confirm-write` spends nothing and
  writes nothing; a second run of the same recording updates rather than
  duplicating (unique index); exceeding `--max-cost-cents` aborts before STT.
- **Owner-only enforcement** is tested at both gates — an Admin-role session must
  be refused transcript text by the Admin BFF *and* by the server, independently.
- `pnpm test` and `pnpm typecheck` in both repos after runtime changes.

---

## 11. Explicit non-goals

- **No automated conversation discovery, transcription, or summarization.**
  Deferred per Section 5.0. Exactly one seeding script, run by hand, on a named
  Lead.
- No automatic action from a summary. A detected CRM mismatch surfaces to the
  Owner; it never writes.
- No sentiment scoring, agent grading, or call-quality scoring. Different
  product, different consent posture.
- No realtime transcription of in-progress calls.
- No replacement of the `/` analytics Overview.
- No new Booking, Cancellation, Release, or Referral command. The Daily View
  delegates to what Units 24–27 own.

---

## 12. Open questions for the Owner

### 12.1 Blocked the Daily View build — all resolved

1. ~~**Rolling window or business day?**~~ **DECIDED 2026-08-19: rolling.**
   24h/48h back from `now`. Reasoning is recorded in challenge 0.3. No third
   mode. Comparable day-over-day numbers stay an analytics concern.
2. ~~**Does Daily View become the home page?**~~ **DECIDED 2026-08-19: no.**
   `/daily` is its own page. `/` remains `HomeOverview` — waiting intakes, this-week
   pulse, compact all-time, create Booking/Cancellation — not Daily View. Daily View
   is a new sidebar entry above Form Leads. No other admin's landing experience
   changes.
3. ~~**Release Reconciliation timing.**~~ **DECIDED 2026-08-19: the tab waits.**
   Release Reconciliation ship after Granot Unit 26 (Release Reconciliation). The
   Daily View does **not** wait for it — ODV-G ships the Booking half and the
   `not_built` capability panel for the Cancellation half.

Nothing in §12.1 blocks the build. Units A–G may proceed once the sprint branch
exists.

### 12.2 Gates the deferred conversation pipeline (Unit H)

These are the deferral gates from Section 5.0, restated as the questions that
must be answered before Unit H can start. None of them blocks Units A–G.

4. **Cost.** Authorize ~$90/month recurring at 50 conversations/day, plus a
   one-time ~$10–15 backfill of the ~187 existing booked call leads with RC ids?
   *The seeded record prints a real per-call cost as the input to this.*
5. **RingCentral account posture.** The six questions in Section 7.2 — recording
   mode, announcement configuration per direction, retention period, API scope
   breadth, service-identity JWT, and call types that must never be transcribed.
   *These are console lookups, not decisions, but they must be recorded.*
6. **PCI.** Section 7.3. Are deposits still taken by reading card numbers aloud?
   If so, pausing recording during payment capture or moving to payment links is
   worth doing **independently of this feature** — it reduces exposure that
   exists today.
7. **Consent.** Section 7.4 questions 1–3 need counsel answers: does the current
   announcement satisfy Florida all-party consent for inbound *and* outbound;
   does consent to record extend to transcription, external storage, and
   third-party AI processing; and does the privacy policy cover any of it.
8. **Third-party processor.** Section 7.5 — org account replacing the personal
   key, DPA, retention/ZDR posture confirmed for the audio endpoint specifically,
   and provider path (direct OpenAI vs Vercel AI Gateway) chosen.
9. **Retention.** Section 5.7 — the proposed line is 90 days for unbooked audio,
   indefinite for booked, transcripts permanent. Weigh against the
   counter-position of storing **no** audio at all and keeping only redacted
   text, which removes the retention question entirely at the cost of playback.
10. **Form-lead discovery scope.** Booked form leads only (~1 RC Heavy request
    per lead, high hit rate), or all form leads (many more requests, most
    finding nothing)? *Recommendation: booked only, with an on-demand button
    covering everything else.*

---

## 13. Where to go next in the repo

| Need | Start here |
| --- | --- |
| Program state | [`sprint-progress-through-unit-25.md`](./sprint-progress-through-unit-25.md) |
| Flags, activation, and source policy | [`lifecycle-activation-flags-and-source-policies.md`](./lifecycle-activation-flags-and-source-policies.md) |
| Unit ledger | [`delivery/UNIT-STATUS.md`](../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md) |
| Provenance chain to reuse | [`projections.ts`](../../src/services/granotLifecycle/projections.ts) — `GranotTimelineEntry`, `paginateTimeline`, `maskContactLabel` |
| Durable claim/lease pattern to copy | [`drainer.ts`](../../src/services/granotLifecycle/drainer.ts), [`call-log-sync-state.store.ts`](../../src/services/ringcentral/call-log-sync-state.store.ts) |
| Owner command contract to copy | [`granot-lifecycle-admin.routes.ts`](../../src/routes/granot-lifecycle-admin.routes.ts) — `Idempotency-Key`, revision guards, `409` |
| Why the conversation pipeline is deferred | Section 5.0 and Section 7 of this document |
| RC recording match evidence | [`FINDINGS-form-lead-phone-matching.md`](../../scripts/dev_ops/ringcentral/FINDINGS-form-lead-phone-matching.md), [`call-lead-transcript-handoff.md`](../../scripts/dev_ops/ringcentral/call-lead-transcript-handoff.md) |
| Named booked leads with confirmed recordings, for the seed | [`BOOKED-LEAD-TRANSCRIPT-SAMPLES.md`](../../scripts/dev_ops/ringcentral/BOOKED-LEAD-TRANSCRIPT-SAMPLES.md), `FINDINGS-form-lead-phone-matching.md` |
| STT + summary reference implementation | [`transcribe-matched-booked-samples.ts`](../../scripts/dev_ops/ringcentral/transcribe-matched-booked-samples.ts) — prompt, models, output shape |
| Blob storage spike | [`upload-ringcentral-mp3.ts`](../../scripts/dev_ops/blob/upload-ringcentral-mp3.ts) |
| Admin operational UX baseline | [`admin-operational-views-ux-proposal.md`](../../../vantage-admin/uxdocs/admin-operational-views-ux-proposal.md) |
| Existing case detail to hand off to | `vantage-admin/components/granot-lifecycle/case-detail.tsx` |
