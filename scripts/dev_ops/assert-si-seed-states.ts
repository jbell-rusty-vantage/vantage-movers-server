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
import { defaultCsiPolicy } from "../../src/services/salesIntelligence/policy";
import { staffedMinutesBetween } from "../../src/services/salesIntelligence/outreach/staffing";
import { derive } from "../../src/services/salesIntelligence/outreach/derive";

const DAY = 86_400_000;
const etDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const BOOKKEEPING_REVIEW_REASONS = ["prior_finding_contradicted", "prior_fulfilled_followup_open"];
const LOCATION_OR_DATE = ["pickup_location", "delivery_location", "move_date"];
// AC0-SEED: the seed never calls `updateCsiPolicy`, so the live policy is always the default (pure, no DB read needed here).
const POLICY = defaultCsiPolicy();
// SEED-T3: the live-call window (`LIVE_CALL_WINDOW_MS`, 4 h) and the owned all-direction subscription filter (`ownerCoverage.ts`).
const T3_LIVE_WINDOW_MS = 4 * 3_600_000;
const T3_ALL_DIRECTIONS = "/restapi/v1.0/account/~/telephony/sessions";

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

const RELATION_KINDS = ["superseded", "fulfilled", "contradicted", "still_true", "cannot_determine"];
type RunDoc = { _id: ObjectId; contact_number_id: ObjectId; conversation_id: ObjectId | null; outreach_record_id: ObjectId | null; output: Record<string, any> };
/**
 * Per Number, its newest completed, unpurged run with an output: `createdAt` desc then `_id` desc, the rule of
 * `outreach/reads.ts` `newestCompletedRun` behind `GET /outreach/:id` `newest_run_id` (data spec §4.1 / V21).
 */
async function newestRuns(db: Db): Promise<RunDoc[]> {
  return db.collection("intelligence_runs").aggregate<{ run: RunDoc }>([
    { $match: { status: "completed", output: { $ne: null }, purged_at: null, purge_started_at: null } },
    { $sort: { contact_number_id: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: "$contact_number_id", run: { $first: "$$ROOT" } } },
  ]).toArray().then(rows => rows.map(r => r.run));
}
/** The Outreach record a run's analysis page belongs to: the run's own binding, else the open record on its Number. */
async function recordOfRun(db: Db, run: RunDoc) {
  return run.outreach_record_id ? db.collection("outreach_records").findOne({ _id: run.outreach_record_id, purged_at: null })
    : db.collection("outreach_records").findOne({ primary_contact_number_id: run.contact_number_id, state: { $ne: "closed" }, purged_at: null });
}
/** Mongo clauses for calls whose first user party resolves to a reviewed sales-rep link at the call time (`repIdentity/resolve.ts`). */
async function reviewedRepClauses(db: Db) {
  const links = await db.collection("rep_identity_links").find({ status: "reviewed", role_kind: "sales_rep" }).toArray();
  return links.map(link => ({ provider_account_id: link.rc_account_id,
    parties: { $elemMatch: { role: "user", extension_id: link.rc_extension_id } },
    started_at: { $gte: link.effective_from, ...(link.effective_to ? { $lt: link.effective_to } : {}) } }));
}

// ── AC0-SEED helpers: the follow-ups below are found by their seed commitment-key prefix, never
// the manifest (per the file header). Each prefix is unique to one AC0-SEED subject. ──────────
async function followupByCommitmentPrefix(db: Db, prefix: string) {
  return db.collection("outreach_followups").findOne({ commitment_key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } });
}
/** Is there an Outbound call on the followup's Number within `tolerance` staffed minutes of `target` before `due_at`? */
async function attemptOffsetMatches(db: Db, prefix: string, target: number, tolerance: number) {
  const followup = await followupByCommitmentPrefix(db, prefix);
  if (!followup?.due_at) return 0;
  const record = await db.collection("outreach_records").findOne({ _id: followup.outreach_record_id });
  if (!record?.primary_contact_number_id) return 0;
  const calls = await db.collection("call_interactions").find({ contact_number_id: record.primary_contact_number_id, direction: "Outbound", merged_into_id: null }).toArray();
  for (const call of calls) if (Math.abs(staffedMinutesBetween(call.started_at, followup.due_at, POLICY) - target) <= tolerance) return 1;
  return 0;
}
/** Numbers whose only calls are a single Inbound human conversation: {numberId, staffed minutes ago}. */
async function inboundOnlyRecords(db: Db, now: Date): Promise<Array<{ numberId: ObjectId; minutesAgo: number }>> {
  const groups = await db.collection("call_interactions").aggregate<{ _id: ObjectId; directions: string[]; calls: Array<{ direction: string; contact_type: string; started_at: Date }> }>([
    { $match: { merged_into_id: null } },
    { $group: { _id: "$contact_number_id", directions: { $addToSet: "$direction" }, calls: { $push: { direction: "$direction", contact_type: "$contact_type", started_at: "$started_at" } } } },
  ]).toArray();
  const out: Array<{ numberId: ObjectId; minutesAgo: number }> = [];
  for (const row of groups) {
    if (row.directions.length !== 1 || row.directions[0] !== "Inbound") continue;
    const human = row.calls.filter(c => c.contact_type === "human_conversation");
    if (human.length !== 1) continue;
    out.push({ numberId: row._id, minutesAgo: staffedMinutesBetween(human[0]!.started_at, now, POLICY) });
  }
  return out;
}
/**
 * AC0-SEED phase 2: derive-consistent boundary check for `no_callback_after_inbound`. Bucketed with a
 * small epsilon (see the state list below), then re-verified against the real `derive()` using the
 * SAME `now` the bucketing used, so seed-to-assert clock drift can never make this flaky: whichever
 * side of 240 the elapsed staffed minutes actually land on, the reason's presence must agree with it.
 */
