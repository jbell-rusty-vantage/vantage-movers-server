# Agent Allocation Service (`agentAllocation.service.ts`)

**Source of truth:** Mongo `agents` catalog (reference data) + denormalized snapshots on `BookedLead.agent_allocations`. Reporting reads the booking snapshot, not live agent renames.

**Role:** Resolve agent names to catalog ids, split binder credit across agents, validate totals, and merge allocation updates. Does not create bookings or sync sheets by itself.

## Stored shape (`BookedLead.agent_allocations`)

Each entry:

| Field | Meaning |
|-------|---------|
| `agent` | `ObjectId` ref to `agents` |
| `agent_name_snapshot` | Canonical `Agent.name` at resolve time |
| `binder_amount` | Credit attributed to that agent (≥ 0) |

Schema requires **at least one** allocation. **Primary agent** = first array element (`primaryAgentName`, cancellation snapshot, `BookedLead` virtuals).

## Name normalization (`agentName.ts`)

`normalizeAgentName`: trim → collapse whitespace → lowercase. Used for duplicate detection within a list and for `split_agent` vs `agent` equality checks. Catalog lookup uses the same normalization via `normalizeCatalogName`.

Display/storage names are trimmed/collapsed but preserve caller casing until resolved; `agent_name_snapshot` stores the catalog’s canonical `name`.

## Entry paths

| Caller | How allocations are built |
|--------|----------------------------|
| `POST /api/v1/booked-leads` | Request supplies `agent_allocations[]` (`agent_name`, `binder_amount`) |
| `createBookedLeadFromSource` | `deriveBookedLeadAgentAllocations({ agent, split_agent, binder_amount })` → `createBookedLead` |
| `createReferralBooking` | Same derive helper; `binder_amount` input = `total_binder_amount` |
| `PATCH /api/v1/booked-leads/:id` | Optional `agent_allocations` + `agent_allocation_mode` |

All create/update paths call `resolveAgentAllocations` **before** the booking transaction (agent catalog writes stay outside the booking txn).

## `deriveBookedLeadAgentAllocations`

Used by form/phone booking submissions and referral bookings.

1. Trim/collapse whitespace on `agent` and optional `split_agent`.
2. **Reject** when normalized `split_agent` equals normalized `agent` (400).
3. **No split:** one allocation with full `binder_amount`.
4. **With split:** two allocations, each `binder_amount / 2` (even split).

Order is always `[primary agent, split agent]`.

## `resolveAgentAllocations`

For each `{ agent_name, binder_amount }`:

1. Trim/collapse display name.
2. **Reject duplicate agents** in the same request (normalized name set) — 400.
3. **`resolveActiveAgentByName(name)`** (`catalog.service.ts`): lookup `agents` by `normalized_name` where `active: true`.
   - Unknown or inactive → 400 (`Unknown or inactive agent`).
   - **Does not auto-create agents** on the standard booking path.
4. Push `{ agent: _id, agent_name_snapshot: agent.name, binder_amount }`.

## `resolveTotalBinderAmount`

- Sum of allocation `binder_amount` values.
- If caller submits `total_binder_amount`, it must match the sum within **0.001** (float tolerance) or 400.
- Returns submitted total when provided, else computed sum.

Zod schemas on create/update also enforce `binderTotalMatches` at the HTTP boundary.

## `patchAgentAllocations` (booking update)

When `agent_allocation_mode` is omitted or `"patch"`:

- Key existing + incoming allocations by `agent` id string.
- Incoming replaces matching ids; agents not in the request **survive**.
- New agent ids are appended (via map merge order: existing first, then overwritten/added).

When `agent_allocation_mode === "replace"`: incoming list replaces the full set.

Referral booking updates are blocked (409) — allocations not editable there yet.

## `primaryAgentName`

Returns `agent_allocations[0].agent_name_snapshot` or `""` if missing. Used when creating a `CancelledLead` to snapshot the booking’s primary agent.

## `upsertAgentByName`

Upserts an agent by `normalized_name` with `created_from: "booked_lead"`, default `active: true`. Handles Mongo `E11000` races by re-read.

**Not used by current production booking/create flows** — exported for historical repair/backfill scripts. Standard API requires pre-existing **active** catalog agents via admin/catalog CRUD.

## Warnings (downstream)

`buildBookedLeadWarnings` (in `bookingWarnings.ts`) flags any resolved allocation with `binder_amount === 0`. Returned on booked-lead create/update responses; does not block save.

## Invariants

- Every booked lead must have ≥ 1 agent allocation with valid catalog refs.
- Do not bypass `normalizeAgentName`, `resolveAgentAllocations`, or `resolveTotalBinderAmount` for booking writes.
- Duplicate agents in one request are forbidden (case/whitespace insensitive).
- Split bookings always use a 50/50 binder split; primary agent is list index 0.
- Inactive agents cannot be allocated on new bookings unless catalog rules or backfill scripts change separately.

## Related modules

- Booking lifecycle: `bookedLead.service.ts`, `bookedLeadFromSource.service.ts`, `referralBooking.service.ts`
- Agent catalog CRUD + lookup: `catalog/catalog.service.ts` (`resolveActiveAgentByName`, admin routes)
- Cancellations: `cancelledLead.service.ts` (`primaryAgentName`)
- Validation: `validation/v1/bookings.validation.ts` (`agentAllocationInputSchema`, `agent_allocation_mode`)
- Historical repair: `scripts/historical/repair-historical-agent-allocations.ts` (may use different agent upsert patterns)

## Operational notes

- Agent resolution failures surface as 400 before any booking persist.
- Allocation changes on update enqueue `booking_chain` sheet-sync refresh like other booking field edits.
- Admin export flattens `agent_allocations` to `agent_names` for CSV/reporting.
