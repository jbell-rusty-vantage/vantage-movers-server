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

const DAY = 86_400_000;
const etDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const BOOKKEEPING_REVIEW_REASONS = ["prior_finding_contradicted", "prior_fulfilled_followup_open"];
const LOCATION_OR_DATE = ["pickup_location", "delivery_location", "move_date"];
// AC0-SEED: the seed never calls `updateCsiPolicy`, so the live policy is always the default (pure, no DB read needed here).
const POLICY = defaultCsiPolicy();

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
/** Numbers whose only calls are a single Inbound human conversation: [staffed minutes ago] per Number. */
async function inboundOnlyStaffedMinutesAgo(db: Db, now: Date): Promise<number[]> {
  const groups = await db.collection("call_interactions").aggregate<{ _id: ObjectId; directions: string[]; calls: Array<{ direction: string; contact_type: string; started_at: Date }> }>([
    { $match: { merged_into_id: null } },
    { $group: { _id: "$contact_number_id", directions: { $addToSet: "$direction" }, calls: { $push: { direction: "$direction", contact_type: "$contact_type", started_at: "$started_at" } } } },
  ]).toArray();
  const out: number[] = [];
  for (const row of groups) {
    if (row.directions.length !== 1 || row.directions[0] !== "Inbound") continue;
    const human = row.calls.filter(c => c.contact_type === "human_conversation");
    if (human.length !== 1) continue;
    out.push(staffedMinutesBetween(human[0]!.started_at, now, POLICY));
  }
  return out;
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
/** Outbound, non-human-conversation attempts grouped by Number, with the distinct `user`-party extensions seen. */
async function outboundAttemptExtensionGroups(db: Db) {
  return db.collection("call_interactions").aggregate<{ _id: ObjectId; exts: string[]; n: number }>([
    { $match: { direction: "Outbound", merged_into_id: null, contact_type: { $ne: "human_conversation" } } },
    { $unwind: "$parties" }, { $match: { "parties.role": "user" } },
    { $group: { _id: "$contact_number_id", exts: { $addToSet: "$parties.extension_id" }, n: { $sum: 1 } } },
  ]).toArray();
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
  ac_callback_customer_exact: (db, now) => db.collection("outreach_followups").countDocuments({ origin: "customer_request", kind: "call", status: "open",
    "date_resolution.precision": "exact", due_at: { $lt: now } }),
  ac_callback_owner_exact: db => db.collection("outreach_followups").countDocuments({ origin: "owner", kind: "call", status: "open", "date_resolution.precision": "exact" }),
  ac_callback_rep_day: db => db.collection("outreach_followups").countDocuments({ origin: "rep_promise", kind: "call", status: "open", "date_resolution.precision": "day" }),
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
  ac_formlead_40s: db => unworkedFormLeadAge(db, 0, 300),
  ac_formlead_3h: db => unworkedFormLeadAge(db, 2 * 3600, 4 * 3600),
  // Bucketed with a small epsilon around the 240-minute boundary: the seed's own binary search
  // (`staffedBefore`, searching via `addStaffedMinutes`) already lands within floating-point noise
  // (~1e-5 minutes) of the exact target, and the two states must stay on either side of the threshold
  // even with a little real clock drift between the seed run and this assertion.
  ac_inbound_only_239: async (db, now) => (await inboundOnlyStaffedMinutesAgo(db, now)).filter(m => m >= 225 && m < 239.95).length,
  ac_inbound_only_240: async (db, now) => (await inboundOnlyStaffedMinutesAgo(db, now)).filter(m => m >= 239.95 && m <= 255).length,
  ac_called_before_form_6d: db => calledBeforeFormDays(db, 5.5, 6.5),
  ac_called_before_form_8d: db => calledBeforeFormDays(db, 7.5, 8.5),
  ac_progress_0_to_1: db => db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority",
    fields: { $elemMatch: { path: "granot_priority", before: "0", after: "1" } }, "provenance.observation_id": { $exists: true } }),
  ac_progress_1_3_1: async db => {
    const upTo3 = await db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority", fields: { $elemMatch: { path: "granot_priority", before: "1", after: "3" } },
      "provenance.observation_id": { $exists: true } });
    const backTo1 = await db.collection("entity_changes").countDocuments({ changed_paths: "granot_priority", fields: { $elemMatch: { path: "granot_priority", before: "3", after: "1" } },
      "provenance.observation_id": { $exists: true } });
    return Math.min(upTo3, backTo1);
  },
  ac_progress_uncertain_1: db => db.collection("outreach_records").countDocuments({ "lead_progress.granot_priority": "1", "lead_progress.provenance": "uncertain" }),
  ac_progress_accepted_3: db => db.collection("outreach_records").countDocuments({ "lead_progress.disposition": "rep_discretion", "lead_progress.provenance": "accepted",
    "lead_progress.work_observed": true }),
  ac_attempts_same_rep: async db => (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length === 1 && g.n >= 2).length,
  ac_attempts_two_reps: async db => (await outboundAttemptExtensionGroups(db)).filter(g => g.exts.length >= 2).length,
  ac_going_cold_unreached: async (db, now) => {
    const records = await db.collection("outreach_records").find({ state: { $ne: "closed" }, primary_contact_number_id: { $ne: null }, trigger_at: { $lt: new Date(+now - 30 * DAY) } }).toArray();
    let n = 0;
    for (const r of records) {
      if (await db.collection("call_interactions").countDocuments({ contact_number_id: r.primary_contact_number_id, contact_type: "human_conversation" })) continue;
      if (await db.collection("call_interactions").countDocuments({ contact_number_id: r.primary_contact_number_id, direction: "Outbound", started_at: { $gte: new Date(+now - 10 * DAY) } })) n++;
    }
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
