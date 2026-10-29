# Maintain the already-landed Call Lead story

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/callLead.service.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`

## Current operation and boundaries

ingestCallLead/beginCallLeadIngestion/completeCallLeadIngestion, RingCentral begin/ingest, correctCallLead and removal story names are implemented; old create/update/delete/find exports remain exact aliases. Legacy POST/Admin and Granot create paths still exist on this branch; qualification is upstream for RingCentral. Form/Call stay separate records and sibling mirror is owned elsewhere.

## Remaining recommendation

Do not rename the landed story again. Remaining cleanup can clarify the v1 facade dependency/caller migration and parity tests. Keep default begin+complete versus injected RingCentral completion event differences, missing-CPL in-transaction logging, no_sync routing, caller contact, temporal pricing and tombstone fallbacks.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`CreateRingCentralCallLeadInput`; `CallLeadIngestionInProgress`; `ingestCallLead`; `beginCallLeadIngestion`; `completeCallLeadIngestion`; `beginRingCentralCallLeadIngestion`; `ingestRingCentralCallLead`; `correctCallLead`; `persistTheCorrectionAndRefreshTheBookingChain`; `listRecentCallLeads`; `removeCallLead`; `beginCallLeadRemoval`; `rememberBothCallSheetTabsForTombstone`; `createCallLead`; `createCallLeadInTransaction`; `finalizeCallLeadCreateAfterCommit`; `createRingCentralCallLead`; `createRingCentralCallLeadInTransaction`; `updateCallLead`; `updateCallLeadInTransaction`; `persistCallLeadUpdateInTransaction`; `findAllCallLeads`; `deleteCallLead`; `deleteCallLeadInTransaction`; `buildCallLeadDeletePreviousTargets`

## Parity proof

Default versus injected RingCentral event differences; duplicate CPL0; source-change repricing; no-op correction skips Sheets; booked duplicate conflict; cascade; both Calls/Duplicate Calls tombstones; no_sync ordinary versus duplicate tabs; aliases exact; no accidental closure of legacy create paths.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
