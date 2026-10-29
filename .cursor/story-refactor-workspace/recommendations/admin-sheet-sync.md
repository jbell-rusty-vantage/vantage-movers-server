# Inspect and Retry Sheet Sync Jobs

- Target: `src/services/admin/adminSheetSync.service.ts`
- Evidence: `docs/knowledge/services/sheet-sync.md`, `src/services/sheetSync/drainer/leases.ts`

Keep the health, jobs, runs, run detail and retry exports as separate public operations. Health reports pending plus retrying, failed, processing, oldest due time, backlog age and last run; listing preserves filters and pagination. Invalid run IDs return 400 and absent runs 404.

Retry defaults to failed status when no IDs are supplied; an explicit ID selection follows the current ID filter. Preserve the selected-job limit, reset fields, immediate due time, returned count and drain initiation. Do not recreate the retired Operational Events reporting service or infer a stronger status fence than the actual code applies.
