# Daily Operations — pre-specification

**Status:** pre-specification (implementation-ready intent, not yet coded)  
**Date:** 2026-09-06  
**Surfaces:** `vantage-main-server` + `vantage-admin`  
**Package manager:** `pnpm@10.13.1` on the main server  
**Glossary:** workspace-root [`CONTEXT.md`](../../../CONTEXT.md)

This is the working contract for **Daily Operations**. The orientation memo [`daily-operations-workspace.md`](daily-operations-workspace.md) is background only.

Use glossary words. Do not invent synonyms. In particular:

| Say | Do not say |
| --- | --- |
| Daily Operations | Daily View, Owner Daily, ODR |
| Daily Operations Event | Operational Event (that is Observational) |
| Granot Observation Receipt | webhook event (unqualified) |
| Lead Message | SMS (except when naming Twilio) |
| Source Company / Source Granularity | partner, advertiser |
| Ingestion Origin | request source, client-supplied origin |
| Granot Booking Reconciliation Case | intake ticket, Granot intake case |

---

## 1. What the Owner gets

Daily Operations is the Owner's **business-day board** at Admin `/daily`.

It answers, continuously, in `America/New_York`:

1. What just happened, in lanes the Owner already thinks in.
2. How today's counts are moving.
3. Whether we are ahead of or behind **yesterday at this same hour**.
4. Where volume came from (Form vs Call, Ingestion Origin, Source Company).

It does **not** replace:

| Desk | Stays |
| --- | --- |
| Overview (`/`) | Week pulse, all-time, short Waiting-for-you band |
| Live Events (`/live-events`) | Raw Granot receipt firehose, last 30 minutes, full payload |
| Analytics (`/analytics`) | Historical ranged business reports |
| Workflow Observational (`/observational`) | Server / integration health |
| Intakes (`/intakes`) | Confirm Granot Booking work queue |

Daily Operations **links into** intakes, leads, bookings, job timeline, and Live Events. It does not embed Confirm Granot Booking.

---

## 2. Product surfaces

### 2.1 Admin route and chrome

- **Route:** Owner-only `/daily`
- **Nav:** Today group, after Overview, before Live Events
- **Label:** Daily Operations
- **Auth:** add `/daily` to `OWNER_ONLY_PAGE_PREFIXES`, `dashboard-shell` owner prefixes, and `dashboard-nav.tsx` (`ownerOnly: true`)
- **Proxy:** `/api/v1/admin/daily-operations` Owner-only on every method (same dual gate as Live Events / conversations)
- **URL:** `/daily?lane=<lane>&company=<slug>&open=<kind>:<id>`
- **Timezone display:** `America/New_York` via existing `lib/floridaTime.ts`

### 2.2 Layout — three bands, one workspace

```
┌─────────────────────────────────────────────────────────────┐
│ Daily Operations     Today · America/New_York · Live / Tail │
├─────────────────────────────────────────────────────────────┤
│ Headline tiles (running counts + vs yesterday + pace)       │
├─────────────────────────────────────────────────────────────┤
│ Origins panel          │ Source Company table               │
├─────────────────────────────────────────────────────────────┤
│ Lane chips · Quiet priorities · company filter              │
│ Categorized activity feed (SSE cards)                       │
└─────────────────────────────────────────────────────────────┘
```

Clicking a tile sets the lane. Clicking a company filters the feed and highlights that row. `?open=` opens the existing `SidePanel` (extend width if needed; do not fork). Confirm work stays on `/intakes?case=`.

### 2.3 Headline tiles

| Tile | Counts | Excludes |
| --- | --- | --- |
| Leads today | Non-duplicate Form Leads + non-duplicate Call Leads created on the NY day | Duplicate Leads; Unmatched Call Leads (`created_on_unmatched`) |
| Form / Call split | Same, by Lead kind | Same |
| Duplicates | Duplicate Form + Duplicate Call created today | Not in the headline Lead tile |
| Bookings today | Official Booking **writes** today | Duplicate submission ignored; `book_date` is display only |
| Cancellations today | Official Cancellation **writes** today | `cancel_date` is display only |
| Texts sent | Lead Messages in `accepted` \| `sent` \| `delivered` | Pending / queued; skipped; failed (failed has its own chip) |
| Granot receipts | Webhook-channel receipts captured today | Extension / HTTP-automation receipts |
| Intakes opened | Granot Booking Reconciliation Cases **opened** today | Refreshes (shown as feed, optional secondary) |

Each headline tile shows:

- `today`
- `yesterday` (closed day document)
- `yesterday_by_now` (sum of yesterday hourly buckets `0..currentNyHour`)
- Session delta (`+1` while the page is open), derived from SSE `metric_touches`

**v1 does not show** lead cost, binder, or deposit. Those stay on Analytics.

### 2.4 Breakdowns

**Ingestion Origin** (Lead writes only):

`wordpress_form` | `ringcentral` | `granot_lead_created` | `best_relocation_sheet` | `vantage_admin`

`wordpress_form` may be **zero** while partner WordPress posts to Granot. That is correct and useful. Volume then sits under `granot_lead_created` and the `lead_created` webhook tile.

**Source Company:** every catalog slug from `SOURCE_COMPANIES` (`tbm_leads`, `tbm_prime_leads`, `top10_leads`, `best_relocation_leads`, `get_movers_leads`, `main_site`, `paid_overflow`, `not_provided`). Zeros remain so a silent partner is visible. Form / Call split inside each company.

