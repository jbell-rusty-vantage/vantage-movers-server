import {
  getAlertEmailImmediateLevels,
  getAlertEmailMinLevel,
  getAlertEmailOwnerEvents,
  getAlertEmailThrottleMinutes,
  isEmailNotificationsEnabled,
  isObservabilityEnabled,
  observabilityLevelRank,
  type ObservabilityLevel,
} from "../../config/domain/observability";
import { getSendgridConfig } from "../../config/domain/observability";
import { logger } from "../../logger";
import {
  getOperationalIncidentModel,
  type OperationalIncidentDocument,
} from "../../models/OperationalIncident";
import type { OperationalEventDocument } from "../../models/OperationalEvent";
import { sendNotification, type SendNotificationResult } from "./emailNotification.service";
import type { NotificationRecipientType } from "../../config/domain/observability";

/**
 * Inline notification policy evaluated by `recordOperationalEvent` after an
 * event (and its incident) are persisted.
 *
 * Responsibilities:
 *   - decide whether an event warrants an immediate owner/developer email,
 *   - throttle repeated identical alerts via the incident's `next_notify_at`,
 *   - render a short, factual subject/body,
 *   - update incident notification state.
 *
 * Digest emails are NOT sent here; the daily-digest cron queries events and
 * sends a single summary. This module only handles immediate + throttled
 * alerts. It never throws and never re-notifies for `notification.*` events
 * (loop prevention).
 */

/** Technical events routed to developers rather than the owner. */
const DEVELOPER_ONLY_EVENT_KEYS = new Set<string>([
  "http.request.5xx",
  "queue.consumer.failed",
  "sheet_sync.queue.publish_failed",
  "cron.trigger.failed",
  "cron.auth.failed",
]);

type NotifyPosture = "immediate_owner" | "immediate_developer" | "none";

function resolvePosture(event: OperationalEventDocument): NotifyPosture {
  // Never email about notification failures (alert-loop prevention).
  if (event.category === "notification" || event.event_key.startsWith("notification.")) {
    return "none";
  }

  const ownerEvents = getAlertEmailOwnerEvents();
  const immediateLevels = getAlertEmailImmediateLevels();
  const minLevelRank = observabilityLevelRank(getAlertEmailMinLevel());
  const isDeveloperOnly = DEVELOPER_ONLY_EVENT_KEYS.has(event.event_key);

  // Owner business milestones / configured owner events.
  if (ownerEvents.includes(event.event_key)) {
    return isDeveloperOnly ? "immediate_developer" : "immediate_owner";
  }

  // Severity-driven immediate alerts.
  const levelRank = observabilityLevelRank(event.level as ObservabilityLevel);
  const isImmediateLevel = immediateLevels.includes(event.level as ObservabilityLevel);
  const meetsMinLevel = levelRank >= minLevelRank;

  if (isImmediateLevel || (meetsMinLevel && event.notification_candidate)) {
    return isDeveloperOnly ? "immediate_developer" : "immediate_owner";
  }

  return "none";
}

function recipientsFor(
  type: NotificationRecipientType,
): { to: string[]; recipientType: NotificationRecipientType } {
  const { ownerToEmails, developerToEmails } = getSendgridConfig();
  if (type === "developer") {
    if (developerToEmails.length > 0) {
      return { to: developerToEmails, recipientType: "developer" };
    }
    return { to: ownerToEmails, recipientType: "owner" };
  }
  return { to: ownerToEmails, recipientType: "owner" };
}

function isSuccessMilestone(level: ObservabilityLevel): boolean {
  return level === "info" || level === "debug";
}

function buildSubject(event: OperationalEventDocument): string {
  if (isSuccessMilestone(event.level as ObservabilityLevel)) {
    return `[Vantage] ${event.summary}`;
  }
  return `[Vantage Alert] ${event.summary}`;
}

