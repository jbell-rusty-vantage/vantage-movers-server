import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import { createMongoSourcePolicyStore, resolveSourcePolicy, type SourcePolicyStore } from "../granotLifecycle/sourcePolicy";
import { createMongoLeadIdentityStore, resolveLeadIdentity, type LeadIdentityStore } from "../granotLifecycle/identity";
import { loadGranotLeadProjection } from "../granotLifecycle/processor";
import { planLeadDesiredState } from "../granotLifecycle/leadDesiredState";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import { Types } from "mongoose";
import { createHash } from "node:crypto";
import { jobNumberDigitCore, jobNumbersEquivalent } from "../bookings/bookingIdentity";
import { normalizeGranotCrmUsername } from "../operationsRegistry";
import type { GranotAutomationLifecycleApply, GranotTableSection } from "./lifecycleStatement";
import type { SynchronizationMatchMethod } from "../granotLifecycle/identity";
import type { GranotSourceCollection } from "./index";
import { buildLifecycleApply } from "./lifecycleStatement";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { findFormsNeedingSiblingUpdate } from "../granotLifecycle/callLeadFormSibling";
import { getCallLeadModel } from "../../models/CallLead";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { reportingEligibleCallLeadFilter } from "../leads/callLeadAdmission";
import { logger } from "../../logger";

/**
 * Work an already-current matched row still owes, as the webhook processor does for the same row:
 * - `record_link`: the Lead has no active Record Link: the identity ladder did not reach it through one, and
 *   no active link holds the row's exact job (or that link has no Lead). The Lead command then establishes or
 *   attaches it. A link naming another Lead is never contested from an already-current row; a real change
 *   still records that dispute. A Call Lead qualifies only while reporting-eligible (`hasReportingEligibleCall`,
 *   not `created_on_unmatched`): only admitted Calls take part in the lifecycle (Owner, November 20);
 * - `form_sibling`: the Form Lead's qualified Call sibling is behind (Owner 2026-10-28 sibling rule).
 */
export type EstimatesFollowUp = "record_link" | "form_sibling";

/** Most already-current rows one plan promotes; a backlog drains over later slots, after real updates. */
export const FOLLOW_UP_PROMOTION_CAP = 50;
/** A Form whose scheduled sibling catch-up committed within this window is not promoted again (failure backoff). */
export const FORM_SIBLING_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
/** Bound on each batched follow-up read; a slow or failed read only skips follow-ups for that plan. */
export const FOLLOW_UP_READ_MAX_TIME_MS = 5_000;

/** Batched reads for follow-up detection; each runs at most once per planned run. */
export type EstimatesFollowUpStore = {
  findActiveLinks(normalizedJobs: string[]): Promise<Array<{ normalized_job_no: string; lead_ref?: { model: string; id: string } | null; disputed?: boolean }>>;
  findEligibleCallLeads(callLeadIds: string[]): Promise<Set<string>>;
  findFormsNeedingSiblingUpdate(formLeadIds: string[]): Promise<Set<string>>;
  findRecentScheduledSiblingCatchUps(formLeadIds: string[], since: Date): Promise<Set<string>>;
};

