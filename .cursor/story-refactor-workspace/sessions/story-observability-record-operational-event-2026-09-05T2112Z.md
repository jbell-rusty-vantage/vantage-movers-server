# Session story-observability-record-operational-event-2026-09-05T2112Z

- Date (UTC): 2026-09-05T21:12Z
- Service / module: `observability` / `recordOperationalEvent.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/187

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 0 / 12
- Recommendations on disk: 184
- Current service / next module (TRAVERSAL): `observability` (unvisited) / enumerate `src/services/observability/`

This checkout booted on `cursor/vantage-server-story-refactor-de99` with a stale seed (NOW pointed at `analytics` / `sourceHierarchy.ts` / 183 recs / PR #185). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-source-hierarchy.md`, lock none, `analytics` visited, next enumerate `observability`. PR #186 was already merged.

Opened `observability`. Enumerated every runtime `.ts` file. Skipped leftover test sink / leftover details bound / leftover identity fold / leftover request fold / leftover hash helper / leftover barrel. First story-worthy module: `recordOperationalEvent.ts`.

## This pass

- opened new service?: yes — 13 runtime modules enumerated
- path or skip: recommended `recordOperationalEvent.ts` → [recommendations/observability-record-operational-event.md](../recommendations/observability-record-operational-event.md)
- operations named: write this happening down (`recordOperationalEvent`: always pino, never throw, leftover test sink / leftover disabled / leftover `log_only` or persist + maybe Incident + maybe email; email failure writes `notification.email.failed` that must not email); write these happenings down in bulk (`recordOperationalEventsBulk`: leftover script insert, no Incident, no email, unused at runtime)
- remaining in this service: `emailNotification.service.ts`, `notificationPolicy.ts`, `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 26 / 1 / 11
- Current service / next module: `observability` (in-progress) / `emailNotification.service.ts`

## Messages posted

- 2026-09-05T2112Z next-run

## Ideas parked

- none

## Contradictions

- No `docs/knowledge/services/` Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map. Already-recommended `granotLifecycle/observability.ts` is a different catalog.
- `recordOperationalEventsBulk` is barrel-exported and unused.
- Leftover `buildRequestEventContext` computes leftover `origin` / leftover `user_agent_family`; this file never stores them.
- Leftover persist-level gate runs after `connectMongo`.
- Unit tests cannot persist: leftover test runner activates the leftover sink and leftover `allowTestObservabilityWrites` is hardcoded false.
- This checkout’s `CONTEXT.md` does not define Operational Event / Incident. `docs/adr/` is absent.
