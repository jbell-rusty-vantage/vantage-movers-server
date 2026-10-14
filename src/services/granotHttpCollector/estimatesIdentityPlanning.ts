import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import { createMongoSourcePolicyStore, resolveSourcePolicy, type SourcePolicyStore } from "../granotLifecycle/sourcePolicy";
import { createMongoLeadIdentityStore, resolveLeadIdentity, type LeadIdentityStore } from "../granotLifecycle/identity";
import { loadGranotLeadProjection } from "../granotLifecycle/processor";
import { planLeadDesiredState } from "../granotLifecycle/leadDesiredState";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import { Types } from "mongoose";
import { normalizeGranotCrmUsername } from "../operationsRegistry";
import type { GranotFormPlanAction } from "./formWorkflow";
import type { GranotSourceCollection } from "./index";
import { buildLifecycleApply } from "./lifecycleStatement";

export type EstimatesIdentityPlanningDeps = {
  sourcePolicyStore?: SourcePolicyStore;
  identityStore?: LeadIdentityStore;
  loadLeadProjection?: typeof loadGranotLeadProjection;
};

/** A single preview reads one consistent Registry resolution per key; apply resolves it again. */
function cachedPolicyStore(store: SourcePolicyStore): SourcePolicyStore {
  function memo<T>(read: (key: string) => Promise<T>): (key: string) => Promise<T> {
    const values = new Map<string, Promise<T>>();
    return (key) => {
      let value = values.get(key);
      if (!value) { value = read(key); values.set(key, value); }
      return value;
    };
  }
  return {
    findByNormalizedLabel: memo((key) => store.findByNormalizedLabel(key)),
    findCompany: memo((key) => store.findCompany(key)),
    findGranularity: memo((key) => store.findGranularity(key)),
  };
}

/**
 * Preview eligibility uses the same normalized statement, Registry and identity ladder as apply.
 * It creates no receipt/Observation or effect, and never promotes an unmatched snapshot to creation.
 * A matched row always reaches the canonical desired-state planner, including an apparent no-op.
 */
