/**
 * Disk trim (2026-10-07): the worker call-capture paths no longer insert
 * `sales_intelligence_audit_events` rows. Owner and desk commands still do.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { getSalesIntelligenceAuditEventModel } from "../../models/SalesIntelligenceAuditEvent";
import { runCaptureProjectionJob, type CaptureProjectionWorkerDeps } from "./captureProjectionWorker";
import { runCallLogRefreshJob, type CallLogRefreshDeps } from "./callLogRefresh";
import { inboundQueueAnsweredDeliveries } from "./fixtures";
import { csiWorkerActor } from "../salesIntelligence/auth";
import { appendCsiAudit } from "../salesIntelligence/transactions";

const WORKER_AUDIT_KINDS = ["interaction.updated", "interaction.created", "interaction.merged", "capture_projection.completed", "call_log_refresh.completed"];

/** Any `create` on the audit model during the mutation fails the test. */
async function withAuditModelFence<T>(run: () => Promise<T>): Promise<T> {
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_diskunit";
  const Audit = getSalesIntelligenceAuditEventModel();
  const original = Audit.create;
  const fence = async () => {
    throw new Error("audit row inserted by a worker completion");
  };
  Object.defineProperty(Audit, "create", { value: fence, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(Audit, "create", { value: original, configurable: true, writable: true });
  }
}

const fakeSession = { inTransaction: () => true } as unknown as mongoose.ClientSession;

test("appendCsiAudit itself still inserts (the Owner/desk path is unchanged): the fence proves it would have caught a worker insert", async () => {
  await withAuditModelFence(async () => {
    await assert.rejects(
      appendCsiAudit(
        { session: fakeSession, command_id: new mongoose.Types.ObjectId(), now: new Date(), actor: csiWorkerActor(new mongoose.Types.ObjectId().toHexString()) },
        { subject_key: "job:x", event_kind: "capture_projection.completed", prior: {}, current: {}, target_id: "x", revision: 1, kind: "job" },
      ),
      /audit row inserted by a worker completion/,
    );
  });
});

test("capture projection completion enqueues its follow-up jobs and inserts no audit row", async () => {
  const job = { _id: new mongoose.Types.ObjectId(), lease_epoch: 2, input_refs: [new mongoose.Types.ObjectId()], stage: "capture_projection", attempts: 1, status: "leased" };
  let mutation: ((session: mongoose.ClientSession) => Promise<unknown>) | null = null;
  const enqueued: string[] = [];
  const deps: CaptureProjectionWorkerDeps = {
    owner: "worker-a",
    now: () => new Date("2026-10-07T03:00:00.000Z"),
    claim: (async () => job) as never,
    complete: (async (_lease: unknown, m: (session: mongoose.ClientSession) => Promise<unknown>) => {
      mutation = m;
    }) as never,
    fail: (async () => undefined) as never,
    loadReceipt: async (id: string) => ({ _id: new mongoose.Types.ObjectId(id), provider: "ringcentral" as const, receivedAt: new Date(), uuid: "u1", rawBody: inboundQueueAnsweredDeliveries("s-w").ringing }),
    observe: (async () => [{ telephony_session_id: "s-w", account_id: "800000000001", ok: true, result: { interaction_id: new mongoose.Types.ObjectId().toHexString(), contact_number_id: null, projection_revision: 1, noop: false, created: true, newly_terminal: false, newly_settled: false, call_log_state: null, new_recording_ids: [], fenced_party_events: 0, stale_call_log: false, merged_interaction_ids: [], jobs: [], contact_number_created: false } }]) as never,
    refreshCandidates: async () => [{ telephony_session_id: "s-w" } as never],
    enqueueRefresh: (async (candidate: { telephony_session_id: string }) => {
      enqueued.push(`refresh:${candidate.telephony_session_id}`);
      return { job_id: "j1", created: true, due_at: new Date() };
    }) as never,
    enqueueContactChange: (async () => {
      enqueued.push("contact_change");
      return [];
    }) as never,
    refreshPublish: { send: async () => undefined } as never,
  };
  const outcome = await runCaptureProjectionJob(String(job._id), deps);
  assert.equal(outcome.status, "completed");
  assert.ok(mutation, "completion runs through completeCsiJob's mutation");
  await withAuditModelFence(() => mutation!(fakeSession));
  assert.deepEqual(enqueued, ["refresh:s-w", "contact_change"], "the business writes inside the completion transaction are intact");
});

test("call log refresh completion stores only the bounded result on the job row and inserts no audit row", async () => {
  const job = { _id: new mongoose.Types.ObjectId(), lease_epoch: 1, attempts: 1, subject_key: "webhook_receipt:none", input_refs: [] };
  let mutation: ((session: mongoose.ClientSession) => Promise<unknown>) | null = null;
  let stored: unknown = null;
  const deps: CallLogRefreshDeps = {
    owner: "worker-b",
    now: () => new Date("2026-10-07T03:00:00.000Z"),
    claim: (async () => job) as never,
    complete: (async (_lease: unknown, m: (session: mongoose.ClientSession) => Promise<unknown>, options: { result: unknown }) => {
      mutation = m;
      stored = options.result;
    }) as never,
    fail: (async () => undefined) as never,
  };
  const outcome = await runCallLogRefreshJob(String(job._id), deps);
  assert.equal(outcome.status, "completed");
  assert.ok(outcome.status === "completed");
  assert.equal(outcome.result.error_code, "session_missing");
  assert.deepEqual(stored, outcome.result, "the result is on the job row");
  assert.ok(mutation);
  await withAuditModelFence(() => mutation!(fakeSession));
});

test("source fence: persistInteraction, captureProjectionWorker and callLogRefresh import no audit writer and name no worker audit kind", () => {
  for (const file of ["persistInteraction.ts", "captureProjectionWorker.ts", "callLogRefresh.ts"]) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.equal(source.includes("appendCsiAudit"), false, `${file} imports appendCsiAudit`);
    for (const kind of WORKER_AUDIT_KINDS) assert.equal(source.includes(`"${kind}"`), false, `${file} still names ${kind}`);
  }
});
