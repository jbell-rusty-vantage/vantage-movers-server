import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadMessageDocument } from "../../models/LeadMessage";
import type { CreateFormLeadInput } from "../../validation/v1.validation";
import {
  buildLeadMessageTwilioSendInput,
  classifyLeadMessagingFailure,
  dispatchPersistedLeadMessage,
  normalizeSmsDestination,
  persistLeadMessageIntent,
  shouldApplyTwilioStatus,
} from "./leadMessaging.service";
import { buildLeadConfirmationMessage } from "./messageBuilder";

test("confirmation builder retains the approved server-side copy", () => {
  const body = buildLeadConfirmationMessage({
    first_name: "Gary",
  } as CreateFormLeadInput);
  assert.equal(
    body,
    "Hi Gary, this is Vantage Movers. We received your request for a quote. Call us at (888) 486-2499 to review your move details and get your free quote.",
  );
});

test("confirmation builder derives the first name from a combined name", () => {
  const body = buildLeadConfirmationMessage({
    name: " Gary Evanish ",
  } as CreateFormLeadInput);
  assert.match(body, /^Hi Gary, this is Vantage Movers\./);
});

test("overnight deferral stays off until quiet hours are explicitly enabled", () => {
  const previous = process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED;
  delete process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED;
  try {
    const overnight = buildLeadMessageTwilioSendInput({
      to: "+15555550123",
      from: "+18885550123",
      body: "hello",
      statusCallback: "https://example.com/status",
      now: new Date("2026-01-15T07:30:00.000Z"),
    });
    assert.equal(overnight.sendAt, undefined);
    assert.equal(overnight.messagingServiceSid, undefined);
  } finally {
    if (previous === undefined) delete process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED;
    else process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED = previous;
  }
});

test("form-lead SMS send input defers overnight Eastern traffic to 8:00 AM via Twilio", () => {
  const overnight = buildLeadMessageTwilioSendInput({
    to: "+15555550123",
    from: "+18885550123",
    body: "hello",
    statusCallback: "https://example.com/status",
    now: new Date("2026-01-15T07:30:00.000Z"),
    messagingServiceSid: "MG123",
    quietHoursEnabled: true,
  });
  assert.equal(overnight.sendAt?.toISOString(), "2026-01-15T13:00:00.000Z");
  assert.equal(overnight.messagingServiceSid, "MG123");

  const daytime = buildLeadMessageTwilioSendInput({
    to: "+15555550123",
    from: "+18885550123",
    body: "hello",
    statusCallback: "https://example.com/status",
    now: new Date("2026-01-15T13:00:00.000Z"),
  });
  assert.equal(daytime.sendAt, undefined);
  assert.equal(daytime.messagingServiceSid, undefined);
});

test("overnight deferral fails closed when the Messaging Service SID is missing", () => {
  assert.throws(
    () =>
      buildLeadMessageTwilioSendInput({
        to: "+15555550123",
        from: "+18885550123",
        body: "hello",
        statusCallback: "https://example.com/status",
        now: new Date("2026-01-15T07:30:00.000Z"),
        messagingServiceSid: null,
        quietHoursEnabled: true,
      }),
    /TWILIO_MESSAGING_SERVICE_SID/,
  );
});

test("SMS destinations are normalized to E.164 when safely possible", () => {
  assert.equal(normalizeSmsDestination("(954) 555-1212"), "+19545551212");
  assert.equal(normalizeSmsDestination("1-954-555-1212"), "+19545551212");
  assert.equal(normalizeSmsDestination("+442071838750"), "+442071838750");
});

test("disabled mode is a dispatch-time kill switch", async () => {
  const previous = process.env.LEAD_MESSAGING_MODE;
  const messageId = new mongoose.Types.ObjectId().toString();
  process.env.LEAD_MESSAGING_MODE = "disabled";
  try {
    assert.deepEqual(
      await dispatchPersistedLeadMessage(
        messageId,
        async () => {
          throw new Error("sender must not be called");
        },
      ),
      {
        message_id: messageId,
        status: "disabled",
      },
    );
  } finally {
    if (previous === undefined) delete process.env.LEAD_MESSAGING_MODE;
    else process.env.LEAD_MESSAGING_MODE = previous;
  }
});

