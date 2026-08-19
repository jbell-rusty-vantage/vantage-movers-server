# Unit I — SSE transport swap

> **Contract maturity: complete. Implementation status: OPTIONAL — do not build speculatively.**
>
> This unit exists so the design is recorded, not so it gets built. ODV-C ships a 3-second cursor poll that is perceptually identical to push for a single Owner watching a board. **Start this unit only if ODV-C's measured Preview latency proved insufficient, and record that measurement in §3.**

## 1. Authority and required reading

- **Specification:** **§4 in full** — §4.1 (why in-process fan-out is impossible), §4.2 (why polling was chosen), §4.3 (the merge), **§4.4 (this unit's design)**.
- **Predecessor contract:** ODV-C — `DailyFeedEvent`, the watermark cursor, `useDailyFeed()`, and the live indicator states. This unit changes **only** the transport behind that hook.
- **Read before writing a route:** `vantage-admin/app/api/proxy/[...path]/route.ts` and `server/vantage-api/client.ts` — they buffer, and understanding exactly why is the reason this unit needs a separate route.
- Next.js 16 streaming route handlers: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.mdx` and `01-app/02-guides/streaming.mdx`. **Read them; this Next.js differs from training-data assumptions.**

## 2. Objective

Replace client polling with server-sent events behind `useDailyFeed()`, with a byte-identical payload and identical cursor semantics, so no consuming component changes. Reduce feed latency from ≤3s to ~2s and reduce client request volume.

## 3. Justification gate — required before starting

Record, from ODV-C's completion report and a fresh measurement:

| Question | Answer required |
| --- | --- |
| Measured Preview latency of the 3s poll | seconds |
| Observed request volume per Owner-hour | count |
| What concrete problem is polling causing? | Not "it would be nicer" |
| How many concurrent Daily View viewers exist? | If 1, the case for this unit is weak |

**If the answer to the third question is not a real, observed problem, close this issue unbuilt.** That is a legitimate outcome and the expected one.

## 4. Current-state evidence to verify

Reverify at implementation:

- ODV-C's `useDailyFeed()` owns the entire transport decision; no component imports a polling primitive. Confirm this is still true — if a component started calling the feed endpoint directly, fix that **before** swapping transports.
- `app/api/proxy/[...path]/route.ts` routes through `requestVantageApi`, which buffers the whole response. It cannot stream and must not be modified to try.
- `vantage-main-server/vercel.json` declares `functions` triggers and `crons`. It declares no `maxDuration` for the Express entrypoint.
- Vercel function `maxDuration` limits are plan-dependent. **Verify the account's actual ceiling** rather than assuming a number; the loop's self-termination margin depends on it.

## 5. Locked decisions and invariants at risk

- **The payload is byte-identical to the poll response.** Same `DailyFeedEvent`, same cursor semantics. If the SSE payload diverges, this stops being a transport swap and becomes a second contract to maintain.
- **`Last-Event-ID` is read as `since`.** That is the whole reconnection design; the browser supplies it automatically.
- **The loop self-terminates before `maxDuration`** with a final `event: reconnect`. A connection killed by the platform mid-frame is a worse failure than a clean handoff.
- **No Mongo change stream.** Specification §4.4 closing paragraph: each connection would hold a dedicated Atlas cursor across cold starts with resume-token handling, for ~2s of latency on a page with one viewer.
- **No external pub/sub vendor** — that would be a different unit with a procurement and a secret, not a transport swap.
- **The poll path stays intact and selectable.** A flag chooses transport; SSE failure falls back to polling rather than to nothing.
- Read-only. No mutation.

## 6. Deliverables and exact contract

### 6.1 Server streaming endpoint

```text
GET /api/v1/admin/owner-daily/feed/stream ?window=24h|48h &since=<ISO>
```

Owner-only, same actor gating as the poll route. Behaviour:

- Loop internally on a 2s interval calling the **same** `listDailyFeed()` service ODV-C built. Do not fork the merge.
- Emit `event: daily` frames with `id: <cursor>` and the `DailyFeedResponse` JSON as data.
- Emit `: keepalive` every 15s so intermediaries do not close the connection.
- Self-terminate **5 seconds before** the declared `maxDuration`, emitting a final `event: reconnect`.
- Headers: `content-type: text/event-stream`, `cache-control: no-store`, `connection: keep-alive`, `x-accel-buffering: no`.
- Read `Last-Event-ID` when `since` is absent.

Declare an explicit `maxDuration` for this function in `vercel.json` within the verified account ceiling.

### 6.2 Admin streaming route handler

New `app/api/live/daily/route.ts` — **not** the existing proxy.

- Authenticate with the same `requireAdmin()` the proxy uses, then the same Owner check.
- Return a `ReadableStream` piping the server's stream through.
- `export const dynamic = "force-dynamic"` and an explicit runtime declaration per the Next.js 16 docs read in §1.
- Propagate client disconnect (`request.signal`) so the upstream connection closes rather than leaking.

### 6.3 Transport selection in `useDailyFeed()`

One flag — an environment variable or a settings toggle, decided at implementation:

| Transport | Behaviour |
| --- | --- |
| `poll` (default) | ODV-C behaviour, unchanged |
| `sse` | `EventSource` to `/api/live/daily`; on `event: reconnect` or error, reconnect; after **two** consecutive failures, fall back to `poll` for the session and surface `reconnecting` then `live` |

The live indicator states from ODV-C are unchanged. The Owner should not be able to tell which transport is active except by latency.

**No consuming component changes.** That is the acceptance test for the whole unit.

## 7. Explicitly out of scope

- Mongo change streams.
- WebSockets.
- Any external pub/sub vendor or SDK.
- Modifying `app/api/proxy/[...path]/route.ts`.
- Changing `DailyFeedEvent`, the cursor contract, or the merge.
- Streaming anything other than the daily feed.

## 8. Flags and runtime posture

Transport flag default **`poll`**. SSE is opt-in even after this unit lands. Granot flags untouched.

## 9. Migration and indexes

**None.** Same eight queries as ODV-C, same indexes.

## 10. Acceptance criteria

- [ ] The SSE payload is byte-identical to the poll response for the same `since` and `window`. Proven by a test comparing serialized output from both paths.
- [ ] **No component outside `lib/query/ownerDailyFeed.ts` changed.** Proven by `git diff --stat`.
- [ ] Reconnection after `event: reconnect` resumes from `Last-Event-ID` with no duplicate and no gap.
- [ ] The loop terminates cleanly before `maxDuration`; no connection is killed mid-frame.
- [ ] Keepalive frames are emitted every 15s.
- [ ] Two consecutive SSE failures fall back to polling for the session; the board keeps updating.
- [ ] Client disconnect closes the upstream connection — no leaked stream after a tab close.
- [ ] With the flag set to `poll`, behaviour is bit-for-bit ODV-C.
- [ ] `grep` proves no change stream, WebSocket, or pub/sub client was introduced.
- [ ] Measured latency improvement is recorded and compared against the §3 justification.
- [ ] No mutation of any kind.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests: payload parity between transports; `Last-Event-ID` resumption; self-termination timing; fallback after two failures; disconnect propagation.

## 12. Live/staging verification

Preview deploy both repositories with the flag set to `sse`. Hold the board open **past** `maxDuration` and confirm a clean reconnect with no duplicate or missing events. Break the stream and confirm fallback to polling. Record measured latency against ODV-C's baseline.

**No production deploy.**

## 13. Rollback

Set the transport flag to `poll`. That is the entire rollback — ODV-C's path is untouched and still the default. Then, if desired, remove the streaming route and the `maxDuration` declaration.

## 14. Required completion handoff

Report: the §3 justification table with real measurements; files added; the `git diff --stat` proving no consuming component changed; payload-parity test output; reconnect and fallback evidence; measured latency before and after; the `vercel.json` diff.

**If the unit was closed unbuilt**, record the §3 measurements and the decision. That is a complete and valid outcome for this issue.
