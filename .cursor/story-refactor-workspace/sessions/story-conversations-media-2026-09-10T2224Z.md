# Session story-conversations-media-2026-09-10T2224Z

- Date (UTC): 2026-09-10
- Service / module: `conversations` / `media.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 38 / 1 / 3
- Recommendations on disk: 298 (through `conversations-redaction.md`)
- Current service / next module (TRAVERSAL): `conversations` (in-progress) / `media.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/conversations-media.md`
- operations named: put the private mp3 in the locker under the recording id; issue the five-minute get-only listen URL for that pathname
- remaining in this service: `seedFromArtifacts.ts`

## Stock at end

- Visited / in-progress / unvisited: 38 / 1 / 3
- Current service / next module: `conversations` (in-progress) / `seedFromArtifacts.ts`

## Messages posted

- 2026-09-10T2224Z next

## Ideas parked

- Spec §7.6 `contentUri` re-resolve and §5.5 / §5.7 vet / janitor stay parked — do not implement in the rename
- Stored `media.blob_url` from private `put` stays a seed-pass question
- Rows 40–42 (`extensionUsers`, `jobNumberTimeline`, `tariff`) stay unvisited until `conversations` is visited
- Disk also has unlisted `dailyOperations`; do not open it while `conversations` is in-progress

## Contradictions

- Spec §7.6 says this file persists `call_log_id` and re-resolves `contentUri`; the file does neither
- Spec §5.5 vet-before-paying and §5.7 janitor are not this file
- Seed stores `media.blob_url`; opened card omits it
- No `media.test.ts`; route stubs the issue beat
- Five-minute listen TTL vs thirty-day put cache
- Knowledge links [Lead Conversation](CONTEXT.md); this checkout’s `CONTEXT.md` does not define it; `docs/adr/` is absent
