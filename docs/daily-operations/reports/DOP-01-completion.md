# DOP-01 completion — models, writer, Redis client

Closed 2026-09-06. Repository `vantage-main-server`, branch `daily-operations`.
No commit. No push.

§4 of the issue was re-verified before coding: no `DailyOperationsEvent` /
`DailyOperationsDay` models, no `src/services/dailyOperations/`, no
`@upstash/redis` in `package.json`. No drift from the coordinator note.
The issue was not rewritten; spec won on every shape.

## Writer function DOP-02 / DOP-03 should call

```ts
recordDailyOperationsFact(
  input: RecordDailyOperationsFactInput,
  deps?: RecordDailyOperationsFactDeps,
): Promise<RecordDailyOperationsFactResult | null>
```

From `src/services/dailyOperations/recordDailyOperationsFact.ts`.

Call **after commit**, same seam as `recordOperationalEvent`. Await it.
It never throws. A `null` result is a swallowed failure; the domain write
must already have succeeded.

```ts
type RecordDailyOperationsFactInput = {
  kind: DailyOperationsKind;       // required, closed catalog
  dedupe_key: string;              // required, unique increment gate
  occurred_at?: Date;              // NY day + hour come from this
  title?: string;                  // defaults from kinds.ts
  lane?: DailyOperationsLane;      // defaults from kinds.ts
  source_company?: string | null;
  ingestion_origin?: string | null;
  lead_kind?: "form" | "call" | null;
  job_no?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  parent_receipt_id?: string | null;
  links?: DailyOperationsLinks;
  card?: DailyOperationsCard;
  metric_touches: string[];        // caller-supplied day $inc paths
};
```

Helpers for callers (do not talk to Redis):

- `laneForKind(kind)` / `titleForKind(kind)`
- `defaultMetricTouches(kind)` — fixed catalog paths from spec §13
- `buildMetricTouches(kind, { origin, sourceCompany, bookingKind })` —
  catalog paths plus `origins.*`, `companies.{slug}.{form|call|total}`,
  and `bookings.{bookingKind}`

Dedupe key shapes stay in spec §14 (`form_lead:<leadId>:created`,
`message:<id>:deferred`, …). The writer does not build them.

## How to pass `card`, `links`, `metric_touches`

`card` is the spec §8.2 payload stored on the event. Name + last four
only. No message body. No raw receipt. Example:

```ts
card: {
  customer_name: lead.name,
  phone_last4: last4,
  move: { pickup_zip, pickup_state, delivery_zip, delivery_state, move_type },
  zip_miss: { pickup: true, delivery: false },
  text: { status: "accepted", deferred: true, send_at: sendAtIso },
}
```

`links` is the click surface for later Admin cards:

```ts
links: { lead_id, lead_model: "FormLead" | "CallLead", booking_id, cancellation_id, intake_case_id, receipt_id, message_id }
```

`metric_touches` are dotted day-document paths. Pass catalog defaults
plus caller-specific origin / company / booking-kind. The writer expands
`hourly.leads` (and the other `hourly.*` names) to
`hourly.{nyHour}.leads` and always `$inc`s `revision`.

```ts
metric_touches: buildMetricTouches("form_lead.created", {
  origin: "wordpress_form",
  sourceCompany: "tbm_leads",
})
// → leads.form, leads.total, hourly.leads, origins.wordpress_form,
//   companies.tbm_leads.form, companies.tbm_leads.total
```

`granot.minted` defaults to `["decisions.minted"]` only. Do not add
`leads.*`. Sheet Sync kinds default to `[]`.

Closed day: the event is kept, `metric_touches` is stored as `[]`, and
`$inc` is skipped.

## Redis key shape as implemented

```
dailyops:{env}:stream:{day}
```

- `env` = `VERCEL_ENV` when it is `production` or `preview`; otherwise `local`
- `day` = `YYYY-MM-DD` America/New_York from `occurred_at`

`XADD` uses `MAXLEN ~ 2000`. Envelope fields only: `event_id`, `day`,
`kind`, `lane`, `occurred_at` (ISO), `dedupe_key`. No contact PII.
`redis_stream_id` is stored when XADD returns an id.

Client: `getDailyOperationsRedis()` — `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`, then `KV_REST_API_URL` /
`KV_REST_API_TOKEN`. Does not read `KV_REST_API_READ_ONLY_TOKEN`,
`KV_URL`, or `REDIS_URL`.

