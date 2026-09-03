# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-09-03T1921Z | to: next-run | from: story-ringcentral-call-log-sync-2026-09-03T1921Z | kind: next

`ringcentral` is **in-progress**. `call-log-sync.service.ts` is recommended. Next module: **`call-log-sync-state.store.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md` + `ringcentral-duplicate-guard.md` + `ringcentral-call-lead-convergence.md` + `ringcentral-shadow-call-leads-store.md` + `ringcentral-processed-calls-store.md` + `ringcentral-call-log-sync.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, `ringcentral-call-lead-convergence.md`, `ringcentral-shadow-call-leads-store.md`, `ringcentral-processed-calls-store.md`, and `ringcentral-call-log-sync.md`.
3. Stay on `ringcentral`. Next is `call-log-sync-state.store.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/138 after #137 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-09-03T1830Z | to: next-run | from: story-ringcentral-processed-calls-store-2026-09-03T1830Z | kind: next

Superseded by story-ringcentral-call-log-sync-2026-09-03T1921Z. `call-log-sync.service.ts` is recommended. `ringcentral` is in-progress. Next is `call-log-sync-state.store.ts`.

`ringcentral` is **in-progress**. `processed-calls-store.ts` is recommended. Next module: **`call-log-sync.service.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md` + `ringcentral-duplicate-guard.md` + `ringcentral-call-lead-convergence.md` + `ringcentral-shadow-call-leads-store.md` + `ringcentral-processed-calls-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, `ringcentral-call-lead-convergence.md`, `ringcentral-shadow-call-leads-store.md`, and `ringcentral-processed-calls-store.md`.
3. Stay on `ringcentral`. Next is `call-log-sync.service.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/137 after #135 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0824Z | to: next-run | from: story-ringcentral-shadow-call-leads-store-2026-08-30T0824Z | kind: next

Superseded by story-ringcentral-processed-calls-store-2026-09-03T1830Z. `processed-calls-store.ts` is recommended. `ringcentral` is in-progress. Next is `call-log-sync.service.ts`.

`ringcentral` is **in-progress**. `shadow-call-leads-store.ts` is recommended. Next module: **`processed-calls-store.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md` + `ringcentral-duplicate-guard.md` + `ringcentral-call-lead-convergence.md` + `ringcentral-shadow-call-leads-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, `ringcentral-call-lead-convergence.md`, and `ringcentral-shadow-call-leads-store.md`.
3. Stay on `ringcentral`. Next is `processed-calls-store.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass updates https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/135).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0728Z | to: next-run | from: story-ringcentral-call-lead-convergence-2026-08-30T0728Z | kind: next

Superseded by story-ringcentral-shadow-call-leads-store-2026-08-30T0824Z. `shadow-call-leads-store.ts` is recommended. `ringcentral` is in-progress. Next is `processed-calls-store.ts`.

`ringcentral` is **in-progress**. `callLeadConvergence.service.ts` is recommended. Next module: **`shadow-call-leads-store.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md` + `ringcentral-duplicate-guard.md` + `ringcentral-call-lead-convergence.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, and `ringcentral-call-lead-convergence.md`.
3. Stay on `ringcentral`. Next is `shadow-call-leads-store.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/135 after #134 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0613Z | to: next-run | from: story-ringcentral-duplicate-guard-2026-08-30T0613Z | kind: next

Superseded by story-ringcentral-call-lead-convergence-2026-08-30T0728Z. `callLeadConvergence.service.ts` is recommended. `ringcentral` is in-progress. Next is `shadow-call-leads-store.ts`.

`ringcentral` is **in-progress**. `ringcentral-duplicate-guard.ts` is recommended. Next module: **`callLeadConvergence.service.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md` + `ringcentral-duplicate-guard.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, and `ringcentral-duplicate-guard.md`.
3. Stay on `ringcentral`. Next is `callLeadConvergence.service.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/134 after #133 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0515Z | to: next-run | from: story-ringcentral-call-lead-ingest-2026-08-30T0515Z | kind: next

Superseded by story-ringcentral-duplicate-guard-2026-08-30T0613Z. `ringcentral-duplicate-guard.ts` is recommended. `ringcentral` is in-progress. Next is `callLeadConvergence.service.ts`.


`ringcentral` is **in-progress**. `ringcentral-call-lead-ingest.service.ts` is recommended. Next module: **`ringcentral-duplicate-guard.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md` + `ringcentral-call-lead-ingest.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, and `ringcentral-call-lead-ingest.md`.
3. Stay on `ringcentral`. Next is `ringcentral-duplicate-guard.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/133 after #132 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0419Z | to: next-run | from: story-ringcentral-webhook-subscriptions-2026-08-30T0419Z | kind: next

Superseded by story-ringcentral-call-lead-ingest-2026-08-30T0515Z. `ringcentral-call-lead-ingest.service.ts` is recommended. `ringcentral` is in-progress. Next is `ringcentral-duplicate-guard.ts`.

`ringcentral` is **in-progress**. `webhook-subscriptions.ts` is recommended. Next module: **`ringcentral-call-lead-ingest.service.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md` + `ringcentral-webhook-subscriptions.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, and `ringcentral-webhook-subscriptions.md`.
3. Stay on `ringcentral`. Next is `ringcentral-call-lead-ingest.service.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/132 after #131 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0317Z | to: next-run | from: story-ringcentral-webhook-capture-2026-08-30T0317Z | kind: next

Superseded by story-ringcentral-webhook-subscriptions-2026-08-30T0419Z. `webhook-subscriptions.ts` is recommended. `ringcentral` is in-progress. Next is `ringcentral-call-lead-ingest.service.ts`.

`ringcentral` is **in-progress**. `webhook-capture.ts` is recommended. Next module: **`webhook-subscriptions.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md` + `ringcentral-webhook-capture.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, and `ringcentral-webhook-capture.md`.
3. Stay on `ringcentral`. Next is `webhook-subscriptions.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/131 after #130 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0220Z | to: next-run | from: story-ringcentral-call-session-store-2026-08-30T0220Z | kind: next

Superseded by story-ringcentral-webhook-capture-2026-08-30T0317Z. `webhook-capture.ts` is recommended. `ringcentral` is in-progress. Next is `webhook-subscriptions.ts`.

`ringcentral` is **in-progress**. `call-session-store.ts` is recommended. Next module: **`webhook-capture.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md` + `ringcentral-call-session-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, and `ringcentral-call-session-store.md`.
3. Stay on `ringcentral`. Next is `webhook-capture.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/130 after #129 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0121Z | to: next-run | from: story-ringcentral-call-session-aggregator-2026-08-30T0121Z | kind: next

Superseded by story-ringcentral-call-session-store-2026-08-30T0220Z. `call-session-store.ts` is recommended. `ringcentral` is in-progress. Next is `webhook-capture.ts`.

`ringcentral` is **in-progress**. `call-session-aggregator.ts` is recommended. Next module: **`call-session-store.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md` + `ringcentral-call-session-aggregator.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, and `ringcentral-call-session-aggregator.md`.
3. Stay on `ringcentral`. Next is `call-session-store.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/129 after #128 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-30T0027Z | to: next-run | from: story-ringcentral-call-candidate-store-2026-08-30T0027Z | kind: next

Superseded by story-ringcentral-call-session-aggregator-2026-08-30T0121Z. `call-session-aggregator.ts` is recommended. `ringcentral` is in-progress. Next is `call-session-store.ts`.

`ringcentral` is **in-progress**. `call-candidate-store.ts` is recommended. Next module: **`call-session-aggregator.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md` + `ringcentral-call-candidate-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `ringcentral-call-candidate-evaluator.md` and `ringcentral-call-candidate-store.md`.
3. Stay on `ringcentral`. Next is `call-session-aggregator.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/128 after #127 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T2348Z | to: next-run | from: story-ringcentral-call-candidate-evaluator-2026-08-29T2348Z | kind: next

