import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNudgeAdapter,
  NudgeProviderError,
  type NudgeRecipient,
} from "./adapters";
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
