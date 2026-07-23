# Employee Booking Reconciliation Acceptance Record

- Run ID: `EBR-20260723`
- Date/time: 2026-07-23 11:45-12:06 EDT
- TEST_MODE confirmed: yes
- Mongo database reported by `/db`: `testvantagemovers`
- Main-server URLs: Vercel dev on `127.0.0.1:3001/3002`; local legacy-mode server on `127.0.0.1:3004`
- Admin URL: `http://localhost:3000`
- Sheet Sync modes tested: `legacy` and `queued`
- Matching policy: `employee-booking-v1`, all five default positive rules
- Auto-rematch: enabled; `matching_unavailable`; delays `5,30,120`; batch size `25`
- `WRITE_SOURCE_LEAD_SHEETS`: `false`
- Form granularity: Best Relocation Forms (`best_relocation_leads_form_long_distance`)
- Agents: Alice Refactor; Bob Splitwise
- Merchant: `EBR Acceptance Merchant 20260723-1151`

## Scenario results

- Public options route: 13 source granularities, 6 agents, nonce cookie, and the isolated test Merchant loaded.
- Public no-match submission: `booked_pending_lead`; idempotent retry returned `duplicate_submission` with the same Booking ID.
- A fresh submission reusing a normalized Job Number returned `409`.
- Split allocation: `$1,200` produced two `$600` allocation rows.
- Exact Form LID submission: `booked_and_linked`.
- Concurrent exact-LID submissions for one Lead: one `booked_and_linked`, one `booked_pending_lead`, and no `5xx`.
- Owner reconciliation: list/detail contract, create-and-attach, dismiss, reopen, candidate refresh, and stale-revision `409` passed.
- Concurrent same-revision refreshes: one `200`, one stale `409`.
- Unresolved employee cancellation: created without Lead metadata, marked the Booking cancelled, dismissed the pending case with `booking_cancelled` history, and synced Master Booked row 10 plus Cancelled Deals row 4.
- Authorization/security: bare API-secret owner access returned `403`; missing public Origin returned `403`.
- Final BFF retry against the hardened backend returned the same `duplicate_submission`; trusted owner proxy headers returned `200`, while role `admin` returned `403`.
- Persistent throttle: ten invalid requests under one HMAC client key returned `400`; request eleven returned `429`.
- Migration: dry-run collision report completed; TEST_MODE backfill and declared indexes applied. Booking Job Number and employee submission indexes are unique partial indexes.
- Legacy Sheet Sync: Booking `6a623bb93863a7c8ba19435e` synced to test Master Booked, row 11, with `failed=0`.
- Queued Sheet Sync: run `6a623bceefa0b5f6d7d6bcd7` completed `claimed=1`, `synced=1`, `failed=0`. Earlier jobs were retried successfully after the test Forms tab was expanded from 22 to 23 columns.

## Created records

- Pending then reconciled Booking/case: `6a62392a95219a930095664f` / `6a62392b95219a9300956650`
- Created and attached Form Lead: `6a6239b50db5ad2e514aaf9a`
- Split Booking/pending case: `6a62398175c1b6b5ae311999` / `6a62398175c1b6b5ae31199a`
- Auto-match fixture/Booking: `6a6239cbdfb09899e3ffbc38` / `6a6239e516c8573ad2a1657f`
- Legacy-mode Booking: `6a623bb93863a7c8ba19435e`
- Leadless cancellation: `6a623e0e17f34cf78ff08dfa`

## Known limitations

- Google Maps Geocoding API is disabled for the configured test project. ZIP resolution fell back successfully and did not block reconciliation.
- Owner behavior was exercised through the authenticated owner API boundary. Final browser visual sign-off with a real owner session remains manual.
- Full backend tests: 449/449 passed. Admin tests: 61/61 passed; Admin TypeScript and production build passed.
- Full backend TypeScript remains red only in unrelated pre-existing `scripts/dev_ops/bbb/*`, `prove-form-lead-duplicate-scope-test-db.ts`, `strip-markdown-to-txt.ts`, and `unpublish-redacted-bbb-testimonials.ts`; no feature-area type errors were reported.