async function inboundOnlyDeriveCheck(db: Db, now: Date, min: number, max: number) {
  const rows = (await inboundOnlyRecords(db, now)).filter(r => r.minutesAgo >= min && r.minutesAgo < max);
  let n = 0;
  for (const r of rows) {
    const record = await db.collection("outreach_records").findOne({ primary_contact_number_id: r.numberId });
    if (!record || record.state !== "open") continue;
    const derived = await deriveForRecord(db, record._id, now);
    const expectFires = r.minutesAgo >= 240;
    if (Boolean(derived?.reasons.includes("no_callback_after_inbound")) === expectFires) n++;
  }
  return n;
}
/** FormLeads within [minSec, maxSec] old whose attached Number has zero call_interactions. */
async function unworkedFormLeadAge(db: Db, minSec: number, maxSec: number) {
  const leads = await db.collection("form_leads").find({}, { projection: { _id: 1, timestamp: 1 } }).toArray();
  const now = Date.now();
  let n = 0;
  for (const lead of leads) {
    const ageSec = (now - +lead.timestamp) / 1000;
    if (ageSec < minSec || ageSec > maxSec) continue;
    const attachment = await db.collection("number_lead_attachments").findOne({ "lead_ref.id": lead._id, state: "attached" });
    if (!attachment) continue;
    if (await db.collection("call_interactions").countDocuments({ contact_number_id: attachment.contact_number_id, merged_into_id: null }) === 0) n++;
  }
  return n;
}
/** `derive()` reasons for the Outreach record of the (uniquely named) FormLead matching `query`. */
async function derivedReasonsForFormLead(db: Db, now: Date, query: Record<string, unknown>) {
  const lead = await db.collection("form_leads").findOne(query, { projection: { _id: 1 } });
  if (!lead) return null;
  const record = await db.collection("outreach_records").findOne({ "subject.model": "FormLead", "subject.id": lead._id });
  if (!record) return null;
  return deriveForRecord(db, record._id, now);
}
/** FormLeads with an Outbound call on the attached phone [minDays, maxDays] before the form's `timestamp`. */
async function calledBeforeFormDays(db: Db, minDays: number, maxDays: number) {
  const leads = await db.collection("form_leads").find({}, { projection: { _id: 1, timestamp: 1 } }).toArray();
  let n = 0;
  for (const lead of leads) {
    const attachment = await db.collection("number_lead_attachments").findOne({ "lead_ref.id": lead._id, state: "attached" });
    if (!attachment) continue;
    const calls = await db.collection("call_interactions").find({ contact_number_id: attachment.contact_number_id, direction: "Outbound", started_at: { $lt: lead.timestamp } }).toArray();
    if (calls.some(call => { const days = (+lead.timestamp - +call.started_at) / DAY; return days >= minDays && days <= maxDays; })) n++;
  }
  return n;
}
/** The Outreach record of the (first) FormLead with an Outbound call [minDays, maxDays] before its `timestamp`. */
async function calledBeforeFormRecord(db: Db, minDays: number, maxDays: number) {
  const leads = await db.collection("form_leads").find({}, { projection: { _id: 1, timestamp: 1 } }).toArray();
  for (const lead of leads) {
    const attachment = await db.collection("number_lead_attachments").findOne({ "lead_ref.id": lead._id, state: "attached" });
    if (!attachment) continue;
    const calls = await db.collection("call_interactions").find({ contact_number_id: attachment.contact_number_id, direction: "Outbound", started_at: { $lt: lead.timestamp } }).toArray();
    if (calls.some(call => { const days = (+lead.timestamp - +call.started_at) / DAY; return days >= minDays && days <= maxDays; }))
      return db.collection("outreach_records").findOne({ "subject.model": "FormLead", "subject.id": lead._id });
  }
  return null;
}
/** Outbound, non-human-conversation attempts grouped by Number, with the distinct `user`-party extensions seen. */
async function outboundAttemptExtensionGroups(db: Db) {
  return db.collection("call_interactions").aggregate<{ _id: ObjectId; exts: string[]; n: number }>([
    { $match: { direction: "Outbound", merged_into_id: null, contact_type: { $ne: "human_conversation" } } },
    { $unwind: "$parties" }, { $match: { "parties.role": "user" } },
    { $group: { _id: "$contact_number_id", exts: { $addToSet: "$parties.extension_id" }, n: { $sum: 1 } } },
  ]).toArray();
}
/** AC0-SEED going-cold candidates (§7.3): open records, `trigger_at` 30+ days old, never a human conversation, with a recent (10-day) outbound attempt. Shared by `ac_going_cold_unreached` (phase 1, raw facts) and `ac_unreached_reason` (phase 2, the derived reason). */
async function goingColdCandidates(db: Db, now: Date) {
  const records = await db.collection("outreach_records").find({ state: { $ne: "closed" }, primary_contact_number_id: { $ne: null }, trigger_at: { $lt: new Date(+now - 30 * DAY) } }).toArray();
  const out: typeof records = [];
  for (const r of records) {
    if (await db.collection("call_interactions").countDocuments({ contact_number_id: r.primary_contact_number_id, contact_type: "human_conversation" })) continue;
    if (await db.collection("call_interactions").countDocuments({ contact_number_id: r.primary_contact_number_id, direction: "Outbound", started_at: { $gte: new Date(+now - 10 * DAY) } })) out.push(r);
  }
  return out;
}
/** Pure `derive()` over the SOURCE collections for one record: never the manifest, never a cached snapshot. */
async function deriveForRecord(db: Db, recordId: ObjectId, now: Date) {
  const record = await db.collection("outreach_records").findOne({ _id: recordId });
  if (!record) return null;
  const followups = await db.collection("outreach_followups").find({ outreach_record_id: recordId }).toArray();
  return derive(record as never, { now, policy: POLICY, staffing: POLICY, followups: followups as never, restrictions: [], reviewItems: [], coverage: {}, evolution: true });
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
  // ── SEED-FIX ──
  newest_run_relations: async db => (await newestRuns(db)).filter(run => {
    const kinds = new Set(((run.output.prior_finding_relations ?? []) as Array<{ relation: string }>).map(r => r.relation));
    return RELATION_KINDS.every(kind => kinds.has(kind));
  }).length,
  newest_run_story_discrepancies: async db => (await newestRuns(db)).filter(run => (run.output.story_discrepancies ?? []).length > 0).length,
  newest_number_run_no_relations: async db => (await newestRuns(db)).filter(run => run.conversation_id == null
    && !(run.output.prior_finding_relations ?? []).length && !(run.output.story_discrepancies ?? []).length).length,
  owner_instruction_assessments: async db => {
    const runs = await db.collection("intelligence_runs").find({ status: "completed", "output.owner_instruction_assessments.0": { $exists: true } }).toArray();
    let n = 0;
    for (const run of runs) {
      const items = run.output.owner_instruction_assessments as Array<{ instruction_id: string; instruction_revision: number; assessment: string }>;
      const matched: string[] = [];
      for (const item of items) if (ObjectId.isValid(item.instruction_id) && await db.collection("sales_intelligence_owner_instructions")
        .countDocuments({ instruction_id: new ObjectId(item.instruction_id), revision: item.instruction_revision })) matched.push(item.assessment);
      const stored = await db.collection("intelligence_owner_assessments").countDocuments({ run_id: run._id });
      if (["agrees", "disagrees", "cannot_determine"].every(kind => matched.includes(kind)) && stored === items.length) n++;
    }
    return n;
  },
  rep_identity_reviewed: async db => {
    const clauses = await reviewedRepClauses(db);
    return clauses.length ? db.collection("call_interactions").countDocuments({ merged_into_id: null, $or: clauses }) : 0;
  },
  rep_identity_unreviewed: async db => {
    const clauses = await reviewedRepClauses(db);
    return db.collection("call_interactions").countDocuments({ merged_into_id: null, parties: { $elemMatch: { role: "user", extension_id: { $type: "string" } } },
      ...(clauses.length ? { $nor: clauses } : {}) });
  },
  suggestion_unapplied_no_followup: async db => {
    let n = 0;
    for (const run of await newestRuns(db)) {
      if (!run.output.next_step_suggestion) continue;
      const record = await recordOfRun(db, run);
      if (!record || record.state === "closed") continue;
      const open = await db.collection("outreach_followups").countDocuments({ outreach_record_id: record._id, status: "open" });
      const applied = await db.collection("sales_intelligence_audit_events").countDocuments({ event_kind: "analysis.suggestion_applied", "invalidation.target_id": String(run._id) });
      if (!open && !applied) n++;
    }
    return n;
  },
  suggestion_applied_followup: async db => {
    const newest = new Set((await newestRuns(db)).map(run => String(run._id)));
    const audits = await db.collection("sales_intelligence_audit_events").find({ event_kind: "analysis.suggestion_applied" }).toArray();
    let n = 0;
    // `apply_suggestion` creates the follow-up in the same command: commitment key `owner:{command_id}:action` (assessment/reads.ts).
    for (const audit of audits) if (newest.has(String(audit.invalidation?.target_id)) && audit.command_id
      && await db.collection("outreach_followups").countDocuments({ commitment_key: `owner:${String(audit.command_id)}:action` })) n++;
    return n;
  },
  // ── AC0-SEED (2026-09-23): Attention evolution / Case File source-data states. Every check reads
  // only the source collections the corresponding seed subject wrote (TEAM-4-INSTRUCTION §4). ──────
  // Phase 2: also verify the real `derive()` puts this exact-precision callback in band 1 with the
  // right `promised_by:*` (F8 §5.1). The raw-fact count from phase 1 still gates `ok`.
  ac_callback_customer_exact: async (db, now) => {
    const raw = await db.collection("outreach_followups").countDocuments({ origin: "customer_request", kind: "call", status: "open", "date_resolution.precision": "exact", due_at: { $lt: now } });
    const followup = await followupByCommitmentPrefix(db, "ac:customer-exact:");
    if (!followup) return 0;
    const derived = await deriveForRecord(db, followup.outreach_record_id, now);
    return raw && derived?.attention_band === 1 && derived.reasons.includes("promised_by:customer") ? raw : 0;
  },
  ac_callback_owner_exact: async (db, now) => {
    const raw = await db.collection("outreach_followups").countDocuments({ origin: "owner", kind: "call", status: "open", "date_resolution.precision": "exact" });
    const candidates = await db.collection("outreach_followups").find({ origin: "owner", kind: "call", status: "open", "date_resolution.precision": "exact", due_at: { $lt: now } }).toArray();
    for (const c of candidates) {
      const derived = await deriveForRecord(db, c.outreach_record_id, now);
      if (derived?.attention_band === 1 && derived.reasons.includes("promised_by:owner")) return raw;
    }
    return 0;
  },
  // Phase 2: the day-precision rep promise is now overdue (§5.5 K13: day precision never reaches band 1;
  // once overdue it is band 4 `followups_due`).
  ac_callback_rep_day: async (db, now) => {
    const raw = await db.collection("outreach_followups").countDocuments({ origin: "rep_promise", kind: "call", status: "open", "date_resolution.precision": "day" });
    const followup = await followupByCommitmentPrefix(db, "ac:rep-day:");
    if (!followup) return 0;
    const derived = await deriveForRecord(db, followup.outreach_record_id, now);
    return raw && derived?.attention_band === 4 && derived.reasons.includes("followups_due") && derived.attention_band !== 1 ? raw : 0;
  },
  ac_callback_send_estimate_day: db => db.collection("outreach_followups").countDocuments({ origin: "rep_promise", kind: "send_estimate", status: "open", "date_resolution.precision": "day" }),
  ac_attempt_50_early: db => attemptOffsetMatches(db, "ac:attempt-50:", 50, 5),
  ac_attempt_70_early: db => attemptOffsetMatches(db, "ac:attempt-70:", 70, 5),
  ac_inbound_after_promise: async db => {
    const followup = await followupByCommitmentPrefix(db, "ac:inbound-after-promise:");
    if (!followup) return 0;
    const record = await db.collection("outreach_records").findOne({ _id: followup.outreach_record_id });
    if (!record?.primary_contact_number_id) return 0;
    return db.collection("call_interactions").countDocuments({ contact_number_id: record.primary_contact_number_id, direction: "Inbound", contact_type: "human_conversation",
      started_at: { $gt: record.trigger_at } });
  },
  ac_promise_chain_source: async db => {
    const followup = await followupByCommitmentPrefix(db, "ac:promise-chain:");
    if (!followup?.due_at) return 0;
    const record = await db.collection("outreach_records").findOne({ _id: followup.outreach_record_id });
    if (!record?.primary_contact_number_id) return 0;
    const calls = await db.collection("call_interactions").find({ contact_number_id: record.primary_contact_number_id, direction: "Outbound", provider_result: "No Answer",
      started_at: { $gte: followup.due_at } }).sort({ started_at: 1 }).toArray();
    if (calls.length < 3) return 0;
    const gaps = [staffedMinutesBetween(calls[0]!.started_at, calls[1]!.started_at, POLICY), staffedMinutesBetween(calls[1]!.started_at, calls[2]!.started_at, POLICY)];
    return gaps.every(g => g >= 90 && g <= 150) ? 1 : 0;
  },
  // Phase 2: the completion loop actually ran (`ensureInteraction` on each attempt). Found by the
  // root's own commitment key, then the code's own `retry:<root>:<attempt>` key (`promiseRetryKey`).
  ac_retry_successor_1: async db => {
    const root = await followupByCommitmentPrefix(db, "ac:promise-chain:");
    if (!root) return 0;
    return db.collection("outreach_followups").countDocuments({ "promise_chain.root_id": root._id, "promise_chain.attempt": 1, commitment_key: `retry:${root._id}:1` });
  },
  ac_retry_successor_2: async db => {
    const root = await followupByCommitmentPrefix(db, "ac:promise-chain:");
    if (!root) return 0;
    return db.collection("outreach_followups").countDocuments({ "promise_chain.root_id": root._id, "promise_chain.attempt": 2, commitment_key: `retry:${root._id}:2` });
  },
  ac_promise_chain_unreached: async (db, now) => {
    const root = await followupByCommitmentPrefix(db, "ac:promise-chain:");
    if (!root) return 0;
    const derived = await deriveForRecord(db, root.outreach_record_id, now);
    return derived?.reasons.includes("promise_unreached") ? 1 : 0;
  },
  // Phase 2: rule 2 (§6) — the inbound human conversation after the promise completed it as `customer_called`.
  ac_completion_customer_called: async db => {
    const followup = await followupByCommitmentPrefix(db, "ac:inbound-after-promise:");
    return followup?.status === "completed" && followup.disposition === "customer_called" ? 1 : 0;
  },
  // Phase 2: rule 1 (§6) — 50 min early is inside the 60-staffed-minute window (completes); 70 is outside (stays open).
  ac_completion_early_window: async db => {
    const followup = await followupByCommitmentPrefix(db, "ac:attempt-50:");
    return followup?.status === "completed" ? 1 : 0;
  },
  ac_completion_not_early_window: async db => {
    const followup = await followupByCommitmentPrefix(db, "ac:attempt-70:");
    return followup?.status === "open" ? 1 : 0;
  },
  ac_formlead_40s: db => unworkedFormLeadAge(db, 0, 300),
  // Wide bucket: the seed now builds this Lead by staffed minutes (45), not calendar hours, so its real
  // age can be anywhere from ~45 minutes to ~2 days depending on when in the week the seed ran (the
  // longest staffed gap is Sat 20:00 -> Mon 08:00). Still clearly not the ~40-second-old sibling.
  ac_formlead_3h: db => unworkedFormLeadAge(db, 600, 48 * 3600),
  // Phase 2: derive() reasons for the specific (uniquely named) record, F10 §5.2.
  ac_new_not_yet_due_vs_no_call_yet: async (db, now) => {
    const fresh = await derivedReasonsForFormLead(db, now, { name: "AC Fresh FormLead 40s" });
    const stale = await derivedReasonsForFormLead(db, now, { name: "AC Fresh FormLead 3h" });
    const freshOk = Boolean(fresh?.reasons.includes("new_not_yet_due")) && !fresh?.reasons.includes("no_call_yet");
    const staleOk = Boolean(stale?.reasons.includes("no_call_yet")) && !stale?.reasons.includes("new_not_yet_due");
    return freshOk && staleOk ? 1 : 0;
  },
  // Bucketed with a small epsilon around the 240-minute boundary, then re-verified against the real
  // `derive()` output at the SAME `now` (`inboundOnlyDeriveCheck`), so seed-to-assert clock drift
  // between the two script invocations can never make this boundary state flaky.
  ac_inbound_only_239: (db, now) => inboundOnlyDeriveCheck(db, now, 225, 239.95),
  ac_inbound_only_240: (db, now) => inboundOnlyDeriveCheck(db, now, 239.95, 255),
  // Phase 2: `prior_contact_at` (§5.4) is now a real record field, computed by `ensureLead`'s
  // `computeContactFacts` at creation time. 6 days back sets it; 8 days (outside the 7-day lookback) doesn't.
  ac_called_before_form_6d: async db => {
    const raw = await calledBeforeFormDays(db, 5.5, 6.5);
    const record = await calledBeforeFormRecord(db, 5.5, 6.5);
    return raw && record?.prior_contact_at ? raw : 0;
  },
  ac_called_before_form_8d: async db => {
    const raw = await calledBeforeFormDays(db, 7.5, 8.5);
    const record = await calledBeforeFormRecord(db, 7.5, 8.5);
    return raw && (!record || !record.prior_contact_at) ? raw : 0;
  },
  ac_progress_0_to_1: db => db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority",
    fields: { $elemMatch: { path: "granot_priority", before: "0", after: "1" } }, "provenance.observation_id": { $exists: true } }),
  ac_progress_1_3_1: async db => {
    const upTo3 = await db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority", fields: { $elemMatch: { path: "granot_priority", before: "1", after: "3" } },
      "provenance.observation_id": { $exists: true } });
    const backTo1 = await db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority", fields: { $elemMatch: { path: "granot_priority", before: "3", after: "1" } },
      "provenance.observation_id": { $exists: true } });
    return Math.min(upTo3, backTo1);
  },
  // Phase 2: P4 (§7.1) actually created one `system_default` "Follow up on the quote" for the accepted
  // 0->1 / 1->3->1 transitions — and, strengthening the phase-1 checks, created NOTHING for the
  // uncertain-1 and accepted-rep_discretion-3 records (K25: "creates nothing").
  // CF-AC: an Owner follow-up superseded the P4 default (§7.1): status superseded, cancel_reason superseded_by_specific_plan.
  ac_default_superseded: db => db.collection("outreach_followups").countDocuments({ default_kind: "quote_followup", status: "superseded", cancel_reason: "superseded_by_specific_plan" }),
  ac_progress_default_created: db => db.collection("outreach_followups").countDocuments({ default_kind: "quote_followup", status: "open" }),
  ac_progress_uncertain_1: async db => {
    const records = await db.collection("outreach_records").find({ "lead_progress.granot_priority": "1", "lead_progress.provenance": "uncertain" }).toArray();
    let n = 0;
    for (const r of records) if (!(await db.collection("outreach_followups").countDocuments({ outreach_record_id: r._id, default_kind: "quote_followup" }))) n++;
    return n;
  },
  ac_progress_accepted_3: async db => {
    const records = await db.collection("outreach_records").find({ "lead_progress.disposition": "rep_discretion", "lead_progress.provenance": "accepted", "lead_progress.work_observed": true }).toArray();
    let n = 0;
    for (const r of records) if (!(await db.collection("outreach_followups").countDocuments({ outreach_record_id: r._id, default_kind: "quote_followup" }))) n++;
    return n;
  },
  ac_attempts_same_rep: async db => (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length === 1 && g.n >= 2).length,
  ac_attempts_two_reps: async db => (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length >= 2).length,
  // Phase 2: `ensureInteraction` actually ran (`firstAttemptsAgent`, §7.2). The same-rep record gets
  // `assignment.origin: "first_attempts"`; the two-reps record gets no automatic assignment at all.
  ac_first_attempts_assigned: async db => {
    const groups = (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length === 1 && g.n >= 2);
    let n = 0;
    for (const g of groups) { const record = await db.collection("outreach_records").findOne({ primary_contact_number_id: g._id }); if (record?.assignment?.origin === "first_attempts") n++; }
    return n;
  },
  ac_first_attempts_none: async db => {
    const groups = (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length >= 2);
    let n = 0;
    for (const g of groups) { const record = await db.collection("outreach_records").findOne({ primary_contact_number_id: g._id }); if (record && record.assignment?.origin !== "first_attempts") n++; }
    return n;
  },
  ac_going_cold_unreached: (db, now) => goingColdCandidates(db, now).then(rows => rows.length),
  // Phase 2: the `unreached` secondary reason (§7.3) on the same going-cold record, via the real `derive()`.
  ac_unreached_reason: async (db, now) => {
    const rows = await goingColdCandidates(db, now);
    let n = 0;
    for (const r of rows) { const derived = await deriveForRecord(db, r._id, now); if (derived?.reasons.includes("unreached")) n++; }
    return n;
  },
  ac_number_25_summaries: async db => (await db.collection("lead_conversations").aggregate([
    { $lookup: { from: "intelligence_evidence_snapshots", localField: "_id", foreignField: "conversation_id", as: "snaps" } },
    { $match: { snaps: { $elemMatch: { source_type: "summary" } } } },
    { $group: { _id: "$contact_number_id", n: { $sum: 1 } } },
    { $match: { n: { $gte: 25 } } },
  ]).toArray()).length,
  ac_granot_estimate_drop: async db => {
    const rows = await db.collection("granot_observations").find({ normalization_result: { $in: ["valid", "valid_with_issues"] }, "identity.normalized_job_no": { $type: "string" } })
      .sort({ captured_at: 1 }).toArray();
    const byJob = new Map<string, typeof rows>();
    for (const row of rows) { const key = row.identity.normalized_job_no as string; (byJob.get(key) ?? byJob.set(key, []).get(key)!).push(row); }
    let n = 0;
    for (const obs of byJob.values()) {
      const has7100 = obs.some(o => o.display_money?.estimate?.raw === "7100.00");
      const has6600 = obs.some(o => o.display_money?.estimate?.raw === "6600.00");
      const newest = obs.at(-1);
      if (has7100 && has6600 && newest && !newest.display_money?.estimate) n++;
    }
    return n;
  },
  ac_granot_invalid: db => db.collection("granot_observations").countDocuments({ normalization_result: "invalid" }),
  ac_granot_phone_mismatch: async db => {
    const leads = await db.collection("form_leads").find({ normalized_job_no: { $type: "string", $ne: "" } }, { projection: { normalized_job_no: 1, normalized_phone_number: 1 } }).toArray();
    let n = 0;
    for (const lead of leads) {
      if (!lead.normalized_phone_number) continue;
      if (await db.collection("granot_observations").countDocuments({ "contact.normalized_phone": lead.normalized_phone_number, "identity.normalized_job_no": { $ne: lead.normalized_job_no } })) n++;
    }
    return n;
  },
  ac_extension_directory_name: async db => {
    const snapshots = await db.collection("ringcentral_directory_snapshots").find({ "extensions.name": { $type: "string" } }).toArray();
    let n = 0;
    for (const snap of snapshots) for (const ext of snap.extensions ?? []) {
      if (!ext.name) continue;
      if (await db.collection("rep_identity_links").countDocuments({ rc_account_id: snap.provider_account_id, rc_extension_id: ext.id, status: "reviewed" })) continue;
      if (await db.collection("call_interactions").countDocuments({ provider_account_id: snap.provider_account_id, parties: { $elemMatch: { role: "user", extension_id: ext.id } } })) n++;
    }
    return n;
  },
  ac_extension_unknown: async db => {
    const groups = await db.collection("call_interactions").aggregate<{ _id: { account: string; ext: string } }>([
      { $match: { merged_into_id: null, parties: { $elemMatch: { role: "user", extension_id: { $type: "string" } } } } },
      { $unwind: "$parties" }, { $match: { "parties.role": "user" } },
      { $group: { _id: { account: "$provider_account_id", ext: "$parties.extension_id" } } },
    ]).toArray();
    let n = 0;
    for (const { _id } of groups) {
      if (await db.collection("rep_identity_links").countDocuments({ rc_account_id: _id.account, rc_extension_id: _id.ext })) continue;
      if (await db.collection("ringcentral_directory_snapshots").countDocuments({ provider_account_id: _id.account, "extensions.id": _id.ext })) continue;
      n++;
    }
    return n;
  },
  ac_call_lead_ringcentral_route: db => db.collection("call_leads").countDocuments({ "ringcentral.route_id": { $type: "objectId" }, "ringcentral.target_name": { $type: "string", $ne: "" } }),
  // ── SEED-T3 (2026-09-24): the S5c capture states (reconciliation addendum §4.1), counted in the source collections. ──
  // An open record whose primary Number has a webhook-only call telephony still reports (the `live_call` rule, S5c-LIVE)
  // while the Owner's `call_progress` is `in_progress`: both fields on one record.
  t3_call_in_progress: async (db, now) => {
    const calls = await db.collection("call_interactions").find({ terminal: false, call_log_state: null, sources: ["webhook"], merged_into_id: null,
      monitoring: { $ne: true }, direction: { $ne: "Internal" }, started_at: { $gte: new Date(+now - T3_LIVE_WINDOW_MS), $lte: now } }).toArray();
    let n = 0;
    for (const call of calls) if (await db.collection("outreach_records").countDocuments({ primary_contact_number_id: call.contact_number_id, state: { $ne: "closed" },
      "call_progress.state": "in_progress" })) n++;
    return n;
  },
  // `capture_health.pending_finalization`: terminal:false, unmerged, started more than 10 min and at most 4 h ago.
  t3_call_pending_finalization: (db, now) => db.collection("call_interactions").countDocuments({ terminal: false, merged_into_id: null,
    started_at: { $gte: new Date(+now - T3_LIVE_WINDOW_MS), $lt: new Date(+now - 10 * 60_000) } }),
  // Final from the Call Log alone (the reconcile stored it settled; the webhook never saw it).
  t3_call_settled: db => db.collection("call_interactions").countDocuments({ call_log_state: "settled", terminal: true, sources: ["call_log_reconcile"],
    "call_log_ids.0": { $exists: true }, merged_into_id: null }),
  // The webhook saw it, the Call Log stored it provisional, then it settled: both sources, revised, final.
  t3_call_provisional_then_settled: db => db.collection("call_interactions").countDocuments({ call_log_state: "settled", terminal: true,
    sources: { $all: ["webhook", "call_log_reconcile"] }, projection_revision: { $gte: 2 }, merged_into_id: null }),
  t3_call_unknown_direction: db => db.collection("call_interactions").countDocuments({ direction: "Unknown", merged_into_id: null }),
  // `capture_recovery` set, and the repair's own audit row proves it (`stamp-capture-recovery.ts` matching rule).
  t3_call_recovered: async db => {
    const calls = await db.collection("call_interactions").find({ "capture_recovery.kind": "added", "capture_recovery.run_id": { $type: "string" } }).toArray();
    let n = 0;
    for (const call of calls) if (await db.collection("sales_intelligence_audit_events").countDocuments({ subject_key: `interaction:${String(call._id)}`,
      event_kind: "interaction.created", "current.proof_ref": { $regex: "^call_log_repair:" } })) n++;
    return n;
  },
  // First stored more than 1 h after it started by the Call Log, with no repair (timeline `observed_reason: late_capture`).
  t3_call_late_capture: db => db.collection("call_interactions").countDocuments({ call_log_state: { $ne: null }, capture_recovery: null, merged_into_id: null,
    $expr: { $gt: [{ $subtract: ["$first_observed_at", "$started_at"] }, 3_600_000] } }),
  // A Number the Form Lead minted (`created_via: "form_lead"`), no call, attached to its Form Lead.
  t3_form_created_number: async db => {
    const numbers = await db.collection("contact_numbers").find({ created_via: "form_lead", "rollups.interactions_total": 0 }).toArray();
    let n = 0;
    for (const number of numbers) {
      if (await db.collection("call_interactions").countDocuments({ contact_number_id: number._id })) continue;
      if (await db.collection("number_lead_attachments").countDocuments({ contact_number_id: number._id, state: "attached", "lead_ref.model": "FormLead" })) n++;
    }
    return n;
  },
  t3_quarantined_call_log: async db => ((await db.collection("sales_intelligence_sync_state").findOne({ scope: "call_log_all_directions" }))?.quarantined_records ?? []).length,
  t3_webhook_subscription_healthy: (db, now) => db.collection("ringcentral_webhook_subscriptions").countDocuments({ provider: "ringcentral", subscriptionId: { $type: "string" },
    eventFilters: T3_ALL_DIRECTIONS, status: { $nin: ["Blacklisted", "Suspended", "Deleted"] }, expirationTime: { $gt: now } }),
  t3_webhook_subscription_expired: (db, now) => db.collection("ringcentral_webhook_subscriptions").countDocuments({ provider: "ringcentral", subscriptionId: { $type: "string" },
    eventFilters: T3_ALL_DIRECTIONS, expirationTime: { $lte: now } }),
  // ── SEED-T3 part 2 (2026-09-24): the assignment addendum's seed list, counted in the source collections. ──
  // Priority 5 (E1): an accepted 5 closes crm_disposition / granot_booked, with no quote default (G8).
  t3_p5_accepted: async db => {
    const rows = await db.collection("outreach_records").find({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked",
      "lead_progress.disposition": "crm_booked", "lead_progress.provenance": "accepted", "lead_progress.granot_priority": "5" }).toArray();
    let n = 0;
    for (const r of rows) if (!await db.collection("outreach_followups").countDocuments({ outreach_record_id: r._id, default_kind: { $type: "string" } })) n++;
    return n;
  },
  // An uncertain 5: active, with an open disposition_review on its subject.
  t3_p5_uncertain: async db => {
    const rows = await db.collection("outreach_records").find({ state: { $ne: "closed" }, "lead_progress.disposition": "crm_booked", "lead_progress.provenance": "uncertain" }).toArray();
    let n = 0;
    for (const r of rows) if (await db.collection("sales_intelligence_review_items").countDocuments({ subject_key: subjectKeyOf(r), cause_kind: "disposition_review", state: "open" })) n++;
    return n;
  },
  // 5 → 1: still closed granot_booked, current code 1, one open disposition_reopen review.
  t3_p5_to_1: async db => {
    const rows = await db.collection("outreach_records").find({ state: "closed", closed_reason: "granot_booked", "lead_progress.granot_priority": "1" }).toArray();
    let n = 0;
    for (const r of rows) if ((await db.collection("sales_intelligence_review_items").countDocuments({ subject_key: subjectKeyOf(r), cause_kind: "disposition_reopen", state: "open" })) === 1) n++;
    return n;
  },
  // 5 → official Booking (E2): official `booked`, and the closure audit says `upgraded_from: granot_booked`.
  t3_p5_booking_upgrade: async db => {
    const audits = await db.collection("sales_intelligence_audit_events").find({ event_kind: "outreach_closed", "current.upgraded_from": "granot_booked" }).toArray();
    let n = 0;
    for (const a of audits) if (await db.collection("outreach_records").countDocuments({ "subject.id": new ObjectId(String(a.subject_key).split(":")[2]), state: "closed", closure_origin: "official", closed_reason: "booked" })) n++;
    return n;
  },
  // receiver_agent sources (E3–E7): the Lead field, its source, and the EntityChange that wrote it.
  t3_receiver_manual: db => receiverSourceCount(db, "manual"),
  t3_receiver_granot: db => receiverSourceCount(db, "granot_username_match"),
  t3_receiver_extension: db => receiverSourceCount(db, "extension_match", "extension_selected", "extension_created", "extension_crm_username_match"),
  t3_receiver_sheet: db => receiverSourceCount(db, "best_relocation_sheet"),
  t3_receiver_ringcentral: db => receiverSourceCount(db, "ringcentral_answered"),
  // A Granot rep change: ≥ 2 Granot receiver changes on one Lead with different agents, and ≥ 2 observations with different reps for its job.
  t3_granot_rep_change: async db => {
    const groups = await db.collection("entity_changes").aggregate<{ _id: string; agents: unknown[]; n: number }>([
      { $match: { changed_paths: "receiver_agent", "provenance.source_system": "granot" } }, { $unwind: "$fields" }, { $match: { "fields.path": "receiver_agent" } },
      { $group: { _id: "$entity.id", agents: { $addToSet: "$fields.after" }, n: { $sum: 1 } } }, { $match: { n: { $gte: 2 } } }]).toArray();
    let n = 0;
    for (const g of groups.filter(g => g.agents.length >= 2)) {
      const lead = await db.collection("form_leads").findOne({ _id: new ObjectId(g._id) }) ?? await db.collection("call_leads").findOne({ _id: new ObjectId(g._id) });
      const reps = await db.collection("granot_observations").distinct("agent_identity.rep_raw", { "identity.normalized_job_no": lead?.normalized_job_no });
      if (reps.length >= 2) n++;
    }
    return n;
  },
  // An older observation received after a newer one (captured_at order ≠ receipt order) for the same job.
  t3_granot_observation_out_of_order: async db => {
    const rows = await db.collection("granot_observations").find({ "agent_identity.rep_raw": { $type: "string" } }, { projection: { "identity.normalized_job_no": 1, captured_at: 1, createdAt: 1 } }).toArray();
    const byJob = new Map<string, Array<{ captured: number; received: number }>>();
    for (const r of rows) { const key = String(r.identity?.normalized_job_no); byJob.set(key, [...(byJob.get(key) ?? []), { captured: +r.captured_at, received: +r.createdAt }]); }
    let n = 0;
    for (const list of byJob.values()) if (list.some(a => list.some(b => a.captured < b.captured && a.received > b.received))) n++;
    return n;
  },
  t3_granot_user_not_rep: db => db.collection("granot_observations").countDocuments({ "agent_identity.user_raw": { $type: "string" }, "agent_identity.rep_raw": { $type: "string" },
    $expr: { $ne: ["$agent_identity.user_raw", "$agent_identity.rep_raw"] } }),
  // An Owner assignment (origin owner) to a rep other than the Lead's receiver_agent.
  t3_owner_assign_vs_receiver: async db => {
    const rows = await db.collection("outreach_records").find({ "subject.kind": "lead", "assignment.origin": "owner", responsible_agent_id: { $type: "objectId" } }).toArray();
    let n = 0;
    for (const r of rows) {
      const lead = await db.collection(r.subject.model === "FormLead" ? "form_leads" : "call_leads").findOne({ _id: new ObjectId(String(r.subject.id)) });
      if (lead?.receiver_agent && String(lead.receiver_agent) !== String(r.responsible_agent_id)) n++;
    }
    return n;
  },
  // Two reps each promised a follow-up on a record another rep is responsible for (E11 union).
  t3_promise_across_reps: async db => {
    const actions = await db.collection("outreach_followups").find({ status: "open", origin: "rep_promise", promised_by_agent_id: { $type: "objectId" } }).toArray();
    const promisers = new Set<string>();
    for (const a of actions) {
      const r = await db.collection("outreach_records").findOne({ _id: a.outreach_record_id, responsible_agent_id: { $type: "objectId" } });
      if (r && String(r.responsible_agent_id) !== String(a.promised_by_agent_id)) promisers.add(String(a.promised_by_agent_id));
    }
    return promisers.size >= 2 ? promisers.size : 0;
  },
  // Closed history (E27): a record closed ~200 days ago (outside the snapshot's 90-day closed partition).
  t3_closed_200d: (db, now) => db.collection("outreach_records").countDocuments({ state: "closed", closed_at: { $gte: new Date(+now - 230 * DAY), $lte: new Date(+now - 180 * DAY) } }),
  t3_no_lead: db => db.collection("outreach_records").countDocuments({ "subject.kind": { $ne: "lead" }, state: { $ne: "closed" }, purged_at: null }),
  t3_priority_0: db => priorityCount(db, "0"),
  t3_priority_1: db => priorityCount(db, "1"),
  t3_priority_3: db => priorityCount(db, "3"),
  t3_priority_4: db => priorityCount(db, "4"),
  t3_priority_7: db => priorityCount(db, "7"),
  t3_priority_8: db => priorityCount(db, "8"),
  t3_priority_9: db => priorityCount(db, "9"),
  t3_priority_not_set: db => db.collection("outreach_records").countDocuments({ "subject.kind": "lead", state: { $ne: "closed" }, purged_at: null,
    $or: [{ lead_progress: null }, { "lead_progress.granot_priority": null }] }),
  // Two ET days on which both reviewed reps have calls in `outreach_rep_days` (the rebuild the seed ran), and the raw calls behind them.
  t3_rep_days_two_reps: async db => {
    const days = await db.collection("outreach_rep_days").aggregate<{ _id: string; reps: number }>([{ $match: { agent_id: { $type: "objectId" }, calls: { $gt: 0 } } },
      { $group: { _id: "$day", reps: { $sum: 1 } } }, { $match: { reps: { $gte: 2 } } }]).toArray();
    let n = 0;
    for (const d of days) {
      const reps = await db.collection("outreach_rep_days").find({ day: d._id, agent_id: { $type: "objectId" }, calls: { $gt: 0 } }).toArray();
      const reviewed = await db.collection("rep_identity_links").distinct("agent_id", { status: "reviewed", role_kind: "sales_rep" });
      if (reps.filter(r => reviewed.some(a => String(a) === String(r.agent_id))).length >= 2) n++;
    }
    return n >= 2 ? n : 0;
  },
  t3_rep_days_unmapped: async db => {
    const rows = await db.collection("outreach_rep_days").find({ agent_key: "unmapped", calls: { $gt: 0 } }).toArray();
    let n = 0;
    for (const r of rows) for (const ext of r.extensions ?? []) if (!await db.collection("rep_identity_links").countDocuments({ rc_extension_id: ext, status: "reviewed" })) { n++; break; }
    return n;
  },
  // Priced Leads in the last 7 days (§7, E20).
  t3_spend_rate: (db, now) => leadCount(db, now, { cpl: { $gt: 0 }, cpl_resolution_status: "resolved", cpl_rate_period: { $type: "objectId" }, no_sync: { $ne: true }, duplicate: { $ne: true } }),
  t3_spend_legacy: (db, now) => leadCount(db, now, { cpl: { $gt: 0 }, cpl_resolution_status: { $exists: false }, cpl_rate_period: { $exists: false }, no_sync: { $ne: true }, duplicate: { $ne: true } }),
  t3_spend_missing_rate: (db, now) => leadCount(db, now, { cpl_resolution_status: "missing_rate" }),
  t3_spend_duplicate_zero: (db, now) => leadCount(db, now, { cpl_resolution_status: "duplicate_zero" }),
  t3_spend_no_sync: (db, now) => leadCount(db, now, { no_sync: true, cpl: { $gt: 0 } }),
  // Band transitions (§6.3, G8): the baseline and each real cause the seed drove between OVERVIEW publishes.
  t3_band_baseline: db => db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "baseline", estimated: true }),
  t3_band_transition_call: db => db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "call", "cause.event_kind": { $type: "string" }, estimated: false }),
  t3_band_transition_capture_repair: db => db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "capture_repair" }),
  t3_band_transition_owner: db => db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "owner" }),
  t3_band_transition_policy: db => db.collection("outreach_band_transitions").countDocuments({ "cause.kind": "policy" }),
  // Active records whose newest transition is still the estimated baseline (`band_since.estimated: true`).
  t3_band_since_estimated: async db => {
    const newest = await db.collection("outreach_band_transitions").aggregate<{ _id: ObjectId; cause: string; to_band: number | null }>([{ $sort: { record_id: 1, at: -1, _id: -1 } },
      { $group: { _id: "$record_id", cause: { $first: "$cause.kind" }, to_band: { $first: "$to_band" } } }, { $match: { cause: "baseline", to_band: { $ne: null } } }]).toArray();
    return db.collection("outreach_records").countDocuments({ _id: { $in: newest.map(r => r._id) }, state: { $ne: "closed" } });
  },
};
function subjectKeyOf(record: { subject?: { kind: string; model?: string; id?: unknown; contact_number_id?: unknown } } & object) {
  if (!record.subject) return "";
  return record.subject.kind === "lead" ? `lead:${record.subject.model}:${String(record.subject.id)}` : `number:${String(record.subject.contact_number_id)}`;
}
async function receiverSourceCount(db: Db, ...sources: string[]) {
  let n = 0;
  for (const collection of ["form_leads", "call_leads"]) {
    const leads = await db.collection(collection).find({ receiver_agent: { $type: "objectId" }, receiver_agent_source: { $in: sources } }, { projection: { _id: 1, receiver_agent: 1 } }).toArray();
    for (const lead of leads) if (await db.collection("entity_changes").countDocuments({ "entity.id": String(lead._id), changed_paths: "receiver_agent" })) n++;
  }
  return n;
}
function priorityCount(db: Db, code: string) {
  return db.collection("outreach_records").countDocuments({ "subject.kind": "lead", "lead_progress.granot_priority": code, purged_at: null });
}
async function leadCount(db: Db, now: Date, filter: Record<string, unknown>) {
  const match = { timestamp: { $gte: new Date(+now - 7 * DAY), $lte: now }, ...filter };
  return (await db.collection("form_leads").countDocuments(match)) + (await db.collection("call_leads").countDocuments(match));
}

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
