# Session story-granot-lifecycle-source-policy-2026-08-26T1508Z

- Date (UTC): 2026-08-26T15:08Z
- Service / module: `granotLifecycle` / `sourcePolicy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/47

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 43 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (in-progress) / `sourcePolicy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/granot-lifecycle-source-policy.md`
- operations named: Say which Registry policy this Granot label uses; Say whether this lifecycle effect may fire
- remaining in this service: `identity.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `identity.ts`

## Messages posted

- 2026-08-26T1508Z next-run

## Ideas parked

- none

## Contradictions

- `allowed: true` still carries a leftover blocking `outcome` / `reason` (`source_disabled`, or Referral `target_source_company_inactive`). Referral refusing `lead_created` is labeled `source_deferred`. `source_scope_eligible` is test-only. Resolve never reads `writeGranotSourcePolicyCache`. See CONTRADICTIONS.md.
