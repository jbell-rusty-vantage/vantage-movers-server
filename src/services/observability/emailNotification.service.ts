import sgMail from "@sendgrid/mail";
import type mongoose from "mongoose";
import {
  getEmailNotificationsMode,
  getEmailProvider,
  getSendgridConfig,
  isEmailNotificationsEnabled,
} from "../../config/domain/observability";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import {
  getNotificationDeliveryModel,
  type NotificationDeliveryDocument,
} from "../../models/NotificationDelivery";
import type {
  NotificationPurpose,
  NotificationRecipientType,
} from "../../config/domain/observability";

/**
 * Email notification provider + delivery persistence.
 *
 * SendGrid is the default provider (`@sendgrid/mail` already ships in this
 * repo). Send posture is controlled by `EMAIL_NOTIFICATIONS_MODE`:
 *   - `live`     real send.
 *   - `sandbox`  SendGrid sandbox mode (no delivery), still records the attempt.
 *   - `log_only` render subject/body to logs + a delivery record, no provider call.
 *   - `disabled` no delivery created.
 *
 * This module never throws to callers and never records operational events
 * itself (the caller decides), which keeps it free of import cycles and
 * prevents notification failures from breaking business workflows.
 */

const BODY_PREVIEW_MAX = 500;

export type SendNotificationInput = {
  purpose: NotificationPurpose;
  recipientType: NotificationRecipientType;
  to: string[];
  subject: string;
  bodyText: string;
  dedupeKey?: string | null;
  eventId?: mongoose.Types.ObjectId | null;
  incidentId?: mongoose.Types.ObjectId | null;
  reportRunId?: mongoose.Types.ObjectId | null;
};

export type SendNotificationResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  deliveryId?: mongoose.Types.ObjectId;
  status: NotificationDeliveryDocument["status"];
  errorMessage?: string;
};

export type RetryNotificationResult = SendNotificationResult & {
  attemptCount: number;
};

type SendGridErrorResponse = {
  response?: { statusCode?: number; body?: unknown };
  message?: string;
};

let sendgridKeyConfigured: string | null = null;

function ensureSendgridKey(apiKey: string): void {
  if (sendgridKeyConfigured !== apiKey) {
    sgMail.setApiKey(apiKey);
    sendgridKeyConfigured = apiKey;
  }
}

function bodyPreview(body: string): string {
  return body.length > BODY_PREVIEW_MAX
    ? `${body.slice(0, BODY_PREVIEW_MAX)}…`
    : body;
}

function nextAttemptAt(attemptCount: number, now = new Date()): Date {
  const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

/**
 * Creates a `notification_deliveries` record and attempts to send according to
 * the configured email mode. Best-effort: any internal failure is captured in
 * the delivery record and logged, never thrown.
 */
export async function sendNotification(
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const mode = getEmailNotificationsMode();

  if (!isEmailNotificationsEnabled() || mode === "disabled") {
    return { ok: false, skipped: true, reason: "email_disabled", status: "cancelled" };
  }

  const recipients = input.to.map((value) => value.trim()).filter(Boolean);
  const { fromEmail, replyTo } = getSendgridConfig();

  if (recipients.length === 0) {
    logger.warn({
      msg: "notification.email.skipped",
      reason: "no_recipients",
      purpose: input.purpose,
      recipient_type: input.recipientType,
    });
    return { ok: false, skipped: true, reason: "no_recipients", status: "cancelled" };
  }

  if (!fromEmail) {
    logger.warn({
      msg: "notification.email.skipped",
      reason: "no_from_email",
      purpose: input.purpose,
    });
    return { ok: false, skipped: true, reason: "no_from_email", status: "cancelled" };
  }

  let deliveryId: mongoose.Types.ObjectId | undefined;

  try {
    await connectMongo();
    const Delivery = getNotificationDeliveryModel();
    const delivery = await Delivery.create({
      channel: "email",
      provider: getEmailProvider(),
      purpose: input.purpose,
      status: "sending",
      recipient_type: input.recipientType,
      to: recipients,
      from: fromEmail,
      reply_to: replyTo,
      subject: input.subject,
        body_text: input.bodyText,
      body_text_preview: bodyPreview(input.bodyText),
      event_id: input.eventId ?? null,
      incident_id: input.incidentId ?? null,
      report_run_id: input.reportRunId ?? null,
      dedupe_key: input.dedupeKey ?? null,
      attempt_count: 1,
    });
    deliveryId = delivery._id;

    if (mode === "log_only") {
      await Delivery.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: "sent",
            sent_at: new Date(),
            last_attempt_at: new Date(),
            next_attempt_at: null,
            provider_response: { mode: "log_only" },
          },
        },
      );
      logger.info({
        msg: "notification.email.log_only",
        purpose: input.purpose,
        recipient_type: input.recipientType,
        to: recipients,
        subject: input.subject,
        body_preview: bodyPreview(input.bodyText),
        delivery_id: delivery._id.toString(),
      });
      return { ok: true, skipped: false, deliveryId: delivery._id, status: "sent" };
    }

    return await sendViaSendgrid({
      delivery,
      recipients,
      fromEmail,
      replyTo,
      input,
      sandbox: mode === "sandbox",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "notification.email.failed",
      reason: "delivery_persistence_failed",
      purpose: input.purpose,
      err: error,
    });
    return {
      ok: false,
      skipped: false,
      deliveryId,
      status: "failed",
      errorMessage: message,
    };
  }
}

