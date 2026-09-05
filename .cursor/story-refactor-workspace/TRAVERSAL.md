# Traversal

Stock-taking board for the **entire** `vantage-main-server` `src/` tree. The unit of work is a **service folder**. Large services take many passes. One pass writes one recommendation (or finishes a thin folder).

Do not put `type:` YAML here. Do not copy Service invariants here.

## Scope

| Wave | Tree | When |
| --- | --- | --- |
| **A (current)** | `src/services/` — every folder, then leftover root barrels | Now. Domain-tour order below. Do not reorder. |
| **B (locked)** | Remaining `src/`: `routes/`, `models/`, `validation/`, `config/domain/`, `middleware/`, `auth/` | Locked until every Wave A service is `visited`. |

Out of scope: `scripts/`, `docs/`, `.cursor/`, tests as targets. Tests are evidence for a recommendation, not their own row.

Production module = a `.ts` file that is not `*.test.ts`, `*.replica.test.ts`, or an empty `index.ts` barrel.

## Stock (rewrite every run)

- Wave: A
- Services visited / in-progress / unvisited: **25 / 1 / 12**
- Recommendations on disk: **181** (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`, `bookings-leadless-booking.md`, `bookings-booking-mirror.md`, `bookings-booking-source-resolver.md`, `bookings-booking-identity.md`, `cancellations-cancelled-lead.md`, `cancellations-cancellation-resolver.md`, `cancellations-cancellation-mirror.md`, `customers-customer.md`, `customers-customer-from-lead.md`, `agents-agent-allocation.md`, `agents-receiver-agent-crm-username.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, `search-form-lead-search.md`, `search-form-lead-browse.md`, `search-call-lead-search.md`, `search-call-lead-browse.md`, `enrichment-call-lead-enrichment.md`, `enrichment-call-lead-enrichment-rows.md`, `reconciliation-booked-call-lead.md`, `reconciliation-booked-call-lead-rows.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`, `granot-lifecycle-source-policy.md`, `granot-lifecycle-identity.md`, `granot-lifecycle-granot-temporal.md`, `granot-lifecycle-lead-desired-state.md`, `granot-lifecycle-authorized-desired-state.md`, `granot-lifecycle-lead-contact-projection.md`, `granot-lifecycle-processor.md`, `granot-lifecycle-operations.md`, `granot-lifecycle-projections.md`, `granot-lifecycle-creating-observation.md`, `granot-lifecycle-drainer.md`, `granot-lifecycle-aggregate-revision.md`, `granot-lifecycle-trusted-lead-create-validation.md`, `granot-lifecycle-synchronize-lead-from-granot.md`, `granot-lifecycle-create-lead-from-granot.md`, `granot-lifecycle-booking-reconciliation.md`, `granot-lifecycle-booking-confirmation.md`, `granot-lifecycle-booking-owner-commands.md`, `granot-lifecycle-booking-priority-pairing.md`, `granot-lifecycle-referral-booking.md`, `granot-lifecycle-release-reconciliation.md`, `granot-lifecycle-release-owner-commands.md`, `granot-lifecycle-discrepancies.md`, `granot-lifecycle-discrepancy-owner-commands.md`, `granot-lifecycle-discrepancy-projections.md`, `granot-lifecycle-observability.md`, `granot-lifecycle-metrics.md`, `granot-lifecycle-alerts.md`, `granot-http-collector-index.md`, `granot-http-collector-automation.md`, `granot-http-collector-source-catalog.md`, `granot-http-collector-form-workflow.md`, `granot-http-collector-form-lead-matcher.md`, `granot-http-collector-lifecycle-statement.md`, `granot-http-collector-run-workflow.md`, `granot-crm-csv-upload.md`, `granot-crm-csv-sync.md`, `granot-crm-csv-registry.md`, `granot-crm-csv-parser.md`, `crm-crm-service.md`, `crm-form-lead-payload.md`, `lead-messaging-lead-messaging.md`, `lead-messaging-granot-created-lead.md`, `lead-messaging-lead-messaging-queue.md`, `lead-messaging-twilio-adapter.md`, `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, `sheet-sync-job-planner.md`, `sheet-sync-batch-writer.md`, `sheet-sync-tab-row-map.md`, `sheet-sync-quota-limiter.md`, `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, `google-sheets-form-lead-row.md`, `google-sheets-call-lead-row.md`, `google-sheets-booked-lead-row.md`, `google-sheets-cancelled-lead-row.md`, `google-auth-service-account.md`, `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, `google-drive-oauth-picker-nonce-store.md`, `google-drive-oauth-picker-selection-store.md`, `google-drive-oauth-drive-metadata.md`, `google-drive-oauth-managed-tab.md`, `google-maps-geocoding.md`, `operational-workbooks-registry.md`, `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, `ringcentral-call-lead-convergence.md`, `ringcentral-shadow-call-leads-store.md`, `ringcentral-processed-calls-store.md`, `ringcentral-call-log-sync.md`, `ringcentral-call-log-sync-state-store.md`, `ringcentral-call-log-vetting.md`, `ringcentral-analytics-reconcile.md`, `ringcentral-auth.md`, `operations-registry-catalog-registry.md`, `operations-registry-source-registry.md`, `operations-registry-source-resolution.md`, `operations-registry-cpl-schedule.md`, `operations-registry-cpl-corrections.md`, `operations-registry-ring-central-registry.md`, `operations-registry-ring-central-snapshot.md`, `operations-registry-ring-central-validation.md`, `operations-registry-granot-crm-sources.md`, `operations-registry-crm-source-outbound-sms.md`, `operations-registry-granot-crm-source-projections.md`, `operations-registry-granot-automation-sources.md`, `operations-registry-trusted-actor.md`, `operations-registry-registry-audit.md`, `operations-registry-runtime-telemetry.md`, `operations-registry-queries-overview.md`, `operations-registry-queries-health.md`, `operations-registry-queries-changes.md`, `operations-registry-label-mappings.md`, `operations-registry-owner-granot-names.md`, `operations-registry-lead-source-setup.md`, `operations-registry-queries-lead-source-projection.md`, `admin-browse.md`, `admin-export.md`, `admin-search.md`, `admin-facets.md`, `admin-filter-catalog.md`, `admin-agent-browse-metrics.md`, `admin-sheet-sync.md`, `analytics-analytics.md`, `analytics-overview.md`, `analytics-summary.md`, `analytics-revenue-trend.md`, `analytics-source-performance.md`, `analytics-agent-performance.md`, `analytics-cancellation-analytics.md`, `analytics-geographic-analytics.md`, `analytics-receiver-agent-performance.md`, `analytics-sms-conversion.md`, `analytics-agent-sales-report.md`, `analytics-lead-cost.md`, `analytics-analytics-export.md`)
- Current service: `analytics` (in-progress)
- Next module: `analyticsFilters.ts`
- Last session: `story-analytics-analytics-export-2026-09-05T1708Z`

