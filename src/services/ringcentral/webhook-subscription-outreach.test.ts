import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import ringCentralWebhookRoutes from "../../routes/ringcentral-webhook.routes";
import {
  applyAllDirectionSubscriptionPlan,
  applyRepSmsSubscriptionPlan,
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  MAX_WEBHOOK_EXPIRES_IN_SECONDS,
  planAllDirectionSubscription,
  planRepSmsSubscription,
  repSmsEventFilters,
  ringCentralSubscriptionProvider,
  SubscriptionOwnershipError,
  updateOwnedSubscription,
  type OwnershipStore,
  type RepSmsLifecycleDeps,
  type StoredSubscriptionMeta,
  type SubscriptionProvider,
  type SubscriptionRecord,
  type SubscriptionWriteInput,
} from "./webhook-subscription-lifecycle";
import {
  compareVerificationToken,
  setDeliveryRefusalRecorderForTests,
  setVerificationTokenLookupForTests,
  verifyRingCentralDelivery,
} from "./webhook-verification";
import { runRepSmsSubscriptionMaintenance } from "./repSms/subscriptionMaintenance";
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

test("10-year expiry cap: create and update request 315,360,000 s", () => {
  assert.equal(MAX_WEBHOOK_EXPIRES_IN_SECONDS, 315_360_000);
  assert.equal(DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS, 315_360_000);
});

test("calls create carries a generated verification token, recorded with purpose calls (never the same token twice)", async () => {
  const f = fakes([], {});
  const deps = { provider: f.provider, store: f.store, address: ADDRESS, now: () => NOW, eventFilters: async () => CALLS };
  await applyAllDirectionSubscriptionPlan(await planAllDirectionSubscription(deps), deps);
  await applyAllDirectionSubscriptionPlan({ action: "create", warnings: [] }, deps);
  const [a, b] = f.writes;
  assert.match(a!.input.verificationToken!, /^[0-9a-f]{32}$/);
  assert.notEqual(a!.input.verificationToken, b!.input.verificationToken);
  assert.equal(a!.input.expiresIn, 315_360_000);
  assert.deepEqual(f.recorded[0], { id: "new-1", meta: { purpose: "calls", verificationToken: a!.input.verificationToken } });
});

test("calls without a stored token: the cron only warns; the operator ensure replaces it (create with a token, then delete), never a PUT (olr CW2)", async () => {
  const records = [record({ id: "owned-calls" }), record({ id: "foreign" })];
  const f = fakes(records, { "owned-calls": { purpose: null, verificationToken: null } });
  const cron = { provider: f.provider, store: f.store, address: ADDRESS, now: () => NOW, eventFilters: async () => CALLS };
  const cronPlan = await planAllDirectionSubscription(cron);
  assert.equal(cronPlan.action, "noop");
  assert.ok(cronPlan.warnings.some((w) => w.includes("no verification token")));
  const operator = { ...cron, requireVerificationToken: true };
  const plan = await planAllDirectionSubscription(operator);
  assert.deepEqual(plan, { action: "replace", subscription_id: "owned-calls", reasons: ["verification_token_missing"], warnings: ["foreign subscription foreign delivers to this address and is not managed here"] });
  assert.deepEqual(await applyAllDirectionSubscriptionPlan(plan, operator), { action: "replaced", removed_subscription_id: "owned-calls", subscription_id: "new-1" });
  assert.deepEqual(f.calls, ["create:new-1", "delete:owned-calls", "mark:owned-calls:Deleted"], "create first, then delete; no PUT");
  assert.equal(f.writes[0]!.op, "create");
  assert.deepEqual(f.writes[0]!.input.eventFilters, CALLS);
  const token = f.writes[0]!.input.verificationToken!;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.deepEqual(f.stored.get("new-1"), { purpose: "calls", verificationToken: token }, "the stored token is exactly the one RingCentral received on the create");
  assert.equal(f.stored.get("owned-calls")?.verificationToken, null, "no token is ever stored for a subscription that did not receive it");
  // Idempotent: once the provider lists the new subscription instead of the old one, the next plan is a noop.
  records.splice(0, records.length, record({ id: "new-1" }), record({ id: "foreign" }));
  assert.equal((await planAllDirectionSubscription(operator)).action, "noop");
});

