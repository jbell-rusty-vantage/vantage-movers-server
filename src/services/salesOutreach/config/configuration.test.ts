import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DESK_TIMING_DEFAULTS } from "../../../config/domain/salesOutreach";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { salesOutreachConfigurationValueSchema, type SalesOutreachConfigurationInput } from "../../../validation/v1/salesOutreach";
import { OutreachError } from "../errors";
import { patchSalesOutreachConfiguration } from "./commands";
import { createConfigurationLoader } from "./load";
import { readSalesOutreachConfiguration } from "./reads";
import { configurationContentHash, type ConfigurationVersion } from "./store";
import { CONFIGURATION_REVISION_5_HASH as REVISION_5_HASH, configurationRevision5Value as revision5, MemoryConfigurationDb } from "./testing";
import { deskTimingOf } from "./timing";

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

// ---- olr A0: configuration evolution safety -------------------------------------------------

/** Stores `value` verbatim (as an older deploy wrote it) and points the active pointer at it. */
function storeRaw(db: MemoryConfigurationDb, value: unknown, content_hash: string, revision = 5): ConfigurationVersion {
  const row: ConfigurationVersion = { version: `sod-config-rev${revision}`, value, content_hash, approval_ref: "owner-session-2026-10-03-FINAL-01", created_by: "owner", created_at: new Date(0) };
  db.versions.set(row.version, row);
  db.pointer = { id: "pointer-1", version: row.version, content_hash, revision, updated_by: "owner", updated_at: new Date(0) };
  return row;
}

test("the revision-5 stored value re-parses to the same content hash (no schema default leaks into old versions)", () => {
  const stored = revision5();
  assert.equal(configurationContentHash(stored as never), REVISION_5_HASH, "fixture unchanged");
  const parsed = salesOutreachConfigurationValueSchema.parse(stored);
  assert.equal(configurationContentHash(parsed), REVISION_5_HASH);
  assert.deepEqual(parsed, stored, "parsing adds, drops or rewrites nothing");
  assert.equal("operations" in parsed, false);
  for (const key of ["call_settlement_allowance_minutes", "today_coverage_tolerance_minutes", "capture_freshness_tolerance_minutes", "webhook_silence_minutes"])
    assert.equal(key in parsed.evidence, false, key);
});

test("a version stored before a schema addition loads active with its stored hash", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, revision5(), REVISION_5_HASH);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.deepEqual([active.revision, active.version, active.content_hash], [5, "sod-config-rev5", REVISION_5_HASH]);
  assert.equal(active.value.controls.cadence_enforcement_enabled, true);
  const read = await readSalesOutreachConfiguration(createConfigurationLoader(db.store));
  assert.deepEqual([read.configuration_state, read.revision, read.content_hash, read.unavailable_reason], ["active", 5, REVISION_5_HASH, null]);
});

test("a stored value the current schema would normalize differently still loads (integrity is checked on the value as written)", async () => {
  // Written by a deploy whose schema had no `intake_admission_watermark` yet: today's schema fills it with null,
  // so the parsed hash differs from the stored one. The raw-value check keeps the version active.
  const stored = revision5();
  delete stored.transition!.intake_admission_watermark;
  const rawHash = configurationContentHash(stored as never);
  assert.notEqual(configurationContentHash(salesOutreachConfigurationValueSchema.parse(stored)), rawHash, "precondition: parsed form differs");
  const db = new MemoryConfigurationDb();
  storeRaw(db, stored, rawHash);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.content_hash, rawHash);
  assert.equal(active.value.transition.intake_admission_watermark, null);
});

test("legacy path: a version whose hash was taken on the parsed value (raw value sparser) stays active", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, { controls: { desk_enabled: true } }, configurationContentHash(salesOutreachConfigurationValueSchema.parse({ controls: { desk_enabled: true } })), 2);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.value.controls.desk_enabled, true);
});

