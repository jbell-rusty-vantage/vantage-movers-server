import mongoose from "mongoose";
import { connectMongo } from "../api/db";
import { registerHistoricalModels } from "./historical_db_models";

async function main(): Promise<void> {
  await connectMongo();
  const models = registerHistoricalModels();

  const present = { $exists: true, $ne: null };
  const nonEmpty = { $exists: true, $ne: "" };

  const [
    bookedTotal,
    bookedLinked,
    bookedWithLid,
    bookedWithCustomer,
    bookedWithJob,
    cancelledTotal,
    cancelledLinked,
    cancelledWithJob,
  ] = await Promise.all([
    models.BookedLead.countDocuments(),
    models.BookedLead.countDocuments({ lead_ref: present }),
    models.BookedLead.countDocuments({ normalized_lid: nonEmpty }),
    models.BookedLead.countDocuments({ normalized_customer_name: nonEmpty }),
    models.BookedLead.countDocuments({ normalized_job_no: nonEmpty }),
    models.CancelledLead.countDocuments(),
    models.CancelledLead.countDocuments({ booked_lead: present }),
    models.CancelledLead.countDocuments({ normalized_job_no: nonEmpty }),
  ]);

  const matchedBy = await models.BookedLead.aggregate([
    { $match: { matched_by: nonEmpty } },
    { $group: { _id: "$matched_by", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const sources = await models.BookedLead.aggregate([
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 },
        linked: { $sum: { $cond: [{ $ifNull: ["$lead_ref", false] }, 1, 0] } },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 25 },
  ]);

  const [formLeadSourceCompanies, callLeadSourceCompanies] = await Promise.all([
    models.FormLead.aggregate([
      { $group: { _id: "$source_company", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    models.CallLead.aggregate([
      { $group: { _id: "$source_company", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  console.log(
    JSON.stringify(
      {
        booked: {
          total: bookedTotal,
          linked: bookedLinked,
          with_lid: bookedWithLid,
          with_customer_name: bookedWithCustomer,
          with_job_no: bookedWithJob,
          matched_by: matchedBy,
          sources,
        },
        cancelled: {
          total: cancelledTotal,
          linked: cancelledLinked,
          with_job_no: cancelledWithJob,
        },
        leads: {
          form_source_companies: formLeadSourceCompanies,
          call_source_companies: callLeadSourceCompanies,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
