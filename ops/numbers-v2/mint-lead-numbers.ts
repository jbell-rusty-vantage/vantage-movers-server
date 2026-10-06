/**
 * Outreach lifecycle repair C2b: give every Lead's phone a Contact Number (one-off backfill).
 *
 *   pnpm numbers:mint-lead-numbers --target=<database>                         # dry run (default): reads only
 *   pnpm numbers:mint-lead-numbers --target=<database> --apply                 # mints, links, wakes the desk
 *   pnpm numbers:mint-lead-numbers --target=<database> --scope=all [--apply]   # every Call Lead, not only desk Leads
 *
 * A Contact Number used to exist only when capture saw a settled call or a Form Lead minted it, so a Call
 * Lead whose phone had not called or been called since capture began has none: no lead link, desk subject
 * `contact_number_ids: []`, SMS never associated. The `lead_link` job now mints a Lead's number on every
 * Lead change (`numberActivity/leadContactNumber.ts`); this script covers the Leads that exist already.
 *
 * - `--scope=desk` (default): the Leads (Form and Call) of every non-closed desk subject. `--scope=all`:
 *   every Call Lead. Form Leads outside the desk were backfilled by the Form Lead Numbers rollout.
 * - Per Lead, the rules of `ensureLeadContactNumber`: Duplicates, Bad Leads, phones that form no E.164 and
 *   our own DIDs are skipped; a phone that already has a number is reused untouched (nothing written).
 * - `--apply` passes the production-writer guard, then per Lead one transaction: mint the number
 *   (`created_via: call_lead | form_lead`, audited `contact_number_created_from_lead`), then
 *   `recomputeLeadLink` for each of the Lead's numbers (`numbersForLead`). The recompute writes the link
 *   and, in the same transaction, the desk wake (`outreach_lead_change` for the subject whose Lead entered
 *   the link, `outreach_contact_change` for the number's calls and SMS) when the desk wants contact
 *   evidence; the minute crons drain both. A failed Lead is counted and the run continues.
 * - Idempotent: a rerun finds the numbers and unchanged links and writes nothing.
 * - Prints one JSON summary (counts only: no phone, name or Lead id).
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo, withTransaction } from "../../src/db";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "../../src/services/numberActivity/directory";
import { ensureLeadContactNumber } from "../../src/services/numberActivity/leadContactNumber";
import { LEAD_LINK_PROJECTION, numbersForLead, recomputeLeadLink, type LeadModel, type LeadRow } from "../../src/services/numberActivity/leadLink";
import { deskWantsContactEvidence } from "../../src/services/salesOutreach/capture/contactChangeWake";
import { movedLeads } from "../../src/services/salesOutreach/capture/leadLinkWake";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { decideLeadMint, emptyMintTally, mintSourceOf, parseMintArgs, tallyMint, type MintArgs, type MintTally } from "../lib/numbers-mint-lead-numbers";

const LEAD_COLLECTION: Record<LeadModel, string> = { FormLead: "form_leads", CallLead: "call_leads" };
/** Leads read per page (and the `$in` batch of E.164s checked against `contact_numbers`). */
const PAGE = 500;

type Db = NonNullable<mongoose.Connection["db"]>;
type Candidate = { model: LeadModel; row: LeadRow; e164: string };

/** One page of Lead rows → the decisions, folding each into the tally; returns the Leads that need a number. */
async function decidePage(db: Db, model: LeadModel, rows: readonly LeadRow[], planned: Set<string>, directory: DirectoryLookup | null,
  tally: MintTally): Promise<Candidate[]> {
  const e164s = rows.flatMap((row) => {
    const decision = decideLeadMint(model, row, new Set(), new Set(), null);
    return decision.kind === "skip" ? [] : [decision.e164];
  });
  const existing = new Set((await db.collection("contact_numbers").find({ e164: { $in: [...new Set(e164s)] } }, { projection: { e164: 1 } }).toArray())
    .map((number) => String(number.e164)));
  const out: Candidate[] = [];
  for (const row of rows) {
    const decision = decideLeadMint(model, row, existing, planned, directory);
    tallyMint(tally, decision);
    if (decision.kind === "mint") {
      planned.add(decision.e164);
      out.push({ model, row, e164: decision.e164 });
    }
  }
  return out;
}

