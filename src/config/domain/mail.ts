/**
 * Transactional email transport settings (SendGrid).
 *
 * Read at call time so scripts and tests can set env before invoking. These
 * settings only identify the sender; each caller decides whether and when it
 * sends.
 */

export type SendgridConfig = {
  apiKey: string | null;
  fromEmail: string | null;
  replyTo: string | null;
};

export function getSendgridConfig(): SendgridConfig {
  return {
    apiKey: process.env.SENDGRID_API_KEY?.trim() || null,
    fromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || null,
    replyTo: process.env.ALERT_EMAIL_REPLY_TO?.trim() || null,
  };
}
