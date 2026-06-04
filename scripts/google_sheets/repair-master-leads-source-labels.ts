/**
 * Repair Master Leads source-company labels after reverting the mistaken
 * 10best source-company split.
 *
 * Run:
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/repair-master-leads-source-labels.ts
 *
 * Apply live changes:
 *   SOURCE_LABEL_REPAIR_APPLY=true node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/repair-master-leads-source-labels.ts
 *
 * What it does:
 * - Patches stale call leads that stored `10best_leads` back to `tbm_leads`.
 * - Patches the one known bad call lead row to `tbm_leads`.
 * - Sends idempotent PATCH requests for all FormLead and CallLead documents so
 *   the deployed API schedules sheet sync with the current label projection.
 *
 * Env:
 * - VANTAGE_API_SECRET (required) sent as the `x-api-secret` header.
 * - MONGO_URI (required) read by `connectMongo`.
 * - SOURCE_LABEL_REPAIR_APPLY ("true") sends requests; otherwise dry-run.
 * - SOURCE_LABEL_REPAIR_BASE_URL defaults to production Vercel URL.
 * - SOURCE_LABEL_REPAIR_DELAY_MS defaults to 800.
 * - SOURCE_LABEL_REPAIR_LIMIT optional cap per lead type for testing.
 * - SOURCE_LABEL_REPAIR_REQUEST_TIMEOUT_MS defaults to 30000.
 */

import process from "node:process";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { getMongoDatabaseName } from "../../api/config/domain";
import { CallLead } from "../../api/models/CallLead";
import { FormLead } from "../../api/models/FormLead";

const DEFAULT_BASE_URL = "https://vantage-movers-main-server.vercel.app";
const KNOWN_TBM_TENBEST_CALL_LEAD_ID = "6a20a4090f3e8ca5be6919ad";

type LeanFormLead = {
  _id: mongoose.Types.ObjectId;
  quoted?: boolean | null;
  duplicate?: boolean | null;
};

type LeanCallLead = {
  _id: mongoose.Types.ObjectId;
  source_company?: string | null;
  duration?: number | null;
  duplicate?: boolean | null;
};

type PatchTarget = {
  id: string;
  endpoint: "form-leads" | "call-leads";
  body: Record<string, unknown>;
  note: string;
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

function shouldApply(): boolean {
  return process.env.SOURCE_LABEL_REPAIR_APPLY?.trim().toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function formNoopPatch(lead: LeanFormLead): PatchTarget {
  return {
    id: lead._id.toString(),
    endpoint: "form-leads",
    body: { duplicate: Boolean(lead.duplicate) },
    note: Boolean(lead.duplicate) ? "form duplicate resync" : "form resync",
  };
}

function callNoopPatch(lead: LeanCallLead): PatchTarget {
  return {
    id: lead._id.toString(),
    endpoint: "call-leads",
    body: { source_company: lead.source_company ?? "not_provided" },
    note: Boolean(lead.duplicate) ? "call duplicate resync" : "call resync",
  };
}

function tbmTenbestPatch(lead: LeanCallLead): PatchTarget {
  return {
    id: lead._id.toString(),
    endpoint: "call-leads",
    body: { source_company: "tbm_leads" },
    note: "10 Best inbound source_company repair",
  };
}

async function loadTargets(limit: number): Promise<PatchTarget[]> {
  const [knownLead, staleTenbestLeads, formLeads, callLeads] = await Promise.all([
    CallLead.findById(KNOWN_TBM_TENBEST_CALL_LEAD_ID, {
      _id: 1,
      source_company: 1,
      duration: 1,
      duplicate: 1,
    }).lean<LeanCallLead | null>().exec(),
    CallLead.find()
      .where("source_company")
      .equals("10best_leads")
      .select({ _id: 1, source_company: 1, duration: 1, duplicate: 1 })
      .sort({ createdAt: 1 })
      .limit(limit > 0 ? limit : 0)
      .lean<LeanCallLead[]>()
      .exec(),
    FormLead.find({}, { _id: 1, quoted: 1, duplicate: 1 })
      .sort({ createdAt: 1 })
      .limit(limit > 0 ? limit : 0)
      .lean<LeanFormLead[]>()
      .exec(),
    CallLead.find({}, { _id: 1, source_company: 1, duration: 1, duplicate: 1 })
      .sort({ createdAt: 1 })
      .limit(limit > 0 ? limit : 0)
      .lean<LeanCallLead[]>()
      .exec(),
  ]);

  if (!knownLead) {
    throw new Error(`Known 10 Best inbound call lead ${KNOWN_TBM_TENBEST_CALL_LEAD_ID} was not found`);
  }

  const targetByKey = new Map<string, PatchTarget>();
  const targets: PatchTarget[] = [];

  function addTarget(target: PatchTarget): void {
    const key = `${target.endpoint}:${target.id}`;
    if (!targetByKey.has(key)) {
      targetByKey.set(key, target);
      targets.push(target);
    }
  }

  addTarget(tbmTenbestPatch(knownLead));

  for (const lead of staleTenbestLeads) {
    addTarget(tbmTenbestPatch(lead));
  }

  for (const lead of formLeads) {
    addTarget(formNoopPatch(lead));
  }

  for (const lead of callLeads) {
    addTarget(callNoopPatch(lead));
  }

  return targets;
}

async function main(): Promise<void> {
  const apiSecret = requiredEnv("VANTAGE_API_SECRET");
  const baseUrl = (
    process.env.SOURCE_LABEL_REPAIR_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const delayMs = parseNonNegativeInt("SOURCE_LABEL_REPAIR_DELAY_MS", 800);
  const limit = parseNonNegativeInt("SOURCE_LABEL_REPAIR_LIMIT", 0);
  const timeoutMs = parseNonNegativeInt("SOURCE_LABEL_REPAIR_REQUEST_TIMEOUT_MS", 30000);
  const apply = shouldApply();

  await connectMongo();
  const targets = await loadTargets(limit);
  const formCount = targets.filter((target) => target.endpoint === "form-leads").length;
  const callCount = targets.filter((target) => target.endpoint === "call-leads").length;

  console.log("=== Master Leads source label repair ===");
  console.log(`Mongo database: ${getMongoDatabaseName()}`);
  console.log(`Target API:     ${baseUrl}`);
  console.log(`Mode:           ${apply ? "LIVE" : "DRY RUN (no requests sent)"}`);
  console.log(`Targets:        ${targets.length} (${formCount} form, ${callCount} call)`);
  console.log(`Delay:          ${delayMs}ms between requests`);
  console.log("");

  let okCount = 0;
  const failures: { target: PatchTarget; status: number; body: string }[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const position = `${i + 1}/${targets.length}`;

    if (!apply) {
      console.log(
        `[${position}] would PATCH ${target.endpoint}/${target.id} (${target.note}) ${JSON.stringify(target.body)}`,
      );
      continue;
    }

    const result = await patchLead(baseUrl, apiSecret, target, timeoutMs);
    if (result.ok) {
      okCount += 1;
      console.log(`[${position}] ok ${target.endpoint}/${target.id} (${result.status}) ${target.note}`);
    } else {
      failures.push({ target, status: result.status, body: result.body.slice(0, 300) });
      console.error(
        `[${position}] FAILED ${target.endpoint}/${target.id} (${result.status}): ${result.body.slice(0, 300)}`,
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
    console.log("Dry run complete. Set SOURCE_LABEL_REPAIR_APPLY=true to send requests.");
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
    console.log("Sheet writes run as background tasks on the server. Check logs for sheets.sync.* results.");
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
