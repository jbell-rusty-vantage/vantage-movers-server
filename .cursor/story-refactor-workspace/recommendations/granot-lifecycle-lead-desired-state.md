# Plan authorized Lead changes without writing them

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/leadDesiredState.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`

## Current operation and boundaries

Pure planning uses identity/policy/temporal/eligibility. Valid Priority may update itself; 1/5 gate broad snapshot enrichment. Full accepted Call match may update move_date at any valid priority. Receiver replacement follows current sources/flag and protects manual/source-less assignments.

## Remaining recommendation

Name matched/no-match/contact/move beats and keep minimum-create eligibility distinct. Preserve command-owned stamps and strip planner metadata before command conversion.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`LeadCreationEligibility`; `LeadDesiredStatePlan`; `LeadContactSnapshot`; `LeadDesiredStateProjection`; `MinimumCreationDataResult`; `receiverLatestWinsEnabled`; `receiverFillableByGranot`; `receiverReplaceableByGranot`; `LeadDesiredStateInput`; `planLeadDesiredState`; `evaluateMinimumCreationData`; `contactSemanticallyEqual`

## Parity proof

Stale/invalid/priority-only gains no extra authority; primary caller contact/ingress snapshots unchanged; absent date retained; receiver flag/manual protection; create only lead_created; exact-current and link-needed remain distinct.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
