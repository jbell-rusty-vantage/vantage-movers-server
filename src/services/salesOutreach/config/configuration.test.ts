import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { salesOutreachConfigurationValueSchema, type SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { OutreachError } from "../errors";
import { patchSalesOutreachConfiguration } from "./commands";
import { createConfigurationLoader } from "./load";
import { readSalesOutreachConfiguration } from "./reads";
import { configurationContentHash } from "./store";
import { MemoryConfigurationDb } from "./testing";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

const owner = csiOperatorActor("sod-config-test");
const deskOn: SalesOutreachConfigurationInput = { controls: { desk_enabled: true } };

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

test("missing configuration is uninitialized: features off, GET writes nothing, desk writes fail closed", async () => {
  const db = new MemoryConfigurationDb();
  const loader = createConfigurationLoader(db.store);
  assert.deepEqual(await loader.load(), { state: "uninitialized" });
  await rejectsWith(loader.requireActive(), "CONFIGURATION_UNAVAILABLE");
  const read = await readSalesOutreachConfiguration(loader, new Date("2026-10-04T12:00:00Z"));
  assert.equal(read.configuration_state, "uninitialized");
  assert.equal(read.revision, 0);
  assert.equal(read.value?.controls.desk_enabled, false);
  assert.equal(read.value?.migration.paused, true);
  assert.equal(read.contract_version, "sod-v1");
  assert.equal(db.pointer, null);
  assert.equal(db.versions.size, 0);
  assert.equal(db.audits.length, 0);
});

test("explicit Owner initialization (expected_revision 0) creates revision 1 with version, pointer and audit together", async () => {
  const db = new MemoryConfigurationDb();
  const { response, replayed } = await patchSalesOutreachConfiguration(
    { actor: owner, idempotency_key: "init-1", expected_revision: 0, value: deskOn },
    db.deps(),
  );
  assert.equal(replayed, false);
  assert.deepEqual([response.revision, response.changed], [1, true]);
  assert.equal(db.pointer?.revision, 1);
  assert.equal(db.pointer?.version, response.version);
  assert.equal(db.versions.get(response.version)?.content_hash, response.content_hash);
  assert.deepEqual(db.audits, [{ event_kind: "sales_outreach_configuration_initialized", revision: 1 }]);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.value.controls.desk_enabled, true);
  assert.equal(active.value.controls.cadence_enforcement_enabled, false);
});

test("idempotency: a replay returns the committed result; the same key with another payload conflicts", async () => {
  const db = new MemoryConfigurationDb();
  const first = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "k1", expected_revision: 0, value: deskOn }, db.deps());
  const replay = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "k1", expected_revision: 0, value: deskOn }, db.deps());
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(db.versions.size, 1);
  assert.equal(db.audits.length, 1);
  await rejectsWith(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "k1", expected_revision: 0, value: {} }, db.deps()),
    "IDEMPOTENCY_CONFLICT",
  );
});

test("CAS: a stale expected_revision is REVISION_CONFLICT and writes nothing", async () => {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "a", expected_revision: 0, value: deskOn }, db.deps());
  await rejectsWith(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "b", expected_revision: 0, value: {} }, db.deps()),
    "REVISION_CONFLICT",
  );
  await rejectsWith(
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "c", expected_revision: 5, value: {} }, db.deps()),
    "REVISION_CONFLICT",
  );
  assert.equal(db.pointer?.revision, 1);
  assert.equal(db.versions.size, 1);
  const second = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "d", expected_revision: 1, value: {} }, db.deps());
  assert.deepEqual([second.response.revision, second.response.changed], [2, true]);
  assert.deepEqual(db.audits.map((a) => a.event_kind), ["sales_outreach_configuration_initialized", "sales_outreach_configuration_changed"]);
});

test("identical semantic input writes no version, pointer move or audit", async () => {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "a", expected_revision: 0, value: deskOn }, db.deps());
  // Same normalized value, spelled with explicit defaults.
  const same = salesOutreachConfigurationValueSchema.parse(deskOn);
  const again = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "b", expected_revision: 1, value: same }, db.deps());
  assert.deepEqual([again.response.revision, again.response.changed], [1, false]);
  assert.equal(db.versions.size, 1);
  assert.equal(db.audits.length, 1);
});