test("update refuses a foreign id before any provider call", async () => {
  const f = fakes([record({ id: "foreign" })], {});
  await assert.rejects(
    updateOwnedSubscription("foreign", { provider: f.provider, store: f.store, purpose: "rep_sms", eventFilters: SMS("1"), address: ADDRESS, expiresIn: 1 }),
    SubscriptionOwnershipError,
  );
  assert.deepEqual(f.calls, []);
});

test("provider adapter: create and PUT send deliveryMode.verificationToken and the 10-year expiry", async () => {
  const requests: Array<[string, string, unknown]> = [];
  const provider = ringCentralSubscriptionProvider((async (method: string, endpoint: string, body?: unknown) => {
    requests.push([method, endpoint, body]);
    return { id: "s" };
  }) as never);
  await provider.create({ eventFilters: SMS("101"), address: ADDRESS, expiresIn: 315_360_000, verificationToken: "tok" });
  await provider.update!("s 1", { eventFilters: SMS("101", "102"), address: ADDRESS, expiresIn: 315_360_000, verificationToken: "tok" });
  assert.deepEqual(requests, [
    ["POST", "/restapi/v1.0/subscription", { eventFilters: SMS("101"), deliveryMode: { transportType: "WebHook", address: ADDRESS, verificationToken: "tok" }, expiresIn: 315_360_000 }],
    ["PUT", "/restapi/v1.0/subscription/s%201", { eventFilters: SMS("101", "102"), deliveryMode: { transportType: "WebHook", address: ADDRESS, verificationToken: "tok" }, expiresIn: 315_360_000 }],
  ]);
});

function repSmsDeps(f: ReturnType<typeof fakes>, mailboxes: string[]): RepSmsLifecycleDeps {
  return { provider: f.provider, store: f.store, address: ADDRESS, mailboxes: async () => mailboxes, now: () => NOW };
}

test("rep_sms filters: one message-store?type=SMS filter per reviewed mailbox, no direction, sorted and unique", () => {
  assert.deepEqual(repSmsEventFilters(["102", "101", "101", " ", "x"]), SMS("101", "102"));
  assert.equal(repSmsEventFilters(["101"])[0]!.includes("direction"), false);
});

test("rep_sms plan: missing → create (operator only; the cron reports missing); never manages calls or foreign subscriptions", async () => {
  const f = fakes(
    [record({ id: "owned-calls" }), record({ id: "foreign-sms", eventFilters: SMS("101") })],
    { "owned-calls": { purpose: "calls", verificationToken: "c" } },
  );
  const deps = repSmsDeps(f, ["101", "102"]);
  const plan = await planRepSmsSubscription(deps);
  assert.equal(plan.action, "create");
  assert.equal(plan.health, "subscription_missing");
  assert.ok(plan.warnings.some((w) => w.includes("foreign-sms")));
  assert.deepEqual(await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: false }), { action: "missing" });
  assert.deepEqual(f.calls, []);
  const created = await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: true });
  assert.deepEqual(created, { action: "created", subscription_id: "new-1" });
  assert.deepEqual(f.writes[0]!.input.eventFilters, SMS("101", "102"));
  assert.equal(f.stored.get("new-1")?.purpose, "rep_sms");
  assert.ok(f.stored.get("new-1")?.verificationToken);
});

test("rep_sms plan: filter drift against the reviewed rep set PUTs the new filter list, keeping the stored token", async () => {
  const f = fakes([record({ id: "owned-sms", eventFilters: SMS("101") })], { "owned-sms": { purpose: "rep_sms", verificationToken: "keep-me" } });
  const deps = repSmsDeps(f, ["101", "103"]);
  const plan = await planRepSmsSubscription(deps);
  assert.equal(plan.action, "update");
  assert.equal(plan.health, "filter_drift");
  assert.deepEqual(await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: false }), { action: "updated", subscription_id: "owned-sms" });
  assert.deepEqual(f.writes[0], { op: "update", id: "owned-sms", input: { eventFilters: SMS("101", "103"), address: ADDRESS, expiresIn: 315_360_000, verificationToken: "keep-me" } });
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

