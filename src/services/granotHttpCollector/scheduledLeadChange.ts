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
import { refreshEstimatesPriorityChange } from "./estimatesOutreachRefresh";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import { certifyWinningLead } from "../granotLifecycle/acceptedLeadEvidence";
import type {
  ApplyAutomationActionInput,
  GranotAutomationActionReceipt,
} from "../granotLifecycle/automationApply";
import { toAuthorizedLeadDesiredState } from "../granotLifecycle/authorizedDesiredState";
import { mirrorFormLeadToCallSibling } from "../granotLifecycle/callLeadFormSibling";
import { createMongoLeadIdentityStore } from "../granotLifecycle/identity";
import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import {
  defaultLoadActivation,
  granotLifecycleProcessorActor,
  loadGranotLeadProjection,
  prepareDecision,
} from "../granotLifecycle/processor";
import { createMongoSourcePolicyStore } from "../granotLifecycle/sourcePolicy";
import {
  applySynchronizeLeadOperation,
  finalizeSynchronizedLead,
} from "../granotLifecycle/synchronizeLeadFromGranot";
import type { SynchronizationOutcome } from "../granotLifecycle/types";
import { wakeLeadLinksAfterChange } from "../numberActivity/leadLinkJobs";

class SkippedChange extends Error {
  constructor(readonly outcome: SynchronizationOutcome) {
    super(outcome);
  }
}

/** A changed action's source is its embedded run result. Only real changes commit
 * observation/decision evidence for the Lead's existing provenance readers. */
export async function applyScheduledLeadChange(
  input: ApplyAutomationActionInput,
  flags = getGranotLifecycleFlags(),
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
        if (
          !plan ||
          decision.outcome !== "applied" ||
          !plan.changed_paths.length
        )
          throw new SkippedChange(
            decision.outcome === "pending_match"
              ? "unmatched"
              : decision.outcome,
          );
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
        if (applied.pending.outcome !== "applied")
          throw new SkippedChange(applied.pending.outcome);
        await certifyWinningLead(
          source,
          {
            decision_id: String(decisionId),
            observation_id: String(observationId),
            target,
            outcome: "applied",
            effects: [],
          },
          session,
        );
        if (desired.changed_paths.includes("granot_priority")) {
          await refreshEstimatesPriorityChange(target, String(source), session);
        }
        return applied;
      },
      finalize: finalizeSynchronizedLead,
    });
  } catch (error) {
    if (error instanceof SkippedChange) return skipped(error.outcome);
    throw error;
  }
  const changed = {
    decision_id: String(decisionId),
    observation_id: String(observationId),
    target,
  };
  await wakeLeadLinksAfterChange(changed);
  if (target.model === "FormLead")
    await mirrorFormLeadToCallSibling(target.id, {
      kind: "granot_lifecycle",
      actor,
      initiator: input.initiator,
      receipt_id: String(source),
      ...changed,
      observation_channel: "granot_http_automation",
    });
  return {
    ...result,
    decision_id: changed.decision_id,
    observation_id: changed.observation_id,
    outcome: "applied",
    outreach_refresh_completed: true,
  };
}
