import type { Types } from "mongoose";
import { toObjectId } from "../../utils/objectId";
import type { ProcessorResult } from "./drainer";

type NoEffectLeadReplay = {
  decision: Types.ObjectId;
  observation: Types.ObjectId;
  lead: Types.ObjectId;
  model: "FormLead" | "CallLead";
  outcome: "already_current" | "stale";
};

export type StoredReceiptReplay = NoEffectLeadReplay | ProcessorResult;

export function storeReceiptReplay(channel: string, result: ProcessorResult): StoredReceiptReplay {
  const { target, outcome } = result;
  if (
    channel !== "granot_http_automation" || result.effects.length ||
    (outcome !== "already_current" && outcome !== "stale") ||
    (target?.model !== "FormLead" && target?.model !== "CallLead") ||
    ![result.decision_id, result.observation_id, target.id].every(id => /^[a-f0-9]{24}$/.test(id)) ||
    Object.keys(target).some(key => key !== "model" && key !== "id") ||
    Object.keys(result).some(key => !["observation_id", "decision_id", "outcome", "effects", "target"].includes(key))
  ) return result;

  return {
    decision: toObjectId(result.decision_id),
    observation: toObjectId(result.observation_id),
    lead: toObjectId(target.id),
    model: target.model,
    outcome,
  };
}

export function currentReceiptReplay(stored: StoredReceiptReplay | undefined, latest: Types.ObjectId) {
  if (!stored) return;
  if ("decision_id" in stored) return stored.decision_id === String(latest) ? stored : undefined;
  if (String(stored.decision) !== String(latest)) return;
  return {
    decision_id: String(stored.decision),
    observation_id: String(stored.observation),
    target: { model: stored.model, id: String(stored.lead) },
    outcome: stored.outcome,
    effects: [],
  } satisfies ProcessorResult;
}