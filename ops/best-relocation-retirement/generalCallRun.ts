import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain";
import type { DurableActor } from "../../src/services/durableWork/types";
import { applyCallBackfill, verifyCallBackfill, callBackfillPlanChecksum, CALL_BACKFILL_FROM,
  CALL_BACKFILL_VERSION, type CallBackfillDependencies, type CallBackfillPlan } from "./callBackfill";

export const GENERAL_CALL_RUN_VERSION = "general-call-reporting-run-v1";
export const generalCallRunScope = (runId: string) => `lead-reporting:general-call-backfill:${runId}`;
type ApplyResult = Awaited<ReturnType<typeof applyCallBackfill>>;
type VerificationResult = Awaited<ReturnType<typeof verifyCallBackfill>>;
export type GeneralCallRunBinding = {
  version: typeof GENERAL_CALL_RUN_VERSION; run_id: string; database: string;
  plan_version: typeof CALL_BACKFILL_VERSION; plan_checksum: string; deployment_id: string;
  from: typeof CALL_BACKFILL_FROM; through: string;
};
export type GeneralCallRunState = GeneralCallRunBinding & {
  created_at: Date; applied?: boolean; apply_started_at?: Date; applied_at?: Date;
  apply_summary?: { completed: number; conflicts: number; unresolved: number };
  verified_at?: Date | null; verification_summary?: { complete: boolean; mismatches: number; unresolved: number; planned: number; observed: number } | null;
};
export type GeneralCallRunLedger = { scope: string; general_call_backfill?: GeneralCallRunState };
export interface GeneralCallRunLedgerStore {
  bind(scope: string, binding: GeneralCallRunBinding, now: Date): Promise<GeneralCallRunLedger>;
  read(scope: string): Promise<GeneralCallRunLedger | null>;
  patch(scope: string, binding: GeneralCallRunBinding, patch: Partial<GeneralCallRunState>): Promise<boolean>;
}
export type GeneralCallRunDependencies = {
  connect(): Promise<void>; database(): string; ledger: GeneralCallRunLedgerStore;
  callDependencies: Partial<CallBackfillDependencies>; now(): Date;
};
export type GeneralCallRunInput = {
  plan: CallBackfillPlan; checksum: string; expectedDatabase: string; deploymentId: string;
  runId: string; owner: DurableActor; assertLease(): Promise<void>;
};
type VerifyInput = GeneralCallRunInput & Parameters<typeof verifyCallBackfill>[1];
const READ_MS = 8000;

