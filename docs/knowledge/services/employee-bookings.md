---
type: Service
title: Employee Bookings
description: Public employee booking submit with auto-match, plus Owner booking-lead reconciliation cases.
tags: [booking, employee-booking]
status: draft
stale_after: 2026-12-08
resource: src/services/employeeBookings/submitEmployeeBooking.service.ts
applies_to:
  - src/services/employeeBookings/submitEmployeeBooking.service.ts
  - src/services/employeeBookings/leadMatchEvaluator.ts
  - src/services/employeeBookings/bookingLeadReconciliation.service.ts
  - src/services/employeeBookings/reconciliationPolicy.ts
  - src/config/domain/employeeBookingMatching.ts
  - src/config/domain/bookingReconciliation.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/employeeBookings/submitEmployeeBooking.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:docs-keeper
  at: 2026-09-08T20:30:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/employeeBookings/`  
**Domain terms used:** [Employee Booking Submission](../../../../CONTEXT.md), [Exact Job Booking Attach](../../../../CONTEXT.md), [Booking Lead Reconciliation](../../../../CONTEXT.md), [Booking Lead Reconciliation Case](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md)

# Employee Bookings

**System of Record:** MongoDB `booked_leads` plus `booking_lead_reconciliation_cases`. This path is **not** the Granot Booking Reconciliation Case ([`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md)).

**Role:** Public [Employee Booking Submission](../../../../CONTEXT.md) creates a Booking. [Exact Job Booking Attach](../../../../CONTEXT.md) links a unique Job Number Lead in the same transaction; otherwise the Booking is a [Leadless Booking](../../../../CONTEXT.md) and a [Booking Lead Reconciliation Case](../../../../CONTEXT.md) is opened. Canonical `POST /api/v1/leadless-bookings` remains a separate admin path ([`bookings.md`](./bookings.md)).

## HTTP / cron

| Surface | Path | Auth / notes |
|---------|------|----------------|
| Options | `GET /api/v1/employee-booking-options` | Secret only (`auth.kind === "secret"`). Active companies + form/call granularities + active catalog agents/merchants |
| Submit | `POST /api/v1/employee-booking-submissions` | Secret + `x-public-client-key-hash` (64 hex). Zod then `submitEmployeeBooking` |
| Owner cases | `GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*` | Mutations need `deriveTrustedOwnerActor` (Owner user, or secret + owner admin headers). Bare secret is 403 |
| Cron | `ALL /api/cron/booking-reconciliation-rematch` | `CRON_SECRET`. No-op unless auto-rematch is enabled |

## Happy path — submit

1. Throttle global + per-client buckets (`PublicSubmissionThrottleBucket`). Defaults: 300s window, 10/client, 250/global. Over limit → 429.
2. Prepare/normalize job, phone, LID, source assignment, agent allocations.
3. Existing `booking_origin=employee_booking` + same `submission_id` → 200 `duplicate_submission` (no second Booking).
4. Another Booking with the same `normalized_job_no` → 409.
5. Inside `runSheetSyncWrite` (`forceTransaction: true`): re-check submission/job uniqueness; query candidates; `evaluateEmployeeBookingMatch`.
6. **Linked:** claim the Lead (`claimAvailableLeadForBooking`), save Booking with `lead_ref`, Sheet job `booking_chain` / `employee_booking.create_linked` → 201 `booked_and_linked`.
7. **Pending:** save leadless Booking + `BookingLeadReconciliationCase` (`status=pending`), Sheet job `booked_lead` / `employee_booking.create_pending` → 201 `booked_pending_lead`. Matcher exceptions that are not 409 become `matching_unavailable` (still creates the Booking).

Confirmation code is the last 8 hex chars of the Booking id.

## Auto-match (current code)

[Exact Job Booking Attach](../../../../CONTEXT.md). Preferred model follows the submitted granularity channel (`form` → Form Lead, `call` → Call Lead). Default policy version is `exact-job-v1`. Enabled rules default to `call_job_no_exact,form_job_no_exact`, or `EMPLOYEE_BOOKING_AUTO_MATCH_RULES`. The parser rejects `form_lid_exact`, `form_contact_triple_exact`, `form_email_phone_exact`, and `channel_phone_exact`. `none` disables automatic attach.

| Before any rule | Outcome |
|-----------------|---------|
| Job Number and phone on different Leads, or LID vs Job Number on different Leads | `pending` / `identity_conflict` |
| Two Call Leads (or two Form Leads) with the same Job Number; candidate query overflow | `pending` / `multiple_matches` — never auto-links |
| Strongest blocked reason (channel-only, source, duplicate, booked, cancelled) | that pending reason |

Positive rules, first enabled winner:

| Rule | Links when |
|------|------------|
| `call_job_no_exact` | Call channel + unique job-number Call Lead, source-compatible |
| `form_job_no_exact` | Form channel + unique job-number Form Lead, source-compatible |

Phone, email, name, and LID never auto-attach. Claim-time failures (Lead cancelled / already booked / duplicate / Call `created_on_unmatched`) downgrade a would-be link to pending. Opposite-channel-only Job Number stays `channel_conflict`. Rematch and Owner pending snapshots use `snapshotEmployeeBookingAutoMatchPolicy()`.

## Owner case actions

`assertAllowedCaseAction` + `assertLiveBookingState`:

| Case status | Allowed |
|-------------|---------|
| `pending` | `dismiss`, `attach_existing`, `create_and_attach`, `update_pending` |
| `dismissed` | `attach_existing`, `reassign`, `reopen` |
| `resolved` | `reassign`, `reopen` |

`assertLiveBookingStateForAction` delegates to `assertLiveBookingState`. Cancelled Booking: only `reopen` / `dismiss`. Already attached: cannot attach / create / update / dismiss / reopen — use `reassign` to change the Lead. `reassign` requires an attached Lead. `reopen` is for a leadless dismissed or leadless resolved case. `dismiss` stays `dismiss`. An `owner_booking` pending case can be dismissed with no Lead; the Booking stays a [Leadless Booking](../../../../CONTEXT.md).

Overrideable warnings (`duplicate_lead`, `source_conflict`, `channel_conflict`, `source_unassigned`, `same_company_legacy`, `created_on_unmatched`) must be listed **exactly**. `lead_already_booked` and `lead_cancelled` are not overrideable.

Owner candidate search (`searchBookingLeadCandidates` / `searchCandidates`) is any-known-contact: `q`, `name`, `email`, and `phone_number` OR live + ingested + Granot paths from `CALL_LEAD_CONTACT_*_PATHS` (aliases of the Form lists). Dedicated `phone_number` still uses `normalizePhoneNumberForMatch` on `*.normalized_phone_number` and typed-substring regex on `*.phone_number`. Owner search results and auto-match candidate snapshots return sanitized `ingested_contact_snapshot` and `granot_contact_snapshot` for owner display. Automatic submit match (`queryEmployeeBookingCandidates`) stays Job / operational phone and does not search Granot snapshot paths.

## Auto-rematch cron

Default `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED` is on unless the env is the string `false`. Default reason list is `matching_unavailable,no_match`. Delays default `5,30,120` minutes. Cron skips entirely when the flag is off.

## Related services

- [`bookings.md`](./bookings.md) — official Booking create/update and leadless admin path
- [`customer.md`](./customer.md) — contact upsert at submit
- [`sheet-sync.md`](./sheet-sync.md) — outbox after linked/pending create