Superseded by story-ringcentral-call-candidate-store-2026-08-30T0027Z. `call-candidate-store.ts` is recommended. `ringcentral` is in-progress. Next is `call-session-aggregator.ts`.

`ringcentral` is **in-progress**. `call-candidate-evaluator.ts` is recommended. Next module: **`call-candidate-store.ts`**. Stay on `ringcentral`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md` + `ringcentral-call-candidate-evaluator.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `operational-workbooks-registry.md` and `ringcentral-call-candidate-evaluator.md`.
3. Stay on `ringcentral`. Next is `call-candidate-store.ts`. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/127 after #126 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T2238Z | to: next-run | from: story-operational-workbooks-registry-2026-08-29T2238Z | kind: next

Superseded by story-ringcentral-call-candidate-evaluator-2026-08-29T2348Z. `call-candidate-evaluator.ts` is recommended. `ringcentral` is in-progress. Next is `call-candidate-store.ts`.

`operationalWorkbooks` is **visited**. `registry.ts` is recommended. `registrations.ts` skipped (env catalog). `index.ts` skipped (default registry). Next service: **`ringcentral`** (unvisited — enumerate first). Do not open Wave B.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md` + `operational-workbooks-registry.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-maps-geocoding.md` and `operational-workbooks-registry.md`.
3. Open `ringcentral`. Enumerate every runtime `.ts` file onto the checklist, skip barrels/type-only/tests, then recommend the first story-worthy module. Do not write a whole-folder recommendation. Wave B is locked. `ringcentral` is large — one module this pass.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/126 after #125 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T2120Z | to: next-run | from: story-google-maps-geocoding-2026-08-29T2120Z | kind: next

Superseded by story-operational-workbooks-registry-2026-08-29T2238Z. `registry.ts` is recommended. `operationalWorkbooks` is visited. Next is `ringcentral` (unvisited — enumerate first).

`googleMaps` is **visited**. `geocoding.ts` is recommended. Next service: **`operationalWorkbooks`** (unvisited — enumerate first). Do not open Wave B.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md` + `google-maps-geocoding.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-managed-tab.md` and `google-maps-geocoding.md`.
3. Open `operationalWorkbooks`. Enumerate every runtime `.ts` file onto the checklist, skip barrels/type-only/tests, then recommend the first story-worthy module. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/125 after #124 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T2024Z | to: next-run | from: story-google-drive-oauth-managed-tab-2026-08-29T2024Z | kind: next

Superseded by story-google-maps-geocoding-2026-08-29T2120Z. `geocoding.ts` is recommended. `googleMaps` is visited. Next is `operationalWorkbooks` (unvisited — enumerate first).

`googleDriveOAuth` is **visited**. `managedTab.service.ts` is recommended. Next service: **`googleMaps`** (unvisited — enumerate first). Do not open Wave B.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md` + `google-drive-oauth-managed-tab.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, `google-drive-oauth-picker-nonce-store.md`, `google-drive-oauth-picker-selection-store.md`, `google-drive-oauth-drive-metadata.md`, and `google-drive-oauth-managed-tab.md`.
3. Open `googleMaps`. Enumerate every runtime `.ts` file onto the checklist, skip barrels/type-only/tests, then recommend the first story-worthy module. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/124 after #123 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1925Z | to: next-run | from: story-google-drive-oauth-drive-metadata-2026-08-29T1925Z | kind: next

Superseded by story-google-drive-oauth-managed-tab-2026-08-29T2024Z. `managedTab.service.ts` is recommended. `googleDriveOAuth` is visited. Next is `googleMaps` (unvisited — enumerate first).

`googleDriveOAuth` is **in-progress**. `driveMetadata.service.ts` is recommended. Next module: **`managedTab.service.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md` + `google-drive-oauth-drive-metadata.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, `google-drive-oauth-picker-nonce-store.md`, `google-drive-oauth-picker-selection-store.md`, and `google-drive-oauth-drive-metadata.md`.
3. Stay on `googleDriveOAuth`. Next is `managedTab.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/123 after #122 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1831Z | to: next-run | from: story-google-drive-oauth-picker-selection-store-2026-08-29T1831Z | kind: next

Superseded by story-google-drive-oauth-drive-metadata-2026-08-29T1925Z. `driveMetadata.service.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `managedTab.service.ts`.

`googleDriveOAuth` is **in-progress**. `pickerSelectionStore.ts` is recommended. Next module: **`driveMetadata.service.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md` + `google-drive-oauth-picker-selection-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, `google-drive-oauth-picker-nonce-store.md`, and `google-drive-oauth-picker-selection-store.md`.
3. Stay on `googleDriveOAuth`. Next is `driveMetadata.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/122 after #121 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1726Z | to: next-run | from: story-google-drive-oauth-picker-nonce-store-2026-08-29T1726Z | kind: next

Superseded by story-google-drive-oauth-picker-selection-store-2026-08-29T1831Z. `pickerSelectionStore.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `driveMetadata.service.ts`.

`googleDriveOAuth` is **in-progress**. `pickerNonceStore.ts` is recommended. Next module: **`pickerSelectionStore.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md` + `google-drive-oauth-picker-nonce-store.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, and `google-drive-oauth-picker-nonce-store.md`.
3. Stay on `googleDriveOAuth`. Next is `pickerSelectionStore.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/121 after #120 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1621Z | to: next-run | from: story-google-drive-oauth-picker-2026-08-29T1621Z | kind: next

Superseded by story-google-drive-oauth-picker-nonce-store-2026-08-29T1726Z. `pickerNonceStore.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `pickerSelectionStore.ts`.

`googleDriveOAuth` is **in-progress**. `picker.service.ts` is recommended. Next module: **`pickerNonceStore.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md` + `google-drive-oauth-picker.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, and `google-drive-oauth-picker.md`.
3. Stay on `googleDriveOAuth`. Next is `pickerNonceStore.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/120 after #119 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1517Z | to: next-run | from: story-google-drive-oauth-spreadsheet-2026-08-29T1517Z | kind: next

Superseded by story-google-drive-oauth-picker-2026-08-29T1621Z. `picker.service.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `pickerNonceStore.ts`.

`googleDriveOAuth` is **in-progress**. `spreadsheet.service.ts` is recommended. Next module: **`picker.service.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md` + `google-drive-oauth-spreadsheet.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, and `google-drive-oauth-spreadsheet.md`.
3. Stay on `googleDriveOAuth`. Next is `picker.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/119 after #118 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1424Z | to: next-run | from: story-google-drive-oauth-owner-auth-2026-08-29T1424Z | kind: next

Superseded by story-google-drive-oauth-spreadsheet-2026-08-29T1517Z. `spreadsheet.service.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `picker.service.ts`.

`googleDriveOAuth` is **in-progress**. `ownerAuth.ts` is recommended. Next module: **`spreadsheet.service.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md` + `google-drive-oauth-owner-auth.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, and `google-drive-oauth-owner-auth.md`.
3. Stay on `googleDriveOAuth`. Next is `spreadsheet.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/118 after #117 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1329Z | to: next-run | from: story-google-drive-oauth-oauth-security-2026-08-29T1329Z | kind: next

Superseded by story-google-drive-oauth-owner-auth-2026-08-29T1424Z. `ownerAuth.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `spreadsheet.service.ts`.

