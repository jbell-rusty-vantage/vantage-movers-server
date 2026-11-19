import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { persistActionReceipt, renewRunLeaseWhenDue } from './runPersistence';
import type { GranotAutomationActionReceipt } from '../granotLifecycle/automationApply';

test('atomic receipt writes survive crash boundaries, lease loss and legacy replay on a disposable replica', async t => {
  if (process.env.GRANOT_RUN_PERSISTENCE_REPLICA_TESTS !== 'true') {
    t.skip('Opt in to localhost-only disposable replica proof.');
    return;
  }
  // Deliberately independent of application credentials, dotenv and MONGO_URI.
  const client = new MongoClient('mongodb://127.0.0.1:27216/?replicaSet=capacityp1');
  await client.connect();
  const db = client.db('testvantagemovers_capacityw5');
  const collection = db.collection('run_persistence_proof');
  try {
    const hello = await db.admin().command({ hello: 1 });
    assert.equal(hello.setName, 'capacityp1');
    assert.deepEqual(hello.hosts, ['127.0.0.1:27216']);
    const receipt: GranotAutomationActionReceipt = {
      action_id: 'source:row-1', lifecycle_receipt_id: 'canonical-receipt-1',
      outcome: 'accepted_for_processing', applied_at: new Date('2026-11-17T00:00:00Z'),
    };
    const expires = new Date(Date.now() + 60_000);
    const fence = () => ({ key: 'run', status: 'applying', lease_owner: 'owner', lease_epoch: 1, leased_until: { $gt: new Date() } });
    const write = (filter: Record<string, unknown>, update: Record<string, unknown>) => collection.updateOne(filter, update);
    const plan = { actions: [{ action_id: receipt.action_id, operation_id: `run:${receipt.action_id}` }] };
    const approval = { plan_checksum: 'unchanged-checksum', selected_action_ids: [receipt.action_id] };
    for (const crashAt of [1, 2]) {
      await collection.deleteMany({});
      await collection.insertOne({ key: 'run', status: 'applying', lease_owner: 'owner', lease_epoch: 1,
        leased_until: expires, receipts: [], plan_snapshot: plan, approval, plan_checksum: approval.plan_checksum });
      let writes = 0;
      await assert.rejects(persistActionReceipt(async (filter, update) => {
        const result = await write(filter, update);
        if (++writes === crashAt) throw new Error('worker died');
        return result;
      }, fence, receipt), /worker died/);
      await persistActionReceipt(write, fence, receipt);
      await persistActionReceipt(write, fence, receipt); // acknowledged identical replay
      const saved = await collection.findOne({ key: 'run' });
      assert.deepEqual(saved?.receipts, [receipt]);
      assert.deepEqual(saved?.plan_snapshot, plan);
      assert.deepEqual(saved?.approval, approval);
      assert.equal(saved?.plan_checksum, approval.plan_checksum);
    }
    // Duplicate wakeups can contend, but cannot append the action twice. A caller
    // that loses the conditional append retries from the durable result.
    await collection.updateOne({ key: 'run' }, { $set: { receipts: [] } });
    await Promise.allSettled([persistActionReceipt(write, fence, receipt), persistActionReceipt(write, fence, receipt)]);
    await persistActionReceipt(write, fence, receipt);
    assert.deepEqual((await collection.findOne({ key: 'run' }))?.receipts, [receipt]);
    await collection.updateOne({ key: 'run' }, { $set: { receipts: [] } });
    let firstWrite = true;
    await assert.rejects(persistActionReceipt(async (filter, update) => {
      const result = await write(filter, update);
      if (firstWrite) {
        firstWrite = false;
        await collection.updateOne({ key: 'run' }, { $set: { lease_epoch: 2 } });
      }
      return result;
    }, fence, receipt), /fenced lease/);
    assert.deepEqual((await collection.findOne({ key: 'run' }))?.receipts, []);
    await collection.updateOne({ key: 'run' }, { $set: { lease_epoch: 1 } });
    await persistActionReceipt(write, fence, receipt);
    const terminal: GranotAutomationActionReceipt = { ...receipt, outcome: 'technical_failure', error_code: 'SYNTHETIC_PARTIAL_FAILURE' };
    await persistActionReceipt(write, fence, terminal, { completed_units: 1 });
    assert.deepEqual((await collection.findOne({ key: 'run' }))?.receipts, [terminal]);
    await collection.updateOne({ key: 'run' }, { $set: { lease_epoch: 2, lease_owner: 'successor' } });
    await assert.rejects(persistActionReceipt(write, fence, receipt), /fenced lease/);
    await collection.updateOne({ key: 'run' }, { $set: { lease_epoch: 1, lease_owner: 'owner', leased_until: new Date(0) } });
    await assert.rejects(persistActionReceipt(write, fence, receipt), /fenced lease/);
    assert.deepEqual((await collection.findOne({ key: 'run' }))?.receipts, [terminal]);

    await collection.updateOne({ key: 'run' }, { $set: { leased_until: expires, receipts: [] } });
    const sizes: number[] = [];
    for (let index = 0; index < 100; index++) {
      await persistActionReceipt((filter, update) => {
        sizes.push(Buffer.byteLength(JSON.stringify({ filter, update })));
        return write(filter, update);
      }, fence, { ...receipt, action_id: `row-${String(index).padStart(3, '0')}` });
    }
    assert.equal((await collection.findOne({ key: 'run' }))?.receipts.length, 100);
    assert.equal(sizes.length, 200);
    assert.equal(Math.max(...sizes.filter((_, index) => index % 2 === 1)), Math.min(...sizes.filter((_, index) => index % 2 === 1)));
    t.diagnostic(`100 fresh actions: ${sizes.length} update commands, ${sizes.reduce((sum, size) => sum + size, 0)} JSON command bytes; constant append size ${sizes[1]} bytes (not wire/BSON or disk measurement).`);
    // The production read adapters use primary reads and the same ownership
    // predicates. Changed status/owner/epoch on either record must stop work.
    await collection.insertOne({ key: 'account', status: 'applying', lease_owner: 'owner', lease_epoch: 1, leased_until: expires });
    for (const key of ['account', 'run']) {
      for (const change of [{ lease_owner: 'successor' }, { lease_epoch: 2 }, { status: 'completed' }]) {
        await collection.updateOne({ key }, { $set: change });
        let renewal = false;
        await assert.rejects(renewRunLeaseWhenDue({
          now: Date.now,
          readAccount: () => collection.findOne({ ...fence(), key: 'account' }, { projection: { leased_until: 1 }, readPreference: 'primary' }).then(row => row ? { leased_until: row.leased_until instanceof Date ? row.leased_until : null } : null),
          readRun: () => collection.findOne(fence(), { projection: { leased_until: 1 }, readPreference: 'primary' }).then(row => row ? { leased_until: row.leased_until instanceof Date ? row.leased_until : null } : null),
          renew: async () => { renewal = true; },
        }), /lease is missing, changed or expired/);
        assert.equal(renewal, false);
        await collection.updateOne({ key }, { $set: { status: 'applying', lease_owner: 'owner', lease_epoch: 1 } });
      }
    }
  } finally {
    await collection.drop().catch(() => undefined);
    await client.close();
  }
});

