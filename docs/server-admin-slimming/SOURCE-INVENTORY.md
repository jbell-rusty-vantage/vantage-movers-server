# Source reference inventory

Generated October 3, 2026 from the local source checkout. Read with CODE-MAP.md. Matches include protected callers, comments and legacy evidence; this is not a deletion allowlist. Runtime production counts and storage have not been measured.

## Server model collection declarations

```text
vantage-main-server/src/models\Agent.ts:33:    collection: "agents",
vantage-main-server/src/models\BookedLead.ts:97:    collection: "booked_leads",
vantage-main-server/src/models\BookingLeadReconciliationCase.ts:181:    collection: "booking_lead_reconciliation_cases",
vantage-main-server/src/models\CallInteraction.ts:235:    collection: "call_interactions",
vantage-main-server/src/models\CallLead.ts:165:    collection: "call_leads",
vantage-main-server/src/models\CancelledLead.ts:49:    collection: "cancelled_leads",
vantage-main-server/src/models\ContactNumber.ts:194:    collection: "contact_numbers",
vantage-main-server/src/models\CplCorrectionJob.ts:133:    collection: "cpl_correction_jobs",
vantage-main-server/src/models\CplLeadCorrection.ts:50:    collection: "cpl_lead_corrections",
vantage-main-server/src/models\CplRate.ts:20:    collection: "cpl_rates",
vantage-main-server/src/models\CplRatePeriod.ts:80:    collection: "cpl_rate_periods",
vantage-main-server/src/models\Customer.ts:11:    collection: "customers",
vantage-main-server/src/models\DomainCommandExecution.ts:63:    collection: "domain_command_executions",
vantage-main-server/src/models\DomainCommandExecution.ts:70:export const DOMAIN_COMMAND_EXECUTION_COLLECTION = "domain_command_executions";
vantage-main-server/src/models\EntityChange.ts:66:export const ENTITY_CHANGE_COLLECTION = "entity_changes";
vantage-main-server/src/models\EntityChange.ts:148:    collection: ENTITY_CHANGE_COLLECTION,
vantage-main-server/src/models\ExtensionUser.ts:32:    collection: "extension_users",
vantage-main-server/src/models\ExternalDataConnection.ts:63:    collection: "external_data_connections",
vantage-main-server/src/models\FormLead.ts:113:    collection: "form_leads",
vantage-main-server/src/models\GoogleDriveConnection.ts:26:    collection: "google_drive_connections",
vantage-main-server/src/models\GoogleOAuthState.ts:15:    collection: "google_oauth_states",
vantage-main-server/src/models\GooglePickerNonce.ts:21:    collection: "google_picker_nonces",
vantage-main-server/src/models\GooglePickerSelection.ts:26:    collection: "google_picker_selections",
vantage-main-server/src/models\GranotAutomationRun.ts:54:    collection: "granot_automation_runs",
vantage-main-server/src/models\GranotAutomationSource.ts:59:    collection: "granot_automation_sources",
vantage-main-server/src/models\GranotAutomationSource.ts:66:export const GRANOT_AUTOMATION_SOURCE_COLLECTION = "granot_automation_sources";
vantage-main-server/src/models\GranotBookingDiscrepancy.ts:22:export const GRANOT_BOOKING_DISCREPANCY_COLLECTION =
vantage-main-server/src/models\GranotBookingDiscrepancy.ts:41:  collection: GRANOT_BOOKING_DISCREPANCY_COLLECTION,
vantage-main-server/src/models\GranotBookingReconciliationCase.ts:86:export const GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION =
vantage-main-server/src/models\GranotBookingReconciliationCase.ts:278:      collection: GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
vantage-main-server/src/models\GranotCrmCsvIngestion.ts:64:    collection: "granot_crm_csv_ingestions",
vantage-main-server/src/models\GranotCrmSource.ts:25:export const GRANOT_CRM_SOURCE_COLLECTION = "granot_crm_sources";
vantage-main-server/src/models\GranotCrmSource.ts:167:    collection: GRANOT_CRM_SOURCE_COLLECTION,
vantage-main-server/src/models\GranotCrmSyncRun.ts:56:    collection: "granot_crm_sync_runs",
vantage-main-server/src/models\granotDiscrepancyModel.ts:90:  collection: string;
vantage-main-server/src/models\granotDiscrepancyModel.ts:175:      collection: input.collection,
vantage-main-server/src/models\GranotLifecycleActivation.ts:16:export const GRANOT_LIFECYCLE_ACTIVATION_COLLECTION =
vantage-main-server/src/models\GranotLifecycleActivation.ts:64:    collection: GRANOT_LIFECYCLE_ACTIVATION_COLLECTION,
vantage-main-server/src/models\GranotObservation.ts:109:export const GRANOT_OBSERVATION_COLLECTION = "granot_observations";
vantage-main-server/src/models\GranotObservation.ts:290:    collection: GRANOT_OBSERVATION_COLLECTION,
vantage-main-server/src/models\GranotObservationReceipt.ts:68:export const GRANOT_OBSERVATION_RECEIPT_COLLECTION = "granot_webhook_receipts";
vantage-main-server/src/models\GranotObservationReceipt.ts:209:    collection: GRANOT_OBSERVATION_RECEIPT_COLLECTION,
vantage-main-server/src/models\GranotRecordLink.ts:43:export const GRANOT_RECORD_LINK_COLLECTION = "granot_record_links";
vantage-main-server/src/models\GranotRecordLink.ts:161:    collection: GRANOT_RECORD_LINK_COLLECTION,
vantage-main-server/src/models\GranotReleaseDiscrepancy.ts:21:export const GRANOT_RELEASE_DISCREPANCY_COLLECTION =
vantage-main-server/src/models\GranotReleaseDiscrepancy.ts:40:  collection: GRANOT_RELEASE_DISCREPANCY_COLLECTION,
vantage-main-server/src/models\GranotReleaseReconciliationCase.ts:72:export const GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION =
vantage-main-server/src/models\GranotReleaseReconciliationCase.ts:259:      collection: GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
vantage-main-server/src/models\historical\Agent.ts:12:    collection: "agents",
vantage-main-server/src/models\IngestionConflict.ts:60:    collection: "ingestion_conflicts",
vantage-main-server/src/models\IngestionRun.ts:73:    collection: "ingestion_runs",
vantage-main-server/src/models\historical\BookedLead.ts:48:    collection: "booked_leads",
vantage-main-server/src/models\historical\CallLead.ts:46:    collection: "call_leads",
vantage-main-server/src/models\historical\CancelledLead.ts:27:    collection: "cancelled_leads",
vantage-main-server/src/models\historical\Customer.ts:11:    collection: "customers",
vantage-main-server/src/models\historical\FormLead.ts:39:    collection: "form_leads",
vantage-main-server/src/models\LeadConversation.ts:278:    collection: LEAD_CONVERSATION_COLLECTION,
vantage-main-server/src/models\LeadMessage.ts:180:    collection: "lead_messages",
vantage-main-server/src/models\LeadMessageRateLimit.ts:30:      collection: "lead_message_rate_limits",
vantage-main-server/src/models\LeadSourceCompany.ts:70:    collection: "lead_source_companies",
vantage-main-server/src/models\LeadSourceGranularity.ts:41:    collection: "lead_source_granularities",
vantage-main-server/src/models\LeadSourceLabelMapping.ts:75:    collection: "lead_source_label_mappings",
vantage-main-server/src/models\Merchant.ts:14:    collection: "merchants",
vantage-main-server/src/models\MovingCarrier.ts:26:    collection: "moving_carriers",
vantage-main-server/src/models\NumberLeadAttachment.ts:135:    collection: "number_lead_attachments",
vantage-main-server/src/models\OperationsRegistryChange.ts:60:    collection: "operations_registry_changes",
vantage-main-server/src/models\OwnerRepNudge.ts:106:    collection: "owner_rep_nudges",
vantage-main-server/src/models\PublicSubmissionThrottleBucket.ts:11:    collection: "public_submission_throttle_buckets",
vantage-main-server/src/models\RepIdentityLink.ts:72:    collection: "rep_identity_links",
vantage-main-server/src/models\ReportingDefinition.ts:20:    collection: "reporting_definitions",
vantage-main-server/src/models\ReportingDelivery.ts:110:    collection: "reporting_deliveries",
vantage-main-server/src/models\ReportingDefinitionRevision.ts:31:    collection: "reporting_definition_revisions",
vantage-main-server/src/models\ReportingDestination.ts:95:    collection: "reporting_destinations",
vantage-main-server/src/models\ReportingPreview.ts:28:    collection: "reporting_previews",
vantage-main-server/src/models\ReportingRun.ts:48:    collection: "reporting_runs",
vantage-main-server/src/models\ReportingRunConfirmation.ts:18:    collection: "reporting_run_confirmations",
vantage-main-server/src/models\ReportingRunManifest.ts:47:    collection: "reporting_run_manifests",
vantage-main-server/src/models\RingCentralInboundRoute.ts:63:    collection: "ringcentral_inbound_routes",
vantage-main-server/src/models\RingCentralInboundRouteAssignment.ts:43:    collection: "ringcentral_inbound_route_assignments",
vantage-main-server/src/models\salesIntelligence\assessment.ts:130:  { collection: "move_assessment_artifacts" },
vantage-main-server/src/models\salesIntelligence\attentionArtifact.ts:13:}, { collection: "sales_intelligence_attention_artifacts" });
vantage-main-server/src/models\salesIntelligence\capture.ts:35:  { collection: "call_interaction_aliases" },
vantage-main-server/src/models\salesIntelligence\capture.ts:105:  { collection: "ringcentral_directory_snapshots" },
vantage-main-server/src/models\salesIntelligence\capture.ts:240:  { collection: "sales_intelligence_sync_state" },
vantage-main-server/src/models\salesIntelligence\capture.ts:276:  { collection: "sales_intelligence_sync_windows" },
vantage-main-server/src/models\SheetSyncAttempt.ts:30:    collection: "sheet_sync_attempts",
vantage-main-server/src/models\SheetSyncJob.ts:81:    collection: "sheet_sync_jobs",
vantage-main-server/src/models\SheetSyncLease.ts:17:    collection: "sheet_sync_leases",
vantage-main-server/src/models\SheetSyncQuotaBucket.ts:21:    collection: "sheet_sync_quota_buckets",
vantage-main-server/src/models\SheetSyncRun.ts:28:    collection: "sheet_sync_runs",
vantage-main-server/src/models\SourceRowReceipt.ts:42:    collection: "source_row_receipts",
vantage-main-server/src/models\SourceRowState.ts:42:    collection: "source_row_states",
vantage-main-server/src/models\SynchronizationDecision.ts:74:export const SYNCHRONIZATION_DECISION_COLLECTION = "synchronization_decisions";
vantage-main-server/src/models\SynchronizationDecision.ts:196:    collection: SYNCHRONIZATION_DECISION_COLLECTION,
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:103:  { collection: "sales_intelligence_jobs" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:155:  { collection: "sales_intelligence_audit_events" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:189:  { collection: "sales_intelligence_command_executions" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:212:  { collection: "sales_intelligence_ai_budget" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:257:  { collection: "sales_intelligence_ai_reservations" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:274:  { collection: "sales_intelligence_policy_versions" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:291:  { collection: "sales_intelligence_policy_pointers" },
vantage-main-server/src/models\salesIntelligence\infrastructure.ts:355:  { collection: "sales_intelligence_attention_snapshots" },
vantage-main-server/src/models\Testimonial.ts:55:    collection: "testimonials",
vantage-main-server/src/models\WordpressFormSubmissionReceipt.ts:4:export const WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION =
vantage-main-server/src/models\WordpressFormSubmissionReceipt.ts:60:    collection: WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION,
vantage-main-server/src/models\salesIntelligence\intelligence.ts:123:  { collection: "intelligence_runs" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:274:  { collection: "intelligence_evidence_snapshots" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:295:  { collection: "intelligence_submissions" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:361:  { collection: "intelligence_findings" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:463:  { collection: "intelligence_effects" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:499:  { collection: "sales_intelligence_owner_instructions" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:523:  { collection: "intelligence_owner_assessments" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:569:  { collection: "sales_intelligence_review_items" },
vantage-main-server/src/models\salesIntelligence\intelligence.ts:600:  { collection: "sales_intelligence_contact_restrictions" },
vantage-main-server/src/models\salesIntelligence\outreach.ts:245:  { collection: "outreach_records" },
vantage-main-server/src/models\salesIntelligence\outreach.ts:362:  { collection: "outreach_followups" },
vantage-main-server/src/models\salesIntelligence\outreach.ts:423:  { collection: "outreach_band_transitions" },
vantage-main-server/src/models\salesIntelligence\overview.ts:38:  { collection: "outreach_rep_days" },
```

