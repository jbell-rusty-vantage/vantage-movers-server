import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose, { type PipelineStage } from "mongoose";
import { connectMongo } from "../../src/db";
import { HISTORICAL_DATABASE_NAME, registerHistoricalModels } from "./models";

type HistoricalModels = ReturnType<typeof registerHistoricalModels>;
type SourceLeadStats = {
  _id: string | null;
  total_leads: number;
  booked_leads: number;
  cancelled_leads: number;
  over_2000: number;
  over_4000: number;
};
type SourceFunnelRow = {
  source_company: string;
  total_leads: number;
  form_leads: number;
  call_leads: number;
  sheet_booked_leads: number;
  sheet_cancelled_leads: number;
  over_2000_leads: number;
  over_4000_leads: number;
  reconciled_bookings?: number;
  reconciled_cancelled_bookings?: number;
  total_deposit_amount?: number;
  total_binder_amount?: number;
  booking_rate?: number | null;
  cancellation_rate?: number;
};

const REPORT_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "historical",
  "models",
  "historical-analytics-report.json",
);

const nonEmpty = { $exists: true, $ne: "" };
const present = { $exists: true, $ne: null };

function sourceCompanyExpression() {
  const joinedSourceCompany = {
    $ifNull: [
      { $arrayElemAt: ["$form_lead.source_company", 0] },
      {
        $ifNull: [
          { $arrayElemAt: ["$call_lead.source_company", 0] },
          { $ifNull: ["$source", "unknown"] },
        ],
      },
    ],
  };

  return {
    $let: {
      vars: { sourceCompany: joinedSourceCompany },
      in: {
        $cond: [
          {
            $or: [
              { $eq: ["$$sourceCompany", null] },
              { $eq: ["$$sourceCompany", ""] },
            ],
          },
          "unknown",
          "$$sourceCompany",
        ],
      },
    },
  };
}

function addBookedLeadSourceLookups(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "form_leads",
        localField: "lead_ref",
        foreignField: "_id",
        as: "form_lead",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "lead_ref",
        foreignField: "_id",
        as: "call_lead",
      },
    },
    {
      $set: {
        derived_source_company: sourceCompanyExpression(),
        is_cancelled: {
          $ne: [{ $ifNull: ["$cancelled", null] }, null],
        },
      },
    },
  ];
}