test('fresh lease checks reduce writes until the earlier persisted expiry is due, including long runs', async () => {
  let now = 0, accountExpiry = 45 * 60_000, runExpiry = accountExpiry, reads = 0, renewals = 0;
  const deps = {
    now: () => now,
    readAccount: async () => { reads++; return { leased_until: new Date(accountExpiry) }; },
    readRun: async () => { reads++; return { leased_until: new Date(runExpiry) }; },
    renew: async () => { renewals++; accountExpiry = runExpiry = now + 45 * 60_000; },
  };
  for (now = 0; now < 22.5 * 60_000; now += 60_000) await renewRunLeaseWhenDue(deps);
  assert.equal(reads, 46);
  assert.equal(renewals, 0);
  await renewRunLeaseWhenDue(deps);
  assert.equal(renewals, 1);
  now = 46 * 60_000;
  await renewRunLeaseWhenDue(deps);
  assert.equal(renewals, 2);
  runExpiry = now + 4 * 60_000; // Persisted run expiry overrides the longer account/token expiry.
  await renewRunLeaseWhenDue(deps);
  assert.equal(renewals, 3);
  await Promise.all([renewRunLeaseWhenDue(deps), renewRunLeaseWhenDue(deps)]);
  assert.equal(renewals, 3); // Duplicate callbacks still read both owners without writing.
});

test('expiry or ownership loss after reads is rejected by the renewal CAS without continuation', async () => {
  let actions = 0;
  await assert.rejects((async () => {
    await renewRunLeaseWhenDue({
      now: () => 0,
      readAccount: async () => ({ leased_until: new Date(100) }),
      readRun: async () => ({ leased_until: new Date(100) }),
      renew: async () => { throw new Error('renewal CAS rejected changed owner or expiry'); },
    });
    actions++;
  })(), /renewal CAS rejected/);
  assert.equal(actions, 0);
});