## How to read a service row

Status: `unvisited` | `in-progress` | `visited`.

- `unvisited` — no pass has opened the folder. First pass **enumerates** production modules, then recommends or skips the first story-worthy one.
- `in-progress` — checklist exists; unchecked production modules remain. **Stay here.** Do not open the next service.
- `visited` — every production module is `recommended` or `skipped`.

Size is a hint, not a quota: `large` expects several passes.

## Wave A — `src/services/`

Order is the domain tour from `project-organization`. Next work is the first `in-progress` service’s next unchecked module, or the first `unvisited` service if none are in progress.

### 1. `leads` — large — **visited**

Folder: `src/services/leads/`

| Module | Verdict |
| --- | --- |
| `formLead.service.ts` | recommended → [recommendations/form-lead.md](recommendations/form-lead.md) |
| `callLead.service.ts` | recommended → [recommendations/leads-call-lead.md](recommendations/leads-call-lead.md) |
| `duplicateLead.service.ts` | recommended → [recommendations/leads-duplicate-lead.md](recommendations/leads-duplicate-lead.md) |
| `leadIngestionProvenance.ts` | recommended → [recommendations/leads-ingestion-provenance.md](recommendations/leads-ingestion-provenance.md) |
| `leadSourceCompany.ts` | recommended → [recommendations/leads-source-company.md](recommendations/leads-source-company.md) |
| `leadCplResolution.ts` | recommended → [recommendations/leads-cpl-resolution.md](recommendations/leads-cpl-resolution.md) |
| `leadLocation.service.ts` | recommended → [recommendations/leads-lead-location.md](recommendations/leads-lead-location.md) |
| `leadName.service.ts` | recommended → [recommendations/leads-lead-name.md](recommendations/leads-lead-name.md) |
| `leadPhoneMatching.ts` | recommended → [recommendations/leads-lead-phone-matching.md](recommendations/leads-lead-phone-matching.md) |
| `sourceLeadLookup.service.ts` | recommended → [recommendations/leads-source-lead-lookup.md](recommendations/leads-source-lead-lookup.md) |
| `callLeadSourceMatch.ts` | recommended → [recommendations/leads-call-lead-source-match.md](recommendations/leads-call-lead-source-match.md) |
| `leadSourceCompatibility.ts` | recommended → [recommendations/leads-lead-source-compatibility.md](recommendations/leads-lead-source-compatibility.md) |
| `index.ts` | skip — barrel |

### 2. `bookings` — large — **visited**

Folder: `src/services/bookings/`

| Module | Verdict |
| --- | --- |
| `bookedLead.service.ts` | recommended → [recommendations/bookings-booked-lead.md](recommendations/bookings-booked-lead.md) |
| `bookedLeadFromSource.service.ts` | recommended → [recommendations/bookings-booked-lead-from-source.md](recommendations/bookings-booked-lead-from-source.md) |
| `referralBooking.service.ts` | recommended → [recommendations/bookings-referral-booking.md](recommendations/bookings-referral-booking.md) |
| `leadlessBooking.service.ts` | recommended → [recommendations/bookings-leadless-booking.md](recommendations/bookings-leadless-booking.md) |
| `bookingMirror.service.ts` | recommended → [recommendations/bookings-booking-mirror.md](recommendations/bookings-booking-mirror.md) |
| `bookingSourceResolver.ts` | recommended → [recommendations/bookings-booking-source-resolver.md](recommendations/bookings-booking-source-resolver.md) |
| `bookingIdentity.ts` | recommended → [recommendations/bookings-booking-identity.md](recommendations/bookings-booking-identity.md) |
| `bookingWarnings.ts` | skip — thin warning helper |
| `bestRelocationImportGuard.ts` | skip — import fence |
| `index.ts` | skip — barrel |

### 3. `cancellations` — medium — **visited**

Folder: `src/services/cancellations/`

| Module | Verdict |
| --- | --- |
| `cancelledLead.service.ts` | recommended → [recommendations/cancellations-cancelled-lead.md](recommendations/cancellations-cancelled-lead.md) |
| `cancellationResolver.ts` | recommended → [recommendations/cancellations-cancellation-resolver.md](recommendations/cancellations-cancellation-resolver.md) |
| `cancellationMirror.service.ts` | recommended → [recommendations/cancellations-cancellation-mirror.md](recommendations/cancellations-cancellation-mirror.md) |
| `index.ts` | skip — barrel |

