/**
 * S6-AGENT / S10 step 3 core: the `receiver_agent` backfill (assignment addendum §3.3, E7; reconciliation §5).
 * Used by `scripts/backfill-receiver-agent.ts` and its replica proof `scripts/dev_ops/test-si-receiver-agent.ts`.
 *
 * Cohort (E7): every Lead with an Outreach record, plus every Lead whose `timestamp` is in the last 90 days.
 * Walked by `_id` with a resumable cursor: phase `records` (Lead Outreach records), then `FormLead` / `CallLead`
 * (recent Leads without a record; a Lead with a record was counted in phase 1).
 *
 * Per Lead (read-only plan, `planReceiverBackfill`):
 * 1. Granot (§3.1, E3/E6): the newest accepted observation for the Lead (a live `created` / `applied` /
 *    `linked` / `already_current` Decision targeting it) with a valid Priority whose `user`/`rep` resolves to
 *    exactly one active Agent (`resolveAgentAssertion`, the lifecycle's own rule). The latest-wins rule
 *    (`receiverReplaceableByGranot`) decides against the current receiver: `manual` (and source-less) is
 *    skipped, an extension/sheet rep set after the observation is kept.
 * 2. RingCentral (E5): a Call Lead still empty gets the one reviewed rep who answered its creating call.
 * 3. The Outreach record: would its responsible rep change (`receiverAssignmentPlan`, the `ensureLead` rule)?
 *
 * Buckets per evidence source (`granot`, `ringcentral_answered`): `set`, `changed`, `unchanged`,
 * `skipped_manual`, `kept_newer_rep`, `conflicting` (user ≠ rep), `ambiguous_username`, `no_evidence`.
 *
 * Dry run (default) is READ-ONLY: no session, no transaction, no write. Apply writes each decided Lead
 * through `writeReceiverAgent` (compare-and-set, `EntityChange`, `domain_revision`, sheet outbox) in one
 * transaction per page. It never runs `ensureLead` itself: the production Outreach scan turns each
 * `receiver_agent` change into `crm_receiver` (a free `outreach_ensure` job), and S10 step 6 re-ensures
 * every record anyway. It creates no Sales Intelligence job: a page that would create one aborts
 * (the job-table counter is taken in the page transaction before and after).
 */
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../src/db";
import { Agent } from "../src/models/Agent";
import { getCallLeadModel } from "../src/models/CallLead";
import { getFormLeadModel } from "../src/models/FormLead";
import { getGranotObservationModel } from "../src/models/GranotObservation";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSynchronizationDecisionModel } from "../src/models/SynchronizationDecision";
import type { CanonicalCommandContext } from "../src/services/domainCommands/types";
import { createMongoLeadIdentityStore, resolveAgentAssertion } from "../src/services/granotLifecycle/identity";
import { receiverReplaceableByGranot } from "../src/services/granotLifecycle/leadDesiredState";
import { ringCentralAnsweredContext, writeReceiverAgent } from "../src/services/leads/receiverAgentWrite";
import { receiverAssignmentPlan, ringCentralAnsweredAgent } from "../src/services/salesIntelligence/outreach/receiverAssignment";
import type { RecordRow } from "../src/services/salesIntelligence/outreach/types";

export const RECEIVER_BACKFILL_VERSION = "receiver-agent-backfill-v1" as const;
export const RECEIVER_COHORT_DAYS = 90;
const ACCEPTED_OUTCOMES = ["created", "applied", "linked", "already_current"] as const;
const DECISION_SCAN = 200;
type Model = "FormLead" | "CallLead";
type Phase = "records" | Model | "done";