/** The Leads the scope covers, decided page by page (dry run and apply read the same way). */
async function collect(db: Db, args: MintArgs, directory: DirectoryLookup | null) {
  const tally = emptyMintTally();
  const planned = new Set<string>();
  const candidates: Candidate[] = [];
  if (args.scope === "desk") {
    const subjects = await db.collection("sales_outreach_subjects")
      .find({ status: { $ne: "closed" } }, { projection: { lead_model: 1, lead_id: 1 } }).sort({ _id: 1 }).toArray();
    for (const model of ["FormLead", "CallLead"] as const) {
      const ids = subjects.filter((s) => s.lead_model === model).map((s) => s.lead_id);
      for (let i = 0; i < ids.length; i += PAGE) {
        const rows = (await db.collection(LEAD_COLLECTION[model]).find({ _id: { $in: ids.slice(i, i + PAGE) } }, { projection: LEAD_LINK_PROJECTION })
          .sort({ _id: 1 }).toArray()) as unknown as LeadRow[];
        candidates.push(...await decidePage(db, model, rows, planned, directory, tally));
      }
    }
    return { tally, candidates, subjects_checked: subjects.length };
  }
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const rows = (await db.collection(LEAD_COLLECTION.CallLead)
      .find({ duplicate: { $ne: true }, ...(after ? { _id: { $gt: after } } : {}) }, { projection: LEAD_LINK_PROJECTION })
      .sort({ _id: 1 }).limit(PAGE).toArray()) as unknown as LeadRow[];
    if (!rows.length) break;
    after = rows.at(-1)!._id as mongoose.Types.ObjectId;
    candidates.push(...await decidePage(db, "CallLead", rows, planned, directory, tally));
    if (rows.length < PAGE) break;
  }
  return { tally, candidates, subjects_checked: null };
}

export async function runMintLeadNumbers(argv: readonly string[], log: (line: string) => void = console.log) {
  const args = parseMintArgs(argv);
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const db = mongoose.connection.useDb(args.target, { useCache: true }).db;
  if (!db) throw new Error("database handle unavailable");
  const account = configuredRingCentralAccountId();
  const directory = account ? await loadDirectoryLookup(account) : null;

  const before = await collect(db, args, directory);
  const selected = args.limit === null ? before.candidates : before.candidates.slice(0, args.limit);
  const summary: Record<string, unknown> = {
    mode: args.apply ? "apply" : "dry_run", database: args.target, scope: args.scope, limit: args.limit,
    directory_loaded: Boolean(directory && !directory.isEmpty), subjects_checked: before.subjects_checked,
    ...before.tally, to_mint_by_model: { FormLead: before.candidates.filter((c) => c.model === "FormLead").length,
      CallLead: before.candidates.filter((c) => c.model === "CallLead").length },
  };
  if (!args.apply) {
    log(JSON.stringify(summary, null, 2));
    return summary;
  }

  await assertProductionWriterMatchesDeployment();
  const runId = `mint-lead-numbers-${new Date().toISOString()}`;
  const actor = csiOperatorActor(runId);
  const applied = { numbers_created: 0, numbers_reused: 0, skipped: 0, links_changed: 0, desk_subjects_nominated: 0, failures: {} as Record<string, number> };
  const wakeLeads: Array<{ model: string; id: string }> = [];
  for (const candidate of selected) {
    const id = String(candidate.row._id);
    try {
      const { result, changes } = await withTransaction(async (session) => {
        const now = new Date();
        const minted = await ensureLeadContactNumber(candidate.model, mintSourceOf(candidate.row), session, runId, now, { force: true, directory, actor });
        const linked = [];
        for (const numberId of await numbersForLead({ model: candidate.model, id }, candidate.row, session)) {
          const change = await recomputeLeadLink(numberId, session, { now });
          if (change?.changed) linked.push(change);
        }
        return { result: minted, changes: linked };
      });
      if (result.action === "created") applied.numbers_created += 1;
      else if (result.action === "reused") applied.numbers_reused += 1;
      else applied.skipped += 1;
      applied.links_changed += changes.length;
      for (const change of changes) wakeLeads.push(...movedLeads(change));
    } catch (error) {
      const code = error instanceof Error ? (error as { code?: unknown }).code ?? error.name : "Error";
      applied.failures[String(code)] = (applied.failures[String(code)] ?? 0) + 1;
    }
  }
  // The desk wake ran inside each recompute; report how many desk subjects it nominated (the jobs are idempotent).
  const wanted = await deskWantsContactEvidence();
  if (wanted && wakeLeads.length) {
    const unique = [...new Map(wakeLeads.map((lead) => [`${lead.model}:${lead.id}`, lead])).values()]
      .filter((lead) => mongoose.isValidObjectId(lead.id));
    for (let i = 0; i < unique.length; i += PAGE)
      applied.desk_subjects_nominated += await db.collection("sales_outreach_subjects").countDocuments({
        $or: unique.slice(i, i + PAGE).map((lead) => ({ lead_model: lead.model, lead_id: new mongoose.Types.ObjectId(lead.id) })) });
  }
  const after = await collect(db, args, directory);
  Object.assign(summary, { run_id: runId, desk_wants_contact_evidence: wanted, applied,
    after: { numbers_to_create: after.tally.numbers_to_create, numbers_reused: after.tally.numbers_reused, skipped: after.tally.skipped } });
  if (Object.keys(applied.failures).length) process.exitCode = 1;
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("ops/numbers-v2/mint-lead-numbers.ts")) {
  runMintLeadNumbers(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "mint-lead-numbers failed");
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