**Webhook classes:** `lead_created`, `priority_updated`, `booking_status_changed`, plus Booked vs Release.

**Mint / link / observe:** Synchronization Decision outcomes on `lead_created` only (`granot.minted` / `granot.linked` / `granot.observed` / `granot.pending_match`). Not a stored Registry enum — derived from `lead_created_policy` + Decision outcome.

**Booking kinds:** `granot_confirm` | `employee_linked` | `employee_pending` | `admin` | `leadless` | `referral`

**Text outcomes:** `successful` | `skipped` | `failed`

### 2.5 Lanes (one feed, not one socket per type)

Granot webhooks stay **one stream**. Do not open a live space per `lead_created` / `priority_updated` / `booking_status_changed`.

| Lane | Default | Contents |
| --- | --- | --- |
| `all` | On | Everything below |
| `granot` | On | Receipt cards + mint/link/observe outcomes |
| `lead` | On | Form / Call created or duplicate |
| `text` | On | Lead Message terminal outcomes |
| `intake` | On | Case opened / refreshed |
| `booking` | On | Official Booking writes |
| `cancellation` | On | Official Cancellation writes |
| `sheet_sync` | Off | Job completed / failed |
| `exception` | On | Zip miss, CRM fail, dead letter, adoption conflict |

Granot chips inside the Granot lane: Lead created · Priority updated · Booked · Release.

**Quiet priorities:** Owner control that hides `granot.priority_updated` cards. Counts still include them. This is the pressure valve for high-volume, low-action Priority Updates.

A `lead_created` receipt and its processor outcome are **paired** by `parent_receipt_id`. The UI groups them (receipt, then minted / linked / observed).

### 2.6 Card actions

| Card | Actions |
| --- | --- |
| Form / Call Lead | Open lead SidePanel; open record list `?record=` |
| Granot receipt | Open payload SidePanel; “Open in Live Events” |
| Booked / Release | Open `/intakes?case=` when `intake_link` exists |
| Job Number present | Open `/job-timeline?job=` |
| Booking / Cancellation | Open record SidePanel |

No mutations from Daily Operations reads.

---

## 3. Calendar

**Today is the America/New_York business day.**

Helpers already in `src/utils/easternTime.ts`:

| Need | Helper |
| --- | --- |
| Day key `"YYYY-MM-DD"` from an instant | `floridaCalendarDateInputValue(now)` |
| UTC-midnight Date of that NY day | `floridaCalendarToday(now)` |
| Hour 0–23 in Eastern | `easternDateTimeParts(now).hour` |

Rules:

| Fact | Binds on |
| --- | --- |
| Form / Call Lead | Lead `timestamp` (already Eastern wall-clock) |
| Granot receipt | `captured_at` |
| Lead Message | Time the terminal status was applied |
| Booking / Cancellation on this board | **Write time** (`createdAt` / command `now`), not `book_date` / `cancel_date` |
| Intake opened | Case `createdAt` |
| Day document key | NY calendar of `occurred_at` |

Yesterday comparison uses the **closed** previous NY day. After New York midnight, a cron sets `status: "closed"` and writers must not `$inc` it. Late facts land on the open day of their `occurred_at`.

Pace: `sum(today.hourly[0..nowHour])` vs `sum(yesterday.hourly[0..nowHour])`.

Live Events remains a rolling 30-minute window. Daily Operations is a **calendar day**.

---

## 4. Architecture

MongoDB remains the system of record (ADR-0001). Redis is a **doorbell and short replay buffer**, not the book.

```
Domain commit (Lead / receipt / Booking / …)
        │
        ▼
 recordDailyOperationsFact()     ← after-commit only, never throws
        │
        ├─ insert Daily Operations Event (unique dedupe_key)
        ├─ $inc Daily Operations Day (only if insert won)
        └─ Redis XADD (+ optional PUBLISH)   ← best-effort doorbell
                │
                ▼
 Owner EventSource ──BFF──► GET .../daily-operations/live
                │
                ├─ snapshot from Mongo (tiles + recent events)
                └─ tail Redis stream; on miss, tail Mongo
```

Vercel isolates do not share memory. The webhook handler cannot emit into the Owner socket. That is why Live Events already polls Mongo behind SSE. Daily Operations keeps the **browser** event-driven (`EventSource`) and uses Redis so the open SSE isolate notices a write without scanning four domain collections.

If Redis is unset, errors, or the test runner is active, the live route **degrades** to Mongo-tail of `daily_operations_events` (same pattern as `runLiveReceiptSse`). Counts still exist because they live in Mongo.

### 4.1 Why Redis is here

| Job | Store |
| --- | --- |
| Remember the fact | Mongo Daily Operations Event |
| Remember today's totals | Mongo Daily Operations Day |
| Wake the open SSE isolate | Upstash Redis Stream `XADD` |
| Catch up after reconnect | Mongo snapshot + `Last-Event-ID`; Redis stream is a short replay only |

Do **not** use Redis `INCR` as the Owner-visible total. Dual-write counters drift. `$inc` the Mongo day document; Redis only rings the bell.

Do **not** `GET` / `XREAD` Redis once per second as a substitute for domain queries if the stream is empty — that is the command-cost trap. `XREAD COUNT 25` on the day stream when idle is one cheap command per poll; that is acceptable (see §5.6). Do not `XREAD BLOCK` for the full `maxDuration` over REST.

