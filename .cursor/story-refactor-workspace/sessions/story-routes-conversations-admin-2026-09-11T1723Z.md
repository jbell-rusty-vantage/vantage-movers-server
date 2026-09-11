# Session story-routes-conversations-admin-2026-09-11T1723Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `conversations-admin.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 317 (through `routes-job-number-timeline-admin.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `conversations-admin.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-conversations-admin.md`
- operations named: show the newest conversations without the words (Owner desk list, never getById); show this Lead’s conversations the same way (Owner Lead drawer, Zod then listByLead, junk id is empty); issue a five-minute listen URL and write who listened (Owner play, registered before /:id, 404 / 409 / audit after sign); open one conversation with the already-redacted transcript (Owner opened card, load then toConversationDetail, never issue) — never put this desk before the secret, never paint words on the list, never sign before load, never embed a forever blob link, never discover or attach, never seed, never write the Lead
- remaining in this service: `extension-users-admin.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `extension-users-admin.routes.ts`

## Messages posted

- 2026-09-11T1723Z next

## Ideas parked

- This desk sits after `/api/v1` secret; Drive / extension login sit before. Do not remount `requireApiSecret`.
- `by-lead` and `audio-url` must stay registered before `/:id`.
- Load vs paint is load-bearing: audio-url and detail share `getConversationById`; only detail asks `toConversationDetail`.
- `404` `conversation_not_found` is not `409` `conversation_audio_unavailable`.
- Audit is after a successful sign, not on 403 / 404 / 409.
- Spec §5.9 says `writeAuditLog`; the file asks `recordOperationalEvent`.
- Unhandled `500` echoes `error.message` and does not log (unlike Job Number timeline `"Internal error"`).
- Operator skill and the host rule omit all four conversation paths.
- Admin is 403 on all four paths; this desk has no read-actor hatch.
- Deferred spec mutations (`discover` / `retry` / `detach` / `attach`) stay off this desk.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.

## Contradictions

- Spec `writeAuditLog` vs `recordOperationalEvent`
- Unhandled 500 echoes `error.message` vs Job Number timeline `"Internal error"`
- Host rule / operator skill omit the four Owner conversation routes
