---
type: Service
title: "Bookings (`bookings/`)"
description: Create, update, and delete Booked Leads, including from-source, referral, leadless, and booking-chain sync.
tags: [booking, sheet-sync]
status: draft
stale_after: 2026-11-20
resource: src/services/bookings/bookedLead.service.ts
applies_to:
  - src/services/bookings/bookedLead.service.ts
  - src/services/bookings/bookedLeadFromSource.service.ts
  - src/services/bookings/bookingSourceResolver.ts
  - src/services/bookings/bookingMirror.service.ts
  - src/services/bookings/referralBooking.service.ts
  - src/services/bookings/leadlessBooking.service.ts
  - src/services/bookings/bestRelocationImportGuard.ts
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/confirmAttachment.ts
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - src/services/granotLifecycle/connectBookingToLead.ts
  - src/services/granotLifecycle/connectLead.ts
  - src/routes/v1.routes.ts
  - src/routes/granot-lifecycle-admin.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/bookings/bookedLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-28T19:15:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/bookings/`  
**Domain terms used:** [Booking](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Binder](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Bookings (`bookings/`)

**System of Record:** MongoDB `booked_leads`. Lead-attached Bookings mirror state onto Form Leads / Call Leads (`booked`, threshold flags, optional source assignment, recomputed CPL). Owner reporting via **Sheet Sync** (**Master Booked** + source lead rows).

Public mutating routes go through canonical adapters (`handleCanonicalCreate` / `Update` / `Delete`) and the executor ([`domain-commands.md`](./domain-commands.md)). The service functions below are the write primitives those adapters call.

**Five services — one lifecycle:**

| File | Role |
|------|------|
| `bookedLead.service.ts` | Core CRUD: create, update, delete, populate |
| `bookedLeadFromSource.service.ts` | Form/phone submission bridge → `createBookedLead` |
| `bookingMirror.service.ts` | Lead ↔ booking state sync + lead-update refresh + employee claim |
| `referralBooking.service.ts` | Referral bookings (no source lead) |
| `leadlessBooking.service.ts` | Leadless bookings; Best Relocation import may open a `BookingLeadReconciliationCase` |

Helpers: `bookingSourceResolver.ts`, `bookingWarnings.ts`, `bookingIdentity.ts`, `bestRelocationImportGuard.ts`. Agent resolution: [`agent-allocation.md`](./agent-allocation.md).

## HTTP entry points

| Route | Service / command |
|-------|-------------------|
| `POST /api/v1/booked-leads` | `createBookingFromLead` → `createBookedLead` |
| `POST /api/v1/booked-leads/from-source` | `createBookingFromLead` → `createBookedLeadFromSource` |
| `PATCH /api/v1/booked-leads/:id` | `updateBookedLead` |
| `DELETE /api/v1/booked-leads/:id?cascade=` | `deleteBookedLead` |
| `GET /api/v1/booked-leads` | `findAllBookedLeads` (last 200) |
| `POST /api/v1/referral-bookings` | `createExistingReferralBooking` → `createReferralBooking` |
| `POST /api/v1/leadless-bookings` | `createLeadlessBooking` |
| `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates` | Owner-only `listConnectLeadCandidates` |
| `POST /api/v1/admin/bookings/:bookingId/connect-lead` | Owner-only `connectBookingToLead` |

Public employee submit is a separate HTTP path ([`employee-bookings.md`](./employee-bookings.md)) that may book-and-link via `claimAvailableLeadForBooking` or create a leadless booking + reconciliation case. Gated Granot Owner Confirm may also mint an official [Leadless Booking](../../../../CONTEXT.md) — see **5. Granot Owner Confirm / Update** below. That path is not `POST /api/v1/leadless-bookings` and does not open a `BookingLeadReconciliationCase`.

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

### 1. From source (`createBookedLeadFromSource`)

1. **`resolveBookingSourceLead`** (`bookingSourceResolver.ts`):
   - **FormLead:** load by `form_lead_id`; use submitted `job_no`.
   - **CallLead:** match `job_no` (Best Relocation import also filters `source_company=best_relocation_leads`). **409** if more than one match (search is newest-first, limit 5). A single job match may overwrite `phone_number` when the request sent one.
   - Else phone via `findBestCallLeadMatchByPhone` (same import filter). A phone match writes submitted `job_no` / `phone_number` onto the lead.
   - Else **create** a Call Lead with `created_on_unmatched: true`, `form_fill` from `hasFormFillForCallLead`, Florida `timestamp`, and CPL snapshot with `applicable: false`. Requires `call_job_no` or `call_phone_number` at Zod.
   - Direct `createBookedLead` may omit `job_no` so a Call Lead can be booked before a Job Number exists. Public `/booked-leads` Zod still requires `job_no`.
2. Optional `source_company` override runs `resolveLeadSourceAssignment` (channel from lead model). That assignment + a new CPL snapshot is written onto the lead **before** booking. Missing CPL after that write emits `lead.cpl.missing_rate` on the public path (canonical path emits it in `finalize`).
3. Display `source` on the booking is the lead/assignment snapshot label when present, else the company slug.
4. **`deriveBookedLeadAgentAllocations`** from `agent`, optional `split_agent`, `binder_amount`.
5. Delegates to **`createBookedLead`** with `lead_ref`, optional `customer_name`/`customer_phone`, `submission_id`.

**Best Relocation import** (`ingestion_source=best_relocation_sheet`): `requireBestRelocationImportSource` requires `best_relocation_leads`. When true, create may resolve **inactive** catalog agents (`allow_inactive_agents`) and, if the lead has no receiver yet, stamp primary-agent receiver attribution (`receiver_agent_source: best_relocation_sheet`, value `Booked Deals:<job_no>`).

### 2. Direct (`createBookedLead`)

Pre-transaction (outside Mongo txn):

- `resolveAgentAllocations` (optional `includeInactive`), `resolveActiveMerchantName`, `resolveTotalBinderAmount`, `buildBookedLeadWarnings`.

Inside `runSheetSyncWrite` / `persistBookedLeadCreateInTransaction`:

1. Load linked lead. Best Relocation import also guards `lead.source_company`.
2. **`source` on the booking** via `resolveBookedLeadSource`: Form Lead company correction (`getFormLeadSourceCompanyForBooking`) → lead snapshot labels (`crm_source_label_snapshot` / granularity / company) → resolved lead company label → input `source`.
3. **`local`:** request or lead; **required for FormLead**, optional for CallLead.
4. **Customer:** `upsertCustomerFromBookingContact` when name override; else `upsertCustomerFromLead`.
5. **One booking per lead:** `findOne({ lead_ref, lead_model })`.
   - **Same `submission_id`:** return existing booking, event `booking.duplicate_submission_ignored`, **no sheet job**.
   - **Existing, different submission:** **upsert** booking fields + `mirrorBookingToLead` → `booking_chain` / `booked_lead.upsert`.
   - **No existing:** insert + mirror → `booking_chain` / `booked_lead.create`.
6. **`mirrorBookingToLead`:** sets `lead.booked`, threshold flags, optional source assignment + CPL snapshot, optional `local`.

Post-commit: `finalizeSheetSync`; events `booking.created` or `booking.upserted`.

### 3. Referral (`createReferralBooking`) — **Referral Booking**

- **No** `lead_ref` / `lead_model`; `is_referral_booking: true`, `source: "referral"`.
- **409** if `job_no` already exists (raw `job_no` lookup, not only the normalized unique index).
- Customer from contact fields only; **no** `mirrorBookingToLead`.
- Sheet job: `resource: "booked_lead"`, `operation: "referral_booking.create"` (not `booking_chain`).
- Public **update is 409**. Public **delete is allowed** (no linked lead required when `is_referral_booking`). Public **cancel is 409** ([`cancelled-lead.md`](./cancelled-lead.md)).
- Separately, the gated Granot lifecycle Owner command in `granotLifecycle/referralBooking.ts` creates the same canonical no-Lead shape from an accepted immutable Referral Observation plus explicit official fields. Checked-in Referral flags stay false.

### 4. Leadless (`createLeadlessBooking`)

- `POST /api/v1/leadless-bookings`. Sets `is_leadless_booking`. **409** if `job_no` already exists.
- Resolves source via `resolveLeadSourceAssignment`. Channel is `call` when the optional `source` label matches `/inbound|call/i`, else `form`. Stored `source` is the request label or the assignment snapshot.
- **Does not** open a `BookingLeadReconciliationCase` on the ordinary admin path. A case is created only when `ingestion_source=best_relocation_sheet` (origin `external_sheet_ingestion`, `status=pending`, `reason=no_match`). Employee public submit opens its own cases ([`employee-bookings.md`](./employee-bookings.md)).
- Best Relocation import may resolve inactive agents.
- Sheet job: `resource: "booked_lead"`, `operation: "leadless_booking.create"`.
- Public **update is 409**. Public **delete is allowed**. Public **cancel is 409** unless Best Relocation import sets `allowLeadless`.

### 5. Granot Owner Confirm / Update — official Leadless

Gated Owner commands in `granotLifecycle/` (`bookingConfirmation.ts`, `confirmAttachment.ts`, `bookingOwnerCommands.ts`). Distinct from `POST /api/v1/leadless-bookings` and from employee submit.

- **Confirm** may attach a Lead or write official `is_leadless_booking: true` (no `lead_ref` / `lead_model`, customer from Observation contact, booking-only Record Link). Attachment resolution is server-owned. Lost attached-path claim fails closed; it does not fall through to Leadless. See [`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md).
- **Update Existing Booking** (`updateExistingBooking`) allows a Granot official Leadless Booking: `isGranotOfficialLeadlessBooking` — leadless, not referral, not `booking_origin=employee_booking`, no `lead_ref` / `lead_model`. Official fields only; Master Booked sheet. Employee and public leadless rows stay rejected here.
- **Connect Booking to Lead** (`connectBookingToLead`) is an Owner-only command on a connectable Leadless Booking: present, not cancelled, not Referral, and Leadless or missing `lead_ref`. The Owner picks an eligible unbooked Form or Call Lead from `/bookings` or `/manual` (not `/bookings/reconciliation`). The command claims the Lead, sets `lead_ref` / `lead_model` / `is_leadless_booking: false`, mirrors booked onto the Lead without rewriting official Binder / Agents / Deposit / Merchant / book date or CPL, writes EntityChange for Booking and Lead (and an existing Record Link if one is already there — it does not mint a new link), and queues one coalescible `booking_chain` / `booked_lead.connect_lead`. Exact same Lead is `already_satisfied`. A different Lead or an already-booked Lead is `IDENTITY_CONFLICT`. Stale booking revision is `DOMAIN_REVISION_CONFLICT`. Flag-off is `422 POLICY_BLOCKED`. Candidate search is `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates`; empty `q` returns an empty page. See [`owner-booking-intake.md`](../granot-lifecycle/owner-booking-intake.md).

