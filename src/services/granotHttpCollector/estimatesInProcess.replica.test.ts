import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { getCallLeadModel } from "../../models/CallLead";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import type { DurableActor } from "../durableWork/types";
import { applyAutomationPlanAction } from "../granotLifecycle/automationApply";
import { claimAndProcessOrPoll } from "../granotLifecycle/drainer";
import { createGranotObservationProcessor } from "../granotLifecycle/processor";
import { nominateLeadChanges } from "../salesOutreach/subjects/feed";
import { buildSubjectFacts } from "../salesOutreach/subjects/subjectBuilder";
import { mongoDeskSubjectStore } from "../salesOutreach/subjects/store";
import { assembleEstimatesPlan } from "./runWorkflow";
import { parseEstimatesInProcessHtml } from "./estimatesInProcess";

const LIVE_NAME = "Live Caller";
const LIVE_EMAIL = "live.caller@example.test";
const MOVE_DATE = "11/20/2026";

const writeFlags = {
  ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
  shadow_mode: false,
  lead_writes_enabled: true,
  processing_enabled: true,
};

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
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(mongoose.connection.db?.databaseName ?? "")) {
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

async function postActivationCaptureAt(): Promise<Date> {
  const Activation = getGranotLifecycleActivationModel();
  const existing = await Activation.findOne({ key: "granot_lifecycle" }).lean();
  if (existing?.activated_at) {
    return new Date(new Date(existing.activated_at).getTime() + 60 * 60 * 1000);
  }
  const activatedAt = new Date("2026-08-17T14:00:00.000Z");
  try {
    await Activation.create({
      key: "granot_lifecycle",
      activated_at: activatedAt,
      activated_by: {
        actor_type: "owner",
        actor_id: "eip-replica",
        actor_label: "Estimates Replica Owner",
        actor_role: "owner",
        request_id: "eip-replica-activation",
        origin: "vantage_admin",
      },
      reason: "Synthetic Estimates in Process replica activation fixture.",
      processor_version: "estimates-replica",
    });
  } catch {
    const raced = await Activation.findOne({ key: "granot_lifecycle" }).lean();
    if (raced?.activated_at) {
      return new Date(new Date(raced.activated_at).getTime() + 60 * 60 * 1000);
    }
    throw new Error("Unable to seed Granot lifecycle activation for replica tests.");
  }
  return new Date("2026-08-18T16:00:00.000Z");
}

function estimatesHtml(input: {
  label: string;
  user: string;
  rows: Array<{ job: string; phone: string; priority: string }>;
}): string {
  const body = input.rows
    .map(
      (row) => `<tr>
        <td>${row.job}</td><td>10/12/2026</td><td>prior: ${row.priority}</td><td>${input.user}</td>
        <td>Granot Customer</td><td>granot@example.test</td><td>${row.phone}</td><td>5550009999</td>
        <td>Miami</td><td>FL</td><td></td>
        <td>250</td><td>12</td><td>400</td><td>1.5</td><td>${input.label}</td>
        <td>${MOVE_DATE}</td>
      </tr>`,
    )
    .join("");
  return `<table>
    <tr>
      <th>job_no</th><th>open_date</th><th>follow_up</th><th>user</th>
      <th>customer</th><th>email</th><th>phone1</th><th>phone2</th>
      <th>from_city</th><th>from_state</th><th>from_zip</th>
      <th>cf</th><th>miles</th><th>lbs</th><th>rate</th><th>source</th>
      <th>move_date</th>
    </tr>
    ${body}
    <tr>
      <td></td><td></td><td></td><td></td>
      <td>Totals</td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
      <td>900</td><td>40</td><td>1000</td><td>3</td><td></td>
      <td></td>
    </tr>
  </table>`;
}

test("estimates apply fills a RingCentral Call Lead and leaves a conflicting or unmatched row alone", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = objectId().toHexString();
  const label = `EIP Synthetic Calls ${suffix}`;
  const username = `EIP${suffix.slice(0, 8).toUpperCase()}`;
  const companyId = objectId();
  const granularityId = objectId();
  const agentId = objectId();
  const linkId = objectId();
  const freshId = objectId();
  const quotedId = objectId();
  const conflictId = objectId();
  const phoneBase = Number(suffix.replace(/\D/g, "").padEnd(7, "0").slice(0, 7));
  const phone = (offset: number) => `555${String((phoneBase + offset) % 10_000_000).padStart(7, "0")}`;
  const freshPhone = phone(1);
  const quotedPhone = phone(2);
  const conflictPhone = phone(3);
  const unmatchedPhone = phone(4);
  const freshJob = `91${suffix.slice(0, 6)}`;
  const quotedJob = `92${suffix.slice(0, 6)}`;
  const incomingConflictJob = `93${suffix.slice(0, 6)}`;
  const storedConflictJob = `94${suffix.slice(0, 6)}`;
  const unmatchedJob = `95${suffix.slice(0, 6)}`;
  const runId = objectId().toHexString();
  const capturedAt = await postActivationCaptureAt();
  const initiator: DurableActor = {
    actor_type: "system",
    actor_id: "granot-estimates-in-process-cron",
    actor_label: "Estimates in Process",
    actor_role: "system",
    request_id: runId,
    origin: "vantage_admin",
  };
  const CallLead = getCallLeadModel();
  const createdLeadIds = [freshId, quotedId, conflictId];

  await getLeadSourceCompanyModel().create({
    _id: companyId,
    company_slug: `eip-call-${suffix}`,
    name: `EIP Call ${suffix}`,
    owner_label: `EIP Call ${suffix}`,
    active: true,
    created_from: "test",
  });
  await getLeadSourceGranularityModel().create({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `eip-call-${suffix}`,
    channel: "call",
    owner_label: "EIP Call",
    crm_label: "EIP Call",
    active: true,
    created_from: "test",
  });
  const source = await getGranotCrmSourceModel().create({
    crm_origin: `eip-call-${suffix}`,
    workspace_slug: `eip-call-${suffix}`,
    granot_label: label,
    normalized_granot_label: label.toLowerCase(),
    default_channel: "call",
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
    lifecycle_routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        source_granularity_id: granularityId,
      },
    ],
  });
  await Agent.create({
    _id: agentId,
    name: `EIP Agent ${suffix}`,
    normalized_name: `eip agent ${suffix}`,
    active: true,
    role: "agent",
    created_from: "test",
    granot_crm_username: username,
  });
  const linkCollection = mongoose.connection.db!.collection("rep_identity_links");
  const existingLinks = await mongoose.connection.db!.listCollections({ name: "rep_identity_links" }).toArray();
  if (existingLinks.length === 0) {
    await mongoose.connection.db!.createCollection("rep_identity_links");
  }
  await linkCollection.createIndex(
    { rc_account_id: 1, rc_extension_id: 1 },
    {
      name: "ril_extension_current_unique",
      unique: true,
      partialFilterExpression: { effective_to: null },
    },
  );
  await getRepIdentityLinkModel().create({
    _id: linkId,
    agent_id: agentId,
    agent_name_snapshot: `EIP Agent ${suffix}`,
    rc_account_id: `eip-acct-${suffix}`,
    rc_extension_id: `eip-ext-${suffix}`,
    role_kind: "sales_rep",
    status: "reviewed",
    effective_from: new Date("2026-01-01T00:00:00.000Z"),
    effective_to: null,
  });

  const seedLead = async (
    id: mongoose.Types.ObjectId,
    leadPhone: string,
    job?: { raw: string; normalized: string },
  ) => {
    await CallLead.create({
      _id: id,
      source_company: "not_provided",
      lead_source_company: companyId,
      source_granularity_id: granularityId,
      name: LIVE_NAME,
      email: LIVE_EMAIL,
      phone_number: leadPhone,
      normalized_phone_number: leadPhone,
      ingestion_origin: "ringcentral",
      quoted: false,
      domain_revision: 4,
      timestamp: capturedAt,
      ...(job
        ? { job_no: job.raw, normalized_job_no: job.normalized, granot_priority: "8" }
        : {}),
    });
  };

  try {
    await seedLead(freshId, freshPhone);
    await seedLead(quotedId, quotedPhone);
    await seedLead(conflictId, conflictPhone, {
      raw: storedConflictJob,
      normalized: normalizeJobNo(storedConflictJob)!,
    });
    const receiptsBefore = await getGranotObservationReceiptModel().countDocuments();
    const leadsBefore = await CallLead.countDocuments({ source_granularity_id: granularityId });
    const parsed = parseEstimatesInProcessHtml(
      estimatesHtml({
        label,
        user: username,
        rows: [
          { job: freshJob, phone: freshPhone, priority: "0" },
          { job: quotedJob, phone: quotedPhone, priority: "1" },
          { job: incomingConflictJob, phone: conflictPhone, priority: "1" },
          { job: unmatchedJob, phone: unmatchedPhone, priority: "1" },
        ],
      }),
    );
    assert.equal(parsed.recognized, true);
    const plan = await assembleEstimatesPlan(parsed.sources, { runId });
    assert.equal(
      await getGranotObservationReceiptModel().countDocuments(),
      receiptsBefore,
      "preview writes no receipt",
    );

    const actionFor = (job: string) => {
      const action = plan.actions.find(
        (entry) => entry.lifecycle_apply?.granot_statement.job_no === job,
      );
      assert.ok(action?.lifecycle_apply, `missing sealed action for ${job}`);
      return action;
    };
    const freshAction = actionFor(freshJob);
    const quotedAction = actionFor(quotedJob);
    assert.equal("syncable" in freshAction && freshAction.syncable, true);
    assert.equal("syncable" in quotedAction && quotedAction.syncable, true);
    assert.equal(freshAction.lifecycle_apply?.granot_statement.event_type, undefined);

    const processor = createGranotObservationProcessor({ flags: writeFlags });
    const apply = (action: typeof freshAction) =>
      applyAutomationPlanAction(
        {
          action_id: action.action_id,
          lifecycle_apply: action.lifecycle_apply!,
          initiator,
          captured_at: capturedAt,
          request_id: runId,
        },
        {
          claimAndProcess: (receiptId) =>
            claimAndProcessOrPoll(receiptId, { flags: writeFlags, processor }),
        },
      );

    const suppressedFlags = { ...writeFlags, lead_writes_enabled: false };
    const suppressedProcessor = createGranotObservationProcessor({ flags: suppressedFlags });
    const suppressed = await applyAutomationPlanAction({
      action_id: `${freshAction.action_id}:suppressed`,
      lifecycle_apply: {
        ...freshAction.lifecycle_apply!,
        operation_id: `${freshAction.lifecycle_apply!.operation_id}:suppressed`,
      },
      initiator,
      captured_at: capturedAt,
      request_id: runId,
    }, {
      claimAndProcess: (receiptId) => claimAndProcessOrPoll(receiptId, {
        flags: suppressedFlags, processor: suppressedProcessor,
      }),
    });
    assert.equal(suppressed.outcome, "policy_blocked");
    assert.ok(suppressed.decision_id, "disabled writes persist a decision");
    const suppressedDecision = await getSynchronizationDecisionModel().findById(suppressed.decision_id).lean();
    assert.equal(suppressedDecision?.reason_code, "global_effect_disabled");
    const untouched = await CallLead.findById(freshId).lean();
    assert.equal(untouched?.granot_priority, undefined);
    assert.equal(untouched?.job_no, undefined);
    assert.equal(untouched?.receiver_agent, undefined);

    const freshResult = await apply(freshAction);
    assert.equal(freshResult.outcome, "applied");
    const fresh = await CallLead.findById(freshId).lean();
    assert.equal(fresh?.job_no, freshJob);
    assert.equal(fresh?.normalized_job_no, normalizeJobNo(freshJob));
    assert.equal(fresh?.granot_priority, "0");
    assert.equal(String(fresh?.receiver_agent), String(agentId));
    assert.equal(fresh?.receiver_agent_source, "granot_username_match");
    assert.equal(fresh?.phone_number, freshPhone);
    assert.equal(fresh?.name, LIVE_NAME);
    assert.equal(fresh?.email, LIVE_EMAIL);
    assert.equal(fresh?.granot_contact_snapshot, undefined);
    assert.equal(fresh?.cubic_feet, undefined);
    assert.equal((fresh as { move_date?: string } | null)?.move_date, undefined);

    const quotedResult = await apply(quotedAction);
    assert.equal(quotedResult.outcome, "applied");
    const quoted = await CallLead.findById(quotedId).lean();
    assert.equal(quoted?.granot_priority, "1");
    assert.equal(quoted?.job_no, quotedJob);
    assert.ok(quoted?.granot_contact_snapshot);
    assert.equal(quoted?.cubic_feet, 250);
    assert.equal((quoted as { move_date?: string } | null)?.move_date, undefined);
    assert.equal(quoted?.phone_number, quotedPhone);
    assert.equal(quoted?.name, LIVE_NAME);

    const conflictResult = await apply(actionFor(incomingConflictJob));
    assert.equal(conflictResult.outcome, "conflict");
    const conflict = await CallLead.findById(conflictId).lean();
    assert.equal(conflict?.job_no, storedConflictJob);
    assert.equal(conflict?.normalized_job_no, normalizeJobNo(storedConflictJob));
    assert.equal(conflict?.granot_priority, "8");
    assert.equal(conflict?.receiver_agent, undefined);

    const unmatchedResult = await apply(actionFor(unmatchedJob));
    assert.notEqual(unmatchedResult.outcome, "created");
    assert.notEqual(unmatchedResult.outcome, "applied");
    assert.equal(
      await CallLead.countDocuments({ normalized_phone_number: unmatchedPhone }),
      0,
    );
    assert.equal(
      await CallLead.countDocuments({ source_granularity_id: granularityId }),
      leadsBefore,
    );

    const changes = await getEntityChangeModel()
      .find({ "entity.id": String(freshId), "entity.model": "CallLead" })
      .lean();
    assert.ok(changes.length >= 1);
    const admissionChange = changes.find(
      (change) =>
        change.changed_paths.includes("granot_priority") &&
        change.changed_paths.includes("normalized_job_no") &&
        change.revision_before > 0,
    );
    assert.ok(admissionChange);
    const nominations = nominateLeadChanges(
      [
        {
          id: String(admissionChange._id),
          lead: { model: "CallLead", id: String(freshId) },
          revision_before: admissionChange.revision_before,
          revision_after: admissionChange.revision_after,
          applied_at: admissionChange.applied_at,
          changed_paths: admissionChange.changed_paths,
        },
      ],
      new Set(),
      false,
      true,
    );
    assert.deepEqual(
      nominations.map((row) => row.kind),
      ["admission"],
    );

    const [facts] = await mongoDeskSubjectStore.loadLeads(
      [{ model: "CallLead", id: String(freshId) }],
      null,
    );
    assert.ok(facts);
    const reviewed = await mongoDeskSubjectStore.reviewedRepIds(
      [String(agentId)],
      capturedAt,
      null,
    );
    assert.equal(reviewed.has(String(agentId)), true);
    const subject = buildSubjectFacts(
      facts,
      { kind: "review", reason: "priority_needs_review" },
      {
        as_of: capturedAt,
        decision_fingerprint: "eip-replica",
        reviewed_rep_ids: reviewed,
        contact_number_ids: [],
        priority_uncertain: false,
      },
    );
    assert.equal(subject.assigned_agent_id, String(agentId));
  } finally {
    const leadIds = createdLeadIds;
    await CallLead.deleteMany({ _id: { $in: leadIds } });
    await Agent.deleteOne({ _id: agentId });
    await getRepIdentityLinkModel().deleteOne({ _id: linkId });
    await getGranotCrmSourceModel().deleteOne({ _id: source._id });
    await getLeadSourceGranularityModel().deleteOne({ _id: granularityId });
    await getLeadSourceCompanyModel().deleteOne({ _id: companyId });
    const db = mongoose.connection.db;
    if (db) {
      await db.collection("entity_changes").deleteMany({ "entity.id": { $in: leadIds } });
      await db.collection("granot_record_links").deleteMany({
        normalized_job_no: {
          $in: [freshJob, quotedJob, incomingConflictJob, storedConflictJob, unmatchedJob].map(
            (job) => normalizeJobNo(job),
          ),
        },
      });
      await db.collection("sheet_sync_jobs").deleteMany({
        entity_id: { $in: leadIds.map(String) },
      });
      await db.collection("domain_command_executions").deleteMany({
        "entity_refs.id": { $in: leadIds.map(String) },
      });
      await db.collection("synchronization_decisions").deleteMany({
        "target.id": { $in: leadIds.map(String) },
      });
      await db.collection("granot_observations").deleteMany({
        "identity.job_no_raw": {
          $in: [freshJob, quotedJob, incomingConflictJob, unmatchedJob],
        },
      });
      await db.collection("granot_observation_receipts").deleteMany({
        channel_operation_id: { $regex: `^${runId}:` },
      });
    }
  }
});
