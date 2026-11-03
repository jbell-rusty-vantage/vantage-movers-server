import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { externalCallAdmissionSchema, hasReportingEligibleCall, hasTrustedExternalCallAdmission,
  reportingEligibleCallLeadFilter, EXTERNAL_CALL_ADMISSION_POLICY_VERSION,
  BEST_RELOCATION_ADMISSION_COMPANY_ID as COMPANY, BEST_RELOCATION_ADMISSION_CALL_FEED_ID as FEED } from "./callLeadAdmission";
import { BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION } from "./externalSheetReview";
import { billableCallLeadExpression, billableCallLeadFilter, getCallLeadReportingDecision } from "./callLeadReportingDisposition";
import { hasQualifiedRingCentralCall } from "../ringcentral/callLeadQualification";
import { aggregateSourcePerformance } from "../reporting/query/canonicalReporting";
import { planExpectedSheetTabs } from "../googleSheets/expectedSheetTabs";
import { getCallLeadModel } from "../../models/CallLead";
import { planFormSiblingUpdate } from "../granotLifecycle/callLeadFormSibling";
import { LEGACY_BEST_RELOCATION_CALL_IDS, LEGACY_BEST_RELOCATION_CALL_MANIFEST } from "./legacyBestRelocationCalls";

function admitted() {
  return { source_company: "best_relocation_leads", lead_source_company: new mongoose.Types.ObjectId(COMPANY),
    source_granularity_id: new mongoose.Types.ObjectId(FEED), external_call_admission: {
      policy_version: EXTERNAL_CALL_ADMISSION_POLICY_VERSION, source_workbook_id: BEST_RELOCATION_TRACKER_ID,
      source_sheet_id: 1191420872, source_tab: "Calls", stable_source_row_id: "lead:fixture",
      source_content_hash: "a".repeat(64), source_company_id: COMPANY, source_granularity_id: FEED,
      source_arrival_at: new Date("2026-11-03T08:00:00Z"), ingestion_run_id: "650000000000000000000001",
      source_row_receipt_id: "650000000000000000000002", applied_at: new Date("2026-11-03T21:00:00Z"),
    } };
}

function historical(id: string = LEGACY_BEST_RELOCATION_CALL_IDS[0]) {
  return { _id: new mongoose.Types.ObjectId(id), source_company: "best_relocation_leads",
    lead_source_company: new mongoose.Types.ObjectId(COMPANY), source_granularity_id: new mongoose.Types.ObjectId(FEED) };
}

test("closed native historical inventory preserves exactly 69 scoped Calls without stamping or qualifying them", () => {
  assert.equal(LEGACY_BEST_RELOCATION_CALL_IDS.length, 69);
  assert.equal(new Set(LEGACY_BEST_RELOCATION_CALL_IDS).size, 69);
  assert.deepEqual([...LEGACY_BEST_RELOCATION_CALL_IDS].sort(), LEGACY_BEST_RELOCATION_CALL_IDS);
  assert.equal(createHash("sha256").update(JSON.stringify(LEGACY_BEST_RELOCATION_CALL_IDS)).digest("hex"), LEGACY_BEST_RELOCATION_CALL_MANIFEST.id_sha256);
  assert.equal(LEGACY_BEST_RELOCATION_CALL_MANIFEST.captured_at, "2026-11-03T21:43:54.101Z");
  for (const id of LEGACY_BEST_RELOCATION_CALL_IDS) {
    const row = historical(id), before = JSON.stringify(row);
    assert.equal(hasReportingEligibleCall(row), true);
    assert.equal(hasReportingEligibleCall({ ...row, _id: id, lead_source_company: COMPANY, source_granularity_id: FEED }), true);
    assert.equal(hasQualifiedRingCentralCall(undefined), false);
    assert.equal(JSON.stringify(row), before);
    assert.equal("external_call_admission" in row, false);
  }
  const row = historical();
  for (const patch of [{ _id: new mongoose.Types.ObjectId() }, { _id: [row._id] }, { source_company: "tbm_leads" },
    { source_company: ["best_relocation_leads"] }, { lead_source_company: "650000000000000000000099" },
    { lead_source_company: [COMPANY] }, { source_granularity_id: "650000000000000000000099" }, { source_granularity_id: [FEED] }]) {
    assert.equal(hasReportingEligibleCall({ ...row, ...patch }), false);
  }
  assert.deepEqual(getCallLeadReportingDecision(row), { disposition: "calls", billable: true, reason_codes: [] });
  assert.equal(getCallLeadReportingDecision({ ...row, duplicate: true }).disposition, "duplicate_calls");
  assert.equal(getCallLeadReportingDecision({ ...row, form_fill: true }).disposition, "duplicate_calls");
  assert.equal(getCallLeadReportingDecision({ ...row, created_on_unmatched: true }).disposition, "excluded");
  assert.equal(getCallLeadReportingDecision({ ...row, no_sync: true }).billable, true);
  assert.equal(planExpectedSheetTabs("CallLead", { ...row, no_sync: true }).expected.length, 0);
});

