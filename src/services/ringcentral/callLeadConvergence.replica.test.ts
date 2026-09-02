import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../db";
import { getCallLeadModel } from "../../models/CallLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { EntityChange } from "../../models/EntityChange";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { toFloridaTimestamp } from "../../utils/easternTime";
import {
  acquireRingCentralConvergenceScopeLock,
  adoptRingCentralCall,
  attemptRingCentralCallLeadConvergence,
  buildRingCentralCommandContext,
  ensureRingCentralConvergenceScopeLock,
  findPreCreationRingCentralConvergenceCandidates,
  markRingCentralConvergenceConflict,
  toQualifiedCallIdentity,
} from "./callLeadConvergence.service";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";
import {
  assertProcessedCallAdoptionIndexes,
  findProcessedCall,
  type RingCentralProcessedCallDocument,
} from "./processed-calls-store";
import {
  ingestRingCentralQualifiedCall,
  type RingCentralQualifiedCall,
} from "./ringcentral-call-lead-ingest.service";

const COMPANY_ID = new mongoose.Types.ObjectId("68a500000000000000000020");
const GRANULARITY_ID = new mongoose.Types.ObjectId(
  "68a500000000000000000021",
);
const ROUTE_ID = new mongoose.Types.ObjectId("68a500000000000000000022");
const ASSIGNMENT_ID = new mongoose.Types.ObjectId(
  "68a500000000000000000023",
);
const SOURCE_SLUG = "unit20_synthetic";
const TARGET_PHONE = "+15550002000";
const actor = {
  actor_type: "system",
  actor_id: "unit20-test",
  actor_label: "Unit 20 synthetic",
  actor_role: "system",
};

before(async () => {
  if (!replicaProofEnabled()) return;
  await connectMongo();
  assert.match(mongoose.connection.name, /^testvantagemovers/i);
  assert.equal(process.env.RINGCENTRAL_COLLECTION_MODE, "test");
  assert.equal(process.env.SHEET_SYNC_MODE, "disabled");
  await cleanup();
  await getLeadSourceCompanyModel().create({
    _id: COMPANY_ID,
    company_slug: SOURCE_SLUG,
    name: "Unit 20 Synthetic",
    owner_label: "Unit 20 Synthetic",
    active: true,
    created_from: "unit20-test",
  });
  await getLeadSourceGranularityModel().create({
    _id: GRANULARITY_ID,
    source_company: COMPANY_ID,
    granularity_key: "unit20_synthetic_calls",
    channel: "call",
    owner_label: "Unit 20 Synthetic Calls",
    crm_label: "Unit 20 Synthetic Calls",
    active: true,
    activated_at: new Date(),
    created_from: "unit20-test",
  });
  await getRingCentralInboundRouteModel().create({
    _id: ROUTE_ID,
    provider: "ringcentral",
    phone_number: TARGET_PHONE,
    phone_locked: true,
    display_label: "Unit 20 Synthetic Route",
    active: true,
    ever_activated: true,
    validation_status: "valid",
    validated_at: new Date(),
    created_from: "unit20-test",
    created_by: actor,
  });
  await getRingCentralInboundRouteAssignmentModel().create({
    _id: ASSIGNMENT_ID,
    route: ROUTE_ID,
    source_company: COMPANY_ID,
    source_granularity: GRANULARITY_ID,
    effective_from: new Date("2026-01-01T00:00:00.000Z"),
    active: true,
    created_by: actor,
    change_reason: "Unit 20 synthetic verification",
  });
  await assertProcessedCallAdoptionIndexes();
});

after(async () => {
  if (!replicaProofEnabled()) return;
  await cleanup();
  await mongoose.disconnect();
});

