import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import type { CaseCall, CaseLead, CaseRepLink, VantageSideContext } from "./types";
import { lineLabel, lineText, readVantageSideContext, repClause, vantageClauseText, vantageSide } from "./vantageSide";

/** F6 (spec §4.5): line label order, rep clause per identity state, queue/transfer facts, and the bounded reads. */
const ACCOUNT = "acct-1";
const link = (id: string, extension: string, status: string, extra: Partial<CaseRepLink> = {}): CaseRepLink => ({ id, revision: 1, agent_id: `agent-${extension}`,
  agent_name: extension === "104" ? "Jordan Bell" : "Sam Kay", rc_account_id: ACCOUNT, rc_extension_id: `ext-${extension}`, rc_extension_number: extension,
  rc_extension_name: null, role_kind: "sales_rep", status, effective_from: "2026-01-01T00:00:00.000Z", effective_to: null,
  reviewed_at: status === "reviewed" ? "2026-01-02T00:00:00.000Z" : null, reviewed_by: status === "reviewed" ? "owner" : null, ...extra });
const ctx = (over: Partial<VantageSideContext> = {}): VantageSideContext => ({
  links: [link("l104", "104", "reviewed"), link("l118", "118", "proposed"), link("l120", "120", "reviewed", { role_kind: "manager" })],
  directories: [{ account_id: ACCOUNT, taken_at: "2026-09-20T00:00:00.000Z", extensions: { "ext-118": { name: "Mike R.", extension_number: "118" }, "ext-104": { name: "Jordan Bell", extension_number: "104" } },
    queues: { "q-1": { name: "Sales", extension_number: "900" } } }],
  routes: [{ id: "6b9000000000000000000a01", phone_number: "+18885550100", display_label: "Top10", queue_name: "Top10 Sales" }],
  call_leads: [{ lead_ref: { model: "CallLead", id: "6b9000000000000000000b01" }, telephony_session_id: "sess-9", target_phone_number: "+18005550199", target_name: "MovingQuotes", source_label: "MQ" }],
  ...over });
const call = (over: Partial<CaseCall> = {}): CaseCall => ({ id: "c1", provider_account_id: ACCOUNT, telephony_session_id: "sess-1", direction: "Outbound", started_at: "2026-09-17T14:04:00.000Z",
  company_e164: "+18885550100", inbound_route_id: null, parties: [{ role: "external", extension_id: null, extension_number: null, name_raw: "M LOPEZ", connected: true },
    { role: "user", extension_id: "ext-104", extension_number: "104", name_raw: null, connected: true }], queue_fanout: false, transfer: false, duration_seconds: 252,
  provider_result: "Call connected", provider_connected: true, contact_type: "human_conversation", recording_count: 1, ...over });
const user = (extension: string, connected = true) => ({ role: "user", extension_id: `ext-${extension}`, extension_number: extension, name_raw: null, connected });

test("rep clause: reviewed name; unreviewed with the directory name as a label; no directory name; excluded role; no extension", () => {
  assert.equal(repClause(call(), ctx()).text, "Jordan Bell (ext 104, reviewed)");
  assert.equal(repClause(call(), ctx()).short, "Jordan Bell");
  const unreviewed = repClause(call({ parties: [user("118")] }), ctx());
  assert.equal(unreviewed.text, 'ext 118 (identity not reviewed; directory name "Mike R.")');
  assert.equal(unreviewed.short, 'ext 118 "Mike R." [directory name, unreviewed]');
  assert.equal(unreviewed.agent_id, null, "a directory name is never an identity");
  assert.equal(repClause(call({ parties: [user("130")] }), ctx()).text, "ext 130 (identity not reviewed)");
  assert.equal(repClause(call({ parties: [user("120")] }), ctx()).text, "ext 120 (reviewed as manager, not a sales rep)");
  assert.equal(repClause(call({ parties: [{ role: "external", extension_id: null, extension_number: null, name_raw: null, connected: true }] }), ctx()).text, "a Vantage line");
  // A link reviewed only after the call does not name the rep for that call.
  const later = ctx({ links: [link("l104", "104", "reviewed", { effective_from: "2026-10-01T00:00:00.000Z" })] });
  assert.equal(repClause(call(), later).text, 'ext 104 (identity not reviewed; directory name "Jordan Bell")');
});

test("line label order: route by id, route by number, the Call Lead's qualifying call, its target number, the number alone", () => {
  assert.deepEqual(lineLabel(call({ inbound_route_id: "6b9000000000000000000a01", company_e164: null }), ctx()), { label: "Top10", e164: null, source: "route" });
  assert.deepEqual(lineLabel(call(), ctx()), { label: "Top10", e164: "+18885550100", source: "route" });
  assert.deepEqual(lineLabel(call({ company_e164: "+15550000000", telephony_session_id: "sess-9" }), ctx()), { label: "MovingQuotes", e164: "+15550000000", source: "call_lead" });
  assert.deepEqual(lineLabel(call({ company_e164: "+18005550199" }), ctx()), { label: "MovingQuotes", e164: "+18005550199", source: "call_lead" });
  assert.deepEqual(lineLabel(call({ company_e164: "+15617770000" }), ctx()), { label: null, e164: "+15617770000", source: "number" });
  assert.deepEqual(lineLabel(call({ company_e164: null }), ctx()), { label: null, e164: null, source: "unknown" });
  assert.equal(lineText({ label: "Sales Overflow Line", e164: "+15125551055", source: "call_lead" }, true), "Sales Overflow Line (+15125551055)", "a label that names a line is not doubled");
  assert.equal(lineText({ label: "Top10", e164: null, source: "route" }), "Top10 line");
  assert.equal(lineText({ label: "Online", e164: null, source: "route" }), "Online line", "only the word line counts");
});