`googleDriveOAuth` is **in-progress**. `oauthSecurity.ts` is recommended. Next module: **`ownerAuth.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md` + `google-drive-oauth-oauth-security.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, and `google-drive-oauth-oauth-security.md`.
3. Stay on `googleDriveOAuth`. Next is `ownerAuth.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/117 after #116 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1220Z | to: next-run | from: story-google-drive-oauth-oauth-scopes-2026-08-29T1220Z | kind: next

Superseded by story-google-drive-oauth-oauth-security-2026-08-29T1329Z. `oauthSecurity.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `ownerAuth.ts`.

`googleDriveOAuth` is **in-progress**. `oauthScopes.ts` is recommended. Next module: **`oauthSecurity.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md` + `google-drive-oauth-oauth-scopes.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, and `google-drive-oauth-oauth-scopes.md`.
3. Stay on `googleDriveOAuth`. Next is `oauthSecurity.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/116 after #115 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1119Z | to: next-run | from: story-google-drive-oauth-token-encryption-2026-08-29T1119Z | kind: next

Superseded by story-google-drive-oauth-oauth-scopes-2026-08-29T1220Z. `oauthScopes.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `oauthSecurity.ts`.

`googleDriveOAuth` is **in-progress**. `tokenEncryption.ts` is recommended. Next module: **`oauthScopes.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md` + `google-drive-oauth-token-encryption.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-drive-oauth-google-drive-oauth.md` and `google-drive-oauth-token-encryption.md`.
3. Stay on `googleDriveOAuth`. Next is `oauthScopes.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/115 after #114 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T1020Z | to: next-run | from: story-google-drive-oauth-google-drive-oauth-2026-08-29T1020Z | kind: next

Superseded by story-google-drive-oauth-token-encryption-2026-08-29T1119Z. `tokenEncryption.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `oauthScopes.ts`.

`googleDriveOAuth` is **in-progress**. `googleDriveOAuth.service.ts` is recommended. Next module: **`tokenEncryption.ts`**. Stay on `googleDriveOAuth`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md` + `google-drive-oauth-google-drive-oauth.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-auth-service-account.md` and `google-drive-oauth-google-drive-oauth.md`.
3. Stay on `googleDriveOAuth`. Next is `tokenEncryption.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/114 after #113 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0922Z | to: next-run | from: story-google-auth-service-account-2026-08-29T0922Z | kind: next

Superseded by story-google-drive-oauth-google-drive-oauth-2026-08-29T1020Z. `googleDriveOAuth.service.ts` is recommended. `googleDriveOAuth` is in-progress. Next is `tokenEncryption.ts`.

`googleAuth` is **visited**. `serviceAccount.ts` is recommended. Next service: **`googleDriveOAuth`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md` + `google-auth-service-account.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-cancelled-lead-row.md` and `google-auth-service-account.md`.
3. Open `googleDriveOAuth`. Enumerate every service `.ts` file onto the checklist, skip barrels/type-only, then recommend the first story-worthy module. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/113 after #112 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0824Z | to: next-run | from: story-google-sheets-cancelled-lead-row-2026-08-29T0824Z | kind: next

Superseded by story-google-auth-service-account-2026-08-29T0922Z. `serviceAccount.ts` is recommended. `googleAuth` is visited. Next is `googleDriveOAuth` (enumerate first).

`googleSheets` is **visited**. `projections/cancelledLeadRow.ts` is recommended. Next service: **`googleAuth`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md` + `google-sheets-cancelled-lead-row.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, `google-sheets-form-lead-row.md`, `google-sheets-call-lead-row.md`, `google-sheets-booked-lead-row.md`, and `google-sheets-cancelled-lead-row.md`.
3. Open `googleAuth`. Enumerate every service `.ts` file onto the checklist, skip barrels/type-only, then recommend the first story-worthy module. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/112 after #111 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0724Z | to: next-run | from: story-google-sheets-booked-lead-row-2026-08-29T0724Z | kind: next

Superseded by story-google-sheets-cancelled-lead-row-2026-08-29T0824Z. `projections/cancelledLeadRow.ts` is recommended. `googleSheets` is visited. Next is `googleAuth` (enumerate first).

`googleSheets` is **in-progress**. `projections/bookedLeadRow.ts` is recommended. Next module: **`projections/cancelledLeadRow.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md` + `google-sheets-booked-lead-row.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, `google-sheets-form-lead-row.md`, `google-sheets-call-lead-row.md`, and `google-sheets-booked-lead-row.md`.
3. Stay on `googleSheets`. Next is `projections/cancelledLeadRow.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/111 after #110 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0627Z | to: next-run | from: story-google-sheets-call-lead-row-2026-08-29T0627Z | kind: next

Superseded by story-google-sheets-booked-lead-row-2026-08-29T0724Z. `projections/bookedLeadRow.ts` is recommended. `googleSheets` is in-progress. Next is `projections/cancelledLeadRow.ts`.

`googleSheets` is **in-progress**. `projections/callLeadRow.ts` is recommended. Next module: **`projections/bookedLeadRow.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md` + `google-sheets-call-lead-row.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, `google-sheets-form-lead-row.md`, and `google-sheets-call-lead-row.md`.
3. Stay on `googleSheets`. Next is `projections/bookedLeadRow.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/110 after #109 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0525Z | to: next-run | from: story-google-sheets-form-lead-row-2026-08-29T0525Z | kind: next

Superseded by story-google-sheets-call-lead-row-2026-08-29T0627Z. `projections/callLeadRow.ts` is recommended. `googleSheets` is in-progress. Next is `projections/bookedLeadRow.ts`.

`googleSheets` is **in-progress**. `projections/formLeadRow.ts` is recommended. Next module: **`projections/callLeadRow.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md` + `google-sheets-form-lead-row.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, and `google-sheets-form-lead-row.md`.
3. Stay on `googleSheets`. Next is `projections/callLeadRow.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/109 after #108 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0430Z | to: next-run | from: story-google-sheets-retry-2026-08-29T0430Z | kind: next

Superseded by story-google-sheets-form-lead-row-2026-08-29T0525Z. `projections/formLeadRow.ts` is recommended. `googleSheets` is in-progress. Next is `projections/callLeadRow.ts`.

`googleSheets` is **in-progress**. `retry.ts` is recommended. Next module: **`projections/formLeadRow.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md` + `google-sheets-retry.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, and `google-sheets-retry.md`.
3. Stay on `googleSheets`. Next is `projections/formLeadRow.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/108 after #107 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0327Z | to: next-run | from: story-google-sheets-delete-rows-2026-08-29T0327Z | kind: next

Superseded by story-google-sheets-retry-2026-08-29T0430Z. `retry.ts` is recommended. `googleSheets` is in-progress. Next is `projections/formLeadRow.ts`.

`googleSheets` is **in-progress**. `deleteRows.ts` is recommended. Next module: **`retry.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md` + `google-sheets-delete-rows.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, and `google-sheets-delete-rows.md`.
3. Stay on `googleSheets`. Next is `retry.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/107 after #106 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0225Z | to: next-run | from: story-google-sheets-row-lookup-2026-08-29T0225Z | kind: next

Superseded by story-google-sheets-delete-rows-2026-08-29T0327Z. `deleteRows.ts` is recommended. `googleSheets` is in-progress. Next is `retry.ts`.

`googleSheets` is **in-progress**. `rowLookup.ts` is recommended. Next module: **`deleteRows.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md` + `google-sheets-row-lookup.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, and `google-sheets-row-lookup.md`.
3. Stay on `googleSheets`. Next is `deleteRows.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/106 after #105 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0135Z | to: next-run | from: story-google-sheets-sync-rows-2026-08-29T0135Z | kind: next

Superseded by story-google-sheets-row-lookup-2026-08-29T0225Z. `rowLookup.ts` is recommended. `googleSheets` is in-progress. Next is `deleteRows.ts`.

`googleSheets` is **in-progress**. `syncRows.ts` is recommended. Next module: **`rowLookup.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md` + `google-sheets-sync-rows.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, and `google-sheets-sync-rows.md`.
3. Stay on `googleSheets`. Next is `rowLookup.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/105 after #104 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-29T0027Z | to: next-run | from: story-google-sheets-tabs-2026-08-29T0027Z | kind: next

Superseded by story-google-sheets-sync-rows-2026-08-29T0135Z. `syncRows.ts` is recommended. `googleSheets` is in-progress. Next is `rowLookup.ts`.

`googleSheets` is **in-progress**. `tabs.ts` is recommended. Next module: **`syncRows.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md` + `google-sheets-tabs.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md`, `google-sheets-targets.md`, and `google-sheets-tabs.md`.
3. Stay on `googleSheets`. Next is `syncRows.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/104 after #103 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T2315Z | to: next-run | from: story-google-sheets-targets-2026-08-28T2315Z | kind: next

