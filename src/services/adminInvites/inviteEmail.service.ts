import sgMail from "@sendgrid/mail";
import { getSendgridConfig, type SendgridConfig } from "../../config/domain/observability";
import { logger } from "../../logger";

/**
 * Admin user invite email (S8-USERS, addendum §4.1, E28).
 *
 * The admin dashboard owns the invite token; this service only delivers the
 * set-password link so the SendGrid key stays on the main server. It is a
 * transactional send: it reads `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`
 * (and the optional `ALERT_EMAIL_REPLY_TO`) directly, independent of the
 * observability `EMAIL_NOTIFICATIONS_*` posture, and it never persists a
 * `notification_deliveries` row (that model stores the body text, which would
 * store the link).
 *
 * The link, the token inside it and the recipient address are never logged.
 */

export type AdminInviteEmailInput = {
  to: string;
  link: string;
  expiresAt: Date;
};

export type AdminInviteEmailResult =
  | { status: "sent" }
  | { status: "not_configured" }
  | { status: "failed"; provider_status: number | null };

export type AdminInviteMailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
};

export type AdminInviteEmailDeps = {
  config?: () => Pick<SendgridConfig, "apiKey" | "fromEmail" | "replyTo">;
  send?: (apiKey: string, message: AdminInviteMailMessage) => Promise<void>;
};

export const ADMIN_INVITE_EMAIL_SUBJECT = "Set your Vantage Admin password";

let configuredKey: string | null = null;

async function sendWithSendgrid(apiKey: string, message: AdminInviteMailMessage): Promise<void> {
  if (configuredKey !== apiKey) {
    sgMail.setApiKey(apiKey);
    configuredKey = apiKey;
  }
  await sgMail.send({
    to: message.to,
    from: message.from,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  });
}

export function adminInviteEmailBody(link: string, expiresAt: Date): string {
  return [
    "You have been given access to the Vantage Admin dashboard.",
    "",
    "Open this link to set your password:",
    link,
    "",
    `The link works once and expires at ${expiresAt.toISOString()} (UTC).`,
    "If you did not expect this email, you can ignore it.",
  ].join("\n");
}

export async function sendAdminInviteEmail(
  input: AdminInviteEmailInput,
  deps: AdminInviteEmailDeps = {},
): Promise<AdminInviteEmailResult> {
  const { apiKey, fromEmail, replyTo } = (deps.config ?? getSendgridConfig)();
  if (!apiKey || !fromEmail) {
    logger.warn({ msg: "admin_invite.email.not_configured", has_api_key: Boolean(apiKey), has_from_email: Boolean(fromEmail) });
    return { status: "not_configured" };
  }

  try {
    await (deps.send ?? sendWithSendgrid)(apiKey, {
      to: input.to,
      from: fromEmail,
      ...(replyTo ? { replyTo } : {}),
      subject: ADMIN_INVITE_EMAIL_SUBJECT,
      text: adminInviteEmailBody(input.link, input.expiresAt),
    });
    logger.info({ msg: "admin_invite.email.sent" });
    return { status: "sent" };
  } catch (error) {
    // Only the provider status code: SendGrid error bodies can echo the message.
    const providerStatus =
      (error as { response?: { statusCode?: unknown } } | null)?.response?.statusCode;
    const statusCode = typeof providerStatus === "number" ? providerStatus : null;
    logger.error({ msg: "admin_invite.email.failed", provider_status: statusCode });
    return { status: "failed", provider_status: statusCode };
  }
}
