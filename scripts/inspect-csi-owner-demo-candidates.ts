/**
 * Read-only shortlist for the Owner demo backfill (task 19 §3.1 and §3.3).
 * Prints job numbers and redacted ids only. Never prints phones, names, or transcripts.
 *
 *   pnpm exec tsx --env-file=.env scripts/inspect-csi-owner-demo-candidates.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { isTestMode } from "../src/config/domain/runtime";
import { BookedLead } from "../src/models/BookedLead";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getCallLeadModel } from "../src/models/CallLead";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceContactRestrictionModel } from "../src/models/SalesIntelligenceContactRestriction";
import {
  resolveAtInteraction,
  type Attachment,
  type InteractionIdentity,
} from "../src/services/salesIntelligence/attachment/suggest";

const PRIOR = [
  { label: "5564662", conversation_id: "6ab036430c84337849a0ab47" },
  { label: "5564549", conversation_id: "6ab027f00c84337849a072d6" },
  { label: "unbooked_call_lead", conversation_id: "6ab0282c0c84337849a07454" },
] as const;

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

function asAttachment(edge: {
  lead_ref: { model: "FormLead" | "CallLead"; id: unknown };
  state: Attachment["state"];
  certainty: Attachment["certainty"];
  evidence?: ReadonlyArray<{ window_from?: Date | null; window_to?: Date | null }>;
  decided_at?: Date | null;
}): Attachment {
  return {
    lead_ref: { model: edge.lead_ref.model, id: String(edge.lead_ref.id) },
    state: edge.state,
    certainty: edge.certainty,
    evidence: (edge.evidence ?? []).map((item) => ({
      ...(item as Attachment["evidence"][number]),
      window_from: item.window_from ?? null,
      window_to: item.window_to ?? null,
    })),
    decided_at: edge.decided_at ?? null,
  };
}

async function priorReport() {
  const snapshots = await getSalesIntelligenceAttentionSnapshotModel()
    .find()
    .sort({ as_of: -1 })
    .limit(3)
    .select({ snapshot_id: 1, as_of: 1, expires_at: 1, counts: 1 })
    .lean();
  const snapshot_count = await getSalesIntelligenceAttentionSnapshotModel().countDocuments();
  const subjects = [];
  for (const prior of PRIOR) {
    const conversation = await getLeadConversationModel()
      .findById(prior.conversation_id)
      .select({
        state: 1,
        contact_number_id: 1,
        started_at: 1,
        latest_transcript_version: 1,
        analysis_eligibility: 1,
        normalized_job_no: 1,
        lead_ref: 1,
        booking_ref: 1,
      })
      .lean();
    const edges = conversation?.contact_number_id
      ? await getNumberLeadAttachmentModel()
          .find({ contact_number_id: conversation.contact_number_id })
          .select({ state: 1, certainty: 1, lead_ref: 1, auto_decision: 1 })
          .lean()
      : [];
    const leadIds = [
      ...new Set([
        ...edges.map((edge) => String(edge.lead_ref.id)),
        conversation?.lead_ref?.id ? String(conversation.lead_ref.id) : "",
      ].filter(Boolean)),
    ];
    const outreach = leadIds.length
      ? await getOutreachRecordModel()
          .find({ "subject.kind": "lead", "subject.id": { $in: leadIds } })
          .select({
            state: 1,
            closed_reason: 1,
            closed_at: 1,
            closure_origin: 1,
            purged_at: 1,
            subject: 1,
            revision: 1,
          })
          .lean()
      : [];
    const runs = await getIntelligenceRunModel()
      .find({ conversation_id: prior.conversation_id })
      .sort({ _id: -1 })
      .limit(3)
      .select({ status: 1, processing_reason: 1, mode: 1, model_version: 1 })
      .lean();
    const booking = await BookedLead.findOne({
      $or: [
        { job_no: prior.label },
        { normalized_job_no: prior.label },
        ...(conversation?.booking_ref ? [{ _id: conversation.booking_ref }] : []),
        ...(leadIds.length ? [{ lead_ref: { $in: leadIds } }] : []),
      ],
    })
      .select({ job_no: 1, lead_model: 1, lead_ref: 1, cancelled: 1 })
      .lean();
    subjects.push({
      label: prior.label,
      conversation: mask(prior.conversation_id),
      state: conversation?.state ?? null,
      eligibility: conversation?.analysis_eligibility?.status ?? null,
      transcript: Boolean(conversation?.latest_transcript_version),
      job_no: conversation?.normalized_job_no ?? booking?.job_no ?? null,
      number: conversation?.contact_number_id ? mask(conversation.contact_number_id) : null,
      edges: edges.map(
        (edge) =>
          `${edge.state}/${edge.certainty}${edge.auto_decision ? "/auto" : ""} ${edge.lead_ref.model} ${mask(edge.lead_ref.id)}`,
      ),
      outreach: outreach.map((row) => ({
        id: mask(row._id),
        model: row.subject.model ?? null,
        lead: row.subject.id ? mask(row.subject.id) : null,
        state: row.state,
        closed_reason: row.closed_reason ?? null,
        closure_origin: row.closure_origin ?? null,
        purged_at: (row as { purged_at?: Date | null }).purged_at ?? null,
      })),
      booking: booking
        ? {
            job_no: booking.job_no ?? null,
            model: booking.lead_model ?? null,
            lead: booking.lead_ref ? mask(booking.lead_ref) : null,
            cancelled: Boolean(booking.cancelled),
          }
        : null,
      runs: runs.map((run) => ({
        id: mask(run._id),
        status: run.status,
        processing_reason: run.processing_reason ?? null,
        mode: run.mode ?? null,
      })),
    });
  }
  return {
    snapshot_count,
    newest_snapshots: snapshots.map((row) => ({
      id: row.snapshot_id,
      as_of: row.as_of,
      expires_at: row.expires_at,
      total: row.counts?.total_items ?? null,
    })),
    subjects,
  };
}

type LeadFlags = {
  model: "FormLead" | "CallLead";
  id: string;
  job_no: string | null;
  booked: boolean;
  cancelled: boolean;
  duplicate: boolean;
  bad_lead: boolean;
  no_sync: boolean;
  booking_job_no: string | null;
  booking_cancelled: boolean;
};

async function loadLead(model: "FormLead" | "CallLead", id: string): Promise<LeadFlags | null> {
  const lead =
    model === "FormLead"
      ? await getFormLeadModel()
          .findById(id)
          .select({ job_no: 1, normalized_job_no: 1, booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1 })
          .lean()
      : await getCallLeadModel()
          .findById(id)
          .select({ job_no: 1, normalized_job_no: 1, booked: 1, cancelled: 1, duplicate: 1, no_sync: 1 })
          .lean();
  if (!lead) return null;
  const booking = await BookedLead.findOne({ lead_ref: id, lead_model: model })
    .select({ job_no: 1, cancelled: 1 })
    .lean();
  const row = lead as {
    job_no?: string | null;
    normalized_job_no?: string | null;
    booked?: unknown;
    cancelled?: unknown;
    duplicate?: boolean;
    bad_lead?: boolean;
    no_sync?: boolean;
  };
  return {
    model,
    id,
    job_no: row.normalized_job_no || row.job_no || null,
    booked: Boolean(row.booked) || Boolean(booking),
    cancelled: Boolean(row.cancelled) || Boolean(booking?.cancelled),
    duplicate: Boolean(row.duplicate),
    bad_lead: Boolean(row.bad_lead),
    no_sync: Boolean(row.no_sync),
    booking_job_no: booking?.job_no ?? null,
    booking_cancelled: Boolean(booking?.cancelled),
  };
}

type DemoCandidate = {
  conversation: string;
  conversation_id: string;
  number: string;
  number_id: string;
  lead: string;
  lead_id: string;
  lead_model: "FormLead" | "CallLead";
  job_no: string | null;
  booked: boolean;
  cancelled: boolean;
  certainty: string;
  auto_attached: boolean;
  classification: string;
  direction: string;
  contact_type?: string | null;
  duration_seconds?: number | null;
  started_at?: Date | null;
  state?: string | null;
  transcript: boolean;
  eligibility: string | null;
  scope?: string | null;
  outreach_state: string | null;
  outreach: string | null;
  run_status: string | null;
  run_reason: string | null;
  why: string;
};

async function shortlist() {
  const priorIds = new Set(PRIOR.map((row) => row.conversation_id));
  const conversations = await getLeadConversationModel()
    .find({
      "media.blob_pathname": { $type: "string" },
      "media.purged_at": null,
      content_purged_at: null,
      contact_number_id: { $ne: null },
      call_interaction_id: { $ne: null },
      direction: { $in: ["Inbound", "Outbound"] },
      _id: { $nin: [...priorIds] },
    })
    .sort({ started_at: -1 })
    .limit(300)
    .select({
      contact_number_id: 1,
      call_interaction_id: 1,
      started_at: 1,
      duration_seconds: 1,
      state: 1,
      direction: 1,
      contact_type: 1,
      latest_transcript_version: 1,
      analysis_eligibility: 1,
      provider_account_id: 1,
      telephony_session_id: 1,
      normalized_job_no: 1,
      latest_completed_run_id: 1,
    })
    .lean();

  const interactionIds = conversations.flatMap((row) => (row.call_interaction_id ? [row.call_interaction_id] : []));
  const numberIds = [...new Set(conversations.map((row) => String(row.contact_number_id)))];
  const [interactions, numbers, edges, restrictions, runs] = await Promise.all([
    getCallInteractionModel()
      .find({ _id: { $in: interactionIds } })
      .select({
        terminal: 1,
        direction: 1,
        monitoring: 1,
        provider_account_id: 1,
        telephony_session_id: 1,
        session_id: 1,
        call_log_ids: 1,
        started_at: 1,
        recording_discovery: 1,
        contact_type: 1,
      })
      .lean(),
    getContactNumberModel()
      .find({ _id: { $in: numberIds } })
      .select({ kind: 1, classification: 1 })
      .lean(),
    getNumberLeadAttachmentModel()
      .find({ contact_number_id: { $in: numberIds } })
      .select({ contact_number_id: 1, state: 1, certainty: 1, evidence: 1, decided_at: 1, lead_ref: 1, auto_decision: 1 })
      .lean(),
    getSalesIntelligenceContactRestrictionModel()
      .find({ contact_number_id: { $in: numberIds }, state: "active" })
      .select({ contact_number_id: 1 })
      .lean(),
    getIntelligenceRunModel()
      .find({ conversation_id: { $in: conversations.map((row) => row._id) } })
      .select({ conversation_id: 1, status: 1, processing_reason: 1 })
      .lean(),
  ]);

  const interactionById = new Map(interactions.map((row) => [String(row._id), row]));
  const numberById = new Map(numbers.map((row) => [String(row._id), row]));
  const restricted = new Set(restrictions.map((row) => String(row.contact_number_id)));
  const edgesByNumber = new Map<string, typeof edges>();
  for (const edge of edges) {
    const key = String(edge.contact_number_id);
    const list = edgesByNumber.get(key) ?? [];
    list.push(edge);
    edgesByNumber.set(key, list);
  }
  const runByConversation = new Map<string, { status: string; processing_reason: string | null }>();
  for (const run of runs) {
    const key = String(run.conversation_id);
    const prior = runByConversation.get(key);
    if (!prior || run.status === "completed") {
      runByConversation.set(key, { status: run.status, processing_reason: run.processing_reason ?? null });
    }
  }

  const priorNumbers = new Set<string>();
  for (const prior of PRIOR) {
    const conversation = await getLeadConversationModel().findById(prior.conversation_id).select({ contact_number_id: 1 }).lean();
    if (conversation?.contact_number_id) priorNumbers.add(String(conversation.contact_number_id));
  }

  const candidates: DemoCandidate[] = [];
  for (const conversation of conversations) {
    const numberId = String(conversation.contact_number_id);
    if (priorNumbers.has(numberId) || restricted.has(numberId)) continue;
    const number = numberById.get(numberId);
    if (!number || number.kind !== "external") continue;
    if (number.classification !== "customer" && number.classification !== "unknown") continue;
    const interaction = interactionById.get(String(conversation.call_interaction_id));
    if (!interaction?.terminal || interaction.monitoring) continue;
    if (interaction.direction !== "Inbound" && interaction.direction !== "Outbound") continue;
    const numberEdges = edgesByNumber.get(numberId) ?? [];
    if (numberEdges.some((edge) => edge.state === "rejected")) continue;
    const attached = numberEdges.filter((edge) => edge.state === "attached");
    if (!attached.length) continue;
    const identity: InteractionIdentity = {
      id: String(interaction._id),
      provider_account_id: interaction.provider_account_id,
      started_at: interaction.started_at,
      telephony_session_id: interaction.telephony_session_id,
      session_id: interaction.session_id,
      call_log_ids: interaction.call_log_ids ?? [],
    };
    const resolution = resolveAtInteraction(numberEdges.map(asAttachment), identity);
    if (!resolution.lead_effects_allowed || !resolution.lead_ref) continue;
    const resolvedEdge = numberEdges.find(
      (edge) => edge.lead_ref.model === resolution.lead_ref!.model && String(edge.lead_ref.id) === resolution.lead_ref!.id,
    );
    if (!resolvedEdge || resolvedEdge.state !== "attached") continue;
    if (!["exact", "owner_confirmed", "likely"].includes(resolution.certainty)) continue;
    const lead = await loadLead(resolution.lead_ref.model, resolution.lead_ref.id);
    if (!lead || lead.duplicate || lead.bad_lead || lead.no_sync) continue;
    const outreach = await getOutreachRecordModel()
      .findOne({ "subject.kind": "lead", "subject.model": lead.model, "subject.id": lead.id })
      .select({ state: 1, closed_reason: 1 })
      .lean();
    const run = runByConversation.get(String(conversation._id)) ?? null;
    candidates.push({
      conversation: mask(conversation._id),
      conversation_id: String(conversation._id),
      number: mask(numberId),
      number_id: numberId,
      lead: mask(lead.id),
      lead_id: lead.id,
      lead_model: lead.model,
      job_no: lead.booking_job_no || lead.job_no || conversation.normalized_job_no || null,
      booked: lead.booked && !lead.cancelled && !lead.booking_cancelled,
      cancelled: lead.cancelled || lead.booking_cancelled,
      certainty: resolution.certainty,
      auto_attached: Boolean(resolvedEdge.auto_decision),
      classification: number.classification,
      direction: interaction.direction,
      contact_type: conversation.contact_type,
      duration_seconds: conversation.duration_seconds,
      started_at: conversation.started_at,
      state: conversation.state,
      transcript: Boolean(conversation.latest_transcript_version),
      eligibility: conversation.analysis_eligibility?.status ?? null,
      scope: conversation.analysis_eligibility?.scope ?? null,
      outreach_state: outreach?.state ?? null,
      outreach: outreach ? mask(outreach._id) : null,
      run_status: run?.status ?? null,
      run_reason: run?.processing_reason ?? null,
      why: [
        "stored media",
        `${resolution.certainty} attached ${lead.model}`,
        lead.booked && !lead.cancelled && !lead.booking_cancelled ? "booked" : "not booked",
        conversation.latest_transcript_version ? "transcript stored" : "needs transcription",
        run?.status === "completed" ? "analysis already completed" : "analysis not completed",
      ].join("; "),
    });
  }

  const rank = (row: (typeof candidates)[number]) =>
    (row.transcript ? 0 : 10) +
    (row.run_status === "completed" ? 5 : 0) +
    (row.contact_type === "human_conversation" ? 0 : 2) +
    (row.eligibility === "eligible" ? 0 : 1);
  const usable = (row: (typeof candidates)[number]) => (row.duration_seconds ?? 0) >= 60 && row.transcript && row.run_status !== "completed";
  const booked = candidates.filter((row) => row.booked && !row.cancelled && usable(row)).sort((a, b) => rank(a) - rank(b));
  const open = candidates.filter((row) => !row.booked && !row.cancelled && usable(row)).sort((a, b) => rank(a) - rank(b));
  const uniqueJobs = (rows: typeof booked) => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = row.job_no ?? row.lead;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const redact = ({ conversation_id: _c, number_id: _n, lead_id: _l, ...rest }: (typeof candidates)[number]) => rest;
  return {
    scanned: conversations.length,
    qualifying: candidates.length,
    booked_call: uniqueJobs(booked.filter((row) => row.lead_model === "CallLead")).slice(0, 4).map(redact),
    booked_form: uniqueJobs(booked.filter((row) => row.lead_model === "FormLead")).slice(0, 4).map(redact),
    open_call: uniqueJobs(open.filter((row) => row.lead_model === "CallLead")).slice(0, 4).map(redact),
    open_form: uniqueJobs(open.filter((row) => row.lead_model === "FormLead")).slice(0, 4).map(redact),
  };
}

async function main() {
  if (isTestMode()) throw new Error("Refusing TEST_MODE.");
  await connectMongo();
  const report = { prior: await priorReport(), shortlist: await shortlist() };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