test("trusted final BR admission enables reporting without asserting RingCentral qualification", () => {
  const row = admitted();
  assert.equal(externalCallAdmissionSchema.safeParse(row.external_call_admission).success, true);
  assert.equal(hasReportingEligibleCall(row), true);
  assert.equal(hasQualifiedRingCentralCall(undefined), false);
  assert.deepEqual(getCallLeadReportingDecision(row), { disposition: "calls", billable: true, reason_codes: [] });
  assert.equal(planExpectedSheetTabs("CallLead", row).expected[0]?.tabName, "Calls");
  const totals = aggregateSourcePerformance([{ ...row, _id: "admitted", leadType: "call", cpl: 50, cpl_resolution_status: "resolved" }], [], new Map());
  assert.equal(totals.resolved_cpl_spend, 50);
  const now = new Date("2026-11-03T22:00:00Z");
  const sibling = planFormSiblingUpdate({ _id: "650000000000000000000010", lead_source_company: COMPANY,
    job_no: "JOB1", normalized_job_no: "JOB1", createdAt: now }, [],
  [{ ...row, _id: "650000000000000000000020", createdAt: now }], now);
  assert.equal(sibling.kind, "update");
});

const corruptions: Record<string, unknown>[] = [
  { policy_version: "best-relocation-retirement-v1" }, { source_workbook_id: "another-workbook" },
  { source_sheet_id: 0 }, { source_tab: "Local Calls" }, { stable_source_row_id: "  " },
  { stable_source_row_id: "x".repeat(257) }, { stable_source_row_id: "😀".repeat(129) },
  { source_content_hash: "a".repeat(63) }, { source_company_id: "650000000000000000000099" },
  { source_granularity_id: "650000000000000000000099" }, { ingestion_run_id: "run" },
  { source_row_receipt_id: "receipt" }, { source_arrival_at: "2026-11-03T08:00:00Z" },
  { applied_at: "2026-11-03T21:00:00Z" }, { applied_at: new Date(NaN) }, { source_tab: ["Calls"] },
];

test("unproven history and corrupted, foreign, or ISO-string stamps never admit Calls", () => {
  assert.equal(hasReportingEligibleCall({ source_company: "best_relocation_leads" }), false);
  for (const patch of corruptions) {
    const fact = { ...admitted().external_call_admission, ...patch };
    assert.equal(hasTrustedExternalCallAdmission(fact), false, JSON.stringify(patch));
    assert.equal(hasReportingEligibleCall({ ...admitted(), external_call_admission: fact }), false);
  }
  for (const patch of [{ source_company: "tbm_leads" }, { lead_source_company: "650000000000000000000099" },
    { source_granularity_id: "650000000000000000000099" }, { source_company: ["best_relocation_leads"] }]) {
    assert.equal(hasReportingEligibleCall({ ...admitted(), ...patch }), false);
  }
});

test("RC historical facts still admit any source independently of external evidence", () => {
  const ringcentral = { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 120, call_log_id: "log" };
  assert.equal(hasReportingEligibleCall({ source_company: "tbm_leads", ringcentral }), true);
  assert.equal(hasReportingEligibleCall({ ...admitted(), external_call_admission: null, ringcentral }), true);
});