## Operational persistence consumers in runtime source

```text
vantage-main-server/src\app.ts:9:import { recordOperationalEvent } from "./services/observability";
vantage-main-server/src\app.ts:125:  void recordOperationalEvent({
vantage-main-server/src\middleware\requireApiSecret.ts:14:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\middleware\requireApiSecret.ts:294:  await recordOperationalEvent({
vantage-main-server/src\models\NotificationDelivery.ts:94:export function getNotificationDeliveryModel(): Model<NotificationDeliveryDocument> {
vantage-main-server/src\models\OperationalReportRun.ts:97:export function getOperationalReportRunModel(): Model<OperationalReportRunDocument> {
vantage-main-server/src\models\OperationalIncident.ts:129:export function getOperationalIncidentModel(): Model<OperationalIncidentDocument> {
vantage-main-server/src\models\OperationalEvent.ts:18: * `getOperationalEventModel()`; do not import the bare schema for writes.
vantage-main-server/src\models\OperationalEvent.ts:122:export function getOperationalEventModel(): Model<OperationalEventDocument> {
vantage-main-server/src\routes\conversations-admin.routes.ts:9:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\routes\conversations-admin.routes.ts:35:  auditAudio?: typeof recordOperationalEvent;
vantage-main-server/src\routes\conversations-admin.routes.ts:47:  const auditAudio = deps.auditAudio ?? recordOperationalEvent;
vantage-main-server/src\routes\best-relocation-ingestion-cron.routes.ts:14:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\routes\best-relocation-ingestion-cron.routes.ts:60:        await recordOperationalEvent({
vantage-main-server/src\services\bookings\bookedLead.service.ts:60:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\bookings\bookedLead.service.ts:416:    await recordOperationalEvent({
vantage-main-server/src\services\bookings\bookedLead.service.ts:456:  await recordOperationalEvent({
vantage-main-server/src\services\cancellations\cancelledLead.service.ts:33:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\cancellations\cancelledLead.service.ts:73:  await recordOperationalEvent({
vantage-main-server/src\services\crm\crm.service.ts:4:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\crm\crm.service.ts:60:  await recordOperationalEvent({
vantage-main-server/src\services\crm\crm.service.ts:96:      await recordOperationalEvent({
vantage-main-server/src\services\crm\crm.service.ts:108:      await recordOperationalEvent({
vantage-main-server/src\services\crm\crm.service.ts:150:    await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\bookingLeadReconciliation.service.ts:24:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\employeeBookings\bookingLeadReconciliation.service.ts:209:  await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\bookingLeadReconciliation.service.ts:395:  await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\bookingLeadReconciliation.service.ts:633:  await recordOperationalEvent({
vantage-main-server/src\services\leads\callLead.service.ts:59:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\leads\callLead.service.ts:230:  await recordOperationalEvent({
vantage-main-server/src\services\leads\callLead.service.ts:260:  await recordOperationalEvent({
vantage-main-server/src\services\leads\leadCplResolution.ts:6:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\leads\leadCplResolution.ts:76:  await recordOperationalEvent({
vantage-main-server/src\services\leads\formLead.service.ts:33:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\leads\formLead.service.ts:579:  await recordOperationalEvent({
vantage-main-server/src\services\leads\formLead.service.ts:601:    await recordOperationalEvent({
vantage-main-server/src\services\leads\formLead.service.ts:620:    await recordOperationalEvent({
vantage-main-server/src\services\leads\formLead.service.ts:637:    await recordOperationalEvent({
vantage-main-server/src\services\leads\leadLocation.service.ts:5:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\leads\leadLocation.service.ts:44:    await recordOperationalEvent({
vantage-main-server/src\services\leads\leadLocation.service.ts:100:    await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\submitEmployeeBooking.service.ts:14:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\employeeBookings\submitEmployeeBooking.service.ts:68:    await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\submitEmployeeBooking.service.ts:358:      await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\submitEmployeeBooking.service.ts:388:    await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\submitEmployeeBooking.service.ts:544:      await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\reconciliationRematch.service.ts:11:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\employeeBookings\reconciliationRematch.service.ts:268:        await recordOperationalEvent({
vantage-main-server/src\services\employeeBookings\reconciliationRematch.service.ts:283:    await recordOperationalEvent({
vantage-main-server/src\services\leadMessaging\leadMessaging.service.ts:35:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\leadMessaging\leadMessaging.service.ts:605:  await recordOperationalEvent({
vantage-main-server/src\services\leadMessaging\leadMessaging.service.ts:978:  await recordOperationalEvent({
vantage-main-server/src\services\leadMessaging\leadMessaging.service.ts:1017:  await recordOperationalEvent({
vantage-main-server/src\services\domainCommands\idempotency.ts:9:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\domainCommands\idempotency.ts:251:  await recordOperationalEvent({
vantage-main-server/src\routes\ringcentral-cron.routes.ts:4:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\routes\ringcentral-cron.routes.ts:108:        await recordOperationalEvent({
vantage-main-server/src\routes\notification-cron.routes.ts:5:  recordOperationalEvent,
vantage-main-server/src\routes\notification-cron.routes.ts:33:      void recordOperationalEvent({
vantage-main-server/src\routes\notification-cron.routes.ts:59:    void recordOperationalEvent({
vantage-main-server/src\routes\notification-cron.routes.ts:86:  void recordOperationalEvent({
vantage-main-server/src\routes\ringcentral-webhook.routes.ts:33:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\routes\ringcentral-webhook.routes.ts:472:    await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingAudit.ts:2:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\reporting\reportingAudit.ts:68:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:1:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\reporting\reportingObservability.ts:24:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:44:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:67:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:91:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:113:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:132:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:151:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:170:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:192:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:218:  await recordOperationalEvent({
vantage-main-server/src\services\reporting\reportingObservability.ts:244:  await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\sheetSyncQueue.service.ts:7:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\sheetSync\sheetSyncQueue.service.ts:90:    await recordOperationalEvent({
vantage-main-server/src\routes\v1.routes.ts:27:  recordOperationalEvent,
vantage-main-server/src\routes\v1.routes.ts:3012:  await recordOperationalEvent({
vantage-main-server/src\routes\twilio-voice.routes.ts:10:import { recordOperationalEvent } from "../services/observability";
vantage-main-server/src\routes\twilio-voice.routes.ts:28:  await recordOperationalEvent({
vantage-main-server/src\routes\twilio-voice.routes.ts:100:  await recordOperationalEvent({
vantage-main-server/src\services\googleMaps\geocoding.ts:9:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\googleMaps\geocoding.ts:110:        await recordOperationalEvent({
vantage-main-server/src\services\googleMaps\geocoding.ts:134:      await recordOperationalEvent({
vantage-main-server/src\services\ingestion\health.ts:1:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\ingestion\health.ts:93:  await recordOperationalEvent({
vantage-main-server/src\services\operationsRegistry\cplCorrections.ts:27:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\cplCorrections.ts:318:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\operationsRegistry\cplCorrections.ts:903:  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
vantage-main-server/src\services\operationsRegistry\cplCorrections.ts:932:  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
vantage-main-server/src\services\operationsRegistry\cplCorrections.ts:2053:    await recordOperationalEvent({
vantage-main-server/src\services\ingestion\worker.ts:13:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\ingestion\worker.ts:688:  await recordOperationalEvent({
vantage-main-server/src\services\observability\adminObservability.service.ts:4:  getOperationalEventModel,
vantage-main-server/src\services\observability\adminObservability.service.ts:8:  getOperationalIncidentModel,
vantage-main-server/src\services\observability\adminObservability.service.ts:12:  getOperationalReportRunModel,
vantage-main-server/src\services\observability\adminObservability.service.ts:29:  getNotificationDeliveryModel,
vantage-main-server/src\services\observability\adminObservability.service.ts:35:import { recordOperationalEvent } from "./recordOperationalEvent";
vantage-main-server/src\services\observability\adminObservability.service.ts:236:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:266:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:274:    const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:285:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:315:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:321:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:322:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:348:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:369:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:461:    return getOperationalEventModel() as Model<ObservabilityDeleteDocument>;
vantage-main-server/src\services\observability\adminObservability.service.ts:464:    return getOperationalIncidentModel() as Model<ObservabilityDeleteDocument>;
vantage-main-server/src\services\observability\adminObservability.service.ts:467:    return getNotificationDeliveryModel() as Model<ObservabilityDeleteDocument>;
vantage-main-server/src\services\observability\adminObservability.service.ts:469:  return getOperationalReportRunModel() as Model<ObservabilityDeleteDocument>;
vantage-main-server/src\services\observability\adminObservability.service.ts:517:  await recordOperationalEvent({
vantage-main-server/src\services\observability\adminObservability.service.ts:538:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:579:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:580:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:581:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:697:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:739:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\adminObservability.service.ts:771:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\emailNotification.service.ts:12:  getNotificationDeliveryModel,
vantage-main-server/src\services\observability\emailNotification.service.ts:127:    const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\emailNotification.service.ts:208:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\emailNotification.service.ts:331:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\ringcentral\analytics-reconcile.service.ts:2:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\ringcentral\analytics-reconcile.service.ts:103:  await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:9:import { recordOperationalEvent } from "../../observability";
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:227:        await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:290:      await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:302:      await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:337:    await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:638:  await recordOperationalEvent({
vantage-main-server/src\services\sheetSync\drainer\runSheetSyncDrain.ts:657:    await recordOperationalEvent({
vantage-main-server/src\services\numberActivity\callLogRefresh.ts:7:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\callLogRefresh.ts:288:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\callLogRefresh.ts:305:  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
vantage-main-server/src\services\numberActivity\callLogRefresh.ts:517:  recordEvent: typeof recordOperationalEvent,
vantage-main-server/src\services\granotLifecycle\alerts.ts:2:import { getOperationalIncidentModel } from "../../models/OperationalIncident";
vantage-main-server/src\services\granotLifecycle\alerts.ts:206:    const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\numberActivity\callLogSweep.ts:8:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\callLogSweep.ts:84:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\callLogSweep.ts:209:    recordEvent: recordOperationalEvent,
vantage-main-server/src\services\numberActivity\captureProjectionWorker.ts:4:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\captureProjectionWorker.ts:103:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\captureProjectionWorker.ts:203:      await (deps.recordEvent ?? recordOperationalEvent)({
vantage-main-server/src\services\observability\testObservabilitySink.ts:2:import type { RecordOperationalEventInput } from "./recordOperationalEvent";
vantage-main-server/src\services\observability\recordOperationalEvent.ts:15:  getOperationalEventModel,
vantage-main-server/src\services\observability\recordOperationalEvent.ts:113:export async function recordOperationalEvent(
vantage-main-server/src\services\observability\recordOperationalEvent.ts:178:    const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\recordOperationalEvent.ts:274:        await recordOperationalEvent({
vantage-main-server/src\services\observability\recordOperationalEvent.ts:313:export async function recordOperationalEventsBulk(
vantage-main-server/src\services\observability\recordOperationalEvent.ts:328:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:3:import { getNotificationDeliveryModel } from "../../models/NotificationDelivery";
vantage-main-server/src\services\observability\operationalReports.service.ts:4:import { getOperationalEventModel } from "../../models/OperationalEvent";
vantage-main-server/src\services\observability\operationalReports.service.ts:5:import { getOperationalIncidentModel } from "../../models/OperationalIncident";
vantage-main-server/src\services\observability\operationalReports.service.ts:7:  getOperationalReportRunModel,
vantage-main-server/src\services\observability\operationalReports.service.ts:84:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:127:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:173:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:205:      const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:229:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:255:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:284:      const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:285:      const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:286:      const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:398:  const ReportRun = getOperationalReportRunModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:457:  const ReportRun = getOperationalReportRunModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:483:  const ReportRun = getOperationalReportRunModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:493:  const ReportRun = getOperationalReportRunModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:517:  const Event = getOperationalEventModel();
vantage-main-server/src\services\observability\operationalReports.service.ts:518:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\operationalIncident.service.ts:7:  getOperationalIncidentModel,
vantage-main-server/src\services\observability\operationalIncident.service.ts:71:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\operationalIncident.service.ts:147:  const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\notificationPolicy.ts:14:  getOperationalIncidentModel,
vantage-main-server/src\services\observability\notificationPolicy.ts:22: * Inline notification policy evaluated by `recordOperationalEvent` after an
vantage-main-server/src\services\observability\notificationPolicy.ts:172: * never thrown. The caller (`recordOperationalEvent`) records a
vantage-main-server/src\services\observability\notificationPolicy.ts:235:    const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\notificationPolicy.ts:254:    const Incident = getOperationalIncidentModel();
vantage-main-server/src\services\observability\notificationDigest.service.ts:7:import { getNotificationDeliveryModel } from "../../models/NotificationDelivery";
vantage-main-server/src\services\observability\notificationDigest.service.ts:98:  const Delivery = getNotificationDeliveryModel();
vantage-main-server/src\services\observability\index.ts:6:  recordOperationalEvent,
vantage-main-server/src\services\observability\index.ts:7:  recordOperationalEventsBulk,
vantage-main-server/src\services\observability\index.ts:9:} from "./recordOperationalEvent";
vantage-main-server/src\services\ringcentral\call-log-sync.service.ts:2:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\ringcentral\call-log-sync.service.ts:124:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\ringcentral\call-log-sync.service.ts:145:  recordEvent: recordOperationalEvent,
vantage-main-server/src\services\salesIntelligence\nudges\commands.ts:14:import { recordOperationalEvent, type RecordOperationalEventInput } from "../../observability";
vantage-main-server/src\services\salesIntelligence\nudges\commands.ts:30:  await recordOperationalEvent({ level: ["sent", "fallback_sent"].includes(status) ? "info" : "error", eventKey: `sales_intelligence.nudge.${status}`,
vantage-main-server/src\services\salesIntelligence\nudges\commands.ts:44:      await recordOperationalEvent(nudgeDestinationRejectionEvent(command.nudge.outreach_record_id, error.code));
vantage-main-server/src\services\salesIntelligence\conversations\workerSupport.ts:6:import { recordOperationalEvent } from "../../observability";
vantage-main-server/src\services\salesIntelligence\conversations\workerSupport.ts:11:    await recordOperationalEvent({ level: outcome === "media_stored" ? "info" : "warn",
vantage-main-server/src\services\numberActivity\directorySync.ts:9:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\directorySync.ts:172:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\directorySync.ts:197:    recordEvent: recordOperationalEvent,
vantage-main-server/src\services\operationsRegistry\labelMappings.ts:10:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\labelMappings.ts:492:    await recordOperationalEvent({
vantage-main-server/src\services\salesIntelligence\ownerCoverage.ts:26:import { getOperationalEventModel } from "../../models/OperationalEvent";
vantage-main-server/src\services\salesIntelligence\ownerCoverage.ts:538:      ? getOperationalEventModel()
vantage-main-server/src\services\operationsRegistry\ringCentralRegistry.ts:8:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\ringCentralRegistry.ts:321:    await recordOperationalEvent({
vantage-main-server/src\services\operationsRegistry\ringCentralSnapshot.ts:10:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\ringCentralSnapshot.ts:95:      await recordOperationalEvent({
vantage-main-server/src\services\operationsRegistry\queries\health.ts:23:import { getOperationalEventModel } from "../../../models/OperationalEvent";
vantage-main-server/src\services\operationsRegistry\queries\health.ts:108:    getOperationalEventModel()
vantage-main-server/src\services\operationsRegistry\queries\health.ts:122:    getOperationalEventModel()
vantage-main-server/src\services\operationsRegistry\runtimeTelemetry.ts:1:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\runtimeTelemetry.ts:105:    const persisted = await recordOperationalEvent({
vantage-main-server/src\services\operationsRegistry\queries\overview.ts:8:import { getOperationalEventModel } from "../../../models/OperationalEvent";
vantage-main-server/src\services\operationsRegistry\queries\overview.ts:50:    getOperationalEventModel()
vantage-main-server/src\services\numberActivity\observeWebhookEvents.ts:2:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\observeWebhookEvents.ts:32:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\observeWebhookEvents.ts:100:  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
vantage-main-server/src\services\operationsRegistry\sourceRegistry.ts:13:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\operationsRegistry\sourceRegistry.ts:657:    await recordOperationalEvent({
vantage-main-server/src\services\operationsRegistry\sourceRegistry.ts:677:  await recordOperationalEvent({
vantage-main-server/src\services\numberActivity\reconcileCallLog.ts:7:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\reconcileCallLog.ts:222:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\reconcileCallLog.ts:276:    recordEvent: recordOperationalEvent,
vantage-main-server/src\services\granotLifecycle\drainer.ts:13:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\webhookFanout.ts:8:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\webhookFanout.ts:104:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\webhookFanout.ts:123:    await (deps.recordEvent ?? recordOperationalEvent)({
vantage-main-server/src\services\numberActivity\webhookFanout.ts:161:    await (deps.recordEvent ?? recordOperationalEvent)({
vantage-main-server/src\services\numberActivity\webhookFanout.ts:273:      await (deps.recordEvent ?? recordOperationalEvent)({
vantage-main-server/src\services\numberActivity\webhookFanout.ts:292:    await (deps.recordEvent ?? recordOperationalEvent)({
vantage-main-server/src\services\ringcentral\ringcentral-call-lead-ingest.service.ts:4:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\ringcentral\ringcentral-call-lead-ingest.service.ts:99:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\ringcentral\ringcentral-call-lead-ingest.service.ts:112:  recordEvent: recordOperationalEvent,
vantage-main-server/src\services\numberActivity\webhookRecovery.ts:7:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\webhookRecovery.ts:95:  recordEvent: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\webhookRecovery.ts:123:    recordEvent: recordOperationalEvent,
vantage-main-server/src\services\numberActivity\webhookSubscriptionCron.ts:3:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\numberActivity\webhookSubscriptionCron.ts:45:  recordEvent?: typeof recordOperationalEvent;
vantage-main-server/src\services\numberActivity\webhookSubscriptionCron.ts:53:  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
vantage-main-server/src\services\granotLifecycle\liveReceipts.ts:6:import { recordOperationalEvent } from "../observability";
vantage-main-server/src\services\granotLifecycle\liveReceipts.ts:241:  await recordOperationalEvent({
vantage-main-server/src\services\granotLifecycle\observability.ts:2:  recordOperationalEvent,
vantage-main-server/src\services\granotLifecycle\observability.ts:258:    await recordOperationalEvent({
vantage-main-server/src\services\granotLifecycle\operations.ts:9:import { getOperationalEventModel } from "../../models/OperationalEvent";
vantage-main-server/src\services\granotLifecycle\operations.ts:422:  await getOperationalEventModel().create(
vantage-main-server/src\services\granotLifecycle\operations.ts:475:  await getOperationalEventModel().create(
vantage-main-server/src\services\granotLifecycle\projections.ts:15:import { getOperationalEventModel } from "../../models/OperationalEvent";
vantage-main-server/src\services\granotLifecycle\projections.ts:2062:    getOperationalEventModel()
vantage-main-server/src\services\granotLifecycle\projections.ts:2073:    getOperationalEventModel().countDocuments({
vantage-main-server/src\services\granotLifecycle\projections.ts:2077:    getOperationalEventModel().countDocuments({
vantage-main-server/src\services\granotLifecycle\projections.ts:2336:  const row = await getOperationalEventModel()
```

