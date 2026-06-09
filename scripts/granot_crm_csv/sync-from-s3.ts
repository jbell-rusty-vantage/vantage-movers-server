import { connectMongo } from "../../api/db";
import {
  runGranotCrmCsvSync,
  type GranotCrmCsvSyncOptions,
} from "../../api/services/granotCrmCsv/sync.service";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await connectMongo();
  const result = await runGranotCrmCsvSync(options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        run_id: result.run_id,
        mode: result.mode,
        counts: result.counts,
        outcomes: result.outcomes,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): GranotCrmCsvSyncOptions {
  const options: GranotCrmCsvSyncOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--workspace" && next) {
      options.workspace = next;
      index += 1;
      continue;
    }
    if (arg === "--csv-kind" && (next === "follow_up" || next === "booked")) {
      options.csvKind = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.trunc(parsed);
      }
      index += 1;
      continue;
    }
  }
  return options;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
