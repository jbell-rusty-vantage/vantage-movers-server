# Daily Operations Workspace

**Status:** orientation memo (superseded as the working contract)  
**Working contract:** [`daily-operations-pre-specification.md`](daily-operations-pre-specification.md)  
**Date:** 2026-09-06  
**Surfaces:** `vantage-main-server` + `vantage-admin`  
**Audience:** Owner-facing Admin Dashboard, backed by new main-server reads and increment writers

This is a product and architecture recommendation for an advanced **Daily Operations** tab and workspace. It is written from the live system as it exists today — routes, collections, Ingestion Origins, webhook classes, and existing desks — not from an earlier Daily View contract.

**Glossary:** workspace-root [`CONTEXT.md`](../../../CONTEXT.md). Use those words. Do not invent synonyms.

---

## 1. What we are building

Daily Operations is the Owner's **business-day board**.

It answers, continuously:

- What just happened, in categories the Owner already thinks in (Form, Call, Granot webhook, text, intake, Booking, Cancellation, Sheet Sync).
- How today's counts are moving, and whether they are ahead or behind yesterday.
- Where the volume came from (Source Company, Form vs Call, Ingestion Origin).

It is **not**:

| Existing desk | Why Daily Operations is different |
| --- | --- |
| Overview (`/`) | Week pulse + all-time + a short Waiting-for-you band. Not a live day board. |
| Live Events (`/live-events`) | Raw Granot webhook receipt firehose. Last 30 minutes, max ~80 cards, no filters, no counts. |
| Analytics (`/analytics`) | Historical, date-ranged business reports. Recomputed on request. Not live. |
| Workflow Observational (`/observational`) | Server and integration health. Operational Events, incidents, Sheet Sync jobs. Not "how many leads today." |
| Intakes (`/intakes`) | Work queue for Granot Booking Reconciliation Cases. Daily Operations links into it; it does not replace it. |
| Record lists (`/form-leads`, `/bookings`, …) | Durable search and edit. Not a rolling day. |

Keep those desks. Daily Operations sits beside them as the **Today** workspace.

**Recommended route:** Owner-only `/daily` in the Today sidebar group, immediately after Overview and before Live Events.

**Recommended label:** Daily Operations. Not Overview. Not Live Events. Not Observational.

---

## 2. How the real day actually arrives

Partner WordPress currently posts the quote form **to Granot, not to Vantage**. That fact shapes the feed.

What the Owner experiences as "a form came in" is, today, usually:

1. Granot receives the form.
2. Granot fires `lead_created` (and later `priority_updated`, and maybe `booking_status_changed`).
3. Vantage captures a Granot Observation Receipt, processes it, and either **mints** a Lead (`create_if_missing`), **links / enriches** an existing Lead (`link_only`), or **observes only**.

Vantage still has `POST /api/v1/form-leads` and stamps `ingestion_origin: wordpress_form`. That path is real for Next.js clients, tests, and future Landing Page wiring. It is **not** the live partner WordPress destination.

So Daily Operations must treat **two different "form" stories** as first-class:

| Story | What the Owner sees | What we count |
| --- | --- | --- |
| Granot-mediated form | `lead_created` receipt, then maybe a minted or linked Form Lead | Webhook + Synchronization Decision + Lead if one is written |
| Direct Form Lead Ingestion | Form Lead created, duplicate check, zip/state, Lead Message, Sheet Sync | Form Lead + downstream steps |
| Call | RingCentral qualification → Call Lead (or duplicate) | Call Lead + origin `ringcentral` |
| Best Relocation | Sheet ingest creates Form/Call/Booking rows | Lead / Booking with origin `best_relocation_sheet` |
| Admin Manual | Owner creates a Lead | Lead with origin `vantage_admin` |

If we only stream Granot receipts, we miss RingCentral, Best Relocation, employee Booking, and direct form ingest. If we only stream Lead creates, we miss `priority_updated`, Release/Booked, texts that never created a Lead, and receipts that observed but did not mint.

