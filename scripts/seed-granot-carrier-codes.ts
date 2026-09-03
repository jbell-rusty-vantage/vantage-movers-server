/**
 * Stamp Granot Carrier Codes onto existing moving_carriers by DOT.
 *
 *   pnpm db:seed-granot-carrier-codes
 *   pnpm db:seed-granot-carrier-codes -- --apply
 */
import mongoose from "mongoose";
import { GRANOT_CARRIER_CODE_SEEDS } from "../src/config/domain/granotCarrierCodes";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { connectMongo } from "../src/db";
import { MovingCarrier } from "../src/models/MovingCarrier";
import { planGranotCarrierCodeSeed } from "../src/services/movingCarriers/granotCarrierCodeSeed";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectMongo();

  const carriers = await MovingCarrier.find({})
    .select({ dot_number: 1, granot_carrier_code: 1, name: 1 })
    .lean()
    .exec();
  const plans = planGranotCarrierCodeSeed(carriers, GRANOT_CARRIER_CODE_SEEDS);
  const counts = {
    missing: plans.filter((plan) => plan.outcome === "missing").length,
    already_set: plans.filter((plan) => plan.outcome === "already_set").length,
    will_set: plans.filter((plan) => plan.outcome === "will_set").length,
    will_replace: plans.filter((plan) => plan.outcome === "will_replace").length,
  };

  let updated = 0;
  if (apply) {
    await MovingCarrier.syncIndexes();
    for (const plan of plans) {
      if (plan.outcome !== "will_set" && plan.outcome !== "will_replace") {
        continue;
      }
      const result = await MovingCarrier.updateOne(
        { dot_number: plan.dot_number },
        { $set: { granot_carrier_code: plan.granot_carrier_code } },
      );
      updated += result.modifiedCount;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: apply ? "apply" : "report",
        database: getMongoDatabaseName(),
        counts,
        updated,
        missing: plans.filter((plan) => plan.outcome === "missing"),
        plans,
      },
      null,
      2,
    ),
  );

  if (counts.missing > 0) {
    throw new Error(
      `${counts.missing} Granot Carrier Code seed(s) have no Moving Carrier DOT match`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