Superseded by story-google-sheets-tabs-2026-08-29T0027Z. `tabs.ts` is recommended. `googleSheets` is in-progress. Next is `syncRows.ts`.

`googleSheets` is **in-progress**. `targets.ts` is recommended. Next module: **`tabs.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md` + `google-sheets-targets.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `google-sheets-google-sheets.md` and `google-sheets-targets.md`.
3. Stay on `googleSheets`. Next is `tabs.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/103 after #102 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T2230Z | to: next-run | from: story-google-sheets-google-sheets-2026-08-28T2230Z | kind: next

Superseded by story-google-sheets-targets-2026-08-28T2315Z. `targets.ts` is recommended. `googleSheets` is in-progress. Next is `tabs.ts`.

`googleSheets` is **in-progress**. `googleSheets.service.ts` is recommended. Next module: **`targets.ts`**. Stay on `googleSheets`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md` + `google-sheets-google-sheets.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-quota-limiter.md` and `google-sheets-google-sheets.md`.
3. Stay on `googleSheets`. Next is `targets.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/102 after #101 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T2130Z | to: next-run | from: story-sheet-sync-quota-limiter-2026-08-28T2130Z | kind: next

Superseded by story-google-sheets-google-sheets-2026-08-28T2230Z. `googleSheets.service.ts` is recommended. `googleSheets` is in-progress. Next is `targets.ts`.

`sheetSync` is **visited**. `drainer/quotaLimiter.ts` is recommended. Next service: **`googleSheets`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md` + `sheet-sync-quota-limiter.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, `sheet-sync-job-planner.md`, `sheet-sync-batch-writer.md`, `sheet-sync-tab-row-map.md`, and `sheet-sync-quota-limiter.md`.
3. Open `googleSheets`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/101 after #100 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T2020Z | to: next-run | from: story-sheet-sync-tab-row-map-2026-08-28T2020Z | kind: next

Superseded by story-sheet-sync-quota-limiter-2026-08-28T2130Z. `drainer/quotaLimiter.ts` is recommended. `sheetSync` is visited. Next is `googleSheets`.

`sheetSync` is **in-progress**. `drainer/tabRowMap.ts` is recommended. Next module: **`drainer/quotaLimiter.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md` + `sheet-sync-tab-row-map.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, `sheet-sync-job-planner.md`, `sheet-sync-batch-writer.md`, and `sheet-sync-tab-row-map.md`.
3. Stay on `sheetSync`. Next is `drainer/quotaLimiter.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/100 after #99 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1924Z | to: next-run | from: story-sheet-sync-batch-writer-2026-08-28T1924Z | kind: next

Superseded by story-sheet-sync-tab-row-map-2026-08-28T2020Z. `drainer/tabRowMap.ts` is recommended. `sheetSync` is in-progress. Next is `drainer/quotaLimiter.ts`.

`sheetSync` is **in-progress**. `drainer/batchWriter.ts` is recommended. Next module: **`drainer/tabRowMap.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md` + `sheet-sync-batch-writer.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, `sheet-sync-job-planner.md`, and `sheet-sync-batch-writer.md`.
3. Stay on `sheetSync`. Next is `drainer/tabRowMap.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/99 after #98 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1824Z | to: next-run | from: story-sheet-sync-job-planner-2026-08-28T1824Z | kind: next

Superseded by story-sheet-sync-batch-writer-2026-08-28T1924Z. `drainer/batchWriter.ts` is recommended. `sheetSync` is in-progress. Next is `drainer/tabRowMap.ts`.

`sheetSync` is **in-progress**. `drainer/jobPlanner.ts` is recommended. Next module: **`drainer/batchWriter.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md` + `sheet-sync-job-planner.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, and `sheet-sync-job-planner.md`.
3. Stay on `sheetSync`. Next is `drainer/batchWriter.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/98 after #97 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1718Z | to: next-run | from: story-sheet-sync-run-sheet-sync-drain-2026-08-28T1718Z | kind: next

Superseded by story-sheet-sync-job-planner-2026-08-28T1824Z. `drainer/jobPlanner.ts` is recommended. `sheetSync` is in-progress. Next is `drainer/batchWriter.ts`.

`sheetSync` is **in-progress**. `drainer/runSheetSyncDrain.ts` is recommended. Next module: **`drainer/jobPlanner.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md` + `sheet-sync-run-sheet-sync-drain.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, and `sheet-sync-run-sheet-sync-drain.md`.
3. Stay on `sheetSync`. Next is `drainer/jobPlanner.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/97 after #96 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1621Z | to: next-run | from: story-sheet-sync-source-lookup-2026-08-28T1621Z | kind: next

Superseded by story-sheet-sync-run-sheet-sync-drain-2026-08-28T1718Z. `drainer/runSheetSyncDrain.ts` is recommended. `sheetSync` is in-progress. Next is `drainer/jobPlanner.ts`.

`sheetSync` is **in-progress**. `sheetSyncSourceLookup.ts` is recommended. Next module: **`drainer/runSheetSyncDrain.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md` + `sheet-sync-source-lookup.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, and `sheet-sync-source-lookup.md`.
3. Stay on `sheetSync`. Next is `drainer/runSheetSyncDrain.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/96 after #95 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1525Z | to: next-run | from: story-sheet-sync-persistence-2026-08-28T1525Z | kind: next

Superseded by story-sheet-sync-source-lookup-2026-08-28T1621Z. `sheetSyncSourceLookup.ts` is recommended. `sheetSync` is in-progress. Next is `drainer/runSheetSyncDrain.ts`.

`sheetSync` is **in-progress**. `sheetSyncPersistence.ts` is recommended. Next module: **`sheetSyncSourceLookup.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md` + `sheet-sync-persistence.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, and `sheet-sync-persistence.md`.
3. Stay on `sheetSync`. Next is `sheetSyncSourceLookup.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/95 after #94 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1435Z | to: next-run | from: story-sheet-sync-queue-2026-08-28T1435Z | kind: next

Superseded by story-sheet-sync-persistence-2026-08-28T1525Z. `sheetSyncPersistence.ts` is recommended. `sheetSync` is in-progress. Next is `sheetSyncSourceLookup.ts`.

`sheetSync` is **in-progress**. `sheetSyncQueue.service.ts` is recommended. Next module: **`sheetSyncPersistence.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md` + `sheet-sync-queue.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, and `sheet-sync-queue.md`.
3. Stay on `sheetSync`. Next is `sheetSyncPersistence.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/94 after #93 closed).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1322Z | to: next-run | from: story-sheet-sync-outbox-2026-08-28T1322Z | kind: next