export type ReceiverBackfillManifest = {
  version: typeof RECEIVER_BACKFILL_VERSION; run_id: string; database: string; mode: "dry_run" | "apply";
  created_at: string; updated_at: string; finished_at: string | null; cohort_from: string;
  cursor: { phase: Phase; after: string | null }; processed: number;
  counts: Record<string, number>;
  jobs_before: Record<string, number> | null; jobs_after: Record<string, number> | null;
};
export type ReceiverBackfillSeams = {
  now?: () => Date;
  save: (manifest: ReceiverBackfillManifest) => Promise<unknown>;
  log: (event: string, fields?: Record<string, unknown>) => Promise<unknown>;
};
export function newReceiverBackfillManifest(database: string, apply: boolean, now = new Date()): ReceiverBackfillManifest {
  return { version: RECEIVER_BACKFILL_VERSION, run_id: new mongoose.Types.ObjectId().toString(), database, mode: apply ? "apply" : "dry_run",
    created_at: now.toISOString(), updated_at: now.toISOString(), finished_at: null,
    cohort_from: new Date(+now - RECEIVER_COHORT_DAYS * 86_400_000).toISOString(),
    cursor: { phase: "records", after: null }, processed: 0, counts: {}, jobs_before: null, jobs_after: null };
}
const bump = (counts: Record<string, number>, key: string, by = 1) => { counts[key] = (counts[key] ?? 0) + by; };
const leadCollection = (model: Model) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection;

/** Every Sales Intelligence job by stage and status (the zero-paid-work counter), read in `session` when given. */
export async function jobTableCounts(session?: ClientSession): Promise<Record<string, number>> {
  const rows = await getSalesIntelligenceJobModel().aggregate<{ _id: { stage: string; status: string }; n: number }>([
    { $group: { _id: { stage: "$stage", status: "$status" }, n: { $sum: 1 } } }]).session(session ?? null);
  const out: Record<string, number> = { total: 0 };
  for (const row of rows) { out[`${row._id.stage}:${row._id.status}`] = row.n; out.total! += row.n; }
  return out;
}

type LeadLean = { _id: mongoose.Types.ObjectId; receiver_agent?: unknown; receiver_agent_source?: string | null; receiver_agent_set_at?: Date | null;
  receiver_agent_name_snapshot?: string | null; ringcentral?: { telephony_session_id?: string | null } | null; timestamp?: Date | null };
type Candidate = { observation_id: string; captured_at: Date; agent_id: string; agent_name: string; username: string };
export type ReceiverBackfillPlan = {
  evidence: "granot" | "ringcentral_answered";
  bucket: "set" | "changed" | "unchanged" | "skipped_manual" | "kept_newer_rep" | "conflicting" | "ambiguous_username" | "no_evidence";
  current_source: string;
  write: null | { agent: { id: string; name: string }; source: "granot_username_match" | "ringcentral_answered"; source_value: string | null;
    observation_id: string | null; interaction_id: string | null; telephony_session_id: string | null };
  granot_failure: "conflicting" | "ambiguous_username" | null;
  /** The Outreach record's responsible rep would change (the `ensureLead` rule, after the write). */
  responsible_change: "would_change" | "owner_kept" | "unchanged" | "no_record";
};

/** The newest accepted Granot observation for the Lead whose `user`/`rep` names exactly one active Agent. */
async function granotCandidate(model: Model, id: string, session?: ClientSession): Promise<{ candidate: Candidate | null; failure: "conflicting" | "ambiguous_username" | null }> {
  const decisions = await getSynchronizationDecisionModel().find({ "target.model": model, "target.id": id, execution_mode: "live", outcome: { $in: [...ACCEPTED_OUTCOMES] } })
    .select({ observation_id: 1 }).sort({ decided_at: -1 }).limit(DECISION_SCAN).session(session ?? null).lean();
  if (!decisions.length) return { candidate: null, failure: null };
  const observations = await getGranotObservationModel().find({ _id: { $in: [...new Set(decisions.map(d => String(d.observation_id)))].map(v => new mongoose.Types.ObjectId(v)) } })
    .select({ captured_at: 1, priority: 1, agent_identity: 1 }).session(session ?? null).lean();
  observations.sort((a, b) => +b.captured_at - +a.captured_at || String(b._id).localeCompare(String(a._id)));
  const store = createMongoLeadIdentityStore(session);
  let failure: "conflicting" | "ambiguous_username" | null = null;
  for (const observation of observations) {
    if (observation.priority?.valid !== true) continue;
    const assertion = await resolveAgentAssertion(observation.agent_identity ?? {}, store);
    if (assertion.agent_assertion === "empty") continue;
    if (assertion.agent_assertion === "conflict") { failure ??= "conflicting"; continue; }
    if (!assertion.agent) { failure ??= "ambiguous_username"; continue; }
    const agent = await Agent.findById(assertion.agent.target.id).select({ name: 1, active: 1 }).session(session ?? null).lean();
    if (!agent || agent.active !== true || !agent.name?.trim()) { failure ??= "ambiguous_username"; continue; }
    return { candidate: { observation_id: String(observation._id), captured_at: observation.captured_at, agent_id: String(agent._id), agent_name: agent.name,
      username: assertion.agent.normalized_username }, failure };
  }
  return { candidate: null, failure };
}

