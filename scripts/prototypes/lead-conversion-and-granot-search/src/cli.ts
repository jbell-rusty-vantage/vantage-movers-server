/**
 * Read-only prototype: conversion rates + Granot observation/command search.
 *
 *   pnpm prototype:lead-conversion-and-granot-search -- rates --confirm-production-db=vantagemovers
 *   pnpm prototype:lead-conversion-and-granot-search -- search --job-no 5562924 --confirm-production-db=vantagemovers
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../../../src/db.js";
import { PRODUCTION_CONFIRMATION } from "../../../migrations/operations-registry-inventory.lib.js";
import { granotLifecycleOutputDirectory } from "../../../migrations/granot-lifecycle-migration.lib.js";
import {
  countUnassignedOfficialCancellations,
  loadGranotSearchCatalog,
  loadReceivedLeads,
  loadSuccessfulSmsLeads,
  productionDatabase,
  PROTOTYPE_DATABASE,
} from "./load.js";
import { computeConversionReport } from "./rates.js";
import {
  GranotSearchQueryError,
  parseBookingActionEventType,
  parseEventClass,
  searchGranotObservationsAndCommands,
} from "./search.js";
import type { ConversionReport, GranotSearchPage } from "./types.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory(
  "lead-conversion-and-granot-search",
);

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function assertProductionConfirmed(args: readonly string[]): void {
  if (!args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(
      `Refusing ${PROTOTYPE_DATABASE} read without ${PRODUCTION_CONFIRMATION}.`,
    );
  }
}

function assertKnownArgs(args: readonly string[]): void {
  const known = new Set([
    "rates",
    "search",
    "--",
    "--job-no",
    "--event",
    "--booking-action",
    PRODUCTION_CONFIRMATION,
  ]);
  const unknown = args.filter(
    (arg) => arg.startsWith("--") && arg !== "--" && !known.has(arg),
  );
  if (unknown.length > 0) {
    throw new GranotSearchQueryError(`Unknown flag(s): ${unknown.join(", ")}`);
  }
}

function printRate(label: string, slice: ConversionReport["received_by_agent"]): void {
  process.stdout.write(
    `${label}: ${slice.booked}/${slice.leads} booked (${slice.booked_of_leads.percent}%), ${slice.cancelled}/${slice.leads} cancelled (${slice.cancelled_of_leads.percent}%)\n`,
  );
}

function printRates(report: ConversionReport): void {
  process.stdout.write(`database: ${PROTOTYPE_DATABASE}\n\n`);
  process.stdout.write(
    `SMS successfully sent then booked: ${report.sms_successfully_sent_then_booked.booked}/${report.sms_successfully_sent_then_booked.leads} (${report.sms_successfully_sent_then_booked.booked_of_leads.percent}%)\n`,
  );
  for (const slice of report.sms_by_origin) {
    process.stdout.write(
      `  ${slice.key}: ${slice.booked}/${slice.leads} (${slice.booked_of_leads.percent}%)\n`,
    );
  }
  process.stdout.write("\n");
  printRate("Received by an agent", report.received_by_agent);
  for (const slice of report.received_by_agent_by_lead_model) {
    printRate(`  ${slice.key}`, slice);
  }
  process.stdout.write("\n");
  for (const note of report.notes) {
    process.stdout.write(`- ${note}\n`);
  }
}

function printSearch(page: GranotSearchPage): void {
  process.stdout.write(
    `job ${page.query.normalized_job_no} event=${page.query.event_class ?? "all"} action=${page.query.booking_action_event_type ?? "all"}\n`,
  );
  process.stdout.write(`hits: ${page.hits.length}\n\n`);
  for (const hit of page.hits) {
    const observation = hit.observation;
    const decision = hit.latest_decision;
    process.stdout.write(
      `${observation.captured_at}  ${observation.route_event_class ?? "?"}  ${observation.payload_event_type_raw ?? ""}  priority=${observation.priority_canonical ?? ""}  obs=${observation.id}\n`,
    );
    if (decision) {
      process.stdout.write(
        `  decision attempt ${decision.attempt} ${decision.outcome}/${decision.reason_code}\n`,
      );
    }
    for (const command of hit.commands) {
      process.stdout.write(
        `  command ${command.command_name} ${command.applied_at} [${command.entity_models.join(",")}]\n`,
      );
    }
  }
  process.stdout.write(
    `\ntimeline_seed observations=${page.timeline_seed.observation_ids.length} commands=${page.timeline_seed.command_ids.length}\n`,
  );
}

async function writeReport(kind: string, payload: unknown): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filePath = path.join(OUTPUT_DIR, `${kind}-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, `${kind}-latest.json`);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
  await writeFile(latestPath, body, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

async function runRates(): Promise<void> {
  await connectMongo();
  const db = await productionDatabase(mongoose);
  const [smsLeads, receivedLeads, unassignedCancellations] = await Promise.all([
    loadSuccessfulSmsLeads(db),
    loadReceivedLeads(db),
    countUnassignedOfficialCancellations(db),
  ]);
  const report = computeConversionReport({
    sms_leads: smsLeads,
    received_leads: receivedLeads,
    unassigned_official_cancellations: unassignedCancellations,
  });
  printRates(report);
  const filePath = await writeReport("rates", {
    database: PROTOTYPE_DATABASE,
    generated_at: new Date().toISOString(),
    report,
  });
  process.stdout.write(`\nWrote ${filePath}\n`);
}

async function runSearch(args: readonly string[]): Promise<void> {
  const jobNo = readFlag(args, "--job-no");
  if (!jobNo) {
    throw new GranotSearchQueryError("search requires --job-no <raw Job Number>.");
  }
  const eventClass = parseEventClass(readFlag(args, "--event"));
  const bookingAction = parseBookingActionEventType(
    readFlag(args, "--booking-action"),
  );
  await connectMongo();
  const db = await productionDatabase(mongoose);
  const catalog = await loadGranotSearchCatalog(db, jobNo);
  const page = searchGranotObservationsAndCommands(
    {
      job_no: jobNo,
      event_class: eventClass,
      booking_action_event_type: bookingAction,
    },
    catalog,
  );
  printSearch(page);
  const filePath = await writeReport(
    `search-${page.query.normalized_job_no}`,
    {
      database: PROTOTYPE_DATABASE,
      generated_at: new Date().toISOString(),
      page,
    },
  );
  process.stdout.write(`\nWrote ${filePath}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assertKnownArgs(args);
  assertProductionConfirmed(args);
  const mode = args.find((arg) => arg === "rates" || arg === "search");
  if (mode === "rates") {
    await runRates();
    return;
  }
  if (mode === "search") {
    await runSearch(args);
    return;
  }
  throw new GranotSearchQueryError("Expected rates or search.");
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("lead-conversion-and-granot-search/src/cli.ts");
}

if (isDirectExecution()) {
  main()
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = error instanceof GranotSearchQueryError ? 2 : 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => undefined);
      }
    });
}