test(
  "[AC-14][AC-15][AC-16] Unit 20 replica adoption, conflict continuation, races, and rollback",
  async (t) => {
    if (!replicaProofEnabled()) {
      t.skip(
        "Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.",
      );
      return;
    }

    await t.test(
      "[AC-14] call-log-only identity adopts atomically and preserves origin",
      async () => {
        const start = new Date();
        const candidate = await createCandidate("5550002001", start);
        const descriptor = qualifiedCall({
          phone: "5550002001",
          start,
          callLogId: "u20-log-adopt",
        });
        const result = await attemptRingCentralCallLeadConvergence({
          call: descriptor,
          enabled: true,
          allowMutations: true,
        });
        assert.equal(result.outcome, "adopted");
        const stored = await getCallLeadModel()
          .findById(candidate._id)
          .lean()
          .exec();
        assert.equal(stored?.ingestion_origin, "granot_lead_created");
        assert.equal(stored?.ringcentral_convergence?.state, "adopted");
        assert.equal(
          stored?.ringcentral_convergence?.candidate_window_started_at?.getTime(),
          start.getTime(),
        );
        assert.equal(
          stored?.ringcentral?.original_caller?.normalized_phone_number,
          "5550002001",
        );
        assert.equal(stored?.domain_revision, 1);
        const ledger = await findProcessedCall({
          callLogId: "u20-log-adopt",
        });
        assert.equal(ledger?.status, "lead_adopted");
        assert.equal(ledger?.callLeadId, String(candidate._id));
        assert.equal(
          await DomainCommandExecution.countDocuments({
            idempotency_key: "ringcentral:adopt:u20-log-adopt",
          }),
          1,
        );
        assert.equal(
          await EntityChange.countDocuments({
            command_name: "adoptRingCentralCall",
            "entity.id": String(candidate._id),
          }),
          1,
        );
        assert.equal(
          await SheetSyncJob.countDocuments({
            entity_id: String(candidate._id),
            operation: "call_lead.update",
          }),
          1,
        );
        await assert.rejects(
          () =>
            getCallLeadModel().updateOne(
              { _id: candidate._id },
              {
                $set: {
                  ringcentral: {
                    ...stored?.ringcentral,
                    original_caller: {
                      phone_number: "5559999999",
                      normalized_phone_number: "5559999999",
                      captured_at: new Date(),
                    },
                  },
                },
              },
              { runValidators: true },
            ),
          /original caller evidence is immutable/,
        );
        const immutable = await getCallLeadModel()
          .findById(candidate._id)
          .lean()
          .exec();
        assert.equal(
          immutable?.ringcentral?.original_caller?.normalized_phone_number,
          "5550002001",
        );
      },
    );

    await t.test(
      "[AC-15] a different prior Lead still marks the adopted Lead duplicate",
      async () => {
        const start = new Date();
        await createPriorLead(
          "5550002002",
          new Date(toFloridaTimestamp(start).getTime() - 1_000),
        );
        const candidate = await createCandidate("5550002002", start);
        const result = await attemptRingCentralCallLeadConvergence({
          call: qualifiedCall({
            phone: "5550002002",
            start,
            callLogId: "u20-log-duplicate",
          }),
          enabled: true,
          allowMutations: true,
        });
        assert.equal(result.outcome, "adopted");
        if (result.outcome === "adopted") assert.equal(result.duplicate, true);
        const stored = await getCallLeadModel()
          .findById(candidate._id)
          .lean()
          .exec();
        assert.equal(stored?.duplicate, true);
        assert.equal(stored?.cpl, 0);
        assert.equal(stored?.cpl_resolution_status, "duplicate_zero");
      },
    );

    await t.test(
      "[AC-14] RingCentral-first creation is reused by later Granot pre-creation",
      async () => {
        const start = new Date();
        const result = await ingestRingCentralQualifiedCall(
          qualifiedCall({
            phone: "5550002005",
            start,
            callLogId: "u20-log-ringcentral-first",
          }),
          start,
        );
        assert.equal(result.action, "lead_created");
        const candidates =
          await findPreCreationRingCentralConvergenceCandidates({
            source_granularity_id: String(GRANULARITY_ID),
            normalized_phone_number: "5550002005",
          });
        assert.deepEqual(candidates, [
          {
            call_lead_id: result.callLeadId,
            domain_revision: 0,
          },
        ]);
        const stored = await getCallLeadModel()
          .findById(result.callLeadId)
          .lean()
          .exec();
        assert.equal(stored?.ingestion_origin, "ringcentral");
      },
    );

    await t.test(
      "[AC-14] zero-candidate webhook and Call Log race creates one normal Lead",
      async () => {
        const start = new Date();
        const sessionId = "u20-zero-candidate-session";
        await seedWebhookSession(sessionId, start);
        const callLogDescriptor: RingCentralQualifiedCall = {
          ...qualifiedCall({
            phone: "5550002008",
            start,
            callLogId: "u20-log-zero-candidate-race",
          }),
          telephonySessionId: null,
          sessionId,
        };
        const webhookDescriptor: RingCentralQualifiedCall = {
          ...callLogDescriptor,
          ingestionSource: "webhook",
          telephonySessionId: sessionId,
          partyId: "u20-zero-candidate-party",
          callLogId: null,
        };
        const settled = await Promise.allSettled([
          ingestRingCentralQualifiedCall(webhookDescriptor, start),
          ingestRingCentralQualifiedCall(callLogDescriptor, start),
        ]);
        assert.ok(settled.every((entry) => entry.status === "fulfilled"));
        assert.equal(
          await getCallLeadModel().countDocuments({
            source_granularity_id: GRANULARITY_ID,
            normalized_phone_number: "5550002008",
          }),
          1,
        );
        assert.equal(
          await processedCollection().then((collection) =>
            collection.countDocuments({ sessionId }),
          ),
          1,
        );
      },
    );

    await t.test(
      "[AC-16] multiple ambiguity is durable and normal ingest preserves the call",
      async () => {
        const start = new Date();
        const first = await createCandidate("5550002003", start);
        const second = await createCandidate("5550002003", start);
        const result = await ingestRingCentralQualifiedCall(
          qualifiedCall({
            phone: "5550002003",
            start,
            callLogId: "u20-log-conflict",
          }),
          start,
        );
        assert.equal(result.action, "lead_created");
        const conflicts = await getCallLeadModel()
          .find({ _id: { $in: [first._id, second._id] } })
          .lean()
          .exec();
        assert.equal(conflicts.length, 2);
        assert.ok(
          conflicts.every(
            (lead) =>
              lead.ringcentral_convergence?.state === "conflict" &&
              lead.ringcentral_convergence?.conflict_reason ===
                "multiple_adoption_candidates" &&
              lead.domain_revision === 1,
          ),
        );
        const ledger = await findProcessedCall({
          callLogId: "u20-log-conflict",
        });
        assert.equal(ledger?.status, "lead_created");
        assert.equal(ledger?.callLeadId, result.callLeadId);
      },
    );

    await t.test(
      "[AC-14] concurrent qualified paths converge on one adopted Lead and ledger",
      async () => {
        const start = new Date();
        const candidate = await createCandidate("5550002004", start);
        const descriptor = qualifiedCall({
          phone: "5550002004",
          start,
          callLogId: "u20-log-race",
        });
        const callLogDescriptor = {
          ...descriptor,
          telephonySessionId: null,
          sessionId: "u20-cross-path-session",
        };
        await seedWebhookSession("u20-cross-path-session", start);
        const webhookDescriptor: RingCentralQualifiedCall = {
          ...callLogDescriptor,
          ingestionSource: "webhook",
          telephonySessionId: "u20-cross-path-session",
          partyId: "u20-cross-path-party",
          callLogId: null,
        };
        const settled = await Promise.allSettled([
          ingestRingCentralQualifiedCall(webhookDescriptor, start),
          ingestRingCentralQualifiedCall(callLogDescriptor, start),
        ]);
        assert.ok(settled.every((entry) => entry.status === "fulfilled"));
        const stored = await getCallLeadModel()
          .findById(candidate._id)
          .lean()
          .exec();
        assert.equal(stored?.ringcentral_convergence?.state, "adopted");
        assert.equal(
          await processedCollection().then((collection) =>
            collection.countDocuments({
              sessionId: "u20-cross-path-session",
            }),
          ),
          1,
        );
        assert.equal(
          await getCallLeadModel().countDocuments({
            "ringcentral.session_id": "u20-cross-path-session",
          }),
          1,
        );
      },
    );

    await t.test(
      "[AC-14][AC-16] candidate revision races re-read and converge",
      async () => {
        const start = new Date();
        const candidate = await createCandidate("5550002007", start);
        let injected = false;
        const result = await attemptRingCentralCallLeadConvergence(
          {
            call: qualifiedCall({
              phone: "5550002007",
              start,
              callLogId: "u20-log-cas-recovery",
            }),
            enabled: true,
            allowMutations: true,
          },
          0,
          {
            after_selection: async (selection) => {
              if (injected || selection.outcome !== "candidate") return;
              injected = true;
              await getCallLeadModel().collection.updateOne(
                { _id: candidate._id },
                { $inc: { domain_revision: 1 } },
              );
            },
          },
        );
        assert.equal(result.outcome, "adopted");
        const stored = await getCallLeadModel()
          .findById(candidate._id)
          .lean()
          .exec();
        assert.equal(stored?.ringcentral_convergence?.state, "adopted");
        assert.equal(stored?.domain_revision, 2);
      },
    );

    await t.test(
      "[AC-14][AC-16] concurrent Granot creation and RingCentral ingest share one scope fence",
      async () => {
        const previousCreate = process.env.RINGCENTRAL_CREATE_CALL_LEADS;
        process.env.RINGCENTRAL_CREATE_CALL_LEADS = "true";
        try {
          assert.equal(process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED, "true");
          const start = new Date();
          const phone = "5550002006";
          const callLogId = "u20-log-cross-path-race";
          await ensureRingCentralConvergenceScopeLock({
            source_granularity_id: String(GRANULARITY_ID),
            normalized_phone_number: phone,
          });
          const granotPath = withTransaction(async (session) => {
            await acquireRingCentralConvergenceScopeLock({
              source_granularity_id: String(GRANULARITY_ID),
              normalized_phone_number: phone,
              session,
              now: start,
            });
            const existing =
              await findPreCreationRingCentralConvergenceCandidates({
                source_granularity_id: String(GRANULARITY_ID),
                normalized_phone_number: phone,
                session,
              });
            if (existing.length > 0) return existing[0]!.call_lead_id;
            const [created] = await getCallLeadModel().create(
              [candidatePayload(phone, start)],
              { session },
            );
            return String(created!._id);
          });
          const ringCentralPath = ingestRingCentralQualifiedCall(
            qualifiedCall({ phone, start, callLogId }),
            start,
          );
          await Promise.all([granotPath, ringCentralPath]);
          const leads = await getCallLeadModel()
            .find({
              source_granularity_id: GRANULARITY_ID,
              normalized_phone_number: phone,
            })
            .lean()
            .exec();
          assert.equal(leads.length, 1);
          assert.equal(
            await processedCollection().then((collection) =>
              collection.countDocuments({ callLogId }),
            ),
            1,
          );
        } finally {
          if (previousCreate === undefined) {
            delete process.env.RINGCENTRAL_CREATE_CALL_LEADS;
          } else {
            process.env.RINGCENTRAL_CREATE_CALL_LEADS = previousCreate;
          }
        }
      },
    );

    await t.test(
      "Job-only Granot Call Lead is not adopted; qualified call may create",
      async () => {
        const previousCreate = process.env.RINGCENTRAL_CREATE_CALL_LEADS;
        process.env.RINGCENTRAL_CREATE_CALL_LEADS = "true";
        const start = new Date();
        const phone = "5550002010";
        const callLogId = "u20-log-job-only";
        const jobOnly = await getCallLeadModel().create({
          source_company: SOURCE_SLUG,
          lead_source_company: COMPANY_ID,
          source_granularity_id: GRANULARITY_ID,
          source_granularity_key: "unit20_synthetic_calls",
          job_no: "u20-synthetic-job-only",
          timestamp: start,
          quoted: false,
          duplicate: false,
          cpl: 0,
          ingestion_origin: "granot_lead_created",
          ringcentral_convergence: { state: "not_applicable" },
          createdAt: start,
          updatedAt: start,
        });
        try {
          const result = await ingestRingCentralQualifiedCall(
            qualifiedCall({ phone, start, callLogId }),
            start,
          );
          assert.notEqual(result.action, "lead_adopted");
          assert.notEqual(result.action, "lead_adopted_duplicate");
          const stored = await getCallLeadModel()
            .findById(jobOnly._id)
            .lean()
            .exec();
          assert.equal(stored?.ingestion_origin, "granot_lead_created");
          assert.equal(stored?.ringcentral_convergence?.state, "not_applicable");
          assert.ok(
            result.action === "lead_created" ||
              result.action === "lead_created_duplicate",
          );
        } finally {
          if (previousCreate === undefined) {
            delete process.env.RINGCENTRAL_CREATE_CALL_LEADS;
          } else {
            process.env.RINGCENTRAL_CREATE_CALL_LEADS = previousCreate;
          }
        }
      },
    );

    await t.test(
      "different Source Granularity with the same phone is not adopted",
      async () => {
        const previousCreate = process.env.RINGCENTRAL_CREATE_CALL_LEADS;
        process.env.RINGCENTRAL_CREATE_CALL_LEADS = "true";
        const start = new Date();
        const phone = "5550002011";
        const callLogId = "u20-log-other-granularity";
        const otherGranularityId = new mongoose.Types.ObjectId();
        await getLeadSourceGranularityModel().create({
          _id: otherGranularityId,
          source_company: COMPANY_ID,
          granularity_key: "unit20_other_calls",
          channel: "call",
          owner_label: "Unit 20 Other Calls",
          crm_label: "Unit 20 Other Calls",
          active: true,
          activated_at: start,
          created_from: "unit20-test",
        });
        const otherLead = await getCallLeadModel().create({
          ...candidatePayload(phone, start),
          source_granularity_id: otherGranularityId,
          source_granularity_key: "unit20_other_calls",
        });
        try {
          const result = await ingestRingCentralQualifiedCall(
            qualifiedCall({ phone, start, callLogId }),
            start,
          );
          assert.notEqual(result.action, "lead_adopted");
          assert.notEqual(result.action, "lead_adopted_duplicate");
          const stored = await getCallLeadModel()
            .findById(otherLead._id)
            .lean()
            .exec();
          assert.equal(stored?.ringcentral_convergence?.state, "pending");
          assert.equal(stored?.ingestion_origin, "granot_lead_created");
          assert.ok(
            result.action === "lead_created" ||
              result.action === "lead_created_duplicate",
          );
        } finally {
          await getCallLeadModel().deleteOne({ _id: otherLead._id });
          await getLeadSourceGranularityModel().deleteOne({
            _id: otherGranularityId,
          });
          if (previousCreate === undefined) {
            delete process.env.RINGCENTRAL_CREATE_CALL_LEADS;
          } else {
            process.env.RINGCENTRAL_CREATE_CALL_LEADS = previousCreate;
          }
        }
      },
    );

    await t.test(
      "adoption off lets a later qualified call mint a RingCentral-origin twin",
      async () => {
        const previousAdoption = process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED;
        const previousCreate = process.env.RINGCENTRAL_CREATE_CALL_LEADS;
        process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED = "false";
        process.env.RINGCENTRAL_CREATE_CALL_LEADS = "true";
        const start = new Date();
        const phone = "5550002012";
        const callLogId = "u20-log-adoption-off-twin";
        const candidate = await createCandidate(phone, start);
        try {
          const result = await ingestRingCentralQualifiedCall(
            qualifiedCall({ phone, start, callLogId }),
            start,
          );
          assert.equal(result.action, "lead_created");
          assert.notEqual(result.callLeadId, String(candidate._id));
          const leads = await getCallLeadModel()
            .find({
              source_granularity_id: GRANULARITY_ID,
              normalized_phone_number: phone,
            })
            .lean()
            .exec();
          assert.equal(leads.length, 2);
          assert.ok(
            leads.some((lead) => lead.ingestion_origin === "granot_lead_created"),
          );
          assert.ok(
            leads.some((lead) => lead.ingestion_origin === "ringcentral"),
          );
        } finally {
          if (previousAdoption === undefined) {
            delete process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED;
          } else {
            process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED = previousAdoption;
          }
          if (previousCreate === undefined) {
            delete process.env.RINGCENTRAL_CREATE_CALL_LEADS;
          } else {
            process.env.RINGCENTRAL_CREATE_CALL_LEADS = previousCreate;
          }
        }
      },
    );

    await t.test(
      "[AC-14][AC-16] every injected adoption/conflict write-stage failure rolls back",
      async () => {
        for (const stage of [
          "lead",
          "changes",
          "outbox",
          "ledger",
        ] as const) {
          const start = new Date();
          const phone = `55500021${String(
            ["lead", "changes", "outbox", "ledger"].indexOf(stage),
          ).padStart(2, "0")}`;
          const callLogId = `u20-log-rollback-${stage}`;
          const candidate = await createCandidate(phone, start);
          const descriptor = qualifiedCall({ phone, start, callLogId });
          const identity = toQualifiedCallIdentity(descriptor);
          const target = {
            call_lead_id: String(candidate._id),
            domain_revision: 0,
          };
          const context = buildRingCentralCommandContext(
            "adopt",
            identity,
            target,
          );
          await assert.rejects(
            () =>
              adoptRingCentralCall(
                {
                  call_lead_id: target.call_lead_id,
                  expected_domain_revision: 0,
                  qualified_call: identity,
                  context,
                },
                { fail_after: stage },
              ),
            /Injected RingCentral convergence rollback/,
          );
          const stored = await getCallLeadModel()
            .findById(candidate._id)
            .lean()
            .exec();
          assert.equal(stored?.ringcentral_convergence?.state, "pending");
          assert.equal(stored?.domain_revision, 0);
          assert.equal(stored?.ringcentral, undefined);
          assert.equal(
            await findProcessedCall({ callLogId }),
            null,
          );
          assert.equal(
            await DomainCommandExecution.countDocuments({
              idempotency_key: `ringcentral:adopt:${callLogId}`,
            }),
            0,
          );
          assert.equal(
            await EntityChange.countDocuments({
              "entity.id": String(candidate._id),
              command_name: "adoptRingCentralCall",
            }),
            0,
          );
          assert.equal(
            await SheetSyncJob.countDocuments({
              entity_id: String(candidate._id),
            }),
            0,
          );
        }
        for (const stage of ["lead", "changes", "outbox"] as const) {
          const start = new Date();
          const phone = `55500022${String(
            ["lead", "changes", "outbox"].indexOf(stage),
          ).padStart(2, "0")}`;
          const callLogId = `u20-log-conflict-rollback-${stage}`;
          const candidates = await Promise.all([
            createCandidate(phone, start),
            createCandidate(phone, start),
          ]);
          const identity = toQualifiedCallIdentity(
            qualifiedCall({ phone, start, callLogId }),
          );
          const targets = candidates
            .map((candidate) => ({
              call_lead_id: String(candidate._id),
              domain_revision: 0,
            }))
            .sort((a, b) => a.call_lead_id.localeCompare(b.call_lead_id));
          const context = buildRingCentralCommandContext(
            "convergence-conflict",
            identity,
            targets,
          );
          await assert.rejects(
            () =>
              markRingCentralConvergenceConflict(
                {
                  call_lead_ids: targets.map(
                    ({ call_lead_id }) => call_lead_id,
                  ),
                  expected_domain_revisions: targets,
                  qualified_call: identity,
                  conflict_reason: "multiple_adoption_candidates",
                  context,
                },
                { fail_after: stage },
              ),
            /Injected RingCentral convergence rollback/,
          );
          const stored = await getCallLeadModel()
            .find({ _id: { $in: candidates.map(({ _id }) => _id) } })
            .lean()
            .exec();
          assert.equal(stored.length, 2);
          assert.ok(
            stored.every(
              (candidate) =>
                candidate.ringcentral_convergence?.state === "pending" &&
                candidate.domain_revision === 0,
            ),
          );
          assert.equal(
            await DomainCommandExecution.countDocuments({
              idempotency_key: `ringcentral:convergence-conflict:${callLogId}`,
            }),
            0,
          );
          assert.equal(
            await EntityChange.countDocuments({
              "entity.id": { $in: candidates.map(({ _id }) => String(_id)) },
              command_name: "markRingCentralConvergenceConflict",
            }),
            0,
          );
          assert.equal(
            await SheetSyncJob.countDocuments({
              entity_id: { $in: candidates.map(({ _id }) => String(_id)) },
            }),
            0,
          );
        }
      },
    );
  },
);

