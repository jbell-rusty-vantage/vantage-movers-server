# Track this instance's Registry resolver and compatibility telemetry

- Status: recommended; reviewed 2026-10-29.
- Target: `src/services/operationsRegistry/runtimeTelemetry.ts`.
- Callers: `cplSchedule.ts`, `labelMappings.ts`, `ringCentralSnapshot.ts`, `sourceRegistry.ts`, `queries/health.ts` and `queries/overview.ts`; tests: `runtimeTelemetry.test.ts`.
- Domain: `docs/knowledge/services/operations-registry.md`.

## Current behavior

`recordRegistryResolverAttempt`, `recordRegistryResolverSuccess`, `recordRegistryResolverFailure` and `recordRegistryResolverStaleServe` maintain process-local state. Source and CPL start in `direct_db` mode, RingCentral in `snapshot`; success sets its clock and max age, clears error and stale status, while failure increments its counter and saves a safe error code. `getRegistryRuntimeTelemetry(now)` calculates nonnegative age and returns the current instance's snapshot.

`recordCompatibilityRead` logs `operations_registry.compatibility_read`, increments an in-memory counter for path and consumer, and retains the last-use timestamp. `getRegistryRuntimeTelemetry` sorts those entries by path and category. This state resets with the instance; the log key is the cross-instance search source. There is no durable event merger here. Preserve the full `RegistryCompatibilityConsumer` union and existing log fields; the test-only reset clears both resolver state and counters.

## Remaining cleanup and parity

Keep the local update and snapshot boundary small; rename an operation only if its caller-facing purpose becomes clearer, retaining existing aliases through migration. Avoid changing clock semantics, log keys or consumer strings. Test attempt/failure counts, successful refresh clearing stale/error, age clamping, sorted path/category counts, last-use updates and reset. Check current import sites before removing an apparently unused export; do not add instrumentation to unrelated callers as part of a naming pass.
