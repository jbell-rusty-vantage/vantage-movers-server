/**
 * Public surface for the operational observability layer. Instrumentation in
 * domain services should import from here.
 */
export {
  recordOperationalEvent,
  recordOperationalEventsBulk,
  type RecordOperationalEventInput,
} from "./recordOperationalEvent";
export { sendNotification } from "./emailNotification.service";
export { dispatchEventNotifications } from "./notificationPolicy";
export {
  autoResolveIncidents,
  upsertIncidentForEvent,
} from "./operationalIncident.service";
export { sanitizeEventDetails } from "./operationalEventSanitizer";
export { normalizeLeadIdentity } from "./leadIdentity";
export { buildRequestEventContext } from "./requestEventContext";
export { computeFingerprint, buildDedupeKey } from "./fingerprint";
export {
  getObservabilityOverview,
  getObservabilityFacets,
  listOperationalEvents,
  getOperationalEventDetail,
  listOperationalIncidents,
  getOperationalIncidentDetail,
  updateOperationalIncidentStatus,
  updateOperationalIncidentStatuses,
  deleteObservabilityRecord,
  deleteObservabilityRecords,
  listNotificationDeliveries,
  exportOperationalEventsCsv,
  exportOperationalIncidentsCsv,
} from "./adminObservability.service";
export {
  runOperationalReport,
  listOperationalReportRuns,
  getOperationalReportRunDetail,
  exportReportRunCsv,
  computeResultHash,
  canonicalize,
  isOperationalReportKey,
  OPERATIONAL_REPORT_KEYS,
  type OperationalReportKey,
} from "./operationalReports.service";
export {
  sendDailyOwnerDigest,
  retryFailedNotifications,
} from "./notificationDigest.service";