### 4. `customers` — small — **visited**

Folder: `src/services/customers/`

| Module | Verdict |
| --- | --- |
| `customer.service.ts` | recommended → [recommendations/customers-customer.md](recommendations/customers-customer.md) |
| `customerFromLead.service.ts` | recommended → [recommendations/customers-customer-from-lead.md](recommendations/customers-customer-from-lead.md) |
| `index.ts` | skip — barrel |

### 5. `agents` — small — **visited**

Folder: `src/services/agents/`

| Module | Verdict |
| --- | --- |
| `agentAllocation.service.ts` | recommended → [recommendations/agents-agent-allocation.md](recommendations/agents-agent-allocation.md) |
| `receiverAgentCrmUsername.ts` | recommended → [recommendations/agents-receiver-agent-crm-username.md](recommendations/agents-receiver-agent-crm-username.md) |
| `agentName.ts` | skip — name fold |
| `index.ts` | skip — barrel |

### 6. `leadSourceCompanies` — small — **visited**

Folder: `src/services/leadSourceCompanies/`

| Module | Verdict |
| --- | --- |
| `leadSourceCompany.service.ts` | recommended → [recommendations/lead-source-companies-lead-source-company.md](recommendations/lead-source-companies-lead-source-company.md) |
| `index.ts` | skip — barrel |

### 7. `cpl` — small — **visited**

Folder: `src/services/cpl/`

| Module | Verdict |
| --- | --- |
| `cplRate.service.ts` | recommended → [recommendations/cpl-cpl-rate.md](recommendations/cpl-cpl-rate.md) |

### 8. `catalog` — small — **visited**

Folder: `src/services/catalog/`

| Module | Verdict |
| --- | --- |
| `catalog.service.ts` | recommended → [recommendations/catalog-catalog.md](recommendations/catalog-catalog.md) |
| `index.ts` | skip — barrel |

### 9. `search` — medium — **visited**

Folder: `src/services/search/`

| Module | Verdict |
| --- | --- |
| `formLeadSearch.service.ts` | recommended → [recommendations/search-form-lead-search.md](recommendations/search-form-lead-search.md) |
| `formLeadBrowse.service.ts` | recommended → [recommendations/search-form-lead-browse.md](recommendations/search-form-lead-browse.md) |
| `callLeadSearch.service.ts` | recommended → [recommendations/search-call-lead-search.md](recommendations/search-call-lead-search.md) |
| `callLeadBrowse.service.ts` | recommended → [recommendations/search-call-lead-browse.md](recommendations/search-call-lead-browse.md) |
| `leadBrowseShared.ts` | skip — browse helpers |
| `index.ts` | skip — barrel |

### 10. `enrichment` — medium — **visited**

Folder: `src/services/enrichment/`

| Module | Verdict |
| --- | --- |
| `callLeadEnrichment.service.ts` | recommended → [recommendations/enrichment-call-lead-enrichment.md](recommendations/enrichment-call-lead-enrichment.md) |
| `callLeadEnrichmentRows.ts` | recommended → [recommendations/enrichment-call-lead-enrichment-rows.md](recommendations/enrichment-call-lead-enrichment-rows.md) |
| `index.ts` | skip — barrel |

### 11. `reconciliation` — medium — **visited**

Folder: `src/services/reconciliation/`

| Module | Verdict |
| --- | --- |
| `bookedCallLeadReconciliation.service.ts` | recommended → [recommendations/reconciliation-booked-call-lead.md](recommendations/reconciliation-booked-call-lead.md) |
| `bookedCallLeadRows.ts` | recommended → [recommendations/reconciliation-booked-call-lead-rows.md](recommendations/reconciliation-booked-call-lead-rows.md) |
| `index.ts` | skip — barrel |

### 12. `granotLifecycle` — large — **visited**

