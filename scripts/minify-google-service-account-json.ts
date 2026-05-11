import fs from "node:fs";
import path from "node:path";

/** Matches default key file used when env credentials are unset (see googleSheets.service.ts). */
const DEFAULT_INPUT = "just-cosmos-437222-b7-f8ab65674d85.json";
const DEFAULT_OUTPUT = "google-service-account.one-line.json";

function main(): void {
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, process.argv[2] ?? DEFAULT_INPUT);
  const outputPath = path.resolve(cwd, process.argv[3] ?? DEFAULT_OUTPUT);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error(
      "Usage: pnpm run sheets:minify-service-account [input.json] [output.json]",
    );
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8")) as Record<string, unknown>;
  const oneLine = JSON.stringify(parsed);
  fs.writeFileSync(outputPath, `${oneLine}\n`, "utf8");
  console.log(
    `Wrote ${outputPath} (${oneLine.length} chars). Paste into GOOGLE_SERVICE_ACCOUNT_JSON or encode for BASE64.`,
  );
}

main();
