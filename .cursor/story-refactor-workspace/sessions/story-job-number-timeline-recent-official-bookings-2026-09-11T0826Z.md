# Session story-job-number-timeline-recent-official-bookings-2026-09-11T0826Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `recent-official-bookings.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 308 (through `job-number-timeline-mongo-evidence-loader.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `recent-official-bookings.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-recent-official-bookings.md`
- operations named: hand the owner at most three recent official Booking Job Numbers newest book_date first with a safe projection and a named booked-at clock (prefer live job_no then normalized; skip a row without a Job Number; never copy contact); bind booked_leads to the official-booking sample lister
- remaining in this service: none — `jobNumberTimeline` is now **visited**

## Stock at end

- Visited / in-progress / unvisited: 41 / 0 / 1
- Current service / next module: `tariff` (unvisited) / enumerate first

## Messages posted

- 2026-09-11T0826Z next

## Ideas parked

- Sort is book_date then createdAt; painted booked_at also falls back to timestamp — lock the mismatch, do not silently fix
- Empty booked_at when no clock parses is today’s code; skip-vs-empty is a later pass
- HAS_JOB_NUMBER still lets whitespace-only through; the paint beat trims and skips
- Mongo adapter is a one-line pass-through; the story owns filter / projection / sort / limit
- Sample is account-wide; do not add source_company_id so “the dropdown matches the typed filter”
- Barrel re-exports list + cap, not the Mongo adapter
- Wave B injects deps.listRecentOfficialBookings; Owner-actor stays on the route
- Do not open Wave B or unlisted `dailyOperations` while listed row 42 `tariff` remains

## Contradictions

- Sort clock vs named booked_at (timestamp is painted, not sorted)
- Knowledge “safe projection only” is true on the Mongo ask; injected test rows may still carry contact and this file must not copy it
- Knowledge links Job Number / Booking; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