test("test mode is also enforced at dispatch time", async () => {
  const previousMode = process.env.LEAD_MESSAGING_MODE;
  const previousTestMode = process.env.TEST_MODE;
  const messageId = new mongoose.Types.ObjectId().toString();
  process.env.LEAD_MESSAGING_MODE = "inline";
  process.env.TEST_MODE = "true";
  try {
    assert.deepEqual(
      await dispatchPersistedLeadMessage(messageId, async () => {
        throw new Error("sender must not be called");
      }),
      { message_id: messageId, status: "disabled" },
    );
  } finally {
    if (previousMode === undefined) delete process.env.LEAD_MESSAGING_MODE;
    else process.env.LEAD_MESSAGING_MODE = previousMode;
    if (previousTestMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = previousTestMode;
  }
});

test("intent persistence gates strictly on parsed true consent", async () => {
  let calls = 0;
  const createMessage = async (value: unknown) => {
    calls += 1;
    return {
      ...(value as object),
      _id: new mongoose.Types.ObjectId(),
    } as LeadMessageDocument;
  };
  const base = {
    formLeadId: new mongoose.Types.ObjectId().toString(),
    destinationPhone: "+15555550123",
    duplicate: false,
    testMode: false,
    session: undefined,
  };

  assert.equal(
    await persistLeadMessageIntent(
      {
        ...base,
        formInput: { sms_consent: false } as CreateFormLeadInput,
      },
      { createMessage, evaluateGuard: async () => null },
    ),
    null,
  );
  assert.equal(
    await persistLeadMessageIntent(
      {
        ...base,
        formInput: {} as CreateFormLeadInput,
      },
      { createMessage, evaluateGuard: async () => null },
    ),
    null,
  );
  await persistLeadMessageIntent(
    {
      ...base,
      formInput: { sms_consent: true } as CreateFormLeadInput,
    },
    {
      createMessage,
      mode: "inline",
      fromNumber: "+18885550123",
      evaluateGuard: async () => null,
    },
  );
  assert.equal(calls, 1);
});

test("duplicate, disabled, and test modes cannot send", async () => {
  const records: Array<Record<string, unknown>> = [];
  const createMessage = async (value: unknown) => {
    records.push(value as Record<string, unknown>);
    return {
      ...(value as object),
      _id: new mongoose.Types.ObjectId(),
    } as LeadMessageDocument;
  };
  const base = {
    formLeadId: new mongoose.Types.ObjectId().toString(),
    destinationPhone: "+15555550123",
    formInput: { sms_consent: true } as CreateFormLeadInput,
    session: undefined,
  };

  await persistLeadMessageIntent(
    { ...base, duplicate: true, testMode: false },
    { createMessage, mode: "inline", evaluateGuard: async () => null },
  );
  await persistLeadMessageIntent(
    { ...base, duplicate: false, testMode: false },
    { createMessage, mode: "disabled", evaluateGuard: async () => null },
  );
  const testResult = await persistLeadMessageIntent(
    { ...base, duplicate: false, testMode: true },
    { createMessage, mode: "inline", evaluateGuard: async () => null },
  );

  assert.equal(records[0].status, "skipped");
  assert.equal(records[0].skip_reason, "duplicate_lead");
  assert.equal(records[1].status, "skipped");
  assert.equal(records[1].skip_reason, "messaging_disabled");
  assert.equal(testResult, null);
  assert.equal(records.length, 2);
});

test("destination policy decisions persist as non-retryable skips", async () => {
  let record: Record<string, unknown> | undefined;
  await persistLeadMessageIntent(
    {
      formLeadId: new mongoose.Types.ObjectId().toString(),
      destinationPhone: "+442071838750",
      formInput: { sms_consent: true } as CreateFormLeadInput,
      duplicate: false,
      testMode: false,
    },
    {
      mode: "inline",
      evaluateGuard: async () => "country_not_allowed",
      createMessage: async (value) => {
        record = value as unknown as Record<string, unknown>;
        return {
          ...(value as object),
          _id: new mongoose.Types.ObjectId(),
        } as LeadMessageDocument;
      },
    },
  );
  assert.equal(record?.status, "skipped");
  assert.equal(record?.skip_reason, "country_not_allowed");
});

test("429 and definite connection failures are retryable", () => {
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("rate limited"), { status: 429 }),
      1,
    ),
    { status: "retry_scheduled", retryable: true },
  );
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      2,
    ),
    { status: "retry_scheduled", retryable: true },
  );
});

test("ambiguous timeouts are never automatically retried", () => {
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      1,
    ),
    { status: "uncertain", retryable: false },
  );
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("provider unavailable"), { status: 503 }),
      1,
    ),
    { status: "uncertain", retryable: false },
  );
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("axios timeout"), { code: "ECONNABORTED" }),
      1,
    ),
    { status: "uncertain", retryable: false },
  );
});

test("retry budget stops automatic retries", () => {
  assert.deepEqual(
    classifyLeadMessagingFailure(
      Object.assign(new Error("rate limited"), { status: 429 }),
      4,
    ),
    { status: "failed", retryable: false },
  );
});

test("status callbacks do not regress or replace terminal outcomes", () => {
  assert.equal(shouldApplyTwilioStatus("queued", "sent"), true);
  assert.equal(shouldApplyTwilioStatus("sent", "queued"), false);
  assert.equal(shouldApplyTwilioStatus("delivered", "sent"), false);
  assert.equal(shouldApplyTwilioStatus("failed", "delivered"), false);
  assert.equal(shouldApplyTwilioStatus("sent", "undelivered"), true);
});
