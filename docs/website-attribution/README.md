# Main Site attribution and outcome reporting

Implemented on `agent/site-preview-api` for isolated review, November 12, 2026. Production release and content publication are separate Owner decisions. No historical attribution is backfilled.

## Capture contract

`src/contracts/websiteAttribution.ts` owns the v1 dependency-free wire contract. The clients repository distributes a byte-identical copy at `packages/api-client/src/website-attribution.ts`; run its `scripts/check-website-attribution-contract.mjs` against this file before changing either deployment. Add future approved pages/campaigns in the server contract first. Preserve old accepted design versions when introducing a future design so historical snapshots remain readable.

Main Site captures a tab session, at most 24 hours, using sessionStorage without a visitor identifier. It retains first touch and latest non-direct touch through guide, locale and direct returns. Paths, content IDs, locales, campaign values and referring hosts use fixed allowlists. Unknown campaign values collapse to `unknown`; arbitrary query values, UTM term/content, full referrers, contact details and raw browsing events are never stored. DNT/GPC and unavailable storage omit capture. Tracking failure never rejects an otherwise valid quote.

The Form Lead create validator sanitizes before canonical command capture. The ingestion service accepts the snapshot only for `main_site` + `wordpress_form`, stamps server `received_at`, and preserves Source Company, source feed, LID and Tracking Reference behavior. Other origins and sources discard it. The optional structured field is insert-only: ordinary validation/query guards reject nested mutation, unset, rename and replacement/pipeline updates. Raw collection writes and bulk migrations are privileged seams outside those guards and must not be used to rewrite evidence. No update API accepts attribution.

## Owner report

Existing analytics accepts `website-outcomes`, including its CSV export. A focused report is sufficient; no Admin screen or alternate analytics database was added. The isolated API exposes only authenticated `GET /api/v1/site-preview/website-outcomes` in addition to its existing narrow routes, returning the deployed source SHA. General admin and lifecycle writes remain unavailable on that deployment.

The Main Site Form Lead cohort uses half-open `from`/`to` bounds on stored Florida wall-clock Lead timestamps; default is the preceding 30 days, maximum 93 days and 10,000 Leads/Bookings. Outcomes are observed now. Booking and Cancellation dates are Florida calendar dates, so same-day booking is zero calendar days, not negative elapsed hours. `outcomes_observed_at` is a real UTC instant. Unrelated source/agent/merchant filters are rejected. Large cohorts require narrower intervals; they are never silently truncated.

Grouping uses latest non-direct touch, else first touch, with explicit unknown attribution, landing content/locale, capture content/locale and design. The report returns eligible, duplicate and bad Leads, distinct booked Leads, official Bookings, active/cancelled Bookings, recorded deposits/binder/refunds, missing amounts, relationship anomalies, attribution coverage and average calendar days to book. Booking rate uses eligible Leads as its denominator. It is not a visitor conversion rate or causal experiment result.

Join only `BookedLead.lead_model=FormLead` + `lead_ref`. Cancellation status uses `BookedLead.cancelled`; a refund requires that exact Cancellation's `booked_lead` to match. No inference from a phone, job, sibling or historical Lead flags. Call Leads and leadless Bookings remain reportable in their existing reports but are outside this cohort. Money describes recorded amounts, not revenue/profit; missing refund/deposit makes deposit-less-refunds unknown. Thirty days is an explicitly declared maturity review window, not a proven sales-cycle duration. Deleted/replaced records are not reconstructed as historical snapshots.

## Qualification and release

- Focused unit/contract tests: `node --import tsx --import ./ops/test-setup.ts --test src/config/sitePreview.test.ts src/services/analytics/websiteOutcomes.service.test.ts src/services/analytics/analytics.service.test.ts`.
- Disposable loopback replica proof: `node --import tsx ops/site-preview/attribution.replica.ts`, with a manually started Mongo replica named `websiteProof` bound to 127.0.0.1:27219. The script discards environment credentials, disables external fetch/side effects, uses a uniquely named test database, and exercises canonical Lead, idempotent replay, immutable correction, Booking, Cancellation and the real Mongo report. [Evidence](evidence/local-replica.json) is synthetic only.
- `.github/workflows/website-preview-api.yml` exports committed source through the existing `ops/site-preview/prepare.mjs`, deploys only the dedicated isolated project, and updates its stable preview alias. The general server preview workflow explicitly excludes this branch. Runtime isolation asserts the exact test database and disabled CRM/messaging/sheet effects.
- The Main Site milestone packet records the new one-shot deployed capture and exact-reference readback. Never replay that submission to refresh evidence. Production count checks are exact-reference, read-only checks only.

Release order after separate Owner selection: review/merge server contract and report, fresh server production build and bounded read qualification, then fresh selected Main Site production build through the existing publication pipeline. Do not promote an isolated preview artifact. Preserve editorial draft status until explicit content/media approval; no campaign or A/B traffic assignment is enabled here.