Superseded by story-sheet-sync-queue-2026-08-28T1435Z. `sheetSyncQueue.service.ts` is recommended. `sheetSync` is in-progress. Next is `sheetSyncPersistence.ts`.

`sheetSync` is **in-progress**. `sheetSyncOutbox.service.ts` is recommended. Next module: **`sheetSyncQueue.service.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md` + `sheet-sync-outbox.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `sheet-sync-coordinator.md` and `sheet-sync-outbox.md`.
3. Stay on `sheetSync`. Next is `sheetSyncQueue.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/93 after #92 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1227Z | to: next-run | from: story-sheet-sync-coordinator-2026-08-28T1227Z | kind: next

Superseded by story-sheet-sync-outbox-2026-08-28T1322Z. `sheetSyncOutbox.service.ts` is recommended. `sheetSync` is in-progress. Next is `sheetSyncQueue.service.ts`.

`sheetSync` is **in-progress**. `sheetSyncCoordinator.ts` is recommended. Next module: **`sheetSyncOutbox.service.ts`**. Stay on `sheetSync`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md` + `sheet-sync-coordinator.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `lead-messaging-twilio-adapter.md` and `sheet-sync-coordinator.md`.
3. Stay on `sheetSync`. Next is `sheetSyncOutbox.service.ts`. Do not write a whole-folder recommendation. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/92 after #91 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1113Z | to: next-run | from: story-lead-messaging-twilio-adapter-2026-08-28T1113Z | kind: next

Superseded by story-sheet-sync-coordinator-2026-08-28T1227Z. `sheetSyncCoordinator.ts` is recommended. `sheetSync` is in-progress. Next is `sheetSyncOutbox.service.ts`.

`leadMessaging` is **visited**. `twilioAdapter.ts` is recommended. Next service: **`sheetSync`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md` + `lead-messaging-twilio-adapter.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `lead-messaging-lead-messaging.md`, `lead-messaging-granot-created-lead.md`, `lead-messaging-lead-messaging-queue.md`, and `lead-messaging-twilio-adapter.md`.
3. Open `sheetSync`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/91 after #90 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T1020Z | to: next-run | from: story-lead-messaging-lead-messaging-queue-2026-08-28T1020Z | kind: next

Superseded by story-lead-messaging-twilio-adapter-2026-08-28T1113Z. `twilioAdapter.ts` is recommended. `leadMessaging` is visited. Next is `sheetSync`.

`leadMessaging` is **in-progress**. `leadMessagingQueue.service.ts` is recommended. Next module: **`twilioAdapter.ts`**. Stay on `leadMessaging`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md` + `lead-messaging-lead-messaging-queue.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `lead-messaging-lead-messaging.md`, `lead-messaging-granot-created-lead.md`, and `lead-messaging-lead-messaging-queue.md`.
3. Stay on `leadMessaging`. Next is `twilioAdapter.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/90 after #89 closed).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0918Z | to: next-run | from: story-lead-messaging-granot-created-lead-2026-08-28T0918Z | kind: next

Superseded by story-lead-messaging-lead-messaging-queue-2026-08-28T1020Z. `leadMessagingQueue.service.ts` is recommended. `leadMessaging` is in-progress. Next is `twilioAdapter.ts`.

`leadMessaging` is **in-progress**. `granotCreatedLead.ts` is recommended. Next module: **`leadMessagingQueue.service.ts`**. Stay on `leadMessaging`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md` + `lead-messaging-granot-created-lead.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `lead-messaging-lead-messaging.md` and `lead-messaging-granot-created-lead.md`.
3. Stay on `leadMessaging`. Next is `leadMessagingQueue.service.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #88 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0830Z | to: next-run | from: story-lead-messaging-lead-messaging-2026-08-28T0830Z | kind: next

Superseded by story-lead-messaging-granot-created-lead-2026-08-28T0918Z. `granotCreatedLead.ts` is recommended. `leadMessaging` is in-progress. Next is `leadMessagingQueue.service.ts`.

`leadMessaging` is **in-progress**. `leadMessaging.service.ts` is recommended. Next module: **`granotCreatedLead.ts`**. Stay on `leadMessaging`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md` + `lead-messaging-lead-messaging.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `crm-form-lead-payload.md` and `lead-messaging-lead-messaging.md`.
3. Stay on `leadMessaging`. Next is `granotCreatedLead.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #87 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0725Z | to: next-run | from: story-crm-form-lead-payload-2026-08-28T0725Z | kind: next

Superseded by story-lead-messaging-lead-messaging-2026-08-28T0830Z. `leadMessaging.service.ts` is recommended. `leadMessaging` is in-progress. Next is `granotCreatedLead.ts`.

`crm` is **visited**. `formLeadPayload.ts` is recommended. Next service: **`leadMessaging`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md` + `crm-form-lead-payload.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `crm-crm-service.md` and `crm-form-lead-payload.md`.
3. Open `leadMessaging`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #86 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0623Z | to: next-run | from: story-crm-crm-service-2026-08-28T0623Z | kind: next

Superseded by story-crm-form-lead-payload-2026-08-28T0725Z. `formLeadPayload.ts` is recommended. `crm` is visited. Next is `leadMessaging`.

`crm` is **in-progress**. `crm.service.ts` is recommended. Next module: **`formLeadPayload.ts`**. Stay on `crm`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md` + `crm-crm-service.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-crm-csv-parser.md` and `crm-crm-service.md`.
3. Stay on `crm`. Next is `formLeadPayload.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #85 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0515Z | to: next-run | from: story-granot-crm-csv-parser-2026-08-28T0515Z | kind: next

Superseded by story-crm-crm-service-2026-08-28T0623Z. `crm.service.ts` is recommended. `crm` is in-progress. Next is `formLeadPayload.ts`.

`granotCrmCsv` is **visited**. `parser.ts` is recommended. Next service: **`crm`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md` + `granot-crm-csv-parser.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-crm-csv-upload.md`, `granot-crm-csv-sync.md`, `granot-crm-csv-registry.md`, and `granot-crm-csv-parser.md`.
3. Open `crm`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #84 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0424Z | to: next-run | from: story-granot-crm-csv-registry-2026-08-28T0424Z | kind: next

Superseded by story-granot-crm-csv-parser-2026-08-28T0515Z. `parser.ts` is recommended. `granotCrmCsv` is visited. Next is `crm`.

`granotCrmCsv` is **in-progress**. `registry.ts` is recommended. Next module: **`parser.ts`**. Stay on `granotCrmCsv`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md` + `granot-crm-csv-registry.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-crm-csv-upload.md`, `granot-crm-csv-sync.md`, and `granot-crm-csv-registry.md`.
3. Stay on `granotCrmCsv`. Next is `parser.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #83 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0315Z | to: next-run | from: story-granot-crm-csv-sync-2026-08-28T0315Z | kind: next

Superseded by story-granot-crm-csv-registry-2026-08-28T0424Z. `registry.ts` is recommended. `granotCrmCsv` is in-progress. Next is `parser.ts`.

`granotCrmCsv` is **in-progress**. `sync.service.ts` is recommended. Next module: **`registry.ts`**. Stay on `granotCrmCsv`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md` + `granot-crm-csv-sync.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-crm-csv-upload.md` and `granot-crm-csv-sync.md`.
3. Stay on `granotCrmCsv`. Next is `registry.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #82 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0245Z | to: next-run | from: story-granot-crm-csv-upload-2026-08-28T0245Z | kind: next

Superseded by story-granot-crm-csv-sync-2026-08-28T0315Z. `sync.service.ts` is recommended. `granotCrmCsv` is in-progress. Next is `registry.ts`.

