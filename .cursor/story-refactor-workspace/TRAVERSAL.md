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
- Services visited / in-progress / unvisited: **40 / 1 / 1**
- Recommendations on disk: **308** (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`, `bookings-leadless-booking.md`, `bookings-booking-mirror.md`, `bookings-booking-source-resolver.md`, `bookings-booking-identity.md`, `cancellations-cancelled-lead.md`, `cancellations-cancellation-resolver.md`, `cancellations-cancellation-mirror.md`, `customers-customer.md`, `customers-customer-from-lead.md`, `agents-agent-allocation.md`, `agents-receiver-agent-crm-username.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, `search-form-lead-search.md`, `search-form-lead-browse.md`, `search-call-lead-search.md`, `search-call-lead-browse.md`, `enrichment-call-lead-enrichment.md`, `enrichment-call-lead-enrichment-rows.md`, `reconciliation-booked-call-lead.md`, `reconciliation-booked-call-lead-rows.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`, `granot-lifecycle-source-policy.md`, `granot-lifecycle-identity.md`, `granot-lifecycle-granot-temporal.md`, `granot-lifecycle-lead-desired-state.md`, `granot-lifecycle-authorized-desired-state.md`, `granot-lifecycle-lead-contact-projection.md`, `granot-lifecycle-processor.md`, `granot-lifecycle-operations.md`, `granot-lifecycle-projections.md`, `granot-lifecycle-creating-observation.md`, `granot-lifecycle-drainer.md`, `granot-lifecycle-aggregate-revision.md`, `granot-lifecycle-trusted-lead-create-validation.md`, `granot-lifecycle-synchronize-lead-from-granot.md`, `granot-lifecycle-create-lead-from-granot.md`, `granot-lifecycle-booking-reconciliation.md`, `granot-lifecycle-booking-confirmation.md`, `granot-lifecycle-booking-owner-commands.md`, `granot-lifecycle-booking-priority-pairing.md`, `granot-lifecycle-referral-booking.md`, `granot-lifecycle-release-reconciliation.md`, `granot-lifecycle-release-owner-commands.md`, `granot-lifecycle-discrepancies.md`, `granot-lifecycle-discrepancy-owner-commands.md`, `granot-lifecycle-discrepancy-projections.md`, `granot-lifecycle-observability.md`, `granot-lifecycle-metrics.md`, `granot-lifecycle-alerts.md`, `granot-http-collector-index.md`, `granot-http-collector-automation.md`, `granot-http-collector-source-catalog.md`, `granot-http-collector-form-workflow.md`, `granot-http-collector-form-lead-matcher.md`, `granot-http-collector-lifecycle-statement.md`, `granot-http-collector-run-workflow.md`, `granot-crm-csv-upload.md`, `granot-crm-csv-sync.md`, `granot-crm-csv-registry.md`, `granot-crm-csv-parser.md`, `crm-crm-service.md`, `crm-form-lead-payload.md`, `lead-messaging-lead-messaging.md`, `lead-messaging-granot-created-lead.md`, `lead-messaging-lead-messaging-queue.md`, `lead-messaging-twilio-adapter.md`, `sheet-sync-coordinator.md`, `sheet-sync-outbox.md`, `sheet-sync-queue.md`, `sheet-sync-persistence.md`, `sheet-sync-source-lookup.md`, `sheet-sync-run-sheet-sync-drain.md`, `sheet-sync-job-planner.md`, `sheet-sync-batch-writer.md`, `sheet-sync-tab-row-map.md`, `sheet-sync-quota-limiter.md`, `google-sheets-google-sheets.md`, `google-sheets-targets.md`, `google-sheets-tabs.md`, `google-sheets-sync-rows.md`, `google-sheets-row-lookup.md`, `google-sheets-delete-rows.md`, `google-sheets-retry.md`, `google-sheets-form-lead-row.md`, `google-sheets-call-lead-row.md`, `google-sheets-booked-lead-row.md`, `google-sheets-cancelled-lead-row.md`, `google-auth-service-account.md`, `google-drive-oauth-google-drive-oauth.md`, `google-drive-oauth-token-encryption.md`, `google-drive-oauth-oauth-scopes.md`, `google-drive-oauth-oauth-security.md`, `google-drive-oauth-owner-auth.md`, `google-drive-oauth-spreadsheet.md`, `google-drive-oauth-picker.md`, `google-drive-oauth-picker-nonce-store.md`, `google-drive-oauth-picker-selection-store.md`, `google-drive-oauth-drive-metadata.md`, `google-drive-oauth-managed-tab.md`, `google-maps-geocoding.md`, `operational-workbooks-registry.md`, `ringcentral-call-candidate-evaluator.md`, `ringcentral-call-candidate-store.md`, `ringcentral-call-session-aggregator.md`, `ringcentral-call-session-store.md`, `ringcentral-webhook-capture.md`, `ringcentral-webhook-subscriptions.md`, `ringcentral-call-lead-ingest.md`, `ringcentral-duplicate-guard.md`, `ringcentral-call-lead-convergence.md`, `ringcentral-shadow-call-leads-store.md`, `ringcentral-processed-calls-store.md`, `ringcentral-call-log-sync.md`, `ringcentral-call-log-sync-state-store.md`, `ringcentral-call-log-vetting.md`, `ringcentral-analytics-reconcile.md`, `ringcentral-auth.md`, `operations-registry-catalog-registry.md`, `operations-registry-source-registry.md`, `operations-registry-source-resolution.md`, `operations-registry-cpl-schedule.md`, `operations-registry-cpl-corrections.md`, `operations-registry-ring-central-registry.md`, `operations-registry-ring-central-snapshot.md`, `operations-registry-ring-central-validation.md`, `operations-registry-granot-crm-sources.md`, `operations-registry-crm-source-outbound-sms.md`, `operations-registry-granot-crm-source-projections.md`, `operations-registry-granot-automation-sources.md`, `operations-registry-trusted-actor.md`, `operations-registry-registry-audit.md`, `operations-registry-runtime-telemetry.md`, `operations-registry-queries-overview.md`, `operations-registry-queries-health.md`, `operations-registry-queries-changes.md`, `operations-registry-label-mappings.md`, `operations-registry-owner-granot-names.md`, `operations-registry-lead-source-setup.md`, `operations-registry-queries-lead-source-projection.md`, `admin-browse.md`, `admin-export.md`, `admin-search.md`, `admin-facets.md`, `admin-filter-catalog.md`, `admin-agent-browse-metrics.md`, `admin-sheet-sync.md`, `analytics-analytics.md`, `analytics-overview.md`, `analytics-summary.md`, `analytics-revenue-trend.md`, `analytics-source-performance.md`, `analytics-agent-performance.md`, `analytics-cancellation-analytics.md`, `analytics-geographic-analytics.md`, `analytics-receiver-agent-performance.md`, `analytics-sms-conversion.md`, `analytics-agent-sales-report.md`, `analytics-lead-cost.md`, `analytics-analytics-export.md`, `analytics-analytics-filters.md`, `analytics-analytics-merge.md`, `analytics-source-hierarchy.md`, `observability-record-operational-event.md`, `observability-email-notification.md`, `observability-notification-policy.md`, `observability-operational-incident.md`, `observability-admin-observability.md`, `observability-operational-reports.md`, `observability-notification-digest.md`, `reporting-reporting.md`, `reporting-timezone.md`, `reporting-destination-contract.md`, `reporting-destination-lineage.md`, `reporting-destination-identity.md`, `reporting-destination.md`, `reporting-destination-repository.md`, `reporting-canonical-reporting.md`, `reporting-reporting-worker.md`, `reporting-delivery-engine.md`, `reporting-execution-stream.md`, `reporting-queue.md`, `reporting-run-repository.md`, `reporting-delivery-repository.md`, `reporting-manifest-repository.md`, `reporting-manifest-page-adapter.md`, `reporting-promotion.md`, `reporting-promotion-reservation.md`, `reporting-snapshot-adapter.md`, `reporting-reporting-observability.md`, `reporting-cleanup.md`, `reporting-ownership-marker.md`, `reporting-registry-filters.md`, `reporting-cell-serialization.md`, `reporting-run-marker.md`, `reporting-drive-app-properties.md`, `reporting-provider-failures.md`, `reporting-reporting-sheets-adapter.md`, `reporting-reporting-drive-adapter.md`, `reporting-live-google-orchestration.md`, `reporting-live-test-run-factory.md`, `reporting-live-test-security.md`, `reporting-live-test-oauth-adapters.md`, `reporting-live-test-cleanup.md`, `reporting-live-test-denylist-proof.md`, `reporting-live-picker-contract-runner.md`, `reporting-live-test-harness-run-registry.md`, `reporting-synthetic-live-test-manifest.md`, `reporting-synthetic-manifest-page-adapter.md`, `reporting-transient-retry-wrapper.md`, `reporting-pii-safe-evidence.md`, `reporting-test-artifact-janitor.md`, `reporting-janitor-completion.md`, `ingestion-worker.md`, `ingestion-apply-plan.md`, `ingestion-repository.md`, `ingestion-health.md`, `ingestion-queue.md`, `best-relocation-sheet-ingest-sheets.md`, `best-relocation-sheet-ingest-parsing.md`, `best-relocation-sheet-ingest-matching.md`, `best-relocation-sheet-ingest-plan.md`, `best-relocation-sheet-ingest-application-plan.md`, `best-relocation-sheet-ingest-provider.md`, `best-relocation-sheet-ingest-identity.md`, `best-relocation-sheet-ingest-source-change-policy.md`, `best-relocation-sheet-ingest-canonical-lead-adoption.md`, `best-relocation-sheet-ingest-bootstrap.md`, `best-relocation-sheet-ingest-update-policy.md`, `best-relocation-sheet-ingest-apply.md`, `best-relocation-sheet-ingest-dry-run.md`, `best-relocation-sheet-ingest-dry-run-reports.md`, `employee-bookings-submit-employee-booking.md`, `employee-bookings-lead-candidate-queries.md`, `employee-bookings-lead-match-evaluator.md`, `employee-bookings-booking-lead-reconciliation.md`, `employee-bookings-booking-lead-attachment.md`, `employee-bookings-reconciliation-policy.md`, `employee-bookings-reconciliation-rematch.md`, `employee-bookings-migration-preflight.md`, `employee-bookings-migration-apply-safety.md`, `domain-commands-idempotency.md`, `domain-commands-command-context.md`, `domain-commands-ringcentral-provenance.md`, `domain-commands-entity-change.md`, `domain-commands-existing-write-context.md`, `domain-commands-existing-writes.md`, `domain-commands-bookings.md`, `durable-work-leases.md`, `durable-work-checksum.md`, `durable-work-actors.md`, `durable-work-checkpoints.md`, `durable-work-capability.md`, `durable-work-schema.md`, `durable-work-provider-retry.md`, `durable-work-run-transitions.md`, `durable-work-testing.md`, `historical-consolidation-classification.md`, `historical-consolidation-planner.md`, `historical-consolidation-manifest.md`, `historical-consolidation-apply.md`, `historical-consolidation-verify.md`, `historical-consolidation-rollback.md`, `historical-consolidation-migration-context.md`, `historical-consolidation-target-guard.md`, `historical-consolidation-operational-lock.md`, `historical-consolidation-schema-validation.md`, `historical-consolidation-normalization.md`, `historical-consolidation-date-parsing.md`, `historical-consolidation-stable-json.md`, `historical-consolidation-mongo-values.md`, `testimonials-testimonial.md`, `testimonials-testimonial-helpers.md`, `moving-carriers-moving-carrier.md`, `moving-carriers-granot-carrier-code-seed.md`, `conversations-reads.md`, `conversations-redaction.md`, `conversations-media.md`, `conversations-seed-from-artifacts.md`, `extension-users-extension-users.md`, `job-number-timeline-assemble.md`, `job-number-timeline-projector.md`, `job-number-timeline-clocks.md`, `job-number-timeline-evidence.md`, `job-number-timeline-outcome.md`, `job-number-timeline-attention.md`, `job-number-timeline-mongo-evidence-loader.md`)
- Current service: `jobNumberTimeline` (in-progress)
- Next module: `recent-official-bookings.ts`
- Last session: `story-job-number-timeline-mongo-evidence-loader-2026-09-11T0722Z`

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

