# Snapshot the temporal CPL result for Lead writes

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadCplResolution.ts`
- Knowledge: `docs/knowledge/services/bookings.md`, `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/operations-registry.md`

## Current operation and boundaries

resolveLeadCplSnapshot calls resolveCpl after storedLeadTimestampToCplInstant. CplRatePeriod covers the business timestamp; duplicate_zero preserves optional base period with amount0; missing_rate and not_applicable remain distinct. Stamped cpl feeds Sheets/corrections while Insights/Today/Desk price schedule live.

## Remaining recommendation

Keep snapshot mapping and missing-rate log as separate public operations. Name time conversion and snapshot fields by pricing semantics; do not switch to legacy flat getCplRate or remove temporal periods.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`LEAD_CPL_RESOLUTION_VERSION`; `LeadCplSnapshot`; `resolveLeadCplSnapshot`; `recordMissingLeadCplRate`

## Parity proof

Resolved period id/amount; duplicate_zero/base id; missing fallback/null; not applicable; injected now/version; business-time conversion; current logging shape and timing at callers.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
