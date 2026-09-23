import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import {
  persistLeadAttachments,
  attachmentPolicyInput,
} from "../../src/services/salesIntelligence/attachment/store";
import { commandAttachment } from "../../src/services/salesIntelligence/attachment/commands";
import { listAttachments } from "../../src/services/salesIntelligence/attachment/reads";
import { resolveAtInteraction } from "../../src/services/salesIntelligence/attachment/suggest";
import {
  runAttachmentRefreshJob,
  drainAttachmentRefreshJobs,
  runAttachmentRefreshOnce,
} from "../../src/services/salesIntelligence/attachment/refresh";
import {
  loadLead,
  type LeadSource,
} from "../../src/services/salesIntelligence/attachment/sources";
import {
  enqueueCsiJob,
  claimCsiJob,
  completeCsiJob,
} from "../../src/services/salesIntelligence/jobs";
import { dispatchCsiWakeup } from "../../src/services/numberActivity/jobDispatch";
import { completeNormalizedMatchSet } from "../../src/services/salesIntelligence/attachment/matchSet";
import { loadEligibilityInputs } from "../../src/services/salesIntelligence/conversations/eligibility";

test(
  "CSI-05 disposable replica: attachment only",
  { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 },
  async (t) => {
    assert.equal(process.env.TEST_MODE, "true");
    assert.match(getMongoDatabaseName(), /^testvantagemovers_csi05[a-z0-9]+$/);
    assert.equal(
      process.env.MONGO_URI,
      "mongodb://127.0.0.1:27189/?replicaSet=csi01",
    );
    await connectMongo();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db!;
    assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
    await applyCsiMigration();
    const Numbers = getContactNumberModel(),
      Edges = getNumberLeadAttachmentModel(),
      Jobs = getSalesIntelligenceJobModel();
    const at = new Date("2026-09-01T12:00:00Z");
    const request: Request = Object.assign(Object.create(express.request), {
      method: "POST",
      originalUrl: "/api/v1/admin/sales-intelligence/attachments/attach",
      headers: {},
      vantageAuth: {
        kind: "user",
        userId: "synthetic-owner",
        email: "owner@example.test",
        roles: ["owner"],
      },
    });
    const fields = {
      adminId: "synthetic-owner",
      email: "owner@example.test",
      role: "owner",
      timestamp: String(Date.now()),
      requestId: "csi05-proof",
      method: request.method,
      path: request.originalUrl,
    };
    request.headers = {
      "x-vantage-admin-user-id": fields.adminId,
      "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(
        fields,
        process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!,
      ),
    };
    const actor = requireCsiOwner(request);
    let serial = 0;
    const number = () =>
      Numbers.create({
        e164: `+120255501${String(++serial).padStart(2, "0")}`,
        // The indexed Lead phone paths store this ten-digit form (14 §3).
        national_ten: `20255501${String(serial).padStart(2, "0")}`,
        digits_reversed: `n${serial}`,
        first_observed_at: at,
        last_activity_at: at,
      });
    async function lead(
      phone: string,
      timestamp = at,
      model: "FormLead" | "CallLead" = "FormLead",
      extra = {},
    ) {
      const row = {
        _id: new mongoose.Types.ObjectId(),
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        name: "Synthetic CSI-05",
        normalized_phone_number: phone,
        ingested_contact_snapshot: {
          normalized_phone_number: phone,
          captured_at: timestamp,
        },
        ...extra,
      };
      if (model === "FormLead")
        await getFormLeadModel().collection.insertOne(row);
      else await getCallLeadModel().collection.insertOne(row);
      return row;
    }
    const persist = (
      row: LeadSource,
      model: "FormLead" | "CallLead" = "FormLead",
    ) =>
      withTransaction((s) =>
        persistLeadAttachments(row, model, s, "a".repeat(24), at),
      );
    const edge = (id: mongoose.Types.ObjectId) =>
      Edges.findOne({ "lead_ref.id": id }).lean().orFail();
    const attach = async (
      id: mongoose.Types.ObjectId,
      key: string,
      expected?: number,
    ) => {
      const row = await edge(id);
      return commandAttachment({
        actor,
        idempotency_key: key,
        command: {
          command: "attach_lead",
          contact_number_id: String(row.contact_number_id),
          lead_ref: { model: row.lead_ref.model, id: String(id) },
          expected_revision: expected ?? row.revision,
          reason: "Synthetic Owner evidence",
        },
      });
    };
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all(
          (await db.listCollections().toArray())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(async (c) => [
              c.name,
              await db.collection(c.name).find().sort({ _id: 1 }).toArray(),
            ]),
        ),
      );
    try {
      await t.test(
        "Owner attaches an absent pair with Number revision and durable replay, preserving official phone",
        async () => {
          const n = await number(),
            l = await lead("+12025550199");
          const command = {
            command: "attach_lead" as const,
            contact_number_id: String(n._id),
            lead_ref: { model: "FormLead" as const, id: String(l._id) },
            expected_revision: n.revision,
            reason: "Synthetic additional callback number",
          };
          const result = await commandAttachment({
            actor,
            idempotency_key: "absent-pair",
            command,
          });
          assert.equal(result.response.state, "attached");
          assert.equal((await edge(l._id)).certainty, "owner_confirmed");
          assert.equal(
            (await getFormLeadModel().findById(l._id).lean())
              ?.normalized_phone_number,
            "+12025550199",
          );
          const replay = await commandAttachment({
            actor,
            idempotency_key: "absent-pair",
            command,
          });
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.response, result.response);
          const audits = await db
            .collection("sales_intelligence_audit_events")
            .find({
              event_kind: "attach_lead",
              "invalidation.target_id": String(n._id),
            })
            .toArray();
          assert.equal(audits.length, 1);
          assert.deepEqual(audits[0].prior, { state: "unlinked" });
        },
      );
      await t.test(
        "unique pair, duplicate refresh, snapshots/search; resolve numbers without creating",
        async () => {
          const n = await number(),
            l = await lead(n.e164);
          await persist(l);
          const before = await edge(l._id);
          const beforeNumber = await Numbers.findById(n._id).lean();
          await persist(l);
          const after = await edge(l._id);
          assert.deepEqual(await Numbers.findById(n._id).lean(), beforeNumber);
          assert.equal(after.state, "candidate");
          assert.equal(after.certainty, "likely");
          assert.equal(after.revision, before.revision);
          assert.deepEqual(after.history, before.history);
          assert.equal(after.evidence.length, before.evidence.length);
          assert.ok(
            (await Numbers.findById(n._id))?.search_terms.includes(
              "synthetic csi-05",
            ),
          );
          const count = await Numbers.countDocuments();
          await persist(await lead("2025550199"));
          assert.equal(await Numbers.countDocuments(), count);
        },
      );
      await t.test(
        "concurrent different-pair refresh fan-in; event-time independent historical moves",
        async () => {
          const n = await number(),
            a = await lead(n.e164),
            b = await lead(n.e164),
            c = await lead(n.e164, new Date("2026-12-01"));
          await Promise.all([persist(a), persist(b)]);
          await persist(c);
          assert.equal((await edge(a._id)).state, "ambiguous");
          assert.equal((await edge(b._id)).state, "ambiguous");
          assert.equal((await edge(c._id)).state, "candidate");
          const rows = await Edges.find({ contact_number_id: n._id }).lean();
          const identity = {
            id: "i",
            provider_account_id: "a",
            call_log_ids: [],
            started_at: at,
          };
          assert.equal(
            resolveAtInteraction(rows.map(attachmentPolicyInput), identity)
              .lead_effects_allowed,
            false,
          );
          assert.equal(
            resolveAtInteraction(rows.map(attachmentPolicyInput), {
              ...identity,
              started_at: new Date("2026-12-01"),
            }).lead_ref?.id,
            String(c._id),
          );
        },
      );
      await t.test(
        "Owner wins concurrent refresh; CAS and idempotency conflicts; reviewed snapshot frozen",
        async () => {
          const n = await number(),
            l = await lead(n.e164);
          await persist(l);
          const rev = (await edge(l._id)).revision;
          await Promise.all([attach(l._id, "owner-race", rev), persist(l)]);
          const reviewed = await edge(l._id);
          assert.equal(reviewed.certainty, "owner_confirmed");
          const replay = await attach(l._id, "owner-race", rev);
          assert.equal(replay.replayed, true);
          await assert.rejects(
            attach(l._id, "owner-race", reviewed.revision),
            /IDEMPOTENCY_CONFLICT/,
          );
          await assert.rejects(
            attach(l._id, "stale", rev),
            /REVISION_CONFLICT/,
          );
          await persist({ ...l, name: "Changed later" });
          assert.deepEqual(await edge(l._id), reviewed);
        },
      );
      await t.test(
        "rejection durable, detached history retained and identity reevaluated",
        async () => {
          const n = await number(),
            l = await lead(n.e164);
          await persist(l);
          await attach(l._id, "attach-detach");
          let row = await edge(l._id);
          await commandAttachment({
            actor,
            attachment_id: String(row._id),
            idempotency_key: "detach",
            command: {
              command: "detach_attachment",
              expected_revision: row.revision,
              reason: "Reevaluate",
            },
          });
          row = await edge(l._id);
          assert.equal(row.state, "candidate");
          assert.equal(row.history.length, 3);
          assert.equal(
            resolveAtInteraction([attachmentPolicyInput(row)], {
              id: "i",
              started_at: at,
              provider_account_id: "a",
              call_log_ids: [],
            }).certainty,
            "likely",
          );
          await commandAttachment({
            actor,
            attachment_id: String(row._id),
            idempotency_key: "reject",
            command: {
              command: "reject_attachment",
              expected_revision: row.revision,
              reason: "Unrelated",
            },
          });
          const rejected = await edge(l._id);
          await persist(l);
          assert.deepEqual(await edge(l._id), rejected);
        },
      );
      await t.test(
        "exact Call Log/session identity stays interaction-scoped through CSI-11",
        async () => {
          const n = await number();
          const call = await getCallInteractionModel().create({
            contact_number_id: n._id,
            provider: "ringcentral",
            provider_account_id: "800000000001",
            telephony_session_id: "csi05-exact",
            call_log_ids: ["csi05-log"],
            direction: "Inbound",
            started_at: at,
            first_observed_at: at,
            last_observed_at: at,
            identity_basis: "telephony_session_id",
            recordings: [{ provider_recording_id: "csi05-recording", observed_at: at }],
          });
          const l = await lead(n.e164, at, "CallLead", {
            ringcentral: { telephony_session_id: "csi05-exact" },
          });
          await persist(l, "CallLead");
          assert.equal((await edge(l._id)).certainty, "exact");
          const f = await lead(n.e164);
          await persist(f);
          const current = await withTransaction((s) =>
            loadEligibilityInputs(call, s),
          );
          assert.equal(current.leads.length, 1);
          assert.equal(current.leads[0]?.id, String(l._id));
          const later = await getCallInteractionModel().create({
            contact_number_id: n._id,
            provider: "ringcentral",
            provider_account_id: "800000000001",
            telephony_session_id: "csi05-later",
            direction: "Inbound",
            started_at: at,
            first_observed_at: at,
            last_observed_at: at,
            identity_basis: "telephony_session_id",
          });
          assert.equal(
            (await withTransaction((s) => loadEligibilityInputs(later, s)))
              .ambiguous,
            true,
          );
          await drainAttachmentRefreshJobs(100);
          assert.ok(
            await Jobs.exists({
              stage: "recording_discovery",
              input_refs: call._id,
              dedupe_key: /attachment:/,
            }),
          );
        },
      );
      await t.test(
        "B job dispatch creates bounded scan jobs; current documents, no payload trust",
        async () => {
          const n = await number(),
            l = await lead(n.national_ten!);
          const call = await getCallInteractionModel().create({
            contact_number_id: n._id,
            provider: "ringcentral",
            provider_account_id: "800000000001",
            telephony_session_id: "csi05-wakeup",
            direction: "Inbound",
            started_at: at,
            first_observed_at: at,
            last_observed_at: at,
            identity_basis: "telephony_session_id",
          });
          const job = await withTransaction((s) =>
            enqueueCsiJob(
              {
                stage: "attachment_refresh",
                dedupe_key: `csi:attachment_refresh:number:${n._id}:1`,
                subject_key: `number:${n._id}`,
                input_revision: 1,
                input_refs: [String(call._id)],
              },
              s,
            ),
          );
          assert.equal(
            (
              await dispatchCsiWakeup({
                job_id: String(job._id),
                lead_id: String(l._id),
              })
            ).status,
            "invalid_payload",
          );
          const result = await dispatchCsiWakeup({ job_id: String(job._id) });
          assert.equal(result.status, "dispatched");
          await drainAttachmentRefreshJobs(100);
          assert.equal((await edge(l._id)).state, "candidate");
          assert.equal(
            (await runAttachmentRefreshJob(String(job._id))).status,
            "not_claimable",
          );
        },
      );
      await t.test(
        "watermark tie pagination beyond batch; lease contention, stage separation and rollback",
        async () => {
          const many = Array.from({ length: 205 }, () => ({
            _id: new mongoose.Types.ObjectId(),
            timestamp: at,
            updatedAt: at,
            createdAt: at,
          }));
          await getFormLeadModel().collection.insertMany(many);
          const first = await runAttachmentRefreshOnce();
          assert.ok(first.scanned <= 500);
          await runAttachmentRefreshOnce();
          for (const row of many)
            assert.ok(
              await Jobs.exists({
                subject_key: `attachment-lead:FormLead:${row._id}`,
              }),
            );
          await getSalesIntelligenceSyncStateModel().updateOne(
            { scope: "attachment_suggest" },
            {
              $set: {
                leased_until: new Date(Date.now() + 10000),
                lease_owner: "other",
              },
            },
          );
          assert.equal((await runAttachmentRefreshOnce()).reason, "lease_held");
          const wrong = await withTransaction((s) =>
            enqueueCsiJob(
              {
                stage: "outreach_ensure",
                subject_key: "other",
                dedupe_key: "other",
                input_revision: 1,
              },
              s,
            ),
          );
          assert.equal(
            (await runAttachmentRefreshJob(String(wrong._id))).status,
            "not_claimable",
          );
          const job = await withTransaction((s) =>
            enqueueCsiJob(
              {
                stage: "attachment_refresh",
                subject_key: "expired",
                dedupe_key: "expired",
                input_revision: 1,
              },
              s,
            ),
          );
          const claimed = await claimCsiJob(
            "expired",
            String(job._id),
            300000,
            "attachment_refresh",
          );
          await Jobs.updateOne(
            { _id: job._id },
            { $set: { leased_until: new Date(0) } },
          );
          await assert.rejects(
            completeCsiJob(
              {
                job_id: String(job._id),
                owner: "expired",
                epoch: claimed!.lease_epoch,
              },
              async (s) => {
                await Numbers.updateMany(
                  {},
                  { $set: { search_terms: ["must-rollback"] } },
                  { session: s },
                );
              },
            ),
            /LEASE_LOST/,
          );
          assert.equal(
            await Numbers.countDocuments({ search_terms: "must-rollback" }),
            0,
          );
        },
      );
      await t.test(
        "Owner competing Attached requires review; independent CAS contenders cannot both win",
        async () => {
          const n = await number(),
            a = await lead(n.e164),
            b = await lead(n.e164);
          await persist(a);
          await persist(b);
          await attach(a._id, "competing-a");
          await attach(b._id, "competing-b");
          const rows = await Edges.find({ contact_number_id: n._id }).lean();
          assert.equal(
            resolveAtInteraction(rows.map(attachmentPolicyInput), {
              id: "i",
              started_at: at,
              provider_account_id: "a",
              call_log_ids: [],
            }).blocked_reason,
            "competing_attached",
          );
          const row = await edge(a._id);
          const commands = await Promise.allSettled(
            ["one", "two"].map((key) =>
              commandAttachment({
                actor,
                attachment_id: String(row._id),
                idempotency_key: `cas-${key}`,
                command: {
                  command: "reject_attachment",
                  expected_revision: row.revision,
                  reason: "Synthetic competing edit",
                },
              }),
            ),
          );
          assert.equal(
            commands.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            commands.filter((r) => r.status === "rejected").length,
            1,
          );
        },
      );
      await t.test(
        "later contact snapshot preserves original evidence; adopted Call Log identity is exact",
        async () => {
          const original = await number(),
            later = await number(),
            l = await lead(original.e164);
          await persist(l);
          const oldEvidence = (await edge(l._id)).evidence;
          await persist({
            ...l,
            normalized_phone_number: later.e164,
            updatedAt: new Date("2026-09-05"),
            granot_contact_snapshot: {
              phone_number: later.e164,
              captured_at: new Date("2026-09-05"),
            },
          });
          const edges = await Edges.find({ "lead_ref.id": l._id }).lean();
          assert.equal(edges.length, 2);
          assert.deepEqual(
            edges.find(
              (e) => String(e.contact_number_id) === String(original._id),
            )!.evidence,
            oldEvidence,
          );
          const newEdge = edges.find(
            (e) => String(e.contact_number_id) === String(later._id),
          )!;
          assert.equal(
            resolveAtInteraction([attachmentPolicyInput(newEdge)], {
              id: "i",
              started_at: at,
              provider_account_id: "a",
              call_log_ids: [],
            }).lead_effects_allowed,
            false,
          );
          assert.ok(
            newEdge.evidence.some(
              (e) => e.field_path === "granot_contact_snapshot.phone_number",
            ),
          );
          const adoptedNumber = await number();
          const interaction = await getCallInteractionModel().create({
            contact_number_id: adoptedNumber._id,
            provider: "ringcentral",
            provider_account_id: "800000000001",
            telephony_session_id: "adopted",
            call_log_ids: ["adopted-log"],
            direction: "Inbound",
            started_at: at,
            first_observed_at: at,
            last_observed_at: at,
            identity_basis: "telephony_session_id",
            // Rediscovery after an attachment change is only raised for calls
            // that carry a recording; a call without one has nothing to rebind.
            recordings: [{ provider_recording_id: "adopted-recording", observed_at: at }],
          });
          const silent = await getCallInteractionModel().create({
            contact_number_id: adoptedNumber._id,
            provider: "ringcentral",
            provider_account_id: "800000000001",
            telephony_session_id: "adopted-silent",
            call_log_ids: ["adopted-silent-log"],
            direction: "Inbound",
            started_at: new Date(+at + 60_000),
            first_observed_at: at,
            last_observed_at: at,
            identity_basis: "telephony_session_id",
          });
          const adopted = await lead(adoptedNumber.e164, at, "CallLead", {
            ingestion_origin: "granot_lead_created",
            ringcentral: { call_log_id: "adopted-log" },
          });
          await persist(adopted, "CallLead");
          assert.ok(
            (await edge(adopted._id)).evidence.some(
              (e) => e.source === "ringcentral_call_adoption",
            ),
          );
          const originalJob = await withTransaction((s) =>
            enqueueCsiJob(
              {
                stage: "recording_discovery",
                dedupe_key: "original-discovery",
                subject_key: `interaction:${interaction._id}`,
                input_revision: 1,
                input_refs: [String(interaction._id)],
              },
              s,
            ),
          );
          await Jobs.updateOne(
            { _id: originalJob._id },
            { $set: { status: "completed", completed_at: new Date() } },
          );
          await attach(adopted._id, "adopted-owner");
          // Earlier watermark jobs intentionally exceed a drain budget; target the durable change intents directly.
          for (const hook of await Jobs.find({
            stage: "attachment_refresh",
            subject_key: `attachment-change:${adoptedNumber._id}`,
          })) {
            assert.equal(
              (await runAttachmentRefreshJob(String(hook._id))).status,
              "completed",
            );
          }
          assert.equal(
            (await Jobs.findById(originalJob._id))?.status,
            "completed",
          );
          assert.ok(
            await Jobs.exists({
              stage: "recording_discovery",
              input_refs: interaction._id,
              dedupe_key: /attachment:/,
            }),
          );
          assert.equal(
            await Jobs.exists({ stage: "recording_discovery", input_refs: silent._id, dedupe_key: /attachment:/ }),
            null,
            "a call without a recording is not rediscovered on an attachment change",
          );
          // One coalesced Outreach replay per number revision, not one job per call.
          const replays = await Jobs.find({ stage: "outreach_ensure", subject_key: `outreach-number:${adoptedNumber._id}` }).lean();
          assert.ok(replays.length >= 1);
          assert.equal(
            await Jobs.countDocuments({ stage: "outreach_ensure", subject_key: `number:${adoptedNumber._id}`, dedupe_key: /attachment:/ }),
            0,
          );
        },
      );
      // ---- H5 sole-match auto-attach (Lead progress §5, §13.3 H5; acceptance 6–9, attachment side) ----
      const priorAutoAttach = process.env.SALES_INTELLIGENCE_AUTO_ATTACH;
      process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
      const ten = (n: { national_ten?: string | null }) => n.national_ten!;
      const auditCount = (event_kind: string, attachmentId: unknown) =>
        db.collection("sales_intelligence_audit_events").countDocuments({ event_kind, "current.attachment_id": String(attachmentId) });
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      /** Evaluate in a transaction the test commits later, so a second transaction can interleave. */
      async function openEvaluation(row: LeadSource, model: "FormLead" | "CallLead" = "FormLead") {
        const session = await mongoose.connection.startSession();
        session.startTransaction();
        await persistLeadAttachments(row, model, session, "a".repeat(24), at);
        return session;
      }
      const synthetic = (phone: string) => ({ _id: new mongoose.Types.ObjectId(), timestamp: at, createdAt: at, updatedAt: at,
        name: "Synthetic H5", normalized_phone_number: phone, ingested_contact_snapshot: { normalized_phone_number: phone, captured_at: at } });
      try {
        await t.test(
          "H5 case 6: sole non-duplicate Form or Call Lead attaches without calls; a duplicate does not block; replay adds nothing",
          async () => {
            const n = await number();
            const dup = await lead(ten(n), at, "FormLead", { duplicate: true });
            const a = await lead(ten(n), at, "FormLead", { source_company: "partner-a",
              granot_contact_snapshot: { normalized_phone_number: ten(n), phone_number: `(202) 555-01${n.e164.slice(-2)}`,
                differs_from_ingested: false, captured_at: at } });
            await persist(dup);
            assert.notEqual((await edge(dup._id)).state, "attached");
            await persist(a);
            const attached = await edge(a._id);
            assert.equal(attached.state, "attached");
            assert.equal(attached.certainty, "likely");
            assert.equal(attached.decision_reason, "sole_non_duplicate_match");
            assert.equal(attached.auto_decision?.confidence, 1);
            assert.equal(attached.auto_decision?.reason, "sole_non_duplicate_match");
            assert.equal(attached.decided_at, null);
            assert.equal(attached.history.at(-1)?.reason, "sole_non_duplicate_match");
            assert.equal(await getCallInteractionModel().countDocuments({ contact_number_id: n._id }), 0);
            const audit = await db.collection("sales_intelligence_audit_events").findOne({
              event_kind: "attachment_auto_attached", "current.attachment_id": String(attached._id) });
            assert.equal(audit?.current.candidate_count, 1);
            assert.equal(audit?.current.policy_version, "sole-match-v1");
            assert.ok(audit?.current.source_fields.length >= 2);
            await persist(a); await persist(dup); await persist(a);
            assert.equal((await edge(a._id)).revision, attached.revision);
            assert.equal(await Edges.countDocuments({ contact_number_id: n._id }), 2);
            assert.equal(await auditCount("attachment_auto_attached", attached._id), 1);
            const m = await number();
            const c = await lead(ten(m), at, "CallLead", {
              ringcentral: { original_caller: { normalized_phone_number: ten(m), captured_at: at } } });
            await persist(c, "CallLead");
            assert.equal((await edge(c._id)).state, "attached");
            assert.equal(await getCallInteractionModel().countDocuments({ contact_number_id: m._id }), 0);
          },
        );
        await t.test(
          "H5 case 7: a second non-duplicate Lead (other Source Company, older move, Form+Call, Bad Lead) blocks even with no edge",
          async () => {
            const n = await number();
            const a = await lead(ten(n), at, "FormLead", { source_company: "partner-a" });
            await lead(ten(n), new Date("2025-03-01T12:00:00Z"), "CallLead", { source_company: "partner-b" });
            await persist(a);
            assert.equal((await edge(a._id)).state, "candidate");
            assert.equal(await Edges.countDocuments({ contact_number_id: n._id }), 1, "the competitor has no edge");
            const set = await withTransaction((s) => completeNormalizedMatchSet(n, s));
            assert.equal(set.status, "complete");
            assert.deepEqual(set.candidates.map((c) => c.lead_ref.model).sort(), ["CallLead", "FormLead"]);
            assert.equal(set.target, null);
            const m = await number();
            const b = await lead(ten(m));
            const bad = await lead(ten(m), at, "FormLead", { bad_lead: "fake_info" });
            await persist(b); await persist(bad);
            assert.notEqual((await edge(b._id)).state, "attached");
            assert.notEqual((await edge(bad._id)).state, "attached");
            const solo = await number();
            const onlyBad = await lead(ten(solo), at, "FormLead", { bad_lead: "fake_info" });
            await persist(onlyBad);
            assert.notEqual((await edge(onlyBad._id)).state, "attached");
          },
        );
        await t.test(
          "H5 case 7: incomplete lookups (raw-only Granot evidence, page overflow) are Unknown and never attach",
          async () => {
            const n = await number();
            const raw = { _id: new mongoose.Types.ObjectId(), timestamp: at, createdAt: at, updatedAt: at, name: "Raw Granot",
              granot_contact_snapshot: { phone_number: `(202) 555-01${n.e164.slice(-2)}`, differs_from_ingested: false, captured_at: at } };
            await getFormLeadModel().collection.insertOne(raw);
            await persist(raw);
            const a = await lead(ten(n));
            await persist(a);
            const set = await withTransaction((s) => completeNormalizedMatchSet(n, s));
            assert.equal(set.status, "unknown");
            assert.equal(set.reason, "unindexed_evidence");
            assert.notEqual((await edge(a._id)).state, "attached");
            assert.notEqual((await edge(raw._id)).state, "attached");
            const m = await number();
            await getFormLeadModel().collection.insertMany(Array.from({ length: 251 }, () => synthetic(ten(m))));
            const page = await withTransaction((s) => completeNormalizedMatchSet(m, s));
            assert.equal(page.status, "unknown");
            assert.equal(page.reason, "page_exceeded");
            assert.equal(page.target, null);
          },
        );
        await t.test(
          "H5 case 7: protected rejection, Owner detach and a competing Owner edge cannot look unique",
          async () => {
            const n = await number(), a = await lead(ten(n));
            process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "false";
            await persist(a);
            process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
            let row = await edge(a._id);
            await commandAttachment({ actor, attachment_id: String(row._id), idempotency_key: "h5-reject",
              command: { command: "reject_attachment", expected_revision: row.revision, reason: "Not this caller" } });
            await persist(a);
            assert.equal((await edge(a._id)).state, "rejected");
            assert.equal(await auditCount("attachment_auto_attached", row._id), 0);
            const m = await number(), b = await lead(ten(m));
            await persist(b);
            row = await edge(b._id);
            assert.equal(row.state, "attached");
            await commandAttachment({ actor, attachment_id: String(row._id), idempotency_key: "h5-detach",
              command: { command: "detach_attachment", expected_revision: row.revision, reason: "Wrong person" } });
            await persist(b);
            const detached = await edge(b._id);
            assert.equal(detached.state, "candidate");
            assert.ok(detached.decided_at);
            assert.equal(await auditCount("attachment_auto_attached", row._id), 1);
            const o = await number(), c = await lead(ten(o)), other = await lead("2025559999");
            await commandAttachment({ actor, idempotency_key: "h5-owner-other", command: { command: "attach_lead",
              contact_number_id: String(o._id), lead_ref: { model: "FormLead", id: String(other._id) },
              expected_revision: (await Numbers.findById(o._id).lean())!.revision, reason: "Owner knows this caller" } });
            await persist(c);
            assert.notEqual((await edge(c._id)).state, "attached");
            assert.equal((await Edges.findOne({ contact_number_id: o._id, "lead_ref.id": other._id }).lean())?.certainty, "owner_confirmed");
          },
        );
        await t.test(
          "H5 case 8: a later competitor contests only the automatic edge, opens one identity review, keeps history; Owner edges stay",
          async () => {
            const n = await number(), a = await lead(ten(n));
            await persist(a);
            const attached = await edge(a._id);
            assert.equal(attached.state, "attached");
            const b = await lead(ten(n), new Date("2024-06-01T12:00:00Z"), "CallLead");
            await persist(b, "CallLead");
            const contested = await edge(a._id);
            assert.equal(contested.state, "ambiguous");
            assert.equal(contested.certainty, "unsure");
            assert.equal(contested.decided_at, null);
            assert.equal(contested.auto_decision, null);
            assert.deepEqual(contested.history.slice(0, attached.history.length), attached.history);
            assert.equal(contested.history.at(-1)?.reason, "auto_attach_contested");
            const reviews = () => db.collection("sales_intelligence_review_items").countDocuments({ subject_key: `number:${n._id}`,
              cause_kind: "identity", cause_key: `auto_attach_contested:${n._id}`, state: "open" });
            assert.equal(await reviews(), 1);
            assert.equal(await auditCount("attachment_auto_contested", attached._id), 1);
            await persist(b, "CallLead"); await persist(a); await persist(b, "CallLead");
            assert.equal((await edge(a._id)).revision, contested.revision);
            assert.equal(await reviews(), 1);
            assert.equal(await auditCount("attachment_auto_contested", attached._id), 1);
            // The competitor becomes a duplicate and no Owner decision blocks: re-evaluation may attach again.
            await getCallLeadModel().collection.updateOne({ _id: b._id }, { $set: { duplicate: true } });
            await persist({ ...b, duplicate: true } as LeadSource, "CallLead");
            assert.equal((await edge(a._id)).state, "attached");
            const m = await number(), o = await lead(ten(m));
            await persist(o);
            await attach(o._id, "h5-owner-confirmed");
            await persist(await lead(ten(m)));
            const owner = await edge(o._id);
            assert.equal(owner.state, "attached");
            assert.equal(owner.certainty, "owner_confirmed");
          },
        );
        await t.test(
          "H5 case 8: INSERT/ATTACH race — a concurrently inserted competitor never leaves a permanent sole-match decision",
          async () => {
            // (1) The competitor's own lead-side evaluation races an open evaluation of A on the same number.
            const n = await number(), a = await lead(ten(n));
            const s1 = await openEvaluation(a);
            const b = synthetic(ten(n));
            let attempts = 0;
            const t2 = withTransaction(async (s) => {
              attempts++;
              await getFormLeadModel().collection.insertOne({ ...b }, { session: s });
              return persistLeadAttachments(b, "FormLead", s, "b".repeat(24), at);
            });
            await pause(250);
            await s1.commitTransaction(); await s1.endSession();
            await t2;
            const finalA = await edge(a._id);
            assert.notEqual(finalA.state, "attached");
            assert.notEqual((await edge(b._id)).state, "attached");
            assert.ok(finalA.history.some((h) => h.reason === "auto_attach_contested"));
            assert.ok(attempts > 1, "lockNumber serialized the two transactions");
            // (2) Insert-only commit inside A's snapshot: A attaches, then the policy-versioned lead job contests it.
            const m = await number(), c = await lead(ten(m));
            const s2 = await openEvaluation(c);
            const d = synthetic(ten(m));
            await withTransaction((s) => getFormLeadModel().collection.insertOne({ ...d }, { session: s }));
            await s2.commitTransaction(); await s2.endSession();
            assert.equal((await edge(c._id)).state, "attached", "the stale snapshot saw one Lead");
            const job = await withTransaction((s) => enqueueCsiJob({ stage: "attachment_refresh",
              subject_key: `attachment-lead:FormLead:${d._id}`, dedupe_key: `csi:attachment-lead:sole-match-v1:FormLead:${d._id}:race`,
              input_revision: 1, input_refs: [String(d._id)] }, s));
            assert.equal((await runAttachmentRefreshJob(String(job._id))).status, "completed");
            assert.equal((await edge(c._id)).state, "ambiguous");
            assert.notEqual((await edge(d._id)).state, "attached");
          },
        );
        await t.test(
          "H5 case 8: PHONE-CHANGE/ATTACH race — a Lead moving onto the number contests durably",
          async () => {
            const n = await number(), elsewhere = await number();
            const a = await lead(ten(n)), b = await lead(ten(elsewhere));
            const s1 = await openEvaluation(a);
            let attempts = 0;
            const t2 = withTransaction(async (s) => {
              attempts++;
              await getFormLeadModel().collection.updateOne({ _id: b._id },
                { $set: { normalized_phone_number: ten(n), updatedAt: new Date("2026-09-02T12:00:00Z") } }, { session: s });
              const current = (await getFormLeadModel().findById(b._id).session(s).lean())!;
              return persistLeadAttachments(current as unknown as LeadSource, "FormLead", s, "c".repeat(24), at);
            });
            await pause(250);
            await s1.commitTransaction(); await s1.endSession();
            await t2;
            const finalA = await Edges.findOne({ contact_number_id: n._id, "lead_ref.id": a._id }).lean().orFail();
            assert.notEqual(finalA.state, "attached");
            assert.ok(finalA.history.some((h) => h.reason === "auto_attach_contested"));
            assert.ok(attempts > 1, "lockNumber serialized the two transactions");
            const moved = await Edges.findOne({ contact_number_id: n._id, "lead_ref.id": b._id }).lean().orFail();
            assert.notEqual(moved.state, "attached");
          },
        );
        await t.test(
          "H5 case 9: exact Call Lead stays Exact; out-of-window calls stay Number evidence; one Lead may hold several numbers",
          async () => {
            const n = await number();
            await getCallInteractionModel().create({ contact_number_id: n._id, provider: "ringcentral", provider_account_id: "800000000001",
              telephony_session_id: "h5-exact", call_log_ids: ["h5-log"], direction: "Inbound", started_at: at,
              first_observed_at: at, last_observed_at: at, identity_basis: "telephony_session_id" });
            const exact = await lead(ten(n), at, "CallLead", { ringcentral: { telephony_session_id: "h5-exact" } });
            await persist(exact, "CallLead");
            const row = await edge(exact._id);
            assert.equal(row.state, "attached");
            assert.equal(row.certainty, "exact");
            assert.equal(row.auto_decision ?? null, null);
            assert.equal(await auditCount("attachment_auto_attached", row._id), 0);
            const home = await number(), cell = await number();
            const f = await lead(ten(home), at, "FormLead", { ingested_contact_snapshot: { normalized_phone_number: ten(cell), captured_at: at } });
            await persist(f);
            const edges = await Edges.find({ "lead_ref.id": f._id }).lean();
            assert.equal(edges.length, 2);
            assert.ok(edges.every((e) => e.state === "attached" && e.decision_reason === "sole_non_duplicate_match"));
            const homeEdge = edges.find((e) => String(e.contact_number_id) === String(home._id))!;
            const identity = { id: "i", provider_account_id: "a", call_log_ids: [], started_at: at };
            assert.equal(resolveAtInteraction([attachmentPolicyInput(homeEdge)], identity).lead_ref?.id, String(f._id));
            assert.equal(resolveAtInteraction([attachmentPolicyInput(homeEdge)], { ...identity, started_at: new Date("2026-11-01T12:00:00Z") })
              .lead_effects_allowed, false);
          },
        );
      } finally {
        if (priorAutoAttach === undefined) delete process.env.SALES_INTELLIGENCE_AUTO_ATTACH;
        else process.env.SALES_INTELLIGENCE_AUTO_ATTACH = priorAutoAttach;
      }
      await t.test(
        "GET and flag-off cron/worker/command do not mutate any collection or official records",
        async () => {
          const n = await Numbers.findOne().orFail();
          const before = await snapshot();
          const page = await listAttachments({
            contact_number_id: String(n._id),
            limit: 1,
          });
          assert.ok(page.items.length);
          assert.equal(await snapshot(), before);
          process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH = "false";
          assert.equal((await runAttachmentRefreshOnce()).reason, "disabled");
          assert.equal((await runAttachmentRefreshJob()).status, "disabled");
          await assert.rejects(
            commandAttachment({
              actor,
              idempotency_key: "off",
              command: {
                command: "attach_lead",
                contact_number_id: String(n._id),
                lead_ref: page.items[0]!.lead_ref,
                expected_revision: 1,
                reason: "Off",
              },
            }),
            /FEATURE_DISABLED/,
          );
          assert.equal(await snapshot(), before);
          assert.equal(
            await db.collection("entity_changes").countDocuments(),
            0,
          );
          assert.equal(
            await db.collection("outreach_records").countDocuments(),
            0,
          );
          assert.equal(
            await Jobs.countDocuments({
              stage: { $in: ["analysis", "transcription", "media_fetch"] },
            }),
            0,
          );
          // loadLead is a read; missing rows never mint official records.
          assert.equal(
            await withTransaction((s) =>
              loadLead(
                {
                  model: "CallLead",
                  id: String(new mongoose.Types.ObjectId()),
                },
                s,
              ),
            ),
            null,
          );
        },
      );
    } finally {
      await db.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
