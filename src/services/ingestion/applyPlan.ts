import { createHash } from "node:crypto";
import {
  assertChecksum,
  classifyGoogleFailure,
  computeChecksum,
  type DurableActor,
  type LeaseStore,
  type LeaseToken,
} from "../durableWork";
import type {
  CanonicalCommandContext,
  CanonicalDomainCommands,
  CanonicalCommandResult,
} from "../domainCommands";
import type {
  BestRelocationApplicationPlan,
  BestRelocationPlanAction,
} from "../bestRelocationSheetIngest/applicationPlan";
import {
  appendSourceReceipt,
  isIngestionConflictDispositioned,
  openIngestionConflict,
  preallocateReceiptId,
  resolvedActionIdsForRun,
} from "./repository";

export type ApplyPlanPersistence = {
  appendSourceReceipt: typeof appendSourceReceipt;
  openIngestionConflict: typeof openIngestionConflict;
  isIngestionConflictDispositioned: typeof isIngestionConflictDispositioned;
  preallocateReceiptId: typeof preallocateReceiptId;
  resolvedActionIdsForRun: typeof resolvedActionIdsForRun;
};

const defaultPersistence: ApplyPlanPersistence = {
  appendSourceReceipt,
  openIngestionConflict,
  isIngestionConflictDispositioned,
  preallocateReceiptId,
  resolvedActionIdsForRun,
};

export async function applyBestRelocationPlan(input: {
  plan: BestRelocationApplicationPlan;
  checksum: string;
  run_id: string;
  connection_id: string;
  actor: DurableActor;
  initiator: DurableActor;
  lease: LeaseToken;
  leaseStore: LeaseStore;
  commands: CanonicalDomainCommands;
  now?: () => Date;
  onCheckpoint?: (input: {
    action_index: number;
    completed_units: number;
    failures: number;
    conflicts: number;
    skipped_dependencies: number;
    failed_action_keys: string[];
  }) => Promise<void>;
  start_action_index?: number;
  initial_completed_units?: number;
  initial_failure_count?: number;
  initial_conflict_count?: number;
  initial_skipped_dependency_count?: number;
  initial_failed_action_keys?: readonly string[];
  assertApplicationEnabled?: () => void | Promise<void>;
  persistence?: ApplyPlanPersistence;
}): Promise<{
  applied: number;
  already_applied: number;
  conflicts: number;
  failures: number;
  skipped_dependencies: number;
  completed_units: number;
}> {
  assertChecksum(
    {
      checksum_version: 1,
      artifact_kind: "ingestion_plan",
      schema_version: input.plan.schema_version,
      payload: input.plan,
    },
    input.checksum,
  );
  const persistence = input.persistence ?? defaultPersistence;
  const now = input.now ?? (() => new Date());
  const resolved =
    (input.start_action_index ?? 0) > 0
      ? await persistence.resolvedActionIdsForRun({
          run_id: input.run_id,
          connection_id: input.connection_id,
          actions: input.plan.actions.slice(0, input.start_action_index),
        })
      : new Map<string, string>();
  const failed = new Set(input.initial_failed_action_keys ?? []);
  const result = {
    applied: 0,
    already_applied: 0,
    conflicts: input.initial_conflict_count ?? 0,
    failures: input.initial_failure_count ?? 0,
    skipped_dependencies: input.initial_skipped_dependency_count ?? 0,
    completed_units: input.initial_completed_units ?? 0,
  };

  for (
    let actionIndex = input.start_action_index ?? 0;
    actionIndex < input.plan.actions.length;
    actionIndex += 1
  ) {
    const action = input.plan.actions[actionIndex];
    if (action.classification === "unchanged") {
      result.completed_units += 1;
      await checkpoint(input, actionIndex, result, failed);
      continue;
    }
    if (action.depends_on.some((dependency) => failed.has(dependency))) {
      failed.add(action.action_key);
      result.skipped_dependencies += 1;
      await checkpoint(input, actionIndex, result, failed);
      continue;
    }
    await input.assertApplicationEnabled?.();
    if (
      !(await input.leaseStore.assertHeld({
        token: input.lease,
        now: now(),
      }))
    ) {
      throw new Error("Ingestion apply lease was lost before mutation");
    }
    let commandStarted = false;
    let commandFinished = false;
    try {
      if (action.command === "record_conflict") {
        const receiptId = persistence.preallocateReceiptId();
        const dispositioned = await persistence.isIngestionConflictDispositioned({
          run_id: input.run_id,
          dataset_key: action.dataset_key,
          stable_source_row_id: action.stable_source_row_id,
          type: action.conflict?.type ?? "ambiguous_lead_match",
        });
        const persistedReceiptId = await persistReceipt(
          input,
          persistence,
          action,
          action.adopted_entity_refs ?? [],
          dispositioned ? "conflict_dispositioned" : "conflict",
          now(),
          receiptId,
        );
        if (!dispositioned) {
          await persistConflict(
            input,
            persistence,
            action,
            now(),
            persistedReceiptId,
            action.depends_on
              .map((dependency) => resolved.get(dependency))
              .filter((id): id is string => Boolean(id)),
          );
          result.conflicts += 1;
        }
        result.completed_units += 1;
        await checkpoint(input, actionIndex, result, failed);
        continue;
      }
      if (action.command === "adopt_existing") {
        await persistReceipt(
          input,
          persistence,
          action,
          action.adopted_entity_refs ?? [],
          "adopted",
          now(),
        );
        result.completed_units += 1;
        await checkpoint(input, actionIndex, result, failed);
        continue;
      }
      const receiptId = persistence.preallocateReceiptId();
      commandStarted = true;
      const commandResult = await executeAction(
        input,
        action,
        receiptId,
        resolved,
      );
      commandFinished = true;
      const canonicalIds = commandResult.entity_refs.map((entry) => entry.id);
      const primaryId = canonicalIds[0];
      if (primaryId) resolved.set(action.action_key, primaryId);
      await persistReceipt(
        input,
        persistence,
        action,
        commandResult.entity_refs,
        commandResult.status,
        now(),
        receiptId,
      );
      result[commandResult.status === "applied" ? "applied" : "already_applied"] += 1;
      result.completed_units += 1;
      await checkpoint(input, actionIndex, result, failed);
    } catch (error) {
      if (!commandStarted || commandFinished) {
        throw error;
      }
      if (!isRowScopedCommandError(error)) {
        throw error;
      }
      failed.add(action.action_key);
      result.failures += 1;
      await checkpoint(input, actionIndex, result, failed);
    }
  }
  return result;
}

