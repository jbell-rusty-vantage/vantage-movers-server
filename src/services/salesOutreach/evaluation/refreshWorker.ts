import { recordWorkflowCounters } from "../../systems/workflowCounters";
import { withTransaction } from "../../../db";
import { getSalesOutreachRefreshRequestModel } from "../../../models/salesOutreach/refreshRequests";
import { salesOutreachConfigurationLoader, type ConfigurationLoader } from "../config/load";
import { CsiError } from "../../salesIntelligence/auth";
import { OutreachError } from "../errors";
import { publishOutreachLive } from "../live/publish";
import { evaluationAdmissionOf, prepareSubjectEvaluation, persistSubjectEvaluation, type EvaluationOutcome } from "./evaluateJob";
import { mongoEvaluationStore } from "./store";
import { claimSubjectRefresh, completeSubjectRefresh, refreshFingerprint, retrySubjectRefresh, type RefreshClaim } from "./refreshRequests";

export type RefreshRunResult = {
  status: string;
  mode?: "active" | "shadow";
  parity?: "match" | "different" | "not_observed";
  outcome?: EvaluationOutcome | null;
};
export async function runSubjectRefresh(claim: RefreshClaim, loader: ConfigurationLoader = salesOutreachConfigurationLoader, asOf = new Date()): Promise<RefreshRunResult> {
  const admitted = evaluationAdmissionOf(await loader.inspect());
  if (!admitted.ok) { await retrySubjectRefresh(claim); return { status: admitted.status }; }
  try {
    const result = await withTransaction(async session => {
      const current = await loader.requireActive(session);
      if (current.version !== admitted.context.configuration.version || current.revision !== admitted.context.configuration.revision)
        throw new OutreachError("CONFIGURATION_UNAVAILABLE");
      // Active-origin generations must finish after rollout is removed; shadow generations never write.
      const write = claim.requires_projection;
      const subjectId = String(claim.subject_id);
      const prepared = await prepareSubjectEvaluation(subjectId, admitted.context, asOf, mongoEvaluationStore, session, !write);
      const prior = await mongoEvaluationStore.readProjection(subjectId, session);
      const evidence = {
        input: refreshFingerprint(prepared ? { input: prepared.input, subject: prepared.subject, policy: admitted.context.policy,
          configuration: current.version, coverage: prepared.coverage, pool_result: prepared.result, as_of: asOf } : { subject_missing: subjectId }),
        output: prepared?.doc.result_fingerprint ?? refreshFingerprint({ subject_missing: subjectId }),
        requirements: refreshFingerprint(prepared ? { ordinary: prepared.ordinary, capped: prepared.capped } : null),
        parity: !prepared || !prior ? "not_observed" as const
          : prior.result_fingerprint === prepared.doc.result_fingerprint ? "match" as const : "different" as const,
      };
      let outcome: EvaluationOutcome | null = null;
      if (write && prepared) outcome = await persistSubjectEvaluation(prepared, admitted.context, mongoEvaluationStore, session);
      // `asOf` makes evaluation evidence reproducible. Lease expiry must use the
      // real completion time, otherwise a delayed or replayed worker can commit
      // after its durable claim has expired.
      await completeSubjectRefresh(claim, evidence, session);
      return { outcome, parity: evidence.parity, mode: write ? "active" as const : "shadow" as const };
    });
    recordWorkflowCounters("outreach", { completions: 1,
      ...(result.outcome ? result.outcome.outcome === "created" || result.outcome.outcome === "updated"
        ? { business_changed: 1 } : { business_unchanged: 1 } : {}) });
    if (result.outcome?.outcome === "created" || result.outcome?.outcome === "updated") await publishOutreachLive({
      topic: "outreach_desk", subject_ids: [result.outcome.subject_id], agent_ids: result.outcome.agent_ids ?? [],
      revision: result.outcome.publication_revision, cause: "evaluation",
    });
    return { status: "completed", ...result };
  } catch (error) {
    await retrySubjectRefresh(claim);
    return { status: error instanceof CsiError && error.code === "LEASE_LOST" ? "lease_lost" : "retry" };
  }
}