### 26. `analytics` — large — **visited**

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
| `analyticsFilters.ts` | recommended → [recommendations/analytics-analytics-filters.md](recommendations/analytics-analytics-filters.md) |
| `analyticsMerge.ts` | recommended → [recommendations/analytics-analytics-merge.md](recommendations/analytics-analytics-merge.md) |
| `sourceHierarchy.ts` | recommended → [recommendations/analytics-source-hierarchy.md](recommendations/analytics-source-hierarchy.md) |
| `index.ts` | skip — barrel |

### 27. `observability` — large — **visited**

Folder: `src/services/observability/` — Operational Events, Incidents, email, Admin desk, reports. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `recordOperationalEvent.ts` | recommended → [recommendations/observability-record-operational-event.md](recommendations/observability-record-operational-event.md) |
| `testObservabilitySink.ts` | skip — test sink |
| `emailNotification.service.ts` | recommended → [recommendations/observability-email-notification.md](recommendations/observability-email-notification.md) |
| `notificationPolicy.ts` | recommended → [recommendations/observability-notification-policy.md](recommendations/observability-notification-policy.md) |
| `operationalIncident.service.ts` | recommended → [recommendations/observability-operational-incident.md](recommendations/observability-operational-incident.md) |
| `operationalEventSanitizer.ts` | skip — details bound |
| `leadIdentity.ts` | skip — identity fold |
| `requestEventContext.ts` | skip — request fold |
| `fingerprint.ts` | skip — hash helper |
| `adminObservability.service.ts` | recommended → [recommendations/observability-admin-observability.md](recommendations/observability-admin-observability.md) |
| `operationalReports.service.ts` | recommended → [recommendations/observability-operational-reports.md](recommendations/observability-operational-reports.md) |
| `notificationDigest.service.ts` | recommended → [recommendations/observability-notification-digest.md](recommendations/observability-notification-digest.md) |
| `index.ts` | skip — barrel |

