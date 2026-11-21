/**
 * Retention reference holds read Form Leads by `_id` only for the plainest chain (November 20, index phase item 3).
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
type Decision = Record<string, unknown>;
const chain = (observation: mongoose.Types.ObjectId, decisions: Decision[]): ArchivedChain => ({
  observation: { _id: observation }, receipt: { _id: oid() }, decisions: decisions.map((d) => ({ _id: oid(), observation_id: observation, ...d })),
});
const form = (id: mongoose.Types.ObjectId) => ({ target: { model: "FormLead", id: String(id) } });

test("Form Lead holds: probe only the plainest chain; every other shape keeps the full scan", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  await connectMongo();
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const forms: mongoose.Types.ObjectId[] = [], calls: mongoose.Types.ObjectId[] = [], changes: mongoose.Types.ObjectId[] = [];
  const holder = async (observation: mongoose.Types.ObjectId, path = "current_move_provenance") => {
    const id = oid(); forms.push(id);
    await db.collection("form_leads").insertOne({ _id: id, [path]: { observation_id: observation } } as never);
    return id;
  };
  try {
    const cases: Array<{ name: string; chain: ArchivedChain; held: boolean }> = [];
    const add = async (name: string, decisions: (holderId: mongoose.Types.ObjectId) => Decision[], held = true, holderIsTarget = false) => {
      const observation = oid();
      const holderId = await holder(observation);
      const other = oid();
      cases.push({ name, chain: chain(observation, decisions(holderIsTarget ? holderId : other)), held });
    };
    await add("probe: one Decision targeting the holder", (id) => [form(id)], true, true);
    await add("scan: no Decision left", () => []);
    await add("scan: two Decisions", (id) => [form(id), form(id)]);
    await add("scan: an untargeted Decision", () => [{ outcome: "pending_match" }]);
    await add("scan: a Call target", (id) => [{ target: { model: "CallLead", id: String(id) } }]);
    await add("scan: target id stored as an ObjectId", (id) => [{ target: { model: "FormLead", id } }]);
    await add("scan: target id stored in uppercase", (id) => [{ target: { model: "FormLead", id: String(id).toUpperCase() } }]);
    // Decision targets Form A while Form B holds the Observation. Every current Form writer is a command, whose
    // EntityChange cites the Observation, so entity_changes holds the chain.
    const crossObservation = oid(), formA = oid();
    const formB = await holder(crossObservation);
    const change = oid(); changes.push(change);
    await db.collection("entity_changes").insertOne({ _id: change, entity: { model: "FormLead", id: String(formB) }, provenance: { observation_id: crossObservation } } as never);
    cases.push({ name: "Form A targeted, Form B holds through a command", chain: chain(crossObservation, [form(formA)]), held: true });
    // A target that moved on holds nothing.
    const moved = oid(), movedForm = oid(); forms.push(movedForm);
    await db.collection("form_leads").insertOne({ _id: movedForm, last_accepted_granot_observation: { observation_id: oid() } } as never);
    cases.push({ name: "probe: target moved on", chain: chain(moved, [form(movedForm)]), held: false });
    // Call Leads keep the full check.
    const callObservation = oid(), call = oid(); calls.push(call);
    await db.collection("call_leads").insertOne({ _id: call, ringcentral_convergence: { observation_id: callObservation } } as never);
    cases.push({ name: "Call reference", chain: chain(callObservation, []), held: true });

    const holds = await referencedChains(db as never, cases.map((c) => c.chain));
    for (const c of cases) assert.equal(holds.has(String(c.chain.observation._id)), c.held, c.name);
    // Each case alone gives the same answer.
    for (const c of cases) assert.equal((await referencedChains(db as never, [c.chain])).has(String(c.chain.observation._id)), c.held, `${c.name} (alone)`);
  } finally {
    await db.collection("form_leads").deleteMany({ _id: { $in: forms } });
    await db.collection("call_leads").deleteMany({ _id: { $in: calls } });
    await db.collection("entity_changes").deleteMany({ _id: { $in: changes } });
  }
});
