# GICC-01 completion

Coordinator review after implementer [GICC-01](11553d3f-4d80-40ad-a854-8de91330feef). Issue §14.

## Files changed

- `src/services/granotLifecycle/leadDesiredState.ts`
- `src/services/granotLifecycle/createLeadFromGranot.ts`
- `src/services/granotLifecycle/leadDesiredState.test.ts`
- `src/services/granotLifecycle/createLeadFromGranot.test.ts`
- `docs/granot-inbound-call-creation-convergence/PROGRESS.md`

## Test command output (coordinator re-run)

```text
cd vantage-main-server
pnpm exec tsx --test src/services/granotLifecycle/leadDesiredState.test.ts src/services/granotLifecycle/createLeadFromGranot.test.ts
# tests 37, pass 37, fail 0
```

## What still says “lead_created only”

The two source files no longer say that. Knowledge still does — GICC-03:

- `docs/knowledge/granot-lifecycle/processor.md`
- `docs/knowledge/granot-lifecycle/desired-state.md`

## Confirmation of what was not done

- `sourcePolicy.ts` — no diff
- `leadMessaging/` — no diff
- No new `lead_created_policy` value, inbound mint boolean, or ninth gate
- Registry rows, production flags, phone fence, adoption flag, ingest lock, and `assertSingleActiveRingCentralAssignment` unchanged
- No commit, push, deploy, or live customer payload

## Note for GICC-03

Best Relocation Inbounds already has `create_if_missing`. Shipping GICC-01 inherits `priority_updated` create and the existing `sendGranotCreatedLeadConfirmation` finalize. That is not a new SMS feature and not a reason for a second policy. Do not enable `outbound_sms` on other inbound families.

## Coordinator review gate

- [x] Form + `create_if_missing` + `lead_created` still eligible (test exists and passed)
- [x] Call + `create_if_missing` + `priority_updated` eligible; Form + `priority_updated` not
- [x] Command does not require CallLead before policy resolve
- [x] `sourcePolicy.ts` and `leadMessaging/` have no diff
- [x] No new `lead_created_policy` value
- [x] Issue §11 tests re-run by coordinator (37 pass)
- [x] This report lists what was not done