async function getTopAgentsByBinder(models: HistoricalModels) {
  return models.BookedLead.aggregate([
    { $unwind: "$agent_allocations" },
    {
      $set: {
        agent_name: {
          $ifNull: ["$agent_allocations.agent_name_snapshot", "unknown"],
        },
        is_cancelled: {
          $ne: [{ $ifNull: ["$cancelled", null] }, null],
        },
      },
    },
    { $match: { agent_name: { $ne: "" } } },
    {
      $group: {
        _id: {
          agent: "$agent_allocations.agent",
          agent_name: "$agent_name",
        },
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_binder_amount: {
          $sum: { $ifNull: ["$agent_allocations.binder_amount", 0] },
        },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        over_2000_bookings: { $sum: { $cond: ["$over_2000", 1, 0] } },
        over_4000_bookings: { $sum: { $cond: ["$over_4000", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        agent_id: "$_id.agent",
        agent_name: "$_id.agent_name",
        bookings: 1,
        cancelled_bookings: 1,
        active_bookings: { $subtract: ["$bookings", "$cancelled_bookings"] },
        cancellation_rate: {
          $cond: [
            { $eq: ["$bookings", 0] },
            0,
            { $divide: ["$cancelled_bookings", "$bookings"] },
          ],
        },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        average_binder_amount: {
          $round: [
            {
              $cond: [
                { $eq: ["$bookings", 0] },
                0,
                { $divide: ["$total_binder_amount", "$bookings"] },
              ],
            },
            2,
          ],
        },
        average_deposit_amount: {
          $round: [
            {
              $cond: [
                { $eq: ["$bookings", 0] },
                0,
                { $divide: ["$total_deposit_amount", "$bookings"] },
              ],
            },
            2,
          ],
        },
        over_2000_bookings: 1,
        over_4000_bookings: 1,
      },
    },
    { $sort: { total_binder_amount: -1, bookings: -1, agent_name: 1 } },
    { $limit: 50 },
  ]);
}

async function getDepositTotalsBySourceCompany(models: HistoricalModels) {
  return models.BookedLead.aggregate([
    ...addBookedLeadSourceLookups(),
    {
      $group: {
        _id: "$derived_source_company",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        source_company: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        active_bookings: { $subtract: ["$bookings", "$cancelled_bookings"] },
        cancellation_rate: {
          $cond: [
            { $eq: ["$bookings", 0] },
            0,
            { $divide: ["$cancelled_bookings", "$bookings"] },
          ],
        },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        average_deposit_amount: {
          $round: [
            {
              $cond: [
                { $eq: ["$bookings", 0] },
                0,
                { $divide: ["$total_deposit_amount", "$bookings"] },
              ],
            },
            2,
          ],
        },
        average_binder_amount: {
          $round: [
            {
              $cond: [
                { $eq: ["$bookings", 0] },
                0,
                { $divide: ["$total_binder_amount", "$bookings"] },
              ],
            },
            2,
          ],
        },
      },
    },
    { $sort: { total_deposit_amount: -1, bookings: -1, source_company: 1 } },
  ]);
}

async function getBookedCancellationRatio(models: HistoricalModels) {
  const [overall] = await models.BookedLead.aggregate([
    ...addBookedLeadSourceLookups(),
    {
      $group: {
        _id: null,
        booked_leads: { $sum: 1 },
        cancelled_leads: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        booked_leads: 1,
        cancelled_leads: 1,
        active_booked_leads: {
          $subtract: ["$booked_leads", "$cancelled_leads"],
        },
        cancellation_rate: {
          $cond: [
            { $eq: ["$booked_leads", 0] },
            0,
            { $divide: ["$cancelled_leads", "$booked_leads"] },
          ],
        },
        booked_to_cancelled_ratio: {
          $cond: [
            { $eq: ["$cancelled_leads", 0] },
            null,
            { $divide: ["$booked_leads", "$cancelled_leads"] },
          ],
        },
      },
    },
  ]);

  const bySourceCompany = await models.BookedLead.aggregate([
    ...addBookedLeadSourceLookups(),
    {
      $group: {
        _id: "$derived_source_company",
        booked_leads: { $sum: 1 },
        cancelled_leads: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        source_company: "$_id",
        booked_leads: 1,
        cancelled_leads: 1,
        active_booked_leads: {
          $subtract: ["$booked_leads", "$cancelled_leads"],
        },
        cancellation_rate: {
          $cond: [
            { $eq: ["$booked_leads", 0] },
            0,
            { $divide: ["$cancelled_leads", "$booked_leads"] },
          ],
        },
        booked_to_cancelled_ratio: {
          $cond: [
            { $eq: ["$cancelled_leads", 0] },
            null,
            { $divide: ["$booked_leads", "$cancelled_leads"] },
          ],
        },
      },
    },
    { $sort: { cancellation_rate: -1, booked_leads: -1 } },
  ]);

  return { overall: overall ?? null, by_source_company: bySourceCompany };
}

async function getSourceLeadStats(models: HistoricalModels) {
  const groupPipeline: PipelineStage[] = [
    {
      $group: {
        _id: "$source_company",
        total_leads: { $sum: 1 },
        booked_leads: {
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ["$booked", null] }, null] }, 1, 0],
          },
        },
        cancelled_leads: {
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ["$cancelled", null] }, null] }, 1, 0],
          },
        },
        over_2000: { $sum: { $cond: ["$over_2000", 1, 0] } },
        over_4000: { $sum: { $cond: ["$over_4000", 1, 0] } },
      },
    },
  ];

  const [formStats, callStats, bookedStats] = await Promise.all([
    models.FormLead.aggregate<SourceLeadStats>(groupPipeline),
    models.CallLead.aggregate<SourceLeadStats>(groupPipeline),
    getDepositTotalsBySourceCompany(models),
  ]);

  const bySource = new Map<string, SourceFunnelRow>();
  for (const row of formStats) {
    const source = row._id || "unknown";
    bySource.set(source, {
      source_company: source,
      total_leads: row.total_leads,
      form_leads: row.total_leads,
      call_leads: 0,
      sheet_booked_leads: row.booked_leads,
      sheet_cancelled_leads: row.cancelled_leads,
      over_2000_leads: row.over_2000,
      over_4000_leads: row.over_4000,
    });
  }

  for (const row of callStats) {
    const source = row._id || "unknown";
    const existing: SourceFunnelRow = bySource.get(source) ?? {
      source_company: source,
      total_leads: 0,
      form_leads: 0,
      call_leads: 0,
      sheet_booked_leads: 0,
      sheet_cancelled_leads: 0,
      over_2000_leads: 0,
      over_4000_leads: 0,
    };

    existing.total_leads = Number(existing.total_leads) + row.total_leads;
    existing.call_leads = Number(existing.call_leads) + row.total_leads;
    existing.sheet_booked_leads =
      Number(existing.sheet_booked_leads) + row.booked_leads;
    existing.sheet_cancelled_leads =
      Number(existing.sheet_cancelled_leads) + row.cancelled_leads;
    existing.over_2000_leads = Number(existing.over_2000_leads) + row.over_2000;
    existing.over_4000_leads = Number(existing.over_4000_leads) + row.over_4000;
    bySource.set(source, existing);
  }

  for (const booked of bookedStats) {
    const source = booked.source_company || "unknown";
    const existing: SourceFunnelRow = bySource.get(source) ?? {
      source_company: source,
      total_leads: 0,
      form_leads: 0,
      call_leads: 0,
      sheet_booked_leads: 0,
      sheet_cancelled_leads: 0,
      over_2000_leads: 0,
      over_4000_leads: 0,
    };

    existing.reconciled_bookings = booked.bookings;
    existing.reconciled_cancelled_bookings = booked.cancelled_bookings;
    existing.total_deposit_amount = booked.total_deposit_amount;
    existing.total_binder_amount = booked.total_binder_amount;
    existing.booking_rate = Number(existing.total_leads)
      ? Number(booked.bookings) / Number(existing.total_leads)
      : null;
    existing.cancellation_rate = booked.cancellation_rate;
    bySource.set(source, existing);
  }

  return Array.from(bySource.values()).sort((a, b) => {
    return (
      Number(b.total_deposit_amount ?? 0) - Number(a.total_deposit_amount ?? 0)
    );
  });
}

