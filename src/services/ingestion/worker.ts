import { connectMongo } from "../../db";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { IngestionRun } from "../../models/IngestionRun";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import {
  BEST_RELOCATION_CUTOFF,
  applyCanonicalAdoptionPolicy,
  applySourceChangePolicy,
  createBestRelocationIngestionAdapter,
  planBootstrapAdoption,
} from "../bestRelocationSheetIngest";
import { canonicalDomainCommands } from "../domainCommands";
import { recordOperationalEvent } from "../observability";
import {
  createBestRelocationIngestionActor,
  computeChecksum,
  classifyGoogleFailure,
  MongoLeaseStore,
  type DurableActor,
  type LeaseToken,
} from "../durableWork";
import { applyBestRelocationPlan } from "./applyPlan";
import {
  emitIngestionHealthSignal,
  planHealthSignals,
} from "./health";
import {
  claimApprovedRun,
  claimQueuedRun,
  createQueuedIngestionRun,
  detectMissingSourceActions,
  evidenceKeysForConnection,
  newWorkerOwner,
  openIngestionConflict,
} from "./repository";
import { publishIngestionWakeup } from "./queue";

const APPLY_SCOPE = "ingestion:best_relocation:apply";
const LEASE_TTL_MS = 5 * 60_000;

export async function runBestRelocationIngestionWorker(): Promise<{
  claimed: boolean;
  run_id?: string;
  status?: string;
}> {
  await connectMongo();
  const now = new Date();
  const owner = newWorkerOwner();
  const leaseStore = new MongoLeaseStore(SheetSyncLease);
  let lease = await leaseStore.acquire({
    scope: APPLY_SCOPE,
    owner,
    ttl_ms: LEASE_TTL_MS,
    now,
  });
  if (!lease) return { claimed: false, status: "lease_busy" };
  let runId: string | undefined;
  try {
    const approved = await claimApprovedRun({
      owner,
      now,
      leaseUntil: lease.leased_until,
      leaseEpoch: lease.epoch,
    });
    const run = approved ?? await claimQueuedRun({
      owner,
      now,
      leaseUntil: lease.leased_until,
      leaseEpoch: lease.epoch,
    });
    if (!isRecord(run)) return { claimed: false };
    runId = String(run._id);
    const trigger = String(run.trigger) as
      | "bootstrap"
      | "preview"
      | "manual"
      | "schedule"
      | "retry";
    const connectionId = String(run.connection_id);
    const actor = createBestRelocationIngestionActor(runId);
    const initiator = run.initiator as DurableActor;
    const applicationEnabled =
      trigger === "bootstrap" ||
      (await isConnectionApplicationEnabled(connectionId));
    if (
      trigger !== "bootstrap" &&
      (String(run.status) === "applying" ||
        trigger === "schedule" ||
        trigger === "retry") &&
      (!deploymentGateEnabled() || !applicationEnabled)
    ) {
      const skipped = await IngestionRun.updateOne(
        {
          _id: runId,
          status: { $in: ["inspecting", "applying"] },
          lease_owner: lease.owner,
          lease_epoch: lease.epoch,
        },
        {
          $set: {
            status: "skipped",
            completed_at: new Date(),
            skip_reason: {
              code: "DEPLOYMENT_GATE_DISABLED",
              summary:
                "The deployment or application ingestion gate is disabled.",
            },
          },
        },
      ).exec();
      if (skipped.modifiedCount !== 1) {
        throw new Error("Deployment-gate skip lost the fenced run lease");
      }
      return { claimed: true, run_id: runId, status: "skipped" };
    }
    if (String(run.status) === "applying") {
      const approvedResult = await applyApprovedClaim({
        run,
        runId,
        connectionId,
        actor,
        initiator,
        lease,
        leaseStore,
      });
      return approvedResult;
    }
    const sourceReadThrough = new Date();
    const adapter = createBestRelocationIngestionAdapter({ leaseStore });

    const inspection = await adapter.inspect({
      source_read_through: sourceReadThrough,
      repair_identity:
        trigger === "bootstrap" ||
        trigger === "schedule" ||
        trigger === "retry",
      lease,
    });
    await ExternalDataConnection.updateOne(
      { _id: connectionId },
      {
        $set: {
          last_checked_at: new Date(inspection.checked_at),
          resolved_workbooks: {
            leads: {
              title:
                inspection.sources.find((source) => source.role === "leads")
                  ?.title ?? null,
              masked_id:
                inspection.sources.find((source) => source.role === "leads")
                  ?.masked_id ?? null,
            },
            booked: {
              title:
                inspection.sources.find((source) => source.role === "booked")
                  ?.title ?? null,
              masked_id:
                inspection.sources.find((source) => source.role === "booked")
                  ?.masked_id ?? null,
            },
          },
          health: connectionHealthFromInspection(inspection),
          updated_actor: actor,
        },
      },
    ).exec();
    if (!inspection.healthy) {
      await emitIngestionHealthSignal({
        key: "schema_or_formula_drift",
        run_id: runId,
        blocking_checks: inspection.checks
          .filter((check) => check.status === "blocking")
          .map((check) => check.key),
      });
      await failRun(
        runId,
        "STRUCTURAL_INSPECTION_FAILED",
        "inspecting",
        undefined,
        lease,
      );
      return { claimed: true, run_id: runId, status: "failed" };
    }
    await IngestionRun.updateOne(
      leaseFilter(runId, lease, "inspecting"),
      {
        $set: {
          status: "planning",
          source_read_through: sourceReadThrough,
        },
      },
    ).exec();
    const observations = [];
    for await (const observation of adapter.read({
      cutoff: BEST_RELOCATION_CUTOFF,
      source_read_through: sourceReadThrough,
      preview: trigger === "manual" || trigger === "preview",
      lease,
    })) {
      observations.push(observation);
    }
    if (observations.length !== 1) {
      throw new Error("Best Relocation adapter returned no workbook snapshot");
    }
    const data = observations[0];
    const unchangedEvidence = await evidenceKeysForConnection(connectionId);
    const initialPlanSnapshot = await adapter.plan({
      observations,
      trigger,
      run_id: runId,
      cutoff: BEST_RELOCATION_CUTOFF,
      source_read_through: sourceReadThrough,
    });
    const withEvidence = {
      ...initialPlanSnapshot,
      actions: initialPlanSnapshot.actions.map((action) => {
        const evidenceKey = `${action.dataset_key}:${action.stable_source_row_id}:${action.content_hash}`;
        if (!unchangedEvidence.has(evidenceKey)) return action;
        const { command_payload: _payload, ...rest } = action;
        return {
          ...rest,
          command: "unchanged" as const,
          classification: "unchanged" as const,
        };
      }),
    };
    let plan =
      trigger === "bootstrap"
        ? await planBootstrapAdoption(initialPlanSnapshot)
        : await applySourceChangePolicy({
            connection_id: connectionId,
            plan: withEvidence,
          });
    if (trigger !== "bootstrap") {
      plan = await applyCanonicalAdoptionPolicy({ plan });
    }
    const missingActions = await detectMissingSourceActions({
      connection_id: connectionId,
      current_actions: plan.actions,
    });
    if (missingActions.length) {
      plan = {
        ...plan,
        actions: [...plan.actions, ...missingActions],
        counters: {
          ...plan.counters,
          conflict: (plan.counters.conflict ?? 0) + missingActions.length,
        },
        warnings: [
          ...plan.warnings,
          `${missingActions.length} previously observed source row(s) are missing; canonical records were preserved.`,
        ],
      };
    }
    const planned = {
      plan,
      checksum: computeChecksum({
        checksum_version: 1,
        artifact_kind: "ingestion_plan",
        schema_version: plan.schema_version,
        payload: plan,
      }),
    };
    const renewedAfterPlanning = await leaseStore.renew({
      token: lease,
      ttl_ms: LEASE_TTL_MS,
      now: new Date(),
    });
    if (!renewedAfterPlanning) {
      throw new Error("Ingestion lease expired during source planning");
    }
    lease = renewedAfterPlanning;
    await IngestionRun.updateOne(
      {
        _id: runId,
        status: "planning",
        lease_owner: lease.owner,
        lease_epoch: lease.epoch,
      },
      { $set: { leased_until: lease.leased_until } },
    ).exec();
    await persistPlanConflicts(runId, connectionId, planned.plan);
    const nextStatus =
      trigger === "preview"
        ? "completed"
        : trigger === "schedule" || trigger === "retry"
          ? "applying"
          : "awaiting_approval";
    const locked = await IngestionRun.updateOne(
      {
        ...leaseFilter(runId, lease, "planning"),
        $or: [
          { plan_locked_at: null },
          { plan_locked_at: { $exists: false } },
        ],
      },
      {
        $set: {
          status: nextStatus,
          plan_snapshot: planned.plan,
          plan_checksum: planned.checksum,
          plan_locked_at: new Date(),
          source_snapshot: planned.plan.source_snapshot,
          source_read_through: sourceReadThrough,
          counters: {
            read:
              data.forms.length +
              data.localForms.length +
              data.calls.length +
              data.booked.length +
              data.refunds.length,
            unchanged: planned.plan.counters.unchanged ?? 0,
            creates: planned.plan.counters.create ?? 0,
            conflicts: planned.plan.counters.conflict ?? 0,
            invalid_rows: planned.plan.counters.invalid ?? 0,
            leadless_bookings:
              planned.plan.counters.leadless_booking ?? 0,
          },
          ...(nextStatus === "completed"
            ? { completed_at: new Date() }
            : {}),
        },
      },
    ).exec();
    if (locked.modifiedCount !== 1) {
      throw new Error("Run plan could not be locked under the active lease");
    }
    const readCount =
      data.forms.length +
      data.localForms.length +
      data.calls.length +
      data.booked.length +
      data.refunds.length;
    for (const signal of planHealthSignals({
      run_id: runId,
      read_count: readCount,
      counters: {
        ...planned.plan.counters,
        unmatched_refund: planned.plan.actions.filter(
          (action) => action.conflict?.type === "unmatched_refund",
        ).length,
        duplicate_source_identity: planned.plan.actions.filter(
          (action) => action.conflict?.type === "duplicate_source_identity",
        ).length,
      },
    })) {
      await emitIngestionHealthSignal(signal);
    }
    if (nextStatus !== "applying") {
      return { claimed: true, run_id: runId, status: nextStatus };
    }
    const connection = await ExternalDataConnection.findById(connectionId)
      .select("bootstrap_completed_at")
      .lean()
      .exec();
    if (!connection?.bootstrap_completed_at) {
      await failRun(
        runId,
        "BOOTSTRAP_NOT_COMPLETED",
        "applying",
        "Scheduled ingestion requires approved bootstrap adoption.",
        lease,
      );
      return { claimed: true, run_id: runId, status: "failed" };
    }
    lease =
      (await leaseStore.renew({
        token: lease,
        ttl_ms: LEASE_TTL_MS,
        now: new Date(),
      })) ?? lease;
    const applied = await applyBestRelocationPlan({
      plan: planned.plan,
      checksum: planned.checksum,
      run_id: runId,
      connection_id: connectionId,
      actor,
      initiator,
      lease,
      leaseStore,
      commands: canonicalDomainCommands,
      assertApplicationEnabled: () =>
        assertIngestionEnabled(connectionId),
      onCheckpoint: (checkpoint) =>
        persistWorkerCheckpoint(runId!, leaseStore, lease!, checkpoint),
    });
    const finalStatus =
      applied.failures || applied.skipped_dependencies
        ? "completed_with_errors"
        : "completed";
    const completedAt = new Date();
    const finalized = await IngestionRun.updateOne(
      leaseFilter(runId, lease, "applying"),
      {
        $set: {
          status: finalStatus,
          completed_at: completedAt,
          "counters.failures": applied.failures,
          "counters.conflicts": applied.conflicts,
          checkpoint: {
            version: planned.plan.actions.length + 1,
            phase: "complete",
            cursor: { action_index: planned.plan.actions.length },
            completed_units: applied.completed_units,
            updated_at: completedAt,
          },
        },
      },
    ).exec();
    if (finalized.modifiedCount !== 1) {
      throw new Error("Ingestion finalization lost the fenced run lease");
    }
    await ExternalDataConnection.updateOne(
      { _id: connectionId },
      {
        $set: {
          last_checked_at: completedAt,
          ...(finalStatus === "completed"
            ? { last_successful_run_at: completedAt }
            : {}),
          updated_actor: actor,
          "health.connection": {
            status:
              finalStatus === "completed" ? "healthy" : "degraded",
            checked_at: completedAt,
            summary:
              finalStatus === "completed"
                ? "Latest ingestion run completed."
                : "Latest ingestion run completed with row failures.",
            details: { run_id: runId, status: finalStatus },
          },
        },
      },
    ).exec();
    if (finalStatus === "completed_with_errors") {
      await emitIngestionHealthSignal({
        key: "completed_with_errors",
        run_id: runId,
        failures: applied.failures,
        skipped_dependencies: applied.skipped_dependencies,
      });
    }
    return { claimed: true, run_id: runId, status: finalStatus };
  } catch (error) {
    if (runId) {
      const markedFailed = await failRun(
        runId,
        "INGESTION_WORKER_FAILED",
        "worker",
        error instanceof Error ? error.message : "Ingestion worker failed",
        lease,
      );
      const failureClass = classifyGoogleFailure(error);
      if (
        markedFailed &&
        (failureClass === "retryable_rate_limit" ||
          failureClass === "retryable_transient")
      ) {
        const failed = await IngestionRun.findById(runId)
          .select(
            "connection_id trigger actor initiator cutoff timezone plan_snapshot plan_checksum plan_locked_at source_snapshot source_read_through",
          )
          .lean()
          .exec();
        if (failed && failed.trigger !== "retry") {
          const retry =
            failed.plan_locked_at &&
            failed.plan_snapshot &&
            failed.plan_checksum
              ? await IngestionRun.create({
                  adapter_key: "best_relocation",
                  schema_version: 2,
                  trigger: "retry",
                  status: "applying",
                  connection_id: failed.connection_id,
                  cutoff: failed.cutoff,
                  timezone: failed.timezone,
                  actor: failed.actor,
                  initiator: failed.initiator,
                  plan_snapshot: failed.plan_snapshot,
                  plan_checksum: failed.plan_checksum,
                  plan_locked_at: new Date(),
                  source_snapshot: failed.source_snapshot,
                  source_read_through: failed.source_read_through,
                })
              : await createQueuedIngestionRun({
                  connection_id: String(failed.connection_id),
                  trigger: "retry",
                  actor: failed.actor as DurableActor,
                  initiator: failed.initiator as DurableActor,
                  now: new Date(),
                });
          await publishIngestionWakeup({
            reason: "retry",
            run_hint:
              "run_id" in retry ? retry.run_id : String(retry._id),
          });
        }
      }
    }
    throw error;
  } finally {
    await leaseStore.release({ token: lease, now: new Date() });
  }
}

