import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import mongoose from "mongoose";
import express, { type Request as ExpressRequest } from "express";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import {
  CSI_BACKFILL_JOB_PRIORITY,
  CSI_LIVE_JOB_PRIORITY,
  csiDataset,
} from "../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getSalesIntelligenceSyncStateModel } from "../src/models/SalesIntelligenceSyncState";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { initializeCsiBudgetPeriod } from "../src/services/salesIntelligence/aiBudget";
import { claimCsiJob, enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import {
  runIntelligenceJob, drainIntelligenceJobs,
  isHistoricalBackfillOnly,
  type AnalysisDependencies,
} from "../src/services/salesIntelligence/analysis/worker";
import { DEFAULT_RUNTIME_LIMITS } from "../src/services/salesIntelligence/analysis/runtime";
import { scheduleTranscriptionJobs } from "../src/services/salesIntelligence/conversations/transcriptionScheduling";
import { requireVantageAuth } from "../src/middleware/requireApiSecret";
import { createSalesIntelligenceBoundaryRouter } from "../src/routes/sales-intelligence-boundary.routes";
import { createSalesIntelligenceInternalRouter } from "../src/routes/sales-intelligence-internal.routes";
import { payloadHash } from "../src/services/salesIntelligence/transactions";

import { commandCsiSettings, readCsiSettings } from "../src/services/salesIntelligence/settings";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { getIntelligenceSubmissionModel } from "../src/models/IntelligenceSubmission";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { readContentSchema } from "../src/services/salesIntelligence/analysis/reads";
import { intelligenceEnvelopeSchema } from "../src/validation/intelligence/intelligenceEnvelope.validation";

function oid() {
  return new mongoose.Types.ObjectId();
}

test("CSI-15 budget, provider recovery, and historical priority", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240_000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi15budget[a-f0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => {
    await db.dropDatabase();
    await mongoose.disconnect();
  });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);

  await getSalesIntelligenceSyncStateModel().create({ scope: "call_log_all_directions", known_complete_through: new Date(Date.now() + 3_600_000), gaps: [] });
  const Jobs = getSalesIntelligenceJobModel();
  const Runs = getIntelligenceRunModel();
  const Snapshots = getIntelligenceEvidenceSnapshotModel();
  async function clearLiveAiQueue() {
    await Jobs.updateMany(
      {
        ...csiDataset(),
        stage: { $in: ["transcription", "analysis", "number_refresh"] },
        priority: { $gte: CSI_LIVE_JOB_PRIORITY },
      },
      { $set: { status: "completed", lease_owner: null, leased_until: null, completed_at: new Date() } },
    );
  }
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  const actorRequest: ExpressRequest = Object.assign(Object.create(express.request), { method: "PATCH", originalUrl: "/api/v1/admin/sales-intelligence/settings", headers: {}, vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi15-budget", method: actorRequest.method, path: actorRequest.originalUrl };
  actorRequest.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET) };
  const actor = requireCsiOwner(actorRequest);
  async function ceiling(cents: number) {
    const settings = await readCsiSettings();
    return commandCsiSettings({ actor, idempotency_key: `ceiling:${oid()}`, command: { command: "update_settings", expected_revision: settings.revision,
      policy: { ...settings.policy, monthly_ceiling_cents: cents }, reason: "Synthetic budget recovery proof" } });
  }
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({
    month,
    policy_version: "csi-policy-v1",
    timezone: "UTC",
    ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`),
    period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  });

  const app = express();
  app.use(express.json());
  app.use(requireVantageAuth);
  app.use(createSalesIntelligenceBoundaryRouter());
  app.use(createSalesIntelligenceInternalRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  const modulePath = pathToFileURL(resolve("../vantage-movers-mcp/lib/intelligence/handler.ts")).href;
  const { createIntelligenceHandler } = await import(modulePath);
  const handler: (request: Request) => Promise<Response> = createIntelligenceHandler({
    env: {
      SALES_INTELLIGENCE_SCOPED_API_KEY: "synthetic-scoped",
      SALES_INTELLIGENCE_RUN_TOKEN_SECRET: process.env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET,
      SALES_INTELLIGENCE_DEPLOYMENT_ID: csiDataset().deployment,
      SALES_INTELLIGENCE_DATABASE: getMongoDatabaseName(),
      SALES_INTELLIGENCE_API_BASE_URL: `http://127.0.0.1:${addr.port}`,
    },
  });
  const mcp = createServer(async (req, res) => {
    try {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(Buffer.from(chunk));
      const body = Buffer.concat(parts).toString();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const response = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end("synthetic transport failure");
    }
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => mcp.once("listening", r));
  const mcpAddr = mcp.address();
  assert(mcpAddr && typeof mcpAddr !== "string");
  const mcpPort = mcpAddr.port;
  t.after(async () => {
    await Promise.all([
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
      new Promise<void>((r) => {
        mcp.closeAllConnections();
        mcp.close(() => r());
      }),
    ]);
  });

  let serial = 0;
  async function analysisFixture(sources: string[]) {
    serial++;
    const at = new Date("2026-09-18T14:00:00Z");
    const number = await getContactNumberModel().create({
      e164: `+1202555${String(2000 + serial)}`,
      digits_reversed: `budget-${serial}`,
      first_observed_at: at,
      last_activity_at: at,
    });
    const call = await getCallInteractionModel().create({
      provider_account_id: "synthetic",
      telephony_session_id: `budget-${serial}`,
      identity_basis: "telephony_session_id",
      contact_number_id: number._id,
      direction: "Inbound",
      started_at: at,
      first_observed_at: at,
      last_observed_at: at,
      sources,
      terminal: true,
      provider_connected: true,
      inbound_route_id: oid(),
      parties: [],
      recordings: [{ provider_recording_id: `rec-${serial}`, observed_at: at }],
    });
    const digest = "c".repeat(64);
    const version = `budget-v-${serial}`;
    const conversation = await getLeadConversationModel().create({
      provider: "ringcentral",
      provider_account_id: "synthetic",
      provider_recording_id: call.recordings[0]!.provider_recording_id,
      call_interaction_id: call._id,
      contact_number_id: number._id,
      started_at: at,
      direction: "Inbound",
      match_method: "number_only",
      match_confidence: "low",
      state: "transcribed",
      latest_transcript_version: version,
      media_digest_sha256: digest,
      media: {
        blob_pathname: "conversations/synthetic-budget.mp3",
        bytes: 1024,
        content_type: "audio/mpeg",
        stored_at: at,
      },
    });
    const snapshot = await Snapshots.create({
      ...csiDataset(),
      conversation_id: conversation._id,
      transcript_version: version,
      source_type: "transcript",
      source_id: String(conversation._id),
      source_revision: digest,
      arguments: {},
      response: {},
      retrieved_at: at,
      happened_at: at,
      content_digest: payloadHash({ text: "Please call me again" }),
      subject_key: `conversation:${conversation._id}`,
      completeness: { complete: true, missing_ranges: [] },
      segments: [{ sid: 1, text: "Please call me again", start_ms: null, end_ms: null, speaker: "unknown", timing_source: "unavailable" }],
    });
    const job = await withTransaction((session) =>
      enqueueCsiJob(
        {
          stage: "analysis",
          subject_key: `conversation:${conversation._id}`,
          input_revision: 1,
          dedupe_key: `csi15:budget:${conversation._id}:${version}`,
          input_refs: [String(conversation._id), String(snapshot._id)],
          priority: isHistoricalBackfillOnly(sources) ? CSI_BACKFILL_JOB_PRIORITY : CSI_LIVE_JOB_PRIORITY,
        },
        session,
      ),
    );
    return { conversation, snapshot, job, call };
  }

  const { MockLanguageModelV4 } = await import("ai/test");
  function deps(jobId: string, behavior: "ok" | "429" | "429-date" | "401" | "403" | "500"): AnalysisDependencies {
    let step = 0;
    return {
      configuration: {
        endpoint: `http://127.0.0.1:${mcpPort}/api/intelligence-mcp`,
        key: "synthetic-scoped",
        gateway_key: undefined,
        model_id: "openai/gpt-5-mini",
        pricing: { version: "synthetic-v1", input_cents_per_million: 1, output_cents_per_million: 1 },
        limits: DEFAULT_RUNTIME_LIMITS,
      },
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          if (behavior === "429" || behavior === "429-date") {
            const error = new Error("rate limited") as Error & { statusCode: number; responseHeaders: Record<string, string> };
            error.statusCode = 429;
            error.responseHeaders = { "retry-after": behavior === "429-date" ? new Date(Date.now() + 120_000).toUTCString() : "42" };
            throw error;
          }
          if (behavior === "401" || behavior === "403") {
            const error = new Error("unauthorized") as Error & { statusCode: number };
            error.statusCode = Number(behavior);
            throw error;
          }
          if (behavior === "500") {
            const error = new Error("server") as Error & { statusCode: number };
            error.statusCode = 500;
            throw error;
          }
          step++;
          const run = await Runs.findOne({ job_id: jobId }).orFail();
          const captured = (await Snapshots.find({ run_id: run._id }).lean()).find(s => readContentSchema.parse(s.response).transcript);
          const transcript = captured ? readContentSchema.parse(captured.response).transcript! : null;
          const finding = transcript ? { key: "callback", kind: "customer_requested_callback", claim: "Customer requested callback", basis: "said_on_call", actor: "customer", speaker_ref: null,
            action_status: "requested", clarity: "clear", confidence: null, evidence: [{ source: "transcript", snapshot_id: String(captured!._id), conversation_id: transcript.conversation_id,
              transcript_version: transcript.transcript_version, segment_ids: [], quote: null }], value: { action_kind: "call", description: "Return customer's call", date_text: null, timezone_text: null, target_followup_id: null } } : null;
          const envelope = intelligenceEnvelopeSchema.parse({ schema_version: "csi-envelope-v1", summary: { overview: "Synthetic analysis", customer_wanted: "Callback", money_and_dates: "Unknown", outcome: "Requested callback",
            commitments: "One request", discrepancies: "Unknown speaker", finding_keys: finding ? ["callback"] : [] }, findings: finding ? [finding] : [], next_step_suggestion: null, owner_instruction_assessments: [] });
          return { content: [{ type: "tool-call" as const, toolCallId: `tool-${step}`, toolName: step === 1 ? "get_intelligence_context" : "submit_intelligence_analysis",
            input: JSON.stringify(step === 1 ? {} : { idempotency_key: String(run._id), envelope }) }], finishReason: { unified: "tool-calls" as const, raw: "synthetic" },
            usage: { inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 30, reasoning: 10 } }, warnings: [], providerMetadata: { gateway: { cost: 0.001 } } };
        },
      }),
      publish: async () => ({ published: false, error_code: null }),
    };
  }

  await t.test("historical backfill-only sources enqueue transcription at backfill priority", async () => {
    const at = new Date("2026-09-18T14:00:00Z");
    const number = await getContactNumberModel().create({
      e164: "+12025551234",
      digits_reversed: "4321552021",
      first_observed_at: at,
      last_activity_at: at,
    });
    const telephonySessionId = `hist-priority-${String(oid())}`;
    const recordingId = `rec-hist-${String(oid())}`;
    await getCallInteractionModel().create({
      provider_account_id: "synthetic",
      telephony_session_id: telephonySessionId,
      identity_basis: "telephony_session_id",
      contact_number_id: number._id,
      direction: "Inbound",
      started_at: at,
      first_observed_at: at,
      last_observed_at: at,
      sources: ["backfill"],
      terminal: true,
      provider_connected: true,
      inbound_route_id: oid(),
      parties: [],
      recordings: [{ provider_recording_id: recordingId, observed_at: at }],
    });
    const digest = "d".repeat(64);
    await getLeadConversationModel().create({
      provider: "ringcentral",
      provider_account_id: "synthetic",
      provider_recording_id: recordingId,
      call_interaction_id: (await getCallInteractionModel().findOne({ telephony_session_id: telephonySessionId }))!._id,
      contact_number_id: number._id,
      started_at: at,
      direction: "Inbound",
      match_method: "number_only",
      match_confidence: "low",
      state: "media_stored",
      media_digest_sha256: digest,
      media: { blob_pathname: "conversations/hist.mp3", bytes: 100, content_type: "audio/mpeg", stored_at: at },
      next_attempt_at: new Date(0),
    });
    const ids = await scheduleTranscriptionJobs(1, async () => ({ published: false, error_code: null }));
    assert.equal(ids.length, 1);
    const row = await Jobs.findById(ids[0]).lean();
    assert.equal(row?.priority, CSI_BACKFILL_JOB_PRIORITY);
  });

  await t.test("due live analysis outranks historical when both are pending", async () => {
    const live = await withTransaction((session) =>
      enqueueCsiJob(
        {
          stage: "analysis",
          subject_key: "conversation:aaaaaaaaaaaaaaaaaaaaaaaa",
          input_revision: 1,
          dedupe_key: "csi15:live-priority",
          input_refs: ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
          priority: CSI_LIVE_JOB_PRIORITY,
        },
        session,
        new Date(0),
      ),
    );
    const hist = await withTransaction((session) =>
      enqueueCsiJob(
        {
          stage: "analysis",
          subject_key: "conversation:cccccccccccccccccccccccc",
          input_revision: 1,
          dedupe_key: "csi15:hist-priority",
          input_refs: ["cccccccccccccccccccccccc", "dddddddddddddddddddddddd"],
          priority: CSI_BACKFILL_JOB_PRIORITY,
        },
        session,
      ),
    );
    const claimed = await claimCsiJob("priority-proof", undefined, 60_000, "analysis");
    assert.ok(claimed);
    assert.equal(String(claimed!._id), String(live._id));
    assert.notEqual(String(claimed!._id), String(hist._id));
    await Jobs.updateOne(
      { _id: live._id },
      { $set: { status: "completed", lease_owner: null, leased_until: null, completed_at: new Date() } },
    );
    await Jobs.deleteOne({ _id: hist._id });
  });

  await t.test("analysis worker 429 honors Retry-After without burning attempts", async () => {
    await clearLiveAiQueue();
    const f = await analysisFixture(["backfill"]);
    const before = (await Jobs.findById(f.job._id))!.attempts;
    const result = await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "429"));
    assert.equal(result.status, "retry");
    const after = await Jobs.findById(f.job._id).lean();
    assert.equal(after?.attempts, before);
    assert.equal(after?.reason, "throttled");
    assert.ok(after?.next_attempt_at && after.next_attempt_at.getTime() > Date.now());
  });

  await t.test("analysis worker 401 pauses without exhausting transient attempts", async () => {
    const f = await analysisFixture(["webhook"]);
    const result = await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "401"));
    assert.equal(result.status, "paused");
    const row = await Jobs.findById(f.job._id).lean();
    assert.equal(row?.status, "paused");
    assert.equal(row?.reason, "permission_denied");
    assert.equal(row?.attempts, 0);
  });

  await t.test("eight provider 500 failures dead-letter analysis at failed stage", async () => {
    const f = await analysisFixture(["webhook"]);
    for (let i = 0; i < 8; i++) {
      await Jobs.updateOne({ _id: f.job._id }, { $set: { status: "pending", next_attempt_at: new Date(0), lease_owner: null, leased_until: null } });
      const result = await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "500"));
      assert.equal(result.status, i === 7 ? "dead_letter" : "retry");
    }
    const row = await Jobs.findById(f.job._id).lean();
    assert.equal(row?.status, "dead_letter");
    const run = await Runs.findOne({ job_id: f.job._id }).lean();
    assert.ok(run); assert.equal(run.status, "failed");
  });

  await t.test("budget exhaustion pauses analysis while capture jobs remain claimable", async () => {
    const f = await analysisFixture(["webhook"]);
    await getSalesIntelligenceAiBudgetModel().updateOne({ month }, { $set: { ceiling_cents: 0, actual_cents: 0, reserved_cents: 0 } });
    const paused = await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "ok"));
    assert.equal(paused.status, "paused");
    assert.equal((await Jobs.findById(f.job._id))?.reason, "budget_exhausted");
    const capture = await withTransaction((session) =>
      enqueueCsiJob(
        {
          stage: "capture_projection",
          subject_key: "interaction:eeeeeeeeeeeeeeeeeeeeeeee",
          input_revision: 1,
          dedupe_key: "csi15:capture-parallel",
          input_refs: ["eeeeeeeeeeeeeeeeeeeeeeee"],
        },
        session,
      ),
    );
    const claimed = await claimCsiJob("capture-proof", undefined, 60_000, "capture_projection");
    assert.ok(claimed);
    assert.equal(String(claimed!._id), String(capture._id));
  });

  async function finishAndCheck(f: Awaited<ReturnType<typeof analysisFixture>>, runId: string) {
    const receipt = await getIntelligenceSubmissionModel().findOne({ run_id: runId }).orFail();
    assert.equal((await runIntelligenceApplicationJob(String(receipt.application_job_id), { onError: error => console.error(error) })).status, "completed");
    assert.equal(await Runs.countDocuments({ job_id: f.job._id }), 1);
    assert.equal(String((await Runs.findOne({ job_id: f.job._id }).orFail())._id), runId);
    assert.equal(await getOutreachFollowupModel().countDocuments({ origin_run_id: runId }), 1, JSON.stringify({ envelope: receipt.envelope, effects: await db.collection("intelligence_effects").find({ run_id: new mongoose.Types.ObjectId(runId) }).toArray() }));
    assert.equal((await runIntelligenceApplicationJob(String(receipt.application_job_id))).status, "not_claimable");
    assert.equal(await getOutreachFollowupModel().countDocuments({ origin_run_id: runId }), 1, JSON.stringify({ envelope: receipt.envelope, effects: await db.collection("intelligence_effects").find({ run_id: new mongoose.Types.ObjectId(runId) }).toArray() }));
    assert.equal(await Jobs.countDocuments({ stage: "transcription", subject_key: `conversation:${f.conversation._id}` }), 0);
    assert.equal((await getLeadConversationModel().findById(f.conversation._id))?.latest_transcript_version, f.conversation.latest_transcript_version);
  }
  await t.test("Owner cap increase resumes and completes saved analysis once without repeating STT or effects", async () => {
    await clearLiveAiQueue();
    const f = await analysisFixture(["webhook"]);
    await ceiling(0);
    assert.equal((await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "ok"))).status, "paused");
    const before = await Runs.findOne({ job_id: f.job._id }).orFail(); assert.equal(before.status, "paused");
    await ceiling(8000);
    const resumed = await Jobs.findById(f.job._id).orFail(); assert.equal(resumed.status, "pending"); assert.equal(resumed.stage, "analysis");
    assert.equal((await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "ok"))).status, "submitted");
    await finishAndCheck(f, String(before._id));
  });
  await t.test("new budget period activation resumes the saved stage and completes the same run", async () => {
    await clearLiveAiQueue(); const f = await analysisFixture(["webhook"]);
    await getSalesIntelligenceAiBudgetModel().updateOne({ month }, { $set: { ceiling_cents: 0 } });
    assert.equal((await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "ok"))).status, "paused");
    const before = await Runs.findOne({ job_id: f.job._id }).orFail();
    // Synthetic clock rollover: previous active interval expires; current interval is initialized by the production API.
    await getSalesIntelligenceAiBudgetModel().updateOne({ month }, { $set: { period_end: new Date(Date.now() - 1) } });
    const next = await initializeCsiBudgetPeriod({ month: "2026-10", policy_version: "synthetic-next-period", timezone: "UTC", ceiling_cents: 8000,
      period_start: new Date(Date.now() - 1000), period_end: new Date(Date.now() + 86_400_000) });
    assert.ok(next.activated_at); assert.equal((await Jobs.findById(f.job._id))?.status, "pending");
    assert.equal((await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "ok"))).status, "submitted");
    await finishAndCheck(f, String(before._id));
  });
  await t.test("Mongo drain recovers expired analysis lease and missing wake-up without provider duplication", async () => {
    await Jobs.deleteMany({ stage: { $in: ["analysis", "number_refresh"] } });
    const f = await analysisFixture(["webhook"]);
    const leased = await claimCsiJob("crashed-analysis", String(f.job._id), 60_000, "analysis"); assert.ok(leased);
    await Jobs.updateOne({ _id: f.job._id }, { $set: { leased_until: new Date(0) } });
    const result = await drainIntelligenceJobs(deps(String(f.job._id), "ok")); assert.equal(result.status, "submitted", JSON.stringify(result));
    const run = await Runs.findOne({ job_id: f.job._id }).orFail();
    assert.ok((await Jobs.findById(f.job._id))!.lease_epoch > leased.lease_epoch);
    await finishAndCheck(f, String(run._id));
  });
  await t.test("403 permission and HTTP-date 429 retain zero failed attempts", async () => {
    const forbidden = await analysisFixture(["webhook"]);
    assert.equal((await runIntelligenceJob(String(forbidden.job._id), "analysis", deps(String(forbidden.job._id), "403"))).status, "paused");
    assert.equal((await Jobs.findById(forbidden.job._id))?.attempts, 0);
    const throttled = await analysisFixture(["webhook"]);
    const before = Date.now();
    assert.equal((await runIntelligenceJob(String(throttled.job._id), "analysis", deps(String(throttled.job._id), "429-date"))).status, "retry");
    const row = await Jobs.findById(throttled.job._id).orFail(); assert.equal(row.attempts, 0);
    assert.ok(+row.next_attempt_at >= before + 118_000, row.next_attempt_at.toISOString());
  });
  await t.test("eighth crashed analysis claim without submission terminalizes its running run without provider or STT", async () => {
    await clearLiveAiQueue();
    const f = await analysisFixture(["webhook"]);
    assert.equal((await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "429"))).status, "retry");
    const run = await Runs.findOne({ job_id: f.job._id }).orFail(); assert.equal(run.status, "running");
    assert.equal(await getIntelligenceSubmissionModel().countDocuments({ run_id: run._id }), 0);
    // Isolate this crashed claim from other scenarios' deliberately pending work.
    await Jobs.updateMany({ _id: { $ne: f.job._id } }, { $set: { status: "completed", lease_owner: null, leased_until: null } });
    await getLeadConversationModel().updateMany({ _id: { $ne: f.conversation._id } }, { $set: { state: "complete" } });
    await Jobs.updateOne({ _id: f.job._id }, { $set: { status: "leased", attempts: 8, lease_owner: "crashed-final-claim", leased_until: new Date(0), next_attempt_at: new Date(0) }, $inc: { lease_epoch: 1 } });
    let providerCalls = 0;
    const noProvider = { ...deps(String(f.job._id), "ok"), model: new MockLanguageModelV4({ doGenerate: async () => { providerCalls++; throw new Error("exhausted job must never invoke provider"); } }) };
    const transcriptBefore = await Snapshots.countDocuments({ source_type: "transcript", conversation_id: f.conversation._id });
    await drainIntelligenceJobs(noProvider);
    const dead = await Jobs.findById(f.job._id).orFail();
    assert.equal(dead.status, "dead_letter"); assert.equal(dead.stage, "analysis"); assert.equal(dead.attempts, 8);
    assert.equal((await Runs.findById(run._id))?.status, "failed");
    assert.equal(providerCalls, 0);
    assert.equal(await Jobs.countDocuments({ stage: "transcription", subject_key: `conversation:${f.conversation._id}` }), 0);
    assert.equal(await Snapshots.countDocuments({ source_type: "transcript", conversation_id: f.conversation._id }), transcriptBefore);
  });  await t.test("backfill-only fixture records analysis mode backfill on prepare", async () => {
    await clearLiveAiQueue();
    const f = await analysisFixture(["backfill"]);
    await runIntelligenceJob(String(f.job._id), "analysis", deps(String(f.job._id), "429"));
    const run = await Runs.findOne({ job_id: f.job._id }).lean();
    assert.equal(run?.mode, "backfill");
  });
});




