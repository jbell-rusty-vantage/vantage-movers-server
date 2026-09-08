---
type: Completion report
title: EJBA-03 — Precise Booking Form UI
status: complete
closed: 2026-09-08
---

# EJBA-03 completion

Repo: `vantage-admin` on existing `main` (unrelated Daily Operations dirty files left untouched). Pack docs: `vantage-main-server` branch `exact-job-booking-attach`. No commit, push, or deploy.

## What landed

The Precise Booking Form lets the Owner file a Call Lead booking without a phone. Job Number stays required. When the create response includes `reconciliation_case_id`, success links to `/bookings/reconciliation?case=`. Connect stays hidden on Employee and Precise Form pending Bookings. Booking Lead Reconciliation Dismiss stays `dismiss` and is worded as a valid keep-without-a-lead close.

### Precise Booking Form

- Call phone is optional helper text (“Optional. Helps Booking Reconciliation later.”). No `required` attribute. Not in `missingFields`.
- Job Number stays required.
- Owner-visible strings live in `components/forms/booking-form-copy.ts`.
- `requestJson` unwraps `{ ok, data }`, so `reconciliation_case_id` is read from the create function return (`data.reconciliation_case_id`), not the envelope.
- Pending / Leadless success: “Booking saved. Connect a lead from Booking Reconciliation, or keep the booking without a lead.” plus “Open Booking Reconciliation”.
- Linked / Referral (no case id): today’s created sentences from the copy module.
- Call desk “Book this lead” still sends `call_phone_number` and now also `call_job_no` when the Lead has a job.

### Connect

- `canConnectBookingToLead` is false when `booking_origin` is `employee_booking` or `owner_booking`, or when an open-case flag is present.
- Granot official Leadless (no origin) stays connectable.
- Copy stays in `components/bookings/bookings-copy.ts`. Owner UI never prints `owner_booking`, `is_leadless_booking`, or `created_on_unmatched`.

### Reconciliation desk

- Origin type includes `owner_booking`.
- Filter and list label: “Precise Booking Form”. Employee stays “Employee booking”. External sheet stays “External sheet”.
- Dismiss button: “Keep without a lead”. Confirm / helper: “The booking stays filed. You do not have to attach a lead.” Action remains `dismiss`.
- Owner strings live in `components/reconciliation/booking-reconciliation-copy.ts`.

## Commands

`pnpm typecheck` (exit 0).

Targeted tests (the package `pnpm test` glob also runs unrelated Daily Operations files; those two failures are pre-existing dirty work, not this issue):

```text
node --import tsx --test \
  tests/granot-lifecycle-components.test.ts \
  tests/booking-stored-lead.test.ts \
  tests/booking-form.test.ts \
  tests/booking-reconciliation-dashboard.test.ts
```

```text
ℹ tests 52
ℹ pass 52
ℹ fail 0
```

## Browser

Signed in locally from `vantage-admin/.env` (`ADMIN_SEED_*`). Secrets not recorded.

Verified at http://localhost:3000/bookings/new:

- Title and page hint from the copy module.
- Call Lead: job input `required`; phone input `required=false`; helper “Optional. Helps Booking Reconciliation later.”
- Call Lead job-only submit left the client (no missing-fields gate). Live API on 3001 returned “Linked source lead not found” — old create path, no case id.
- Leadless submit succeeded. Success notice: pending copy + “Open Booking Reconciliation”. Href was `/bookings/reconciliation` without `?case=` because the live response had no `reconciliation_case_id`.

Verified at http://localhost:3000/bookings/reconciliation:

- Origin filter includes Precise Booking Form (value `owner_booking`, label only).
- Page hint mentions keeping a Booking without a lead.
- Queue was empty; the Keep-without-a-lead button was not clicked on a live case.

Unrelated Next.js overlay from dirty Daily Operations / layout hydration was present. Not caused by this issue.

## What this issue did not do

- Server match rules (EJBA-01 / EJBA-02).
- Knowledge (EJBA-04).
- A second case action besides `dismiss`.
- Redesign of the whole reconciliation desk.
- Daily Operations files.
- Commit, push, or deploy.

## Drift vs issue current-state

Issue current-state was still accurate at start. After this issue:

- Call phone is no longer a client submit gate.
- Success reads `reconciliation_case_id` from the unwrapped create result.
- Connect hides Employee / Precise Form origins.
- Reconciliation origin filter and list label include Precise Booking Form.
- Dismiss copy is keep-without-a-lead.

## Risks for EJBA-04

- Local API on 3001 may still be old `main`. Restart on `exact-job-booking-attach` before claiming a live pending deep link.
- Admin Precise Form work is uncommitted on `main` beside unrelated Daily Operations dirt. Do not fold Daily Operations into this pack branch.
- Knowledge bodies still describe the five-rule employee table and rematch `matching_unavailable` only (EJBA-01 finding).
- Dismiss button label is now “Keep without a lead”; knowledge should not still say the Owner only “dismisses a failed match.”