async function applyApprovedClaim(input: {
  run: Record<string, unknown>;
  runId: string;
  connectionId: string;
  actor: DurableActor;
  initiator: DurableActor;
  lease: LeaseToken;
  leaseStore: MongoLeaseStore;
}): Promise<{ claimed: true; run_id: string; status: string }> {
  if (!isRecord(input.run.plan_snapshot) || !input.run.plan_checksum) {
    throw new Error("Approved ingestion run has no immutable plan");
  }
  const applied = await applyBestRelocationPlan({
    plan: input.run.plan_snapshot as never,
    checksum: String(input.run.plan_checksum),
    run_id: input.runId,
    connection_id: input.connectionId,
    actor: input.actor,
    initiator: input.initiator,
    lease: input.lease,
    leaseStore: input.leaseStore,
    commands: canonicalDomainCommands,
    ...(String(input.run.trigger) === "bootstrap"
      ? {}
      : {
          assertApplicationEnabled: () =>
            assertIngestionEnabled(input.connectionId),
        }),
    start_action_index: Number(
      (
        (input.run.checkpoint as { cursor?: { action_index?: number } } | null)
          ?.cursor
      )?.action_index ?? 0,
    ),
    initial_completed_units: Number(
      (
        input.run.checkpoint as { completed_units?: number } | null
      )?.completed_units ?? 0,
    ),
    initial_failure_count: Number(
      (input.run.counters as { failures?: number } | null)?.failures ?? 0,
    ),
    initial_conflict_count: Number(
      (
        input.run.checkpoint as {
          cursor?: { conflicts?: number };
        } | null
      )?.cursor?.conflicts ?? 0,
    ),
    initial_skipped_dependency_count: Number(
      (
        input.run.checkpoint as {
          cursor?: { skipped_dependencies?: number };
        } | null
      )?.cursor?.skipped_dependencies ?? 0,
    ),
    initial_failed_action_keys:
      (
        input.run.checkpoint as {
          cursor?: { failed_action_keys?: string[] };
        } | null
      )?.cursor?.failed_action_keys ?? [],
    onCheckpoint: (checkpoint) =>
      persistWorkerCheckpoint(
        input.runId,
        input.leaseStore,
        input.lease,
        checkpoint,
      ),
  });
  const finalStatus =
    applied.failures || applied.skipped_dependencies
      ? "completed_with_errors"
      : "completed";
  const completedAt = new Date();
  const finalized = await IngestionRun.updateOne(
    leaseFilter(input.runId, input.lease, "applying"),
    {
      $set: {
        status: finalStatus,
        completed_at: completedAt,
        "counters.failures": applied.failures,
        "counters.conflicts": applied.conflicts,
        checkpoint: {
          version: Number(
            (input.run.plan_snapshot as { actions?: unknown[] }).actions?.length ??
              0,
          ) + 1,
          phase: "complete",
          cursor: {
            action_index: (
              input.run.plan_snapshot as { actions?: unknown[] }
            ).actions?.length ?? 0,
          },
          completed_units: applied.completed_units,
          updated_at: completedAt,
        },
      },
    },
  ).exec();
  if (finalized.modifiedCount !== 1) {
    throw new Error("Ingestion finalization lost the fenced run lease");
  }
  await ExternalDataConnection.updateOne(
    { _id: input.connectionId },
    {
      $set: {
        last_checked_at: completedAt,
        ...(finalStatus === "completed"
          ? { last_successful_run_at: completedAt }
          : {}),
        ...(String(input.run.trigger) === "bootstrap" &&
        finalStatus === "completed"
          ? { bootstrap_completed_at: completedAt }
          : {}),
        updated_actor: input.actor,
        "health.connection": {
          status: finalStatus === "completed" ? "healthy" : "degraded",
          checked_at: completedAt,
          summary:
            finalStatus === "completed"
              ? "Latest ingestion run completed."
              : "Latest ingestion retry completed with row failures.",
          details: { run_id: input.runId, status: finalStatus },
        },
      },
    },
  ).exec();
  if (finalStatus === "completed_with_errors") {
    await emitIngestionHealthSignal({
      key: "completed_with_errors",
      run_id: input.runId,
      failures: applied.failures,
      skipped_dependencies: applied.skipped_dependencies,
    });
  }
  return { claimed: true, run_id: input.runId, status: finalStatus };
}

