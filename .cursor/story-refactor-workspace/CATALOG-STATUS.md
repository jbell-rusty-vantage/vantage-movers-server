# Current recommendation catalog

- Latest review: owner-requested second source pass, 2026-10-29, against this checkout.
- Rules: [DIRECTIVE.md](DIRECTIVE.md). Latest report: [SECOND-PASS-2026-10-29.md](SECOND-PASS-2026-10-29.md).

All **338 active briefs** received a second source review: **217 corrected or clarified**, **121 checked without further correction**. All **56 prior removals** were rechecked and retained.

The original catalog had 394 briefs. The first pass removed 56 and refreshed or retained the remaining 338. The labels below reflect the **second pass**, rather than reusing the first-pass triage as source proof. Corrected/clarified includes restored guidance, inventories and editorial repairs; it is not a runtime-bug count. Checked does not mean tests passed or an implementation was qualified.

## Start an implementation when requested

[Duplicate Lead](recommendations/leads-duplicate-lead.md) remains first: distinguish Duplicate Form classification from Form Fill. Form Lead and Call Lead story names already exist; do not repeat their rename. Review the selected target, actual callers and delegated effects before deciding the implementation.

Do not resume `TRAVERSAL.md` or revive removed workflows to satisfy an old recommendation. Historical Release compatibility code remains separate from live booking intake. Operations Registry, lifecycle logging, Lead Messaging, temporal CPL periods and Reporting remain live boundaries distinct from retired services.

## Evidence and coverage

Read the [second-pass report](SECOND-PASS-2026-10-29.md) and per-file audits: [business](second-pass-business.json), [lifecycle/models](second-pass-lifecycle-models.json), [integrations](second-pass-integrations.json), [removals](second-pass-removals.json). [COVERAGE.md](COVERAGE.md) identifies newer modules inside already-covered families as well as newer service families; a missing dedicated target row does not automatically require a refactor or authorize new work.

First-pass evidence remains in [its report](REFRESH-2026-10-29.md) and refresh-a/b/c.json. Old sessions and traversal references are historical, not the queue.

## Active briefs

