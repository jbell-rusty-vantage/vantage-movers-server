/** Disposable redaction/reconstruction fixture; no server model, business writer or provider is loaded. */
import { ObjectId, type Db } from "mongodb";
import { computeChecksum } from "../../src/services/durableWork/checksum";
import { GRANOT_REHEARSAL, OperatorError, publicFailure } from "./local-safety";
import { withLocalDatabase } from "./local-database";

export const PRIVATE_MARKER = "Synthetic private evidence";
export async function seedGranotTrace(db: Db) {
  if (db.databaseName !== GRANOT_REHEARSAL.database) throw new OperatorError("unsafe_fixture_database");
  const run = new ObjectId(), receipt = new ObjectId(), observation = new ObjectId();
  const decision = new ObjectId(), checkpoint = new ObjectId(), lead = new ObjectId(), winner = new ObjectId();
  const action = "Synthetic source:followUpEstimates:7";
  const operation = run.toHexString() + ":" + action;
  const captured = new Date(Date.now() - 90_000);
  const locked = new Date(captured.getTime() + 1_000), approved = new Date(locked.getTime() + 1_000);
  const expires = new Date(captured.getTime() + 24 * 3_600_000);
  const plan = { schema_version: 2, kind: "estimates_in_process", counters: {}, actions: [{
    action_id: action, classification: "update", collection_captured_at: captured.toISOString(),
    lifecycle_apply: { operation_id: operation, operation_kind: "lead_snapshot_apply", granot_statement: { customer: PRIVATE_MARKER } },
  }] };
  const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
  // The trace requires the same key patterns as the deployed models. Only this fixed fixture DB is writable here.
  await db.collection("granot_webhook_receipts").createIndex({ observation_channel: 1, channel_operation_id: 1 }, {
    name: "granot_observation_receipt_channel_operation_id_unique", unique: true, partialFilterExpression: { channel_operation_id: { $type: "string" } },
  });
  await db.collection("granot_observations").createIndex({ receipt_id: 1 }, { name: "granot_observation_receipt_id_unique", unique: true });
  const target = { model: "FormLead", id: lead.toHexString() };
  await db.collection("form_leads").insertOne({
    _id: lead, name: PRIVATE_MARKER, last_accepted_granot_observation: {
      observation_id: winner, captured_at: new Date(captured.getTime() + 30_000),
    },
  });
  await db.collection("synchronization_decisions").insertMany([
    { _id: checkpoint, observation_id: observation, execution_mode: "live", attempt: 1, outcome: "pending_match",
      reason_code: "pending_source_scoped_match", effects: [], candidates: [], evaluated_gates: [], decided_at: approved },
    { _id: decision, observation_id: observation, execution_mode: "live", attempt: 2, target, outcome: "applied",
      reason_code: "lead_state_changed", effects: [{ kind: "lead_updated", ref: target, changed_paths: [PRIVATE_MARKER] }],
      candidates: [], evaluated_gates: [], decided_at: new Date(approved.getTime() + 10_000) },
  ]);
  await db.collection("granot_observations").insertOne({
    _id: observation, receipt_id: receipt, normalization_result: "valid", captured_at: captured, contact: { display_name: PRIVATE_MARKER },
  });
  await db.collection("granot_webhook_receipts").insertOne({
    _id: receipt, observation_channel: "granot_http_automation", channel_operation_id: operation, channel_operation_kind: "lead_snapshot_apply", captured_at: captured,
    payload: { customer: PRIVATE_MARKER }, processing: { state: "completed", latest_decision_id: decision },
  });
  await db.collection("granot_automation_runs").insertOne({
    _id: run, workflow: "apply", operation: "estimates_in_process", status: "applying", plan_snapshot: plan,
    plan_checksum: checksum, plan_locked_at: locked, expires_at: expires,
    approval: { approved_at: approved, plan_checksum: checksum, selected_action_ids: [action] },
    receipts: [{ action_id: action, lifecycle_receipt_id: receipt.toHexString(), observation_id: observation.toHexString(),
      decision_id: checkpoint.toHexString(), outcome: "accepted_for_processing", applied_at: approved }],
  });
  return { run, receipt, observation, decision, checkpoint, lead, winner, captured, action };
}

if (require.main === module) {
  void withLocalDatabase(GRANOT_REHEARSAL, async (db) => {
    const { run, action } = await seedGranotTrace(db);
    process.stdout.write(JSON.stringify({ profile: "granot-rehearsal", run_id: run, action_id: action }) + "\n");
  }).catch((error) => {
    const { exitCode, ...failure } = publicFailure(error);
    process.stdout.write(JSON.stringify(failure) + "\n");
    process.exitCode = exitCode;
  });
}
