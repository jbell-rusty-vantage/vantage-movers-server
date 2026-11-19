import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import ringCentralWebhookRoutes from "../../routes/ringcentral-webhook.routes";
import {
  applyRepSmsSubscriptionPlan,
  planRepSmsSubscription,
  repSmsEventFilters,
  type OwnershipStore,
  type RepSmsLifecycleDeps,
  type StoredSubscriptionMeta,
  type SubscriptionProvider,
  type SubscriptionRecord,
  type SubscriptionWriteInput,
} from "./webhook-subscription-lifecycle";
import {
  setDeliveryRefusalRecorderForTests,
  setVerificationTokenLookupForTests,
  verifyRingCentralDelivery,
} from "./webhook-verification";
import { reviewedRepMailboxes } from "./repSms/mailboxes";

const ADDRESS = "https://example.test/api/webhooks/ringcentral";
const CALLS = ["/restapi/v1.0/account/~/telephony/sessions"];
const NOW = new Date("2026-10-05T06:15:00.000Z");
const DAY = 24 * 60 * 60_000;
const SMS = (...ids: string[]) => ids.map((id) => `/restapi/v1.0/account/~/extension/${id}/message-store?type=SMS`);

function record(partial: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
  return {
    eventFilters: CALLS,
    transportType: "WebHook",
    address: ADDRESS,
    status: "Active",
    expiresIn: null,
    expirationTime: new Date(NOW.getTime() + 365 * DAY),
    raw: { id: partial.id },
    ...partial,
  };
}

function fakes(records: SubscriptionRecord[], meta: Record<string, StoredSubscriptionMeta>) {
  const calls: string[] = [];
  const writes: Array<{ op: string; id?: string; input: SubscriptionWriteInput }> = [];
  const recorded: Array<{ id: string; meta: Partial<StoredSubscriptionMeta> | undefined }> = [];
  const stored = new Map(Object.entries(meta));
  let created = 0;
  const provider: SubscriptionProvider = {
    list: async () => records,
    create: async (input) => {
      created += 1;
      calls.push(`create:new-${created}`);
      writes.push({ op: "create", input });
      return { id: `new-${created}`, eventFilters: input.eventFilters, status: "Active" };
    },
    update: async (id, input) => {
      calls.push(`update:${id}`);
      writes.push({ op: "update", id, input });
      return { id, eventFilters: input.eventFilters, status: "Active" };
    },
    renew: async (id) => {
      calls.push(`renew:${id}`);
      return { id, status: "Active" };
    },
    remove: async (id) => {
      calls.push(`delete:${id}`);
    },
  };
  const store: OwnershipStore = {
    ownedIds: async () => new Set(stored.keys()),
    record: async (raw, m) => {
      const id = (raw as { id: string }).id;
      recorded.push({ id, meta: m });
      const prior = stored.get(id) ?? { purpose: null, verificationToken: null };
      stored.set(id, { purpose: m?.purpose ?? prior.purpose, verificationToken: m?.verificationToken ?? prior.verificationToken });
    },
    markStatus: async (id, status) => {
      calls.push(`mark:${id}:${status}`);
    },
    meta: async () => new Map(stored),
  };
  return { provider, store, calls, writes, recorded, stored };
}

function repSmsDeps(f: ReturnType<typeof fakes>, mailboxes: string[]): RepSmsLifecycleDeps {
  return { provider: f.provider, store: f.store, address: ADDRESS, mailboxes: async () => mailboxes, now: () => NOW };
}

test("rep_sms filters: one message-store?type=SMS filter per reviewed mailbox, no direction, sorted and unique", () => {
  assert.deepEqual(repSmsEventFilters(["102", "101", "101", " ", "x"]), SMS("101", "102"));
  assert.equal(repSmsEventFilters(["101"])[0]!.includes("direction"), false);
});

test("rep_sms plan: no stored token → replace (the cron skips it; the operator creates with a token, then deletes); refused deliveries → deliveries_refused (olr CW2)", async () => {
  const tokenless = fakes([record({ id: "owned-sms", eventFilters: SMS("101") })], { "owned-sms": { purpose: "rep_sms", verificationToken: null } });
  const deps = repSmsDeps(tokenless, ["101"]);
  const plan = await planRepSmsSubscription(deps);
  assert.equal(plan.action, "replace");
  assert.equal(plan.health, "token_missing");
  assert.deepEqual(plan.action === "replace" ? plan.reasons : null, ["verification_token_missing"]);
  assert.deepEqual(await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: false }), { action: "skipped", reason: "create_not_allowed" });
  assert.deepEqual(tokenless.calls, [], "the daily cron never PUTs a token on");
  assert.deepEqual(await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: true }), { action: "replaced", removed_subscription_id: "owned-sms", subscription_id: "new-1" });
  assert.deepEqual(tokenless.calls, ["create:new-1", "delete:owned-sms", "mark:owned-sms:Deleted"]);
  assert.deepEqual(tokenless.writes[0]!.input.eventFilters, SMS("101"));
  assert.deepEqual(tokenless.stored.get("new-1"), { purpose: "rep_sms", verificationToken: tokenless.writes[0]!.input.verificationToken });

  const refused = fakes([record({ id: "owned-sms", eventFilters: SMS("101") })], { "owned-sms": { purpose: "rep_sms", verificationToken: "t" } });
  refused.store.deliveryRefusals = async () => ({ count: 3, last_refused_at: new Date(NOW.getTime() - 60_000), last_reason: "token_mismatch", accepted_since: false });
  const refusedPlan = await planRepSmsSubscription(repSmsDeps(refused, ["101", "102"]));
  assert.equal(refusedPlan.action, "replace");
  assert.equal(refusedPlan.health, "deliveries_refused");
  assert.deepEqual(refusedPlan.action === "replace" ? refusedPlan.reasons : null, ["filter_drift", "deliveries_refused"]);
});