/** Mongo is authoritative: this bounded drain needs no queue delivery and survives configuration rollback. */
export type RefreshDrainResult = { skipped: string | null; outcomes: Record<string, number>; durations_ms: number[] };
type RefreshDrainDependencies = {
  preflight: () => Promise<string | null>;
  next: () => Promise<RefreshRunResult | null>;
  clock: () => number;
};
async function refreshDrainPreflight(): Promise<string | null> {
  const admitted = evaluationAdmissionOf(await salesOutreachConfigurationLoader.inspect());
  if (!admitted.ok) return admitted.status;
  const Model = getSalesOutreachRefreshRequestModel();
  // No collection is expected before the explicit reviewed index installation and first activation.
  const exists = await Model.db.db?.listCollections({ name: Model.collection.name }, { nameOnly: true, maxTimeMS: 3000 }).hasNext();
  if (!admitted.context.configuration.value.refresh_requests
    && (!exists || await Model.estimatedDocumentCount({ maxTimeMS: 3000 }) === 0)) return "disabled";
  return null;
}
async function runNextSubjectRefresh(): Promise<RefreshRunResult | null> {
  const claim = await claimSubjectRefresh();
  if (!claim) return null;
  recordWorkflowCounters("outreach", { claims: 1 });
  return runSubjectRefresh(claim);
}
export async function drainSubjectRefreshes(max = 100, budgetMs = 10_000,
  dependencies: Partial<RefreshDrainDependencies> = {}): Promise<RefreshDrainResult> {
  if (max <= 0 || budgetMs <= 0) return { skipped: "budget", outcomes: {}, durations_ms: [] };
  const clock = dependencies.clock ?? Date.now;
  // Admission and collection probes consume the caller's same time budget.
  const deadline = clock() + Math.min(10_000, Math.max(1, budgetMs));
  const skipped = await (dependencies.preflight ?? refreshDrainPreflight)();
  if (skipped) return { skipped, outcomes: {}, durations_ms: [] };
  const outcomes: Record<string, number> = {};
  const durations_ms: number[] = [];
  for (let i = 0; i < Math.min(100, Math.max(1, max)) && clock() < deadline; i++) {
    const started = clock();
    try {
      const result = await (dependencies.next ?? runNextSubjectRefresh)();
      if (!result) break;
      durations_ms.push(Math.max(0, clock() - started));
      outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
    } catch {
      // A claim/retry write may have committed before its response failed. Reserve
      // this slot and retain prior work so the shared legacy/refresh cap stays bounded.
      durations_ms.push(Math.max(0, clock() - started));
      outcomes.failed = (outcomes.failed ?? 0) + 1;
      return { skipped: "failed", outcomes, durations_ms };
    }
  }
  return { skipped: null, outcomes, durations_ms };
}

/** One atomic turn per single-slot drain, only when durable refresh work exists. Survives rollback/restart. */
export async function takeSingleSlotRefreshTurn(): Promise<boolean> {
  const Model = getSalesOutreachRefreshRequestModel();
  const db = Model.db.db;
  if (!db || !await db.listCollections({ name: Model.collection.name }, { nameOnly: true }).hasNext()) return false;
  if (!await Model.findOne({ pending: true }, { _id: 1 }).hint("sod_refresh_pending_due").maxTimeMS(3000).lean()) return false;
  const control = await db.collection<{ _id: string; refresh_first: boolean }>("sales_outreach_refresh_drain_control").findOneAndUpdate(
    { _id: "single-slot-v1" }, [{ $set: { refresh_first: { $not: [{ $ifNull: ["$refresh_first", false] }] } } }],
    { upsert: true, returnDocument: "after", writeConcern: { w: "majority" }, maxTimeMS: 3000 });
  return control?.refresh_first === true;
}
