/** Isolated OI source fixture. No drop, indexes, provider calls or model calls.
 * Supply MONGO_URI through the environment; run --fixture before contract captures, --performance after.
 * The only permitted database is testvantagemovers_oi. Stable IDs constrain every upsert to this fixture.
 * Publication is an explicit separate coordinator step so existing pinned snapshots remain inspectable.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";

const DB = "testvantagemovers_oi";
if (process.env.TEST_MODE !== "true" || process.env.TEST_MONGO_DATABASE_NAME !== DB) throw new Error("Requires TEST_MODE=true and exact isolated database testvantagemovers_oi");
if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be supplied privately");
const mode = process.argv[2];
if (mode !== "--fixture" && mode !== "--performance") throw new Error("Use --fixture or --performance");
const id = (key: string) => new mongoose.Types.ObjectId(createHash("sha256").update(`oi-team-v1:${key}`).digest("hex").slice(0, 24));
const NOW = new Date(), past = new Date(+NOW - 3_600_000), future = new Date(+NOW + 86_400_000);

async function main() {
  const { configureMongoDnsServers } = await import("../../src/db");
  configureMongoDnsServers();
  await mongoose.connect(process.env.MONGO_URI!, { dbName: DB, autoIndex: false });
  const db = mongoose.connection.useDb(DB, { useCache: true });
  if (db.name !== DB) throw new Error("Database fence mismatch");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getOutreachFollowupModel } = await import("../../src/models/OutreachFollowup");
  const { getSalesIntelligenceReviewItemModel } = await import("../../src/models/SalesIntelligenceReviewItem");
  const { getGranotObservationModel } = await import("../../src/models/GranotObservation");
  const { getCallInteractionModel } = await import("../../src/models/CallInteraction");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink");
  const { toFloridaTimestamp } = await import("../../src/utils/easternTime");
  const Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel();
  async function upsert(collection: Pick<mongoose.mongo.Collection, "bulkWrite">, rows: mongoose.mongo.Document[]) {
    for (let i = 0; i < rows.length; i += 500) await collection.bulkWrite(rows.slice(i, i + 500).map(row => ({ replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true } })));
  }
  const names = ["Alex", "Sam", "Taylor", "Riley"];
  const catalog = names.map(name => ({ _id: id(`agent:${name}`), name, normalized_name: name.toLowerCase(), active: name !== "Riley", createdAt: NOW, updatedAt: NOW }));
  if (mode === "--fixture") await upsert(db.collection("agents"), catalog);
  const existingAgents = await db.collection("agents").find({}, { projection: { _id: 1, name: 1 } }).toArray();
  if (mode === "--performance") {
    const extra = Array.from({ length: Math.max(0, 50 - existingAgents.length) }, (_, i) => ({ _id: id(`performance-agent:${i}`), name: `OI Performance ${i + 1}`, active: true, createdAt: NOW, updatedAt: NOW }));
    await upsert(db.collection("agents"), extra);
    existingAgents.push(...extra);
  }
  const labels = mode === "--fixture" ? ["A", "B", "U", "C", "K", "Granot money", "Granot no estimate", "Phone only"] : Array.from({ length: 10_000 }, (_, i) => `performance:${i}`);
  const records: mongoose.mongo.Document[] = [], forms: mongoose.mongo.Document[] = [], calls: mongoose.mongo.Document[] = [], followups: mongoose.mongo.Document[] = [];
  for (const [i, label] of labels.entries()) {
    const leadId = id(`lead:${label}`), recordId = id(`record:${label}`), isCall = label.startsWith("Granot") || label === "Phone only", model = isCall ? "CallLead" : "FormLead";
    const responsible = mode === "--performance" ? existingAgents[i % existingAgents.length]!._id : label === "A" || label === "K" ? catalog[0]!._id : label === "B" ? catalog[1]!._id : label === "C" ? catalog[3]!._id : null;
    const job = `OITEAM${leadId.toString().toUpperCase()}`, ten = `561555${String(1000 + i % 9000)}`;
    const lead = { _id: leadId, name: `OI ${label}`, job_no: job, normalized_job_no: job, timestamp: toFloridaTimestamp(past), createdAt: past, updatedAt: NOW,
      normalized_phone_number: ten, phone_number: ten, source_company: "OI synthetic", granot_priority: mode === "--performance" ? "OP" : isCall ? "OM" : "OI", receiver_agent: responsible,
      receiver_agent_name_snapshot: responsible ? existingAgents.find(a => String(a._id) === String(responsible))?.name : null,
      quoted: false, duplicate: false, no_sync: false, cpl: 0, pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX",
      ...(isCall ? { captured_at: past } : { pickup_zip: "02118", destination_zip: "78701", move_size: "2 Bedroom", move_date: new Date(future.toISOString().slice(0, 10)) }) };
    (isCall ? calls : forms).push(lead);
    const record = new Records({ _id: recordId, subject: { kind: "lead", model, id: leadId }, state: label === "K" ? "closed" : "open",
      trigger_kind: "lead_arrival", trigger_at: past, first_action_due_at: past, first_attributable_outbound_at: past,
      responsible_agent_id: responsible, policy_version: "csi-policy-v1", revision: 1,
      lead_progress: { granot_priority: lead.granot_priority, quoted: false, disposition: "unmapped", work_observed: true, basis: "historical_snapshot", provenance: "accepted",
        projected_at: NOW, fingerprint: `oi-team:${label}`, disposition_revision: "oi-fixture-v1" },
      ...(label === "K" ? { closed_at: past, closed_reason: "owner_closed", closed_by: "oi-fixture", closure_origin: "owner" } : {}) });
    const error = record.validateSync(); if (error) throw error;
    records.push({ ...record.toObject(), createdAt: past, updatedAt: NOW });
    const count = mode === "--performance" ? 1 : label === "A" ? 2 : label === "U" ? 1 : 0;
    for (let j = 0; j < count; j++) {
      const due = label === "U" || (mode === "--performance" && i % 3 !== 0) ? future : past;
      const followup = new Followups({ _id: id(`followup:${label}:${j}`), outreach_record_id: recordId, commitment_key: `oi-team:${label}:${j}`,
        kind: "call", description: `OI fixture follow-up ${label} ${j + 1}`, status: "open", origin: "owner", due_at: due, attention_due_at: due, base_attention_due_at: due,
        responsible_agent_id: mode === "--performance" ? existingAgents[(i + 1) % existingAgents.length]!._id : catalog[1]!._id, revision: 1 });
      const error = followup.validateSync(); if (error) throw error;
      followups.push({ ...followup.toObject(), createdAt: past, updatedAt: NOW });
    }
  }
  await upsert(db.collection("form_leads"), forms); await upsert(db.collection("call_leads"), calls);
  await upsert(Records.collection, records); await upsert(Followups.collection, followups);
  if (mode === "--fixture") {
    const review = new (getSalesIntelligenceReviewItemModel())({ _id: id("review:K"), subject_key: `lead:FormLead:${id("lead:K")}`, cause_kind: "closed_work_request", cause_key: "oi-team:K", state: "open", opened_at: past });
    if (review.validateSync()) throw review.validateSync(); await upsert(getSalesIntelligenceReviewItemModel().collection, [review.toObject()]);
    const observations = calls.map((lead, i) => ({ _id: id(`observation:${i}`), receipt_id: id(`receipt:${i}`), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid",
      normalized_source_label: "oi-synthetic", captured_at: past, identity: { normalized_job_no: i === 2 ? "UNRELATEDJOB" : lead.normalized_job_no }, contact: { normalized_phone: lead.normalized_phone_number },
      move: { move_date: new Date(future.toISOString().slice(0, 10)), granot_move_size_raw: "3 BR", estimated_cubic_feet: 600, origin: { city: "Boston", state: "MA", zip: "02118" }, destination: { city: "Austin", state: "TX", zip: "78701" } },
      display_money: i === 1 ? {} : { estimate: { raw: "$3,500.00" }, payment: { raw: "$500.00" }, balance: { raw: "$3,000.00" } }, priority: { raw: "1", canonical: "1", valid: true },
      booking_action: {}, agent_identity: {}, provider_context: {}, issues: [], quoted: false, createdAt: past, updatedAt: past }));
    await upsert(getGranotObservationModel().collection, observations);
    const account = "oi-team-synthetic", interaction = { _id: id("transferred-call"), provider: "ringcentral", provider_account_id: account, telephony_session_id: "oi-team-transferred", identity_basis: "telephony_session_id",
      started_at: past, ended_at: new Date(+past + 180_000), direction: "Outbound", contact_type: "human_conversation", provider_connected: true, terminal: true, monitoring: false,
      merged_into_id: null, purged_at: null, duration_seconds: 180, transfer: true, recordings: [], legs: [], sources: ["call_log"],
      parties: ["501", "502"].map(extension_id => ({ role: "user", extension_id, connected: true, direction: "Outbound" })), createdAt: past, updatedAt: past };
    await upsert(getCallInteractionModel().collection, [interaction]);
    await upsert(getRepIdentityLinkModel().collection, catalog.slice(0, 2).map((agent, i) => ({ _id: id(`rep-link:${i}`), revision: 1, agent_id: agent._id, agent_name_snapshot: agent.name,
      rc_account_id: account, rc_extension_id: String(501 + i), role_kind: "sales_rep", status: "reviewed", effective_from: new Date(+past - 86_400_000), effective_to: null,
      reviewed_at: new Date(+past - 86_400_000), reviewed_by: "oi-fixture", createdAt: past, updatedAt: past })));
  }
  await upsert(db.collection("oi_team_fixture_manifest"), labels.map(label => ({ _id: id(`manifest:${label}`), label, mode, record_id: id(`record:${label}`), lead_id: id(`lead:${label}`), seeded_at: NOW })));
  const directory = resolve(process.cwd(), "../outreach-intelligence-workspace/contracts/C");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, mode === "--fixture" ? "fixture-manifest.json" : "performance-fixture-manifest.json"), JSON.stringify({
    database: DB, mode, seeded_at: NOW, priority: mode === "--performance" ? "OP" : "OI", move_examples_priority: "OM",
    agents: catalog.map(a => ({ id: String(a._id), name: a.name, active: a.active })),
    records: mode === "--fixture" ? labels.map(label => ({ label, record_id: String(id(`record:${label}`)), lead_id: String(id(`lead:${label}`)),
      subject_key: `lead:${label.startsWith("Granot") || label === "Phone only" ? "CallLead" : "FormLead"}:${id(`lead:${label}`)}`,
      followups: label === "A" ? [0, 1].map(i => String(id(`followup:${label}:${i}`))) : label === "U" ? [String(id(`followup:${label}:0`))] : [] })) : { count: labels.length },
    followup_dates: { overdue: past, future }, transferred_call: { id: String(id("transferred-call")), started_at: past, account: "oi-team-synthetic" },
    missing_day_example: { from: "2020-01-01", through: "2020-01-02", note: "Custom range intentionally predates this synthetic capture; expect null counts" },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ database: DB, mode, rows_written: records.length, followups_written: followups.length, total_agents: await db.collection("agents").countDocuments(),
    total_records: await Records.countDocuments(), priority: mode === "--performance" ? "OP" : "OI", move_examples_priority: "OM", agents: catalog.map(a => ({ id: String(a._id), name: a.name })), publication: "Run the real Attention publisher separately" }));
}
main().catch(error => { console.error(error instanceof Error ? error.name + ": " + error.message : "Fixture failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