async function createCandidate(phone: string, createdAt: Date) {
  await ensureRingCentralConvergenceScopeLock({
    source_granularity_id: String(GRANULARITY_ID),
    normalized_phone_number: phone,
  });
  return getCallLeadModel().create(candidatePayload(phone, createdAt));
}

function candidatePayload(phone: string, createdAt: Date) {
  return {
    source_company: SOURCE_SLUG,
    lead_source_company: COMPANY_ID,
    source_granularity_id: GRANULARITY_ID,
    source_granularity_key: "unit20_synthetic_calls",
    source_company_label_snapshot: "Unit 20 Synthetic",
    source_granularity_label_snapshot: "Unit 20 Synthetic Calls",
    crm_source_label_snapshot: "Unit 20 Synthetic Calls",
    phone_number: phone,
    timestamp: createdAt,
    quoted: false,
    duplicate: false,
    cpl: 25,
    cpl_resolution_status: "resolved" as const,
    cpl_resolved_at: createdAt,
    cpl_resolution_version: "unit20",
    ingestion_origin: "granot_lead_created" as const,
    ingested_contact_snapshot: {
      phone_number: phone,
      normalized_phone_number: phone,
      captured_at: createdAt,
      evidence_status: "captured_at_ingestion" as const,
    },
    ringcentral_convergence: {
      state: "pending" as const,
      candidate_window_started_at: createdAt,
      observation_id: new mongoose.Types.ObjectId(),
    },
    createdAt,
    updatedAt: createdAt,
  };
}