---

## 5. Upstash Redis

### 5.1 Client

Install on **vantage-main-server** only (the doorbell publisher and the live tail):

```bash
pnpm add @upstash/redis
```

`Redis.fromEnv()` reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The Vercel Marketplace integration injects the **KV_*** names the Owner already placed in `.env`. Construct the client ourselves so both work.

`src/config/domain/dailyOperations.ts` (call-time env, same as Twilio / queues):

```ts
import { Redis } from "@upstash/redis";

export function getDailyOperationsRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}
```

| Variable | Use |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Canonical `@upstash/redis` names |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel Marketplace aliases (already in local `.env`) |
| `KV_REST_API_READ_ONLY_TOKEN` | Do not use for publish |
| `KV_URL` / `REDIS_URL` | TCP `rediss://`. **Do not use** with `@upstash/redis` on Vercel Functions |

Never log tokens. Never commit `.env`.

### 5.2 Publish gate

Mirror queue gates (`shouldPublishGranotLifecycleQueue`):

- Test runner / `TEST_MODE=true` → **no Redis writes**
- Missing URL/token → no Redis writes (Mongo-only)
- Production Vercel and local Owner watch → Redis writes allowed when configured

Local `pnpm dev:local` **should** publish if KV_* are set, so `/daily` in the Admin dashboard can prove the doorbell. That differs from Granot Queue (prod-only). Document it: Redis doorbell is safe on free tier; a Vercel Queue publish from a laptop is not.

### 5.3 Keys

Prefix every key with environment so local / preview / production never collide.

```
dailyops:{env}:stream:{day}     Redis Stream of wake envelopes
dailyops:{env}:wake             Pub/sub channel (optional, same payload)
```

`env` = `VERCEL_ENV` (`production` | `preview`) or `local`.  
`day` = `YYYY-MM-DD` America/New_York.

### 5.4 Stream envelope (small)

`XADD dailyops:{env}:stream:{day} MAXLEN ~ 2000 *`

| Field | Value |
| --- | --- |
| `event_id` | Daily Operations Event `_id` hex |
| `day` | `YYYY-MM-DD` |
| `kind` | closed catalog kind |
| `lane` | lane id |
| `occurred_at` | ISO |
| `dedupe_key` | stable key |

No contact PII on the Redis payload. The SSE isolate loads the full card from Mongo by `event_id`.

`MAXLEN ~ 2000` keeps a few hours of doorbells, not the business day archive. Mongo is the archive.

Optional: `PUBLISH dailyops:{env}:wake` with the same JSON. Classic Redis `SUBSCRIBE` is **not** available on the Upstash REST client. Do not build the live route on TCP subscribe. The Stream is the contract; PUBLISH is optional and unused in v1 unless we later pipe Upstash's HTTP `/subscribe` SSE.

### 5.5 Live isolate algorithm

Copy `runLiveReceiptSse` (`src/services/granotLifecycle/liveReceiptStream.ts`): inject `write`, `sleep`, `now`, `signal`; `maxMs = 240_000`; heartbeat 15s; abort on `req.close`.

1. Snapshot from Mongo: today's day document + last N events (default 80, NY day, lane filter from query is **not** applied server-side — filter on the client so one socket serves all chips).
2. Remember Redis stream ID `"0-0"` or the last `XADD` id stored on the newest event (`redis_stream_id` optional field) / `Last-Event-ID` decode.
3. Loop until max duration:
   - If Redis client exists: `XREAD COUNT 25 STREAMS dailyops:{env}:stream:{day} lastId`
   - For each envelope, `find` the Mongo event by `event_id` (skip if missing — replica lag: retry next loop)
   - Emit SSE `event` with `id: encodeDailyOpsEventId({ occurred_at, event_id })`
   - Emit SSE `metrics` when `metric_touches` is present (full tile payload from an in-memory copy updated by those touches, or a cheap day-doc `findById` at most once per wake batch)
   - If Redis is null or throws: `listDailyOperationsEventsAfter(cursor)` on Mongo (same `$or` captured_at / `_id` pattern as live receipts)
   - Heartbeat
   - `sleep(1000)`

`Last-Event-ID` format: `{occurred_at_iso}:{event_id}` using `lastIndexOf(":")` (ISO contains colons). Reconnect skips snapshot when the header is valid — same as Live Events.

### 5.6 Cost discipline (free tier)

Upstash free: 500,000 commands / month, 256 MB.

| Pattern | Commands if Owner watches 8 hours/day × 22 days |
| --- | --- |
| `XADD` once per counted fact (~2,000 facts/month) | ~2,000 |
| Live `XREAD COUNT` once per second while tab open | ~28,800 / month / tab |
| `GET` of four Mongo collections every second | Not a Redis cost; do not do this |
| `XREAD BLOCK 240000` over REST | Avoid |

Expected bill for this doorbell: **$0 on free tier**. The failure mode is turning Redis into a 1 Hz cache poll of large keys.

`KV_REST_API_READ_ONLY_TOKEN` is unused. Do not give the Admin BFF Redis credentials; the BFF only pipes SSE from the main server.

---

## 6. Mongo models

New module: `src/services/dailyOperations/`  
New models: `src/models/DailyOperationsEvent.ts`, `src/models/DailyOperationsDay.ts`

