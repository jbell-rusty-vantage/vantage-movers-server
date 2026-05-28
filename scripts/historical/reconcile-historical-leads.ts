import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { registerHistoricalModels } from "./models";

type HistoricalModels = ReturnType<typeof registerHistoricalModels>;
type LeadModelName = "FormLead" | "CallLead";
type MatchResult = {
  lead: any;
  leadModel: LeadModelName;
  matchedBy: string;
  confidence: number;
};

function dateMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

function putLatestByTimestamp(map: Map<string, any>, key: unknown, lead: any): void {
  if (typeof key !== "string" || key.length === 0) return;

  const existing = map.get(key);
  if (!existing || dateMs(lead.timestamp) > dateMs(existing.timestamp)) {
    map.set(key, lead);
  }
}

function putByName(map: Map<string, any[]>, lead: any): void {
  if (typeof lead.normalized_name !== "string" || lead.normalized_name.length === 0) return;

  const existing = map.get(lead.normalized_name) ?? [];
  existing.push(lead);
  existing.sort((a, b) => dateMs(b.timestamp) - dateMs(a.timestamp));
  map.set(lead.normalized_name, existing);
}

function findByNameDate(formByName: Map<string, any[]>, booked: any): MatchResult | undefined {
  const normalizedName = booked.normalized_customer_name;
  if (typeof normalizedName !== "string" || normalizedName.length === 0) return undefined;

  const candidates = formByName.get(normalizedName);
  if (!candidates?.length) return undefined;

  const bookTime = dateMs(booked.book_date) || dateMs(booked.timestamp);
  if (bookTime > 0) {
    const oneDayAfterBook = bookTime + 24 * 60 * 60 * 1000;
    const ninetyDaysBeforeBook = bookTime - 90 * 24 * 60 * 60 * 1000;
    const lead = candidates.find((candidate) => {
      const leadTime = dateMs(candidate.timestamp);
      return leadTime >= ninetyDaysBeforeBook && leadTime <= oneDayAfterBook;
    });

    if (lead) {
      return {
        lead,
        leadModel: "FormLead",
        matchedBy: "name_date_window",
        confidence: 0.75,
      };
    }
  }

  return {
    lead: candidates[0],
    leadModel: "FormLead",
    matchedBy: "name",
    confidence: 0.6,
  };
}

function findLeadForBooked(
  booked: any,
  indexes: {
    formByLid: Map<string, any>;
    formByRefNo: Map<string, any>;
    callByJobNo: Map<string, any>;
    formByName: Map<string, any[]>;
  },
): MatchResult | undefined {
  const lid = booked.normalized_lid || booked.submission_id;
  if (typeof lid === "string" && indexes.formByLid.has(lid)) {
    return {
      lead: indexes.formByLid.get(lid),
      leadModel: "FormLead",
      matchedBy: "lid",
      confidence: 1,
    };
  }

  const jobNo = booked.normalized_job_no;
  if (typeof jobNo === "string" && indexes.formByRefNo.has(jobNo)) {
    return {
      lead: indexes.formByRefNo.get(jobNo),
      leadModel: "FormLead",
      matchedBy: "job_no_ref_no",
      confidence: 0.9,
    };
  }

  if (typeof jobNo === "string" && indexes.callByJobNo.has(jobNo)) {
    return {
      lead: indexes.callByJobNo.get(jobNo),
      leadModel: "CallLead",
      matchedBy: "job_no",
      confidence: 0.9,
    };
  }

  return findByNameDate(indexes.formByName, booked);
}

