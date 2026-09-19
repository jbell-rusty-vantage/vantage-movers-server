import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../../../../src/db";
import { getCallLeadModel } from "../../../../../src/models/CallLead";
import { getOutreachRecordModel } from "../../../../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../../../src/models/OutreachFollowup";
import { getSalesIntelligenceJobModel } from "../../../../../src/models/SalesIntelligenceJob";
import { officialClosure } from "../../../../../src/services/salesIntelligence/outreach/transitions";
import { enqueueCsiJob } from "../../../../../src/services/salesIntelligence/jobs";
import { runOutreachEnsureJob } from "../../../../../src/services/salesIntelligence/outreach/worker";

process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";

const SUBJECTS = [
  { job: "P5562014", leadId: "6a761d3d7ceae445794c57bd" },
  { job: "5564480", leadId: "6aaaf552ca2df3ab6f396b5d" },
] as const;

function redacted(row: {
  job: string;
  leadId: string;
  booked: boolean;
  official: string | null;
  outreach_id: string | null;
  state: string | null;
  closed_reason: string | null;
  closure_origin: string | null;
  first_action_due_at: string | null;
  primary_number: boolean;
  open_followups: number;
  ensure_job: string | null;
  ensure_status: string | null;
  refresh_jobs: number;
}) {
  return row;
}

async function snapshot(job: string, leadId: string) {
  const lead = await getCallLeadModel().findById(leadId).lean();
  if (!lead) throw new Error(`missing Call Lead ${leadId}`);
  const official = officialClosure(lead);
  const outreach = await getOutreachRecordModel()
    .findOne({ "subject.kind": "lead", "subject.model": "CallLead", "subject.id": leadId })
    .lean();
  const openFollowups = outreach
    ? await getOutreachFollowupModel().countDocuments({ outreach_record_id: outreach._id, status: "open" })
    : 0;
  const refreshJobs = outreach
    ? await getSalesIntelligenceJobModel().countDocuments({
        stage: "number_refresh",
        "input_refs.0": String(outreach._id),
      })
    : 0;
  return {
    job,
    leadId,
    booked: Boolean(lead.booked),
    official,
    outreach_id: outreach ? String(outreach._id) : null,
    state: outreach?.state ?? null,
    closed_reason: outreach?.closed_reason ?? null,
    closure_origin: outreach?.closure_origin ?? null,
    first_action_due_at: outreach?.first_action_due_at?.toISOString() ?? null,
    primary_number: Boolean(outreach?.primary_contact_number_id),
    open_followups: openFollowups,
    ensure_job: null as string | null,
    ensure_status: null as string | null,
    refresh_jobs: refreshJobs,
  };
}

async function ensureOne(job: string, leadId: string) {
  const before = await snapshot(job, leadId);
  if (before.official !== "booked" && before.official !== "cancelled") {
    throw new Error(`${job}: official closure is ${before.official}; refusing ensure`);
  }
  if (before.state && before.state !== "closed") {
    throw new Error(`${job}: existing Outreach state ${before.state}; refusing ensure`);
  }
  if (before.open_followups > 0) {
    throw new Error(`${job}: existing open followups; refusing ensure`);
  }
  const queued = await withTransaction(async (session) =>
    enqueueCsiJob(
      {
        stage: "outreach_ensure",
        subject_key: `outreach-lead:CallLead:${leadId}`,
        dedupe_key: `csi:named-subject:outreach-lead:CallLead:${leadId}`,
        input_revision: 1,
        input_refs: [leadId],
      },
      session,
    ),
  );
  const result = await runOutreachEnsureJob(String(queued._id));
  const after = await snapshot(job, leadId);
  after.ensure_job = String(queued._id);
  after.ensure_status = result.status;
  if (after.state !== "closed" || after.closed_reason !== before.official || after.closure_origin !== "official") {
    throw new Error(`${job}: expected official ${before.official} close, got ${after.state}/${after.closed_reason}/${after.closure_origin}`);
  }
  if (after.first_action_due_at || after.open_followups > 0) {
    throw new Error(`${job}: historical obligation leaked`);
  }
  return { before: redacted(before), after: redacted(after) };
}

async function main() {
  if (!process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID?.trim()) {
    throw new Error("SALES_INTELLIGENCE_DEPLOYMENT_ID is required");
  }
  await connectMongo();
  const results = [];
  for (const subject of SUBJECTS) results.push(await ensureOne(subject.job, subject.leadId));
  console.log(JSON.stringify({ ok: true, database: "vantagemovers", results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "named-subject ensure failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
