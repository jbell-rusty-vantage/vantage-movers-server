# Session story-reporting-reporting-2026-09-06T0418Z

- Date (UTC): 2026-09-06T04:18Z
- Service / module: `reporting` / `reporting.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/193

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 0 / 11
- Recommendations on disk: 191
- Current service / next module (TRAVERSAL): `reporting` (unvisited) / enumerate `src/services/reporting/`

This checkout booted on `cursor/vantage-server-story-refactor-71b0` with a stale seed `NOW.md` (`observability` / `notificationDigest`). Disk on `docs/story-refactor` at `37a8282` already had 191 recommendations through `observability-notification-digest.md`. `observability` was visited. PR #193 was already open.

## This pass

- opened new service?: yes — enumerated non-test `.ts` under `src/services/reporting/` (catalog, timezone, destinations, query, worker, delivery, queue, google adapters, live harness). Skipped `catalog/types.ts` (type-only), `catalog/index.ts` (dataset catalog), `reportingAudit.ts` (audit fold), `registerStage4Foundation.ts` (bootstrap hook), `google/index.ts` (barrel), `google/fakeReportingGoogle.ts` (test fake).
- path or skip: recommended `reporting.service.ts` → [recommendations/reporting-reporting.md](../recommendations/reporting-reporting.md)
- operations named: preview this report draft (`previewReportingDraft`: live destination + 50 sample rows + keyed HMAC evidence + 15-minute preview; capacity 409); freeze this draft as an immutable revision (`saveReportingRevision`: matching unexpired preview or 409; `$inc` + CAS pointer; refuse dataset-key change); estimate this manual run (`prepareManualRun` without token: bind actor + revision + stable destination identity + query checksum; 10-minute token); confirm this manual run and queue the write (`prepareManualRun` with token: consume confirmation, insert queued run, leftover wakeup after persist; same key replays). Not leftover destinations, not leftover worker write, not leftover Analytics, not leftover Sheet Sync.
- remaining in this service: `timezone.ts` next, then leftover destination / query / worker / google / live modules on the checklist

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` (in-progress) / `timezone.ts`

## Messages posted

- 2026-09-06T0418Z next-run

## Ideas parked

- none

## Contradictions

- Success audit lives in Wave B `reporting.routes.ts`; this file audits throw only.
- `REPORTING_GOOGLE_DELIVERY_ENABLED` is a route kill switch on destination mutations and `POST .../run`, not on preview / freeze.
- Live destination checksum may differ from the frozen revision checksum; leftover lineage decides.
- Confirmation binds stable identity, not `healthVerifiedAt` / `denylistCheckedAt`.
- `revisionToQueryInput` re-resolves the Eastern window at estimate / confirm time; frozen `resolved_window` is not what leftover estimate sees.
- Wakeup `false` (local / publish fail) still returns the queued run.
- Preview returns raw `sampleRows` plus opaque HMAC evidence.
- Pointer conflict is a bare `Error`, not `reportingError`.
- List / clone / archive of definitions live in the route, not this file.
- `reporting.test.ts` does not call `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun`.
- This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets. `docs/adr/` is absent (knowledge cites ADR-0001).