async function reconcileBookedLeads(models: HistoricalModels) {
  console.log("Loading relationship indexes...");

  const [bookedLeads, formLeads, callLeads] = await Promise.all([
    models.BookedLead.find({
      $or: [{ lead_ref: { $exists: false } }, { lead_ref: null }],
    }).lean(),
    models.FormLead.find({})
      .select("_id normalized_lid normalized_ref_no normalized_name timestamp")
      .lean(),
    models.CallLead.find({})
      .select("_id normalized_job_no normalized_name timestamp")
      .lean(),
  ]);

  const formByLid = new Map<string, any>();
  const formByRefNo = new Map<string, any>();
  const formByName = new Map<string, any[]>();
  const callByJobNo = new Map<string, any>();

  for (const formLead of formLeads) {
    putLatestByTimestamp(formByLid, formLead.normalized_lid, formLead);
    putLatestByTimestamp(formByRefNo, formLead.normalized_ref_no, formLead);
    putByName(formByName, formLead);
  }

  for (const callLead of callLeads) {
    putLatestByTimestamp(callByJobNo, callLead.normalized_job_no, callLead);
  }

  let linked = 0;
  let unlinked = 0;
  const bookedOps: any[] = [];
  const formOps: any[] = [];
  const callOps: any[] = [];

  for (const booked of bookedLeads) {
    const match = findLeadForBooked(booked, {
      formByLid,
      formByRefNo,
      callByJobNo,
      formByName,
    });
    if (!match) {
      unlinked++;
      continue;
    }

    bookedOps.push({
      updateOne: {
        filter: { _id: booked._id },
        update: {
          $set: {
            lead_ref: match.lead._id,
            lead_model: match.leadModel,
            matched_by: match.matchedBy,
            match_confidence: match.confidence,
          },
        },
      },
    });

    const leadOp = {
      updateOne: {
        filter: { _id: match.lead._id, booked: { $exists: false } },
        update: { $set: { booked: booked._id } },
      },
    };
    if (match.leadModel === "FormLead") {
      formOps.push(leadOp);
    } else {
      callOps.push(leadOp);
    }

    linked++;
  }

  if (bookedOps.length > 0) {
    await models.BookedLead.bulkWrite(bookedOps, { ordered: false });
  }
  if (formOps.length > 0) {
    await models.FormLead.bulkWrite(formOps, { ordered: false });
  }
  if (callOps.length > 0) {
    await models.CallLead.bulkWrite(callOps, { ordered: false });
  }

  return { scanned: bookedLeads.length, linked, unlinked };
}

async function reconcileCancelledLeads(models: HistoricalModels) {
  const [cancelledLeads, bookedLeads] = await Promise.all([
    models.CancelledLead.find({
      $or: [{ booked_lead: { $exists: false } }, { booked_lead: null }],
    }).lean(),
    models.BookedLead.find({ normalized_job_no: { $exists: true, $ne: "" } })
      .select("_id normalized_job_no customer lead_ref lead_model")
      .lean(),
  ]);

  const bookedByJobNo = new Map<string, any>();
  for (const booked of bookedLeads) {
    putLatestByTimestamp(bookedByJobNo, booked.normalized_job_no, booked);
  }

  let linked = 0;
  let unlinked = 0;
  const cancelledOps: any[] = [];
  const bookedOps: any[] = [];
  const formOps: any[] = [];
  const callOps: any[] = [];

  for (const cancelled of cancelledLeads) {
    const booked =
      typeof cancelled.normalized_job_no === "string"
        ? bookedByJobNo.get(cancelled.normalized_job_no)
        : undefined;
    if (!booked) {
      unlinked++;
      continue;
    }

    cancelledOps.push({
      updateOne: {
        filter: { _id: cancelled._id },
        update: {
          $set: {
            booked_lead: booked._id,
            customer: booked.customer,
            lead_ref: booked.lead_ref,
            lead_model: booked.lead_model,
          },
        },
      },
    });

    bookedOps.push({
      updateOne: {
        filter: { _id: booked._id },
        update: { $set: { cancelled: cancelled._id } },
      },
    });

    if (booked.lead_ref && booked.lead_model === "FormLead") {
      formOps.push({
        updateOne: {
          filter: { _id: booked.lead_ref },
          update: { $set: { cancelled: cancelled._id } },
        },
      });
    } else if (booked.lead_ref && booked.lead_model === "CallLead") {
      callOps.push({
        updateOne: {
          filter: { _id: booked.lead_ref },
          update: { $set: { cancelled: cancelled._id } },
        },
      });
    }

    linked++;
  }

  if (cancelledOps.length > 0) {
    await models.CancelledLead.bulkWrite(cancelledOps, { ordered: false });
  }
  if (bookedOps.length > 0) {
    await models.BookedLead.bulkWrite(bookedOps, { ordered: false });
  }
  if (formOps.length > 0) {
    await models.FormLead.bulkWrite(formOps, { ordered: false });
  }
  if (callOps.length > 0) {
    await models.CallLead.bulkWrite(callOps, { ordered: false });
  }

  return { scanned: cancelledLeads.length, linked, unlinked };
}

export async function reconcileHistoricalRelationships(models = registerHistoricalModels()) {
  const booked = await reconcileBookedLeads(models);
  const cancelled = await reconcileCancelledLeads(models);

  console.log(
    `Booked reconciliation: scanned ${booked.scanned}, linked ${booked.linked}, unlinked ${booked.unlinked}`,
  );
  console.log(
    `Cancelled reconciliation: scanned ${cancelled.scanned}, linked ${cancelled.linked}, unlinked ${cancelled.unlinked}`,
  );

  return { booked, cancelled };
}

async function main(): Promise<void> {
  await connectMongo();
  const models = registerHistoricalModels();
  await reconcileHistoricalRelationships(models);
}

if (process.argv[1]?.endsWith("reconcile-historical-leads.ts")) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
