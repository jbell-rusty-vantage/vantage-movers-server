import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getSalesIntelligenceAiBudgetModel } from "../../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
async function main() {
  await connectMongo();
  const b = await getSalesIntelligenceAiBudgetModel().findOne({ activated_at: { $ne: null }, period_start: { $lte: new Date() }, period_end: { $gt: new Date() } }).lean();
  const reserved = await getSalesIntelligenceAiReservationModel().aggregate([{ $match: { status: "reserved" } }, { $group: { _id: null, n: { $sum: 1 }, cents: { $sum: "$estimated_cents" } } }]);
  console.log(JSON.stringify({ budget: b && { month: b.month, ceiling_cents: (b as { ceiling_cents?: number }).ceiling_cents, actual_cents: b.actual_cents, reserved_cents: (b as { reserved_cents?: number }).reserved_cents, keys: Object.keys(b) }, reserved: reserved[0] ?? null }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