function isRowScopedCommandError(error: unknown): boolean {
  if (classifyGoogleFailure(error) === "invalid_request") return true;
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";
  return [
    "ZodError",
    "ValidationError",
    "ConflictError",
    "NotFoundError",
  ].includes(name);
}

async function checkpoint(
  input: Parameters<typeof applyBestRelocationPlan>[0],
  actionIndex: number,
  result: {
    applied: number;
    already_applied: number;
    failures: number;
    completed_units: number;
    conflicts: number;
    skipped_dependencies: number;
  },
  failed: ReadonlySet<string>,
): Promise<void> {
  await input.onCheckpoint?.({
    action_index: actionIndex + 1,
    completed_units: result.completed_units,
    failures: result.failures,
    conflicts: result.conflicts,
    skipped_dependencies: result.skipped_dependencies,
    failed_action_keys: [...failed],
  });
}

async function executeAction(
  input: Parameters<typeof applyBestRelocationPlan>[0],
  action: BestRelocationPlanAction,
  receiptId: string,
  resolved: Map<string, string>,
): Promise<CanonicalCommandResult> {
  const data = resolvePayload(action, resolved);
  const payloadChecksum = computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: action.schema_version,
    payload: data,
  });
  const context: CanonicalCommandContext = {
    command_id: deterministicId(
      `${input.run_id}:${action.action_key}:${payloadChecksum}`,
    ),
    idempotency_key: action.action_key,
    payload_checksum: payloadChecksum,
    actor: input.actor,
    initiator: input.initiator,
    provenance: {
      origin: "external_sheet_ingestion",
      run_id: input.run_id,
      source_receipt_id: receiptId,
      source_connection_key: "best_relocation",
    },
  };
  switch (action.command) {
    case "create_form_lead":
      return input.commands.createFormLead({ data: data as never, context });
    case "create_call_lead":
      return input.commands.createCallLead({ data: data as never, context });
    case "update_source_owned_lead":
      return input.commands.updateSourceOwnedLead({
        lead_model: data.lead_model as "FormLead" | "CallLead",
        lead_id: String(data.lead_id),
        patch: (data.patch ?? {}) as Record<string, unknown>,
        context,
      });
    case "create_booked_from_source":
      return input.commands.createBookingFromLead({
        data: data as never,
        context,
      });
    case "create_leadless_booking":
      return input.commands.createLeadlessBooking({
        data: data as never,
        context,
      });
    case "create_cancelled_lead":
      return input.commands.createCancellation({ data: data as never, context });
    default:
      throw new Error(`Unsupported canonical ingestion command ${action.command}`);
  }
}