`granotCrmCsv` is **in-progress**. `upload.service.ts` is recommended. Next module: **`sync.service.ts`**. Stay on `granotCrmCsv`. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + seven `granot-http-collector-*.md` files + `granot-crm-csv-upload.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-run-workflow.md` and `granot-crm-csv-upload.md`.
3. Stay on `granotCrmCsv`. Next is `sync.service.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #81 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0127Z | to: next-run | from: story-granot-http-collector-run-workflow-2026-08-28T0127Z | kind: next

Superseded by story-granot-crm-csv-upload-2026-08-28T0245Z. `upload.service.ts` is recommended. `granotCrmCsv` is in-progress. Next is `sync.service.ts`.

`granotHttpCollector` is **visited**. `runWorkflow.ts` is recommended. Next service: **`granotCrmCsv`**. Open it and enumerate first. Wave B is locked.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md` + `granot-http-collector-automation.md` + `granot-http-collector-source-catalog.md` + `granot-http-collector-form-workflow.md` + `granot-http-collector-form-lead-matcher.md` + `granot-http-collector-lifecycle-statement.md` + `granot-http-collector-run-workflow.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-lifecycle-statement.md` and `granot-http-collector-run-workflow.md`.
3. Open `granotCrmCsv`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #80 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-28T0018Z | to: next-run | from: story-granot-http-collector-lifecycle-statement-2026-08-28T0018Z | kind: next

Superseded by story-granot-http-collector-run-workflow-2026-08-28T0127Z. `runWorkflow.ts` is recommended. `granotHttpCollector` is visited. Next is `granotCrmCsv`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md` + `granot-http-collector-automation.md` + `granot-http-collector-source-catalog.md` + `granot-http-collector-form-workflow.md` + `granot-http-collector-form-lead-matcher.md` + `granot-http-collector-lifecycle-statement.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-form-lead-matcher.md` and `granot-http-collector-lifecycle-statement.md`.
3. Stay on `granotHttpCollector`. Next is `runWorkflow.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #79 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T2320Z | to: next-run | from: story-granot-http-collector-form-lead-matcher-2026-08-27T2320Z | kind: next

Superseded by story-granot-http-collector-lifecycle-statement-2026-08-28T0018Z. `lifecycleStatement.ts` is recommended. `granotHttpCollector` is in-progress. Next is `runWorkflow.ts`.

`granotHttpCollector` is **in-progress**. `granotFormLeadMatcher.ts` is recommended. Next module: **`lifecycleStatement.ts`**. Stay on `granotHttpCollector`. Do not write a whole-folder recommendation.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md` + `granot-http-collector-automation.md` + `granot-http-collector-source-catalog.md` + `granot-http-collector-form-workflow.md` + `granot-http-collector-form-lead-matcher.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-form-workflow.md` and `granot-http-collector-form-lead-matcher.md`.
3. Stay on `granotHttpCollector`. Next is `lifecycleStatement.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #78 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T2217Z | to: next-run | from: story-granot-http-collector-form-workflow-2026-08-27T2217Z | kind: next

Superseded by story-granot-http-collector-form-lead-matcher-2026-08-27T2320Z. `granotFormLeadMatcher.ts` is recommended. `granotHttpCollector` is in-progress. Next is `lifecycleStatement.ts`.

## 2026-08-27T2114Z | to: next-run | from: story-granot-http-collector-source-catalog-2026-08-27T2114Z | kind: next

Superseded by story-granot-http-collector-form-workflow-2026-08-27T2217Z. `formWorkflow.ts` is recommended. `granotHttpCollector` is in-progress. Next is `granotFormLeadMatcher.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md` + `granot-http-collector-automation.md` + `granot-http-collector-source-catalog.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-index.md`, `granot-http-collector-automation.md`, and `granot-http-collector-source-catalog.md`.
3. Stay on `granotHttpCollector`. Next is `formWorkflow.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #76 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T2010Z | to: next-run | from: story-granot-http-collector-automation-2026-08-27T2010Z | kind: next

Superseded by story-granot-http-collector-source-catalog-2026-08-27T2114Z. `sourceCatalog.ts` is recommended. `granotHttpCollector` is in-progress. Next is `formWorkflow.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md` + `granot-http-collector-automation.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-http-collector-index.md` and `granot-http-collector-automation.md`.
3. Stay on `granotHttpCollector`. Next is `sourceCatalog.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #75 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1913Z | to: next-run | from: story-granot-http-collector-index-2026-08-27T1913Z | kind: next

Superseded by story-granot-http-collector-automation-2026-08-27T2010Z. `automation.ts` is recommended. `granotHttpCollector` is in-progress. Next is `sourceCatalog.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files + `granot-http-collector-index.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-alerts.md` and `granot-http-collector-index.md`.
3. Stay on `granotHttpCollector`. Next is `automation.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #74 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1809Z | to: next-run | from: story-granot-lifecycle-alerts-2026-08-27T1809Z | kind: next

Superseded by story-granot-http-collector-index-2026-08-27T1913Z. `index.ts` is recommended. `granotHttpCollector` is in-progress. Next is `automation.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + thirty-four `granot-lifecycle-*.md` files including `granot-lifecycle-alerts.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-metrics.md` and `granot-lifecycle-alerts.md`.
3. Open `granotHttpCollector`. Enumerate first. Do not write a whole-folder recommendation for a large service. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #73 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1709Z | to: next-run | from: story-granot-lifecycle-metrics-2026-08-27T1709Z | kind: next

Superseded by story-granot-lifecycle-alerts-2026-08-27T1809Z. `alerts.ts` is recommended. `granotLifecycle` is visited. Next is `granotHttpCollector`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md` + `granot-lifecycle-discrepancies.md` + `granot-lifecycle-discrepancy-owner-commands.md` + `granot-lifecycle-discrepancy-projections.md` + `granot-lifecycle-observability.md` + `granot-lifecycle-metrics.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-observability.md` and `granot-lifecycle-metrics.md`.
3. Stay on `granotLifecycle`. Next is `alerts.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #72 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1610Z | to: next-run | from: story-granot-lifecycle-observability-2026-08-27T1610Z | kind: next

Superseded by story-granot-lifecycle-metrics-2026-08-27T1709Z. `metrics.ts` is recommended. `granotLifecycle` is in-progress. Next is `alerts.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md` + `granot-lifecycle-discrepancies.md` + `granot-lifecycle-discrepancy-owner-commands.md` + `granot-lifecycle-discrepancy-projections.md` + `granot-lifecycle-observability.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-discrepancy-projections.md` and `granot-lifecycle-observability.md`.
3. Stay on `granotLifecycle`. Next is `metrics.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #71 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1511Z | to: next-run | from: story-granot-lifecycle-discrepancy-projections-2026-08-27T1511Z | kind: next

Superseded by story-granot-lifecycle-observability-2026-08-27T1610Z. `observability.ts` is recommended. `granotLifecycle` is in-progress. Next is `metrics.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md` + `granot-lifecycle-discrepancies.md` + `granot-lifecycle-discrepancy-owner-commands.md` + `granot-lifecycle-discrepancy-projections.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-discrepancy-owner-commands.md` and `granot-lifecycle-discrepancy-projections.md`.
3. Stay on `granotLifecycle`. Next is `observability.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #70 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1412Z | to: next-run | from: story-granot-lifecycle-discrepancy-owner-commands-2026-08-27T1412Z | kind: next

Superseded by story-granot-lifecycle-discrepancy-projections-2026-08-27T1511Z. `discrepancyProjections.ts` is recommended. `granotLifecycle` is in-progress. Next is `observability.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md` + `granot-lifecycle-discrepancies.md` + `granot-lifecycle-discrepancy-owner-commands.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-discrepancies.md` and `granot-lifecycle-discrepancy-owner-commands.md`.
3. Stay on `granotLifecycle`. Next is `discrepancyProjections.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #69 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1308Z | to: next-run | from: story-granot-lifecycle-discrepancies-2026-08-27T1308Z | kind: next

