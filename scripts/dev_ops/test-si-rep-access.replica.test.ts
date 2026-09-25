import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { requireApiSecret } from "../../src/middleware/requireApiSecret";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../src/models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { computeAdminActorSignature, signAdminActorPayload } from "../../src/services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../../src/services/operationsRegistry/trustedActorCanonical";
import { publishAttentionSnapshot, clearParsedAttentionSnapshots } from "../../src/services/salesIntelligence/outreach/attention";
import { clearOverviewCache } from "../../src/services/salesIntelligence/overview/read";
import { clearOverviewIndexCache } from "../../src/services/salesIntelligence/overview/now";
import { openOwnerConversationMedia, type BlobReader } from "../../src/services/salesIntelligence/conversations/ownerMedia";
import { conversationInRepScope, numberInRepScope, outreachRecordInRepScope } from "../../src/services/salesIntelligence/repScope";
import { createSalesIntelligenceBoundaryRouter } from "../../src/routes/sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "../../src/routes/sales-intelligence-admin.routes";
import { seedLead, seedNumber, seedRecord, seedSummaryConversation } from "./csi-move-assessment-fixtures";

/**
 * S8-REP replica proof (assignment addendum §4.2, E9–E11, E23; C6, C11). Two reps with records, follow-ups and a
 * promise across records, driven over HTTP through the real boundary and admin routers with signed headers exactly
 * as the admin proxy sends them. Production flags on plus REP_ACCESS and OVERVIEW; no paid job may be created.
 *
 *   A: R1 (responsible, N1, conversation C1), R2 via F2 (promised by A, responsible B), R4 closed 200 days ago.
 *   B: R2, R3 (N3, conversation C3), R5 closed 5 days ago, R7 closed 300 days ago.
 *   Unassigned: R6.
 */
const API = "synthetic-global", SIGNING = "synthetic-owner-signature";
const PAID_STAGES = ["analysis", "number_refresh", "move_assessment", "transcription", "extraction"];
const HOUR = 3_600_000, DAY = 86_400_000;
type Role = "owner" | "rep";