Folder: `src/services/granotLifecycle/` — many passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `receiptEvidence.ts` | skip — redact helpers |
| `receiptCompatibility.ts` | skip — legacy fill |
| `errors.ts` | skip — error types |
| `applyItem.ts` | skip — apply hints |
| `safeLogging.ts` | skip — log mask |
| `synchronizeLeadTypes.ts` | skip — type-only |
| `sourceLabel.ts` | skip — label fold |
| `lastError.ts` | skip — error sanitize |
| `schedules.ts` | skip — retry clock |
| `capture.ts` | recommended → [recommendations/granot-lifecycle-capture.md](recommendations/granot-lifecycle-capture.md) |
| `queuePublisher.ts` | recommended → [recommendations/granot-lifecycle-queue-publisher.md](recommendations/granot-lifecycle-queue-publisher.md) |
| `extensionApply.ts` | recommended → [recommendations/granot-lifecycle-extension-apply.md](recommendations/granot-lifecycle-extension-apply.md) |
| `automationApply.ts` | recommended → [recommendations/granot-lifecycle-automation-apply.md](recommendations/granot-lifecycle-automation-apply.md) |
| `automationCompatibility.ts` | recommended → [recommendations/granot-lifecycle-automation-compatibility.md](recommendations/granot-lifecycle-automation-compatibility.md) |
| `normalization.ts` | recommended → [recommendations/granot-lifecycle-normalization.md](recommendations/granot-lifecycle-normalization.md) |
| `sourcePolicy.ts` | recommended → [recommendations/granot-lifecycle-source-policy.md](recommendations/granot-lifecycle-source-policy.md) |
| `identity.ts` | recommended → [recommendations/granot-lifecycle-identity.md](recommendations/granot-lifecycle-identity.md) |
| `granotTemporal.ts` | recommended → [recommendations/granot-lifecycle-granot-temporal.md](recommendations/granot-lifecycle-granot-temporal.md) |
| `leadDesiredState.ts` | recommended → [recommendations/granot-lifecycle-lead-desired-state.md](recommendations/granot-lifecycle-lead-desired-state.md) |
| `authorizedDesiredState.ts` | recommended → [recommendations/granot-lifecycle-authorized-desired-state.md](recommendations/granot-lifecycle-authorized-desired-state.md) |
| `leadContactProjection.ts` | recommended → [recommendations/granot-lifecycle-lead-contact-projection.md](recommendations/granot-lifecycle-lead-contact-projection.md) |
| `processor.ts` | recommended → [recommendations/granot-lifecycle-processor.md](recommendations/granot-lifecycle-processor.md) |
| `operations.ts` | recommended → [recommendations/granot-lifecycle-operations.md](recommendations/granot-lifecycle-operations.md) |
| `projections.ts` | recommended → [recommendations/granot-lifecycle-projections.md](recommendations/granot-lifecycle-projections.md) |
| `creatingObservation.ts` | recommended → [recommendations/granot-lifecycle-creating-observation.md](recommendations/granot-lifecycle-creating-observation.md) |
| `drainer.ts` | recommended → [recommendations/granot-lifecycle-drainer.md](recommendations/granot-lifecycle-drainer.md) |
| `aggregateRevision.ts` | recommended → [recommendations/granot-lifecycle-aggregate-revision.md](recommendations/granot-lifecycle-aggregate-revision.md) |
| `trustedLeadCreateValidation.ts` | recommended → [recommendations/granot-lifecycle-trusted-lead-create-validation.md](recommendations/granot-lifecycle-trusted-lead-create-validation.md) |
| `synchronizeLeadFromGranot.ts` | recommended → [recommendations/granot-lifecycle-synchronize-lead-from-granot.md](recommendations/granot-lifecycle-synchronize-lead-from-granot.md) |
| `createLeadFromGranot.ts` | recommended → [recommendations/granot-lifecycle-create-lead-from-granot.md](recommendations/granot-lifecycle-create-lead-from-granot.md) |
| `bookingReconciliation.ts` | recommended → [recommendations/granot-lifecycle-booking-reconciliation.md](recommendations/granot-lifecycle-booking-reconciliation.md) |
| `bookingConfirmation.ts` | recommended → [recommendations/granot-lifecycle-booking-confirmation.md](recommendations/granot-lifecycle-booking-confirmation.md) |
| `bookingOwnerCommands.ts` | recommended → [recommendations/granot-lifecycle-booking-owner-commands.md](recommendations/granot-lifecycle-booking-owner-commands.md) |
| `bookingPriorityPairing.ts` | recommended → [recommendations/granot-lifecycle-booking-priority-pairing.md](recommendations/granot-lifecycle-booking-priority-pairing.md) |
| `referralBooking.ts` | recommended → [recommendations/granot-lifecycle-referral-booking.md](recommendations/granot-lifecycle-referral-booking.md) |
| `releaseReconciliation.ts` | recommended → [recommendations/granot-lifecycle-release-reconciliation.md](recommendations/granot-lifecycle-release-reconciliation.md) |
| `releaseOwnerCommands.ts` | recommended → [recommendations/granot-lifecycle-release-owner-commands.md](recommendations/granot-lifecycle-release-owner-commands.md) |
| `discrepancies.ts` | recommended → [recommendations/granot-lifecycle-discrepancies.md](recommendations/granot-lifecycle-discrepancies.md) |
| `discrepancyOwnerCommands.ts` | recommended → [recommendations/granot-lifecycle-discrepancy-owner-commands.md](recommendations/granot-lifecycle-discrepancy-owner-commands.md) |
| `discrepancyProjections.ts` | recommended → [recommendations/granot-lifecycle-discrepancy-projections.md](recommendations/granot-lifecycle-discrepancy-projections.md) |
| `observability.ts` | recommended → [recommendations/granot-lifecycle-observability.md](recommendations/granot-lifecycle-observability.md) |
| `metrics.ts` | recommended → [recommendations/granot-lifecycle-metrics.md](recommendations/granot-lifecycle-metrics.md) |
| `alerts.ts` | recommended → [recommendations/granot-lifecycle-alerts.md](recommendations/granot-lifecycle-alerts.md) |

### 13. `granotHttpCollector` — medium — **visited**

Folder: `src/services/granotHttpCollector/` — several passes. Do not treat as one recommendation. `index.ts` is the session collector, not a barrel.

| Module | Verdict |
| --- | --- |
| `index.ts` | recommended → [recommendations/granot-http-collector-index.md](recommendations/granot-http-collector-index.md) |
| `automation.ts` | recommended → [recommendations/granot-http-collector-automation.md](recommendations/granot-http-collector-automation.md) |
| `sourceCatalog.ts` | recommended → [recommendations/granot-http-collector-source-catalog.md](recommendations/granot-http-collector-source-catalog.md) |
| `formWorkflow.ts` | recommended → [recommendations/granot-http-collector-form-workflow.md](recommendations/granot-http-collector-form-workflow.md) |
| `granotFormLeadMatcher.ts` | recommended → [recommendations/granot-http-collector-form-lead-matcher.md](recommendations/granot-http-collector-form-lead-matcher.md) |
| `lifecycleStatement.ts` | recommended → [recommendations/granot-http-collector-lifecycle-statement.md](recommendations/granot-http-collector-lifecycle-statement.md) |
| `runWorkflow.ts` | recommended → [recommendations/granot-http-collector-run-workflow.md](recommendations/granot-http-collector-run-workflow.md) |
| `errors.ts` | skip — error class |