test("admitted BR Calls use the same bad, duplicate, Form Fill and unmatched dispositions", () => {
  const row = admitted();
  const review = { raw_value: "note", normalized_value: "note", source_workbook_id: BEST_RELOCATION_TRACKER_ID,
    source_sheet_id: 1191420872, source_tab: "Calls", stable_source_row_id: "lead:fixture",
    source_content_hash: "a".repeat(64), policy_version: EXTERNAL_REVIEW_POLICY_VERSION,
    ingestion_run_id: "run", source_row_receipt_id: "receipt", applied_at: new Date() };
  assert.equal(getCallLeadReportingDecision({ ...row, external_sheet_review: { ...review, kind: "bad_call", reason_code: "external_bad_call" } }).disposition, "bad_call_leads");
  const duplicate = { ...row, no_sync: true, external_sheet_review: { ...review, kind: "duplicate_call", reason_code: "external_form_fill" } };
  assert.equal(getCallLeadReportingDecision(duplicate).disposition, "duplicate_calls");
  assert.equal(planExpectedSheetTabs("CallLead", duplicate).expected[0]?.tabName, "Duplicate Calls");
  assert.equal(getCallLeadReportingDecision({ ...row, form_fill: true }).billable, false);
  assert.equal(getCallLeadReportingDecision({ ...row, created_on_unmatched: true }).disposition, "excluded");
});

test("Call model validates the stamp on insert and rejects a nested admission edit on a saved document", async () => {
  const model = getCallLeadModel();
  const input = { ...admitted(), phone_number: "5551234567" };
  await new model(input).validate();
  const persisted = model.hydrate({ ...input, _id: new mongoose.Types.ObjectId(), domain_revision: 0 });
  persisted.set("external_call_admission.source_content_hash", "b".repeat(64));
  await assert.rejects(persisted.validate(), /immutable after insert/);
});

test("loopback Mongo: persisted admission object/filter/billing expression agree and stamp cannot be ordinarily rewritten", {
  skip: process.env.RUN_CALL_ADMISSION_LOCAL_TEST !== "1",
}, async () => {
  // Explicit loopback URI and dedicated test database: never use application credentials.
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_calladmissionproof";
  await mongoose.connect("mongodb://127.0.0.1:27119/?replicaSet=callReportingProof", { dbName: "testvantagemovers_calladmissionproof", serverSelectionTimeoutMS: 8000 });
  const model = getCallLeadModel();
  const base = admitted();
  const validReview = { kind: "bad_call", reason_code: "external_bad_call", raw_value: "bad", normalized_value: "bad",
    policy_version: EXTERNAL_REVIEW_POLICY_VERSION, source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 1191420872,
    source_tab: "Calls", stable_source_row_id: "lead:fixture", source_content_hash: "a".repeat(64),
    ingestion_run_id: "run", source_row_receipt_id: "receipt", applied_at: new Date() };
  const qualified = { source_company: "synthetic", ringcentral: { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 120, call_log_id: "log" } };
  const fixtures: Record<string, unknown>[] = [base,
    { ...base, duplicate: true }, { ...base, form_fill: true }, { ...base, created_on_unmatched: true },
    { ...base, external_call_admission: { ...base.external_call_admission, stable_source_row_id: "😀".repeat(128) } },
    ...corruptions.filter(patch => !(patch.applied_at instanceof Date && Number.isNaN(+patch.applied_at))).map(patch => ({ ...base, external_call_admission: { ...base.external_call_admission, ...patch } })),
    ...[{ source_company: "tbm_leads" }, { lead_source_company: "650000000000000000000099" }, { source_company: ["best_relocation_leads"] }].map(patch => ({ ...base, ...patch })),
    { ...base, external_call_admission: { ...base.external_call_admission, source_arrival_at: [base.external_call_admission.source_arrival_at] } },
    qualified,
    { ...qualified, external_sheet_review: validReview },
    ...Object.entries(validReview).map(([key, value]) => ({ ...qualified, external_sheet_review: { ...validReview, [key]: [value] } })),
  ];
  const docs = fixtures.map(row => ({ ...row, _id: new mongoose.Types.ObjectId(), timestamp: new Date(), phone_number: "5551234567", domain_revision: 0 }));
  const ids = docs.map(row => row._id);
  try {
    await model.collection.insertMany(docs as never);
    const persisted = await model.collection.find({ _id: { $in: ids } }).toArray();
    const eligible = await model.collection.find({ $and: [{ _id: { $in: ids } }, reportingEligibleCallLeadFilter()] }).toArray();
    assert.deepEqual(eligible.map(row => String(row._id)).sort(), persisted.filter(hasReportingEligibleCall).map(row => String(row._id)).sort());
    const billable = await model.collection.find({ $and: [{ _id: { $in: ids } }, billableCallLeadFilter()] }).toArray();
    const expected = persisted.filter(row => getCallLeadReportingDecision(row).billable).map(row => String(row._id)).sort();
    assert.deepEqual(billable.map(row => String(row._id)).sort(), expected);
    const expressed = await model.collection.aggregate([{ $match: { _id: { $in: ids } } }, { $project: { billable: billableCallLeadExpression() } }]).toArray();
    assert.deepEqual(expressed.filter(row => row.billable).map(row => String(row._id)).sort(), expected);
    await assert.rejects(model.updateOne({ _id: ids[0] }, { $set: { "external_call_admission.source_content_hash": "b".repeat(64), external_call_admission: { ...base.external_call_admission, stable_source_row_id: "forged" } } }), /trusted final-import command/);
    await assert.rejects(model.updateOne({ _id: ids[0] }, { $unset: { external_call_admission: 1 } }), /trusted final-import command/);
    await assert.rejects(model.updateOne({ _id: ids[0] }, { $rename: { name: "external_call_admission" } }), /trusted final-import command/);
    const saved = await model.collection.findOne({ _id: ids[0] });
    assert.equal(saved?.external_call_admission.source_content_hash, "a".repeat(64));
    assert.equal(saved?.external_call_admission.stable_source_row_id, "lead:fixture");
  } finally {
    await model.collection.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  }
});

