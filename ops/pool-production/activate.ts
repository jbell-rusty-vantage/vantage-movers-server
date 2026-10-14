/** Exact selected-ID pilot only. Default is a fresh dry run; all writes use canonical transaction services. */
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { assertFreshManifest, contentHash, publicSummary, type PilotManifest } from "./manifest";

async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  if (args.some(a => a !== "--apply" && !/^--(target|manifest|manifest-hash|approval-ref)=/.test(a))) throw new Error("Unknown pilot option; schema drift overrides are not allowed");
  const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), file = option("manifest"), expectedHash = option("manifest-hash"), approvalRef = option("approval-ref");
  if (!target || !file || !expectedHash || !approvalRef) throw new Error("Require --target, --manifest, --manifest-hash and --approval-ref");
  const manifest = JSON.parse(await readFile(file, "utf8")) as PilotManifest;
  if (contentHash(manifest) !== expectedHash) throw new Error("Private manifest hash differs from reviewed artifact");
  assertFreshManifest(manifest, target);
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
  const refs = manifest.candidates.map(c => c.lead);
  const compare = (fresh: PilotManifest) => {
    assertFreshManifest(manifest, target);
    if (!fresh.ready || fresh.selection_hash !== manifest.selection_hash || fresh.configuration_revision !== manifest.configuration_revision || fresh.configuration_hash !== manifest.configuration_hash) throw new Error("Pilot pins or configuration changed; regenerate and review the manifest");
  };
  if (!apply) {
    compare(await inspectPilot(refs, target));
    console.log(JSON.stringify({ mode: "dry_run", ...publicSummary(manifest), apply_performed: false }, null, 2)); return;
  }
  await assertProductionWriterMatchesDeployment({ argv: [] });
  const committed = await executeCsiCommand({ actor: csiOperatorActor("pool-production-pilot"), command: "sod.pool.pilot.activate.v1",
    idempotency_key: `pool-pilot:${expectedHash}`, payload: { manifest_hash: expectedHash, approval_ref: approvalRef },
    operation: async context => {
      const fresh = await inspectPilot(refs, target, context.now, context.session); compare(fresh);
      const configuration = await createConfigurationLoader().requireActive(context.session);
      if (!configuration.value.pool?.enabled || configuration.value.pool.admission_enabled) throw new Error("Pilot requires Pool enabled and automatic admission disabled");
      const results = [];
      for (const pin of manifest.candidates) {
        const result = await activatePoolCandidate({ ref: pin.lead, expected_domain_revision: pin.lead_revision,
          expected_observation_id: pin.accepted_observation_id!, expected_record_link_id: pin.link_id!, expected_record_link_revision: pin.link_revision!,
          expected_source_company_id: pin.source_company_id!, expected_source_granularity_id: pin.source_granularity_id!, approval_ref: approvalRef }, configuration, context.now, context.session);
        await appendCsiAudit(context, { subject_key: `outreach-subject:${result.subject_id}`, event_kind: "pool_pilot_activated", prior: { manifest_hash: expectedHash },
          current: { lead: pin.lead, outcome: result.outcome, approval_ref: approvalRef }, target_id: result.subject_id, revision: pin.lead_revision, kind: "outreach" });
        results.push(result);
      }
      return { selection_hash: manifest.selection_hash, manifest_hash: expectedHash, activated_at: context.now.toISOString(), count: results.length, results };
    } });
  console.log(JSON.stringify({ mode: "apply", replayed: committed.replayed, count: committed.response.count, selection_hash: committed.response.selection_hash,
    activated_at: committed.response.activated_at, no_customer_contact: true }, null, 2));
}
main().catch(error => { console.error(error instanceof Error && /^(Require|Unknown|Private|Manifest|Named|Pilot)/.test(error.message) ? error.message : "Pool pilot refused or failed; inspect canonical audit/ledger without printing private details"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
