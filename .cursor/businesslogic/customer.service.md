**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `api/services/customers/`  
**Domain terms used:** Customer, Booking, Form Lead, Call Lead, System of Record

# Customer Service

**System of Record:** MongoDB `customers` collection. Bookings reference **Customers** via `BookedLead.customer` (`ObjectId`); denormalized `customer_name` may also live on the Booking.

**Role:** Route-facing CRUD plus booking-time upsert helpers. **Customers** are not created from Form Lead or Call Lead Ingestion alone — linkage happens during Booking (or manual **Admin Dashboard** CRUD).

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

1. **Phone present** (trimmed): `findOneAndUpdate({ phone_number }, …, { upsert: true })`.
2. **No phone:** match on `normalized_name` (`trim().toLowerCase()` on `full_name`).

Phone on booking contact wins over linked lead phone. Email comes from the lead when upserting; trimmed and lowercased when set.

### `upsertCustomerFromLead(lead, session?)`

- Returns `undefined` when lead has no non-empty `name` — booking may still proceed without `customer` ref.
- Otherwise upserts and returns the customer document.

### `upsertCustomerFromBookingContact(input, session?)`

- Used when booking supplies `customer_name` override (direct create, from-source, referral).
- Returns `undefined` when `customer_name` is empty after trim.
- Resolves phone: `customer_phone` → lead `phone_number`.

Both helpers run inside booking transactions when a `session` is passed.

## Booking callers

| Flow | Customer path |
|------|----------------|
| `createBookedLead` | `customer_name` override → `upsertCustomerFromBookingContact`; else `upsertCustomerFromLead` |
| `createReferralBooking` | `upsertCustomerFromBookingContact` from referral contact fields |
| `refreshAttachedBookingFromLead` | Re-upsert from updated lead; updates `booking.customer` when id changes |

See `bookings.service.md` for when `customer_name` override is stored on the booking document.

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

- Browse/search/export: `customers` admin resource (`adminBrowse.service.ts`, `adminSearch.service.md`).
- Detail loads attached booked + cancelled leads (limit 25 each).

## Manual CRUD vs upsert helpers

`createCustomer` / `updateCustomer` do **not** recompute `normalized_name` from `full_name`. Only `customerFromLead` upserts set it.

Manual creates/updates may leave `normalized_name` empty. Later booking upserts keyed by name could create a **second** customer row for the same person if phone is absent. Prefer upsert paths for production linkage; backfill `normalized_name` when seeding via API.

## Invariants

- Booking customer linkage is optional when lead/contact lacks a usable name.
- Do not import `deleteBookedLead` directly from `bookings/` in `customer.service.ts` — use the `v1.service` re-export.
- Do not bypass upsert helpers for booking-time customer resolution.
- Phone match takes precedence over name match; phone strings are stored as provided (no E.164 normalization in this service).
- Customer delete with bookings is destructive — requires explicit `cascade=true`.

## Related modules

- Bookings: `bookings.service.md`, `bookingMirror.service.ts`
- Model: `models/Customer.ts`
- Validation: `validation/v1/customers.validation.ts`
- Tests: `customers/customerFromLead.service.test.ts`
