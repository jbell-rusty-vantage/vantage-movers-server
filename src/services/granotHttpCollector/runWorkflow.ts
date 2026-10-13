import { createHash, randomUUID } from "node:crypto";
import { send } from "@vercel/queue";
import { Types } from "mongoose";
import { connectMongo, withTransaction } from "../../db";
import { logger } from "../../logger";
import { GranotAutomationRun } from "../../models/GranotAutomationRun";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import {
  findAgentByGranotCrmUsername,
  normalizeGranotCrmUsername,
} from "../agents/receiverAgentCrmUsername";
import {
  MongoLeaseStore,
  assertChecksum,
  computeChecksum,
  type DurableActor,
  type LeaseToken,
} from "../durableWork";
import { previewCallLeadEnrichment } from "../enrichment";
import { previewBookedCallLeadReconciliation } from "../reconciliation";
import { GRANOT_ESTIMATES_CRON_ACTOR_ID } from "../domainCommands/types";
import { OperationIdempotencyConflictError } from "../granotLifecycle/errors";
import { applyAutomationPlanAction } from "../granotLifecycle/automationApply";
import type { GranotAutomationActionReceipt } from "../granotLifecycle/automationApply";
import {
  buildGranotOperationPayloads,
  collectGranotReport,
  GranotCollectorError,
  type GranotCollectionRequest,
  type GranotSourceCollection,
} from "./index";
import {
  collectEstimatesInProcess,
  estimatesRegistryLookup,
  partitionEstimatesSources,
  type EstimatesLabelLookup,
  type EstimatesPartition,
} from "./estimatesInProcess";
import { GranotRunConflict } from "./errors";
import { estimatesDateWindow } from "./estimatesCron";
import {
  planGranotFormWorkflow,
  type GranotFormPlan,
} from "./formWorkflow";
import {
  assertSealedAutomationPlan,
  automationRunCompletionStatus,
  isPendingAutomationActionOutcome,
  isTerminalAutomationActionOutcome,
  sealAutomationPlan,
  type GranotAutomationLifecycleApply,
} from "./lifecycleStatement";

export { GranotRunConflict } from "./errors";
import {
  GranotAutomationSourceValidationError,
  resolveGranotAutomationSources,
  type GranotAutomationSourceItem,
  type GranotSourceOperation,
} from "./sourceCatalog";

export const GRANOT_AUTOMATION_TOPIC = "granot-automation-events";
const LEASE_SCOPE = "granot:automation:account";
// The collector permits 50 sequential sources, one complete session retry,
// and 20 seconds per request. This covers the worst supported planning run;
// apply additionally renews before every mutation.
const LEASE_TTL_MS = 45 * 60_000;
const PLAN_TTL_MS = 24 * 60 * 60_000;

export type GranotLeadOperation = "form_leads" | "call_leads";
export type GranotOperation = GranotLeadOperation | "estimates_in_process";
export type GranotWorkflow = "preview" | "apply";
export type GranotRunRequest = Omit<GranotCollectionRequest, "credentials"> & {
  operation: GranotOperation;
  workflow: GranotWorkflow;
  initiator: DurableActor;
  sourceIds?: string[];
  /**
   * Estimates cron creates this flag; reviewed Owner promotion also stores it.
   * Cron plans and approves every approvable action as the system
   * actor, and applies in the same lease. Owner approval stays on every other run.
   */
  autoApply?: boolean;
  /** Cron retry identity, scoped to an Estimates date and New York hour. */
  scheduledSlotKey?: string;
};
export type GranotRunGroupRequest = {
  operations: GranotLeadOperation[];
  workflow: GranotWorkflow;
  dateWindow: GranotCollectionRequest["dateWindow"];
  sourceIds: string[];
  filters?: GranotCollectionRequest["filters"];
  initiator: DurableActor;
};
type QueuedGranotRun = ReturnType<typeof buildQueuedRun>;
type InsertedGranotRun = QueuedGranotRun & { _id: unknown };
export type GranotRunGroupRuntime = {
  resolveSources: (input: {
    sourceIds: string[];
    operations: GranotSourceOperation[];
  }) => Promise<Map<GranotSourceOperation, GranotAutomationSourceItem[]>>;
  insertRuns: (documents: QueuedGranotRun[]) => Promise<InsertedGranotRun[]>;
  publishWakeup: (runId: string) => Promise<boolean>;
};

