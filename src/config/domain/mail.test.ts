import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSendgridConfig } from "./mail";

const MAIL_ENV = ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL", "ALERT_EMAIL_REPLY_TO"] as const;
const saved = Object.fromEntries(MAIL_ENV.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of MAIL_ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

test("mail config reads trimmed SendGrid sender settings at call time", () => {
  process.env.SENDGRID_API_KEY = " SG.synthetic ";
  process.env.SENDGRID_FROM_EMAIL = " noreply@example.invalid ";
  process.env.ALERT_EMAIL_REPLY_TO = " ops@example.invalid ";

  assert.deepEqual(getSendgridConfig(), {
    apiKey: "SG.synthetic",
    fromEmail: "noreply@example.invalid",
    replyTo: "ops@example.invalid",
  });
});

test("mail config treats missing or blank sender settings as not configured", () => {
  delete process.env.SENDGRID_API_KEY;
  process.env.SENDGRID_FROM_EMAIL = "   ";
  delete process.env.ALERT_EMAIL_REPLY_TO;

  assert.deepEqual(getSendgridConfig(), { apiKey: null, fromEmail: null, replyTo: null });
});
