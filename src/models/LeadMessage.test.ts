import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { LeadMessage } from "./LeadMessage";

test("LeadMessage validates normalized FormLead relationship and message snapshot", async () => {
  const leadId = new mongoose.Types.ObjectId();
  const message = new LeadMessage({
    form_lead: leadId,
    purpose: "quote_request_confirmation",
    message_key: "quote_request_confirmation",
    template_version: 1,
    to: "+19545551212",
    from: "+18885550123",
    body: "Confirmation",
    dispatch_mode: "inline",
    status: "pending",
  });

  await message.validate();
  assert.equal(message.form_lead?.toString(), leadId.toString());
  assert.equal(message.provider, "twilio");
  assert.equal(message.channel, "sms");
  assert.equal(message.twilio_message_sid, null);
  assert.equal(message.manual_retry_count, 0);
  assert.deepEqual(message.attempts, []);
  assert.deepEqual(message.status_history, []);
});

test("LeadMessage unique SID index excludes unsent documents", () => {
  const sidIndex = LeadMessage.schema
    .indexes()
    .find(
      (index: [Record<string, unknown>, Record<string, unknown>]) =>
        index[0].twilio_message_sid === 1,
    );
  assert.deepEqual(sidIndex?.[1].partialFilterExpression, {
    twilio_message_sid: { $type: "string" },
  });
});

test("LeadMessage rejects unsupported lifecycle states", async () => {
  const message = new LeadMessage({
    form_lead: new mongoose.Types.ObjectId(),
    purpose: "quote_request_confirmation",
    message_key: "quote_request_confirmation",
    template_version: 1,
    to: "+19545551212",
    from: "+18885550123",
    body: "Confirmation",
    dispatch_mode: "inline",
    status: "invented",
  });

  await assert.rejects(message.validate(), /status/);
});