## Update (`updateBookedLead`)

- Public `updateBookedLead` **409** for referral, leadless, or missing `lead_ref`/`lead_model`. **404** if missing. That public 409 still applies. The gated Granot Owner path above is the exception for Granot official Leadless.
- Merchant re-resolved when provided; deposit drives `over_2000` / `over_4000`.
- Agent changes: `resolveAgentAllocations` + `patch` (default) or `replace` — see [`agent-allocation.md`](./agent-allocation.md). Warnings are built from the **incoming** resolved list, not the merged list.
- `local` = `input.local ?? booking.local ?? lead.local`.
- Canonical `updateBookedLeadInTransaction`: if no `BOOKED_LEAD_CHANGE_PATHS` diffs, **noop** — no save, no mirror, no Sheet job.
- Public `updateBookedLead` always saves + mirrors + `booking_chain` / `booked_lead.update` (no field-diff short-circuit).
- Mirror on update does **not** pass a source-company override.

## Delete (`deleteBookedLead`)

**404** if missing. **409** if the booking has neither a linked lead nor `is_referral_booking` / `is_leadless_booking`. If `booking.cancelled` is set, needs `cascade=true`.

Referral and leadless **delete** are supported (they skip `clearBookingFromLead` when there is no lead).

**Queued mode:**

