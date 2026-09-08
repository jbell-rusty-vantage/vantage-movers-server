# DOP-05 — SSE live + Redis doorbell

> **Contract maturity: implementation-ready.** Session 3. One Owner
> EventSource that wakes from Redis `XADD` and degrades to Mongo tail.
> **No Admin page (DOP-06). Do not invent a second socket per panel.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §10–11, §16.2.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Pattern:** `src/services/granotLifecycle/liveReceiptStream.ts` +
  `liveReceiptStream.test.ts`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

`GET /api/v1/admin/daily-operations/live` is an Owner-only SSE. First
open (no `Last-Event-ID`) emits `snapshot`. Later facts emit `event`
and `metrics`. One socket serves every Daily Operations Panel; the
server does **not** filter by lane.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** DOP-01 and DOP-04 `complete`.
- No 21st.dev.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverified 2026-09-08 — no drift.**

- Live Events: `runLiveReceiptSse` polls Mongo, `maxMs = 240_000`,
  heartbeat 15s, `Last-Event-ID` decode with `lastIndexOf(":")`.
- Admin BFF clone target:
  `vantage-admin/app/api/granot-live-receipts/route.ts` — **this issue
  does not add the BFF** (DOP-06). Server route only.
- Writer already XADDs when Redis is configured (DOP-01).
- Upstash REST cannot `SUBSCRIBE`. Stream `XREAD COUNT 25` only.

## 5. Locked decisions and invariants at risk

- One socket. No per-lane server filter.
- Redis is a doorbell. Missing Redis → Mongo tail.
- Do not `XREAD BLOCK` for `maxDuration` over REST.
- Do not put PII on the Redis envelope.
- Test runner never hits real Upstash.
- Headers copy Live Events + `flushHeaders`.

## 6. Deliverables and exact contract

1. `liveStream.ts` algorithm in spec §11.5.
2. Route `GET /api/v1/admin/daily-operations/live`.
3. SSE event types: `snapshot`, `event`, `metrics`, `heartbeat`,
   `error`.
4. `Last-Event-ID` `{occurred_at_iso}:{event_id}`; reconnect skips
   snapshot when valid.
5. Tests copied in spirit from `liveReceiptStream.test.ts`: snapshot,
   XREAD envelopes, Mongo fallback, Last-Event-ID skip snapshot,
   replica-lag skip + retry.

## 7. Out of scope

- Admin BFF and `EventSource` client (DOP-06).
- Panel fan-out (DOP-07).
- Changing Live Events.

## 8. Tests

Spec §19 SSE rows. Inject `write` / `sleep` / `now` / Redis fake.

## 9. Knowledge updates after this issue ships

None required. DOP-08 owns pointers.

## 10. Acceptance criteria

- [x] First open without Last-Event-ID emits `snapshot` then tails.
- [x] Valid Last-Event-ID skips snapshot.
- [x] Redis envelope loads the Mongo event by `event_id`.
- [x] Missing Redis uses Mongo tail and still emits facts.
- [x] Lane query is ignored server-side (documented + tested).
- [x] Heartbeat at 15s idle.
- [x] Owner-only. No Redis credentials in the response.
- [x] Focused tests + typecheck.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/liveStream.test.ts
```

Plus typecheck. Paste output.

## 12. Risks

- Filtering lanes server-side and forcing one socket per panel.
- `XREAD BLOCK` over REST.
- Emitting Redis envelope fields as the card (PII / incomplete).
- Hitting real Upstash from tests.

## 13. Rollback

Unmount the live route. Writer XADD can stay; nothing consumes it.

## 14. Handoff list for the completion report

- Live path and headers for the DOP-06 BFF clone.
- `Last-Event-ID` encode/decode helpers.
- Snapshot payload shape (must match DOP-04 GET).

**Unblocks:** DOP-06.
