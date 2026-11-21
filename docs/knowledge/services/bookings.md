---
type: Service
title: "Bookings (`bookings/`)"
description: Create, update, and delete Booked Leads, including from-source, referral, leadless, and booking-chain sync.
tags: [booking, sheet-sync]
status: draft
stale_after: 2026-12-08
resource: src/services/bookings/bookedLead.service.ts
applies_to:
  - src/services/bookings/bookedLead.service.ts
  - src/services/bookings/bookedLeadFromSource.service.ts
  - src/services/bookings/bookingSourceResolver.ts
  - src/services/bookings/ownerBookingAttach.ts
  - src/services/bookings/bookingMirror.service.ts
  - src/services/bookings/referralBooking.service.ts
  - src/services/bookings/leadlessBooking.service.ts
  - src/services/bookings/bestRelocationImportGuard.ts
  - src/services/bookings/bookingJobNumber.ts
  - src/services/bookings/bookingJobNumberGuard.ts
  - src/services/bookings/bookingJobNormalizationInvariant.ts
  - src/routes/booking-reconciliation-cron.routes.ts
  - src/models/BookedLead.ts
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
  at: 2026-09-08T20:30:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/bookings/`  
**Domain terms used:** [Booking](../../../../CONTEXT.md), [Precise Booking Form](../../../../CONTEXT.md), [Exact Job Booking Attach](../../../../CONTEXT.md), [Employee Booking Submission](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Booking Lead Reconciliation Case](../../../../CONTEXT.md), [Connect Booking to Lead](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md)

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
| `leadlessBooking.service.ts` | [Leadless Booking](../../../../CONTEXT.md) create; Owner [Precise Booking Form](../../../../CONTEXT.md) pending and Best Relocation import each open a [Booking Lead Reconciliation Case](../../../../CONTEXT.md) |

Helpers: `bookingSourceResolver.ts`, `ownerBookingAttach.ts`, `bookingWarnings.ts`, `bookingIdentity.ts`, `bestRelocationImportGuard.ts`. Agent resolution: [`agent-allocation.md`](./agent-allocation.md).

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

Public [Employee Booking Submission](../../../../CONTEXT.md) is a separate HTTP path ([`employee-bookings.md`](./employee-bookings.md)) that may book-and-link via `claimAvailableLeadForBooking` or create a [Leadless Booking](../../../../CONTEXT.md) + [Booking Lead Reconciliation Case](../../../../CONTEXT.md). Gated Granot Owner Confirm may also mint an official [Leadless Booking](../../../../CONTEXT.md) — see **5. Granot Owner Confirm / Update** below. Confirm is not `POST /api/v1/leadless-bookings` and does not open a case.

## Create paths

```
From-source attach plan    Direct API                 Referral / leadless
(resolveFromSourceAttach)  (booked-leads)
      │                          │                          │
      ▼                          ▼                          ▼
linked or Owner pending    input.lead_ref/model      no source lead
      │                          │                          │
      └──────── createBookedLead ─┘         createReferralBooking
                    │                       createLeadlessBooking
            mirrorBookingToLead                 (no lead mirror)
                    │
            Booking Chain Sheet Sync        booked_lead Sheet Sync