type CallPlanAction = {
  action_id: string;
  operation: "enrichment" | "booked_reconciliation";
  row: Record<string, unknown>;
  preview: Record<string, unknown>;
  syncable: boolean;
  target_binding: CallTargetBinding;
  lifecycle_apply?: GranotAutomationLifecycleApply;
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
  schema_version: 1 | 2;
  actions: CallPlanAction[];
  counters: Record<string, number>;
};

export type EstimatesPlan = {
  kind: "estimates_in_process";
  schema_version: 2;
  actions: Array<GranotFormPlan["actions"][number] | CallPlanAction>;
  counters: Record<string, number>;
};

type GranotPlan = GranotFormPlan | CallPlan | EstimatesPlan;


export async function createGranotRun(
  request: GranotRunRequest,
): Promise<{ run_id: string; status: "queued"; queue_published: boolean }> {
  await connectMongo();
  let sourceLabels = request.sourceLabels;
  let sourceIds = request.sourceIds ?? [];
  if (request.operation === "estimates_in_process") {
    if ((request.sourceIds?.length ?? 0) > 0 || request.sourceLabels.length > 0) {
      throw new GranotAutomationSourceValidationError(
        "Estimates in Process does not take a source list.",
        [{
          path: ["source_ids"],
          message: "omit source_ids and source_labels",
        }],
      );
    }
    sourceLabels = [];
    sourceIds = [];
  } else if (request.sourceIds) {
    const partitions = await resolveGranotAutomationSources({
      sourceIds: request.sourceIds,
      operations: [request.operation],
    });
    const sources = partitions.get(request.operation) ?? [];
    sourceLabels = sources.map((source) => source.label);
    sourceIds = sources.map((source) => source.id);
  }
  const document = buildQueuedRun({
    operation: request.operation,
    workflow: request.workflow,
    dateWindow: request.dateWindow,
    sourceIds,
    sourceLabels,
    filters: request.filters,
    initiator: request.initiator,
    autoApply: request.autoApply,
  });
  let run;
  if (request.scheduledSlotKey) {
    if (request.operation !== "estimates_in_process" || !request.autoApply) {
      throw new GranotRunConflict("INVALID_SCHEDULED_RUN", "Only Estimates auto-apply may use a scheduled slot.");
    }
    const id = scheduledEstimatesRunId(request.scheduledSlotKey);
    // _id is already unique in Mongo: no new production index is required.
    // Both a retry and concurrent requests retain the first run and its plan.
    try {
      await GranotAutomationRun.updateOne(
        { _id: id },
        { $setOnInsert: { ...document, request_snapshot: { ...document.request_snapshot, scheduled_slot_key: request.scheduledSlotKey } } },
        { upsert: true },
      ).exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    run = { _id: id };
  } else {
    run = await GranotAutomationRun.create(document);
  }
  const runId = String(run._id);
  return {
    run_id: runId,
    status: "queued" as const,
    queue_published: await publishGranotWakeup(runId, "create"),
  };
}

export function scheduledEstimatesRunId(slotKey: string): Types.ObjectId {
  return new Types.ObjectId(createHash("sha256").update(`granot-estimates-slot-v1:${slotKey}`).digest("hex").slice(0, 24));
}

export async function createGranotRunGroup(
  request: GranotRunGroupRequest,
  runtime: GranotRunGroupRuntime = defaultGranotRunGroupRuntime,
): Promise<{
  run_group_id: string;
  runs: Array<{
    run_id: string;
    operation: GranotOperation;
    source_labels: string[];
    queue_published: boolean;
  }>;
}> {
  if (
    request.operations.length < 1 ||
    request.operations.length > 2 ||
    new Set(request.operations).size !== request.operations.length
  ) {
    throw new GranotAutomationSourceValidationError(
      "Lead workflows must contain one or two unique operations.",
      [{
        path: ["operations"],
        message: "Select one or two unique Lead workflows",
      }],
    );
  }
  const operations = [...new Set(request.operations)];
  const partitions = await runtime.resolveSources({
    sourceIds: request.sourceIds,
    operations: operations as GranotSourceOperation[],
  });
  const runGroupId = randomUUID();
  const documents = operations.map((operation) => {
    const sources = partitions.get(operation) ?? [];
    return buildQueuedRun({
      operation,
      workflow: request.workflow,
      dateWindow: request.dateWindow,
      sourceIds: sources.map((source) => source.id),
      sourceLabels: sources.map((source) => source.label),
      filters: request.filters,
      initiator: request.initiator,
      runGroupId,
    });
  });

  // All compatibility validation happens above. The transaction is the
  // durable boundary: either every child run is committed or none are.
  const created = await runtime.insertRuns(documents);
  const publications = await Promise.all(
    created.map((run) => runtime.publishWakeup(String(run._id))),
  );
  return {
    run_group_id: runGroupId,
    runs: created.map((run, index) => ({
      run_id: String(run._id),
      operation: run.operation as GranotOperation,
      source_labels:
        (
          run.request_snapshot as {
            sourceLabels?: string[];
          }
        ).sourceLabels ?? [],
      queue_published: publications[index] ?? false,
    })),
  };
}

const defaultGranotRunGroupRuntime: GranotRunGroupRuntime = {
  resolveSources: resolveGranotAutomationSources,
  insertRuns: (documents) =>
    withTransaction(async (session) => {
      const inserted = await GranotAutomationRun.insertMany(documents, {
        ordered: true,
        session,
      });
      return inserted as unknown as InsertedGranotRun[];
    }),
  publishWakeup: (runId) => publishGranotWakeup(runId, "create"),
};

function buildQueuedRun(input: {
  operation: GranotOperation;
  workflow: GranotWorkflow;
  dateWindow: GranotCollectionRequest["dateWindow"];
  sourceIds: string[];
  sourceLabels: string[];
  filters?: GranotCollectionRequest["filters"];
  initiator: DurableActor;
  runGroupId?: string;
  autoApply?: boolean;
}) {
  const now = new Date();
  return {
    operation: input.operation,
    run_group_id: input.runGroupId ?? null,
    workflow: input.workflow,
    status: "queued" as const,
    request_snapshot: {
      dateWindow: input.dateWindow,
      sourceIds: input.sourceIds,
      sourceLabels: input.sourceLabels,
      filters: input.filters ?? {},
      ...(input.autoApply ? { auto_apply: true } : {}),
    },
    initiator: input.initiator,
    expires_at: new Date(now.getTime() + PLAN_TTL_MS),
    purge_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    last_attempt_at: now,
  };
}

type GranotApprovalInput = {
  run_id: string;
  plan_checksum: string;
  selected_action_ids: string[];
  approved_by: DurableActor;
};

export async function approveGranotRun(input: GranotApprovalInput): Promise<{ approved: boolean }> {
  return approveSealedRun(input, false);
}

/** Owner selection from a completed, bounded preview; no recollect or direct Lead writer. */
export async function applyReviewedEstimatesRun(input: GranotApprovalInput): Promise<{ approved: boolean }> {
  return approveSealedRun(input, true);
}

async function approveSealedRun(input: GranotApprovalInput, reviewedEstimates: boolean): Promise<{ approved: boolean }> {
  await connectMongo();
  if (!reviewedEstimates && !granotApplyEnabled()) {
    throw new GranotRunConflict("APPLY_DISABLED", "GRANOT_AUTOMATION_APPLY_ENABLED must be true before apply.");
  }
  const now = new Date();
  const stateFilter = reviewedEstimates
    ? { operation: "estimates_in_process", status: "completed", workflow: "preview" } as const
    : { status: "awaiting_approval", workflow: "apply" } as const;
  const run = await GranotAutomationRun.findOne({
    _id: input.run_id,
    ...stateFilter,
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
  if (reviewedEstimates) {
    assertReviewedEstimatesWindow((run.request_snapshot as { dateWindow?: unknown }).dateWindow, now);
    if (run.approval || run.receipts.length > 0) {
      throw new GranotRunConflict("RUN_NOT_APPROVABLE", "Reviewed preview already has apply state.");
    }
  }
  const plan = run.plan_snapshot as unknown as GranotPlan;
  assertSealedAutomationPlan(plan);
  assertPlanChecksum(plan, input.plan_checksum);
  assertUniqueActionIds(plan);
  const validIds = new Set(
    plan.actions
      .filter(isApprovableAction)
      .map((action) => action.action_id),
  );
  const selected = [...new Set(input.selected_action_ids)];
  if (selected.length === 0 || selected.some((id) => !validIds.has(id))) {
    throw new GranotRunConflict("UNKNOWN_ACTION", "One or more selected actions are not in the immutable plan.");
  }
  const approved = await GranotAutomationRun.updateOne(
    {
      _id: input.run_id,
      ...stateFilter,
      plan_checksum: input.plan_checksum.toLowerCase(),
      expires_at: { $gt: now },
    },
    {
      $set: {
        status: "applying",
        ...(reviewedEstimates ? { workflow: "apply", "request_snapshot.auto_apply": true, completed_at: null } : {}),
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

/** At most 90 inclusive Open Dates, with no future dates, through the reviewed path. */
export function assertReviewedEstimatesWindow(value: unknown, now: Date): void {
  const window = value as { from?: unknown; to?: unknown } | null;
  const parse = (input: unknown) => {
    if (typeof input !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return NaN;
    const [month, day, year] = input.split("/").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day ? +date : NaN;
  };
  const from = parse(window?.from);
  const to = parse(window?.to);
  const today = parse(estimatesDateWindow(now).to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to > today || to - from > 89 * 86_400_000) {
    throw new GranotRunConflict("INVALID_BACKFILL_WINDOW", "Reviewed Estimates apply requires 1–90 inclusive calendar dates ending no later than today in New York.");
  }
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
    // Approved work takes precedence over new planning so an owner does not
    // wait behind a large sibling plan after explicitly approving a checksum.
    const run =
      (await claimGranotRun({ status: "applying" }, lease, now)) ??
      (await claimGranotRun(
        {
          $or: [
            { status: "queued" },
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
        lease,
        now,
      ));
    if (!run) return { claimed: false };
    runId = String(run._id);
    if (run.status === "applying") {
      const status = await applyRun(runId, lease);
      return { claimed: true, run_id: runId, status };
    }
    const plannedStatus = await planRun(runId, lease);
    if (plannedStatus === "applying") {
      const status = await applyRun(runId, lease);
      return { claimed: true, run_id: runId, status };
    }
    return { claimed: true, run_id: runId, status: plannedStatus };
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
  > & { auto_apply?: boolean };
  let sourceIndex = 0;
  let plannedRows = 0;
  const beforeRow = async () => {
    await renewRunLease(runId, lease, "planning");
    plannedRows += 1;
    await GranotAutomationRun.updateOne(
      fenced(runId, lease, ["planning"]),
      { $set: { checkpoint: checkpoint("plan", plannedRows) } },
    ).exec();
  };
  const planned = await planOperation(run.operation, request, runId, lease, beforeRow);
  const plan = planned.plan;
  assertUniqueActionIds(plan);
  const checksum = planChecksum(plan);
  const autoApply =
    run.operation === "estimates_in_process" && request.auto_apply === true;
  const approvableIds = plan.actions
    .filter(isApprovableAction)
    .map((action) => action.action_id);
  const finalStatus = autoApply
    ? approvableIds.length > 0
      ? "applying"
      : "completed"
    : run.workflow === "apply" && approvableIds.length > 0
      ? "awaiting_approval"
      : "completed";
  const approvedAt = new Date();
  const locked = await GranotAutomationRun.updateOne(
    {
      ...fenced(runId, lease, ["planning"]),
      plan_locked_at: null,
      expires_at: { $gt: approvedAt },
    },
    {
      $set: {
        status: finalStatus,
        plan_snapshot: plan,
        plan_checksum: checksum,
        plan_locked_at: approvedAt,
        collection_summary: planned.collection_summary,
        counters: plan.counters,
        checkpoint: checkpoint("planned", plan.actions.length),
        ...(finalStatus === "completed" ? { completed_at: approvedAt } : {}),
        ...(finalStatus === "applying" && autoApply
          ? {
              approval: {
                approved_at: approvedAt,
                approved_by: estimatesCronActor(runId),
                selected_action_ids: approvableIds,
                plan_checksum: checksum,
              },
            }
          : {}),
      },
    },
  ).exec();
  if (locked.modifiedCount !== 1) {
    throw new Error("Granot immutable plan lock was rejected.");
  }
  return finalStatus;
}

async function planOperation(
  operation: string,
  request: Omit<GranotCollectionRequest, "credentials">,
  runId: string,
  lease: LeaseToken,
  beforeRow: () => Promise<void>,
): Promise<{ plan: GranotPlan; collection_summary: ReturnType<typeof summarizeCollection> }> {
  if (operation === "estimates_in_process") {
    const sources = await collectEstimatesInProcess({
      dateWindow: request.dateWindow,
      credentials: readCredentials(),
    });
    const plan = await assembleEstimatesPlan(sources, { runId, beforeRow });
    return {
      plan,
      collection_summary: summarizeEstimateSources(request.dateWindow, sources),
    };
  }
  let sourceIndex = 0;
  const collection = await collectGranotReport(
    {
      ...request,
      credentials: readCredentials(),
    },
    {
      beforeSource: async () => {
        await renewRunLease(runId, lease, "planning");
        sourceIndex += 1;
        await GranotAutomationRun.updateOne(
          fenced(runId, lease, ["planning"]),
          { $set: { checkpoint: checkpoint("collect", sourceIndex) } },
        ).exec();
      },
    },
  );
  const planned =
    operation === "form_leads"
      ? await planGranotFormWorkflow(collection.sources, { beforeRow })
      : await planCallWorkflow(collection.sources, beforeRow);
  return {
    plan: sealAutomationPlan(planned, runId, collection.sources),
    collection_summary: summarizeCollection(collection),
  };
}

/**
 * Partition Estimates rows by Registry route, seal each side with the planner
 * it already uses, and merge the sealed actions onto one run plan.
 */
export async function assembleEstimatesPlan(
  sources: GranotSourceCollection[],
  input: {
    runId: string;
    beforeRow?: () => Promise<void>;
    lookup?: EstimatesLabelLookup;
    planForm?: typeof planGranotFormWorkflow;
    planCall?: typeof planCallWorkflow;
  },
): Promise<EstimatesPlan> {
  const beforeRow = input.beforeRow ?? (async () => undefined);
  const partition = await partitionEstimatesSources(
    sources,
    input.lookup ?? estimatesRegistryLookup(),
  );
  const planForm = input.planForm ?? planGranotFormWorkflow;
  const planCall = input.planCall ?? planCallWorkflow;
  const formPlan = await planForm(partition.form, { beforeRow });
  const callPlan = await planCall(partition.call, beforeRow);
  for (const entry of partition.unresolved) {
    for (const _row of entry.source.sections.followUpEstimates) {
      await beforeRow();
    }
  }
  const unresolvedPlan = unresolvedEstimatesPlan(partition.unresolved);
  const sealedForm = sealAutomationPlan(formPlan, input.runId, partition.form);
  const sealedCall = sealAutomationPlan(callPlan, input.runId, partition.call);
  const sealedUnresolved = sealAutomationPlan(
    unresolvedPlan,
    input.runId,
    partition.unresolved.map((entry) => entry.source),
  );
  // The legacy preview patches do not include Granot priority, job attachment on
  // Forms, or replacing a call-inferred receiver. A matched "unchanged" row
  // still needs the canonical lifecycle decision for this snapshot.
  for (const action of sealedForm.actions) {
    if (action.classification === "unchanged" && action.lead_id && hasEstimatesPriority(action)) {
      action.classification = "update";
      action.reason = "lifecycle_snapshot_check";
      sealedForm.counters.unchanged -= 1;
      sealedForm.counters.update += 1;
    }
  }
  for (const action of sealedCall.actions) {
    if (action.preview.status === "unchanged" && action.target_binding.call_lead_id && hasEstimatesPriority(action)) {
      action.syncable = true;
    }
  }
  return {
    kind: "estimates_in_process",
    schema_version: 2,
    actions: [
      ...sealedForm.actions,
      ...sealedCall.actions,
      ...sealedUnresolved.actions,
    ],
    counters: mergeCounters(
      sealedForm.counters,
      sealedCall.counters,
      unresolvedCounters(partition.unresolved),
    ),
  };
}

function hasEstimatesPriority(action: { lifecycle_apply?: GranotAutomationLifecycleApply }): boolean {
  return /^[0-9]$/.test(String(action.lifecycle_apply?.granot_statement.priority ?? ""));
}

function unresolvedEstimatesPlan(
  entries: EstimatesPartition["unresolved"],
): CallPlan {
  const actions: CallPlanAction[] = [];
  for (const entry of entries) {
    for (const row of entry.source.sections.followUpEstimates) {
      actions.push({
        action_id: `unresolved:${entry.source.sourceLabel}:${row.id}`,
        operation: "enrichment",
        row: {
          row_id: `${entry.source.sourceLabel}:${row.id}`,
          row_index: row.rowIndex,
        },
        preview: { status: entry.reason },
        syncable: false,
        target_binding: {
          call_lead_id: null,
          call_lead_updated_at: null,
          booking_id: null,
          booking_updated_at: null,
          receiver_username: null,
          expected_receiver_agent: null,
          target_receiver_agent: null,
        },
      });
    }
  }
  return {
    kind: "call_leads",
    schema_version: 1,
    actions,
    counters: {},
  };
}

function unresolvedCounters(
  entries: EstimatesPartition["unresolved"],
): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const entry of entries) {
    const count = entry.source.sections.followUpEstimates.length;
    counters[entry.reason] = (counters[entry.reason] ?? 0) + count;
  }
  return counters;
}

function mergeCounters(
  ...records: Array<Record<string, number>>
): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      counters[key] = (counters[key] ?? 0) + value;
    }
  }
  return counters;
}

function summarizeEstimateSources(
  dateWindow: { from: string; to: string },
  sources: GranotSourceCollection[],
): ReturnType<typeof summarizeCollection> {
  return {
    requestedDateWindow: dateWindow,
    discoveredSourceLabels: sources.map((source) => source.sourceLabel),
    notObservedSourceLabels: [],
    sources: sources.map((source) => ({
      sourceLabel: source.sourceLabel,
      contentHash: source.contentHash,
      bookedJobs: source.sections.bookedJobs.length,
      followUpEstimates: source.sections.followUpEstimates.length,
    })),
  };
}

function estimatesCronActor(runId: string): DurableActor {
  return {
    actor_type: "system",
    actor_id: GRANOT_ESTIMATES_CRON_ACTOR_ID,
    actor_label: "Estimates in Process",
    actor_role: "system",
    request_id: runId,
    origin: "vantage_admin",
  };
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
      preview: toDurableGranotValue(preview) as Record<string, unknown>,
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
      preview: toDurableGranotValue(preview) as Record<string, unknown>,
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
  const run = await GranotAutomationRun.findOne({
    ...fenced(runId, lease, ["applying"]),
    expires_at: { $gt: new Date() },
  })
    .lean()
    .exec();
  if (!run || !run.plan_snapshot || !run.plan_checksum || !run.approval) {
    throw new GranotRunConflict("RUN_EXPIRED_OR_DRIFTED", "Approved Granot run expired or lost its immutable plan.");
  }
  const estimatesAutoApply =
    run.operation === "estimates_in_process" &&
    (run.request_snapshot as { auto_apply?: boolean } | null)?.auto_apply === true;
  if (!estimatesAutoApply && !granotApplyEnabled()) {
    throw new GranotRunConflict("APPLY_DISABLED", "Granot apply deployment gate is disabled.");
  }
  const plan = run.plan_snapshot as unknown as GranotPlan;
  assertSealedAutomationPlan(plan);
  assertPlanChecksum(plan, run.plan_checksum);
  const approval = run.approval as unknown as {
    selected_action_ids: string[];
    plan_checksum: string;
    approved_by: DurableActor;
  };
  if (approval.plan_checksum !== run.plan_checksum) {
    throw new GranotRunConflict("CHECKSUM_DRIFT", "Approval checksum no longer matches the immutable plan.");
  }
  const selected = [...new Set(approval.selected_action_ids)];
  const selectedSet = new Set(selected);
  const storedReceipts = ((run.receipts as GranotAutomationActionReceipt[]) ?? []);
  const receiptsByAction = new Map(
    storedReceipts
      .filter((receipt) => typeof receipt.action_id === "string")
      .map((receipt) => [receipt.action_id, receipt]),
  );
  let completed = [...receiptsByAction.values()].filter((receipt) =>
    isTerminalAutomationActionOutcome(receipt.outcome),
  ).length;

  for (const action of plan.actions) {
    if (!selectedSet.has(action.action_id)) continue;
    const existing = receiptsByAction.get(action.action_id);
    if (existing && isTerminalAutomationActionOutcome(existing.outcome)) {
      continue;
    }
    if (!action.lifecycle_apply) {
      throw new GranotRunConflict(
        "RUN_REPLAN_REQUIRED",
        "Selected action is missing the immutable lifecycle apply block.",
      );
    }
    await renewRunLease(runId, lease, "applying");
    let receipt: GranotAutomationActionReceipt;
    try {
      receipt = await applyAutomationPlanAction({
        action_id: action.action_id,
        lifecycle_apply: action.lifecycle_apply,
        initiator: approval.approved_by,
        existing_receipt: existing,
        request_id: runId,
      });
    } catch (error) {
      if (error instanceof OperationIdempotencyConflictError) {
        receipt = {
          action_id: action.action_id,
          lifecycle_receipt_id: existing?.lifecycle_receipt_id ?? "",
          outcome: "technical_failure",
          applied_at: new Date(),
          error_code: error.code,
        };
      } else {
        throw error;
      }
    }
    const terminal = isTerminalAutomationActionOutcome(receipt.outcome);
    if (terminal && (!existing || isPendingAutomationActionOutcome(existing.outcome))) {
      completed += 1;
    }
    await upsertActionReceipt(runId, lease, receipt, terminal ? completed : undefined);
    receiptsByAction.set(action.action_id, receipt);
    if (isPendingAutomationActionOutcome(receipt.outcome)) {
      await yieldApplyingRun(runId, lease);
      return "applying";
    }
  }

  const status = automationRunCompletionStatus(
    [...receiptsByAction.values()],
    selected,
  );
  if (status === "applying") {
    await yieldApplyingRun(runId, lease);
    return status;
  }
  const finished = await GranotAutomationRun.updateOne(
    fenced(runId, lease, ["applying"]),
    {
      $set: {
        status,
        completed_at: new Date(),
        checkpoint: checkpoint("completed", completed),
        lease_owner: null,
        leased_until: null,
      },
    },
  ).exec();
  if (finished.modifiedCount !== 1) throw new Error("Granot completion lost its fenced lease.");
  return status;
}

async function upsertActionReceipt(
  runId: string,
  lease: LeaseToken,
  receipt: GranotAutomationActionReceipt,
  completed?: number,
): Promise<void> {
  const run = await GranotAutomationRun.findOne(fenced(runId, lease, ["applying"]))
    .select({ receipts: 1 })
    .lean()
    .exec();
  if (!run) throw new Error("Granot apply checkpoint lost its fenced lease.");
  const receipts = [
    ...(((run.receipts as GranotAutomationActionReceipt[]) ?? []).filter(
      (entry) => entry.action_id !== receipt.action_id,
    )),
    receipt,
  ];
  const saved = await GranotAutomationRun.updateOne(
    fenced(runId, lease, ["applying"]),
    {
      $set: {
        receipts,
        ...(completed !== undefined
          ? { checkpoint: checkpoint("apply", completed) }
          : {}),
      },
    },
  ).exec();
  if (saved.modifiedCount !== 1) throw new Error("Granot apply checkpoint lost its fenced lease.");
}

async function yieldApplyingRun(runId: string, lease: LeaseToken): Promise<void> {
  const yielded = await GranotAutomationRun.updateOne(
    fenced(runId, lease, ["applying"]),
    {
      $set: {
        lease_owner: null,
        leased_until: null,
      },
    },
  ).exec();
  if (yielded.modifiedCount !== 1) {
    throw new Error("Granot pending continuation lost its fenced lease.");
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

export async function continueGranotRuns(completedRunId: string): Promise<{
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
    queue_published: exists
      ? await publishGranotWakeup(
          String(exists._id),
          "continuation",
          completedRunId,
        )
      : false,
  };
}

export async function publishGranotWakeup(
  runId: string,
  reason: "create" | "approval" | "recovery" | "continuation",
  predecessorRunId?: string,
): Promise<boolean> {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production") return false;
  try {
    const idempotencyKey =
      reason === "recovery"
        ? `granot:${reason}:${runId}:${Math.floor(Date.now() / (5 * 60_000))}`
        : reason === "continuation"
          ? `granot:${reason}:${predecessorRunId ?? "unknown"}:${runId}`
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
    run_group_id: run.run_group_id,
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
    ...(details
      ? {
          plan: plan ? redactPlanForDisplay(plan) : plan,
          receipts: redactReceiptsForDisplay(run.receipts),
        }
      : {}),
  };
}

function redactPlanForDisplay(plan: GranotPlan): GranotPlan {
  return {
    ...plan,
    actions: plan.actions.map((action) => {
      if (!("lifecycle_apply" in action) || !action.lifecycle_apply) {
        return action;
      }
      const { granot_statement: _statement, ...safeApply } = action.lifecycle_apply;
      return {
        ...action,
        lifecycle_apply: safeApply as GranotAutomationLifecycleApply,
      };
    }),
  } as GranotPlan;
}

function redactReceiptsForDisplay(value: unknown): GranotAutomationActionReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const receipt = entry as GranotAutomationActionReceipt;
    return {
      action_id: receipt.action_id,
      lifecycle_receipt_id: receipt.lifecycle_receipt_id,
      ...(receipt.observation_id ? { observation_id: receipt.observation_id } : {}),
      ...(receipt.decision_id ? { decision_id: receipt.decision_id } : {}),
      outcome: receipt.outcome,
      applied_at: receipt.applied_at,
      ...(receipt.error_code ? { error_code: receipt.error_code } : {}),
    };
  });
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
        lease_owner: null,
        leased_until: null,
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

async function claimGranotRun(
  filter: Record<string, unknown>,
  lease: LeaseToken,
  now: Date,
) {
  return GranotAutomationRun.findOneAndUpdate(
    filter,
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
}

export function buildFormExpectedFilter(
  expected: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(expected).map(([path, value]) => [
      path,
      value === null && path !== "receiver_agent"
        ? { $in: [null, ""] }
        : value,
    ]),
  );
}

export function toDurableGranotValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Granot durable plans cannot contain non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Granot durable plans cannot contain invalid dates.");
    }
    return value.toISOString();
  }
  if (value instanceof Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(toDurableGranotValue);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Granot durable plans cannot contain non-plain objects.");
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toDurableGranotValue(entry)]),
    );
  }
  throw new TypeError(
    `Granot durable plans cannot contain ${typeof value} values.`,
  );
}
