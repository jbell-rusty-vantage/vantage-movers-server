# Session story-crm-form-lead-payload-2026-08-28T0725Z

- Date (UTC): 2026-08-28T07:25Z
- Service / module: `crm` / `formLeadPayload.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/87

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 14 / 1 / 23
- Recommendations on disk: 83
- Current service / next module (TRAVERSAL): `crm` (in-progress) / `formLeadPayload.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/crm-form-lead-payload.md`
- operations named: map the already-saved Form Lead onto the Granot wire; encode the Granot Form Lead as urlencoded; mask the Granot payload for operator logs
- remaining in this service: none (`crm` visited)

## Stock at end

- Visited / in-progress / unvisited: 15 / 0 / 23
- Current service / next module: `leadMessaging` (unvisited) / enumerate `src/services/leadMessaging/` first

## Messages posted

- 2026-08-28T0725Z next-run

## Ideas parked

- none

## Contradictions

- Header comment claims `CRM_SOURCE_LABELS` / call-lead labels; this file never resolves them
- Name peel ignores stored `first_name` / `last_name` (already on CONTRADICTIONS via leads-lead-name)
- Wire-map test uses local `new Date(2026, 5, 1)` while the date fold is UTC
- Knowledge links ADR-0002; `docs/adr/` is absent on this checkout
- Sheet Sync still runs before the post (Form Lead Ingestion; out of scope)
