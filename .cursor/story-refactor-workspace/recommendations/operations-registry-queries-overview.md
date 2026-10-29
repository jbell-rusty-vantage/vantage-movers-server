# Read Registry counts, signing readiness and local runtime telemetry

- Status: recommended; reviewed 2026-10-29.
- Target: `src/services/operationsRegistry/queries/overview.ts`.
- Caller: `src/services/operationsRegistry/index.ts` and the Registry HTTP routes.
- Domain: `docs/knowledge/services/operations-registry.md`.

## Current behavior

`getRegistryOverview` connects to Mongo and runs eleven counts in parallel: total and active Agents, Merchants, Source Companies, Source Granularities and RingCentral routes, plus all-time Registry Changes. It constructs `generated_at` after those queries. Signing fields report a boolean secret presence, preview unsigned policy and signature maximum age; the secret itself is never returned. `runtime` is the current `getRegistryRuntimeTelemetry()` snapshot for this process, including compatibility counters since this instance started. It does not query the past day, merge durable events, aggregate other instances, or create findings.

## Remaining cleanup and parity

The eleven parallel queries and result mapping can be named to make counts and scope clear while preserving the returned field names, filters, all-time Change count, time of `generated_at`, signing fields and instance-local runtime scope. Keep health findings in `queries/health.ts` and actor verification in its existing boundary. Tests should distinguish active from total counts, check a false signing-secret boolean without exposing a secret, and confirm runtime data is passed through without claiming cross-instance coverage. Search structured compatibility logs when fleet-wide evidence is needed.
