# Session story-observability-operational-reports-2026-09-06T0211Z

- Date (UTC): 2026-09-06T02:11Z
- Service / module: `observability` / `operationalReports.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/192

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 26 / 1 / 11
- Recommendations on disk: 189
- Current service / next module (TRAVERSAL): `observability` (in-progress) / `operationalReports.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-222e` with a stale seed (NOW pointed at `operationalIncident.service.ts` / 187 recs / PR #189). Checked out `docs/story-refactor` at `0ca9363` before choosing the module. Disk already had 189 recommendations through `observability-admin-observability.md`, lock none, `observability` in-progress, next `operationalReports.service.ts`. PR #191 was already merged.

## This pass

- opened new service?: no
- path or skip: recommended `operationalReports.service.ts` → [recommendations/observability-operational-reports.md](../recommendations/observability-operational-reports.md)
- operations named: run the named Observational report for this window (`runOperationalReport`: refuse unknown key / backwards window / >90 days; write `running`; count reportable happenings; `$sort` then `$limit` then `sortRows`; hash; watermark; `completed` or `failed` then rethrow; second run still inserts); show the report-run desk (list strips `result`); open one report run; download this report run as CSV (`result.rows` or daily-owner as one row; `csv_export_path` never written). Catalog / cite seams: `OPERATIONAL_REPORT_KEYS` / `isOperationalReportKey` / `computeResultHash`. Not leftover overview, leftover digest, leftover Google Reporting, leftover email.
- remaining in this service: `notificationDigest.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 26 / 1 / 11
- Current service / next module: `observability` (in-progress) / `notificationDigest.service.ts`

## Messages posted

- 2026-09-06T0211Z next-run

## Ideas parked

- none

## Contradictions

- No `docs/knowledge/services/` Observability Service. Rule `.cursor/rules/observability-service.mdc` is the software map.
- `timezone` is stored and hashed; aggregations use Date instants only. `granularity` is hardcoded `day`.
- `database_scope` is hardcoded to the live Admin browse scope.
- `include_resolved: false` gates daily-owner `resolved_incidents` with open/acknowledged, so that count is almost always 0.
- Daily-owner `executive_status` is live open Incidents, not period-scoped. Leftover digest asks leftover overview, not this key.
- `notification-delivery-summary` ignores event filters but still hashes them.
- Watermark counts every happening in the window, not `reportable: true`.
- `observability-review-report.md` finding 10 is stale (`include_resolved` is used on daily-owner Incident counts).
- Tests cover hash helpers only. No run / list / detail / CSV / named-count interface tests.
- This checkout’s `CONTEXT.md` does not define Observational report. `docs/adr/` is absent.
