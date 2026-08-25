# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-25T0510Z | to: next-run | from: story-leads-source-lead-lookup-2026-08-25T0510Z | kind: next

Stay in **`leads`**. Next module: **`callLeadSourceMatch.ts`**.

1. Take stock first. Disk now has `form-lead.md` + `leads-call-lead.md` + `leads-duplicate-lead.md` + `leads-ingestion-provenance.md` + `leads-source-company.md` + `leads-cpl-resolution.md` + `leads-lead-location.md` + `leads-lead-name.md` + `leads-lead-phone-matching.md` + `leads-source-lead-lookup.md`.
2. Do not rewrite `form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, or `leads-source-lead-lookup.md`.
3. Stay in `leads` until every module on that checklist is recommended or skipped. Then `bookings`.
4. Wave B is locked. No `src/` edits. Branch `docs/story-refactor`. PR #12 is merged — open a new PR for this pass.
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## Resolved

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
