import { ObjectId, type Db, type Document } from "mongodb";
import {
  CHANNEL_OPERATION_KINDS, EXECUTION_MODES, NORMALIZATION_RESULTS, RECEIPT_WORK_STATES, SYNCHRONIZATION_EFFECT_KINDS,
  SYNCHRONIZATION_OUTCOMES, SYNCHRONIZATION_REASON_CODES, ENTITY_REF_MODELS,
} from "../../src/models/granotLifecycleSchemas";
import { assertSafeAutomationOperationId, buildAutomationOperationId } from "../../src/services/granotHttpCollector/lifecycleStatement";
import { compareGranotTemporal } from "../../src/services/granotLifecycle/granotTemporal";
import type { GranotTimelineEntry } from "../../src/services/granotLifecycle/projections";
import type { GranotAutomationActionReceipt } from "../../src/services/granotLifecycle/automationApply";
import { OperatorError } from "./local-safety";

const readOptions = { maxTimeMS: 2_000, allowDiskUse: false, batchSize: 1 };
const literal = (value: string) => ({ $literal: value });
const asId = (field: string) => ({ $convert: { input: field, to: "objectId", onError: null, onNull: null } });
const typed = (field: string, type: string) => ({ $cond: [{ $eq: [{ $type: field }, type] }, field, null] });
const enumerated = (field: string, values: readonly string[]) => ({ $cond: [{ $in: [field, values] }, field, "unknown"] });
const array = (field: string) => ({ $cond: [{ $isArray: field }, field, []] });
const traceOutcomes: readonly GranotAutomationActionReceipt["outcome"][] = [...SYNCHRONIZATION_OUTCOMES, "accepted_for_processing", "technical_failure"];
type DecisionData = Extract<GranotTimelineEntry, { type: "decision" }>["data"];

const decisionProjection = {
  decision_id: typed("$_id", "objectId"), observation_id: typed("$observation_id", "objectId"),
  execution_mode: enumerated("$execution_mode", EXECUTION_MODES),
  outcome: enumerated("$outcome", SYNCHRONIZATION_OUTCOMES),
  reason_code: enumerated("$reason_code", SYNCHRONIZATION_REASON_CODES),
  target_model: enumerated("$target.model", ENTITY_REF_MODELS),
  target_id: asId("$target.id"),
  // Only the closed vocabulary of effect kinds crosses the read boundary.
  effect_kinds: { $setIntersection: [array("$effects.kind"), SYNCHRONIZATION_EFFECT_KINDS] },
  target_lead_effect_kinds: { $setIntersection: [["lead_created", "lead_updated"], { $map: {
    input: { $filter: { input: array("$effects"), as: "effect", cond: { $and: [
      { $in: ["$target.model", ["FormLead", "CallLead"]] }, { $eq: ["$$effect.ref.model", "$target.model"] },
      { $eq: ["$$effect.ref.id", "$target.id"] },
    ] } } }, as: "matched", in: "$$matched.kind",
  } }] },
  next_match_attempt_at: typed("$next_match_attempt_at", "date"),
} satisfies Record<Exclude<keyof DecisionData, "target" | "effects"> | "target_model" | "target_id" | "effect_kinds" | "target_lead_effect_kinds" | "next_match_attempt_at", unknown>;

/** All lookups use an exact indexed key and return at most one scalar projection. */
async function one(db: Db, collection: string, match: Document, project: Document, hint: string | Document = "_id_") {
  return db.collection(collection).aggregate([
    { $match: match }, { $limit: 1 }, { $project: { _id: 0, ...project } },
  ], { ...readOptions, hint }).next();
}