Follow the **observability factory** (`getObservabilityModel`): `useDb(getMongoDatabaseName())`, registration `Model__${collectionName}`, explicit collection name. Do **not** use the lead-model pattern (fixed collection, db switch only) if we want test collections isolated.

| Key | Production | Test |
| --- | --- | --- |
| events | `daily_operations_events` | `test_daily_operations_events` |
| days | `daily_operations_days` | `test_daily_operations_days` |

Mode: reuse `TEST_MODE` / test runner, same spirit as observability. Optional later: `DAILY_OPERATIONS_COLLECTION_PREFIX`.

### 6.1 Daily Operations Event

Closed Owner catalog. Not an Operational Event.

```ts
type DailyOperationsEventDocument = {
  _id: ObjectId;
  day: string;                    // YYYY-MM-DD America/New_York
  occurred_at: Date;
  lane:
    | "granot"
    | "lead"
    | "text"
    | "intake"
    | "booking"
    | "cancellation"
    | "sheet_sync"
    | "exception";
  kind: DailyOperationsKind;      // §7
  title: string;                  // Owner sentence
  source_company: string | null;  // slug
  ingestion_origin: string | null;
  lead_kind: "form" | "call" | null;
  job_no: string | null;
  entity_type: string | null;
  entity_id: string | null;
  parent_receipt_id: string | null;
  links: {
    lead_id?: string;
    lead_model?: "FormLead" | "CallLead";
    booking_id?: string;
    cancellation_id?: string;
    intake_case_id?: string;
    receipt_id?: string;
    message_id?: string;
  };
  metric_touches: string[];       // day-doc paths incremented, e.g. "leads.form"
  dedupe_key: string;             // unique
  redis_stream_id: string | null; // set after XADD if we want reconnect hints
  createdAt: Date;
  updatedAt: Date;
};
```

**Indexes:**

```
{ dedupe_key: 1 }                    unique
{ day: 1, occurred_at: -1, _id: -1 }
{ day: 1, lane: 1, occurred_at: -1 }
{ parent_receipt_id: 1, occurred_at: 1 }
{ entity_type: 1, entity_id: 1 }
```

PII on the card: `title` may include a first name the Owner already sees on desks. Do not store full Granot payloads. Do not copy `granot_statement`.

### 6.2 Daily Operations Day

One document per NY calendar day.

```ts
type DailyOperationsDayDocument = {
  _id: ObjectId;
  day: string;                      // unique YYYY-MM-DD
  timezone: "America/New_York";
  status: "open" | "closed";
  closed_at: Date | null;
  revision: number;

  leads: {
    total: number;                  // non-duplicate form + call, excluding unmatched
    form: number;
    call: number;
    duplicate_form: number;
    duplicate_call: number;
    unmatched_call: number;         // incremented but excluded from total
  };

  origins: {
    wordpress_form: number;
    ringcentral: number;
    granot_lead_created: number;
    best_relocation_sheet: number;
    vantage_admin: number;
  };

  companies: Record<string, { form: number; call: number; total: number }>;

  webhooks: {
    lead_created: number;
    priority_updated: number;
    booking_status_changed: number;
    booked: number;
    release: number;
  };

  decisions: {
    minted: number;
    linked: number;
    observed: number;
    pending_match: number;
    unmatched: number;
  };

  messages: {
    successful: number;
    skipped: number;
    failed: number;
  };

  bookings: {
    total: number;
    granot_confirm: number;
    employee_linked: number;
    employee_pending: number;
    admin: number;
    leadless: number;
    referral: number;
  };

  cancellations: { total: number };

  intakes: { opened: number; refreshed: number };

  hourly: Array<{
    hour: number;                   // 0–23
    leads: number;
    bookings: number;
    cancellations: number;
    webhooks: number;
    messages: number;
  }>;

  createdAt: Date;
  updatedAt: Date;
};
```

**Indexes:** `{ day: 1 }` unique. `{ status: 1, day: -1 }`.

`hourly` is a 24-element array, pre-seeded on first upsert of the day (`hour: 0..23`, zeros). Increment with:

```
$inc: {
  "leads.form": 1,
  "leads.total": 1,
  "origins.ringcentral": 1,
  "companies.top10_leads.form": 1,
  "companies.top10_leads.total": 1,
  "hourly.14.leads": 1,            // 14 === current NY hour
  revision: 1,
}
```

`companies.<slug>.*` dynamic paths are valid Mongo. Seed known slugs on first insert so the GET payload always includes zeros.

Closed days: cron `POST` / internal `closeDailyOperationsDay(yesterday)` shortly after 00:05 America/New_York. `updateOne({ day, status: "open" }, { $set: { status: "closed", closed_at } })`. Writers check `status !== "closed"`; if closed, they **do not increment** (event still inserts if `occurred_at` maps to that day — rare race at midnight). Prefer: compute `day` from `occurred_at`; if that day's doc is closed, skip `$inc` and set `metric_touches: []` (feed still shows the late card; tiles stay stable).

### 6.3 Writer: `recordDailyOperationsFact`

`src/services/dailyOperations/recordDailyOperationsFact.ts`

Behavior copied from `recordOperationalEvent`: **awaited after commit, never throws, never changes the domain write.**

