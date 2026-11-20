/**
 * Retention reference holds read Form Leads by their Decision target `_id` (November 20, index phase item 4A).
 * Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true with TEST_MODE=true on a loopback replica.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import type { ArchivedChain } from "./archiveCodec";
import { referencedChains } from "./retentionReferences";

after(async () => { await mongoose.disconnect().catch(() => undefined); });
const oid = () => new mongoose.Types.ObjectId();

test("a Form Lead target holds its referenced chain; a target that moved on holds nothing; a decisionless chain keeps the scan; Call Leads keep the full check", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  await connectMongo();
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const [held, movedOn, callHeld, unreferenced, decisionless] = [oid(), oid(), oid(), oid(), oid()];
  const [heldForm, movedForm, call, olderForm] = [oid(), oid(), oid(), oid()];
  const chain = (observation: mongoose.Types.ObjectId, target?: { model: string; id: string }): ArchivedChain => ({
    observation: { _id: observation }, receipt: { _id: oid() }, decisions: [{ _id: oid(), observation_id: observation, ...(target ? { target } : {}) }],
  });
  const chains = [
    chain(held, { model: "FormLead", id: String(heldForm) }),
    chain(movedOn, { model: "FormLead", id: String(movedForm) }),
    // A Call reference whose Decision has no target: Call Leads are still scanned by path.
    chain(callHeld),
    chain(unreferenced, { model: "FormLead", id: String(oid()) }),
    // An older lead_created Observation with no Decision left: nothing names its Lead, so Forms are scanned.
    { observation: { _id: decisionless }, receipt: { _id: oid() }, decisions: [] },
  ];
  await db.collection("form_leads").insertMany([
    { _id: heldForm, current_move_provenance: { observation_id: held } },
    { _id: movedForm, last_accepted_granot_observation: { observation_id: oid() } },
    { _id: olderForm, granot_contact_snapshot: { observation_id: decisionless } },
  ] as never[]);
  await db.collection("call_leads").insertOne({ _id: call, ringcentral_convergence: { observation_id: callHeld } } as never);
  try {
    const holds = await referencedChains(db as never, chains);
    assert.deepEqual([...holds.keys()].sort(), [String(held), String(callHeld), String(decisionless)].sort());
    assert.deepEqual([...holds.get(String(decisionless))!], ["form_leads.granot_contact_snapshot.observation_id"]);
    assert.deepEqual([...holds.get(String(held))!], ["form_leads.current_move_provenance.observation_id"]);
    assert.deepEqual([...holds.get(String(callHeld))!], ["call_leads.ringcentral_convergence.observation_id"]);
    // With no Form Lead target in the batch, form_leads is not read at all.
    const callOnly = await referencedChains(db as never, [chain(callHeld)]);
    assert.deepEqual([...callOnly.keys()], [String(callHeld)]);
  } finally {
    await db.collection("form_leads").deleteMany({ _id: { $in: [heldForm, movedForm, olderForm] } });
    await db.collection("call_leads").deleteOne({ _id: call });
  }
});
