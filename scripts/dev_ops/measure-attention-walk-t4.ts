import { spawn } from "node:child_process";
/**
 * Team 4 K18: the Attention publish walk time and its query count, before and after AC3/AC5.
 *
 * Generates the production-shaped volume of `measure-si-attention.ts` (8,031 Outreach records,
 * 798 Contact Numbers, follow-ups, Bookings, Lead progress, assessment projections) in its own
 * replica database, then runs `publishAttentionSnapshot` N times (ATTENTION_V2 on, as in
 * production) and records every walk time plus the Mongoose query count of one publish
 * (the B11 counter: `mongoose.set("debug", …)`), broken down by `collection.method`.
 *
 * The same file runs unchanged against the base worktree (`%TEMP%/t4base`, commit 01bcf18),
 * so the before/after numbers come from one generator and one measurement.
 *
 *   node --import tsx scripts/dev_ops/measure-attention-walk-t4.ts [--runs 5] [--evolution on|off] [--fields] [--db t4awalk]
 *
 * `--evolution on` sets SALES_INTELLIGENCE_ATTENTION_EVOLUTION=true. `--fields` writes the four
 * AC3/AC5 record fields (`last_inbound_human_at`, `last_attributable_outbound_at`,
 * `prior_contact_at`, `last_activity_at`) on every generated record (raw insert, so the base
 * schema never sees them). Replica csi01 on 27189 only; the database is dropped at the end.
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const suffix = (arg("--db") ?? "t4awalk").replace(/[^a-z0-9]/gi, "");
const database = `testvantagemovers_${suffix}`;
if (process.env.T4_WALK_CHILD !== "1") {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", __filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env, T4_WALK_CHILD: "1", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
      SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
      SALES_INTELLIGENCE_ATTENTION_V2: "true", SALES_INTELLIGENCE_ATTENTION_EVOLUTION: arg("--evolution") === "on" ? "true" : "false",
      RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
      VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
    },
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}

const DAY = 86_400_000;
const TOTAL = 8031, CLOSED_90D = 2559, CLOSED_OLDER = 900, NUMBERS = 798, AGENTS = 12;
function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

async function main() {
  const assert = await import("node:assert/strict");
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getOutreachFollowupModel } = await import("../../src/models/OutreachFollowup");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { publishAttentionSnapshot } = await import("../../src/services/salesIntelligence/outreach/attention");
  const { readCaptureCoverage } = await import("../../src/services/numberActivity/coverage");
  const { defaultCsiPolicy } = await import("../../src/services/salesIntelligence/policy");
  const runs = Number(arg("--runs") ?? 5), withFields = process.argv.includes("--fields");

  assert.equal(getMongoDatabaseName(), database);
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const rand = prng(20260923);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const oid = () => new mongoose.Types.ObjectId();
  const now = Date.now();
  const policy = defaultCsiPolicy();
  const agents = Array.from({ length: AGENTS }, (_, i) => ({ _id: oid(), name: `Synthetic Agent ${i + 1}` }));
  await db.collection("agents").insertMany(agents);
  const Numbers = getContactNumberModel(), Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel();
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
  for (let i = 0; i < numbers.length; i += 1000) await Numbers.collection.insertMany(numbers.slice(i, i + 1000));
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
    const row = valid(new Records(record)) as Record<string, unknown>;
    // The random stream is consumed identically with or without `--fields`, so both variants generate the same corpus.
    const inbound = rand() < 0.3 ? new Date(+trigger + rand() * DAY) : null, outbound = rand() < 0.5 ? new Date(+trigger + rand() * 2 * DAY) : null, prior = rand() < 0.05 ? new Date(+trigger - rand() * 6 * DAY) : null;
    if (withFields) {
      const activity = [row.last_meaningful_contact_at as Date | null, outbound].filter((d): d is Date => Boolean(d)).sort((a, b) => +b - +a)[0] ?? null;
      Object.assign(row, { last_inbound_human_at: inbound, last_attributable_outbound_at: outbound, prior_contact_at: prior, last_activity_at: activity });
    }
    records.push(row);
    if (reason === "booked" || reason === "cancelled" || (kind === "closedOld" && rand() < 0.3)) {
      const bookingId = oid();
      bookings.push({ _id: bookingId, lead_model: "FormLead", lead_ref: leadId, agent: pick(agents)._id, book_date: new Date(+trigger + (+closedAt! - +trigger) * (reason === "cancelled" ? 0.6 : 1)), job_no: `V-${i}`, total_binder_amount: 900 + Math.floor(rand() * 4000) });
      if (reason === "cancelled") cancels.push({ _id: oid(), booked_lead: bookingId, cancel_date: closedAt, reason: pick(["Moving later", "Found another mover", null]) });
    }
    const followupCount = !closedAt && (number || rand() < 0.3) ? 1 + Math.floor(rand() * 2) : closedAt && rand() < 0.3 ? 1 : 0;
    for (let k = 0; k < followupCount; k++) {
      const due = new Date(now + (rand() - 0.6) * 4 * DAY);
      const status = closedAt ? "cancelled" : k === 0 ? "open" : "completed";
      followups.push(valid(new Followups({ outreach_record_id: record._id, commitment_key: `ck-${i}-${k}`, kind: "call", description: "Synthetic callback", status, due_at: due,
        attention_due_at: due, base_attention_due_at: due, responsible_agent_id: rand() < 0.7 ? pick(agents)._id : null, promised_by_agent_id: rand() < 0.5 ? pick(agents)._id : null,
        origin: pick(["rep_promise", "system_default", "customer_request"]), date_resolution: { precision: "exact", timezone: policy.timezone, anchor: trigger, policy_version: policy.version } })) as Record<string, unknown>);
    }
  }
  const insert = async (name: string, docs: Record<string, unknown>[]) => { for (let i = 0; i < docs.length; i += 1000) if (docs.slice(i, i + 1000).length) await db.collection(name).insertMany(docs.slice(i, i + 1000)); };
  await insert("form_leads", leads);
  await insert(Records.collection.collectionName, records);
  await insert(Followups.collection.collectionName, followups);
  await insert("booked_leads", bookings);
  await insert("cancelled_leads", cancels);
  console.log("# generated", JSON.stringify({ records: records.length, followups: followups.length, bookings: bookings.length, fields: withFields }));
  try {
    await readCaptureCoverage();
    // Warm-up publish (module init, coverage memo, connection pool).
    await publishAttentionSnapshot({ deadlineMs: 600_000 });
    const walks: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const published = await publishAttentionSnapshot({ deadlineMs: 600_000 }) as { status: string; total_items: number; closed_items?: number };
      walks.push(performance.now() - t0);
      assert.equal(published.status, "published");
    }
    const calls: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { calls.push(`${collection}.${method}`); });
    let counted: { status: string; total_items: number; closed_items?: number };
    try { counted = await publishAttentionSnapshot({ deadlineMs: 600_000 }) as typeof counted; } finally { mongoose.set("debug", false); }
    const byKind: Record<string, number> = {};
    for (const call of calls) byKind[call] = (byKind[call] ?? 0) + 1;
    const result = { evolution: process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION === "true", fields: withFields, runs, walks_ms: walks.map(ms => Math.round(ms)),
      median_ms: Math.round(median(walks)), min_ms: Math.round(Math.min(...walks)), total_items: counted.total_items, closed_items: counted.closed_items ?? 0,
      queries: calls.length, queries_by_kind: Object.fromEntries(Object.entries(byKind).sort()) };
    console.log("# K18", JSON.stringify(result));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