## Historical database scope consumers

```text
vantage-main-server/src\services\admin\adminScope.service.ts:9:// Historical models target the separate vantagemovershistorical DB and are only
vantage-main-server/src\services\admin\adminScope.service.ts:11:import { registerHistoricalModels } from "../../models/historical";
vantage-main-server/src\services\admin\adminScope.service.ts:26:  if (scope === "historical") {
vantage-main-server/src\services\admin\adminScope.service.ts:27:    const historical = registerHistoricalModels();
vantage-main-server/src\services\admin\adminScope.service.ts:51:  return scope === "combined" ? ["production", "historical"] : [scope];
vantage-main-server/src\services\admin\adminScope.service.ts:57:  if (scope === "combined") {
vantage-main-server/src\models\historical\index.ts:9:export const HISTORICAL_DATABASE_NAME = "vantagemovershistorical";
vantage-main-server/src\models\historical\index.ts:15:export function registerHistoricalModels(connection: Connection = getHistoricalConnection()) {
vantage-main-server/src\models\historical\index.ts:27:  models: ReturnType<typeof registerHistoricalModels>,
vantage-main-server/src\services\admin\adminBrowse.service.ts:216:  if (query.database_scope === "combined") {
vantage-main-server/src\services\admin\adminBrowse.service.ts:569:    (scope === "historical" || row?.origin === "historical_distinct") &&
vantage-main-server/src\services\admin\adminBrowse.service.ts:588:  if (row?.origin === "historical_distinct" || scope === "historical" || companySlug) {
vantage-main-server/src\services\admin\adminBrowse.service.ts:758:  if (scope === "historical" || items.length === 0) {
vantage-main-server/src\services\admin\adminFacets.service.ts:41:  if (scope === "combined") {
vantage-main-server/src\services\analytics\analytics.service.ts:48:  const data = query.database_scope === "combined" ? mergeAnalyticsPayload(report, payloads) : payloads[0];
vantage-main-server/src\services\analytics\analytics.service.ts:89:      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentPerformance(models, query);
vantage-main-server/src\services\analytics\analytics.service.ts:91:      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentTrend(models, query);
vantage-main-server/src\services\analytics\analytics.service.ts:93:      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentSourceBreakdown(models, query);
vantage-main-server/src\services\analytics\analytics.service.ts:95:      return scope === "historical" ? unsupportedSmsConversionReport() : getSmsSuccessfullySentThenBooked(models, query);
vantage-main-server/src\services\analytics\sourceHierarchy.ts:90:  if (query.database_scope === "historical" && !hasGranularityKeys) {
vantage-main-server/src\services\historicalConsolidation\types.ts:70:    database: "vantagemovershistorical" | "vantagemovers";
vantage-main-server/src\services\historicalConsolidation\planner.ts:82:  const historical = snapshotDb(input.snapshot, "vantagemovershistorical");
vantage-main-server/src\services\historicalConsolidation\planner.ts:675:function snapshotDb(snapshot: HistoricalSnapshot, name: "vantagemovers" | "vantagemovershistorical") { const database = snapshot.mongo.find((entry) => entry.database === name); if (!database) throw new Error(`Snapshot is missing ${name}`); return database; }
vantage-admin/components\analytics\analytics-dashboard.tsx:438:  if (scope === "historical") {
vantage-admin/components\analytics\analytics-dashboard.tsx:441:  if (scope === "combined") {
vantage-admin/components\analytics\analytics-dashboard.tsx:488:        value={filters.database_scope === "historical" ? "N/A" : `${(receiverCoverage * 100).toFixed(1)}%`}
vantage-admin/components\analytics\analytics-dashboard.tsx:489:        hint={filters.database_scope === "combined" ? "Production coverage; historical unavailable" : "Production received leads"}
vantage-admin/components\operational\operational-configs.ts:444:      .filter((field) => !(options.scope === "historical" && field.key === "receiver_agent"))
vantage-admin/components\operational\operational-detail-panel.tsx:591:  const effectiveScope = scope === "combined" ? "production" : scope;
vantage-admin/components\operational\operational-resource-page.tsx:179:    if (scope === "historical" && filters.receiver_agent) {
vantage-admin/components\operational\operational-resource-page.tsx:188:    database_scope: filters.database_scope === "combined" ? "production" : filters.database_scope,
vantage-admin/components\operational\operational-resource-page.tsx:197:  const readOnly = Boolean(config.readOnly) || effectiveFilters.database_scope === "historical";
vantage-admin/components\operational\operational-resource-page.tsx:460:      {effectiveFilters.database_scope === "historical" ? (
vantage-admin/lib\api\admin.ts:348:  const detailScope = scope === "combined" ? "production" : scope;
```

