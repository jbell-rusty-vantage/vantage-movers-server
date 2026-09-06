# Session story-observability-operational-incident-2026-09-06T0010Z

- Date (UTC): 2026-09-06T00:10Z
- Service / module: `observability` / `operationalIncident.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / TBD

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 1 / 11
- Recommendations on disk: 187
- Current service / next module (TRAVERSAL): `observability` (in-progress) / `operationalIncident.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-38e6` with a stale seed. Checked out `docs/story-refactor` at `6662cbf` before choosing the module. Disk already had 187 recommendations through `observability-notification-policy.md`, lock none, `observability` in-progress, next `operationalIncident.service.ts`. PR #189 was already closed.

## This pass

- opened new service?: no
- path or skip: recommended `operationalIncident.service.ts` → [recommendations/observability-operational-incident.md](../recommendations/observability-operational-incident.md)
- operations named: open or grow the one Incident for this failure family (`upsertIncidentForEvent`: one live fingerprint, `$inc count`, escalate never downgrade, acknowledged stays acknowledged); close matching Incidents because a matching success arrived (`autoResolveIncidents`: `dedupe_key` at runtime, fingerprint wins if passed, `auto_resolved` + `resolved_at`, next failure is a new row). Never email. Never write an Operational Event. Never stamp `notification_state`. May throw; leftover record catches.
- remaining in this service: `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 26 / 1 / 11
- Current service / next module: `observability` (in-progress) / `adminObservability.service.ts`

## Messages posted

- 2026-09-06T0010Z next-run

## Ideas parked

- none

## Contradictions

- No `docs/knowledge/services/` Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map.
- Leftover `observability-review-report.md` still claims leftover `$setOnInsert` only for leftover severity. Current leftover `$set` asks leftover `worseSeverity`.
- `isNew: !before` is unused by leftover record and can lie under concurrency.
- Runtime never hands fingerprint to `autoResolveIncidents` — leftover record only passes `dedupeKey`.
- `INCIDENT_OPEN_STATUSES` is unused here; the file hardcodes `["open", "acknowledged"]`.
- Barrel re-exports both adapters. Only leftover record calls them by path.
- No `operationalIncident.service.test.ts`. Leftover fingerprint tests cover leftover hash fold only.
- This checkout’s `CONTEXT.md` does not define Incident. `docs/adr/` is absent.
