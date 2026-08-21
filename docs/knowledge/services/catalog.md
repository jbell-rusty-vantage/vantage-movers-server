---
type: Service
title: Catalog Service
description: Agents and merchants read facade; mutations go through Operations Registry.
tags: [catalog, operations-registry]
status: draft
stale_after: 2026-11-19
resource: src/services/catalog/catalog.service.ts
applies_to:
  - src/services/catalog/catalog.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/catalog/catalog.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/catalog/catalog.service.ts`  
**Domain terms used:** [Agent](../../../../CONTEXT.md), [Active Agent](../../../../CONTEXT.md), [Merchant](../../../../CONTEXT.md), [Active Merchant](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Admin Dashboard](../../../../CONTEXT.md)

# Catalog Service

**System of Record:** Operations Registry catalog collections (`agents`, `merchants`). This file is the public facade; mutations go through `operationsRegistry/catalogRegistry.ts` with a signed Owner actor and a Registry Change audit row.

**Role:** Unified list/detail/resolve plus owner mutations for both catalogs. Does not create bookings, sync sheets, or auto-provision agents on standard booking paths.

## Catalog kinds

| Kind | Model | Collection | Extra fields |
|------|-------|------------|--------------|
| `agents` | `Agent` | `agents` | `role` (default `"agent"`) |
| `merchants` | `Merchant` | `merchants` | — |

Both share: `name`, `normalized_name` (unique), `active`, `created_from`, timestamps.

## Name handling

Two steps on write:

1. **`canonicalName`:** trim + collapse internal whitespace (preserves caller casing in stored `name`).
2. **`normalizeCatalogName`:** delegates to `normalizeAgentName` — trim, collapse whitespace, **lowercase** → stored in `normalized_name`.

Uniqueness is enforced on `normalized_name` (Mongo unique index). Duplicate create/rename → **409** (`{label} already exists: {name}`).

**Lookup** (`resolveActiveAgentByName`, `resolveActiveMerchantName`) matches `normalized_name` + `active: true`. Caller may pass messy spacing/casing; resolution is case- and whitespace-insensitive.

## API surface (`v1.routes.ts`)

| Operation | Agents | Merchants |
|-----------|--------|-----------|
| List (active default) | `GET /api/v1/admin/catalog/agents`, `GET /api/v1/admin/agents` | `GET /api/v1/admin/catalog/merchants`, `GET /api/v1/admin/merchants` |
| Detail | `GET /api/v1/admin/agents/:id` | `GET /api/v1/admin/merchants/:id` |
| Create | `POST /api/v1/admin/agents` | `POST /api/v1/admin/merchants` |
| Update | `PATCH /api/v1/admin/agents/:id` | `PATCH /api/v1/admin/merchants/:id` |

List query: `include_inactive=true` includes deactivated rows. Default list sorts by `name` ascending.

Create/update bodies validated by `catalogCreateSchema` / `catalogUpdateSchema` (`name`, optional `active`, optional `role` for agents). Update requires at least one field.

## Service functions

| Function | Behavior |
|----------|----------|
| `listCatalogItems` | Filter `{ active: true }` unless `includeInactive`; map to `CatalogItem` DTO |
| `getCatalogItem` | By id; 404 if missing |
| `createCatalogItem` | Apply kind defaults (`created_from: "admin"`; agents also `role: "agent"`) |
| `updateCatalogItem` | Partial `$set`; recompute `normalized_name` when `name` changes |
| `resolveActiveAgentByName` | Returns the public Operations Registry catalog DTO; 400 if unknown/inactive |
| `resolveActiveMerchantName` | Returns catalog canonical `name` string; 400 if unknown/inactive |

`CatalogItem` exposes both `id` and `_id` as string for admin JSON consumers.

## Downstream consumers

| Consumer | Usage |
|----------|--------|
| `agentAllocation.service.ts` | `resolveActiveAgentByName` on every booking allocation — **no auto-create** on standard paths |
| `bookedLead.service.ts` | `resolveActiveMerchantName` on create/update — stores canonical merchant display name on booking |
| `referralBooking.service.ts` | Same merchant resolution on referral create |
| `adminFacets.service.ts` | Production scope: `listCatalogItems` for agent + merchant filter dropdowns (active only) | // pragma: allowlist secret

Historical admin facets scan booking snapshots instead of live catalog (`agent_name_snapshot`, `merchant` on booked leads).

## Create defaults vs legacy agents

Admin catalog create sets `created_from: "admin"`. Standard booking paths never
auto-create Agents: allocations resolve through the public Operations Registry
interface and require a pre-existing active Agent.

## Deactivation semantics

Setting `active: false` via catalog update:

- Blocks **new** agent allocations and merchant assignments (400 on resolve).
- Does **not** rewrite existing `BookedLead.agent_allocations` snapshots or historical merchant strings on bookings.
- Excluded from default list and production admin facets unless `include_inactive`. // pragma: allowlist secret

Renaming updates future resolutions; booking snapshots keep prior `agent_name_snapshot` until booking is edited.

## Invariants

- Do not bypass `normalizeCatalogName` / `resolveActive*` for booking writes — keeps merchant and agent matching consistent with admin catalog.
- `normalized_name` is the dedupe key; display `name` is canonical whitespace only (not forced title case).
- Unknown or inactive catalog entries must fail before booking persist (400), not silently create catalog rows.
- Merchant resolution returns **display name**, not ObjectId — bookings store the string field `merchant`.

## Related modules

- Agent allocation: `agent-allocation.md`
- Booking merchant field: `bookings.md`
- Name helper: `agents/agentName.ts`
- Models: `models/Agent.ts`, `models/Merchant.ts`
- Validation: `validation/v1/admin.validation.ts`
- Tests: `catalog/catalog.service.test.ts`