export async function planEstimatesIdentities(
  sources: GranotSourceCollection[],
  input: EstimatesIdentityPlanningDeps & { runId: string; beforeRow?: () => Promise<void> },
): Promise<{ kind: "estimates_in_process"; schema_version: 2; actions: GranotFormPlanAction[]; counters: Record<string, number> }> {
  const policyStore = cachedPolicyStore(input.sourcePolicyStore ?? createMongoSourcePolicyStore());
  const readIdentity = input.identityStore ?? createMongoLeadIdentityStore();
  const agents = new Map<string, ReturnType<LeadIdentityStore["findActiveAgentsByUsername"]>>();
  const identityStore: LeadIdentityStore = { ...readIdentity,
    findActiveAgentsByUsername(username) {
      let matches = agents.get(username);
      if (!matches) { matches = readIdentity.findActiveAgentsByUsername(username); agents.set(username, matches); }
      return matches;
    },
  };
  const actions: GranotFormPlanAction[] = [];
  const counters: Record<string, number> = {};
  const prepared = sources.flatMap((source) => source.sections.followUpEstimates.map((row) => {
    const actionId = `${source.sourceLabel}:${row.id}`;
    const lifecycle = buildLifecycleApply({ runId: input.runId, actionId, row, sourceLabel: source.sourceLabel, section: "followUpEstimates" });
    const normalized = normalizeGranotReceipt({
      observation_channel: "granot_http_automation", captured_at: new Date(row.collectedAt ?? 0),
      channel_operation_kind: "lead_snapshot_apply", channel_operation_id: lifecycle.operation_id,
      payload: { operation_id: lifecycle.operation_id, operation_kind: "lead_snapshot_apply", granot_statement: lifecycle.granot_statement },
    });
    return { source, row, actionId, lifecycle, normalized };
  }));
  // A report contains no modification clock establishing which contradictory
  // row wins. Hold every exact normalized Job assertion in that group, across
  // sources too. Prefix-equivalent Jobs retain the canonical identity ladder;
  // this collection check does not introduce a new global equivalence policy.
  const assertions = new Map<string, Set<string>>();
  for (const { normalized } of prepared) {
    const job = normalized.identity.normalized_job_no;
    if (!job) continue;
    const values = assertions.get(job) ?? new Set<string>();
    values.add(JSON.stringify([
      normalized.normalized_source_label ?? "", normalized.priority.valid ? normalized.priority.canonical : "invalid",
      normalizeGranotCrmUsername(normalized.agent_identity.user_raw) ?? "",
      normalizeGranotCrmUsername(normalized.agent_identity.rep_raw) ?? "",
    ]));
    assertions.set(job, values);
  }
  for (const { source, row, actionId, lifecycle, normalized } of prepared) {
    await input.beforeRow?.();
    const base = {
      action_id: actionId, row_id: row.id, source_label: source.sourceLabel,
      table_section: "followUpEstimates" as const, lifecycle_apply: lifecycle,
      ...(row.collectedAt ? { collection_captured_at: row.collectedAt } : {}),
    };
    const hold = (reason: string, classification: "invalid" | "conflict" | "no_match" = "no_match", warnings: string[] = []) => {
      actions.push({ ...base, classification, reason, warnings });
      counters[reason] = (counters[reason] ?? 0) + 1;
      counters[classification] = (counters[classification] ?? 0) + 1;
    };
    if (normalized.identity.normalized_job_no && (assertions.get(normalized.identity.normalized_job_no)?.size ?? 0) > 1) { hold("conflicting_report_job_assertions", "conflict"); continue; }
    if (row.values.estimates_hold_reason) { hold(row.values.estimates_hold_reason, "invalid"); continue; }
    if (!row.collectedAt || !Number.isFinite(Date.parse(row.collectedAt))) { hold("missing_collection_time", "invalid"); continue; }
    if (normalized.normalization_result === "invalid" || !normalized.priority.valid || normalized.issues.some((issue) => issue.severity === "error")) {
      hold("invalid_normalized_snapshot", "invalid", normalized.issues.map((issue) => issue.code)); continue;
    }
    const policy = await resolveSourcePolicy({
      source_label: normalized.source_label_raw ?? "", origin_state: normalized.move.origin?.state,
      destination_state: normalized.move.destination?.state, provider_type: normalized.provider_context.type_raw,
    }, policyStore);
    if (!policy.ok) { hold(policy.reason, policy.outcome === "conflict" || policy.outcome === "ambiguous" ? "conflict" : "no_match"); continue; }
    const identity = await resolveLeadIdentity({ observation: normalized, policy: policy.snapshot }, identityStore);
    const warnings = normalized.issues.map((issue) => String(issue.code));
    if (identity.agent_assertion === "empty") warnings.push("missing_granot_username");
    else if (identity.agent_assertion === "conflict") warnings.push("conflicting_granot_username");
    else if (!identity.agent && identity.target_eligibility !== "priority_only") warnings.push("unresolved_granot_username");
    if (identity.outcome !== "linked" || !identity.target) {
      hold(identity.reason_code, identity.outcome === "conflict" || identity.outcome === "ambiguous" ? "conflict" : "no_match", warnings); continue;
    }
    if (identity.target.model !== "FormLead" && identity.target.model !== "CallLead") { hold("unexpected_identity_target", "conflict", warnings); continue; }
    const target = { model: identity.target.model, id: identity.target.id };
    if (identity.target_eligibility === "priority_only") warnings.push("priority_only_target");
    const lead = await (input.loadLeadProjection ?? loadGranotLeadProjection)(identity.target);
    if (!lead) { hold("target_missing_after_identity", "no_match", warnings); continue; }
    // An unsaved preview has no accepted Observation id. On an equal-time tie
    // the diff is conditional; apply's persisted id and transaction decide it.
    const winnerAt = lead.last_accepted_granot_observation?.captured_at;
    if (winnerAt && +winnerAt === +normalized.captured_at) warnings.push("temporal_tie_requires_apply_recheck");
    const desired = planLeadDesiredState({
      observation: { ...normalized, _id: new Types.ObjectId(), receipt_id: new Types.ObjectId(input.runId) } as GranotObservationDocument,
      identity, lead, policy: policy.snapshot, now: normalized.captured_at, attempt: 1,
      temporal_order: winnerAt && +winnerAt > +normalized.captured_at ? "older" : "newer",
    });
    actions.push({ ...base, classification: "update", lead_id: identity.target.id,
      reason: "canonical_lifecycle_snapshot_check", warnings,
      lifecycle_apply: { ...lifecycle, expected_target: target },
      desired_state_summary: { outcome: desired.outcome, reason_code: desired.reason_code,
        changed_paths: desired.changed_paths, agent_changed_paths: desired.agent_changed_paths,
        target_revision: lead.domain_revision ?? 0, conditional_on_apply: true },
    });
    counters.update = (counters.update ?? 0) + 1;
    const plannedOutcome = `planned_${desired.outcome}`;
    counters[plannedOutcome] = (counters[plannedOutcome] ?? 0) + 1;
    for (const warning of warnings) counters[`warning_${warning}`] = (counters[`warning_${warning}`] ?? 0) + 1;
  }
  return { kind: "estimates_in_process", schema_version: 2, actions, counters };
}
