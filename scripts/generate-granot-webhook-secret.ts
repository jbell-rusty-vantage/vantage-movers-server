import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const outputPath = path.resolve(process.cwd(), ".env.granot-webhook.local");
  const secret = randomBytes(48).toString("base64url");

  try {
    await writeFile(outputPath, `GRANOT_WEBHOOK_SECRET=${secret}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Created ${outputPath}. The secret was not printed.`);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(`${outputPath} already exists; refusing to overwrite it.`);
    }
    throw error;
  }
}

void main();
