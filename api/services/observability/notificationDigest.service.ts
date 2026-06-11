import {
  getSendgridConfig,
  isAlertEmailDailyDigestEnabled,
  isEmailNotificationsEnabled,
} from "../../config/domain/observability";
import { connectMongo } from "../../db";
import { getNotificationDeliveryModel } from "../../models/NotificationDelivery";
import { getObservabilityOverview } from "./adminObservability.service";
import {
  retryNotificationDeliveryInPlace,
  sendNotification,
} from "./emailNotification.service";

/**
 * Daily owner digest + failed-delivery retry, invoked by the notifications
 * cron. The digest is a single owner email summarizing the last day's health;
 * the retry resends recently-failed deliveries. Both are best-effort.
 */

const MAX_RETRY_BATCH = 25;
const MAX_RETRY_ATTEMPTS = 3;

export type DailyDigestResult = {
  skipped: boolean;
  reason?: string;
  sent: boolean;
};

export async function sendDailyOwnerDigest(): Promise<DailyDigestResult> {
  if (!isEmailNotificationsEnabled() || !isAlertEmailDailyDigestEnabled()) {
    return { skipped: true, reason: "digest_disabled", sent: false };
  }

  const { ownerToEmails } = getSendgridConfig();
  if (ownerToEmails.length === 0) {
    return { skipped: true, reason: "no_recipients", sent: false };
  }

  const overview = await getObservabilityOverview({});
  const subject = `[Vantage] Daily operational summary — ${overview.health.overall_status}`;
  const body = buildDigestBody(overview);

  const result = await sendNotification({
    purpose: "daily_digest",
    recipientType: "owner",
    to: ownerToEmails,
    subject,
    bodyText: body,
  });

  return { skipped: result.skipped, reason: result.reason, sent: result.ok };
}

function buildDigestBody(overview: Awaited<ReturnType<typeof getObservabilityOverview>>): string {
  const lines: string[] = [];
  lines.push(`Overall status: ${overview.health.overall_status}`);
  lines.push("");
  lines.push(`Open critical incidents: ${overview.health.open_critical}`);
  lines.push(`Open errors: ${overview.health.open_error}`);
  lines.push(`Open warnings: ${overview.health.open_warn}`);
  lines.push("");
  lines.push("Events by level (today):");
  for (const row of overview.event_counts_by_level) {
    lines.push(`  ${row.key}: ${row.count}`);
  }
  lines.push("");
  lines.push(
    `Notifications today — sent: ${overview.notifications.sent_today}, failed: ${overview.notifications.failed_today}, suppressed: ${overview.notifications.suppressed_today}`,
  );

  if (overview.top_open_incidents.length > 0) {
    lines.push("");
    lines.push("Top open incidents:");
    for (const incident of overview.top_open_incidents.slice(0, 10)) {
      const inc = incident as {
        severity?: string;
        title?: string;
        count?: number;
      };
      lines.push(`  [${inc.severity}] ${inc.title} (x${inc.count})`);
    }
  }

  lines.push("");
  lines.push("Open the Observational tab in the admin dashboard for full detail.");
  return lines.join("\n");
}

/**
 * Resends recently-failed notification deliveries (bounded). Retries update the
 * original delivery record in-place so metrics count one logical delivery.
 */
export async function retryFailedNotifications(): Promise<{ retried: number }> {
  if (!isEmailNotificationsEnabled()) {
    return { retried: 0 };
  }
  await connectMongo();
  const Delivery = getNotificationDeliveryModel();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();

  const failed = await Delivery.find({
    status: "failed",
    attempt_count: { $lt: MAX_RETRY_ATTEMPTS },
    createdAt: { $gte: since },
    $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
  })
    .sort({ createdAt: 1 })
    .limit(MAX_RETRY_BATCH)
    .select({ _id: 1 })
    .lean();

  let retried = 0;
  for (const delivery of failed) {
    const result = await retryNotificationDeliveryInPlace(delivery._id);
    if (result.ok) retried += 1;
  }

  return { retried };
}