```

### 1. From source (`createBookedLeadFromSource`)

`resolveFromSourceAttach` (`bookedLeadFromSource.service.ts`) picks the attach plan.

**Owner [Precise Booking Form](../../../../CONTEXT.md)** (not Best Relocation import):

- **Form Lead + Mongo ID:** Owner-selected attach via `resolveBookingSourceLead`. Linked, no case, `booking_origin=owner_booking`.
- **Call Lead:** [Exact Job Booking Attach](../../../../CONTEXT.md) (`evaluateOwnerCallLeadMatch` → `queryEmployeeBookingCandidates` / `evaluateEmployeeBookingMatch`). No `findBestCallLeadMatchByPhone`. No [Unmatched Call Lead](../../../../CONTEXT.md) mint. Zod requires `call_job_no`; phone is optional. Unique job → linked, no case, `booking_origin=owner_booking`. Miss or ambiguous → [Leadless Booking](../../../../CONTEXT.md) + pending [Booking Lead Reconciliation Case](../../../../CONTEXT.md) `origin=owner_booking`, `booking_origin=owner_booking`, HTTP 201, `data.reconciliation_case_id`.

**Best Relocation import** (`ingestion_source=best_relocation_sheet`) still uses `resolveBookingSourceLead` for Call Lead: job lookup (**409** if more than one; newest-first, limit 5), else `findBestCallLeadMatchByPhone`, else mint `created_on_unmatched: true` (Unmatched Call Lead). Phone-or-job identity at Zod. Unchanged.

`resolveBookingSourceLead` remains for Form Lead requests and that import Call Lead path only.

Then:

1. Optional `source_company` override runs `resolveLeadSourceAssignment` (channel from lead model). That assignment + a new CPL snapshot is written onto the lead **before** booking. Missing CPL after that write emits `lead.cpl.missing_rate` on the public path (canonical path emits it in `finalize`).
2. Display `source` on the booking is the lead/assignment snapshot label when present, else the company slug.
3. **`deriveBookedLeadAgentAllocations`** from `agent`, optional `split_agent`, `binder_amount`.
4. Linked plans delegate to **`createBookedLead`** with `lead_ref`, optional `customer_name`/`customer_phone`, `submission_id`, and `booking_origin=owner_booking` on the Owner path. Pending Owner Call Lead plans go through `createLeadlessBookingInTransaction` (sheet `owner_booking.create_pending`).
5. Direct `createBookedLead` may omit `job_no` so a Call Lead can be booked before a Job Number exists. Public `/booked-leads` Zod still requires `job_no`.

**Best Relocation import** also: `requireBestRelocationImportSource` requires `best_relocation_leads`. When true, create may resolve **inactive** catalog agents (`allow_inactive_agents`) and, if the lead has no receiver yet, stamp primary-agent receiver attribution (`receiver_agent_source: best_relocation_sheet`, value `Booked Deals:<job_no>`).

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
- No [Booking Lead Reconciliation Case](../../../../CONTEXT.md). No `booking_origin`.
- Separately, the gated Granot lifecycle Owner command in `granotLifecycle/referralBooking.ts` creates the same canonical no-Lead shape from an accepted immutable Referral Observation plus explicit official fields. Checked-in Referral flags stay false.

### 4. Leadless (`createLeadlessBooking`)

- `POST /api/v1/leadless-bookings`. Sets `is_leadless_booking`. **409** if `job_no` already exists.
- Resolves source via `resolveLeadSourceAssignment`. Channel is `call` when the optional `source` label matches `/inbound|call/i`, else `form`. Stored `source` is the request label or the assignment snapshot.
- **Owner (non-import), including explicit [Precise Booking Form](../../../../CONTEXT.md) Leadless:** always opens a pending [Booking Lead Reconciliation Case](../../../../CONTEXT.md) `origin=owner_booking`, `reason=no_match`, sets `booking_origin=owner_booking`, HTTP 201, `reconciliation_case_id`. Sheet job: `resource: "booked_lead"`, `operation: "owner_booking.create_pending"`.
- **Best Relocation import** (`ingestion_source=best_relocation_sheet`): case `origin=external_sheet_ingestion`, `status=pending`, `reason=no_match`. Sheet stays `leadless_booking.create`. No `booking_origin`. Unchanged.
- Employee public submit opens its own cases ([`employee-bookings.md`](./employee-bookings.md)).
- Best Relocation import may resolve inactive agents.
- Public **update is 409**. Public **delete is allowed**. Public **cancel is 409** unless Best Relocation import sets `allowLeadless`.

### 5. Granot Owner Confirm / Update — official Leadless

Gated Owner commands in `granotLifecycle/` (`bookingConfirmation.ts`, `confirmAttachment.ts`, `bookingOwnerCommands.ts`). Distinct from `POST /api/v1/leadless-bookings` and from employee submit.

- **Confirm** may attach a Lead or write official `is_leadless_booking: true` (no `lead_ref` / `lead_model`, customer from Observation contact, booking-only Record Link). Attachment resolution is server-owned. Lost attached-path claim fails closed; it does not fall through to Leadless. Confirm does **not** open a [Booking Lead Reconciliation Case](../../../../CONTEXT.md). Missing `booking_origin` is still official Granot Leadless. See [`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md).
- **Update Existing Booking** (`updateExistingBooking`) allows a Granot official Leadless Booking: `isGranotOfficialLeadlessBooking` — leadless, not referral, not `booking_origin=employee_booking` or `owner_booking`, no `lead_ref` / `lead_model`. Official fields only; Master Booked sheet. Employee and Precise Form pending rows stay rejected here.
- **Connect Booking to Lead** (`connectBookingToLead`) is an Owner-only command on a connectable Leadless Booking: `isConnectableLeadlessBooking` = `isGranotOfficialLeadlessBooking` **and** no pending [Booking Lead Reconciliation Case](../../../../CONTEXT.md). `owner_booking` and `employee_booking` are not official. The Owner picks an eligible unbooked Form or Call Lead from `/bookings` or `/manual` (not `/bookings/reconciliation`). The command claims the Lead, sets `lead_ref` / `lead_model` / `is_leadless_booking: false`, mirrors booked onto the Lead without rewriting official Binder / Agents / Deposit / Merchant / book date or CPL, writes EntityChange for Booking and Lead (and an existing Record Link if one is already there — it does not mint a new link), and queues one coalescible `booking_chain` / `booked_lead.connect_lead`. Exact same Lead is `already_satisfied`. A different Lead or an already-booked Lead is `IDENTITY_CONFLICT`. Stale booking revision is `DOMAIN_REVISION_CONFLICT`. Flag-off is `422 POLICY_BLOCKED`. Candidate search is `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates`; empty `q` returns an empty page. See [`owner-booking-intake.md`](../granot-lifecycle/owner-booking-intake.md).

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