function buildBody(
  event: OperationalEventDocument,
  incident: OperationalIncidentDocument | null,
): string {
  const lines: string[] = [];
  lines.push(event.summary);
  lines.push("");
  lines.push(`Environment: ${event.environment}`);
  lines.push(`Event: ${event.event_key}`);
  lines.push(`Workflow: ${event.workflow}`);
  lines.push(`Level: ${event.level}`);

  if (event.source_company) {
    lines.push(`Source company: ${event.source_company}`);
  }
  if (event.lead_name || event.lead_phone || event.lead_email) {
    lines.push(
      `Customer: ${[event.lead_name, event.lead_phone, event.lead_email]
        .filter(Boolean)
        .join(" / ")}`,
    );
  }
  if (event.job_no) {
    lines.push(`Job #: ${event.job_no}`);
  }
  if (event.entity_type && event.entity_id) {
    lines.push(`Record: ${event.entity_type} ${event.entity_id}`);
  }
  if (event.run_id) {
    lines.push(`Run ID: ${event.run_id}`);
  }
  if (event.route) {
    lines.push(`Route: ${event.method ?? ""} ${event.route}`.trim());
  }

  const detailEntries = Object.entries(event.details ?? {}).slice(0, 12);
  if (detailEntries.length > 0) {
    lines.push("");
    lines.push("Details:");
    for (const [key, value] of detailEntries) {
      lines.push(`  ${key}: ${formatDetailValue(value)}`);
    }
  }

  if (incident) {
    lines.push("");
    lines.push(`Occurrences: ${incident.count}`);
    lines.push(`First seen: ${incident.first_seen_at.toISOString()}`);
    lines.push(`Last seen: ${incident.last_seen_at.toISOString()}`);
  }

  return lines.join("\n");
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 200);
    } catch {
      return "[object]";
    }
  }
  return String(value).slice(0, 200);
}

/**
 * Evaluates and dispatches immediate notifications for a persisted event.
 * Returns the send result when an email was attempted, or `null` when policy
 * decided not to email. Best-effort; failures are captured in the result and
 * never thrown. The caller (`recordOperationalEvent`) records a
 * `notification.email.failed` event when a send fails, which keeps this module
 * free of an import cycle and prevents alert loops.
 */
export async function dispatchEventNotifications(params: {
  event: OperationalEventDocument;
  incident: OperationalIncidentDocument | null;
}): Promise<SendNotificationResult | null> {
  const { event, incident } = params;

  if (!isObservabilityEnabled() || !isEmailNotificationsEnabled()) {
    return null;
  }

  const posture = resolvePosture(event);
  if (posture === "none") {
    return null;
  }

  const now = new Date();

  // Throttle repeated identical alerts using the incident's next_notify_at.
  if (incident) {
    const nextNotifyAt = incident.notification_state?.next_notify_at ?? null;
    if (nextNotifyAt && now < new Date(nextNotifyAt)) {
      await markIncidentSuppressed(incident._id);
      return null;
    }
  }

  const { to, recipientType } = recipientsFor(
    posture === "immediate_developer" ? "developer" : "owner",
  );

  if (to.length === 0) {
    return null;
  }

  const result = await sendNotification({
    purpose: "immediate_alert",
    recipientType,
    to,
    subject: buildSubject(event),
    bodyText: buildBody(event, incident),
    dedupeKey: event.dedupe_key,
    eventId: event._id,
    incidentId: incident?._id ?? null,
  });

  if (incident && result.ok) {
    const throttleMs = getAlertEmailThrottleMinutes() * 60_000;
    await markIncidentNotified(incident._id, now, new Date(now.getTime() + throttleMs));
  }

  return result;
}

async function markIncidentNotified(
  incidentId: OperationalIncidentDocument["_id"],
  sentAt: Date,
  nextNotifyAt: Date,
): Promise<void> {
  try {
    const Incident = getOperationalIncidentModel();
    await Incident.updateOne(
      { _id: incidentId },
      {
        $set: {
          "notification_state.immediate_sent_at": sentAt,
          "notification_state.next_notify_at": nextNotifyAt,
        },
      },
    );
  } catch (error) {
    logger.warn({ msg: "observability.incident.notify_state_failed", err: error });
  }
}

async function markIncidentSuppressed(
  incidentId: OperationalIncidentDocument["_id"],
): Promise<void> {
  try {
    const Incident = getOperationalIncidentModel();
    await Incident.updateOne(
      { _id: incidentId },
      { $inc: { "notification_state.suppressed_count": 1 } },
    );
  } catch (error) {
    logger.warn({ msg: "observability.incident.suppress_state_failed", err: error });
  }
}