async function failRun(
  runId: string,
  code: string,
  phase: string,
  summary = "Best Relocation ingestion failed structural validation.",
  lease?: LeaseToken,
): Promise<boolean> {
  const result = await IngestionRun.updateOne(
    {
      _id: runId,
      ...(lease
        ? {
            lease_owner: lease.owner,
            lease_epoch: lease.epoch,
            leased_until: { $gt: new Date() },
          }
        : {}),
      status: {
        $in: [
          "queued",
          "inspecting",
          "planning",
          "awaiting_approval",
          "applying",
        ],
      },
    },
    {
      $set: {
        status: "failed",
        completed_at: new Date(),
        failure: {
          code,
          class: "structural",
          retryable: false,
          summary,
          phase,
        },
      },
    },
  ).exec();
  if (result.modifiedCount !== 1) return false;
  await recordOperationalEvent({
    level: "error",
    eventKey: "best_relocation_ingestion.run_failed",
    category: "google_sheets",
    workflow: "best_relocation_ingestion",
    summary,
    details: { run_id: runId, code, phase },
    errorMessage: summary,
    notificationCandidate: true,
  });
  return true;
}

async function persistWorkerCheckpoint(
  runId: string,
  leaseStore: MongoLeaseStore,
  lease: LeaseToken,
  checkpoint: {
    action_index: number;
    completed_units: number;
    failures: number;
    conflicts: number;
    skipped_dependencies: number;
    failed_action_keys: string[];
  },
): Promise<void> {
  const updatedAt = new Date();
  const renewed = await leaseStore.renew({
    token: lease,
    ttl_ms: LEASE_TTL_MS,
    now: updatedAt,
  });
  if (!renewed) {
    throw new Error("Ingestion checkpoint could not renew the apply lease");
  }
  const result = await IngestionRun.updateOne(
    leaseFilter(runId, lease, "applying"),
    {
      $set: {
        checkpoint: {
          version: checkpoint.action_index,
          phase: "applying",
          cursor: {
            action_index: checkpoint.action_index,
            failed_action_keys: checkpoint.failed_action_keys,
            conflicts: checkpoint.conflicts,
            skipped_dependencies: checkpoint.skipped_dependencies,
          },
          completed_units: checkpoint.completed_units,
          updated_at: updatedAt,
        },
        "counters.failures": checkpoint.failures,
        leased_until: renewed.leased_until,
      },
    },
  ).exec();
  if (result.modifiedCount !== 1) {
    throw new Error("Ingestion checkpoint lost its fenced run lease");
  }
}

