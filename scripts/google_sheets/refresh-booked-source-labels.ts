/**
 * Enqueue idempotent booking-chain sheet sync jobs so the deployed Booked Deals
 * projection rewrites Source cells with form/call-specific source labels.
 *
 * Dry run:
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/refresh-booked-source-labels.ts --dry-run
 *
 * Apply:
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/refresh-booked-source-labels.ts --apply
 *
 * Optional:
 *   --limit N      Cap eligible bookings for a smoke run.
 */

import process from "node:process";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { BookedLead } from "../../api/models/BookedLead";
import { enqueueSheetSyncJob } from "../../api/services/sheetSync";

type CliOptions = {
  apply: boolean;
  limit: number;
};

type LeanBookedLead = {
  _id: mongoose.Types.ObjectId;
  lead_ref?: unknown;
  lead_model?: string | null;
  is_referral_booking?: boolean | null;
};

type RefreshSummary = {
  scanned: number;
  eligible: number;
  enqueued: number;
  skipped: number;
  failed: number;
  sampleIds: string[];
};

function parseCliOptions(argv: string[]): CliOptions {
  let apply = false;
  let limit = 0;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--limit") {
      const rawLimit = argv[index + 1];
      if (!rawLimit) {
        throw new Error("--limit requires a number");
      }
      limit = parseLimit(rawLimit);
      index++;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, limit };
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return Math.floor(parsed);
}

function isEligibleBooking(booking: LeanBookedLead): boolean {
  return (
    booking.is_referral_booking !== true &&
    Boolean(booking.lead_ref) &&
    (booking.lead_model === "FormLead" || booking.lead_model === "CallLead")
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  await connectMongo();

  const query = BookedLead.find(
    {
      is_referral_booking: { $ne: true },
      lead_ref: { $exists: true, $ne: null },
      lead_model: { $in: ["FormLead", "CallLead"] },
    },
    { _id: 1, lead_ref: 1, lead_model: 1, is_referral_booking: 1 },
  ).sort({ createdAt: 1 });

  if (options.limit > 0) {
    query.limit(options.limit);
  }

  const bookings = await query.lean<LeanBookedLead[]>().exec();
  const summary: RefreshSummary = {
    scanned: bookings.length,
    eligible: 0,
    enqueued: 0,
    skipped: 0,
    failed: 0,
    sampleIds: [],
  };

  for (const booking of bookings) {
    const bookingId = booking._id.toString();
    if (!isEligibleBooking(booking)) {
      summary.skipped++;
      continue;
    }

    summary.eligible++;
    if (summary.sampleIds.length < 10) {
      summary.sampleIds.push(bookingId);
    }

    if (!options.apply) {
      continue;
    }

    try {
      await enqueueSheetSyncJob(
        {
          resource: "booking_chain",
          operation: "booked_lead.source_label_refresh",
          bookingId,
        },
        {
          createdBy: "script",
          dueAt: new Date(),
        },
      );
      summary.enqueued++;
      if (summary.enqueued % 100 === 0) {
        console.info(`Enqueued ${summary.enqueued} booking-chain refresh jobs...`);
      }
    } catch (error) {
      summary.failed++;
      console.error(
        `Failed to enqueue booking ${bookingId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.info(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        ...summary,
      },
      null,
      2,
    ),
  );

  if (!options.apply) {
    console.info("Dry run only. Re-run with --apply to enqueue sheet-sync jobs.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
