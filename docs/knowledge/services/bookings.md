---
type: Service
title: "Bookings (`bookings/`)"
description: Create, update, and delete Booked Leads, including from-source, referral, leadless, and booking-chain sync.
tags: [booking, sheet-sync]
status: draft
stale_after: 2026-11-19
resource: src/services/bookings/
applies_to:
  - src/services/bookings/
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/bookings/
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T00:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/bookings/`  
**Domain terms used:** [Booking](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Binder](../../../../CONTEXT.md), [Deposit](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Bookings (`bookings/`)

**System of Record:** MongoDB `booked_leads`. Lead-attached Bookings mirror state onto Form Leads / Call Leads (`booked`, threshold flags, optional `source_company`/`local`, recomputed CPL). Owner reporting via **Sheet Sync** (**Master Booked** + source lead rows).

**Five services — one lifecycle:**

| File | Role |
|------|------|
| `bookedLead.service.ts` | Core CRUD: create, update, delete, populate. Canonical wrappers use `createBookedLeadInTransaction` ([`domain-commands.md`](./domain-commands.md)). |
| `bookedLeadFromSource.service.ts` | Form/phone submission bridge → `createBookedLead` |
| `bookingMirror.service.ts` | Lead ↔ booking state sync + lead-update refresh |
| `referralBooking.service.ts` | Referral bookings (no source lead) |
| `leadlessBooking.service.ts` | Leadless bookings + `BookingLeadReconciliationCase` |

Helpers in same folder: `bookingSourceResolver.ts` (lead lookup/create), `bookingWarnings.ts` (zero-binder warnings). Agent resolution: see `agent-allocation.md`.

## HTTP entry points

| Route | Service |
|-------|---------|
| `POST /api/v1/booked-leads` | `createBookedLead` — full payload, linked lead required |
| `POST /api/v1/booked-leads/from-source` | `createBookedLeadFromSource` |
| `PATCH /api/v1/booked-leads/:id` | `updateBookedLead` |
| `DELETE /api/v1/booked-leads/:id?cascade=` | `deleteBookedLead` |
| `GET /api/v1/booked-leads` | `findAllBookedLeads` (last 200) |
| `POST /api/v1/referral-bookings` | `createReferralBooking` |
| `POST /api/v1/leadless-bookings` | `createLeadlessBooking` |

## Create paths

```
Form/phone intake          Direct API                 Referral / leadless
(from-source)              (booked-leads)
      │                          │                          │
      ▼                          ▼                          ▼
resolveBookingSourceLead   input.lead_ref/model      no source lead
      │                          │                          │
      └──────── createBookedLead ─┘         createReferralBooking
                    │                       createLeadlessBooking
            mirrorBookingToLead                 (no lead mirror)
                    │
            Booking Chain Sheet Sync        booked_lead Sheet Sync
