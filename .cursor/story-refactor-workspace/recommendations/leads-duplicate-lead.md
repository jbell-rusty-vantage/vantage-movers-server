# Classify Duplicate Forms separately from marking Form Fill

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/duplicateLead.service.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Current duplicate Form query requires exact source_granularity_id, earlier timestamp strictly less than event time, non-duplicate candidates and email/normalized-phone verification. At/after 2026-04-30 New York cutoff only the post-cutoff cohort counts. Form Fill instead uses Source Company+phone, at most25 candidates, and is not Call duplication.

## Remaining recommendation

Name classification and Form Fill operations separately; preserve current detailed match result and boolean wrapper. Keep the current exact-granularity and cutoff-cohort rule explicit. markMatchingCallLeadsWithFormFill must save/emit per-Call EntityChange in supplied session and return Sheet intents to caller.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`DuplicateFormLeadMatch`; `LeadSourceMatchScope`; `ExactGranularityMatchScope`; `findDuplicateFormLeadMatch`; `isDuplicateFormLead`; `hasFormFillForCallLead`; `markMatchingCallLeadsWithFormFill`

## Parity proof

Missing granularity throws when contact exists; empty contact false; equal timestamp excluded; cutoff cohorts; email/phone/both; exact phone recheck; Form Fill company fallback; no-op flag; shared command id/session; no RingCentral90-day guard here.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
