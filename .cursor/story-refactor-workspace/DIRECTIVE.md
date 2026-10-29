# Clean-code directive

- Date: 2026-10-29
- Status: active. Read this before any file in `recommendations/`.
- Catalog sort: [CATALOG-STATUS.md](CATALOG-STATUS.md)
- Supersedes: the September 2026 traversal tour. `TRAVERSAL.md` stock is a frozen map of what was recommended. It is not the work queue. Messages that say the next module is `IngestionRun.ts` are closed.

This folder holds recommendations. It does not authorize a behavior change. The owner requested a catalog-wide maintenance pass on 2026-10-29: remove obsolete recommendations and update surviving briefs against current code and Service docs. That maintenance request supersedes the old prohibition on rewriting recommendation files, including the Form Lead exemplar. It does not start an implementation pass. See [CATALOG-STATUS.md](CATALOG-STATUS.md) for the refreshed inventory and per-file review evidence. The live file wins when a brief disagrees with it.

## What this program is

Make `vantage-main-server` maintainable by another developer and by agents.

- Keep the outcomes, the import graph, the side-effect order, and the error shapes.
- Rename toward the operational story when the recommendation still matches the live file.
- Critique and strengthen tests so they name the operation. A test that passes by swallowing errors is not coverage.
- Do not start a database schema refactor. Form Lead and Call Lead stay two records. Origin is the difference between them.
- Do not invent a second story, a `*Service` class, or a new recommendation during an implementation pass.

Branches may hold several clean-code commits. One story at a time. Branch from current `origin/main`. Name it `refactor/<story-slug>`.

## The business this code serves

Vantage Movers is a moving broker. The main server is the system of record for leads, bookings, cancellations, Granot, RingCentral, and the Master Leads sheets. Transportation pricing lives in `vantage-operations-server`. It is not this cleanup.

Vantage buys leads from Source Companies. A Form Lead arrives from a landing-page quote. A Call Lead arrives when a qualified RingCentral call is minted. The same person can be both. The records stay separate and are kept near parity. A booking prefers the Form Lead. A Granot update on a Form Lead mirrors the job, priority, and receiver onto that customer's qualified Call Lead (`granot_form_sibling`). The desk works the pair through the Form Lead.

The owner’s rule is that a Call Lead is minted from a qualified RingCentral call: one completed inbound call to a mapped number, at least 120 seconds total elapsed. Both transports reach final parent Call Log vetting in `vetRingCentralCallLogRecord`: it requires `finished === true`, Voice, valid start and identity, mapped inbound target and caller. The elapsed/direction/route/caller primitive `qualifyRingCentralCall` is only part of that gate; it does not itself prove completion. Precise parent `durationMs >= 120000` qualifies, invalid supplied milliseconds fail closed, and rounded seconds exactly 120 without milliseconds remain unconfirmed. Webhook candidate previews do not authorize creation. The code still has other create paths: `POST /api/v1/call-leads`, `granot_lead_created`, `vantage_admin`, and the Owner employee-booking reconciliation `create_and_attach` Call branch (`createAndAttachReconciliationCallLead`, which constructs and saves a Call Lead directly). `best_relocation_sheet` remains on the origin enum as a leftover label. The external sheet ingest that used it is not live. Closing the remaining create paths is a logic change. A rename leaves them in place.

The Master Leads sheet is what lead providers see. The Forms tab and the Calls tab are that report. Sheet Sync still matters.

Granot is the CRM. The Admin dashboard is the supplement: Outreach Desk for reps, booking finalization, and Setup. Extension users are the Granot browser extension. Dashboard roles (owner, admin, manager, rep) are a different account and live in `vantage-admin`. Do not treat an extension-user recommendation as a dashboard-role change.

There is a standing tension between lead state, booking accuracy, and what is billable. A cleanup that "simplifies" that tension is a logic change. Stop and ask.

## What changed after the recommendations

