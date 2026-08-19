import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { IngestionConflict } from "../../models/IngestionConflict";
import { IngestionRun } from "../../models/IngestionRun";
import { SourceRowReceipt } from "../../models/SourceRowReceipt";
import { SourceRowState } from "../../models/SourceRowState";
import {
  BEST_RELOCATION_CUTOFF,
  BEST_RELOCATION_TIMEZONE,
} from "../bestRelocationSheetIngest";
import type { BestRelocationApplicationPlan } from "../bestRelocationSheetIngest/applicationPlan";
import type { BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import { computeChecksum, type DurableActor } from "../durableWork";

export const BEST_RELOCATION_CONNECTION_KEY = "best_relocation";

export async function ensureBestRelocationConnection(
  actor: DurableActor,
): Promise<unknown> {
  return ExternalDataConnection.findOneAndUpdate(
    { key: BEST_RELOCATION_CONNECTION_KEY },
    {
      $setOnInsert: {
        key: BEST_RELOCATION_CONNECTION_KEY,
        provider: "google_sheets",
        workbook_env_keys: {
          leads: "BEST_RELOCATION_SYNC_SHEET_ID",
          booked: "BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID",
        },
        application_enabled: false,
        cadence_hours: 24,
        created_actor: actor,
      },
      $set: { updated_actor: actor },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).exec();
}

export async function claimDueBestRelocationConnection(input: {
  now: Date;
  actor: DurableActor;
}): Promise<{
  connection_id: string;
  next_due_at: Date;
  initiator: DurableActor;
} | null> {
  const current = await ExternalDataConnection.findOne({
    key: BEST_RELOCATION_CONNECTION_KEY,
    application_enabled: true,
    application_enabled_actor: { $ne: null },
    $or: [
      { next_due_at: null },
      { next_due_at: { $exists: false } },
      { next_due_at: { $lte: input.now } },
    ],
  })
    .select("_id cadence_hours application_enabled_actor")
    .lean()
    .exec();
  if (!current) return null;
  const nextDueAt = new Date(
    input.now.getTime() + Number(current.cadence_hours) * 60 * 60 * 1000,
  );
  const claimed = await ExternalDataConnection.findOneAndUpdate(
    {
      _id: current._id,
      application_enabled: true,
      application_enabled_actor: { $ne: null },
      $or: [
        { next_due_at: null },
        { next_due_at: { $exists: false } },
        { next_due_at: { $lte: input.now } },
      ],
    },
    {
      $set: {
        next_due_at: nextDueAt,
        last_checked_at: input.now,
        updated_actor: input.actor,
      },
    },
    { returnDocument: "after" },
  )
      .select("_id next_due_at application_enabled_actor")
    .lean()
    .exec();
  return claimed
    ? {
        connection_id: String(claimed._id),
        next_due_at: claimed.next_due_at ?? nextDueAt,
          initiator: claimed.application_enabled_actor as DurableActor,
      }
    : null;
}

export async function createQueuedIngestionRun(input: {
  connection_id: string;
  trigger: "bootstrap" | "preview" | "manual" | "schedule" | "retry";
  actor: DurableActor;
  initiator: DurableActor;
  now: Date;
}): Promise<{ run_id: string }> {
  const run = await IngestionRun.create({
    adapter_key: BEST_RELOCATION_CONNECTION_KEY,
    schema_version: 2,
    trigger: input.trigger,
    status: "queued",
    connection_id: input.connection_id,
    cutoff: BEST_RELOCATION_CUTOFF,
    timezone: BEST_RELOCATION_TIMEZONE,
    actor: input.actor,
    initiator: input.initiator,
    last_attempt_at: input.now,
  });
  return { run_id: String(run._id) };
}

export async function claimQueuedRun(input: {
  owner: string;
  now: Date;
  leaseUntil: Date;
  leaseEpoch: number;
}): Promise<unknown | null> {
  return IngestionRun.findOneAndUpdate(
    {
      $or: [
        { status: "queued" },
        {
          status: { $in: ["inspecting", "planning"] },
          $or: [
            { leased_until: { $lte: input.now } },
            { leased_until: null },
            { leased_until: { $exists: false } },
          ],
        },
      ],
    },
    {
      $set: {
        status: "inspecting",
        lease_owner: input.owner,
        leased_until: input.leaseUntil,
        lease_epoch: input.leaseEpoch,
        started_at: input.now,
        last_attempt_at: input.now,
      },
      $inc: { attempt_count: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  )
    .lean()
    .exec();
}

export async function claimApprovedRun(input: {
  owner: string;
  now: Date;
  leaseUntil: Date;
  leaseEpoch: number;
}): Promise<unknown | null> {
  return IngestionRun.findOneAndUpdate(
    {
      status: "applying",
      plan_locked_at: { $type: "date" },
      $and: [
        {
          $or: [
            { "approval.approved_at": { $type: "date" } },
            { trigger: { $in: ["schedule", "retry"] } },
          ],
        },
        {
          $or: [
            { lease_owner: null },
            { leased_until: { $lte: input.now } },
            { leased_until: { $exists: false } },
          ],
        },
      ],
    },
    {
      $set: {
        lease_owner: input.owner,
        leased_until: input.leaseUntil,
        lease_epoch: input.leaseEpoch,
        last_attempt_at: input.now,
      },
      $inc: { attempt_count: 1 },
    },
    { sort: { updatedAt: 1 }, returnDocument: "after" },
  )
    .lean()
    .exec();
}

export async function lockRunPlan(input: {
  run_id: string;
  plan: BestRelocationApplicationPlan;
  checksum: string;
  sourceReadThrough: Date;
  sourceSnapshot: BestRelocationApplicationPlan["source_snapshot"];
  nextStatus: "awaiting_approval" | "applying" | "completed";
  now: Date;
}): Promise<boolean> {
  const result = await IngestionRun.updateOne(
    {
      _id: input.run_id,
      status: "planning",
      $or: [
        { plan_locked_at: null },
        { plan_locked_at: { $exists: false } },
      ],
    },
    {
      $set: {
        status: input.nextStatus,
        plan_snapshot: input.plan,
        plan_checksum: input.checksum,
        plan_locked_at: input.now,
        source_read_through: input.sourceReadThrough,
        source_snapshot: input.sourceSnapshot,
        counters: mapPlanCounters(input.plan.counters),
        ...(input.nextStatus === "completed"
          ? { completed_at: input.now }
          : {}),
      },
    },
  ).exec();
  return result.modifiedCount === 1;
}

export async function evidenceKeysForConnection(
  connectionId: string,
): Promise<Set<string>> {
  const states = await SourceRowState.find({
    connection_id: connectionId,
    source_state: "present",
    last_applied_content_hash: { $type: "string" },
    $expr: { $eq: ["$latest_content_hash", "$last_applied_content_hash"] },
  })
    .select("dataset_key stable_source_row_id last_applied_content_hash")
    .limit(50_001)
    .lean()
    .exec() as Array<{
    dataset_key: string;
    stable_source_row_id: string;
    last_applied_content_hash: string;
  }>;
  if (states.length > 50_000) {
    throw new Error("Receipt identity scan exceeded the 50,000-row safety bound");
  }
  return new Set(
    states.map(
      (state) =>
        `${state.dataset_key}:${state.stable_source_row_id}:${state.last_applied_content_hash}`,
    ),
  );
}

export async function detectMissingSourceActions(input: {
  connection_id: string;
  current_actions: readonly BestRelocationPlanAction[];
}): Promise<BestRelocationPlanAction[]> {
  const current = new Set(
    input.current_actions.map(
      (action) => `${action.dataset_key}:${action.stable_source_row_id}`,
    ),
  );
  const history = await SourceRowState.find({
    connection_id: input.connection_id,
    source_state: "present",
  })
    .select("+workbook_id")
    .limit(50_001)
    .lean()
    .exec();
  if (history.length > 50_000) {
    throw new Error("Missing-source scan exceeded the 50,000-row safety bound");
  }
  const actions: BestRelocationPlanAction[] = [];
  for (const receipt of history) {
    const key = `${receipt.dataset_key}:${receipt.stable_source_row_id}`;
    if (current.has(key)) continue;
    const contentHash = computeChecksum({
      checksum_version: 1,
      artifact_kind: "ingestion_plan",
      schema_version: Number(receipt.schema_version),
      payload: {
        dataset_key: receipt.dataset_key,
        stable_source_row_id: receipt.stable_source_row_id,
        source_state: "source_missing",
      },
    });
    actions.push({
      action_key: `missing:${key}:${contentHash}`,
      command: "record_conflict",
      classification: "conflict",
      dataset_key: String(receipt.dataset_key),
      stable_source_row_id: String(receipt.stable_source_row_id),
      content_hash: contentHash,
      schema_profile: String(receipt.schema_profile),
      schema_version: Number(receipt.schema_version),
      provenance: {
        workbook_id: String(receipt.workbook_id ?? ""),
        workbook_title: String(receipt.workbook_title),
        tab: receipt.tab_name as never,
        sheet_row: Number(receipt.last_observed_row_number),
        source_row_key: String(receipt.stable_source_row_id),
        raw: {},
      },
      depends_on: [],
      adopted_entity_refs: (receipt.resulting_canonical_ids ?? []).map(
        (id) => ({
          model: receipt.resulting_canonical_model ?? "Unknown",
          id: String(id),
        }),
      ),
      source_owned_values:
        receipt.last_applied_source_values &&
        typeof receipt.last_applied_source_values === "object"
          ? (receipt.last_applied_source_values as Record<string, unknown>)
          : undefined,
      conflict: { type: "missing_source_row", severity: "warning" },
    });
  }
  return actions;
}

export function preallocateReceiptId(): string {
  return String(new mongoose.Types.ObjectId());
}

export async function resolvedActionIdsForRun(input: {
  run_id: string;
  connection_id: string;
  actions: readonly BestRelocationPlanAction[];
}): Promise<Map<string, string>> {
  if (!input.actions.length) return new Map();
  const receipts = await SourceRowReceipt.find({
    connection_id: input.connection_id,
    $or: input.actions.map((action) => ({
      dataset_key: action.dataset_key,
      stable_source_row_id: action.stable_source_row_id,
      content_hash: action.content_hash,
      schema_version: action.schema_version,
    })),
    resulting_canonical_ids: { $exists: true, $ne: [] },
  })
    .select(
      "dataset_key stable_source_row_id content_hash resulting_canonical_ids",
    )
    .lean()
    .exec();
  const byEvidence = new Map(
    receipts.map((receipt) => [
      `${receipt.dataset_key}:${receipt.stable_source_row_id}:${receipt.content_hash}`,
      receipt.resulting_canonical_ids[0],
    ]),
  );
  const resolved = new Map<string, string>();
  for (const action of input.actions) {
    const id = byEvidence.get(
      `${action.dataset_key}:${action.stable_source_row_id}:${action.content_hash}`,
    );
    if (id) resolved.set(action.action_key, String(id));
  }
  return resolved;
}

export async function oldestRecoverableIngestionRun(
  now: Date,
): Promise<string | null> {
  const run = await IngestionRun.findOne({
    $or: [
      { status: "queued" },
      {
        $and: [
          { status: { $in: ["inspecting", "planning", "applying"] } },
          {
            $or: [
              { leased_until: null },
              { leased_until: { $lte: now } },
              { leased_until: { $exists: false } },
            ],
          },
        ],
      },
    ],
  })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean()
    .exec();
  return run ? String(run._id) : null;
}

type SourceReceiptWrite = Record<string, unknown> & {
  _id?: string;
  connection_id: unknown;
  dataset_key: string;
  stable_source_row_id: string;
  content_hash: string;
  schema_profile: string;
  schema_version: number;
  workbook_id: string;
  workbook_title: string;
  tab_name: string;
  last_observed_row_number: number;
  observed_at: Date;
  ingestion_run_id: unknown;
  outcome: string;
  source_state: "present" | "source_missing";
};

export async function appendSourceReceipt(
  receipt: SourceReceiptWrite,
): Promise<{ id: string; inserted: boolean }> {
  let receiptId: string;
  let inserted: boolean;
  try {
    const created = (await SourceRowReceipt.create(receipt as never)) as unknown as {
      _id: unknown;
    };
    receiptId = String(created._id);
    inserted = true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await SourceRowReceipt.findOne()
      .where("connection_id")
      .equals(receipt.connection_id)
      .where("dataset_key")
      .equals(receipt.dataset_key)
      .where("stable_source_row_id")
      .equals(receipt.stable_source_row_id)
      .where("schema_version")
      .equals(receipt.schema_version)
      .where("content_hash")
      .equals(receipt.content_hash)
      .select("_id")
      .lean()
      .exec();
    if (!existing) throw error;
    receiptId = String(existing._id);
    inserted = false;
  }
  await updateSourceRowState(receipt, receiptId);
  return { id: receiptId, inserted };
}

const APPLIED_RECEIPT_OUTCOMES = new Set([
  "applied",
  "already_applied",
  "adopted",
]);

async function updateSourceRowState(
  receipt: SourceReceiptWrite,
  receiptId: string,
): Promise<void> {
  const outcome = String(receipt.outcome ?? "");
  const applied = APPLIED_RECEIPT_OUTCOMES.has(outcome);
  await SourceRowState.findOneAndUpdate(
    {
      connection_id: receipt.connection_id,
      dataset_key: receipt.dataset_key,
      stable_source_row_id: receipt.stable_source_row_id,
      schema_version: receipt.schema_version,
    } as never,
    {
      $set: {
        schema_profile: receipt.schema_profile,
        workbook_id: receipt.workbook_id,
        workbook_title: receipt.workbook_title,
        tab_name: receipt.tab_name,
        last_observed_row_number: receipt.last_observed_row_number,
        latest_content_hash: receipt.content_hash,
        latest_outcome: outcome,
        latest_receipt_id: receiptId,
        source_state: receipt.source_state,
        last_observed_at: receipt.observed_at,
        last_ingestion_run_id: receipt.ingestion_run_id,
        ...(applied
          ? {
              resulting_canonical_model:
                receipt.resulting_canonical_model ?? null,
              resulting_canonical_ids:
                receipt.resulting_canonical_ids ?? [],
              last_applied_content_hash: receipt.content_hash,
              last_applied_source_values:
                receipt.last_applied_source_values ?? null,
            }
          : {}),
      },
    } as never,
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).exec();
}

export async function openIngestionConflict(
  conflict: Record<string, unknown>,
): Promise<{ id: string; inserted: boolean }> {
  try {
    const created = await IngestionConflict.create(conflict);
    return { id: String(created._id), inserted: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await IngestionConflict.findOne()
      .where("run_id")
      .equals(conflict.run_id)
      .where("dataset_key")
      .equals(conflict.dataset_key)
      .where("stable_source_row_id")
      .equals(conflict.stable_source_row_id)
      .where("type")
      .equals(conflict.type)
      .where("status")
      .equals("open")
      .select("_id")
      .lean()
      .exec();
    if (!existing) throw error;
    if (conflict.source_receipt_id) {
      await IngestionConflict.updateOne(
        {
          _id: existing._id,
          $or: [
            { source_receipt_id: null },
            { source_receipt_id: { $exists: false } },
          ],
        },
        { $set: { source_receipt_id: conflict.source_receipt_id } },
      ).exec();
    }
    if (
      Array.isArray(conflict.related_canonical_ids) &&
      conflict.related_canonical_ids.length > 0
    ) {
      await IngestionConflict.updateOne(
        { _id: existing._id },
        {
          $addToSet: {
            related_canonical_ids: {
              $each: conflict.related_canonical_ids,
            },
          },
        },
      ).exec();
    }
    return { id: String(existing._id), inserted: false };
  }
}

export async function isIngestionConflictDispositioned(input: {
  run_id: string;
  dataset_key: string;
  stable_source_row_id: string;
  type: string;
}): Promise<boolean> {
  const conflict = await IngestionConflict.findOne()
    .where("run_id")
    .equals(input.run_id)
    .where("dataset_key")
    .equals(input.dataset_key)
    .where("stable_source_row_id")
    .equals(input.stable_source_row_id)
    .where("type")
    .equals(input.type)
    .where("status")
    .in(["resolved", "dismissed"])
    .select("_id")
    .lean()
    .exec();
  return Boolean(conflict);
}

export function newWorkerOwner(): string {
  return `best-relocation-worker:${randomUUID()}`;
}

function mapPlanCounters(counters: Record<string, number>) {
  return {
    unchanged: counters.unchanged ?? 0,
    creates: counters.create ?? 0,
    conflicts: counters.conflict ?? 0,
    leadless_bookings: counters.leadless_booking ?? 0,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