Publish gate: `shouldPublishDailyOperationsRedis()`. False when
`isVantageTestRunner()` or `isTestMode()`, or when url/token is missing.
Local `pnpm dev:local` publishes when credentials are present.

The writer never calls Redis `INCR`. The writer does not construct a
Redis client when the publish gate is false (including the test runner,
even if `KV_*` are in `process.env`).

## What this issue did not do

- No domain hooks (Form / Call / Booking / Cancellation / Lead Message)
- No Granot hooks
- No HTTP routes or cron
- No Admin UI / `vantage-admin` files
- No SSE / live stream
- No Knowledge Service body
- No live Upstash writes from tests
- No commit or push

## §10 acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Unique `dedupe_key` insert increments the named `metric_touches` | `recordDailyOperationsFact.test.ts` — `leads.form` / `leads.total` / `hourly.23.leads` / `origins.wordpress_form` / `companies.tbm_leads.form` became 1; first-day seed had 24 hourly buckets and every `SOURCE_COMPANIES` slug |
| Duplicate `dedupe_key` is a no-op | Same file — second call `outcome: "duplicate"`, `incrementCalls` stayed 1, XADD stayed 1 |
| Closed day skips `$inc` and records `metric_touches: []` | Same file — `incrementCalls === 0`, event touches `[]`, day `leads.form` stayed 9 |
| Missing Redis client still persists | Same file — `getRedis` returned null; event + `$inc` still happened |
| Test runner never constructs a publish that would call Upstash | `shouldPublishDailyOperationsRedis()` is false in the runner; `getRedis` was not called (would have thrown). Config tests also prove the gate stays false with dummy KV credentials |
| `2026-06-01T03:00:00.000Z` maps to NY day `2026-05-31` | `dayDocument.test.ts` — day `2026-05-31`, hour `23` |
| Package tests + typecheck | 22 passed, 0 failed. `pnpm typecheck` exit 0 |

In-memory stores only. No live Mongo. No live Upstash.

## Command output

```
$ pnpm exec tsx --test src/services/dailyOperations/recordDailyOperationsFact.test.ts src/config/domain/dailyOperations.test.ts src/services/dailyOperations/dayDocument.test.ts
✔ missing Redis URL or token returns a null client (2.2346ms)
✔ UPSTASH_* names construct a client and KV_* aliases do too (1.7284ms)
✔ read-only token, KV_URL, and REDIS_URL are not used for the client (0.3974ms)
✔ test runner never publishes Daily Operations Redis writes (0.4849ms)
✔ TEST_MODE also keeps Daily Operations Redis publish off (0.4885ms)
✔ missing credentials keep publish off even outside the TEST_MODE flag (0.3667ms)
✔ Redis stream key uses VERCEL_ENV production or preview, otherwise local (0.5207ms)
✔ collection names use the test prefix in the test runner (2.1953ms)
✔ 2026-06-01T03:00:00.000Z maps to the NY day 2026-05-31 (1.8572ms)
✔ first day seed has 24 hourly buckets and known Source Company slugs (1.6991ms)
✔ metric_touches expand hourly.* onto the NY hour and always bump revision (0.357ms)
✔ already-expanded hourly paths stay as written (0.2177ms)
✔ dotted increments apply onto a seeded day including hourly buckets (0.3394ms)
✔ unique dedupe_key insert increments the named metric_touches (3.2961ms)
✔ duplicate dedupe_key is a no-op: no second increment and no XADD (0.6844ms)
✔ closed day skips increment and records empty metric_touches (0.5274ms)
✔ missing Redis client still persists the event and day increment (0.4301ms)
✔ test runner never constructs a publish that would call Upstash (0.3165ms)
✔ Redis XADD failure is swallowed and does not fail the fact (3.4536ms)
✔ successful XADD stores redis_stream_id and only envelope fields (0.8512ms)
✔ writer never throws when stores fail (0.4649ms)
✔ granot.minted increments decisions only and sheet sync increments none (0.2341ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2325.0983
```

Pino `warn` / `error` lines in the raw run are expected: Redis XADD
failure is logged and swallowed; store failure is logged and the writer
returns `null`. Tokens were not logged.

```
$ pnpm typecheck

> vantage_movers_server@1.0.0 typecheck C:\Users\Pinda\Proyectos\vantage\vantage-main-server
> tsc --noEmit
```

Exit 0.