/** Existing exact-scope state collection; only this operator's own subdocument is written. */
function defaultLedger(): GeneralCallRunLedgerStore {
  const collection = () => mongoose.connection.getClient().db(getMongoDatabaseName()).collection<GeneralCallRunLedger>("sales_intelligence_sync_state");
  const filter = (scope: string, binding: GeneralCallRunBinding) => ({ scope,
    ...Object.fromEntries(Object.entries(binding).map(([key, value]) => [`general_call_backfill.${key}`, value])),
  });
  return {
    async bind(scope, binding, now) {
      await collection().updateOne({ scope }, { $setOnInsert: { scope, general_call_backfill: { ...binding, created_at: now } } }, { upsert: true, maxTimeMS: READ_MS });
      const row = await collection().findOne({ scope }, { maxTimeMS: READ_MS });
      if (!row) throw new Error("general_call_run_binding_missing");
      return row;
    },
    read: scope => collection().findOne({ scope }, { maxTimeMS: READ_MS }),
    async patch(scope, binding, patch) {
      const result = await collection().updateOne(filter(scope, binding), {
        $set: Object.fromEntries(Object.entries(patch).map(([key, value]) => [`general_call_backfill.${key}`, value])),
      }, { maxTimeMS: READ_MS });
      return result.matchedCount === 1;
    },
  };
}
function defaults(): GeneralCallRunDependencies {
  return { connect: connectMongo, database: getMongoDatabaseName, ledger: defaultLedger(), callDependencies: {}, now: () => new Date() };
}
function validate(input: GeneralCallRunInput, database: string): GeneralCallRunBinding {
  const plan = input.plan;
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(input.runId)) throw new Error("general_call_run_id_invalid");
  if (!/^[a-f0-9]{40}$/.test(input.deploymentId) || plan.deployment_id !== input.deploymentId) throw new Error("general_call_run_deployment_mismatch");
  if (database !== input.expectedDatabase || plan.database !== database) throw new Error("general_call_run_database_mismatch");
  if (input.checksum !== plan.checksum || callBackfillPlanChecksum(plan) !== input.checksum || plan.version !== CALL_BACKFILL_VERSION ||
      plan.from !== CALL_BACKFILL_FROM || !/(?:Z|[+-]\d\d:\d\d)$/.test(plan.through) || !Number.isFinite(Date.parse(plan.through)) ||
      Date.parse(plan.through) < Date.parse(CALL_BACKFILL_FROM) || !Number.isFinite(plan.timestamp_padding_ms) || plan.timestamp_padding_ms < 6 * 3600000) {
    throw new Error("general_call_run_plan_mismatch");
  }
  if (!["owner", "admin"].includes(input.owner.actor_type) || input.owner.origin !== "vantage_admin") throw new Error("general_call_run_owner_required");
  return { version: GENERAL_CALL_RUN_VERSION, run_id: input.runId, database, plan_version: plan.version,
    plan_checksum: plan.checksum, deployment_id: input.deploymentId, from: plan.from, through: plan.through };
}
function assertBinding(row: GeneralCallRunLedger | null, scope: string, binding: GeneralCallRunBinding): GeneralCallRunState {
  const state = row?.general_call_backfill;
  if (row?.scope !== scope || !state || Object.entries(binding).some(([key, value]) => state[key as keyof GeneralCallRunBinding] !== value)) {
    throw new Error("general_call_run_immutable_binding_mismatch");
  }
  return state;
}
async function writeState(deps: GeneralCallRunDependencies, input: GeneralCallRunInput, scope: string, binding: GeneralCallRunBinding, patch: Partial<GeneralCallRunState>) {
  await input.assertLease();
  if (!await deps.ledger.patch(scope, binding, patch)) throw new Error("general_call_run_binding_changed");
}

/** No external ingestion ledger, source receipt, or Best Relocation completion claim. */
export async function applyGeneralCallRun(input: GeneralCallRunInput, overrides: Partial<GeneralCallRunDependencies> = {}): Promise<ApplyResult & { run_id: string; ledger_scope: string }> {
  const deps = { ...defaults(), ...overrides };
  const binding = validate(input, deps.database()), scope = generalCallRunScope(input.runId);
  await deps.connect();
  validate(input, deps.database());
  await input.assertLease();
  assertBinding(await deps.ledger.bind(scope, binding, deps.now()), scope, binding);
  // A crash or failed traversal cannot reuse a previous successful apply/verification claim.
  await writeState(deps, input, scope, binding, { applied: false, apply_started_at: deps.now(), verified_at: null, verification_summary: null });
  const result = await applyCallBackfill(input.plan, input, deps.callDependencies);
  await writeState(deps, input, scope, binding, { applied: true, applied_at: deps.now(),
    apply_summary: { completed: result.completed.length, conflicts: result.conflicts.length, unresolved: result.unresolved.length } });
  return { ...result, run_id: input.runId, ledger_scope: scope };
}

/** Independently verifies coverage and physical membership after the bound apply and drain. */
export async function verifyGeneralCallRun(input: VerifyInput, overrides: Partial<GeneralCallRunDependencies> = {}): Promise<VerificationResult & { run_id: string; ledger_scope: string }> {
  const deps = { ...defaults(), ...overrides };
  const binding = validate(input, deps.database()), scope = generalCallRunScope(input.runId);
  await deps.connect();
  validate(input, deps.database());
  await input.assertLease();
  const state = assertBinding(await deps.ledger.read(scope), scope, binding);
  if (state.applied !== true || !(state.applied_at instanceof Date) || !state.apply_summary) throw new Error("general_call_run_apply_required");
  const result = await verifyCallBackfill(input.plan, { readMembership: input.readMembership }, deps.callDependencies);
  if (state.apply_summary.conflicts > 0) {
    result.complete = false;
    result.mismatches.push({ lead_id: "", reason: "general_call_run_apply_conflicts" });
  }
  await writeState(deps, input, scope, binding, { verified_at: deps.now(), verification_summary: {
    complete: result.complete, mismatches: result.mismatches.length, unresolved: result.unresolved.length,
    planned: result.coverage.planned, observed: result.coverage.observed,
  } });
  return { ...result, run_id: input.runId, ledger_scope: scope };
}
