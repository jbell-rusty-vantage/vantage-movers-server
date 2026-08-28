---
type: Completion report
title: BILA-02 — Confirm without a required Lead; high-confidence auto-attach
status: complete
closed: 2026-08-28
---

# BILA-02 completion

Repos: `vantage-main-server`, `vantage-admin`. Both desks were on `main`. No extra feature branch.

## Attachment-resolution tests

`confirmAttachment.test.ts` (all pass in the full server suite):

- Owner `selected_lead` attaches even when the suggestion is medium
- no `selected_lead` and a unique high suggestion auto-attaches
- no `selected_lead` and a medium-only suggestion stays Leadless
- no `selected_lead` and no suggestion stays Leadless
- `source_scoped_contact` never auto-attaches even if confidence were high
- Referral is not a Granot official Leadless Booking
- employee `booking_origin=employee_booking` is not a Granot official Leadless Booking

Zod (`[AC-22] confirm Booking input is strict and validates exact official cents`): omitted `selected_lead` parses as `undefined`; unknown keys still reject.

Admin `pickBestCandidate`: high only; a medium suggestion or in-scope-only list returns no pre-select. `vantage-admin` `pnpm test` **341 pass**.

## Sheet intent evidence

`Sheet intents distinguish attached Confirm from Leadless Confirm and Update` (pass):

| Outcome | resource | operation |
| --- | --- | --- |
| Confirm attached | `booking_chain` | `booked_lead.create` |
| Confirm Leadless | `booked_lead` | `granot_booking.create_leadless` |
| Update attached | `booking_chain` | `booked_lead.update` |
| Update Granot Leadless | `booked_lead` | `booked_lead.update` |
| Update Referral | `booked_lead` | `referral_booking.update` |

Replica Confirm/Update cases (opt-in `GRANOT_LIFECYCLE_REPLICA_TESTS=true`) were **skipped** in this run, same pattern as BILA-01. Names:

- Confirm omit `selected_lead` with unique high suggestion attaches and queues `booking_chain`
- Confirm omit `selected_lead` with medium-only suggestion creates a Leadless Booking
- Confirm Owner-selected medium attaches that Lead
- Confirm lost claim fails closed and does not fall through to Leadless
- Update Existing Booking on a Granot Leadless Booking writes official fields and Master Booked only

## Processor / update / cancel evidence

- `bookingReconciliation.test.ts`: actual Booked on a Granot official Leadless Booking opens `review_existing_booking` (does not fail closed; does not require an employee case). Employee `booking_origin=employee_booking` fixtures still take the existing pending path.
- Update: `isGranotOfficialLeadlessBooking` allows official-field replacement; sheet is Master Booked only.
- Cancel: `Confirm Granot Cancellation succeeds on a Granot official Leadless Booking without a Lead mirror` (replica, skipped unless the replica flag is on). `assertLeadIdentity` already returns when there is no Lead.

Lost claim stays `IDENTITY_CONFLICT` / `DOMAIN_REVISION_CONFLICT`. Confirm does not fall through to Leadless.

## Browser notes (steps 5–6)

This desk’s Owner Admin is **http://localhost:3000** (API on **http://localhost:3001**). Commands were enabled. No live Confirm was submitted.

5. Opened a waiting `create_missing_booking` intake whose case suggestion was medium (`source_scoped_contact`). No customer was pre-selected. Panel: **No stored lead** and “No strong match. You can search, or save the booking now and connect a lead later from Bookings.” Official fields were blank. After typing synthetic official details (date, $1.00 deposit/binder, House, Paper Check), **Review Booking** opened. Review stated **No lead — Master Booked only**. Left via **Back to edit**.
6. Opened a waiting `create_missing_booking` intake whose case suggestion was unique high (`granot_record_link`). That customer was pre-filled. Form copy: “This customer will be attached when you file the booking.” **Review Booking** was available. Did not submit.

No live names, phones, or emails are repeated here.

## What this issue did not do

- BILA-03: Connect Booking to Lead command and `/bookings` Connect UI
- Live Confirm submit (would mint an official Booking on a waiting job)
- Replica Confirm/Update/Cancel runs (`GRANOT_LIFECYCLE_REPLICA_TESTS` off)
- `identity.ts`, scored search, even Binder, Referral official fields
- Bookings-tab copy, Daily, ingestion redirect

## §4 drift corrected

Issue §4 matched the repo at pickup. This issue is the change: optional `selected_lead`; Confirm persist attached vs Leadless; Update allows Granot official Leadless; processor Booked + Granot Leadless opens `review_existing_booking`. Employee Booking-without-Lead still fail-closed when `booking_origin=employee_booking` and no employee case. Referral stays `is_leadless_booking: false`.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| Focused server tests (Zod + attachment + bookingReconciliation) | 39 pass |
| `vantage-main-server` `pnpm test` | 1704 pass, 0 fail, 93 skipped (pre-existing suite skips plus new replica names) |
| `vantage-admin` `pnpm test` | 341 pass |
| `vantage-admin` `pnpm typecheck` | pass |

Full server suite footer:

```text
ℹ tests 1797
ℹ suites 10
ℹ pass 1704
ℹ fail 0
ℹ cancelled 0
ℹ skipped 93
ℹ todo 0
ℹ duration_ms 303420.6969
```

Knowledge docs restamped by docs-keeper after ship. BILA-03 is the next startable issue.
