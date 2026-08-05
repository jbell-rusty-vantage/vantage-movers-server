import { randomUUID } from "node:crypto";
import { send } from "@vercel/queue";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import { GranotAutomationRun } from "../../models/GranotAutomationRun";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import {
  findAgentByGranotCrmUsername,
  normalizeGranotCrmUsername,
} from "../agents/receiverAgentCrmUsername";
import { updateFormLead } from "../leads/formLead.service";
import {
  MongoLeaseStore,
  assertChecksum,
  computeChecksum,
  type DurableActor,
  type LeaseToken,
} from "../durableWork";
import {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
} from "../enrichment";
import {
  previewBookedCallLeadReconciliation,
  syncBookedCallLeadReconciliation,
} from "../reconciliation";
import {
  buildGranotOperationPayloads,
  collectGranotReport,
  GranotCollectorError,
  type GranotCollectionRequest,
} from "./index";
import {
  planGranotFormWorkflow,
  type GranotFormPlan,
  type GranotFormPlanAction,
} from "./formWorkflow";

export const GRANOT_AUTOMATION_TOPIC = "granot-automation-events";
const LEASE_SCOPE = "granot:automation:account";
// The collector permits 50 sequential sources, one complete session retry,
// and 20 seconds per request. This covers the worst supported planning run;
// apply additionally renews before every mutation.
const LEASE_TTL_MS = 45 * 60_000;
const PLAN_TTL_MS = 24 * 60 * 60_000;

export type GranotOperation = "form_leads" | "call_leads";
export type GranotWorkflow = "preview" | "apply";
export type GranotRunRequest = Omit<GranotCollectionRequest, "credentials"> & {
  operation: GranotOperation;
  workflow: GranotWorkflow;
  initiator: DurableActor;
};

type CallPlanAction = {
  action_id: string;
  operation: "enrichment" | "booked_reconciliation";
  row: Record<string, unknown>;
  preview: Record<string, unknown>;
  syncable: boolean;
  target_binding: CallTargetBinding;
};

type CallTargetBinding = {
  call_lead_id: string | null;
  call_lead_updated_at: string | null;
  booking_id: string | null;
  booking_updated_at: string | null;
  receiver_username: string | null;
  expected_receiver_agent: string | null;
  target_receiver_agent: string | null;
};

type CallPlan = {
  kind: "call_leads";
  schema_version: 1;
  actions: CallPlanAction[];
  counters: Record<string, number>;
};

type GranotPlan = GranotFormPlan | CallPlan;

export async function createGranotRun(
  request: GranotRunRequest,
): Promise<{ run_id: string; status: "queued"; queue_published: boolean }> {
  await connectMongo();
  const now = new Date();
  const run = await GranotAutomationRun.create({
    operation: request.operation,
    workflow: request.workflow,
    status: "queued",
    request_snapshot: {
      dateWindow: request.dateWindow,
      sourceLabels: request.sourceLabels,
      filters: request.filters ?? {},
    },
    initiator: request.initiator,
    expires_at: new Date(now.getTime() + PLAN_TTL_MS),
    purge_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    last_attempt_at: now,
  });
  const runId = String(run._id);
  return {
    run_id: runId,
    status: "queued",
    queue_published: await publishGranotWakeup(runId, "create"),
  };
}