function resolvePayload(
  action: BestRelocationPlanAction,
  resolved: Map<string, string>,
): Record<string, unknown> {
  const payload = { ...(action.command_payload ?? {}) };
  if (action.command === "create_booked_from_source") {
    const dependency = action.depends_on[0];
    if (dependency) {
      const leadId = resolved.get(dependency);
      if (!leadId) throw new Error(`Missing lead dependency ${dependency}`);
      payload.lead_ref = leadId;
    }
  }
  if (action.command === "create_cancelled_lead") {
    const dependency = action.depends_on[0];
    const bookingId = dependency ? resolved.get(dependency) : undefined;
    if (!bookingId) throw new Error(`Missing booking dependency ${dependency}`);
    payload.booked_lead = bookingId;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" || !value.startsWith("$ref:")) continue;
    const dependency = value.slice("$ref:".length);
    const id = resolved.get(dependency);
    if (!id) throw new Error(`Missing dependency ${dependency}`);
    payload[key] = id;
  }
  return payload;
}

async function persistReceipt(
  input: Parameters<typeof applyBestRelocationPlan>[0],
  persistence: ApplyPlanPersistence,
  action: BestRelocationPlanAction,
  entityRefs: readonly { model: string; id: string }[],
  outcome: string,
  observedAt: Date,
  receiptId?: string,
): Promise<string> {
  const provenance =
    "rows" in action.provenance
      ? action.provenance.rows[0]
      : action.provenance;
  const persisted = await persistence.appendSourceReceipt({
    ...(receiptId ? { _id: receiptId } : {}),
    connection_id: input.connection_id,
    dataset_key: action.dataset_key,
    stable_source_row_id: action.stable_source_row_id,
    content_hash: action.content_hash,
    schema_profile: action.schema_profile,
    schema_version: action.schema_version,
    workbook_id: provenance.workbook_id,
    workbook_title: provenance.workbook_title,
    tab_name: provenance.tab,
    last_observed_row_number: provenance.sheet_row,
    range: `${provenance.tab}!${provenance.sheet_row}:${provenance.sheet_row}`,
    observed_at: observedAt,
    ingestion_run_id: input.run_id,
    observation_type: action.dataset_key,
    classification: action.classification,
    outcome,
    resulting_canonical_model: entityRefs[0]?.model ?? null,
    resulting_canonical_ids: entityRefs.map((entry) => entry.id),
    last_applied_source_values:
      action.source_owned_values ?? action.command_payload ?? null,
    matching: action.matching ?? null,
    source_state:
      action.conflict?.type === "missing_source_row"
        ? "source_missing"
        : "present",
  });
  return persisted.id;
}

async function persistConflict(
  input: Parameters<typeof applyBestRelocationPlan>[0],
  persistence: ApplyPlanPersistence,
  action: BestRelocationPlanAction,
  createdAt: Date,
  receiptId: string,
  relatedCanonicalIds: string[],
): Promise<void> {
  const provenance =
    "rows" in action.provenance
      ? action.provenance.rows[0]
      : action.provenance;
  await persistence.openIngestionConflict({
    run_id: input.run_id,
    source_receipt_id: receiptId,
    connection_id: input.connection_id,
    dataset_key: action.dataset_key,
    stable_source_row_id: action.stable_source_row_id,
    type: action.conflict?.type ?? "ambiguous_lead_match",
    severity: action.conflict?.severity ?? "blocking",
    status: "open",
    source_company_key: "best_relocation_leads",
    provenance: {
      workbook_title: provenance.workbook_title,
      tab: provenance.tab,
      row: provenance.sheet_row,
    },
    normalized_source_values: {},
    ranked_candidates: [],
    related_canonical_ids: relatedCanonicalIds,
    origin: "external_sheet_ingestion",
    createdAt,
  });
}

function deterministicId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
