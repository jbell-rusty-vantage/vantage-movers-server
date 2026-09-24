import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { readClosedHistory } from "../../src/services/salesIntelligence/outreach/closedHistory";
import { priorityLabel } from "../../src/services/salesIntelligence/outreach/leadProgress";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";

/**
 * S7-CLOSED (assignment addendum §2.2a, E27; acceptance C14). Closed history returns a record closed
 * 200 days ago with the snapshot's outcome line; the `(closed_at, _id)` keyset neither repeats nor skips
 * older rows while new closures land between pages; `outcome` / `priority` / `agent_id` / range filters
 * match the Closed view; read counts don't grow with the page size; p95 < 300 ms at a few thousand closures.
 */
const READ_METHODS = new Set(["find", "findOne", "aggregate", "distinct", "countDocuments", "estimatedDocumentCount", "count"]);
const DAY = 86_400_000;

test("S7-CLOSED disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3cclosed");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel();
  const agentA = oid(), agentB = oid();
  await db.collection("agents").insertMany([{ _id: agentA, name: "Synthetic Rep A", active: true }, { _id: agentB, name: "Synthetic Rep B", active: true }]);
  let serial = 0;
  type Closure = { reason: string; origin: "official" | "crm_disposition" | "owner"; daysAgo: number; code?: string | null; responsible?: mongoose.Types.ObjectId };
  async function closedRecord(closure: Closure) {
    const n = ++serial;
    const lead = { _id: oid(), timestamp: new Date(Date.now() - (closure.daysAgo + 2) * DAY), createdAt: new Date(), updatedAt: new Date(), name: `Synthetic Closed ${n}`,
      job_no: `T3C-${n}`, normalized_phone_number: `555061${String(n).padStart(4, "0")}` };
    await getFormLeadModel().collection.insertOne(lead);
    const record = await withTransaction(session => ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), new Date())));
    const set: Record<string, unknown> = { state: "closed", closed_at: new Date(Date.now() - closure.daysAgo * DAY), closed_reason: closure.reason, closure_origin: closure.origin,
      responsible_agent_id: closure.responsible ?? null };
    if (closure.code !== undefined && closure.code !== null) set["lead_progress"] = { granot_priority: closure.code, quoted: closure.code === "1", disposition: "crm_dead", work_observed: true,
      basis: "priority_assigned", provenance: "accepted", source_origin: "granot", source_applied_at: new Date(), last_progress_at: new Date(), first_work_observed_at: null,
      override: null, reopen_review_id: null, disposition_revision: `r${n}`, projected_at: new Date(), fingerprint: `f${n}` };
    await Records.collection.updateOne({ _id: record!._id }, { $set: set });
    if (closure.reason === "booked") await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: lead._id, agent: agentA,
      book_date: new Date(Date.now() - closure.daysAgo * DAY), job_no: lead.job_no, total_binder_amount: 900 });
    return { lead, id: String(record!._id) };
  }
  async function countReads<T>(work: () => Promise<T>) {
    const byCollection: Record<string, number> = {};
    let reads = 0;
    mongoose.set("debug", (collection: string, method: string) => {
      if (!READ_METHODS.has(method)) return;
      reads++;
      byCollection[`${collection}.${method}`] = (byCollection[`${collection}.${method}`] ?? 0) + 1;
    });
    try { return { result: await work(), reads, byCollection }; } finally { mongoose.set("debug", false); }
  }
  async function allHistory(query: Record<string, unknown>, between?: () => Promise<void>) {
    const out: AttentionRowDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await readClosedHistory({ ...query, ...(cursor ? { cursor } : {}) } as never);
      out.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
      if (cursor && between) await between();
    } while (cursor);
    return out;
  }
  const idOf = (row: AttentionRowDto) => row.outreach!.id;

  try {
    const recent = await closedRecord({ reason: "booked", origin: "official", daysAgo: 3, code: "1", responsible: agentA });
    const old200 = await closedRecord({ reason: "granot_dead_opportunity", origin: "crm_disposition", daysAgo: 200, code: "8", responsible: agentB });
    const owner120 = await closedRecord({ reason: "lost", origin: "owner", daysAgo: 120, code: null });
    const bad400 = await closedRecord({ reason: "granot_bad_unusable", origin: "crm_disposition", daysAgo: 400, code: "7" });
    const noOutcome = await closedRecord({ reason: "lead_context_available", origin: "official", daysAgo: 150 });
    // A promise by rep A on a record B is responsible for: the agents key is responsible ∪ follow-up responsible ∪ promised (V10).
    await getOutreachFollowupModel().collection.insertOne({ outreach_record_id: new mongoose.Types.ObjectId(old200.id), commitment_key: `synthetic:${old200.id}`, kind: "call",
      description: "Call back", status: "completed", due_at: new Date(Date.now() - 201 * DAY), date_text: null, date_resolution: null, base_attention_due_at: null, attention_due_at: null,
      snoozed_until: null, wait_expired_at: null, missed_episode_key: null, trigger_interaction_ids: [], first_missed_at: null, responsible_agent_id: agentB, assignment: null,
      promised_by_agent_id: agentA, requested_by: "rep", origin: "rep_promise", source_finding_ids: [], origin_run_id: null, owner_instruction_ids: [], disposition: "no_answer",
      completion_basis: "call_attempt", completed_at: new Date(Date.now() - 201 * DAY), completed_by: null, evidence_interaction_id: null, completion_finding_id: null, supersedes_id: null,
      cancel_reason: null, revision: 1, createdAt: new Date(), updatedAt: new Date() });
    assert.equal((await publishAttentionSnapshot({ attentionV2: true })).status, "published");

    await t.test("C14: a record closed 200 days ago returns with the snapshot's outcome line; a recent one matches its snapshot row", async () => {
      const page = await readClosedHistory({ limit: 50 });
      assert.equal(page.data.retention.days, 730, "the Sales Intelligence activity retention (env default)");
      const ids = page.data.items.map(idOf);
      assert.deepEqual(ids, [recent.id, owner120.id, old200.id, bad400.id], "newest closed_at first; a closure that is no outcome never appears");
      assert.ok(!ids.includes(noOutcome.id));
      const old = page.data.items.find(row => idOf(row) === old200.id)!;
      assert.equal(old.partition, "closed");
      assert.equal(old.in_attention, false);
      assert.equal(old.outcome?.reason, "crm_dead");
      assert.equal(old.outcome?.origin, "crm_disposition");
      assert.deepEqual(old.outcome?.priority, { code: "8", label: priorityLabel("8") });
      assert.equal(old.filter_keys?.priority, "8");
      assert.deepEqual(old.filter_keys?.agents, [String(agentA), String(agentB)].sort());
      assert.deepEqual(old.outreach?.followups, [], "the closed card reduces to Open");
      const snapshot = await readAttention({ view: "closed", limit: 200 });
      const snapshotIds = snapshot.data.items.map(idOf);
      assert.ok(!snapshotIds.includes(old200.id), "the 90-day partition doesn't hold it");
      const fromSnapshot = snapshot.data.items.find(row => idOf(row) === recent.id)!;
      const fromHistory = page.data.items.find(row => idOf(row) === recent.id)!;
      assert.deepEqual(fromHistory.outcome, fromSnapshot.outcome, "same outcome DTO");
      assert.deepEqual(fromHistory.filter_keys, fromSnapshot.filter_keys, "same filter keys");
      assert.deepEqual(fromHistory.outreach?.facts, fromSnapshot.outreach?.facts, "same facts");
      assert.deepEqual(fromHistory.sort_keys, fromSnapshot.sort_keys, "same sort keys");
      assert.equal(fromHistory.outcome?.booking?.agent_name, "Synthetic Rep A");
    });

    await t.test("C14: filters match the Closed view (outcome, priority incl. not_set, agent_id via promise, closed range)", async () => {
      const ids = async (query: Record<string, unknown>) => (await allHistory({ limit: 50, ...query })).map(idOf);
      assert.deepEqual(await ids({ outcome: "crm_dead,crm_bad_unusable" }), [old200.id, bad400.id]);
      assert.deepEqual(await ids({ outcome: "owner" }), [owner120.id]);
      assert.deepEqual(await ids({ priority: "8" }), [old200.id]);
      assert.deepEqual(await ids({ priority: "3,4,7,8,9" }), [old200.id, bad400.id]);
      assert.deepEqual(await ids({ priority: "not_set" }), [owner120.id]);
      assert.deepEqual(await ids({ agent_id: String(agentA) }), [recent.id, old200.id], "A is responsible for one and promised on the other");
      assert.deepEqual(await ids({ agent_id: String(agentB) }), [old200.id]);
      assert.deepEqual(await ids({ closed_before: new Date(Date.now() - 90 * DAY).toISOString() }), [owner120.id, old200.id, bad400.id], "older than 90 days");
      assert.deepEqual(await ids({ closed_from: new Date(Date.now() - 250 * DAY).toISOString(), closed_before: new Date(Date.now() - 90 * DAY).toISOString() }), [owner120.id, old200.id]);
      // S8-REP hook: a forced scope ignores the client's agent_id.
      const forced = await readClosedHistory({ agent_id: String(agentA), limit: 50 }, { scope: { agent_id: String(agentB) } });
      assert.deepEqual(forced.data.items.map(idOf), [old200.id]);
    });

    // Bulk: a few thousand closures cloned from the seeded records (distinct Leads, spread over two years).
    const templates = await Records.find({ _id: { $in: [recent.id, old200.id, owner120.id, bad400.id].map(id => new mongoose.Types.ObjectId(id)) } }).lean();
    const BULK = 3000;
    const leads: Record<string, unknown>[] = [], clones: Record<string, unknown>[] = [];
    for (let i = 0; i < BULK; i++) {
      const template = templates[i % templates.length]!;
      const leadId = oid();
      leads.push({ _id: leadId, timestamp: new Date(Date.now() - 800 * DAY), createdAt: new Date(), updatedAt: new Date(), name: `Bulk ${i}`, job_no: `T3CB-${i}` });
      const { _id: _ignored, ...rest } = template;
      clones.push({ ...rest, _id: oid(), subject: { ...template.subject, id: leadId }, closed_at: new Date(Date.now() - (5 + (i * 7919) % 720) * DAY - i * 1000),
        responsible_agent_id: i % 3 === 0 ? agentA : i % 3 === 1 ? agentB : null });
    }
    await getFormLeadModel().collection.insertMany(leads);
    await Records.collection.insertMany(clones);

    await t.test("C14: the keyset is stable under concurrent closures (no repeat, no skip of older rows)", async () => {
      const before = new Set((await Records.find({ state: "closed", closure_origin: { $in: ["official", "crm_disposition", "owner"] }, closed_reason: { $ne: "lead_context_available" } })
        .select({ _id: 1 }).lean()).map(row => String(row._id)));
      let inserted = 0;
      const seen = await allHistory({ limit: 50 }, async () => {
        // New closures land "now", newer than every cursor position: they must not appear later in this walk nor shift it.
        for (let k = 0; k < 3; k++) { await closedRecord({ reason: "lost", origin: "owner", daysAgo: 0 }); inserted++; }
      });
      const ids = seen.map(idOf);
      assert.equal(new Set(ids).size, ids.length, "no repeat");
      for (const id of before) assert.ok(ids.includes(id), `no skip: ${id}`);
      assert.equal(ids.length, before.size, "the closures added mid-walk are newer than the first page and don't appear later");
      assert.ok(inserted > 0);
      for (let i = 1; i < seen.length; i++) {
        const [a, b] = [seen[i - 1]!, seen[i]!];
        assert.ok(a.outcome!.closed_at > b.outcome!.closed_at || (a.outcome!.closed_at === b.outcome!.closed_at && idOf(a) > idOf(b)), "strict (closed_at, _id) desc");
      }
    });

    await t.test("C14/B11: reads per page don't grow with the page size (no per-row query)", async () => {
      await readClosedHistory({ limit: 1 });
      const small = await countReads(() => readClosedHistory({ limit: 5 }));
      const large = await countReads(() => readClosedHistory({ limit: 50 }));
      assert.equal(large.result.data.items.length, 50);
      assert.deepEqual(large.byCollection, small.byCollection, "per-collection read counts are constant in the page size");
      console.log(`# closed-history reads: limit 5 → ${small.reads}, limit 50 → ${large.reads}`, JSON.stringify(large.byCollection));
      const filtered = await countReads(() => readClosedHistory({ limit: 50, agent_id: String(agentA), priority: "8,1" }));
      console.log(`# closed-history reads (agent + priority): ${filtered.reads}`, JSON.stringify(filtered.byCollection));
    });

    await t.test("C14: p95 < 300 ms at a few thousand closed records", async () => {
      const total = await Records.countDocuments({ state: "closed" });
      assert.ok(total >= BULK);
      const queries: Record<string, unknown>[] = [{}, { outcome: "crm_dead" }, { priority: "not_set" }, { agent_id: String(agentA) },
        { closed_before: new Date(Date.now() - 90 * DAY).toISOString() }, { outcome: "booked,owner", priority: "1,not_set" }];
      const times: number[] = [];
      for (let round = 0; round < 5; round++) for (const query of queries) {
        let cursor: string | undefined;
        for (let page = 0; page < 3; page++) {
          const started = performance.now();
          const result = await readClosedHistory({ limit: 25, ...query, ...(cursor ? { cursor } : {}) } as never);
          times.push(performance.now() - started);
          cursor = result.data.cursor ?? undefined;
          if (!cursor) break;
        }
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)]!;
      console.log(`# closed-history p95 ${p95.toFixed(1)} ms, p50 ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms over ${times.length} pages; ${total} closed records`);
      assert.ok(p95 < 300, `p95 ${p95.toFixed(1)} ms`);
      const plan = await Records.find({ state: "closed", purged_at: null, closed_at: { $ne: null } }).sort({ closed_at: -1, _id: -1 }).limit(26).explain("queryPlanner") as unknown as { queryPlanner: { winningPlan: unknown } };
      assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /outreach_state_closed/, "served by the new index");
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
