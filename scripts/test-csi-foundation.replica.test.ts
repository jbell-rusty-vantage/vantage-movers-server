import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../src/models/IntelligenceFinding";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import {
  applyCsiMigration,
  reportCsiMigration,
} from "./migrations/sales-intelligence.lib";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getCallInteractionAliasModel } from "../src/models/CallInteractionAlias";
import { getSalesIntelligenceCommandExecutionModel } from "../src/models/SalesIntelligenceCommandExecution";
import { getSalesIntelligenceAuditEventModel } from "../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceSubmissionModel } from "../src/models/IntelligenceSubmission";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../src/models/SalesIntelligenceAiReservation";
import {
  requireCsiOwner,
  requireCsiRun,
  issueCsiRunToken,
  type CsiActor,
} from "../src/services/salesIntelligence/auth";
import {
  executeCsiCommand,
  csiCas,
  appendCsiAudit,
} from "../src/services/salesIntelligence/transactions";
import {
  claimCsiJob,
  enqueueCsiJob,
  completeCsiJob,
  renewCsiJob,
  failCsiJob,
} from "../src/services/salesIntelligence/jobs";
import {
  reserveCsiBudget,
  reconcileCsiBudget,
  initializeCsiBudgetPeriod,
} from "../src/services/salesIntelligence/aiBudget";
import { multipleCommitmentsUndatedActionFixture } from "../src/validation/intelligence/fixtures";
import { parseIntelligenceEnvelope } from "../src/validation/intelligence/intelligenceEnvelope.validation";
import { getSalesIntelligencePolicyPointerModel } from "../src/models/SalesIntelligencePolicyPointer";
import { getSalesIntelligencePolicyVersionModel } from "../src/models/SalesIntelligencePolicyVersion";
import {
  defaultCsiPolicy,
  updateCsiPolicy,
} from "../src/services/salesIntelligence/policy";