### 14. `granotCrmCsv` — medium — **visited**

Folder: `src/services/granotCrmCsv/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `upload.service.ts` | recommended → [recommendations/granot-crm-csv-upload.md](recommendations/granot-crm-csv-upload.md) |
| `sync.service.ts` | recommended → [recommendations/granot-crm-csv-sync.md](recommendations/granot-crm-csv-sync.md) |
| `registry.ts` | recommended → [recommendations/granot-crm-csv-registry.md](recommendations/granot-crm-csv-registry.md) |
| `parser.ts` | recommended → [recommendations/granot-crm-csv-parser.md](recommendations/granot-crm-csv-parser.md) |
| `keys.ts` | skip — key fold |
| `storage.ts` | skip — S3 adapter |
| `types.ts` | skip — type-only |
| `index.ts` | skip — barrel |

### 15. `crm` — medium — **visited**

Folder: `src/services/crm/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `crm.service.ts` | recommended → [recommendations/crm-crm-service.md](recommendations/crm-crm-service.md) |
| `formLeadPayload.ts` | recommended → [recommendations/crm-form-lead-payload.md](recommendations/crm-form-lead-payload.md) |
| `crmConfig.ts` | skip — endpoint config |
| `types.ts` | skip — type-only |
| `index.ts` | skip — barrel |

### 16. `leadMessaging` — medium — **visited**

Folder: `src/services/leadMessaging/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `leadMessaging.service.ts` | recommended → [recommendations/lead-messaging-lead-messaging.md](recommendations/lead-messaging-lead-messaging.md) |
| `granotCreatedLead.ts` | recommended → [recommendations/lead-messaging-granot-created-lead.md](recommendations/lead-messaging-granot-created-lead.md) |
| `leadMessagingQueue.service.ts` | recommended → [recommendations/lead-messaging-lead-messaging-queue.md](recommendations/lead-messaging-lead-messaging-queue.md) |
| `twilioAdapter.ts` | recommended → [recommendations/lead-messaging-twilio-adapter.md](recommendations/lead-messaging-twilio-adapter.md) |
| `quietHours.ts` | skip — quiet clock |
| `messageBuilder.ts` | skip — template fold |
| `twilioVoice.ts` | skip — voice helper |
| `index.ts` | skip — barrel |

### 17. `sheetSync` — large — **visited**

Folder: `src/services/sheetSync/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `sheetSyncCoordinator.ts` | recommended → [recommendations/sheet-sync-coordinator.md](recommendations/sheet-sync-coordinator.md) |
| `sheetSyncOutbox.service.ts` | recommended → [recommendations/sheet-sync-outbox.md](recommendations/sheet-sync-outbox.md) |
| `sheetSyncQueue.service.ts` | recommended → [recommendations/sheet-sync-queue.md](recommendations/sheet-sync-queue.md) |
| `sheetSyncPersistence.ts` | recommended → [recommendations/sheet-sync-persistence.md](recommendations/sheet-sync-persistence.md) |
| `sheetSyncSourceLookup.ts` | recommended → [recommendations/sheet-sync-source-lookup.md](recommendations/sheet-sync-source-lookup.md) |
| `sheetSyncJobs.ts` | skip — type-only |
| `index.ts` | skip — barrel |
| `drainer/runSheetSyncDrain.ts` | recommended → [recommendations/sheet-sync-run-sheet-sync-drain.md](recommendations/sheet-sync-run-sheet-sync-drain.md) |
| `drainer/jobPlanner.ts` | recommended → [recommendations/sheet-sync-job-planner.md](recommendations/sheet-sync-job-planner.md) |
| `drainer/batchWriter.ts` | recommended → [recommendations/sheet-sync-batch-writer.md](recommendations/sheet-sync-batch-writer.md) |
| `drainer/tabRowMap.ts` | recommended → [recommendations/sheet-sync-tab-row-map.md](recommendations/sheet-sync-tab-row-map.md) |
| `drainer/quotaLimiter.ts` | recommended → [recommendations/sheet-sync-quota-limiter.md](recommendations/sheet-sync-quota-limiter.md) |
| `drainer/leases.ts` | skip — lease adapter |
| `drainer/types.ts` | skip — type-only |
| `drainer/index.ts` | skip — barrel |

### 18. `googleSheets` — large — **visited**

