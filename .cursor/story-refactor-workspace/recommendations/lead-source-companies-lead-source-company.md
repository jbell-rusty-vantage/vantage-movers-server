# Read legacy source compatibility without replacing the Registry

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leadSourceCompanies/leadSourceCompany.service.ts`
- Knowledge: `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/operations-registry.md`

## Current operation and boundaries

This facade still seeds/reads embedded source definitions and exposes legacy mutations/resolution/CPL helpers. Live operational ownership, first-class Source Granularity, source attribution and temporal CPL schedules belong to operationsRegistry. Embedded data is migration/compatibility evidence.

## Remaining recommendation

Name legacy compatibility explicitly in internal functions and caller map. Keep current exported facade until callers migrate; do not turn getCplForLeadSource into the create pricing path or copy Registry policy into embedded rows.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`LeadSourceChannel`; `LeadSourceCompanyInput`; `LeadSourceGranularityInput`; `LeadSourceCompanyItem`; `LeadSourceGranularityItem`; `LeadSourceResolution`; `LeadSourceResolveInput`; `ensureLeadSourceCompaniesSeeded`; `listLeadSourceCompanies`; `getLeadSourceCompany`; `createLeadSourceCompany`; `updateLeadSourceCompany`; `resolveLeadSource`; `leadSourceAssignmentFields`; `getCplForLeadSource`

## Parity proof

Existing seeded identity/aliases; unique/ambiguous source selection; channel/Move Type; legacy CPL read unchanged; no second first-class feed authority or schedule deletion.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