### 28. `reporting` — large — **visited**

Folder: `src/services/reporting/` — Owner-designed checksum-bound reports, destinations, worker write, live harness. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `catalog/types.ts` | skip — type-only |
| `catalog/index.ts` | skip — dataset catalog |
| `reporting.service.ts` | recommended → [recommendations/reporting-reporting.md](recommendations/reporting-reporting.md) |
| `timezone.ts` | recommended → [recommendations/reporting-timezone.md](recommendations/reporting-timezone.md) |
| `destinationContract.ts` | recommended → [recommendations/reporting-destination-contract.md](recommendations/reporting-destination-contract.md) |
| `destinationLineage.ts` | recommended → [recommendations/reporting-destination-lineage.md](recommendations/reporting-destination-lineage.md) |
| `destinationIdentity.ts` | recommended → [recommendations/reporting-destination-identity.md](recommendations/reporting-destination-identity.md) |
| `reportingDestination.service.ts` | recommended → [recommendations/reporting-destination.md](recommendations/reporting-destination.md) |
| `reportingDestinationRepository.ts` | recommended → [recommendations/reporting-destination-repository.md](recommendations/reporting-destination-repository.md) |
| `reportingDestinationPort.adapter.ts` | skip — one-line facade |
| `query/canonicalReporting.ts` | recommended → [recommendations/reporting-canonical-reporting.md](recommendations/reporting-canonical-reporting.md) |
| `query/pagination.ts` | skip — cursor helper |
| `reportingWorker.ts` | recommended → [recommendations/reporting-reporting-worker.md](recommendations/reporting-reporting-worker.md) |
| `deliveryEngine.ts` | recommended → [recommendations/reporting-delivery-engine.md](recommendations/reporting-delivery-engine.md) |
| `executionStream.ts` | recommended → [recommendations/reporting-execution-stream.md](recommendations/reporting-execution-stream.md) |
| `queue.ts` | recommended → [recommendations/reporting-queue.md](recommendations/reporting-queue.md) |
| `reportingRunRepository.ts` | recommended → [recommendations/reporting-run-repository.md](recommendations/reporting-run-repository.md) |
| `reportingDeliveryRepository.ts` | recommended → [recommendations/reporting-delivery-repository.md](recommendations/reporting-delivery-repository.md) |
| `reportingManifestRepository.ts` | recommended → [recommendations/reporting-manifest-repository.md](recommendations/reporting-manifest-repository.md) |
| `manifestPageAdapter.ts` | recommended → [recommendations/reporting-manifest-page-adapter.md](recommendations/reporting-manifest-page-adapter.md) |
| `promotion.ts` | recommended → [recommendations/reporting-promotion.md](recommendations/reporting-promotion.md) |
| `promotionReservation.ts` | recommended → [recommendations/reporting-promotion-reservation.md](recommendations/reporting-promotion-reservation.md) |
| `snapshotAdapter.ts` | recommended → [recommendations/reporting-snapshot-adapter.md](recommendations/reporting-snapshot-adapter.md) |
| `reportingAudit.ts` | skip — audit fold |
| `reportingObservability.ts` | recommended → [recommendations/reporting-reporting-observability.md](recommendations/reporting-reporting-observability.md) |
| `cleanup.ts` | recommended → [recommendations/reporting-cleanup.md](recommendations/reporting-cleanup.md) |
| `ownershipMarker.ts` | recommended → [recommendations/reporting-ownership-marker.md](recommendations/reporting-ownership-marker.md) |
| `registryFilters.ts` | recommended → [recommendations/reporting-registry-filters.md](recommendations/reporting-registry-filters.md) |
| `registerStage4Foundation.ts` | skip — bootstrap hook |
| `google/index.ts` | skip — barrel |
| `google/fakeReportingGoogle.ts` | skip — test fake |
| `google/cellSerialization.ts` | recommended → [recommendations/reporting-cell-serialization.md](recommendations/reporting-cell-serialization.md) |
| `google/runMarker.ts` | recommended → [recommendations/reporting-run-marker.md](recommendations/reporting-run-marker.md) |
| `google/driveAppProperties.ts` | recommended → [recommendations/reporting-drive-app-properties.md](recommendations/reporting-drive-app-properties.md) |
| `google/providerFailures.ts` | recommended → [recommendations/reporting-provider-failures.md](recommendations/reporting-provider-failures.md) |
| `google/reportingSheetsAdapter.ts` | recommended → [recommendations/reporting-reporting-sheets-adapter.md](recommendations/reporting-reporting-sheets-adapter.md) |
| `google/reportingDriveAdapter.ts` | recommended → [recommendations/reporting-reporting-drive-adapter.md](recommendations/reporting-reporting-drive-adapter.md) |
| `live/liveGoogleHarness.ts` | skip — one-line facade |
| `live/liveGoogleOrchestration.ts` | recommended → [recommendations/reporting-live-google-orchestration.md](recommendations/reporting-live-google-orchestration.md) |
| `live/liveTestRunFactory.ts` | recommended → [recommendations/reporting-live-test-run-factory.md](recommendations/reporting-live-test-run-factory.md) |
| `live/liveTestWorkerHooks.ts` | skip — inject counter |
| `live/liveTestSecurity.ts` | recommended → [recommendations/reporting-live-test-security.md](recommendations/reporting-live-test-security.md) |
| `live/liveTestOAuthAdapters.ts` | recommended → [recommendations/reporting-live-test-oauth-adapters.md](recommendations/reporting-live-test-oauth-adapters.md) |
| `live/liveTestCleanup.ts` | recommended → [recommendations/reporting-live-test-cleanup.md](recommendations/reporting-live-test-cleanup.md) |
| `live/liveTestEnv.ts` | skip — env pin |
| `live/liveTestDenylistProof.ts` | recommended → [recommendations/reporting-live-test-denylist-proof.md](recommendations/reporting-live-test-denylist-proof.md) |
| `live/livePickerContractRunner.ts` | recommended → [recommendations/reporting-live-picker-contract-runner.md](recommendations/reporting-live-picker-contract-runner.md) |
| `live/liveTestHarnessRunRegistry.ts` | recommended → [recommendations/reporting-live-test-harness-run-registry.md](recommendations/reporting-live-test-harness-run-registry.md) |
| `live/syntheticLiveTestManifest.ts` | recommended → [recommendations/reporting-synthetic-live-test-manifest.md](recommendations/reporting-synthetic-live-test-manifest.md) |
| `live/syntheticManifestPageAdapter.ts` | recommended → [recommendations/reporting-synthetic-manifest-page-adapter.md](recommendations/reporting-synthetic-manifest-page-adapter.md) |
| `live/transientRetryWrapper.ts` | recommended → [recommendations/reporting-transient-retry-wrapper.md](recommendations/reporting-transient-retry-wrapper.md) |
| `live/piiSafeEvidence.ts` | recommended → [recommendations/reporting-pii-safe-evidence.md](recommendations/reporting-pii-safe-evidence.md) |
| `live/testArtifactJanitor.ts` | recommended → [recommendations/reporting-test-artifact-janitor.md](recommendations/reporting-test-artifact-janitor.md) |
| `live/janitorCompletion.ts` | recommended → [recommendations/reporting-janitor-completion.md](recommendations/reporting-janitor-completion.md) |

