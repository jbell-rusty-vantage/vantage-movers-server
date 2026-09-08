# DOP-04 completion — snapshot, events, rebuild, close cron

Closed 2026-09-06. Repository `vantage-main-server`, branch `daily-operations`.
No commit. No push.

§4 of the issue was re-verified before coding: no Daily Operations
routes, Overview open-case count is
`getGranotBookingReconciliationCaseModel` `state: "open"`, cron secret
matches sheet-sync (`CRON_SECRET` Bearer or `x-cron-secret`),
`vercel.json` already had crons, Lead Message held query is
`provider_status: "scheduled"` and `status: "accepted"` with no
`sendAt` column.

## Snapshot JSON example for DOP-06

`GET /api/v1/admin/daily-operations` returns this shape (spec §16.1).
Owner-only. Missing open today → zeros. Missing yesterday → `yesterday`
and `yesterday_by_now` are `null` (show `—`). `held_now` and
`still_open` are live queries. GET does not mutate.

```json
{
  "timezone": "America/New_York",
  "today": "2026-09-06",
  "yesterday": "2026-09-05",
  "generated_at": "2026-09-06T18:14:00.000Z",
  "redis": { "configured": false, "mode": "stream" },
  "metrics": {
    "leads": {
      "today": 42,
      "yesterday": 38,
      "yesterday_by_now": 31,
      "form": 28,
      "call": 14,
      "duplicate_form": 3,
      "duplicate_call": 1
    },
    "bookings": { "today": 6, "yesterday": 5, "yesterday_by_now": 4 },
    "cancellations": { "today": 1, "yesterday": 0, "yesterday_by_now": 0 },
    "texts": {
      "today": 19,
      "yesterday": 22,
      "yesterday_by_now": 18,
      "deferred": 4,
      "held_now": 3,
      "skipped": 4,
      "failed": 1
    },
    "webhooks": {
      "lead_created": { "today": 55, "yesterday": 49 },
      "priority_updated": { "today": 120, "yesterday": 101 },
      "booking_status_changed": { "today": 8, "yesterday": 7 },
      "booked": { "today": 5, "yesterday": 4 },
      "release": { "today": 3, "yesterday": 3 }
    },
    "intakes": { "opened_today": 3, "still_open": 2 },
    "exceptions": {
      "zip_missing": 2,
      "crm_failed": 0,
      "dead_letter": 0,
      "adoption_conflict": 0
    }
  },
  "origins": {
    "granot_lead_created": 20,
    "ringcentral": 14,
    "wordpress_form": 0,
    "best_relocation_sheet": 6,
    "vantage_admin": 2
  },
  "companies": [
    { "source_company": "tbm_leads", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "tbm_prime_leads", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "top10_leads", "form": 12, "call": 5, "total": 17, "yesterday_total": 15 },
    { "source_company": "best_relocation_leads", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "get_movers_leads", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "main_site", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "paid_overflow", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 },
    { "source_company": "not_provided", "form": 0, "call": 0, "total": 0, "yesterday_total": 0 }
  ],
  "hourly": { "today": [], "yesterday": [] }
}
```

In production `hourly.today` / `hourly.yesterday` are 24 buckets
(`hour`, `leads`, `bookings`, `cancellations`, `webhooks`, `messages`).
`yesterday_by_now` is `sum(yesterday.hourly[0..currentNyHour])` for that
metric. Pace is that comparison, not full yesterday vs in-progress today.

`redis.configured` comes from `shouldPublishDailyOperationsRedis()`
(env URL/token presence). The GET does not construct or connect an
Upstash client. In the test runner it is `false`.

Live fields:

- `intakes.still_open` — `GranotBookingReconciliationCase` `state: "open"` count (Overview query). Not a day increment.
- `texts.held_now` — Lead Messages `provider_status: "scheduled"` and `status: "accepted"`. No `sendAt` column.
- `texts.deferred` — day increment (held at some point today).

## Events cursor format for DOP-05 / DOP-07

`GET /api/v1/admin/daily-operations/events?cursor=&lane=&limit=`
(default `limit` 80). NY day only. **Newest-first**
(`order: "newest_first"`). Response includes `next_cursor`.

Cursor: `{occurred_at_iso}:{event_id}`

Parse with `lastIndexOf(":")` because the ISO-8601 timestamp contains
colons. Same idea as Live Events.

```ts
encode: `${occurredAt.toISOString()}:${eventId}`
decode: value.lastIndexOf(":") → occurred_at | event_id
```

