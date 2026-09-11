# Session story-job-number-timeline-attention-2026-09-11T0622Z

- Date (UTC): 2026-09-11
- Service / module: `jobNumberTimeline` / `attention.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 40 / 1 / 1
- Recommendations on disk: 306 (through `job-number-timeline-outcome.md`)
- Current service / next module (TRAVERSAL): `jobNumberTimeline` (in-progress) / `attention.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/job-number-timeline-attention.md`
- operations named: name the ten §8 attention codes (unresolved Lead; resolved Booking or Cancellation case without an official fact; orphan Cancellation without a durable snapshot; official Cancellation whose Booking document is gone; live Sheet job older than one hour or terminally failed; contradictory official clocks via sibling `officialFactsContradict`; disagreeing source scopes; claimed applied Decision without its EntityChange); always name multi-query read, move completion unavailable, and Google destination unverified; keep a named 250-cap truncation; name a missing WordPress receipt (Granot does not clear it) and a RingCentral cursor bound; stamp freshness including cursor lag; say whether there is a processing evidence gap so projector can hand the boolean into `assessStages`
- remaining in this service: `mongo-evidence-loader.ts`, `recent-official-bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 40 / 1 / 1
- Current service / next module: `jobNumberTimeline` (in-progress) / `mongo-evidence-loader.ts`

## Messages posted

- 2026-09-11T0622Z next

## Ideas parked

- `evaluators.test.ts` locks §8 codes through `module.read`; it imports only `SHEET_SYNC_PENDING_TOO_LONG_MS`
- `OFFICIAL_BOOKING_UNAVAILABLE` (attention) is not sibling stage reason `BOOKING_UNAVAILABLE_AFTER_CANCELLATION`
- Orphan cancel (no snapshot) vs snapshot-only cancel (official cancel + booking unavailable) are different codes
- Processing gap is one beat, two exports — projector injects the boolean into `assessStages`
- WordPress limitation clears only on WordPress ingress, not a later Granot receipt
- Always-on limitations are not events or stages; Sheet `synced` is not Google equality
- Do not open `tariff` or Wave B while this checklist has unchecked modules
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 41–42 remain

## Contradictions

- Module proofs are not the attention **interface**
- Attention code vs booking-stage reason for snapshot-only cancel use different strings on purpose
- Knowledge links Job Number / Form Lead / Call Lead / Booking / Cancellation / Sheet Sync / WordPress Form Submission Receipt; this checkout’s `CONTEXT.md` does not define them; `docs/adr/` and `docs/job-number-timeline/` are absent