function leaseFilter(
  runId: string,
  lease: { owner: string; epoch: number },
  status: string,
): Record<string, unknown> {
  return {
    _id: runId,
    status,
    lease_owner: lease.owner,
    lease_epoch: lease.epoch,
    leased_until: { $gt: new Date() },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deploymentGateEnabled(): boolean {
  return (
    process.env.BEST_RELOCATION_INGEST_ENABLED?.trim().toLowerCase() === "true"
  );
}

async function isConnectionApplicationEnabled(
  connectionId: string,
): Promise<boolean> {
  const connection = await ExternalDataConnection.findOne({
    _id: connectionId,
    application_enabled: true,
  })
    .select("_id")
    .lean()
    .exec();
  return Boolean(connection);
}

async function assertIngestionEnabled(connectionId: string): Promise<void> {
  if (
    !deploymentGateEnabled() ||
    !(await isConnectionApplicationEnabled(connectionId))
  ) {
    throw new Error(
      "Best Relocation ingestion was disabled during apply.",
    );
  }
}

function connectionHealthFromInspection(inspection: {
  healthy: boolean;
  checked_at: string;
  checks: Array<{ key: string; status: string; summary: string }>;
}) {
  const checkedAt = new Date(inspection.checked_at);
  const summarize = (prefix: string) => {
    const checks = inspection.checks.filter((check) =>
      check.key.startsWith(prefix),
    );
    const blocking = checks.find((check) => check.status === "blocking");
    const warning = checks.find((check) => check.status === "warning");
    return {
      status: blocking ? "unhealthy" : warning ? "degraded" : "healthy",
      checked_at: checkedAt,
      summary:
        blocking?.summary ??
        warning?.summary ??
        `${prefix.replace(/:$/, "")} checks passed.`,
      details: { check_count: checks.length },
    };
  };
  return {
    connection: {
      status: inspection.healthy ? "healthy" : "unhealthy",
      checked_at: checkedAt,
      summary: inspection.healthy
        ? "Both source workbooks are accessible."
        : "Source inspection has blocking findings.",
      details: { check_count: inspection.checks.length },
    },
    schema: summarize("schema:"),
    formula: summarize("formula:"),
    identity_column: summarize("identity:"),
  };
}

async function persistPlanConflicts(
  runId: string,
  connectionId: string,
  plan: {
    actions: Array<{
      command: string;
      dataset_key: string;
      stable_source_row_id: string;
      conflict?: { type: string; severity: string };
      adopted_entity_refs?: Array<{ model: string; id: string }>;
      matching?: Record<string, unknown>;
      provenance:
        | { workbook_title: string; tab: string; sheet_row: number }
        | {
            rows: Array<{
              workbook_title: string;
              tab: string;
              sheet_row: number;
            }>;
          };
    }>;
  },
): Promise<void> {
  for (const action of plan.actions) {
    if (action.command !== "record_conflict" || !action.conflict) continue;
    const source =
      "rows" in action.provenance
        ? action.provenance.rows[0]
        : action.provenance;
    await openIngestionConflict({
      run_id: runId,
      connection_id: connectionId,
      dataset_key: action.dataset_key,
      stable_source_row_id: action.stable_source_row_id,
      type: action.conflict.type,
      severity: action.conflict.severity,
      status: "open",
      source_company_key: "best_relocation_leads",
      provenance: {
        workbook_title: source.workbook_title,
        tab: source.tab,
        row: source.sheet_row,
      },
      normalized_source_values: {},
      ranked_candidates:
        action.adopted_entity_refs ??
        (action.matching ? [action.matching] : []),
      related_canonical_ids: (action.adopted_entity_refs ?? []).map(
        (entry: { id: string }) => entry.id,
      ),
      origin: "external_sheet_ingestion",
    });
  }
}