1. Optionally tombstone + delete linked `CancelledLead`.
2. `clearBookingFromLead` when a lead exists (`syncAfterClear: false`).
3. `source_lead` job `delete_booked_lead` when a lead exists.
4. Tombstone `delete_booked_lead` for the booking itself, then Mongo delete.

**Legacy mode:** cascade-delete cancellation sheets, `clearBookingFromLead` (inline sync), `deleteBookedLeadFromSheets`, Mongo delete.

## Lead mirror (`bookingMirror.service.ts`)

### `mirrorBookingToLead`

Called on every lead-attached booking create/upsert/update. Writes `booked`, `over_2000`, `over_4000`; may write `local`; when `sourceCompany` is passed, runs `resolveLeadSourceAssignment` onto the lead; recomputes CPL unless `preserveExistingCpl=true` (reconciliation / employee claim paths).

### `refreshAttachedBookingFromLead`

Called from **form/call lead update** after lead save:

- No `lead.booked` → `source_lead` job only.
- Booking missing or `lead_ref`/`lead_model` mismatch → `source_lead.update.booking_*` warn, `source_lead` job only.
- Else upsert customer from the lead and copy `local` when the lead has a value. Save the booking only if customer or `local` changed. Always return `booking_chain` when the booking is valid.

### `clearBookingFromLead`

Booking delete: clears `booked`, `cancelled`, threshold flags. Legacy path also runs inline `syncSourceLead`; queued path relies on the enqueued `source_lead` job.

### `claimAvailableLeadForBooking`

Atomic `updateOne` used by employee submit. Filter: not booked, not cancelled, not duplicate; Call Leads also `created_on_unmatched != true`. Sets `booked` + thresholds + optional `local`. **Does not rewrite CPL.** Returns `false` when another writer already claimed the lead (test: concurrent claims, only one wins).

## Derived fields and invariants