export async function approveGranotRun(input: {
  run_id: string;
  plan_checksum: string;
  selected_action_ids: string[];
  approved_by: DurableActor;
}): Promise<{ approved: boolean }> {
  await connectMongo();
  if (!granotApplyEnabled()) {
    throw new GranotRunConflict("APPLY_DISABLED", "GRANOT_AUTOMATION_APPLY_ENABLED must be true before apply.");
  }
  const now = new Date();
  const run = await GranotAutomationRun.findOne({
    _id: input.run_id,
    status: "awaiting_approval",
    workflow: "apply",
    plan_checksum: input.plan_checksum.toLowerCase(),
    expires_at: { $gt: now },
  })
    .lean()
    .exec();
  if (!run || !run.plan_snapshot) {
    throw new GranotRunConflict(
      "RUN_NOT_APPROVABLE",
      "Run is expired, not awaiting approval, or checksum does not match.",
    );
  }
  const plan = run.plan_snapshot as unknown as GranotPlan;
  assertPlanChecksum(plan, input.plan_checksum);
  assertUniqueActionIds(plan);
  const validIds = new Set(
    plan.actions
      .filter(isApprovableAction)
      .map((action) => action.action_id),
  );
  const selected = [...new Set(input.selected_action_ids)];
  if (selected.some((id) => !validIds.has(id))) {
    throw new GranotRunConflict("UNKNOWN_ACTION", "One or more selected actions are not in the immutable plan.");
  }
  const approved = await GranotAutomationRun.updateOne(
    {
      _id: input.run_id,
      status: "awaiting_approval",
      plan_checksum: input.plan_checksum.toLowerCase(),
      expires_at: { $gt: now },
    },
    {
      $set: {
        status: "applying",
        lease_owner: null,
        leased_until: null,
        lease_epoch: 0,
        approval: {
          approved_at: now,
          approved_by: input.approved_by,
          selected_action_ids: selected,
          plan_checksum: input.plan_checksum.toLowerCase(),
        },
      },
    },
  ).exec();
  if (approved.modifiedCount !== 1) {
    throw new GranotRunConflict("APPROVAL_RACE", "Run approval state changed; reload and retry.");
  }
  await publishGranotWakeup(input.run_id, "approval");
  return { approved: true };
}