```
1. Build dedupe_key and day from occurred_at
2. insertOne event
   - duplicate key → return (no increment, no Redis)
3. upsert + $inc the open day document for those metric_touches
4. best-effort Redis XADD; store redis_stream_id if we want
5. log Redis failures via pino; do not emit Operational Incidents for doorbell misses
```

Callers pass a typed input (`kind`, identities, `metric_touches`). They do not talk to Redis themselves.

---

## 7. Closed kind catalog

| kind | lane | Headline increment |
| --- | --- | --- |
| `form_lead.created` | lead | `leads.form`, `leads.total`, origin, company.form, hourly.leads |
| `form_lead.duplicate` | lead | `leads.duplicate_form` only |
| `call_lead.created` | lead | `leads.call`, `leads.total`, origin, company.call, hourly.leads |
| `call_lead.duplicate` | lead | `leads.duplicate_call` only |
| `call_lead.unmatched` | lead | `leads.unmatched_call` only (not in headline) |
| `granot.lead_created` | granot | `webhooks.lead_created`, hourly.webhooks |
| `granot.priority_updated` | granot | `webhooks.priority_updated`, hourly.webhooks |
| `granot.booked` | granot | `webhooks.booking_status_changed`, `webhooks.booked`, hourly.webhooks |
| `granot.release` | granot | `webhooks.booking_status_changed`, `webhooks.release`, hourly.webhooks |
| `granot.minted` | granot | `decisions.minted` — **and** the Lead create kinds fire from the create finalize, not here, to avoid double-counting Leads |
| `granot.linked` | granot | `decisions.linked` |
| `granot.observed` | granot | `decisions.observed` |
| `granot.pending_match` | granot | `decisions.pending_match` |
| `granot.unmatched` | granot | `decisions.unmatched` |
| `intake.opened` | intake | `intakes.opened` |
| `intake.refreshed` | intake | `intakes.refreshed` |
| `text.sent` | text | `messages.successful`, hourly.messages |
| `text.skipped` | text | `messages.skipped` |
| `text.failed` | text | `messages.failed` |
| `booking.created` | booking | `bookings.total` + kind bucket, hourly.bookings |
| `booking.employee_pending` | booking | `bookings.total`, `bookings.employee_pending`, hourly.bookings |
| `cancellation.created` | cancellation | `cancellations.total`, hourly.cancellations |
| `sheet_sync.completed` | sheet_sync | none (progress only) |
| `sheet_sync.failed` | sheet_sync | none |
| `exception.zip_missing` | exception | none |
| `exception.crm_failed` | exception | none |
| `exception.dead_letter` | exception | none |
| `exception.adoption_conflict` | exception | none |

**Granot mint vs Lead create:** a `create_if_missing` Decision writes a Lead through `createLeadFromGranot` `finalize`. That finalize records `form_lead.created` or `call_lead.created` with `ingestion_origin: granot_lead_created`. The processor also records `granot.minted` (decision count only). Do **not** increment `leads.*` from `granot.minted`.

**Receipt vs outcome:** capture records `granot.lead_created` (receipt count). Processor records `granot.minted|linked|observed|…` (decision count). Two cards, two increments, paired by `parent_receipt_id`.

---

## 8. Dedupe keys

Unique on `daily_operations_events.dedupe_key`. Insert-win is the increment gate.

| Fact | `dedupe_key` |
| --- | --- |
| Form Lead create | `form_lead:<leadId>:created` or `:duplicate` |
| Call Lead create | `call_lead:<leadId>:created` or `:duplicate` or `:unmatched` |
| Granot receipt | `receipt:<receiptId>:<route_event_class>[:booked\|release]` |
| Granot decision | `decision:<decisionId>:<kind>` |
| Intake | `intake:<caseId>:opened` or `:refreshed:<revision>` |
| Lead Message | `message:<messageId>:<accepted\|sent\|delivered\|skipped\|failed>` — first successful status wins `text.sent` (do not increment again from accepted → sent → delivered) |
| Booking | `booking:<bookingId>:created` |
| Cancellation | `cancellation:<cancellationId>:created` |
| Sheet Sync | `sheet_sync:<jobId>:<completed\|failed>` |
| Exception | `exception:<stable fingerprint>` |

Lead Message: increment `messages.successful` **once** on the first transition into `{accepted, sent, delivered}`. Later Twilio callbacks must not create a second `text.sent` (same `dedupe_key` family: use `message:<id>:successful`).

WordPress receipt reuse (`reusedExistingLead: true`) must **not** call the writer.

Canonical command **replay** (`replayed === true`) must **not** call the writer.

Employee / Admin duplicate submission (`booking.duplicate_submission_ignored`) must **not** call the writer.

---

## 9. Hook points (after commit only)

Never inside `operation()` / `withTransaction`. Never on Granot HTTP 202 for Lead / Booking / Decision counts. Same seam as today's `recordOperationalEvent`.

### 9.1 Form Lead

| Function | File | When |
| --- | --- | --- |
| `completeFormLeadIngestion` | `src/services/leads/formLead.service.ts` | After reused-lead early return; next to `recordWhatTheOwnerNeedsToKnow` |

Identity: `lead._id`, `source_company`, `duplicate`, `ingestion_origin` on the lead, name/phone. No `job_no` on WordPress create.

`runExistingCreateFormLead` finalize already calls `completeFormLeadIngestion` (`existingWrites.ts`). One hook covers HTTP, Admin Manual, and Best Relocation apply.