| Field | Rule |
|-------|------|
| `agent_allocations` | ≥ 1; catalog resolve; see agent allocation |
| `total_binder_amount` | Sum of allocation binders (±0.001) |
| `over_2000` / `over_4000` | From `deposit_amount` (`>` 2000 / 4000) |
| `source` (booking) | Display label for sheets/reporting |
| `submission_id` | Idempotency for repeat form posts; employee path uses a separate unique index |
| `cancelled` | Set by cancellation flow (not this service) |
| `normalized_job_no` | Pre-save from `job_no`; unique partial index `booked_lead_normalized_job_no_unique` (accepted alias `normalized_job_no_1`) |

**Lead linkage:** Non-referral, non-leadless bookings require `lead_ref` + `lead_model`. Schema enforces via pre-validate hook.

**Upsert vs duplicate:** Second create for the same lead **updates** the booking unless `submission_id` matches — then no-op with the existing doc returned.

**Unmatched Call Leads:** Created at booking time when call identity cannot be resolved; `created_on_unmatched: true`. Sheet Sync skips a misleading Calls-tab row for those stubs (`jobPlanner.ts`).

## Sheet Sync

| Path | Resource | Operations |
|------|----------|------------|
| Lead-attached create | `booking_chain` | `booked_lead.create` |
| Lead-attached re-book / upsert | `booking_chain` | `booked_lead.upsert` |
| Lead-attached update | `booking_chain` | `booked_lead.update` |
| Lead-attached delete | tombstone `delete_booked_lead` + optional `source_lead` | `delete_booked_lead` |
| Referral create / lifecycle update | `booked_lead` | `referral_booking.create`, `referral_booking.update` |
| Leadless create (`POST /api/v1/leadless-bookings`) | `booked_lead` | `leadless_booking.create` |
| Granot Confirm attached | `booking_chain` | `booked_lead.create` |
| Granot Confirm Leadless | `booked_lead` | `granot_booking.create_leadless` |
| Granot Update attached | `booking_chain` | `booked_lead.update` |
| Granot Update Leadless | `booked_lead` | `booked_lead.update` |
| Granot Connect Booking to Lead | `booking_chain` | `booked_lead.connect_lead` |
| Lead update with booking | `booking_chain` or `source_lead` | from `refreshAttachedBookingFromLead` |

**Booking Chain** refreshes **Master Booked** (`Booked Deals` tab) and the linked source lead row. Details: [`google-sheets.md`](./google-sheets.md), [`sheet-sync.md`](./sheet-sync.md).

## Warnings and events

- **Warnings:** zero binder per agent (`buildBookedLeadWarnings`) — non-blocking.
- **Events:** `booking.created`, `booking.upserted`, `booking.duplicate_submission_ignored`.

## Lifecycle revision

`domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical Booking/leadless/Referral create/update/delete adapters persist append-only `EntityChange` rows and stamp `last_change_*` in the executor transaction. One Booking per normalized Job Number remains the unique partial index contract; collisions block unique-index apply. Granot lifecycle Referral commands are implemented but remain disabled by checked-in gates.

## Tests

- `bookingMirror.test.ts` — `claimAvailableLeadForBooking` concurrency + no CPL rewrite; `preserveExistingCpl`
- `bookingIdentity.test.ts` — job/name normalize
- `bestRelocationImportGuard.test.ts` — source-company fence
- `agentAllocation.service.test.ts` — inactive-agent resolve + receiver attribution
- Domain-command adapters in `domainCommands.test.ts`
- `connectLead.test.ts` — connectable booking / eligible Lead fences, sheet intent `booking_chain` / `booked_lead.connect_lead`
- `connectLeadCandidates.test.ts` — empty `q` is an empty page; non-connectable booking is `IDENTITY_CONFLICT`
- `connectBookingToLead.replica.test.ts` — happy-path EntityChange + sheet intent (skipped unless the Booking-command flag is on)

## Related services

- [`cancelled-lead.md`](./cancelled-lead.md) — **Cancellation** (public referral blocked; public leadless only via Best Relocation import). Confirm Granot Cancellation on Granot official Leadless succeeds without a Lead mirror ([`release-reconciliation.md`](../granot-lifecycle/release-reconciliation.md)).
- [`agent-allocation.md`](./agent-allocation.md) — **Agent Allocation**, **Binder**
- [`employee-bookings.md`](./employee-bookings.md) — public submit + Owner cases
- [`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md) — gated Confirm / Update / Referral / No Action
- [`analytics.md`](./analytics.md) — **Analytics** over bookings

## Do not bypass

- `resolveBookingSourceLead` / `resolveLeadSourceAssignment` for from-source creates
- `resolveAgentAllocations`, `resolveTotalBinderAmount` for allocation writes
- `mirrorBookingToLead` / `clearBookingFromLead` / `claimAvailableLeadForBooking` for lead state
- `runSheetSyncWrite` + `persistSheetSyncIntent` / tombstone helpers for sheet-backed mutations
