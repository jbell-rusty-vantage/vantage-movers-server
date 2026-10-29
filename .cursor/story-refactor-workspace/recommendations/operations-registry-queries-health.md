# Assess Operations Registry health

- Status: recommended; reviewed 2026-10-29.
- Target: `src/services/operationsRegistry/queries/health.ts`.
- Callers: `src/services/operationsRegistry/index.ts`, `src/services/operationsRegistry/queries/leadSourceProjection.ts`; tests: `src/services/operationsRegistry/queries/health.test.ts`.
- Domain: `docs/knowledge/services/operations-registry.md`.

## Current behavior

`getRegistryHealth` connects to Mongo, checks signing configuration, and loads inactive Agent and Merchant counts, all companies, granularities, routes, open assignments, label mappings and Granot sources, unarchived CPL periods, missing-rate Form and Call Lead counts, failed and stalled correction job counts, and the latest Registry migration Change. It composes findings from the five exported source, RingCentral, CPL, label-mapping and Granot-source judges, then adds the runtime snapshot and migration evidence. `finalizeHealthFindings` fills missing timestamps and defaults actionable to the presence of a remediation action. The inactive Agent count is all inactive Agents despite its variable name; preserve that behavior.

`buildRuntimeRegistryHealthFindings` flags a resolver when serving stale or its age exceeds its maximum. Compatibility findings count only `getRegistryRuntimeTelemetry().compatibility_reads` on this instance since startup. Their evidence has `observation_scope: server_instance`; cross-instance evidence comes from searching structured `operations_registry.compatibility_read` logs. This module does not query historical Source-miss or compatibility events or merge a durable event stream. Lead Source projection calls the family judges for one source, using zero missing-rate Leads and no correction job counts; it does not call the runtime judge.

## Remaining cleanup and parity

Consider naming the inactive Agent count for what it actually counts, and clarify the mapping from loaded documents to the five focused judges without changing the finding codes, severity, evidence, defaults, ordering or remediation. Keep the pure family judges available to Lead Source projection rather than moving Mongo reads into them. Preserve active Feed CPL coverage checks, unresolved lead and failed/stalled correction findings, RingCentral route and assignment validation, label collisions and Granot destination checks. Test stale versus fresh resolver clocks, per-instance compatibility count and last-used timestamp, absent/present migration evidence, and finalized timestamps. A rename does not create an event collection or make health aggregate across instances.
