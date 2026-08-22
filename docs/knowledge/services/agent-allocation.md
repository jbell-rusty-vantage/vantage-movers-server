---
type: Service
title: Agent Allocation Service
description: Resolve agent names, split binder credit, and snapshot allocations on bookings.
tags: [agent-allocation, booking]
status: draft
stale_after: 2026-11-20
resource: src/services/agents/agentAllocation.service.ts
applies_to:
  - src/services/agents/agentAllocation.service.ts
  - src/services/agents/agentName.ts
  - src/services/catalog/catalog.service.ts
  - src/services/bookings/bookedLead.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/agents/agentAllocation.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T02:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/agents/agentAllocation.service.ts`  
**Domain terms used:** [Agent Allocation](../../../../CONTEXT.md), [Agent](../../../../CONTEXT.md), [Active Agent](../../../../CONTEXT.md), [Binder](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md)

# Agent Allocation Service

**System of Record:** MongoDB `agents` catalog (reference data) + denormalized snapshots on `BookedLead.agent_allocations`. **Analytics** reads the booking snapshot, not live agent renames.

**Role:** Resolve agent names to catalog ids, split binder credit across agents, validate totals, and merge allocation updates. Does not create bookings or sync sheets by itself.

## Stored shape (`BookedLead.agent_allocations`)

Each entry:

| Field | Meaning |
|-------|---------|
| `agent` | `ObjectId` ref to `agents` |
| `agent_name_snapshot` | Canonical `Agent.name` at resolve time |
| `binder_amount` | Credit attributed to that agent (≥ 0) |

Schema requires **at least one** **Agent Allocation**. **Primary agent** = first array element (`primaryAgentName`, **Cancellation** snapshot, `BookedLead` virtuals).

## Name normalization (`agentName.ts`)

`normalizeAgentName`: trim → collapse whitespace → lowercase. Used for duplicate detection within a list and for `split_agent` vs `agent` equality checks. Catalog lookup uses the same normalization via `normalizeCatalogName` and also matches `name_aliases`.

Display/storage names are trimmed/collapsed but preserve caller casing until resolved; `agent_name_snapshot` stores the catalog’s canonical `name`.

## Entry paths

| Caller | How allocations are built |
|--------|----------------------------|
| `POST /api/v1/booked-leads` | Request supplies `agent_allocations[]` (`agent_name`, `binder_amount`) |
| `createBookedLeadFromSource` | `deriveBookedLeadAgentAllocations({ agent, split_agent, binder_amount })` → `createBookedLead` |
| `createReferralBooking` / `createLeadlessBooking` | Same derive helper; `binder_amount` input = `total_binder_amount` |
| `PATCH /api/v1/booked-leads/:id` | Optional `agent_allocations` + `agent_allocation_mode` |

All create/update paths call `resolveAgentAllocations` **before** the booking transaction (agent catalog writes stay outside the booking txn). Best Relocation import passes `{ includeInactive: true }`.

There is **no** `upsertAgentByName` in this module anymore. Standard API requires a pre-existing catalog agent. Historical repair scripts may still upsert agents on their own.

## `deriveBookedLeadAgentAllocations`

Used by form/phone booking submissions, referral, and leadless bookings.

1. Trim/collapse whitespace on `agent` and optional `split_agent`.
2. **Reject** when normalized `split_agent` equals normalized `agent` (400 `split_agent must be different from agent`).
3. **No split:** one allocation with full `binder_amount`.
4. **With split:** two allocations, each `binder_amount / 2` (even split).

Order is always `[primary agent, split agent]`.

## `resolveAgentAllocations`

For each `{ agent_name, binder_amount }`:

1. Trim/collapse display name.
2. **Reject duplicate agents** in the same request (normalized name set) — 400.
3. **`resolveAgentByName(name, options)`** (`catalog.service.ts` → Registry). Default looks up **active** agents (`Unknown or inactive agent`). `{ includeInactive: true }` also accepts inactive agents (`Unknown agent` when missing). Lookup filter is `$or: [{ normalized_name }, { name_aliases }]` (test: Best Relocation inactive resolve).
4. **Does not auto-create agents.**
5. Push `{ agent: _id, agent_name_snapshot: agent.name, binder_amount }`.

`resolveActiveAgentByName` still exists on the catalog facade as `resolveAgentByName(name)` with no options.

## `resolveTotalBinderAmount`

- Sum of allocation `binder_amount` values.
- If caller submits `total_binder_amount`, it must match the sum within **0.001** (float tolerance) or 400.
- Returns submitted total when provided, else computed sum.

Zod schemas on create/update also enforce `binderTotalMatches` at the HTTP boundary.

## `patchAgentAllocations` (booking update)

When `agent_allocation_mode` is omitted or `"patch"`:

- Key existing + incoming allocations by `agent` id string.
- Incoming replaces matching ids; agents not in the request **survive**.
- New agent ids are appended (map merge order: existing first, then overwritten/added).

When `agent_allocation_mode === "replace"`: incoming list replaces the full set.

Referral and leadless booking updates are blocked (409) in `updateBookedLead` — allocations are not editable there.

Booking-update warnings come from the **incoming** resolved list (`buildBookedLeadWarnings(resolvedAllocations)`), not the merged patch result.

## `primaryAgentName`

Returns `agent_allocations[0].agent_name_snapshot` or `""` if missing. Used when creating a `CancelledLead` to snapshot the booking’s primary agent.

## `receiverAttributionFromPrimaryAllocation`

Best Relocation from-source create may stamp the source lead’s receiver from allocation `[0]` when the lead has no `receiver_agent` yet. Source enum value is `best_relocation_sheet`. Existing receiver is left untouched (test).

## Warnings (downstream)

`buildBookedLeadWarnings` (in `bookingWarnings.ts`) flags any resolved allocation with `binder_amount === 0`. Returned on booked-lead create/update responses; does not block save.

## Invariants

- Every booked lead must have ≥ 1 agent allocation with valid catalog refs.
- Do not bypass `normalizeAgentName`, `resolveAgentAllocations`, or `resolveTotalBinderAmount` for booking writes.
- Duplicate agents in one request are forbidden (case/whitespace insensitive).
- Split bookings always use a 50/50 binder split; primary agent is list index 0.
- Inactive agents can be allocated only when the caller passes `includeInactive` (Best Relocation import). Ordinary public booking still requires an active agent.

## Tests

`agentAllocation.service.test.ts` — inactive resolve + alias filter; receiver attribution set / not overwrite.

## Related modules

- Booking lifecycle: [`bookings.md`](./bookings.md)
- Agent catalog CRUD + lookup: [`catalog.md`](./catalog.md) (`resolveAgentByName`, admin routes)
- Cancellations: [`cancelled-lead.md`](./cancelled-lead.md) (`primaryAgentName`)
- Validation: `validation/v1/bookings.validation.ts` (`agentAllocationInputSchema`, `agent_allocation_mode`)
- Historical repair: `scripts/historical/repair-historical-agent-allocations.ts` (may use different agent upsert patterns)

## Operational notes

- Agent resolution failures surface as 400 before any booking persist.
- Allocation changes on update enqueue `booking_chain` sheet-sync refresh like other booking field edits (public path; canonical update no-ops when no booking fields change).
- Admin export flattens `agent_allocations` to `agent_names` for CSV/reporting.