Helpers: `encodeDailyOperationsEventCursor` /
`decodeDailyOperationsEventCursor` in
`src/services/dailyOperations/eventsPage.ts`.

SSE live (`GET .../live`) is **not** in this issue.

## Cron path registered in `vercel.json`

| Path | Schedule | Why |
| --- | --- | --- |
| `/api/cron/daily-operations-close` | `5 * * * *` | Hourly at minute 5 **UTC**. Vercel cron is UTC. After 00:05 America/New_York the handler closes every open day whose `day` is before today NY. Other hours no-op (`already_closed: true`). Avoids a single UTC clock that is wrong for EST vs EDT. UTC midnight is never the day key. |

Handler: `ALL /api/cron/daily-operations-close` in
`src/routes/daily-operations-cron.routes.ts`, mounted from `src/app.ts`
next to sheet-sync. Secret: `CRON_SECRET` Bearer or `x-cron-secret`.
401 without header. 500 if `CRON_SECRET` unset.

Close: `updateMany({ day: { $lt: today }, status: "open" }, { $set: { status: "closed", closed_at } })`.
Idempotent if already closed.

Optional 10-minute rebuild cron was **not** registered.

## Routes

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/admin/daily-operations` | `requireApiSecret` (v1) + `requireRegistryOwnerActor` |
| GET | `/api/v1/admin/daily-operations/events` | same |
| POST | `/api/v1/admin/daily-operations/rebuild` | same |
| ALL | `/api/cron/daily-operations-close` | `CRON_SECRET` |

Admin router mounted from `v1.routes.ts` like Granot lifecycle admin.
Rebuild of a **closed** day is 409 `DAY_CLOSED`. Rebuild replaces
counters only; events stay append-only.

## What this issue did not do

- SSE live route (DOP-05).
- Admin `/daily` page (DOP-06 / DOP-07).
- Domain / Granot hooks (already DOP-02 / DOP-03).
- Optional 10-minute rebuild cron (allowed to wait).
- Hitting real Upstash or live Mongo from unit tests.
- Commit / push.
- docs-keeper (coordinator may invoke; pack knowledge pointers stay DOP-08).

## Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/snapshot.test.ts src/services/dailyOperations/rebuild.test.ts src/services/dailyOperations/closeDay.test.ts src/routes/daily-operations-admin.routes.test.ts
```

```
✔ Owner snapshot includes yesterday_by_now, company zeros, and wordpress_form (47.3583ms)
✔ Admin without Owner is 403 on every Daily Operations method (67.5723ms)
✔ missing API secret is 401 (11.4743ms)
✔ events page is newest-first and forwards cursor, lane, and limit (5.3744ms)
✔ Owner rebuild returns counters-replaced, events not deleted (8.9833ms)
✔ close cron rejects missing secret header and missing CRON_SECRET (78.6153ms)
✔ close sets yesterday status closed when it is still open (3.6163ms)
✔ close is a no-op when yesterday is already closed (0.3427ms)
✔ close also seals older open days, not only yesterday (0.3323ms)
✔ rebuild of an open day replaces counters and never deletes events (1.9174ms)
✔ rebuild refuses a closed day and leaves counters and events alone (0.691ms)
✔ rebuild of a missing open day still writes seeded counters (0.4007ms)
✔ rebuild rejects a deleteEvents hook so events stay append-only (0.3721ms)
✔ missing open day returns seeded zeros, not 404 (5.9754ms)
✔ missing yesterday yields null totals so the UI can show a dash (1.38ms)
✔ yesterday_by_now is hourly 0..currentNyHour, not the full yesterday (0.6871ms)
✔ every SOURCE_COMPANIES slug is present including zeros (0.8971ms)
✔ wordpress_form is a present key even when zero (0.4905ms)
✔ intakes.still_open and texts.held_now are live queries, not day increments (0.5811ms)
✔ GET snapshot does not mutate loaded day documents (0.5978ms)
✔ events cursor is occurred_at ISO plus event id, parsed at the last colon (0.4192ms)
✔ events page is newest-first for the NY day and returns next_cursor (0.7766ms)
✔ test runner reports redis.configured false without constructing a client (0.8748ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4963.6463
```

Cron tests live in `src/routes/daily-operations-admin.routes.test.ts`
(same file as allowed by the issue).

Then `src/services/dailyOperations/*.test.ts`: **83 pass**, 0 fail.

Then `pnpm typecheck`: **0 errors**.
