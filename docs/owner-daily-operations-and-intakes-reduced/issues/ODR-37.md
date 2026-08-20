# ODR-37 — Intakes tab (both halves) and the live cursor feed

> **Contract maturity: implementation-ready.** The tab where the Owner sees what is waiting on him, and the 3-second cursor poll that keeps the whole board current — including the Granot webhook receipt stream he asked for. Both intake halves ship: Granot Unit 26 is complete, so Release Reconciliation are flag-gated, not missing. Read-only; every write is a navigation handoff to an existing gated endpoint.

## 1. Authority and required reading

- **Reduced specification:** [`owner-daily-reduced-specification.md`](../owner-daily-reduced-specification.md) — §2.2 (**Release Reconciliation ship now**), §4, §6, §7 (**the feed**), §8, §10.
- **Full specification:** [`owner-daily-operations-view-specification.md`](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — challenges 0.2, 0.4, 0.5, 0.8; §4.1–4.4; §6.5; §8.
- **Wireframes (illustrative only):** `vantage-admin/uxdocs/owner-daily-view-planned.txt` §1 (live indicator), §2 (live columns), §5, §5a, §10.
- **Predecessor:** [`ODR-35.md`](./ODR-35.md) — window contract, `DailyCapabilities`, **`DailyFeedEvent`**, cursor conventions, authorization.
- **Patterns to reuse, not reinvent:**
  - `src/services/granotLifecycle/projections.ts:420` — `listGranotLifecycleCases`, which already does everything the intake list needs.
  - `vantage-admin/components/granot-lifecycle/case-list.tsx` — `GranotLifecycleCaseList({ items, now })`.
  - `vantage-admin/app/(dashboard)/ingestion/granot/lifecycle/cases/[caseId]/page.tsx` — the handoff target.

## 2. Objective

Deliver the **Intakes** tab covering Booking Reconciliation *and* Release (Cancellation) Reconciliation cases, and the live cursor feed that makes the Today tab's event columns and the tab badges update without a refresh.

At the end of this issue the board is live: new Granot receipts, decisions, leads, bookings, cancellations, and newly opened intake cases appear within three seconds, and the Owner has one place that tells him what is blocked on him and one click to go resolve it.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on the reduced-pack branch.
- **Prerequisite:** ODR-35 merged. This issue **imports** `DailyFeedEvent` from `src/services/ownerDaily/types.ts`. It does not declare it.
- **Prerequisite:** Granot Units 22–23 (booking cases) and Unit 26 (release cases) landed. Verify both completion reports; do not trust the ledger alone.
- **May run in parallel with ODR-36.** The only shared file is `lib/api/ownerDaily.ts`, extended additively.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; **reverify at implementation**.

**The intake list is almost entirely an existing projection. Read this before writing anything.**

`listGranotLifecycleCases(query)` — `projections.ts:420` — already:

- accepts `kind?: "booking" | "release"`, `state`, `mode`, `source_id`, `normalized_job_no`, `opened_from`, `opened_to`, `cursor`, `limit`, `sort`, `order`;
- defaults `sort` to `last_evidence_at`, which is exactly this pack's `activity_at` for both intake panes;
- queries `getGranotBookingReconciliationCaseModel()` and `getGranotReleaseReconciliationCaseModel()` **in parallel** and merges them behind **one** cursor;
- returns `GranotLifecycleCaseListItem` carrying `kind`, `state`, `mode`, `normalized_job_no`, `job_no`, `source`, `masked_contact_label`, `latest_action`, `evidence_count`, `deterministic_booking`, `opened_at`, `last_evidence_at`, `resolved_at`.

So `intakes.service.ts` is a **window-and-capability adapter**, not a query implementation.

Other state to confirm:

- `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` is a real named flag in the health projection — `projections.ts:1301`. ODR-35's `capabilities.cancellation_intakes` is gated on it.
- Granot **Unit 27** (release owner commands: cancellation, booking update, no-action) is **blocked**. Release case detail is therefore **read-only**. Booking cases have their full owner workflow from Units 24–25 at `POST /api/v1/admin/granot-lifecycle/booking-cases/:id/{confirm-booking,update-booking,no-action}`.
- The existing case detail page is `app/(dashboard)/ingestion/granot/lifecycle/cases/[caseId]/page.tsx`, and `/ingestion/granot` is **already** in `OWNER_ONLY_PAGE_PREFIXES`. The handoff target needs no new authorization.
- `GET /api/v1/admin/granot-lifecycle/cases/:case_id/candidates` (`granot-lifecycle-admin.routes.ts:243`) is the candidate lead search the Owner asked for. **It already exists on the case detail page. It needs no new work.**
- `vantage-main-server` is Express behind `api/index.ts` on Vercel; every request is a separate serverless invocation. Producers — the Granot webhook lambda, the lifecycle queue consumer, the crons — share **no** process memory with an invocation holding a browser connection.

## 5. Locked decisions and invariants at risk

- **No `EventEmitter`, no module-level response registry, no `socket.io`.** Full spec §4.1 is binding and the reason is architectural, not stylistic: those mechanisms will appear to work in `pnpm dev` and will silently deliver nothing in production. Ship the cursor poll.
- **No SSE in this issue.** ODV-I owns it, and only if a measured 3-second poll proves insufficient. The seam is designed for it here; the transport is not.
- **`useDailyFeed()` is the only transport seam.** Every component consumes the hook; **nothing** consumes the fetcher or the query directly. This single rule is what makes ODV-I a transport swap instead of a redesign — reduced spec §10.
- **`DailyFeedEvent` is imported from ODR-35's `types.ts`, never re-declared.**
- **Idempotent by construction.** The client keys on `event.id`. A retried or duplicated poll **replaces**, never appends. Existing rows never reorder.
- **Never blank a populated pane because a poll failed.** Keep the last good data, say how old it is, offer a retry.
- **Release Reconciliation are `not_activated`, never `not_built`.** Reduced spec §2.2. Copying the full spec's "Release Reconciliation lands in Unit 26" panel is a factual error — that unit is complete.
- **Release cases are read-only until Granot Unit 27.** The Intakes tab links to their detail; it must not render or imply a resolve action for them.
- **The Intakes tab hands off; it does not embed.** Full spec §0.8. Confirming a booking is exact-cent data entry with revision guards, an `Idempotency-Key`, and a draft-preserving `409`. A cramped overlay is the wrong container for a form whose failure mode is losing typed work, and duplicating it would fork the concurrency logic that most needs not to be forked.
- **Tab badges count only things needing action.** Open intakes, yes. "Leads exist", never.
- **The live indicator is honest about its own state.** A board that silently stops updating is worse than one that never claimed to.
- This issue is read-only. Its only writes are the ones the Owner performs after navigating away to an existing, already-gated Granot endpoint.

## 6. Deliverables and exact contract

### 6.1 `src/services/ownerDaily/intakes.service.ts`

```ts
export type DailyIntakeRow = {
  case_id: string;
  kind: "booking" | "release";
  state: "open" | "resolved";
  mode: string;
  job_no: string;
  normalized_job_no: string;
  source_label: string | null;
  masked_contact_label: string;      // straight from the projection
  latest_action: "priority_5" | "booked" | "release";
  evidence_count: number;
  deterministic_booking: { present: boolean; masked_ref?: string };
  opened_at: string;
  last_evidence_at: string;          // the bound
  age_seconds: number;               // computed server-side against window.to
  detail_href: string;               // "/ingestion/granot/lifecycle/cases/<id>?return=…"
  resolvable: boolean;               // false for kind "release" until Granot Unit 27
};

export async function listDailyIntakes(input: {
  window: DailyWindow;
  kind?: "booking" | "release";
  state?: "open" | "resolved";
  cursor?: string;
  limit: number;
}): Promise<{
  items: DailyIntakeRow[];
  next_cursor: string | null;
  capability: DailyPaneCapability;
  counts: { open: number; oldest_opened_at: string | null };
  window: DailyWindowEcho;
}>;
```

Implementation constraints:

- **Delegate to `listGranotLifecycleCases`.** Map the window onto its `opened_from` / `opened_to`, or bound on `last_evidence_at` if the projection's sort field is used — whichever is correct against the projection as it actually reads at implementation time. Verify, do not assume.
- **Open cases are never hidden by the window.** A case opened four days ago and still open is *the* thing the Owner needs to see on a 12h board. Rule: `state: "open"` rows are returned regardless of window; `state: "resolved"` rows are window-bounded on `last_evidence_at`. Sort open-first, then by `last_evidence_at DESC`. **This is a deliberate departure from the pack's uniform windowing and must be stated in the `window` echo's `activity_field` as `"last_evidence_at (open cases unbounded)"`.**
- **Check the capability before querying.** When the relevant flag is off, return `capability` with the `not_activated` state, `items: []`, and `counts.open: 0`. The Admin renders the reason.
- `resolvable` is `false` for every `kind: "release"` row for as long as Granot Unit 27 is unlanded. Derive it from a single named constant, not scattered literals, so flipping it later is one edit.

### 6.2 `src/services/ownerDaily/feed.service.ts`

```ts
export async function listDailyFeed(input: {
  window: DailyWindow;
  since?: Date;        // watermark, NOT a page cursor
  limit: number;
}): Promise<{
  events: DailyFeedEvent[];
  cursor: string;      // ISO of the newest event_at, or `since` when empty
  counts: { open_booking_intakes: number; open_cancellation_intakes: number };
  window: DailyWindowEcho;
}>;
```

Seven bounded indexed queries via `Promise.all`, each `limit 50`, each floored by `window.from`:

| Source | Predicate |
| --- | --- |
| `granot_observation_receipts` | `captured_at > since` |
| `synchronization_decisions` | `decided_at > since` |
| `form_leads` | `timestamp > since` |
| `call_leads` | `timestamp > since` |
| `booked_leads` | `timestamp > since` |
| `cancelled_leads` | `createdAt > since` |
| reconciliation cases | `last_evidence_at > since` — **one** `listGranotLifecycleCases` call covering both kinds |

Then normalize each to `DailyFeedEvent`, merge-sort by `(event_at DESC, id DESC)`, truncate to `limit`, and set `cursor` to the newest `event_at`.

On first load `since` is absent and `window.from` bounds it. Thereafter `since` is seconds old and every query returns nothing — which is the steady state this design is optimized for.

`counts` powers the tab badges without a second request.

### 6.3 Routes

Added to `src/routes/owner-daily-admin.routes.ts`. Same Owner-only gating, same envelope, same validation module.

```text
GET /api/v1/admin/owner-daily/intakes  ?window&kind=booking|release&state=open|resolved&cursor&limit
GET /api/v1/admin/owner-daily/feed     ?window&since=<iso>&limit
```

`since` validates as an ISO instant and is rejected if it is in the future or older than `window.from` by more than the window length — a stale client must not be able to request an unbounded scan.

**One `/intakes` route, not two.** The projection already takes `kind`; two routes differing only in a constant would be duplication.

### 6.4 Admin — Intakes tab

`components/daily/intakes-tab.tsx`, segmented `Booking | Cancellation`, open cases first.

```text
[ Booking ③ │ Cancellation ① ]              3 open · oldest 4h 12m

Opened  Job       Source            Evidence        Suggested lead    Age     
6:02    P5562401  Best Relocation   Booked (2)      R•••• M••••       10m    [ Open → ]
4:41    P5562388  Top10 Forms       Priority 5 (1)  — ambiguous       1h31m  [ Open → ]
2:00    P5562344  Best Relocation   Booked (1)      K•••• W••••       4h12m  [ Open → ]
```

- `[ Open → ]` routes to `/ingestion/granot/lifecycle/cases/:id?return=/daily?tab=intakes`. **Not a drawer.**
- The case detail page must honour `?return` with a visible breadcrumb back to `/daily`. If it does not already, adding that is in scope for this issue and is the only change permitted to that page.
- A `kind: "release"` row renders `[ View → ]` rather than `[ Open → ]`, with a note that release resolution arrives in Granot Unit 27. Do not render a disabled resolve button that implies the Owner is missing a permission.
- When a half's capability is not `available`, render `<PaneCapability>` from ODR-35 with the exact flag name — **never** an empty table.
- `masked_contact_label` is used as-is from the projection. The §2.3 full-name decision does **not** extend here: the case projection is shared with the existing lifecycle UI and its masking must not be altered for this tab.

### 6.5 Admin — the live feed

`lib/query/ownerDailyFeed.ts`:

```ts
export function useDailyFeed(window: DailyWindowMode): {
  events: DailyFeedEvent[];
  counts: { open_booking_intakes: number; open_cancellation_intakes: number };
  status: "live" | "paused" | "reconnecting" | "off";
  last_success_at: number | null;
  retry: () => void;
};
```

- TanStack Query, `refetchInterval: 3000` while the document is focused, `refetchIntervalInBackground: false`.
- Back off to **15s** after five minutes with no Owner interaction, and to **60s** when the document is hidden.
- Maintain the merged event list in the query cache **keyed on `event.id`**, capped at a bounded length. A duplicate id replaces in place; existing rows never reorder.
- The window mode is part of the query key, so switching 12h/24h/48h is a clean cache boundary and resets the watermark.
- An `off` state exists and is user-togglable.

`components/daily/live-indicator.tsx` renders exactly four states:

```text
● Live · 2s ago          polling, focused
◌ Paused (background)    document hidden, backed off
⚠ Reconnecting…          last poll failed, retrying      [ Retry now ]
○ Live off               the Owner switched it off
```

Wiring:

- The Today tab's two event columns (leads, Granot events) become the same `DailyFeedEvent` list filtered by `kind`, replacing ODR-35's static `super_recent` render. New rows fade in with a ~1.5s highlight.
- Tab badges read from `counts`.
- On a failed poll: keep the last good data, show `⚠ Reconnecting… showing data from 6:09 AM (2m ago)` with a retry. **Do not blank the pane.**

## 7. Explicitly out of scope

- **SSE, `EventSource`, any streaming route handler** — ODV-I, and only on measured evidence.
- Any push broker: Ably, Pusher, Upstash, Mongo change streams.
- Conversation events in the feed, a Conversations tab, the `⚠ n conversations failed` NEEDS YOU item — **ODV-D/E**, cut from this pack.
- Agent metrics — **ODV-F**, cut.
- Release owner commands — **Granot Unit 27**.
- Discrepancy panes — **Granot Unit 29**.
- Reimplementing candidate lead search, the confirm-booking form, revision guards, or idempotency handling. All of it exists on the case detail page.
- Any change to the case detail page beyond honouring `?return`.
- Leads and Completed tabs and the drawer — **ODR-36**.

## 8. Flags and runtime posture

- No new flag. Live polling is on by default with a client-side off switch.
- Granot lifecycle flags are read only and unchanged.
- **With both case flags false**, the Intakes tab renders two `not_activated` panels naming `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` and `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED`, the badges show no count, and the feed still runs and still delivers receipts, decisions, leads, bookings, and cancellations. That is the expected day-one posture and it is a test.

## 9. Migration and indexes

**None expected.**

The feed's seven predicates are covered by the four ODR-35 window indexes plus the `captured_at` / `decided_at` / `last_evidence_at` indexes declared by Granot Units 02–04, 07, 22–23, and 26. **Verify each of the seven with an `explain()` on the test database and record the winning plan in the completion handoff.** If one is missing, add it to `scripts/migrations/owner-daily-indexes.ts` report-first with a collision report. A collection scan on a 3-second poll is the one performance failure this design cannot absorb.

## 10. Acceptance criteria

- [ ] The Intakes tab renders booking **and** release cases, correctly segmented, open first.
- [ ] With `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` false, the Cancellation half renders `not_activated` naming that exact flag. It is **never** `not_built` and never an empty table.
- [ ] With `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` false, the Booking half does the same with its flag.
- [ ] An intake case opened four days ago and still `open` **appears** on a 12h board. A case resolved four days ago does **not**.
- [ ] The `window` echo for `/intakes` states `activity_field` as `"last_evidence_at (open cases unbounded)"`.
- [ ] `[ Open → ]` on a booking case lands on `/ingestion/granot/lifecycle/cases/:id?return=/daily?tab=intakes` and the page shows a working breadcrumb back.
- [ ] A release row offers `[ View → ]` and no resolve action; `resolvable` is `false` for every release row.
- [ ] `listDailyIntakes` delegates to `listGranotLifecycleCases`. `grep` confirms no direct query against either reconciliation case model was added under `src/services/ownerDaily/`.
- [ ] `GET /feed` with no `since` returns events bounded by `window.from`; a second call with the returned `cursor` returns an empty `events` array and the **same** cursor.
- [ ] Delivering the same event twice replaces it in the client list rather than appending. Assert on list length and on stable ordering.
- [ ] Existing rows never reorder when new events arrive.
- [ ] `DailyFeedEvent` is imported from `src/services/ownerDaily/types.ts`. No second declaration exists in the repository.
- [ ] **No component imports the feed fetcher or the feed query key directly.** Every consumer goes through `useDailyFeed()`. This is verified by `grep`, and it is the ODV-I precondition.
- [ ] The live indicator renders all four states, driven by real conditions: focused, hidden, a forced failed poll, and the off toggle.
- [ ] A failed poll leaves the previously rendered data on screen with an age and a retry. The pane does not blank.
- [ ] Switching 12h/24h/48h resets the watermark and refetches cleanly with no duplicated or dropped events.
- [ ] `explain()` output for all seven feed predicates shows an index scan, not a collection scan.
- [ ] No `EventEmitter`, module-level response registry, `socket.io`, `EventSource`, or Mongo change stream exists anywhere in the diff.
- [ ] A non-Owner admin session receives 403 from the server **and** is blocked by `canProxyVantagePath` for both new endpoints, proven independently.
- [ ] No Command, `EntityChange`, revision transition, outbox row, case, or notification is produced by any request in this issue.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/ownerDaily/intakes.service.test.ts` — both kinds returned; the open-case-unbounded rule as a **named test**; each flag off produces the exact `not_activated` capability; `resolvable` false for release.
- `src/services/ownerDaily/feed.service.test.ts` — watermark semantics (a second call with the returned cursor is empty and idempotent); merge ordering across all seven sources; `since` rejected when in the future or beyond the window floor; `counts` matches the intake service for the same state.
- `src/routes/owner-daily-admin.routes.test.ts` — extended: Owner-only gating on both new routes, `since` validation, envelope parity.
- Admin: `useDailyFeed` dedupe-by-id and no-reorder under a replayed poll; all four indicator states; backoff on hidden document; window switch resetting the watermark; the `not_activated` renderer for each half.

Zero-mutation proof as in ODR-35, extended to both new endpoints, and run **while the poll is active** for at least one minute — a 3-second poll that writes anything would show up here and nowhere else.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database. With the board open, insert a synthetic receipt, a synthetic lead, and a synthetic booking into the test database and verify each appears within three seconds without a refresh, in the correct column, without reordering existing rows. Force a poll failure and verify the degraded banner keeps the last good data. Open a booking case from the tab and confirm the breadcrumb returns to `/daily?tab=intakes`. Capture deployment ids and the seven `explain()` plans.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Set the feed's `refetchInterval` to `false` and render the indicator as `○ Live off` — that stops all polling load in one edit without touching the rest of the board. Then remove the Intakes tab component from `daily-shell.tsx`, which restores the ODR-35 placeholder. Then remove the two routes and the two services. Nothing was written and no index was added, so there is nothing to reverse.

## 14. Required completion handoff

Report: files added; test and typecheck output for both repositories; preview deployment ids; the seven feed `explain()` plans; the named open-case-unbounded test output verbatim; `grep` evidence that `DailyFeedEvent` has one declaration, that no component bypasses `useDailyFeed()`, that no direct reconciliation-case query was added under `ownerDaily/`, and that no push-broker or `EventEmitter` mechanism exists in the diff; and explicit confirmation that no Granot flag changed and no mutation occurred during a sustained poll.

**Unblocks:** ODV-I becomes a pure transport swap behind `useDailyFeed()`. ODV-G extends `intakes.service.ts` with richer filters. Granot Unit 27 flips `resolvable` for release rows at one named constant.
