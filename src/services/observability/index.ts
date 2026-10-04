/**
 * Public surface for the operational observability layer. Instrumentation in
 * domain services should import from here.
 */
export {
  recordOperationalEvent,
  recordOperationalEventsBulk,
  type RecordOperationalEventInput,
} from "./recordOperationalEvent";
export {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
  installTestObservabilitySink,
  isTestObservabilitySinkActive,
  type CapturedOperationalEvent,
} from "./testObservabilitySink";
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