/** The read-only plan for one Lead (both halves of §3.3 and the Outreach consequence). */
export async function planReceiverBackfill(model: Model, lead: LeadLean, record: RecordRow | null, session?: ClientSession): Promise<ReceiverBackfillPlan> {
  const id = String(lead._id);
  const current = lead.receiver_agent ? String(lead.receiver_agent) : null;
  const current_source = current ? lead.receiver_agent_source ?? "none_recorded" : "empty";
  const { candidate, failure } = await granotCandidate(model, id, session);
  let plan: ReceiverBackfillPlan = { evidence: "granot", bucket: "no_evidence", current_source, write: null, granot_failure: failure, responsible_change: "no_record" };
  if (candidate) {
    const projection = { receiver_agent: current ?? undefined, receiver_agent_source: lead.receiver_agent_source ?? undefined, receiver_agent_set_at: lead.receiver_agent_set_at ?? undefined };
    if (current === candidate.agent_id) plan.bucket = "unchanged";
    else if (current && (!lead.receiver_agent_source || lead.receiver_agent_source === "manual")) plan.bucket = "skipped_manual";
    else if (!receiverReplaceableByGranot(projection, candidate.agent_id, candidate.captured_at)) plan.bucket = "kept_newer_rep";
    else {
      plan.bucket = current ? "changed" : "set";
      plan.write = { agent: { id: candidate.agent_id, name: candidate.agent_name }, source: "granot_username_match", source_value: candidate.username,
        observation_id: candidate.observation_id, interaction_id: null, telephony_session_id: null };
    }
  } else if (failure) plan.bucket = failure;
  // E5: a Call Lead that stays empty after the Granot half.
  if (!current && !plan.write && model === "CallLead") {
    const answered = record ? await ringCentralAnsweredAgent(record, lead, session) : null;
    plan = { ...plan, evidence: "ringcentral_answered", bucket: answered ? "set" : plan.bucket,
      write: answered ? { agent: answered.agent, source: "ringcentral_answered", source_value: answered.call_id, observation_id: null,
        interaction_id: answered.call_id, telephony_session_id: answered.telephony_session_id } : null };
  }
  if (record) {
    const after = plan.write ? { receiver_agent: plan.write.agent.id, receiver_agent_source: plan.write.source } : { receiver_agent: current, receiver_agent_source: lead.receiver_agent_source ?? null };
    const decision = receiverAssignmentPlan(record, after);
    const differs = decision === "fallback" || (decision === "follow" && String(record.responsible_agent_id ?? "") !== String(after.receiver_agent ?? ""));
    plan.responsible_change = record.assignment?.origin === "owner" && after.receiver_agent && String(record.responsible_agent_id ?? "") !== String(after.receiver_agent)
      ? "owner_kept" : differs ? "would_change" : "unchanged";
  }
  return plan;
}

const BACKFILL_ACTOR = (requestId: string) => ({ actor_type: "system" as const, actor_id: "receiver-agent-backfill", actor_label: "Receiver agent backfill",
  actor_role: "system" as const, request_id: requestId, origin: "granot_lifecycle" as const });