Booking delete does not delete the Lead. Inside the same delete, before the Booking document is removed, it releases live Granot claims:

- An active [Granot Record Link](../../../../CONTEXT.md) whose `booking_ref` is this Booking: `$unset` `booking_ref` and advance `domain_revision` by 1. The link stays `active`. `lead_ref`, `source_scope`, and `last_observation_id` stay. A superseded link is left alone. The write is `collection.updateOne` compare-and-swap; a lost match aborts the delete. One `GranotRecordLink` EntityChange records the cleared `booking_ref`.
- An open [Granot Booking Reconciliation Case](../../../../CONTEXT.md) whose `deterministic_booking_id` is this Booking: `$unset` that id and advance `case_revision` by 1. The case stays `open`. Resolved cases keep `deterministic_booking_id` and `resolution.entity_ref`.

Referral and leadless deletes skip `clearBookingFromLead` and still release a matching active `booking_ref`.

Cancellation delete does not clear Record Link `booking_ref`. The Booking is still there.

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

## Lead EntityChange emission (LP-03, 2026-09-22)

Sales Intelligence reads Lead state only through durable `EntityChange` rows. Every write in this Service that changes a Form Lead or Call Lead now leaves one Lead change in the same session:

- **Canonical adapters (already emitted):** `createBookingFromLead` (direct and from-source), `updateBookedLead`, `deleteBookedLead`, `createCancellation`, `attachBookingToLead`, Granot Confirm / Connect / Owner Booking commands. `mirrorBookingToLead`, `clearBookingFromLead` and `claimAvailableLeadForBooking` themselves do **not** emit, because these commands already diff the Lead and persist its change; emitting in the helper would double-stamp `domain_revision`.
- **Compatibility writers (new):** `createBookedLead`, `updateBookedLead` and `deleteBookedLead` in `bookedLead.service.ts` (still reached by `DELETE /api/v1/customers/:id` cascade) emit through `LeadChangeRecorder` with the fixed `booking-lead-mirror` system actor. The legacy/disabled Sheet Sync delete branch has no transaction; its change is written right after the Lead clear.
- **`resolveBookingSourceLead` (new):** takes an optional `{ session }`. The job-match phone correction, the phone-match job/phone correction (`correctBookingSourceCallLead`) and the Unmatched Call Lead mint (`createCallLead`) each emit with the fixed `booking-source-resolver` actor and stamp the returned document's `domain_revision`, so the booking command's later `booked` change uses the current CAS value. **Open:** `bookedLeadFromSource.service.ts` does not yet pass the command session, so these writes and their changes still commit outside the command transaction.
- `refreshAttachedBookingFromLead` writes only the Booking (customer, `local`), not the Lead; no Lead change is due.