async function readRunAction(db: Db, runId: ObjectId, actionId: string, operationId: string) {
  const selected = literal(actionId);
  const matching = (path: string) => ({ $filter: {
    input: array(path), as: "entry", cond: { $eq: ["$$entry.action_id", selected] }, limit: 2,
  } });
  const checksum = { $cond: [{ $eq: [{ $type: "$plan_checksum" }, "string"] }, "$plan_checksum", ""] };
  return db.collection("granot_automation_runs").aggregate([
    { $match: { _id: runId } }, { $limit: 1 },
    { $project: {
      status: enumerated("$status", ["queued", "planning", "awaiting_approval", "applying", "completed", "completed_with_errors", "failed", "expired"]),
      workflow: enumerated("$workflow", ["apply", "preview"]),
      operation: enumerated("$operation", ["form_leads", "call_leads", "estimates_in_process"]),
      expires_at: typed("$expires_at", "date"), plan_locked_at: typed("$plan_locked_at", "date"),
      approved_at: typed("$approval.approved_at", "date"),
      checksum_matches: { $and: [{ $regexMatch: { input: checksum, regex: "^[0-9a-f]{64}$" } },
        { $eq: ["$approval.plan_checksum", "$plan_checksum"] }] },
      schema_v2: { $eq: ["$plan_snapshot.schema_version", 2] },
      selected: { $in: [selected, array("$approval.selected_action_ids")] },
      actions: matching("$plan_snapshot.actions"), receipts: matching("$receipts"),
    } },
    { $set: { action: { $first: "$actions" }, receipt: { $first: "$receipts" } } },
    { $project: {
      _id: 0, run_id: "$_id", status: 1, workflow: 1, operation: 1, expires_at: 1, plan_locked_at: 1,
      approved_at: 1, checksum_matches: 1, schema_v2: 1, selected: 1,
      action_count: { $size: "$actions" }, receipt_count: { $size: "$receipts" },
      operation_kind: enumerated("$action.lifecycle_apply.operation_kind", CHANNEL_OPERATION_KINDS),
      statement_object_present: { $eq: [{ $type: "$action.lifecycle_apply.granot_statement" }, "object"] },
      collection_captured_at: { $convert: { input: "$action.collection_captured_at", to: "date", onNull: null, onError: null } },
      capture_conflict: { $eq: ["$receipt.error_code", "GRANOT_OPERATION_IDEMPOTENCY_CONFLICT"] },
      observation_pointer_invalid: { $and: [{ $ne: [{ $ifNull: ["$receipt.observation_id", null] }, null] }, { $eq: [asId("$receipt.observation_id"), null] }] },
      decision_pointer_invalid: { $and: [{ $ne: [{ $ifNull: ["$receipt.decision_id", null] }, null] }, { $eq: [asId("$receipt.decision_id"), null] }] },
      operation_matches: { $eq: ["$action.lifecycle_apply.operation_id", literal(operationId)] },
      lifecycle_receipt_id: asId("$receipt.lifecycle_receipt_id"), observation_id: asId("$receipt.observation_id"),
      decision_id: asId("$receipt.decision_id"), outcome: enumerated("$receipt.outcome", traceOutcomes),
    } },
  ], { ...readOptions, hint: "_id_" }).next();
}