/** The Granot-origin context of a backfilled Granot rep: `source_system: granot`, paired with its observation. */
export function granotBackfillContext(runId: string, leadId: string, observationId: string): CanonicalCommandContext {
  const actor = BACKFILL_ACTOR(runId);
  return { command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: `receiver-agent-backfill:${runId}:${leadId}`, payload_checksum: "0".repeat(64),
    actor, initiator: actor, provenance: { origin: "granot_lifecycle", run_id: null, source_receipt_id: null, source_connection_key: null,
      observation_id: observationId, decision_id: null, case_id: null, discrepancy_id: null, observation_channel: null } };
}

/** The candidate Leads of one page for the current phase, advancing the phase when it is exhausted. */
async function nextPage(manifest: ReceiverBackfillManifest, page: number): Promise<Array<{ model: Model; lead: LeadLean; record: RecordRow | null; key: string }>> {
  const LEAD_PROJECTION = { receiver_agent: 1, receiver_agent_source: 1, receiver_agent_set_at: 1, receiver_agent_name_snapshot: 1, "ringcentral.telephony_session_id": 1, timestamp: 1 };
  for (;;) {
    const { phase, after } = manifest.cursor;
    if (phase === "done") return [];
    const afterFilter = after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {};
    if (phase === "records") {
      const records = await getOutreachRecordModel().find({ "subject.kind": "lead", ...afterFilter }).sort({ _id: 1 }).limit(page).lean() as unknown as RecordRow[];
      if (!records.length) { manifest.cursor = { phase: "FormLead", after: null }; continue; }
      const out: Array<{ model: Model; lead: LeadLean; record: RecordRow | null; key: string }> = [];
      for (const model of ["FormLead", "CallLead"] as const) {
        const mine = records.filter(r => r.subject.model === model);
        if (!mine.length) continue;
        const leads = new Map((await leadCollection(model).find({ _id: { $in: mine.map(r => r.subject.id!) } }, { projection: LEAD_PROJECTION }).toArray() as unknown as LeadLean[])
          .map(l => [String(l._id), l]));
        for (const record of mine) {
          const lead = leads.get(String(record.subject.id));
          out.push({ model, lead: lead ?? ({ _id: record.subject.id } as LeadLean), record, key: `${lead ? "" : "missing:"}${record._id}` });
        }
      }
      return out.sort((a, b) => a.key.replace("missing:", "").localeCompare(b.key.replace("missing:", "")));
    }
    const from = new Date(manifest.cohort_from);
    const leads = await leadCollection(phase).find({ timestamp: { $gte: from }, ...afterFilter }, { projection: LEAD_PROJECTION }).sort({ _id: 1 }).limit(page).toArray() as unknown as LeadLean[];
    if (!leads.length) { manifest.cursor = { phase: phase === "FormLead" ? "CallLead" : "done", after: null }; continue; }
    const withRecord = new Set((await getOutreachRecordModel().find({ "subject.kind": "lead", "subject.model": phase, "subject.id": { $in: leads.map(l => l._id) } })
      .select({ subject: 1 }).lean()).map(r => String(r.subject.id)));
    return leads.map(lead => ({ model: phase, lead, record: null, key: `${withRecord.has(String(lead._id)) ? "skip:" : ""}${lead._id}` }));
  }
}
const cursorValue = (key: string) => key.replace(/^(skip|missing):/, "");

/** Apply of one planned Lead inside the page transaction; returns what was written. */
async function applyOne(model: Model, lead: LeadLean, plan: ReceiverBackfillPlan, runId: string, session: ClientSession, now: Date) {
  if (!plan.write) return false;
  const id = String(lead._id);
  const context = plan.write.source === "granot_username_match"
    ? granotBackfillContext(runId, id, plan.write.observation_id!)
    : ringCentralAnsweredContext({ lead_id: id, telephony_session_id: plan.write.telephony_session_id!, interaction_id: plan.write.interaction_id! });
  const stamp = await writeReceiverAgent({ model, id, agent: plan.write.agent, source: plan.write.source, source_value: plan.write.source_value,
    expected_receiver: lead.receiver_agent ? String(lead.receiver_agent) : null, context, command_name: "backfillReceiverAgent", session, now });
  return Boolean(stamp);
}