export function createMongoEstimatesFollowUpStore(): EstimatesFollowUpStore {
  return {
    async findActiveLinks(normalizedJobs) {
      if (!normalizedJobs.length) return [];
      const rows = await getGranotRecordLinkModel()
        .find({ provider: "granot", state: "active", normalized_job_no: { $in: normalizedJobs } }, { normalized_job_no: 1, lead_ref: 1, disputed: 1 })
        .maxTimeMS(FOLLOW_UP_READ_MAX_TIME_MS).lean().exec();
      return rows.map((row) => ({ normalized_job_no: row.normalized_job_no,
        lead_ref: row.lead_ref ? { model: row.lead_ref.model, id: String(row.lead_ref.id) } : null, disputed: row.disputed === true }));
    },
    async findEligibleCallLeads(ids) {
      if (!ids.length) return new Set();
      const rows = await getCallLeadModel()
        .find({ $and: [{ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, reportingEligibleCallLeadFilter(), { created_on_unmatched: { $ne: true } }] }, { _id: 1 })
        .maxTimeMS(FOLLOW_UP_READ_MAX_TIME_MS).lean().exec();
      return new Set(rows.map((row) => String(row._id)));
    },
    findFormsNeedingSiblingUpdate: (ids) => findFormsNeedingSiblingUpdate(ids, { maxTimeMS: FOLLOW_UP_READ_MAX_TIME_MS }),
    async findRecentScheduledSiblingCatchUps(ids, since) {
      if (!ids.length) return new Set();
      const decisions = await getSynchronizationDecisionModel()
        .find({ "target.model": "FormLead", "target.id": { $in: ids }, decided_at: { $gte: since }, outcome: "already_current", execution_mode: "live" },
          { observation_id: 1, "target.id": 1 })
        .maxTimeMS(FOLLOW_UP_READ_MAX_TIME_MS).lean().exec();
      if (!decisions.length) return new Set();
      // Only scheduled Observations count: a webhook Decision is not a scheduled catch-up attempt.
      const scheduled = new Set((await getGranotObservationModel()
        .find({ _id: { $in: decisions.map((row) => row.observation_id) }, scheduled_run_id: { $exists: true } }, { _id: 1 })
        .maxTimeMS(FOLLOW_UP_READ_MAX_TIME_MS).lean().exec()).map((row) => String(row._id)));
      return new Set(decisions.filter((row) => scheduled.has(String(row.observation_id))).map((row) => String(row.target?.id)));
    },
  };
}

export type EstimatesPlanAction = {
  action_id: string;
  row_id: string;
  source_label: string;
  table_section: GranotTableSection;
  classification: "update" | "unchanged" | "conflict" | "no_match" | "invalid";
  lead_id?: string;
  reason?: string;
  warnings?: string[];
  lifecycle_apply?: GranotAutomationLifecycleApply;
  /** Set only on an already-current row promoted to `update` for its follow-up work. */
  follow_up?: EstimatesFollowUp[];
  collection_captured_at?: string;
  report_identity?: {
    version: 1;
    normalized_job_sha256?: string;
    job_equivalence_sha256?: string;
    lead_model?: "FormLead" | "CallLead";
    match_method?: SynchronizationMatchMethod;
  };
  desired_state_summary?: {
    outcome: string;
    reason_code: string;
    changed_paths: string[];
    agent_changed_paths: string[];
    target_revision: number;
    conditional_on_apply: true;
  };
};

export type EstimatesIdentityPlanningDeps = {
  sourcePolicyStore?: SourcePolicyStore;
  identityStore?: LeadIdentityStore;
  loadLeadProjection?: typeof loadGranotLeadProjection;
  followUpStore?: EstimatesFollowUpStore;
  now?: () => Date;
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
): Promise<{ kind: "estimates_in_process"; schema_version: 2; actions: EstimatesPlanAction[]; counters: Record<string, number> }> {
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
  const actions: EstimatesPlanAction[] = [];
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
      report_identity: { version: 1 as const, ...(normalized.identity.normalized_job_no
        ? { normalized_job_sha256: createHash("sha256").update(normalized.identity.normalized_job_no).digest("hex"),
          job_equivalence_sha256: createHash("sha256").update(jobNumberDigitCore(normalized.identity.normalized_job_no) ?? normalized.identity.normalized_job_no).digest("hex") } : {}) },
    };
    let resolvedModel: "FormLead" | "CallLead" | undefined;
    const hold = (reason: string, classification: "invalid" | "conflict" | "no_match" = "no_match", warnings: string[] = []) => {
      actions.push({ ...base, classification, reason, warnings, report_identity: { ...base.report_identity, ...(resolvedModel ? { lead_model: resolvedModel } : {}) } });
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
    resolvedModel = policy.ok ? policy.snapshot.selected_lead_model : policy.snapshot?.selected_lead_model;
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
    const classification = desired.outcome === "applied" && desired.changed_paths.length ? "update" : "unchanged";
    actions.push({ ...base, classification, lead_id: identity.target.id,
      reason: desired.reason_code, warnings,
      lifecycle_apply: { ...lifecycle, expected_target: target },
      report_identity: { ...base.report_identity, lead_model: target.model, match_method: identity.match_method },
      desired_state_summary: { outcome: desired.outcome, reason_code: desired.reason_code,
        changed_paths: desired.changed_paths, agent_changed_paths: desired.agent_changed_paths,
        target_revision: lead.domain_revision ?? 0, conditional_on_apply: true },
    });
    counters[classification] = (counters[classification] ?? 0) + 1;
    const plannedOutcome = `planned_${desired.outcome}`;
    counters[plannedOutcome] = (counters[plannedOutcome] ?? 0) + 1;
    for (const warning of warnings) counters[`warning_${warning}`] = (counters[`warning_${warning}`] ?? 0) + 1;
  }
  // The whole declared report must support a unique Job attachment to a jobless
  // Lead. Per-row uniqueness alone otherwise lets report order choose the Job.
  const jobsByAction = new Map(prepared.map((entry) => [entry.actionId, entry.normalized.identity.normalized_job_no]));
  const attachments = new Map<string, EstimatesPlanAction[]>();
  for (const action of actions) {
    const target = action.lifecycle_apply?.expected_target;
    if (action.classification !== "update" || !target || !action.desired_state_summary?.changed_paths.some((field) => field === "job_no" || field === "normalized_job_no")) continue;
    const key = `${target.model}:${target.id}`, group = attachments.get(key) ?? [];
    group.push(action); attachments.set(key, group);
  }
  for (const group of attachments.values()) {
    const first = jobsByAction.get(group[0]!.action_id);
    if (group.every((action) => jobNumbersEquivalent(first, jobsByAction.get(action.action_id)))) continue;
    for (const action of group) {
      action.classification = "conflict";
      action.reason = "competing_target_job_attachments";
      if (action.desired_state_summary) {
        const previous = `planned_${action.desired_state_summary.outcome}`;
        counters[previous] = Math.max(0, (counters[previous] ?? 0) - 1);
        action.desired_state_summary.outcome = "conflict";
        action.desired_state_summary.reason_code = "job_number_conflict";
      }
      counters.update = Math.max(0, (counters.update ?? 0) - 1);
      counters.conflict = (counters.conflict ?? 0) + 1;
      counters.planned_conflict = (counters.planned_conflict ?? 0) + 1;
      counters.competing_target_job_attachments = (counters.competing_target_job_attachments ?? 0) + 1;
    }
  }
  await promoteFollowUps(actions, jobsByAction, counters, input.followUpStore ?? createMongoEstimatesFollowUpStore(), input.now?.() ?? new Date());
  return { kind: "estimates_in_process", schema_version: 2, actions, counters };
}

