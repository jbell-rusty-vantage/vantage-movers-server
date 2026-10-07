/**
 * Seeds a local test database (csi01 loopback replica only, `--database=test…`) with ~150 days of synthetic leads,
 * bookings, cancellations, lead costs and reviews, so the Admin's Insights, Today and Desk pages can be walked against
 * the real server (`ops/local-integration/serve.ts`). Invented names and amounts; deterministic.
 *
 *   node --import tsx ops/insights/seed-synthetic.ts --database=testvantagemovers_insights
 */
import { database } from "../local-integration/env";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";

let seed = 20261006;
const rand = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const DAY = 86_400_000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { easternDayKey, easternHour } = await import("../../src/services/dailyOperations/dayDocument.js");
  await connectMongo();
  if (mongoose.connection.name !== database) throw new Error("not the local test database");
  const db = mongoose.connection.db!;
  for (const name of ["lead_source_companies", "lead_source_granularities", "cpl_rate_periods", "agents", "form_leads", "call_leads", "booked_leads", "cancelled_leads", "testimonials"]) {
    await db.collection(name).deleteMany({});
  }

  const companies = [
    { _id: new ObjectId(), company_slug: "harbor_leads", name: "Harbor Leads", owner_label: "Harbor Leads", active: true, granularities: [] },
    { _id: new ObjectId(), company_slug: "bay_leads", name: "Bay Leads", owner_label: "Bay Leads", active: true, granularities: [] },
    { _id: new ObjectId(), company_slug: "summit_leads", name: "Summit Leads", owner_label: "Summit Leads", active: true, granularities: [] },
    { _id: new ObjectId(), company_slug: "free_site", name: "Website", owner_label: "Website", active: true, granularities: [] },
  ];
  await db.collection("lead_source_companies").insertMany(companies.map((c) => ({ ...c, created_from: "seed", createdAt: new Date(), updatedAt: new Date() })));
  const feeds = [
    { company: 0, key: "harbor_form", label: "Harbor Forms", channel: "form", cpl: 205, weight: 30 },
    { company: 0, key: "harbor_call", label: "Harbor Calls", channel: "call", cpl: 180, weight: 8 },
    { company: 1, key: "bay_form", label: "Bay Forms", channel: "form", cpl: 150, weight: 22 },
    { company: 2, key: "summit_form", label: "Summit Forms", channel: "form", cpl: 95, weight: 14 },
    { company: 3, key: "free_site_form", label: "Website Forms", channel: "form", cpl: 0, weight: 10 },
  ].map((feed) => ({ ...feed, _id: new ObjectId() }));
  await db.collection("lead_source_granularities").insertMany(
    feeds.map((feed) => ({
      _id: feed._id,
      source_company: companies[feed.company]!._id,
      granularity_key: feed.key,
      channel: feed.channel,
      owner_label: feed.label,
      crm_label: feed.label,
      aliases: [],
      active: true,
      priority: 0,
      schedule_revision: 1,
      created_from: "seed",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  await db.collection("cpl_rate_periods").insertMany(
    feeds.map((feed) => ({
      source_granularity: feed._id,
      amount_cents: feed.cpl * 100,
      effective_from: new Date("2024-01-01T05:00:00.000Z"),
      effective_from_date: "2024-01-01",
      business_timezone: "America/New_York",
      schedule_revision: 1,
      archived_at: null,
      created_by: { actor_type: "owner", actor_id: "seed", actor_label: "Seed", actor_role: "owner" },
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  const agents = ["Avery", "Blake", "Casey", "Drew", "Emery"].map((name, index) => ({
    _id: new ObjectId(),
    name,
    normalized_name: name.toLowerCase(),
    active: index < 4,
    role: "agent",
  }));
  await db.collection("agents").insertMany(agents);
  const skill = [0.16, 0.11, 0.08, 0.13, 0.06];

  const today = easternDayKey(new Date());
  const start = new Date(new Date(`${today}T00:00:00Z`).getTime() - 150 * DAY);
  const states = ["FL", "FL", "FL", "GA", "NY", "TX", "NC", "CA", "NJ", "IL"];
  const reasons = ["Customer found a cheaper mover", "Move postponed", "Changed their mind", "Booked by mistake"];
  const forms: Record<string, unknown>[] = [];
  const calls: Record<string, unknown>[] = [];
  const bookings: Record<string, unknown>[] = [];
  const cancellations: Record<string, unknown>[] = [];
  const weightTotal = feeds.reduce((sum, feed) => sum + feed.weight, 0);
  const pickFeed = () => {
    let roll = rand() * weightTotal;
    for (const feed of feeds) {
      roll -= feed.weight;
      if (roll <= 0) return feed;
    }
    return feeds[0]!;
  };

  for (let day = 0; day <= 150; day += 1) {
    const date = new Date(start.getTime() + day * DAY);
    const key = dayKey(date);
    const growth = 1 + day / 220;
    const count = Math.round((9 + rand() * 9) * growth * (date.getUTCDay() === 0 ? 0.5 : 1));
    for (let i = 0; i < count; i += 1) {
      const feed = pickFeed();
      const hour = 7 + Math.floor(rand() * 15);
      const wallClock = new Date(date.getTime() + hour * 3_600_000 + Math.floor(rand() * 3_600_000));
      if (key === today && hour > easternHour(new Date())) continue;
      const duplicate = rand() < 0.05;
      const agentIndex = rand() < 0.14 ? -1 : Math.floor(rand() * 4);
      const agent = agentIndex >= 0 ? agents[agentIndex]! : null;
      const pickup = pick(states);
      const delivery = rand() < 0.35 ? pickup : pick(states);
      const leadId = new ObjectId();
      const company = companies[feed.company]!;
      const lead = {
        _id: leadId,
        source_company: company.company_slug,
        lead_source_company: company._id,
        source_granularity_id: feed._id,
        source_granularity_key: feed.key,
        name: `Customer ${forms.length + calls.length + 1}`,
        timestamp: wallClock,
        createdAt: new Date(wallClock.getTime() + 4 * 3_600_000 + 1_000),
        updatedAt: new Date(wallClock.getTime() + 4 * 3_600_000 + 1_000),
        duplicate,
        receiver_agent: agent?._id,
        receiver_agent_name_snapshot: agent?.name,
        pickup_state: pickup,
        delivery_state: delivery,
        local: pickup === delivery ? "local" : "long_distance",
        phone_number: "5550000000",
        pickup_zip: "33101",
        destination_zip: "30301",
        cpl: duplicate ? 0 : feed.cpl,
        cpl_resolution_status: duplicate ? "duplicate_zero" : "resolved",
      } as Record<string, unknown>;
      const conversion = (agentIndex >= 0 ? skill[agentIndex]! : 0.04) * (feed.key === "summit_form" ? 1.5 : feed.key === "free_site_form" ? 0.6 : 1);
      if (!duplicate && rand() < conversion) {
        const bookDay = new Date(Math.min(date.getTime() + Math.floor(rand() * rand() * 25) * DAY, new Date(`${today}T00:00:00Z`).getTime()));
        const binder = Math.round(600 + rand() * rand() * 5_200);
        const bookingId = new ObjectId();
        const split = rand() < 0.12;
        const primary = agent ?? agents[Math.floor(rand() * 4)]!;
        const other = agents[(agents.indexOf(primary) + 1) % 4]!;
        const cancelled = rand() < 0.07;
        const cancelId = cancelled ? new ObjectId() : undefined;
        bookings.push({
          _id: bookingId,
          timestamp: bookDay,
          book_date: bookDay,
          lead_ref: leadId,
          lead_model: feed.channel === "form" ? "FormLead" : "CallLead",
          agent_allocations: split
            ? [
                { agent: primary._id, agent_name_snapshot: primary.name, binder_amount: binder / 2 },
                { agent: other._id, agent_name_snapshot: other.name, binder_amount: binder / 2 },
              ]
            : [{ agent: primary._id, agent_name_snapshot: primary.name, binder_amount: binder }],
          total_binder_amount: binder,
          deposit_amount: Math.round(binder * 1.08),
          merchant: rand() < 0.8 ? "Elavon" : "Stripe",
          source: feed.label,
          is_referral_booking: false,
          is_leadless_booking: false,
          local: lead.local,
          cancelled: cancelId,
        });
        lead.booked = bookingId;
        if (cancelId) {
          const cancelDay = new Date(Math.min(bookDay.getTime() + Math.floor(1 + rand() * 12) * DAY, new Date(`${today}T00:00:00Z`).getTime()));
          cancellations.push({
            _id: cancelId,
            booked_lead: bookingId,
            lead_ref: leadId,
            lead_model: feed.channel === "form" ? "FormLead" : "CallLead",
            cancel_date: cancelDay,
            book_date: bookDay,
            reason: pick(reasons),
            refund_amount: rand() < 0.5 ? 0 : Math.round(binder * 0.5),
            agent: primary.name,
            timestamp: cancelDay,
          });
          lead.cancelled = cancelId;
        }
      }
      (feed.channel === "form" ? forms : calls).push(lead);
    }
    if (rand() < 0.12) {
      const agent = agents[Math.floor(rand() * 4)]!;
      const binder = Math.round(800 + rand() * 2_000);
      bookings.push({
        _id: new ObjectId(),
        timestamp: date,
        book_date: date,
        agent_allocations: [{ agent: agent._id, agent_name_snapshot: agent.name, binder_amount: binder }],
        total_binder_amount: binder,
        deposit_amount: binder,
        merchant: "Elavon",
        source: rand() < 0.5 ? "Referral" : "Direct",
        is_referral_booking: rand() < 0.5,
        is_leadless_booking: true,
      });
    }
  }
  await db.collection("form_leads").insertMany(forms);
  await db.collection("call_leads").insertMany(calls);
  await db.collection("booked_leads").insertMany(bookings);
  if (cancellations.length) await db.collection("cancelled_leads").insertMany(cancellations);

  const reviews = Array.from({ length: 70 }, (_, index) => {
    const date = new Date(new Date(`${today}T00:00:00Z`).getTime() - Math.floor(rand() * 330) * DAY);
    const rating = rand() < 0.8 ? 5 : rand() < 0.5 ? 4 : rand() < 0.5 ? 1 : 3;
    return {
      source: "BBB",
      reviewer_name: `Reviewer ${index + 1}`,
      normalized_reviewer_name: `reviewer ${index + 1}`,
      review_date: date,
      rating,
      review_text: rating >= 4 ? "The crew was on time, careful with the furniture and the price matched the estimate." : "The move was late and a box was damaged; it took a week to hear back.",
      business_response: rand() < 0.5 ? { responded_at: date, text: "Thank you for the feedback." } : null,
      content_fingerprint: `seed-${index}`,
      published: true,
      featured: false,
      createdAt: new Date(new Date(`${today}T00:00:00Z`).getTime() - 20 * DAY),
      updatedAt: new Date(),
    };
  });
  await db.collection("testimonials").insertMany(reviews);
  console.log(`seeded ${database}: ${forms.length} form, ${calls.length} call, ${bookings.length} bookings, ${cancellations.length} cancellations, ${reviews.length} reviews`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