**The workspace streams both facts and outcomes.**

---

## 3. Calendar and "today"

**Today is the America/New_York business day.** That is already the Owner calendar for CPL, reporting, Best Relocation, SMS quiet hours, and Florida wall-clock lead timestamps (`FLORIDA_TIME_ZONE` in `src/utils/easternTime.ts`).

Rules:

- The day key is `YYYY-MM-DD` in `America/New_York`, not UTC midnight and not the process-local timezone.
- Lead activity binds on the Lead's `timestamp` (already stored as Eastern wall-clock).
- Booking activity for the **live day board** binds on **when the Booking was written** (`createdAt` / command time), not `book_date`. `book_date` is the sale date the Owner entered; it can be yesterday's sale recorded this morning.
- Cancellation activity for the live board binds on **when the Cancellation was written**, not `cancel_date`.
- Granot receipts bind on `captured_at`.
- Lead Messages bind on accepted/sent/delivered time.
- Yesterday comparison uses the previous New York calendar day, **frozen at close** (see §7). Comparing a live today against a still-mutating yesterday is how day-over-day lies.

Live Events stays a rolling 30-minute window. Daily Operations is a **calendar day**, with an optional "last 12 hours" clip for the feed only. Counts always mean the New York day.

---

## 4. Event catalog — everything we can stream

Each row is a **streamable fact**: something that already happens in code and can appear as a categorized card. `Count?` means it also bumps a running total.

### 4.1 Form path (direct ingest — exists, not current WordPress destination)

| Fact | Existing signal | Count? | Notes |
| --- | --- | --- | --- |
| Form Lead created | `lead.form.created` | Yes — Form Lead | Origin `wordpress_form` (public) or `vantage_admin` |
| Duplicate Form Lead | `lead.form.duplicate_detected` | Yes — duplicate Form, not paid volume | Still saved |
| Matching Call Leads marked Form Fill | `lead.form.call_leads_marked_form_fill` | Progress, not a headline KPI | Attribution overlap |
| Zip/state missing | `zip_state.lookup.missing` | Exception chip | Move Type may be incomplete |
| Maps fallback failed | `zip_state.google_maps.failed` / `.unavailable` | Exception | |
| CRM Posting started / done / failed | `crm.form_lead.submit.*` | Progress | Only on this ingest path; duplicates skip |
| Lead Message accepted / failed | `lead_message.accepted` / `.dispatch_failed` / `.delivery_failed` | Yes — texts | Only if `sms_consent=true` |
| Sheet Sync job enqueued / written | `sheet_sync.*` + job row | Progress | Eventually consistent |

### 4.2 Call path

| Fact | Existing signal | Count? | Notes |
| --- | --- | --- | --- |
| RingCentral cron started / completed | `ringcentral.call_log_sync.*` | Health, not a volume KPI | Safety net beside the webhook |
| Qualified call ingested | `ringcentral.call_lead.created` | Yes — Call Lead | Origin `ringcentral` |
| Duplicate Call Lead | `ringcentral.call_lead.duplicate_created` | Yes — duplicate Call | CPL = 0 |
| Already processed (idempotent) | `ringcentral.call_lead.skipped_already_processed` | No | Noise; keep out of the Owner feed |
| Form Fill on Call Lead | `lead.call.form_fill_detected` | Progress | |
| Granot Call adopted by RingCentral | `ringcentral.granot_adoption.adopted` | Progress | Origin stays `granot_lead_created` |
| Adoption conflict | `ringcentral.granot_adoption.conflict` | Exception | |
| Admin / sheet Call Lead created | `lead.call.created` | Yes — Call Lead | Origins `vantage_admin` / `best_relocation_sheet` |

Unqualified RingCentral calls (not inbound, not mapped, unanswered, under 120s, no caller phone) **do not become Call Leads** and should not appear on Daily Operations. They belong in Observational if anywhere.

### 4.3 Granot webhooks

These already stream on Live Events. Daily Operations **consumes the same receipts**, then adds the **processor outcome**.

