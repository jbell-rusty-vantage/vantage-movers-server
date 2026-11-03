import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { connectMongo, withTransaction } from "../src/db";
import { inspectPoolCandidates } from "../src/services/salesOutreach/pool/admission";
import { getSalesOutreachPoolWorkModel } from "../src/models/salesOutreach";
async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const work = await getSalesOutreachPoolWorkModel()
    .find({ active: true })
    .select("lead_model lead_id")
    .sort({ _id: 1 })
    .lean();
  let checked = 0,
    eligible = 0,
    mismatches = 0;
  for (let i = 0; i < work.length; i += 64) {
    const refs = work
      .slice(i, i + 64)
      .map((w) => ({ model: w.lead_model, id: String(w.lead_id) }));
    const result = await withTransaction(async (session) => {
      const current = await inspectPoolCandidates(refs, session, "current"),
        historical = await inspectPoolCandidates(refs, session, "history");
      return {
        eligible: current.filter((c) => c.eligible).length,
        mismatches: current.filter(
          (c, j) => !isDeepStrictEqual(c, historical[j]),
        ).length,
      };
    });
    checked += refs.length;
    eligible += result.eligible;
    mismatches += result.mismatches;
  }
  console.log(
    JSON.stringify({ at: new Date(), checked, eligible, mismatches }),
  );
  if (mismatches) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e.name, e.code ?? "comparison_failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
