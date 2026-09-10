# Session story-conversations-reads-2026-09-10T2030Z

- Date (UTC): 2026-09-10
- Service / module: `conversations` / `reads.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 38 / 0 / 4
- Recommendations on disk: 296 (through `moving-carriers-granot-carrier-code-seed.md`)
- Current service / next module (TRAVERSAL): `conversations` (unvisited) / enumerate first

## This pass

- opened new service?: yes — modules enumerated: `reads.ts` (recommended), `redaction.ts`, `media.ts`, `seedFromArtifacts.ts`, `index.ts` (skip — barrel). Tests `reads.test.ts` / `redaction.test.ts` / `seedFromArtifacts.test.ts` are evidence, not checklist rows.
- path or skip: recommended → `recommendations/conversations-reads.md`
- operations named: show the owner the newest conversations without the words; show the owner this lead's conversations without the words; load one conversation or say it is missing; paint the opened conversation with the redacted transcript and the sectioned summary
- remaining in this service: `redaction.ts`, `media.ts`, `seedFromArtifacts.ts`

## Stock at end

- Visited / in-progress / unvisited: 38 / 1 / 3
- Current service / next module: `conversations` (in-progress) / `redaction.ts`

## Messages posted

- 2026-09-10T2030Z next

## Ideas parked

- The always-applied API host rule and hit-vantage-api still omit the four Owner conversation routes — park until a human asks; do not edit those rules from this pass
- Rows 40–42 (`extensionUsers`, `jobNumberTimeline`, `tariff`) stay unvisited until `conversations` is visited

## Contradictions

- `reads.test.ts` never **asks** `listConversations` / `listConversationsByLead` / `getConversationById`; it paints a fixture and **asks** leftover `assertListProjectionSafe`
- Opened-card section split and `hasCrmMismatch` live on sibling `seedFromArtifacts.ts`; this file imports them
- Knowledge links [Lead Conversation](CONTEXT.md); this checkout’s `CONTEXT.md` does not define it; `docs/adr/` is absent
- The always-applied API host rule omits `GET /api/v1/admin/conversations*` even though `v1.routes.ts` mounts them
