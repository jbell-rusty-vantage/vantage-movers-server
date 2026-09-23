/**
 * S0-SEED B0b: every state the final spec prints exists in the final-UI seed database.
 *
 *   node --import tsx scripts/dev_ops/assert-si-seed-states.ts
 *
 * Counts each state in the SOURCE collections (never the manifest), prints `state | count | ok`
 * and exits non-zero when any state has count 0. Read-only; loopback replica only.
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { SI_SEED_DATABASE, SI_SEED_REPLICA, SI_SEED_STATES, assertSeedDatabase, type SiSeedState } from "./lib/si-contract-common";

const DAY = 86_400_000;
const etDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const BOOKKEEPING_REVIEW_REASONS = ["prior_finding_contradicted", "prior_fulfilled_followup_open"];
const LOCATION_OR_DATE = ["pickup_location", "delivery_location", "move_date"];

type Check = (db: Db, now: Date) => Promise<number>;
const closedWithin = (reason: string, origin: string): Check => (db, now) => db.collection("outreach_records").countDocuments({ state: "closed", closed_reason: reason,
  closure_origin: origin, closed_at: { $gte: new Date(+now - 90 * DAY) } });

async function nextActionStates(db: Db, now: Date) {
  const records = await db.collection("outreach_records").find({ state: { $ne: "closed" }, purged_at: null }, { projection: { next_action: 1 } }).toArray();
  const ids = records.flatMap(r => (r.next_action?.followup_id ? [r.next_action.followup_id as ObjectId] : []));
  const followups = new Map((await db.collection("outreach_followups").find({ _id: { $in: ids } }, { projection: { attention_due_at: 1, status: 1 } }).toArray()).map(f => [String(f._id), f]));
  const out = { due: 0, overdue: 0, no_due_date: 0, none: 0 };
  for (const record of records) {
    const action = record.next_action?.followup_id ? followups.get(String(record.next_action.followup_id)) : null;
    if (!action) out.none++;
    else if (!action.attention_due_at) out.no_due_date++;
    else if (+action.attention_due_at <= +now) out.overdue++;
    else out.due++;
  }
  return out;
}

async function timelineEvents(db: Db) {
  const heavy = await db.collection("call_interactions").aggregate<{ _id: ObjectId; calls: number }>([{ $match: { merged_into_id: null, purged_at: null } },
    { $group: { _id: "$contact_number_id", calls: { $sum: 1 } } }, { $match: { calls: { $gte: 50 } } }]).toArray();
  const out: Array<{ number: string; total: number; kinds: number }> = [];
  for (const { _id, calls } of heavy) {
    const number = await db.collection("contact_numbers").findOne({ _id });
    const edges = await db.collection("number_lead_attachments").find({ contact_number_id: _id, state: { $ne: "rejected" } }).toArray();
    const leadIds = edges.map(e => String(e.lead_ref.id));
    const records = await db.collection("outreach_records").find({ primary_contact_number_id: _id }).project({ _id: 1 }).toArray();
    const [messages, changes, followups, conversations] = await Promise.all([
      db.collection("lead_messages").countDocuments({ to: number?.e164 }),
      db.collection("entity_changes").countDocuments({ "entity.id": { $in: leadIds }, changed_paths: { $in: ["granot_priority", "quoted"] } }),
      db.collection("outreach_followups").countDocuments({ outreach_record_id: { $in: records.map(r => r._id) } }),
      db.collection("lead_conversations").countDocuments({ contact_number_id: _id }),
    ]);
    const parts = [calls, messages, changes, followups, conversations];
    out.push({ number: String(_id), total: parts.reduce((a, b) => a + b, 0), kinds: parts.filter(p => p > 0).length });
  }
  return out;
}

const CHECKS: Record<SiSeedState, Check> = {
  number_only: db => db.collection("outreach_records").countDocuments({ "subject.kind": "number_review", purged_at: null }),
  multi_lead_phone: async db => (await db.collection("number_lead_attachments").aggregate([{ $match: { state: "attached" } },
    { $group: { _id: "$contact_number_id", n: { $sum: 1 } } }, { $match: { n: { $gte: 2 } } }]).toArray()).length,
  closed_booked: async (db, now) => {
    const rows = await db.collection("outreach_records").find({ state: "closed", closed_reason: "booked", closure_origin: "official", closed_at: { $gte: new Date(+now - 90 * DAY) } }).toArray();
    let n = 0;
    for (const r of rows) {
      const booking = await db.collection("booked_leads").findOne({ lead_ref: new ObjectId(String(r.subject.id)), lead_model: r.subject.model });
      const days = booking ? (+booking.book_date - +r.trigger_at) / DAY : NaN;
      if (days >= 7.5 && days <= 8.5) n++;
    }
    return n;
  },
  closed_cancelled: async (db, now) => {
    const rows = await db.collection("outreach_records").find({ state: "closed", closed_reason: "cancelled", closure_origin: "official", closed_at: { $gte: new Date(+now - 90 * DAY) } }).toArray();
    let n = 0;
    for (const r of rows) if (await db.collection("cancelled_leads").countDocuments({ lead_ref: new ObjectId(String(r.subject.id)), reason: { $type: "string", $ne: "" }, cancel_date: { $type: "date" } })) n++;
    return n;
  },
  closed_bad_lead: closedWithin("bad_lead", "official"),
  closed_duplicate: closedWithin("duplicate", "official"),
  closed_no_sync: closedWithin("no_sync", "official"),
  closed_crm_dead: closedWithin("granot_dead_opportunity", "crm_disposition"),
  closed_crm_bad_unusable: closedWithin("granot_bad_unusable", "crm_disposition"),
  closed_owner: (db, now) => db.collection("outreach_records").countDocuments({ state: "closed", closure_origin: "owner", closed_at: { $gte: new Date(+now - 90 * DAY) } }),
  closed_over_90d: (db, now) => db.collection("outreach_records").countDocuments({ state: "closed", closed_at: { $lt: new Date(+now - 90 * DAY) } }),
  followup_due: async (db, now) => (await nextActionStates(db, now)).due,
  followup_overdue: async (db, now) => (await nextActionStates(db, now)).overdue,
  followup_no_due_date: async (db, now) => (await nextActionStates(db, now)).no_due_date,
  followup_none: async (db, now) => (await nextActionStates(db, now)).none,
  move_date_future: (db, now) => db.collection("form_leads").countDocuments({ move_date: { $gte: new Date(`${etDay(now)}T00:00:00Z`) } }),
  move_date_passed: async (db, now) => {
    const leads = await db.collection("form_leads").find({ move_date: { $lt: new Date(`${etDay(now)}T00:00:00Z`) } }).project({ _id: 1 }).toArray();
    return db.collection("outreach_records").countDocuments({ "subject.id": { $in: leads.map(l => l._id) }, "move_assessment.status": "ready" });
  },
  newer_call_after_assessment: async db => {
    const rows = await db.collection("outreach_records").find({ "move_assessment.latest_conversation_at": { $type: "date" }, primary_contact_number_id: { $ne: null } }).toArray();
    let n = 0;
    for (const r of rows) if (await db.collection("call_interactions").countDocuments({ contact_number_id: r.primary_contact_number_id, merged_into_id: null, purged_at: null,
      started_at: { $gt: r.move_assessment.latest_conversation_at } })) n++;
    return n;
  },
  conflict_details_disagree: db => db.collection("move_assessment_artifacts").countDocuments({ shadow: false, status: "ready", "conflicts.affects": { $in: LOCATION_OR_DATE } }),
  conflict_other: db => db.collection("move_assessment_artifacts").countDocuments({ shadow: false, status: "ready", "conflicts.0": { $exists: true }, "conflicts.affects": { $nin: LOCATION_OR_DATE } }),
  assessment_lead_only: db => db.collection("move_assessment_artifacts").countDocuments({ shadow: false, status: "ready", input_mode: "lead_only" }),
  assessment_not_applicable: db => db.collection("outreach_records").countDocuments({ state: { $ne: "closed" }, "move_assessment.artifact_id": { $ne: null },
    "lead_progress.disposition": { $in: ["crm_bad_unusable", "crm_dead"] }, "lead_progress.provenance": "accepted", "lead_progress.override": null }),
  assessment_pending: db => db.collection("sales_intelligence_jobs").countDocuments({ stage: "move_assessment", status: { $in: ["pending", "leased", "retry"] } }),
  work_applied: db => db.collection("intelligence_effects").countDocuments({ status: "applied", effect_kind: { $ne: "supersede" },
    $nor: [{ effect_kind: "open_review", reason: { $in: BOOKKEEPING_REVIEW_REASONS } }] }),
  work_blocked: db => db.collection("intelligence_effects").countDocuments({ status: { $regex: /^blocked_/ } }),
  work_needs_review_effect: db => db.collection("intelligence_effects").countDocuments({ status: "needs_review" }),
  work_needs_review_item: async db => {
    const items = await db.collection("sales_intelligence_review_items").find({ state: "open", cause_kind: { $ne: "record_disputed_on_call" }, "evidence_ids.0": { $exists: true } }).toArray();
    let n = 0;
    for (const item of items) if (await db.collection("intelligence_findings").countDocuments({ _id: { $in: item.evidence_ids } })) n++;
    return n;
  },
  work_not_applicable: async db => {
    const effects = await db.collection("intelligence_effects").find({}).project({ finding_id: 1, status: 1, effect_kind: 1, reason: 1 }).toArray();
    const worked = new Set(effects.filter(e => e.effect_kind !== "supersede" && !(e.effect_kind === "open_review" && BOOKKEEPING_REVIEW_REASONS.includes(e.reason))
      && (e.status === "applied" || e.status === "needs_review" || String(e.status).startsWith("blocked_"))).map(e => String(e.finding_id)));
    const reviewed = new Set((await db.collection("sales_intelligence_review_items").find({ state: "open", cause_kind: { $ne: "record_disputed_on_call" } }).toArray())
      .flatMap(i => (i.evidence_ids ?? []).map(String)));
    const findings = await db.collection("intelligence_findings").find({ review_state: { $ne: "retracted" }, superseded_by: null, conversation_id: { $ne: null } }).project({ _id: 1 }).toArray();
    return findings.filter(f => !worked.has(String(f._id)) && !reviewed.has(String(f._id))).length;
  },
  work_superseded: db => db.collection("intelligence_findings").countDocuments({ superseded_by: { $ne: null } }),
  work_retracted: db => db.collection("intelligence_findings").countDocuments({ review_state: "retracted" }),
  relation_bookkeeping_effects: async db => Math.min(await db.collection("intelligence_effects").countDocuments({ effect_kind: "supersede" }),
    await db.collection("intelligence_effects").countDocuments({ effect_kind: "open_review", reason: "prior_finding_contradicted" })),
  relations_all_kinds: db => db.collection("intelligence_runs").countDocuments({ status: "completed", $and: ["superseded", "fulfilled", "contradicted", "still_true", "cannot_determine"]
    .map(relation => ({ "output.prior_finding_relations.relation": relation })) }),
  story_discrepancies: db => db.collection("intelligence_runs").countDocuments({ status: "completed", "output.story_discrepancies.0": { $exists: true } }),
  engagement_created_and_skipped: db => db.collection("move_assessment_artifacts").countDocuments({ "engagement_effects.followup_ids.0": { $exists: true },
    "engagement_effects.skipped.0": { $exists: true } }),
  legacy_conversation: async db => {
    const rows = await db.collection("lead_conversations").find({ latest_completed_run_id: { $ne: null }, "summary.sections.money_dates": { $type: "string" } }).toArray();
    let n = 0;
    for (const row of rows) {
      const run = await db.collection("intelligence_runs").findOne({ _id: row.latest_completed_run_id, analysis_pipeline: null, prompt_version: { $in: ["sales_intelligence_analyze_v1", "sales_intelligence_analyze_v2"] } });
      const summaries = await db.collection("intelligence_evidence_snapshots").countDocuments({ conversation_id: row._id, source_type: "summary" });
      if (run && summaries === 0) n++;
    }
    return n;
  },
  audio_purged_transcript_kept: async db => {
    const rows = await db.collection("lead_conversations").find({ "media.purged_at": { $type: "date" } }).toArray();
    let n = 0;
    for (const row of rows) if (await db.collection("intelligence_evidence_snapshots").countDocuments({ conversation_id: row._id, source_type: "transcript", purged_at: null })) n++;
    return n;
  },
  media_retained: db => db.collection("lead_conversations").countDocuments({ "media.blob_pathname": { $type: "string" }, "media.purged_at": null }),
  priority_change_paired: async db => {
    const rows = await db.collection("entity_changes").find({ changed_paths: "granot_priority", "provenance.observation_id": { $exists: true } }).toArray();
    const found = await db.collection("granot_observations").countDocuments({ _id: { $in: rows.map(r => r.provenance.observation_id) } });
    return Math.min(rows.length, found);
  },
  priority_change_unpaired: db => db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority", "provenance.observation_id": { $exists: false } }),
  quoted_change: db => db.collection("entity_changes").countDocuments({ changed_paths: "quoted", fields: { $elemMatch: { path: "quoted", $or: [{ after: true }, { before: true }] } } }),
  lead_message: db => db.collection("lead_messages").countDocuments({}),
  booking: db => db.collection("booked_leads").countDocuments({}),
  cancellation: db => db.collection("cancelled_leads").countDocuments({ reason: { $type: "string" } }),
  transcript_segments: db => db.collection("intelligence_evidence_snapshots").countDocuments({ source_type: "transcript", "segments.1": { $exists: true }, "segments.start_ms": { $type: "number" } }),
  summary_snapshot_move_evidence: db => db.collection("intelligence_evidence_snapshots").countDocuments({ source_type: "summary",
    "response.analysis_summary.said_on_call.0": { $exists: true }, "response.analysis_summary.move_evidence.observations.0": { $exists: true },
    "response.analysis_summary.move_evidence.inventory.0": { $exists: true }, "response.analysis_summary.move_evidence.intent_signals.0": { $exists: true } }),
  number_run: db => db.collection("intelligence_runs").countDocuments({ status: "completed", conversation_id: null, output: { $ne: null } }),
  conversation_run: db => db.collection("intelligence_runs").countDocuments({ status: "completed", conversation_id: { $ne: null }, output: { $ne: null } }),
  suggestion_applied: db => db.collection("sales_intelligence_audit_events").countDocuments({ event_kind: "analysis.suggestion_applied" }),
  calls_50: async db => (await db.collection("call_interactions").aggregate([{ $match: { merged_into_id: null, purged_at: null } },
    { $group: { _id: "$contact_number_id", n: { $sum: 1 } } }, { $match: { n: { $gte: 50 } } }]).toArray()).length,
  timeline_300: async db => (await timelineEvents(db)).filter(row => row.total >= 300 && row.kinds >= 4).length,
};

async function main() {
  assertSeedDatabase(SI_SEED_DATABASE);
  const client = new MongoClient(SI_SEED_REPLICA, { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(SI_SEED_DATABASE);
    const now = new Date();
    const rows: Array<{ state: string; count: number; ok: boolean }> = [];
    for (const state of SI_SEED_STATES) {
      const count = await CHECKS[state](db, now);
      rows.push({ state, count, ok: count >= 1 });
    }
    const width = Math.max(...rows.map(r => r.state.length));
    console.log(`${"state".padEnd(width)} | count | ok`);
    console.log(`${"-".repeat(width)}-|-------|----`);
    for (const r of rows) console.log(`${r.state.padEnd(width)} | ${String(r.count).padStart(5)} | ${r.ok ? "ok" : "MISSING"}`);
    const timeline = await timelineEvents(db);
    console.log(`\ntimeline candidates (numbers with >= 50 calls): ${timeline.map(t => `${t.number}=${t.total} events/${t.kinds} kinds`).join(", ")}`);
    const missing = rows.filter(r => !r.ok);
    console.log(`\n${rows.length - missing.length}/${rows.length} states present${missing.length ? `; missing: ${missing.map(r => r.state).join(", ")}` : ""}`);
    if (missing.length) process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
