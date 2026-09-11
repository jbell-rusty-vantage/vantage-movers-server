# Session story-job-number-timeline-projector-2026-09-11T0223Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `projector.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 302 (through `job-number-timeline-assemble.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `projector.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-projector.md`
- operations named: stamp each assembled event with dual clocks, stage, evidence, and correlation; group related rows into activities so an observation wave stays together and official Booking / official Cancellation / lead created keep their own activity; link cause and result inside each activity; cap at 250 later events and name `TIMELINE_TRUNCATED`; ask current outcome, stages, attention, freshness, and limitations, then stamp the owner-facing v2 page
- remaining in this service: `clocks.ts`, `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `clocks.ts`

## Messages posted

- 2026-09-11T0223Z next

## Ideas parked

- `v2.test.ts` / `evaluators.test.ts` lock wrap + evaluator proofs through `module.read`, not `projectEnhancedPage`
- Missing `now` + empty events → epoch `assembled_at`; module always passes `now`
- Same-wave join is exact string equality of `event_at` / `requested_at` to decision or observation clock
- Lead created never joins the observation wave; official Booking and official Cancellation keep independent activity ids
- Evaluators run on kept events only — cap before the **asks**
- `originLabel` falls through to `proof_shape` after source labels
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module proofs are not the projector **interface**
- Epoch `assembled_at` vs module-injected `now`
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Sheet Sync / Granot Observation Receipt / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
