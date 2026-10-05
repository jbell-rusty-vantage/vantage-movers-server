import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SALES_OUTREACH_MODEL_REGISTRY } from "./registry";
import { getSalesOutreachConfigurationModel, salesOutreachConfigurationVersionKey } from "./configuration";
import { getSalesOutreachSubjectModel } from "./subjects";
import { getSalesOutreachRepDayProjectionModel } from "./projections";
import { CSI_MODEL_REGISTRY } from "../salesIntelligence/registry";
import { salesOutreachConfigurationValueSchema } from "../../validation/v1/salesOutreach";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

const EXPECTED_COLLECTIONS = [
  "sales_outreach_configuration",
  "sales_outreach_subjects",
  "sales_outreach_policy_periods",
  "sales_outreach_followup_schedules",
  "sales_outreach_contact_events",
  "sales_outreach_projections",
  "sales_outreach_rep_day_projections",
  "sales_outreach_enrollment_runs",
  "sales_outreach_live_events",
  "ringcentral_rep_sms_evidence",
];

test("the desk registry holds exactly the IMPLEMENTATION-PLAN §4.1–§4.6/§4.8 collections, isolated and never auto-indexed", () => {
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_sodunit";
  assert.deepEqual(SALES_OUTREACH_MODEL_REGISTRY.map((e) => e.model().collection.collectionName), EXPECTED_COLLECTIONS);
  for (const entry of SALES_OUTREACH_MODEL_REGISTRY) {
    const model = entry.model();
    assert.equal(model.db.name, "testvantagemovers_sodunit");
    assert.equal(model.schema.options.autoIndex, false, entry.name);
    assert.equal(model.schema.options.autoCreate, false, entry.name);
    assert.ok(entry.indexes.length > 0, entry.name);
    // Every declared index carries a stable name, the build script's idempotency key.
    assert.equal(new Set(entry.indexes.map((i) => i.name)).size, entry.indexes.length, entry.name);
    for (const index of entry.indexes) assert.match(index.name, /^sod_/);
  }
  const csiCollections = CSI_MODEL_REGISTRY.map((e) => e.model().collection.collectionName);
  for (const collection of EXPECTED_COLLECTIONS) assert.ok(csiCollections.includes(collection), collection);
});

test("the plan's uniqueness fences and queue sort indexes are declared", () => {
  const byName = new Map(SALES_OUTREACH_MODEL_REGISTRY.flatMap((e) => e.indexes.map((i) => [i.name, i] as const)));
  assert.deepEqual(byName.get("sod_subject_lead_unique")?.key, { lead_model: 1, lead_id: 1 });
  assert.equal(byName.get("sod_subject_lead_unique")?.unique, true);
  assert.deepEqual(byName.get("sod_period_active_unique")?.partialFilterExpression, { ended_at: null });
  assert.deepEqual(byName.get("sod_period_transition_unique")?.key, { subject_id: 1, transition_key: 1 });
  assert.deepEqual(byName.get("sod_followup_active_unique")?.partialFilterExpression, { status: "active" });
  assert.deepEqual(byName.get("sod_contact_source_unique")?.key, { source_kind: 1, source_id: 1, subject_id: 1 });
  assert.deepEqual(byName.get("sod_rep_day_unique")?.key, { agent_id: 1, business_day: 1 });
  assert.deepEqual(byName.get("sod_projection_q_urgency")?.key, {
    assigned_agent_id: 1,
    "status_flags.needs_contact": 1,
    "queue_keys.urgency_due": 1,
    "queue_keys.urgency_next": 1,
    "queue_keys.received_asc": 1,
    subject_id: 1,
  });
  assert.ok(byName.get("sod_projection_q_team_urgency"));
  assert.ok(byName.get("sod_projection_q_received_asc"));
  assert.ok(byName.get("sod_projection_q_received_desc"));
  assert.ok(byName.get("sod_projection_q_interaction"));
  assert.ok(byName.get("sod_projection_next_evaluation"));
  assert.deepEqual(byName.get("sod_configuration_key_unique")?.key, { key: 1 });
});

test("subjects and rep days are strict: unknown fields and unknown enum values are refused", async () => {
  const Subject = getSalesOutreachSubjectModel();
  const base = {
    lead_model: "FormLead",
    lead_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    enrollment: { cohort_id: "pilot-1", kind: "pilot", enrolled_at: new Date(), activation_at: new Date() },
    received_quality: "wall_clock",
    adapter_version: "lead-instant-v1",
  };
  await new Subject(base).validate();
  await assert.rejects(new Subject({ ...base, status: "open" }).validate());
  assert.throws(() => new Subject({ ...base, outreach_id: "x" }));
  const RepDay = getSalesOutreachRepDayProjectionModel();
  const day = {
    agent_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    business_day: "2026-10-04",
    count_scope: "all_outbound",
    goal_state: "goal",
    input_fingerprint: "f",
    computed_as_of: new Date(),
  };
  await new RepDay(day).validate();
  await assert.rejects(new RepDay({ ...day, progress: 1.2 }).validate());
  await assert.rejects(new RepDay({ ...day, goal_state: "achieved" }).validate());
});

test("configuration documents are kind-checked; versions are insert-only and bulk writes are refused", async () => {
  const Configuration = getSalesOutreachConfigurationModel();
  const value = salesOutreachConfigurationValueSchema.parse({});
  const actor = { kind: "owner", id: "owner-1", request_id: "r1", run_id: null };
  const version = {
    kind: "version",
    key: salesOutreachConfigurationVersionKey("v1"),
    version: "v1",
    schema_version: 1,
    value,
    content_hash: "h",
    created_by: actor,
  };
  await new Configuration(version).validate();
  await assert.rejects(new Configuration({ ...version, key: "version:other" }).validate());
  await assert.rejects(new Configuration({ ...version, value: { controls: { desk_enabled: "yes" } } }).validate());
  const pointer = { kind: "pointer", key: "active", version: "v1", content_hash: "h", revision: 1, updated_by: "owner-1" };
  await new Configuration(pointer).validate();
  await assert.rejects(new Configuration({ ...pointer, revision: 0 }).validate());
  await assert.rejects(new Configuration({ ...pointer, key: "other" }).validate());
  await assert.rejects(new Configuration({ ...pointer, content_hash: null }).validate());
  await assert.rejects(new Configuration({ ...pointer, value }).validate());
  // Query guards run before any database access.
  await assert.rejects(Configuration.updateOne({ key: "version:v1" }, { $set: { content_hash: "x" } }).exec(), /immutable/);
  await assert.rejects(Configuration.deleteMany({}).exec(), /immutable/);
  await assert.rejects(Configuration.bulkWrite([]), /bulk mutation is forbidden/);
});

test("the CONTRACTS bootstrap defaults are exactly what an empty value normalizes to", () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, "../../../docs/sales-outreach-desk/contracts/configuration-defaults.json"), "utf8"),
  ) as { value: Record<string, Record<string, unknown>> };
  const normalized = salesOutreachConfigurationValueSchema.parse({}) as unknown as Record<string, Record<string, unknown>>;
  for (const [namespace, fields] of Object.entries(fixture.value))
    for (const [key, expected] of Object.entries(fields)) assert.deepEqual(normalized[namespace]![key], expected, `${namespace}.${key}`);
  assert.deepEqual(salesOutreachConfigurationValueSchema.parse(fixture.value), normalized);
});
