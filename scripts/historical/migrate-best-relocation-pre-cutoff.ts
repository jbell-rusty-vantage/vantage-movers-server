/**
 * Move Best Relocation leads before 2026-04-30, and only the bookings and
 * cancellations connected to those leads, from `vantagemovers` to
 * `vantagemovershistorical`. Matching is always rooted at the lead timestamp.
 *
 * Dry run (default):
 *   pnpm exec node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
 *     scripts/historical/migrate-best-relocation-pre-cutoff.ts
 *
 * Live:
 *   pnpm exec node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
 *     scripts/historical/migrate-best-relocation-pre-cutoff.ts \
 *     --apply --confirm=best_relocation_leads-before-2026-04-30
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import type { sheets_v4 } from "googleapis";
import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getMongoDatabaseName,
  SHEET_TAB_NAMES,
} from "../../src/config/domain";
import { connectMongo } from "../../src/db";
import {
  normalizeComparisonName,
  normalizeJobNo,
  normalizeSubmissionLid,
} from "../../src/services/bookings/bookingIdentity";
import { getSheetsClient } from "../../src/services/googleSheets/auth";

const PRODUCTION_DB = "vantagemovers";
const HISTORICAL_DB = "vantagemovershistorical";
const SOURCE_COMPANY = "best_relocation_leads";
const HISTORICAL_SOURCE_ALIASES = [SOURCE_COMPANY, "best_relocation"] as const;
const CUTOFF = new Date("2026-04-30T00:00:00.000Z");
const CONFIRMATION = `${SOURCE_COMPANY}-before-2026-04-30`;
const BATCH_ID = "best-relocation-pre-2026-04-30-production-correction";
const OUTPUT_DIR = path.join(process.cwd(), "scripts", "output");
const EXPECTED_LIVE_COUNTS = {
  formLeads: 651,
  callLeads: 205,
  bookings: 72,
  cancellations: 6,
} as const;

type Doc = Record<string, unknown> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

type Scope = {
  formLeads: Doc[];
  callLeads: Doc[];
  bookings: Doc[];
  cancellations: Doc[];
  customers: Doc[];
  agents: Doc[];
};

type SheetPlan = {
  spreadsheetId: string;
  tabName: string;
  sheetId: number;
  mongoIdColumn: number;
  mongoIds: string[];
  rowNumbers: number[];
};

type DestinationMappings = {
  leadIds: Map<string, mongoose.Types.ObjectId>;
  bookingIds: Map<string, mongoose.Types.ObjectId>;
  cancellationIds: Map<string, mongoose.Types.ObjectId>;
  existingLeadIds: Set<string>;
  existingBookingIds: Set<string>;
  existingCancellationIds: Set<string>;
};

const FORM_FIELDS = [
  "source_company",
  "name",
  "source_company_site",
  "timestamp",
  "lid",
  "normalized_lid",
  "pickup_city",
  "pickup_zip",
  "delivery_city",
  "destination_zip",
  "pickup_state",
  "delivery_state",
  "move_size",
  "move_date",
  "ref_no",
  "booked",
  "over_2000",
  "over_4000",
  "local",
  "email",
  "phone_number",
  "normalized_phone_number",
  "cpl",
  "quoted",
  "post_to_granot",
  "cancelled",
  "cubic_feet",
  "createdAt",
  "updatedAt",
] as const;

const CALL_FIELDS = [
  "source_company",
  "source_company_site",
  "timestamp",
  "job_no",
  "normalized_job_no",
  "name",
  "email",
  "phone_number",
  "normalized_phone_number",
  "duration",
  "start_time",
  "end_time",
  "booked",
  "cancelled",
  "over_2000",
  "over_4000",
  "local",
  "pickup_city",
  "pickup_zip",
  "delivery_city",
  "delivery_zip",
  "pickup_state",
  "delivery_state",
  "cubic_feet",
  "cpl",
  "createdAt",
  "updatedAt",
] as const;

const BOOKING_FIELDS = [
  "timestamp",
  "book_date",
  "job_no",
  "normalized_job_no",
  "customer",
  "lead_ref",
  "lead_model",
  "agent_allocations",
  "total_binder_amount",
  "deposit_amount",
  "merchant",
  "source",
  "submission_id",
  "local",
  "over_2000",
  "over_4000",
  "cancelled",
  "createdAt",
  "updatedAt",
] as const;

const CANCELLATION_FIELDS = [
  "timestamp",
  "booked_lead",
  "customer",
  "lead_ref",
  "lead_model",
  "reason",
  "notes",
  "cancelled_by",
  "cancel_date",
  "agent",
  "book_date",
  "job_no",
  "customer_name",
  "refund_amount",
  "merchant",
  "source",
  "createdAt",
  "updatedAt",
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const confirmation = process.argv
    .find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);
  if (apply && confirmation !== CONFIRMATION) {
    throw new Error(`Live migration requires --confirm=${CONFIRMATION}`);
  }
  if (apply && process.env.TEST_MODE?.trim().toLowerCase() !== "false") {
    throw new Error("Live migration requires TEST_MODE=false.");
  }
  if (apply && getMongoDatabaseName() !== PRODUCTION_DB) {
    throw new Error(
      `Refusing live migration from "${getMongoDatabaseName()}"; expected "${PRODUCTION_DB}".`,
    );
  }

  await connectMongo();
  const production = mongoose.connection.useDb(PRODUCTION_DB, { useCache: true }).db;
  const historical = mongoose.connection.useDb(HISTORICAL_DB, { useCache: true }).db;
  if (!production || !historical) throw new Error("MongoDB connections are not ready.");

  const scope = await loadScope(production);
  await assertRelationshipIntegrity(production, scope);
  const mappings = await buildDestinationMappings(historical, scope);
  if (apply) assertExpectedLiveScope(scope, mappings);
  const sheetPlan = await buildSheetPlan(scope);
  const summary = summarize(scope, sheetPlan, mappings, apply);
  const artifactPath = await writeArtifact("preflight", { summary, scope, sheetPlan });

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Recovery/preflight artifact: ${artifactPath}`);
  if (!apply) {
    console.log(`Dry run complete. Re-run with --apply --confirm=${CONFIRMATION}`);
    return;
  }

  await writeMigrationJournal(production, "preflight_complete", scope, artifactPath);
  await applySheetPlan(sheetPlan);
  await writeMigrationJournal(production, "sheets_deleted", scope, artifactPath);
  await moveMongoScope(production, historical, scope, mappings);
  await writeMigrationJournal(production, "mongo_moved", scope, artifactPath);
  await verifyMongoMove(production, historical, scope, mappings);
  const remainingSheetRows = await countRemainingSheetRows(scope);
  if (remainingSheetRows !== 0) {
    throw new Error(`Mongo move committed, but ${remainingSheetRows} target sheet row(s) remain.`);
  }
  const completionPath = await writeArtifact("completed", {
    ...summary,
    completedAt: new Date().toISOString(),
    remainingSheetRows,
  });
  await writeMigrationJournal(production, "completed", scope, completionPath);
  console.log(`Migration complete. Completion artifact: ${completionPath}`);
}

async function loadScope(production: mongoose.mongo.Db): Promise<Scope> {
  const leadFilter = { source_company: SOURCE_COMPANY, timestamp: { $lt: CUTOFF } };
  const [formLeads, callLeads] = await Promise.all([
    production.collection<Doc>("form_leads").find(leadFilter).toArray(),
    production.collection<Doc>("call_leads").find(leadFilter).toArray(),
  ]);
  const leadIds = [...formLeads, ...callLeads].map((lead) => lead._id);
  const bookedBackRefs = idsFrom([...formLeads, ...callLeads], "booked");
  const bookings = leadIds.length
    ? await production
        .collection<Doc>("booked_leads")
        .find({ $or: [{ lead_ref: { $in: leadIds } }, { _id: { $in: bookedBackRefs } }] })
        .toArray()
    : [];
  const bookingIds = bookings.map((booking) => booking._id);
  const cancellationBackRefs = idsFrom([...formLeads, ...callLeads, ...bookings], "cancelled");
  const cancellations = bookingIds.length
    ? await production
        .collection<Doc>("cancelled_leads")
        .find({
          $or: [
            { booked_lead: { $in: bookingIds } },
            { lead_ref: { $in: leadIds } },
            { _id: { $in: cancellationBackRefs } },
          ],
        })
        .toArray()
    : [];
  const customerIds = idsFrom([...bookings, ...cancellations], "customer");
  const agentIds = uniqueObjectIds(
    bookings.flatMap((booking) => {
      const allocations = Array.isArray(booking.agent_allocations)
        ? booking.agent_allocations
        : [];
      return allocations.map((allocation) =>
        isRecord(allocation) ? allocation.agent : undefined,
      );
    }),
  );
  const [customers, agents] = await Promise.all([
    customerIds.length
      ? production.collection<Doc>("customers").find({ _id: { $in: customerIds } }).toArray()
      : [],
    agentIds.length
      ? production.collection<Doc>("agents").find({ _id: { $in: agentIds } }).toArray()
      : [],
  ]);
  return { formLeads, callLeads, bookings, cancellations, customers, agents };
}

async function assertRelationshipIntegrity(
  production: mongoose.mongo.Db,
  scope: Scope,
): Promise<void> {
  const leads = [...scope.formLeads, ...scope.callLeads];
  const leadIds = new Set(leads.map(idString));
  const bookingIds = new Set(scope.bookings.map(idString));
  const cancellationIds = new Set(scope.cancellations.map(idString));
  const formLeadIds = new Set(scope.formLeads.map(idString));
  const callLeadIds = new Set(scope.callLeads.map(idString));
  const errors: string[] = [];

  for (const lead of leads) {
    checkReference(errors, lead, "booked", bookingIds, "selected booking");
    checkReference(errors, lead, "cancelled", cancellationIds, "selected cancellation");
  }
  for (const booking of scope.bookings) {
    checkReference(errors, booking, "lead_ref", leadIds, "selected lead", true);
    checkLeadModel(errors, booking, formLeadIds, callLeadIds);
    checkReference(errors, booking, "cancelled", cancellationIds, "selected cancellation");
  }
  for (const cancellation of scope.cancellations) {
    checkReference(errors, cancellation, "booked_lead", bookingIds, "selected booking", true);
    checkReference(errors, cancellation, "lead_ref", leadIds, "selected lead");
    if (cancellation.lead_ref) {
      checkLeadModel(errors, cancellation, formLeadIds, callLeadIds);
    }
  }

  const leadObjectIds = [...scope.formLeads, ...scope.callLeads].map((lead) => lead._id);
  const bookingObjectIds = scope.bookings.map((booking) => booking._id);
  const cancellationObjectIds = scope.cancellations.map((cancellation) => cancellation._id);
  const [foreignFormRefs, foreignCallRefs] = await Promise.all([
    production.collection("form_leads").countDocuments({
      _id: { $nin: leadObjectIds },
      $or: [
        { booked: { $in: bookingObjectIds } },
        { cancelled: { $in: cancellationObjectIds } },
      ],
    }),
    production.collection("call_leads").countDocuments({
      _id: { $nin: leadObjectIds },
      $or: [
        { booked: { $in: bookingObjectIds } },
        { cancelled: { $in: cancellationObjectIds } },
      ],
    }),
  ]);
  if (foreignFormRefs || foreignCallRefs) {
    errors.push(
      `${foreignFormRefs + foreignCallRefs} non-selected lead(s) reference selected booking/cancellation records`,
    );
  }
  if (errors.length) throw new Error(`Relationship preflight failed:\n- ${errors.join("\n- ")}`);
}

async function buildDestinationMappings(
  historical: mongoose.mongo.Db,
  scope: Scope,
): Promise<DestinationMappings> {
  const productionLeads = [...scope.formLeads, ...scope.callLeads];
  const productionLeadIds = productionLeads.map((lead) => lead._id);
  const lids = scope.formLeads
    .map((lead) => lead.lid)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const [historicalForms, historicalCalls] = await Promise.all([
    historical
      .collection<Doc>("form_leads")
      .find({
        $or: [
          { _id: { $in: productionLeadIds }, source_company: { $in: HISTORICAL_SOURCE_ALIASES } },
          { lid: { $in: lids }, source_company: { $in: HISTORICAL_SOURCE_ALIASES } },
        ],
      })
      .toArray(),
    historical
      .collection<Doc>("call_leads")
      .find({
        source_company: { $in: HISTORICAL_SOURCE_ALIASES },
        // Legacy historical timestamps are true Eastern instants, while the
        // production owner-facing timestamps store wall-clock components in
        // UTC. Include the following day and reconcile through raw Date/Time.
        timestamp: { $lt: new Date(CUTOFF.getTime() + 24 * 60 * 60 * 1000) },
      })
      .toArray(),
  ]);
  const formByLid = uniqueIndex(historicalForms, (lead) => stringValue(lead.lid), "form LID");
  const callByIdentity = uniqueIndex(
    historicalCalls,
    historicalCallIdentity,
    "call timestamp/phone",
  );
  const historicalLeadById = new Map(
    [...historicalForms, ...historicalCalls].map((lead) => [idString(lead), lead]),
  );
  const leadIds = new Map<string, mongoose.Types.ObjectId>();
  for (const lead of scope.formLeads) {
    const existing =
      historicalLeadById.get(idString(lead)) ?? formByLid.get(stringValue(lead.lid) ?? "");
    leadIds.set(idString(lead), existing?._id ?? lead._id);
  }
  for (const lead of scope.callLeads) {
    const existing =
      historicalLeadById.get(idString(lead)) ??
      callByIdentity.get(historicalCallIdentity(lead) ?? "");
    leadIds.set(idString(lead), existing?._id ?? lead._id);
  }

  assertInjectiveMapping(leadIds, "lead");
  const jobs = scope.bookings
    .map((booking) => normalizeJobNo(stringValue(booking.job_no)))
    .filter((value): value is string => Boolean(value));
  const historicalBookedRefs = idsFrom(
    [...historicalForms, ...historicalCalls],
    "booked",
  );
  const historicalBookings = await historical
    .collection<Doc>("booked_leads")
    .find({
      $or: [
        { _id: { $in: scope.bookings.map((booking) => booking._id) } },
        { _id: { $in: historicalBookedRefs } },
        { normalized_job_no: { $in: jobs } },
        { job_no: { $in: scope.bookings.map((booking) => booking.job_no).filter(Boolean) } },
      ],
    })
    .toArray();
  const historicalBookingById = new Map(
    historicalBookings.map((booking) => [idString(booking), booking]),
  );
  const bookingsByJob = multiIndex(
    historicalBookings,
    (booking) => normalizeJobNo(stringValue(booking.job_no)),
  );
  const bookingIds = new Map<string, mongoose.Types.ObjectId>();
  for (const booking of scope.bookings) {
    const mappedLeadId = objectIdString(booking.lead_ref)
      ? leadIds.get(objectIdString(booking.lead_ref)!)
      : undefined;
    const historicalLead = mappedLeadId
      ? historicalLeadById.get(mappedLeadId.toString())
      : undefined;
    const leadBookingId = objectIdValue(historicalLead?.booked);
    const existing =
      historicalBookingById.get(idString(booking)) ??
      (leadBookingId ? historicalBookingById.get(leadBookingId.toString()) : undefined) ??
      resolveRelatedBookingCandidate(
        bookingsByJob.get(normalizeJobNo(stringValue(booking.job_no)) ?? "") ?? [],
        mappedLeadId,
        normalizeJobNo(stringValue(booking.job_no)) ?? "",
      );
    validateHistoricalBooking(existing, mappedLeadId, leadBookingId, booking);
    bookingIds.set(idString(booking), existing?._id ?? booking._id);
  }
  assertInjectiveMapping(bookingIds, "booking");

  const cancellationJobs = scope.cancellations
    .map((cancellation) => normalizeJobNo(stringValue(cancellation.job_no)))
    .filter((value): value is string => Boolean(value));
  const historicalCancellationRefs = idsFrom(
    [...historicalForms, ...historicalCalls, ...historicalBookings],
    "cancelled",
  );
  const historicalCancellations = await historical
    .collection<Doc>("cancelled_leads")
    .find({
      $or: [
        { _id: { $in: scope.cancellations.map((cancellation) => cancellation._id) } },
        { _id: { $in: historicalCancellationRefs } },
        { normalized_job_no: { $in: cancellationJobs } },
        {
          job_no: {
            $in: scope.cancellations
              .map((cancellation) => cancellation.job_no)
              .filter(Boolean),
          },
        },
      ],
    })
    .toArray();
  const historicalCancellationById = new Map(
    historicalCancellations.map((cancellation) => [idString(cancellation), cancellation]),
  );
  const cancellationsByJob = multiIndex(
    historicalCancellations,
    (cancellation) => normalizeJobNo(stringValue(cancellation.job_no)),
  );
  const cancellationIds = new Map<string, mongoose.Types.ObjectId>();
  for (const cancellation of scope.cancellations) {
    const productionBookingId = objectIdString(cancellation.booked_lead);
    const mappedBookingId = productionBookingId
      ? bookingIds.get(productionBookingId)
      : undefined;
    const historicalBooking = mappedBookingId
      ? historicalBookingById.get(mappedBookingId.toString())
      : undefined;
    const bookingCancellationId = objectIdValue(historicalBooking?.cancelled);
    const existing =
      historicalCancellationById.get(idString(cancellation)) ??
      (bookingCancellationId
        ? historicalCancellationById.get(bookingCancellationId.toString())
        : undefined) ??
      resolveRelatedCancellationCandidate(
        cancellationsByJob.get(
          normalizeJobNo(stringValue(cancellation.job_no)) ?? "",
        ) ?? [],
        mappedBookingId,
        mappedReference(cancellation.lead_ref, leadIds),
        normalizeJobNo(stringValue(cancellation.job_no)) ?? "",
      );
    validateHistoricalCancellation(
      existing,
      mappedBookingId,
      bookingCancellationId,
      cancellation,
    );
    cancellationIds.set(idString(cancellation), existing?._id ?? cancellation._id);
  }
  assertInjectiveMapping(cancellationIds, "cancellation");

  return {
    leadIds,
    bookingIds,
    cancellationIds,
    existingLeadIds: new Set([...historicalLeadById.keys()]),
    existingBookingIds: new Set([...historicalBookingById.keys()]),
    existingCancellationIds: new Set([...historicalCancellationById.keys()]),
  };
}

async function buildSheetPlan(scope: Scope): Promise<SheetPlan[]> {
  const leadsSheet = getMasterLeadsSheetContainerId();
  const bookedSheet = getMasterBookedSheetContainerId();
  const specs = [
    {
      spreadsheetId: leadsSheet,
      tabName: SHEET_TAB_NAMES.forms,
      headers: FORM_SHEET_HEADERS,
      ids: new Set(scope.formLeads.map(idString)),
    },
    {
      spreadsheetId: leadsSheet,
      tabName: SHEET_TAB_NAMES.duplicates,
      headers: FORM_SHEET_HEADERS,
      ids: new Set(scope.formLeads.map(idString)),
    },
    {
      spreadsheetId: leadsSheet,
      tabName: SHEET_TAB_NAMES.badLeads,
      headers: FORM_SHEET_HEADERS,
      ids: new Set(scope.formLeads.map(idString)),
    },
    {
      spreadsheetId: leadsSheet,
      tabName: SHEET_TAB_NAMES.calls,
      headers: CALL_SHEET_HEADERS,
      ids: new Set(scope.callLeads.map(idString)),
    },
    {
      spreadsheetId: leadsSheet,
      tabName: SHEET_TAB_NAMES.duplicateCalls,
      headers: CALL_SHEET_HEADERS,
      ids: new Set(scope.callLeads.map(idString)),
    },
    {
      spreadsheetId: bookedSheet,
      tabName: SHEET_TAB_NAMES.bookedDeals,
      headers: BOOKED_SHEET_HEADERS,
      ids: new Set(scope.bookings.map(idString)),
    },
    {
      spreadsheetId: bookedSheet,
      tabName: SHEET_TAB_NAMES.cancelledDeals,
      headers: CANCELLED_SHEET_HEADERS,
      ids: new Set(scope.cancellations.map(idString)),
    },
  ];
  const sheets = getSheetsClient();
  const metadataBySpreadsheet = new Map<string, Map<string, number>>();
  const plans: SheetPlan[] = [];
  for (const spec of specs) {
    let metadata = metadataBySpreadsheet.get(spec.spreadsheetId);
    if (!metadata) {
      metadata = await loadSheetIds(sheets, spec.spreadsheetId);
      metadataBySpreadsheet.set(spec.spreadsheetId, metadata);
    }
    const sheetId = metadata.get(spec.tabName);
    if (sheetId === undefined) throw new Error(`Missing sheet tab "${spec.tabName}".`);
    const mongoIdColumn = spec.headers.indexOf("Mongo ID");
    if (mongoIdColumn < 0) throw new Error(`No Mongo ID header configured for ${spec.tabName}.`);
    const mongoIds = [...spec.ids];
    const rowNumbers = await loadMatchingRowNumbers(
      sheets,
      spec.spreadsheetId,
      spec.tabName,
      mongoIdColumn,
      new Set(mongoIds),
    );
    plans.push({
      spreadsheetId: spec.spreadsheetId,
      tabName: spec.tabName,
      sheetId,
      mongoIdColumn,
      mongoIds,
      rowNumbers,
    });
  }
  return plans;
}

async function applySheetPlan(plans: SheetPlan[]): Promise<void> {
  const sheets = getSheetsClient();
  for (const plan of plans) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: plan.spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: plan.sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: "DATE_TIME",
                    pattern: "M/d/yyyy HH:mm:ss",
                  },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      },
    });
    // Row numbers from preflight are informational only. Re-read the Mongo ID
    // column immediately before deletion so stale row indexes cannot target a
    // different record after sheet inserts/deletes.
    const currentRows = await loadMatchingRowNumbers(
      sheets,
      plan.spreadsheetId,
      plan.tabName,
      plan.mongoIdColumn,
      new Set(plan.mongoIds),
    );
    const ranges = contiguousRanges(currentRows).sort((a, b) => b.start - a.start);
    for (let offset = 0; offset < ranges.length; offset += 400) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: plan.spreadsheetId,
        requestBody: {
          requests: ranges.slice(offset, offset + 400).map((range) => ({
            deleteDimension: {
              range: {
                sheetId: plan.sheetId,
                dimension: "ROWS",
                startIndex: range.start - 1,
                endIndex: range.end,
              },
            },
          })),
        },
      });
    }
  }
}

async function moveMongoScope(
  production: mongoose.mongo.Db,
  historical: mongoose.mongo.Db,
  scope: Scope,
  mappings: DestinationMappings,
): Promise<void> {
  const support = missingHistoricalSupport(scope, mappings);
  const session = await mongoose.connection.startSession();
  try {
    await session.withTransaction(async () => {
      await assertScopeUnchanged(production, scope, session);
      await assertDestinationMappingsExist(historical, scope, mappings, session);
      await insertManyIfAbsent(
        historical.collection<Doc>("customers"),
        support.customers.map((doc) =>
          project(doc, ["full_name", "normalized_name", "phone_number", "email", "createdAt", "updatedAt"]),
        ),
        session,
      );
      await insertManyIfAbsent(
        historical.collection<Doc>("agents"),
        support.agents.map((doc) =>
          project(doc, ["name", "normalized_name", "active", "role", "created_from", "createdAt", "updatedAt"]),
        ),
        session,
      );
      await replaceMany(
        historical.collection<Doc>("form_leads"),
        scope.formLeads
          .filter((doc) => !isMappedToExisting(doc, mappings.leadIds, mappings.existingLeadIds))
          .map((doc) => remapRelationships(toHistoricalForm(doc), mappings)),
        session,
      );
      await replaceMany(
        historical.collection<Doc>("call_leads"),
        scope.callLeads
          .filter((doc) => !isMappedToExisting(doc, mappings.leadIds, mappings.existingLeadIds))
          .map((doc) => remapRelationships(toHistoricalCall(doc), mappings)),
        session,
      );
      await replaceMany(
        historical.collection<Doc>("booked_leads"),
        scope.bookings
          .filter(
            (doc) =>
              !isMappedToExisting(doc, mappings.bookingIds, mappings.existingBookingIds),
          )
          .map((doc) => remapRelationships(toHistoricalBooking(doc), mappings)),
        session,
      );
      await replaceMany(
        historical.collection<Doc>("cancelled_leads"),
        scope.cancellations
          .filter(
            (doc) =>
              !isMappedToExisting(
                doc,
                mappings.cancellationIds,
                mappings.existingCancellationIds,
              ),
          )
          .map((doc) => remapRelationships(toHistoricalCancellation(doc), mappings)),
        session,
      );
      await linkHistoricalRelationships(historical, scope, mappings, session);

      await production
        .collection("cancelled_leads")
        .deleteMany({ _id: { $in: scope.cancellations.map((doc) => doc._id) } }, { session });
      await production
        .collection("booked_leads")
        .deleteMany({ _id: { $in: scope.bookings.map((doc) => doc._id) } }, { session });
      await production
        .collection("form_leads")
        .deleteMany({ _id: { $in: scope.formLeads.map((doc) => doc._id) } }, { session });
      await production
        .collection("call_leads")
        .deleteMany({ _id: { $in: scope.callLeads.map((doc) => doc._id) } }, { session });
    });
  } finally {
    await session.endSession();
  }
}

async function replaceMany(
  collection: mongoose.mongo.Collection<Doc>,
  docs: Doc[],
  session: mongoose.mongo.ClientSession,
): Promise<void> {
  if (!docs.length) return;
  await collection.bulkWrite(
    docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
    { ordered: true, session },
  );
}

async function insertManyIfAbsent(
  collection: mongoose.mongo.Collection<Doc>,
  docs: Doc[],
  session: mongoose.mongo.ClientSession,
): Promise<void> {
  if (!docs.length) return;
  await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: true, session },
  );
}

async function assertScopeUnchanged(
  production: mongoose.mongo.Db,
  scope: Scope,
  session: mongoose.mongo.ClientSession,
): Promise<void> {
  const checks = [
    ["form_leads", scope.formLeads],
    ["call_leads", scope.callLeads],
    ["booked_leads", scope.bookings],
    ["cancelled_leads", scope.cancellations],
  ] as const;
  for (const [collectionName, expected] of checks) {
    const current = await production
      .collection<Doc>(collectionName)
      .find({ _id: { $in: expected.map((doc) => doc._id) } }, { session })
      .project<Doc>({ _id: 1, updatedAt: 1, source_company: 1, timestamp: 1 })
      .toArray();
    const currentById = new Map(current.map((doc) => [idString(doc), doc]));
    for (const expectedDoc of expected) {
      const actual = currentById.get(idString(expectedDoc));
      if (!actual) {
        throw new Error(`${collectionName} ${idString(expectedDoc)} disappeared after preflight.`);
      }
      if (dateMillis(actual.updatedAt) !== dateMillis(expectedDoc.updatedAt)) {
        throw new Error(`${collectionName} ${idString(expectedDoc)} changed after preflight.`);
      }
      if (
        (collectionName === "form_leads" || collectionName === "call_leads") &&
        (actual.source_company !== SOURCE_COMPANY ||
          !(actual.timestamp instanceof Date) ||
          actual.timestamp >= CUTOFF)
      ) {
        throw new Error(`${collectionName} ${idString(expectedDoc)} left the selected scope.`);
      }
    }
  }

  const leadIds = [...scope.formLeads, ...scope.callLeads].map((lead) => lead._id);
  const bookingIds = scope.bookings.map((booking) => booking._id);
  const [bookingCount, cancellationCount] = await Promise.all([
    production.collection("booked_leads").countDocuments(
      {
        $or: [
          { lead_ref: { $in: leadIds } },
          { _id: { $in: idsFrom([...scope.formLeads, ...scope.callLeads], "booked") } },
        ],
      },
      { session },
    ),
    production.collection("cancelled_leads").countDocuments(
      {
        $or: [
          { booked_lead: { $in: bookingIds } },
          { lead_ref: { $in: leadIds } },
          {
            _id: {
              $in: idsFrom(
                [...scope.formLeads, ...scope.callLeads, ...scope.bookings],
                "cancelled",
              ),
            },
          },
        ],
      },
      { session },
    ),
  ]);
  if (
    bookingCount !== scope.bookings.length ||
    cancellationCount !== scope.cancellations.length
  ) {
    throw new Error(
      `Connected scope changed after preflight: bookings=${bookingCount}/${scope.bookings.length}, cancellations=${cancellationCount}/${scope.cancellations.length}.`,
    );
  }
}

async function assertDestinationMappingsExist(
  historical: mongoose.mongo.Db,
  scope: Scope,
  mappings: DestinationMappings,
  session: mongoose.mongo.ClientSession,
): Promise<void> {
  const checks = [
    ["form_leads", scope.formLeads, mappings.leadIds, mappings.existingLeadIds],
    ["call_leads", scope.callLeads, mappings.leadIds, mappings.existingLeadIds],
    [
      "booked_leads",
      scope.bookings,
      mappings.bookingIds,
      mappings.existingBookingIds,
    ],
    [
      "cancelled_leads",
      scope.cancellations,
      mappings.cancellationIds,
      mappings.existingCancellationIds,
    ],
  ] as const;
  for (const [collectionName, sourceDocs, mapping, existingIds] of checks) {
    const expectedIds = sourceDocs
      .map((doc) => mapping.get(idString(doc))!)
      .filter((id) => existingIds.has(id.toString()));
    if (!expectedIds.length) continue;
    const count = await historical.collection(collectionName).countDocuments(
      { _id: { $in: expectedIds } },
      { session },
    );
    if (count !== expectedIds.length) {
      throw new Error(
        `${collectionName} destination changed after preflight: ${count}/${expectedIds.length} reused records remain.`,
      );
    }
  }
}

async function linkHistoricalRelationships(
  historical: mongoose.mongo.Db,
  scope: Scope,
  mappings: DestinationMappings,
  session: mongoose.mongo.ClientSession,
): Promise<void> {
  for (const [collectionName, leads] of [
    ["form_leads", scope.formLeads],
    ["call_leads", scope.callLeads],
  ] as const) {
    const operations = leads.map((lead) => {
      const update: Record<string, unknown> = { sheet_booked: Boolean(lead.booked) };
      const booked = mappedReference(lead.booked, mappings.bookingIds);
      const cancelled = mappedReference(lead.cancelled, mappings.cancellationIds);
      if (booked) update.booked = booked;
      if (cancelled) update.cancelled = cancelled;
      return {
        updateOne: {
          filter: { _id: mappings.leadIds.get(idString(lead))! },
          update: { $set: update },
        },
      };
    });
    if (operations.length) {
      const result = await historical
        .collection(collectionName)
        .bulkWrite(operations, { session });
      if (result.matchedCount !== operations.length) {
        throw new Error(
          `${collectionName} relationship update matched ${result.matchedCount}/${operations.length} historical records.`,
        );
      }
    }
  }

  const bookingOperations = scope.bookings.map((booking) => {
    const update: Record<string, unknown> = {};
    const leadRef = mappedReference(booking.lead_ref, mappings.leadIds);
    const cancelled = mappedReference(booking.cancelled, mappings.cancellationIds);
    if (leadRef) update.lead_ref = leadRef;
    if (booking.lead_model) update.lead_model = booking.lead_model;
    if (cancelled) update.cancelled = cancelled;
    return {
      updateOne: {
        filter: { _id: mappings.bookingIds.get(idString(booking))! },
        update: { $set: update },
      },
    };
  });
  if (bookingOperations.length) {
    const result = await historical
      .collection("booked_leads")
      .bulkWrite(bookingOperations, { session });
    if (result.matchedCount !== bookingOperations.length) {
      throw new Error(
        `booked_leads relationship update matched ${result.matchedCount}/${bookingOperations.length} historical records.`,
      );
    }
  }

  const cancellationOperations = scope.cancellations.map((cancellation) => {
    const update: Record<string, unknown> = {};
    const bookedLead = mappedReference(cancellation.booked_lead, mappings.bookingIds);
    const leadRef = mappedReference(cancellation.lead_ref, mappings.leadIds);
    if (bookedLead) update.booked_lead = bookedLead;
    if (leadRef) update.lead_ref = leadRef;
    if (cancellation.lead_model) update.lead_model = cancellation.lead_model;
    return {
      updateOne: {
        filter: { _id: mappings.cancellationIds.get(idString(cancellation))! },
        update: { $set: update },
      },
    };
  });
  if (cancellationOperations.length) {
    const result = await historical
      .collection("cancelled_leads")
      .bulkWrite(cancellationOperations, { session });
    if (result.matchedCount !== cancellationOperations.length) {
      throw new Error(
        `cancelled_leads relationship update matched ${result.matchedCount}/${cancellationOperations.length} historical records.`,
      );
    }
  }
}

async function verifyMongoMove(
  production: mongoose.mongo.Db,
  historical: mongoose.mongo.Db,
  scope: Scope,
  mappings: DestinationMappings,
): Promise<void> {
  const checks = [
    ["form_leads", scope.formLeads, mappings.leadIds],
    ["call_leads", scope.callLeads, mappings.leadIds],
    ["booked_leads", scope.bookings, mappings.bookingIds],
    ["cancelled_leads", scope.cancellations, mappings.cancellationIds],
  ] as const;
  for (const [collectionName, docs, destinationMap] of checks) {
    const ids = docs.map((doc) => doc._id);
    const destinationIds = docs.map((doc) => destinationMap.get(idString(doc))!);
    const [productionCount, historicalCount] = await Promise.all([
      production.collection(collectionName).countDocuments({ _id: { $in: ids } }),
      historical
        .collection(collectionName)
        .countDocuments({ _id: { $in: destinationIds } }),
    ]);
    if (productionCount !== 0 || historicalCount !== ids.length) {
      throw new Error(
        `${collectionName} verification failed: production=${productionCount}, historical=${historicalCount}, expected=${ids.length}`,
      );
    }
  }
}

async function countRemainingSheetRows(scope: Scope): Promise<number> {
  const plans = await buildSheetPlan(scope);
  return plans.reduce((sum, plan) => sum + plan.rowNumbers.length, 0);
}

function toHistoricalForm(doc: Doc): Doc {
  const result = withImportMetadata(project(doc, FORM_FIELDS), "FormLead");
  result.normalized_name = normalizeComparisonName(stringValue(doc.name));
  result.normalized_lid = normalizeSubmissionLid(stringValue(doc.lid));
  result.normalized_ref_no = normalizeJobNo(stringValue(doc.ref_no));
  result.sheet_booked = Boolean(doc.booked);
  return result;
}

function toHistoricalCall(doc: Doc): Doc {
  const result = withImportMetadata(project(doc, CALL_FIELDS), "CallLead");
  result.normalized_name = normalizeComparisonName(stringValue(doc.name));
  result.normalized_job_no = normalizeJobNo(stringValue(doc.job_no));
  result.sheet_booked = Boolean(doc.booked);
  return result;
}

function toHistoricalBooking(doc: Doc): Doc {
  const result = withImportMetadata(project(doc, BOOKING_FIELDS), "BookedLead");
  const customerName = stringValue(doc.customer_name);
  result.customer_name_snapshot = customerName;
  result.normalized_customer_name = normalizeComparisonName(customerName);
  result.normalized_job_no = normalizeJobNo(stringValue(doc.job_no));
  result.normalized_lid = normalizeSubmissionLid(stringValue(doc.submission_id));
  result.matched_by = "production_lead_ref";
  result.match_confidence = 1;
  return result;
}

function toHistoricalCancellation(doc: Doc): Doc {
  const result = withImportMetadata(project(doc, CANCELLATION_FIELDS), "CancelledLead");
  result.normalized_job_no = normalizeJobNo(stringValue(doc.job_no));
  result.normalized_customer_name = normalizeComparisonName(stringValue(doc.customer_name));
  return result;
}

function withImportMetadata(doc: Doc, model: string): Doc {
  return {
    ...doc,
    source_row_key: `production-migration:${model}:${doc._id.toString()}`,
    import_batch_id: BATCH_ID,
    source_workbook: "Production correction",
    source_tab: model,
  };
}

function project(doc: Doc, fields: readonly string[]): Doc {
  const result: Doc = { _id: doc._id };
  for (const field of fields) {
    if (doc[field] !== undefined) result[field] = doc[field];
  }
  return result;
}

function remapRelationships(doc: Doc, mappings: DestinationMappings): Doc {
  const originalId = idString(doc);
  doc._id =
    mappings.leadIds.get(originalId) ??
    mappings.bookingIds.get(originalId) ??
    mappings.cancellationIds.get(originalId) ??
    doc._id;
  const booked = mappedReference(doc.booked, mappings.bookingIds);
  const cancelled = mappedReference(doc.cancelled, mappings.cancellationIds);
  const leadRef = mappedReference(doc.lead_ref, mappings.leadIds);
  const bookedLead = mappedReference(doc.booked_lead, mappings.bookingIds);
  if (booked) doc.booked = booked;
  if (cancelled) doc.cancelled = cancelled;
  if (leadRef) doc.lead_ref = leadRef;
  if (bookedLead) doc.booked_lead = bookedLead;
  return doc;
}

function mappedReference(
  value: unknown,
  mapping: Map<string, mongoose.Types.ObjectId>,
): mongoose.Types.ObjectId | undefined {
  const sourceId = objectIdString(value);
  return sourceId ? mapping.get(sourceId) : undefined;
}

function isMappedToExisting(
  doc: Doc,
  mapping: Map<string, mongoose.Types.ObjectId>,
  existingIds: Set<string>,
): boolean {
  const destinationId = mapping.get(idString(doc));
  return Boolean(destinationId && existingIds.has(destinationId.toString()));
}

function countMappedExisting(
  docs: Doc[],
  mapping: Map<string, mongoose.Types.ObjectId>,
  existingIds: Set<string>,
): number {
  return docs.filter((doc) => isMappedToExisting(doc, mapping, existingIds)).length;
}

function summarize(
  scope: Scope,
  sheetPlan: SheetPlan[],
  mappings: DestinationMappings,
  apply: boolean,
) {
  const support = missingHistoricalSupport(scope, mappings);
  return {
    mode: apply ? "live" : "dry-run",
    sourceDatabase: PRODUCTION_DB,
    destinationDatabase: HISTORICAL_DB,
    sourceCompany: SOURCE_COMPANY,
    cutoffExclusive: CUTOFF.toISOString(),
    counts: {
      formLeads: scope.formLeads.length,
      callLeads: scope.callLeads.length,
      bookings: scope.bookings.length,
      cancellations: scope.cancellations.length,
      supportingCustomersCopied: support.customers.length,
      supportingAgentsCopied: support.agents.length,
      existingHistoricalLeadsReused: countMappedExisting(
        [...scope.formLeads, ...scope.callLeads],
        mappings.leadIds,
        mappings.existingLeadIds,
      ),
      existingHistoricalBookingsReused: countMappedExisting(
        scope.bookings,
        mappings.bookingIds,
        mappings.existingBookingIds,
      ),
      existingHistoricalCancellationsReused: countMappedExisting(
        scope.cancellations,
        mappings.cancellationIds,
        mappings.existingCancellationIds,
      ),
      sheetRows: Object.fromEntries(
        sheetPlan.map((plan) => [plan.tabName, plan.rowNumbers.length]),
      ),
    },
  };
}

function missingHistoricalSupport(
  scope: Scope,
  mappings: DestinationMappings,
): { customers: Doc[]; agents: Doc[] } {
  const missingBookings = scope.bookings.filter(
    (booking) =>
      !isMappedToExisting(booking, mappings.bookingIds, mappings.existingBookingIds),
  );
  const customerIds = new Set(
    idsFrom(missingBookings, "customer").map((id) => id.toString()),
  );
  const agentIds = new Set(
    uniqueObjectIds(
      missingBookings.flatMap((booking) => {
        const allocations = Array.isArray(booking.agent_allocations)
          ? booking.agent_allocations
          : [];
        return allocations.map((allocation) =>
          isRecord(allocation) ? allocation.agent : undefined,
        );
      }),
    ).map((id) => id.toString()),
  );
  return {
    customers: scope.customers.filter((customer) =>
      customerIds.has(customer._id.toString()),
    ),
    agents: scope.agents.filter((agent) => agentIds.has(agent._id.toString())),
  };
}

function assertExpectedLiveScope(
  scope: Scope,
  mappings: DestinationMappings,
): void {
  const actual = {
    formLeads: scope.formLeads.length,
    callLeads: scope.callLeads.length,
    bookings: scope.bookings.length,
    cancellations: scope.cancellations.length,
  };
  for (const key of Object.keys(EXPECTED_LIVE_COUNTS) as Array<
    keyof typeof EXPECTED_LIVE_COUNTS
  >) {
    if (actual[key] !== EXPECTED_LIVE_COUNTS[key]) {
      throw new Error(
        `Live scope count changed for ${key}: expected ${EXPECTED_LIVE_COUNTS[key]}, got ${actual[key]}.`,
      );
    }
  }
  const reused = {
    leads: countMappedExisting(
      [...scope.formLeads, ...scope.callLeads],
      mappings.leadIds,
      mappings.existingLeadIds,
    ),
    bookings: countMappedExisting(
      scope.bookings,
      mappings.bookingIds,
      mappings.existingBookingIds,
    ),
    cancellations: countMappedExisting(
      scope.cancellations,
      mappings.cancellationIds,
      mappings.existingCancellationIds,
    ),
  };
  if (
    reused.leads !== EXPECTED_LIVE_COUNTS.formLeads + EXPECTED_LIVE_COUNTS.callLeads ||
    reused.bookings !== EXPECTED_LIVE_COUNTS.bookings ||
    reused.cancellations !== EXPECTED_LIVE_COUNTS.cancellations
  ) {
    throw new Error(
      `Live historical reuse changed: leads=${reused.leads}, bookings=${reused.bookings}, cancellations=${reused.cancellations}.`,
    );
  }
}

async function writeMigrationJournal(
  production: mongoose.mongo.Db,
  status: string,
  scope: Scope,
  artifactPath: string,
): Promise<void> {
  await production
    .collection<{ _id: string; [key: string]: unknown }>("data_migration_runs")
    .updateOne(
    { _id: BATCH_ID },
    {
      $set: {
        status,
        updated_at: new Date(),
        artifact_path: artifactPath,
        source_company: SOURCE_COMPANY,
        cutoff_exclusive: CUTOFF,
        counts: {
          form_leads: scope.formLeads.length,
          call_leads: scope.callLeads.length,
          bookings: scope.bookings.length,
          cancellations: scope.cancellations.length,
        },
        ids: {
          form_leads: scope.formLeads.map(idString),
          call_leads: scope.callLeads.map(idString),
          bookings: scope.bookings.map(idString),
          cancellations: scope.cancellations.map(idString),
        },
      },
      $setOnInsert: { created_at: new Date() },
    },
      { upsert: true },
    );
}

async function writeArtifact(label: string, value: unknown): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(
    OUTPUT_DIR,
    `best-relocation-pre-cutoff-${label}-${Date.now()}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return filePath;
}

async function loadSheetIds(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Map<string, number>> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return new Map(
    (response.data.sheets ?? []).flatMap((sheet) => {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      return typeof title === "string" && typeof id === "number"
        ? [[title, id] as const]
        : [];
    }),
  );
}

async function loadMatchingRowNumbers(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  mongoIdColumn: number,
  mongoIds: Set<string>,
): Promise<number[]> {
  const column = columnLetter(mongoIdColumn + 1);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName.replace(/'/g, "''")}'!${column}:${column}`,
    majorDimension: "COLUMNS",
  });
  const values = response.data.values?.[0] ?? [];
  return values.flatMap((value, index) =>
    mongoIds.has(String(value).trim()) ? [index + 1] : [],
  );
}

function contiguousRanges(rowNumbers: number[]): { start: number; end: number }[] {
  const sorted = [...new Set(rowNumbers)].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const row of sorted) {
    const last = ranges.at(-1);
    if (last && row === last.end + 1) last.end = row;
    else ranges.push({ start: row, end: row });
  }
  return ranges;
}

function checkReference(
  errors: string[],
  doc: Doc,
  field: string,
  expectedIds: Set<string>,
  label: string,
  required = false,
): void {
  const value = doc[field];
  if (value === undefined || value === null) {
    if (required) errors.push(`${doc._id.toString()}.${field} is missing`);
    return;
  }
  const id = objectIdString(value);
  if (!id || !expectedIds.has(id)) {
    errors.push(`${doc._id.toString()}.${field} does not reference a ${label}`);
  }
}

function checkLeadModel(
  errors: string[],
  doc: Doc,
  formLeadIds: Set<string>,
  callLeadIds: Set<string>,
): void {
  const leadRef = objectIdString(doc.lead_ref);
  if (!leadRef) return;
  if (
    (doc.lead_model === "FormLead" && formLeadIds.has(leadRef)) ||
    (doc.lead_model === "CallLead" && callLeadIds.has(leadRef))
  ) {
    return;
  }
  errors.push(
    `${doc._id.toString()}.lead_model=${String(doc.lead_model)} does not match lead_ref`,
  );
}

function idsFrom(docs: Doc[], field: string): mongoose.Types.ObjectId[] {
  return uniqueObjectIds(docs.map((doc) => doc[field]));
}

function uniqueObjectIds(values: unknown[]): mongoose.Types.ObjectId[] {
  const result = new Map<string, mongoose.Types.ObjectId>();
  for (const value of values) {
    if (value instanceof mongoose.Types.ObjectId) result.set(value.toString(), value);
  }
  return [...result.values()];
}

function objectIdValue(value: unknown): mongoose.Types.ObjectId | undefined {
  return value instanceof mongoose.Types.ObjectId ? value : undefined;
}

function uniqueIndex(
  docs: Doc[],
  keyFor: (doc: Doc) => string | undefined,
  label: string,
): Map<string, Doc> {
  const result = new Map<string, Doc>();
  for (const doc of docs) {
    const key = keyFor(doc);
    if (!key) continue;
    const existing = result.get(key);
    if (existing && idString(existing) !== idString(doc)) {
      throw new Error(
        `Historical preflight found ambiguous ${label} "${key}" (${idString(existing)}, ${idString(doc)}).`,
      );
    }
    result.set(key, doc);
  }
  return result;
}

function multiIndex(
  docs: Doc[],
  keyFor: (doc: Doc) => string | undefined,
): Map<string, Doc[]> {
  const result = new Map<string, Doc[]>();
  for (const doc of docs) {
    const key = keyFor(doc);
    if (!key) continue;
    result.set(key, [...(result.get(key) ?? []), doc]);
  }
  return result;
}

function resolveRelatedBookingCandidate(
  candidates: Doc[],
  mappedLeadId: mongoose.Types.ObjectId | undefined,
  key: string,
): Doc | undefined {
  const sourceMatches = candidates.filter((candidate) =>
    isBestRelocationLabel(stringValue(candidate.source)),
  );
  const related = mappedLeadId
    ? sourceMatches.filter(
        (candidate) => objectIdString(candidate.lead_ref) === mappedLeadId.toString(),
      )
    : [];
  if (related.length === 1) return related[0];
  if (related.length > 1) {
    throw new Error(
      `Historical preflight found ${related.length} relationship-linked bookings for job "${key}" (${related.map(idString).join(", ")}).`,
    );
  }
  if (sourceMatches.length === 1) return sourceMatches[0];
  throw new Error(
    `Historical preflight cannot safely choose among ${sourceMatches.length} Best Relocation bookings for job "${key}" (${sourceMatches.map(idString).join(", ")}).`,
  );
}

function resolveRelatedCancellationCandidate(
  candidates: Doc[],
  mappedBookingId: mongoose.Types.ObjectId | undefined,
  mappedLeadId: mongoose.Types.ObjectId | undefined,
  key: string,
): Doc | undefined {
  const sourceMatches = candidates.filter((candidate) =>
    isBestRelocationLabel(stringValue(candidate.source)),
  );
  const related = sourceMatches.filter(
    (candidate) =>
      (mappedBookingId &&
        objectIdString(candidate.booked_lead) === mappedBookingId.toString()) ||
      (mappedLeadId && objectIdString(candidate.lead_ref) === mappedLeadId.toString()),
  );
  if (related.length === 1) return related[0];
  if (related.length > 1) {
    throw new Error(
      `Historical preflight found ${related.length} relationship-linked cancellations for job "${key}" (${related.map(idString).join(", ")}).`,
    );
  }
  if (sourceMatches.length === 1) return sourceMatches[0];
  throw new Error(
    `Historical preflight cannot safely choose among ${sourceMatches.length} Best Relocation cancellations for job "${key}" (${sourceMatches.map(idString).join(", ")}).`,
  );
}

function validateHistoricalBooking(
  candidate: Doc | undefined,
  mappedLeadId: mongoose.Types.ObjectId | undefined,
  leadBookingId: mongoose.Types.ObjectId | undefined,
  productionBooking: Doc,
): void {
  if (!candidate) return;
  const source = stringValue(candidate.source) ?? "";
  const sameJob =
    normalizeJobNo(stringValue(candidate.job_no)) ===
    normalizeJobNo(stringValue(productionBooking.job_no));
  const related =
    (mappedLeadId &&
      objectIdString(candidate.lead_ref) === mappedLeadId.toString()) ||
    (leadBookingId && candidate._id.equals(leadBookingId));
  if (!isBestRelocationLabel(source) || (!related && !sameJob)) {
    throw new Error(
      `Historical booking ${idString(candidate)} is not a source-and-relationship match for production booking ${idString(productionBooking)}.`,
    );
  }
}

function validateHistoricalCancellation(
  candidate: Doc | undefined,
  mappedBookingId: mongoose.Types.ObjectId | undefined,
  bookingCancellationId: mongoose.Types.ObjectId | undefined,
  productionCancellation: Doc,
): void {
  if (!candidate) return;
  const sameJob =
    normalizeJobNo(stringValue(candidate.job_no)) ===
    normalizeJobNo(stringValue(productionCancellation.job_no));
  const related =
    (mappedBookingId &&
      objectIdString(candidate.booked_lead) === mappedBookingId.toString()) ||
    (bookingCancellationId && candidate._id.equals(bookingCancellationId));
  if (
    !isBestRelocationLabel(stringValue(candidate.source)) ||
    (!related && !sameJob)
  ) {
    throw new Error(
      `Historical cancellation ${idString(candidate)} is not relationship-linked to production cancellation ${idString(productionCancellation)}.`,
    );
  }
}

function isBestRelocationLabel(value: string | undefined): boolean {
  return Boolean(value && /best[\s_]*relocation/i.test(value));
}

function assertInjectiveMapping(
  mapping: Map<string, mongoose.Types.ObjectId>,
  label: string,
): void {
  const reverse = new Map<string, string>();
  for (const [sourceId, destinationId] of mapping) {
    const destination = destinationId.toString();
    const existing = reverse.get(destination);
    if (existing && existing !== sourceId) {
      throw new Error(
        `Historical preflight maps two production ${label}s (${existing}, ${sourceId}) to ${destination}.`,
      );
    }
    reverse.set(destination, sourceId);
  }
}

function historicalCallIdentity(doc: Doc): string | undefined {
  const raw = isRecord(doc.raw_row) ? doc.raw_row : undefined;
  const rawDate = normalizeDateText(stringValue(raw?.Date));
  const rawTime = normalizeTimeText(stringValue(raw?.Time));
  const timestamp = rawDate && rawTime
    ? `${rawDate}T${rawTime}`
    : doc.timestamp instanceof Date
      ? doc.timestamp.toISOString().slice(0, 19)
      : typeof doc.timestamp === "string"
        ? new Date(doc.timestamp).toISOString().slice(0, 19)
        : undefined;
  const phone =
    stringValue(doc.normalized_phone_number) ?? stringValue(doc.phone_number);
  return timestamp && phone ? `${timestamp}|${phone}` : undefined;
}

function normalizeDateText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  }
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  }
  return value;
}

function normalizeTimeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return value;
  let hour = Number(match[1]);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function idString(doc: Doc): string {
  return doc._id.toString();
}

function objectIdString(value: unknown): string | undefined {
  return value instanceof mongoose.Types.ObjectId ? value.toString() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function dateMillis(value: unknown): number | undefined {
  return value instanceof Date ? value.getTime() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function columnLetter(value: number): string {
  let column = value;
  let result = "";
  while (column > 0) {
    result = String.fromCharCode(65 + ((column - 1) % 26)) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
