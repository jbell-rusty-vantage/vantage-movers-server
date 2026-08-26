# Session story-granot-lifecycle-identity-2026-08-26T1611Z

- Date (UTC): 2026-08-26T16:11Z
- Service / module: `granotLifecycle` / `identity.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR — #47 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 44 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`, two `reconciliation-*.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`, `granot-lifecycle-source-policy.md`)
- Current service / next module (TRAVERSAL): `granotLifecycle` (in-progress) / `identity.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/granot-lifecycle-identity.md`
- operations named: Say which Form or Call Lead this Observation is; Say which Agent this Observation named; Say which Booking already owns this Job
- remaining in this service: `granotTemporal.ts` and the rest of the checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` (in-progress) / `granotTemporal.ts`

## Messages posted

- 2026-08-26T1611Z next-run

## Ideas parked

- none

## Contradictions

- Referral identity reason is `creation_policy_observation_only`. Successful non-link matches still say `record_link_confirmed`. `agent_assertion: "single"` covers zero/one/many. Identity Agent find uses both username fields; CSV find does not. `disputed` is loaded and unused. See CONTRADICTIONS.md.
