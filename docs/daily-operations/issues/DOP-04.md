# DOP-04 — Snapshot, events page, rebuild, close cron

> **Contract maturity: implementation-ready.** Session 2/4. Owner-only
> reads of the day document plus repair and close-of-day. **No SSE
> (DOP-05). No Admin UI.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §5–6, §9, §16.1, §16.3, §18.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Pattern:** Granot-lifecycle-admin router (full path +
  `requireApiSecret` + `requireRegistryOwnerActor`)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

`GET /api/v1/admin/daily-operations` returns today's tiles, origins,
companies (zeros included), hourly, yesterday + `yesterday_by_now`,
`held_now`, and `still_open` intakes. `GET .../events` pages the day.
Rebuild repairs the **open** day from domain collections. A cron
closes yesterday shortly after 00:05 America/New_York.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** DOP-01 `complete`. Hooks may still be landing;
  snapshot must return zeros when the day doc is missing.
- No 21st.dev.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- No daily-operations routes.
- Overview already lists open Granot Booking Reconciliation Cases —
  reuse that query for `still_open`.
- Cron secret pattern: sheet-sync / RingCentral
  `ALL /api/cron/...` + `CRON_SECRET`.
- `vercel.json` already has cron entries; add close next to them.
- Lead Message held query: `provider_status: "scheduled"` and
  `status: "accepted"`. The row has **no** `sendAt` column. Do not
  invent one.

## 5. Locked decisions and invariants at risk

- Pace is hourly `0..currentNyHour`, not full yesterday vs in-progress
  today.
- Missing yesterday → nulls, UI will show `—` (this issue returns null).
- Rebuild replaces counters only; events are append-only.
- Closed days are not rebuilt in v1.
- Owner-only on every method.
- `held_now` is a live query; `texts.deferred` is the day increment.

## 6. Deliverables and exact contract

1. `GET /api/v1/admin/daily-operations` body in spec §16.1.
2. `GET /api/v1/admin/daily-operations/events` (`cursor`, `lane`,
   `limit`, default 80).
3. `POST /api/v1/admin/daily-operations/rebuild` — open day only.
4. `closeDailyOperationsDay` + `ALL /api/cron/daily-operations-close`.
5. Optional 10-minute rebuild cron may wait; close cron is required.
6. Tests: snapshot zeros; pace math; company zeros seeded; closed
   yesterday not incremented; rebuild does not delete events; cron
   secret rejected without header.

## 7. Out of scope

- SSE live route (DOP-05).
- Admin page (DOP-06).
- Domain hooks (DOP-02 / DOP-03).

## 8. Tests

Spec §19 snapshot / midnight / rebuild rows. Route tests next to other
admin Owner routes.

## 9. Knowledge updates after this issue ships

None required. DOP-08 owns pointers.

## 10. Acceptance criteria

- [x] Snapshot includes `yesterday_by_now` per headline metric.
- [x] All `SOURCE_COMPANIES` slugs Daily Operations tracks appear,
      including zeros.
- [x] `wordpress_form: 0` is a valid, present key.
- [x] `intakes.still_open` is a live case count, not a day increment.
- [x] `texts.held_now` is a live scheduled-message count.
- [x] Rebuild of an open day changes counters, not event rows.
- [x] Close cron sets yesterday `status: "closed"`.
- [x] Non-owner / missing API secret is 401/403.
- [x] Focused tests + typecheck.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/snapshot.test.ts src/services/dailyOperations/rebuild.test.ts src/services/dailyOperations/closeDay.test.ts src/routes/daily-operations-admin.routes.test.ts
```

Adjust to files you add. Paste output.

## 12. Risks

- Comparing full yesterday to a half day (wrong pace).
- Rebuild deleting events.
- Forgetting company zero-seed so a silent partner vanishes.
- Using UTC midnight as the day key.

## 13. Rollback

Unmount the routes and cron. Collections may remain; they are unused.

## 14. Handoff list for the completion report

- Exact snapshot JSON example for DOP-06.
- Events cursor format for DOP-05 / DOP-07 load-earlier.
- Cron path registered in `vercel.json`.

**Unblocks:** DOP-05, DOP-06.