Helper: `src/services/domainCommands/leadChangeEmission.ts` (before/after diff over `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS`, `persistEntityChangeMutations`, revision stamp). A semantic no-op emits nothing.

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
| `job_no` | Must satisfy the Booking Job Number rule on create or change (see Job Number validation) |

**Lead linkage:** Non-referral, non-leadless bookings require `lead_ref` + `lead_model`. Schema enforces via pre-validate hook.

**Upsert vs duplicate:** Second create for the same lead **updates** the booking unless `submission_id` matches — then no-op with the existing doc returned.

**Unmatched Call Leads:** Best Relocation import (and any other remaining `resolveBookingSourceLead` Call path) may mint `created_on_unmatched: true` when call identity cannot be resolved. [Precise Booking Form](../../../../CONTEXT.md) Call Lead create never mints one. Sheet Sync skips a misleading Calls-tab row for those stubs (`jobPlanner.ts`). Distinct from [No-Sync Lead](../../../../CONTEXT.md).

## Job Number validation (Owner rule, 2026-11-20)

Every Booking must carry a valid Job Number, and a valid Job Number is never rejected. The rule is `classifyBookingJobNumber` (`bookings/bookingJobNumber.ts`, version `booking-job-number-v1`). It runs on `normalizeJobNo` output (NFKC, punctuation and whitespace runs to one space, uppercase):

- exactly one token contains a number: an optional ASCII letter prefix and **4–9 ASCII digits** (the digit core);
- a bare digit token may follow one letters-only token (a separated prefix, `P-5556759` → `P 5556759`);
- every other token is letters only (Granot annotations such as `NEW`, `VIP`, `RIGOS`).

Rejected, with a reason: `missing` (absent, empty or punctuation only), `no_digits` (free text such as a name), `multiple_numbers` (`EJBA03-LL-20260908-A`), `mixed_token` (`5556759A`, `LNS03W01`) and `digit_core_length` (fewer than 4 or more than 9 digits; a 10-digit value is a phone number).

**Valid classes, measured read-only on production 2026-11-20** (`ops/booking-job-number/replay.ts`, 416,215 stored values across the 21 collections and 40 fields in `ops/booking-job-number/sources.ts`: Bookings, Cancellations, Form and Call Leads, Record Links, Granot observations, case observations, webhook and archived receipts, booking and release cases and discrepancies, case statements, history archive chunks, booking reconciliation cases, source-row receipts and states, Contact Numbers, Outreach subjects, Daily Operations events):

| Class | Example | Values | Where |
|---|---|---|---|
| `prefixed` | `P5556818`, `RF5555499`, `AT5564415`, `EJBA5555555` (test) | 217,836 | Granot extension and collector, Bookings (603), Leads, Record Links, all Granot evidence |
| `digits` | `5556835` | 197,797 | Bookings (471), Form Leads (4,541), Granot webhooks and cases |
| `annotated` | `P5556759 new`, `P5556759 VIP`, `P5556759 VIP RIGOS` | 538 | July 2026 Form Leads (45) and their Record Links, Contact Numbers, Daily Operations |
| `separated_prefix` | `P-5556759` | 0 stored | accepted so a hyphenated entry is never refused |

