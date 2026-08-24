---
type: Service
title: Catalog Service
description: Agents and merchants read facade; Owner mutations go through Operations Registry create-or-update, activation, and dependency preview.
tags: [catalog, operations-registry]
status: draft
stale_after: 2026-11-20
resource: src/services/catalog/catalog.service.ts
applies_to:
  - src/services/catalog/catalog.service.ts
  - src/services/operationsRegistry/catalogRegistry.ts
  - src/validation/v1/admin.validation.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/catalog/catalog.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T05:53:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/catalog/catalog.service.ts` (facade) + `src/services/operationsRegistry/catalogRegistry.ts` (authority)  
**Domain terms used:** [Agent](../../../../CONTEXT.md), [Active Agent](../../../../CONTEXT.md), [Merchant](../../../../CONTEXT.md), [Active Merchant](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Admin Dashboard](../../../../CONTEXT.md)

# Catalog Service

**System of Record:** Operations Registry catalog collections (`agents`, `merchants`). This file is the public facade. Mutations call `createOrUpdateAgent` / `createOrUpdateMerchant` / `setAgentActivation` / `setMerchantActivation` with a signed **Owner** actor and one Registry Change row in the same transaction.

**Role:** List/detail/resolve plus Owner create, rename, username, and activation. Does not create Bookings, sync sheets, or auto-provision Agents on standard booking paths.

**Not the same as:** [`operations-registry.md`](./operations-registry.md) owns the mutation transaction, audit, and cache invalidation. [`agent-allocation.md`](./agent-allocation.md) consumes `resolveActiveAgentByName`.

## Catalog kinds

| Kind | Model | Collection | Extra fields |
|------|-------|------------|--------------|
| `agents` | `Agent` | `agents` | `role` (default `"agent"`), optional `granot_crm_username` / `granot_identity` |
| `merchants` | `Merchant` | `merchants` | — |

Shared persisted fields: `name`, `normalized_name` (unique vs aliases), `name_aliases[]`, `active`, `created_from`, optional `archived_at` / `deactivation_reason`, timestamps.

The public `CatalogItem` DTO exposes `id` and `_id` as the same string, plus optional flattened `granot_crm_username`. It does **not** return `name_aliases`, nested `granot_identity`, `archived_at`, or `deactivation_reason`. `resolveActiveAgentByName` returns the full `RegistryCatalogItem` (aliases + identity).

## Name handling

Two steps on write (`catalogRegistry.ts`):

1. **`canonicalName`:** trim + collapse internal whitespace. Stored `name` keeps caller casing.
2. **`normalizeAgentName` (also `normalizeCatalogName`):** trim, collapse whitespace, **lowercase** → `normalized_name`.

Uniqueness is `{ normalized_name }` **or** `{ name_aliases }` (`assertCatalogNameAvailable`). Duplicate create/rename → Registry `DUPLICATE_IDENTIFIER` (`A catalog name or alias already uses this identifier.`). Not the older `{label} already exists: {name}` string.

**Lookup** (`resolveRegistryAgentByName` / `resolveRegistryMerchantByName`) matches `$or: [{ normalized_name }, { name_aliases }]` and, unless `includeInactive`, `active: true`. Caller spacing/casing is ignored.

`resolveAgentByName(..., { includeInactive: true })` can return an inactive Agent (`Unknown agent` if missing). `resolveActiveAgentByName` never includes inactive (`Unknown or inactive agent`). Merchant public resolve has **no** include-inactive option (`Unknown or inactive merchant`).

Rename on an existing row `mergeAlias`es the old `normalized_name` into `name_aliases` so prior names keep resolving.

## HTTP entry points (`v1.routes.ts`)

List/detail/dependencies: `requireRegistryReadActor`. Create/update/activation: `requireRegistryOwnerActor`.

| Operation | Agents | Merchants |
|-----------|--------|-----------|
| List | `GET /api/v1/admin/catalog/agents`, `GET /api/v1/admin/agents` | `GET /api/v1/admin/merchants` only — **no** `/admin/catalog/merchants` alias |
| Detail | `GET /api/v1/admin/agents/:id` | `GET /api/v1/admin/merchants/:id` |
| Create | `POST /api/v1/admin/agents` | `POST /api/v1/admin/merchants` |
| Update | `PATCH /api/v1/admin/agents/:id` | `PATCH /api/v1/admin/merchants/:id` |
| Activation | `POST /api/v1/admin/agents/:id/activation` | `POST /api/v1/admin/merchants/:id/activation` |
| Dependencies | `GET /api/v1/admin/agents/:id/dependencies` | `GET /api/v1/admin/merchants/:id/dependencies` |

List query (`catalogListQuerySchema`): `include_inactive=true` lists deactivated rows. Default filter is `{ active: true }`. Sort is `name` ascending.

Create (`catalogCreateSchema`): required `name`; optional `role` (agents), `granot_crm_username` (agents), `active`, `created_from`. Update is partial plus optional `reason`; at least one of `name`, `role`, `granot_crm_username`, `active`, `created_from` is required. Activation body is `{ active, reason? }`.

Zod comments still mention a `CATALOGS` map in `catalog.service.ts`. **That map is gone.** Defaults live in `catalogRegistry.ts` (known gap vs the schema comment).

## Happy path — create

```
requireRegistryOwnerActor
  → createCatalogItem → createOrUpdateAgent|Merchant (no id)
  → canonicalName + normalizeAgentName
  → assertCatalogNameAvailable
  → agents: optional unique Granot username (resets granot_identity.verified)
  → created_from = input or "admin"; role = input or "agent"; active = input or true
  → insert + Registry Change action "create"
  → invalidate keys agents|merchants, catalog, facets
  → facade maps RegistryCatalogItem → CatalogItem
