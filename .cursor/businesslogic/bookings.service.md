# Bookings (`bookings/`)

**Source of truth:** Mongo `booked_leads`. Lead-attached bookings also mirror state onto `form_leads` / `call_leads` (`booked`, `over_2000`, `over_4000`, optional `source_company`/`local`, recomputed `cpl`). Owner reporting via sheet sync (Master Booked + source lead rows).

**Four services — one lifecycle:**

| File | Role |
|------|------|
| `bookedLead.service.ts` | Core CRUD: create, update, delete, populate |
| `bookedLeadFromSource.service.ts` | Form/phone submission bridge → `createBookedLead` |
| `bookingMirror.service.ts` | Lead ↔ booking state sync + lead-update refresh |
| `referralBooking.service.ts` | Leadless referral bookings (separate create path) |

Helpers in same folder: `bookingSourceResolver.ts` (lead lookup/create), `bookingWarnings.ts` (zero-binder warnings). Agent resolution: see `agentAllocation.service.md`.

## HTTP entry points

| Route | Service |
|-------|---------|
| `POST /api/v1/booked-leads` | `createBookedLead` — full payload, linked lead required |
| `POST /api/v1/booked-leads/from-source` | `createBookedLeadFromSource` |
| `PATCH /api/v1/booked-leads/:id` | `updateBookedLead` |
| `DELETE /api/v1/booked-leads/:id?cascade=` | `deleteBookedLead` |
| `GET /api/v1/booked-leads` | `findAllBookedLeads` (last 200) |
| `POST /api/v1/referral-bookings` | `createReferralBooking` |

## Three create paths

```
Form/phone intake          Direct API                 Referral
(from-source)              (booked-leads)
      │                          │                          │
      ▼                          ▼                          ▼
resolveBookingSourceLead   input.lead_ref/model      no source lead
      │                          │                          │
      └──────── createBookedLead ─┘                    createReferralBooking
                    │                                        │
            mirrorBookingToLead                         (no mirror)
                    │
            booking_chain sheet sync              booked_lead sheet sync
```

### 1. From source (`createBookedLeadFromSource`)

1. **`resolveBookingSourceLead`** (`bookingSourceResolver.ts`):
   - **FormLead:** load by `form_lead_id`; use submitted `job_no`.
   - **CallLead:** match by `call_job_no` (409 if multiple); else phone via `findBestCallLeadMatchByPhone`; else **create** new call lead with `created_on_unmatched: true` (excluded from billable lead-cost analytics). Requires `call_job_no` or `call_phone_number`.
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

### 3. Referral (`createReferralBooking`)

- **No** `lead_ref` / `lead_model`; `is_referral_booking: true`, `source: "referral"`.
- **409** if `job_no` already exists globally.
- Customer from contact fields only; **no** `mirrorBookingToLead`.
- Sheet job: `resource: "booked_lead"`, `operation: "referral_booking.create"` (not `booking_chain`).
- **Update/delete/cancel not supported yet** (409 from booked-lead and cancellation resolvers).

## Update (`updateBookedLead`)

- Blocks referral bookings and bookings missing lead metadata (409).
- Merchant re-resolved when provided; deposit drives `over_2000` / `over_4000`.
- Agent changes: `resolveAgentAllocations` + `patch` (default) or `replace` — see `agentAllocation.service.md`.
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

**Unmatched call leads:** Created at booking time when call identity cannot be resolved; flagged `created_on_unmatched: true`.

## Sheet sync

| Path | Resource | Operations |
|------|----------|------------|
| Lead-attached create | `booking_chain` | `booked_lead.create` |
| Lead-attached re-book / upsert | `booking_chain` | `booked_lead.upsert` |
| Lead-attached update | `booking_chain` | `booked_lead.update` |
| Lead-attached delete | tombstone + `source_lead` | `delete_booked_lead` |
| Referral create | `booked_lead` | `referral_booking.create` |
| Lead update with booking | `booking_chain` or `source_lead` | from `refreshAttachedBookingFromLead` |

`booking_chain` refreshes **both** Master Booked (`bookedDeals` tab) and the linked source lead row. Details: `googleSheets.service.md`, `rules/sheet-sync-process.mdc`.

## Warnings and events

- **Warnings:** zero binder per agent (`buildBookedLeadWarnings`) — non-blocking.
- **Events:** `booking.created`, `booking.upserted`, `booking.duplicate_submission_ignored`.

## Related modules

- Agent allocations: `agentAllocation.service.md`
- Cancellations: `cancelledLead.service.md` (sets `booking.cancelled`; referral blocked)
- Customers: `customerFromLead.service.ts`
- Catalog: `resolveActiveMerchantName`
- Lead services: form/call update → `refreshAttachedBookingFromLead`
- Analytics: bookings drive agent/source reports (`analytics.service.md`)

## Do not bypass

- `resolveBookingSourceLead` / `effectiveBookingSourceCompany` for from-source creates
- `resolveAgentAllocations`, `resolveTotalBinderAmount` for allocation writes
- `mirrorBookingToLead` / `clearBookingFromLead` for lead state consistency
- `runSheetSyncWrite` + `persistSheetSyncIntent` / tombstone helpers for sheet-backed mutations
