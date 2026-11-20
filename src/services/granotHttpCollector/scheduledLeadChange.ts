import { createHash } from "node:crypto";
import { Types } from "mongoose";
import {
  classifyExecutionMode,
  getGranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import {
  getGranotObservationModel,
  type GranotObservationDocument,
} from "../../models/GranotObservation";
import { getCallLeadModel } from "../../models/CallLead";
import { hasReportingEligibleCall } from "../leads/callLeadAdmission";
import type { ClientSession } from "mongoose";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { refreshEstimatesPriorityChange } from "./estimatesOutreachRefresh";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import { certifyWinningLead } from "../granotLifecycle/acceptedLeadEvidence";
import type {
  ApplyAutomationActionInput,
  GranotAutomationActionReceipt,
  ScheduledPostCommitOutcome,
} from "../granotLifecycle/automationApply";
import { toAuthorizedLeadDesiredState } from "../granotLifecycle/authorizedDesiredState";
import {
  loadFormSiblingCandidates,
  mirrorFormLeadToCallSibling,
  planFormSiblingUpdate,
  SIBLING_CALL_PROJECTION,
} from "../granotLifecycle/callLeadFormSibling";
import { createMongoLeadIdentityStore } from "../granotLifecycle/identity";
import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import {
  boundedLeadLinkWake,
  defaultLoadActivation,
  granotLifecycleProcessorActor,
  LEAD_LINK_WAKE_TIMEOUT_MS,
  loadGranotLeadProjection,
  prepareDecision,
  toDecisionDocument,
} from "../granotLifecycle/processor";
import { createMongoSourcePolicyStore } from "../granotLifecycle/sourcePolicy";
import {
  applySynchronizeLeadOperation,
  finalizeSynchronizedLead,
  findExactActiveRecordLink,
} from "../granotLifecycle/synchronizeLeadFromGranot";
import type { SynchronizationOutcome } from "../granotLifecycle/types";
import { wakeLeadLinksAfterChange } from "../numberActivity/leadLinkJobs";

class SkippedChange extends Error {
  constructor(readonly outcome: SynchronizationOutcome) {
    super(outcome);
  }
}

/** Outcomes this command commits; each one persisted its Observation and Decision. */
type CommittedOutcome = "applied" | "linked" | "already_current" | "conflict";
const COMMITTED: ReadonlySet<string> = new Set<CommittedOutcome>(["applied", "linked", "already_current", "conflict"]);

/** Seams for the post-commit steps (tests); defaults are the production effects and the webhook path's 2 s bound. */
export type ScheduledLeadChangeDeps = {
  wakeLeadLinks?: typeof wakeLeadLinksAfterChange;
  mirrorFormSibling?: typeof mirrorFormLeadToCallSibling;
  postCommitTimeoutMs?: number;
};

/**
 * A scheduled action commits Observation and Decision evidence only when it does real work for its Lead:
 * - a Lead change (`applied`);
 * - a Record Link dispute the Lead command finds while applying a change, recorded once (`conflict`);
 * - for an already-current Lead without any active Record Link, that link (`linked`);
 * - for an already-current Form Lead whose qualified Call sibling is behind, an `already_current` Decision
 *   that the sibling update cites (Owner 2026-10-28 sibling rule).
 * Any other result aborts the transaction and leaves no per-Lead history.
 *
 * After commit, the Lead-link wake and the Form sibling update follow the webhook path's rule: each is bounded
 * to 2 s, never throws and its result is recorded on the action receipt (`post_commit`). The sibling update
 * never creates or qualifies a Call Lead; `callLeadFormSibling.ts` keeps its eligibility gate.
 */
export async function applyScheduledLeadChange(
  input: ApplyAutomationActionInput,
  flags = getGranotLifecycleFlags(),
  deps: ScheduledLeadChangeDeps = {},
): Promise<GranotAutomationActionReceipt> {
  const item = input.lifecycle_apply;
  const expected = item.expected_target;
  const captured = input.captured_at;
  if (
    !captured ||
    !input.request_id ||
    item.operation_kind !== "lead_snapshot_apply" ||
    item.operation_id !== `${input.request_id}:${input.action_id}`
  )
    throw new Error("Invalid scheduled Lead action");

  const actionId = (role: string) =>
    new Types.ObjectId(
      createHash("sha256")
        .update(role + ":" + item.operation_id)
        .digest("hex")
        .slice(0, 24),
    );
  const source = actionId("run-result"),
    observationId = actionId("observation"),
    decisionId = actionId("decision");
  const result = {
    action_id: input.action_id,
    scheduled_direct: true as const,
    lifecycle_receipt_id: String(source),
    applied_at: new Date(),
  };
  const skipped = (outcome: SynchronizationOutcome) => ({
    ...result,
    outcome,
    outreach_refresh_completed: true,
  });
  if (
    !expected ||
    (expected.model !== "CallLead" && expected.model !== "FormLead")
  )
    return skipped("unmatched");
  const target = { model: expected.model, id: expected.id } as const;
  const actor = granotLifecycleProcessorActor(String(source));
  const context = {
    command_id: String(actionId("command")),
    idempotency_key: "scheduled-estimate:" + String(source),
    payload_checksum: createHash("sha256")
      .update(JSON.stringify([item, captured.toISOString()]))
      .digest("hex"),
    actor,
    initiator: input.initiator,
    provenance: {
      origin: "granot_lifecycle" as const,
      run_id: input.request_id,
      source_receipt_id: String(source),
      observation_id: String(observationId),
      decision_id: String(decisionId),
      source_connection_key: null,
      observation_channel: "granot_http_automation" as const,
    },
  };
  const observation = {
    ...normalizeGranotReceipt({
      observation_channel: "granot_http_automation",
      captured_at: captured,
      channel_operation_kind: item.operation_kind,
      channel_operation_id: item.operation_id,
      payload: item,
    }),
    _id: observationId,
    receipt_id: source,
    scheduled_run_id: new Types.ObjectId(input.request_id),
  } as GranotObservationDocument;
  const activation = await defaultLoadActivation();
  const mode = classifyExecutionMode({
    captured_at: captured,
    activated_at: activation?.activated_at ?? null,
    shadow_mode: flags.shadow_mode,
  });
  let committed: CommittedOutcome | undefined;
  try {
    await executeCanonicalCommandWithPostCommit({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session, now, command_execution_id }) => {
        if (
          !flags.processing_enabled ||
          !flags.lead_writes_enabled ||
          mode !== "live"
        )
          throw new SkippedChange("policy_blocked");
        const lead = await loadGranotLeadProjection(target, session);
        if (!lead) throw new SkippedChange("unmatched");
        const prepared = await prepareDecision({
          observation,
          attempt: 1,
          execution_mode: mode,
          flags,
          decided_at: now,
          identityStore: createMongoLeadIdentityStore(session),
          sourcePolicyStore: createMongoSourcePolicyStore(session),
          leadOverride: lead,
        });
        const { decision, plan, identity } = prepared;
        if (
          identity?.outcome !== "linked" ||
          identity.target?.model !== target.model ||
          identity.target.id !== target.id
        )
          throw new SkippedChange("unmatched");
        if (!plan) throw new SkippedChange(decision.outcome === "pending_match" ? "unmatched" : decision.outcome);
        const changed = decision.outcome === "applied" && plan.changed_paths.length > 0;
        if (!changed) {
          const current = plan.outcome === "already_current" && decision.outcome === "already_current"
            && decision.evaluated_gates.every((gate) => gate.allowed);
          if (!current) throw new SkippedChange(decision.outcome === "pending_match" ? "unmatched" : decision.outcome);
          // The webhook processor's association rule (`liveAssociationNeeded`) on the exact job.
          // The Lead has no active Record Link: the ladder did not reach it through one, and no active link holds
          // the exact job (or that link has no Lead). A link naming another Lead is never contested from here.
          const link = prepared.job && identity.match_method !== "granot_record_link"
            ? await findExactActiveRecordLink(prepared.job.normalized_job_no, session) : undefined;
          // Only an admitted Call takes part in the lifecycle (Owner, November 20).
          const linkOwed = link !== undefined && !link?.lead_ref
            && (target.model === "FormLead" || await admittedCallLead(target.id, session));
          if (!linkOwed) {
            if (target.model !== "FormLead") throw new SkippedChange("already_current");
            const sibling = await loadFormSiblingCandidates(target.id, session);
            if (!sibling.form || planFormSiblingUpdate(sibling.form, sibling.jobMatches, sibling.phoneMatches, now).kind !== "update")
              throw new SkippedChange("already_current");
            // The sibling update cites this Observation and Decision; the Form Lead itself is unchanged.
            await getGranotObservationModel().create([observation], { session });
            await getSynchronizationDecisionModel().create([toDecisionDocument(decisionId, decision)], { session });
            committed = "already_current";
            return { entity_refs: [target], pending: undefined };
          }
        }
        const desired = toAuthorizedLeadDesiredState({
          plan,
          lead_model: target.model,
          temporal_winner: {
            captured_at: captured,
            observation_id: String(observationId),
          },
        });
        await getGranotObservationModel().create([observation], { session });
        const applied = await applySynchronizeLeadOperation(
          {
            context,
            lead_ref: target,
            expected_domain_revision: lead.domain_revision ?? 0,
            desired_state: desired,
            execution: {
              observation,
              identity,
              attempt: 1,
              execution_mode: mode,
              flags,
              evaluated_gates: decision.evaluated_gates,
              match_method: decision.match_method,
              candidates: decision.candidates,
              source_scope: decision.source_scope,
              job: prepared.job,
              decided_at: now,
              target,
            },
          },
          session,
          now,
          command_execution_id,
        );
        const outcome = applied.pending.outcome;
        if (outcome === "conflict") {
          // Keep the dispute the Lead command recorded; an already-disputed link leaves no new history.
          if (!applied.pending.dispute_recorded) throw new SkippedChange("conflict");
          committed = "conflict";
          return applied;
        }
        if (outcome !== (changed ? "applied" : "linked")) throw new SkippedChange(outcome);
        await certifyWinningLead(
          source,
          {
            decision_id: String(decisionId),
            observation_id: String(observationId),
            target,
            outcome,
            effects: [],
          },
          session,
        );
        if (desired.changed_paths.includes("granot_priority")) {
          await refreshEstimatesPriorityChange(target, String(source), session);
        }
        committed = outcome;
        return applied;
      },
      finalize: finalizeSynchronizedLead,
    });
  } catch (error) {
    if (error instanceof SkippedChange) return skipped(error.outcome);
    throw error;
  }
  // An idempotent replay skips the operation; the committed Decision says what it did.
  const outcome = committed ?? await committedOutcome(decisionId);
  if (!outcome) throw new Error("Scheduled Lead command committed without its Decision");
  const ids = { decision_id: String(decisionId), observation_id: String(observationId), target };
  const timeoutMs = deps.postCommitTimeoutMs ?? LEAD_LINK_WAKE_TIMEOUT_MS;
  const post_commit: ScheduledPostCommitOutcome = {};
  if (outcome === "applied" || outcome === "linked") {
    post_commit.lead_link_wake = await boundedLeadLinkWake(
      () => (deps.wakeLeadLinks ?? wakeLeadLinksAfterChange)(ids), ids.observation_id, timeoutMs);
  }
  if (target.model === "FormLead" && outcome !== "conflict") {
    let sibling: string | undefined;
    const step = await boundedLeadLinkWake(async () => {
      sibling = (await (deps.mirrorFormSibling ?? mirrorFormLeadToCallSibling)(target.id, {
        kind: "granot_lifecycle",
        actor,
        initiator: input.initiator,
        receipt_id: String(source),
        ...ids,
        observation_channel: "granot_http_automation",
      })).outcome;
    }, ids.observation_id, timeoutMs, "form_sibling_update");
    post_commit.form_sibling = step === "done" ? sibling : step;
  }
  return {
    ...result,
    decision_id: ids.decision_id,
    observation_id: ids.observation_id,
    outcome,
    outreach_refresh_completed: true,
    post_commit,
  };
}

/** A reporting-eligible Call (`hasReportingEligibleCall`) that was not created on an unmatched observation. */
async function admittedCallLead(id: string, session: ClientSession): Promise<boolean> {
  const row = await getCallLeadModel().findById(id, SIBLING_CALL_PROJECTION).session(session).lean();
  return !!row && hasReportingEligibleCall(row) && row.created_on_unmatched !== true;
}

async function committedOutcome(decisionId: Types.ObjectId): Promise<CommittedOutcome | undefined> {
  const row = await getSynchronizationDecisionModel().findById(decisionId, { outcome: 1 }).read("primary").lean();
  return row && COMMITTED.has(row.outcome) ? row.outcome as CommittedOutcome : undefined;
}