test("invalid values are refused with bounded issue paths: activation without approved policy, unknown keys, env-style flags", async () => {
  const db = new MemoryConfigurationDb();
  const attempt = (value: unknown) =>
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: `bad-${Math.random()}`, expected_revision: 0, value }, db.deps());
  await assert.rejects(attempt({ controls: { cadence_enforcement_enabled: true } }), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.equal(error.code, "INVALID_INPUT");
    const paths = error.issues!.map((i) => i.path);
    assert.ok(paths.includes("cadence.approval_ref"));
    assert.ok(paths.includes("goals.rep_work_schedules"));
    return true;
  });
  await rejectsWith(attempt({ controls: { goal_metrics_enabled: true } }), "INVALID_INPUT");
  await rejectsWith(attempt({ controls: { SALES_OUTREACH_DESK: true } }), "INVALID_INPUT");
  await rejectsWith(attempt({ cadence: { custom_rule: "() => true" } }), "INVALID_INPUT");
  await rejectsWith(attempt({ cadence: { precedence_rule: "goal_first" } }), "INVALID_INPUT");
  await rejectsWith(attempt({ transition: { intake_admission_enabled: true } }), "INVALID_INPUT");
  await rejectsWith(attempt({ transition: { backfill_lookback_days: 0 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ goals: { rep_work_schedules: [], effective_day_overrides: [{ agent_id: "a".repeat(24), business_date: "2026-10-05", goal: 0, reason: "absence" }] } }), "INVALID_INPUT");
  await rejectsWith(attempt({ goals: { effective_day_overrides: [{ agent_id: "a".repeat(24), business_date: "2026-02-30", goal: 0, reason: "absence" }] } }), "INVALID_INPUT");
  assert.equal(db.pointer, null);
});

test("FAST-01 transition fields persist; no env variable can turn a control on", async () => {
  process.env.SALES_OUTREACH_DESK_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration(
    { actor: owner, idempotency_key: "fast", expected_revision: 0, value: { transition: { backfill_lookback_days: 90, backfill_include_upcoming_moves: true } } },
    db.deps(),
  );
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.value.transition.backfill_lookback_days, 90);
  assert.equal(active.value.transition.backfill_include_upcoming_moves, true);
  assert.equal(active.value.controls.desk_enabled, false);
});

test("two instances: a committed PATCH is seen by every instance on its next read, without restart or invalidation", async () => {
  const db = new MemoryConfigurationDb();
  const instanceA = createConfigurationLoader(db.store);
  const instanceB = createConfigurationLoader(db.store);
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v1", expected_revision: 0, value: {} }, db.deps());
  assert.equal((await instanceA.requireActive()).value.controls.desk_enabled, false);
  assert.equal((await instanceB.requireActive()).value.controls.desk_enabled, false);
  // Instance A served v1 from its immutable cache; the pointer is still read on every call.
  const readsBefore = { ...db.reads };
  await instanceA.requireActive();
  assert.equal(db.reads.pointer, readsBefore.pointer + 1);
  assert.equal(db.reads.version, readsBefore.version);
  // A PATCH committed through "instance B" (no invalidation message is ever sent: the missed-invalidation case).
  const patched = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v2", expected_revision: 1, value: deskOn }, db.deps());
  const a = await instanceA.requireActive();
  const b = await instanceB.requireActive();
  for (const seen of [a, b]) {
    assert.equal(seen.revision, 2);
    assert.equal(seen.version, patched.response.version);
    assert.equal(seen.value.controls.desk_enabled, true);
  }
  // A cached old version is never served once the pointer has moved on.
  assert.notEqual(a.version, (await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v3", expected_revision: 2, value: {} }, db.deps())).response.version);
  assert.equal((await instanceA.requireActive()).value.controls.desk_enabled, false);
});

test("a dangling, tampered or invalid active version fails closed but stays repairable by the Owner", async () => {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v1", expected_revision: 0, value: deskOn }, db.deps());
  const version = db.pointer!.version;
  const stored = db.versions.get(version)!;

  db.versions.delete(version);
  const loader = createConfigurationLoader(db.store);
  assert.deepEqual((await loader.inspect()).state, "unavailable");
  await rejectsWith(loader.load(), "CONFIGURATION_UNAVAILABLE");
  const read = await readSalesOutreachConfiguration(loader);
  assert.deepEqual([read.configuration_state, read.revision, read.unavailable_reason, read.value], ["unavailable", 1, "dangling_version", null]);

  db.versions.set(version, { ...stored, value: { controls: { desk_enabled: "yes" } } });
  assert.equal((await createConfigurationLoader(db.store).inspect()).state, "unavailable");

  db.versions.set(version, { ...stored, content_hash: configurationContentHash(salesOutreachConfigurationValueSchema.parse({})) });
  const tampered = await createConfigurationLoader(db.store).inspect();
  assert.equal(tampered.state === "unavailable" && tampered.reason, "hash_mismatch");

  // Repair: the Owner PATCHes against the visible pointer revision.
  const repaired = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "repair", expected_revision: 1, value: {} }, db.deps());
  assert.equal(repaired.response.revision, 2);
  assert.equal((await createConfigurationLoader(db.store).requireActive()).revision, 2);
});

test("a database failure propagates: no cached configuration is presented as fresh", async () => {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "v1", expected_revision: 0, value: deskOn }, db.deps());
  const loader = createConfigurationLoader(db.store);
  await loader.requireActive();
  db.failReads = true;
  await assert.rejects(loader.requireActive(), /database unavailable/);
  await assert.rejects(readSalesOutreachConfiguration(loader), /database unavailable/);
});