All digit cores observed are 7 digits; no leading-zero or letter-suffix Job exists. 334 values needed normalization (lowercase annotations, whitespace). Rejected: only the two known bad Bookings and their derivatives (8 values): the September 8 employee-booking test (`6aa06db8…`, its test Call Lead `6aa06da7…` and its Daily Operations event) and the August 10 Booking whose `job_no` holds the customer's name (`6a7a47df…`). 36 empty strings (Granot observations, receipts and one Daily Operations event) are absent Job Numbers, not Booking inputs.

**Enforcement point.** `BookedLead` checks the rule in `pre("validate")` for a new Booking or a changed `job_no` (every create, update and reconciliation path saves a document: `createBookingFromLead` including from-source, `createLeadlessBooking`, `createExistingReferralBooking`, `submitEmployeeBooking`, `updatePendingEmployeeBooking`, `updateBookedLead`, `confirmGranotBooking`, Granot Referral). Query writes get the same check: an update that sets `job_no` through `$set`, `$setOnInsert` or a top-level key, or `$unset`s it (`updateOne`, `updateMany`, `findOneAndUpdate`, `findByIdAndUpdate`), and a replacement (`replaceOne`, `findOneAndReplace`), are checked and their `normalized_job_no` rewritten in step. Aggregation-pipeline updates and `$rename` of `job_no` cannot be checked and are refused outright; no code path uses them. The would-reject record names the Booking only for a single ObjectId `_id` filter, otherwise `unknown`. The raw `BookedLead.collection.updateOne` writers (`updateBooking`, Granot Update/Release/Connect, cancellation claim) never set `job_no`. An untouched legacy value is not re-checked, so cancellation, unrelated edits and deletion of an old record still work.

**Modes (runtime configuration in Mongo, never an env var).** `booking_job_number_control` `{ _id: "validation", mode }`. Missing or any value other than `enforce` reads as `shadow`:

- `shadow` (default): the write proceeds; one `booking_job_number_checks` document per Booking, reason and value length (`_id` `<booking_id|unknown>:<reason>:<length>`) records `reason`, `write_path`, `value_length`, `rule_version` and timestamps. The value is never stored, hashed or logged: a rejected value is often a customer's name, and an unsalted hash of a name can be reversed by guessing. It is written in the caller's transaction, so an aborted write leaves no record. Expected volume: under 10 documents a year (2 bad values in 1,077 Bookings over five months); no TTL.
- `enforce`: the write throws `BookingJobNumberError` (`AppError`, HTTP **422**, code `booking.job_number_invalid`, message naming the reason). Both `/api/v1` and the Granot lifecycle admin routes answer `BookingJobNumberError.toHttpBody()`: `{ ok: false, code: "booking.job_number_invalid", error, issues: [{ path: "job_no", message: <reason> }] }`, plus `request_id` on the lifecycle routes. Nothing is written.

Operator: `node --env-file=.env --import tsx ops/booking-job-number/control.ts status` (read-only: mode and would-reject counts by reason and path); `… set --mode=enforce --reason="…" --actor="…" --apply` (the Owner decides; `--mode=shadow` or deleting the document is the rollback).

**Equivalence (Pool admission and Booking validation only).** `bookingJobNumbersEquivalent` and `bookingJobNumberKey` compare digit cores by structure (the same token grammar, without the 4–9 digit write-time bound, so no equivalence that held before the rule is lost). For Pool admission's Booking hold and for this rule, `P5556759 NEW`, `P 5556759`, `RF5556759` and `5556759` are one Job. `bookingJobNumberFilter` reads `booked_leads` by exact keys plus one anchored digit-core regex, both with `$type: "string"` so the partial `normalized_job_no` index is usable.

