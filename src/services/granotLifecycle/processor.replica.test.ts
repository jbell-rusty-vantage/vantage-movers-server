import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo, withTransaction } from "../../db";
import { getFormLeadModel } from "../../models/FormLead";
import { getEntityChangeModel } from "../../models/EntityChange";
import { processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";
import type { LeadIdentityResult } from "./identity";
import type { LeadDesiredStateProjection } from "./leadDesiredState";
import type { SourcePolicyStore } from "./sourcePolicy";

const capturedAt = new Date("2026-08-17T16:00:00.000Z");
const olderCapturedAt = new Date("2026-08-17T15:00:00.000Z");

const ZERO_WRITE_COLLECTIONS = [
  "entity_changes",
  "sheet_sync_jobs",
  "domain_command_executions",
  "booked_leads",
  "cancelled_leads",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function observation(id = objectId()): GranotObservationDocument {
  return {
    _id: id,
    receipt_id: objectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "priority_updated",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: "synthetic-job-100",
      normalized_job_no: "SYNTHETIC JOB 100",
    },
    contact: {},
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
    priority: { valid: true, canonical: "8" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  } as GranotObservationDocument;
}

function store(): SourcePolicyStore {
  const companyId = String(objectId());
  const granularityId = String(objectId());
  return {
    async findByNormalizedLabel() {
      return [
        {
          id: String(objectId()),
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: companyId,
          lifecycle_routes: [
            {
              route_key: "form_any",
              lead_model: "FormLead",
              move_type: "any",
              source_granularity_id: granularityId,
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
        },
      ];
    },
    async findCompany(id) {
      return { id, active: true };
    },
    async findGranularity(id) {
      return {
        id,
        source_company_id: companyId,
        active: true,
        channel: "form",
      };
    },
  };
}

function replicaProcessorDeps(input: {
  observation: GranotObservationDocument;
  leadId: string;
  lead?: LeadDesiredStateProjection | null;
  loadLead?: () => Promise<LeadDesiredStateProjection | null>;
}): GranotLifecycleProcessorDeps {
  const decisions: SynchronizationDecisionDocument[] = [];
  return {
    now: () => new Date("2026-08-17T16:05:00.000Z"),
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    sourcePolicyStore: store(),
    loadReceipt: async () => ({
      _id: input.observation.receipt_id,
      observation_channel: "granot_webhook",
      captured_at: capturedAt,
      processing: { match_attempt: 0 },
    }),
    upsertObservation: async () => input.observation,
    loadActivation: async () => ({ activated_at: new Date("2026-08-17T14:00:00.000Z") }),
    findDecision: async () => null,
    resolveIdentity: async () => identityFor(input.leadId),
    loadLeadProjection: input.loadLead ?? (async () => input.lead ?? null),
    persistDecisionOnly: async (decision) => {
      decisions.push(decision);
    },
    persistDecisionAndLink: async ({ decision }) => {
      decisions.push(decision);
    },
    withTransaction,
  };
}

function identityFor(leadId: string): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "form_ref_no_exact",
    target: { model: "FormLead", id: leadId },
    target_eligibility: "full",
    candidates: [{ target: { model: "FormLead", id: leadId }, reason_codes: ["form_ref_no_exact"] }],
  };
}

async function seedLead(input: {
  id: mongoose.Types.ObjectId;
  winnerId: mongoose.Types.ObjectId;
  winnerCapturedAt: Date;
  revision?: number;
}): Promise<LeadDesiredStateProjection> {
  const FormLead = getFormLeadModel();
  await FormLead.create({
    _id: input.id,
    source_company: "synthetic",
    name: "Synthetic Replica",
    phone_number: "5550001111",
    pickup_zip: "10001",
    destination_zip: "10002",
    pickup_state: "NY",
    delivery_state: "NY",
    move_date: capturedAt,
    local: "local",
    quoted: false,
    granot_priority: "8",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no: "synthetic-job-100",
    ingestion_origin: "wordpress_form",
    domain_revision: input.revision ?? 4,
    last_accepted_granot_observation: {
      observation_id: input.winnerId,
      captured_at: input.winnerCapturedAt,
    },
  });
  return {
    model: "FormLead",
    id: String(input.id),
    ingestion_origin: "wordpress_form",
    quoted: false,
    granot_priority: "8",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no: "synthetic-job-100",
    domain_revision: input.revision ?? 4,
    last_accepted_granot_observation: {
      observation_id: String(input.winnerId),
      captured_at: input.winnerCapturedAt,
    },
  };
}

test("[AC-32] replica temporal CAS one winner advances metadata without revision/Change/outbox", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const EntityChange = getEntityChangeModel();
  const leadId = objectId();
  const olderWinner = objectId();
  const incoming = observation();
  const beforeCounts: Record<string, number> = {};
  const db = mongoose.connection.db!;
  for (const name of ZERO_WRITE_COLLECTIONS) {
    beforeCounts[name] = await db.collection(name).countDocuments();
  }
  try {
    const lead = await seedLead({
      id: leadId,
      winnerId: olderWinner,
      winnerCapturedAt: olderCapturedAt,
    });
    const beforeRevision = (await FormLead.findById(leadId).lean())?.domain_revision;
    const result = await processGranotObservation(
      { receipt_id: String(incoming.receipt_id) },
      replicaProcessorDeps({
        observation: incoming,
        leadId: String(leadId),
        lead,
      }),
    );
    assert.equal(result.outcome, "already_current");
    assert.equal(result.effects.length, 0);
    const after = await FormLead.findById(leadId).lean();
    assert.equal(String(after?.last_accepted_granot_observation?.observation_id), String(incoming._id));
    assert.equal(after?.last_accepted_granot_observation?.captured_at.toISOString(), capturedAt.toISOString());
    assert.equal(after?.domain_revision, beforeRevision);
    assert.equal(after?.last_change_id, undefined);
    assert.equal(await EntityChange.countDocuments({ "target.id": String(leadId) }), 0);
    for (const name of ZERO_WRITE_COLLECTIONS) {
      assert.equal(await db.collection(name).countDocuments(), beforeCounts[name]);
    }
  } finally {
    await FormLead.deleteMany({ _id: leadId });
  }
});

test("[AC-32] replica concurrent temporal loser re-evaluates stale and does not persist already_current", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const leadId = objectId();
  const first = observation();
  const second = observation();
  second.captured_at = capturedAt;
  try {
    await seedLead({
      id: leadId,
      winnerId: objectId(),
      winnerCapturedAt: olderCapturedAt,
    });
    const sharedLead = async (): Promise<LeadDesiredStateProjection | null> => {
      const row = await FormLead.findById(leadId).lean();
      if (!row?.last_accepted_granot_observation) return null;
      return {
        model: "FormLead",
        id: String(leadId),
        ingestion_origin: "wordpress_form",
        quoted: false,
        granot_priority: "8",
        normalized_job_no: "SYNTHETIC JOB 100",
        job_no: "synthetic-job-100",
        domain_revision: row.domain_revision,
        last_accepted_granot_observation: {
          observation_id: String(row.last_accepted_granot_observation.observation_id),
          captured_at: new Date(row.last_accepted_granot_observation.captured_at),
        },
      };
    };
    const [a, b] = await Promise.all([
      processGranotObservation(
        { receipt_id: String(first.receipt_id) },
        replicaProcessorDeps({
          observation: first,
          leadId: String(leadId),
          loadLead: sharedLead,
        }),
      ),
      processGranotObservation(
        { receipt_id: String(second.receipt_id) },
        replicaProcessorDeps({
          observation: second,
          leadId: String(leadId),
          loadLead: sharedLead,
        }),
      ),
    ]);
    const after = await FormLead.findById(leadId).lean();
    const winnerId = String(after?.last_accepted_granot_observation?.observation_id);
    const expectedWinner =
      String(first._id) > String(second._id) ? String(first._id) : String(second._id);
    assert.equal(winnerId, expectedWinner);
    assert.ok([a.outcome, b.outcome].includes("already_current"));
    assert.ok(
      [a.outcome, b.outcome].every(
        (outcome) => outcome === "already_current" || outcome === "stale",
      ),
    );
    assert.equal(after?.domain_revision, 4);

    const older = observation();
    older.captured_at = olderCapturedAt;
    const stale = await processGranotObservation(
      { receipt_id: String(older.receipt_id) },
      replicaProcessorDeps({
        observation: older,
        leadId: String(leadId),
        loadLead: sharedLead,
      }),
    );
    assert.equal(stale.outcome, "stale");
    assert.equal(stale.effects.length, 0);
    const still = await FormLead.findById(leadId).lean();
    assert.equal(String(still?.last_accepted_granot_observation?.observation_id), winnerId);
    assert.equal(still?.domain_revision, 4);
  } finally {
    await FormLead.deleteMany({ _id: leadId });
  }
});