test("S8-REP rep access on the csi01 replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3brep");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_REP_ACCESS, "true");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await applyCsiMigration()).ready, true);
  const realFetch = globalThis.fetch;
  // Only loopback traffic (this test's own HTTP server) is allowed.
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("http://127.0.0.1:")) throw new Error(`External traffic forbidden in the S8-REP replica proof: ${url}`);
    return realFetch(input, init);
  });

  // ── Seed ─────────────────────────────────────────────────────────────
  const oid = () => new mongoose.Types.ObjectId();
  const now = new Date();
  const agentA = oid(), agentB = oid();
  const A = String(agentA), B = String(agentB);
  await db.collection("agents").insertMany([{ _id: agentA, name: "Synthetic Rep A", active: true }, { _id: agentB, name: "Synthetic Rep B", active: true }]);
  const numbers: Record<string, string> = {}, records: Record<string, string> = {};
  for (const name of ["R1", "R2", "R3", "R4", "R5", "R6", "R7"]) {
    const number = await seedNumber();
    numbers[name] = String(number._id);
    const lead = await seedLead("FormLead", number.national_ten as string, { receiver_agent: null });
    records[name] = await seedRecord(lead, numbers[name]);
  }
  const Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel();
  const setRecord = (name: string, set: Record<string, unknown>) => Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(records[name]) }, { $set: set });
  const closed = (days: number, agent: mongoose.Types.ObjectId | null) => ({ state: "closed", closed_at: new Date(+now - days * DAY), closed_reason: "lost", closure_origin: "owner",
    closed_by: "owner", responsible_agent_id: agent });
  await setRecord("R1", { state: "open", responsible_agent_id: agentA, trigger_at: new Date(+now - 2 * DAY) });
  await setRecord("R2", { state: "open", responsible_agent_id: agentB, trigger_at: new Date(+now - 3 * DAY) });
  await setRecord("R3", { state: "open", responsible_agent_id: agentB, trigger_at: new Date(+now - DAY) });
  await setRecord("R4", closed(200, agentA));
  await setRecord("R5", closed(5, agentB));
  await setRecord("R6", { state: "open", responsible_agent_id: null, trigger_at: new Date(+now - 20 * DAY) });
  await setRecord("R7", closed(300, agentB));
  let serial = 0;
  const followup = (record: string, over: Record<string, unknown>) => ({ _id: oid(), outreach_record_id: new mongoose.Types.ObjectId(records[record]), commitment_key: `s8rep:${++serial}`,
    kind: "call", description: "Synthetic callback", status: "open", due_at: null, date_text: null,
    date_resolution: { precision: "exact", timezone: "America/New_York", assumption: "Synthetic promise", anchor: new Date(+now - 3 * DAY), policy_version: "v" },
    base_attention_due_at: null, attention_due_at: null, snoozed_until: null, wait_expired_at: null, missed_episode_key: null, trigger_interaction_ids: [], first_missed_at: null,
    responsible_agent_id: agentA, assignment: null, promised_by_agent_id: null, requested_by: null, origin: "rep_promise", source_finding_ids: [], origin_run_id: null, owner_instruction_ids: [],
    disposition: null, completion_basis: null, completed_at: null, completed_by: null, evidence_interaction_id: null, completion_finding_id: null, supersedes_id: null, cancel_reason: null,
    revision: 1, createdAt: new Date(+now - 3 * DAY), updatedAt: now, ...over });
  const due = (ms: number) => ({ due_at: new Date(+now + ms), base_attention_due_at: new Date(+now + ms), attention_due_at: new Date(+now + ms) });
  const F1 = followup("R1", due(-DAY));
  const F2 = followup("R2", { ...due(DAY), responsible_agent_id: agentB, promised_by_agent_id: agentA });
  const F3 = followup("R3", { ...due(-DAY), responsible_agent_id: agentB });
  const F4 = followup("R1", due(2 * DAY));
  await Followups.collection.insertMany([F1, F2, F3, F4]);
  const at = (hours: number) => new Date(+now - hours * HOUR);
  const C1 = (await seedSummaryConversation(numbers.R1!, at(30), { overview: "Rep A's call about a move to Denver." })).conversation;
  const C3 = (await seedSummaryConversation(numbers.R3!, at(20), { overview: "Rep B's call about storage." })).conversation;
  for (const conversation of [C1, C3]) await getLeadConversationModel().collection.updateOne({ _id: conversation._id }, { $set: {
    media: { blob_pathname: `conversations/synthetic/s8rep-${String(conversation._id)}.mp3`, blob_url: null, bytes: 4, content_type: "audio/mpeg", stored_at: at(19), purged_at: null } } });
  clearParsedAttentionSnapshots();
  assert.equal((await publishAttentionSnapshot()).status, "published");
  const paidJobs = () => getSalesIntelligenceJobModel().countDocuments({ stage: { $in: PAID_STAGES } });
  const paidBefore = await paidJobs();
  assert.equal(paidBefore, 0, "the seed queues no paid job");

  // ── HTTP, signed exactly as the admin proxy signs ────────────────────
  const blobReads: string[] = [];
  const readBlob: BlobReader = async (pathname) => { blobReads.push(pathname); return { status: 200, content_type: "audio/mpeg", content_length: 4, content_range: null,
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3, 4])); c.close(); } }) }; };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter());
  app.use(createSalesIntelligenceAdminRouter({ conversationMedia: input => openOwnerConversationMedia(input, { readBlob }) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let request = 0;
  async function call(role: Role, method: string, path: string, options: { agent?: string; body?: unknown } = {}) {
    const url = `${CSI_ADMIN_PREFIX}${path}`, signedPath = url.split("?")[0]!;
    const fields = { adminId: role === "rep" ? `rep-user-${options.agent}` : "owner-user", email: `${role}@example.test`, role, timestamp: String(Date.now()),
      requestId: `s8rep-${++request}`, method, path: signedPath };
    const signature = role === "rep" ? signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId: options.agent! }), SIGNING) : computeAdminActorSignature(fields, SIGNING);
    const headers: Record<string, string> = { "x-api-secret": API, "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": signature,
      ...(role === "rep" ? { "x-vantage-admin-agent-id": options.agent! } : {}) };
    if (method !== "GET") { headers["content-type"] = "application/json"; headers["idempotency-key"] = `s8rep-key-${request}`; }
    const response = await fetch(`${base}${url}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}) });
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await response.json() as Record<string, any> : (await response.arrayBuffer(), null); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: response.status, body };
  }
  const repA = (method: string, path: string, body?: unknown) => call("rep", method, path, { agent: A, body });
  const repB = (method: string, path: string, body?: unknown) => call("rep", method, path, { agent: B, body });
  const owner = (method: string, path: string, body?: unknown) => call("owner", method, path, { body });
  const subjects = (page: { body: Record<string, any> | null }) => (page.body?.data?.items ?? []).map((row: { outreach?: { id: string } }) => row.outreach?.id).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const inA = [records.R1!, records.R2!].sort(), inB = [records.R2!, records.R3!].sort();

  await t.test("desk: the rep's scope is forced (params ignored), with its own tiles and chip counts", async () => {
    const repPage = await repA("GET", `/attention?view=all_outreach&agent_id=${B}&unassigned=true&limit=50`);
    assert.equal(repPage.status, 200);
    assert.deepEqual(subjects(repPage), inA, "responsible ∪ promised by A");
    const ownerFiltered = await owner("GET", `/attention?view=all_outreach&agent_id=${A}&limit=50`);
    assert.deepEqual(subjects(ownerFiltered), inA, "the forced filter equals the Owner's agent filter");
    assert.deepEqual(subjects(await repB("GET", "/attention?view=all_outreach&limit=50")), inB);
    const ownerAll = await owner("GET", "/attention?view=all_outreach&limit=50");
    assert.deepEqual(subjects(ownerAll), [records.R1!, records.R2!, records.R3!, records.R6!].sort());
    // Tiles: recomputed over A's entries, equal to the Owner's filtered counts, and not the global header.
    const repMetrics = repPage.body!.data.metrics, globalMetrics = ownerAll.body!.data.metrics;
    assert.ok(repMetrics && globalMetrics);
    for (const [field, band] of [["callbacks_overdue", 1], ["not_called_yet", 2]] as const) {
      const scoped = await owner("GET", `/attention?view=all_outreach&agent_id=${A}&band=${band}&limit=200`);
      assert.equal(repMetrics[field], scoped.body!.data.total_items, field);
    }
    assert.equal(repMetrics.callbacks_overdue, 1, "R1's overdue F1; R3's overdue F3 is B's");
    assert.ok(globalMetrics.callbacks_overdue >= 2);
    const since = new Date(Date.parse(repPage.body!.as_of) - 7 * DAY).toISOString();
    const receivedActive = await owner("GET", `/attention?view=all_outreach&agent_id=${A}&received_from=${encodeURIComponent(since)}&limit=200`);
    const receivedClosed = await owner("GET", `/attention?view=closed&agent_id=${A}&received_from=${encodeURIComponent(since)}&limit=200`);
    assert.equal(repMetrics.leads_received_7d, receivedActive.body!.data.total_items + receivedClosed.body!.data.total_items);
    assert.notDeepEqual(repMetrics, globalMetrics);
    // Chip counts over A's entries: two active records (R1, R2), nothing in the 90-day closed partition (R4 is 200 days old).
    const counts = repPage.body!.data.priority_counts as Record<string, { attention: number; active: number; closed: number }>;
    const sum = (key: "active" | "closed") => Object.values(counts).reduce((total, bucket) => total + bucket[key], 0);
    assert.equal(sum("active"), 2); assert.equal(sum("closed"), 0);
    const bCounts = (await repB("GET", "/attention")).body!.data.priority_counts as typeof counts;
    assert.equal(Object.values(bCounts).reduce((total, bucket) => total + bucket.closed, 0), 1, "R5 is B's recent closure");
    // Closed view: A sees none of B's closures.
    assert.deepEqual(subjects(await repA("GET", "/attention?view=closed")), []);
    assert.deepEqual(subjects(await repB("GET", "/attention?view=closed")), [records.R5!]);
  });

  await t.test("desk cursor binds to the forced scope", async () => {
    const first = await repB("GET", "/attention?view=all_outreach&limit=1");
    const cursor = first.body!.data.cursor as string;
    assert.ok(cursor);
    assert.equal((await repB("GET", `/attention?view=all_outreach&limit=1&cursor=${cursor}`)).status, 200);
    assert.equal((await repA("GET", `/attention?view=all_outreach&limit=1&cursor=${cursor}`)).status, 400, "another rep can't page B's cursor");
    assert.equal((await owner("GET", `/attention?view=all_outreach&limit=1&cursor=${cursor}`)).status, 400, "nor can the unscoped Owner read");
  });

  await t.test("record reads: in scope as the Owner sees them; outside the scope 404 exactly like a missing record", async () => {
    const missing = String(oid());
    for (const suffix of ["", "/timeline", "/assessment", "/findings"]) {
      const missingBody = await owner("GET", `/outreach/${missing}${suffix}`);
      assert.equal(missingBody.status, 404, `missing ${suffix}`);
      for (const record of inA) {
        const [asRep, asOwner] = [await repA("GET", `/outreach/${record}${suffix}`), await owner("GET", `/outreach/${record}${suffix}`)];
        assert.equal(asRep.status, asOwner.status, `${record}${suffix}`);
        assert.notEqual(asRep.status, 404, `${record}${suffix}`);
      }
      for (const record of [records.R3!, records.R5!, records.R6!, records.R7!, missing]) {
        const asRep = await repA("GET", `/outreach/${record}${suffix}`);
        assert.equal(asRep.status, 404, `${record}${suffix}`);
        assert.equal(asRep.body!.error, missingBody.body!.error); assert.equal(asRep.body!.code, missingBody.body!.code);
      }
      // B reads R2 and R3 but not R1.
      assert.equal((await repB("GET", `/outreach/${records.R1}${suffix}`)).status, 404);
      assert.notEqual((await repB("GET", `/outreach/${records.R3}${suffix}`)).status, 404);
    }
    // A closed record older than the partition is still the rep's.
    assert.equal((await repA("GET", `/outreach/${records.R4}`)).status, 200);
    // The detail carries no Owner→rep nudges for a rep.
    assert.deepEqual((await repA("GET", `/outreach/${records.R1}`)).body!.data.nudges, { items: [], next_cursor: null });
  });

  await t.test("V-T3 M8: the rep's Outreach timeline drops Owner nudges and Owner notes before the page is cut; restrictions stay", async () => {
    const r1 = await Records.findById(records.R1).lean();
    const subject = r1!.subject as { model: string; id: unknown };
    const subject_key = `lead:${subject.model}:${String(subject.id)}`;
    const audit = (event_kind: string, hoursAgo: number, current: Record<string, unknown>, kind: string) => ({ _id: oid(), semantic_key: `m8:${event_kind}:${hoursAgo}`, subject_key, event_kind,
      actor: { kind: "owner", id: "owner-user" }, happened_at: at(hoursAgo), recorded_at: at(hoursAgo), prior: {}, current,
      invalidation: { kind, target_id: String(oid()), subject_key, revision: 1 } });
    // Interleaved so the hidden rows fall inside and between small pages.
    await getSalesIntelligenceAuditEventModel().collection.insertMany([
      audit("nudge_sent", 1, { channel: "sms" }, "nudge"), audit("add_note", 2, { note: "Owner-only: margin is thin, push the deposit" }, "outreach"),
      audit("restriction_set", 3, { reason: "Customer asked: do not call before 5 PM" }, "restriction"), audit("nudge.authorized", 4, { status: "pending" }, "nudge"),
      audit("add_note", 5, { note: "Owner-only second note" }, "outreach"), audit("nudge_sent", 6, { channel: "teams" }, "nudge")]);
    const pageAll = async (read: (path: string) => Promise<{ status: number; body: Record<string, any> | null }>, limit: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const items: Array<{ id: string; kind: string; detail: unknown }> = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 200; pages++) {
        const page = await read(`/outreach/${records.R1}/timeline?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        assert.equal(page.status, 200, JSON.stringify(page.body));
        items.push(...page.body!.data.items);
        cursor = page.body!.data.cursor;
        if (!cursor) return items;
        assert.equal(page.body!.data.items.length, limit, "a page with a cursor is full");
      }
      throw new Error("timeline paging did not terminate");
    };
    const ownerItems = await pageAll(path => owner("GET", path), 50);
    assert.ok(ownerItems.some(e => e.kind === "nudge_sent") && ownerItems.some(e => e.kind === "owner_note"), "the Owner sees nudges and notes");
    const expected = ownerItems.filter(e => e.kind !== "nudge_sent" && e.kind !== "owner_note").map(e => `${e.kind}:${e.id}`);
    for (const limit of [1, 2, 3, 50]) {
      const repItems = await pageAll(path => repA("GET", path), limit);
      assert.deepEqual(repItems.map(e => `${e.kind}:${e.id}`), expected, `rep limit ${limit}: the Owner's stream minus the hidden kinds, exact paging`);
    }
    const repItems = await pageAll(path => repA("GET", path), 50);
    assert.ok(repItems.some(e => e.kind === "restriction_set"), "do-not-call stays visible to the rep");
    assert.ok(!JSON.stringify(repItems).includes("Owner-only"), "no Owner note text reaches the rep");
    const hidden = await repA("GET", `/outreach/${records.R1}/timeline?kinds=nudge_sent,owner_note`);
    assert.equal(hidden.status, 200); assert.deepEqual(hidden.body!.data.items, []);
  });

  await t.test("Number and conversation reads: in scope when one of the Number's records is; media audited with the rep", async () => {
    const missingNumber = await owner("GET", `/numbers/${String(oid())}/conversations`);
    assert.equal(missingNumber.status, 404);
    const [repConversations, ownerConversations] = [await repA("GET", `/numbers/${numbers.R1}/conversations`), await owner("GET", `/numbers/${numbers.R1}/conversations`)];
    assert.equal(repConversations.status, 200);
    assert.deepEqual(repConversations.body!.data, ownerConversations.body!.data);
    const outNumber = await repA("GET", `/numbers/${numbers.R3}/conversations`);
    assert.equal(outNumber.status, 404); assert.equal(outNumber.body!.error, missingNumber.body!.error);
    // R2's Number is A's through the promise.
    assert.equal((await repA("GET", `/numbers/${numbers.R2}/conversations`)).status, 200);
    // The Number itself stays Owner-only.
    assert.equal((await repA("GET", `/numbers/${numbers.R1}`)).status, 403);
    assert.equal((await repA("GET", `/numbers/${numbers.R1}/timeline`)).status, 403);
    assert.equal((await repA("GET", "/numbers")).status, 403);
    const missingConversation = await owner("GET", `/conversations/${String(oid())}/transcript`);
    const [repTranscript, ownerTranscript] = [await repA("GET", `/conversations/${C1._id}/transcript`), await owner("GET", `/conversations/${C1._id}/transcript`)];
    assert.equal(repTranscript.status, 200); assert.deepEqual(repTranscript.body!.data, ownerTranscript.body!.data);
    const outTranscript = await repA("GET", `/conversations/${C3._id}/transcript`);
    assert.equal(outTranscript.status, 404); assert.equal(outTranscript.body!.error, missingConversation.body!.error);
    // Media: in scope plays and is audited with the rep as actor; outside, 404 and no audit row, no blob read.
    const Audit = getSalesIntelligenceAuditEventModel();
    const played = await repA("GET", `/conversations/${C1._id}/media`);
    assert.equal(played.status, 200);
    const rows = await Audit.find({ subject_key: `conversation:${C1._id}`, event_kind: "media_played" }).lean();
    assert.equal(rows.length, 1); assert.equal(rows[0]!.actor.kind, "rep"); assert.equal(rows[0]!.actor.id, `rep-user-${A}`);
    assert.deepEqual(Object.keys(rows[0]!.actor).sort(), ["id", "kind", "request_id", "run_id"]);
    const blocked = await repA("GET", `/conversations/${C3._id}/media`);
    assert.equal(blocked.status, 404);
    assert.equal(await Audit.countDocuments({ subject_key: `conversation:${C3._id}` }), 0);
    assert.equal(blobReads.length, 1);
    assert.equal((await repA("GET", `/conversations/${C1._id}/findings`)).status, 403, "run-keyed Full output stays Owner-only");
  });

  await t.test("scope checks are indexed and bounded (≤ 3 reads each)", async () => {
    for (const [check, id] of [[outreachRecordInRepScope, records.R2!], [numberInRepScope, numbers.R2!], [conversationInRepScope, String(C1._id)]] as const) {
      const reads: string[] = [];
      assert.equal(await check(id, A, { onRead: collection => reads.push(collection) }), true);
      assert.ok(reads.length <= 3, reads.join(","));
    }
    const explain = await db.collection("outreach_records").find({ primary_contact_number_id: new mongoose.Types.ObjectId(numbers.R1) }).explain("queryPlanner") as { queryPlanner: { winningPlan: unknown } };
    assert.match(JSON.stringify(explain.queryPlanner.winningPlan), /outreach_number/);
    const followExplain = await db.collection("outreach_followups").find({ outreach_record_id: { $in: [new mongoose.Types.ObjectId(records.R2)] }, $or: [{ responsible_agent_id: agentA }, { promised_by_agent_id: agentA }] })
      .explain("queryPlanner") as { queryPlanner: { winningPlan: unknown } };
    assert.match(JSON.stringify(followExplain.queryPlanner.winningPlan), /followup_outreach_due/);
  });

  await t.test("Closed history: forced to the rep; the cursor binds to it", async () => {
    const aPage = await repA("GET", `/outreach/closed-history?agent_id=${B}`);
    assert.equal(aPage.status, 200);
    assert.deepEqual(subjects(aPage), [records.R4!], "A's 200-day closure, none of B's");
    const bFirst = await repB("GET", "/outreach/closed-history?limit=1");
    assert.deepEqual(subjects(bFirst), [records.R5!]);
    const cursor = bFirst.body!.data.cursor as string;
    assert.ok(cursor);
    assert.deepEqual(subjects(await repB("GET", `/outreach/closed-history?limit=1&cursor=${cursor}`)), [records.R7!]);
    assert.equal((await repA("GET", `/outreach/closed-history?limit=1&cursor=${cursor}`)).status, 400);
    assert.equal((await owner("GET", `/outreach/closed-history?limit=1&cursor=${cursor}&agent_id=${B}`)).status, 400, "a rep cursor is not an Owner cursor");
  });

  await t.test("Overview: the rep's numbers plus anonymous team medians, no other rep (C11)", async () => {
    clearOverviewCache(); clearOverviewIndexCache();
    const view = await repA("GET", `/overview?agent_id=${B}&period=last_7_days`);
    assert.equal(view.status, 200);
    const data = view.body!.data;
    assert.deepEqual(data.scope, { agent_id: A });
    assert.deepEqual(data.reps.map((row: { agent: { id: string } }) => row.agent.id), [A]);
    assert.equal(data.unmapped, null); assert.equal(data.unassigned, null);
    assert.deepEqual(data.spend.by_rep.map((row: { agent_id: string }) => row.agent_id), [A]);
    assert.ok(data.team_medians && typeof data.team_medians.reps === "number");
    const text = JSON.stringify(data);
    assert.ok(!text.includes(B), "no other rep's id"); assert.ok(!text.includes("Synthetic Rep B"), "no other rep's name");
    // The Owner asking for A sees the same scoped view.
    clearOverviewCache();
    const ownerScoped = await owner("GET", `/overview?agent_id=${A}&period=last_7_days`);
    assert.deepEqual(ownerScoped.body!.data.reps, data.reps);
  });

  await t.test("commands: complete, snooze and re-date own follow-ups with a note; everything else FORBIDDEN; no Owner instruction, no direct enqueue", async () => {
    const Instructions = getSalesIntelligenceOwnerInstructionModel();
    const instructionsBefore = await Instructions.countDocuments({});
    // Allowlisted, own follow-ups.
    const complete = await repA("POST", `/followups/${F1._id}/complete`, { command: "complete_followup", expected_revision: 1, disposition: "spoke_with_customer", note: "Spoke, quoting tomorrow" });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    const f1 = await Followups.findById(F1._id).lean();
    assert.equal(f1!.status, "completed"); assert.equal(f1!.completion_basis, "rep_confirmation"); assert.equal(f1!.completed_by, `rep-user-${A}`);
    assert.deepEqual(f1!.owner_instruction_ids, []);
    const snooze = await repA("POST", `/followups/${F4._id}/snooze`, { command: "snooze_followup", expected_revision: 1, until: new Date(+now + DAY).toISOString(), reason: "Customer at work until 5" });
    assert.equal(snooze.status, 200, JSON.stringify(snooze.body));
    const redate = await repA("PATCH", `/followups/${F4._id}`, { command: "patch_followup", expected_revision: 2, changes: { due_at: new Date(+now + 3 * DAY).toISOString() }, reason: "Customer asked for Friday" });
    assert.equal(redate.status, 200, JSON.stringify(redate.body));
    const f4 = await Followups.findById(F4._id).lean();
    assert.equal(+f4!.due_at!, +now + 3 * DAY); assert.equal(f4!.snoozed_until, null); assert.deepEqual(f4!.owner_instruction_ids, []);
    // V-T3 m1: a re-date or snooze past now + 60 days would cancel by proxy (E9): INVALID_INPUT, nothing written.
    for (const [method, path, body] of [
      ["PATCH", `/followups/${F4._id}`, { command: "patch_followup", expected_revision: 3, changes: { due_at: "9999-12-31T00:00:00.000Z" }, reason: "Far away" }],
      ["PATCH", `/followups/${F4._id}`, { command: "patch_followup", expected_revision: 3, changes: { due_at: new Date(+now + 61 * DAY).toISOString() }, reason: "Two months" }],
      ["POST", `/followups/${F4._id}/snooze`, { command: "snooze_followup", expected_revision: 3, until: new Date(+now + 61 * DAY).toISOString(), reason: "Two months" }],
    ] as const) {
      const refused = await repA(method, path, body);
      assert.equal(refused.status, 400, JSON.stringify(refused.body)); assert.equal(refused.body!.code, "INVALID_INPUT");
    }
    assert.equal((await Followups.findById(F4._id).lean())!.revision, 3, "the refused dates wrote nothing");
    assert.equal(await Instructions.countDocuments({}), instructionsBefore, "rep changes are not Owner instructions");
    const audits = await getSalesIntelligenceAuditEventModel().find({ "actor.kind": "rep", event_kind: { $in: ["complete_followup", "snooze_followup", "patch_followup"] } }).lean();
    assert.ok(audits.length >= 3);
    assert.ok(audits.every(row => row.actor.id === `rep-user-${A}`));
    // The record audit of the completion carries the rep and its note.
    const completions = await getSalesIntelligenceAuditEventModel().find({ "actor.kind": "rep", event_kind: "complete_followup" }).lean();
    assert.ok(completions.some(row => (row.current as { note?: string; rep_agent_id?: string } | null)?.note === "Spoke, quoting tomorrow"
      && (row.current as { rep_agent_id?: string }).rep_agent_id === A));
    // Refused: another rep's follow-up (even one A promised), an unknown id, missing note, other commands.
    for (const [target, label] of [[F2._id, "B's follow-up promised by A"], [F3._id, "B's follow-up"], [oid(), "unknown"]] as const) {
      const result = await repA("POST", `/followups/${target}/complete`, { command: "complete_followup", expected_revision: 1, disposition: "completed", note: "trying" });
      assert.equal(result.status, 403, label); assert.equal(result.body!.code, "FORBIDDEN", label);
    }
    assert.equal((await Followups.findById(F2._id).lean())!.status, "open");
    assert.equal((await repA("POST", `/followups/${F4._id}/complete`, { command: "complete_followup", expected_revision: 3, disposition: "completed" })).status, 400);
    for (const [method, path, body] of [
      ["POST", `/outreach/${records.R1}/commands`, { command: "close", expected_revision: 1, reason: "lost" }],
      ["POST", `/outreach/${records.R1}/commands`, { command: "assign", expected_revision: 1, responsible_agent_id: B }],
      ["POST", "/followups", { command: "create_followup", expected_revision: 1, outreach_record_id: records.R1, action: { kind: "call", description: "x", due_at: null } }],
      ["POST", `/followups/${F4._id}/cancel`, { command: "cancel_followup", expected_revision: 3, reason: "x" }],
      ["PATCH", `/followups/${F4._id}`, { command: "patch_followup", expected_revision: 3, changes: { responsible_agent_id: B }, reason: "hand over" }],
    ] as const) {
      const result = await repA(method, path, body);
      assert.equal(result.status, 403, `${method} ${path}`); assert.equal(result.body!.code, "FORBIDDEN");
    }
    assert.equal((await Records.findById(records.R1).lean())!.state === "closed", false);
    // No Owner precedence: the rep's changes carry no Owner instruction (checked above), so later Owner edits and automatic
    // plans treat the follow-up as before. An Owner command isn't sent here: it would queue a paid `number_refresh`.
    // V-T3 M1 (decision amended): rep commands enqueue no job directly. Like an Owner edit, the completion and the re-date
    // change the Number fingerprint, so the next scan (not run here) may re-analyse, budget-gated.
    assert.equal(await paidJobs(), paidBefore, "rep commands enqueue no job directly");
  });

  await t.test("flag off: a rep is refused exactly as before; the Owner's desk is unchanged", async () => {
    const ownerOn = await owner("GET", "/attention?view=all_outreach&limit=50");
    process.env.SALES_INTELLIGENCE_REP_ACCESS = "false";
    try {
      for (const path of ["/attention", `/outreach/${records.R1}`, "/overview", `/followups/${F4._id}/snooze`]) {
        const result = await (path.includes("snooze") ? repA("POST", path, { command: "snooze_followup", expected_revision: 4, until: new Date(+now + DAY).toISOString(), reason: "x" }) : repA("GET", path));
        assert.equal(result.status, 403, path); assert.equal(result.body!.code, "OWNER_REQUIRED", path);
      }
      const ownerOff = await owner("GET", "/attention?view=all_outreach&limit=50");
      assert.deepEqual(ownerOff.body!.data, ownerOn.body!.data);
    } finally { process.env.SALES_INTELLIGENCE_REP_ACCESS = "true"; }
    assert.equal(await paidJobs(), paidBefore);
  });
});
