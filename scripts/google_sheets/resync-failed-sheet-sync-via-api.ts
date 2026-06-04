/**
 * Re-sync leads whose `sheet_sync` entries are `failed` by PATCHing the
 * production API (idempotent no-op bodies). The server schedules background
 * Google Sheets writes on each update.
 *
 * Run (dry-run, lists targets only):
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/resync-failed-sheet-sync-via-api.ts
 *
 * Apply live PATCH requests:
 *   SHEET_SYNC_RESYNC_APPLY=true node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/resync-failed-sheet-sync-via-api.ts
 *
 * Env:
 * - VANTAGE_API_SECRET (required) — sent as `x-api-secret`.
 * - MONGO_URI (required) — read by `connectMongo`.
 * - SHEET_SYNC_RESYNC_BASE_URL (default https://vantage-movers-main-server.vercel.app)
 * - SHEET_SYNC_RESYNC_APPLY ("true") — send requests; otherwise dry-run.
 * - SHEET_SYNC_RESYNC_DELAY_MS (default 1000) — pause between requests (Sheets quota).
 * - SHEET_SYNC_RESYNC_LIMIT (optional) — cap per collection query (0 = no cap).
 * - SHEET_SYNC_RESYNC_REQUEST_TIMEOUT_MS (default 30000)
 * - SHEET_SYNC_RESYNC_INCLUDE_FORM_LEADS ("true"|"false", default true)
 * - SHEET_SYNC_RESYNC_INCLUDE_CALL_LEADS ("true"|"false", default true)
 * - SHEET_SYNC_RESYNC_EXTRA_IDS (optional) — comma-separated Mongo ids to always include
 */

import process from "node:process";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { getMongoDatabaseName } from "../../api/config/domain";
import { CallLead } from "../../api/models/CallLead";
import { FormLead } from "../../api/models/FormLead";

const DEFAULT_BASE_URL = "https://vantage-movers-main-server.vercel.app";

const FAILED_SHEET_SYNC_FILTER = {
  sheet_sync: { $elemMatch: { status: "failed" } },
} as const;

type LeanFormLead = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  duplicate?: boolean | null;
  sheet_sync?: { target: string; status: string; last_error?: string }[];
};

type LeanCallLead = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  source_company?: string | null;
  duplicate?: boolean | null;
  sheet_sync?: { target: string; status: string; last_error?: string }[];
};

type PatchTarget = {
  id: string;
  endpoint: "form-leads" | "call-leads";
  body: Record<string, unknown>;
  note: string;
  name?: string | null;
  failedTargets: string[];
};

type PatchResult = {
  ok: boolean;
  status: number;
  body: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.`);
  }
  return value;
}

function parseNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`Ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function shouldApply(): boolean {
  return process.env.SHEET_SYNC_RESYNC_APPLY?.trim().toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseExtraIds(): mongoose.Types.ObjectId[] {
  const raw = process.env.SHEET_SYNC_RESYNC_EXTRA_IDS?.trim();
  if (!raw) {
    return [];
  }
  const ids: mongoose.Types.ObjectId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!mongoose.isValidObjectId(id)) {
      console.warn(`Skipping invalid SHEET_SYNC_RESYNC_EXTRA_IDS entry: ${id}`);
      continue;
    }
    ids.push(new mongoose.Types.ObjectId(id));
  }
  return ids;
}

function failedSyncTargets(
  sheetSync: LeanFormLead["sheet_sync"] | LeanCallLead["sheet_sync"],
): string[] {
  return (
    sheetSync
      ?.filter((entry) => entry.status === "failed")
      .map((entry) => entry.target) ?? []
  );
}

function formNoopPatch(lead: LeanFormLead): PatchTarget {
  const targets = failedSyncTargets(lead.sheet_sync);
  return {
    id: lead._id.toString(),
    endpoint: "form-leads",
    body: { duplicate: Boolean(lead.duplicate) },
    note: lead.duplicate ? "form duplicate resync" : "form resync",
    name: lead.name,
    failedTargets: targets,
  };
}

function callNoopPatch(lead: LeanCallLead): PatchTarget {
  const targets = failedSyncTargets(lead.sheet_sync);
  return {
    id: lead._id.toString(),
    endpoint: "call-leads",
    body: { source_company: lead.source_company ?? "not_provided" },
    note: lead.duplicate ? "call duplicate resync" : "call resync",
    name: lead.name,
    failedTargets: targets,
  };
}

async function patchLead(
  baseUrl: string,
  apiSecret: string,
  target: PatchTarget,
  timeoutMs: number,
): Promise<PatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/${target.endpoint}/${target.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-api-secret": apiSecret,
        },
        body: JSON.stringify(target.body),
        signal: controller.signal,
      },
    );
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadFailedFormLeads(limit: number): Promise<LeanFormLead[]> {
  let query = FormLead.find(FAILED_SHEET_SYNC_FILTER)
    .select({ _id: 1, name: 1, duplicate: 1, sheet_sync: 1 })
    .sort({ createdAt: 1 });
  if (limit > 0) {
    query = query.limit(limit);
  }
  return query.lean<LeanFormLead[]>().exec();
}

async function loadFailedCallLeads(limit: number): Promise<LeanCallLead[]> {
  let query = CallLead.find(FAILED_SHEET_SYNC_FILTER)
    .select({ _id: 1, name: 1, source_company: 1, duplicate: 1, sheet_sync: 1 })
    .sort({ createdAt: 1 });
  if (limit > 0) {
    query = query.limit(limit);
  }
  return query.lean<LeanCallLead[]>().exec();
}