## Server production AI provider callsites

```text
vantage-main-server/src\services\conversations\transcriptionProvider.ts:69:      const { createGateway } = await import("@ai-sdk/gateway");
vantage-main-server/src\services\salesIntelligence\analysis\structuredRuntime.ts:68:  const { createGateway } = await import("@ai-sdk/gateway");
vantage-main-server/src\services\salesIntelligence\analysis\structuredGeneration.ts:82:  const { generateObject, NoObjectGeneratedError } = await import("ai");
vantage-main-server/src\services\salesIntelligence\analysis\structuredGeneration.ts:104:        const result = await generateObject({ model: input.model, schema: providerSchema, maxRetries: 0,
vantage-main-server/src\services\salesIntelligence\analysis\runtime.ts:1:import type { MCPClient, CallToolResult } from "@ai-sdk/mcp" with { "resolution-mode": "import" };
vantage-main-server/src\services\salesIntelligence\analysis\runtime.ts:114:  const { createMCPClient } = await import("@ai-sdk/mcp");
vantage-main-server/src\services\salesIntelligence\analysis\runtime.ts:115:  const { ToolLoopAgent, isStepCount, tool, jsonSchema } = await import("ai");
vantage-main-server/src\services\salesIntelligence\analysis\runtime.ts:116:  const { createGateway } = await import("@ai-sdk/gateway");
vantage-main-server/src\services\salesIntelligence\analysis\runtime.ts:252:    const agent = new ToolLoopAgent({ model, tools, instructions: input.prompt, maxRetries: 0, maxOutputTokens: limits.output_tokens,
vantage-main-server/src\services\salesIntelligence\assessment\generate.ts:118:  const { generateObject, NoObjectGeneratedError } = await import("ai");
vantage-main-server/src\services\salesIntelligence\assessment\generate.ts:119:  const model = input.model ?? (await import("@ai-sdk/gateway")).createGateway({ apiKey: input.gateway_key })(input.model_id);
vantage-main-server/src\services\salesIntelligence\assessment\generate.ts:154:        const result = await generateObject({ model, schema: providerSchema, maxRetries: 0,
```

