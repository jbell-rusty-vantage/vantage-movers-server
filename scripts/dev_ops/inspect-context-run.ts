import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceEffectModel } from "../../src/models/IntelligenceEffect";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
async function main() {
  await connectMongo();
  const run = await getIntelligenceRunModel().findById(process.argv[2]).lean();
  if (!run) throw new Error("no run");
  const out = run.output as { prior_finding_relations?: Array<{ relation: string; note: string | null }>; story_discrepancies?: Array<{ claim: string }>; summary: { overview: string } } | null;
  const effects = await getIntelligenceEffectModel().find({ run_id: run._id }).select("effect_kind status reason").lean();
  const reviews = await getSalesIntelligenceReviewItemModel().find({ subject_key: run.subject_key, cause_kind: { $in: ["prior_fulfilled_unclaimed", "prior_contradiction", "record_disputed_on_call"] } }).select("cause_kind state").lean();
  console.log(JSON.stringify({ status: run.status, prompt_version: run.prompt_version, predecessor_run_id: run.predecessor_run_id, raw_output_retained: run.raw_output != null,
    raw_keys: run.raw_output ? Object.keys(run.raw_output as object) : null, lineage: (run.step_artifacts as { lineage?: unknown })?.lineage,
    relations: out?.prior_finding_relations?.map(r => `${r.relation}${r.note ? `: ${r.note}` : ""}`), discrepancies: out?.story_discrepancies?.map(d => d.claim),
    overview: out?.summary.overview, effects: effects.map(e => `${e.effect_kind}:${e.status}:${e.reason ?? ""}`), reviews: reviews.map(r => `${r.cause_kind}:${r.state}`), cents: run.usage?.actual_cents }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
