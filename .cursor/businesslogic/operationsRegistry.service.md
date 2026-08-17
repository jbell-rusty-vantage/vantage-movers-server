**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/operationsRegistry/`  
**Authoritative plan:** [`../../docs/current_plans/01-operations-registry-specification.md`](../../docs/current_plans/01-operations-registry-specification.md)

# Operations Registry

**System of Record:** production MongoDB `vantagemovers` catalog collections.

**Role:** Owner-managed operational configuration with lifecycle rules, deterministic resolution, dependency previews, signed actor authorization, and transactional mutation history.

## Catalog lifecycle

- Agent, Merchant, Source Company, and Source Granularity records are deactivated, never deleted.
- Default lists and automatic matching use active records only. Owner correction workflows may explicitly include inactive records.
- Agent and Merchant renames preserve the prior normalized name as an alias. Existing Booking and Lead snapshots are not rewritten.
- An Owner may set or correct a Granot username on an Agent; usernames remain globally unique. Nested `granot_identity` is authoritative; the legacy flat username remains a temporary fallback. Changing a username resets verification.

## Source attribution

- `company_slug` and `granularity_key` are immutable.
- Exact granularity key, CRM label, and source-site identifiers must resolve uniquely among active records for the requested Lead Channel.
- Fallback aliases use highest priority. Equal-priority ambiguity fails and records an actionable Operational Event.
- Active channel defaults belong to the same active Source Company and point to an active same-channel Source Granularity.
- A current default cannot be deactivated without a same-command replacement or explicit removal of automatic channel use.
- Source Company projection mode defaults to `derived_import`; `direct_write` requires complete workbook metadata and does not itself enable Sheet Sync writes.
- Employee Booking validation and production admin facets read first-class
  Source Granularities. Embedded arrays are migration/rollback evidence only.

## CPL, catalog, and RingCentral (same folder)

- `cplSchedule.ts` — authoritative CPL periods + `resolveCpl` / `resolveCplFromPeriods`. Lead writes go through `leads/leadCplResolution.ts`.
- `cplCorrections.ts` — owner correction jobs against stored lead snapshots.
- `catalogRegistry.ts` — Agent/Merchant mutations used by the catalog facade.
- `ringCentralRegistry.ts` / `ringCentralValidation.ts` — inbound-route snapshot used at Call Qualification time.
- HTTP: registry overview/health/changes plus catalog, CPL admin, and RC inbound-route routes in `v1.routes.ts`. Mutations require a signed Owner actor.
- `granotCrmSources.ts` — Owner-only create/update/enable-disable for `GranotCrmSource` lifecycle semantics. Mutation and one `granot_crm_source` `OperationsRegistryChange` share a transaction; policy/list/health cache keys invalidate only after commit. Unreviewed rows stay disabled/deferred/observation-only. Runtime resolution lives in `granotLifecycle/sourcePolicy.ts`, not here.

## Authorization and audit

- Approved signed dashboard roles may read. Only a verified Owner may mutate.
- Domain mutation and Registry Change insert commit in one transaction. Cache invalidation runs after commit.
- Registry Changes are authoritative successful mutation history. Operational Events are reserved for failures, ambiguity, drift, and migration outcomes.

## Compatibility and migration

- M2 preserves Agent IDs, flat Granot usernames, and Booking snapshots.
- M3 preserves valid embedded Source Granularity IDs, retains embedded arrays and compatibility default keys, and creates first-class records.
- Inventory and migration scripts are deterministic, redacted, dry-run first, production guarded, and never access historical models or `vantagemovershistorical`.
- Every production M2–M5 apply must name the exact reviewed dry-run manifest.
  The script version, target database, mapping checksum, and M4 cutover date
  must still match before any write or RingCentral validation begins.

## Related

- [`catalog.service.md`](catalog.service.md) — public catalog facade
- [`form-lead.service.md`](form-lead.service.md) / [`call-lead.service.md`](call-lead.service.md) — lead CPL snapshots
- [`rules/operations-registry.mdc`](../rules/operations-registry.mdc), [`rules/cpl-operations.mdc`](../rules/cpl-operations.mdc)
