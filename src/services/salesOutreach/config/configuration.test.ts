import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { salesOutreachConfigurationValueSchema, type SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { OutreachError } from "../errors";
import { deskEnginePolicy } from "../evaluation/policyAdapter";
import { patchSalesOutreachConfiguration } from "./commands";
import { createConfigurationLoader } from "./load";
import { readSalesOutreachConfiguration } from "./reads";
import { configurationContentHash, type ConfigurationVersion } from "./store";
import { CONFIGURATION_REVISION_5_HASH as REVISION_5_HASH, configurationRevision5Value as revision5, MemoryConfigurationDb } from "./testing";

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

// ---- olr A0: configuration evolution safety -------------------------------------------------

/** Stores `value` verbatim (as an older deploy wrote it) and points the active pointer at it. */
function storeRaw(db: MemoryConfigurationDb, value: unknown, content_hash: string, revision = 5): ConfigurationVersion {
  const row: ConfigurationVersion = { version: `sod-config-rev${revision}`, value, content_hash, approval_ref: "owner-session-2026-10-03-FINAL-01", created_by: "owner", created_at: new Date(0) };
  db.versions.set(row.version, row);
  db.pointer = { id: "pointer-1", version: row.version, content_hash, revision, updated_by: "owner", updated_at: new Date(0) };
  return row;
}

test("legacy path: a version whose hash was taken on the parsed value (raw value sparser) stays active", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, { controls: { desk_enabled: true } }, configurationContentHash(salesOutreachConfigurationValueSchema.parse({ controls: { desk_enabled: true } })), 2);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.value.controls.desk_enabled, true);
});

test("C1a count_scope_not_prospective: entries on or before today are immutable; a later entry is accepted", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, revision5(), REVISION_5_HASH);
  db.now = new Date("2026-10-06T15:00:00Z"); // 11:00 New York, business day 2026-10-06
  let revision = 5;
  const withSchedule = (schedule: unknown) => {
    const value = revision5();
    value.goals!.count_scope_schedule = schedule;
    return value;
  };
  const patch = (schedule: unknown, key: string) =>
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: `c1a-${key}`, expected_revision: revision, value: withSchedule(schedule) }, db.deps());
  const refusedProspective = async (schedule: unknown, key: string) =>
    assert.rejects(patch(schedule, key), (error: unknown) => {
      assert.ok(error instanceof OutreachError);
      assert.equal(error.code, "INVALID_INPUT");
      assert.deepEqual(error.issues!.map((i) => [i.path, i.code]), [["goals.count_scope_schedule", "count_scope_not_prospective"]]);
      return true;
    });

  // A new entry at today (or in the past) would change a day that has started.
  await refusedProspective([{ from_day: "2026-10-06", scope: "eligible_new_quoted" }], "today");
  await refusedProspective([{ from_day: "2026-10-01", scope: "eligible_new_quoted" }], "past");
  assert.equal(db.pointer!.revision, 5, "nothing written");

  // The D1 PATCH shape: from tomorrow. Accepted.
  const tomorrow = await patch([{ from_day: "2026-10-07", scope: "eligible_new_quoted" }], "tomorrow");
  assert.deepEqual([tomorrow.response.changed, tomorrow.response.revision], [true, 6]);
  revision = 6;
  // Still in the future: the entry may be edited or removed.
  const moved = await patch([{ from_day: "2026-10-08", scope: "eligible_new_quoted" }], "move-future");
  assert.equal(moved.response.revision, 7);
  revision = 7;

  // The next day: the 2026-10-08 entry has started.
  db.now = new Date("2026-10-08T13:00:00Z");
  await refusedProspective([{ from_day: "2026-10-08", scope: "all_outbound" }], "edit-started");
  await refusedProspective([], "remove-started");
  await refusedProspective([{ from_day: "2026-10-07", scope: "all_outbound" }, { from_day: "2026-10-08", scope: "eligible_new_quoted" }], "insert-before");
  // Appending a later flip back keeps the started entry identical: accepted.
  const back = await patch([{ from_day: "2026-10-08", scope: "eligible_new_quoted" }, { from_day: "2026-10-09", scope: "all_outbound" }], "flip-back");
  assert.equal(back.response.revision, 8);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.deepEqual(active.value.goals.count_scope_schedule, [
    { from_day: "2026-10-08", scope: "eligible_new_quoted" },
    { from_day: "2026-10-09", scope: "all_outbound" },
  ]);
});