/**
 * An already-current row needs no Lead change, but the webhook processor would still establish its Record
 * Link and bring the Form's Call sibling up to date. Promote exactly those rows to `update`, marked with their
 * follow-up, so apply rechecks and performs them. At most `FOLLOW_UP_PROMOTION_CAP` rows per plan, placed after
 * the plan's real updates. A failed follow-up read promotes nothing; every other unchanged row still creates
 * no per-Lead history.
 */
async function promoteFollowUps(
  actions: EstimatesPlanAction[],
  jobsByAction: Map<string, string | undefined | null>,
  counters: Record<string, number>,
  store: EstimatesFollowUpStore,
  now: Date,
): Promise<void> {
  const current = actions.filter((action) => action.classification === "unchanged"
    && action.desired_state_summary?.outcome === "already_current" && action.lifecycle_apply?.expected_target
    && jobsByAction.get(action.action_id));
  if (!current.length) return;
  const targetIds = (model: "FormLead" | "CallLead") => [...new Set(current.flatMap((action) =>
    action.lifecycle_apply!.expected_target!.model === model ? [action.lifecycle_apply!.expected_target!.id] : []))];
  let links: Awaited<ReturnType<EstimatesFollowUpStore["findActiveLinks"]>>;
  let eligibleCalls: Set<string>, siblings: Set<string>, backedOff: Set<string>;
  try {
    links = await store.findActiveLinks([...new Set(current.map((action) => jobsByAction.get(action.action_id)!))]);
    eligibleCalls = await store.findEligibleCallLeads(targetIds("CallLead"));
    siblings = await store.findFormsNeedingSiblingUpdate(targetIds("FormLead"));
    backedOff = await store.findRecentScheduledSiblingCatchUps([...siblings], new Date(+now - FORM_SIBLING_RETRY_AFTER_MS));
  } catch (error) {
    logger.warn({ msg: "granot_estimates.follow_up_read_failed", errorName: error instanceof Error ? error.name : null });
    counters.follow_up_unavailable = 1;
    return;
  }
  const linkByJob = new Map(links.map((link) => [link.normalized_job_no, link]));
  const promoted: EstimatesPlanAction[] = [];
  for (const action of current) {
    const target = action.lifecycle_apply!.expected_target!;
    const link = linkByJob.get(jobsByAction.get(action.action_id)!);
    // A Lead the ladder reached through a Record Link (any equivalent job) already has an active link: no alias
    // link is added and no dispute is raised from an already-current row.
    const linkOwed = action.report_identity?.match_method !== "granot_record_link" && (!link || !link.lead_ref)
      && (target.model === "FormLead" || eligibleCalls.has(target.id));
    const siblingOwed = target.model === "FormLead" && siblings.has(target.id);
    if (siblingOwed && backedOff.has(target.id)) counters.follow_up_form_sibling_backoff = (counters.follow_up_form_sibling_backoff ?? 0) + 1;
    const followUp: EstimatesFollowUp[] = [
      ...(linkOwed ? ["record_link" as const] : []),
      ...(siblingOwed && !backedOff.has(target.id) ? ["form_sibling" as const] : []),
    ];
    if (!followUp.length) continue;
    if (promoted.length >= FOLLOW_UP_PROMOTION_CAP) {
      counters.follow_up_deferred = (counters.follow_up_deferred ?? 0) + 1;
      continue;
    }
    action.classification = "update";
    action.follow_up = followUp;
    promoted.push(action);
    counters.unchanged = Math.max(0, (counters.unchanged ?? 0) - 1);
    counters.update = (counters.update ?? 0) + 1;
    for (const kind of followUp) counters[`follow_up_${kind}`] = (counters[`follow_up_${kind}`] ?? 0) + 1;
  }
  // Apply processes a bounded number of actions per pass in plan order: real updates go first.
  const moved = new Set(promoted);
  actions.splice(0, actions.length, ...actions.filter((action) => !moved.has(action)), ...promoted);
}