| Recommendation | Latest review | Current target |
| --- | --- | --- |
| [admin-browse](recommendations/admin-browse.md) | Corrected / clarified | `src/services/admin/adminBrowse.service.ts` |
| [admin-export](recommendations/admin-export.md) | Corrected / clarified | `src/services/admin/adminExport.service.ts` |
| [admin-facets](recommendations/admin-facets.md) | Checked against source | `src/services/admin/adminFacets.service.ts` |
| [admin-filter-catalog](recommendations/admin-filter-catalog.md) | Checked against source | `src/services/admin/filterCatalog.ts` |
| [admin-search](recommendations/admin-search.md) | Corrected / clarified | `src/services/admin/adminSearch.service.ts` |
| [admin-sheet-sync](recommendations/admin-sheet-sync.md) | Checked against source | `src/services/admin/adminSheetSync.service.ts` |
| [agents-agent-allocation](recommendations/agents-agent-allocation.md) | Corrected / clarified | `src/services/agents/agentAllocation.service.ts` |
| [agents-receiver-agent-crm-username](recommendations/agents-receiver-agent-crm-username.md) | Corrected / clarified | `src/services/agents/receiverAgentCrmUsername.ts` |
| [analytics-agent-performance](recommendations/analytics-agent-performance.md) | Corrected / clarified | `src/services/analytics/agentPerformance.service.ts` |
| [analytics-analytics-export](recommendations/analytics-analytics-export.md) | Corrected / clarified | `src/services/analytics/analyticsExport.service.ts` |
| [analytics-analytics-filters](recommendations/analytics-analytics-filters.md) | Corrected / clarified | `src/services/analytics/analyticsFilters.ts` |
| [analytics-analytics](recommendations/analytics-analytics.md) | Checked against source | `src/services/analytics/analytics.service.ts` |
| [analytics-cancellation-analytics](recommendations/analytics-cancellation-analytics.md) | Corrected / clarified | `src/services/analytics/cancellationAnalytics.service.ts` |
| [analytics-geographic-analytics](recommendations/analytics-geographic-analytics.md) | Corrected / clarified | `src/services/analytics/geographicAnalytics.service.ts` |
| [analytics-lead-cost](recommendations/analytics-lead-cost.md) | Checked against source | `src/services/analytics/leadCost.service.ts` |
| [analytics-overview](recommendations/analytics-overview.md) | Corrected / clarified | `src/services/analytics/overview.service.ts` |
| [analytics-receiver-agent-performance](recommendations/analytics-receiver-agent-performance.md) | Corrected / clarified | `src/services/analytics/receiverAgentPerformance.service.ts` |
| [analytics-revenue-trend](recommendations/analytics-revenue-trend.md) | Corrected / clarified | `src/services/analytics/revenueTrend.service.ts` |
| [analytics-sms-conversion](recommendations/analytics-sms-conversion.md) | Corrected / clarified | `src/services/analytics/smsConversion.service.ts` |
| [analytics-source-hierarchy](recommendations/analytics-source-hierarchy.md) | Corrected / clarified | `src/services/analytics/sourceHierarchy.ts` |
| [analytics-source-performance](recommendations/analytics-source-performance.md) | Corrected / clarified | `src/services/analytics/sourcePerformance.service.ts` |
| [analytics-summary](recommendations/analytics-summary.md) | Corrected / clarified | `src/services/analytics/summary.service.ts` |
| [bookings-booked-lead-from-source](recommendations/bookings-booked-lead-from-source.md) | Corrected / clarified | `src/services/bookings/bookedLeadFromSource.service.ts` |
| [bookings-booked-lead](recommendations/bookings-booked-lead.md) | Corrected / clarified | `src/services/bookings/bookedLead.service.ts` |
| [bookings-booking-identity](recommendations/bookings-booking-identity.md) | Corrected / clarified | `src/services/bookings/bookingIdentity.ts` |
| [bookings-booking-mirror](recommendations/bookings-booking-mirror.md) | Corrected / clarified | `src/services/bookings/bookingMirror.service.ts` |
| [bookings-booking-source-resolver](recommendations/bookings-booking-source-resolver.md) | Corrected / clarified | `src/services/bookings/bookingSourceResolver.ts` |
| [bookings-leadless-booking](recommendations/bookings-leadless-booking.md) | Corrected / clarified | `src/services/bookings/leadlessBooking.service.ts` |
| [bookings-referral-booking](recommendations/bookings-referral-booking.md) | Corrected / clarified | `src/services/bookings/referralBooking.service.ts` |
| [cancellations-cancellation-mirror](recommendations/cancellations-cancellation-mirror.md) | Corrected / clarified | `src/services/cancellations/cancellationMirror.service.ts` |
| [cancellations-cancellation-resolver](recommendations/cancellations-cancellation-resolver.md) | Corrected / clarified | `src/services/cancellations/cancellationResolver.ts` |
| [cancellations-cancelled-lead](recommendations/cancellations-cancelled-lead.md) | Corrected / clarified | `src/services/cancellations/cancelledLead.service.ts` |
| [catalog-catalog](recommendations/catalog-catalog.md) | Corrected / clarified | `src/services/catalog/catalog.service.ts` |
| [cpl-cpl-rate](recommendations/cpl-cpl-rate.md) | Corrected / clarified | `src/services/cpl/cplRate.service.ts` |
| [crm-crm-service](recommendations/crm-crm-service.md) | Corrected / clarified | `src/services/crm/crm.service.ts` |
| [crm-form-lead-payload](recommendations/crm-form-lead-payload.md) | Corrected / clarified | `src/services/crm/formLeadPayload.ts` |
| [customers-customer-from-lead](recommendations/customers-customer-from-lead.md) | Corrected / clarified | `src/services/customers/customerFromLead.service.ts` |
| [customers-customer](recommendations/customers-customer.md) | Corrected / clarified | `src/services/customers/customer.service.ts` |
| [domain-commands-bookings](recommendations/domain-commands-bookings.md) | Corrected / clarified | `src/services/domainCommands/bookings.ts` |
| [domain-commands-command-context](recommendations/domain-commands-command-context.md) | Corrected / clarified | `src/services/domainCommands/commandContext.ts` |
| [domain-commands-entity-change](recommendations/domain-commands-entity-change.md) | Corrected / clarified | `src/services/domainCommands/entityChange.ts` |
| [domain-commands-existing-write-context](recommendations/domain-commands-existing-write-context.md) | Corrected / clarified | `src/services/domainCommands/existingWriteContext.ts` |
| [domain-commands-existing-writes](recommendations/domain-commands-existing-writes.md) | Corrected / clarified | `src/services/domainCommands/existingWrites.ts` |
| [domain-commands-idempotency](recommendations/domain-commands-idempotency.md) | Corrected / clarified | `src/services/domainCommands/idempotency.ts` |
| [domain-commands-ringcentral-provenance](recommendations/domain-commands-ringcentral-provenance.md) | Corrected / clarified | `src/services/domainCommands/ringcentralProvenance.ts` |
| [durable-work-actors](recommendations/durable-work-actors.md) | Corrected / clarified | `src/services/durableWork/actors.ts` |
| [durable-work-capability](recommendations/durable-work-capability.md) | Checked against source | `src/services/durableWork/capability.ts` |
| [durable-work-checkpoints](recommendations/durable-work-checkpoints.md) | Corrected / clarified | `src/services/durableWork/checkpoints.ts` |
| [durable-work-checksum](recommendations/durable-work-checksum.md) | Corrected / clarified | `src/services/durableWork/checksum.ts` |
| [durable-work-leases](recommendations/durable-work-leases.md) | Checked against source | `src/services/durableWork/leases.ts` |
| [durable-work-provider-retry](recommendations/durable-work-provider-retry.md) | Corrected / clarified | `src/services/durableWork/providerRetry.ts` |
| [durable-work-run-transitions](recommendations/durable-work-run-transitions.md) | Corrected / clarified | `src/services/durableWork/runTransitions.ts` |
| [durable-work-schema](recommendations/durable-work-schema.md) | Corrected / clarified | `src/services/durableWork/schema.ts` |
| [durable-work-testing](recommendations/durable-work-testing.md) | Corrected / clarified | `src/services/durableWork/testing.ts` |
| [employee-bookings-booking-lead-attachment](recommendations/employee-bookings-booking-lead-attachment.md) | Corrected / clarified | `src/services/employeeBookings/bookingLeadAttachment.service.ts` |
| [employee-bookings-booking-lead-reconciliation](recommendations/employee-bookings-booking-lead-reconciliation.md) | Corrected / clarified | `src/services/employeeBookings/bookingLeadReconciliation.service.ts` |
| [employee-bookings-lead-candidate-queries](recommendations/employee-bookings-lead-candidate-queries.md) | Corrected / clarified | `src/services/employeeBookings/leadCandidateQueries.ts` |
| [employee-bookings-lead-match-evaluator](recommendations/employee-bookings-lead-match-evaluator.md) | Corrected / clarified | `src/services/employeeBookings/leadMatchEvaluator.ts` |
| [employee-bookings-migration-apply-safety](recommendations/employee-bookings-migration-apply-safety.md) | Corrected / clarified | `src/services/employeeBookings/migrationApplySafety.ts` |
| [employee-bookings-migration-preflight](recommendations/employee-bookings-migration-preflight.md) | Corrected / clarified | `src/services/employeeBookings/migrationPreflight.ts` |
| [employee-bookings-reconciliation-policy](recommendations/employee-bookings-reconciliation-policy.md) | Corrected / clarified | `src/services/employeeBookings/reconciliationPolicy.ts` |
| [employee-bookings-reconciliation-rematch](recommendations/employee-bookings-reconciliation-rematch.md) | Corrected / clarified | `src/services/employeeBookings/reconciliationRematch.service.ts` |
| [employee-bookings-submit-employee-booking](recommendations/employee-bookings-submit-employee-booking.md) | Corrected / clarified | `src/services/employeeBookings/submitEmployeeBooking.service.ts` |
| [enrichment-call-lead-enrichment-rows](recommendations/enrichment-call-lead-enrichment-rows.md) | Corrected / clarified | `src/services/enrichment/callLeadEnrichmentRows.ts` |
| [enrichment-call-lead-enrichment](recommendations/enrichment-call-lead-enrichment.md) | Corrected / clarified | `src/services/enrichment/callLeadEnrichment.service.ts` |
| [extension-users-extension-users](recommendations/extension-users-extension-users.md) | Corrected / clarified | `src/services/extensionUsers/extensionUsers.service.ts` |
| [form-lead](recommendations/form-lead.md) | Corrected / clarified | `src/services/leads/formLead.service.ts` |
| [google-auth-service-account](recommendations/google-auth-service-account.md) | Corrected / clarified | `src/services/googleAuth/serviceAccount.ts` |
| [google-drive-oauth-drive-metadata](recommendations/google-drive-oauth-drive-metadata.md) | Corrected / clarified | `src/services/googleDriveOAuth/driveMetadata.service.ts` |
| [google-drive-oauth-google-drive-oauth](recommendations/google-drive-oauth-google-drive-oauth.md) | Corrected / clarified | `src/services/googleDriveOAuth/googleDriveOAuth.service.ts` |
| [google-drive-oauth-managed-tab](recommendations/google-drive-oauth-managed-tab.md) | Corrected / clarified | `src/services/googleDriveOAuth/managedTab.service.ts` |
| [google-drive-oauth-oauth-scopes](recommendations/google-drive-oauth-oauth-scopes.md) | Corrected / clarified | `src/services/googleDriveOAuth/oauthScopes.ts` |
| [google-drive-oauth-oauth-security](recommendations/google-drive-oauth-oauth-security.md) | Corrected / clarified | `src/services/googleDriveOAuth/oauthSecurity.ts` |
| [google-drive-oauth-owner-auth](recommendations/google-drive-oauth-owner-auth.md) | Corrected / clarified | `src/services/googleDriveOAuth/ownerAuth.ts` |
| [google-drive-oauth-picker-nonce-store](recommendations/google-drive-oauth-picker-nonce-store.md) | Corrected / clarified | `src/services/googleDriveOAuth/pickerNonceStore.ts` |
| [google-drive-oauth-picker-selection-store](recommendations/google-drive-oauth-picker-selection-store.md) | Corrected / clarified | `src/services/googleDriveOAuth/pickerSelectionStore.ts` |
| [google-drive-oauth-picker](recommendations/google-drive-oauth-picker.md) | Corrected / clarified | `src/services/googleDriveOAuth/picker.service.ts` |
| [google-drive-oauth-spreadsheet](recommendations/google-drive-oauth-spreadsheet.md) | Corrected / clarified | `src/services/googleDriveOAuth/spreadsheet.service.ts` |
| [google-drive-oauth-token-encryption](recommendations/google-drive-oauth-token-encryption.md) | Corrected / clarified | `src/services/googleDriveOAuth/tokenEncryption.ts` |
| [google-maps-geocoding](recommendations/google-maps-geocoding.md) | Corrected / clarified | `src/services/googleMaps/geocoding.ts` |
| [google-sheets-booked-lead-row](recommendations/google-sheets-booked-lead-row.md) | Corrected / clarified | `src/services/googleSheets/projections/bookedLeadRow.ts` |
| [google-sheets-call-lead-row](recommendations/google-sheets-call-lead-row.md) | Corrected / clarified | `src/services/googleSheets/projections/callLeadRow.ts` |
| [google-sheets-cancelled-lead-row](recommendations/google-sheets-cancelled-lead-row.md) | Corrected / clarified | `src/services/googleSheets/projections/cancelledLeadRow.ts` |
| [google-sheets-delete-rows](recommendations/google-sheets-delete-rows.md) | Corrected / clarified | `src/services/googleSheets/deleteRows.ts` |
| [google-sheets-form-lead-row](recommendations/google-sheets-form-lead-row.md) | Corrected / clarified | `src/services/googleSheets/projections/formLeadRow.ts` |
| [google-sheets-google-sheets](recommendations/google-sheets-google-sheets.md) | Corrected / clarified | `src/services/googleSheets/googleSheets.service.ts` |
| [google-sheets-retry](recommendations/google-sheets-retry.md) | Corrected / clarified | `src/services/googleSheets/retry.ts` |
| [google-sheets-row-lookup](recommendations/google-sheets-row-lookup.md) | Corrected / clarified | `src/services/googleSheets/rowLookup.ts` |
| [google-sheets-sync-rows](recommendations/google-sheets-sync-rows.md) | Corrected / clarified | `src/services/googleSheets/syncRows.ts` |
| [google-sheets-tabs](recommendations/google-sheets-tabs.md) | Corrected / clarified | `src/services/googleSheets/tabs.ts` |
| [google-sheets-targets](recommendations/google-sheets-targets.md) | Corrected / clarified | `src/services/googleSheets/targets.ts` |
| [granot-crm-csv-parser](recommendations/granot-crm-csv-parser.md) | Corrected / clarified | `src/services/granotCrmCsv/parser.ts` |
| [granot-crm-csv-registry](recommendations/granot-crm-csv-registry.md) | Corrected / clarified | `src/services/granotCrmCsv/registry.ts` |
| [granot-crm-csv-sync](recommendations/granot-crm-csv-sync.md) | Corrected / clarified | `src/services/granotCrmCsv/sync.service.ts` |
| [granot-crm-csv-upload](recommendations/granot-crm-csv-upload.md) | Corrected / clarified | `src/services/granotCrmCsv/upload.service.ts` |
| [granot-http-collector-automation](recommendations/granot-http-collector-automation.md) | Corrected / clarified | `src/services/granotHttpCollector/automation.ts` |
| [granot-http-collector-form-lead-matcher](recommendations/granot-http-collector-form-lead-matcher.md) | Corrected / clarified | `src/services/granotHttpCollector/granotFormLeadMatcher.ts` |
| [granot-http-collector-form-workflow](recommendations/granot-http-collector-form-workflow.md) | Corrected / clarified | `src/services/granotHttpCollector/formWorkflow.ts` |
| [granot-http-collector-index](recommendations/granot-http-collector-index.md) | Corrected / clarified | `src/services/granotHttpCollector/index.ts` |
| [granot-http-collector-lifecycle-statement](recommendations/granot-http-collector-lifecycle-statement.md) | Corrected / clarified | `src/services/granotHttpCollector/lifecycleStatement.ts` |
| [granot-http-collector-run-workflow](recommendations/granot-http-collector-run-workflow.md) | Corrected / clarified | `src/services/granotHttpCollector/runWorkflow.ts` |
| [granot-http-collector-source-catalog](recommendations/granot-http-collector-source-catalog.md) | Corrected / clarified | `src/services/granotHttpCollector/sourceCatalog.ts` |
| [granot-lifecycle-aggregate-revision](recommendations/granot-lifecycle-aggregate-revision.md) | Checked against source | `src/services/granotLifecycle/aggregateRevision.ts` |
| [granot-lifecycle-alerts](recommendations/granot-lifecycle-alerts.md) | Corrected / clarified | `src/services/granotLifecycle/alerts.ts` |
| [granot-lifecycle-authorized-desired-state](recommendations/granot-lifecycle-authorized-desired-state.md) | Corrected / clarified | `src/services/granotLifecycle/authorizedDesiredState.ts` |
| [granot-lifecycle-automation-apply](recommendations/granot-lifecycle-automation-apply.md) | Checked against source | `src/services/granotLifecycle/automationApply.ts` |
| [granot-lifecycle-automation-compatibility](recommendations/granot-lifecycle-automation-compatibility.md) | Checked against source | `src/services/granotLifecycle/automationCompatibility.ts` |
| [granot-lifecycle-booking-confirmation](recommendations/granot-lifecycle-booking-confirmation.md) | Corrected / clarified | `src/services/granotLifecycle/bookingConfirmation.ts` |
| [granot-lifecycle-booking-owner-commands](recommendations/granot-lifecycle-booking-owner-commands.md) | Checked against source | `src/services/granotLifecycle/bookingOwnerCommands.ts` |
| [granot-lifecycle-booking-priority-pairing](recommendations/granot-lifecycle-booking-priority-pairing.md) | Corrected / clarified | `src/services/granotLifecycle/bookingPriorityPairing.ts` |
| [granot-lifecycle-booking-reconciliation](recommendations/granot-lifecycle-booking-reconciliation.md) | Checked against source | `src/services/granotLifecycle/bookingReconciliation.ts` |
| [granot-lifecycle-capture](recommendations/granot-lifecycle-capture.md) | Checked against source | `src/services/granotLifecycle/capture.ts` |
| [granot-lifecycle-create-lead-from-granot](recommendations/granot-lifecycle-create-lead-from-granot.md) | Checked against source | `src/services/granotLifecycle/createLeadFromGranot.ts` |
| [granot-lifecycle-creating-observation](recommendations/granot-lifecycle-creating-observation.md) | Corrected / clarified | `src/services/granotLifecycle/creatingObservation.ts` |
| [granot-lifecycle-discrepancies](recommendations/granot-lifecycle-discrepancies.md) | Checked against source | `src/services/granotLifecycle/discrepancies.ts` |
| [granot-lifecycle-discrepancy-owner-commands](recommendations/granot-lifecycle-discrepancy-owner-commands.md) | Checked against source | `src/services/granotLifecycle/discrepancyOwnerCommands.ts` |
| [granot-lifecycle-discrepancy-projections](recommendations/granot-lifecycle-discrepancy-projections.md) | Checked against source | `src/services/granotLifecycle/discrepancyProjections.ts` |
| [granot-lifecycle-drainer](recommendations/granot-lifecycle-drainer.md) | Checked against source | `src/services/granotLifecycle/drainer.ts` |
| [granot-lifecycle-extension-apply](recommendations/granot-lifecycle-extension-apply.md) | Checked against source | `src/services/granotLifecycle/extensionApply.ts` |
| [granot-lifecycle-granot-temporal](recommendations/granot-lifecycle-granot-temporal.md) | Corrected / clarified | `src/services/granotLifecycle/granotTemporal.ts` |
| [granot-lifecycle-identity](recommendations/granot-lifecycle-identity.md) | Checked against source | `src/services/granotLifecycle/identity.ts` |
| [granot-lifecycle-lead-contact-projection](recommendations/granot-lifecycle-lead-contact-projection.md) | Corrected / clarified | `src/services/granotLifecycle/leadContactProjection.ts` |
| [granot-lifecycle-lead-desired-state](recommendations/granot-lifecycle-lead-desired-state.md) | Checked against source | `src/services/granotLifecycle/leadDesiredState.ts` |
| [granot-lifecycle-metrics](recommendations/granot-lifecycle-metrics.md) | Checked against source | `src/services/granotLifecycle/metrics.ts` |
| [granot-lifecycle-normalization](recommendations/granot-lifecycle-normalization.md) | Checked against source | `src/services/granotLifecycle/normalization.ts` |
| [granot-lifecycle-observability](recommendations/granot-lifecycle-observability.md) | Checked against source | `src/services/granotLifecycle/observability.ts` |
| [granot-lifecycle-operations](recommendations/granot-lifecycle-operations.md) | Checked against source | `src/services/granotLifecycle/operations.ts` |
| [granot-lifecycle-processor](recommendations/granot-lifecycle-processor.md) | Corrected / clarified | `src/services/granotLifecycle/processor.ts` |
| [granot-lifecycle-projections](recommendations/granot-lifecycle-projections.md) | Checked against source | `src/services/granotLifecycle/projections.ts` |
| [granot-lifecycle-queue-publisher](recommendations/granot-lifecycle-queue-publisher.md) | Checked against source | `src/services/granotLifecycle/queuePublisher.ts` |
| [granot-lifecycle-referral-booking](recommendations/granot-lifecycle-referral-booking.md) | Checked against source | `src/services/granotLifecycle/referralBooking.ts` |
| [granot-lifecycle-source-policy](recommendations/granot-lifecycle-source-policy.md) | Checked against source | `src/services/granotLifecycle/sourcePolicy.ts` |
| [granot-lifecycle-synchronize-lead-from-granot](recommendations/granot-lifecycle-synchronize-lead-from-granot.md) | Checked against source | `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` |
| [granot-lifecycle-trusted-lead-create-validation](recommendations/granot-lifecycle-trusted-lead-create-validation.md) | Checked against source | `src/services/granotLifecycle/trustedLeadCreateValidation.ts` |
| [job-number-timeline-assemble](recommendations/job-number-timeline-assemble.md) | Checked against source | `src/services/jobNumberTimeline/assemble.ts` |
| [job-number-timeline-attention](recommendations/job-number-timeline-attention.md) | Checked against source | `src/services/jobNumberTimeline/attention.ts` |
| [job-number-timeline-clocks](recommendations/job-number-timeline-clocks.md) | Corrected / clarified | `src/services/jobNumberTimeline/clocks.ts` |
| [job-number-timeline-evidence](recommendations/job-number-timeline-evidence.md) | Corrected / clarified | `src/services/jobNumberTimeline/evidence.ts` |
| [job-number-timeline-mongo-evidence-loader](recommendations/job-number-timeline-mongo-evidence-loader.md) | Checked against source | `src/services/jobNumberTimeline/mongo-evidence-loader.ts` |
| [job-number-timeline-outcome](recommendations/job-number-timeline-outcome.md) | Checked against source | `src/services/jobNumberTimeline/outcome.ts` |
| [job-number-timeline-projector](recommendations/job-number-timeline-projector.md) | Checked against source | `src/services/jobNumberTimeline/projector.ts` |
| [job-number-timeline-recent-official-bookings](recommendations/job-number-timeline-recent-official-bookings.md) | Checked against source | `src/services/jobNumberTimeline/recent-official-bookings.ts` |
| [lead-messaging-granot-created-lead](recommendations/lead-messaging-granot-created-lead.md) | Corrected / clarified | `src/services/leadMessaging/granotCreatedLead.ts` |
| [lead-messaging-lead-messaging-queue](recommendations/lead-messaging-lead-messaging-queue.md) | Corrected / clarified | `src/services/leadMessaging/leadMessagingQueue.service.ts` |
| [lead-messaging-lead-messaging](recommendations/lead-messaging-lead-messaging.md) | Checked against source | `src/services/leadMessaging/leadMessaging.service.ts` |
| [lead-messaging-twilio-adapter](recommendations/lead-messaging-twilio-adapter.md) | Checked against source | `src/services/leadMessaging/twilioAdapter.ts` |
| [lead-source-companies-lead-source-company](recommendations/lead-source-companies-lead-source-company.md) | Checked against source | `src/services/leadSourceCompanies/leadSourceCompany.service.ts` |
| [leads-call-lead-source-match](recommendations/leads-call-lead-source-match.md) | Corrected / clarified | `src/services/leads/callLeadSourceMatch.ts` |
| [leads-call-lead](recommendations/leads-call-lead.md) | Checked against source | `src/services/leads/callLead.service.ts` |
| [leads-cpl-resolution](recommendations/leads-cpl-resolution.md) | Checked against source | `src/services/leads/leadCplResolution.ts` |
| [leads-duplicate-lead](recommendations/leads-duplicate-lead.md) | Checked against source | `src/services/leads/duplicateLead.service.ts` |
| [leads-ingestion-provenance](recommendations/leads-ingestion-provenance.md) | Checked against source | `src/services/leads/leadIngestionProvenance.ts` |
| [leads-lead-location](recommendations/leads-lead-location.md) | Checked against source | `src/services/leads/leadLocation.service.ts` |
| [leads-lead-name](recommendations/leads-lead-name.md) | Checked against source | `src/services/leads/leadName.service.ts` |
| [leads-lead-phone-matching](recommendations/leads-lead-phone-matching.md) | Corrected / clarified | `src/services/leads/leadPhoneMatching.ts` |
| [leads-lead-source-compatibility](recommendations/leads-lead-source-compatibility.md) | Checked against source | `src/services/leads/leadSourceCompatibility.ts` |
| [leads-source-company](recommendations/leads-source-company.md) | Corrected / clarified | `src/services/leads/leadSourceCompany.ts` |
| [leads-source-lead-lookup](recommendations/leads-source-lead-lookup.md) | Checked against source | `src/services/leads/sourceLeadLookup.service.ts` |
| [models-agent](recommendations/models-agent.md) | Checked against source | `src/models/Agent.ts` |
| [models-booked-lead](recommendations/models-booked-lead.md) | Checked against source | `src/models/BookedLead.ts` |
| [models-booking-lead-reconciliation-case](recommendations/models-booking-lead-reconciliation-case.md) | Checked against source | `src/models/BookingLeadReconciliationCase.ts` |
| [models-call-lead](recommendations/models-call-lead.md) | Corrected / clarified | `src/models/CallLead.ts` |
| [models-cancelled-lead](recommendations/models-cancelled-lead.md) | Corrected / clarified | `src/models/CancelledLead.ts` |
| [models-cpl-correction-job](recommendations/models-cpl-correction-job.md) | Corrected / clarified | `src/models/CplCorrectionJob.ts` |
| [models-cpl-lead-correction](recommendations/models-cpl-lead-correction.md) | Corrected / clarified | `src/models/CplLeadCorrection.ts` |
| [models-cpl-rate-period](recommendations/models-cpl-rate-period.md) | Corrected / clarified | `src/models/CplRatePeriod.ts` |
| [models-cpl-rate](recommendations/models-cpl-rate.md) | Checked against source | `src/models/CplRate.ts` |
| [models-customer](recommendations/models-customer.md) | Checked against source | `src/models/Customer.ts` |
| [models-domain-command-execution](recommendations/models-domain-command-execution.md) | Checked against source | `src/models/DomainCommandExecution.ts` |
| [models-entity-change](recommendations/models-entity-change.md) | Corrected / clarified | `src/models/EntityChange.ts` |
| [models-extension-user](recommendations/models-extension-user.md) | Checked against source | `src/models/ExtensionUser.ts` |
| [models-form-lead](recommendations/models-form-lead.md) | Corrected / clarified | `src/models/FormLead.ts` |
| [models-google-drive-connection](recommendations/models-google-drive-connection.md) | Checked against source | `src/models/GoogleDriveConnection.ts` |
| [models-google-oauth-state](recommendations/models-google-oauth-state.md) | Checked against source | `src/models/GoogleOAuthState.ts` |
| [models-google-picker-nonce](recommendations/models-google-picker-nonce.md) | Checked against source | `src/models/GooglePickerNonce.ts` |
| [models-google-picker-selection](recommendations/models-google-picker-selection.md) | Checked against source | `src/models/GooglePickerSelection.ts` |
| [models-granot-automation-run](recommendations/models-granot-automation-run.md) | Corrected / clarified | `src/models/GranotAutomationRun.ts` |
| [models-granot-automation-source](recommendations/models-granot-automation-source.md) | Checked against source | `src/models/GranotAutomationSource.ts` |
| [models-granot-booking-discrepancy](recommendations/models-granot-booking-discrepancy.md) | Checked against source | `src/models/GranotBookingDiscrepancy.ts` |
| [models-granot-booking-reconciliation-case](recommendations/models-granot-booking-reconciliation-case.md) | Corrected / clarified | `src/models/GranotBookingReconciliationCase.ts` |
| [models-granot-crm-csv-ingestion](recommendations/models-granot-crm-csv-ingestion.md) | Checked against source | `src/models/GranotCrmCsvIngestion.ts` |
| [models-granot-crm-source-semantics](recommendations/models-granot-crm-source-semantics.md) | Checked against source | `src/models/granotCrmSourceSemantics.ts` |
| [models-granot-crm-source](recommendations/models-granot-crm-source.md) | Corrected / clarified | `src/models/GranotCrmSource.ts` |
| [models-granot-crm-sync-run](recommendations/models-granot-crm-sync-run.md) | Checked against source | `src/models/GranotCrmSyncRun.ts` |
| [models-granot-discrepancy-model](recommendations/models-granot-discrepancy-model.md) | Corrected / clarified | `src/models/granotDiscrepancyModel.ts` |
| [models-granot-lifecycle-activation](recommendations/models-granot-lifecycle-activation.md) | Corrected / clarified | `src/models/GranotLifecycleActivation.ts` |
| [models-granot-lifecycle-schemas](recommendations/models-granot-lifecycle-schemas.md) | Corrected / clarified | `src/models/granotLifecycleSchemas.ts` |
| [models-granot-observation-receipt](recommendations/models-granot-observation-receipt.md) | Corrected / clarified | `src/models/GranotObservationReceipt.ts` |
| [models-granot-observation](recommendations/models-granot-observation.md) | Corrected / clarified | `src/models/GranotObservation.ts` |
| [models-granot-record-link](recommendations/models-granot-record-link.md) | Checked against source | `src/models/GranotRecordLink.ts` |
| [models-granot-release-discrepancy](recommendations/models-granot-release-discrepancy.md) | Checked against source | `src/models/GranotReleaseDiscrepancy.ts` |
| [models-lead-message-rate-limit](recommendations/models-lead-message-rate-limit.md) | Corrected / clarified | `src/models/LeadMessageRateLimit.ts` |
| [models-lead-message](recommendations/models-lead-message.md) | Checked against source | `src/models/LeadMessage.ts` |
| [models-lead-source-company](recommendations/models-lead-source-company.md) | Corrected / clarified | `src/models/LeadSourceCompany.ts` |
| [models-lead-source-granularity](recommendations/models-lead-source-granularity.md) | Corrected / clarified | `src/models/LeadSourceGranularity.ts` |
| [models-lead-source-label-mapping](recommendations/models-lead-source-label-mapping.md) | Corrected / clarified | `src/models/LeadSourceLabelMapping.ts` |
| [models-merchant](recommendations/models-merchant.md) | Checked against source | `src/models/Merchant.ts` |
| [models-moving-carrier](recommendations/models-moving-carrier.md) | Checked against source | `src/models/MovingCarrier.ts` |
| [models-public-submission-throttle-bucket](recommendations/models-public-submission-throttle-bucket.md) | Checked against source | `src/models/PublicSubmissionThrottleBucket.ts` |
| [models-ringcentral-inbound-route-assignment](recommendations/models-ringcentral-inbound-route-assignment.md) | Corrected / clarified | `src/models/RingCentralInboundRouteAssignment.ts` |
| [models-ringcentral-inbound-route](recommendations/models-ringcentral-inbound-route.md) | Corrected / clarified | `src/models/RingCentralInboundRoute.ts` |
| [models-schema-helpers](recommendations/models-schema-helpers.md) | Checked against source | `src/models/schemaHelpers.ts` |
| [models-sheet-sync-attempt](recommendations/models-sheet-sync-attempt.md) | Checked against source | `src/models/SheetSyncAttempt.ts` |
| [models-sheet-sync-job](recommendations/models-sheet-sync-job.md) | Checked against source | `src/models/SheetSyncJob.ts` |
| [models-sheet-sync-lease](recommendations/models-sheet-sync-lease.md) | Checked against source | `src/models/SheetSyncLease.ts` |
| [models-sheet-sync-quota-bucket](recommendations/models-sheet-sync-quota-bucket.md) | Checked against source | `src/models/SheetSyncQuotaBucket.ts` |
| [models-sheet-sync-run](recommendations/models-sheet-sync-run.md) | Checked against source | `src/models/SheetSyncRun.ts` |
| [models-synchronization-decision](recommendations/models-synchronization-decision.md) | Corrected / clarified | `src/models/SynchronizationDecision.ts` |
| [models-testimonial](recommendations/models-testimonial.md) | Checked against source | `src/models/Testimonial.ts` |
| [models-wordpress-form-submission-receipt](recommendations/models-wordpress-form-submission-receipt.md) | Corrected / clarified | `src/models/WordpressFormSubmissionReceipt.ts` |
| [moving-carriers-granot-carrier-code-seed](recommendations/moving-carriers-granot-carrier-code-seed.md) | Checked against source | `src/services/movingCarriers/granotCarrierCodeSeed.ts` |
| [moving-carriers-moving-carrier](recommendations/moving-carriers-moving-carrier.md) | Checked against source | `src/services/movingCarriers/movingCarrier.service.ts` |
| [operational-workbooks-registry](recommendations/operational-workbooks-registry.md) | Checked against source | `src/services/operationalWorkbooks/registry.ts` |
| [operations-registry-catalog-registry](recommendations/operations-registry-catalog-registry.md) | Corrected / clarified | `src/services/operationsRegistry/catalogRegistry.ts` |
| [operations-registry-cpl-corrections](recommendations/operations-registry-cpl-corrections.md) | Corrected / clarified | `src/services/operationsRegistry/cplCorrections.ts` |
| [operations-registry-cpl-schedule](recommendations/operations-registry-cpl-schedule.md) | Corrected / clarified | `src/services/operationsRegistry/cplSchedule.ts` |
| [operations-registry-crm-source-outbound-sms](recommendations/operations-registry-crm-source-outbound-sms.md) | Corrected / clarified | `src/services/operationsRegistry/crmSourceOutboundSms.ts` |
| [operations-registry-granot-automation-sources](recommendations/operations-registry-granot-automation-sources.md) | Checked against source | `src/services/operationsRegistry/granotAutomationSources.ts` |
| [operations-registry-granot-crm-source-projections](recommendations/operations-registry-granot-crm-source-projections.md) | Checked against source | `src/services/operationsRegistry/granotCrmSourceProjections.ts` |
| [operations-registry-granot-crm-sources](recommendations/operations-registry-granot-crm-sources.md) | Corrected / clarified | `src/services/operationsRegistry/granotCrmSources.ts` |
| [operations-registry-label-mappings](recommendations/operations-registry-label-mappings.md) | Corrected / clarified | `src/services/operationsRegistry/labelMappings.ts` |
| [operations-registry-lead-source-setup](recommendations/operations-registry-lead-source-setup.md) | Checked against source | `src/services/operationsRegistry/leadSourceSetup.ts` |
| [operations-registry-owner-granot-names](recommendations/operations-registry-owner-granot-names.md) | Corrected / clarified | `src/services/operationsRegistry/ownerGranotNames.ts` |
| [operations-registry-queries-changes](recommendations/operations-registry-queries-changes.md) | Checked against source | `src/services/operationsRegistry/queries/changes.ts` |
| [operations-registry-queries-health](recommendations/operations-registry-queries-health.md) | Checked against source | `src/services/operationsRegistry/queries/health.ts` |
| [operations-registry-queries-lead-source-projection](recommendations/operations-registry-queries-lead-source-projection.md) | Checked against source | `src/services/operationsRegistry/queries/leadSourceProjection.ts` |
| [operations-registry-queries-overview](recommendations/operations-registry-queries-overview.md) | Checked against source | `src/services/operationsRegistry/queries/overview.ts` |
| [operations-registry-registry-audit](recommendations/operations-registry-registry-audit.md) | Corrected / clarified | `src/services/operationsRegistry/registryAudit.ts` |
| [operations-registry-ring-central-registry](recommendations/operations-registry-ring-central-registry.md) | Checked against source | `src/services/operationsRegistry/ringCentralRegistry.ts` |
| [operations-registry-ring-central-snapshot](recommendations/operations-registry-ring-central-snapshot.md) | Corrected / clarified | `src/services/operationsRegistry/ringCentralSnapshot.ts` |
| [operations-registry-ring-central-validation](recommendations/operations-registry-ring-central-validation.md) | Corrected / clarified | `src/services/operationsRegistry/ringCentralValidation.ts` |
| [operations-registry-runtime-telemetry](recommendations/operations-registry-runtime-telemetry.md) | Checked against source | `src/services/operationsRegistry/runtimeTelemetry.ts` |
| [operations-registry-source-registry](recommendations/operations-registry-source-registry.md) | Corrected / clarified | `src/services/operationsRegistry/sourceRegistry.ts` |
| [operations-registry-source-resolution](recommendations/operations-registry-source-resolution.md) | Corrected / clarified | `src/services/operationsRegistry/sourceResolution.ts` |
| [operations-registry-trusted-actor](recommendations/operations-registry-trusted-actor.md) | Corrected / clarified | `src/services/operationsRegistry/trustedActor.ts` |
| [reconciliation-booked-call-lead-rows](recommendations/reconciliation-booked-call-lead-rows.md) | Checked against source | `src/services/reconciliation/bookedCallLeadRows.ts` |
| [reconciliation-booked-call-lead](recommendations/reconciliation-booked-call-lead.md) | Corrected / clarified | `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` |
| [reporting-canonical-reporting](recommendations/reporting-canonical-reporting.md) | Checked against source | `src/services/reporting/query/canonicalReporting.ts` |
| [reporting-cell-serialization](recommendations/reporting-cell-serialization.md) | Corrected / clarified | `src/services/reporting/google/cellSerialization.ts` |
| [reporting-cleanup](recommendations/reporting-cleanup.md) | Corrected / clarified | `src/services/reporting/cleanup.ts` |
| [reporting-delivery-engine](recommendations/reporting-delivery-engine.md) | Checked against source | `src/services/reporting/deliveryEngine.ts` |
| [reporting-delivery-repository](recommendations/reporting-delivery-repository.md) | Corrected / clarified | `src/services/reporting/reportingDeliveryRepository.ts` |
| [reporting-destination-contract](recommendations/reporting-destination-contract.md) | Checked against source | `src/services/reporting/destinationContract.ts` |
| [reporting-destination-identity](recommendations/reporting-destination-identity.md) | Checked against source | `src/services/reporting/destinationIdentity.ts` |
| [reporting-destination-lineage](recommendations/reporting-destination-lineage.md) | Checked against source | `src/services/reporting/destinationLineage.ts` |
| [reporting-destination-repository](recommendations/reporting-destination-repository.md) | Checked against source | `src/services/reporting/reportingDestinationRepository.ts` |
| [reporting-destination](recommendations/reporting-destination.md) | Checked against source | `src/services/reporting/reportingDestination.service.ts` |
| [reporting-drive-app-properties](recommendations/reporting-drive-app-properties.md) | Corrected / clarified | `src/services/reporting/google/driveAppProperties.ts` |
| [reporting-execution-stream](recommendations/reporting-execution-stream.md) | Checked against source | `src/services/reporting/executionStream.ts` |
| [reporting-janitor-completion](recommendations/reporting-janitor-completion.md) | Corrected / clarified | `src/services/reporting/live/janitorCompletion.ts` |
| [reporting-live-google-orchestration](recommendations/reporting-live-google-orchestration.md) | Corrected / clarified | `src/services/reporting/live/liveGoogleOrchestration.ts` |
| [reporting-live-picker-contract-runner](recommendations/reporting-live-picker-contract-runner.md) | Corrected / clarified | `src/services/reporting/live/livePickerContractRunner.ts` |
| [reporting-live-test-cleanup](recommendations/reporting-live-test-cleanup.md) | Corrected / clarified | `src/services/reporting/live/liveTestCleanup.ts` |
| [reporting-live-test-denylist-proof](recommendations/reporting-live-test-denylist-proof.md) | Corrected / clarified | `src/services/reporting/live/liveTestDenylistProof.ts` |
| [reporting-live-test-harness-run-registry](recommendations/reporting-live-test-harness-run-registry.md) | Corrected / clarified | `src/services/reporting/live/liveTestHarnessRunRegistry.ts` |
| [reporting-live-test-oauth-adapters](recommendations/reporting-live-test-oauth-adapters.md) | Corrected / clarified | `src/services/reporting/live/liveTestOAuthAdapters.ts` |
| [reporting-live-test-run-factory](recommendations/reporting-live-test-run-factory.md) | Corrected / clarified | `src/services/reporting/live/liveTestRunFactory.ts` |
| [reporting-live-test-security](recommendations/reporting-live-test-security.md) | Corrected / clarified | `src/services/reporting/live/liveTestSecurity.ts` |
| [reporting-manifest-page-adapter](recommendations/reporting-manifest-page-adapter.md) | Corrected / clarified | `src/services/reporting/manifestPageAdapter.ts` |
| [reporting-manifest-repository](recommendations/reporting-manifest-repository.md) | Corrected / clarified | `src/services/reporting/reportingManifestRepository.ts` |
| [reporting-ownership-marker](recommendations/reporting-ownership-marker.md) | Corrected / clarified | `src/services/reporting/ownershipMarker.ts` |
| [reporting-pii-safe-evidence](recommendations/reporting-pii-safe-evidence.md) | Corrected / clarified | `src/services/reporting/live/piiSafeEvidence.ts` |
| [reporting-promotion-reservation](recommendations/reporting-promotion-reservation.md) | Corrected / clarified | `src/services/reporting/promotionReservation.ts` |
| [reporting-promotion](recommendations/reporting-promotion.md) | Corrected / clarified | `src/services/reporting/promotion.ts` |
| [reporting-provider-failures](recommendations/reporting-provider-failures.md) | Corrected / clarified | `src/services/reporting/google/providerFailures.ts` |
| [reporting-queue](recommendations/reporting-queue.md) | Corrected / clarified | `src/services/reporting/queue.ts` |
| [reporting-registry-filters](recommendations/reporting-registry-filters.md) | Corrected / clarified | `src/services/reporting/registryFilters.ts` |
| [reporting-reporting-drive-adapter](recommendations/reporting-reporting-drive-adapter.md) | Corrected / clarified | `src/services/reporting/google/reportingDriveAdapter.ts` |
| [reporting-reporting-observability](recommendations/reporting-reporting-observability.md) | Corrected / clarified | `src/services/reporting/reportingObservability.ts` |
| [reporting-reporting-sheets-adapter](recommendations/reporting-reporting-sheets-adapter.md) | Corrected / clarified | `src/services/reporting/google/reportingSheetsAdapter.ts` |
| [reporting-reporting-worker](recommendations/reporting-reporting-worker.md) | Checked against source | `src/services/reporting/reportingWorker.ts` |
| [reporting-reporting](recommendations/reporting-reporting.md) | Checked against source | `src/services/reporting/reporting.service.ts` |
| [reporting-run-marker](recommendations/reporting-run-marker.md) | Corrected / clarified | `src/services/reporting/google/runMarker.ts` |
| [reporting-run-repository](recommendations/reporting-run-repository.md) | Corrected / clarified | `src/services/reporting/reportingRunRepository.ts` |
| [reporting-snapshot-adapter](recommendations/reporting-snapshot-adapter.md) | Corrected / clarified | `src/services/reporting/snapshotAdapter.ts` |
| [reporting-synthetic-live-test-manifest](recommendations/reporting-synthetic-live-test-manifest.md) | Corrected / clarified | `src/services/reporting/live/syntheticLiveTestManifest.ts` |
| [reporting-synthetic-manifest-page-adapter](recommendations/reporting-synthetic-manifest-page-adapter.md) | Corrected / clarified | `src/services/reporting/live/syntheticManifestPageAdapter.ts` |
| [reporting-test-artifact-janitor](recommendations/reporting-test-artifact-janitor.md) | Checked against source | `src/services/reporting/live/testArtifactJanitor.ts` |
| [reporting-timezone](recommendations/reporting-timezone.md) | Checked against source | `src/services/reporting/timezone.ts` |
| [reporting-transient-retry-wrapper](recommendations/reporting-transient-retry-wrapper.md) | Corrected / clarified | `src/services/reporting/live/transientRetryWrapper.ts` |
| [ringcentral-analytics-reconcile](recommendations/ringcentral-analytics-reconcile.md) | Corrected / clarified | `src/services/ringcentral/analytics-reconcile.service.ts` |
| [ringcentral-auth](recommendations/ringcentral-auth.md) | Corrected / clarified | `src/services/ringcentral/auth.ts` |
| [ringcentral-call-candidate-evaluator](recommendations/ringcentral-call-candidate-evaluator.md) | Corrected / clarified | `src/services/ringcentral/call-candidate-evaluator.ts` |
| [ringcentral-call-candidate-store](recommendations/ringcentral-call-candidate-store.md) | Corrected / clarified | `src/services/ringcentral/call-candidate-store.ts` |
| [ringcentral-call-lead-convergence](recommendations/ringcentral-call-lead-convergence.md) | Corrected / clarified | `src/services/ringcentral/callLeadConvergence.service.ts` |
| [ringcentral-call-lead-ingest](recommendations/ringcentral-call-lead-ingest.md) | Corrected / clarified | `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts` |
| [ringcentral-call-log-sync-state-store](recommendations/ringcentral-call-log-sync-state-store.md) | Corrected / clarified | `src/services/ringcentral/call-log-sync-state.store.ts` |
| [ringcentral-call-log-sync](recommendations/ringcentral-call-log-sync.md) | Corrected / clarified | `src/services/ringcentral/call-log-sync.service.ts` |
| [ringcentral-call-log-vetting](recommendations/ringcentral-call-log-vetting.md) | Corrected / clarified | `src/services/ringcentral/call-log-vetting.ts` |
| [ringcentral-call-session-aggregator](recommendations/ringcentral-call-session-aggregator.md) | Corrected / clarified | `src/services/ringcentral/call-session-aggregator.ts` |
| [ringcentral-call-session-store](recommendations/ringcentral-call-session-store.md) | Corrected / clarified | `src/services/ringcentral/call-session-store.ts` |
| [ringcentral-duplicate-guard](recommendations/ringcentral-duplicate-guard.md) | Corrected / clarified | `src/services/ringcentral/ringcentral-duplicate-guard.ts` |
| [ringcentral-processed-calls-store](recommendations/ringcentral-processed-calls-store.md) | Checked against source | `src/services/ringcentral/processed-calls-store.ts` |
| [ringcentral-shadow-call-leads-store](recommendations/ringcentral-shadow-call-leads-store.md) | Corrected / clarified | `src/services/ringcentral/shadow-call-leads-store.ts` |
| [ringcentral-webhook-capture](recommendations/ringcentral-webhook-capture.md) | Corrected / clarified | `src/services/ringcentral/webhook-capture.ts` |
| [ringcentral-webhook-subscriptions](recommendations/ringcentral-webhook-subscriptions.md) | Corrected / clarified | `src/services/ringcentral/webhook-subscriptions.ts` |
| [routes-booking-reconciliation-cron](recommendations/routes-booking-reconciliation-cron.md) | Corrected / clarified | `src/routes/booking-reconciliation-cron.routes.ts` |
| [routes-cpl-correction-cron](recommendations/routes-cpl-correction-cron.md) | Corrected / clarified | `src/routes/cpl-correction-cron.routes.ts` |
| [routes-extension-auth](recommendations/routes-extension-auth.md) | Corrected / clarified | `src/routes/extension-auth.routes.ts` |
| [routes-extension-granot-apply](recommendations/routes-extension-granot-apply.md) | Checked against source | `src/routes/extension-granot-apply.routes.ts` |
| [routes-extension-users-admin](recommendations/routes-extension-users-admin.md) | Corrected / clarified | `src/routes/extension-users-admin.routes.ts` |
| [routes-google-drive-oauth](recommendations/routes-google-drive-oauth.md) | Checked against source | `src/routes/google-drive-oauth.routes.ts` |
| [routes-granot-automation-cron](recommendations/routes-granot-automation-cron.md) | Corrected / clarified | `src/routes/granot-automation-cron.routes.ts` |
| [routes-granot-automation](recommendations/routes-granot-automation.md) | Checked against source | `src/routes/granot-automation.routes.ts` |
| [routes-granot-lifecycle-admin](recommendations/routes-granot-lifecycle-admin.md) | Checked against source | `src/routes/granot-lifecycle-admin.routes.ts` |
| [routes-granot-lifecycle-cron](recommendations/routes-granot-lifecycle-cron.md) | Corrected / clarified | `src/routes/granot-lifecycle-cron.routes.ts` |
| [routes-granot-webhook](recommendations/routes-granot-webhook.md) | Checked against source | `src/routes/granot-webhook.routes.ts` |
| [routes-job-number-timeline-admin](recommendations/routes-job-number-timeline-admin.md) | Checked against source | `src/routes/job-number-timeline-admin.routes.ts` |
| [routes-lead-messaging-cron](recommendations/routes-lead-messaging-cron.md) | Corrected / clarified | `src/routes/lead-messaging-cron.routes.ts` |
| [routes-reporting-cron](recommendations/routes-reporting-cron.md) | Checked against source | `src/routes/reporting-cron.routes.ts` |
| [routes-reporting](recommendations/routes-reporting.md) | Corrected / clarified | `src/routes/reporting.routes.ts` |
| [routes-ringcentral-cron](recommendations/routes-ringcentral-cron.md) | Corrected / clarified | `src/routes/ringcentral-cron.routes.ts` |
| [routes-ringcentral-registry](recommendations/routes-ringcentral-registry.md) | Corrected / clarified | `src/routes/ringcentral-registry.routes.ts` |
| [routes-ringcentral-webhook-local](recommendations/routes-ringcentral-webhook-local.md) | Checked against source | `src/routes/ringcentral-webhook-local.routes.ts` |
| [routes-ringcentral-webhook](recommendations/routes-ringcentral-webhook.md) | Corrected / clarified | `src/routes/ringcentral-webhook.routes.ts` |
| [routes-sheet-sync-cron](recommendations/routes-sheet-sync-cron.md) | Corrected / clarified | `src/routes/sheet-sync-cron.routes.ts` |
| [routes-tariff-adjustments](recommendations/routes-tariff-adjustments.md) | Corrected / clarified | `src/routes/tariff-adjustments.routes.ts` |
| [routes-twilio-message-status](recommendations/routes-twilio-message-status.md) | Checked against source | `src/routes/twilio-message-status.routes.ts` |
| [routes-twilio-voice](recommendations/routes-twilio-voice.md) | Checked against source | `src/routes/twilio-voice.routes.ts` |
| [routes-v1](recommendations/routes-v1.md) | Corrected / clarified | `src/routes/v1.routes.ts` |
| [search-call-lead-browse](recommendations/search-call-lead-browse.md) | Corrected / clarified | `src/services/search/callLeadBrowse.service.ts` |
| [search-call-lead-search](recommendations/search-call-lead-search.md) | Corrected / clarified | `src/services/search/callLeadSearch.service.ts` |
| [search-form-lead-browse](recommendations/search-form-lead-browse.md) | Corrected / clarified | `src/services/search/formLeadBrowse.service.ts` |
| [search-form-lead-search](recommendations/search-form-lead-search.md) | Corrected / clarified | `src/services/search/formLeadSearch.service.ts` |
| [sheet-sync-batch-writer](recommendations/sheet-sync-batch-writer.md) | Checked against source | `src/services/sheetSync/drainer/batchWriter.ts` |
| [sheet-sync-coordinator](recommendations/sheet-sync-coordinator.md) | Checked against source | `src/services/sheetSync/sheetSyncCoordinator.ts` |
| [sheet-sync-job-planner](recommendations/sheet-sync-job-planner.md) | Corrected / clarified | `src/services/sheetSync/drainer/jobPlanner.ts` |
| [sheet-sync-outbox](recommendations/sheet-sync-outbox.md) | Checked against source | `src/services/sheetSync/sheetSyncOutbox.service.ts` |
| [sheet-sync-persistence](recommendations/sheet-sync-persistence.md) | Checked against source | `src/services/sheetSync/sheetSyncPersistence.ts` |
| [sheet-sync-queue](recommendations/sheet-sync-queue.md) | Checked against source | `src/services/sheetSync/sheetSyncQueue.service.ts` |
| [sheet-sync-quota-limiter](recommendations/sheet-sync-quota-limiter.md) | Checked against source | `src/services/sheetSync/drainer/quotaLimiter.ts` |
| [sheet-sync-run-sheet-sync-drain](recommendations/sheet-sync-run-sheet-sync-drain.md) | Corrected / clarified | `src/services/sheetSync/drainer/runSheetSyncDrain.ts` |
| [sheet-sync-source-lookup](recommendations/sheet-sync-source-lookup.md) | Corrected / clarified | `src/services/sheetSync/sheetSyncSourceLookup.ts` |
| [sheet-sync-tab-row-map](recommendations/sheet-sync-tab-row-map.md) | Checked against source | `src/services/sheetSync/drainer/tabRowMap.ts` |
| [tariff-append](recommendations/tariff-append.md) | Corrected / clarified | `src/services/tariff/append.ts` |
| [tariff-resolve-carrier](recommendations/tariff-resolve-carrier.md) | Checked against source | `src/services/tariff/resolveCarrier.ts` |
| [testimonials-testimonial-helpers](recommendations/testimonials-testimonial-helpers.md) | Corrected / clarified | `src/services/testimonials/testimonial.helpers.ts` |
| [testimonials-testimonial](recommendations/testimonials-testimonial.md) | Corrected / clarified | `src/services/testimonials/testimonial.service.ts` |

