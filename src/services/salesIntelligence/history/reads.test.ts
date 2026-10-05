import assert from "node:assert/strict";
import { mock, test } from "node:test";
import mongoose from "mongoose";
import { getContactNumberModel } from "../../../models/ContactNumber";
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

test("Contact Number history carries the All Numbers summary and lead link only: no classification, rollup, summary or Outreach", async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_historyunit";
  const numberId = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId(), excludedId = new mongoose.Types.ObjectId();
  const stored = {
    _id: numberId, e164: "+15551234567", national_ten: "5551234567", country: "US", provider_names: ["ADA L"], first_observed_at: new Date("2026-09-01T00:00:00Z"),
    last_activity_at: new Date("2026-09-30T00:00:00Z"), revision: 4, purged_at: null, created_via: "form_lead",
    lead: { model: "FormLead", id: leadId, name: "Ada pat@example.com", job_no: "J-1", receiver_agent_id: null, receiver_agent_name: "Dana", received_at: new Date("2026-09-01T00:00:00Z"), state: "open" },
    other_leads: [{ model: "CallLead", id: otherId, name: "Ada", job_no: null, receiver_agent_id: null, receiver_agent_name: null, received_at: new Date("2026-08-01T00:00:00Z"), state: "booked" }],
    lead_link: { source: "owner", set_at: new Date("2026-09-02T00:00:00Z"), set_by: "owner-1", excluded: [{ model: "FormLead", id: excludedId }] },
    last_call: { interaction_id: new mongoose.Types.ObjectId(), at: new Date("2026-09-30T00:00:00Z"), direction: "inbound", result: "missed", duration_seconds: 0, rc_extension_id: "e1" },
    calls: { inbound: 2, outbound: 1, missed: 1 }, last_inbound_at: new Date("2026-09-30T00:00:00Z"), last_outbound_at: null, waiting_since: new Date("2026-09-30T00:00:00Z"),
    // Stored before the phase B cleanup or the slimming purge: none of these may be returned.
    kind: "external", classification: "customer", contact_eligibility: { state: "allowed" }, rollups: { interactions_total: 3, open_outreach_count: 1 },
    running_summary: { text: "Customer said ...", run_id: new mongoose.Types.ObjectId() },
  };
  const findById = mock.method(getContactNumberModel(), "findById", (() => chain(stored)) as never);
  t.after(() => { findById.mock.restore(); });

  const history = await readContactNumberHistory(String(numberId)) as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(history).sort(), ["contact_number", "lead", "lead_link", "other_leads"]);
  const number = history.contact_number!;
  assert.equal(number.e164, "+15551234567");
  assert.equal(number.source, "form_lead");
  assert.deepEqual(number.calls, { inbound: 2, outbound: 1, missed: 1 });
  assert.deepEqual(number.last_call, { at: "2026-09-30T00:00:00.000Z", direction: "inbound", result: "missed", duration_seconds: 0 });
  assert.equal(number.waiting_since, "2026-09-30T00:00:00.000Z");
  for (const retired of ["kind", "classification", "contact_eligibility", "rollups", "running_summary"]) assert.equal(retired in number, false, retired);
  assert.deepEqual(history.lead, { model: "FormLead", id: String(leadId), name: "Ada [REDACTED:EMAIL]", job_no: "J-1", rep_name: "Dana",
    received_at: "2026-09-01T00:00:00.000Z", state: "open" });
  assert.deepEqual((history.other_leads as unknown as Array<Record<string, unknown>>).map((lead) => lead.id), [String(otherId)]);
  assert.deepEqual(history.lead_link, { source: "owner", set_at: "2026-09-02T00:00:00.000Z", set_by: "owner-1", excluded: [{ model: "FormLead", id: String(excludedId) }] });

  findById.mock.mockImplementation((() => chain({ ...stored, purged_at: new Date() })) as never);
  assert.equal(await readContactNumberHistory(String(numberId)), null);
  findById.mock.mockImplementation((() => chain(null)) as never);
  assert.equal(await readContactNumberHistory(String(numberId)), null);
});