export async function traceGranotAction(db: Db, run: string, actionId: string) {
  const runId = run.toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(runId) || !actionId || actionId.trim() !== actionId) throw new OperatorError("invalid_arguments", 2);
  const operationId = buildAutomationOperationId(runId, actionId);
  try { assertSafeAutomationOperationId(operationId); } catch { throw new OperatorError("invalid_arguments", 2); }

  const data: { run: Document | null; action: Document | null; receipt: Document | null;
    observation: Document | null; decision: Document | null; lead: Document | null } =
    { run: null, action: null, receipt: null, observation: null, decision: null, lead: null };
  const finish = (stop: string, status = "partial") => ({ status, stop, ...data });
  const row = await readRunAction(db, new ObjectId(runId), actionId, operationId);
  if (!row) return finish("run_missing");
  const { run_id, status, operation, workflow, expires_at, plan_locked_at, approved_at, checksum_matches, schema_v2 } = row;
  data.run = { run_id, status, operation, workflow, expires_at, plan_locked_at, approved_at, checksum_matches, schema_v2 };
  data.action = { present: row.action_count > 0, selected: row.selected, operation_matches: row.operation_matches,
    operation_kind: row.operation_kind, statement_object_present: row.statement_object_present, collection_captured_at: row.collection_captured_at,
    run_receipt_present: row.receipt_count > 0, recorded_outcome: row.receipt_count ? row.outcome : null,
    recorded_receipt_id: row.lifecycle_receipt_id, recorded_observation_id: row.observation_id, recorded_decision_id: row.decision_id };
  if (!row.action_count) return finish("action_missing");
  if (row.action_count > 1 || row.receipt_count > 1) return finish("ambiguous_run_evidence");
  if (!row.selected) return finish("action_not_selected");
  if (workflow !== "apply" || !schema_v2 || !plan_locked_at || !approved_at || !checksum_matches || !row.operation_matches || !row.statement_object_present || row.operation_kind === "unknown") return finish("approval_evidence_incomplete");

  if (row.capture_conflict) return finish("operation_idempotency_conflict");
  if (row.receipt_count && !row.lifecycle_receipt_id) return finish("run_receipt_pointer_invalid");
  if (row.observation_pointer_invalid || row.decision_pointer_invalid) return finish("run_checkpoint_pointer_invalid");

  const receipt = await one(db, "granot_webhook_receipts", { observation_channel: "granot_http_automation", channel_operation_id: operationId }, {
    receipt_id: typed("$_id", "objectId"), operation_kind: enumerated("$channel_operation_kind", CHANNEL_OPERATION_KINDS),
    captured_at: typed("$captured_at", "date"), state: enumerated("$processing.state", RECEIPT_WORK_STATES),
    next_attempt_at: typed("$processing.next_attempt_at", "date"), leased_until: typed("$processing.leased_until", "date"),
    latest_decision_id: typed("$processing.latest_decision_id", "objectId"),
    evidence_released: { $ne: [{ $type: "$evidence_archive" }, "missing"] },
  }, { observation_channel: 1, channel_operation_id: 1 });
  if (!receipt) return finish("operation_receipt_missing");
  data.receipt = { ...receipt, matches_sealed_capture_time: row.collection_captured_at && receipt.captured_at
    ? row.collection_captured_at.getTime() === receipt.captured_at.getTime() : null };
  if (!receipt.receipt_id) return finish("receipt_id_invalid");
  if (receipt.operation_kind !== row.operation_kind) return finish("receipt_operation_kind_mismatch");
  if (!row.receipt_count) return finish("operation_key_correlation_only");
  if (row.lifecycle_receipt_id && !row.lifecycle_receipt_id.equals(receipt.receipt_id)) return finish("run_receipt_pointer_mismatch");

  const observation = await one(db, "granot_observations", { receipt_id: receipt.receipt_id }, {
    observation_id: typed("$_id", "objectId"), receipt_id: typed("$receipt_id", "objectId"), captured_at: typed("$captured_at", "date"),
    normalization_result: enumerated("$normalization_result", NORMALIZATION_RESULTS),
  }, { receipt_id: 1 });
  // The Lead evidence pass (including the proven-winner release) moved it to GCS; read it with ops/granot-read-archived-evidence.ts.
  if (!observation) return finish(receipt.evidence_released ? "observation_released_to_gcs" : "observation_missing");
  data.observation = observation;
  if (!observation.observation_id) return finish("observation_id_invalid");
  if (row.observation_id && !row.observation_id.equals(observation.observation_id)) return finish("run_observation_pointer_mismatch");
  if (!receipt.latest_decision_id) return finish("latest_decision_pointer_missing");
  const decision = await one(db, "synchronization_decisions",
    { _id: receipt.latest_decision_id, observation_id: observation.observation_id }, decisionProjection);
  if (!decision) return finish("linked_decision_missing");
  data.decision = { ...decision, matches_run_checkpoint: row.decision_id ? row.decision_id.equals(decision.decision_id) : null };
  if (!["FormLead", "CallLead"].includes(decision.target_model)) return finish("no_canonical_lead_target");
  if (!decision.target_id) return finish("lead_target_id_invalid");
  const lead = await one(db, decision.target_model === "FormLead" ? "form_leads" : "call_leads", { _id: decision.target_id }, {
    lead_id: "$_id", winner_id: typed("$last_accepted_granot_observation.observation_id", "objectId"),
    winner_captured_at: typed("$last_accepted_granot_observation.captured_at", "date"),
    certificate_v2: { $eq: ["$last_accepted_granot_observation.evidence.version", 2] },
    certificate_outcome: enumerated("$last_accepted_granot_observation.evidence.outcome", SYNCHRONIZATION_OUTCOMES),
    certified_decision_id: typed("$last_accepted_granot_observation.evidence.decision_id", "objectId"),
    certified_receipt_id: typed("$last_accepted_granot_observation.evidence.receipt_id", "objectId"),
  });
  if (!lead) return finish("lead_missing");
  const order = lead.winner_id && lead.winner_captured_at && observation.captured_at
    ? compareGranotTemporal({ captured_at: observation.captured_at, observation_id: String(observation.observation_id) },
        { captured_at: lead.winner_captured_at, observation_id: String(lead.winner_id) }) : "unknown";
  data.lead = { ...lead, model: decision.target_model, observation_vs_current_winner: order,
    certified_for_this_decision: order === "same" && lead.certificate_v2 && lead.certificate_outcome === decision.outcome
      && decision.execution_mode === "live" && ["created", "applied", "linked", "already_current"].includes(decision.outcome)
      && !!lead.certified_decision_id?.equals(decision.decision_id)
      && !!lead.certified_receipt_id?.equals(receipt.receipt_id) };
  return finish("canonical_lead_read", "traced");
}
