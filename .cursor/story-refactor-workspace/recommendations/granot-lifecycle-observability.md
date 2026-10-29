# Log safe events and update bounded Health facts

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/observability.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/observability.md`

## Current operation and boundaries

emitGranotLifecycleEvent validates catalog, sanitizes/masks details, logs and updates Health counters/latest-run rows; instrumentation errors are caught. Persisted Operational Events/incidents/notifications and server AI/media are retired.

## Remaining recommendation

Keep logging and bounded Health as the current boundary. Separate key normalization, safe detail conversion, Health-fact mapping and Owner result observation; keep safeLogging/healthState as deeper modules.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GRANOT_LIFECYCLE_EVENT_CATALOG`; `GranotLifecycleEventKey`; `GRANOT_LIFECYCLE_SUPPORTING_EVENT_KEYS`; `GRANOT_LIFECYCLE_EVENT_ALIASES`; `GRANOT_LIFECYCLE_ALERT_CODES`; `GranotLifecycleAlertCode`; `OWNER_COMMAND_CONFLICT_CODES`; `GranotLifecycleEventLevel`; `GranotLifecycleEventCategory`; `GranotLifecycleEmitInput`; `normalizeGranotLifecycleEventKey`; `isGranotLifecycleCatalogKey`; `maskLifecycleId`; `sanitizeGranotLifecycleEventDetails`; `emitGranotLifecycleEvent`; `ownerCommandConflictCode`; `observeGranotOwnerCommandConflict`; `observeGranotOwnerCommandResult`

## Parity proof

Unknown keys dropped; sensitive identifiers/contact masked; approved Health counters only; replay not applied twice; logging/Health failure never throws into a committed command.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
