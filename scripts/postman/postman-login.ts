import { spawnSync } from "node:child_process";

function main(): void {
  const apiKey = process.env.POSTMAN_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "Missing POSTMAN_API_KEY. Add it to .env or export it before running this script.",
    );
    process.exit(1);
  }

  const region = process.env.POSTMAN_REGION?.trim();
  const args = ["login", "--with-api-key", apiKey];
  if (region) {
    args.push("--region", region);
  }

  const result = spawnSync("postman", args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(
        "postman CLI not found on PATH. Install it globally, for example: npm install -g postman-cli",
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
