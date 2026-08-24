---
type: Service
title: Customer Service
description: Customer CRUD and booking-time upsert from lead or contact.
tags: [customer, booking]
status: draft
stale_after: 2026-11-20
resource: src/services/customers/customer.service.ts
applies_to:
  - src/services/customers/customer.service.ts
  - src/services/customers/customerFromLead.service.ts
  - src/routes/v1.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/customers/customer.service.ts
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
**Primary code:** `src/services/customers/`  
**Domain terms used:** [Customer](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Customer Service

**System of Record:** MongoDB `customers` collection. Bookings reference **Customers** via `BookedLead.customer` (`ObjectId`); denormalized `customer_name` may also live on the Booking.

**Role:** Route-facing CRUD plus booking-time upsert helpers. **Customers** are not created from Form Lead or Call Lead Ingestion alone — linkage happens during Booking (or manual **Admin Dashboard** CRUD). Public customer routes are still `handleCreate` / `handleUpdate` / `handleDelete` (not the Booking canonical executor).

## Module split

| File | Responsibility |
|------|----------------|
| `customer.service.ts` | HTTP CRUD: create, update, list, cascade delete |
| `customerFromLead.service.ts` | Upsert from lead or booking contact — **no booking imports** (avoids cycles) |

## Stored shape (`Customer`)

| Field | Notes |
|-------|-------|
| `full_name` | Required display name |
| `normalized_name` | Lowercase trimmed name; indexed; set by upsert helpers |
| `phone_number` | Optional; primary match key when present |
| `email` | Optional; lowercased on upsert |

Virtuals: `booked_leads`, `cancelled_leads` (populate from admin detail).

## Booking-time upsert (`customerFromLead.service.ts`)

### Match key

1. **Phone present** (trimmed): `findOneAndUpdate({ phone_number }, …, { upsert: true })`. Phone is stored as submitted (no E.164). Test: `"(240) 555-0199"` matches on that exact string.
2. **No phone:** match on `normalized_name` (`trim().toLowerCase()` on `full_name`).

Phone on booking contact wins over linked lead phone. Email comes from `customer_email` when passed, else the lead; trimmed and lowercased when set.

### `upsertCustomerFromLead(lead, session?)`

- Returns `undefined` when lead has no non-empty `name` — booking may still proceed without `customer` ref.
- Name-only leads match `normalized_name` (test: `upsertCustomerFromLead allows name-only leads`).

### `upsertCustomerFromBookingContact(input, session?)`

- Used when booking supplies `customer_name` override (direct create, from-source, referral, leadless).
- Returns `undefined` when `customer_name` is empty after trim.
- Resolves phone: `customer_phone` → lead `phone_number`. Blank customer phone falls back to the lead (test).
- Optional `customer_email` overrides lead email.

Both helpers run inside booking transactions when a `session` is passed.

Booked-call-lead reconciliation uses a **different** customer write: `Customer.findOneAndUpdate` by phone with `$setOnInsert` only ([`booked-call-lead-reconciliation.md`](./booked-call-lead-reconciliation.md)). Do not treat that path as these helpers.

## Booking callers

| Flow | Customer path |
|------|----------------|
| `createBookedLead` | `customer_name` override → `upsertCustomerFromBookingContact`; else `upsertCustomerFromLead` |
| `createReferralBooking` / `createLeadlessBooking` | `upsertCustomerFromBookingContact` from contact fields (leadless skips when name blank) |
| `refreshAttachedBookingFromLead` | Re-upsert from updated lead; updates `booking.customer` when id changes |

See [`bookings.md`](./bookings.md) for when `customer_name` override is stored on the booking document.

## HTTP API (`customer.service.ts`)

All routes under `/api/v1/customers` (require `x-api-secret`).

| Method | Handler | Notes |
|--------|---------|-------|
| `GET` | `findAllCustomers` | Newest first; **hard limit 200** |
| `POST` | `createCustomer` | `Customer.create(input)` — passes body through |
| `PATCH` | `updateCustomer` | Partial update; 404 if missing |
| `DELETE` | `deleteCustomer` | Query `cascade=true` when bookings exist |

### Delete cascade

1. `BookedLead.find({ customer: id })`.
2. If any bookings and `cascade !== true` → **409** (`Customer has bookings; pass cascade=true…`).
3. For each booking: `deleteBookedLead(id, true)` (booking delete cascade, incl. linked cancellation when applicable).
4. `Customer.findByIdAndDelete(id)`.

`deleteBookedLead` is imported via `v1.service` facade to break a load-time cycle (`bookings` ↔ `customers`).

## Admin UI

- Browse/search/export: `customers` admin resource (`adminBrowse.service.ts`, [`admin-search.md`](./admin-search.md)).
- Detail loads attached booked + cancelled leads (limit 25 each).

## Manual CRUD vs upsert helpers

`createCustomer` / `updateCustomer` do **not** recompute `normalized_name` from `full_name`. Only `customerFromLead` upserts set it.

Manual creates/updates may leave `normalized_name` empty. Later booking upserts keyed by name could create a **second** customer row for the same person if phone is absent. Prefer upsert paths for booking linkage; backfill `normalized_name` when seeding via API.

## Invariants

- Booking customer linkage is optional when lead/contact lacks a usable name.
- Do not import `deleteBookedLead` directly from `bookings/` in `customer.service.ts` — use the `v1.service` re-export.
- Do not bypass upsert helpers for booking-time customer resolution.
- Phone match takes precedence over name match; phone strings are stored as provided (no E.164 normalization in this service).
- Customer delete with bookings is destructive — requires explicit `cascade=true`.

## Tests

`customers/customerFromLead.service.test.ts` — phone match, lead-phone fallback, normalized-name match, name-only lead.

## Related modules

- Bookings: [`bookings.md`](./bookings.md), `bookingMirror.service.ts`
- Model: `models/Customer.ts`
- Validation: `validation/v1/customers.validation.ts`