Everywhere else still uses `jobNumberDigitCore` (`/^[A-Z]*(\d+)$/`), which gives a separated (`P 5556759`) or annotated (`P5556759 NEW`) key **no** core: cancellation correlation, employee-booking Lead matching, `equivalentNormalizedJobFilter` and the unique `normalized_job_no` index treat those keys as different from `P5556759`. Production holds 0 such Bookings (the 538 annotated values are on Leads and their derivatives). **Follow-up, not in this change:** extend the employee-booking and cancellation cross-path matching to these classes, or canonicalize the stored key, with a backfill.

**Normalization invariant.** Pool admission reads Booking Jobs only through `normalized_job_no`, so every Booking's key must equal `normalizeJobNo(job_no)`. `runBookingJobNormalizationInvariant` (`bookings/bookingJobNormalizationInvariant.ts`) checks it from `/api/cron/booking-reconciliation-rematch` (every five minutes, the Booking service's own cron, whatever the rematch setting), throttled to once per 55 minutes. It reads `booked_leads` once (the candidates whose raw and normalized text differ or whose key is missing; 1,077 Bookings and 1 candidate on 2026-11-20), stores `{ _id: "normalization_invariant", checked_at, drift_count, booking_ids }` in `booking_job_number_control`, and logs `booking.job_number.normalization_drift` at error level when the count is above 0. A failure is logged and never blocks the rematch. `control.ts status` shows the last cron result and a live count. **Any change to `normalizeJobNo` must ship with a `normalized_job_no` backfill of `booked_leads` that runs before the change deploys**; otherwise every Booking whose key changes stops holding its Lead by Job until the backfill runs.

**Before enforce.** The Owner should read the shadow records by reason (`control.ts status`). Plausible spellings that never appeared in the replay are rejected by this rule and would show up there first: `P5556759-1` and `P5556759 (2nd)` (two numbers), `5,556,759` (three numbers), `5556759A` (letters after the digits) and a Cyrillic `Р` prefix (not ASCII).

## Sheet Sync

| Path | Resource | Operations |
|------|----------|------------|
| Lead-attached create | `booking_chain` | `booked_lead.create` |
| Lead-attached re-book / upsert | `booking_chain` | `booked_lead.upsert` |
| Lead-attached update | `booking_chain` | `booked_lead.update` |
| Lead-attached delete | tombstone `delete_booked_lead` + optional `source_lead` | `delete_booked_lead` |
| Referral create / lifecycle update | `booked_lead` | `referral_booking.create`, `referral_booking.update` |
| Leadless create (Best Relocation import) | `booked_lead` | `leadless_booking.create` |
| Owner Precise Form pending / Owner leadless | `booked_lead` | `owner_booking.create_pending` |
| Granot Confirm attached | `booking_chain` | `booked_lead.create` |
| Granot Confirm Leadless | `booked_lead` | `granot_booking.create_leadless` |
| Granot Update attached | `booking_chain` | `booked_lead.update` |
| Granot Update Leadless | `booked_lead` | `booked_lead.update` |
| Granot Connect Booking to Lead | `booking_chain` | `booked_lead.connect_lead` |
| Lead update with booking | `booking_chain` or `source_lead` | from `refreshAttachedBookingFromLead` |

**Booking Chain** refreshes **Master Booked** (`Booked Deals` tab) and the linked source lead row. Details: [`google-sheets.md`](./google-sheets.md), [`sheet-sync.md`](./sheet-sync.md).

[Booking Chain](../../../../CONTEXT.md) + ordinary [No-Sync Lead](../../../../CONTEXT.md): Booked Deals still writes the Mongo Lead ID. The matched source Lead must not upsert Forms or Calls — same `planSourceLead` / `syncSourceLead` `noSyncAppliesToNormalTabs` predicate. Duplicate / Bad routing on that Lead is unchanged. Do not gate only `persistSheetSyncIntent`.

## Warnings and events

- **Warnings:** zero binder per agent (`buildBookedLeadWarnings`) — non-blocking.
- **Events:** `booking.created`, `booking.upserted`, `booking.duplicate_submission_ignored`.

## Lifecycle revision

`domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical Booking/leadless/Referral create/update/delete adapters persist append-only `EntityChange` rows and stamp `last_change_*` in the executor transaction. One Booking per normalized Job Number remains the unique partial index contract; collisions block unique-index apply. Granot lifecycle Referral commands are implemented but remain disabled by checked-in gates.

## Tests

- `bookingMirror.test.ts` — `claimAvailableLeadForBooking` concurrency + no CPL rewrite; `preserveExistingCpl`
- `indexedJobLookup.replica.test.ts` checks that indexed Job Number aliases return the same rows as the original regex lookup on MongoDB.
- `bookingJobNumber.test.ts` — the Job Number rule per class and rejection reason, equivalence keys and the Booking job filter.
- `granot-lifecycle-admin.routes.test.ts` — Owner Confirm answers 422 `booking.job_number_invalid` with the reason.
- `salesOutreach/pool/poolBookingRead.replica.test.ts` and `ops/pool-production/shared-duty.replica.ts` — Pool admission's Booking hold by `lead_ref` and by every valid Job class, and an index-only plan.
- `bookingJobNumberWriters.test.ts` — inventory of every raw `booked_leads` reader and writer (`BookedLead.collection`, `collection("booked_leads")`, `collection(BookedLead.collection.collectionName)`); no raw write may set `job_no`, including through a prebuilt object or local helper.
- `bookingJobNumber.replica.test.ts` — the model hook in shadow and enforce (transaction-scoped record, abort leaves none, query updates) and 422 from `createBookingFromLead`, `createLeadlessBooking`, `createExistingReferralBooking`, `updateBookedLead`, `submitEmployeeBooking`, `updatePendingEmployeeBooking`; Granot Confirm and Referral enforce cases live in `bookingConfirmation.replica.test.ts` and `referralBooking.replica.test.ts`.
- `bestRelocationImportGuard.test.ts` — source-company fence
- `agentAllocation.service.test.ts` — inactive-agent resolve + receiver attribution
- Domain-command adapters in `domainCommands.test.ts`
- `ownerBookingAttach.test.ts`, `bookedLeadFromSource.service.test.ts`, `leadlessBooking.service.test.ts` — Owner Exact Job Booking Attach, pending `owner_booking` case, no Unmatched Call Lead on the Owner path
- `connectLead.test.ts` — connectable booking / eligible Lead fences, `owner_booking` / `employee_booking` rejected, sheet intent `booking_chain` / `booked_lead.connect_lead`
- `connectLeadCandidates.test.ts` — empty `q` is an empty page; non-connectable booking is `IDENTITY_CONFLICT`
- `connectBookingToLead.replica.test.ts` — happy-path EntityChange + sheet intent (skipped unless the Booking-command flag is on)
- `employeeBookings/leadChangeEmission.replica.test.ts` — compatibility delete and source-resolver Lead changes (opt-in `LP03_REPLICA_TESTS=true`)

## Related services

- [`cancelled-lead.md`](./cancelled-lead.md) — **Cancellation** (public referral blocked; public leadless only via Best Relocation import). Confirm Granot Cancellation on Granot official Leadless succeeds without a Lead mirror ([`release-reconciliation.md`](../granot-lifecycle/release-reconciliation.md)).
- [`agent-allocation.md`](./agent-allocation.md) — **Agent Allocation**, **Binder**
- [`employee-bookings.md`](./employee-bookings.md) — public submit + Owner cases
- [`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md) — gated Confirm / Update / Referral / No Action
- [`analytics.md`](./analytics.md) — **Analytics** over bookings

## Do not bypass

- `resolveFromSourceAttach` (Owner Call Lead Exact Job Booking Attach; Form Lead / Best Relocation import still `resolveBookingSourceLead`) / `resolveLeadSourceAssignment` for from-source creates
- `resolveAgentAllocations`, `resolveTotalBinderAmount` for allocation writes
- `mirrorBookingToLead` / `clearBookingFromLead` / `claimAvailableLeadForBooking` for lead state
- `runSheetSyncWrite` + `persistSheetSyncIntent` / tombstone helpers for sheet-backed mutations