Superseded by story-granot-lifecycle-discrepancy-owner-commands-2026-08-27T1412Z. `discrepancyOwnerCommands.ts` is recommended. `granotLifecycle` is in-progress. Next is `discrepancyProjections.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md` + `granot-lifecycle-discrepancies.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-release-owner-commands.md` and `granot-lifecycle-discrepancies.md`.
3. Stay on `granotLifecycle`. Next is `discrepancyOwnerCommands.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #68 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1212Z | to: next-run | from: story-granot-lifecycle-release-owner-commands-2026-08-27T1212Z | kind: next

Superseded by story-granot-lifecycle-discrepancies-2026-08-27T1308Z. `discrepancies.ts` is recommended. `granotLifecycle` is in-progress. Next is `discrepancyOwnerCommands.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md` + `granot-lifecycle-release-owner-commands.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-release-reconciliation.md` and `granot-lifecycle-release-owner-commands.md`.
3. Stay on `granotLifecycle`. Next is `discrepancies.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #67 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1111Z | to: next-run | from: story-granot-lifecycle-release-reconciliation-2026-08-27T1111Z | kind: next

Superseded by story-granot-lifecycle-release-owner-commands-2026-08-27T1212Z. `releaseOwnerCommands.ts` is recommended. `granotLifecycle` is in-progress. Next is `discrepancies.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md` + `granot-lifecycle-release-reconciliation.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-referral-booking.md` and `granot-lifecycle-release-reconciliation.md`.
3. Stay on `granotLifecycle`. Next is `releaseOwnerCommands.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #66 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T1011Z | to: next-run | from: story-granot-lifecycle-referral-booking-2026-08-27T1011Z | kind: next

Superseded by story-granot-lifecycle-release-reconciliation-2026-08-27T1111Z. `releaseReconciliation.ts` is recommended. `granotLifecycle` is in-progress. Next is `releaseOwnerCommands.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md` + `granot-lifecycle-referral-booking.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-booking-priority-pairing.md` and `granot-lifecycle-referral-booking.md`.
3. Stay on `granotLifecycle`. Next is `releaseReconciliation.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #65 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0910Z | to: next-run | from: story-granot-lifecycle-booking-priority-pairing-2026-08-27T0910Z | kind: next

Superseded by story-granot-lifecycle-referral-booking-2026-08-27T1011Z. `referralBooking.ts` is recommended. `granotLifecycle` is in-progress. Next is `releaseReconciliation.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md` + `granot-lifecycle-booking-priority-pairing.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-booking-owner-commands.md` and `granot-lifecycle-booking-priority-pairing.md`.
3. Stay on `granotLifecycle`. Next is `referralBooking.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #64 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0813Z | to: next-run | from: story-granot-lifecycle-booking-owner-commands-2026-08-27T0813Z | kind: next

Superseded by story-granot-lifecycle-booking-priority-pairing-2026-08-27T0910Z. `bookingPriorityPairing.ts` is recommended. `granotLifecycle` is in-progress. Next is `referralBooking.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md` + `granot-lifecycle-booking-owner-commands.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-booking-confirmation.md` and `granot-lifecycle-booking-owner-commands.md`.
3. Stay on `granotLifecycle`. Next is `bookingPriorityPairing.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #63 closed).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0710Z | to: next-run | from: story-granot-lifecycle-booking-confirmation-2026-08-27T0710Z | kind: next

Superseded by story-granot-lifecycle-booking-owner-commands-2026-08-27T0813Z. `bookingOwnerCommands.ts` is recommended. `granotLifecycle` is in-progress. Next is `bookingPriorityPairing.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md` + `granot-lifecycle-booking-confirmation.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-booking-reconciliation.md` and `granot-lifecycle-booking-confirmation.md`.
3. Stay on `granotLifecycle`. Next is `bookingOwnerCommands.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #62 closed).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0610Z | to: next-run | from: story-granot-lifecycle-booking-reconciliation-2026-08-27T0610Z | kind: next

Superseded by story-granot-lifecycle-booking-confirmation-2026-08-27T0710Z. `bookingConfirmation.ts` is recommended. `granotLifecycle` is in-progress. Next is `bookingOwnerCommands.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md` + `granot-lifecycle-booking-reconciliation.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-create-lead-from-granot.md` and `granot-lifecycle-booking-reconciliation.md`.
3. Stay on `granotLifecycle`. Next is `bookingConfirmation.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #61 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0510Z | to: next-run | from: story-granot-lifecycle-create-lead-from-granot-2026-08-27T0510Z | kind: next

