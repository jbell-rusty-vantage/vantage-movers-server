# Read safe cases, candidates, timelines and Health

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/projections.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/observability.md`, `docs/knowledge/granot-lifecycle/projections.md`

## Current operation and boundaries

Current reads include booking latest-action capabilities, known contacts, Connect candidates, deterministic official facts and Health. Receipt list/Live Events SSE are retired. Historical Release cases are opt-in; default Owner intake is booking work. Granot forensic timeline differs from jobNumberTimeline.

## Remaining recommendation

Keep retired receipt/SSE reads outside the module’s active surface. Group case/candidate/timeline/Health beats while preserving exports, limits/cursors/redaction and policy-owned capabilities. Admin consumes projections; it must not recompute matching/eligibility.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`DEFAULT_TIMELINE_LIMIT`; `JOB_PROJECTION_LIMIT`; `SafeRecordLinkProjection`; `SafeBookingProjection`; `SafeCancellationProjection`; `GranotTimelineEntry`; `GranotTimelinePage`; `DeterministicBookingListProjection`; `GranotLifecycleCaseListItem`; `GranotLifecycleCaseListPage`; `GranotLifecycleCaseDetail`; `CandidateKnownContact`; `CandidateKnownGranotContact`; `CandidateKnownContacts`; `GranotLifecycleCandidateItem`; `includeReleaseCasesInList`; `includeBookingCasesInList`; `toBookingIntakeLatestActionEvidence`; `projectCaseLatestAction`; `projectBookingIntakeCapabilities`; `GranotLifecycleHealthProjection`; `GranotLifecycleRingCentralHealth`; `dueWorkFilter`; `GranotLifecycleLastRunProjection`; `normalizeJobProjectionPath`; `projectGranotJob`; `projectGranotLeadTimeline`; `listGranotLifecycleCases`; `getGranotLifecycleCaseDetail`; `listGranotLifecycleCaseCandidates`; `listConnectLeadCandidates`; `paginateTimeline`; `compareTimelineEntries`; `formLeadCandidateSearchOr`; `callLeadCandidateSearchOr`; `assembleCandidateEntries`; `projectCandidateKnownContacts`; `rankBookingCandidateProjections`; `projectOwnerVisibleContact`; `customerLabel`; `maskContactLabel`; `projectDeterministicBooking`; `flagsToNamedBooleans`; `projectGranotLifecycleHealth`; `projectCaseDetailPriorityPairing`; `compactCaseListPriorityPairing`; `JOB_PROJECTION_FORBIDDEN_KEYS`; `collectForbiddenProjectionKeys`; `assertProjectionSafe`; `assertJobProjectionMasked`

## Parity proof

Stable pagination; empty Connect search; ranked candidates before browse; any-known-contact search; latest action ignores historical priority5 when actual action exists; safe fields; historical visibility; Health unknowns/PII scan.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
