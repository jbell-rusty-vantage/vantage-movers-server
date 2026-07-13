/**
 * @deprecated Use `pnpm run db:ingest-moving-carriers` (`scripts/ingest-moving-carriers.ts`).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectMongo } from "../../api/db";
import { importMovingCarriersFromCsv } from "../../api/services/movingCarriers";

const DEFAULT_CSV_PATH = path.resolve(
  process.cwd(),
  "..",
  "carrier_data",
  "Carrier List - Active Carriers List.csv",
);

async function seedMovingCarriers() {
  await connectMongo();
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV_PATH;
  const csvText = await readFile(csvPath, "utf8");
  const result = await importMovingCarriersFromCsv({
    csv_text: csvText,
    mode: "replace",
  });

  console.log(
    [
      `Seeded moving carriers from ${csvPath}`,
      `created=${result.created}`,
      `updated=${result.updated}`,
      `deactivated=${result.deactivated}`,
      `skipped=${result.skipped}`,
    ].join(" "),
  );
}

seedMovingCarriers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to seed moving carriers", error);
    process.exit(1);
  });
