---
type: Service
title: Daily Operations
description: Owner/Manager Daily Operations board. Mongo day documents and append-only Daily Operations Events, served through one shared 60-second read view. Redis and the live SSE stream are retired. Not Daily View. Not Live Events. Not a second specification.
tags: [daily-operations, owner-dashboard, admin-dashboard]
status: draft
stale_after: 2026-12-19
resource: src/services/dailyOperations/recordDailyOperationsFact.ts
applies_to:
  - src/services/dailyOperations/**
  - src/models/DailyOperationsEvent.ts
  - src/models/DailyOperationsDay.ts
  - src/models/DailyOperationsReadView.ts
  - src/models/dailyOperationsModelFactory.ts
  - src/config/domain/dailyOperations.ts
  - src/routes/daily-operations-admin.routes.ts
  - src/routes/daily-operations-cron.routes.ts
  - ops/daily-operations-read-view-indexes.ts
  - vantage-admin/components/daily/**
  - vantage-admin/components/today/**
  - vantage-admin/lib/api/dailyOperations.ts
  - vantage-admin/lib/api/dailyOperationsBoard.ts
  - vantage-admin/lib/api/dailyOperationsColors.ts
  - vantage-admin/app/api/daily-operations-board/route.ts
  - vantage-admin/server/auth/authorization.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: internal_hidden_docs/daily-operations/daily-operations-specification.md
    title: Daily Operations specification
  - id: release-2026-11-19
    resource: docs/operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md
    title: Daily Operations, canonical commands and Master Sheets release (2026-11-19)
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:docs-keeper
  at: 2026-09-10T17:43:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** the Daily Operations specification, `internal_hidden_docs/daily-operations/daily-operations-specification.md`. It is the working contract and wins on every conflict. `internal_hidden_docs/` is gitignored, so the pack exists only in checkouts that have it.  
**Latest release record:** [Daily Operations, canonical commands and Master Sheets, 2026-11-19](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md)  
**Domain terms used:** [Daily Operations](../../../../CONTEXT.md), [Daily Operations Event](../../../../CONTEXT.md), [Daily Operations Panel](../../../../CONTEXT.md), [Arrivals](../../../../CONTEXT.md), [Lead Message](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md)

# Daily Operations

This file is a Service pointer. It does not copy the specification's hook tables or wire shapes.

## How the board is served

`GET /api/v1/admin/daily-operations/board` returns one shared read view ([`readView.ts`](../../../src/services/dailyOperations/readView.ts)). The view holds the three-day snapshot, the newest 80 cards and the newest 50 goal milestones, with truncation flags. It carries `revision`, `generated_at`, `freshness` and `poll_after_ms: 60000`.

[`readViewCache.ts`](../../../src/services/dailyOperations/readViewCache.ts) builds the view on demand. A reader inside the 60-second interval gets the stored payload. After the interval, one reader claims a lease (15 s) and rebuilds; other readers get the last value marked `stale`. A failed or timed-out build (5 s) keeps the last value. A missing value returns HTTP 503 `DAILY_OPERATIONS_VIEW_UNAVAILABLE` with `Retry-After: 60`. The payload is capped at 512 KiB. `revision` changes only when the content hash changes.

Goal summary (`/goal-summary`) and Owner-only lead spend (`/lead-spend-summary`) use separate five-minute views ([`auxiliaryReadViews.ts`](../../../src/services/dailyOperations/auxiliaryReadViews.ts)).

The release record measured the trade-off on 2026-11-18: the 60-second coalesced refresh allows at most 60 builds per key per hour. Rebuilding on every fact would have added up to 100 refresh triggers in the busiest hour.

Admin reads the board through `app/api/daily-operations-board/route.ts` and one visible-tab poll per `poll_after_ms` (`components/daily/daily-read-provider.tsx`). The board renders inside Today (`components/today/today-page.tsx`); `/daily` is still a dashboard route. Admin helpers that still carry board rules: `lib/api/dailyOperations.ts` (`percentChange`, `twoDayAverageByNow`), `lib/api/dailyOperationsBoard.ts` (`eventsForDailyOperationsArrivals`, `eventsForDailyOperationsPanel`, `lanesNeedingBackfill`, `dailyOperationsCardDetails`) and `lib/api/dailyOperationsColors.ts` (Owner kind colours in `localStorage` key `vantage-admin-daily-kind-colors`). A panel count must never sit above an empty stack; the copy is `DAILY_COPY.countWithoutCards`. The earlier `arrivals-stream.tsx` rail and the per-tab `EventSource` are gone.

## Routes and access

| Route | Access | Behavior |
| --- | --- | --- |
| `GET /api/v1/admin/daily-operations` | Owner or signed Manager | Snapshot only, uncached |
| `GET /api/v1/admin/daily-operations/board` | Owner or signed Manager | Shared read view |
| `GET /api/v1/admin/daily-operations/goal-summary` | Owner or signed Manager | Five-minute view |
| `GET /api/v1/admin/daily-operations/lead-spend-summary` | Owner | Five-minute view |
| `GET /api/v1/admin/daily-operations/events` | Owner or signed Manager | Cursor page for one day, optional `lane` |
| `GET /api/v1/admin/daily-operations/live` | Owner or signed Manager | Retired. Returns HTTP 204. No Redis client, no Mongo tail |
| `POST /api/v1/admin/daily-operations/rebuild` | Owner | Rebuild the open day's counters |
| `ALL /api/cron/daily-operations-close` | `CRON_SECRET` | Hourly at minute 5 UTC. Closes every open day before today in New York |

Generic Admin and Rep are denied. Reads do not mutate business records. A board read can write only its own read-view document.

## Redis is retired

`getDailyOperationsRedis()` returns `null` and `shouldPublishDailyOperationsRedis()` returns `false` ([`config/domain/dailyOperations.ts`](../../../src/config/domain/dailyOperations.ts)). No Redis credentials are read. New events omit `redis_stream_id`; they no longer store `null`. Older events keep their real stream IDs.

[`liveStream.ts`](../../../src/services/dailyOperations/liveStream.ts) still holds the SSE replay code and its tests, including the skip past retired webhook cards (a12d7bda). No route calls it. `/live` answers 204 so an old `EventSource` stops reconnecting.

## Writing facts

[`recordDailyOperationsFact.ts`](../../../src/services/dailyOperations/recordDailyOperationsFact.ts) writes facts after the business commit. It never throws to the caller; failures are logged and return `null`.

- A fact needs a `dedupe_key`. The unique `dedupe_key` index makes a repeated fact a `duplicate` outcome.
- A fact with metric touches updates its New York day document and inserts the event in one transaction. A concurrent first-day upsert retries up to three times.
- A fact without metric touches inserts only the event and does not read the day.
- `decisions.*` touches are dropped. Those counters are retired.
- A fact for a closed day keeps its original New York day and dedupe key. It is stored with empty `metric_touches`, the frozen close totals do not change, and the outcome is `closed_day`.

Granot webhook acceptance increments the day, hour and route counter inside the receipt capture transaction ([`webhookDay.ts`](../../../src/services/dailyOperations/webhookDay.ts)). Ordinary webhook arrivals no longer write receipt cards. The retired card kinds `granot.lead_created`, `granot.priority_updated`, `granot.booked` and `granot.release` are filtered from every card read (`RETIRED_WEBHOOK_CARD_KINDS`). Decision cards no longer carry `parent_receipt_id` or `links.receipt_id`. Only `exception.dead_letter` sets `parent_receipt_id` and keeps its receipt link.

Granot-created Leads count as Leads. `createLeadFromGranot`'s after-commit finalize records `form_lead.created` / `call_lead.created` from the created Lead, after `granot.minted`. `granot.minted` adds no Lead count. Live Lead facts pass the Lead arrival instant as `occurred_at` (see the time rule below).

Booked/Release contributions found during intake use the existing deduped intake event. Only redundant `already_current` and `stale` Granot display facts are suppressed. Synchronization Decisions and Observation Receipts remain canonical.

Measured on 2026-11-18 (release record): canonical creation to the durable board fact had median/p95 of 471/695 ms for 65 Forms, 138/405 ms for 9 Calls and 142/158 ms for 4 Bookings.

## Day close and rebuild

[`closeDay.ts`](../../../src/services/dailyOperations/closeDay.ts) sets `status: "closed"`, `closed_at`, and increments `revision` on each open day before today.

[`rebuild.ts`](../../../src/services/dailyOperations/rebuild.ts) recomputes today's New York day from canonical rows and replaces counters with a revision compare-and-set, up to three attempts. A concurrent change returns 409 `DAY_CHANGED`. A closed day returns 409 `DAY_CLOSED`. A rebuild never deletes events (`EVENTS_APPEND_ONLY`).

- **Leads:** one time rule, [`leadDay.ts`](../../../src/services/dailyOperations/leadDay.ts). A Lead belongs to the New York day and hour of its arrival instant (`leadArrivalInstant`, through `salesOutreach/subjects/leadInstant.ts`). The rebuild scans `timestamp` in the wall-clock range widened by six hours, then keeps the rows whose instant falls on the day.
- **Texts:** by event day. Lead Messages with `createdAt`, `accepted_at`, `sent_at` or `delivered_at` on the day. A sent scheduled message with no recorded send time counts in `messages.unreconstructable_sent_day` on its accept day.
- **Webhooks:** a day with `webhook_counts_version: 1` keeps its transactional webhook totals. An older open day is reconstructed from Granot Observation Receipts while they are still available (`backfillWebhookDay`).
- **Bookings, Cancellations, intakes opened:** by `createdAt` on the day.
- **Sheet Sync completed/failed:** counted from this day's `sheet_sync.completed` / `sheet_sync.failed` events. The events are the only record of that count.

Agreement between live recording and rebuild: [`liveRebuildAgreement.test.ts`](../../../src/services/dailyOperations/liveRebuildAgreement.test.ts). Writer and boundary behavior on a replica: [`writer.replica.test.ts`](../../../src/services/dailyOperations/writer.replica.test.ts).

## Snapshot

`getDailyOperationsSnapshot` ([`snapshot.ts`](../../../src/services/dailyOperations/snapshot.ts)) loads today, yesterday and the day before in one query. A missing day yields `null` prior values. `*_by_now` sums hourly buckets `0..currentNyHour`. It also counts open booking intakes and held (scheduled, accepted) Lead Messages. Proof: `snapshot.test.ts`.

## Goal milestones

Lane `outreach` has `outreach.rep_goal_met` and `outreach.team_goal_met`, with no metric touches. The Sales Outreach Desk records each at most once per rep or team and day (`salesOutreach/contacts/goalMilestones.ts`; see [`sales-outreach-desk.md`](./sales-outreach-desk.md)). The board reads them as their own bounded page.

## Storage, indexes and read paths

Collection names come from [`config/domain/dailyOperations.ts`](../../../src/config/domain/dailyOperations.ts). Test mode uses the `test_` prefixed names. The models are registered through `dailyOperationsModelFactory.ts` and do not set `autoIndex: false`.

### `daily_operations_events`

Indexes declared in [`DailyOperationsEvent.ts`](../../../src/models/DailyOperationsEvent.ts):

| Name in production | Key | Options | Main code query |
| --- | --- | --- | --- |
| `dedupe_key_1` | `{ dedupe_key: 1 }` | unique | Insert dedupe (write constraint) |
| `day_1_occurred_at_-1__id_-1` | `{ day: 1, occurred_at: -1, _id: -1 }` | | Board card page and `/events` without `lane`: `{ day, kind: { $nin: retired } }` sorted `occurred_at -1, _id -1` |
| `day_1_lane_1_occurred_at_-1` | `{ day: 1, lane: 1, occurred_at: -1 }` | | `/events?lane=` |
| `dailyops_day_kind_order` | `{ day: 1, kind: 1, occurred_at: -1, _id: -1 }` | name set in code | Board milestone page `{ day, kind: { $in: goal kinds } }`; rebuild counts of `sheet_sync.*` and intake adjustments |
| `parent_receipt_id_1_occurred_at_1` | `{ parent_receipt_id: 1, occurred_at: 1 }` | | None found |
| `entity_type_1_entity_id_1` | `{ entity_type: 1, entity_id: 1 }` | | None found |
| `daily_operations_event_created_ttl` | `{ createdAt: 1 }` | TTL 400 days | Retention |

`dailyops_day_kind_order` is also created by [`ops/daily-operations-read-view-indexes.ts`](../../../ops/daily-operations-read-view-indexes.ts). The TTL was installed by `ops/disk-trim/trim.ts` (2026-10-07). The `day` key is a string and cannot carry a TTL.

Retention: 400 days after `createdAt`. Keep the history in MongoDB. The release record compared a GCS export of closed days and kept MongoDB: the export would add an upload and verification per day, archive reads and a merge for late facts. New GCS objects for this release were zero.

Measured baseline (release record and [`operations-command-sheets-final-stock.json`](../../operations/evidence/operations-command-sheets-final-stock.json)):

- Stock on 2026-11-19: 276,617 documents, 175.57 MiB logical, 83.11 MiB allocated data, 147.46 MiB indexes. Indexes are larger than the data.
- November 18 (New York day): 674 events, 462,533 BSON bytes, peak 100 in the 22:00 hour.
- Board card page examined 10 keys for 10 results on `day_1_occurred_at_-1__id_-1`. The milestone page examined 1 key on `dailyops_day_kind_order`.
- Index access counters on the primary, 2026-11-18T20:50Z to 2026-11-19T23:13Z: `day_1_occurred_at_-1__id_-1` 320, `dailyops_day_kind_order` 302, `day_1_lane_1_occurred_at_-1` 1, TTL 4, `parent_receipt_id_1_occurred_at_1` 0, `entity_type_1_entity_id_1` 0. `dedupe_key_1` shows 0 because the counter excludes uniqueness checks on insert. Counters reset on restart.
- One-time compaction removed empty `redis_stream_id` from 216,499 events (3,680,483 bytes). 60,116 events keep real stream IDs.

### `daily_operations_days`

Indexes declared in [`DailyOperationsDay.ts`](../../../src/models/DailyOperationsDay.ts):

| Key | Options | Main code query |
| --- | --- | --- |
| `{ day: 1 }` | unique | Snapshot `{ day: { $in: [three keys] } }`; fact and webhook upserts `{ day }`; rebuild `findOne({ day })` and CAS `{ day, status: "open", revision }` |
| `{ status: 1, day: -1 }` | | Close `{ day: { $lt: today }, status: "open" }` |

No TTL. One document per New York day; closed days keep their frozen totals. November 18's day document was 3,661 BSON bytes (release record). Index usage is unmeasured.

### `daily_operations_read_views`

[`DailyOperationsReadView.ts`](../../../src/models/DailyOperationsReadView.ts) declares no secondary index. The `_id` key (`<env>:<day>:<scope>:v2`) is the cache key and the cross-instance lease fence. Each build reads and writes by `_id`. One document per scope per day is kept; there is no TTL. Size and usage are unmeasured.

### Reads of other collections

| Collection | Query | Caller | Declared index that fits |
| --- | --- | --- | --- |
| `granot_booking_reconciliation_cases` | count `{ state: "open" }` | Snapshot | `granot_booking_case_state_last_evidence` |
| `lead_messages` | count `{ provider_status: "scheduled", status: "accepted" }` | Snapshot | `{ status, next_attempt_at, createdAt }` prefix only |
| `form_leads`, `call_leads` | `{ timestamp: range }` | Rebuild | None leading with `timestamp` |
| `lead_messages` | `$or` of `createdAt`, `accepted_at`, `sent_at`, `delivered_at` ranges | Rebuild | None leading with those fields |
| `booked_leads`, `cancelled_leads` | `{ createdAt: range }` | Rebuild | None leading with `createdAt` |
| `granot_booking_reconciliation_cases` | count `{ createdAt: range }` | Rebuild | None |
| `granot_observation_receipts` | `{ observation_channel, route_event_class: $in, captured_at: range }` | Rebuild of a legacy open day | `granot_observation_receipt_route_event_captured` |

The snapshot reads run at most once per board build. The rebuild runs only on an Owner `POST /rebuild`. Their production plans are unmeasured.

### Observations for the index phase

- `parent_receipt_id_1_occurred_at_1` and `entity_type_1_entity_id_1` have no code query and recorded 0 accesses in the window above. Since c55f61a7 only `exception.dead_letter` sets `parent_receipt_id`.
- Event indexes (147.46 MiB) exceed allocated event data (83.11 MiB).
- `daily_operations_read_views` gains one document per scope (`dailyops_core`, `dailyops_goals`, `dailyops_owner_spend`) per New York day and has no TTL or cleanup. Each payload may reach 512 KiB. Growth is unmeasured.
- The rebuild's time-range scans on Leads, Lead Messages, Bookings, Cancellations and booking cases have no matching declared index. Their cost is unmeasured.

## Related

- [`sales-outreach-desk.md`](./sales-outreach-desk.md) — goal milestones and Manager access.
- [`job-number-timeline.md`](./job-number-timeline.md) — shares `leadArrivalInstant` for Lead arrival.
- [`sheet-sync.md`](./sheet-sync.md) — source of `sheet_sync.completed` / `sheet_sync.failed` facts.
