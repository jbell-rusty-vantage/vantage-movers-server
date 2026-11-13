import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { assertSitePreviewEnvironment } from "../../src/config/sitePreview";
import { installCatalog } from "../../src/services/sitePreviewCms/store";

async function main() {
  assertSitePreviewEnvironment(process.env);
  const filename = process.argv[2];
  if (!filename) throw new Error("Pass the exact reviewed catalog JSON path.");
  const flags = process.argv.slice(3);
  if (flags.some(flag => flag !== "--allow-append")) throw new Error("Only --allow-append is supported after the catalog path.");
  const result = await installCatalog(JSON.parse(await readFile(filename, "utf8")), { allowAppend: flags.includes("--allow-append") });
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Catalog installation failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
