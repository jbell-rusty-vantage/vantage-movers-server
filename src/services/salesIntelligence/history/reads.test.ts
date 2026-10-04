import assert from "node:assert/strict";
import { mock, test } from "node:test";
import mongoose from "mongoose";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { readContactNumberHistory, serialize } from "./reads";

/** A lean query chain (`select`/`sort`/`limit` then `lean`) that resolves to `rows`. */
function chain(rows: unknown, seen: string[] = []) {
  const query = {
    select: (fields: string) => { seen.push(`select:${fields}`); return query; },
    sort: () => query,
    limit: () => query,
    lean: async () => rows,
  };
  return query;
}

test("serialize redacts every string, stringifies ids and dates and drops buffers", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(serialize({ id, at: new Date("2026-10-01T00:00:00.000Z"), note: "write pat@example.com", raw: Buffer.from("x"), list: ["a"] }), {
    id: String(id), at: "2026-10-01T00:00:00.000Z", note: "write [REDACTED:EMAIL]", raw: null, list: ["a"],
  });
});

test("Contact Number history carries provider-metadata rollups and attachments only: no summary, Outreach or retired rollup", async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_historyunit";
  const numberId = new mongoose.Types.ObjectId();
  const seen: string[] = [];
  const stored = {
    _id: numberId, e164: "+15551234567", national_ten: "5551234567", country: "US", kind: "external", classification: "customer",
    classification_reason: null, contact_eligibility: { state: "allowed" }, provider_names: ["ADA L"], first_observed_at: new Date("2026-09-01T00:00:00Z"),
    last_activity_at: new Date("2026-09-30T00:00:00Z"), revision: 4, purged_at: null,
    // Stored before the slimming purge: none of these may be returned.
    running_summary: { text: "Customer said ...", run_id: new mongoose.Types.ObjectId() }, content_purge_pending: false, intelligence_schedule: { due_at: new Date() },
    rollups: { interactions_total: 3, inbound_total: 2, outbound_total: 1, human_conversations_total: 1, last_inbound_at: new Date("2026-09-30T00:00:00Z"),
      last_outbound_at: null, last_human_conversation_at: null, attached_lead_count: 1, candidate_lead_count: 0, recordings_total: 1,
      conversations_analyzed_total: 1, last_analyzed_at: new Date(), open_outreach_count: 1, outreach_records_total: 1 },
  };
  const edge = { _id: new mongoose.Types.ObjectId(), lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId() }, state: "attached", certainty: "exact",
    evidence: [{ source: "form_lead", field_path: "normalized_phone_number", observed_at: new Date("2026-09-02T00:00:00Z"), extra: "dropped" }],
    lead_snapshot: { name: "Ada" }, decided_by: null, decided_at: null, decision_reason: null, auto_decision: null, updatedAt: new Date("2026-09-02T00:00:00Z") };
  const findById = mock.method(getContactNumberModel(), "findById", (() => chain(stored, seen)) as never);
  const find = mock.method(getNumberLeadAttachmentModel(), "find", (() => chain([edge])) as never);
  t.after(() => { findById.mock.restore(); find.mock.restore(); });

  const history = await readContactNumberHistory(String(numberId)) as Record<string, Record<string, unknown> & { rollups: Record<string, unknown> }>;
  assert.deepEqual(Object.keys(history).sort(), ["attachments", "contact_number"]);
  assert.equal(history.contact_number!.e164, "+15551234567");
  assert.equal("running_summary" in history.contact_number!, false);
  assert.equal("content_purge_pending" in history.contact_number!, false);
  assert.deepEqual(Object.keys(history.contact_number!.rollups).sort(), [
    "attached_lead_count", "candidate_lead_count", "human_conversations_total", "inbound_total", "interactions_total",
    "last_human_conversation_at", "last_inbound_at", "last_outbound_at", "outbound_total", "recordings_total",
  ]);
  assert.equal(history.contact_number!.rollups.interactions_total, 3);
  const [attachment] = history.attachments as unknown as Array<Record<string, unknown>>;
  assert.equal(attachment!.state, "attached");
  assert.deepEqual(attachment!.evidence, [{ source: "form_lead", field_path: "normalized_phone_number", observed_at: "2026-09-02T00:00:00.000Z" }]);
  assert.ok(seen.includes("select:-search_terms -digits_reversed"));

  findById.mock.mockImplementation((() => chain({ ...stored, purged_at: new Date() })) as never);
  assert.equal(await readContactNumberHistory(String(numberId)), null);
  findById.mock.mockImplementation((() => chain(null)) as never);
  assert.equal(await readContactNumberHistory(String(numberId)), null);
});
