import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { csiFlag, csiBackfillDays, CSI_BACKFILL_JOB_PRIORITY } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, continueCsiJob, enqueueCsiJob, failCsiJob } from "../jobs";
import { ensureInteraction, workerContext } from "../outreach/ensure";
import { enqueueDeferredDiscovery } from "./activate";
import { historicalCaptureReady, historicalAttachmentsReady } from "./readiness";
import { CALL_LOG_BACKFILL_STREAM } from "./windows";
import { backfillYieldToLiveWork } from "./livePriority";

export async function enqueueBackfillActivation(windowId: string, session: ClientSession, now: Date) {
  return enqueueCsiJob({ dedupe_key: `csi:backfill:activate:${windowId}`, stage: "backfill",
    subject_key: `window:${windowId}`, input_revision: 1, input_refs: [windowId], priority: CSI_BACKFILL_JOB_PRIORITY }, session, now);
}

/** Each transaction processes at most ten calls for one number, newest first. */
async function activationBatch(windowId: string, session: ClientSession, requestId: string) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const window = await Window.findById(windowId).session(session).orFail();
  const Interaction = getCallInteractionModel();
  let numberId = window.activation_number_id;
  if (!numberId) {
    const numbers = await Interaction.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { merged_into_id: null, sources: "backfill", started_at: { $gte: window.window_from, $lt: window.window_to },
        contact_number_id: { $ne: null, ...(window.activation_contact_cursor ? { $gt: window.activation_contact_cursor } : {}) } } },
      { $group: { _id: "$contact_number_id" } }, { $sort: { _id: 1 } }, { $limit: 1 },
    ]).session(session);
    numberId = numbers[0]?._id ?? null;
    if (!numberId) {
      await Window.updateOne({ _id: window._id }, { $set: { activation_status: "complete" } }, { session });
      return 0;
    }
  }
  if (!await historicalAttachmentsReady(String(numberId), session)) throw new CsiError("BACKFILL_ACTIVE");
  const calls = await Interaction.find({ contact_number_id: numberId, merged_into_id: null,
    started_at: { $gte: window.window_from },
    ...(window.activation_call_at ? { $or: [ { started_at: { $lt: window.activation_call_at } },
      { started_at: window.activation_call_at, _id: { $lt: window.activation_call_id } } ] } : {}),
  }).sort({ started_at: -1, _id: -1 }).limit(10).session(session);
  const context = workerContext(session, requestId);
  for (const call of calls) {
    await ensureInteraction(call, context);
    if (call.sources.includes("backfill") && call.started_at < window.window_to && call.terminal) {
      await enqueueDeferredDiscovery(call, session, context.now);
    }
  }
  const last = calls.at(-1);
  await Window.updateOne({ _id: window._id }, { $set: calls.length === 10 && last ? {
    activation_number_id: numberId, activation_call_at: last.started_at, activation_call_id: last._id,
  } : { activation_contact_cursor: numberId, activation_number_id: null, activation_call_at: null, activation_call_id: null } }, { session });
  return calls.length;
}

export async function runBackfillActivationJob(jobId?: string) {
  if (!csiFlag("ENABLED") || !csiFlag("OUTREACH_ENSURE") || csiBackfillDays() <= 0) return { status: "disabled" };
  if (await backfillYieldToLiveWork(new Date())) return { status: "live_priority" };
  const job = await claimCsiJob(`csi-backfill:${randomUUID()}`, jobId, 300_000, "backfill");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    const window = await getSalesIntelligenceSyncWindowModel().findById(job.input_refs[0]).lean();
    if (!window || window.stream !== CALL_LOG_BACKFILL_STREAM) throw new CsiError("INVALID_INPUT");
    if (window.activation_status === "complete") {
      await completeCsiJob(lease, async () => undefined);
      return { status: "completed" };
    }
    if (window.status !== "complete" || !await historicalCaptureReady(window.window_from)) {
      await failCsiJob(lease, "eligibility_pending", 60_000);
      return { status: "waiting_history" };
    }
    const activated = await continueCsiJob(lease, session => activationBatch(String(window._id), session, lease.job_id));
    return { status: "continued", activated };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    if (error instanceof CsiError && error.code === "BACKFILL_ACTIVE") {
      await failCsiJob(lease, "eligibility_pending", 60_000);
      return { status: "waiting_attachments" };
    }
    await failCsiJob(lease, "transient");
    return { status: "retry" };
  }
}

export async function drainBackfillActivationJobs(max = 20) {
  if (!csiFlag("ENABLED") || !csiFlag("OUTREACH_ENSURE") || csiBackfillDays() <= 0) return { outcomes: ["disabled"] };
  const pending = await getSalesIntelligenceSyncWindowModel().find({ stream: CALL_LOG_BACKFILL_STREAM,
    status: "complete", activation_status: "pending" }).sort({ window_from: 1 }).limit(25).lean();
  for (const window of pending) await withTransaction(session => enqueueBackfillActivation(String(window._id), session, new Date()));
  const outcomes: string[] = [], deadline = Date.now() + 40_000;
  for (let i = 0; i < max && Date.now() < deadline; i++) {
    const result = await runBackfillActivationJob(); outcomes.push(result.status);
    if (["not_claimable", "disabled", "lease_lost", "live_priority"].includes(result.status)) break;
  }
  return { outcomes };
}
