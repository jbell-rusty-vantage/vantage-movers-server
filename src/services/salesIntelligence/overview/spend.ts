import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import type { OverviewPeriod } from "./periods";

/**
 * Addendum §7 (E19–E21) and §6.2 Outcomes. The cohort is every Form and Call Lead whose `timestamp`
 * (ET wall clock) falls in the period, minus `duplicate` and `no_sync` Leads. The rep is the Lead's
 * **current** `receiver_agent` (null → Unassigned). Spend reads the stored `cpl`; nothing is re-priced.
 */
export const SPEND_BASES = ["rate", "legacy", "unpriced", "zero"] as const;
export type SpendBasis = (typeof SPEND_BASES)[number];
export type SpendLead = {
  _id: unknown; model: "FormLead" | "CallLead"; timestamp?: Date | null; receiver_agent?: unknown; cpl?: number | null; cpl_rate_period?: unknown;
  cpl_resolution_status?: string | null; source_granularity_label_snapshot?: string | null; source_company?: string | null;
  quoted?: boolean | null; granot_priority?: string | null; booked?: unknown;
};

/**
 * E20, in this order:
 * 1. `resolved` with a rate period → the stored `cpl`, `rate`;
 * 2. `missing_rate` → $0, `unpriced` (counted; the resolver stores `cpl` 0 for it);
 * 3. `duplicate_zero` / `not_applicable` → $0, `zero`;
 * 4. otherwise a positive `cpl` with no rate period (pre-rate-period Leads) → that `cpl`, `legacy`;
 * 5. no `cpl_resolution_status` at all and `cpl` 0 or missing → $0, `unpriced` (V-T3 m12: the price is unknown,
 *    not a known $0; the detail's `lead_cost` shows it as unpriced rather than "Lead cost $0");
 * 6. anything else → $0, `zero`.
 * Every basis adds exactly the stored `cpl` for the Lead it names except `unpriced` / `zero`, which store 0,
 * so the spend total equals Σ `cpl` over the cohort (C10).
 */
export function spendBasis(lead: Pick<SpendLead, "cpl" | "cpl_rate_period" | "cpl_resolution_status">): { basis: SpendBasis; amount: number } {
  const cpl = typeof lead.cpl === "number" && Number.isFinite(lead.cpl) ? lead.cpl : 0;
  const status = lead.cpl_resolution_status ?? null;
  if (status === "resolved" && lead.cpl_rate_period) return { basis: "rate", amount: cpl };
  if (status === "missing_rate") return { basis: "unpriced", amount: 0 };
  if (status === "duplicate_zero" || status === "not_applicable") return { basis: "zero", amount: 0 };
  if (cpl > 0) return { basis: "legacy", amount: cpl };
  if (status === null) return { basis: "unpriced", amount: 0 };
  return { basis: "zero", amount: 0 };
}

const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (value: number) => value / 100;
export type SpendBucket = { leads: number; spend: number; rate: number; legacy: number; unpriced_leads: number; zero_leads: number };
export type SourceBucket = SpendBucket & { source: string; unit_cpl: number | null };
export type OutcomeBucket = { leads: number; quoted: number; booked_in_granot: number; booked_official: number; bookings: number; booking_rate: number | null };
export type RepCohort = { spend: SpendBucket; by_source: SourceBucket[]; outcomes: OutcomeBucket; cost_per_booking: number | null };

type Acc = { leads: number; spend: number; rate: number; legacy: number; unpriced: number; zero: number; amounts: Set<number>;
  quoted: number; granot: number; official: number; bookings: number };
const acc = (): Acc => ({ leads: 0, spend: 0, rate: 0, legacy: 0, unpriced: 0, zero: 0, amounts: new Set(), quoted: 0, granot: 0, official: 0, bookings: 0 });
function add(target: Acc, basis: SpendBasis, amountCents: number, outcome: { quoted: boolean; granot: boolean; official: boolean }) {
  target.leads++;
  target.spend += amountCents;
  if (basis === "rate") target.rate += amountCents;
  else if (basis === "legacy") target.legacy += amountCents;
  else if (basis === "unpriced") target.unpriced++;
  else target.zero++;
  target.amounts.add(amountCents);
  if (outcome.quoted) target.quoted++;
  if (outcome.granot) target.granot++;
  if (outcome.official) target.official++;
  if (outcome.granot || outcome.official) target.bookings++;
}
const spendOf = (a: Acc): SpendBucket => ({ leads: a.leads, spend: dollars(a.spend), rate: dollars(a.rate), legacy: dollars(a.legacy), unpriced_leads: a.unpriced, zero_leads: a.zero });
const outcomesOf = (a: Acc): OutcomeBucket => ({ leads: a.leads, quoted: a.quoted, booked_in_granot: a.granot, booked_official: a.official, bookings: a.bookings,
  booking_rate: a.leads ? a.bookings / a.leads : null });