| Fact | Route class | Count? | Outcome the Owner cares about |
| --- | --- | --- | --- |
| `lead_created` received | `lead_created` | Yes — webhook | Then: minted / linked / pending match / unmatched / observed only / blocked |
| `priority_updated` received | `priority_updated` | Yes — webhook | Never mints. Enrichment or no-op. |
| `booking_status_changed` Booked | `booking_status_changed` + action `booked` | Yes — webhook + Booked | Opens / refreshes a Granot Booking Reconciliation Case. Does **not** create a Booking. |
| `booking_status_changed` Release | same + action `release` | Yes — webhook + Release | Same case family. Does **not** create a Cancellation. |
| Receipt captured | receipt row | Implicit | 202 `{ receipt_id }` |
| Processing completed | `granot_lifecycle.processing.completed` | Progress | Decision outcome |
| Case opened / refreshed | `granot_lifecycle.booking_case.opened` / `.refreshed` | Yes — intakes opened | Link to `/intakes?case=` |
| Dead letter / retry | `granot_lifecycle.dead_letter.*` / `.technical_retry.*` | Exception | Also Observational |

Mint / link / observe is **not** a stored enum. It is the Registry `lead_created_policy` on the Granot CRM Source:

| Policy | Owner language on the card |
| --- | --- |
| `create_if_missing` | Created a Lead (mint) — origin `granot_lead_created` |
| `link_only` | Linked or waiting to match. No new Lead. |
| `observation_only` | Seen only. No Lead write. |

`priority_updated` and `booking_status_changed` never mint.

### 4.4 Lead updates and Sheet Sync

| Fact | Count? | Notes |
| --- | --- | --- |
| Lead corrected (Admin PATCH) | Feed only | Not a "new lead today" |
| Granot synchronize applied | Feed only | `applied` / `already_current` / `stale` |
| Form / Call Enrichment (extension) | Feed only | Distinct from ingestion |
| Sheet Sync job completed / failed / deferred quota | Progress | Master Sheets only |
| CPL Correction | Out of Daily Operations | Batch rewrite; belongs in Operations Registry / Observational |

### 4.5 Booking and Cancellation

| Fact | Existing signal | Count? |
| --- | --- | --- |
| Granot Booking Reconciliation Case opened | case + Operational Event | Yes — intakes |
| Owner Confirm Granot Booking | official Booking write | Yes — Booking |
| Connect Booking to Lead | attach only | Feed; not a new Booking |
| Employee Booking Submission linked | `booking.employee_submission.created_linked` | Yes — Booking |
| Employee Booking Submission pending Lead | `.created_pending` | Yes — Booking + Booking Lead Reconciliation Case |
| Admin `booked-leads` / from-source / leadless / referral | `booking.created` / `.upserted` | Yes — Booking (split by kind) |
| Duplicate submission ignored | `booking.duplicate_submission_ignored` | No |
| Cancellation created | `cancellation.created` | Yes — Cancellation |
| Confirm Granot Cancellation | official Cancellation | Yes — Cancellation |
| Booking Lead Reconciliation resolved / dismissed | `booking.lead_reconciliation.*` | Progress |

### 4.6 Best Relocation

| Fact | Count? | Notes |
| --- | --- | --- |
| Ingest run applied creates | Yes, on each created Lead / Booking | Origin `best_relocation_sheet` |
| Adopt (receipt only) | No new origin rewrite | Do not recount as a new Lead |
| Conflict / unmatched refund | Exception | Never invent a Cancellation |

### 4.7 What we deliberately do not stream here

