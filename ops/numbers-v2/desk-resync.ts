/**
 * All Numbers phase B switch for the Sales Outreach Desk (all-numbers CONTRACT §3 "Outreach Desk",
 * §5 phase B). Run once right after phase B deploys, before or after `cleanup.ts`.
 *
 *   node --env-file=.env --import tsx ops/numbers-v2/desk-resync.ts --target=<database>            # dry run (default): reads only
 *   node --env-file=.env --import tsx ops/numbers-v2/desk-resync.ts --target=<database> --apply    # enqueues desk jobs
 *   node --env-file=.env --import tsx ops/numbers-v2/desk-resync.ts --target=<database> --all-open [--apply]
 *
 * The phase A migration wrote every number's lead link while the desk still read the attachments, so
 * nothing woke the desk: a lead-link change only wakes it from phase B code (`capture/leadLinkWake.ts`).
 * Until each Lead changes again, a desk subject keeps its attachment-era `contact_number_ids` and a
 * contact event keeps its attachment-era association (`ambiguous` for a number with several attached
 * Leads, `none` for one with none). This script nominates the existing desk jobs for exactly that drift:
 *   1. every non-closed subject whose stored `contact_number_ids` differ from the numbers whose `lead`
 *      or `other_leads` hold its Lead gets an `outreach_lead_change` job (the job re-reads the Lead and
 *      the links);
 *   2. every call since the earliest subject activation whose contact event does not credit the
 *      subject of its number's current Lead (or credits one when it should not) gets an
 *      `outreach_contact_change` job (the consumer re-derives it and recounts the rep-day).
 * The minute crons drain both stages (`sales-outreach-lead-changes`, `sales-outreach-contact-events`).
 * Calls with no contact event yet are left to the contact sweep. Nothing is enqueued unless the
 * persisted desk configuration wants contact evidence.
 *
 * Idempotent: the job identities carry the fixed tag `numbers-v2-switch`, so a rerun enqueues nothing
 * new, and once the jobs ran no drift is left to nominate. Production applies pass the
 * production-writer guard. Prints one JSON summary.
 *
 * `--all-open` (outreach lifecycle repair C2c, LANE-C §C2 migration): step 1 nominates every non-closed
 * subject, drifted or not, so a changed subject rule (`cadence.no_contact_number_rule`) is recomputed
 * for every open subject without waiting for its Lead to change. Those jobs carry the tag
 * `lane-c-review-rule-r<active configuration revision>`: a rerun under the same revision enqueues
 * nothing new, and a later PATCH (turning the rule off again) gets fresh identities. Step 2 is unchanged.
 */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { deskWantsContactEvidence, enqueueOutreachContactChangeJobs, type ContactChangeSource } from "../../src/services/salesOutreach/capture/contactChangeWake";
import { salesOutreachConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { parseNumbersV2Args } from "../lib/numbers-v2";

export const DESK_RESYNC_TAG = "numbers-v2-switch";
/** olr C2c: `--all-open` lead-change tag, per active configuration revision. */
export const reviewRuleTag = (revision: number) => `lane-c-review-rule-r${revision}`;
const BATCH = 100;
const CALL_PAGE = 1_000;

type Ref = { model: string; id: unknown };
type SubjectRow = { _id: mongoose.Types.ObjectId; lead_model: string; lead_id: mongoose.Types.ObjectId; status: string; contact_number_ids?: unknown[]; enrollment?: { activation_at?: Date } };
type NumberRow = { _id: mongoose.Types.ObjectId; lead?: Ref | null; other_leads?: Ref[] };
const keyOf = (ref: Ref) => `${ref.model}:${String(ref.id)}`;
const sameIds = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

async function inBatches<T>(items: readonly T[], work: (batch: readonly T[], session: mongoose.ClientSession) => Promise<number>): Promise<number> {
  let created = 0;
  for (let i = 0; i < items.length; i += BATCH) created += await withTransaction((session) => work(items.slice(i, i + BATCH), session));
  return created;
}

export async function runDeskResync(argv: readonly string[], log: (line: string) => void = console.log) {
  const allOpen = argv.includes("--all-open");
  const args = parseNumbersV2Args(argv.filter((arg) => arg !== "--all-open"), { allowed: ["--apply"] });
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const db = mongoose.connection.useDb(args.target, { useCache: true }).db;
  if (!db) throw new Error("database handle unavailable");

  // Every Lead → the numbers whose `lead` or `other_leads` hold it; every number → its current Lead.
  const linked = new Map<string, string[]>();
  const currentLead = new Map<string, string>();
  const numbers = db.collection<NumberRow>("contact_numbers")
    .find({ purged_at: null, $or: [{ lead: { $type: "object" } }, { "other_leads.0": { $exists: true } }] }, { projection: { lead: 1, other_leads: 1 } });
  for await (const number of numbers) {
    if (number.lead) currentLead.set(String(number._id), keyOf(number.lead));
    for (const lead of [...(number.lead ? [number.lead] : []), ...(number.other_leads ?? [])])
      linked.set(keyOf(lead), [...(linked.get(keyOf(lead)) ?? []), String(number._id)]);
  }

  const subjects = (await db.collection("sales_outreach_subjects")
    .find({ status: { $ne: "closed" } }, { projection: { lead_model: 1, lead_id: 1, status: 1, contact_number_ids: 1, enrollment: 1 } })
    .toArray()) as unknown as SubjectRow[];
  const subjectByLead = new Map(subjects.map((s) => [keyOf({ model: s.lead_model, id: s.lead_id }), s]));
  const drifted = subjects.filter((s) => !sameIds(s.contact_number_ids ?? [], linked.get(keyOf({ model: s.lead_model, id: s.lead_id })) ?? []));
  const inspected = allOpen ? await salesOutreachConfigurationLoader.inspect() : null;
  const leadTag = inspected ? (inspected.state === "active" ? reviewRuleTag(inspected.revision) : null) : DESK_RESYNC_TAG;
  const toResync = allOpen ? subjects : drifted;

  // Calls since the earliest activation whose stored event credits a different subject than the number's current Lead.
  const activations = subjects.map((s) => s.enrollment?.activation_at).filter((at): at is Date => at instanceof Date);
  const since = activations.length ? new Date(Math.min(...activations.map(Number))) : null;
  const calls: ContactChangeSource[] = [];
  let callsChecked = 0;
  if (since) {
    let after: mongoose.Types.ObjectId | null = null;
    for (;;) {
      const page = (await db.collection("call_interactions")
        .find({ started_at: { $gte: since }, merged_into_id: null, contact_number_id: { $ne: null }, ...(after ? { _id: { $gt: after } } : {}) },
          { projection: { contact_number_id: 1, started_at: 1 } })
        .sort({ _id: 1 }).limit(CALL_PAGE).toArray()) as unknown as Array<{ _id: mongoose.Types.ObjectId; contact_number_id: unknown; started_at: Date }>;
      if (!page.length) break;
      after = page.at(-1)!._id;
      const events = new Map((await db.collection("sales_outreach_contact_events")
        .find({ source_kind: "call", source_id: { $in: page.map((call) => call._id) } }, { projection: { source_id: 1, subject_id: 1 } })
        .toArray()).map((event) => [String(event.source_id), event.subject_id ? String(event.subject_id) : null]));
      for (const call of page) {
        callsChecked += 1;
        if (!events.has(String(call._id))) continue; // not derived yet: the contact sweep owns it
        const lead = currentLead.get(String(call.contact_number_id));
        const subject = lead ? subjectByLead.get(lead) : undefined;
        const activeAtCall = subject?.enrollment?.activation_at && +subject.enrollment.activation_at <= +call.started_at;
        const expected = subject && activeAtCall ? String(subject._id) : null;
        if (events.get(String(call._id)) !== expected) calls.push({ source_kind: "call", source_id: String(call._id), source_revision: DESK_RESYNC_TAG });
      }
      if (page.length < CALL_PAGE) break;
    }
  }

  const summary: Record<string, unknown> = {
    mode: args.apply ? "apply" : "dry_run", database: args.target, since: since?.toISOString() ?? null,
    subjects_checked: subjects.length, subjects_to_resync: toResync.length, calls_checked: callsChecked, calls_to_rederive: calls.length,
    ...(allOpen ? { all_open: true, subjects_drifted: drifted.length, lead_change_tag: leadTag } : {}),
  };
  if (!args.apply) {
    log(JSON.stringify(summary, null, 2));
    return summary;
  }
  await assertProductionWriterMatchesDeployment();
  if (!leadTag || !(await deskWantsContactEvidence())) {
    summary.applied = { skipped: "desk_configuration_wants_no_contact_evidence" };
    log(JSON.stringify(summary, null, 2));
    return summary;
  }
  const now = new Date();
  const leadJobs = await inBatches(toResync, async (batch, session) => {
    let created = 0;
    for (const subject of batch) {
      const id = String(subject.lead_id);
      const row = await enqueueCsiJob({ stage: "outreach_lead_change", subject_key: `outreach-lead:${subject.lead_model}:${id}`,
        dedupe_key: `sod:lead-change:${subject.lead_model}:${id}:${leadTag}`, input_revision: 1, input_refs: [id] }, session, now);
      if ((row as { createdAt?: Date }).createdAt?.getTime() === now.getTime()) created += 1;
    }
    return created;
  });
  const callJobs = await inBatches(calls, async (batch, session) =>
    (await enqueueOutreachContactChangeJobs(batch, session, now, { wanted: async () => true })).filter((job) => job.created).length);
  summary.applied = { lead_change_jobs_created: leadJobs, contact_change_jobs_created: callJobs };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("ops/numbers-v2/desk-resync.ts")) {
  runDeskResync(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "All Numbers desk resync failed");
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