test("clause text: outbound, inbound through a queue with a transfer, unanswered inbound", () => {
  assert.equal(vantageClauseText(vantageSide(call(), ctx()), "Outbound", true), "from Top10 line by Jordan Bell (ext 104, reviewed)");
  const inbound = call({ direction: "Inbound", company_e164: "+15617770000", queue_fanout: true, transfer: true,
    parties: [{ role: "queue", extension_id: "q-1", extension_number: "900", name_raw: null, connected: false }, user("104", false), user("120", false), user("118")] });
  assert.equal(vantageClauseText(vantageSide(inbound, ctx()), "Inbound", true),
    'to Vantage line (+15617770000), queue "Sales" rang 3; transferred from ext 104; answered by ext 118 (identity not reviewed; directory name "Mike R.")');
  assert.equal(vantageClauseText(vantageSide(call({ direction: "Inbound", provider_connected: false }), ctx()), "Inbound", false), "to Top10 line");
  assert.equal(vantageClauseText(vantageSide(call(), ctx()), "Outbound", true, true), "from Top10 line (+18885550100) by Jordan Bell (ext 104, reviewed)");
});

test("reads: one link query, the newest directory snapshot per account (only the extensions seen), routes by id or number", async t => {
  const queries: Array<{ model: string; filter: unknown }> = [];
  const chain = (rows: unknown) => { const q = { select: () => q, sort: () => q, limit: () => q, lean: () => Promise.resolve(rows) }; return q; };
  t.mock.method(getRepIdentityLinkModel(), "find", ((filter: unknown) => { queries.push({ model: "links", filter }); return chain([{ _id: new mongoose.Types.ObjectId("6b9000000000000000000c01"),
    revision: 1, agent_id: new mongoose.Types.ObjectId("6b9000000000000000000c02"), agent_name_snapshot: "Jordan Bell", rc_account_id: ACCOUNT, rc_extension_id: "ext-104",
    rc_extension_number: "104", rc_extension_name_snapshot: "Jordan Bell", role_kind: "sales_rep", status: "reviewed", effective_from: new Date("2026-01-01T00:00:00.000Z"),
    effective_to: null, reviewed_at: new Date("2026-01-02T00:00:00.000Z"), reviewed_by: "owner" }]); }) as never);
  t.mock.method(getRingCentralDirectorySnapshotModel(), "findOne", ((filter: unknown) => { queries.push({ model: "directory", filter }); return chain({ provider_account_id: ACCOUNT,
    taken_at: new Date("2026-09-20T00:00:00.000Z"), extensions: [{ id: "ext-118", name: "Mike R.", extension_number: "118" }, { id: "ext-999", name: "Someone Else", extension_number: "999" }],
    queues: [{ id: "q-1", name: "Sales", extension_number: "900" }] }); }) as never);
  t.mock.method(getRingCentralInboundRouteModel(), "find", ((filter: unknown) => { queries.push({ model: "routes", filter }); return chain([{ _id: new mongoose.Types.ObjectId("6b9000000000000000000a01"),
    phone_number: "+18885550100", display_label: "Top10", ringcentral_queue_name: "Top10 Sales" }]); }) as never);
  const lead = { ref: { model: "CallLead", id: "6b9000000000000000000b01" }, ringcentral: { telephony_session_id: "sess-9", qualification_reason: null, start_time: null,
    target_phone_number: "+18005550199", target_name: "MovingQuotes", source_label: "MQ", route_id: null } } as unknown as CaseLead;
  const context = await readVantageSideContext([call(), call({ id: "c2", parties: [user("118")] })], [lead]);
  assert.deepEqual(queries.map(q => q.model), ["links", "directory", "routes"]);
  assert.deepEqual(Object.keys(context.directories[0]!.extensions), ["ext-118"], "only the extensions on these calls are kept");
  assert.equal(context.links[0]!.agent_name, "Jordan Bell");
  assert.equal(context.routes[0]!.display_label, "Top10");
  assert.equal(context.call_leads[0]!.target_name, "MovingQuotes");
  assert.equal(repClause(call({ parties: [user("118")] }), context).text, 'ext 118 (identity not reviewed; directory name "Mike R.")');
  const none = await readVantageSideContext([], []);
  assert.deepEqual(none, { links: [], directories: [], routes: [], call_leads: [] });
});