```

HTTP 201. PATCH with `id` is the same helper (update / rename / activate / deactivate in the audit action).

## Skip / fail

| Condition | Result |
|-----------|--------|
| Unknown id on get/update/activation | Registry `NOT_FOUND` (`Agent not found.` / `Merchant not found.`) |
| Empty name after canonicalize | 400 `Name is required.` |
| Normalized name or alias collision | `DUPLICATE_IDENTIFIER` |
| Agent Granot username already assigned | `Granot username is already assigned to another Agent.` |
| Non-owner mutation actor | `Registry mutations require an Owner actor.` |
| Resolve miss / inactive (default) | 400 `Unknown or inactive agent|merchant: {name}` |
| Inactive resolve with `includeInactive` and no row | 400 `Unknown agent: {name}` |

Deactivation (`active: false` via PATCH or `/activation`) sets `archived_at` and optional `deactivation_reason`. Reactivation `$unset`s those two fields. Existing `BookedLead.agent_allocations` snapshots and stored merchant strings are **not** rewritten.

## Dependency preview

`previewRegistryDependency`:

- Agent: counts `BookedLead.agent_allocations.agent`, `FormLead.receiver_agent`, `CallLead.receiver_agent`.
- Merchant: counts `BookedLead.merchant` `$in` `[name, ...name_aliases]`.

Returned `total` is the sum. Preview does not mutate.

## Downstream consumers

| Consumer | Usage |
|----------|--------|
| `agentAllocation.service.ts` | `resolveActiveAgentByName` — **no auto-create** |
| `bookedLead.service.ts`, `referralBooking.service.ts`, `leadlessBooking.service.ts`, `employeeBookingPreparation.ts` | `resolveActiveMerchantName` — stores canonical display `name` on `BookedLead.merchant` |
| `adminFacets.service.ts` | [REDACTED] scope: `listCatalogItems` (active only) for agent + merchant dropdowns. Historical scope scans booking `agent_name_snapshot` / `merchant` instead. Combined merges both. Cache TTL 5 minutes. | // pragma: allowlist secret
| `getEmployeeBookingOptions.service.ts` | Active agent + merchant lists for the public employee form |

## Invariants

- Do not bypass `normalizeAgentName` / `resolveActive*` for booking writes.
- `normalized_name` plus `name_aliases` are the dedupe and resolve keys. Display `name` is whitespace-canonical only (not title case).
- Unknown or inactive catalog entries fail before booking persist (400). Standard booking paths never insert catalog rows.
- Merchant resolution returns **display name**, not ObjectId.
- Owner mutations require a signed Owner actor; audit failure aborts the write ([`operations-registry.md`](./operations-registry.md)).

## Related modules

- Agent allocation: [`agent-allocation.md`](./agent-allocation.md)
- Booking merchant field: [`bookings.md`](./bookings.md)
- Employee options: [`employee-bookings.md`](./employee-bookings.md)
- Name helper: `src/services/agents/agentName.ts`
- Models: `src/models/Agent.ts`, `src/models/Merchant.ts`
- Tests: `src/services/catalog/catalog.service.test.ts`, `src/services/operationsRegistry/catalogRegistry.test.ts`
