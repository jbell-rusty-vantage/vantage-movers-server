# Session story-crm-crm-service-2026-08-28T0623Z

- Date (UTC): 2026-08-28T06:23Z
- Service / module: `crm` / `crm.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/86

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 14 / 0 / 24
- Recommendations on disk: 82
- Current service / next module (TRAVERSAL): `crm` (unvisited) / enumerate `src/services/crm/` first

## This pass

- opened new service?: yes — `crm.service.ts`, `formLeadPayload.ts`, `crmConfig.ts` (skip — endpoint config), `types.ts` (skip — type-only), `index.ts` (skip — barrel)
- path or skip: recommended → `recommendations/crm-crm-service.md`
- operations named: announce that CRM Posting started; send the urlencoded Form Lead to the Granot lead gateway; remember the Granot post outcome without throwing
- remaining in this service: `formLeadPayload.ts`

## Stock at end

- Visited / in-progress / unvisited: 14 / 1 / 23
- Current service / next module: `crm` (in-progress) / `formLeadPayload.ts`

## Messages posted

- 2026-08-28T0623Z next-run

## Ideas parked

- none

## Contradictions

- Skip fabricates `ok: true`, `status: 0` in Form Lead Ingestion; this file never owns skip
- “Never throws” does not cover `recordOperationalEvent` after a good POST
- `responseText` is logged raw; the request payload is masked
- Knowledge links ADR-0002; `docs/adr/` is absent on this checkout
- Sheet Sync still runs before this post (Form Lead Ingestion; out of scope)
