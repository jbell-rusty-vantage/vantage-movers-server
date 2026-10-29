# Serve Reporting previews, immutable revisions, confirmed runs and destination commands

- Status: recommended; source-verified 2026-10-29.
- Target: `src/routes/reporting.routes.ts`
- Domain: `docs/knowledge/services/reporting.md`.
- Source evidence: `src/app.ts`, `src/services/reporting/reporting.service.ts`, `src/services/reporting/reportingDestination.service.ts`, `src/services/reporting/reportingRunRepository.ts`.

## Current operations and seams

The router mounts `/api/v1/admin/reporting` with `requireApiSecret`. In `app.ts` it follows v1 and ingestion routers, so preserve its own guard and the existing parent mount order. Reads use `requireRegistryReadActor`; writes use `requireRegistryOwnerActor`, converted to DurableActor. Google destination mutations and new runs check the delivery flag; preview, revision save, clone, definition archive and cancel remain available independently.

Preview, immutable revision save and estimate/confirm are service-owned operations. `/definitions/:id/run` returns 202 for queued status and ordinary 200 for estimate/other status. Audit distinguishes run_estimate, run_confirmation replay and run_queue. Preserve idempotency/confirmation inputs; do not split the URL or move the service transaction into HTTP. Definition-specific preview checks an active definition but previews the supplied draft, not its current frozen revision.

Destination archive exists as both `POST /destinations/:id/archive` and `DELETE /destinations/:id`, with expected_version. Preserve both aliases and stale-version behavior. Clone can answer “Definition not found” when the revision is missing; definition archive requires active state. Run cancel requires its idempotency key, returns 200 and best-effort publishes a wakeup; it does not adopt heartbeat's unpublished→503 policy.

## Error and read contracts

`serializeReportingRouteError` maps Zod to 400 with issues, ReportingError to its status/code/message and RegistryError to `toHttpBody`. AppError below 500 retains status/code/message (destination not found is a 404); AppError at least 500 retains status but uses `reporting_internal_error` / “Reporting request failed”. InvalidReportingObjectIdError is 400 `invalid_object_id`. ReportingGoogleDeliveryDisabledError is 503 `reporting_google_delivery_disabled`; incomplete workbook safety is 503 `reporting_workbook_safety_unconfigured`. Unexpected errors use the fixed safe 500. The old recommendation that all destination AppErrors become 500 is obsolete.

Run reads apply safe failure envelopes, remove execution_package.destination, and expose artifact-safe progress instead of row payloads. Definition revisions still return destination_snapshot; preview reads exclude their destination snapshot/sample token. Preserve the real distinct shapes during a rename rather than silently broadening redaction.

## Remaining cleanup and proof

Name adapters around preview/save/estimate-confirm, destination administration and safe run reads. Keep policy, query execution, provider adapters and leased worker out of this router. The exported error/read helpers currently support existing tests; retain aliases until their callers migrate. Inspect `src/services/reporting/reporting.test.ts` and route tests for exact current assertions. Needed parity includes Owner/Admin access, flag-off cancel, estimate versus queued status, both archive aliases/version checks, safe AppError serialization and read redaction. Reading these suites is not execution evidence; this review ran no runtime tests.