async function loadExtraLeads(ids: mongoose.Types.ObjectId[]): Promise<{
  forms: LeanFormLead[];
  calls: LeanCallLead[];
}> {
  if (ids.length === 0) {
    return { forms: [], calls: [] };
  }
  const [forms, calls] = await Promise.all([
    FormLead.find({ _id: { $in: ids } })
      .select({ _id: 1, name: 1, duplicate: 1, sheet_sync: 1 })
      .lean<LeanFormLead[]>()
      .exec(),
    CallLead.find({ _id: { $in: ids } })
      .select({ _id: 1, name: 1, source_company: 1, duplicate: 1, sheet_sync: 1 })
      .lean<LeanCallLead[]>()
      .exec(),
  ]);
  return { forms, calls };
}

function mergeTargets(
  failedForms: LeanFormLead[],
  failedCalls: LeanCallLead[],
  extraForms: LeanFormLead[],
  extraCalls: LeanCallLead[],
  includeForms: boolean,
  includeCalls: boolean,
): PatchTarget[] {
  const byKey = new Map<string, PatchTarget>();
  const add = (target: PatchTarget) => {
    const key = `${target.endpoint}:${target.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, target);
    }
  };

  if (includeForms) {
    for (const lead of [...failedForms, ...extraForms]) {
      add(formNoopPatch(lead));
    }
  }
  if (includeCalls) {
    for (const lead of [...failedCalls, ...extraCalls]) {
      add(callNoopPatch(lead));
    }
  }

  return [...byKey.values()];
}

async function main(): Promise<void> {
  const apiSecret = requiredEnv("VANTAGE_API_SECRET");
  const baseUrl = (
    process.env.SHEET_SYNC_RESYNC_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const delayMs = parseNonNegativeInt("SHEET_SYNC_RESYNC_DELAY_MS", 1000);
  const limit = parseNonNegativeInt("SHEET_SYNC_RESYNC_LIMIT", 0);
  const timeoutMs = parseNonNegativeInt("SHEET_SYNC_RESYNC_REQUEST_TIMEOUT_MS", 30000);
  const apply = shouldApply();
  const includeForms = envFlag("SHEET_SYNC_RESYNC_INCLUDE_FORM_LEADS", true);
  const includeCalls = envFlag("SHEET_SYNC_RESYNC_INCLUDE_CALL_LEADS", true);
  const extraIds = parseExtraIds();

  await connectMongo();

  const [failedForms, failedCalls, extra] = await Promise.all([
    includeForms ? loadFailedFormLeads(limit) : Promise.resolve([]),
    includeCalls ? loadFailedCallLeads(limit) : Promise.resolve([]),
    loadExtraLeads(extraIds),
  ]);

  const targets = mergeTargets(
    failedForms,
    failedCalls,
    extra.forms,
    extra.calls,
    includeForms,
    includeCalls,
  );

  const formCount = targets.filter((target) => target.endpoint === "form-leads").length;
  const callCount = targets.filter((target) => target.endpoint === "call-leads").length;

  console.log("=== Resync failed sheet_sync via production API ===");
  console.log(`Mongo database: ${getMongoDatabaseName()}`);
  console.log(`Target API:     ${baseUrl}`);
  console.log(`Mode:           ${apply ? "LIVE" : "DRY RUN (no requests sent)"}`);
  console.log(
    `Query:          sheet_sync elemMatch status=failed` +
      (extraIds.length > 0 ? ` + ${extraIds.length} extra id(s)` : ""),
  );
  console.log(
    `Targets:        ${targets.length} (${formCount} form-leads, ${callCount} call-leads)`,
  );
  console.log(`Delay:          ${delayMs}ms between requests`);
  console.log("");

  if (targets.length === 0) {
    console.log("No leads matched. Nothing to do.");
    return;
  }

  let okCount = 0;
  const failures: { target: PatchTarget; status: number; body: string }[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const position = `${i + 1}/${targets.length}`;
    const label = target.name?.trim() || target.id;
    const failedTabs = target.failedTargets.length
      ? target.failedTargets.join(", ")
      : "(none recorded)";

    if (!apply) {
      console.log(
        `[${position}] would PATCH ${target.endpoint}/${target.id} — ${label} — failed: ${failedTabs} — ${target.note} ${JSON.stringify(target.body)}`,
      );
      continue;
    }

    const result = await patchLead(baseUrl, apiSecret, target, timeoutMs);
    if (result.ok) {
      okCount += 1;
      console.log(
        `[${position}] ok ${target.endpoint}/${target.id} (${result.status}) — ${label} — ${target.note}`,
      );
    } else {
      failures.push({ target, status: result.status, body: result.body.slice(0, 300) });
      console.error(
        `[${position}] FAILED ${target.endpoint}/${target.id} (${result.status}) — ${label}: ${result.body.slice(0, 300)}`,
      );
    }

    if (delayMs > 0 && i < targets.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Total:     ${targets.length}`);
  if (!apply) {
    console.log("Dry run complete. Set SHEET_SYNC_RESYNC_APPLY=true to send requests.");
  } else {
    console.log(`Succeeded: ${okCount}`);
    console.log(`Failed:    ${failures.length}`);
    if (failures.length > 0) {
      console.log("");
      console.log("Failed targets:");
      for (const failure of failures) {
        console.log(
          `  ${failure.target.endpoint}/${failure.target.id} (${failure.status}) ${failure.body}`,
        );
      }
      process.exitCode = 1;
    }
    console.log("");
    console.log(
      "Sheet writes run as background tasks on the server. Check logs for sheets.sync.* / form_lead.updated.",
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