test("rep_sms plan: healthy → noop; expiring → renew; blacklisted → repair only for the operator; no mailboxes → nothing created", async () => {
  const healthy = fakes([record({ id: "s" , eventFilters: SMS("101") })], { s: { purpose: "rep_sms", verificationToken: "t" } });
  assert.equal((await planRepSmsSubscription(repSmsDeps(healthy, ["101"]))).action, "noop");
  const expiring = fakes([record({ id: "s", eventFilters: SMS("101"), expirationTime: new Date(NOW.getTime() + DAY) })], { s: { purpose: "rep_sms", verificationToken: "t" } });
  const renewPlan = await planRepSmsSubscription(repSmsDeps(expiring, ["101"]));
  assert.equal(renewPlan.action, "renew");
  await applyRepSmsSubscriptionPlan(renewPlan, repSmsDeps(expiring, ["101"]), { allowCreate: false });
  assert.deepEqual(expiring.calls, ["renew:s"]);
  const black = fakes([record({ id: "s", eventFilters: SMS("101"), status: "Blacklisted" })], { s: { purpose: "rep_sms", verificationToken: "t" } });
  const repair = await planRepSmsSubscription(repSmsDeps(black, ["101"]));
  assert.equal(repair.health, "blacklisted");
  assert.deepEqual(await applyRepSmsSubscriptionPlan(repair, repSmsDeps(black, ["101"]), { allowCreate: false }), { action: "skipped", reason: "create_not_allowed" });
  assert.deepEqual(black.calls, []);
  await applyRepSmsSubscriptionPlan(repair, repSmsDeps(black, ["101"]), { allowCreate: true });
  assert.deepEqual(black.calls, ["delete:s", "mark:s:Deleted", "create:new-1"]);
  const none = fakes([], {});
  const empty = await planRepSmsSubscription(repSmsDeps(none, []));
  assert.equal(empty.health, "no_mailboxes");
  assert.deepEqual(await applyRepSmsSubscriptionPlan(empty, repSmsDeps(none, []), { allowCreate: true }), { action: "skipped", reason: "no_mailboxes" });
});

test("rep_sms maintenance (daily cron): gated by controls.rep_sms_capture_enabled, never creates, stores the channel health", async () => {
  const outcomes: Array<string | null> = [];
  assert.deepEqual(await runRepSmsSubscriptionMaintenance({ enabled: async () => false }), { skipped: true, reason: "capture_disabled" });
  const missing = fakes([], {});
  const summary = await runRepSmsSubscriptionMaintenance({
    enabled: async () => true,
    provider: missing.provider,
    store: missing.store,
    address: ADDRESS,
    mailboxes: async () => ["101"],
    now: () => NOW,
    recordOutcome: async (code) => {
      outcomes.push(code);
    },
  });
  assert.equal(summary.skipped, false);
  assert.ok(!summary.skipped && summary.result === "missing" && summary.health === "subscription_missing");
  assert.deepEqual(missing.calls, []);
  const drift = fakes([record({ id: "s", eventFilters: SMS("101") })], { s: { purpose: "rep_sms", verificationToken: "t" } });
  const fixed = await runRepSmsSubscriptionMaintenance({
    enabled: async () => true,
    provider: drift.provider,
    store: drift.store,
    address: ADDRESS,
    mailboxes: async () => ["101", "102"],
    now: () => NOW,
    recordOutcome: async (code) => {
      outcomes.push(code);
    },
  });
  assert.ok(!fixed.skipped && fixed.result === "updated" && fixed.health === "ok");
  assert.deepEqual(outcomes, ["subscription_missing", null]);
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

test("verification token: exact match accepted; missing or different refused; constant-time compare of unequal lengths", () => {
  assert.deepEqual(compareVerificationToken("abc", "abc"), { ok: true, reason: "verified" });
  assert.deepEqual(compareVerificationToken("abc", " abc "), { ok: true, reason: "verified" });
  assert.deepEqual(compareVerificationToken("abc", "abd"), { ok: false, reason: "token_mismatch" });
  assert.deepEqual(compareVerificationToken("abc", "abcd"), { ok: false, reason: "token_mismatch" });
  assert.deepEqual(compareVerificationToken("abc", ""), { ok: false, reason: "token_missing" });
  assert.deepEqual(compareVerificationToken("abc", null), { ok: false, reason: "token_missing" });
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
