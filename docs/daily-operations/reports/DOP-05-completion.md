# DOP-05 completion — SSE live + Redis doorbell

Closed 2026-09-08. Repository `vantage-main-server`, branch `daily-operations`.
No commit. No push.

§4 of the issue was re-verified before coding (2026-09-08): no drift
from the 2026-09-06 observation. Live Events still polls Mongo in
`runLiveReceiptSse` (`maxMs = 240_000`, heartbeat 15s,
`Last-Event-ID` via `lastIndexOf(":")`). Live Events headers and
`flushHeaders` / `req.close` abort are unchanged on
`GET /api/v1/admin/granot-lifecycle/receipts/live`. Writer already
XADDs envelope fields only. Upstash REST has no `SUBSCRIBE`. Owner
admin router already existed.

## Live path and headers for the DOP-06 BFF clone

**Upstream (this issue):**

| | |
| --- | --- |
| Method / path | `GET /api/v1/admin/daily-operations/live` |
| Auth | `requireApiSecret` (v1) + `requireRegistryOwnerActor` |
| Query | `?lane=` is **ignored**. One socket serves every Daily Operations Panel. |

Response headers (copy of Live Events + `flushHeaders`):

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Route: `src/routes/daily-operations-admin.routes.ts`.
Isolate: `runDailyOperationsLiveSse` in
`src/services/dailyOperations/liveStream.ts`.
`req.on("close")` aborts. `last-event-id` from
`req.header("last-event-id")`. Failure write:

```
event: error
data: {"error":"Live stream failed"}
```

**BFF clone target (DOP-06, not this issue):**
`vantage-admin/app/api/daily-operations-live/route.ts` — clone
`vantage-admin/app/api/granot-live-receipts/route.ts`
(`runtime = "nodejs"`, `maxDuration = 300`, Owner-only, forward
`last-event-id`, pipe body). Do not give the BFF Redis credentials.
Do not put Redis credentials in the browser or in SSE responses.

SSE types:

| Event | When | `id:` |
| --- | --- | --- |
| `snapshot` | First open (no / invalid Last-Event-ID) | no |
| `event` | New Daily Operations Event (full card, events-page item shape) | yes `{occurred_at_iso}:{event_id}` |
| `metrics` | After a wake batch that touched tiles | no — `{ metric_touches: string[] }` |
| `heartbeat` | 15s idle | no — `{ ts: ISO }` |
| `error` | Stream failed | no |

Redis path: `XREAD COUNT 25` on `dailyops:{env}:stream:{day}`. Never
`XREAD BLOCK`. Missing / throwing Redis → Mongo tail
(`occurred_at` / `_id` oldest-after-cursor, NY day, no lane filter).
Replica lag: missing Mongo `event_id` does not advance the stream id;
next loop retries.

## Last-Event-ID encode/decode helpers

Reuse DOP-04. Do **not** invent a second pair.

`encodeDailyOperationsEventCursor` /
`decodeDailyOperationsEventCursor` in
`src/services/dailyOperations/eventsPage.ts`.

```
encode: `${occurredAt.toISOString()}:${eventId}`
decode: value.lastIndexOf(":") → occurred_at | event_id
```

Valid header: skip `snapshot`, continue from that cursor (and that
event’s `redis_stream_id` when present). Invalid / missing: emit
`snapshot` then tail.

## Snapshot payload shape (must match DOP-04 GET)

SSE `snapshot` `data:` is `getDailyOperationsSnapshot()` — the same
function as `GET /api/v1/admin/daily-operations`. No `id:`. Shape is
spec §16.1 / [DOP-04 completion](DOP-04-completion.md) (timezone,
today / yesterday, `generated_at`, `redis`, `metrics` with
`yesterday_by_now`, `origins` including `wordpress_form: 0`,
`companies` zeros, `hourly`).

Live `event` cards use `projectDailyOperationsEventItem` (same item
shape as `GET .../events`).

## What this issue did not do

- Admin BFF `app/api/daily-operations-live` and EventSource client
  (DOP-06).
- Panel fan-out (DOP-07).
- Changing Live Events.
- Redis `INCR` as the Owner total.
- `XREAD BLOCK` over REST.
- Hitting real Upstash from tests (`createDailyOperationsLiveRedisReader`
  returns `null` in the test runner; tests inject a fake).
- A Lead increment on `granot.minted` (known DOP-03 / DOP-02 fallout;
  live increment still misses Granot-minted Lead volume; rebuild still
  counts those Leads).
- Confirm Granot Booking on `/daily`.
- The 2026-08-19 tabbed Daily View.
- Commit / push / deploy.
- docs-keeper (issue §9: none required; DOP-08 owns pointers).

## Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/liveStream.test.ts src/services/dailyOperations/*.test.ts && pnpm typecheck
```

```
✔ first open emits snapshot then tails Redis envelopes as event plus metrics (5.2445ms)
✔ valid Last-Event-ID skips snapshot and continues from the cursor (1.6736ms)
✔ invalid Last-Event-ID is treated as first open and emits snapshot (1.3033ms)
✔ missing Redis uses Mongo tail oldest-after-cursor and still emits facts (1.1641ms)
✔ Redis throw degrades to Mongo tail for that loop (1.458ms)
✔ replica-lag skip retries the same Redis id and does not drop the event (1.3115ms)
✔ lane query is ignored — one socket emits every Daily Operations Event (1.4568ms)
✔ heartbeat fires after 15s idle and has no id (1.7555ms)
✔ parseDailyOperationsXread reads object and flat-array field shapes (1.2423ms)
✔ test runner never constructs an Upstash client for the live isolate (0.6865ms)
… (other dailyOperations service tests)
ℹ tests 93
ℹ suites 0
ℹ pass 93
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5834.9415
```

`pnpm typecheck`: **0 errors**.

Also ran `src/routes/daily-operations-admin.routes.test.ts` with the
service suite: **101 pass**, 0 fail (Owner live headers + snapshot +
Redis event; `?lane=lead` still emits a Granot fact; Last-Event-ID
skips snapshot; Admin 403 on `/live`).