async function sendViaSendgrid(params: {
  delivery: NotificationDeliveryDocument;
  recipients: string[];
  fromEmail: string;
  replyTo: string | null;
  input: SendNotificationInput;
  sandbox: boolean;
}): Promise<SendNotificationResult> {
  const { delivery, recipients, fromEmail, replyTo, input, sandbox } = params;
  const Delivery = getNotificationDeliveryModel();
  const { apiKey } = getSendgridConfig();

  if (!apiKey) {
    await Delivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: "failed",
          error_message: "SENDGRID_API_KEY is not set",
          last_attempt_at: new Date(),
          next_attempt_at: nextAttemptAt(delivery.attempt_count),
        },
      },
    );
    logger.warn({
      msg: "notification.email.failed",
      reason: "missing_api_key",
      purpose: input.purpose,
    });
    return {
      ok: false,
      skipped: false,
      deliveryId: delivery._id,
      status: "failed",
      errorMessage: "SENDGRID_API_KEY is not set",
    };
  }

  try {
    ensureSendgridKey(apiKey);
    const [response] = await sgMail.send({
      to: recipients,
      from: fromEmail,
      ...(replyTo ? { replyTo } : {}),
      subject: input.subject,
      text: input.bodyText,
      mailSettings: { sandboxMode: { enable: sandbox } },
    });

    const messageId =
      (response.headers as Record<string, string> | undefined)?.["x-message-id"] ??
      null;

    await Delivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: "sent",
          sent_at: new Date(),
          last_attempt_at: new Date(),
          next_attempt_at: null,
          error_message: null,
          provider_message_id: messageId,
          provider_response: {
            statusCode: response.statusCode,
            sandbox,
          },
        },
      },
    );

    logger.info({
      msg: "notification.email.sent",
      purpose: input.purpose,
      recipient_type: input.recipientType,
      sandbox,
      status_code: response.statusCode,
      delivery_id: delivery._id.toString(),
    });

    return { ok: true, skipped: false, deliveryId: delivery._id, status: "sent" };
  } catch (error) {
    const sgError = error as SendGridErrorResponse;
    const statusCode = sgError.response?.statusCode ?? null;
    const message = sgError.message ?? (error instanceof Error ? error.message : String(error));

    await Delivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: "failed",
          error_message: message,
          last_attempt_at: new Date(),
          next_attempt_at: nextAttemptAt(delivery.attempt_count),
          provider_response: { statusCode },
        },
      },
    );

    logger.error({
      msg: "notification.email.failed",
      reason: "sendgrid_error",
      purpose: input.purpose,
      status_code: statusCode,
      err: error,
    });

    return {
      ok: false,
      skipped: false,
      deliveryId: delivery._id,
      status: "failed",
      errorMessage: message,
    };
  }
}

export async function retryNotificationDeliveryInPlace(
  deliveryId: mongoose.Types.ObjectId,
): Promise<RetryNotificationResult> {
  if (!isEmailNotificationsEnabled() || getEmailNotificationsMode() === "disabled") {
    return {
      ok: false,
      skipped: true,
      reason: "email_disabled",
      deliveryId,
      status: "cancelled",
      attemptCount: 0,
    };
  }

  const mode = getEmailNotificationsMode();
  const Delivery = getNotificationDeliveryModel();
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) {
    return {
      ok: false,
      skipped: true,
      reason: "delivery_not_found",
      deliveryId,
      status: "cancelled",
      attemptCount: 0,
    };
  }

  const recipients = delivery.to.map((value) => value.trim()).filter(Boolean);
  if (recipients.length === 0) {
    await Delivery.updateOne(
      { _id: delivery._id },
      { $set: { status: "cancelled", error_message: "No recipients configured" } },
    );
    return {
      ok: false,
      skipped: true,
      reason: "no_recipients",
      deliveryId: delivery._id,
      status: "cancelled",
      attemptCount: delivery.attempt_count,
    };
  }

  const now = new Date();
  const attemptCount = delivery.attempt_count + 1;
  const bodyText = delivery.body_text ?? delivery.body_text_preview;
  await Delivery.updateOne(
    { _id: delivery._id },
    {
      $set: {
        status: "sending",
        last_attempt_at: now,
        next_attempt_at: null,
        body_text: bodyText,
        body_text_preview: bodyPreview(bodyText),
      },
      $inc: { attempt_count: 1 },
    },
  );
  delivery.attempt_count = attemptCount;

  if (mode === "log_only") {
    await Delivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: "sent",
          sent_at: new Date(),
          error_message: null,
          provider_response: { mode: "log_only", retry: true },
        },
      },
    );
    logger.info({
      msg: "notification.email.retry_log_only",
      purpose: delivery.purpose,
      recipient_type: delivery.recipient_type,
      to: recipients,
      subject: delivery.subject,
      delivery_id: delivery._id.toString(),
    });
    return {
      ok: true,
      skipped: false,
      deliveryId: delivery._id,
      status: "sent",
      attemptCount,
    };
  }

  return {
    ...(await sendViaSendgrid({
      delivery,
      recipients,
      fromEmail: delivery.from,
      replyTo: delivery.reply_to,
      input: {
        purpose: delivery.purpose,
        recipientType: delivery.recipient_type,
        to: recipients,
        subject: delivery.subject,
        bodyText,
        dedupeKey: delivery.dedupe_key,
        eventId: delivery.event_id,
        incidentId: delivery.incident_id,
        reportRunId: delivery.report_run_id,
      },
      sandbox: mode === "sandbox",
    })),
    attemptCount,
  };
}
