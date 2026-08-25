# Session story-leads-call-lead-source-match-2026-08-25T0610Z

- Date (UTC): 2026-08-25T06:10Z
- Service / module: `leads` / `callLeadSourceMatch.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/14

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 0 / 1 / 37
- Recommendations on disk: 10 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`)
- Current service / next module (TRAVERSAL): `leads` / `callLeadSourceMatch.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/leads-call-lead-source-match.md`
- operations named: May this Call Lead take this CRM row’s source (unassigned or any one of company id / granularity / leftover string); Name the CRM row and Call Lead sources for a human; Write the assigned-source conflict sentence (silent without leftover `source_company`)
- remaining in this service: `leadSourceCompatibility.ts`

## Stock at end

- Visited / in-progress / unvisited: 0 / 1 / 37
- Current service / next module: `leads` / `leadSourceCompatibility.ts`

## Messages posted

- 2026-08-25T0610Z next-run

## Ideas parked

- none

## Contradictions

- added: this file’s yes/no OR-ladder + unassigned-on-leftover-company-only vs `classifyLeadSourceCompatibility` four-way (unassigned also requires no `lead_source_company`). Recon pastes this file; employee booking uses the classifier.