async function createPriorLead(phone: string, timestamp: Date) {
  return getCallLeadModel().create({
    source_company: SOURCE_SLUG,
    lead_source_company: COMPANY_ID,
    source_granularity_id: GRANULARITY_ID,
    source_granularity_key: "unit20_synthetic_calls",
    phone_number: phone,
    timestamp,
    quoted: false,
    duplicate: false,
    cpl: 25,
    cpl_resolution_status: "resolved",
    ingestion_origin: "ringcentral",
    ingested_contact_snapshot: {
      phone_number: phone,
      normalized_phone_number: phone,
      captured_at: timestamp,
      evidence_status: "captured_at_ingestion",
    },
    ringcentral: {
      telephony_session_id: `prior-${new mongoose.Types.ObjectId()}`,
      ingestion_source: "webhook",
      route_id: ROUTE_ID,
      route_assignment_id: ASSIGNMENT_ID,
      target_phone_number: TARGET_PHONE,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function qualifiedCall(input: {
  phone: string;
  start: Date;
  callLogId: string;
}): RingCentralQualifiedCall {
  return {
    ingestionSource: "call_log_sync",
    telephonySessionId: null,
    sessionId: `session-${input.callLogId}`,
    partyId: null,
    callLogId: input.callLogId,
    sourceCompany: SOURCE_SLUG,
    sourceLabel: "Unit 20 Synthetic Calls",
    routeResolution: {
      route_id: String(ROUTE_ID),
      assignment_id: String(ASSIGNMENT_ID),
      normalized_target_number: TARGET_PHONE,
      company_id: String(COMPANY_ID),
      company_slug: SOURCE_SLUG,
      company_label_snapshot: "Unit 20 Synthetic",
      granularity_id: String(GRANULARITY_ID),
      granularity_key: "unit20_synthetic_calls",
      granularity_label_snapshot: "Unit 20 Synthetic Calls",
      crm_label_snapshot: "Unit 20 Synthetic Calls",
    },
    callerPhoneNumber: input.phone,
    callerName: "Synthetic Caller",
    targetPhoneNumber: TARGET_PHONE,
    targetName: "Unit 20 Synthetic Queue",
    answeredAt: new Date(input.start.getTime() + 1_000),
    terminalAt: new Date(input.start.getTime() + 181_000),
    startTime: input.start,
    durationSeconds: 180,
    qualificationReason: "synthetic_qualified",
  };
}

async function processedCollection() {
  const db = await getRingCentralDb();
  return db.collection<RingCentralProcessedCallDocument>(
    getRingCentralCollectionName("processedCalls"),
  );
}

async function seedWebhookSession(
  telephonySessionId: string,
  now: Date,
): Promise<void> {
  const db = await getRingCentralDb();
  await db
    .collection(getRingCentralCollectionName("callSessions"))
    .updateOne(
      { provider: "ringcentral", telephonySessionId },
      {
        $set: {
          provider: "ringcentral",
          telephonySessionId,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
}

async function cleanup(): Promise<void> {
  const Lead = getCallLeadModel();
  const ids = await Lead.find(
    { source_granularity_id: GRANULARITY_ID },
    { _id: 1 },
  )
    .lean()
    .exec();
  const leadIds = ids.map((row) => row._id);
  await Promise.all([
    SheetSyncJob.deleteMany({
      entity_id: { $in: leadIds.map(String) },
    }),
    EntityChange.collection.deleteMany({
      $or: [
        { "entity.id": { $in: leadIds.map(String) } },
        {
          command_name: {
            $in: [
              "adoptRingCentralCall",
              "markRingCentralConvergenceConflict",
            ],
          },
        },
      ],
    }),
    DomainCommandExecution.deleteMany({
      origin: "ringcentral",
      idempotency_key: /^ringcentral:(?:adopt|convergence-conflict):u20-/,
    }),
    processedCollection().then((collection) =>
      collection.deleteMany({
        $or: [
          { callLogId: /^u20-/ },
          { telephonySessionId: /^u20-/ },
        ],
      }),
    ),
    getRingCentralDb().then((db) =>
      db
        .collection(getRingCentralCollectionName("convergenceLocks"))
        .deleteMany({}),
    ),
    getRingCentralDb().then((db) =>
      db
        .collection(getRingCentralCollectionName("callSessions"))
        .deleteMany({ telephonySessionId: /^u20-/ }),
    ),
  ]);
  await Lead.deleteMany({ source_granularity_id: GRANULARITY_ID });
  await getRingCentralInboundRouteAssignmentModel().deleteMany({
    _id: ASSIGNMENT_ID,
  });
  await getRingCentralInboundRouteModel().deleteMany({ _id: ROUTE_ID });
  await getLeadSourceGranularityModel().deleteMany({ _id: GRANULARITY_ID });
  await getLeadSourceCompanyModel().deleteMany({ _id: COMPANY_ID });
}

function replicaProofEnabled(): boolean {
  return (
    process.env.GRANOT_LIFECYCLE_REPLICA_TESTS === "true" &&
    process.env.TEST_MODE === "true" &&
    /^testvantagemovers/i.test(process.env.MONGO_DB_NAME ?? "") &&
    process.env.RINGCENTRAL_COLLECTION_MODE === "test" &&
    process.env.SHEET_SYNC_MODE === "disabled"
  );
}