async function getMonthlyRevenueTrend(models: HistoricalModels) {
  return models.BookedLead.aggregate([
    {
      $set: {
        report_date: { $ifNull: ["$book_date", "$timestamp"] },
        is_cancelled: {
          $ne: [{ $ifNull: ["$cancelled", null] }, null],
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            date: "$report_date",
            format: "%Y-%m",
          },
        },
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        month: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        cancellation_rate: {
          $cond: [
            { $eq: ["$bookings", 0] },
            0,
            { $divide: ["$cancelled_bookings", "$bookings"] },
          ],
        },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
      },
    },
    { $sort: { month: 1 } },
  ]);
}

async function getCancellationReasons(models: HistoricalModels) {
  return models.CancelledLead.aggregate([
    {
      $lookup: {
        from: "booked_leads",
        localField: "booked_lead",
        foreignField: "_id",
        as: "booked_lead_doc",
      },
    },
    {
      $set: {
        normalized_reason: {
          $cond: [
            { $or: [{ $eq: ["$reason", null] }, { $eq: ["$reason", ""] }] },
            "unknown",
            "$reason",
          ],
        },
      },
    },
    {
      $group: {
        _id: "$normalized_reason",
        cancellations: { $sum: 1 },
        linked_to_booked: {
          $sum: { $cond: [{ $gt: [{ $size: "$booked_lead_doc" }, 0] }, 1, 0] },
        },
        total_refund_amount: { $sum: { $ifNull: ["$refund_amount", 0] } },
        affected_deposit_amount: {
          $sum: {
            $ifNull: [
              { $arrayElemAt: ["$booked_lead_doc.deposit_amount", 0] },
              0,
            ],
          },
        },
        affected_binder_amount: {
          $sum: {
            $ifNull: [
              { $arrayElemAt: ["$booked_lead_doc.total_binder_amount", 0] },
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        reason: "$_id",
        cancellations: 1,
        linked_to_booked: 1,
        total_refund_amount: { $round: ["$total_refund_amount", 2] },
        affected_deposit_amount: { $round: ["$affected_deposit_amount", 2] },
        affected_binder_amount: { $round: ["$affected_binder_amount", 2] },
      },
    },
    { $sort: { cancellations: -1, reason: 1 } },
    { $limit: 50 },
  ]);
}

async function getLeadSourcePerformance(models: HistoricalModels) {
  return models.BookedLead.aggregate([
    {
      $set: {
        normalized_source: {
          $cond: [
            { $or: [{ $eq: ["$source", null] }, { $eq: ["$source", ""] }] },
            "unknown",
            "$source",
          ],
        },
        is_cancelled: {
          $ne: [{ $ifNull: ["$cancelled", null] }, null],
        },
      },
    },
    {
      $group: {
        _id: "$normalized_source",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        lead_source: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        cancellation_rate: {
          $cond: [
            { $eq: ["$bookings", 0] },
            0,
            { $divide: ["$cancelled_bookings", "$bookings"] },
          ],
        },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        average_deposit_amount: {
          $round: [
            {
              $cond: [
                { $eq: ["$bookings", 0] },
                0,
                { $divide: ["$total_deposit_amount", "$bookings"] },
              ],
            },
            2,
          ],
        },
      },
    },
    { $sort: { total_deposit_amount: -1, bookings: -1 } },
    { $limit: 75 },
  ]);
}

async function getLocalVsLongDistance(models: HistoricalModels) {
  return models.BookedLead.aggregate([
    ...addBookedLeadSourceLookups(),
    {
      $group: {
        _id: {
          $cond: [
            { $or: [{ $eq: ["$local", null] }, { $eq: ["$local", ""] }] },
            "unknown",
            "$local",
          ],
        },
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        local_type: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        cancellation_rate: {
          $cond: [
            { $eq: ["$bookings", 0] },
            0,
            { $divide: ["$cancelled_bookings", "$bookings"] },
          ],
        },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
      },
    },
    { $sort: { total_deposit_amount: -1 } },
  ]);
}

async function getGeographicLanes(models: HistoricalModels) {
  const pipeline: PipelineStage[] = [
    {
      $set: {
        pickup: {
          $cond: [
            {
              $or: [
                { $eq: ["$pickup_state", null] },
                { $eq: ["$pickup_state", ""] },
              ],
            },
            "unknown",
            "$pickup_state",
          ],
        },
        delivery: {
          $cond: [
            {
              $or: [
                { $eq: ["$delivery_state", null] },
                { $eq: ["$delivery_state", ""] },
              ],
            },
            "unknown",
            "$delivery_state",
          ],
        },
      },
    },
    {
      $group: {
        _id: { pickup_state: "$pickup", delivery_state: "$delivery" },
        leads: { $sum: 1 },
        booked_leads: {
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ["$booked", null] }, null] }, 1, 0],
          },
        },
        cancelled_leads: {
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ["$cancelled", null] }, null] }, 1, 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        pickup_state: "$_id.pickup_state",
        delivery_state: "$_id.delivery_state",
        leads: 1,
        booked_leads: 1,
        cancelled_leads: 1,
        booking_rate: {
          $cond: [
            { $eq: ["$leads", 0] },
            0,
            { $divide: ["$booked_leads", "$leads"] },
          ],
        },
      },
    },
    { $sort: { leads: -1, booked_leads: -1 } },
    { $limit: 50 },
  ];

  const [formLanes, callLanes] = await Promise.all([
    models.FormLead.aggregate(pipeline),
    models.CallLead.aggregate(pipeline),
  ]);

  return { form_lanes: formLanes, call_lanes: callLanes };
}