test("a tampered stored value is hash_mismatch; a version/pointer hash disagreement is hash_mismatch", async () => {
  const tampered = revision5();
  tampered.goals!.default_scheduled_goal = 1;
  const db = new MemoryConfigurationDb();
  storeRaw(db, tampered, REVISION_5_HASH);
  const inspected = await createConfigurationLoader(db.store).inspect();
  assert.deepEqual([inspected.state, inspected.state === "unavailable" && inspected.reason], ["unavailable", "hash_mismatch"]);

  const other = new MemoryConfigurationDb();
  storeRaw(other, revision5(), REVISION_5_HASH);
  other.pointer = { ...other.pointer!, content_hash: "0".repeat(64) };
  const disagree = await createConfigurationLoader(other.store).inspect();
  assert.equal(disagree.state === "unavailable" && disagree.reason, "hash_mismatch");
});

test("new optional keys leave old hashes valid and are hashed only when set", async () => {
  const db = new MemoryConfigurationDb();
  storeRaw(db, revision5(), REVISION_5_HASH);
  // Re-submitting the revision-5 content is still "identical content": no new version.
  const same = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "same", expected_revision: 5, value: revision5() }, db.deps());
  assert.deepEqual([same.response.revision, same.response.changed, same.response.content_hash], [5, false, REVISION_5_HASH]);
  // Setting a new key is a real change with a new hash, and the new version loads active.
  const withKeys = revision5();
  withKeys.evidence!.webhook_silence_minutes = 45;
  withKeys.operations = { evaluate_drain_max_jobs: 200 };
  const changed = await patchSalesOutreachConfiguration({ actor: owner, idempotency_key: "tunables", expected_revision: 5, value: withKeys }, db.deps());
  assert.equal(changed.response.changed, true);
  assert.notEqual(changed.response.content_hash, REVISION_5_HASH);
  const active = await createConfigurationLoader(db.store).requireActive();
  assert.equal(active.revision, 6);
  assert.equal(active.value.evidence.webhook_silence_minutes, 45);
  assert.deepEqual(active.value.operations, { evaluate_drain_max_jobs: 200 });
});

test("deskTimingOf: absent timing keys resolve to the code defaults; set keys win", () => {
  const defaults = deskTimingOf(salesOutreachConfigurationValueSchema.parse(revision5()));
  assert.deepEqual(defaults, {
    call_settlement_allowance_ms: 2 * 60_000,
    today_coverage_tolerance_ms: 25 * 60_000,
    capture_freshness_tolerance_ms: 10 * 60_000,
    webhook_silence_ms: 30 * 60_000,
    evaluate_drain_max_jobs: 100,
    evaluate_drain_budget_ms: 40_000,
    evaluate_drain_concurrency: 1,
  });
  assert.deepEqual(deskTimingOf(null), defaults, "no configuration (capture-side callers) = defaults");
  assert.deepEqual(deskTimingOf(salesOutreachConfigurationValueSchema.parse({})), defaults);
  assert.equal(DESK_TIMING_DEFAULTS.evaluate_drain_max_jobs, 100);

  const set = salesOutreachConfigurationValueSchema.parse({
    evidence: { call_settlement_allowance_minutes: 0, today_coverage_tolerance_minutes: 40, capture_freshness_tolerance_minutes: 5, webhook_silence_minutes: 60 },
    operations: { evaluate_drain_max_jobs: 250, evaluate_drain_budget_seconds: 50, evaluate_drain_concurrency: 2 },
  });
  assert.deepEqual(deskTimingOf(set), {
    call_settlement_allowance_ms: 0,
    today_coverage_tolerance_ms: 40 * 60_000,
    capture_freshness_tolerance_ms: 5 * 60_000,
    webhook_silence_ms: 60 * 60_000,
    evaluate_drain_max_jobs: 250,
    evaluate_drain_budget_ms: 50_000,
    evaluate_drain_concurrency: 2,
  });
  const partial = deskTimingOf(salesOutreachConfigurationValueSchema.parse({ operations: { evaluate_drain_concurrency: 3 } }));
  assert.deepEqual([partial.evaluate_drain_concurrency, partial.evaluate_drain_max_jobs, partial.webhook_silence_ms], [3, 100, 30 * 60_000]);
});

