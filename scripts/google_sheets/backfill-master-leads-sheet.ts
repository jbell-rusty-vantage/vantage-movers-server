/**
 * Backfill the Master Leads sheet (`Forms` + `Duplicates` tabs) from every
 * FormLead currently in Mongo.
 *
 * Run: pnpm run sheets:backfill-master-leads
 *
 * How it works:
 * - Enumerates all FormLead documents from Mongo (the GET API caps at 200, so
 *   we read the collection directly to get every id).
 * - For each lead, sends an idempotent `PATCH /api/v1/form-leads/:id` to the
 *   production server with the `x-api-secret` header. The PATCH re-runs the
 *   server's sheet-sync for that lead, which—now that the master-only flag is
 *   the default—writes the row to the Master `Forms`/`Duplicates` tab with the
 *   new 20-column layout. Re-running is safe: `Mongo ID` is the row identity,
 *   so existing rows are updated in place instead of duplicated.
 *
 * Why PATCH and not a direct sheet write: the deployed server holds the Google
 * credentials and the live header/projection code, so routing through the API
 * guarantees the backfill matches exactly what new leads produce. The body
 * sends the lead's *current* `quoted` value only — `updateFormLeadSchema`
 * requires at least one field, and `quoted` triggers no zip/state geocoding.
 *
 * Notes / side effects:
 * - The server schedules the sheet write as a background (`waitUntil`) task, so
 *   a 2xx response means "accepted/scheduled", not "row written". Pacing
 *   (`BACKFILL_DELAY_MS`) keeps background sheet writes under the Sheets
 *   per-minute quota. Check the server logs (`sheets.sync.*`) for write results.
 * - The PATCH recomputes `cpl` from config and refreshes any attached booking
 *   chain, bumping `updatedAt`. This is harmless for a backfill.
 *
 * Env:
 * - VANTAGE_API_SECRET   (required) — sent as the `x-api-secret` header.
 * - MONGO_URI            (required) — read by `connectMongo`.
 * - BACKFILL_BASE_URL    (default https://vantage-movers-main-server.vercel.app)
 * - BACKFILL_DELAY_MS    (default 800)  — pause between requests.
 * - BACKFILL_LIMIT       (optional)     — cap leads processed (for testing).
 * - BACKFILL_DRY_RUN     ("true")       — list what would be sent, send nothing.
 * - BACKFILL_REQUEST_TIMEOUT_MS (default 30000) — per-request timeout.
 */

import process from "node:process";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { getMongoDatabaseName } from "../../api/config/domain";
import { FormLead } from "../../api/models/FormLead";

const DEFAULT_BASE_URL = "https://vantage-movers-main-server.vercel.app";

type LeanFormLead = {
  _id: mongoose.Types.ObjectId;
  quoted?: boolean | null;
  duplicate?: boolean | null;
  name?: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.`);
  }
  return value;
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`Ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
}

function isDryRun(): boolean {
  return process.env.BACKFILL_DRY_RUN?.trim().toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function patchFormLead(
  baseUrl: string,
  apiSecret: string,
  lead: LeanFormLead,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/form-leads/${lead._id.toString()}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-api-secret": apiSecret,
        },
        body: JSON.stringify({ quoted: Boolean(lead.quoted) }),
        signal: controller.signal,
      },
    );
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, body: message };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const apiSecret = requiredEnv("VANTAGE_API_SECRET");
  const baseUrl = (process.env.BACKFILL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const delayMs = parsePositiveInt("BACKFILL_DELAY_MS", 800);
  const limit = parsePositiveInt("BACKFILL_LIMIT", 0);
  const timeoutMs = parsePositiveInt("BACKFILL_REQUEST_TIMEOUT_MS", 30000);
  const dryRun = isDryRun();

  await connectMongo();

  const query = FormLead.find(
    {},
    { _id: 1, quoted: 1, duplicate: 1, name: 1 },
  ).sort({ createdAt: 1 });
  if (limit > 0) {
    query.limit(limit);
  }
  const leads = (await query.lean<LeanFormLead[]>().exec()) ?? [];

  const duplicateCount = leads.filter((lead) => Boolean(lead.duplicate)).length;

  console.log("=== Master Leads sheet backfill ===");
  console.log(`Mongo database: ${getMongoDatabaseName()}`);
  console.log(`Target API:     ${baseUrl}`);
  console.log(`Leads to sync:  ${leads.length} (${duplicateCount} duplicates -> Duplicates tab)`);
  console.log(`Delay:          ${delayMs}ms between requests`);
  console.log(`Mode:           ${dryRun ? "DRY RUN (no requests sent)" : "LIVE"}`);
  console.log("");

  let okCount = 0;
  const failures: { id: string; status: number; body: string }[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const id = lead._id.toString();
    const position = `${i + 1}/${leads.length}`;

    if (dryRun) {
      console.log(`[${position}] would PATCH ${id} (quoted=${Boolean(lead.quoted)})`);
      continue;
    }

    const result = await patchFormLead(baseUrl, apiSecret, lead, timeoutMs);
    if (result.ok) {
      okCount += 1;
      console.log(`[${position}] ok ${id} (${result.status})`);
    } else {
      failures.push({ id, status: result.status, body: result.body.slice(0, 300) });
      console.error(`[${position}] FAILED ${id} (${result.status}): ${result.body.slice(0, 300)}`);
    }

    if (delayMs > 0 && i < leads.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Total:     ${leads.length}`);
  if (dryRun) {
    console.log("Dry run complete — no requests were sent.");
  } else {
    console.log(`Succeeded: ${okCount}`);
    console.log(`Failed:    ${failures.length}`);
    if (failures.length > 0) {
      console.log("");
      console.log("Failed lead ids (re-run later to retry):");
      for (const failure of failures) {
        console.log(`  ${failure.id} (${failure.status}) ${failure.body}`);
      }
    }
    console.log("");
    console.log(
      "Note: sheet writes run as background tasks on the server. Check the " +
        "server logs (sheets.sync.*) to confirm rows landed.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.disconnect();
  });