async function getReconciliationHealth(models: HistoricalModels) {
  const [
    bookedTotal,
    bookedLinked,
    cancelledTotal,
    cancelledLinked,
    matchedBy,
    bookedSourceCoverage,
  ] = await Promise.all([
    models.BookedLead.countDocuments(),
    models.BookedLead.countDocuments({ lead_ref: present }),
    models.CancelledLead.countDocuments(),
    models.CancelledLead.countDocuments({ booked_lead: present }),
    models.BookedLead.aggregate([
      { $match: { matched_by: nonEmpty } },
      {
        $group: {
          _id: "$matched_by",
          count: { $sum: 1 },
          average_confidence: { $avg: "$match_confidence" },
        },
      },
      {
        $project: {
          _id: 0,
          matched_by: "$_id",
          count: 1,
          average_confidence: { $round: ["$average_confidence", 3] },
        },
      },
      { $sort: { count: -1 } },
    ]),
    models.BookedLead.aggregate([
      ...addBookedLeadSourceLookups(),
      {
        $group: {
          _id: "$derived_source_company",
          bookings: { $sum: 1 },
          linked_bookings: {
            $sum: {
              $cond: [{ $ne: [{ $ifNull: ["$lead_ref", null] }, null] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          source_company: "$_id",
          bookings: 1,
          linked_bookings: 1,
          unlinked_bookings: { $subtract: ["$bookings", "$linked_bookings"] },
          link_rate: {
            $cond: [
              { $eq: ["$bookings", 0] },
              0,
              { $divide: ["$linked_bookings", "$bookings"] },
            ],
          },
        },
      },
      { $sort: { link_rate: 1, bookings: -1 } },
    ]),
  ]);

  return {
    booked: {
      total: bookedTotal,
      linked_to_source_lead: bookedLinked,
      unlinked_to_source_lead: bookedTotal - bookedLinked,
      link_rate: bookedTotal ? bookedLinked / bookedTotal : 0,
      matched_by: matchedBy,
      source_company_coverage: bookedSourceCoverage,
    },
    cancelled: {
      total: cancelledTotal,
      linked_to_booked: cancelledLinked,
      unlinked_to_booked: cancelledTotal - cancelledLinked,
      link_rate: cancelledTotal ? cancelledLinked / cancelledTotal : 0,
    },
  };
}

async function buildHistoricalAnalyticsReport(models: HistoricalModels) {
  const [
    topAgentsByBinder,
    depositTotalsBySourceCompany,
    bookedCancellationRatio,
    sourceCompanyFunnel,
    monthlyRevenueTrend,
    cancellationReasons,
    leadSourcePerformance,
    localVsLongDistance,
    geographicLanes,
    reconciliationHealth,
  ] = await Promise.all([
    getTopAgentsByBinder(models),
    getDepositTotalsBySourceCompany(models),
    getBookedCancellationRatio(models),
    getSourceLeadStats(models),
    getMonthlyRevenueTrend(models),
    getCancellationReasons(models),
    getLeadSourcePerformance(models),
    getLocalVsLongDistance(models),
    getGeographicLanes(models),
    getReconciliationHealth(models),
  ]);

  return {
    generated_at: new Date().toISOString(),
    database: HISTORICAL_DATABASE_NAME,
    report_path: REPORT_PATH,
    analytics: {
      top_agents_by_binder: topAgentsByBinder,
      deposit_totals_by_source_company: depositTotalsBySourceCompany,
      booked_cancellation_ratio: bookedCancellationRatio,
      source_company_funnel: sourceCompanyFunnel,
      monthly_revenue_trend: monthlyRevenueTrend,
      cancellation_reasons: cancellationReasons,
      lead_source_performance: leadSourcePerformance,
      local_vs_long_distance: localVsLongDistance,
      geographic_lanes: geographicLanes,
      reconciliation_health: reconciliationHealth,
    },
  };
}

async function main(): Promise<void> {
  await connectMongo();
  const models = registerHistoricalModels();
  const report = await buildHistoricalAnalyticsReport(models);

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Historical analytics report written to ${REPORT_PATH}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
