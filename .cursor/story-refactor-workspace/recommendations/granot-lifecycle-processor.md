# Turn one claimed receipt into a Decision and authorized effect

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/processor.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`

## Current operation and boundaries

Drainer claims, then processGranotObservation normalizes/replays, resolves policy/identity/temporal plan, routes actual Booked OR Release to booking intake, else creates/synchronizes or persists classification. No production maybeReconcileRelease branch remains. Metadata-only winner CAS differs from reportable Lead changes.

## Remaining recommendation

Keep orchestration above policy/identity/planner/commands. Extract by booking, create/replan, synchronize/replan or Decision-only stories if warranted. Preserve createGranotObservationProcessor wrapper: committed live Form applied/linked/created/already_current, including replay, triggers bounded separate sibling mirror only when lead writes are enabled, shadow mode is off, and provenance is available; bounded lead-link wake also remains.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GranotLifecycleProcessorDeps`; `createGranotObservationProcessor`; `LEAD_LINK_WAKE_TIMEOUT_MS`; `boundedLeadLinkWake`; `processGranotObservation`; `loadGranotLeadProjection`; `granotObservationProcessor`

## Parity proof

Stored Decision replay/integrity conflict; technical failure finalization creates no new business Decision; a prior committed Decision can remain available for replay; shadow suppression; Booked/Release stops before Lead path; Priority5 alone does not open case; lost CAS replans; bounded post-commit failures never undo outcome; two-record sibling mirroring leaves Call temporal winner independent.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
