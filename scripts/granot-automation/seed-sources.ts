import mongoose from "mongoose";
import {
  DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS,
  seedGranotAutomationSources,
} from "../../src/services/granotHttpCollector/sourceCatalog";

async function main() {
  const inserted = await seedGranotAutomationSources();
  console.log(
    `Granot automation source catalog is ready: ${DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS.length} defaults, ${inserted} inserted.`,
  );
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Failed to seed Granot automation sources", error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
