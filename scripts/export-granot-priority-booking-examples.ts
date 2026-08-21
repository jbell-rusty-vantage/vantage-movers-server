/**
 * Read-only owner briefing: how Granot priority_updated and
 * booking_status_changed receipts actually arrive, and which
 * job-level progressions Vantage has to handle.
 *
 *   pnpm ops:granot-priority-booking-examples -- --confirm-production-db=vantagemovers
 *
 * Writes markdown + JSON under scripts/output/granot-priority-booking-examples/.
 * Keeps job numbers so the owner can look them up. Masks names, phones, emails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../src/config/domain/runtime.js";
import { connectMongo } from "../src/db.js";
import { getGranotObservationModel } from "../src/models/GranotObservation.js";
import { getGranotObservationReceiptModel } from "../src/models/GranotObservationReceipt.js";
import {
  PRODUCTION_CONFIRMATION,
  PRODUCTION_DATABASE,
} from "./migrations/operations-registry-inventory.lib.js";
import { granotLifecycleOutputDirectory } from "./migrations/granot-lifecycle-migration.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-priority-booking-examples");
const BUSINESS_TZ = "America/New_York";
const EXAMPLES_PER_BUCKET = 4;

const PII_PAYLOAD_KEYS = new Set([
  "first_name",
  "last_name",
  "email",
  "phone",
  "phone_number",
  "customer_name",
  "display_name",
  "contact_name",
]);

type ReceiptRow = {
  _id: mongoose.Types.ObjectId;
  captured_at: Date;
  route_event_class?: string;
  processing?: { state?: string };
  payload?: Record<string, unknown> | null;
};

type TimelineEvent = {
  captured_at: string;
  captured_at_et: string;
  route: string;
  event_type: string;
  priority: string;
  job_no: string;
  source: string;
  user: string;
  rep: string;
  service_type: string;
  est_cf: string;
  estimate: string;
  payment: string;
  balance: string;
  move_date: string;
  from: string;
  to: string;
  processing_state: string;
  receipt_id: string;
};

type JobSet = {
  job_no: string;
  event_count: number;
  first_at: string;
  last_at: string;
  pattern: string;
  routes: string[];
  event_types: string[];
  priorities: string[];
  timeline: TimelineEvent[];
};

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function iso(value: Date | string | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatEt(value: Date | string | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function location(payload: Record<string, unknown>, prefix: "from" | "to"): string {
  const city = asString(payload[`${prefix}_city`]);
  const state = asString(payload[`${prefix}_state`]);
  const zip = asString(payload[`${prefix}_zip`]);
  return [city, state, zip].filter(Boolean).join(", ");
}

function redactPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PII_PAYLOAD_KEYS.has(key)) {
      out[key] = value == null || value === "" ? "" : "[redacted]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

function toEvent(row: ReceiptRow): TimelineEvent | undefined {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  const jobNo = asString(payload.job_no);
  if (!jobNo) return undefined;
  return {
    captured_at: iso(row.captured_at),
    captured_at_et: formatEt(row.captured_at),
    route: asString(row.route_event_class),
    event_type: asString(payload.event_type),
    priority: asString(payload.priority),
    job_no: jobNo,
    source: asString(payload.source ?? payload.label),
    user: asString(payload.user),
    rep: asString(payload.rep),
    service_type: asString(payload.service_type),
    est_cf: asString(payload.est_cf),
    estimate: asString(payload.estimate),
    payment: asString(payload.payment),
    balance: asString(payload.balance),
    move_date: asString(payload.move_date),
    from: location(payload, "from"),
    to: location(payload, "to"),
    processing_state: asString(row.processing?.state),
    receipt_id: String(row._id),
  };
}

function classify(events: TimelineEvent[]): string {
  const routes = new Set(events.map((event) => event.route));
  const types = events.map((event) => event.event_type);
  const hasPriority = routes.has("priority_updated");
  const hasBooking = routes.has("booking_status_changed");
  const bookedIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event_type === "Booked");
  const releaseIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event_type === "Releas");
  const firstBooked = bookedIndexes[0];
  const firstPriority5 = events.findIndex(
    (event) => event.route === "priority_updated" && event.priority === "5",
  );
  const firstPriority1 = events.findIndex(
    (event) => event.route === "priority_updated" && event.priority === "1",
  );
  const bookedThenReleaseThenBooked = Boolean(
    firstBooked &&
      releaseIndexes.some(({ index }) => index > firstBooked.index) &&
      bookedIndexes.some((booked) =>
        releaseIndexes.some(
          ({ index }) => booked.index > index && index > firstBooked.index,
        ),
      ),
  );
  const releaseThenBookedNoPriority =
    !hasPriority &&
    releaseIndexes.length > 0 &&
    bookedIndexes.some((booked) =>
      releaseIndexes.some(({ index }) => booked.index > index),
    );
  const quoteThenLaterBook =
    firstPriority1 >= 0 &&
    firstPriority5 > firstPriority1 &&
    bookedIndexes.some((booked) => booked.index > firstPriority5);
  const bookedBeforePriorityCorrected = bookedIndexes.some(
    ({ event, index }) =>
      event.priority !== "" &&
      event.priority !== "5" &&
      events.some(
        (later, laterIndex) =>
          laterIndex > index &&
          later.route === "priority_updated" &&
          later.priority === "5",
      ),
  );
  const cleanFirstBook =
    hasPriority &&
    firstPriority5 >= 0 &&
    firstBooked != null &&
    firstBooked.index === firstPriority5 + 1 &&
    events[firstPriority5]?.priority === "5" &&
    firstBooked.event.priority === "5" &&
    releaseIndexes.length === 0 &&
    types.filter((type) => type === "Booked").length === 1;
  const bookedWithoutPriorityWebhook = hasBooking && !hasPriority;
  const standalonePriority = hasPriority && !hasBooking;

  if (bookedBeforePriorityCorrected) {
    return "booked_before_priority_corrected";
  }
  if (quoteThenLaterBook && bookedThenReleaseThenBooked) {
    return "quote_then_book_then_releas_booked";
  }
  if (bookedThenReleaseThenBooked) return "booked_then_releas_then_booked";
  if (releaseThenBookedNoPriority) return "releas_then_booked_no_priority_webhook";
  if (quoteThenLaterBook) return "quote_then_later_book";
  if (cleanFirstBook) return "clean_priority5_then_booked";
  if (bookedWithoutPriorityWebhook) return "booking_webhooks_only";
  if (standalonePriority) return "priority_webhooks_only";
  if (hasPriority && hasBooking) return "priority_and_booking_mixed";
  return "other";
}

function payloadKeyInventory(rows: ReceiptRow[]): Record<string, Record<string, number>> {
  const inventory: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const route = asString(row.route_event_class) || "unknown";
    const eventType = asString(row.payload?.event_type) || "(empty)";
    const bucket = `${route} / ${eventType}`;
    inventory[bucket] ??= {};
    const keys =
      row.payload && typeof row.payload === "object" ? Object.keys(row.payload) : [];
    for (const key of keys) {
      inventory[bucket][key] = (inventory[bucket][key] ?? 0) + 1;
    }
  }
  for (const bucket of Object.values(inventory)) {
    for (const key of Object.keys(bucket).sort()) {
      const count = bucket[key];
      delete bucket[key];
      bucket[key] = count;
    }
  }
  return Object.fromEntries(
    Object.entries(inventory).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function pickExamples(sets: JobSet[], pattern: string): JobSet[] {
  return sets
    .filter((set) => set.pattern === pattern)
    .sort((left, right) => right.event_count - left.event_count || left.job_no.localeCompare(right.job_no))
    .slice(0, EXAMPLES_PER_BUCKET);
}

function markdownTable(headers: string[], rows: string[][]): string {
  const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ") || "—";
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}

function timelineTable(events: TimelineEvent[]): string {
  return markdownTable(
    ["ET", "route", "event_type", "priority", "user / rep", "est_cf", "estimate", "payment", "source"],
    events.map((event) => [
      event.captured_at_et,
      event.route,
      event.event_type || "(empty)",
      event.priority || "(empty)",
      [event.user, event.rep].filter(Boolean).join(" / ") || "—",
      event.est_cf || "—",
      event.estimate || "—",
      event.payment || "—",
      event.source || "—",
    ]),
  );
}

function exampleSection(title: string, why: string, sets: JobSet[]): string[] {
  const lines = [`## ${title}`, "", why, ""];
  if (sets.length === 0) {
    lines.push("_No jobs in the current receipt window matched this pattern._", "");
    return lines;
  }
  for (const set of sets) {
    lines.push(`### Job ${set.job_no}`, "");
    lines.push(
      `${set.event_count} receipts from ${formatEt(set.first_at)} to ${formatEt(set.last_at)} ET. Pattern: \`${set.pattern}\`.`,
      "",
    );
    lines.push(timelineTable(set.timeline));
  }
  return lines;
}

function assertProductionConfirmed(args: readonly string[], databaseName: string): void {
  if (databaseName !== PRODUCTION_DATABASE) {
    throw new Error(
      `Refusing export against ${databaseName}. Connect with TEST_MODE=false so the database is ${PRODUCTION_DATABASE}.`,
    );
  }
  if (!args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(`Refusing production read without ${PRODUCTION_CONFIRMATION}.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName ?? getMongoDatabaseName();
  assertProductionConfirmed(args, databaseName);

  const Receipt = getGranotObservationReceiptModel();
  const Observation = getGranotObservationModel();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection has no database.");

  const activation = await db.collection("granot_lifecycle_activations").findOne({
    key: "granot_lifecycle",
  });

  const receipts = (await Receipt.find({
    route_event_class: { $in: ["priority_updated", "booking_status_changed"] },
  })
    .sort({ captured_at: 1, _id: 1 })
    .lean()) as ReceiptRow[];

  const receiptCounts = new Map<string, { n: number; first?: Date; last?: Date }>();
  const eventTypeCounts = new Map<string, number>();
  for (const row of receipts) {
    const route = asString(row.route_event_class) || "unknown";
    const state = asString(row.processing?.state) || "unknown";
    const key = `${route}\t${state}`;
    const current = receiptCounts.get(key) ?? { n: 0 };
    current.n += 1;
    if (!current.first || row.captured_at < current.first) current.first = row.captured_at;
    if (!current.last || row.captured_at > current.last) current.last = row.captured_at;
    receiptCounts.set(key, current);

    const eventType = asString(row.payload?.event_type) || "(empty)";
    const priority = asString(row.payload?.priority) || "(empty)";
    const typeKey = `${route}\t${eventType}\t${priority}`;
    eventTypeCounts.set(typeKey, (eventTypeCounts.get(typeKey) ?? 0) + 1);
  }

  const jobs = new Map<string, TimelineEvent[]>();
  for (const row of receipts) {
    const event = toEvent(row);
    if (!event) continue;
    const list = jobs.get(event.job_no) ?? [];
    list.push(event);
    jobs.set(event.job_no, list);
  }

  const sets: JobSet[] = [...jobs.entries()].map(([jobNo, events]) => ({
    job_no: jobNo,
    event_count: events.length,
    first_at: events[0]?.captured_at ?? "",
    last_at: events[events.length - 1]?.captured_at ?? "",
    pattern: classify(events),
    routes: [...new Set(events.map((event) => event.route))],
    event_types: [...new Set(events.map((event) => event.event_type).filter(Boolean))],
    priorities: [...new Set(events.map((event) => event.priority).filter(Boolean))],
    timeline: events,
  }));

  const patternCounts = new Map<string, number>();
  for (const set of sets) {
    patternCounts.set(set.pattern, (patternCounts.get(set.pattern) ?? 0) + 1);
  }

  const observationPairing = await Observation.aggregate([
    {
      $match: {
        route_event_class: { $in: ["priority_updated", "booking_status_changed"] },
        "identity.normalized_job_no": { $type: "string" },
      },
    },
    {
      $group: {
        _id: "$identity.normalized_job_no",
        routes: { $addToSet: "$route_event_class" },
        actions: { $addToSet: "$booking_action.normalized" },
        action_raws: { $addToSet: "$booking_action.raw" },
        priorities: { $addToSet: "$priority.canonical" },
        n: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: {
          has_priority: { $in: ["priority_updated", "$routes"] },
          has_booking: { $in: ["booking_status_changed", "$routes"] },
          actions: "$actions",
        },
        jobs: { $sum: 1 },
        observations: { $sum: "$n" },
      },
    },
    { $sort: { jobs: -1 } },
  ]);

  const examples = {
    booked_before_priority_corrected: pickExamples(sets, "booked_before_priority_corrected"),
    clean_priority5_then_booked: pickExamples(sets, "clean_priority5_then_booked"),
    booked_then_releas_then_booked: pickExamples(sets, "booked_then_releas_then_booked"),
    quote_then_book_then_releas_booked: pickExamples(sets, "quote_then_book_then_releas_booked"),
    releas_then_booked_no_priority_webhook: pickExamples(
      sets,
      "releas_then_booked_no_priority_webhook",
    ),
    booking_webhooks_only: pickExamples(sets, "booking_webhooks_only"),
    priority_webhooks_only: pickExamples(sets, "priority_webhooks_only"),
  };

  const shapeExamples: Record<string, Record<string, unknown> | null> = {};
  for (const row of receipts) {
    const eventType = asString(row.payload?.event_type);
    if (eventType === "priority_update" && !shapeExamples.priority_update) {
      shapeExamples.priority_update = redactPayload(row.payload);
    }
    if (eventType === "Booked" && !shapeExamples.Booked) {
      shapeExamples.Booked = redactPayload(row.payload);
    }
    if (eventType === "Releas" && !shapeExamples.Releas) {
      shapeExamples.Releas = redactPayload(row.payload);
    }
  }

  const generatedAt = new Date();
  const manifest = {
    generated_at: generatedAt.toISOString(),
    generated_at_et: formatEt(generatedAt),
    database: databaseName,
    activated_at: iso(activation?.activated_at as Date | undefined),
    activated_at_et: formatEt(activation?.activated_at as Date | undefined),
    receipt_window: {
      first: iso(receipts[0]?.captured_at),
      last: iso(receipts[receipts.length - 1]?.captured_at),
      count: receipts.length,
    },
    receipt_counts: [...receiptCounts.entries()].map(([key, value]) => {
      const [route, state] = key.split("\t");
      return {
        route,
        state,
        n: value.n,
        first: iso(value.first),
        last: iso(value.last),
      };
    }),
    event_type_priority_counts: [...eventTypeCounts.entries()]
      .map(([key, n]) => {
        const [route, event_type, priority] = key.split("\t");
        return { route, event_type, priority, n };
      })
      .sort((left, right) => right.n - left.n),
    payload_key_inventory: payloadKeyInventory(receipts),
    job_pattern_counts: Object.fromEntries(
      [...patternCounts.entries()].sort((left, right) => right[1] - left[1]),
    ),
    observation_pairing: observationPairing,
    examples,
    payload_shapes: shapeExamples,
  };

  const markdown = [
    "# Granot webhook examples: Priority Update vs Booking Status",
    "",
    `Generated ${formatEt(generatedAt)} ET from \`${databaseName}\`. Receipt window ${formatEt(manifest.receipt_window.first)} – ${formatEt(manifest.receipt_window.last)} ET. Lifecycle activated ${manifest.activated_at_et || "—"} ET.`,
    "",
    "This file is for the owner. Job numbers are real so they can be opened in Granot. Customer names, phones, and emails are redacted.",
    "",
    "## What Granot actually sends",
    "",
    "These are **two different webhooks**, not one event with two meanings.",
    "",
    markdownTable(
      ["Our route", "Granot `event_type` on the body", "What it means"],
      [
        [
          "`priority_updated`",
          "`priority_update`",
          "Someone changed Priority in Granot. This is the only webhook whose job is Priority.",
        ],
        [
          "`booking_status_changed`",
          "`Booked`",
          "The job just became booked, or was re-booked after a release.",
        ],
        [
          "`booking_status_changed`",
          "`Releas`",
          "Granot's real spelling is truncated. It means Release — the booked state was undone.",
        ],
      ],
    ),
    "Granot does **not** send `event_type: \"priority_updated\"` or `event_type: \"Release\"`. We keep those names internally. The body uses `priority_update` and `Releas`.",
    "",
    "Every Booked / Releas body we have also already carries a `priority` field. Almost always that value is `5`. That is **not** a Priority Update webhook. Priority 5 on a Booked body means “this job is booked and Granot currently shows Priority 5.” It does not replace a missing Priority Update, and a Priority Update to 5 does not mean the job is booked.",
    "",
    "## Counts in this window",
    "",
    markdownTable(
      ["route", "processing", "receipts", "first ET", "last ET"],
      manifest.receipt_counts.map((row) => [
        row.route,
        row.state,
        String(row.n),
        formatEt(row.first),
        formatEt(row.last),
      ]),
    ),
    markdownTable(
      ["route", "event_type", "priority on body", "receipts"],
      manifest.event_type_priority_counts.map((row) => [
        row.route,
        row.event_type,
        row.priority,
        String(row.n),
      ]),
    ),
    markdownTable(
      ["job-level pattern from receipts", "jobs"],
      Object.entries(manifest.job_pattern_counts).map(([pattern, n]) => [
        pattern,
        String(n),
      ]),
    ),
    "## Exact reasoning — the logic we need",
    "",
    "1. **Treat the two routes as independent facts.** A Priority Update never books a job. A Booked / Releas webhook never *is* a Priority Update, even when the body includes `priority: \"5\"`.",
    "2. **Do not wait for a sibling Priority Update before handling Booked.** In the live receipts, Booked already carries Priority. If we require a separate `priority_updated` receipt before we accept a booking, we will miss real books and we will invent a dependency Granot does not guarantee.",
    "3. **Priority 5 ≠ booked.** A `priority_updated` receipt with canonical 5 only says the owner/agent set Priority to 5. It may arrive ~2 seconds before Booked. It may arrive with no Booked at all. It must update `granot_priority` (and the Priority 1/5 enrichment fields). It must not open a “review existing booking” case by itself.",
    "4. **`Releas` then `Booked` is a Granot edit/rebook, not a first-time book.** When someone changes a booked job in Granot (cubic feet, money, dates, or other booked fields), Granot fires `Releas` and then `Booked` again. Priority usually stays 5 the whole time. There is often **no** new Priority Update.",
    "5. **A Booked can arrive with no Priority Update in our window.** That happens when the job was already Priority 5 / already booked before we started capturing, and the owner later released and rebooked. We still have to handle the Releas → Booked progression.",
    "6. **Booked can happen while Priority is still 1 (or 0), and fixing Priority later produces Releas + Booked.** That is a real Granot sequence, not a theory. The agent books first. The Booked body still says Priority 1. Someone then sets Priority to 5. Granot releases and rebooks so the booked record picks up Priority 5. We have to accept the first Booked as booked, accept the later Priority Update as Priority, and treat the Releas + second Booked as a progression — not as “this job was never booked.”",
    "7. **Most Releas + Booked pairs are still ordinary booking edits.** Cubic feet and money move, Priority stays 5, and there is no Priority Update. Both progressions are in scope.",
    "8. **What Vantage must do with each fact:**",
    "   - `priority_updated` → plan `granot_priority`; enrich quoted / contact snapshot / move facts only for Priority 1 and 5.",
    "   - `Booked` → booking reconciliation (create-missing or review-existing). Read Priority off that same body if present.",
    "   - `Releas` → release reconciliation against the current official Booking.",
    "   - `Releas` + `Booked` on the same job after an earlier Booked → release case then booking refresh. Do not treat the second Booked as a brand-new first booking.",
    "",
    ...exampleSection(
      "Set A — Booked while Priority is still 1, then owner sets 5, then Releas + Booked",
      "This is the sequence the owner asked about. Granot allowed the job to book without a Priority Update to 5. The Booked body still says Priority 1. A few minutes later someone sets Priority 5; Granot fires Releas and Booked again so the booked record matches. Vantage must keep the first Booked, apply the Priority Update, and handle Releas → Booked as a progression.",
      examples.booked_before_priority_corrected,
    ),
    ...exampleSection(
      "Set B — clean first book: Priority 5, then Booked ~2 seconds later",
      "This is the happy path the owner will recognize. Granot sends Priority Update first, then Booking Status Booked. Both bodies already say Priority 5. We must apply Priority from the first webhook and open booking work from the second. We must not collapse them into one event.",
      examples.clean_priority5_then_booked,
    ),
    ...exampleSection(
      "Set C — booked, then Releas, then Booked again",
      "Someone edited an already-booked job in Granot. Watch `est_cf` / `estimate` / `payment` across the Releas and second Booked — those fields often move. Priority stays 5. There is usually no new Priority Update for the edit. This is the progression we have to handle without asking the owner to “fix Priority.”",
      examples.booked_then_releas_then_booked,
    ),
    ...exampleSection(
      "Set D — quoted (Priority 1), later Priority 5 + Booked, then Releas + Booked",
      "Closest thing in this window to “Priority was not 5 when the job was worked, then it was booked, then it was edited.” The book itself still arrives as Priority 5 + Booked together. The later Releas + Booked cycles are booking edits after it was already booked.",
      examples.quote_then_book_then_releas_booked,
    ),
    ...exampleSection(
      "Set E — Releas then Booked with no Priority Update webhook at all",
      "These jobs have booking-status webhooks only. The bodies already say Priority 5. That matches “the job was already booked / already Priority 5, and the owner or agent released and booked it again.” If we required a Priority Update before handling Booked, these jobs would stall.",
      examples.releas_then_booked_no_priority_webhook,
    ),
    ...exampleSection(
      "Set F — booking webhooks only (any Booked / Releas mix, no Priority Update)",
      "Same independence proof as Set E, including shorter Releas → Booked pairs.",
      examples.booking_webhooks_only,
    ),
    ...exampleSection(
      "Set G — Priority Update only (no Booked / Releas)",
      "Most receipts in this window are this. Agents change Priority 8 / 7 / 1 / 2 / 9 all day and the job is never booked. This is why Priority 5 on a later day is still not a booking.",
      examples.priority_webhooks_only,
    ),
    "## How the bodies differ",
    "",
    "Priority Update bodies do **not** include `payment` or `balance`. Booked and Releas bodies do. `rep` is usually empty on Priority Update and filled on Booked / Releas. Fields below are redacted for customer identity.",
    "",
    "### `event_type: \"priority_update\"`",
    "",
    "```json",
    JSON.stringify(shapeExamples.priority_update, null, 2),
    "```",
    "",
    "### `event_type: \"Booked\"`",
    "",
    "```json",
    JSON.stringify(shapeExamples.Booked, null, 2),
    "```",
    "",
    "### `event_type: \"Releas\"`",
    "",
    "```json",
    JSON.stringify(shapeExamples.Releas, null, 2),
    "```",
    "",
    "## Payload keys actually present",
    "",
    ...Object.entries(manifest.payload_key_inventory).flatMap(([bucket, keys]) => [
      `### ${bucket}`,
      "",
      markdownTable(
        ["field", "receipts that have it"],
        Object.entries(keys)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([field, n]) => [field, String(n)]),
      ),
    ]),
    "## Observation pairing (normalized, not raw receipts)",
    "",
    "Observations are the normalized rows the processor sees. Receipt counts are higher because capture started before every receipt was materialized as an Observation. Pairing below is job-level from Observations only.",
    "",
    "```json",
    JSON.stringify(observationPairing, null, 2),
    "```",
    "",
  ].join("\n");

  const stamp = generatedAt.toISOString().replaceAll(":", "-");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const markdownPath = path.join(OUTPUT_DIR, `owner-briefing-${stamp}.md`);
  const jsonPath = path.join(OUTPUT_DIR, `owner-briefing-${stamp}.json`);
  await writeFile(markdownPath, markdown, { encoding: "utf8", mode: 0o600 });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const latestMarkdownPath = path.join(OUTPUT_DIR, "owner-briefing-latest.md");
  const latestJsonPath = path.join(OUTPUT_DIR, "owner-briefing-latest.json");
  await writeFile(latestMarkdownPath, markdown, { encoding: "utf8", mode: 0o600 });
  await writeFile(latestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await mongoose.disconnect();
  process.stdout.write(`Wrote ${markdownPath}\nWrote ${jsonPath}\n`);
  process.stdout.write(`Wrote ${latestMarkdownPath}\nWrote ${latestJsonPath}\n`);
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("export-granot-priority-booking-examples.ts");
}

if (isDirectExecution()) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => undefined);
    }
    process.exitCode = 1;
  });
}
