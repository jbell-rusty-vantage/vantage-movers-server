# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-25T1809Z | to: next-run | from: story-customers-customer-2026-08-25T1809Z | kind: next

Stay in **`customers`**. Next module: **`customerFromLead.service.ts`**.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + `customers-customer.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including the seven `bookings-*.md` files, the three `cancellations-*.md` files, and `customers-customer.md`.
3. Stay in `customers` until every module on that checklist is recommended or skipped. Then `agents`.
4. Wave B is locked. No `src/` edits. Branch `docs/story-refactor`. PR #26 is this pass. If that PR is already merged, open a new PR.
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## Resolved

## 2026-08-25T1713Z | to: next-run | from: story-cancellations-cancellation-mirror-2026-08-25T1713Z | kind: next

Superseded by story-customers-customer-2026-08-25T1809Z. `customer.service.ts` is recommended. `customers` is in-progress.

## 2026-08-25T1609Z | to: next-run | from: story-cancellations-cancellation-resolver-2026-08-25T1609Z | kind: next

Superseded by story-cancellations-cancellation-mirror-2026-08-25T1713Z. `cancellationMirror.service.ts` is recommended. `cancellations` is visited.

## 2026-08-25T1512Z | to: next-run | from: story-cancellations-cancelled-lead-2026-08-25T1512Z | kind: next

Superseded by story-cancellations-cancellation-resolver-2026-08-25T1609Z. `cancellationResolver.ts` is recommended. Next is `cancellationMirror.service.ts`.

## 2026-08-25T1409Z | to: next-run | from: story-bookings-booking-identity-2026-08-25T1409Z | kind: next

Superseded by story-cancellations-cancelled-lead-2026-08-25T1512Z. `cancelledLead.service.ts` is recommended. `cancellations` is in-progress.

## 2026-08-25T1310Z | to: next-run | from: story-bookings-booking-source-resolver-2026-08-25T1310Z | kind: next

Superseded by story-bookings-booking-identity-2026-08-25T1409Z. `bookingIdentity.ts` is recommended. `bookings` is visited.

## 2026-08-25T1230Z | to: next-run | from: story-bookings-booking-mirror-2026-08-25T1230Z | kind: next

Superseded by story-bookings-booking-source-resolver-2026-08-25T1310Z. `bookingSourceResolver.ts` is recommended.

## 2026-08-25T1113Z | to: next-run | from: story-bookings-leadless-booking-2026-08-25T1113Z | kind: next

Superseded by story-bookings-booking-mirror-2026-08-25T1230Z. `bookingMirror.service.ts` is recommended.

## 2026-08-25T1014Z | to: next-run | from: story-bookings-referral-booking-2026-08-25T1014Z | kind: next

Superseded by story-bookings-leadless-booking-2026-08-25T1113Z. `leadlessBooking.service.ts` is recommended.

## 2026-08-25T0911Z | to: next-run | from: story-bookings-booked-lead-from-source-2026-08-25T0911Z | kind: next

Superseded by story-bookings-referral-booking-2026-08-25T1014Z. `referralBooking.service.ts` is recommended.

## 2026-08-25T0810Z | to: next-run | from: story-bookings-booked-lead-2026-08-25T0810Z | kind: next

Superseded by story-bookings-booked-lead-from-source-2026-08-25T0911Z. `bookedLeadFromSource.service.ts` is recommended.

## 2026-08-25T0710Z | to: next-run | from: story-leads-lead-source-compatibility-2026-08-25T0710Z | kind: next

Superseded by story-bookings-booked-lead-2026-08-25T0810Z. `bookings` is open; `bookedLead.service.ts` is recommended.

## 2026-08-25T0610Z | to: next-run | from: story-leads-call-lead-source-match-2026-08-25T0610Z | kind: next

Superseded by story-leads-lead-source-compatibility-2026-08-25T0710Z. `leadSourceCompatibility.ts` is recommended. `leads` is visited.

## 2026-08-25T0510Z | to: next-run | from: story-leads-source-lead-lookup-2026-08-25T0510Z | kind: next

Superseded by story-leads-call-lead-source-match-2026-08-25T0610Z. `callLeadSourceMatch.ts` is recommended.

## 2026-08-25T0411Z | to: next-run | from: story-leads-lead-phone-matching-2026-08-25T0411Z | kind: next

Superseded by story-leads-source-lead-lookup-2026-08-25T0510Z. `sourceLeadLookup.service.ts` is recommended.

## 2026-08-25T0309Z | to: next-run | from: story-leads-lead-name-2026-08-25T0309Z | kind: next

Superseded by story-leads-lead-phone-matching-2026-08-25T0411Z. `leadPhoneMatching.ts` is recommended.

## 2026-08-25T0209Z | to: next-run | from: story-leads-lead-location-2026-08-25T0209Z | kind: next

Superseded by story-leads-lead-name-2026-08-25T0309Z. `leadName.service.ts` is recommended.

## 2026-08-25T0108Z | to: next-run | from: story-leads-cpl-resolution-2026-08-25T0108Z | kind: next

Superseded by story-leads-lead-location-2026-08-25T0209Z. `leadLocation.service.ts` is recommended.

## 2026-08-25T0013Z | to: next-run | from: story-leads-source-company-2026-08-25T0013Z | kind: next

Superseded by story-leads-cpl-resolution-2026-08-25T0108Z. `leadCplResolution.ts` is recommended.

## 2026-08-24T2310Z | to: next-run | from: story-leads-ingestion-provenance-2026-08-24T2310Z | kind: next

Superseded by story-leads-source-company-2026-08-25T0013Z. `leadSourceCompany.ts` is recommended.

## 2026-08-24T2212Z | to: next-run | from: story-leads-duplicate-lead-2026-08-24T2212Z | kind: next

Superseded by story-leads-ingestion-provenance-2026-08-24T2310Z. `leadIngestionProvenance.ts` is recommended.

## 2026-08-24T2125Z | to: next-run | from: story-leads-call-lead-2026-08-24T2125Z | kind: next

Superseded by story-leads-duplicate-lead-2026-08-24T2212Z. `duplicateLead.service.ts` is recommended.

## 2026-08-24T2117Z | to: next-run | from: seed | kind: next

Superseded by story-leads-call-lead-2026-08-24T2125Z. `callLead.service.ts` is recommended.
