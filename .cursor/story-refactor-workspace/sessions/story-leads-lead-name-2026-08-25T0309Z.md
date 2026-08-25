# Session story-leads-lead-name-2026-08-25T0309Z

- Date (UTC): 2026-08-25T03:09Z
- Service / module: `leads` / `leadName.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR (prior #10 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 7 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`)
- Current service / next module (TRAVERSAL): `leads` / `leadName.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-lead-name.md`
- operations named: Compose the Lead’s display name (trimmed `name` wins, else join first + last); Rebuild the Lead’s display name on correction (explicit `name` wins; first/last keys merge with the live Lead)
- remaining in this service: `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadPhoneMatching.ts`

## Messages posted

- 2026-08-25T0309Z next-run

## Ideas parked

- none

## Contradictions

- added: `form-lead.md` says create normalizes Name; `createLeadFromGranot` composes `display_name ?? first + last` and does not call this file. CRM splits `lead.name` and ignores stored first/last.