Folder: `src/services/googleSheets/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `googleSheets.service.ts` | recommended → [recommendations/google-sheets-google-sheets.md](recommendations/google-sheets-google-sheets.md) |
| `targets.ts` | recommended → [recommendations/google-sheets-targets.md](recommendations/google-sheets-targets.md) |
| `tabs.ts` | recommended → [recommendations/google-sheets-tabs.md](recommendations/google-sheets-tabs.md) |
| `syncRows.ts` | recommended → [recommendations/google-sheets-sync-rows.md](recommendations/google-sheets-sync-rows.md) |
| `rowLookup.ts` | recommended → [recommendations/google-sheets-row-lookup.md](recommendations/google-sheets-row-lookup.md) |
| `deleteRows.ts` | recommended → [recommendations/google-sheets-delete-rows.md](recommendations/google-sheets-delete-rows.md) |
| `retry.ts` | recommended → [recommendations/google-sheets-retry.md](recommendations/google-sheets-retry.md) |
| `auth.ts` | skip — client factory |
| `diagnostics.ts` | skip — error format |
| `types.ts` | skip — type-only |
| `projections/formLeadRow.ts` | recommended → [recommendations/google-sheets-form-lead-row.md](recommendations/google-sheets-form-lead-row.md) |
| `projections/callLeadRow.ts` | recommended → [recommendations/google-sheets-call-lead-row.md](recommendations/google-sheets-call-lead-row.md) |
| `projections/bookedLeadRow.ts` | recommended → [recommendations/google-sheets-booked-lead-row.md](recommendations/google-sheets-booked-lead-row.md) |
| `projections/cancelledLeadRow.ts` | recommended → [recommendations/google-sheets-cancelled-lead-row.md](recommendations/google-sheets-cancelled-lead-row.md) |
| `projections/cells.ts` | skip — cell format |

### 19. `googleAuth` — small — **visited**

Folder: `src/services/googleAuth/`

| Module | Verdict |
| --- | --- |
| `serviceAccount.ts` | recommended → [recommendations/google-auth-service-account.md](recommendations/google-auth-service-account.md) |

### 20. `googleDriveOAuth` — medium — **visited**

Folder: `src/services/googleDriveOAuth/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `googleDriveOAuth.service.ts` | recommended → [recommendations/google-drive-oauth-google-drive-oauth.md](recommendations/google-drive-oauth-google-drive-oauth.md) |
| `tokenEncryption.ts` | recommended → [recommendations/google-drive-oauth-token-encryption.md](recommendations/google-drive-oauth-token-encryption.md) |
| `oauthScopes.ts` | recommended → [recommendations/google-drive-oauth-oauth-scopes.md](recommendations/google-drive-oauth-oauth-scopes.md) |
| `oauthSecurity.ts` | recommended → [recommendations/google-drive-oauth-oauth-security.md](recommendations/google-drive-oauth-oauth-security.md) |
| `ownerAuth.ts` | recommended → [recommendations/google-drive-oauth-owner-auth.md](recommendations/google-drive-oauth-owner-auth.md) |
| `spreadsheet.service.ts` | recommended → [recommendations/google-drive-oauth-spreadsheet.md](recommendations/google-drive-oauth-spreadsheet.md) |
| `workbook.service.ts` | skip — one-line facade |
| `picker.service.ts` | recommended → [recommendations/google-drive-oauth-picker.md](recommendations/google-drive-oauth-picker.md) |
| `pickerNonceStore.ts` | recommended → [recommendations/google-drive-oauth-picker-nonce-store.md](recommendations/google-drive-oauth-picker-nonce-store.md) |
| `pickerSelectionStore.ts` | recommended → [recommendations/google-drive-oauth-picker-selection-store.md](recommendations/google-drive-oauth-picker-selection-store.md) |
| `picker.types.ts` | skip — type-only |
| `driveMetadata.service.ts` | recommended → [recommendations/google-drive-oauth-drive-metadata.md](recommendations/google-drive-oauth-drive-metadata.md) |
| `managedTab.service.ts` | recommended → [recommendations/google-drive-oauth-managed-tab.md](recommendations/google-drive-oauth-managed-tab.md) |
| `index.ts` | skip — barrel |

### 21. `googleMaps` — small — **visited**

Folder: `src/services/googleMaps/`

| Module | Verdict |
| --- | --- |
| `geocoding.ts` | recommended → [recommendations/google-maps-geocoding.md](recommendations/google-maps-geocoding.md) |

### 22. `operationalWorkbooks` — small — **visited**

Folder: `src/services/operationalWorkbooks/`

| Module | Verdict |
| --- | --- |
| `registry.ts` | recommended → [recommendations/operational-workbooks-registry.md](recommendations/operational-workbooks-registry.md) |
| `registrations.ts` | skip — env catalog |
| `index.ts` | skip — default registry |

### 23. `ringcentral` — large — **visited**

