# Unit C — Live feed cursor endpoint, `useDailyFeed`, and the live indicator

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-A lands. This unit makes the board live. It ships a **cursor poll**, not a push transport, and it establishes the transport seam that ODV-I could later swap for SSE without touching a single consuming component.

## 1. Authority and required reading

- **Specification:** challenge 0.4, challenge 0.5, **§4 in full** — §4.1 explains why the obvious approach is impossible here, §4.2 the recommendation, §4.3 the merge, §4.4 the SSE seam. Also §6.2 and §8.
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §1 (live indicator states), §2 (live columns), §10 (degraded state).
- **Read before designing:** `vercel.json` function/cron declarations, `api/index.ts`, `src/services/granotLifecycle/queuePublisher.ts`. These establish that producers are separate invocations.

## 2. Objective

Deliver one watermark-cursor feed endpoint, the `useDailyFeed()` Admin hook that owns the entire transport decision, and the honest live indicator. Make the Overview live columns update without a reload. Establish `DailyFeedEvent` as the single event shape every live surface consumes.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin` on the sprint branch.
- **Prerequisite:** ODV-A complete — window contract, capabilities, `DailyOverviewCard` in `src/services/ownerDaily/types.ts`, Overview tab, live-indicator slot.
- ODV-B is **not** a prerequisite. If B has landed, wire its lists to the feed as well; if not, Overview alone is sufficient proof.
- Redacted synthetic data only. `TEST_MODE=true`. No commit, push, deploy, production apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `vantage-main-server` is Express behind `api/index.ts` with `rewrites: [{ source: "/(.*)", destination: "/api" }]`. Every request is a serverless invocation.
- Event producers are **different invocations**: `/api/webhooks/granot/*`, `api/queues/granot-lifecycle-consumer.ts`, `/api/cron/ringcentral-call-log-sync`, `/api/cron/granot-lifecycle-drain`, and the Admin proxy for Owner commands. **None shares memory with an invocation holding a browser connection.**
- `app/api/proxy/[...path]/route.ts` calls `requestVantageApi`, which buffers the whole response. It cannot stream.
- TanStack Query v5 is available in Admin. `refetchInterval`, `refetchIntervalInBackground`, and `useInfiniteQuery` are all in use elsewhere in the app.
- No `OwnerDailyEvent` collection exists and none is to be created — see §5.

## 5. Locked decisions and invariants at risk

- **An in-process `EventEmitter`, module-level response registry, or `socket.io` server is forbidden.** It will appear to work in `next dev` and will silently deliver nothing in production. This is an architectural impossibility on this deployment, not a preference.
- **No event-sourcing projection collection.** Specification challenge 0.5. The window is 24–48h; a read-time merge is bounded and adds zero write-path risk. Reusing observability `OperationalEvent` is also rejected — it is a health stream, not a business-fact stream.
- **`since` is a watermark, not a page cursor.** The client sends the newest `event_at` it holds; the server returns strictly newer events.
- **Idempotent by construction.** The client keys on `DailyFeedEvent.id`. A duplicate delivery replaces; it never appends. Never append blindly.
- **Existing rows never reorder** when new ones arrive.
- **The transport lives behind `useDailyFeed()` alone.** No component imports a polling primitive, an interval, or an `EventSource`.
- Read-only. No mutation of any kind.

## 6. Deliverables and exact contract

### 6.1 Route

```text
GET /api/v1/admin/owner-daily/feed ?window=24h|48h &since=<ISO> &limit=1..200
```

Owner-only. `since` is optional; when absent the window floor bounds the query. `limit` defaults to 100.

```ts
export type DailyFeedResponse = {
  window: DailyWindowEcho;
  events: DailyFeedEvent[];   // newest first
  cursor: string;             // ISO — newest event_at returned, or `since` when empty
  counts: {                   // cheap badge refresh, same call
    booking_intakes_open: number;
    cancellation_intakes_open: number;
    failed_conversations: number;
  };
};
```

`DailyFeedEvent` is the type ODV-A declared as `DailyOverviewCard` in `src/services/ownerDaily/types.ts`. **Rename it to `DailyFeedEvent`, alias the old name, and update ODV-A's consumers — do not declare a parallel type.**

```ts
export type DailyFeedEventKind =
  | "granot_receipt" | "granot_decision"
  | "form_lead" | "call_lead"
  | "booking" | "cancellation"
  | "booking_intake" | "cancellation_intake"
  | "conversation";
```

### 6.2 The merge — `src/services/ownerDaily/feed.service.ts`

Eight bounded queries in `Promise.all`, each `activity_at > since AND activity_at >= window.from`, each `.limit(50)`, each sorted `activity_at DESC, _id DESC`. Normalize to `DailyFeedEvent`, merge-sort, truncate to `limit`.

| Source | Field |
| --- | --- |
| `granot_observation_receipts` | `captured_at` |
| `synchronization_decisions` | `decided_at` |
| `form_leads` | `timestamp` |
| `call_leads` | `timestamp` |
| `booked_leads` | `timestamp` |
| `cancelled_leads` | `createdAt` |
| `granot_booking_reconciliation_cases` | `last_evidence_at` |
| `lead_conversations` | `updatedAt` |

`lead_conversations` will not exist until ODV-D. Guard the query behind `capabilities.conversations.state === "available"` so this unit works standalone and gains the source automatically when D lands.

Every event carries `masked_label` from `maskContactLabel`. **No unmasked contact enters the feed.**

### 6.3 Admin — `lib/query/ownerDailyFeed.ts`

```ts
export function useDailyFeed(options: {
  window: DailyWindowMode;
  kinds?: DailyFeedEventKind[];
}): {
  events: DailyFeedEvent[];
  counts: DailyFeedResponse["counts"];
  status: "live" | "paused" | "reconnecting" | "off";
  lastUpdatedAt: Date | null;
  retry: () => void;
};
```

Polling policy, exact:

| Condition | Interval |
| --- | --- |
| Document focused, Owner interacted within 5 minutes | 3s |
| Document focused, idle beyond 5 minutes | 15s |
| Document hidden | 60s, `refetchIntervalInBackground: false` |
| Owner toggled live off | no polling |

On failure: keep the last good data, surface `reconnecting`, retry with backoff. **Never blank a populated pane because one poll failed.**

The hook accumulates events client-side into a bounded ring (cap 200 per kind), keyed by `id`, sorted `event_at DESC`. Switching window resets the accumulator.

### 6.4 Admin components

| Path | Deliverable |
| --- | --- |
| `components/daily/live-indicator.tsx` | Four honest states from §6.3, `lastUpdatedAt` age, retry action, live on/off toggle persisted to local storage |
| `components/daily/live-feed-column.tsx` | Shared renderer for both Overview columns, filtered by `kinds` |
| `components/daily/overview-tab.tsx` | Replace static recent columns with `useDailyFeed` |

New rows animate in with a brief highlight. Existing rows do not move.

## 7. Explicitly out of scope

- **SSE, `EventSource`, streaming route handlers, and `maxDuration` tuning — ODV-I.** Specification §4.4 records that design. Do not build it here, and do not add a streaming route "for later".
- Mongo change streams, in any form.
- Any external pub/sub vendor, SDK, or secret.
- Creating an `OwnerDailyEvent` collection or any event projection.
- Making ODV-B lists live if B has not landed.

## 8. Flags and runtime posture

No new server flag. The Admin live on/off toggle is a client preference in local storage, not a feature flag. Granot flags read-only and unchanged.

## 9. Migration and indexes

**No new index.** The eight feed queries are served by the four ODV-A window indexes plus existing receipt, decision, and case indexes. Verify each of the eight `$gt` queries uses an index via `explain()` and record the winning plan in the completion handoff. If any is a collection scan, report it — do not add an index under this issue.

## 10. Acceptance criteria

- [ ] A record created after the client's last poll appears within 3 seconds while the tab is focused.
- [ ] Delivering the same event twice results in **one** row, not two. Proven by a test that replays an identical response.
- [ ] Existing rows do not reorder when a newer event arrives.
- [ ] With `since` set to the current instant, all eight queries return empty and the response echoes `since` as `cursor`.
- [ ] Hiding the document drops polling to 60s; showing it restores 3s. Proven in a test with a mocked visibility API.
- [ ] A failing poll surfaces `reconnecting` and **retains** the previously rendered events.
- [ ] Switching 24h↔48h resets the accumulator and does not merge events across windows.
- [ ] `grep -rn "EventEmitter\|socket\.io\|new EventSource\|ChangeStream\|watch()" src/services/ownerDaily vantage-admin/components/daily vantage-admin/lib/query` returns nothing.
- [ ] No component outside `lib/query/ownerDailyFeed.ts` imports a polling primitive or interval.
- [ ] No feed event contains an unmasked phone, email, or full name.
- [ ] `explain()` output for all eight queries is recorded and none is a collection scan.
- [ ] No Command, Change, revision, outbox row, case, or notification is produced.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `feed.service.test.ts` — watermark semantics, merge ordering with cross-source ties, the empty steady state, the conversations-source guard when `lead_conversations` is absent.
- Idempotency test: replay an identical response and assert one row.
- `ownerDailyFeed.test.ts` — interval selection per condition, failure retains data, window switch resets.
- Route test: Owner-only gating, `since` validation, `limit` bounds.

## 12. Live/staging verification

Preview deploy both repositories. With the Preview open, insert a synthetic record into the test database and confirm it appears within 3 seconds without a reload. Then break the endpoint and confirm the indicator degrades to `reconnecting` while the existing rows remain. Capture deployment ids and a note of observed latency.

**No production deploy, no live payload read.**

## 13. Rollback

Set the Admin live toggle default to off — the board reverts to static data with no server change. Then remove `useDailyFeed` from the Overview tab and unmount the feed route. No data was written.

## 14. Required completion handoff

Report: files added; the eight `explain()` plans; the grep output proving no push primitive was introduced; observed Preview latency; test and typecheck output for both repositories; explicit confirmation of zero mutation.

**Unblocks:** ODV-I (optional). Note in the handoff whether measured latency justifies it — the expected answer is no.
