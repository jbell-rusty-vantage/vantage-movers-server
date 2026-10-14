/** Deliberate reviewed expansion. Report is default; apply requires the exact fresh file and cohort hashes. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import { contentHash, expansionCohorts, keyOf, PILOT_MAX_AGE_MS, type CandidatePin } from "./manifest";

const MAX_REVIEWED_EXPANSION = 601;
const names = ["pilot_ready", "assigned_other_review", "unassigned_review"] as const;
type Cohort = typeof names[number];
export type ExpansionManifest = {
  contract: "pool-reviewed-expansion-v1"; database: string; captured_at: string; expires_at: string;
  configuration_revision: number; configuration_hash: string; candidates: CandidatePin[];
  cohort_hashes: Partial<Record<Cohort, string>>; cohort_counts: Partial<Record<Cohort, number>>; review_hash: string; writes: 0;
};
const chunks = <T>(rows: readonly T[], count = 20) => Array.from({ length: Math.ceil(rows.length / count) }, (_, i) => rows.slice(i * count, i * count + count));
const summary = (manifest: ExpansionManifest) => ({ ...manifest, candidates: undefined, selected: manifest.candidates.length, private_manifest_hash: contentHash(manifest),
  activation: "not_performed", assignment_rule: "Preserve existing receiver or Unassigned; team shared eligibility does not depend on receiver readiness" });

export function assertExpansionManifest(manifest: ExpansionManifest, database: string, now = Date.now()) {
  if (manifest.contract !== "pool-reviewed-expansion-v1" || manifest.database !== database || manifest.writes !== 0 || manifest.candidates.length < 1 || manifest.candidates.length > MAX_REVIEWED_EXPANSION
    || new Set(manifest.candidates.map(c => keyOf(c.lead))).size !== manifest.candidates.length) throw new Error("Expansion manifest has invalid scope");
  if (!Number.isFinite(+new Date(manifest.captured_at)) || +new Date(manifest.captured_at) > now || +new Date(manifest.expires_at) <= now
    || +new Date(manifest.expires_at) - +new Date(manifest.captured_at) !== PILOT_MAX_AGE_MS) throw new Error("Expansion manifest expired; regenerate and review");
  const cohorts = expansionCohorts(manifest.candidates);
  if (cohorts.held.length) throw new Error("Expansion manifest contains domain-held Leads");
  for (const name of names) {
    if (cohorts[name].length && (!manifest.cohort_hashes[name] || manifest.cohort_hashes[name] !== contentHash(cohorts[name]) || manifest.cohort_counts[name] !== cohorts[name].length)) throw new Error("Expansion cohort hash/count differs from reviewed scope");
  }
}

async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  if (args.some(a => a !== "--apply" && !/^--(target|review|review-hash|cohorts|pilot-hash|assigned-other-hash|unassigned-hash|manifest|manifest-hash|private-out|summary-out|approval-ref)=/.test(a))) throw new Error("Unknown expansion option; schema drift overrides are not allowed");
  const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), approvalRef = option("approval-ref");
  if (!target || !approvalRef) throw new Error("Require --target and --approval-ref");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime.js");
  const { connectMongo } = await import("../../src/db.js");
  const { inspectPilot } = await import("./inspect.js");
  const { createConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { activatePoolCandidate } = await import("../../src/services/salesOutreach/pool/admission.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { appendCsiAudit, executeCsiCommand } = await import("../../src/services/salesIntelligence/transactions.js");
  const { assertProductionWriterMatchesDeployment } = await import("../lib/production-writer-guard.js");
  if (getMongoDatabaseName() !== target) throw new Error("Named target differs from resolved database");
  await connectMongo();
  const assertBounded = (manifest: ExpansionManifest) => assertExpansionManifest(manifest, target);
  const priorPilot = await mongoose.connection.useDb(target, { useCache: true }).db!.collection("sales_intelligence_command_executions").findOne({ command: "sod.pool.pilot.activate.v1", "response.count": { $gte: 1 } }, { projection: { _id: 1 } });
  if (!priorPilot) throw new Error("Expansion requires a committed selected-ID pilot before preparation or apply");
  if (!option("manifest")) {
    if (apply) throw new Error("Expansion apply requires a separately generated fresh --manifest and hash");
    const file = option("review"), expectedReviewHash = option("review-hash"), privateOut = option("private-out"), summaryOut = option("summary-out");
    const requested = option("cohorts")?.split(",") as Cohort[] | undefined;
    if (!file || !expectedReviewHash || !privateOut || !summaryOut || !requested?.length || new Set(requested).size !== requested.length || requested.some(c => !names.includes(c))) throw new Error("Require reviewed inventory hash, explicit cohorts, private output and summary output");
    execFileSync("git", ["check-ignore", "--quiet", "--", resolve(privateOut)], { stdio: "ignore" });
    const review = JSON.parse(await readFile(file, "utf8"));
    if (review.contract !== "pool-expansion-review-v1" || review.database !== target || contentHash(review) !== expectedReviewHash) throw new Error("Reviewed inventory file/hash does not match");
    const grouped = expansionCohorts(review.candidates);
    const reviewedHashes: Record<Cohort, string | undefined> = { pilot_ready: option("pilot-hash"), assigned_other_review: option("assigned-other-hash"), unassigned_review: option("unassigned-hash") };
    for (const cohort of requested) if (contentHash(grouped[cohort]) !== reviewedHashes[cohort]) throw new Error("Reviewed cohort hash does not match");
    const reviewed = requested.flatMap(name => grouped[name]).sort((a, b) => keyOf(a.lead).localeCompare(keyOf(b.lead)));
    if (!reviewed.length || reviewed.length > MAX_REVIEWED_EXPANSION) throw new Error("Expansion exceeds approved 601-Lead maximum");
    const captured = new Date(), current = await createConfigurationLoader().requireActive();
    if (!current.value.pool?.enabled || current.value.pool.admission_enabled) throw new Error("Expansion requires enabled Pool and automatic admission disabled");
    const candidates: CandidatePin[] = [];
    for (const batch of chunks(reviewed)) {
      const fresh = await inspectPilot(batch.map(c => c.lead), target);
      if (fresh.configuration_revision !== current.revision || fresh.configuration_hash !== current.content_hash || expansionCohorts(fresh.candidates).held.length) throw new Error("Expansion eligibility or configuration changed during fresh report");
      candidates.push(...fresh.candidates);
    }
    candidates.sort((a, b) => keyOf(a.lead).localeCompare(keyOf(b.lead)));
    const freshGroups = expansionCohorts(candidates), cohortHashes: Partial<Record<Cohort, string>> = {}, cohortCounts: Partial<Record<Cohort, number>> = {};
    for (const name of requested) {
      if (contentHash(freshGroups[name].map(c => keyOf(c.lead)).sort()) !== contentHash(grouped[name].map(c => keyOf(c.lead)).sort())) throw new Error("Expansion cohort membership changed; regenerate inventory before review");
      cohortHashes[name] = contentHash(freshGroups[name]); cohortCounts[name] = freshGroups[name].length;
    }
    const manifest: ExpansionManifest = { contract: "pool-reviewed-expansion-v1", database: target, captured_at: captured.toISOString(), expires_at: new Date(+captured + PILOT_MAX_AGE_MS).toISOString(),
      configuration_revision: current.revision, configuration_hash: current.content_hash, candidates, cohort_hashes: cohortHashes, cohort_counts: cohortCounts, review_hash: expectedReviewHash, writes: 0 };
    assertBounded(manifest);
    await mkdir(dirname(resolve(privateOut)), { recursive: true }); await writeFile(privateOut, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await mkdir(dirname(resolve(summaryOut)), { recursive: true }); await writeFile(summaryOut, JSON.stringify(summary(manifest), null, 2));
    console.log(JSON.stringify(summary(manifest), null, 2)); return;
  }
  const manifest = JSON.parse(await readFile(option("manifest")!, "utf8")) as ExpansionManifest, expectedHash = option("manifest-hash");
  if (!expectedHash || contentHash(manifest) !== expectedHash) throw new Error("Fresh expansion manifest hash does not match reviewed file");
  assertBounded(manifest);
  if (apply) await assertProductionWriterMatchesDeployment({ argv: [] });
  let applied = 0, replayed = 0;
  for (const [index, batch] of chunks(manifest.candidates).entries()) {
    const inspect = async (session?: mongoose.ClientSession) => {
      assertBounded(manifest);
      const fresh = await inspectPilot(batch.map(c => c.lead), target, new Date(), session ?? null);
      if (fresh.configuration_revision !== manifest.configuration_revision || fresh.configuration_hash !== manifest.configuration_hash || contentHash(fresh.candidates) !== contentHash(batch)) throw new Error("Expansion batch pins changed; stop and regenerate review");
      return createConfigurationLoader().requireActive(session);
    };
    if (!apply) { await inspect(); continue; }
    const result = await executeCsiCommand({ actor: csiOperatorActor("pool-reviewed-expansion"), command: "sod.pool.reviewed_expansion.v1", idempotency_key: `pool-expand:${expectedHash}:${index}`,
      payload: { manifest_hash: expectedHash, batch_index: index, cohort_hashes: manifest.cohort_hashes, approval_ref: approvalRef }, operation: async context => {
        const configuration = await inspect(context.session);
        if (!configuration.value.pool?.enabled || configuration.value.pool.admission_enabled) throw new Error("Expansion requires enabled Pool and automatic admission disabled");
        for (const pin of batch) {
          const result = await activatePoolCandidate({ ref: pin.lead, expected_domain_revision: pin.lead_revision, expected_observation_id: pin.accepted_observation_id!,
            expected_record_link_id: pin.link_id!, expected_record_link_revision: pin.link_revision!, expected_source_company_id: pin.source_company_id!, expected_source_granularity_id: pin.source_granularity_id!, approval_ref: approvalRef }, configuration, context.now, context.session);
          await appendCsiAudit(context, { subject_key: `outreach-subject:${result.subject_id}`, event_kind: "pool_reviewed_expansion_activated", prior: { manifest_hash: expectedHash },
            current: { lead: pin.lead, outcome: result.outcome, approval_ref: approvalRef }, target_id: result.subject_id, revision: pin.lead_revision, kind: "outreach" });
        }
        return { count: batch.length, batch_index: index, manifest_hash: expectedHash, activated_at: context.now.toISOString() };
      } });
    applied += result.response.count; replayed += Number(result.replayed);
    console.log(JSON.stringify({ mode: "apply", batch: index, count: result.response.count, replayed: result.replayed, manifest_hash: expectedHash }));
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", selected: manifest.candidates.length, applied, replayed_batches: replayed, manifest_hash: expectedHash, no_customer_contact: true }));
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error && /^(Require|Unknown|Named|Expansion|Reviewed|Fresh)/.test(error.message) ? error.message : "Reviewed expansion refused or failed; private details suppressed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
