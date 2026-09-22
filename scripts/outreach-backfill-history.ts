import { appendFileSync, mkdirSync } from "node:fs";

/** Append-only operational history survives a stopped process or a resumed report. */
export function backfillEvent(event: Record<string, unknown>) {
  mkdirSync("scripts/output/outreach-backfill", { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event });
  appendFileSync("scripts/output/outreach-backfill/history.jsonl", `${line}\n`);
  console.log(line);
}