test("loopback Mongo: all fixed historical IDs agree across object, indexed match and billing expression", {
  skip: process.env.RUN_CALL_ADMISSION_LOCAL_TEST !== "1",
}, async () => {
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_legacycallproof";
  await mongoose.connect("mongodb://127.0.0.1:27119/?replicaSet=callReportingProof", { dbName: "testvantagemovers_legacycallproof", serverSelectionTimeoutMS: 8000 });
  const collection = mongoose.connection.db!.collection("legacy_reporting_parity_fixtures");
  const fixtures: Record<string, unknown>[] = LEGACY_BEST_RELOCATION_CALL_IDS.map((id, index) => ({ ...historical(id),
    duplicate: index === 1, form_fill: index === 2, created_on_unmatched: index === 3, no_sync: index === 4,
  }));
  fixtures.push({ ...historical(), _id: LEGACY_BEST_RELOCATION_CALL_IDS[5], lead_source_company: COMPANY, source_granularity_id: FEED });
  fixtures.push({ ...historical(), _id: new mongoose.Types.ObjectId() });
  const corruptions = [{ source_company: "tbm_leads" }, { lead_source_company: "650000000000000000000099" },
    { source_granularity_id: "650000000000000000000099" }, { source_company: ["best_relocation_leads"] },
    { lead_source_company: [new mongoose.Types.ObjectId(COMPANY)] }, { source_granularity_id: [FEED] }];
  for (const [index, patch] of corruptions.entries()) fixtures.push({ ...historical(), _id: LEGACY_BEST_RELOCATION_CALL_IDS[index + 6], ...patch });
  const ids = fixtures.map(row => row._id);
  const identity = (row: Record<string, unknown>) => `${typeof row._id}:${String(row._id)}`;
  try {
    await collection.insertMany(fixtures);
    const persisted = await collection.find({ _id: { $in: ids } } as never).toArray();
    const eligible = await collection.find({ $and: [{ _id: { $in: ids } }, reportingEligibleCallLeadFilter()] }).toArray();
    assert.deepEqual(eligible.map(identity).sort(), persisted.filter(hasReportingEligibleCall).map(identity).sort());
    assert.equal(eligible.length, 70);
    const expected = persisted.filter(row => getCallLeadReportingDecision(row).billable).map(identity).sort();
    const matched = await collection.find({ $and: [{ _id: { $in: ids } }, billableCallLeadFilter()] }).toArray();
    assert.deepEqual(matched.map(identity).sort(), expected);
    const expressed = await collection.aggregate([{ $match: { _id: { $in: ids } } }, { $project: { billable: billableCallLeadExpression() } }]).toArray();
    assert.deepEqual(expressed.filter(row => row.billable).map(identity).sort(), expected);
    assert.deepEqual(await collection.find({ _id: { $in: ids } } as never).toArray(), persisted);
  } finally {
    await collection.deleteMany({ _id: { $in: ids } } as never);
    await mongoose.disconnect();
  }
});
