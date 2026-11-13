import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { assertSitePreviewEnvironment } from "../../src/config/sitePreview";
import { installCatalog } from "../../src/services/sitePreviewCms/store";

async function main() {
  assertSitePreviewEnvironment(process.env);
  const filename = process.argv[2];
  if (!filename) throw new Error("Pass the exact reviewed catalog JSON path.");
  const result = await installCatalog(JSON.parse(await readFile(filename, "utf8")));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Catalog installation failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