## Admin audit producers and consumers

```text
vantage-admin/components\operational\operational-resource-page.tsx:419:      setExportMessage("CSV export downloaded and audit logged.");
vantage-admin/app\api\proxy\[...path]\route.ts:13:import { writeAuditLog, buildProxyAuditRequestPayload, proxyAuditPathname } from "@/server/audit";
vantage-admin/app\api\proxy\[...path]\route.ts:141:    await writeAuditLog({
vantage-admin/server\audit\index.ts:8:export { redactPayload, writeAuditLog, type AuditAction, type AuditLogInput } from "./auditLog";
vantage-admin/server\audit\auditLog.ts:3:import { AdminAuditLog } from "@/server/models";
vantage-admin/server\audit\auditLog.ts:37:export async function writeAuditLog(input: AuditLogInput): Promise<void> {
vantage-admin/server\audit\auditLog.ts:40:  await AdminAuditLog.create({
vantage-admin/server\models\AdminAuditLog.ts:3:const AdminAuditLogSchema = new Schema(
vantage-admin/server\models\AdminAuditLog.ts:21:    collection: "admin_audit_logs",
vantage-admin/server\models\AdminAuditLog.ts:26:AdminAuditLogSchema.index({ timestamp: -1 });
vantage-admin/server\models\AdminAuditLog.ts:27:AdminAuditLogSchema.index({ admin_user_id: 1, timestamp: -1 });
vantage-admin/server\models\AdminAuditLog.ts:28:AdminAuditLogSchema.index({ action: 1, timestamp: -1 });
vantage-admin/server\models\AdminAuditLog.ts:30:export type AdminAuditLogDocument = InferSchemaType<typeof AdminAuditLogSchema> & {
vantage-admin/server\models\AdminAuditLog.ts:34:export const AdminAuditLog: Model<AdminAuditLogDocument> =
vantage-admin/server\models\AdminAuditLog.ts:35:  mongoose.models.AdminAuditLog ??
vantage-admin/server\models\AdminAuditLog.ts:36:  mongoose.model<AdminAuditLogDocument>("AdminAuditLog", AdminAuditLogSchema);
vantage-admin/app\api\auth\refresh\route.ts:11:import { writeAuditLog } from "@/server/audit";
vantage-admin/app\api\auth\refresh\route.ts:28:    await writeAuditLog({
vantage-admin/app\api\auth\logout\route.ts:9:import { writeAuditLog } from "@/server/audit";
vantage-admin/app\api\auth\logout\route.ts:20:  await writeAuditLog({
vantage-admin/app\api\auth\login\route.ts:9:import { writeAuditLog } from "@/server/audit";
vantage-admin/app\api\auth\login\route.ts:29:      await writeAuditLog({
vantage-admin/app\api\auth\login\route.ts:43:      await writeAuditLog({
vantage-admin/app\api\auth\login\route.ts:58:    await writeAuditLog({
vantage-admin/app\api\auth\login\route.ts:70:    await writeAuditLog({
vantage-admin/server\models\index.ts:1:export { AdminAuditLog } from "./AdminAuditLog";
vantage-admin/app\api\audit-log\route.ts:5:import { AdminAuditLog } from "@/server/models/AdminAuditLog";
vantage-admin/app\api\audit-log\route.ts:51:    AdminAuditLog.find(query)
vantage-admin/app\api\audit-log\route.ts:56:    AdminAuditLog.countDocuments(query),
vantage-admin/server\users\wiring.ts:12:import { writeAuditLog } from "@/server/audit";
vantage-admin/server\users\wiring.ts:28:        await writeAuditLog({
```

