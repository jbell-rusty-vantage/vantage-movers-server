import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { SourceRowReceipt } from "../../models/SourceRowReceipt";
import { SourceRowState } from "../../models/SourceRowState";
import { canonicalJson } from "../durableWork";
import type {
  BestRelocationApplicationPlan,
  BestRelocationPlanAction,
} from "./applicationPlan";
import { evaluateSourceOwnedLeadUpdate } from "./updatePolicy";

export async function applySourceChangePolicy(input: {
  connection_id: string;
  plan: BestRelocationApplicationPlan;
}): Promise<BestRelocationApplicationPlan> {
  const keyChanges = new Map<string, string>();
  const transformed: BestRelocationPlanAction[] = [];
  for (const action of input.plan.actions) {
    if (
      action.command === "unchanged" ||
      action.command === "record_conflict" ||
      action.command === "adopt_existing"
    ) {
      transformed.push(action);
      continue;
    }
    const [previous, currentState] = await Promise.all([
      SourceRowReceipt.findOne({
      connection_id: input.connection_id,
      dataset_key: action.dataset_key,
      stable_source_row_id: action.stable_source_row_id,
      outcome: { $in: ["applied", "already_applied", "adopted"] },
      })
        .sort({ createdAt: -1 })
        .select(
          "content_hash resulting_canonical_model resulting_canonical_ids last_applied_source_values",
        )
        .lean()
        .exec(),
      SourceRowState.findOne({
        connection_id: input.connection_id,
        dataset_key: action.dataset_key,
        stable_source_row_id: action.stable_source_row_id,
        schema_version: action.schema_version,
      })
        .select("source_state latest_content_hash latest_outcome")
        .lean()
        .exec(),
    ]);
    if (!previous) {
      transformed.push(action);
      continue;
    }
    const evidenceState = classifyKnownEvidence({
      previous_applied_content_hash: previous.content_hash,
      current_source_state: currentState?.source_state,
      incoming_content_hash: action.content_hash,
    });
    const revisionKey = `${action.action_key}:revision:${action.content_hash.slice(0, 16)}`;
    keyChanges.set(action.action_key, revisionKey);
    if (evidenceState === "unchanged" || evidenceState === "reappeared") {
      transformed.push(
        evidenceState === "reappeared"
          ? {
              ...withoutCommandPayload(action),
              action_key: revisionKey,
              command: "adopt_existing",
              classification: "adoption",
              adopted_entity_refs: previous.resulting_canonical_ids.map((id) => ({
                model: previous.resulting_canonical_model ?? "Unknown",
                id: String(id),
              })),
            }
          : {
              ...withoutCommandPayload(action),
              action_key: revisionKey,
              command: "unchanged",
              classification: "unchanged",
            },
      );
      continue;
    }
    if (
      currentState?.source_state === "source_missing" &&
      previous.last_applied_source_values &&
      canonicalJson(previous.last_applied_source_values) ===
        canonicalJson(
          action.source_owned_values ?? action.command_payload ?? {},
        )
    ) {
      transformed.push({
        ...withoutCommandPayload(action),
        action_key: revisionKey,
        command: "adopt_existing",
        classification: "adoption",
        adopted_entity_refs: previous.resulting_canonical_ids.map((id) => ({
          model: previous.resulting_canonical_model ?? "Unknown",
          id: String(id),
        })),
      });
      continue;
    }
    if (
      (action.command === "create_form_lead" ||
        action.command === "create_call_lead") &&
      previous.resulting_canonical_ids[0] &&
      previous.last_applied_source_values &&
      typeof previous.last_applied_source_values === "object"
    ) {
      const leadModel =
        action.command === "create_form_lead" ? "FormLead" : "CallLead";
      const canonical =
        leadModel === "FormLead"
          ? await FormLead.findById(previous.resulting_canonical_ids[0])
              .lean()
              .exec()
          : await CallLead.findById(previous.resulting_canonical_ids[0])
              .lean()
              .exec();
      if (!canonical) {
        transformed.push(
          asConflict(action, revisionKey, "canonical_divergence"),
        );
        continue;
      }
      const decision = evaluateSourceOwnedLeadUpdate({
        lead_model: leadModel,
        originated_from_best_relocation: true,
        last_applied:
          previous.last_applied_source_values as Record<string, unknown>,
        current_source: action.source_owned_values ?? action.command_payload ?? {},
        current_canonical: canonical as unknown as Record<string, unknown>,
      });
      if (decision.classification === "safe_update") {
        transformed.push({
          ...action,
          action_key: revisionKey,
          command: "update_source_owned_lead",
          classification: "safe_update",
          command_payload: {
            lead_model: leadModel,
            lead_id: String(previous.resulting_canonical_ids[0]),
            patch: decision.patch,
          },
        });
      } else if (decision.classification === "unchanged") {
        transformed.push(
          currentState?.source_state === "source_missing"
            ? {
                ...withoutCommandPayload(action),
                action_key: revisionKey,
                command: "adopt_existing",
                classification: "adoption",
                adopted_entity_refs: previous.resulting_canonical_ids.map(
                  (id) => ({
                    model: leadModel,
                    id: String(id),
                  }),
                ),
              }
            : {
                ...withoutCommandPayload(action),
                action_key: revisionKey,
                command: "unchanged",
                classification: "unchanged",
              },
        );
      } else {
        transformed.push(
          asConflict(
            action,
            revisionKey,
            decision.conflicts.some(
              (conflict) => conflict.type === "changed_protected_field",
            )
              ? "changed_protected_field"
              : "canonical_divergence",
          ),
        );
      }
      continue;
    }
    transformed.push(
      asConflict(action, revisionKey, "changed_protected_field"),
    );
  }
  const actions = transformed.map((action) => ({
    ...action,
    depends_on: action.depends_on.map(
      (dependency) => keyChanges.get(dependency) ?? dependency,
    ),
  }));
  return {
    ...input.plan,
    actions,
    counters: actions.reduce<Record<string, number>>((counts, action) => {
      counts[action.classification] =
        (counts[action.classification] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function classifyKnownEvidence(input: {
  previous_applied_content_hash?: string | null;
  current_source_state?: "present" | "source_missing" | null;
  incoming_content_hash: string;
}): "new" | "unchanged" | "reappeared" | "changed" {
  if (!input.previous_applied_content_hash) return "new";
  if (input.previous_applied_content_hash !== input.incoming_content_hash) {
    return "changed";
  }
  return input.current_source_state === "source_missing"
    ? "reappeared"
    : "unchanged";
}

function withoutCommandPayload(
  action: BestRelocationPlanAction,
): Omit<BestRelocationPlanAction, "command_payload"> {
  const { command_payload: _payload, ...rest } = action;
  return rest;
}

function asConflict(
  action: BestRelocationPlanAction,
  actionKey: string,
  type: "changed_protected_field" | "canonical_divergence",
): BestRelocationPlanAction {
  return {
    ...action,
    action_key: actionKey,
    command: "record_conflict",
    classification: "conflict",
    conflict: { type, severity: "blocking" },
  };
}
