import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getLeadMessageModel } from "../src/models/LeadMessage";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../src/models/SalesIntelligenceSyncState";
import { CsiError } from "../src/services/salesIntelligence/auth";
import { getContactNumberDetail } from "../src/services/numberActivity/contactNumbers";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import type { NumberTimelineEventDto } from "../src/services/numberActivity/dto";
import {
  normalizeWebhookPartyObservations,
  observeRingCentralWebhookEvents,
} from "../src/services/numberActivity/observeWebhookEvents";
import { applyInteractionObservation } from "../src/services/numberActivity/persistInteraction";
import { reverseDigits, toNationalTenDigit } from "../src/services/numberActivity/phone";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "../src/services/numberActivity/reconcileCallLog";
import {
  decodeNumberCursor,
  numberSearchQuerySchema,
  searchNumberActivity,
} from "../src/services/numberActivity/search";
import {
  decodeTimelineCursor,
  getNumberTimeline,
  type TimelineSource,
} from "../src/services/numberActivity/timeline";
import { WEBHOOK_RECEIPTS_SCOPE } from "../src/services/numberActivity/webhookFanout";
import {
  at,
  callLogRecord,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  internalCallDelivery,
  sessionIdOnlyCallLog,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_COMPANY_DID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  SYNTHETIC_OTHER_ACCOUNT_ID,
  SYNTHETIC_SALES_DID,
  SYNTHETIC_USER_EXTENSION,
  syntheticDirectory,
  transferredCallLog,
  webhookDelivery,
  withheldInboundDelivery,
} from "../src/services/numberActivity/fixtures";

const enabled = process.env.CSI_REPLICA_TEST === "true";
const directory = syntheticDirectory();
const noRoute = () => null;
const noEvent = async () => undefined;
const observe = (payload: unknown, receivedAt: Date) =>
  observeRingCentralWebhookEvents(normalizeWebhookPartyObservations(payload, receivedAt), {
    now: () => receivedAt,
    directory: async () => directory,
    resolveRoute: noRoute,
    recordEvent: noEvent as never,
    configuredAccountId: null,
  });
const okResult = (results: Awaited<ReturnType<typeof observe>>) => {
  const [first] = results;
  assert.ok(first && first.ok, `observation failed: ${JSON.stringify(results)}`);
  return first.result;
};
const applyCallLog = (record: Record<string, unknown>, now: Date) =>
  applyInteractionObservation(
    SYNTHETIC_ACCOUNT_ID,
    { kind: "call_log", record: record as never, proof_ref: `call_log:${String(record.id)}` },
    { now: () => now, directory, resolveRoute: noRoute },
  );
const query = (input: Record<string, unknown>) => numberSearchQuerySchema.parse(input);
const key = (e: NumberTimelineEventDto) => `${e.kind}:${e.id}`;

/** Eight same-instant external callers for the keyset completeness proof (all last_activity_at = T0). */
const SAME_INSTANT_CALLERS = Array.from({ length: 8 }, (_, i) => `+1555010030${i}`);

const SNAPSHOT_COLLECTIONS = [
  "contact_numbers",
  "call_interactions",
  "call_interaction_aliases",
  "number_lead_attachments",
  "lead_messages",
  "lead_conversations",
  "outreach_records",
  "sales_intelligence_jobs",
  "sales_intelligence_audit_events",
  "sales_intelligence_sync_state",
];