## Numbers coupling and producer seams

```text
vantage-main-server/src/services/granotLifecycle/processor.ts:202:  /** AC6-WAKE seam: post-commit Outreach wake-up after a Lead EntityChange (default `wakeOutreachAfterGranotApply`). */
vantage-main-server/src/services/granotLifecycle/processor.ts:237:      await boundedOutreachWake(() => (deps.wakeOutreach ?? wakeOutreachAfterGranotApply)(result), result.observation_id,
vantage-main-server/src/services/granotLifecycle/processor.ts:284:export async function wakeOutreachAfterGranotApply(
vantage-main-server/src/services/salesIntelligence/attachment\hooks.ts:4:import { reactToAttachmentChanged } from "../outreach/ensure";
vantage-main-server/src/services/salesIntelligence/attachment\hooks.ts:10:  await reactToAttachmentChanged(change, session);
vantage-main-server/src/services/salesIntelligence/attachment\hooks.ts:27:  if (!after) await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `outreach-number:${change.number_id}`,
vantage-main-server/src/services/salesIntelligence/attachment\hooks.ts:32:  for (const row of rows) await enqueueCsiJob({ stage: "recording_discovery", subject_key: `interaction:${row._id}`,
vantage-main-server/src/services/salesIntelligence/attachment\hooks.ts:33:    dedupe_key: `csi:recording_discovery:interaction:${row._id}:attachment:${change.number_id}:${change.revision}`,
vantage-main-server/src/services/numberActivity\dto.ts:77: * resolved display Lead, from `loadAttachedLeadProgressForNumbers` in
vantage-main-server/src/services/numberActivity\contactNumbers.ts:8:import { readNumberOutreach } from "../salesIntelligence/outreach/reads";
vantage-main-server/src/services/numberActivity\contactNumbers.ts:150: * handed to `readNumberOutreach`, which reads restrictions, review items and the
vantage-main-server/src/services/numberActivity\contactNumbers.ts:176:  const { attached_lead_progress: attached, ...outreachData } = await readNumberOutreach(numberId, { edges: attachments, number: row, now, coverage });
vantage-main-server/src/services/numberActivity\persistInteraction.ts:708:    const key = `csi:outreach_ensure:interaction:${interactionId}:${revision}`;
vantage-main-server/src/services/numberActivity\persistInteraction.ts:712:        stage: "outreach_ensure",
vantage-main-server/src/services/numberActivity\persistInteraction.ts:742:      const key = `csi:recording_discovery:interaction:${interactionId}:recording:${recordingId}`;
vantage-main-server/src/services/numberActivity\persistInteraction.ts:746:          stage: "recording_discovery",
vantage-main-server/src/services/numberActivity\persistInteraction.ts:758:      const key = `csi:recording_discovery:interaction:${interactionId}:pending`;
vantage-main-server/src/services/numberActivity\persistInteraction.ts:762:          stage: "recording_discovery",
vantage-main-server/src/services/numberActivity\coverage.ts:169:    getCallInteractionModel().countDocuments({ merged_into_id: null, terminal: true, "recordings.0": { $exists: false }, direction: { $ne: "Internal" }, "recording_discovery.state": { $ne: "no_recording" } }),
vantage-main-server/src/services/numberActivity\coverage.ts:170:    getCallInteractionModel().countDocuments({ merged_into_id: null, "recording_discovery.state": "no_recording" }),
vantage-main-server/src/services/numberActivity\webhookFanout.ts:140: * `outreach_ensure` job the Granot lifecycle processor enqueues after it commits a
vantage-main-server/src/services/numberActivity\search.ts:9:import { loadAttachedLeadProgressForNumbers } from "../salesIntelligence/outreach/reads";
vantage-main-server/src/services/numberActivity\search.ts:616:  const loadAttached = deps.attachedLeadProgress ?? loadAttachedLeadProgressForNumbers;
vantage-main-server/src/services/numberActivity\jobDispatch.ts:52:    recording_discovery: (jobId) => runRecordingDiscoveryJob(jobId),
vantage-main-server/src/services/numberActivity\jobDispatch.ts:56:    outreach_ensure: (jobId) => runOutreachEnsureJob(jobId),
```