- Unqualified RingCentral calls
- Idempotent "already processed" skips
- HTTP / Mongo / auth Operational Events
- Process-local Granot Section 33 counters
- Full Granot payload dumps (Live Events and Receipts already have that)
- Conversations (seeded desk exists; not part of this board's first cut)
- Bad Call (not implemented)

---

## 5. One feed or a space per webhook?

**Keep one Granot stream. Categorize it. Do not open a socket per event class.**

Live Events already streams `lead_created`, `priority_updated`, and `booking_status_changed` on one SSE. That is the right transport grain for Granot. Splitting into three live spaces would:

- Triple reconnect / watermark logic for no new information.
- Hide the real sequence (create → priority 5 → Booked) that the Owner uses to understand one Job Number.
- Make day counts harder, because the same job crosses classes.

What *does* need to change is **presentation**, not transport.

### Recommendation

**Daily Operations has one activity feed with lanes (filters), not three webhook pages.**

| Lane | Default | Why |
| --- | --- | --- |
| All | On | Single story of the day |
| Granot | On | The three webhook classes, tagged |
| Leads | On | Form / Call creates, duplicates, mints, links |
| Texts | On | Lead Messages |
| Intakes | On | Case opened / refreshed — the work signal |
| Bookings | On | Official Booking writes |
| Cancellations | On | Official Cancellation writes |
| Sheet Sync | Off by default | Progress; noisy |
| Exceptions | On | Zip miss, dead letter, adoption conflict, CRM fail |

Inside the Granot lane, **chips** (not separate pages):

- Lead created
- Priority updated
- Booked
- Release

`priority_updated` is high volume and low action. Default the chip **on**, but give the Owner a one-click "quiet priorities" so Booked / Release and Lead creates stay visible. That is the pressure valve. It is not a second workspace.

**Do not merge this feed into Live Events.** Live Events stays the raw receipt accordion (full payload, 30-minute window). Daily Operations cards are Owner-language: who, Source Company, what happened, outcome, link to intake / lead / job.

**Do not merge this feed into Observational Events.** Those rows are workflow telemetry (`http`, `mongo`, `queue`, `cron`). The Owner should not hunt `lead.form.created` next to a sheet-quota deferral.

### How Granot sits next to domain writes

A single `lead_created` receipt can produce **two cards** that should stay visually paired:

1. **Receipt card** — "Granot lead created · Top10 · 10:42"
2. **Outcome card** — "Form Lead created" **or** "Linked to existing Form Lead" **or** "Observing only"

Counts increment independently (webhook count vs Lead count). The feed groups them by `receipt_id` / Observation so the Owner sees cause then effect, not a flat mix.

---

## 6. Metric catalog — what the strip shows

Headline tiles (always visible, live):

| Tile | Definition | vs yesterday |
| --- | --- | --- |
| Leads today | Non-duplicate Form Leads + non-duplicate Call Leads created on the NY day | Absolute and % |
| Form / Call split | Same, by Lead kind | Each vs yesterday |
| Bookings today | Official Booking writes today (any path) | Absolute and % |
| Cancellations today | Official Cancellation writes today | Absolute and % |
| Texts sent | Lead Messages in `accepted` \| `sent` \| `delivered` | Absolute and % |
| Granot receipts | Webhook-channel receipts today, by class | Each class vs yesterday |
| Intakes opened | Granot Booking Reconciliation Cases opened today | Absolute |

Breakdown panels (second row / drawer):

| Slice | Values |
| --- | --- |
| Ingestion Origin | `wordpress_form`, `ringcentral`, `granot_lead_created`, `best_relocation_sheet`, `vantage_admin` |
| Source Company | Registry companies, zeros included so a silent partner is visible |
| Form vs Call inside each company | Lead Channel |
| Duplicates | Form duplicates and Call duplicates, **excluded from the headline Lead tile** |
| Webhook classes | `lead_created`, `priority_updated`, `booking_status_changed` |
| Booking actions | Booked vs Release (subset of `booking_status_changed`) |
| Booking kinds | Confirm Granot, employee linked, employee pending, Admin, leadless, referral |
| Text outcomes | successful / skipped (duplicate or no consent) / failed |
| Mint vs link vs observe | From Synchronization Decisions on `lead_created` only |

**Pace, not just totals.** For each headline tile, also show **yesterday at this same New York hour**. "14 leads by 2pm vs 11 by 2pm yesterday" is the useful comparison. End-of-day yesterday vs a half-finished today always looks like a miss.

**Session deltas.** While the page is open, tiles flash `+1` when a count increments. That is the "progress and metric changes" feel. It is derived from the poll cursor, not a third store.

**Do not put lead cost, binder, or deposit on this board in v1.** Those are Analytics. Daily Operations is volume, mix, and work.

---

## 7. How to maintain running counts

There is no daily business-count collection today. Analytics recomputes with `$aggregate` / `countDocuments`. Granot Health recomputes from Mongo. Process-local maps die per Vercel isolate. `$inc` is used for leases, incidents, and rate limits — not "bookings today."

Daily Operations needs something Analytics does not: **sub-second-feeling totals that do not rescan four collections on every poll.**

### 7.1 Hybrid: increment a day document, repair from source

**System of record for the business facts stays the domain collections** (`form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `lead_messages`, `granot_webhook_receipts`, Granot cases). Mongo remains authoritative (ADR-0001).

**System of record for the *day board* is a projection:**

```
daily_operations_days
  day: "2026-09-06"          // America/New_York
  timezone: "America/New_York"
  status: "open" | "closed"
  closed_at: Date | null
  leads: { total, form, call, duplicate_form, duplicate_call }
  origins: { wordpress_form, ringcentral, granot_lead_created, best_relocation_sheet, vantage_admin }
  companies: [{ source_company, form, call, total }]
  webhooks: { lead_created, priority_updated, booking_status_changed, booked, release }
  decisions: { minted, linked, observed, pending_match, unmatched }
  messages: { successful, skipped, failed }
  bookings: { total, granot_confirm, employee_linked, employee_pending, admin, leadless, referral }
  cancellations: { total }
  intakes: { opened, refreshed }
  hourly: [{ hour: 0-23, leads, bookings, cancellations, webhooks, messages }]
  revision: number
```

On every **counted fact** (same transaction or immediately after the domain commit):

1. Append a **Daily Operations Event** (the feed row).
2. `$inc` the matching paths on today's `daily_operations_days` document, including `hourly[currentNyHour]`.

Yesterday's document is **closed** by a cron a few minutes after New York midnight. After `status: "closed"`, writers must not increment it. Late facts (a Sheet Sync finalize that straddles midnight, a Twilio status after 12:05) land on the **open** day of the event time, or on a small `late[]` bag if we decide they belong to the closed day. Default: event time wins; do not reopen yesterday.

Day-over-day reads:

```
today = open document (or rebuild if missing)
yesterday = closed document
pace = today.hourly[0..now] vs yesterday.hourly[0..now]
```

### 7.2 Why not query-only?

Query-only works at today's volume (hundreds of leads, not millions). It is the correct **repair path** and the correct **source of truth check**. It is a poor live path because the board needs:

- One payload with ~15 tiles, company breakdown, origin breakdown, hourly pace, and a cursor of events.
- A poll every few seconds while the Owner watches.
- Stable yesterday totals after midnight.

Re-aggregating `form_leads` + `call_leads` + receipts + messages + bookings + cancellations + cases on that cadence will get expensive the moment we add company × origin × hour.

### 7.3 Why not increment `operational_events` and group those?

Operational Events are a **best-effort observability log**. They do not throw, they can be disabled, they mix debug/info/warn, and they are not a closed business catalog. Counting `lead.form.created` from that collection would silently undercount when observability is off, and would double-count if a path emits twice.

Use Operational Events for Observational. Use Daily Operations Events for the board.

### 7.4 Why not a second SSE of counters?

Vercel isolates do not share memory. Live Events already works by **polling Mongo from the SSE handler**. A counter SSE would be the same poll with a different payload. Prefer **one HTTP poll that returns metrics + events since cursor**. Simpler BFF, simpler auth, one watermark.

Live Events SSE stays. Daily Operations polls.

### 7.5 Increment points (writers)

Hook **after successful domain commit**, never in the webhook 202 path (capture is not an outcome).

| Writer | Increments |
| --- | --- |
| Form Lead create command | leads.form or duplicate_form; origin; company; hourly |
| Call Lead ingest / admin create | leads.call or duplicate_call; origin; company; hourly |
| Granot processor Decision | webhooks.*; decisions.*; intakes.opened if a case opened |
| Lead Message status → successful / failed / skipped | messages.* |
| Booking create (all official paths) | bookings.* |
| Cancellation create | cancellations.total |
| Best Relocation apply | same Lead / Booking increments, origin `best_relocation_sheet` |

Idempotency: the Daily Operations Event has a stable `dedupe_key` (e.g. `form_lead:<id>:created`, `receipt:<id>:captured`, `booking:<id>:created`). The increment runs once per key (`$addToSet` of keys on the day doc, or a unique index on the event collection + increment only on insert).

### 7.6 Repair

`GET` of today's board, if `revision` looks stale or the document is missing, may **rebuild from domain collections for that NY day** and replace the open document. Rebuild is also a Owner-hidden admin action and a cron every N minutes as a safety net.

Closed days are not rebuilt unless we explicitly reopen for a backfill. That keeps yesterday's comparison stable.

### 7.7 What we do not increment

- Sheet Sync job counts as headline KPIs (progress only; jobs retry).
- Unmatched Call Leads (`created_on_unmatched`) — excluded from Call Lead volume, same as Analytics / sheet reporting.
- Adopt-only Best Relocation rows that did not create a Lead.
- Duplicate webhook deliveries that did not produce a new receipt outcome we already counted (receipts themselves are not idempotent today; count **receipts stored**, not payload SHA).

---

## 8. Daily Operations Events (the stream)

New collection, Owner-facing, closed catalog.

```
daily_operations_events
  event_id
  day                              // NY calendar
  occurred_at
  lane                             // granot | lead | text | intake | booking | cancellation | sheet_sync | exception
  kind                             // closed enum, see below
  title                            // Owner sentence
  source_company                   // slug or null
  ingestion_origin                 // when a Lead was written
  lead_kind                        // form | call | null
  job_no                           // when known
  entity                           // { type, id }
  links                            // { lead, booking, intake, receipt, job_timeline }
  parent_receipt_id                // pair outcome cards to Granot
  dedupe_key
  metric_touches                   // which day-doc paths this increment hit
```

Closed `kind` values (v1):

```
form_lead.created
form_lead.duplicate
call_lead.created
call_lead.duplicate
granot.lead_created
granot.priority_updated
granot.booked
granot.release
granot.minted
granot.linked
granot.observed
granot.pending_match
intake.opened
intake.refreshed
text.sent
text.skipped
text.failed
booking.created
booking.employee_pending
cancellation.created
sheet_sync.completed
sheet_sync.failed
exception.zip_missing
exception.crm_failed
exception.dead_letter
exception.adoption_conflict
```

This catalog is **smaller than Operational Events on purpose**. If a fact is not in this list, it does not appear on the board.

---

## 9. Server shape

New module: `src/services/dailyOperations/`  
New routes (Owner-only, same gate as Live Events / Intakes):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/daily-operations` | Day snapshot: tiles, breakdowns, pace vs yesterday |
| `GET` | `/api/v1/admin/daily-operations/events` | Cursor poll: `?since=&lane=&limit=` |
| `GET` | `/api/v1/admin/daily-operations/companies` | Source Company table for the day |
| `POST` | `/api/v1/admin/daily-operations/rebuild` | Owner-hidden / ops: rebuild open day from SoR |

`GET /daily-operations` response sketch:

```json
{
  "timezone": "America/New_York",
  "today": "2026-09-06",
  "yesterday": "2026-09-05",
  "generated_at": "...",
  "metrics": {
    "leads": { "today": 42, "yesterday": 38, "yesterday_by_now": 31, "form": 28, "call": 14 },
    "bookings": { "today": 6, "yesterday": 5, "yesterday_by_now": 4 },
    "cancellations": { "today": 1, "yesterday": 0, "yesterday_by_now": 0 },
    "texts": { "today": 19, "yesterday": 22, "yesterday_by_now": 18 },
    "webhooks": {
      "lead_created": { "today": 55, "yesterday": 49 },
      "priority_updated": { "today": 120, "yesterday": 101 },
      "booking_status_changed": { "today": 8, "yesterday": 7 },
      "booked": { "today": 5, "yesterday": 4 },
      "release": { "today": 3, "yesterday": 3 }
    }
  },
  "origins": { "granot_lead_created": 20, "ringcentral": 14, "wordpress_form": 0, "best_relocation_sheet": 6, "vantage_admin": 2 },
  "companies": [{ "source_company": "top10", "form": 12, "call": 5, "total": 17, "yesterday_total": 15 }],
  "hourly": { "today": [/* 24 */], "yesterday": [/* 24 */] }
}
```

`wordpress_form: 0` on a busy day is **correct and useful** while WordPress still posts to Granot. The volume will sit under `granot_lead_created` and the Granot `lead_created` webhook tile. When Landing Pages post to Vantage, that tile starts moving without a redesign.

**Cron:** close yesterday shortly after 00:00 America/New_York; optional rebuild of the open day every 5–10 minutes.

**Do not** put increment logic inside Analytics. Analytics stays read-only ranged reports. Daily Operations is a write-behind projection of today's facts.

**Do not** teach the Live Events SSE to emit Bookings or texts. Different window, different audience, different payload.

---

## 10. Admin Dashboard shape

### 10.1 Page

`app/(dashboard)/daily/page.tsx` — Owner-only.

Add `/daily` to the Today nav, `OWNER_ONLY_PAGE_PREFIXES`, dashboard-shell owner prefixes, and the proxy ACL (all methods Owner-only).

Reuse: `SidePanel`, `floridaTime`, `/api/proxy`, existing intake / job-timeline / lead hrefs. Do not fork a second drawer.

### 10.2 Layout (one workspace, three bands)

```
┌─────────────────────────────────────────────────────────────┐
│ Daily Operations          Today · America/New_York · Live   │
├─────────────────────────────────────────────────────────────┤
│ [42 Leads +4 vs yday] [28 Form / 14 Call] [6 Bookings]      │
│ [1 Cancel] [19 Texts] [55 lead_created · 8 status] [3 new   │
│  intakes]                                                    │
├─────────────────────────────────────────────────────────────┤
│ Origins          │ Source Companies                         │
│ Granot 20        │ Top10    17  ▓▓▓▓▓  +2                   │
│ RingCentral 14   │ TBM       9  ▓▓▓    −1                   │
│ Best Relo 6      │ Main Site 4  ▓▓     +1                   │
│ Admin 2          │ …                                        │
│ WordPress 0      │                                          │
├─────────────────────────────────────────────────────────────┤
│ Lanes: All Granot Leads Texts Intakes Bookings Cancels      │
│        [Quiet priorities]                                    │
│ ┌─ feed ──────────────────────────────────────────────────┐ │
│ │ 2:14  Booked · Job 4412 · opens intake          [Open]  │ │
│ │ 2:13  Call Lead · Top10 Inbounds · RingCentral          │ │
│ │ 2:12  Text sent · Form Lead …                           │ │
│ │ 2:11  lead_created → minted Form Lead · Best Relo       │ │
│ │ 2:10  priority_updated · linked, already current        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The top band is **metrics**. The middle band is **aggregates**. The bottom band is **the categorized stream**. Clicking a company filters the feed and highlights that row. Clicking a tile (Texts, Booked) sets the lane.

A SidePanel on `?open=lead:<id>` / `intake:<id>` / `booking:<id>` / `receipt:<id>` shows the same facts the desks already know. Confirm Granot Booking stays on `/intakes`. Daily Operations does not become a second intake workbench.

### 10.3 Transport on the client

One hook, `useDailyOperations()`, polls:

1. Metrics snapshot every ~5s (or immediately after an events page that included `metric_touches`).
2. Events `?since=cursor` every ~3s.

No `EventSource` on `/daily`. The existing Live Events BFF stays the only SSE.

When the tab is hidden, back off the poll. When it resumes, fetch the snapshot once and catch up the cursor.

### 10.4 Relationship to Live Events

| | Live Events | Daily Operations |
| --- | --- | --- |
| Window | Last 30 minutes | New York calendar day |
| Payload | Granot receipt + raw JSON | Owner card + outcome |
| Filters | None | Lanes + company + origin |
| Counts | None | Running + vs yesterday + pace |
| Non-Granot | No | Yes |
| Deep work | Intake / job links | Same links, plus lead / booking |

A small "Open in Live Events" action on a Granot card is enough. Do not embed the raw accordion on `/daily`.

---

## 11. What "progress" looks like

Besides tiles incrementing:

- **Intake lane** is the work pulse: Booked / Release → case opened → later (on another desk) Confirm. Show "3 intakes opened today, 2 still open" by reading the existing open-case list (same query Overview already uses). That is a **query**, not an increment — open/closed is live state, not a day counter.
- **Text lane** shows pending → sent. A pending message is progress; only terminal success/fail increments the tile.
- **Sheet Sync** (opt-in lane) shows "Forms row written" as a trailing check on a Lead card, not a separate headline.
- **Hourly sparkline** under Leads and Bookings: today vs yesterday, same hours.

---

## 12. Phasing

### Slice 1 — Board that tells the truth about today

- `daily_operations_days` + `daily_operations_events`
- Increment on Form Lead create, Call Lead create, Granot receipt+decision, Lead Message success, Booking create, Cancellation create
- `GET` snapshot + events cursor
- `/daily` with headline tiles, origin + company breakdowns, one feed, lane chips
- Yesterday totals (query-built for the first week if no closed doc yet)

### Slice 2 — Pace and Granot nuance

- Hourly buckets + yesterday-by-now
- Mint / link / observe on `lead_created` cards
- Booked vs Release chips
- Quiet-priorities control
- Intake opened count + "still open" query
- Close-of-day cron

### Slice 3 — Progress polish

- Pair receipt + outcome cards
- Session `+1` flashes
- Sheet Sync opt-in lane
- Exception lane
- Rebuild cron + `dedupe_key` hardening

### Out of v1

- Lead cost / binder / deposit
- Conversations
- A second SSE
- Changing WordPress to post to Vantage (the board will light `wordpress_form` when that happens)
- Replacing Live Events, Overview, or Analytics

---

## 13. Decisions to lock before implementation

1. **`/daily` is a new Owner page**, not a tab on Live Events, Overview, or Observational.
2. **One Granot stream, categorized.** No per-class live space.
3. **Counts increment a day projection; domain collections remain SoR.** Repair by rebuild.
4. **Today is America/New_York.** Pace compares hourly, not raw end-of-day vs in-progress.
5. **Headline Leads exclude duplicates and Unmatched Call Leads.** Duplicates get their own chip.
6. **Bookings and Cancellations count write-time, not `book_date` / `cancel_date`.**
7. **Webhook counts are receipts; Lead counts are Lead writes.** Both appear. `wordpress_form` may be zero while WordPress posts to Granot.
8. **Daily Operations Events are a closed Owner catalog.** Operational Events stay in Observational.

---

## 14. Why this will shine

The desks we already have are either **raw** (Live Events), **historical** (Analytics), **healthy** (Observational), or **durable** (record lists). None of them say, at 2:14pm:

> 42 leads today — 4 ahead of yesterday at this hour. 28 form / 14 call. Twenty of the leads were minted from Granot `lead_created` (WordPress never hit us). Fourteen came from RingCentral. Six from Best Relocation. Nineteen texts landed. Eight booking-status webhooks, five of them Booked, three new intakes still waiting. Six Bookings written. One Cancellation.

That sentence is the product. The feed is how the Owner trusts the sentence. The day document is how the sentence stays fast and comparable tomorrow.
