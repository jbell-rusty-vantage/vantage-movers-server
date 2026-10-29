# Recommendation coverage and its limits

Reviewed 2026-10-29 during the second pass. This file explains what the catalog can support before an implementation starts; it is not a new traversal queue.

The first-pass coverage note listed newer service families, but missed newer modules within families that already had recommendations. A current target for every surviving recommendation does **not** imply a recommendation for every current module, or that each dependency has been reviewed in isolation.

[coverage-second-pass.json](coverage-second-pass.json) maps the 338 dedicated target rows and lists source files without a dedicated row. Its denominator is non-test `.ts` files under `src/`, including types, barrels, fixtures, configuration and inactive compatibility code. Those entries must not be counted as missing refactors, active workflows or an implementation backlog. Parent briefs can cover dependencies without giving them a separate recommendation.

## Relevant gaps inside covered families

| Current module or group | How to use existing recommendations |
| --- | --- |
| `ringcentral/call-qualification.ts`, `webhook-call-log-qualification.ts` | Read these together with the vetting, webhook and ingest briefs. The shared qualification primitive alone does not prove final parent-call completion. |
| `granotLifecycle/callLeadFormSibling.ts` | Read with the processor, Form/Call and booking briefs; its pairing and mirror guards must be inventoried rather than inferred from the old synchronize-lead story. |
| `granotLifecycle/bookingIntakeLatestAction.ts`, `confirmAttachment.ts`, `officialCancellationWrite.ts`, `connectBookingToLead.ts` | Inventory these actual dependencies when changing booking intake or Owner commands. Their absent target rows do not mean their work belongs inside the parent module. |
| `bookings/ownerBookingAttach.ts`, `releaseLiveBookingClaims.ts` | Include current attachment/claim behavior when assessing a booking cleanup. Preserve ownership in the current deeper module. |
| `domainCommands/leads.ts`, `cancellations.ts`, `reconciliation.ts`, `leadChangeEmission.ts` | Read the actual command boundaries and callers; the old existing-writes brief is not a complete command inventory. |
| `sheetSync/noSyncLead.ts`, `sheetSyncJobs.ts`, `drainer/leases.ts` | Include the current job/lease/no-sync dependencies in parity review rather than recreating their policy in another helper. |
| `granotHttpCollector/estimates*.ts`, `poolCron.ts` | The dashboard HTTP automation brief is not a brief for each newer scheduled collector. |

Paths in the table are relative to `src/services/` and were checked on disk. The table is a risk-oriented selection, not a complete list. The JSON inventory is structural only.

## Newer service families and models

Daily Operations, Insights, Outreach Desk, Sales Intelligence, number activity, systems and admin invites have no dedicated briefs in this catalog. Newer models and routes supporting them are also not exhaustively covered. The same applies to the Granot Estimates-specific models. Existing briefs must reflect dependencies on those services where relevant, but this maintenance pass does not invent their designs.

The 56 removed recommendations were separately rechecked in [second-pass-removals.json](second-pass-removals.json): 31 targets are absent, 22 concern the not-live external ingest, and 3 concern historical Release workflow compatibility. Their files staying out of the active folder does not authorize deleting compatibility code or data.

Before an implementation, choose the story, enumerate current exports/callers and delegated effects, then decide whether the existing brief is sufficient or needs more design. The updated catalog is a starting point for that proof, not a substitute.