```

Public employee submit is a separate HTTP path ([`employee-bookings.md`](./employee-bookings.md)) that may book-and-link or create a leadless booking + reconciliation case.

### 1. From source (`createBookedLeadFromSource`)

1. **`resolveBookingSourceLead`** (`bookingSourceResolver.ts`):
   - **FormLead:** load by `form_lead_id`; use submitted `job_no`.
   - **CallLead:** match by `call_job_no` (409 if multiple); else phone via `findBestCallLeadMatchByPhone`; else **create** new Call Lead with `created_on_unmatched: true` (**Unmatched Call Lead** — excluded from lead-cost **Analytics**). Requires `call_job_no` or `call_phone_number`.
2. **`effectiveBookingSourceCompany`** — override from form label/parsing, else lead’s company. If override provided, writes `lead.source_company` before booking.
3. **`deriveBookedLeadAgentAllocations`** from `agent`, optional `split_agent`, `binder_amount`.
4. Delegates to **`createBookedLead`** with `lead_ref`, optional `customer_name`/`customer_phone`, `submission_id`.

### 2. Direct (`createBookedLead`)

Pre-transaction (outside Mongo txn):

- `resolveAgentAllocations`, `resolveActiveMerchantName`, `resolveTotalBinderAmount`, `buildBookedLeadWarnings`.

Inside `runSheetSyncWrite`:

1. Load linked lead; derive **`source`** on booking via `resolveBookedLeadSource` (form-lead company correction → lead company → input `source`).
2. **`local`:** request or lead; **required for FormLead**, optional for CallLead.
3. **Customer:** `upsertCustomerFromBookingContact` when name override; else `upsertCustomerFromLead`.
4. **One booking per lead:** `findOne({ lead_ref, lead_model })`.
   - **Same `submission_id`:** idempotent duplicate — return existing booking, warn event `booking.duplicate_submission_ignored`, **no sheet job**.
   - **Existing, different submission:** **upsert** booking fields + `mirrorBookingToLead` → `booking_chain` / `booked_lead.upsert`.
   - **No existing:** insert + mirror → `booking_chain` / `booked_lead.create`.
5. **`mirrorBookingToLead`:** sets `lead.booked`, threshold flags, optional `source_company`/`local`, recomputes `lead.cpl`.

Post-commit: `finalizeSheetSync`; operational events `booking.created` or `booking.upserted`.

### 3. Referral (`createReferralBooking`) — **Referral Booking**

- **No** `lead_ref` / `lead_model`; `is_referral_booking: true`, `source: "referral"`.
- **409** if `job_no` already exists globally.
- Customer from contact fields only; **no** `mirrorBookingToLead`.
- Sheet job: `resource: "booked_lead"`, `operation: "referral_booking.create"` (not `booking_chain`).
- **Update/delete/cancel not supported yet** (409 from booked-lead and cancellation resolvers).
- Separately, the gated Granot lifecycle Owner command in `granotLifecycle/referralBooking.ts` creates the same canonical no-Lead shape from an accepted immutable Referral Observation plus explicit official fields. It writes through the canonical executor, attaches only a booking-only Granot Record Link, and targets Master Booked. An existing Referral case may fully replace official Booking fields through the lifecycle `updateBooking` command without creating a Lead; legacy public referral update remains unsupported.

### 4. Leadless (`createLeadlessBooking`)

- `POST /api/v1/leadless-bookings`. Sets `is_leadless_booking`. **409** if `job_no` already exists.
- Resolves source via `resolveLeadSourceAssignment`. Opens a `BookingLeadReconciliationCase`.
- Sheet job: `resource: "booked_lead"`, `operation: "leadless_booking.create"`.
- Distinct from referral (`source: "referral"`) and from employee public submit.

## Update (`updateBookedLead`)

- Blocks referral bookings and bookings missing lead metadata (409).
- Merchant re-resolved when provided; deposit drives `over_2000` / `over_4000`.
- Agent changes: `resolveAgentAllocations` + `patch` (default) or `replace` — see `agent-allocation.md`.
- Txn: save booking, `mirrorBookingToLead` (no source_company override on update), `booking_chain` / `booked_lead.update`.

## Delete (`deleteBookedLead`)

Requires linked lead (non-referral). If `booking.cancelled` set, needs `cascade=true`.

**Queued mode:**

1. Optionally tombstone + delete linked `CancelledLead`.
2. `clearBookingFromLead` (no inline sync — job enqueued).
3. `source_lead` job `delete_booked_lead` to refresh lead row.
4. Tombstone + delete `BookedLead`.

**Legacy mode:** cascade-delete cancellation, `clearBookingFromLead`, `deleteBookedLeadFromSheets`, Mongo delete.

Referral delete: 409 (not supported).

## Lead mirror (`bookingMirror.service.ts`)

### `mirrorBookingToLead`

Called on every lead-attached booking create/upsert/update. Writes booking linkage and threshold flags back to the source lead; may overwrite `source_company` (form booking correction) and `local`; recomputes `cpl`.

### `refreshAttachedBookingFromLead`

Called from **form/call lead update** paths after lead save:

- No `lead.booked` → return `source_lead` sync job only.
- Booking missing or `lead_ref`/`lead_model` mismatch → log warning, `source_lead` job only.
- Else sync customer + `local` onto booking if changed → return `booking_chain` job.

### `clearBookingFromLead`

Booking delete: clears `booked`, `cancelled`, threshold flags on lead. Legacy path also runs inline `syncSourceLead`; queued path relies on enqueued `source_lead` job.

## Derived fields and invariants

| Field | Rule |
|-------|------|
| `agent_allocations` | ≥ 1; resolved active catalog agents; see agent allocation doc |
| `total_binder_amount` | Sum of allocation binders (±0.001) |
| `over_2000` / `over_4000` | From `deposit_amount` thresholds (>2000, >4000) |
| `source` (booking) | Canonical source company string for sheets/reporting |
| `submission_id` | Idempotency key for repeat form posts |
| `cancelled` | Set by cancellation flow (not booking service) |

**Lead linkage:** Non-referral bookings require `lead_ref` + `lead_model`. Schema enforces via pre-validate hook.

**Upsert vs duplicate:** Second create for same lead **updates** the booking unless `submission_id` matches — then no-op with existing doc returned.

**Unmatched Call Leads:** Created at booking time when call identity cannot be resolved; flagged `created_on_unmatched: true`.

## Sheet Sync

| Path | Resource | Operations |
|------|----------|------------|
| Lead-attached create | `booking_chain` | **Booking Chain** — `booked_lead.create` |
| Lead-attached re-book / upsert | `booking_chain` | `booked_lead.upsert` |
| Lead-attached update | `booking_chain` | `booked_lead.update` |
| Lead-attached delete | tombstone + `source_lead` | `delete_booked_lead` |
| Referral create / lifecycle update | `booked_lead` | `referral_booking.create`, `referral_booking.update` |
| Leadless create | `booked_lead` | `leadless_booking.create` |
| Lead update with booking | `booking_chain` or `source_lead` | from `refreshAttachedBookingFromLead` |

**Booking Chain** refreshes **Master Booked** (`Booked Deals` tab) and the linked source lead row. Details: [`google-sheets.md`](./google-sheets.md), [`sheet-sync.md`](./sheet-sync.md).

## Warnings and events

- **Warnings:** zero binder per agent (`buildBookedLeadWarnings`) — non-blocking.
- **Events:** `booking.created`, `booking.upserted`, `booking.duplicate_submission_ignored`.

## Lifecycle revision

`domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical Booking/leadless/Referral create/update/delete adapters persist append-only `EntityChange` rows and stamp `last_change_*` in the executor transaction. One Booking per normalized Job Number remains the unique partial index contract; collisions block unique-index apply. Granot lifecycle Referral commands are implemented but remain disabled by checked-in gates.

## Related rules

- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — outbox, drainer mechanics

## Related services

- [`cancelled-lead.md`](./cancelled-lead.md) — **Cancellation** (referral blocked)
- [`agent-allocation.md`](./agent-allocation.md) — **Agent Allocation**, **Binder**
- [`analytics.md`](./analytics.md) — **Analytics** over bookings

## Do not bypass

- `resolveBookingSourceLead` / `effectiveBookingSourceCompany` for from-source creates
- `resolveAgentAllocations`, `resolveTotalBinderAmount` for allocation writes
- `mirrorBookingToLead` / `clearBookingFromLead` for lead state consistency
- `runSheetSyncWrite` + `persistSheetSyncIntent` / tombstone helpers for sheet-backed mutations
