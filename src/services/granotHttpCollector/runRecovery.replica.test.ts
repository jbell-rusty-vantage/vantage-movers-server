import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { connectMongo } from '../../db';
import { GranotAutomationRun } from '../../models/GranotAutomationRun';
import { computeChecksum } from '../durableWork';
import type { ApplyAutomationActionInput, GranotAutomationActionReceipt } from '../granotLifecycle/automationApply';
import { runGranotWorker } from './runWorkflow';
import { prepareClosedRun } from '../granotHistory/prepareClosedRun';
import { checkClosedOperation, packClosedRun, unpackClosedRun } from '../granotHistory/closedAutomationRun';
import { digest } from '../granotHistory/archiveCodec';
import { hashCredentialRedactedPayload } from '../granotLifecycle/receiptEvidence';

const actor = { actor_type: 'owner', actor_id: 'w5-recovery-proof', actor_label: 'Synthetic', actor_role: 'owner', origin: 'vantage_admin' };
async function ready(t: { skip: (reason: string) => void }) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== 'true') { t.skip('Disposable replica proof is opt-in'); return false; }
  assert.equal(process.env.TEST_MODE, 'true');
  assert.match(process.env.MONGO_URI ?? '', /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  assert.match(mongoose.connection.name, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  assert.equal(hello.setName, 'capacityp1');
  assert.ok(Array.isArray(hello.hosts) && hello.hosts.length > 0);
  for (const host of [...hello.hosts, ...(hello.passives ?? []), ...(hello.arbiters ?? [])]) assert.match(String(host), /^(127\.0\.0\.1|localhost):\d+$/);
  return true;
}
function planFor(id: Types.ObjectId) {
  return { kind: 'estimates_in_process' as const, schema_version: 2, counters: { update: 1 }, actions: [{ action_id: 'row-1', classification: 'update', collection_captured_at: '2026-10-01T00:00:00.000Z', lifecycle_apply: {
    operation_id: `${id}:row-1`, operation_kind: 'lead_snapshot_apply' as const, granot_statement: { priority: '0', job_no: 'SYNTHETIC-W5' },
  } }] };
}
async function seed(id: Types.ObjectId, expiresAt = new Date(Date.now() + 3600000)) {
  const plan = planFor(id);
  const checksum = computeChecksum({ checksum_version: 1, artifact_kind: 'ingestion_plan', schema_version: 1, payload: plan });
  await GranotAutomationRun.create({ _id: id, operation: 'estimates_in_process', workflow: 'apply', status: 'applying', request_snapshot: { auto_apply: true }, initiator: actor,
    plan_snapshot: plan, plan_checksum: checksum, plan_locked_at: new Date('2026-10-01'), approval: { selected_action_ids: ['row-1'], plan_checksum: checksum, approved_by: actor, approved_at: new Date('2026-10-01') },
    expires_at: expiresAt, purge_at: new Date(Date.now() + 86400000), last_attempt_at: new Date(0) });
  return checksum;
}
after(async () => { await mongoose.disconnect(); });

test('worker crash after canonical action but before run result replays the exact identity and checksum', async t => {
  if (!(await ready(t))) return;
  const id = new Types.ObjectId(), receiptId = new Types.ObjectId().toHexString();
  const checksum = await seed(id);
  const effects = mongoose.connection.db!.collection<{ _id: string; receipt: string }>('w5_synthetic_action_ledger');
  let calls = 0;
  const applyAction = async (input: ApplyAutomationActionInput): Promise<GranotAutomationActionReceipt> => {
    calls++;
    assert.equal(input.lifecycle_apply.operation_id, `${id}:row-1`);
    await effects.updateOne({ _id: input.lifecycle_apply.operation_id }, { $setOnInsert: { receipt: receiptId } }, { upsert: true });
    if (calls === 1) {
      // A worker that loses its run ownership cannot checkpoint or mark failure.
      await GranotAutomationRun.updateOne({ _id: id }, { $inc: { lease_epoch: 1 } });
    }
    return { action_id: input.action_id, lifecycle_receipt_id: receiptId, outcome: 'already_current', applied_at: new Date() };
  };
  try {
    await assert.rejects(runGranotWorker({ applyAction, refreshOutreach: async () => 'enqueued' }), /fenced lease/);
    const interrupted = await GranotAutomationRun.findById(id).lean();
    assert.equal(interrupted?.status, 'applying');
    assert.equal(interrupted?.receipts.length, 0);
    await GranotAutomationRun.updateOne({ _id: id }, { $set: { leased_until: new Date(0) } });
    const resumed = await runGranotWorker({ applyAction, refreshOutreach: async () => 'enqueued' });
    assert.equal(resumed.status, 'completed');
    assert.equal(await effects.countDocuments({ _id: `${id}:row-1` }), 1);
    const final = await GranotAutomationRun.findById(id).lean();
    assert.equal(calls, 2);
    assert.equal(final?.plan_checksum, checksum);
    assert.deepEqual(final?.approval, interrupted?.approval);
    assert.equal(final?.receipts.length, 1);
    assert.equal(final?.receipts[0].lifecycle_receipt_id, receiptId);
  } finally {
    await GranotAutomationRun.deleteOne({ _id: id });
    await effects.deleteOne({ _id: `${id}:row-1` });
  }
});

test('legacy expiry remains enforced: an approved run beyond normal expiry does not execute', async t => {
  if (!(await ready(t))) return;
  const id = new Types.ObjectId();
  await seed(id, new Date(Date.now() - 8 * 86400000));
  let calls = 0;
  try {
    await assert.rejects(runGranotWorker({ applyAction: async input => {
      calls++;
      return { action_id: input.action_id, lifecycle_receipt_id: '', outcome: 'technical_failure', applied_at: new Date() };
    } }), /expired or lost/);
    assert.equal(calls, 0);
    assert.equal((await GranotAutomationRun.findById(id).lean())?.status, 'failed');
  } finally { await GranotAutomationRun.deleteOne({ _id: id }); }
});

test('legacy closed-run reconstruction requires absent run, mature complete evidence and exact replay hash', async t => {
  if (!(await ready(t))) return;
  const id = new Types.ObjectId(), receipt = new Types.ObjectId(), observation = new Types.ObjectId(), decision = new Types.ObjectId();
  const db = mongoose.connection.db!, item = planFor(id).actions[0]!.lifecycle_apply;
  const receipts = db.collection('granot_webhook_receipts'), observations = db.collection('granot_observations'), decisions = db.collection('synchronization_decisions');
  const mature = new Date(Date.now() - 9 * 86400000), cutoff = new Date(Date.now() - 8 * 86400000);
  await receipts.createIndex({ observation_channel: 1, channel_operation_id: 1 }, { name: 'granot_observation_receipt_channel_operation_id_unique', unique: true, partialFilterExpression: { channel_operation_id: { $type: 'string' } } });
  await seed(id);
  try {
    await receipts.insertOne({ _id: receipt, observation_channel: 'granot_http_automation', channel_operation_id: item.operation_id, channel_operation_kind: item.operation_kind, payload_sha256: hashCredentialRedactedPayload(item).payload_sha256,
      processing: { state: 'completed', completed_at: mature, latest_decision_id: decision } });
    await observations.insertOne({ _id: observation, receipt_id: receipt });
    await decisions.insertOne({ _id: decision, observation_id: observation, outcome: 'already_current', decided_at: mature, effects: [] });
    assert.equal((await prepareClosedRun(db, String(id), cutoff)).reason, 'run_still_present');
    await GranotAutomationRun.deleteOne({ _id: id });
    const prepared = await prepareClosedRun(db, String(id), cutoff);
    assert.equal(prepared.reason, 'ready');
    if (prepared.reason !== 'ready') throw new Error('Expected complete closure');
    const index = { _id: String(id), hash: digest(prepared.bytes), count: prepared.count, closed_at: new Date() };
    const reconstructed = unpackClosedRun(index, prepared.bytes);
    assert.equal(checkClosedOperation(reconstructed, item).result.decision_id, String(decision));
    assert.deepEqual(packClosedRun(String(id), reconstructed), prepared.bytes);
    assert.throws(() => checkClosedOperation(reconstructed, { ...item, granot_statement: { ...item.granot_statement, priority: '5' } }), /different|conflict|operation/i);
    await receipts.updateOne({ _id: receipt }, { $set: { 'processing.state': 'claimed' } });
    assert.equal((await prepareClosedRun(db, String(id), cutoff)).reason, 'unfinished_or_recent');
  } finally {
    await GranotAutomationRun.deleteOne({ _id: id });
    await receipts.deleteOne({ _id: receipt }); await observations.deleteOne({ _id: observation }); await decisions.deleteOne({ _id: decision });
  }
});
