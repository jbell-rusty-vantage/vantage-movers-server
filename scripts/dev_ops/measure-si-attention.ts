import { spawn } from "node:child_process";
/**
 * S2-DESK B8 and the Attention publish walk at production-like volume (data spec §3.7, TEAM-1 §6).
 *
 * Generates, in its own replica database `testvantagemovers_s2volume`, the production shape of
 * 2026-09-23: 8,031 live Outreach records of which 2,559 closed in the last 90 days, 798 Contact
 * Numbers (most records have none), follow-ups on the worked records, Bookings/Cancellations for the
 * official closures, Lead progress and Move assessment projections. Then it publishes once per
 * variant (flag off; flag on, auto layout; flag on, chunked) and measures `readAttention` over a
 * mix of ≥ 200 default, filtered, sorted, closed-view and paged requests.
 *
 * Usage: node --import tsx scripts/dev_ops/measure-si-attention.ts   (replica csi01 on 27189)
 */
const database = "testvantagemovers_s2volume";
if (process.env.S2_MEASURE_CHILD !== "1") {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", __filename], {
    stdio: "inherit",
    env: {
      ...process.env, S2_MEASURE_CHILD: "1", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
      SALES_INTELLIGENCE_ATTENTION_V2: "false", RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}

const DAY = 86_400_000;
const TOTAL = Number(process.env.S2_RECORDS ?? 8031), CLOSED_90D = Number(process.env.S2_CLOSED_90D ?? 2559), CLOSED_OLDER = Number(process.env.S2_CLOSED_OLDER ?? 900);
const NUMBERS = 798, AGENTS = 12, READS = Number(process.env.S2_READS ?? 220);

/** Deterministic PRNG so every run generates the same volume. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pct = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? NaN; };

async function main() {
  const assert = await import("node:assert/strict");
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getOutreachFollowupModel } = await import("../../src/models/OutreachFollowup");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { getSalesIntelligenceAttentionSnapshotModel } = await import("../../src/models/SalesIntelligenceAttentionSnapshot");
  const { publishAttentionSnapshot, readAttention, decompressAttentionRows, clearParsedAttentionSnapshots } = await import("../../src/services/salesIntelligence/outreach/attention");
  const { readCaptureCoverage } = await import("../../src/services/numberActivity/coverage");
  const { defaultCsiPolicy } = await import("../../src/services/salesIntelligence/policy");

  assert.equal(getMongoDatabaseName(), database);
  // S2_DRY=1 generates and validates the volume without a database (generator check only).
  const dry = process.env.S2_DRY === "1";
  if (!dry) await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  if (!dry) {
    assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
    await db.dropDatabase();
    await applyCsiMigration();
  }
  const rand = prng(20260923);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const oid = () => new mongoose.Types.ObjectId();
  const now = Date.now();
  const policy = defaultCsiPolicy();
  const agents = Array.from({ length: AGENTS }, (_, i) => ({ _id: oid(), name: `Synthetic Agent ${i + 1}` }));
  if (!dry) await db.collection("agents").insertMany(agents);

  // ---------------------------------------------------------------- generation
  const genStart = Date.now();
  const Numbers = getContactNumberModel(), Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel();
  /** Mongoose defaults and validation without a round trip per document; raw insertMany afterwards. */
  const valid = <D extends { validateSync(): unknown; toObject(): unknown }>(doc: D) => { const error = doc.validateSync(); if (error) throw error; return doc.toObject() as ReturnType<D["toObject"]>; };
  const numbers = Array.from({ length: NUMBERS }, (_, i) => {
    const e164 = `+1555${String(1_000_000 + i).slice(1)}`;
    const calls = 1 + Math.floor(rand() * 14);
    const inbound = Math.floor(calls * rand());
    const last = new Date(now - rand() * 60 * DAY);
    return valid(new Numbers({ e164, national_ten: e164.slice(2), digits_reversed: [...e164.slice(2)].reverse().join(""), kind: "external", classification: "customer",
      first_observed_at: new Date(+last - rand() * 90 * DAY), last_activity_at: last,
      rollups: { interactions_total: calls, inbound_total: inbound, outbound_total: calls - inbound, human_conversations_total: Math.floor(calls / 3),
        last_inbound_at: inbound ? new Date(+last - rand() * DAY) : null, last_outbound_at: new Date(+last - rand() * 2 * DAY), recordings_total: Math.floor(calls / 2),
        conversations_analyzed_total: Math.floor(calls / 4), outreach_records_total: 1 } }));
  });
  if (!dry) for (let i = 0; i < numbers.length; i += 1000) await Numbers.collection.insertMany(numbers.slice(i, i + 1000));
  const reasons: Array<[string, string, number]> = [["booked", "official", 0.34], ["cancelled", "official", 0.08], ["bad_lead", "official", 0.1], ["duplicate", "official", 0.16],
    ["no_sync", "official", 0.05], ["granot_dead_opportunity", "crm_disposition", 0.1], ["granot_bad_unusable", "crm_disposition", 0.05], ["Owner closed: not moving", "owner", 0.1], ["lead_unavailable", "official", 0.02]];
  const closure = () => { let r = rand(); for (const entry of reasons) { if ((r -= entry[2]) <= 0) return entry; } return reasons[0]!; };
  const leads: Record<string, unknown>[] = [], records: Record<string, unknown>[] = [], followups: Record<string, unknown>[] = [], bookings: Record<string, unknown>[] = [], cancels: Record<string, unknown>[] = [];
  let numberCursor = 0;
  for (let i = 0; i < TOTAL; i++) {
    const kind = i < CLOSED_90D ? "closed90" : i < CLOSED_90D + CLOSED_OLDER ? "closedOld" : "active";
    const closedAt = kind === "closed90" ? new Date(now - rand() * 90 * DAY + 60_000) : kind === "closedOld" ? new Date(now - (91 + rand() * 200) * DAY) : null;
    const trigger = closedAt ? new Date(+closedAt - (0.2 + rand() * 20) * DAY) : new Date(now - rand() * 60 * DAY);
    const leadId = oid();
    leads.push({ _id: leadId, timestamp: trigger, createdAt: trigger, updatedAt: trigger, name: `Synthetic Volume ${i}`, job_no: `V-${i}`, pickup_city: pick(["Boston", "Austin", "Miami", "Denver"]),
      pickup_state: pick(["MA", "TX", "FL", "CO"]), delivery_city: pick(["Seattle", "Atlanta", "Phoenix"]), delivery_state: pick(["WA", "GA", "AZ"]),
      move_date: new Date(Date.UTC(2026, 8, 1) + Math.floor(rand() * 120) * DAY), move_size: pick(["Studio", "1 Bedroom", "2 Bedroom", "3 Bedroom"]), receiver_agent: pick(agents)._id });
    // Production: ≈ 800 Numbers across ≈ 8,000 records; most Lead-only records have no primary Number.
    const withNumber = numberCursor < NUMBERS && rand() < 0.1;
    const number = withNumber ? numbers[numberCursor++]! : null;
    const [reason, origin] = closedAt ? closure() : [null, null];
    const priority = rand() < 0.45 ? pick(["0", "1", "3", "5", "9"]) : null;
    const crmPriority = origin === "crm_disposition" ? (reason === "granot_dead_opportunity" ? "8" : "7") : priority;
    const record: Record<string, unknown> = { _id: oid(), subject: { kind: "lead", model: "FormLead", id: leadId }, trigger_kind: "lead_arrival", trigger_at: trigger, policy_version: policy.version,
      state: closedAt ? "closed" : pick(["unworked", "open", "open", "open", "waiting_on_customer"]), primary_contact_number_id: number?._id ?? null,
      first_action_due_at: new Date(+trigger + 15 * 60_000), responsible_agent_id: rand() < 0.4 ? pick(agents)._id : null,
      last_meaningful_contact_at: number ? number.rollups.last_outbound_at : null,
      closed_reason: reason, closed_at: closedAt, closure_origin: origin, closed_by: closedAt ? "system" : null,
      lead_progress: crmPriority != null ? { granot_priority: crmPriority, quoted: crmPriority === "1", disposition: ({ "0": "fresh", "1": "quoted", "3": "rep_discretion", "7": "crm_bad_unusable", "8": "crm_dead" } as Record<string, string>)[crmPriority] ?? "unmapped",
        work_observed: crmPriority !== "0", provenance: "accepted", projected_at: trigger, fingerprint: `fp-${i}`, disposition_revision: `dr-${i}`, last_progress_at: new Date(+trigger + DAY) } : null,
      move_assessment: number && rand() < 0.6 ? { artifact_id: oid(), status: pick(["ready", "ready", "insufficient_evidence"]), transaction_intent: Math.floor(rand() * 101), move_likelihood: Math.floor(rand() * 101),
        transaction_intent_confidence: "medium", move_likelihood_confidence: "medium", context_as_of: number.last_activity_at, latest_conversation_at: new Date(+number.last_activity_at - rand() * 2 * DAY),
        input_fingerprint: `ma-${i}`, schema_version: "move-assessment-v1", stale: false, published_at: number.last_activity_at, conflict_targets: rand() < 0.1 ? ["move_date"] : [] } : null };
    records.push(valid(new Records(record)) as Record<string, unknown>);
    if (reason === "booked" || reason === "cancelled" || (kind === "closedOld" && rand() < 0.3)) {
      const bookingId = oid();
      bookings.push({ _id: bookingId, lead_model: "FormLead", lead_ref: leadId, agent: pick(agents)._id, book_date: new Date(+trigger + (+closedAt! - +trigger) * (reason === "cancelled" ? 0.6 : 1)), job_no: `V-${i}`, total_binder_amount: 900 + Math.floor(rand() * 4000) });
      if (reason === "cancelled") cancels.push({ _id: oid(), booked_lead: bookingId, cancel_date: closedAt, reason: pick(["Moving later", "Found another mover", null]) });
    }
    // Follow-ups on the worked records: open callbacks (some overdue) plus completed history.
    const followupCount = !closedAt && (number || rand() < 0.3) ? 1 + Math.floor(rand() * 2) : closedAt && rand() < 0.3 ? 1 : 0;
    for (let k = 0; k < followupCount; k++) {
      const due = new Date(now + (rand() - 0.6) * 4 * DAY);
      const status = closedAt ? "cancelled" : k === 0 ? "open" : "completed";
      followups.push(valid(new Followups({ outreach_record_id: record._id, commitment_key: `ck-${i}-${k}`, kind: "call", description: "Synthetic callback", status, due_at: due,
        attention_due_at: due, base_attention_due_at: due, responsible_agent_id: rand() < 0.7 ? pick(agents)._id : null, promised_by_agent_id: rand() < 0.5 ? pick(agents)._id : null,
        origin: pick(["rep_promise", "system_default", "customer_request"]), date_resolution: { precision: "exact", timezone: policy.timezone, anchor: trigger, policy_version: policy.version } })) as Record<string, unknown>);
    }
  }
  const insert = async (name: string, docs: Record<string, unknown>[]) => { if (dry) return; for (let i = 0; i < docs.length; i += 1000) if (docs.slice(i, i + 1000).length) await db.collection(name).insertMany(docs.slice(i, i + 1000)); };
  await insert("form_leads", leads);
  await insert(Records.collection.collectionName, records);
  await insert(Followups.collection.collectionName, followups);
  await insert("booked_leads", bookings);
  await insert("cancelled_leads", cancels);
  const generated = { records: records.length, closed_90d: CLOSED_90D, closed_older: CLOSED_OLDER, active: TOTAL - CLOSED_90D - CLOSED_OLDER, numbers: NUMBERS,
    records_with_number: numberCursor, followups: followups.length, bookings: bookings.length, cancellations: cancels.length, generate_ms: Date.now() - genStart };
  console.log("# generated", JSON.stringify(generated));
  if (dry) return;

  // ---------------------------------------------------------------- publish + reads per variant
  const Snapshots = getSalesIntelligenceAttentionSnapshotModel();
  const agentId = String(agents[0]!._id);
  const mix = (closedView: boolean): Array<[string, Record<string, unknown>]> => {
    const base: Array<[string, Record<string, unknown>]> = [
      ["default", {}], ["default", { limit: 50 }],
      ["all_outreach", { view: "all_outreach", sort: "lead_received" }],
      ["filtered", { band: "1,2" }], ["filtered", { view: "all_outreach", agent_id: agentId }], ["filtered", { view: "all_outreach", has_recording: "true" }],
      ["filtered", { view: "all_outreach", priority: "not_set" }], ["filtered", { view: "all_outreach", move_date_within: "30" }],
      ["filtered", { view: "all_outreach", sort: "transaction_intent", ti_min: "50" }], ["filtered", { view: "all_outreach", unassigned: "true", received_from: new Date(now - 7 * DAY).toISOString() }],
      ["sorted", { view: "all_outreach", sort: "last_call" }], ["sorted", { view: "all_outreach", sort: "interactions" }], ["sorted", { view: "all_outreach", sort: "next_action_due" }],
    ];
    if (closedView) base.push(["closed", { view: "closed" }], ["closed", { view: "closed", outcome: "booked" }], ["closed", { view: "closed", sort: "time_to_close" }],
      ["closed", { view: "closed", closed_from: new Date(now - 7 * DAY).toISOString() }]);
    return base;
  };
  async function measure(label: string, publish: Parameters<typeof publishAttentionSnapshot>[0]) {
    await readCaptureCoverage();
    const t0 = Date.now();
    const published = await publishAttentionSnapshot({ ...publish, deadlineMs: 600_000 }) as { status: string; snapshot_id: string; total_items: number; closed_items?: number };
    const walkMs = Date.now() - t0;
    assert.equal(published.status, "published");
    const header = await Snapshots.findOne({ snapshot_id: published.snapshot_id }).lean();
    const chunkDocs = await Snapshots.find({ parent_snapshot_id: published.snapshot_id }).lean();
    const rowsGzip = header?.rows_gzip_base64 ? Buffer.byteLength(header.rows_gzip_base64) : 0;
    const decoded = header?.rows_gzip_base64 ? Buffer.byteLength(JSON.stringify(decompressAttentionRows(header.rows_gzip_base64))) : chunkDocs.reduce((n, d) => n + Buffer.byteLength(JSON.stringify(d.rows)), 0);
    const size = { total_items: published.total_items, closed_items: published.closed_items ?? 0, layout: header?.rows_gzip_base64 ? "inline_gzip" : chunkDocs.length ? `chunked(${chunkDocs.length})` : "inline_rows",
      rows_gzip_bytes: rowsGzip, rows_decoded_bytes: decoded, index_gzip_bytes: header?.index_gzip_base64 ? Buffer.byteLength(header.index_gzip_base64) : 0,
      header_bson_bytes: header ? mongoose.mongo.BSON.calculateObjectSize(header) : 0, largest_chunk_bson_bytes: Math.max(0, ...chunkDocs.map(d => mongoose.mongo.BSON.calculateObjectSize(d))) };
    const requests = mix(Boolean(publish?.attentionV2));
    // Cold reads: the parsed-snapshot cache is empty (a new instance, or the first read after a publish).
    const cold: number[] = [];
    for (let i = 0; i < 5; i++) {
      clearParsedAttentionSnapshots();
      const start = performance.now();
      await readAttention(requests[0]![1]);
      cold.push(performance.now() - start);
    }
    const timings: Record<string, number[]> = {};
    const all: number[] = [];
    for (let i = 0; i < READS; i++) {
      const [kind, query] = requests[i % requests.length]!;
      let start = performance.now();
      const page = await readAttention(query);
      let ms = performance.now() - start;
      (timings[kind] ??= []).push(ms); all.push(ms);
      // Every fifth request also follows its cursor two pages deep ("paged").
      if (i % 5 === 0 && page.data.cursor) {
        let cursor: string | null = page.data.cursor;
        for (let depth = 0; depth < 2 && cursor; depth++) {
          start = performance.now();
          const next: Awaited<ReturnType<typeof readAttention>> = await readAttention({ ...query, cursor });
          ms = performance.now() - start;
          (timings.paged ??= []).push(ms); all.push(ms);
          cursor = next.data.cursor;
        }
      }
    }
    const summary = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { n: v.length, p50: +pct(v, 0.5).toFixed(1), p95: +pct(v, 0.95).toFixed(1) }]));
    const result = { label, walk_ms: walkMs, walk_budget_ms: 90_000, size, reads: { n: all.length, p50: +pct(all, 0.5).toFixed(1), p95: +pct(all, 0.95).toFixed(1), max: +Math.max(...all).toFixed(1) }, cold_reads_ms: cold.map(ms => +ms.toFixed(1)), by_kind: summary };
    console.log(`# ${label}`, JSON.stringify(result));
    return result;
  }
  try {
    const results = [];
    // Warm the process (module init, coverage memo, connection pool) before the first measured publish.
    await publishAttentionSnapshot({ attentionV2: false, deadlineMs: 600_000 });
    results.push(await measure("flag_off (today's read path)", { attentionV2: false }));
    results.push(await measure("flag_on auto layout", { attentionV2: true }));
    results.push(await measure("flag_on chunked layout", { attentionV2: true, layout: "chunked" }));
    console.log("# B8 target p95 < 150 ms; walk budget 90 s");
    for (const r of results) console.log(`# ${r.label}: walk ${(r.walk_ms / 1000).toFixed(1)} s, total_items ${r.size.total_items} (closed ${r.size.closed_items}), ${r.size.layout}, reads p50 ${r.reads.p50} ms p95 ${r.reads.p95} ms over ${r.reads.n}; cold reads ${r.cold_reads_ms.join("/")} ms`);
  } finally {
    if (process.env.S2_KEEP !== "1") await db.dropDatabase();
    await mongoose.disconnect();
  }
}