// ---- olr B3: engine_policy_unavailable ------------------------------------------------------

test("B3 engine_policy_unavailable: PATCH refuses a value whose engine policy is unavailable while cadence is on (400); allowed when cadence is off", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, revision5(), REVISION_5_HASH);
  db.now = new Date("2026-10-06T15:00:00Z");
  type Rev5 = ReturnType<typeof revision5>;
  const edit = (change: (value: Rev5) => void) => {
    const value = revision5();
    change(value);
    return value;
  };
  const intake = (value: Rev5) => value.cadence!.intake_default_rule as Record<string, string>;
  const patch = (value: Rev5, key: string, expected_revision: number) =>
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: `b3-${key}`, expected_revision, value }, db.deps());

  // A native source set to review parses but cannot be represented by the engine: refused with every reason.
  await assert.rejects(patch(edit((v) => (intake(v).manual = "review")), "native-review", 5), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.equal(error.code, "INVALID_INPUT");
    assert.deepEqual(error.issues!.map((i) => [i.path, i.code]), [["cadence", "engine_policy_unavailable"]]);
    assert.match(error.issues![0]!.message!, /intake_default_rule: the engine encodes only native intake = new/);
    return true;
  });
  // Several engine problems are all listed.
  await assert.rejects(
    patch(edit((v) => { intake(v).website_form = "review"; v.cadence!.quoted_open_minute = 600; }), "two-reasons", 5),
    (error: unknown) => {
      assert.ok(error instanceof OutreachError);
      assert.deepEqual(error.issues!.map((i) => i.code), ["engine_policy_unavailable", "engine_policy_unavailable"]);
      return true;
    },
  );
  assert.deepEqual([db.pointer!.revision, db.versions.size, db.audits.length], [5, 1, 0], "nothing written");

  // The D3 amendment (P05e-1): Granot-created missing priority → New is accepted and resolves.
  const d3 = await patch(edit((v) => (intake(v).granot_created = "new")), "d3", 5);
  assert.deepEqual([d3.response.changed, d3.response.revision], [true, 6]);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.value.cadence.intake_default_rule?.granot_created, "new");
  assert.equal(deskEnginePolicy(active.value).ok, true, "projections keep evaluating");

  // With cadence off the evaluator does not run: a staged unresolvable value is accepted.
  const staged = await patch(
    edit((v) => {
      intake(v).manual = "review";
      v.controls!.cadence_shadow_enabled = false;
      v.controls!.cadence_enforcement_enabled = false;
    }),
    "cadence-off",
    6,
  );
  assert.deepEqual([staged.response.changed, staged.response.revision], [true, 7]);
  // Turning cadence back on with that value is refused.
  await assert.rejects(patch(edit((v) => (intake(v).manual = "review")), "cadence-on-again", 7), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.deepEqual(error.issues!.map((i) => i.code), ["engine_policy_unavailable"]);
    return true;
  });
  assert.equal(db.pointer!.revision, 7);
});

test("P08a-1: an override for an Agent off the configured list is refused under explicit and accepted under desk_reps; the rule is a closed enum", () => {
  const stranger = "9".repeat(24);
  const withOverride = (rule?: unknown) => {
    const value = revision5();
    value.goals!.effective_day_overrides = [{ agent_id: stranger, business_date: "2026-10-05", goal: 0, reason: "absence" }];
    if (rule !== undefined) value.goals!.roster_rule = rule;
    return value;
  };
  const explicit = salesOutreachConfigurationValueSchema.safeParse(withOverride());
  assert.equal(explicit.success, false);
  assert.ok(explicit.error!.issues.some((i) => i.path.join(".") === "goals.effective_day_overrides.0.agent_id"), "override for a rep not on the roster");
  const explicitNamed = salesOutreachConfigurationValueSchema.safeParse(withOverride("explicit"));
  assert.equal(explicitNamed.success, false);
  const derived = salesOutreachConfigurationValueSchema.safeParse(withOverride("desk_reps"));
  assert.equal(derived.success, true, JSON.stringify(derived.error?.issues));
  assert.equal(derived.data!.goals.roster_rule, "desk_reps");
  assert.equal(salesOutreachConfigurationValueSchema.safeParse(withOverride("everyone")).success, false, "closed enum");
});