export async function runGranotWorker(): Promise<{
  claimed: boolean;
  run_id?: string;
  status?: string;
}> {
  await connectMongo();
  const now = new Date();
  const owner = `granot-worker:${randomUUID()}`;
  const leaseStore = new MongoLeaseStore(SheetSyncLease);
  const lease = await leaseStore.acquire({
    scope: LEASE_SCOPE,
    owner,
    ttl_ms: LEASE_TTL_MS,
    now,
  });
  if (!lease) return { claimed: false, status: "lease_busy" };
  let runId: string | undefined;
  try {
    await GranotAutomationRun.updateMany(
      {
        status: "awaiting_approval",
        expires_at: { $lte: now },
      },
      { $set: { status: "expired", completed_at: now } },
    ).exec();
    const run = await GranotAutomationRun.findOneAndUpdate(
      {
        $or: [
          { status: "queued" },
          { status: "applying" },
          {
            status: "planning",
            $or: [
              { leased_until: { $lte: now } },
              { leased_until: null },
              { leased_until: { $exists: false } },
            ],
          },
        ],
      },
      {
        $set: {
          lease_owner: lease.owner,
          leased_until: lease.leased_until,
          lease_epoch: lease.epoch,
          started_at: now,
          last_attempt_at: now,
        },
        $inc: { attempt_count: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    )
      .lean()
      .exec();
    if (!run) return { claimed: false };
    runId = String(run._id);
    if (run.status === "applying") {
      const status = await applyRun(runId, lease);
      return { claimed: true, run_id: runId, status };
    }
    const status = await planRun(runId, lease);
    return { claimed: true, run_id: runId, status };
  } catch (error) {
    if (runId) await failRun(runId, lease, error);
    throw error;
  } finally {
    await leaseStore.release({ token: lease, now: new Date() });
  }
}

async function planRun(runId: string, lease: LeaseToken): Promise<string> {
  const run = await GranotAutomationRun.findOneAndUpdate(
    fenced(runId, lease, ["queued", "planning"]),
    {
      $set: {
        status: "planning",
        checkpoint: checkpoint("collect", 0),
      },
    },
    { returnDocument: "after" },
  )
    .lean()
    .exec();
  if (!run) throw new Error("Granot run lost its fenced lease before planning.");
  const request = run.request_snapshot as unknown as Omit<
    GranotCollectionRequest,
    "credentials"
  >;
  let sourceIndex = 0;
  const collection = await collectGranotReport({
    ...request,
    credentials: readCredentials(),
  }, {
    beforeSource: async () => {
      await renewRunLease(runId, lease, "planning");
      sourceIndex += 1;
      await GranotAutomationRun.updateOne(
        fenced(runId, lease, ["planning"]),
        { $set: { checkpoint: checkpoint("collect", sourceIndex) } },
      ).exec();
    },
  });
  let plannedRows = 0;
  const beforeRow = async () => {
    await renewRunLease(runId, lease, "planning");
    plannedRows += 1;
    await GranotAutomationRun.updateOne(
      fenced(runId, lease, ["planning"]),
      { $set: { checkpoint: checkpoint("plan", plannedRows) } },
    ).exec();
  };
  const plan =
    run.operation === "form_leads"
      ? await planGranotFormWorkflow(collection.sources, { beforeRow })
      : await planCallWorkflow(collection.sources, beforeRow);
  assertUniqueActionIds(plan);
  const checksum = planChecksum(plan);
  const finalStatus =
    run.workflow === "apply" && plan.actions.some(isApprovableAction)
      ? "awaiting_approval"
      : "completed";
  const locked = await GranotAutomationRun.updateOne(
    {
      ...fenced(runId, lease, ["planning"]),
      plan_locked_at: null,
      expires_at: { $gt: new Date() },
    },
    {
      $set: {
        status: finalStatus,
        plan_snapshot: plan,
        plan_checksum: checksum,
        plan_locked_at: new Date(),
        collection_summary: summarizeCollection(collection),
        counters: plan.counters,
        checkpoint: checkpoint("planned", plan.actions.length),
        ...(finalStatus === "completed" ? { completed_at: new Date() } : {}),
      },
    },
  ).exec();
  if (locked.modifiedCount !== 1) {
    throw new Error("Granot immutable plan lock was rejected.");
  }
  return finalStatus;
}

async function planCallWorkflow(
  sources: Parameters<typeof buildGranotOperationPayloads>[0],
  beforeRow: () => Promise<void>,
): Promise<CallPlan> {
  const payloads = buildGranotOperationPayloads(sources);
  const actions: CallPlanAction[] = [];
  for (const row of payloads.enrichmentRows) {
    await beforeRow();
    const [preview] = await previewCallLeadEnrichment({ rows: [row] });
    const targetBinding = await buildCallTargetBinding(row, preview);
    actions.push({
      action_id: `enrichment:${row.row_id}`,
      operation: "enrichment",
      row,
      preview: preview as unknown as Record<string, unknown>,
      syncable:
        preview?.status === "updateable" ||
        Boolean(targetBinding.target_receiver_agent),
      target_binding: targetBinding,
    });
  }
  for (const row of payloads.bookedReconciliationRows) {
    await beforeRow();
    const [preview] = await previewBookedCallLeadReconciliation({ rows: [row] });
    const targetBinding = await buildCallTargetBinding(row, preview);
    actions.push({
      action_id: `booked_reconciliation:${row.row_id}`,
      operation: "booked_reconciliation",
      row,
      preview: preview as unknown as Record<string, unknown>,
      syncable:
        preview?.status === "updateable" ||
        Boolean(targetBinding.target_receiver_agent),
      target_binding: targetBinding,
    });
  }
  return {
    kind: "call_leads",
    schema_version: 1,
    actions,
    counters: actions.reduce<Record<string, number>>((counts, action) => {
      const status = String(action.preview.status ?? "unknown");
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

async function applyRun(runId: string, lease: LeaseToken): Promise<string> {
  if (!granotApplyEnabled()) {
    throw new GranotRunConflict("APPLY_DISABLED", "Granot apply deployment gate is disabled.");
  }
  const run = await GranotAutomationRun.findOne({
    ...fenced(runId, lease, ["applying"]),
    expires_at: { $gt: new Date() },
  })
    .lean()
    .exec();
  if (!run || !run.plan_snapshot || !run.plan_checksum || !run.approval) {
    throw new GranotRunConflict("RUN_EXPIRED_OR_DRIFTED", "Approved Granot run expired or lost its immutable plan.");
  }
  const plan = run.plan_snapshot as unknown as GranotPlan;
  assertPlanChecksum(plan, run.plan_checksum);
  const approval = run.approval as unknown as {
    selected_action_ids: string[];
    plan_checksum: string;
  };
  if (approval.plan_checksum !== run.plan_checksum) {
    throw new GranotRunConflict("CHECKSUM_DRIFT", "Approval checksum no longer matches the immutable plan.");
  }
  const selected = new Set(approval.selected_action_ids);
  const storedReceipts = run.receipts as Array<{
    action_id?: string;
    outcome?: string;
  }>;
  const priorReceipts = new Set(
    storedReceipts.map((receipt) => receipt.action_id),
  );
  let completed = priorReceipts.size;
  let failures = storedReceipts.filter(
    ({ outcome }) => outcome === "failed" || outcome === "drift",
  ).length;
  for (const action of plan.actions) {
    if (!selected.has(action.action_id) || priorReceipts.has(action.action_id)) continue;
    await renewRunLease(runId, lease, "applying");
    const receipt =
      plan.kind === "form_leads"
        ? await applyFormAction(action as GranotFormPlanAction)
        : await applyCallAction(action as CallPlanAction);
    if (receipt.outcome === "drift" || receipt.outcome === "failed") failures += 1;
    completed += 1;
    const saved = await GranotAutomationRun.updateOne(
      fenced(runId, lease, ["applying"]),
      {
        $push: { receipts: receipt },
        $set: { checkpoint: checkpoint("apply", completed) },
      },
    ).exec();
    if (saved.modifiedCount !== 1) throw new Error("Granot apply checkpoint lost its fenced lease.");
    priorReceipts.add(action.action_id);
  }
  const status = failures > 0 ? "completed_with_errors" : "completed";
  const finished = await GranotAutomationRun.updateOne(
    fenced(runId, lease, ["applying"]),
    {
      $set: {
        status,
        completed_at: new Date(),
        checkpoint: checkpoint("completed", completed),
      },
    },
  ).exec();
  if (finished.modifiedCount !== 1) throw new Error("Granot completion lost its fenced lease.");
  return status;
}

async function applyFormAction(action: GranotFormPlanAction) {
  if (action.classification !== "update" || !action.lead_id || !action.patch) {
    return receipt(action.action_id, "skipped");
  }
  const FormLead = getFormLeadModel();
  const expected = Object.fromEntries(
    Object.entries(action.expected ?? {}).map(([path, value]) => [
      path,
      value === null ? { $in: [null, ""] } : value,
    ]),
  );
  const {
    receiver_agent_name_snapshot: _receiverName,
    receiver_agent_set_at: _receiverSetAt,
    ...canonicalPatch
  } = action.patch;
  const stillCurrent = await FormLead.exists({
    _id: action.lead_id,
    duplicate: { $ne: true },
    ...expected,
  });
  if (stillCurrent) {
    try {
      await updateFormLead(action.lead_id, canonicalPatch as never, {
        expected: {
          duplicate: { $ne: true },
          ...expected,
        },
      });
      return receipt(action.action_id, "applied");
    } catch {
      const appliedAfterRace = await FormLead.exists({
        _id: action.lead_id,
        duplicate: { $ne: true },
        ...canonicalPatch,
      });
      return receipt(
        action.action_id,
        appliedAfterRace ? "already_applied" : "drift",
      );
    }
  }
  const alreadyApplied = await FormLead.exists({
    _id: action.lead_id,
    duplicate: { $ne: true },
    ...canonicalPatch,
  });
  return receipt(action.action_id, alreadyApplied ? "already_applied" : "drift");
}

async function applyCallAction(action: CallPlanAction) {
  try {
    if (!action.syncable) {
      return receipt(action.action_id, "skipped");
    }
    const currentPreview =
      action.operation === "enrichment"
        ? (await previewCallLeadEnrichment({ rows: [action.row as never] }))[0]
        : (await previewBookedCallLeadReconciliation({
            rows: [action.row as never],
          }))[0];
    const currentBinding = await buildCallTargetBinding(
      action.row,
      currentPreview,
    );
    if (callActionAlreadyApplied(action, currentPreview, currentBinding)) {
      return receipt(action.action_id, "already_applied");
    }
    if (
      JSON.stringify(callPreviewBinding(currentPreview)) !==
        JSON.stringify(callPreviewBinding(action.preview)) ||
      JSON.stringify(currentBinding) !== JSON.stringify(action.target_binding)
    ) {
      return receipt(action.action_id, "drift");
    }
    const [result] =
      action.operation === "enrichment"
        ? await syncCallLeadEnrichment(
            { rows: [action.row as never] },
            {
              expectedCallLeadId: action.target_binding.call_lead_id,
              expectedUpdatedAt: action.target_binding.call_lead_updated_at,
              expectedReceiverAgent:
                action.target_binding.expected_receiver_agent,
              targetReceiverAgent:
                action.target_binding.target_receiver_agent,
            },
          )
        : await syncBookedCallLeadReconciliation(
            { rows: [action.row as never] },
            {
              expectedCallLeadId: action.target_binding.call_lead_id,
              expectedCallLeadUpdatedAt:
                action.target_binding.call_lead_updated_at,
              expectedBookingId: action.target_binding.booking_id,
              expectedBookingUpdatedAt:
                action.target_binding.booking_updated_at,
              expectedReceiverAgent:
                action.target_binding.expected_receiver_agent,
              targetReceiverAgent:
                action.target_binding.target_receiver_agent,
            },
          );
    return receipt(action.action_id, String(result?.status ?? "failed"));
  } catch {
    return receipt(action.action_id, "failed");
  }
}

async function buildCallTargetBinding(
  row: { granot_crm_username?: string },
  preview: unknown,
): Promise<CallTargetBinding> {
  const value =
    preview && typeof preview === "object"
      ? (preview as Record<string, unknown>)
      : {};
  const callLeadId =
    typeof value.call_lead_id === "string" ? value.call_lead_id : null;
  const bookingId =
    typeof value.booking_id === "string" ? value.booking_id : null;
  const lead = callLeadId
    ? ((await getCallLeadModel()
        .findById(callLeadId)
        .select("_id receiver_agent updatedAt")
        .lean()
        .exec()) as {
        receiver_agent?: unknown;
        updatedAt?: Date;
      } | null)
    : null;
  const booking = bookingId
    ? ((await BookedLead.findById(bookingId)
        .select("_id updatedAt")
        .lean()
        .exec()) as { updatedAt?: Date } | null)
    : null;
  const username = normalizeGranotCrmUsername(row.granot_crm_username);
  const expectedReceiver = lead?.receiver_agent
    ? String(lead.receiver_agent)
    : null;
  const receiverAgent =
    username && lead && !expectedReceiver
      ? await findAgentByGranotCrmUsername(username)
      : undefined;
  return {
    call_lead_id: callLeadId,
    call_lead_updated_at: dateString(lead?.updatedAt),
    booking_id: bookingId,
    booking_updated_at: dateString(booking?.updatedAt),
    receiver_username: username || null,
    expected_receiver_agent: expectedReceiver,
    target_receiver_agent: receiverAgent?.id ?? null,
  };
}

function callActionAlreadyApplied(
  action: CallPlanAction,
  currentPreview: unknown,
  currentBinding: CallTargetBinding,
): boolean {
  const before = callPreviewBinding(action.preview);
  const after = callPreviewBinding(currentPreview);
  const sameTargets =
    before.call_lead_id === after.call_lead_id &&
    before.booking_id === after.booking_id;
  if (!sameTargets || after.status !== "unchanged") return false;
  if (before.status === "updateable") return true;
  return Boolean(
    action.target_binding.target_receiver_agent &&
      currentBinding.expected_receiver_agent ===
        action.target_binding.target_receiver_agent,
  );
}

function dateString(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function renewRunLease(
  runId: string,
  lease: LeaseToken,
  status: "planning" | "applying",
): Promise<void> {
  const now = new Date();
  const leaseStore = new MongoLeaseStore(SheetSyncLease);
  const renewed = await leaseStore.renew({
    token: lease,
    ttl_ms: LEASE_TTL_MS,
    now,
  });
  if (!renewed) {
    throw new GranotRunConflict(
      "LEASE_LOST",
      "Granot automation lease was lost while processing a run.",
    );
  }
  const updated = await GranotAutomationRun.updateOne(
    {
      _id: runId,
      status,
      lease_owner: lease.owner,
      lease_epoch: lease.epoch,
      leased_until: { $gt: now },
    },
    { $set: { leased_until: renewed.leased_until } },
  ).exec();
  if (updated.modifiedCount !== 1) {
    throw new GranotRunConflict(
      "RUN_LEASE_LOST",
      "Granot run lease was lost while processing a run.",
    );
  }
  lease.leased_until = renewed.leased_until;
}

function callPreviewBinding(preview: unknown): Record<string, unknown> {
  const value =
    preview && typeof preview === "object"
      ? (preview as Record<string, unknown>)
      : {};
  return {
    status: value.status ?? null,
    call_lead_id: value.call_lead_id ?? null,
    booking_id: value.booking_id ?? null,
    match_method: value.match_method ?? null,
    has_booking: value.has_booking ?? null,
    changes: Array.isArray(value.changes) ? [...value.changes].sort() : [],
  };
}

function isApprovableAction(action: GranotPlan["actions"][number]): boolean {
  return "classification" in action
    ? action.classification === "update"
    : action.syncable;
}

function assertUniqueActionIds(plan: GranotPlan): void {
  const ids = new Set<string>();
  for (const action of plan.actions) {
    if (ids.has(action.action_id)) {
      throw new GranotRunConflict(
        "DUPLICATE_ACTION_ID",
        "Granot plan contains duplicate action identities.",
      );
    }
    ids.add(action.action_id);
  }
}

export async function getGranotRun(
  runId: string,
  includeDetails = false,
): Promise<Record<string, unknown> | null> {
  await connectMongo();
  const run = await GranotAutomationRun.findById(runId).lean().exec();
  return run ? safeRun(run as unknown as Record<string, unknown>, includeDetails) : null;
}

export async function listGranotRuns(limit = 25): Promise<Record<string, unknown>[]> {
  await connectMongo();
  const runs = await GranotAutomationRun.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean()
    .exec();
  return runs.map((run) => safeRun(run as unknown as Record<string, unknown>, false));
}

export async function recoverGranotRuns(): Promise<{
  recoverable: boolean;
  queue_published: boolean;
}> {
  await connectMongo();
  const exists = await GranotAutomationRun.exists({
    $or: [
      { status: "queued" },
      {
        status: { $in: ["planning", "applying"] },
        $or: [
          { leased_until: { $lte: new Date() } },
          { leased_until: null },
          { leased_until: { $exists: false } },
        ],
      },
    ],
  });
  return {
    recoverable: Boolean(exists),
    queue_published: exists ? await publishGranotWakeup(String(exists._id), "recovery") : false,
  };
}

export async function publishGranotWakeup(
  runId: string,
  reason: "create" | "approval" | "recovery",
): Promise<boolean> {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production") return false;
  try {
    const idempotencyKey =
      reason === "recovery"
        ? `granot:${reason}:${runId}:${Math.floor(Date.now() / (5 * 60_000))}`
        : `granot:${reason}:${runId}`;
    await send(
      GRANOT_AUTOMATION_TOPIC,
      { kind: "granot_automation_wakeup", run_hint: runId, reason },
      { idempotencyKey },
    );
    return true;
  } catch (error) {
    logger.error({
      err: error,
      msg: "granot_automation.queue.publish_failed",
      runId,
      reason,
    });
    return false;
  }
}

export function granotApplyEnabled(
  value = process.env.GRANOT_AUTOMATION_APPLY_ENABLED,
): boolean {
  return value?.trim().toLowerCase() === "true";
}

function planChecksum(plan: GranotPlan): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: 1,
    payload: plan,
  });
}

function assertPlanChecksum(plan: GranotPlan, checksum: string): void {
  assertChecksum(
    {
      checksum_version: 1,
      artifact_kind: "ingestion_plan",
      schema_version: 1,
      payload: plan,
    },
    checksum,
  );
}

function fenced(
  runId: string,
  lease: LeaseToken,
  statuses: string[],
): Record<string, unknown> {
  return {
    _id: runId,
    status: { $in: statuses },
    lease_owner: lease.owner,
    lease_epoch: lease.epoch,
    leased_until: { $gt: new Date() },
  };
}

function checkpoint(phase: string, completed: number) {
  return {
    version: 1,
    phase,
    cursor: { completed },
    completed_units: completed,
    updated_at: new Date(),
  };
}

function receipt(actionId: string, outcome: string) {
  return { action_id: actionId, outcome, applied_at: new Date() };
}

function summarizeCollection(collection: Awaited<ReturnType<typeof collectGranotReport>>) {
  return {
    requestedDateWindow: collection.requestedDateWindow,
    discoveredSourceLabels: collection.discoveredSourceLabels,
    notObservedSourceLabels: collection.notObservedSourceLabels,
    sources: collection.sources.map((source) => ({
      sourceLabel: source.sourceLabel,
      contentHash: source.contentHash,
      bookedJobs: source.sections.bookedJobs.length,
      followUpEstimates: source.sections.followUpEstimates.length,
    })),
  };
}

function safeRun(run: Record<string, unknown>, details: boolean) {
  const plan = run.plan_snapshot as GranotPlan | null;
  return {
    id: String(run._id),
    operation: run.operation,
    workflow: run.workflow,
    status: run.status,
    plan_checksum: run.plan_checksum,
    expires_at: run.expires_at,
    counters: run.counters,
    collection: run.collection_summary,
    checkpoint: run.checkpoint,
    receipt_count: Array.isArray(run.receipts) ? run.receipts.length : 0,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ...(details ? { plan, receipts: run.receipts } : {}),
  };
}

function readCredentials(): GranotCollectionRequest["credentials"] {
  return {
    networkUsername: requireEnv("GRANOT_NETWORK_USERNAME", "MAIN_LOGIN_USERNAME"),
    networkPassword: requireEnv("GRANOT_NETWORK_PASSWORD", "MAIN_LOGIN_PASSWORD"),
    username: requireEnv("GRANOT_USERNAME", "SPECIFIC_USERNAME"),
    password: requireEnv("GRANOT_PASSWORD", "SPECIFIC_PASSWORD"),
  };
}

function requireEnv(primary: string, legacy: string): string {
  const value = process.env[primary]?.trim() || process.env[legacy]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${primary}`);
  return value;
}

async function failRun(runId: string, lease: LeaseToken, error: unknown): Promise<void> {
  if (
    error instanceof GranotCollectorError &&
    (error.code === "provider_error" || error.code === "invalid_session")
  ) {
    const retry = await GranotAutomationRun.updateOne(
      {
        ...fenced(runId, lease, ["queued", "planning", "applying"]),
        attempt_count: { $lt: 3 },
      },
      {
        $set: {
          status: "queued",
          lease_owner: null,
          leased_until: null,
          failure: {
            code: error.code,
            class: "provider",
            retryable: true,
            summary: "Transient Granot provider failure; retry queued.",
            phase: "worker",
          },
        },
      },
    ).exec();
    if (retry.modifiedCount === 1) return;
  }
  await GranotAutomationRun.updateOne(
    fenced(runId, lease, ["queued", "planning", "applying"]),
    {
      $set: {
        status: "failed",
        completed_at: new Date(),
        failure: {
          code:
            error instanceof GranotRunConflict ? error.code : "GRANOT_RUN_FAILED",
          class: "structural",
          retryable: false,
          summary:
            error instanceof Error ? error.message : "Granot automation failed.",
          phase: "worker",
        },
      },
    },
  ).exec();
}

export class GranotRunConflict extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GranotRunConflict";
  }
}