### 29. `ingestion` — medium — **visited**

Folder: `src/services/ingestion/` — Fenced Best Relocation inspect / plan / apply through canonical commands. Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `index.ts` | skip — barrel |
| `worker.ts` | recommended → [recommendations/ingestion-worker.md](recommendations/ingestion-worker.md) |
| `applyPlan.ts` | recommended → [recommendations/ingestion-apply-plan.md](recommendations/ingestion-apply-plan.md) |
| `repository.ts` | recommended → [recommendations/ingestion-repository.md](recommendations/ingestion-repository.md) |
| `health.ts` | recommended → [recommendations/ingestion-health.md](recommendations/ingestion-health.md) |
| `queue.ts` | recommended → [recommendations/ingestion-queue.md](recommendations/ingestion-queue.md) |

### 30. `bestRelocationSheetIngest` — medium — **visited**

Folder: `src/services/bestRelocationSheetIngest/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `index.ts` | skip — barrel |
| `adapter.ts` | skip — thin facade |
| `sheets.ts` | recommended → [recommendations/best-relocation-sheet-ingest-sheets.md](recommendations/best-relocation-sheet-ingest-sheets.md) |
| `parsing.ts` | recommended → [recommendations/best-relocation-sheet-ingest-parsing.md](recommendations/best-relocation-sheet-ingest-parsing.md) |
| `matching.ts` | recommended → [recommendations/best-relocation-sheet-ingest-matching.md](recommendations/best-relocation-sheet-ingest-matching.md) |
| `plan.ts` | recommended → [recommendations/best-relocation-sheet-ingest-plan.md](recommendations/best-relocation-sheet-ingest-plan.md) |
| `applicationPlan.ts` | recommended → [recommendations/best-relocation-sheet-ingest-application-plan.md](recommendations/best-relocation-sheet-ingest-application-plan.md) |
| `provider.ts` | recommended → [recommendations/best-relocation-sheet-ingest-provider.md](recommendations/best-relocation-sheet-ingest-provider.md) |
| `identity.ts` | recommended → [recommendations/best-relocation-sheet-ingest-identity.md](recommendations/best-relocation-sheet-ingest-identity.md) |
| `sourceChangePolicy.ts` | recommended → [recommendations/best-relocation-sheet-ingest-source-change-policy.md](recommendations/best-relocation-sheet-ingest-source-change-policy.md) |
| `canonicalLeadAdoption.ts` | recommended → [recommendations/best-relocation-sheet-ingest-canonical-lead-adoption.md](recommendations/best-relocation-sheet-ingest-canonical-lead-adoption.md) |
| `bootstrap.ts` | recommended → [recommendations/best-relocation-sheet-ingest-bootstrap.md](recommendations/best-relocation-sheet-ingest-bootstrap.md) |
| `updatePolicy.ts` | recommended → [recommendations/best-relocation-sheet-ingest-update-policy.md](recommendations/best-relocation-sheet-ingest-update-policy.md) |
| `apply.ts` | recommended → [recommendations/best-relocation-sheet-ingest-apply.md](recommendations/best-relocation-sheet-ingest-apply.md) |
| `dryRun.ts` | recommended → [recommendations/best-relocation-sheet-ingest-dry-run.md](recommendations/best-relocation-sheet-ingest-dry-run.md) |
| `dryRunReports.ts` | recommended → [recommendations/best-relocation-sheet-ingest-dry-run-reports.md](recommendations/best-relocation-sheet-ingest-dry-run-reports.md) |

### 31. `employeeBookings` — medium — **visited**

Folder: `src/services/employeeBookings/` — several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `index.ts` | skip — barrel |
| `getEmployeeBookingOptions.service.ts` | skip — options catalog |
| `employeeBookingPreparation.ts` | skip — prepare helper |
| `submitEmployeeBooking.service.ts` | recommended → [recommendations/employee-bookings-submit-employee-booking.md](recommendations/employee-bookings-submit-employee-booking.md) |
| `leadCandidateQueries.ts` | recommended → [recommendations/employee-bookings-lead-candidate-queries.md](recommendations/employee-bookings-lead-candidate-queries.md) |
| `leadMatchEvaluator.ts` | recommended → [recommendations/employee-bookings-lead-match-evaluator.md](recommendations/employee-bookings-lead-match-evaluator.md) |
| `bookingLeadReconciliation.service.ts` | recommended → [recommendations/employee-bookings-booking-lead-reconciliation.md](recommendations/employee-bookings-booking-lead-reconciliation.md) |
| `bookingLeadAttachment.service.ts` | recommended → [recommendations/employee-bookings-booking-lead-attachment.md](recommendations/employee-bookings-booking-lead-attachment.md) |
| `reconciliationPolicy.ts` | recommended → [recommendations/employee-bookings-reconciliation-policy.md](recommendations/employee-bookings-reconciliation-policy.md) |
| `reconciliationRematch.service.ts` | recommended → [recommendations/employee-bookings-reconciliation-rematch.md](recommendations/employee-bookings-reconciliation-rematch.md) |
| `migrationPreflight.ts` | recommended → [recommendations/employee-bookings-migration-preflight.md](recommendations/employee-bookings-migration-preflight.md) |
| `migrationApplySafety.ts` | recommended → [recommendations/employee-bookings-migration-apply-safety.md](recommendations/employee-bookings-migration-apply-safety.md) |

### 32. `domainCommands` — large — **visited**

Folder: `src/services/domainCommands/` — many passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — types plus errors |
| `index.ts` | skip — barrel |
| `idempotency.ts` | recommended → [recommendations/domain-commands-idempotency.md](recommendations/domain-commands-idempotency.md) |
| `commandContext.ts` | recommended → [recommendations/domain-commands-command-context.md](recommendations/domain-commands-command-context.md) |
| `ringcentralProvenance.ts` | recommended → [recommendations/domain-commands-ringcentral-provenance.md](recommendations/domain-commands-ringcentral-provenance.md) |
| `entityChange.ts` | recommended → [recommendations/domain-commands-entity-change.md](recommendations/domain-commands-entity-change.md) |
| `existingWriteContext.ts` | recommended → [recommendations/domain-commands-existing-write-context.md](recommendations/domain-commands-existing-write-context.md) |
| `existingWrites.ts` | recommended → [recommendations/domain-commands-existing-writes.md](recommendations/domain-commands-existing-writes.md) |
| `leads.ts` | skip — thin facade |
| `bookings.ts` | recommended → [recommendations/domain-commands-bookings.md](recommendations/domain-commands-bookings.md) |
| `cancellations.ts` | skip — thin facade |
| `reconciliation.ts` | skip — one-line re-export |

### 33. `durableWork` — small — **visited**

Folder: `src/services/durableWork/`

| Module | Verdict |
| --- | --- |
| `leases.ts` | recommended → [recommendations/durable-work-leases.md](recommendations/durable-work-leases.md) |
| `checksum.ts` | recommended → [recommendations/durable-work-checksum.md](recommendations/durable-work-checksum.md) |
| `actors.ts` | recommended → [recommendations/durable-work-actors.md](recommendations/durable-work-actors.md) |
| `checkpoints.ts` | recommended → [recommendations/durable-work-checkpoints.md](recommendations/durable-work-checkpoints.md) |
| `capability.ts` | recommended → [recommendations/durable-work-capability.md](recommendations/durable-work-capability.md) |
| `schema.ts` | recommended → [recommendations/durable-work-schema.md](recommendations/durable-work-schema.md) |
| `providerRetry.ts` | recommended → [recommendations/durable-work-provider-retry.md](recommendations/durable-work-provider-retry.md) |
| `runTransitions.ts` | recommended → [recommendations/durable-work-run-transitions.md](recommendations/durable-work-run-transitions.md) |
| `testing.ts` | recommended → [recommendations/durable-work-testing.md](recommendations/durable-work-testing.md) |
| `types.ts` | skip — types |
| `index.ts` | skip — barrel |

### 34. `historicalConsolidation` — small — **visited**

Folder: `src/services/historicalConsolidation/`

| Module | Verdict |
| --- | --- |
| `classification.ts` | recommended → [recommendations/historical-consolidation-classification.md](recommendations/historical-consolidation-classification.md) |
| `planner.ts` | recommended → [recommendations/historical-consolidation-planner.md](recommendations/historical-consolidation-planner.md) |
| `manifest.ts` | recommended → [recommendations/historical-consolidation-manifest.md](recommendations/historical-consolidation-manifest.md) |
| `apply.ts` | recommended → [recommendations/historical-consolidation-apply.md](recommendations/historical-consolidation-apply.md) |
| `verify.ts` | recommended → [recommendations/historical-consolidation-verify.md](recommendations/historical-consolidation-verify.md) |
| `rollback.ts` | recommended → [recommendations/historical-consolidation-rollback.md](recommendations/historical-consolidation-rollback.md) |
| `migrationContext.ts` | recommended → [recommendations/historical-consolidation-migration-context.md](recommendations/historical-consolidation-migration-context.md) |
| `targetGuard.ts` | recommended → [recommendations/historical-consolidation-target-guard.md](recommendations/historical-consolidation-target-guard.md) |
| `operationalLock.ts` | recommended → [recommendations/historical-consolidation-operational-lock.md](recommendations/historical-consolidation-operational-lock.md) |
| `schemaValidation.ts` | recommended → [recommendations/historical-consolidation-schema-validation.md](recommendations/historical-consolidation-schema-validation.md) |
| `normalization.ts` | recommended → [recommendations/historical-consolidation-normalization.md](recommendations/historical-consolidation-normalization.md) |
| `dateParsing.ts` | recommended → [recommendations/historical-consolidation-date-parsing.md](recommendations/historical-consolidation-date-parsing.md) |
| `stableJson.ts` | recommended → [recommendations/historical-consolidation-stable-json.md](recommendations/historical-consolidation-stable-json.md) |
| `mongoValues.ts` | recommended → [recommendations/historical-consolidation-mongo-values.md](recommendations/historical-consolidation-mongo-values.md) |
| `types.ts` | skip — types |
| `index.ts` | skip — barrel |

### 35. `testimonials` — small — **visited**

Folder: `src/services/testimonials/`

| Module | Verdict |
| --- | --- |
| `testimonial.service.ts` | recommended → [recommendations/testimonials-testimonial.md](recommendations/testimonials-testimonial.md) |
| `testimonial.helpers.ts` | recommended → [recommendations/testimonials-testimonial-helpers.md](recommendations/testimonials-testimonial-helpers.md) |
| `index.ts` | skip — barrel |

### 36. `movingCarriers` — small — **visited**

Folder: `src/services/movingCarriers/`

| Module | Verdict |
| --- | --- |
| `movingCarrier.service.ts` | recommended → [recommendations/moving-carriers-moving-carrier.md](recommendations/moving-carriers-moving-carrier.md) |
| `granotCarrierCodeSeed.ts` | recommended → [recommendations/moving-carriers-granot-carrier-code-seed.md](recommendations/moving-carriers-granot-carrier-code-seed.md) |
| `index.ts` | skip — barrel |

### 37. `errors` — small — **visited**

Folder: `src/services/errors/`

| Module | Verdict |
| --- | --- |
| `AppError.ts` | skip — error class |
| `serviceErrors.ts` | skip — HTTP subclasses |
| `errorCodes.ts` | skip — code constants |
| `registryErrorCodes.ts` | skip — registry codes |
| `index.ts` | skip — barrel |

Thin-folder skip. No recommendation file. `AppError` plus seven HTTP subclasses stamp a public message, a stable `code`, and a status; `toLog()` collapses log-only fields. That is not ingest / correct / post / sync / book / cancel / reconcile / drain / claim. Leftover `v1ServiceError.ts` stays on `legacy-root`.

### 38. `legacy-root` — medium — **visited**

Leftover files on `src/services/` itself (not a folder). Tests `v1.service.test.ts` / `v1ServiceError.test.ts` are evidence, not checklist rows.

| Module | Verdict |
| --- | --- |
| `v1.service.ts` | skip — facade |
| `v1ServiceError.ts` | skip — leftover error |
| `formLeadSearch.service.ts` | skip — facade |
| `callLeadSearch.service.ts` | skip — facade |
| `crm.service.ts` | skip — facade |
| `googleSheets.service.ts` | skip — facade |
| `callLeadEnrichment.service.ts` | skip — facade |
| `bookedCallLeadReconciliation.service.ts` | skip — facade |

Thin leftover-root skip. No recommendation file. The v1 barrel re-exports leads / bookings / cancellations / customers / sheet-sync plus leftover `V1ServiceError`. The other six files re-export already-visited search / CRM / sheets / enrichment / reconciliation folders. That is not ingest / correct / post / sync / book / cancel / reconcile / drain / claim.

### 39. `conversations` — medium — **visited**

Folder: `src/services/conversations/` — parked after listed Wave A (rows 1–38). Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `reads.ts` | recommended → [recommendations/conversations-reads.md](recommendations/conversations-reads.md) |
| `redaction.ts` | recommended → [recommendations/conversations-redaction.md](recommendations/conversations-redaction.md) |
| `media.ts` | recommended → [recommendations/conversations-media.md](recommendations/conversations-media.md) |
| `seedFromArtifacts.ts` | recommended → [recommendations/conversations-seed-from-artifacts.md](recommendations/conversations-seed-from-artifacts.md) |
| `index.ts` | skip — barrel |

### 40. `extensionUsers` — small — **visited**

Folder: `src/services/extensionUsers/` — parked after listed Wave A (rows 1–38). Thin folder: one story-worthy module plus a barrel.

| Module | Verdict |
| --- | --- |
| `extensionUsers.service.ts` | recommended → [recommendations/extension-users-extension-users.md](recommendations/extension-users-extension-users.md) |
| `index.ts` | skip — barrel |

### 41. `jobNumberTimeline` — large — **in-progress**

Folder: `src/services/jobNumberTimeline/` — parked after listed Wave A (rows 1–38). Several passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `rows.ts` | skip — row types |
| `evidence-loader.port.ts` | skip — loader port |
| `normalize.ts` | skip — identity wrap |
| `fixtures.ts` | skip — test fixtures |
| `golden-pages.ts` | skip — test fixtures |
| `index.ts` | skip — barrel |
| `masking.ts` | skip — redact helpers |
| `memory-evidence-loader.ts` | skip — test adapter |
| `module.ts` | skip — thin facade |
| `assemble.ts` | recommended → [recommendations/job-number-timeline-assemble.md](recommendations/job-number-timeline-assemble.md) |
| `projector.ts` | recommended → [recommendations/job-number-timeline-projector.md](recommendations/job-number-timeline-projector.md) |
| `clocks.ts` | recommended → [recommendations/job-number-timeline-clocks.md](recommendations/job-number-timeline-clocks.md) |
| `evidence.ts` | recommended → [recommendations/job-number-timeline-evidence.md](recommendations/job-number-timeline-evidence.md) |
| `outcome.ts` | recommended → [recommendations/job-number-timeline-outcome.md](recommendations/job-number-timeline-outcome.md) |
| `attention.ts` | recommended → [recommendations/job-number-timeline-attention.md](recommendations/job-number-timeline-attention.md) |
| `mongo-evidence-loader.ts` | recommended → [recommendations/job-number-timeline-mongo-evidence-loader.md](recommendations/job-number-timeline-mongo-evidence-loader.md) |
| `recent-official-bookings.ts` | |

### 42. `tariff` — small — unvisited

`src/services/tariff/` — parked after listed Wave A (rows 1–38). Enumerate before Wave B.

## Wave B — locked

Do not open until every Wave A service is `visited`.

- `src/routes/`
- `src/models/`
- `src/validation/`
- `src/config/domain/`
- `src/middleware/`
- `src/auth/`