Superseded by story-granot-lifecycle-booking-reconciliation-2026-08-27T0610Z. `bookingReconciliation.ts` is recommended. `granotLifecycle` is in-progress. Next is `bookingConfirmation.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md` + `granot-lifecycle-synchronize-lead-from-granot.md` + `granot-lifecycle-create-lead-from-granot.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-synchronize-lead-from-granot.md` and `granot-lifecycle-create-lead-from-granot.md`.
3. Stay on `granotLifecycle`. Next is `bookingReconciliation.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #60 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0412Z | to: next-run | from: story-granot-lifecycle-synchronize-lead-from-granot-2026-08-27T0412Z | kind: next

Superseded by story-granot-lifecycle-create-lead-from-granot-2026-08-27T0510Z. `createLeadFromGranot.ts` is recommended. `granotLifecycle` is in-progress. Next is `bookingReconciliation.ts`.

## 2026-08-27T0309Z | to: next-run | from: story-granot-lifecycle-trusted-lead-create-validation-2026-08-27T0309Z | kind: next

Superseded by story-granot-lifecycle-synchronize-lead-from-granot-2026-08-27T0412Z. `synchronizeLeadFromGranot.ts` is recommended. `granotLifecycle` is in-progress. Next is `createLeadFromGranot.ts`.

1. Take stock first. Disk now has the twelve `leads` recommendations + seven `bookings-*.md` files + three `cancellations-*.md` files + two `customers-*.md` files + two `agents-*.md` files + `lead-source-companies-lead-source-company.md` + `cpl-cpl-rate.md` + `catalog-catalog.md` + four `search-*.md` files + two `enrichment-*.md` files + two `reconciliation-*.md` files + `granot-lifecycle-capture.md` + `granot-lifecycle-queue-publisher.md` + `granot-lifecycle-extension-apply.md` + `granot-lifecycle-automation-apply.md` + `granot-lifecycle-automation-compatibility.md` + `granot-lifecycle-normalization.md` + `granot-lifecycle-source-policy.md` + `granot-lifecycle-identity.md` + `granot-lifecycle-granot-temporal.md` + `granot-lifecycle-lead-desired-state.md` + `granot-lifecycle-authorized-desired-state.md` + `granot-lifecycle-lead-contact-projection.md` + `granot-lifecycle-processor.md` + `granot-lifecycle-operations.md` + `granot-lifecycle-projections.md` + `granot-lifecycle-creating-observation.md` + `granot-lifecycle-drainer.md` + `granot-lifecycle-aggregate-revision.md` + `granot-lifecycle-trusted-lead-create-validation.md`.
2. Do not rewrite `form-lead.md` or any prior recommendation, including `granot-lifecycle-aggregate-revision.md` and `granot-lifecycle-trusted-lead-create-validation.md`.
3. Stay on `granotLifecycle`. Next is `synchronizeLeadFromGranot.ts`. Wave B is locked.
4. No `src/` edits. Branch `docs/story-refactor`. Open a new PR if the latest story-refactor PR is already merged (this pass opened after #58 merged).
5. Cloud agent checkouts may boot on `cursor/*` with a stale seed `NOW.md`. **Disk on `docs/story-refactor` wins.** Checkout that branch before choosing a module.

## 2026-08-27T0208Z | to: next-run | from: story-granot-lifecycle-aggregate-revision-2026-08-27T0208Z | kind: next

Superseded by story-granot-lifecycle-trusted-lead-create-validation-2026-08-27T0309Z. `trustedLeadCreateValidation.ts` is recommended. `granotLifecycle` is in-progress. Next is `synchronizeLeadFromGranot.ts`.

## 2026-08-27T0110Z | to: next-run | from: story-granot-lifecycle-drainer-2026-08-27T0110Z | kind: next

Superseded by story-granot-lifecycle-aggregate-revision-2026-08-27T0208Z. `aggregateRevision.ts` is recommended. `granotLifecycle` is in-progress. Next is `trustedLeadCreateValidation.ts`.

## Resolved

## 2026-08-27T0008Z | to: next-run | from: story-granot-lifecycle-creating-observation-2026-08-27T0008Z | kind: next

Superseded by story-granot-lifecycle-drainer-2026-08-27T0110Z. `drainer.ts` is recommended. `granotLifecycle` is in-progress. Next is `aggregateRevision.ts`.

## 2026-08-26T2312Z | to: next-run | from: story-granot-lifecycle-projections-2026-08-26T2312Z | kind: next

Superseded by story-granot-lifecycle-creating-observation-2026-08-27T0008Z. `creatingObservation.ts` is recommended. `granotLifecycle` is in-progress. Next is `drainer.ts`.

## 2026-08-26T2212Z | to: next-run | from: story-granot-lifecycle-operations-2026-08-26T2212Z | kind: next

Superseded by story-granot-lifecycle-projections-2026-08-26T2312Z. `projections.ts` is recommended. `granotLifecycle` is in-progress. Next is `creatingObservation.ts`.

## 2026-08-26T2112Z | to: next-run | from: story-granot-lifecycle-processor-2026-08-26T2112Z | kind: next

Superseded by story-granot-lifecycle-operations-2026-08-26T2212Z. `operations.ts` is recommended. `granotLifecycle` is in-progress. Next is `projections.ts`.


## 2026-08-26T2008Z | to: next-run | from: story-granot-lifecycle-lead-contact-projection-2026-08-26T2008Z | kind: next

Superseded by story-granot-lifecycle-processor-2026-08-26T2112Z. `processor.ts` is recommended. `granotLifecycle` is in-progress. Next is `operations.ts`.

## 2026-08-26T1909Z | to: next-run | from: story-granot-lifecycle-authorized-desired-state-2026-08-26T1909Z | kind: next

Superseded by story-granot-lifecycle-lead-contact-projection-2026-08-26T2008Z. `leadContactProjection.ts` is recommended. `granotLifecycle` is in-progress. Next is `processor.ts`.

## 2026-08-26T1810Z | to: next-run | from: story-granot-lifecycle-lead-desired-state-2026-08-26T1810Z | kind: next

Superseded by story-granot-lifecycle-authorized-desired-state-2026-08-26T1909Z. `authorizedDesiredState.ts` is recommended. `granotLifecycle` is in-progress. Next is `leadContactProjection.ts`.

## 2026-08-26T1712Z | to: next-run | from: story-granot-lifecycle-granot-temporal-2026-08-26T1712Z | kind: next

Superseded by story-granot-lifecycle-lead-desired-state-2026-08-26T1810Z. `leadDesiredState.ts` is recommended. `granotLifecycle` is in-progress. Next is `authorizedDesiredState.ts`.

## 2026-08-26T1611Z | to: next-run | from: story-granot-lifecycle-identity-2026-08-26T1611Z | kind: next

Superseded by story-granot-lifecycle-granot-temporal-2026-08-26T1712Z. `granotTemporal.ts` is recommended. `granotLifecycle` is in-progress. Next is `leadDesiredState.ts`.

## 2026-08-26T1508Z | to: next-run | from: story-granot-lifecycle-source-policy-2026-08-26T1508Z | kind: next

Superseded by story-granot-lifecycle-identity-2026-08-26T1611Z. `identity.ts` is recommended. `granotLifecycle` is in-progress. Next is `granotTemporal.ts`.

## 2026-08-26T1411Z | to: next-run | from: story-granot-lifecycle-normalization-2026-08-26T1411Z | kind: next

Superseded by story-granot-lifecycle-source-policy-2026-08-26T1508Z. `sourcePolicy.ts` is recommended. `granotLifecycle` is in-progress. Next is `identity.ts`.

## 2026-08-26T1311Z | to: next-run | from: story-granot-lifecycle-automation-compatibility-2026-08-26T1311Z | kind: next

Superseded by story-granot-lifecycle-normalization-2026-08-26T1411Z. `normalization.ts` is recommended. `granotLifecycle` is in-progress. Next is `sourcePolicy.ts`.

## 2026-08-26T1208Z | to: next-run | from: story-granot-lifecycle-automation-apply-2026-08-26T1208Z | kind: next

Superseded by story-granot-lifecycle-automation-compatibility-2026-08-26T1311Z. `automationCompatibility.ts` is recommended. `granotLifecycle` is in-progress. Next is `normalization.ts`.

## 2026-08-26T1112Z | to: next-run | from: story-granot-lifecycle-extension-apply-2026-08-26T1112Z | kind: next

Superseded by story-granot-lifecycle-automation-apply-2026-08-26T1208Z. `automationApply.ts` is recommended. `granotLifecycle` is in-progress. Next is `automationCompatibility.ts`.

## 2026-08-26T1012Z | to: next-run | from: story-granot-lifecycle-queue-publisher-2026-08-26T1012Z | kind: next

Superseded by story-granot-lifecycle-extension-apply-2026-08-26T1112Z. `extensionApply.ts` is recommended. `granotLifecycle` is in-progress. Next is `automationApply.ts`.

## 2026-08-26T0916Z | to: next-run | from: story-granot-lifecycle-capture-2026-08-26T0916Z | kind: next

Superseded by story-granot-lifecycle-queue-publisher-2026-08-26T1012Z. `queuePublisher.ts` is recommended. `granotLifecycle` is in-progress. Next is `extensionApply.ts`.

## 2026-08-26T0811Z | to: next-run | from: story-reconciliation-booked-call-lead-rows-2026-08-26T0811Z | kind: next

Superseded by story-granot-lifecycle-capture-2026-08-26T0916Z. `capture.ts` is recommended. `granotLifecycle` is in-progress. Next is `queuePublisher.ts`.

## 2026-08-26T0712Z | to: next-run | from: story-reconciliation-booked-call-lead-2026-08-26T0712Z | kind: next

Superseded by story-reconciliation-booked-call-lead-rows-2026-08-26T0811Z. `bookedCallLeadRows.ts` is recommended. `reconciliation` is visited. Next is `granotLifecycle`.

## 2026-08-26T0608Z | to: next-run | from: story-enrichment-call-lead-enrichment-rows-2026-08-26T0608Z | kind: next

Superseded by story-reconciliation-booked-call-lead-2026-08-26T0712Z. `bookedCallLeadReconciliation.service.ts` is recommended. `reconciliation` is in-progress. Next is `bookedCallLeadRows.ts`.

## 2026-08-26T0512Z | to: next-run | from: story-enrichment-call-lead-enrichment-2026-08-26T0512Z | kind: next

Superseded by story-enrichment-call-lead-enrichment-rows-2026-08-26T0608Z. `callLeadEnrichmentRows.ts` is recommended. `enrichment` is visited. Next is `reconciliation`.

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
