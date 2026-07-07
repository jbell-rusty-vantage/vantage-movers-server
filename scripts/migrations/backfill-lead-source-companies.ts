import { connectMongo } from "../../api/db";
import type { LocalType } from "../../api/config/domain";
import { getCallLeadModel } from "../../api/models/CallLead";
import { getFormLeadModel } from "../../api/models/FormLead";
import {
  ensureLeadSourceCompaniesSeeded,
  leadSourceAssignmentFields,
  resolveLeadSource,
} from "../../api/services/leadSourceCompanies";

const BATCH_SIZE = 250;

type BackfillStats = {
  scanned: number;
  updated: number;
  failed: number;
};

async function main() {
  console.log("Connecting to Mongo for lead source company backfill...");
  await connectMongo();
  console.log("Mongo connected. Seeding LeadSourceCompany catalog...");
  await ensureLeadSourceCompaniesSeeded();
  console.log("LeadSourceCompany catalog seeded. Counting leads to backfill...");

  const formStats = await backfillFormLeads();
  const callStats = await backfillCallLeads();

  console.log("Lead source company backfill complete.", {
    form_leads: formStats,
    call_leads: callStats,
  });
}

async function backfillFormLeads(): Promise<BackfillStats> {
  const FormLead = getFormLeadModel();
  const filter = {
    $or: [
      { lead_source_company: { $exists: false } },
      { source_granularity_key: { $exists: false } },
      { crm_source_label_snapshot: { $exists: false } },
    ],
  };
  const total = await FormLead.countDocuments(filter).exec();
  console.log(`Backfilling form leads: ${total} candidates.`);
  const cursor = FormLead.find(filter).cursor({ batchSize: BATCH_SIZE });

  const stats: BackfillStats = { scanned: 0, updated: 0, failed: 0 };
  for await (const lead of cursor) {
    stats.scanned += 1;
    try {
      const resolution = await resolveLeadSource({
        value: lead.crm_source_label_snapshot ?? lead.source_company,
        company_slug: lead.source_company,
        granularity_key: lead.source_granularity_key,
        channel: "form",
        local: lead.local as LocalType,
        source_site: lead.source_company_site,
        requireActive: false,
      });
      await FormLead.updateOne(
        { _id: lead._id },
        { $set: leadSourceAssignmentFields(resolution) },
      ).exec();
      stats.updated += 1;
    } catch (error) {
      stats.failed += 1;
      console.warn("Failed to backfill form lead source", {
        id: lead._id.toString(),
        source_company: lead.source_company,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (stats.scanned % BATCH_SIZE === 0) {
      console.log("Form lead backfill progress", stats);
    }
  }
  console.log("Form lead backfill finished", stats);
  return stats;
}

async function backfillCallLeads(): Promise<BackfillStats> {
  const CallLead = getCallLeadModel();
  const filter = {
    $or: [
      { lead_source_company: { $exists: false } },
      { source_granularity_key: { $exists: false } },
      { crm_source_label_snapshot: { $exists: false } },
    ],
  };
  const total = await CallLead.countDocuments(filter).exec();
  console.log(`Backfilling call leads: ${total} candidates.`);
  const cursor = CallLead.find(filter).cursor({ batchSize: BATCH_SIZE });

  const stats: BackfillStats = { scanned: 0, updated: 0, failed: 0 };
  for await (const lead of cursor) {
    stats.scanned += 1;
    try {
      const resolution = await resolveLeadSource({
        value:
          lead.ringcentral?.source_label ??
          lead.crm_source_label_snapshot ??
          lead.source_company,
        company_slug: lead.source_company,
        granularity_key: lead.source_granularity_key,
        channel: "call",
        local: lead.local as LocalType | undefined,
        source_site: lead.source_company_site,
        requireActive: false,
      });
      await CallLead.updateOne(
        { _id: lead._id },
        { $set: leadSourceAssignmentFields(resolution) },
      ).exec();
      stats.updated += 1;
    } catch (error) {
      stats.failed += 1;
      console.warn("Failed to backfill call lead source", {
        id: lead._id.toString(),
        source_company: lead.source_company,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (stats.scanned % BATCH_SIZE === 0) {
      console.log("Call lead backfill progress", stats);
    }
  }
  console.log("Call lead backfill finished", stats);
  return stats;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to backfill lead source companies", error);
    process.exit(1);
  });