/**
 * The walk. Resumable: the manifest carries the cursor and every count, saved after each page.
 * Dry run: reads only. Apply: one transaction per page; the page re-plans inside the transaction (so a
 * concurrent edit is seen) and aborts if any Sales Intelligence job appears.
 */
export async function runReceiverBackfill(options: { apply: boolean; limit?: number | null; page?: number }, manifest: ReceiverBackfillManifest, seams: ReceiverBackfillSeams) {
  const now = seams.now ?? (() => new Date());
  const page = options.page ?? 50, limit = options.limit ?? null;
  manifest.jobs_before ??= await jobTableCounts();
  await seams.log("started", { mode: manifest.mode, cursor: manifest.cursor, processed: manifest.processed, cohort_from: manifest.cohort_from });
  while (manifest.cursor.phase !== "done" && (limit === null || manifest.processed < limit)) {
    const candidates = await nextPage(manifest, limit === null ? page : Math.max(1, Math.min(page, limit - manifest.processed)));
    if (!candidates.length) break;
    const phase = manifest.cursor.phase;
    const results: Array<{ key: string; model: Model; id: string; plan: ReceiverBackfillPlan | null; written: boolean; skip: string | null }> = [];
    const at = now();
    const planPage = async (session?: ClientSession) => {
      results.length = 0;
      for (const { model, lead, record, key } of candidates) {
        if (key.startsWith("skip:")) { results.push({ key, model, id: String(lead._id), plan: null, written: false, skip: "counted_in_records_phase" }); continue; }
        if (key.startsWith("missing:")) { results.push({ key, model, id: String(lead._id), plan: null, written: false, skip: "lead_missing" }); continue; }
        const fresh = session ? await leadCollection(model).findOne({ _id: lead._id }, { session }) as LeadLean | null : lead;
        if (!fresh) { results.push({ key, model, id: String(lead._id), plan: null, written: false, skip: "lead_missing" }); continue; }
        const plan = await planReceiverBackfill(model, fresh, record, session);
        const written = session ? await applyOne(model, fresh, plan, manifest.run_id, session, at) : false;
        results.push({ key, model, id: String(lead._id), plan, written, skip: null });
      }
    };
    if (options.apply) {
      await withTransaction(async session => {
        // Jobs visible in this snapshot with a recent id (wall clock: ids carry the creation second); a new one is ours.
        const recent = { _id: { $gt: mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 3_600_000) / 1000)) } };
        const before = await getSalesIntelligenceJobModel().countDocuments(recent).session(session);
        await planPage(session);
        const after = await getSalesIntelligenceJobModel().countDocuments(recent).session(session);
        if (after !== before) throw new Error(`a Sales Intelligence job was created in page ${phase}:${candidates[0]!.key}; transaction aborted`);
      });
    } else await planPage();
    for (const { key, model, id, plan, written, skip } of results) {
      if (skip) bump(manifest.counts, `skip:${skip}`);
      if (plan) {
        bump(manifest.counts, `${plan.evidence}:${plan.bucket}`);
        bump(manifest.counts, `current:${plan.current_source}:${plan.bucket}`);
        if (plan.granot_failure && plan.evidence === "ringcentral_answered") bump(manifest.counts, `granot:${plan.granot_failure}_then_ringcentral`);
        bump(manifest.counts, `outreach:${plan.responsible_change}`);
        if (written) bump(manifest.counts, `written:${plan.write!.source}`);
        else if (plan.write && manifest.mode === "apply") bump(manifest.counts, "apply_lost_race");
      }
      await seams.log("candidate", { phase, model, lead_id: id, bucket: plan?.bucket ?? null, evidence: plan?.evidence ?? null, current_source: plan?.current_source ?? null,
        to_agent: plan?.write?.agent.id ?? null, source: plan?.write?.source ?? null, responsible_change: plan?.responsible_change ?? null, written, skip });
      manifest.cursor.after = cursorValue(key);
      if (!skip) manifest.processed++;
    }
    manifest.updated_at = now().toISOString();
    await seams.save(manifest);
  }
  manifest.jobs_after = await jobTableCounts();
  if (manifest.cursor.phase === "done") manifest.finished_at = now().toISOString();
  manifest.updated_at = now().toISOString();
  await seams.save(manifest);
  await seams.log("finished", { mode: manifest.mode, processed: manifest.processed, counts: manifest.counts });
  return manifest;
}

