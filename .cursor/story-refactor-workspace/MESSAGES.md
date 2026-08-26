# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-26T0512Z | to: next-run | from: story-enrichment-call-lead-enrichment-2026-08-26T0512Z | kind: next

`enrichment` is **in-progress**. `callLeadEnrichment.service.ts` is recommended. Next module: **`callLeadEnrichmentRows.ts`**. Stay on `enrichment`. Do not open `reconciliation`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + `enrichment-call-lead-enrichment.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `search-call-lead-browse.md` and `enrichment-call-lead-enrichment.md`.
3. Stay on `enrichment`. Next is `callLeadEnrichmentRows.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged.
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## Resolved

## 2026-08-26T0408Z | to: next-run | from: story-search-call-lead-browse-2026-08-26T0408Z | kind: next

Superseded by story-enrichment-call-lead-enrichment-2026-08-26T0512Z. `callLeadEnrichment.service.ts` is recommended. `enrichment` is in-progress. Next is `callLeadEnrichmentRows.ts`.

## 2026-08-26T0309Z | to: next-run | from: story-search-call-lead-search-2026-08-26T0309Z | kind: next

Superseded by story-search-call-lead-browse-2026-08-26T0408Z. `callLeadBrowse.service.ts` is recommended. `search` is visited. Next is `enrichment`.

## 2026-08-26T0208Z | to: next-run | from: story-search-form-lead-browse-2026-08-26T0208Z | kind: next

Superseded by story-search-call-lead-search-2026-08-26T0309Z. `callLeadSearch.service.ts` is recommended. Next is `callLeadBrowse.service.ts`.

## 2026-08-26T0108Z | to: next-run | from: story-search-form-lead-search-2026-08-26T0108Z | kind: next

Superseded by story-search-form-lead-browse-2026-08-26T0208Z. `formLeadBrowse.service.ts` is recommended. Next is `callLeadSearch.service.ts`.

## 2026-08-26T0010Z | to: next-run | from: story-catalog-catalog-2026-08-26T0010Z | kind: next

Superseded by story-search-form-lead-search-2026-08-26T0108Z. `formLeadSearch.service.ts` is recommended. `search` is in-progress. Next is `formLeadBrowse.service.ts`.

## 2026-08-25T2308Z | to: next-run | from: story-cpl-cpl-rate-2026-08-25T2308Z | kind: next

Superseded by story-catalog-catalog-2026-08-26T0010Z. `catalog.service.ts` is recommended. `catalog` is visited. Next is `search`.

## 2026-08-25T2209Z | to: next-run | from: story-lead-source-companies-lead-source-company-2026-08-25T2209Z | kind: next

Superseded by story-cpl-cpl-rate-2026-08-25T2308Z. `cplRate.service.ts` is recommended. `cpl` is visited. Next is `catalog`.

## 2026-08-25T2110Z | to: next-run | from: story-agents-receiver-agent-crm-username-2026-08-25T2110Z | kind: next

Superseded by story-lead-source-companies-lead-source-company-2026-08-25T2209Z. `leadSourceCompany.service.ts` is recommended. `leadSourceCompanies` is visited. Next is `cpl`.

## 2026-08-25T2010Z | to: next-run | from: story-agents-agent-allocation-2026-08-25T2010Z | kind: next

Superseded by story-agents-receiver-agent-crm-username-2026-08-25T2110Z. `receiverAgentCrmUsername.ts` is recommended. `agents` is visited.

## 2026-08-25T1908Z | to: next-run | from: story-customers-customer-from-lead-2026-08-25T1908Z | kind: next

Superseded by story-agents-agent-allocation-2026-08-25T2010Z. `agentAllocation.service.ts` is recommended. `agents` is in-progress.

## 2026-08-25T1809Z | to: next-run | from: story-customers-customer-2026-08-25T1809Z | kind: next

Superseded by story-customers-customer-from-lead-2026-08-25T1908Z. `customerFromLead.service.ts` is recommended. `customers` is visited.

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
