---
type: Service
title: Employee Bookings
description: Public employee booking submit with auto-match, plus Owner booking-lead reconciliation cases.
tags: [booking, employee-booking]
status: draft
stale_after: 2026-11-21
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
  at: 2026-09-04T20:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/employeeBookings/`  
**Domain terms used:** [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Employee Bookings

**System of Record:** MongoDB `booked_leads` plus `booking_lead_reconciliation_cases`. This path is **not** the Granot Booking Reconciliation Case ([`booking-reconciliation.md`](../granot-lifecycle/booking-reconciliation.md)).

**Role:** Public employee submit creates a Booking. A unique source-compatible auto-match attaches the Lead in the same transaction; otherwise the Booking is leadless and an Owner case is opened. Canonical `POST /api/v1/leadless-bookings` remains a separate admin path ([`bookings.md`](./bookings.md)).

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

Preferred model follows the submitted granularity channel (`form` → Form Lead, `call` → Call Lead). Enabled rules default to all five, or `EMPLOYEE_BOOKING_AUTO_MATCH_RULES` (`none` disables auto-link).

| Before any rule | Outcome |
|-----------------|---------|
| Identity conflict across candidates | `pending` / `identity_conflict` |
| Candidate query overflow | `pending` / `multiple_matches` — never auto-links |
| Strongest blocked reason (channel-only, source, duplicate, booked, cancelled) | that pending reason |

Positive rules, first enabled winner:

| Rule | Links when |
|------|------------|
| `form_lid_exact` | Form channel + unique LID-eligible Form Lead, source-compatible |
| `call_job_no_exact` | Call channel + unique job-number Call Lead |
| `form_contact_triple_exact` | Form channel, no LID candidate, unique phone+email+name at exact granularity |
| `form_email_phone_exact` | Form channel, no LID candidate, unique phone+email at exact granularity, no `name_contradiction` |
| `channel_phone_exact` | Unique preferred-model phone at exact granularity |

Claim-time failures (Lead cancelled / already booked / duplicate / Call `created_on_unmatched`) downgrade a would-be link to pending. Opposite-channel-only hits stay `channel_conflict`.

## Owner case actions

`assertAllowedCaseAction` + `assertLiveBookingState`:

| Case status | Allowed |
|-------------|---------|
| `pending` | `dismiss`, `attach_existing`, `create_and_attach`, `update_pending` |
| `dismissed` | `attach_existing`, `reassign`, `reopen` |
| `resolved` | `reassign`, `reopen` |

`assertLiveBookingStateForAction` delegates to `assertLiveBookingState`. Cancelled Booking: only `reopen` / `dismiss`. Already attached: cannot attach / create / update / dismiss / reopen — use `reassign` to change the Lead. `reassign` requires an attached Lead. `reopen` is for a leadless dismissed or leadless resolved case.

Overrideable warnings (`duplicate_lead`, `source_conflict`, `channel_conflict`, `source_unassigned`, `same_company_legacy`, `created_on_unmatched`) must be listed **exactly**. `lead_already_booked` and `lead_cancelled` are not overrideable.

Owner candidate search (`searchBookingLeadCandidates` / `searchCandidates`) is any-known-contact: `q`, `name`, `email`, and `phone_number` OR live + ingested + Granot paths from `CALL_LEAD_CONTACT_*_PATHS` (aliases of the Form lists). Dedicated `phone_number` still uses `normalizePhoneNumberForMatch` on `*.normalized_phone_number` and typed-substring regex on `*.phone_number`. Owner search results and auto-match candidate snapshots return sanitized `ingested_contact_snapshot` and `granot_contact_snapshot` for owner display. Automatic submit match (`queryEmployeeBookingCandidates`) stays Job / operational phone and does not search Granot snapshot paths.

## Auto-rematch cron

Default `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED` is on unless the env is the string `false`. Default reason list is only `matching_unavailable`. Delays default `5,30,120` minutes. Cron skips entirely when the flag is off.

## Related services

- [`bookings.md`](./bookings.md) — official Booking create/update and leadless admin path
- [`customer.md`](./customer.md) — contact upsert at submit
- [`sheet-sync.md`](./sheet-sync.md) — outbox after linked/pending create
