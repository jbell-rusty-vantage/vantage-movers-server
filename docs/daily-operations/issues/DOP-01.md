# DOP-01 — Models, writer, Redis client

> **Contract maturity: implementation-ready.** Session 1. Persist Daily
> Operations Events and increment the day document. **No HTTP. No Admin
> UI. No domain hooks.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §10–13, §21. Wins on models, writer, Redis client.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **ADR:** `docs/adr/0001-mongodb-system-of-record.md`
- **Pattern:** `getObservabilityModel` / `recordOperationalEvent` (never-throw after-commit)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

A caller can record one Daily Operations Event. If the `dedupe_key`
insert wins, the matching day document `$inc`s. Redis `XADD` is
best-effort and never changes the book. The test runner never writes
Redis.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** `daily-operations` if isolating; otherwise the current
  server desk branch. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- No 21st.dev in this issue.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- No `DailyOperationsEvent` / `DailyOperationsDay` models.
- No `src/services/dailyOperations/` module.
- No `@upstash/redis` in `package.json`.
- Observability factory in `src/models` / `getObservabilityModel` is
  the registration pattern to copy.
- `recordOperationalEvent` is the never-throw after-commit pattern.
- Local `.env` already has `KV_REST_API_URL` / `KV_REST_API_TOKEN`
  (do not log or commit them).

## 5. Locked decisions and invariants at risk

- Mongo is the book. Redis is a doorbell. No Redis `INCR`.
- Insert-on-`dedupe_key` is the increment gate.
- Closed day: skip `$inc`, keep the event, `metric_touches: []`.
- Test runner / `TEST_MODE=true` → no Redis writes.
- Factory uses test collection names when the test runner is active.
- Writer never throws into the domain caller.

## 6. Deliverables and exact contract

1. `pnpm add @upstash/redis`.
2. `src/config/domain/dailyOperations.ts` — `getDailyOperationsRedis()`
   reading `UPSTASH_REDIS_*` or `KV_REST_API_*` (spec §11.1).
3. Models + factory for `daily_operations_events` /
   `daily_operations_days` (test prefixes). Indexes in spec §12.
4. Closed `DailyOperationsKind` catalog in `kinds.ts` including
   `text.deferred` and exception kinds.
5. `recordDailyOperationsFact` — insert, increment, best-effort XADD
   (spec §12.3). Seed known Source Company slugs and 24 hourly buckets
   on first day upsert.
6. Unit tests: insert-win, duplicate-key no increment, closed-day skip,
   Redis failure swallowed, no Redis in test runner, Eastern midnight
   day key.

## 7. Out of scope

- Any route or cron (DOP-04 / DOP-05).
- Any domain hook (DOP-02 / DOP-03).
- Any `vantage-admin` file.
- Knowledge Service body (DOP-08).

## 8. Tests

Spec §19 writer / day-key rows. Add focused cases next to the new
module. Do not hit the real Upstash project.

## 9. Knowledge updates after this issue ships

None required. DOP-08 / docs-keeper owns the Service pointer.

## 10. Acceptance criteria

- [ ] Unique `dedupe_key` insert increments the named `metric_touches`.
- [ ] Duplicate `dedupe_key` is a no-op (no second `$inc`, no XADD).
- [ ] Closed day skips `$inc` and records `metric_touches: []`.
- [ ] Missing Redis client still persists the event and day increment.
- [ ] Test runner never constructs a publish that would call Upstash.
- [ ] `2026-06-01T03:00:00.000Z` maps to NY day `2026-05-31`.
- [ ] Package tests for the new module + typecheck.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/recordDailyOperationsFact.test.ts src/config/domain/dailyOperations.test.ts src/services/dailyOperations/dayDocument.test.ts
```

Plus the repo’s usual typecheck. Paste output in the completion report.

## 12. Risks

- Using the lead-model factory and leaking test writes into production
  collection names.
- Incrementing before the unique insert wins.
- Logging KV tokens.
- Treating Redis failure as an Operational Incident.

## 13. Rollback

Delete the new module, models, config, and `@upstash/redis`. Domain
write paths are untouched.

## 14. Handoff list for the completion report

- Writer function signature DOP-02 / DOP-03 should call.
- How to pass `card`, `links`, `metric_touches`.
- Redis key shape as implemented.
- What you did not do (hooks, HTTP, Admin).

**Unblocks:** DOP-02, DOP-03, DOP-04.