Folder: `src/services/ringcentral/` — qualify, ingest, call-log sync, analytics reconcile. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `call-qualification.ts` | skip — thin facts |
| `call-candidate-evaluator.ts` | recommended → [recommendations/ringcentral-call-candidate-evaluator.md](recommendations/ringcentral-call-candidate-evaluator.md) |
| `call-candidate-store.ts` | recommended → [recommendations/ringcentral-call-candidate-store.md](recommendations/ringcentral-call-candidate-store.md) |
| `call-candidate-types.ts` | skip — type-only |
| `call-session-aggregator.ts` | recommended → [recommendations/ringcentral-call-session-aggregator.md](recommendations/ringcentral-call-session-aggregator.md) |
| `call-session-store.ts` | recommended → [recommendations/ringcentral-call-session-store.md](recommendations/ringcentral-call-session-store.md) |
| `call-session-types.ts` | skip — type-only |
| `webhook-capture.ts` | recommended → [recommendations/ringcentral-webhook-capture.md](recommendations/ringcentral-webhook-capture.md) |
| `webhook-event-normalizer.ts` | skip — payload fold |
| `webhook-subscriptions.ts` | recommended → [recommendations/ringcentral-webhook-subscriptions.md](recommendations/ringcentral-webhook-subscriptions.md) |
| `local-webhook-capture.ts` | skip — local file |
| `ringcentral-call-lead-ingest.service.ts` | recommended → [recommendations/ringcentral-call-lead-ingest.md](recommendations/ringcentral-call-lead-ingest.md) |
| `ringcentral-duplicate-guard.ts` | recommended → [recommendations/ringcentral-duplicate-guard.md](recommendations/ringcentral-duplicate-guard.md) |
| `callLeadConvergence.service.ts` | recommended → [recommendations/ringcentral-call-lead-convergence.md](recommendations/ringcentral-call-lead-convergence.md) |
| `shadow-call-leads-store.ts` | recommended → [recommendations/ringcentral-shadow-call-leads-store.md](recommendations/ringcentral-shadow-call-leads-store.md) |
| `processed-calls-store.ts` | recommended → [recommendations/ringcentral-processed-calls-store.md](recommendations/ringcentral-processed-calls-store.md) |
| `call-lead-sources.ts` | skip — seed only |
| `call-log-sync.service.ts` | recommended → [recommendations/ringcentral-call-log-sync.md](recommendations/ringcentral-call-log-sync.md) |
| `call-log-sync-state.store.ts` | recommended → [recommendations/ringcentral-call-log-sync-state-store.md](recommendations/ringcentral-call-log-sync-state-store.md) |
| `call-log-vetting.ts` | recommended → [recommendations/ringcentral-call-log-vetting.md](recommendations/ringcentral-call-log-vetting.md) |
| `analytics-reconcile.service.ts` | recommended → [recommendations/ringcentral-analytics-reconcile.md](recommendations/ringcentral-analytics-reconcile.md) |
| `auth.ts` | recommended → [recommendations/ringcentral-auth.md](recommendations/ringcentral-auth.md) |
| `ringcentral-config.ts` | skip — env toggles |
| `ringcentral-metrics.ts` | skip — metric counters |
| `ringcentral-mongo.ts` | skip — mongo helper |
| `client.ts` | skip — HTTP adapter |
| `token-store.ts` | skip — store factory |
| `mongo-token-store.ts` | skip — token adapter |
| `file-token-store.ts` | skip — token adapter |
| `phone-normalization.ts` | skip — phone fold |
| `types.ts` | skip — type-only |

### 24. `operationsRegistry` — large — **visited**

Folder: `src/services/operationsRegistry/` — Owner catalog, sources, CPL, inbound routes, Granot CRM sources, audit. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `catalogRegistry.ts` | recommended → [recommendations/operations-registry-catalog-registry.md](recommendations/operations-registry-catalog-registry.md) |
| `catalogNormalization.ts` | skip — username fold |
| `sourceRegistry.ts` | recommended → [recommendations/operations-registry-source-registry.md](recommendations/operations-registry-source-registry.md) |
| `sourceResolution.ts` | recommended → [recommendations/operations-registry-source-resolution.md](recommendations/operations-registry-source-resolution.md) |
| `cplSchedule.ts` | recommended → [recommendations/operations-registry-cpl-schedule.md](recommendations/operations-registry-cpl-schedule.md) |
| `cplCorrections.ts` | recommended → [recommendations/operations-registry-cpl-corrections.md](recommendations/operations-registry-cpl-corrections.md) |
| `ringCentralRegistry.ts` | recommended → [recommendations/operations-registry-ring-central-registry.md](recommendations/operations-registry-ring-central-registry.md) |
| `ringCentralSnapshot.ts` | recommended → [recommendations/operations-registry-ring-central-snapshot.md](recommendations/operations-registry-ring-central-snapshot.md) |
| `ringCentralValidation.ts` | recommended → [recommendations/operations-registry-ring-central-validation.md](recommendations/operations-registry-ring-central-validation.md) |
| `granotCrmSources.ts` | recommended → [recommendations/operations-registry-granot-crm-sources.md](recommendations/operations-registry-granot-crm-sources.md) |
| `crmSourceOutboundSms.ts` | recommended → [recommendations/operations-registry-crm-source-outbound-sms.md](recommendations/operations-registry-crm-source-outbound-sms.md) |
| `granotCrmSourceProjections.ts` | recommended → [recommendations/operations-registry-granot-crm-source-projections.md](recommendations/operations-registry-granot-crm-source-projections.md) |
| `granotCrmSourceCache.ts` | skip — cache keys |
| `granotAutomationSources.ts` | recommended → [recommendations/operations-registry-granot-automation-sources.md](recommendations/operations-registry-granot-automation-sources.md) |
| `trustedActor.ts` | recommended → [recommendations/operations-registry-trusted-actor.md](recommendations/operations-registry-trusted-actor.md) |
| `trustedActorCanonical.ts` | skip — header fold |
| `registryAudit.ts` | recommended → [recommendations/operations-registry-registry-audit.md](recommendations/operations-registry-registry-audit.md) |
| `snapshotSanitizer.ts` | skip — snapshot fold |
| `cacheInvalidation.ts` | skip — cache notify |
| `runtimeTelemetry.ts` | recommended → [recommendations/operations-registry-runtime-telemetry.md](recommendations/operations-registry-runtime-telemetry.md) |
| `config.ts` | skip — env toggles |
| `errors.ts` | skip — error class |
| `types.ts` | skip — type-only |
| `queries/overview.ts` | recommended → [recommendations/operations-registry-queries-overview.md](recommendations/operations-registry-queries-overview.md) |
| `queries/health.ts` | recommended → [recommendations/operations-registry-queries-health.md](recommendations/operations-registry-queries-health.md) |
| `queries/changes.ts` | recommended → [recommendations/operations-registry-queries-changes.md](recommendations/operations-registry-queries-changes.md) |
| `sourceLabelNormalize.ts` | skip — label fold |
| `ownerLanguageDeck.ts` | skip — DTO leak check |
| `queries/findingTranslation.ts` | skip — finding fold |
| `labelMappings.ts` | recommended → [recommendations/operations-registry-label-mappings.md](recommendations/operations-registry-label-mappings.md) |
| `ownerGranotNames.ts` | recommended → [recommendations/operations-registry-owner-granot-names.md](recommendations/operations-registry-owner-granot-names.md) |
| `leadSourceSetup.ts` | recommended → [recommendations/operations-registry-lead-source-setup.md](recommendations/operations-registry-lead-source-setup.md) |
| `queries/leadSourceProjection.ts` | recommended → [recommendations/operations-registry-queries-lead-source-projection.md](recommendations/operations-registry-queries-lead-source-projection.md) |
| `index.ts` | skip — barrel |

