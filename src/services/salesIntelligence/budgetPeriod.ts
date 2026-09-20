import { getSalesIntelligenceAiBudgetModel } from "../../models/SalesIntelligenceAiBudget";
import { initializeCsiBudgetPeriod } from "./aiBudget";
import { CsiError } from "./auth";
import { localInstant } from "./outreach/staffing";
import { resolvePolicy } from "./policy";

/** Calendar month in the policy timezone; ambiguous midnight fails closed. */
export function csiBudgetMonthBounds(now: Date, timezone: string) {
  if (!Number.isFinite(now.getTime())) throw new CsiError("INVALID_INPUT");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")!.value);
  const monthNumber = Number(parts.find(part => part.type === "month")!.value);
  const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
  const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  const period_start = localInstant(`${month}-01`, 0, timezone);
  const period_end = localInstant(`${next}-01`, 0, timezone);
  if (!period_start || !period_end || period_start > now || period_end <= now) {
    throw new CsiError("INVALID_INPUT");
  }
  return { month, timezone, period_start, period_end };
}

/** Call after a worker's enabled gate. Existing period bounds and spend always win. */
export async function ensureCurrentCsiBudgetPeriod(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new CsiError("INVALID_INPUT");
  const current = await getSalesIntelligenceAiBudgetModel().find({
    period_start: { $lte: now }, period_end: { $gt: now },
  }).sort({ period_start: -1 }).limit(2).lean();
  // Overlapping policy periods must never provide two independent allowances.
  if (current.length > 1) throw new CsiError("IDEMPOTENCY_CONFLICT");
  const row = current[0];
  if (row?.activated_at) return row;
  if (row) return initializeCsiBudgetPeriod({
    month: row.month, policy_version: row.policy_version, ceiling_cents: row.ceiling_cents,
    timezone: row.timezone, period_start: row.period_start, period_end: row.period_end,
  }, now);
  const policy = await resolvePolicy();
  return initializeCsiBudgetPeriod({
    ...csiBudgetMonthBounds(now, policy.timezone),
    policy_version: policy.version, ceiling_cents: policy.monthly_ceiling_cents,
  }, now);
}