Zip miss / CRM fail: existing events in complete / CRM service → `exception.*` (optional v1).

### 9.2 Call Lead

| Function | File | When |
| --- | --- | --- |
| `completeCallLeadIngestion` | `src/services/leads/callLead.service.ts` | After commit; covers Admin, Best Relocation, and RingCentral's inner complete |

RingCentral also emits `ringcentral.call_lead.created` / `.duplicate_created` in `ingestRingCentralQualifiedCall`. Increment **once** inside `completeCallLeadIngestion`.

Adoption (`lead_adopted`) is not a create. Shadow / dry-run are not domain writes. Adoption conflict → `exception.adoption_conflict` from the ingest recorder.

Unmatched Call Lead (`created_on_unmatched`): kind `call_lead.unmatched`, not headline.

### 9.3 Granot receipt (202) — receipts only

| Function | File | When |
| --- | --- | --- |
| `captureGranotLifecycleWebhookReceipt` | `src/services/granotLifecycle/capture.ts` | After persist (`create`), before 202 |

Available: `receipt_id`, `route_event_class`, `captured_at`. No Source Company yet. Title can say “Granot lead created” from the route class. Booking action (Booked / Release) is **not** known until normalization — if the raw payload already has the action at capture, classify `granot.booked` / `granot.release`; otherwise emit `granot.booked` / `granot.release` from the processor once normalized and **do not double-count** `booking_status_changed` (capture increments `webhooks.booking_status_changed` only; processor increments `booked` / `release`).

**Locked rule:** capture increments `webhooks.lead_created` | `priority_updated` | `booking_status_changed`. Processor increments `webhooks.booked` / `webhooks.release` and decision / intake kinds. One `booking_status_changed` receipt is one class count at capture plus one Booked or Release count at process.

Do not hook `captureChannelOperationReceipt` (extension / automation) for this board.

### 9.4 Granot Decision / mint / link

| Function | File | When |
| --- | --- | --- |
| `createLeadFromGranot` `finalize` | `src/services/granotLifecycle/createLeadFromGranot.ts` | After commit — Lead id, `source_company`, `ingestion_origin: granot_lead_created`, `job_no` on the lead |
| `synchronizeLeadFromGranot` return | `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` | After `executeCanonicalCommandWithPostCommit`; `pending` today is `{ leadModel, leadId }` only — **extend `pending`** with outcome + provenance (`source_receipt_id`, `decision_id`, `job_no`) so the writer has them |
| `logProcessingCompletion` | `src/services/granotLifecycle/processor.ts` | After commit — receipt / observation / decision / outcome. Use for `granot.observed` / `pending_match` / `unmatched` when no lead finalize ran |

Prefer command `finalize` when a Lead was written. Use `logProcessingCompletion` for observe-only / pending / unmatched.

### 9.5 Granot booking case

| Function | File | When |
| --- | --- | --- |
| `reconcilePreparedObservation` | `src/services/granotLifecycle/bookingReconciliation.ts` | After the transaction, next to `granot_lifecycle.booking_case.opened` / `.refreshed` |

Identity: `case_id`, `observation_id`, `decision_id`. Reload case for `normalized_job_no`. No Booking id until Confirm.

### 9.6 Lead Message

| Function | File | When |
| --- | --- | --- |
| `dispatchPersistedLeadMessage` | `src/services/leadMessaging/leadMessaging.service.ts` | Next to `lead_message.accepted` |
| `recordStatusCallbackEvent` | same | When `applied === true` and status is terminal; dedupe as `message:<id>:successful` or `:failed` |
| `dispatchOrQueuePersistedLeadMessage` | same | After-commit skipped path (no Operational Event today) — emit `text.skipped` |

Do not hook `persistLeadMessageIntent` (mid-transaction).

### 9.7 Booking

| Function | File | When |
| --- | --- | --- |
| `finalizeBookedLeadCreateAfterCommit` | `src/services/bookings/bookedLead.service.ts` | After populate; skip `kind === "duplicate"` |
| `submitEmployeeBooking` | `src/services/employeeBookings/submitEmployeeBooking.service.ts` | After `finalizeSheetSync`; `created_linked` → `booking.created` / `employee_linked`; `created_pending` → `booking.employee_pending` |
| `confirmBooking` | `src/services/granotLifecycle/bookingConfirmation.ts` | After `finalizeSheetSync` when `outcome === "booking_created"`; skip `replayed` |
| `runExistingCreateReferralBooking` finalize | `existingWrites.ts` | `booking.created` + `referral` |
| `runExistingCreateLeadlessBooking` finalize | `existingWrites.ts` | `booking.created` + `leadless` (no `booking.created` Operational Event today — Daily Operations still counts it) |

Admin `createBookedLead` / `from-source` share `finalizeBookedLeadCreateAfterCommit` → kind `admin`.

Best Relocation apply **must not** hook `applyBestRelocationPlan`. It already runs these commands (`ingestion_origin` / provenance `external_sheet_ingestion`). Hooking apply would double-count.

### 9.8 Cancellation

| Function | File | When |
| --- | --- | --- |
| `runExistingCreateCancellation` finalize | `src/services/domainCommands/existingWrites.ts` | `pending` has `cancellation`, `booking`, `job`. Live API path does **not** emit `cancellation.created` today — Daily Operations is the place that records the Owner fact. |
| `confirmCancellation` | `src/services/granotLifecycle/bookingOwnerCommands.ts` | After `finalizeSheetSync` when `cancellation_created`; skip replay |