## Removed briefs — second pass upheld

No compatibility code or historical data was deleted. See the removal audit for target existence and evidence.

| Former recommendation | Reason |
| --- | --- |
| `admin-agent-browse-metrics.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `analytics-agent-sales-report.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `analytics-analytics-merge.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `best-relocation-sheet-ingest-application-plan.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-apply.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-bootstrap.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-canonical-lead-adoption.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-dry-run-reports.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-dry-run.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-identity.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-matching.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-parsing.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-plan.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-provider.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-sheets.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-source-change-policy.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `best-relocation-sheet-ingest-update-policy.md` | Best Relocation external sheet ingest is not live; its remaining files are not evidence of an active product. |
| `conversations-media.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `conversations-reads.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `conversations-redaction.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `conversations-seed-from-artifacts.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `granot-lifecycle-release-owner-commands.md` | Standalone Release-case workflow is retired. Runtime model/commands remain for historical compatibility/audit only; new Release evidence enters booking intake. No runtime code or historical data is removed. |
| `granot-lifecycle-release-reconciliation.md` | Standalone Release-case workflow is retired. Runtime model/commands remain for historical compatibility/audit only; new Release evidence enters booking intake. No runtime code or historical data is removed. |
| `historical-consolidation-apply.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-classification.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-date-parsing.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-manifest.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-migration-context.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-mongo-values.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-normalization.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-operational-lock.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-planner.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-rollback.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-schema-validation.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-stable-json.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-target-guard.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `historical-consolidation-verify.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `ingestion-apply-plan.md` | Best Relocation external sheet ingestion is not live; leftover runtime files are outside the active cleanup catalog. |
| `ingestion-health.md` | Best Relocation external sheet ingestion is not live; leftover runtime files are outside the active cleanup catalog. |
| `ingestion-queue.md` | Best Relocation external sheet ingestion is not live; leftover runtime files are outside the active cleanup catalog. |
| `ingestion-repository.md` | Best Relocation external sheet ingestion is not live; leftover runtime files are outside the active cleanup catalog. |
| `ingestion-worker.md` | Best Relocation external sheet ingestion is not live; leftover runtime files are outside the active cleanup catalog. |
| `models-external-data-connection.md` | Best Relocation external sheet ingestion is not live; the leftover connection model does not justify an active recommendation. |
| `models-granot-release-reconciliation-case.md` | Standalone Release-case workflow is retired. Runtime model/commands remain for historical compatibility/audit only; new Release evidence enters booking intake. No runtime code or historical data is removed. |
| `models-lead-conversation.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `observability-admin-observability.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-email-notification.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-notification-digest.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-notification-policy.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-operational-incident.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-operational-reports.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `observability-record-operational-event.md` | Retired Operational Events target is absent. This removal does not concern the live Operations Registry or Granot lifecycle logging. |
| `routes-best-relocation-ingestion-cron.md` | Best Relocation external sheet ingestion is not live. |
| `routes-conversations-admin.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
| `routes-ingestion.md` | Best Relocation external sheet ingestion is not live. |
| `routes-notification-cron.md` | Original target is absent from the current tree; the recommendation must not recreate it. See recorded target and retirement/catalog evidence. |
