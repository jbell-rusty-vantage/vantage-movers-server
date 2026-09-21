/**
 * Read-only timing for two Attention publish pages, plus prompt versions on
 * runs completed during the owner demo. No phones, names, or transcripts.
 *
 *   pnpm exec tsx --env-file=.env scripts/time-csi-attention-pages.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";
import { deriveOutreachFacts, loadOutreachInputsBatch, loadOutreachSideData, toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";

async function main() {
  await connectMongo();
  const since = new Date("2026-09-21T19:30:00.000Z");
  const versions = await getIntelligenceRunModel().aggregate<{ _id: { version: string | null; status: string; mode: string }; count: number }>([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { version: "$prompt_version", status: "$status", mode: "$mode" }, count: { $sum: 1 } } },
  ]);
  console.log(JSON.stringify({
    prompt_versions: versions.map((row) => ({ ...row._id, count: row.count })),
  }));

  const now = new Date();
  const [policy, coverage] = await Promise.all([resolvePolicy(), readCaptureCoverage()]);
  let after: string | undefined;
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const started = Date.now();
    const page = await getOutreachRecordModel().find({ purged_at: null, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(50).lean();
    const inputs = await loadOutreachInputsBatch(page, now);
    const desk = page.filter((record) => {
      const bundle = inputs.get(String(record._id));
      if (!bundle) return false;
      const facts = deriveOutreachFacts(record, bundle, { now, policy, coverage });
      return Boolean(facts.attention_band || facts.review_badges.length);
    });
    const sideStarted = Date.now();
    if (desk.length) {
      const side = await loadOutreachSideData(desk, inputs);
      for (const record of desk) {
        const bundle = inputs.get(String(record._id));
        if (bundle) await toOutreachDto(record, now, coverage, { policy, inputs: bundle, side });
      }
    }
    pages.push({ i, records: page.length, desk: desk.length, ms: Date.now() - started, dto_ms: Date.now() - sideStarted });
    if (page.length < 50) break;
    after = String(page.at(-1)!._id);
  }
  const total = await getOutreachRecordModel().countDocuments({ purged_at: null });
  console.log(JSON.stringify({ outreach_records: total, pages }));
}

main().then(() => mongoose.disconnect()).catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