### 9.9 Sheet Sync (opt-in lane, v1 optional)

| Function | File | When |
| --- | --- | --- |
| Drain completion | `src/services/sheetSync/drainer/runSheetSyncDrain.ts` | After run update — `sheet_sync.completed` / `.failed` |

Do **not** hook `finalizeSheetSync` (queue wakeup, not job done).

### 9.10 Still-open intakes (query, not increment)

“3 opened today, 2 still open” — `opened` comes from the day document; **still open** is `countDocuments` on Granot Booking Reconciliation Cases with `state: "open"` (same list Overview already uses). Do not store open/closed as a day increment.

---

## 10. HTTP API

Owner-only. Mount on the Granot-lifecycle-admin style router (full `/api/v1/admin/...` path + `requireApiSecret` + `requireRegistryOwnerActor`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/daily-operations` | Day snapshot: tiles, origins, companies, hourly, yesterday + pace |
| `GET` | `/api/v1/admin/daily-operations/events` | Historical page for the day (`cursor`, `lane`, `limit`) — not the live path |
| `GET` | `/api/v1/admin/daily-operations/live` | SSE |
| `POST` | `/api/v1/admin/daily-operations/rebuild` | Rebuild **open** day from domain collections (Owner / ops) |

### 10.1 Snapshot body

```json
{
  "timezone": "America/New_York",
  "today": "2026-09-06",
  "yesterday": "2026-09-05",
  "generated_at": "2026-09-06T18:14:00.000Z",
  "redis": { "configured": true, "mode": "stream" },
  "metrics": {
    "leads": { "today": 42, "yesterday": 38, "yesterday_by_now": 31, "form": 28, "call": 14, "duplicate_form": 3, "duplicate_call": 1 },
    "bookings": { "today": 6, "yesterday": 5, "yesterday_by_now": 4 },
    "cancellations": { "today": 1, "yesterday": 0, "yesterday_by_now": 0 },
    "texts": { "today": 19, "yesterday": 22, "yesterday_by_now": 18, "skipped": 4, "failed": 1 },
    "webhooks": {
      "lead_created": { "today": 55, "yesterday": 49 },
      "priority_updated": { "today": 120, "yesterday": 101 },
      "booking_status_changed": { "today": 8, "yesterday": 7 },
      "booked": { "today": 5, "yesterday": 4 },
      "release": { "today": 3, "yesterday": 3 }
    },
    "intakes": { "opened_today": 3, "still_open": 2 }
  },
  "origins": {
    "granot_lead_created": 20,
    "ringcentral": 14,
    "wordpress_form": 0,
    "best_relocation_sheet": 6,
    "vantage_admin": 2
  },
  "companies": [
    { "source_company": "top10_leads", "form": 12, "call": 5, "total": 17, "yesterday_total": 15 }
  ],
  "hourly": { "today": [/* 24 */], "yesterday": [/* 24 */] }
}
```

Missing open day → treat as zeros (or rebuild synchronously on GET if `?rebuild=1`, default off). Missing closed yesterday → `yesterday` totals null and UI shows “—” until the first close cron or a one-shot rebuild of that day.

### 10.2 SSE events

| Event | When | `id:` |
| --- | --- | --- |
| `snapshot` | First open (no Last-Event-ID) | no |
| `event` | New Daily Operations Event | yes `{occurred_at}:{event_id}` |
| `metrics` | After a wake batch that touched tiles | no |
| `heartbeat` | 15s idle | no |
| `error` | Stream failed | no |

Headers: copy Live Events (`text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`) + `flushHeaders`.

Admin BFF: `app/api/daily-operations-live/route.ts` — clone `granot-live-receipts/route.ts` (`runtime = "nodejs"`, `maxDuration = 300`, Owner-only, forward `last-event-id`, pipe body). Do **not** send Redis credentials to the browser.

### 10.3 Rebuild

Rebuild **open** today from domain collections:

| Counter | Source query (NY day bounds) |
| --- | --- |
| Form / Call leads | `form_leads` / `call_leads` on `timestamp`; split duplicate / unmatched |
| Origins / companies | Same documents |
| Webhooks | `granot_webhook_receipts` on `captured_at`, `observation_channel: granot_webhook` |
| Booked / Release | Observations or receipts with normalized booking action |
| Decisions | `synchronization_decisions` on the day (outcome groups) |
| Messages | `lead_messages` terminal status time |
| Bookings / Cancellations | `booked_leads` / `cancelled_leads` on `createdAt` |
| Intakes opened | cases `createdAt` |

Rebuild replaces the open day document and does **not** delete events (events are append-only; rebuild is counters only). Closed days are not rebuilt unless an explicit `?day=` + Owner confirm is added later.

---

## 11. Admin client

| File | Role |
| --- | --- |
| `app/(dashboard)/daily/page.tsx` | Page |
| `components/daily/*` | Shell, tiles, origin/company, feed, lane chips |
| `lib/api/dailyOperations.ts` | Snapshot fetch via `/api/proxy` |
| `lib/api/dailyOperationsLive.ts` | Types + merge (copy `granotLiveReceipts.ts`) |
| `app/api/daily-operations-live/route.ts` | SSE BFF |
| `lib/query/keys.ts` | `queryKeys.dailyOperations.snapshot` |

Client:

```ts
const source = new EventSource("/api/daily-operations-live");
```

Native reconnect. No custom backoff (same as Live Events). `onerror` → status `reconnecting`. Merge events by `event_id`. Apply `metrics` to the tile store. Filter lanes / Quiet priorities / company **in memory**.

Do not add a 3s HTTP poll of the snapshot while SSE is live. Optional: one snapshot fetch on tab focus if the stream was hidden long enough to miss `maxDuration` reconnect (EventSource should already reconnect).

---

## 12. Cron

| Job | When | Does |
| --- | --- | --- |
| Close yesterday | ~00:05 America/New_York | `status: closed` |
| Rebuild open day | every 10 minutes (optional v1) | Repair drift vs domain collections |

Register in `vercel.json` next to existing crons. Handler: `ALL /api/cron/daily-operations-close` with the same cron secret pattern as sheet-sync / RingCentral.

---

## 13. Testing

- Unit: `recordDailyOperationsFact` insert-win / duplicate-key / closed-day skip / Redis failure swallowed
- Unit: day key + hour around Eastern midnight (`2026-06-01T03:00:00.000Z` → still `2026-05-31`)
- Unit: SSE loop — snapshot, XREAD envelopes, Mongo fallback, Last-Event-ID skip snapshot (copy `liveReceiptStream.test.ts`)
- Integration: Form Lead complete → event + day `$inc` + no Redis in test runner
- Integration: Granot capture increments webhook only; createLeadFromGranot finalize increments Lead + origin `granot_lead_created`
- Do **not** hit the real Upstash project from the Node test runner

---

## 14. Phasing

### Slice 1 — Truthful board

- Models + `recordDailyOperationsFact`
- Hooks: Form complete, Call complete, Granot capture, Booking finalize, Cancellation finalize, Lead Message successful
- Snapshot GET + SSE (Mongo tail; Redis XADD if configured)
- Admin `/daily` tiles + origin/company + one feed + lane chips
- Auth / nav / BFF
- `pnpm add @upstash/redis` + `getDailyOperationsRedis()` reading KV_* / UPSTASH_*

### Slice 2 — Pace and Granot nuance

- Hourly buckets + yesterday-by-now
- Close-of-day cron
- Processor decision kinds + intake opened
- Booked vs Release chips + Quiet priorities
- Pair receipt + outcome
- Employee / Confirm Granot / leadless / referral booking kinds
- `still_open` intake query

### Slice 3 — Progress polish

- Session `+1` flashes
- Sheet Sync opt-in lane
- Exception kinds
- Rebuild cron
- `redis_stream_id` on events

### Out of v1

- Lead cost / binder / deposit
- Lead Conversations
- Changing WordPress to post to Vantage
- Replacing Live Events
- TCP `SUBSCRIBE` / `@vercel/kv`
- Redis as counter SoR

---

## 15. Locked decisions

1. `/daily` is a new Owner page. Not a tab on Live Events, Overview, or Observational.
2. One Granot stream, categorized. No per-class live space.
3. Mongo is SoR for events and counts. Redis is a doorbell (`XADD` Stream). Degrade to Mongo tail if Redis is absent.
4. After-commit hooks only. Same seam as `recordOperationalEvent`. Never Granot 202 for Lead / Booking / Decision counts.
5. Insert-on-`dedupe_key` is the increment gate. Replays, receipt reuse, and duplicate booking submissions do not count.
6. Today is America/New_York. Pace is hourly, not raw end-of-day vs in-progress.
7. Headline Leads exclude duplicates and Unmatched Call Leads.
8. Bookings and Cancellations count write time, not `book_date` / `cancel_date`.
9. Webhook counts are receipts; Lead counts are Lead writes. `wordpress_form` may be zero.
10. Daily Operations Events are a closed Owner catalog. Operational Events stay in Observational.
11. Use `@upstash/redis` REST with `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_*`). Do not use `REDIS_URL` / `KV_URL` TCP on Vercel Functions.
12. Best Relocation apply is not a hook. Canonical finalize already runs.

---

## 16. Suggested code layout

```
vantage-main-server/src/
  config/domain/dailyOperations.ts
  models/DailyOperationsEvent.ts
  models/DailyOperationsDay.ts
  services/dailyOperations/
    recordDailyOperationsFact.ts
    dayDocument.ts
    kinds.ts
    liveStream.ts
    snapshot.ts
    rebuild.ts
    closeDay.ts
  routes/daily-operations-admin.routes.ts
  routes/daily-operations-cron.routes.ts

vantage-admin/
  app/(dashboard)/daily/page.tsx
  app/api/daily-operations-live/route.ts
  components/daily/
  lib/api/dailyOperations.ts
  lib/api/dailyOperationsLive.ts
```

---

## 17. What “done” looks like at 2:14pm

The Owner opens `/daily` and can say:

> 42 leads today — 4 ahead of yesterday at this hour. 28 form / 14 call. Twenty minted from Granot `lead_created` (WordPress never hit us). Fourteen from RingCentral. Six from Best Relocation. Nineteen texts. Eight booking-status receipts, five Booked, three intakes still open. Six Bookings. One Cancellation.

The feed shows the last cards in lanes. A new RingCentral Call Lead appears as a card and the Call tile ticks without a page refresh. Live Events still has the raw Granot accordion. Analytics is unchanged.
