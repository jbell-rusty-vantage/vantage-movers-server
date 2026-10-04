import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNudgeAdapter,
  NudgeProviderError,
  type NudgeRecipient,
} from "./adapters";
import { renderNudgeTemplate, validateNudgeBody } from "./templates";
import { csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { csiNudgeCommandSchema } from "../../../validation/v1/salesIntelligence";

const recipient: NudgeRecipient = {
  account: "synthetic",
  extension: "101",
  person: "person101",
  senderExtension: "100",
  senderExtensionNumber: "10",
  senderPerson: "person100",
  senderDid: "+12025550198",
};
test("single-attempt adapter never retries a non-idempotent submission, including 401/429/timeout", async () => {
  for (const status of [401, 403, 408, 429, 500]) {
    let calls = 0;
    const adapter = createNudgeAdapter(async () => {
      calls++;
      return { status, value: { secret: "must-not-escape" } };
    });
    await assert.rejects(
      adapter.submit({
        ...recipient,
        channel: "team_messaging",
        destination: "chat",
        body: "Synthetic",
      }),
      (error) => {
        assert.ok(error instanceof NudgeProviderError);
        assert.equal(error.definitive, [401, 403].includes(status));
        assert.ok(!JSON.stringify(error).includes("must-not-escape"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("Direct chat must have exactly the two reviewed people; supports provider member objects", async () => {
  for (const members of [
    [{ id: "person100" }, { id: "person101" }],
    ["person100", "person101"],
  ]) {
    const adapter = createNudgeAdapter(async (method, path, body) => {
      if (path === "/restapi/v1.0/glip/persons/~")
        return { status: 200, value: { id: "person100" } };
      assert.equal(method, "POST");
      assert.equal(path, "/restapi/v1.0/glip/conversations");
      assert.deepEqual(body, { members: [{ id: "person101" }] });
      return { status: 200, value: { id: "chat", type: "Direct", members } };
    });
    assert.equal((await adapter.resolveDirect(recipient)).id, "chat");
  }
  for (const value of [
    { id: "chat", type: "Group", members: ["person100", "person101"] },
    { id: "chat", type: "Direct", members: ["person100", "other"] },
    {
      id: "chat",
      type: "Direct",
      members: ["person100", "person101", "other"],
    },
  ]) {
    await assert.rejects(
      createNudgeAdapter(async (_method, path) => ({
        status: 200,
        value: path.endsWith("persons/~") ? { id: "person100" } : value,
      })).resolveDirect(recipient),
      /recipient_mismatch/,
    );
  }
});
test("SMS and pager use JWT sender and correct endpoint contract", async () => {
  const requests: unknown[] = [];
  const adapter = createNudgeAdapter(async (method, path, body) => {
    if (method === "GET")
      return {
        status: 200,
        value: path.includes("phone-number")
          ? {
              records: [
                { phoneNumber: "+12025550198", features: ["SmsSender"] },
              ],
            }
          : { id: "100", extensionNumber: "10" },
      };
    requests.push({ method, path, body });
    return { status: 200, value: { id: 123 } };
  });
  await adapter.submit({
    ...recipient,
    channel: "sms_to_rep",
    destination: "+12025550199",
    body: "Review",
  });
  await adapter.submit({
    ...recipient,
    channel: "pager",
    destination: "101",
    body: "Review",
  });
  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/restapi/v1.0/account/~/extension/~/sms",
      body: {
        from: { phoneNumber: "+12025550198" },
        to: [{ phoneNumber: "+12025550199" }],
        text: "Review",
      },
    },
    {
      method: "POST",
      path: "/restapi/v1.0/account/~/extension/~/company-pager",
      body: {
        from: { extensionNumber: "10" },
        to: [{ extensionNumber: "101" }],
        text: "Review",
      },
    },
  ]);
});
test("repair receipt requires exact ID, sender and Direct membership, not matching text/time", async () => {
  const input = {
    ...recipient,
    channel: "team_messaging" as const,
    destination: "chat",
    body: "same body",
    messageId: "exact",
  };
  const adapter = (post: unknown) =>
    createNudgeAdapter(async (_method, path) => ({
      status: 200,
      value: path.endsWith("/posts/exact")
        ? post
        : { id: "chat", type: "Direct", members: ["person100", "person101"] },
    }));
  assert.equal(
    await adapter({
      id: "other",
      creatorId: "person100",
      text: "same body",
    }).receipt(input),
    false,
  );
  assert.equal(
    await adapter({ id: "exact", creatorId: "other" }).receipt(input),
    false,
  );
  assert.equal(
    await adapter({ id: "exact", creatorId: "person100" }).receipt(input),
    true,
  );
});
test("repair receipt rejects a Direct chat response for a different chat ID", async () => {
  const input = {
    ...recipient,
    channel: "team_messaging" as const,
    destination: "expected-chat",
    body: "same body",
    messageId: "exact",
  };
  const adapter = createNudgeAdapter(async (_method, path) => ({
    status: 200,
    value: path.endsWith("/posts/exact")
      ? { id: "exact", creatorId: "person100" }
      : {
          id: "other-chat",
          type: "Direct",
          members: ["person100", "person101"],
        },
  }));
  assert.equal(await adapter.receipt(input), false);
});
test("the message body is the Owner's trimmed text, 1..1000 characters", () => {
  assert.equal(validateNudgeBody("  Review the directory entry.  "), "Review the directory entry.");
  assert.throws(() => validateNudgeBody("   "), /NUDGE_BODY_INVALID/);
  assert.throws(() => validateNudgeBody("x".repeat(1001)), /NUDGE_BODY_INVALID/);
});
test("the review template is versioned and strict; its text may tell that User to call or message someone", () => {
  const input = { purpose: "review_context" as const, template_key: "review_context", template_version: 1, body: "Please call the customer." };
  assert.equal(renderNudgeTemplate(input), "Please call the customer.");
  assert.throws(() => renderNudgeTemplate({ ...input, template_version: 2 }), /INVALID_INPUT/);
  assert.throws(() => renderNudgeTemplate({ ...input, template_key: "call_suggestion" }), /INVALID_INPUT/);
});
test("the command is a directory review message only: no Outreach record, follow-up, revision fence, customer channel or chat id", () => {
  const nudge = { rc_account_id: "synthetic", rc_extension_id: "220", channel: "pager", template_key: "review_context", template_version: 1,
    purpose: "review_context", body: "Joshua — please review this internal note." };
  assert.equal(csiNudgeCommandSchema.safeParse({ nudge }).success, true);
  assert.equal(csiNudgeCommandSchema.safeParse({ nudge: { ...nudge, channel: "team_messaging" } }).success, true);
  assert.equal(csiNudgeCommandSchema.safeParse({ nudge: { ...nudge, rep_identity_link_id: "b".repeat(24) }, expected_rep_revision: 1 }).success, true);
  for (const [label, command] of [
    ["sms to a phone number", { nudge: { ...nudge, channel: "sms_to_rep" } }],
    ["an Outreach record", { nudge: { ...nudge, outreach_record_id: "a".repeat(24) } }],
    ["an Outreach revision fence", { nudge, expected_revision: 1 }],
    ["a follow-up", { nudge: { ...nudge, followup_id: "a".repeat(24) } }],
    ["a call suggestion", { nudge: { ...nudge, purpose: "call_suggestion", template_key: "call_suggestion" } }],
    ["no body", { nudge: { ...nudge, body: undefined } }],
    ["a client-chosen chat id", { nudge: { ...nudge, chat_id: "arbitrary" } }],
    ["a rep revision without a link", { nudge, expected_rep_revision: 1 }],
    ["a link without its revision", { nudge: { ...nudge, rep_identity_link_id: "b".repeat(24) } }],
  ] as const) assert.equal(csiNudgeCommandSchema.safeParse(command).success, false, label);
});
test("optional channels default off", () => {
  const sms = process.env.SALES_INTELLIGENCE_NUDGE_SMS_ENABLED,
    pager = process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED;
  delete process.env.SALES_INTELLIGENCE_NUDGE_SMS_ENABLED;
  delete process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED;
  try {
    assert.equal(csiNudgeConfiguration().channels.sms_to_rep, false);
    assert.equal(csiNudgeConfiguration().channels.pager, false);
  } finally {
    if (sms !== undefined)
      process.env.SALES_INTELLIGENCE_NUDGE_SMS_ENABLED = sms;
    if (pager !== undefined)
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = pager;
  }
});
test("documented nudge controls take precedence; aliases cannot widen an explicit channel allowlist", () => {
  const keys = [
    "SALES_INTELLIGENCE_NUDGE_CHANNELS",
    "SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR",
    "SALES_INTELLIGENCE_NUDGE_HOURLY_LIMIT",
    "SALES_INTELLIGENCE_NUDGE_TEAM_MESSAGING_ENABLED",
    "SALES_INTELLIGENCE_NUDGE_SMS_ENABLED",
    "SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    Object.assign(process.env, {
      SALES_INTELLIGENCE_NUDGE_CHANNELS: "team_messaging",
      SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR: "1",
      SALES_INTELLIGENCE_NUDGE_HOURLY_LIMIT: "6",
      SALES_INTELLIGENCE_NUDGE_SMS_ENABLED: "true",
    });
    assert.equal(csiNudgeConfiguration().hourlyLimit, 1);
    assert.deepEqual(csiNudgeConfiguration().channels, {
      team_messaging: true,
      sms_to_rep: false,
      pager: false,
    });
    process.env.SALES_INTELLIGENCE_NUDGE_CHANNELS = "sms_to_rep,pager";
    assert.deepEqual(csiNudgeConfiguration().channels, {
      team_messaging: false,
      sms_to_rep: true,
      pager: true,
    });
    process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "false";
    assert.equal(csiNudgeConfiguration().channels.pager, false);
    process.env.SALES_INTELLIGENCE_NUDGE_CHANNELS = "arbitrary";
    assert.throws(() => csiNudgeConfiguration(), /invalid_nudge_channels/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
