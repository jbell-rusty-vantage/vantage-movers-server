# Session story-routes-job-number-timeline-admin-2026-09-11T1621Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `job-number-timeline-admin.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 316 (through `routes-granot-lifecycle-admin.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `job-number-timeline-admin.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-job-number-timeline-admin.md`
- operations named: hand at most three recent official Booking Job Numbers (Owner sample, registered first, never module.read); tell the owner-facing chain for the typed Job Number (Owner, Zod then module.read, closed assembler statuses stay HTTP 200) — never put this desk before the secret, never assemble here, never call the forensic Granot job page, never catalog, never mutate, never echo an unhandled throw
- remaining in this service: `conversations-admin.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `conversations-admin.routes.ts`

## Messages posted

- 2026-09-11T1621Z next

## Ideas parked

- This desk sits after `/api/v1` secret; Drive / extension login sit before. Do not remount `requireApiSecret`.
- `/recent-official-bookings` must stay registered before `/job-number-timeline`.
- Zod `400` `invalid_job_number` is not assembler `invalid_job_number` (HTTP 200).
- `sendError` uses `code: registryCode` + `request_id`; does not remap to Granot `OWNER_REQUIRED` or v1 `toHttpBody()`.
- Default live path must ask `module.read`, not `assemble.ts` (redact + company-granularity mismatch live on the module).
- Default sample path must ask `listRecentOfficialBookingExamples`, not `module.read`.
- Operator skill misses `GET .../recent-official-bookings`. Folder `v1.routes.test.ts` lists none of this desk.
- Admin is 403 on both paths; this desk has no read-actor hatch.
- This checkout has no `docs/adr/`, no `docs/job-number-timeline/` pack, and no `daily-operations-admin.routes.ts`.

## Contradictions

- Operator skill / `v1.routes.test.ts` miss recent-official-bookings
- Zod 400 vs assembler 200 `invalid_job_number`
- Third refuse shape (`code` + `request_id`) vs Granot remap vs v1 `registry_code`