const oid = () => new mongoose.Types.ObjectId();
const actorRequest: Request = Object.assign(Object.create(express.request), {
  method: "POST",
  originalUrl: "/api/v1/admin/sales-intelligence/settings",
  headers: {},
  vantageAuth: {
    kind: "user",
    userId: "synthetic-owner",
    email: "owner@example.test",
    roles: ["owner"],
  },
});
let actor: CsiActor;
const enabled = process.env.CSI_REPLICA_TEST === "true";
test(
  "CSI-01 isolated replica proof",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    assert.equal(process.env.TEST_MODE, "true");
    assert.match(getMongoDatabaseName(), /^testvantagemovers_csi[a-z0-9]+$/);
    assert.equal(
      process.env.MONGO_URI,
      "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    );
    await connectMongo();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db!;
    assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
    process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET =
      "synthetic-csi-proxy-signing-secret";
    const fields = {
      adminId: "synthetic-owner",
      email: "owner@example.test",
      role: "owner",
      timestamp: String(Date.now()),
      requestId: "synthetic-request",
      method: actorRequest.method,
      path: actorRequest.originalUrl,
    };
    actorRequest.headers = {
      "x-vantage-admin-user-id": fields.adminId,
      "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(
        fields,
        process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET,
      ),
    };
    actor = requireCsiOwner(actorRequest);
    try {
      await t.test(
        "migration report does not write; unresolved accounts block apply; verified mappings preserve legacy data",
        async () => {
          const id = oid();
          await db.collection("lead_conversations").insertOne({
            _id: id,
            provider: "ringcentral",
            provider_recording_id: "legacy-recording",
            summary: { text: "Synthetic preserved seed" },
          });
          await db
            .collection("lead_conversations")
            .createIndex(
              { provider: 1, provider_recording_id: 1 },
              { name: "lead_conversation_recording_unique", unique: true },
            );
          const before = await db.listCollections().toArray();
          const report = await reportCsiMigration();
          assert.deepEqual(report.unresolved_account_ids, [String(id)]);
          assert.equal(
            (await db.listCollections().toArray()).length,
            before.length,
          );
          await assert.rejects(applyCsiMigration(), /conflicts/);
          const applied = await applyCsiMigration([
            {
              conversation_id: String(id),
              provider_account_id: "account-a",
              evidence_ref: "synthetic-provider-evidence",
            },
          ]);
          assert.equal(applied.ready, true);
          assert.equal(
            applied.collections.every((c) => !c.missing.length),
            true,
          );
          const row = await db
            .collection("lead_conversations")
            .findOne({ _id: id });
          assert.equal(row?.summary.text, "Synthetic preserved seed");
          assert.equal(
            (await db.collection("lead_conversations").indexes()).some(
              (i) => i.name === "lead_conversation_recording_unique",
            ),
            false,
          );
          await db.collection("lead_conversations").insertOne({
            provider: "ringcentral",
            provider_account_id: "account-b",
            provider_recording_id: "legacy-recording",
          });
          await assert.rejects(
            db.collection("lead_conversations").insertOne({
              provider: "ringcentral",
              provider_account_id: "account-a",
              provider_recording_id: "legacy-recording",
            }),
          );
          await applyCsiMigration();
        },
      );
      await t.test(
        "runtime fails closed without a unique fence; obsolete single-action index blocks migration",
        async () => {
          await db
            .collection("call_interaction_aliases")
            .dropIndex("csi_alias_unique");
          await assert.rejects(
            getCallInteractionAliasModel().create({
              provider: "ringcentral",
              provider_account_id: "synthetic",
              kind: "session_id",
              value: "missing-index",
              interaction_id: oid(),
            }),
            /INDEX_REQUIRED/,
          );
          await applyCsiMigration();
          await db
            .collection("outreach_followups")
            .createIndex(
              { outreach_record_id: 1 },
              { name: "legacy_one_action", unique: true },
            );
          const report = await reportCsiMigration();
          assert.equal(report.ready, false);
          await assert.rejects(applyCsiMigration(), /conflicts/);
          await db
            .collection("outreach_followups")
            .dropIndex("legacy_one_action");
        },
      );
      await t.test(
        "bounded retries and permission pause preserve pending work",
        async () => {
          const Jobs = getSalesIntelligenceJobModel();
          const job = await withTransaction((session) =>
            enqueueCsiJob(
              {
                dedupe_key: "retry-limit",
                stage: "media",
                subject_key: "number:test",
                input_revision: 1,
              },
              session,
            ),
          );
          await Jobs.updateOne({ _id: job._id }, { $set: { attempts: 7 } });
          const claimed = await claimCsiJob("worker", String(job._id));
          assert.ok(claimed);
          await failCsiJob(
            {
              job_id: String(job._id),
              owner: "worker",
              epoch: claimed.lease_epoch,
            },
            "transient",
          );
          assert.equal((await Jobs.findById(job._id))?.status, "dead_letter");
          assert.equal(await claimCsiJob("worker", String(job._id)), null);
          const paused = await withTransaction((session) =>
            enqueueCsiJob(
              {
                dedupe_key: "pause",
                stage: "media",
                subject_key: "number:test",
                input_revision: 1,
              },
              session,
            ),
          );
          const leased = await claimCsiJob("worker", String(paused._id));
          assert.ok(leased);
          await failCsiJob(
            {
              job_id: String(paused._id),
              owner: "worker",
              epoch: leased.lease_epoch,
            },
            "permission_denied",
          );
          assert.equal((await Jobs.findById(paused._id))?.status, "paused");
          assert.equal((await Jobs.findById(paused._id))?.attempts, 0);
        },
      );
      await t.test(
        "analysis content finalizes once and snapshots remain immutable",
        async () => {
          const Runs = getIntelligenceRunModel();
          const run = await Runs.create({
            subject_key: "number:test",
            mode: "number_refresh",
            job_id: oid(),
            input_fingerprint: "synthetic",
            prompt_version: "v1",
            schema_version: "csi-envelope-v1",
            model_version: "synthetic",
            deployment: "csi-local-proof",
            database: getMongoDatabaseName(),
          });
          assert.equal(run.output, null);
          assert.equal(run.conversation_id, null);
          const first = await Runs.updateOne(
            { _id: run._id, revision: 1 },
            {
              $set: {
                output: multipleCommitmentsUndatedActionFixture,
                finalized_at: new Date(),
                rendered_prompt: "Synthetic prompt",
                manifest_digest: "synthetic-digest",
              },
              $inc: { revision: 1 },
            },
            { runValidators: true },
          );
          assert.equal(first.modifiedCount, 1);
          const second = await Runs.updateOne(
            { _id: run._id },
            { $set: { rendered_prompt: "must not replace evidence" } },
          );
          assert.equal(second.modifiedCount, 0);
          for (const field of [
            "subject_key",
            "input_fingerprint",
            "prompt_version",
            "model_version",
            "deployment",
          ])
            assert.equal(
              (
                await Runs.updateOne(
                  { _id: run._id },
                  { $set: { [field]: "rewritten" } },
                )
              ).modifiedCount,
              0,
            );
          await assert.rejects(
            Runs.updateOne(
              { _id: run._id },
              { $rename: { status: "rendered_prompt" } },
            ),
            /renames/,
          );
          const Findings = getIntelligenceFindingModel();
          const originalAssertion = parseIntelligenceEnvelope(
            multipleCommitmentsUndatedActionFixture,
          ).findings[0]!;
          const finding = await Findings.create({
            run_id: run._id,
            key: "immutable",
            assertion: originalAssertion,
            kind: originalAssertion.kind,
            prompt_version: "v1",
            schema_version: "csi-envelope-v1",
            model_version: "synthetic",
            validation: { schema_ok: true, source_snapshots_valid: true },
          });
          await assert.rejects(
            Findings.replaceOne(
              { _id: finding._id },
              { ...finding.toObject(), key: "rewritten" },
            ),
            /replacement/,
          );
          await assert.rejects(
            Findings.findOneAndReplace(
              { _id: finding._id },
              finding.toObject(),
            ),
            /replacement/,
          );
          await assert.rejects(
            Findings.deleteOne({ _id: finding._id }),
            /deletion/,
          );
          await assert.rejects(
            Findings.updateOne(
              { _id: finding._id },
              { $set: { "assertion.claim": "rewritten" } },
            ),
            /immutable/,
          );
          await assert.rejects(
            Findings.updateOne(
              { _id: finding._id },
              [{ $set: { key: "rewritten" } }],
              { updatePipeline: true },
            ),
            /pipelines/,
          );
          await assert.rejects(
            Findings.bulkWrite([
              { deleteOne: { filter: { _id: finding._id } } },
            ]),
            /bulk/,
          );
          assert.equal(
            (
              await Findings.updateOne(
                { _id: finding._id },
                { $set: { review_state: "confirmed" }, $inc: { revision: 1 } },
              )
            ).modifiedCount,
            1,
          );
          assert.equal(
            (await Findings.findById(finding._id))?.assertion.claim,
            originalAssertion.claim,
          );
          const Snapshots = getIntelligenceEvidenceSnapshotModel();
          const snapshot = await Snapshots.create({
            run_id: run._id,
            source_type: "tool_response",
            source_id: "synthetic",
            tool_name: "get_intelligence_context",
            tool_call_id: "tool-1",
            arguments: {},
            response: {},
            retrieved_at: new Date(),
            content_digest: "synthetic",
            subject_key: "number:test",
            deployment: "csi-local-proof",
            database: getMongoDatabaseName(),
            completeness: { complete: true, missing_ranges: [] },
          });
          await assert.rejects(
            Snapshots.updateOne(
              { _id: snapshot._id },
              { $set: { response: { replaced: true } } },
            ),
            /append-only/,
          );
          await assert.rejects(
            Snapshots.deleteOne({ _id: snapshot._id }),
            /append-only/,
          );
        },
      );
      const Outreach = getOutreachRecordModel();
      const number = oid();
      const outreach = await Outreach.create({
        subject: { kind: "number_review", contact_number_id: number },
        trigger_kind: "owner_open",
        trigger_at: new Date(),
        policy_version: "csi-policy-v1",
      });
      const id = String(outreach._id);
      await t.test(
        "subject, alias, commitment and submission fences; multiple nullable dates",
        async () => {
          await assert.rejects(
            Outreach.create({
              subject: { kind: "number_review", contact_number_id: number },
              trigger_kind: "owner_open",
              trigger_at: new Date(),
              policy_version: "csi-policy-v1",
            }),
          );
          const Alias = getCallInteractionAliasModel();
          const alias = {
            provider: "ringcentral" as const,
            provider_account_id: "a",
            kind: "call_log_id" as const,
            value: "fallback",
            interaction_id: oid(),
          };
          await Alias.create(alias);
          await assert.rejects(Alias.create(alias));
          await Alias.create({ ...alias, provider_account_id: "b" });
          const Followup = getOutreachFollowupModel();
          const first = {
            outreach_record_id: outreach._id,
            commitment_key: "stable-1",
            kind: "call" as const,
            description: "Synthetic callback",
            origin: "owner" as const,
            due_at: null,
          };
          await Followup.create(first);
          await Followup.create({
            ...first,
            commitment_key: "stable-2",
            kind: "send_estimate",
          });
          assert.equal(
            await Followup.countDocuments({
              outreach_record_id: outreach._id,
              status: "open",
              due_at: null,
            }),
            2,
          );
          await assert.rejects(Followup.create(first));
          const Submission = getIntelligenceSubmissionModel();
          const submission = {
            run_id: oid(),
            idempotency_key: "run-key",
            payload_hash: "synthetic",
            envelope: multipleCommitmentsUndatedActionFixture,
            received_at: new Date(),
            application_job_id: oid(),
          };
          await Submission.create(submission);
          await assert.rejects(Submission.create(submission));
          await assert.rejects(
            Submission.updateOne(
              { run_id: submission.run_id },
              { $set: { payload_hash: "changed" } },
            ),
            /append-only/,
          );
        },
      );
      const command = (key: string, expected: number, fail = false) =>
        executeCsiCommand({
          actor,
          command: "assign",
          idempotency_key: key,
          payload: { id, expected },
          operation: async (context) => {
            await csiCas(
              Outreach,
              id,
              expected,
              { closed_reason: key },
              context.session,
            );
            await appendCsiAudit(context, {
              subject_key: `number:${number}`,
              event_kind: "synthetic_change",
              prior: {},
              current: { key },
              target_id: id,
              revision: expected + 1,
              kind: "outreach",
            });
            await enqueueCsiJob(
              {
                dedupe_key: key,
                subject_key: `number:${number}`,
                stage: "outreach_derive",
                input_revision: expected + 1,
              },
              context.session,
            );
            if (fail) throw new Error("synthetic rollback");
            return { id, revision: expected + 1 };
          },
        });
      await t.test(
        "idempotency replay/conflict and transaction rollback of aggregate/audit/job/command",
        async () => {
          const first = await command("first", 1);
          assert.equal(first.replayed, false);
          const replay = await command("first", 1);
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.response, first.response);
          await assert.rejects(command("first", 2), /IDEMPOTENCY_CONFLICT/);
          const before =
            await getSalesIntelligenceAuditEventModel().countDocuments();
          await assert.rejects(
            command("rollback", 2, true),
            /synthetic rollback/,
          );
          assert.equal((await Outreach.findById(id))?.revision, 2);
          assert.equal(
            await getSalesIntelligenceAuditEventModel().countDocuments(),
            before,
          );
          assert.equal(
            await getSalesIntelligenceJobModel().countDocuments({
              dedupe_key: "rollback",
            }),
            0,
          );
          assert.equal(
            await getSalesIntelligenceCommandExecutionModel().countDocuments({
              idempotency_key: "rollback",
            }),
            0,
          );
        },
      );
      await t.test("concurrent Owner revisions have one winner", async () => {
        const outcomes = await Promise.allSettled([
          command("race-a", 2),
          command("race-b", 2),
        ]);
        assert.equal(
          outcomes.filter((v) => v.status === "fulfilled").length,
          1,
        );
        assert.equal((await Outreach.findById(id))?.revision, 3);
      });
      await t.test("concurrent same-key commands replay once", async () => {
        const result = await Promise.all([
          command("same-key", 3),
          command("same-key", 3),
        ]);
        assert.equal(result.filter((v) => !v.replayed).length, 1);
        assert.equal((await Outreach.findById(id))?.revision, 4);
      });
      await t.test(
        "job dedupe, claim recovery, old epochs and expiry inside effect transaction",
        async () => {
          const Jobs = getSalesIntelligenceJobModel();
          const job = await withTransaction((session) =>
            enqueueCsiJob(
              {
                dedupe_key: "lease-test",
                stage: "application",
                subject_key: "number:test",
                input_revision: 1,
              },
              session,
            ),
          );
          const duplicate = await withTransaction((session) =>
            enqueueCsiJob(
              {
                dedupe_key: "lease-test",
                stage: "application",
                subject_key: "number:test",
                input_revision: 1,
              },
              session,
            ),
          );
          assert.equal(String(job._id), String(duplicate._id));
          const a = await claimCsiJob("worker-a", String(job._id));
          assert.ok(a);
          assert.equal(await claimCsiJob("worker-b", String(job._id)), null);
          await Jobs.updateOne(
            { _id: job._id },
            { $set: { leased_until: new Date(Date.now() - 1) } },
          );
          const b = await claimCsiJob("worker-b", String(job._id));
          assert.ok(b);
          assert.equal(b.lease_epoch, a.lease_epoch + 1);
          const old = {
            job_id: String(job._id),
            owner: "worker-a",
            epoch: a.lease_epoch,
          };
          await assert.rejects(renewCsiJob(old), /LEASE_LOST/);
          await assert.rejects(
            completeCsiJob(old, async () => {}),
            /LEASE_LOST/,
          );
          const lease = {
            job_id: String(job._id),
            owner: "worker-b",
            epoch: b.lease_epoch,
          };
          await Jobs.updateOne(
            { _id: job._id },
            { $set: { leased_until: new Date(Date.now() + 150) } },
          );
          await assert.rejects(
            completeCsiJob(lease, async (session) => {
              await csiCas(
                Outreach,
                id,
                4,
                { closed_reason: "must rollback" },
                session,
              );
              await new Promise((resolve) => setTimeout(resolve, 200));
            }),
            /LEASE_LOST/,
          );
          assert.equal((await Outreach.findById(id))?.revision, 4);
          const recovered = await claimCsiJob("worker-c", String(job._id));
          assert.ok(recovered);
          await completeCsiJob(
            {
              job_id: String(job._id),
              owner: "worker-c",
              epoch: recovered.lease_epoch,
            },
            async (session) => {
              await csiCas(
                Outreach,
                id,
                4,
                { closed_reason: "fenced" },
                session,
              );
            },
          );
          assert.equal((await Outreach.findById(id))?.revision, 5);
          assert.equal((await Jobs.findById(job._id))?.status, "completed");
        },
      );
      await t.test(
        "budget races never over-admit and reconcile/release once",
        async () => {
          await getSalesIntelligenceAiBudgetModel().create({
            month: "2026-09",
            ceiling_cents: 8000,
            policy_version: "csi-policy-v1",
            timezone: "America/New_York",
            period_start: new Date("2026-09-01T04:00:00Z"),
            period_end: new Date("2026-10-01T04:00:00Z"),
          });
          const a = {
            reservation_id: "reserve-a",
            month: "2026-09",
            job_id: String(oid()),
            run_id: null,
            step: "stt",
            stage: "transcription" as const,
            estimated_cents: 5000,
          };
          const b = {
            ...a,
            reservation_id: "reserve-b",
            job_id: String(oid()),
          };
          const results = await Promise.allSettled([
            reserveCsiBudget(a),
            reserveCsiBudget(b),
          ]);
          assert.equal(
            results.filter((v) => v.status === "fulfilled").length,
            1,
          );
          const winner = results[0]!.status === "fulfilled" ? a : b;
          await reserveCsiBudget(winner);
          await assert.rejects(
            reserveCsiBudget({ ...winner, estimated_cents: 5001 }),
            /IDEMPOTENCY_CONFLICT/,
          );
          await Promise.all([
            reconcileCsiBudget(winner.reservation_id, 4000),
            reconcileCsiBudget(winner.reservation_id, 4000),
          ]);
          const totals = await getSalesIntelligenceAiBudgetModel().findOne({
            month: "2026-09",
          });
          assert.equal(totals?.actual_cents, 4000);
          assert.equal(totals?.reserved_cents, 0);
          await reserveCsiBudget({
            ...a,
            reservation_id: "release",
            job_id: String(oid()),
            estimated_cents: 100,
          });
          await reconcileCsiBudget("release", 0, true);
          await reconcileCsiBudget("release", 0, true);
          assert.equal(
            (
              await getSalesIntelligenceAiBudgetModel().findOne({
                month: "2026-09",
              })
            )?.reserved_cents,
            0,
          );
        },
      );
      await t.test("job dedupe cannot replay across deployments", async () => {
        const input = {
          dedupe_key: "dataset-replay",
          stage: "analysis" as const,
          subject_key: "number:dataset",
          input_revision: 1,
        };
        const job = await withTransaction((session) =>
          enqueueCsiJob(input, session),
        );
        const deployment = process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID;
        try {
          process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "other-deployment";
          await assert.rejects(
            withTransaction((session) => enqueueCsiJob(input, session)),
            /IDEMPOTENCY_CONFLICT/,
          );
          assert.equal(await claimCsiJob("foreign", String(job._id)), null);
        } finally {
          process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = deployment;
        }
      });
      await t.test(
        "stored run token enforces job subject, deployment and current lease",
        async () => {
          process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME = "csi-agent";
          process.env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET =
            "synthetic-local-run-signing-key-32-plus";
          const job = await withTransaction((session) =>
            enqueueCsiJob(
              {
                dedupe_key: "stored-auth",
                stage: "analysis",
                subject_key: "number:auth",
                input_revision: 1,
              },
              session,
            ),
          );
          const claimed = await claimCsiJob("auth-worker", String(job._id));
          assert.ok(claimed);
          const run = await getIntelligenceRunModel().create({
            subject_key: job.subject_key,
            mode: "number_refresh",
            job_id: job._id,
            input_fingerprint: "synthetic",
            prompt_version: "v1",
            schema_version: "csi-envelope-v1",
            model_version: "synthetic",
            deployment: job.deployment,
            database: getMongoDatabaseName(),
            status: "running",
            token_nonce: "synthetic-run-nonce",
            permitted_tools: ["get_intelligence_context"],
          });
          const token = await issueCsiRunToken(String(run._id), {
            job_id: String(job._id),
            owner: "auth-worker",
            epoch: claimed.lease_epoch,
          });
          const req: Request = Object.assign(Object.create(express.request), {
            headers: { "x-vantage-intelligence-run-token": token },
            vantageAuth: { kind: "scoped_key", scopedKeyName: "csi-agent" },
          });
          assert.equal(
            (
              await requireCsiRun(
                req,
                String(run._id),
                "get_intelligence_context",
              )
            ).claims.run_id,
            String(run._id),
          );
          for (const changed of [
            { deployment: "foreign" },
            { subject_key: "number:foreign" },
            { lease_epoch: claimed.lease_epoch + 1 },
          ]) {
            await getSalesIntelligenceJobModel().updateOne(
              { _id: job._id },
              { $set: changed },
            );
            await assert.rejects(
              requireCsiRun(req, String(run._id), "get_intelligence_context"),
              /RUN_SCOPE_DENIED/,
            );
            await getSalesIntelligenceJobModel().updateOne(
              { _id: job._id },
              {
                $set: {
                  deployment: job.deployment,
                  subject_key: job.subject_key,
                  lease_epoch: claimed.lease_epoch,
                },
              },
            );
          }
        },
      );
      await t.test(
        "new budget period resumes current dataset once, not future periods or permission pauses",
        async () => {
          const Jobs = getSalesIntelligenceJobModel();
          const input = {
            month: "2098-01",
            policy_version: "csi-policy-v1",
            ceiling_cents: 8000,
            timezone: "America/New_York",
            period_start: new Date(Date.now() - 60000),
            period_end: new Date(Date.now() + 60000),
          };
          const base = {
            stage: "analysis" as const,
            subject_key: "number:budget-period",
            input_revision: 1,
            payload_hash: "synthetic",
            deployment: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID,
            database: getMongoDatabaseName(),
            status: "paused" as const,
            reason: "budget_exhausted",
            next_attempt_at: new Date(),
          };
          const paused = await Jobs.create({
            ...base,
            dedupe_key: "period-paused",
          });
          const foreign = await Jobs.create({
            ...base,
            dedupe_key: "period-foreign",
            deployment: "foreign",
          });
          const denied = await Jobs.create({
            ...base,
            dedupe_key: "period-denied",
            reason: "permission_denied",
          });
          await initializeCsiBudgetPeriod({
            ...input,
            month: "2098-02",
            period_start: new Date(Date.now() + 120000),
            period_end: new Date(Date.now() + 180000),
          });
          assert.equal((await Jobs.findById(paused._id))?.status, "paused");
          await Promise.all([
            initializeCsiBudgetPeriod(input),
            initializeCsiBudgetPeriod(input),
          ]);
          assert.equal((await Jobs.findById(paused._id))?.status, "pending");
          assert.equal((await Jobs.findById(foreign._id))?.status, "paused");
          assert.equal((await Jobs.findById(denied._id))?.status, "paused");
          await Jobs.updateOne(
            { _id: paused._id },
            { $set: { status: "paused" } },
          );
          await initializeCsiBudgetPeriod(input);
          assert.equal((await Jobs.findById(paused._id))?.status, "paused");
        },
      );
      await t.test(
        "policy CAS preserves immutable versions and one concurrent winner",
        async () => {
          await getSalesIntelligencePolicyPointerModel().create({
            key: "active",
            version: "csi-policy-v1",
            revision: 1,
          });
          await getSalesIntelligencePolicyVersionModel().create({
            version: "csi-policy-v1",
            policy: defaultCsiPolicy(),
            actor,
            effective_at: new Date(),
          });
          const outcomes = await Promise.allSettled(
            ["v2", "v3"].map((version) =>
              updateCsiPolicy({
                actor,
                idempotency_key: version,
                expected_revision: 1,
                policy: { ...defaultCsiPolicy(), version },
              }),
            ),
          );
          assert.equal(
            outcomes.filter((v) => v.status === "fulfilled").length,
            1,
          );
          assert.equal(
            await getSalesIntelligencePolicyVersionModel().countDocuments(),
            2,
          );
          const paused = await getSalesIntelligenceJobModel().create({
            dedupe_key: "policy-paused",
            stage: "analysis",
            subject_key: "number:policy",
            input_revision: 1,
            payload_hash: "synthetic",
            deployment: process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID,
            next_attempt_at: new Date(),
            database: process.env.TEST_MONGO_DATABASE_NAME,
            status: "paused",
            reason: "budget_exhausted",
          });
          await updateCsiPolicy({
            actor,
            idempotency_key: "lower-budget",
            expected_revision: 2,
            policy: {
              ...defaultCsiPolicy(),
              version: "v4",
              monthly_ceiling_cents: 7000,
            },
          });
          assert.equal(
            (await getSalesIntelligenceJobModel().findById(paused._id))?.status,
            "paused",
          );
          await updateCsiPolicy({
            actor,
            idempotency_key: "raise-budget",
            expected_revision: 3,
            policy: {
              ...defaultCsiPolicy(),
              version: "v5",
              monthly_ceiling_cents: 9000,
            },
          });
          assert.equal(
            (await getSalesIntelligenceJobModel().findById(paused._id))?.status,
            "pending",
          );
        },
      );
    } finally {
      await mongoose.disconnect();
    }
  },
);

after(async () => {
  if (enabled) await mongoose.disconnect();
});
