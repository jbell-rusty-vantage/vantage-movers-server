# Session story-models-agent-2026-09-12T2018Z

- Date (UTC): 2026-09-12T2018Z
- Service / module: `models` / `Agent.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 344
- Current service / next module (TRAVERSAL): `models` (in-progress) / `Agent.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-agent.md` (`src/models/Agent.ts`)
- operations named: Hold the Agent as the catalog System of Record row; Keep one Agent per folded name and at most one per Granot username; Register inverse virtuals for Form Leads and Call Leads received
- remaining in this service: `LeadSourceCompany.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadSourceCompany.ts`

## Messages posted

- 2026-09-12T2018Z next

## Ideas parked

- none (do not invent `getAgentModel` in this pass; leftover Registry write, leftover identity `$or`, leftover Owner active-id load, leftover admin non-historical scope, and leftover historical-consolidation validate already import default `Agent`)

## Contradictions

- Schema unique-indexes both username paths; leftover receiver / Registry resolve query only nested; leftover identity `$or`s both
- Schema unique-indexes `normalized_name` only; leftover Registry assert also covers `name_aliases`
- Inverse virtuals exist; leftover preview counts Form / Call / Booking collections itself
- Live Agent requires `name`, unique-indexes folded name, and has Granot fields plus virtuals; leftover historical Agent does none of those
- `created_from` defaults to `"booked_lead"`; leftover catalog create stamps `"admin"`
- Live Agent does not set `autoIndex: false`; Form / Call / Booking / Cancellation do
- Form / Call have selected-database getters; Agent writes ask default `Agent`
- knowledge Service is `catalog.md` (leftover facade + Registry write); this file is the Mongo row