test("timing keys are bounded; today tolerance must exceed settlement + 15 (400 INVALID_INPUT)", async () => {
  const db = new MemoryConfigurationDb();
  const attempt = (value: unknown) =>
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: `timing-${Math.random()}`, expected_revision: 0, value }, db.deps());
  await assert.rejects(attempt({ evidence: { today_coverage_tolerance_minutes: 17 } }), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.equal(error.code, "INVALID_INPUT");
    assert.ok(error.issues!.some((i) => i.path === "evidence.today_coverage_tolerance_minutes"));
    return true;
  });
  // A configured settlement raises the floor too: 10 + 15 = 25 is not below the default 25.
  await rejectsWith(attempt({ evidence: { call_settlement_allowance_minutes: 10 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ evidence: { webhook_silence_minutes: 4 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ operations: { evaluate_drain_budget_seconds: 60 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ operations: { evaluate_drain_concurrency: 0 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ operations: { unknown_tunable: 1 } }), "INVALID_INPUT");
  await rejectsWith(attempt({ evidence: { capture_freshness_tolerance_minutes: 2.5 } }), "INVALID_INPUT");
  assert.equal(db.pointer, null);
  const ok = await attempt({ evidence: { call_settlement_allowance_minutes: 5, today_coverage_tolerance_minutes: 21 } });
  assert.equal(ok.response.changed, true);
});

// ---- olr C1a: goals.count_scope_schedule ----------------------------------------------------

test("C1a: the revision-5 value (no count_scope_schedule) re-parses to the same hash; the key stays absent", () => {
  const parsed = salesOutreachConfigurationValueSchema.parse(revision5());
  assert.equal(configurationContentHash(parsed), REVISION_5_HASH);
  assert.equal("count_scope_schedule" in parsed.goals, false, "no default leaks into old versions");
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

test("C1a: the schedule must ascend by from_day, use known scopes and valid dates (400); initialization skips the guard", async () => {
  const db = new MemoryConfigurationDb();
  db.now = new Date("2026-10-06T15:00:00Z");
  const attempt = (schedule: unknown) =>
    patchSalesOutreachConfiguration({ actor: owner, idempotency_key: `c1a-shape-${Math.random()}`, expected_revision: 0, value: { goals: { count_scope_schedule: schedule } } }, db.deps());
  await assert.rejects(
    attempt([{ from_day: "2026-10-09", scope: "all_outbound" }, { from_day: "2026-10-08", scope: "eligible_new_quoted" }]),
    (error: unknown) => {
      assert.ok(error instanceof OutreachError);
      assert.equal(error.code, "INVALID_INPUT");
      assert.ok(error.issues!.some((i) => i.path === "goals.count_scope_schedule"));
      return true;
    },
  );
  await rejectsWith(attempt([{ from_day: "2026-10-08", scope: "eligible_new_quoted" }, { from_day: "2026-10-08", scope: "all_outbound" }]), "INVALID_INPUT");
  await rejectsWith(attempt([{ from_day: "2026-10-08", scope: "enrolled_only" }]), "INVALID_INPUT");
  await rejectsWith(attempt([{ from_day: "2026-02-30", scope: "all_outbound" }]), "INVALID_INPUT");
  await rejectsWith(attempt([{ from_day: "2026-10-08", scope: "all_outbound", note: "x" }]), "INVALID_INPUT");
  assert.equal(db.pointer, null);
  // Explicit initialization (no active value) has nothing to protect, even with a past entry.
  const init = await attempt([{ from_day: "2026-10-01", scope: "all_outbound" }]);
  assert.deepEqual([init.response.changed, init.response.revision], [true, 1]);
});
