import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import {
  getGranotLifecycleCaseDetail,
  listGranotLifecycleCaseCandidates,
  listGranotLifecycleCases,
  projectGranotJob,
  projectGranotLeadTimeline,
} from "./projections";

const seededIds = new Map<string, mongoose.Types.ObjectId[]>();

const MUTATION_SENSITIVE_COLLECTIONS = [
  "form_leads",
  "call_leads",
  "booked_leads",
  "cancelled_leads",
  "granot_booking_reconciliation_cases",
  "granot_record_links",
  "domain_command_executions",
  "entity_changes",
  "sheet_sync_jobs",
  "operational_events",
  "notifications",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

function remember(collection: string, id: mongoose.Types.ObjectId): void {
  seededIds.set(collection, [...(seededIds.get(collection) ?? []), id]);
}

async function insert(collection: string, document: Record<string, unknown>): Promise<void> {
  const id = document._id;
  assert.ok(id instanceof mongoose.Types.ObjectId);
  remember(collection, id);
  await mongoose.connection.db!.collection(collection).insertOne(document);
}

async function mutationCounts(): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(MUTATION_SENSITIVE_COLLECTIONS.map(async (name) => [
    name,
    await mongoose.connection.db!.collection(name).countDocuments(),
  ])));
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    for (const [collection, ids] of seededIds) {
      await mongoose.connection.db!.collection(collection).deleteMany({ _id: { $in: ids } });
    }
  }
  await mongoose.disconnect().catch(() => undefined);
});

test("[AC-18][AC-20][AC-35][AC-39] replica lifecycle reads leave aggregate and effect collection counts unchanged", async (t) => {
  if (!(await replicaReady(t))) return;

  const suffix = Date.now().toString().slice(-9);
  const job = `923${suffix}`;
  const leadId = new mongoose.Types.ObjectId();
  const observationId = new mongoose.Types.ObjectId();
  const receiptId = new mongoose.Types.ObjectId();
  const decisionId = new mongoose.Types.ObjectId();
  const linkId = new mongoose.Types.ObjectId();
  const caseId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const granularityId = new mongoose.Types.ObjectId();
  const capturedAt = new Date("2020-01-02T03:04:05.000Z");

  await insert("form_leads", {
    _id: leadId,
    name: "Synthetic Read Proof",
    phone_number: "0000004321",
    email: "unit23-read@example.invalid",
    job_no: job,
    normalized_job_no: job,
    lead_source_company: sourceId,
    source_granularity_id: granularityId,
    duplicate: false,
    bad_lead: null,
  });
  await insert("granot_observations", {
    _id: observationId,
    receipt_id: receiptId,
    captured_at: capturedAt,
    normalization_result: "valid",
    issues: [],
    identity: { normalized_job_no: job, job_no_raw: job },
    priority: { valid: true, canonical: "5" },
    booking_action: { normalized: "booked" },
  });
  await insert("synchronization_decisions", {
    _id: decisionId,
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "shadow",
    outcome: "already_current",
    reason_code: "desired_state_already_current",
    candidates: [],
    evaluated_gates: [],
    effects: [],
    decided_at: capturedAt,
  });
  await insert("granot_record_links", {
    _id: linkId,
    provider: "granot",
    normalized_job_no: job,
    job_no_snapshot: job,
    state: "active",
    lead_ref: { model: "FormLead", id: leadId },
    source_scope: { lead_source_company: sourceId, source_granularity_id: granularityId },
    disputed: false,
    established_by_decision_id: decisionId,
    established_at: capturedAt,
    last_observation_id: observationId,
    last_observed_at: capturedAt,
    domain_revision: 1,
  });
  await insert("granot_booking_reconciliation_cases", {
    _id: caseId,
    normalized_job_no: job,
    job_no_snapshot: job,
    action_kind: "booked",
    sequence_number: 1,
    mode: "create_missing_booking",
    state: "open",
    case_revision: 1,
    evidence_revision: 1,
    source_scope: {
      granot_crm_source_id: new mongoose.Types.ObjectId(),
      lead_source_company: sourceId,
      source_granularity_id: granularityId,
    },
    record_link_id: linkId,
    evidence: [{ observation_id: observationId, decision_id: decisionId, captured_at: capturedAt, action: "booked" }],
    observed_context: { contact: { name: "Synthetic Read Proof", phone_number: "0000004321" } },
    suggested_lead: {
      lead_ref: { model: "FormLead", id: leadId },
      confidence: "high",
      match_method: "form_ref_no_exact",
      reason_codes: ["form_ref_no_exact"],
    },
    opened_at: capturedAt,
    last_evidence_at: capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  });

  const before = await mutationCounts();

  const queue = await listGranotLifecycleCases({
    kind: "booking",
    state: "open",
    sort: "last_evidence_at",
    order: "desc",
    limit: 25,
  });
  const detail = await getGranotLifecycleCaseDetail(String(caseId));
  const candidates = await listGranotLifecycleCaseCandidates(String(caseId), {
    scope: "source",
    lead_model: "FormLead",
    limit: 25,
  });
  const jobTimeline = await projectGranotJob(job, { limit: 100 });
  const leadTimeline = await projectGranotLeadTimeline("FormLead", String(leadId), { limit: 100 });

  assert.ok(queue.items.some((item) => item.case_id === String(caseId)));
  assert.equal(detail?.case_id, String(caseId));
  assert.ok(candidates?.items.some((item) => item.lead_ref.id === String(leadId)));
  assert.ok(jobTimeline.items.some((item) => item.type === "case"));
  assert.ok(leadTimeline?.items.some((item) => item.type === "record_link_change"));
  assert.deepEqual(await mutationCounts(), before);
});