test("reviewed rep mailboxes: only reviewed sales_rep links effective now; conflicting, proposed or other roles are excluded", () => {
  const at = NOW;
  const base = { revision: 1, rc_account_id: "8001", effective_from: new Date("2026-01-01T00:00:00Z"), effective_to: null };
  const rows = [
    { ...base, _id: "a", agent_id: "agentA", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed", rc_direct_numbers: ["+15550000101"], rc_sms_sender_number: "+15550000101" },
    { ...base, _id: "b", agent_id: "agentB", rc_extension_id: "102", role_kind: "sales_rep", status: "proposed" },
    { ...base, _id: "c", agent_id: "agentC", rc_extension_id: "103", role_kind: "service", status: "reviewed" },
    { ...base, _id: "d1", agent_id: "agentD", rc_extension_id: "104", role_kind: "sales_rep", status: "reviewed" },
    { ...base, _id: "d2", agent_id: "agentE", rc_extension_id: "104", role_kind: "sales_rep", status: "reviewed" },
    { ...base, _id: "e", agent_id: "agentF", rc_extension_id: "105", role_kind: "sales_rep", status: "reviewed", effective_to: new Date("2026-02-01T00:00:00Z") },
  ];
  assert.deepEqual(reviewedRepMailboxes(rows, "8001", at), [
    { rc_account_id: "8001", extension_id: "101", agent_id: "agentA", link_id: "a", sender_numbers: ["+15550000101"] },
  ]);
});

test("delivery verification: our token-bearing subscription requires its token; legacy, foreign and handshake deliveries pass as before", async () => {
  const lookup = async (id: string) => (id === "ours" ? "tok" : id === "legacy" ? null : undefined);
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: "ours", providedToken: "tok" }, lookup), { ok: true, reason: "verified" });
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: "ours", providedToken: "nope" }, lookup), { ok: false, reason: "token_mismatch" });
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: "ours", providedToken: null }, lookup), { ok: false, reason: "token_missing" });
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: "legacy", providedToken: null }, lookup), { ok: true, reason: "no_token_on_record" });
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: "foreign", providedToken: null }, lookup), { ok: true, reason: "not_owned" });
  assert.deepEqual(await verifyRingCentralDelivery({ subscriptionId: null, providedToken: null }, lookup), { ok: true, reason: "no_subscription_id" });
});

test("webhook route: Verification-Token is matched case-insensitively; a wrong or missing token is refused before anything is stored", async () => {
  const saved = { ...process.env };
  delete process.env.MONGO_URI;
  process.env.RINGCENTRAL_WEBHOOK_ENABLED = "false";
  process.env.SALES_INTELLIGENCE_CAPTURE_WEBHOOK = "true";
  setVerificationTokenLookupForTests(async (id) => (id === "sub-1" ? "secret-token" : undefined));
  const refusals: Array<{ subscriptionId: string; reason: string }> = [];
  let refusalStoreDown = false;
  setDeliveryRefusalRecorderForTests(async ({ subscriptionId, reason, at }) => {
    assert.ok(at instanceof Date);
    if (refusalStoreDown) throw new Error("store down");
    refusals.push({ subscriptionId, reason });
  });
  const app = express();
  app.use(express.json());
  app.use(ringCentralWebhookRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/ringcentral`;
  const post = (headers: Record<string, string>, subscriptionId = "sub-1") =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ uuid: `u-${Math.random()}`, subscriptionId, event: "/restapi/v1.0/account/~/extension/101/message-store", body: {} }),
      signal: AbortSignal.timeout(5000),
    });
  try {
    for (const name of ["Verification-Token", "verification-token", "VERIFICATION-TOKEN"]) {
      const ok = await post({ [name]: "secret-token" });
      assert.equal(ok.status, 200, name);
    }
    const wrong = await post({ "Verification-Token": "guess" });
    assert.equal(wrong.status, 403);
    assert.deepEqual(await wrong.json(), { ok: false, provider: "ringcentral", error: "verification_failed" });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({}, "foreign-sub")).status, 200, "a subscription that is not ours keeps the old behaviour");
    // olr CW2: each refusal is counted against its subscription; accepted deliveries are not.
    assert.deepEqual(refusals, [
      { subscriptionId: "sub-1", reason: "token_mismatch" },
      { subscriptionId: "sub-1", reason: "token_missing" },
    ]);
    refusalStoreDown = true;
    assert.equal((await post({})).status, 403, "a counter failure never changes the refusal");
  } finally {
    setDeliveryRefusalRecorderForTests(null);
    setVerificationTokenLookupForTests(null);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});
