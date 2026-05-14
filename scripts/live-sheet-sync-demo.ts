/**
 * Live demo: ~20 authenticated CRUD calls against /api/v1 (forms, calls, bookings, cancellations)
 * plus an optional MongoDB read-back report (sheet_sync summary).
 *
 * Usage (from vantage_movers_server):
 *   pnpm run demo:live-sheet-sync
 *   pnpm run demo:live-sheet-sync -- path/to/custom.fixture.json
 *   DEMO_RUN_TAG=manual-1 pnpm run demo:live-sheet-sync
 *
 * Env:
 *   VANTAGE_API_SECRET (required) — sent as x-api-secret
 *   API_BASE_URL or LOCAL_BASE_URL (default http://localhost:3000)
 *   MONGO_URI — required for the Mongo report (use --no-mongo to skip)
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../api/db";
import { BookedLead } from "../api/models/BookedLead";
import { CallLead } from "../api/models/CallLead";
import { CancelledLead } from "../api/models/CancelledLead";
import { FormLead } from "../api/models/FormLead";

type LeadKind = "FormLead" | "CallLead";

type Fixture = {
  scenarioName?: string;
  description?: string;
  formCreates: Record<string, unknown>[];
  callCreates: Record<string, unknown>[];
  formPatches: { index: number; body: Record<string, unknown> }[];
  callPatches: { index: number; body: Record<string, unknown> }[];
  bookings: {
    lead: { kind: LeadKind; index: number };
    body: Record<string, unknown>;
  }[];
  cancellations: { bookingIndex: number; body: Record<string, unknown> }[];
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function apiBaseUrl(): string {
  const raw = process.env.API_BASE_URL?.trim() || process.env.LOCAL_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function parseArgs(): { fixturePath: string; skipMongo: boolean } {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const skipMongo = process.argv.includes("--no-mongo");
  const positional = argv.find((a) => !a.startsWith("-"));
  const fixturePath = positional
    ? isAbsolute(positional)
      ? positional
      : resolve(process.cwd(), positional)
    : join(process.cwd(), "scripts", "live-sheet-sync-demo.fixture.json");
  return { fixturePath, skipMongo };
}

function loadFixture(path: string, runTag: string): Fixture {
  const raw = readFileSync(path, "utf8").replaceAll("{{RUN_TAG}}", runTag);
  return JSON.parse(raw) as Fixture;
}

function pickId(data: unknown): string {
  if (!data || typeof data !== "object") {
    throw new Error("Response data is not an object");
  }
  const d = data as Record<string, unknown>;
  const id = d._id ?? d.id;
  if (typeof id === "string" && mongoose.isValidObjectId(id)) {
    return id;
  }
  if (id && typeof id === "object") {
    const oid = (id as { toString?: () => string }).toString?.();
    if (oid && mongoose.isValidObjectId(oid)) {
      return oid;
    }
  }
  throw new Error(`Could not read Mongo id from API payload: ${JSON.stringify(data).slice(0, 200)}`);
}

async function apiJson(
  baseUrl: string,
  secret: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "x-api-secret": secret,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

function isOkPayload(json: unknown): json is { ok: true; data: unknown } {
  return Boolean(json && typeof json === "object" && (json as { ok?: boolean }).ok === true);
}

function summarizeSheetSync(entries: unknown): string {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "no sheet_sync rows";
  }
  const counts: Record<string, number> = {};
  for (const e of entries) {
    if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "string") {
      const s = (e as { status: string }).status;
      counts[s] = (counts[s] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
}

async function main(): Promise<void> {
  const { fixturePath, skipMongo } = parseArgs();
  const secret = requireEnv("VANTAGE_API_SECRET");
  const baseUrl = apiBaseUrl();
  const runTag =
    process.env.DEMO_RUN_TAG?.trim() ||
    `DEMO${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${process.pid.toString(36).toUpperCase()}`;

  console.log(`Scenario fixture: ${fixturePath}`);
  console.log(`RUN_TAG: ${runTag}`);
  console.log(`API: ${baseUrl}\n`);

  let fixture: Fixture;
  try {
    fixture = loadFixture(fixturePath, runTag);
  } catch (e) {
    console.error("Failed to read or parse fixture:", e);
    process.exit(1);
  }

  if (fixture.scenarioName) {
    console.log(`Name: ${fixture.scenarioName}`);
  }
  if (fixture.description) {
    console.log(`${fixture.description}\n`);
  }

  const formIds: string[] = [];
  const callIds: string[] = [];
  const bookedIds: string[] = [];
  const cancelledIds: string[] = [];
  const formSources = fixture.formCreates.map((row) => String(row.source_company ?? "not_provided").trim());
  const callSources = fixture.callCreates.map((row) => String(row.source_company ?? "not_provided").trim());
  let stepN = 0;

  const logStep = (entry: {
    n: number;
    method: string;
    path: string;
    status: number;
    ok: boolean;
    id?: string;
    detail?: string;
  }) => {
    const idPart = entry.id ? ` id=${entry.id}` : "";
    const fail = entry.ok ? "" : ` ${entry.detail ?? ""}`;
    console.log(`[${entry.n}] ${entry.method} ${entry.path} → ${entry.status}${idPart}${fail}`);
  };

  for (const body of fixture.formCreates) {
    stepN += 1;
    const { status, json } = await apiJson(baseUrl, secret, "POST", "/api/v1/form-leads", body);
    const ok = status === 201 && isOkPayload(json);
    let id: string | undefined;
    let detail: string | undefined;
    if (ok) {
      id = pickId((json as { data: unknown }).data);
      formIds.push(id);
    } else {
      detail = JSON.stringify(json).slice(0, 400);
    }
    logStep({ n: stepN, method: "POST", path: "/api/v1/form-leads", status, ok, id, detail });
    if (!ok) {
      process.exit(1);
    }
  }

  for (const body of fixture.callCreates) {
    stepN += 1;
    const { status, json } = await apiJson(baseUrl, secret, "POST", "/api/v1/call-leads", body);
    const ok = status === 201 && isOkPayload(json);
    let id: string | undefined;
    let detail: string | undefined;
    if (ok) {
      id = pickId((json as { data: unknown }).data);
      callIds.push(id);
    } else {
      detail = JSON.stringify(json).slice(0, 400);
    }
    logStep({ n: stepN, method: "POST", path: "/api/v1/call-leads", status, ok, id, detail });
    if (!ok) {
      process.exit(1);
    }
  }

  for (const patch of fixture.formPatches) {
    stepN += 1;
    const id = formIds[patch.index];
    const path = `/api/v1/form-leads/${id}`;
    const { status, json } = await apiJson(baseUrl, secret, "PATCH", path, patch.body);
    const ok = status === 200 && isOkPayload(json);
    logStep({
      n: stepN,
      method: "PATCH",
      path,
      status,
      ok,
      id,
      detail: ok ? undefined : JSON.stringify(json).slice(0, 400),
    });
    if (!ok) {
      process.exit(1);
    }
  }

  for (const patch of fixture.callPatches) {
    stepN += 1;
    const id = callIds[patch.index];
    const path = `/api/v1/call-leads/${id}`;
    const { status, json } = await apiJson(baseUrl, secret, "PATCH", path, patch.body);
    const ok = status === 200 && isOkPayload(json);
    logStep({
      n: stepN,
      method: "PATCH",
      path,
      status,
      ok,
      id,
      detail: ok ? undefined : JSON.stringify(json).slice(0, 400),
    });
    if (!ok) {
      process.exit(1);
    }
  }

  for (const booking of fixture.bookings) {
    stepN += 1;
    const leadId = booking.lead.kind === "FormLead" ? formIds[booking.lead.index] : callIds[booking.lead.index];
    if (!leadId) {
      console.error("Invalid lead index in fixture.bookings");
      process.exit(1);
    }
    const sourceFromLead =
      booking.lead.kind === "FormLead"
        ? formSources[booking.lead.index] ?? "not_provided"
        : callSources[booking.lead.index] ?? "not_provided";
    const body = {
      ...booking.body,
      lead_ref: leadId,
      lead_model: booking.lead.kind,
      source: sourceFromLead,
    };
    const { status, json } = await apiJson(baseUrl, secret, "POST", "/api/v1/booked-leads", body);
    const ok = status === 201 && isOkPayload(json);
    let id: string | undefined;
    if (ok) {
      id = pickId((json as { data: unknown }).data);
      bookedIds.push(id);
    }
    logStep({
      n: stepN,
      method: "POST",
      path: "/api/v1/booked-leads",
      status,
      ok,
      id,
      detail: ok ? undefined : JSON.stringify(json).slice(0, 400),
    });
    if (!ok) {
      process.exit(1);
    }
  }

  for (const cancel of fixture.cancellations) {
    stepN += 1;
    const bookedId = bookedIds[cancel.bookingIndex];
    if (!bookedId) {
      console.error("Invalid bookingIndex in fixture.cancellations");
      process.exit(1);
    }
    const body = { ...cancel.body, booked_lead: bookedId };
    const { status, json } = await apiJson(baseUrl, secret, "POST", "/api/v1/cancelled-leads", body);
    const ok = status === 201 && isOkPayload(json);
    let id: string | undefined;
    if (ok) {
      id = pickId((json as { data: unknown }).data);
      cancelledIds.push(id);
    }
    logStep({
      n: stepN,
      method: "POST",
      path: "/api/v1/cancelled-leads",
      status,
      ok,
      id,
      detail: ok ? undefined : JSON.stringify(json).slice(0, 400),
    });
    if (!ok) {
      process.exit(1);
    }
  }

  console.log(`\nCompleted ${stepN} HTTP operations.\n`);

  if (skipMongo) {
    console.log("--no-mongo: skipping database report.");
    return;
  }

  if (!process.env.MONGO_URI?.trim()) {
    console.log("MONGO_URI not set — skipping database report (set MONGO_URI or pass --no-mongo).");
    return;
  }

  await connectMongo();

  const [forms, calls, booked, cancelled] = await Promise.all([
    FormLead.find({ _id: { $in: formIds } })
      .select("ref_no source_company booked cancelled local quoted sheet_sync")
      .lean(),
    CallLead.find({ _id: { $in: callIds } })
      .select("name source_company booked cancelled local duration sheet_sync")
      .lean(),
    BookedLead.find({ _id: { $in: bookedIds } })
      .select("job_no lead_model lead_ref deposit_amount cancelled sheet_sync")
      .lean(),
    CancelledLead.find({ _id: { $in: cancelledIds } })
      .select("job_no reason booked_lead sheet_sync")
      .lean(),
  ]);

  console.log("── Mongo read-back (this run only) ──\n");

  console.log("Form leads:");
  for (const row of forms) {
    console.log(
      `  ${row.ref_no} | ${row.source_company} | local=${row.local} | quoted=${row.quoted} | booked=${row.booked ?? "—"} | cancelled=${row.cancelled ?? "—"} | ${summarizeSheetSync(row.sheet_sync)}`,
    );
  }

  console.log("\nCall leads:");
  for (const row of calls) {
    console.log(
      `  ${row.name} | ${row.source_company} | local=${row.local ?? "—"} | dur=${row.duration} | booked=${row.booked ?? "—"} | cancelled=${row.cancelled ?? "—"} | ${summarizeSheetSync(row.sheet_sync)}`,
    );
  }

  console.log("\nBooked leads:");
  for (const row of booked) {
    console.log(
      `  ${row.job_no} | ${row.lead_model} ${row.lead_ref} | deposit=${row.deposit_amount} | cancelled=${row.cancelled ?? "—"} | ${summarizeSheetSync(row.sheet_sync)}`,
    );
  }

  console.log("\nCancelled leads:");
  for (const row of cancelled) {
    console.log(`  ${row.job_no ?? "—"} | ${row.reason} | booked_lead=${row.booked_lead} | ${summarizeSheetSync(row.sheet_sync)}`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