test("CSI-04 read-service isolated replica proof", { skip: !enabled, timeout: 240_000 }, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi04r[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_ENABLED, "false", "services do not check the flag; the route layer does");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  const applied = await applyCsiMigration();
  assert.equal(applied.ready, true);
  const Interaction = getCallInteractionModel();
  const ContactNumber = getContactNumberModel();
  const Attachment = getNumberLeadAttachmentModel();
  const Outreach = getOutreachRecordModel();
  const LeadMessage = getLeadMessageModel();
  const LeadConversation = getLeadConversationModel();
  const Jobs = getSalesIntelligenceJobModel();
  const SyncState = getSalesIntelligenceSyncStateModel();

  /** Byte-level snapshot (JSON of every document, `_id` order) of every collection a read could touch. */
  const snapshot = async () => {
    const out: Record<string, string> = {};
    for (const name of SNAPSHOT_COLLECTIONS) {
      out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    }
    return out;
  };
  let readsProvenReadOnly = 0;
  const readOnly = async <T>(label: string, read: () => Promise<T>): Promise<T> => {
    const before = await snapshot();
    const result = await read();
    const after = await snapshot();
    for (const name of SNAPSHOT_COLLECTIONS) assert.equal(after[name], before[name], `${label}: ${name} changed during a read`);
    readsProvenReadOnly += 1;
    return result;
  };

  try {
    // ------------------------------------------------------------------ seeding through CSI-02 primitives
    let customerA!: { _id: mongoose.Types.ObjectId; revision: number };
    let canonicalMergeId!: string;
    let tombstoneId!: string;
    let interactionA1!: string;
    let interactionA2!: string;

    await t.test("seed: Contact Numbers and interactions through applyInteractionObservation (webhook + Call Log), one merged pair with a tombstone", async () => {
      // Customer A: webhook lifecycle then the authoritative Call Log record with one recording.
      const life = inboundQueueAnsweredDeliveries("s-a-1");
      okResult(await observe(life.ringing, at(1)));
      okResult(await observe(life.answered, at(9)));
      okResult(await observe(life.disconnected, at(96)));
      const a1 = await applyCallLog(inboundConnectedCallLog("s-a-1"), at(700));
      interactionA1 = a1.interaction_id;
      assert.deepEqual(a1.new_recording_ids, ["rec-s-a-1-1"]);
      // Customer A: transferred call with two recordings (same instant as s-a-1).
      const a2 = await applyCallLog(transferredCallLog("s-a-2"), at(800));
      interactionA2 = a2.interaction_id;
      assert.equal((await Interaction.findById(a2.interaction_id).lean())?.recordings.length, 2);

      // Customer A: provisional rows bridged by one provider record → canonical + tombstone (CSI-02 merge recipe).
      const noSid = webhookDelivery({
        uuid: "m-1",
        telephonySessionId: "s-merge-1",
        sessionId: null,
        sequence: 1,
        eventTime: at(0),
        parties: inboundQueueAnsweredDeliveries("s-merge-1").disconnected.body.parties.map((p) => ({
          id: p.id,
          extensionId: p.extensionId,
          direction: p.direction,
          status: p.status.code,
          from: p.from,
          to: p.to,
          queueCall: p.queueCall,
        })),
      });
      const rowA = okResult(await observe(noSid, at(1)));
      const rowB = await applyCallLog(sessionIdOnlyCallLog("s-merge-1"), at(700));
      assert.notEqual(rowA.interaction_id, rowB.interaction_id);
      const bridge = inboundConnectedCallLog("s-merge-1");
      bridge.sessionId = "s-merge-1-sid";
      const merged = await applyCallLog(bridge, at(800));
      assert.equal(merged.interaction_id, rowA.interaction_id);
      assert.deepEqual(merged.merged_interaction_ids, [rowB.interaction_id]);
      canonicalMergeId = rowA.interaction_id;
      tombstoneId = rowB.interaction_id;
      const tomb = await Interaction.findById(tombstoneId).lean();
      assert.equal(String(tomb?.merged_into_id), canonicalMergeId);
      assert.equal(String(tomb?.contact_number_id), String((await Interaction.findById(canonicalMergeId).lean())?.contact_number_id), "tombstone keeps contact_number_id");

      const a = await ContactNumber.findOne({ e164: SYNTHETIC_CUSTOMER }).lean();
      assert.ok(a);
      customerA = { _id: a._id, revision: a.revision };
      assert.equal(a.rollups.interactions_total, 3, "s-a-1, s-a-2, merged canonical; the tombstone contributes nothing");
      assert.equal(a.last_activity_at.toISOString(), at(0).toISOString());
      assert.deepEqual(a.provider_names, ["Synthetic Customer"]);

      // Customer B: outbound Call Log an hour earlier (distinct last_activity_at for range/order proofs).
      await applyCallLog(
        callLogRecord({
          id: "cl-s-b-1",
          telephonySessionId: "s-b-1",
          direction: "Outbound",
          result: "No Answer",
          startTime: at(-3600),
          duration: 30,
          from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number },
          to: { phoneNumber: SYNTHETIC_CUSTOMER_B },
        }),
        at(-3500),
      );
      const b = await ContactNumber.findOne({ e164: SYNTHETIC_CUSTOMER_B }).lean();
      assert.equal(b?.last_activity_at.toISOString(), at(-3600).toISOString());
      assert.equal(b?.rollups.outbound_total, 1);

      // Eight callers sharing one instant (keyset completeness proof).
      for (const [i, e164] of SAME_INSTANT_CALLERS.entries()) {
        await applyCallLog(
          callLogRecord({
            id: `cl-same-${i}`,
            telephonySessionId: `s-same-${i}`,
            direction: "Inbound",
            result: "Missed",
            startTime: at(0),
            duration: 10,
            from: { phoneNumber: e164, name: `Same Caller ${i}` },
            to: { phoneNumber: SYNTHETIC_SALES_DID },
          }),
          at(600),
        );
      }
      assert.equal(await ContactNumber.countDocuments({ last_activity_at: at(0), kind: "external" }), 9, "A plus eight same-instant callers");

      // Internal and withheld observations create no Contact Number.
      const numbersBefore = await ContactNumber.countDocuments();
      okResult(await observe(internalCallDelivery("s-int-1"), at(0)));
      okResult(await observe(withheldInboundDelivery("s-wh-1"), at(0)));
      assert.equal(await ContactNumber.countDocuments(), numbersBefore);
      assert.equal(await ContactNumber.countDocuments({ kind: "external" }), 10);
    });

    await t.test("seed: hygiene row, attachment, Outreach records, Lead Messages and Lead Conversations (test seeding through the models, not reads)", async () => {
      // Non-external kind row (Coverage → Hygiene); no capture primitive creates these.
      await ContactNumber.create({
        revision: 1,
        e164: SYNTHETIC_COMPANY_DID,
        national_ten: toNationalTenDigit(SYNTHETIC_COMPANY_DID),
        digits_reversed: reverseDigits(SYNTHETIC_COMPANY_DID),
        country: "US",
        kind: "company_did",
        classification: "company",
        contact_eligibility: { state: "allowed" },
        provider_names: [],
        search_terms: ["main company number"],
        first_observed_at: at(0),
        last_activity_at: at(0),
      });

      // One attachment on A. Rollup counters are Team C's (attachment refresh); set them here as seeding.
      const leadId = new mongoose.Types.ObjectId();
      await Attachment.create({
        contact_number_id: customerA._id,
        lead_ref: { model: "FormLead", id: leadId },
        state: "attached",
        certainty: "exact",
        evidence: [{ source: "owner_attach", field_path: "owner", observed_at: at(0) }],
        revision: 1,
      });
      await Attachment.create({
        contact_number_id: customerA._id,
        lead_ref: { model: "CallLead", id: new mongoose.Types.ObjectId() },
        state: "rejected",
        certainty: "rejected",
        revision: 2,
      });
      await ContactNumber.updateOne(
        { _id: customerA._id, revision: customerA.revision },
        { $set: { "rollups.attached_lead_count": 1 }, $inc: { revision: 1 } },
      );
      customerA.revision += 1;

      // Outreach: one open Number Review on A, one closed Lead record whose primary number is A.
      await Outreach.create({
        subject: { kind: "number_review", contact_number_id: customerA._id },
        state: "open",
        trigger_kind: "owner_open",
        trigger_at: at(0),
        revision: 1,
        policy_version: "csi-policy-v1",
      });
      await Outreach.create({
        subject: { kind: "lead", model: "FormLead", id: leadId },
        primary_contact_number_id: customerA._id,
        state: "closed",
        trigger_kind: "lead_arrival",
        trigger_at: at(-100),
        closed_reason: "lost",
        closed_at: at(-50),
        revision: 1,
        policy_version: "csi-policy-v1",
      });

      // Lead Messages to A (`to` is E.164): same instant as the calls, earlier, and one never sent.
      const messageBase = {
        origin: "public_form" as const,
        provider: "twilio" as const,
        channel: "sms" as const,
        purpose: "quote_request_confirmation" as const,
        template_version: 1,
        from: "+15550100100",
        body: "synthetic body text that must never appear in a DTO",
        dispatch_mode: "queued" as const,
        lead_ref: { model: "FormLead" as const, id: leadId },
      };
      await LeadMessage.create([
        { ...messageBase, message_key: "m1", to: SYNTHETIC_CUSTOMER, status: "delivered", sent_at: at(0), delivered_at: at(5), createdAt: at(-2) },
        { ...messageBase, message_key: "m2", to: SYNTHETIC_CUSTOMER, status: "sent", sent_at: at(-1800), createdAt: at(-1801) },
        { ...messageBase, message_key: "m3", to: SYNTHETIC_CUSTOMER, status: "pending", sent_at: null, createdAt: at(-7200) },
        { ...messageBase, message_key: "mb", to: SYNTHETIC_CUSTOMER_B, status: "delivered", sent_at: at(-3000), delivered_at: at(-2990), createdAt: at(-3001) },
      ]);

      // Lead Conversations: one per recording of A under the capture account, plus a foreign-account row with the same recording id.
      const conversationBase = {
        provider: "ringcentral" as const,
        match_method: "number_only" as const,
        match_confidence: "low" as const,
        direction: "Inbound" as const,
        state: "discovered" as const,
      };
      await LeadConversation.create([
        { ...conversationBase, provider_account_id: SYNTHETIC_ACCOUNT_ID, provider_recording_id: "rec-s-a-1-1", call_log_id: "cl-s-a-1", telephony_session_id: "s-a-1", started_at: at(0), duration_seconds: 95 },
        { ...conversationBase, provider_account_id: SYNTHETIC_ACCOUNT_ID, provider_recording_id: "rec-s-a-2-2", call_log_id: "cl-s-a-2", telephony_session_id: "s-a-2", started_at: at(125), duration_seconds: 175 },
        { ...conversationBase, provider_account_id: SYNTHETIC_OTHER_ACCOUNT_ID, provider_recording_id: "rec-s-a-1-1", started_at: at(0), duration_seconds: 95 },
      ]);
    });

    // ------------------------------------------------------------------ search
    const walkSearch = async (base: Record<string, unknown>) => {
      const pages: string[][] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const page = await readOnly(`search ${JSON.stringify(base)} page ${pages.length}`, () =>
          searchNumberActivity(query(cursor ? { ...base, cursor } : base)),
        );
        pages.push(page.data.items.map((i) => i.id));
        assert.ok(page.data.items.length <= Number(base.limit ?? 50));
        if (!page.data.cursor) break;
        const decoded = decodeNumberCursor(page.data.cursor);
        assert.equal(decoded.id, page.data.items[page.data.items.length - 1]!.id, "cursor points at the last returned item");
        cursor = page.data.cursor;
      }
      return pages;
    };

    await t.test("search: keyset pagination is complete and duplicate-free through a same-instant cluster (nine numbers at one timestamp, limit 2)", async () => {
      const expected = (await ContactNumber.find({ kind: "external" }).sort({ last_activity_at: -1, _id: -1 }).lean()).map((r) => String(r._id));
      assert.equal(expected.length, 10);
      const pages = await walkSearch({ limit: 2 });
      assert.equal(pages.length, 5, "10 rows / 2 per page");
      const flat = pages.flat();
      assert.deepEqual(flat, expected, "pages concatenate to the full ordered set: no skips, no duplicates, no reordering");
      assert.equal(new Set(flat).size, flat.length);
      assert.equal(flat[flat.length - 1], String((await ContactNumber.findOne({ e164: SYNTHETIC_CUSTOMER_B }).lean())!._id), "the hour-older customer sorts last");

      const first = await readOnly("search default", () => searchNumberActivity(query({})));
      assert.equal(first.data.items.length, 10);
      assert.equal(first.data.cursor, null);
      assert.ok(first.data.items.every((i) => i.kind === "external"));
      assert.ok(first.data.items.every((i) => !("search_terms" in i)), "search_terms is detail-only");
      assert.deepEqual(first.data.items.map((i) => i.match.kind), Array(10).fill("none"));
      assert.equal(first.coverage.known_through, null);
      assert.match(first.as_of, /^\d{4}-\d{2}-\d{2}T/);
    });

    await t.test("search: e164, suffix and term matching (provider names live in search_terms)", async () => {
      const exact = await readOnly("search e164", () => searchNumberActivity(query({ q: "(555) 010-0200" })));
      assert.deepEqual(exact.data.items.map((i) => [i.e164, i.match.kind]), [[SYNTHETIC_CUSTOMER, "e164"]]);
      assert.equal(exact.data.items[0]!.linked, true);
      assert.equal(exact.data.items[0]!.rollups.interactions_total, 3);
      assert.equal(exact.data.items[0]!.national_ten, "5550100200");

      const suffix = await readOnly("search suffix", () => searchNumberActivity(query({ q: "0200" })));
      assert.deepEqual(suffix.data.items.map((i) => [i.e164, i.match.kind]), [[SYNTHETIC_CUSTOMER, "suffix"]], "only +15550100200 ends in 0200");
      const suffix7 = await readOnly("search suffix 7", () => searchNumberActivity(query({ q: "010-0201" })));
      assert.deepEqual(suffix7.data.items.map((i) => i.e164), [SYNTHETIC_CUSTOMER_B]);

      const term = await readOnly("search term", () => searchNumberActivity(query({ q: "Synthetic" })));
      assert.deepEqual(term.data.items.map((i) => [i.e164, i.match.kind]), [[SYNTHETIC_CUSTOMER, "term"]], "caller-id name observed on the webhook party");
      const one = await readOnly("search term exact", () => searchNumberActivity(query({ q: "same caller 3" })));
      assert.deepEqual(one.data.items.map((i) => i.e164), [SAME_INSTANT_CALLERS[3]]);
      const prefix = await readOnly("search term prefix", () => searchNumberActivity(query({ q: "same" })));
      assert.equal(prefix.data.items.length, 8);
      const none = await readOnly("search term none", () => searchNumberActivity(query({ q: "aller" })));
      assert.equal(none.data.items.length, 0, "anchored prefix, not substring");
      const regexSafe = await readOnly("search regex chars", () => searchNumberActivity(query({ q: ".*" })));
      assert.equal(regexSafe.data.items.length, 0, "regex metacharacters are literal");
    });

    await t.test("search: attachment, activity range, classification and hygiene filters", async () => {
      const linked = await readOnly("search linked", () => searchNumberActivity(query({ attachment: "linked" })));
      assert.deepEqual(linked.data.items.map((i) => i.e164), [SYNTHETIC_CUSTOMER]);
      const unlinked = await readOnly("search unlinked", () => searchNumberActivity(query({ attachment: "unlinked" })));
      assert.equal(unlinked.data.items.length, 9);
      assert.ok(unlinked.data.items.every((i) => i.e164 !== SYNTHETIC_CUSTOMER && i.linked === false));

      const older = await readOnly("search active_to", () => searchNumberActivity(query({ active_to: at(-1800).toISOString() })));
      assert.deepEqual(older.data.items.map((i) => i.e164), [SYNTHETIC_CUSTOMER_B]);
      const recent = await readOnly("search active_from", () => searchNumberActivity(query({ active_from: at(-1).toISOString() })));
      assert.equal(recent.data.items.length, 9);
      const window = await readOnly("search window", () => searchNumberActivity(query({ active_from: at(-3600).toISOString(), active_to: at(-3600).toISOString() })));
      assert.deepEqual(window.data.items.map((i) => i.e164), [SYNTHETIC_CUSTOMER_B]);

      assert.equal((await readOnly("search classification", () => searchNumberActivity(query({ classification: "customer" })))).data.items.length, 0);
      assert.equal((await readOnly("search classification unknown", () => searchNumberActivity(query({ classification: "unknown" })))).data.items.length, 10);

      const hygiene = await readOnly("search hygiene", () => searchNumberActivity(query({ hygiene: "true" })));
      assert.deepEqual(hygiene.data.items.map((i) => [i.e164, i.kind]), [[SYNTHETIC_COMPANY_DID, "company_did"]]);
      const hidden = await readOnly("search default hides hygiene", () => searchNumberActivity(query({})));
      assert.ok(hidden.data.items.every((i) => i.e164 !== SYNTHETIC_COMPANY_DID), "non-external kinds hidden by default");
      const hygieneTerm = await readOnly("search hygiene term", () => searchNumberActivity(query({ hygiene: "true", q: "main company" })));
      assert.equal(hygieneTerm.data.items.length, 1);

      await assert.rejects(() => searchNumberActivity(query({ cursor: "garbage" })), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
    });

    // ------------------------------------------------------------------ timeline
    let fullTimeline!: NumberTimelineEventDto[];
    const walkTimeline = async (limit: number, deps?: Parameters<typeof getNumberTimeline>[2]) => {
      const items: NumberTimelineEventDto[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 50; guard += 1) {
        const page = await readOnly(`timeline limit ${limit} page ${guard}`, () => getNumberTimeline(String(customerA._id), { limit, cursor }, deps));
        assert.ok(page);
        assert.ok(page.data.items.length <= limit);
        items.push(...page.data.items);
        if (!page.data.cursor) break;
        const last = page.data.items[page.data.items.length - 1]!;
        assert.deepEqual(decodeTimelineCursor(page.data.cursor), { happened_at: last.happened_at, kind: last.kind, id: last.id });
        cursor = page.data.cursor;
      }
      return items;
    };

    await t.test("timeline: cross-kind ordering with same-millisecond ties, canonical dedupe, recordings per entry, messages and conversations present", async () => {
      const page = await readOnly("timeline full", () => getNumberTimeline(String(customerA._id), { limit: 100 }));
      assert.ok(page);
      assert.equal(page.data.number_id, String(customerA._id));
      assert.equal(page.data.cursor, null);
      fullTimeline = page.data.items;
      assert.equal(fullTimeline.length, 8, "3 canonical interactions + 3 Lead Messages + 2 conversations");
      assert.deepEqual(
        fullTimeline.map((e) => [e.kind, e.happened_at]),
        [
          ["conversation", at(125).toISOString()],
          ["conversation", at(0).toISOString()],
          ["interaction", at(0).toISOString()],
          ["interaction", at(0).toISOString()],
          ["interaction", at(0).toISOString()],
          ["lead_message", at(0).toISOString()],
          ["lead_message", at(-1800).toISOString()],
          ["lead_message", at(-7200).toISOString()],
        ],
        "happened_at desc, then kind asc inside the same millisecond",
      );
      const sameInstantInteractions = fullTimeline.filter((e) => e.kind === "interaction").map((e) => e.id);
      assert.deepEqual(sameInstantInteractions, [...sameInstantInteractions].sort().reverse(), "same instant and kind: id desc");
      assert.deepEqual(sameInstantInteractions.sort(), [interactionA1, interactionA2, canonicalMergeId].sort());
      assert.equal(fullTimeline.some((e) => e.id === tombstoneId), false, "the merge tombstone never appears");
      assert.equal(fullTimeline.filter((e) => e.id === canonicalMergeId).length, 1, "the canonical row appears once");

      const transfer = fullTimeline.find((e) => e.id === interactionA2)!;
      assert.equal(transfer.detail.recording_count, 2, "recordings counted per recordings[] entry");
      assert.deepEqual(transfer.detail.recording_ids, ["rec-s-a-2-1", "rec-s-a-2-2"]);
      assert.deepEqual(transfer.evidence_refs, [`interaction:${interactionA2}`, "recording:rec-s-a-2-1", "recording:rec-s-a-2-2"]);
      assert.equal(transfer.detail.direction, "Inbound");
      assert.equal(transfer.detail.terminal, true);
      assert.equal(transfer.detail.provider_result, "Call connected");
      assert.equal(typeof transfer.detail.projection_revision, "number");
      assert.deepEqual(transfer.detail.sources, ["call_log_reconcile"]);
      const a1 = fullTimeline.find((e) => e.id === interactionA1)!;
      assert.equal(a1.detail.duration_seconds, 95);
      assert.deepEqual(a1.detail.sources, ["call_log_reconcile", "webhook"]);
      assert.notEqual(a1.observed_at, a1.happened_at, "observed_at is the last observation, kept separate from event time");

      const messages = fullTimeline.filter((e) => e.kind === "lead_message");
      assert.deepEqual(messages.map((e) => e.detail.status), ["delivered", "sent", "pending"]);
      assert.equal(messages[2]!.happened_at, at(-7200).toISOString(), "never-sent message falls back to createdAt");
      assert.equal(messages[0]!.observed_at, at(-2).toISOString());
      for (const message of messages) {
        assert.equal("body" in message.detail, false, "no message body in the DTO");
        assert.equal(JSON.stringify(message).includes("synthetic body text"), false);
        assert.equal(message.detail.purpose, "quote_request_confirmation");
        assert.ok(message.detail.lead_ref);
      }

      const conversations = fullTimeline.filter((e) => e.kind === "conversation");
      assert.deepEqual(conversations.map((e) => e.detail.provider_recording_id), ["rec-s-a-2-2", "rec-s-a-1-1"]);
      assert.equal(conversations.length, 2, "the foreign-account conversation with the same recording id is excluded");
      assert.equal(conversations[1]!.evidence_refs[1], "recording:rec-s-a-1-1");
      for (const c of conversations) {
        assert.equal("transcript" in c.detail, false);
        assert.equal("summary" in c.detail, false);
      }
      for (const e of fullTimeline) assert.equal(e.subject_key, `number:${String(customerA._id)}`);

      // Customer B has one call and one message; the tombstone/others never leak across numbers.
      const b = await ContactNumber.findOne({ e164: SYNTHETIC_CUSTOMER_B }).lean();
      const pageB = await readOnly("timeline B", () => getNumberTimeline(String(b!._id), {}));
      assert.deepEqual(pageB!.data.items.map((e) => [e.kind, e.happened_at]), [
        ["lead_message", at(-3000).toISOString()],
        ["interaction", at(-3600).toISOString()],
      ]);
    });

    await t.test("timeline: cursor pagination is complete across same-millisecond, cross-kind ties; malformed/missing ids are null; extra sources merge", async () => {
      for (const limit of [1, 2, 3, 5]) {
        const walked = await walkTimeline(limit);
        assert.deepEqual(walked.map(key), fullTimeline.map(key), `limit ${limit}: pages concatenate to the full ordered timeline`);
      }
      assert.equal(await getNumberTimeline("not-an-id", {}), null);
      assert.equal(await getNumberTimeline(String(new mongoose.Types.ObjectId()), {}), null);
      await assert.rejects(() => getNumberTimeline(String(customerA._id), { cursor: "garbage" }), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");

      const nudgeId = String(new mongoose.Types.ObjectId());
      const nudgeSource: TimelineSource = async ({ number_id, cursor }) => {
        const event: NumberTimelineEventDto = {
          id: nudgeId,
          kind: "nudge",
          happened_at: at(0).toISOString(),
          observed_at: at(1).toISOString(),
          subject_key: `number:${number_id}`,
          description: "synthetic Team C event",
          evidence_refs: [`nudge:${nudgeId}`],
          detail: {},
        };
        const after = !cursor || Date.parse(event.happened_at) < Date.parse(cursor.happened_at) || (event.happened_at === cursor.happened_at && ("nudge" > cursor.kind || (cursor.kind === "nudge" && event.id < cursor.id)));
        return after ? [event] : [];
      };
      const withExtra = await walkTimeline(3, { extraSources: [nudgeSource] });
      assert.equal(withExtra.length, 9);
      const at0 = withExtra.filter((e) => e.happened_at === at(0).toISOString()).map((e) => e.kind);
      assert.deepEqual(at0, ["conversation", "interaction", "interaction", "interaction", "lead_message", "nudge"], "extra source events take their place in the total order");
    });

    // ------------------------------------------------------------------ detail
    await t.test("detail: attachments, connections counts, fresh interaction recount, allowed actions; malformed/missing ids are null", async () => {
      const detail = await readOnly("detail A", () => getContactNumberDetail(String(customerA._id)));
      assert.ok(detail);
      const d = detail.data;
      assert.equal(d.id, String(customerA._id));
      assert.equal(d.e164, SYNTHETIC_CUSTOMER);
      assert.equal(d.kind, "external");
      assert.equal(d.national_ten, "5550100200");
      assert.equal(d.revision, customerA.revision);
      assert.equal(d.eligibility, "allowed");
      assert.equal(d.classification, "unknown");
      assert.deepEqual(d.attachments.map((a) => [a.lead_ref.model, a.state, a.certainty]), [["FormLead", "attached", "exact"], ["CallLead", "rejected", "rejected"]]);
      assert.deepEqual(d.connections, {
        attachments_total: 2,
        attached: 1,
        candidate: 0,
        ambiguous: 0,
        rejected: 1,
        outreach_records_total: 2,
        open_outreach: 1,
        interactions_total_recount: 3,
      });
      assert.equal(d.connections.interactions_total_recount, d.rollups.interactions_total, "recount excludes the tombstone and matches the rollup");
      assert.equal(await Interaction.countDocuments({ contact_number_id: customerA._id }), 4, "four rows exist including the tombstone");
      assert.equal(d.rollups.attached_lead_count, 1);
      assert.equal(d.rollups.inbound_total, 3);
      assert.equal(d.rollups.last_inbound_at, at(0).toISOString());
      assert.equal(d.rollups.last_outbound_at, null);
      assert.deepEqual(d.provider_names, ["Synthetic Customer"]);
      assert.deepEqual(d.search_terms, ["synthetic customer"]);
      assert.deepEqual(d.outreach_records, []);
      assert.deepEqual(d.restrictions, []);
      assert.deepEqual(d.review_items, []);
      assert.equal(d.running_analysis, null);
      assert.deepEqual(d.allowed_actions, [{ action: "rebuild_number", enabled: true, blocker_codes: [], target_id: String(customerA._id), expected_revision: customerA.revision }]);
      assert.equal(d.first_observed_at, at(0).toISOString());
      assert.equal(d.last_activity_at, at(0).toISOString());

      assert.equal(await getContactNumberDetail("nope"), null);
      assert.equal(await getContactNumberDetail(String(new mongoose.Types.ObjectId())), null);
      const company = await ContactNumber.findOne({ e164: SYNTHETIC_COMPANY_DID }).lean();
      const hygieneDetail = await readOnly("detail hygiene", () => getContactNumberDetail(String(company!._id)));
      assert.equal(hygieneDetail?.data.kind, "company_did");
      assert.equal(hygieneDetail?.data.connections.interactions_total_recount, 0);
    });

    // ------------------------------------------------------------------ coverage
    await t.test("coverage: honest without sync state; watermark, gaps, webhook capability and AI pause reported once they exist", async () => {
      assert.equal(await SyncState.countDocuments(), 0);
      const empty = await readOnly("coverage empty", () => readCaptureCoverage());
      assert.deepEqual(empty, {
        known_through: null,
        gaps: [],
        capabilities: { call_log: "unknown", recording_content: "unknown", webhook: "unknown" },
        ai_paused: false,
      });

      await SyncState.create({
        scope: CALL_LOG_ALL_DIRECTIONS_SCOPE,
        lease_epoch: 3,
        known_complete_through: at(-900),
        gaps: [{ from: at(-7200), to: at(-6000), reason: "provider_request_failed", opened_at: at(-5900) }],
        consecutive_failures: 0,
      });
      const withState = await readOnly("coverage with state", () => readCaptureCoverage());
      assert.deepEqual(withState, {
        known_through: at(-900).toISOString(),
        gaps: [{ from: at(-7200).toISOString(), to: at(-6000).toISOString(), reason: "provider_request_failed" }],
        capabilities: { call_log: "ok", recording_content: "unknown", webhook: "unknown" },
        ai_paused: false,
      });

      await SyncState.create({ scope: WEBHOOK_RECEIPTS_SCOPE, lease_epoch: 1, cursor: { last_sync_to: at(-60) }, consecutive_failures: 0 });
      await Jobs.create({
        dedupe_key: "csi:analysis:synthetic:paused",
        payload_hash: "synthetic",
        stage: "analysis",
        subject_key: "conversation:synthetic",
        input_revision: 1,
        deployment: "csi-local-proof",
        database: getMongoDatabaseName(),
        status: "paused",
        reason: "budget_exhausted",
        next_attempt_at: at(0),
      });
      await Jobs.create({
        dedupe_key: "csi:analysis:synthetic:other-deployment",
        payload_hash: "synthetic",
        stage: "analysis",
        subject_key: "conversation:synthetic-2",
        input_revision: 1,
        deployment: "some-other-deployment",
        database: getMongoDatabaseName(),
        status: "paused",
        reason: "budget_exhausted",
        next_attempt_at: at(0),
      });
      const paused = await readOnly("coverage paused", () => readCaptureCoverage());
      assert.equal(paused.ai_paused, true);
      assert.equal(paused.capabilities.webhook, "ok");

      await SyncState.updateOne(
        { scope: WEBHOOK_RECEIPTS_SCOPE },
        { $set: { consecutive_failures: 7, last_run: { error_code: "provider_request_failed" } } },
      );
      assert.equal(
        (await readOnly("coverage webhook failing", () => readCaptureCoverage())).capabilities.webhook,
        "unavailable",
        "a failing webhook stream is not reported as ok just because the lease row exists",
      );
      await SyncState.updateOne(
        { scope: WEBHOOK_RECEIPTS_SCOPE },
        { $set: { consecutive_failures: 0, last_run: { error_code: null } } },
      );
      await Jobs.updateOne({ dedupe_key: "csi:analysis:synthetic:paused" }, { $set: { status: "pending", reason: null } });
      assert.equal((await readOnly("coverage other deployment", () => readCaptureCoverage())).ai_paused, false, "a paused job in another deployment does not pause this dataset");

      const wrapped = await readOnly("search after coverage", () => searchNumberActivity(query({ limit: 1 })));
      assert.equal(wrapped.coverage.known_through, at(-900).toISOString());
      assert.equal(wrapped.coverage.gaps.length, 1);
    });

    assert.ok(readsProvenReadOnly >= 40, `every read above ran under a before/after snapshot (${readsProvenReadOnly})`);
  } finally {
    if (/^testvantagemovers_csi04r[a-z0-9]+$/.test(db.databaseName)) {
      await db.dropDatabase().catch(() => undefined);
    }
    await mongoose.disconnect();
  }
});