const BUCKETS = ["set", "changed", "unchanged", "skipped_manual", "kept_newer_rep", "conflicting", "ambiguous_username", "no_evidence"] as const;
/** The S10-3 report body (identifiers and counts only). */
export function receiverBackfillReport(manifest: ReceiverBackfillManifest, env: string, flags: Record<string, boolean>): string {
  const c = manifest.counts, n = (key: string) => c[key] ?? 0;
  const jobDelta = manifest.jobs_before && manifest.jobs_after ? (manifest.jobs_after.total ?? 0) - (manifest.jobs_before.total ?? 0) : null;
  const sources = [...new Set(Object.keys(c).filter(k => k.startsWith("current:")).map(k => k.split(":")[1]!))].sort();
  return [
    `# S10 step 3: receiver_agent backfill (${env})`, "",
    `- Mode: **${manifest.mode}**; database \`${manifest.database}\`; run \`${manifest.run_id}\`; ${manifest.created_at} → ${manifest.finished_at ?? "(not finished; resume)"}`,
    `- Script: \`scripts/backfill-receiver-agent.ts\` (${RECEIVER_BACKFILL_VERSION}); flags ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- Cohort: Leads with an Outreach record, plus Leads with \`timestamp\` ≥ ${manifest.cohort_from}. Processed: ${manifest.processed}; cursor ${manifest.cursor.phase}${manifest.cursor.after ? ` after ${manifest.cursor.after}` : ""}`,
    "", "## Buckets per evidence source", "", `| Bucket | Granot (\`granot_username_match\`) | RingCentral (\`ringcentral_answered\`, Call Leads still empty) |`, "|---|---|---|",
    ...BUCKETS.map(b => `| ${b} | ${n(`granot:${b}`)} | ${n(`ringcentral_answered:${b}`)} |`),
    "", `${manifest.mode === "apply" ? "Written" : "Would write"}: Granot ${manifest.mode === "apply" ? n("written:granot_username_match") : n("granot:set") + n("granot:changed")}, RingCentral ${manifest.mode === "apply" ? n("written:ringcentral_answered") : n("ringcentral_answered:set")}${manifest.mode === "apply" ? `; lost a race (re-run picks it up): ${n("apply_lost_race")}` : ""}.`,
    "", "## By the Lead's current `receiver_agent_source`", "", `| Current source | ${BUCKETS.join(" | ")} |`, `|---|${BUCKETS.map(() => "---").join("|")}|`,
    ...sources.map(s => `| ${s} | ${BUCKETS.map(b => n(`current:${s}:${b}`)).join(" | ")} |`),
    "", "## Outreach responsible rep (the `ensureLead` rule after this write)", "", "| Outcome | Records |", "|---|---|",
    `| Responsible rep would change (\`crm_receiver\`) | ${n("outreach:would_change")} |`, `| Owner-assigned, kept (E26) | ${n("outreach:owner_kept")} |`,
    `| Unchanged | ${n("outreach:unchanged")} |`, `| Lead has no Outreach record | ${n("outreach:no_record")} |`,
    "", `Sales Intelligence jobs (all stages) before → after: ${manifest.jobs_before?.total ?? "?"} → ${manifest.jobs_after?.total ?? "?"} (delta ${jobDelta ?? "?"}; production consumers may add their own work during the run; the apply aborts any page that creates one itself).`,
    "", "## Every count", "", "| Key | Count |", "|---|---|", ...Object.entries(c).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`), "",
  ].join("\n");
}
