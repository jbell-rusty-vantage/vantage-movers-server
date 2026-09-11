# Session story-job-number-timeline-clocks-2026-09-11T0323Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `clocks.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 303 (through `job-number-timeline-projector.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `clocks.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-clocks.md`
- operations named: keep the assembled occurred clock, then pick recorded from the loaded receipt / observation / processed call / lead / message / booking / cancellation / sheet job and name capture vs domain vs provider vs storage-fallback precision; order by occurred, then type priority, then id
- remaining in this service: `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `evidence.ts`

## Messages posted

- 2026-09-11T0323Z next

## Ideas parked

- `v2.test.ts` locks dual clocks through `module.read`, not `selectEventTime`
- WordPress leftover field name when receipt is missing; terminal Sheet Sync records `createdAt` while occurred may be `updatedAt`
- RingCentral ingress precision is `domain`, not `capture`
- `recorded_at` typed nullable, never null
- Assemble `sortEvents` and `compareOccurredThenPriority` are two copies of occurred / type / id — do not sort by recorded
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module dual-clock proof is not the clocks **interface**
- Leftover recorded field names vs missing rows
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Sheet Sync / Granot Observation Receipt / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