| Fact | What an agent does with it |
| --- | --- |
| Server/admin slimming removed Operational Events, Lead Conversations, and the server AI/media pipeline. | Drop those recommendations. The service folder `src/services/observability/` is gone. `LeadConversation` is gone. |
| The Operations Registry is a different thing. It is the live catalog for Source Companies, Source Granularities, RingCentral numbers, Granot CRM Sources, and lead cost. | Keep it. Do not delete it while dropping Operational Events. |
| `src/services/granotLifecycle/observability.ts` is lifecycle logging. | Leave it. It is not Operational Events. |
| The historical database and historical consolidation are gone. `src/services/historicalConsolidation/` is absent. | Remove their recommendations from the active catalog. |
| Best Relocation external sheet ingest is not live. The historical database ingest is not live. | Do not implement those recommendations. Do not enable `BEST_RELOCATION_INGEST_ENABLED`. Do not describe leftover files as a running ingest. Do not write the next recommendation for `IngestionRun.ts`. |
| Lead cost on create is `resolveLeadCplSnapshot` → `resolveCpl`, which loads the `CplRatePeriod` covering that lead’s business timestamp. Insights, Today's lead spend, and the Desk read the same schedule live. The flat `getCplRate` helper is a legacy compatibility read and is not what create uses. The stamped `Lead.cpl` still feeds Sheets and the correction job. | Re-read before any CPL rename. Do not delete `CplRatePeriod`, and do not switch create over to `getCplRate`, unless the owner asks for that pricing change. |
| Granot automation from the dashboard still runs. A second path reads the Granot Estimates page on a cron at 08:00, 13:00, and 18:00 New York (`estimatesCron.ts`). | Do not fold the estimates cron into an old automation recommendation. |
| Granot lifecycle and Granot webhooks are in production, including the Form sibling mirror. | Re-read those files. The September text is not the contract. |
| Outreach Desk, Daily Operations, Insights, Sales Intelligence, and number activity were added. They have no recommendation in this folder. | Do not start there. Do not invent recommendations for them in an implementation pass. |
| Analytics reports still exist for compatibility. Insights replaced them on the dashboard. | Re-read. Do not "restore" the old analytics pipeline. |
| Transportation pricing is `vantage-operations-server`. Tariff adjustment on this server is a different feature. | Do not move or reimplement pricing here. |
| Form Lead and Call Lead story names are already on `origin/main` (`ingestFormLead`, `beginFormLeadIngestion`, `ingestCallLead`, and the matching aliases). | Do not rename them again. The remaining leads work starts at Duplicate Lead. |

## Catalog maintenance and implementation

The refresh is a starting point for implementation reasoning, not certification that every suggested extraction or rename is worthwhile. A reviewer checks the target, current exports, relevant callers and Service docs, removes stale instructions, and records a disposition for each original recommendation. Removed recommendations stay out of the active folder; their names and reasons stay in the refresh audit. Historical sessions and the September traversal remain historical evidence.

Do not revive a missing service to satisfy an old recommendation. Do not infer that a shared module is retired merely because one former caller is retired. Already-landed names are context for remaining work, never a request to repeat the rename. New services without existing recommendations remain outside this refresh; the catalog records that coverage gap.

## Catalog dispositions

Use the current labels in [CATALOG-STATUS.md](CATALOG-STATUS.md), together with the latest dated review report:

- **Refreshed**: substantive stale instructions were corrected. This is documentation status, not completed implementation or a passed parity check.
- **Retained guidance**: the prior design remains a starting point after triage; do not assume every assertion or proposed extraction was certified.
- **Removed**: not in the active folder. The reason may be a missing target, a retired workflow with compatibility code still present, or a not-live integration. Do not recreate the old service to satisfy the recommendation.

Second-pass evidence records concrete corrections and source checks separately from the first-pass dispositions. An unrepresented source file is a coverage gap, not automatic authorization to write a recommendation or start a refactor. Every active brief requires a live re-read before implementation.

## How an implementation pass starts

1. Read this directive and the row in `CATALOG-STATUS.md`.
2. Read the live target. The recommendation table is not the inventory.
3. If the brief is removed or the workflow is not live, skip it. Resolve historical compatibility scope before treating leftover code as an active workflow.
4. If a smell would change an outcome, ask. Do not land it.
5. Keep old export names as exact aliases until the callers the recommendation names have moved.
6. Tests name the operation. They must fail if the outcome changes. They must not pass by catching every error except one type.
7. Run the targeted tests. Typecheck the touched files.
8. Update the matching knowledge Service and the glob rule that already owns the file, using current behavior.

## First story

**Duplicate Lead** — `recommendations/leads-duplicate-lead.md`, target `src/services/leads/duplicateLead.service.ts`.

Classify a Duplicate Form Lead, and link Form Fill onto matching Call Leads. Those are different operations. Do not pull RingCentral's 90-day Call duplicate guard into this file.

Form Lead tests were drafted and not reviewed. They sit uncommitted on `refactor/form-lead-tests` (`src/services/leads/formLead.service.test.ts` only). Leave that branch until the owner asks to keep or drop it. The next implementation branch is new, from current `origin/main`.
