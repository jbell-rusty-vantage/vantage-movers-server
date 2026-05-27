import dns from "node:dns";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const DATABASE_NAME = "vantagemovers";
const BOOKED_LEADS_COLLECTION = "booked_leads";
const REPORTS_DIR = path.join(process.cwd(), "scripts", "reports");

type MongoId = mongoose.Types.ObjectId;

type BookedLeadRecord = {
  _id: MongoId;
  timestamp?: Date;
  book_date?: Date;
  job_no?: string;
  customer?: MongoId;
  lead_ref?: MongoId;
  lead_model?: "FormLead" | "CallLead";
  source?: string;
  total_binder_amount?: number;
  deposit_amount?: number;
  merchant?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type AttachedLeadRecord = {
  _id: MongoId;
  booked?: MongoId;
  name?: string;
  phone_number?: string;
  email?: string;
  ref_no?: string;
  job_no?: string;
  source_company?: string;
  source_company_site?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type AttachedLeadReport = {
  model: "FormLead" | "CallLead";
  attachmentType: "lead.booked" | "booking.lead_ref";
  lead: Record<string, unknown>;
};

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    throw new Error("MONGO_URI is not set");
  }

  const confirmed = process.argv.includes("--confirm");

  configureMongoDnsServers();
  await mongoose.connect(uri, { dbName: DATABASE_NAME });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  if (mongoose.connection.name !== DATABASE_NAME) {
    throw new Error(
      `Refusing to clear unexpected database "${mongoose.connection.name}". Expected "${DATABASE_NAME}".`,
    );
  }

  const bookedLeads = await db
    .collection<BookedLeadRecord>(BOOKED_LEADS_COLLECTION)
    .find({})
    .project<BookedLeadRecord>({
      timestamp: 1,
      book_date: 1,
      job_no: 1,
      customer: 1,
      lead_ref: 1,
      lead_model: 1,
      source: 1,
      total_binder_amount: 1,
      deposit_amount: 1,
      merchant: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .toArray();

  const bookedLeadIds = bookedLeads.map((booking) => booking._id);
  const attachedLeads = bookedLeadIds.length
    ? await getAttachedLeadReports(bookedLeads, bookedLeadIds)
    : [];

  const report = {
    database: DATABASE_NAME,
    collectionToClear: BOOKED_LEADS_COLLECTION,
    mode: confirmed ? "delete" : "dry-run",
    generatedAt: new Date().toISOString(),
    bookedLeadCount: bookedLeads.length,
    attachedLeadCount: attachedLeads.length,
    bookedLeads: bookedLeads.map(serializeDocument),
    attachedLeads,
  };

  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(
    REPORTS_DIR,
    `clear-production-booked-leads-${Date.now()}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Database: ${DATABASE_NAME}`);
  console.log(`Booked leads found: ${bookedLeads.length}`);
  console.log(`Attached lead references found: ${attachedLeads.length}`);
  console.log(`Report written: ${reportPath}`);

  if (!confirmed) {
    console.log("Dry run only. Re-run with --confirm to delete booked_leads.");
    return;
  }

  const result = await db.collection(BOOKED_LEADS_COLLECTION).deleteMany({});
  console.log(`${BOOKED_LEADS_COLLECTION}: deleted ${result.deletedCount} documents`);
  console.log("Form and call lead collections were not modified.");
}

async function getAttachedLeadReports(
  bookedLeads: BookedLeadRecord[],
  bookedLeadIds: MongoId[],
): Promise<AttachedLeadReport[]> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const formLeadRefs = bookedLeads
    .filter((booking) => booking.lead_model === "FormLead" && booking.lead_ref)
    .map((booking) => booking.lead_ref as MongoId);
  const callLeadRefs = bookedLeads
    .filter((booking) => booking.lead_model === "CallLead" && booking.lead_ref)
    .map((booking) => booking.lead_ref as MongoId);

  const [formBackRefs, callBackRefs, formLeadRefDocs, callLeadRefDocs] =
    await Promise.all([
      db
        .collection<AttachedLeadRecord>("form_leads")
        .find({ booked: { $in: bookedLeadIds } })
        .project<AttachedLeadRecord>(leadProjection())
        .toArray(),
      db
        .collection<AttachedLeadRecord>("call_leads")
        .find({ booked: { $in: bookedLeadIds } })
        .project<AttachedLeadRecord>(leadProjection())
        .toArray(),
      formLeadRefs.length
        ? db
            .collection<AttachedLeadRecord>("form_leads")
            .find({ _id: { $in: formLeadRefs } })
            .project<AttachedLeadRecord>(leadProjection())
            .toArray()
        : Promise.resolve([]),
      callLeadRefs.length
        ? db
            .collection<AttachedLeadRecord>("call_leads")
            .find({ _id: { $in: callLeadRefs } })
            .project<AttachedLeadRecord>(leadProjection())
            .toArray()
        : Promise.resolve([]),
    ]);

  return [
    ...formBackRefs.map((lead) => buildAttachedLeadReport("FormLead", "lead.booked", lead)),
    ...callBackRefs.map((lead) => buildAttachedLeadReport("CallLead", "lead.booked", lead)),
    ...formLeadRefDocs.map((lead) =>
      buildAttachedLeadReport("FormLead", "booking.lead_ref", lead),
    ),
    ...callLeadRefDocs.map((lead) =>
      buildAttachedLeadReport("CallLead", "booking.lead_ref", lead),
    ),
  ];
}

function leadProjection(): Record<string, 1> {
  return {
    booked: 1,
    name: 1,
    phone_number: 1,
    email: 1,
    ref_no: 1,
    job_no: 1,
    source_company: 1,
    source_company_site: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildAttachedLeadReport(
  model: "FormLead" | "CallLead",
  attachmentType: "lead.booked" | "booking.lead_ref",
  lead: AttachedLeadRecord,
): AttachedLeadReport {
  return {
    model,
    attachmentType,
    lead: serializeDocument(lead),
  };
}

function serializeDocument(document: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [key, serializeValue(value)]),
  );
}

function serializeValue(value: unknown): unknown {
  if (isObjectIdLike(value)) {
    return (value as { toString(): string }).toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    return serializeDocument(value as Record<string, unknown>);
  }
  return value;
}

function isObjectIdLike(value: unknown): boolean {
  if (value instanceof mongoose.Types.ObjectId) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeObjectId = value as { _bsontype?: unknown; toString?: unknown };
  return maybeObjectId._bsontype === "ObjectId" && typeof maybeObjectId.toString === "function";
}

function shouldUseLocalMongoDnsServers(): boolean {
  return process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production";
}

function configureMongoDnsServers(): void {
  if (!shouldUseLocalMongoDnsServers()) {
    return;
  }

  const servers = process.env.MONGO_DNS_SERVERS?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (!servers?.length) {
    return;
  }

  dns.setServers(servers);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