/** The source a Lead is spent through (`TBM Form · 5 × $40 = $200`). */
export const sourceLabel = (lead: Pick<SpendLead, "source_granularity_label_snapshot" | "source_company">) =>
  lead.source_granularity_label_snapshot?.trim() || lead.source_company?.trim() || "Unknown source";

/**
 * Pure aggregation (§7): per current `receiver_agent` (`null` → Unassigned), the Lead count, spend,
 * basis split and per-source expansion, and the §6.2 outcomes over the same cohort. `officialBooked`
 * names the Leads (`Model:id`) with an exact `booked_leads` row. Money is summed in cents.
 */
export function aggregateCohort(leads: readonly SpendLead[], officialBooked: ReadonlySet<string>) {
  const byRep = new Map<string | null, { all: Acc; sources: Map<string, Acc> }>();
  const total = acc(), totalSources = new Map<string, Acc>();
  for (const lead of leads) {
    const { basis, amount } = spendBasis(lead);
    const amountCents = cents(amount);
    const outcome = { quoted: lead.quoted === true, granot: lead.granot_priority === "5",
      official: officialBooked.has(`${lead.model}:${String(lead._id)}`) || Boolean(lead.booked) };
    const rep = lead.receiver_agent ? String(lead.receiver_agent) : null;
    let bucket = byRep.get(rep);
    if (!bucket) byRep.set(rep, bucket = { all: acc(), sources: new Map() });
    const source = sourceLabel(lead);
    for (const [target, sources] of [[bucket.all, bucket.sources], [total, totalSources]] as const) {
      add(target, basis, amountCents, outcome);
      let s = sources.get(source);
      if (!s) sources.set(source, s = acc());
      add(s, basis, amountCents, outcome);
    }
  }
  const sourcesOf = (sources: Map<string, Acc>): SourceBucket[] => [...sources.entries()]
    .map(([source, a]) => ({ source, ...spendOf(a), unit_cpl: a.amounts.size === 1 && a.leads > 0 ? dollars([...a.amounts][0]!) : null }))
    .sort((a, b) => b.spend - a.spend || a.source.localeCompare(b.source));
  const cohort = (entry: { all: Acc; sources: Map<string, Acc> }): RepCohort => ({ spend: spendOf(entry.all), by_source: sourcesOf(entry.sources), outcomes: outcomesOf(entry.all),
    cost_per_booking: entry.all.bookings ? dollars(Math.round(entry.all.spend / entry.all.bookings)) : null });
  return {
    total: { ...spendOf(total), outcomes: outcomesOf(total) },
    by_source: sourcesOf(totalSources),
    by_rep: new Map([...byRep.entries()].filter(([rep]) => rep !== null).map(([rep, entry]) => [rep!, cohort(entry)])),
    unassigned: byRep.has(null) ? cohort(byRep.get(null)!) : null,
  };
}

const LEAD_PROJECTION = { _id: 1, timestamp: 1, receiver_agent: 1, cpl: 1, cpl_rate_period: 1, cpl_resolution_status: 1, source_granularity_label_snapshot: 1,
  source_company: 1, quoted: 1, granot_priority: 1, booked: 1 } as const;
/**
 * Read side (index `{ timestamp: 1, receiver_agent: 1 }` on both Lead collections): two Lead reads and
 * one `booked_leads` `$in`. A Priority filter (Lead-based, §4.5) narrows in Mongo: `not_set` = no code;
 * `no_lead` selects no Lead.
 */
export async function loadSpendCohort(period: Pick<OverviewPeriod, "lead_start" | "lead_end">, filters: { priority?: readonly string[] | null; agent_id?: string | null } = {}) {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const codes = filters.priority?.filter(key => key !== "no_lead") ?? null;
  if (filters.priority?.length && !codes!.length) return { leads: [] as SpendLead[], officialBooked: new Set<string>() };
  const match: Record<string, unknown> = { timestamp: { $gte: period.lead_start, $lt: period.lead_end }, duplicate: { $ne: true }, no_sync: { $ne: true },
    ...(filters.agent_id ? { receiver_agent: new mongoose.Types.ObjectId(filters.agent_id) } : {}),
    ...(codes?.length ? { $or: codes.map(code => code === "not_set" ? { granot_priority: null } : { granot_priority: code }) } : {}) };
  const [form, call] = await Promise.all([
    db.collection("form_leads").find(match, { projection: LEAD_PROJECTION }).toArray(),
    db.collection("call_leads").find(match, { projection: LEAD_PROJECTION }).toArray(),
  ]);
  const leads: SpendLead[] = [...form.map(l => ({ ...l, model: "FormLead" as const })), ...call.map(l => ({ ...l, model: "CallLead" as const }))] as SpendLead[];
  const officialBooked = new Set<string>();
  if (leads.length) {
    const rows = await db.collection("booked_leads").find({ lead_ref: { $in: leads.map(l => l._id) } }, { projection: { lead_ref: 1, lead_model: 1 } }).toArray();
    for (const row of rows) officialBooked.add(`${String(row.lead_model)}:${String(row.lead_ref)}`);
  }
  return { leads, officialBooked };
}