### 25. `admin` — large — **visited**

Folder: `src/services/admin/` — Admin Dashboard desk, typeahead, facets, Agent metrics, Sheet Sync health. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `adminScope.service.ts` | skip — scope pick |
| `adminBrowse.service.ts` | recommended → [recommendations/admin-browse.md](recommendations/admin-browse.md) |
| `adminExport.service.ts` | recommended → [recommendations/admin-export.md](recommendations/admin-export.md) |
| `adminSearch.service.ts` | recommended → [recommendations/admin-search.md](recommendations/admin-search.md) |
| `adminFacets.service.ts` | recommended → [recommendations/admin-facets.md](recommendations/admin-facets.md) |
| `filterCatalog.ts` | recommended → [recommendations/admin-filter-catalog.md](recommendations/admin-filter-catalog.md) |
| `agentBrowseMetrics.service.ts` | recommended → [recommendations/admin-agent-browse-metrics.md](recommendations/admin-agent-browse-metrics.md) |
| `adminSheetSync.service.ts` | recommended → [recommendations/admin-sheet-sync.md](recommendations/admin-sheet-sync.md) |
| `index.ts` | skip — barrel |

### 26. `analytics` — large — **in-progress**

Folder: `src/services/analytics/` — Admin Dashboard named reports, home Overview, Agent Sales, CSV flatten. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `analytics.service.ts` | recommended → [recommendations/analytics-analytics.md](recommendations/analytics-analytics.md) |
| `overview.service.ts` | recommended → [recommendations/analytics-overview.md](recommendations/analytics-overview.md) |
| `summary.service.ts` | recommended → [recommendations/analytics-summary.md](recommendations/analytics-summary.md) |
| `revenueTrend.service.ts` | recommended → [recommendations/analytics-revenue-trend.md](recommendations/analytics-revenue-trend.md) |
| `sourcePerformance.service.ts` | recommended → [recommendations/analytics-source-performance.md](recommendations/analytics-source-performance.md) |
| `agentPerformance.service.ts` | recommended → [recommendations/analytics-agent-performance.md](recommendations/analytics-agent-performance.md) |
| `cancellationAnalytics.service.ts` | recommended → [recommendations/analytics-cancellation-analytics.md](recommendations/analytics-cancellation-analytics.md) |
| `geographicAnalytics.service.ts` | recommended → [recommendations/analytics-geographic-analytics.md](recommendations/analytics-geographic-analytics.md) |
| `receiverAgentPerformance.service.ts` | recommended → [recommendations/analytics-receiver-agent-performance.md](recommendations/analytics-receiver-agent-performance.md) |
| `smsConversion.service.ts` | recommended → [recommendations/analytics-sms-conversion.md](recommendations/analytics-sms-conversion.md) |
| `agentSalesReport.service.ts` | recommended → [recommendations/analytics-agent-sales-report.md](recommendations/analytics-agent-sales-report.md) |
| `leadCost.service.ts` | recommended → [recommendations/analytics-lead-cost.md](recommendations/analytics-lead-cost.md) |
| `analyticsExport.service.ts` | recommended → [recommendations/analytics-analytics-export.md](recommendations/analytics-analytics-export.md) |
| `analyticsFilters.ts` | |
| `analyticsMerge.ts` | |
| `sourceHierarchy.ts` | |
| `index.ts` | skip — barrel |

### 27. `observability` — large — unvisited

`src/services/observability/`

### 28. `reporting` — large — unvisited

`src/services/reporting/`

### 29. `ingestion` — medium — unvisited

`src/services/ingestion/`

### 30. `bestRelocationSheetIngest` — medium — unvisited

`src/services/bestRelocationSheetIngest/`

### 31. `employeeBookings` — medium — unvisited

`src/services/employeeBookings/`

### 32. `domainCommands` — large — unvisited

`src/services/domainCommands/`

### 33. `durableWork` — small — unvisited

`src/services/durableWork/`

### 34. `historicalConsolidation` — small — unvisited

`src/services/historicalConsolidation/`

### 35. `testimonials` — small — unvisited

`src/services/testimonials/`

### 36. `movingCarriers` — small — unvisited

`src/services/movingCarriers/`

### 37. `errors` — small — unvisited

`src/services/errors/`

### 38. `legacy-root` — medium — unvisited

Leftover files on `src/services/` itself: `v1.service.ts`, `v1ServiceError.ts`, and compatibility barrels (`formLeadSearch.service.ts`, `callLeadSearch.service.ts`, `crm.service.ts`, `googleSheets.service.ts`, `callLeadEnrichment.service.ts`, `bookedCallLeadReconciliation.service.ts`). Enumerate; most should skip as facades. Visit last in Wave A.

## Wave B — locked

Do not open until every Wave A service is `visited`.

- `src/routes/`
- `src/models/`
- `src/validation/`
- `src/config/domain/`
- `src/middleware/`
- `src/auth/`
