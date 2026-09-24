import mongoose from "mongoose";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { ATTENTION_OUTCOMES, attentionRowDtoSchema, ownerReadSchema, type AttentionOutcome } from "../dto";
import { CsiError } from "../auth";
import { resolvePolicy } from "../policy";
import { resolveRetentionDays } from "../retentionPolicy";
import { payloadHash } from "../transactions";
import { attentionFilterKeys, attentionSortKeys } from "./attention";
import { closedOutcome, recordFilterKeys, type FactsCancellation } from "./facts";
import { loadOutreachInputsBatch, loadOutreachSideData, toOutreachDto } from "./reads";
import { subjectKey, type RecordRow } from "./types";

/**
 * S7-CLOSED (assignment addendum §2.2a, E27; acceptance C14): every closed Outreach record stays
 * findable. The snapshot's closed partition keeps 90 days; this paged read serves every closure
 * that Sales Intelligence retention still holds, newest `closed_at` first, keyset `(closed_at, _id)`.
 *
 * Each row is the snapshot closed-partition row (`publishAttentionSnapshot`): the same outcome DTO
 * (`closedOutcome`), `facts`, `filter_keys` and `sort_keys`, computed at request time from the same
 * batched reads the publish page uses (`loadOutreachInputsBatch`, `loadOutreachSideData`), so a page
 * costs a fixed number of queries whatever its size (B11). Reads only.
 *
 * `outcome`, `priority` and `agent_id` narrow in Mongo first (index `outreach_state_closed`) and are
 * then re-checked with the Closed view's own keys (`recordFilterKeys`, `closedOutcome`), so a row
 * this read returns is exactly a row the Closed view's predicate would accept.
 */
const HISTORY_MAX_LIMIT = 50;
/** A filtered page stops after this many keyset batches and returns its cursor (bounded work per request). */
const HISTORY_MAX_BATCHES = 5;
const instant = z.iso.datetime({ offset: true }).optional();
function repeated<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const parts = (Array.isArray(value) ? value : [value]).flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean);
    return parts.length ? [...new Set(parts)].sort() : undefined;
  }, z.array(schema).min(1).optional());
}

export const closedHistoryQuerySchema = z.object({
  scope: z.literal("production").optional(),
  // Half-open `[closed_from, closed_before)`, the Closed view's bound convention.
  closed_before: instant,
  closed_from: instant,
  outcome: repeated(z.enum(ATTENTION_OUTCOMES)),
  priority: repeated(z.string().regex(/^(not_set|no_lead|[A-Za-z0-9]{1,8})$/)),
  agent_id: repeated(z.string().regex(/^[a-f\d]{24}$/i)),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).default(25),
}).strict();
export type ClosedHistoryQuery = z.infer<typeof closedHistoryQuerySchema>;

export const closedHistoryPageDtoSchema = ownerReadSchema(z.object({
  items: z.array(attentionRowDtoSchema),
  cursor: z.string().nullable(),
  /** `Closed Outreach is kept for {retention}`: the Sales Intelligence activity retention; null days = kept until removed by the Owner. */
  retention: z.object({ days: z.number().int().positive().nullable(), basis: z.literal("activity") }).strict(),
}).strict());
export type ClosedHistoryPageDto = z.infer<typeof closedHistoryPageDtoSchema>;

/** S8-REP hook: a rep's forced scope. The route passes null for the Owner; S8 passes `{ agent_id: actor.agent_id }`. */
export type ClosedHistoryScope = { agent_id: string } | null;

type Keyset = { closed_at: string; id: string };
const cursorSchema = z.object({ closed_at: z.iso.datetime(), id: z.string().regex(/^[a-f\d]{24}$/i), digest: z.string() }).strict();

/** The filters a cursor is bound to (everything except the cursor and the page size). */
export function closedHistoryDigest(query: Omit<ClosedHistoryQuery, "cursor" | "limit">, scope: ClosedHistoryScope) {
  const { scope: _scope, ...filters } = query;
  return payloadHash({ ...filters, forced_agent: scope?.agent_id ?? null });
}
export function encodeClosedHistoryCursor(at: Keyset, digest: string) {
  return Buffer.from(JSON.stringify({ closed_at: at.closed_at, id: at.id, digest })).toString("base64url");
}
export function decodeClosedHistoryCursor(cursor: string, digest: string): Keyset {
  let parsed: z.infer<typeof cursorSchema>;
  try { parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); } catch { throw new CsiError("INVALID_INPUT"); }
  if (parsed.digest !== digest) throw new CsiError("INVALID_INPUT");
  return { closed_at: parsed.closed_at, id: parsed.id };
}

/**
 * `facts.ts` `outcomeReason` as a Mongo predicate: the stored fields each Closed-view outcome comes
 * from. A closure that is no outcome (`lead_context_available`, `lead_unavailable`) matches none.
 * `granot_booked` (S6-P5) is listed so this read follows the outcome enum as soon as it gains it.
 */
const OUTCOME_PREDICATES: Record<string, Record<string, unknown>> = {
  owner: { closure_origin: "owner" },
  crm_dead: { closure_origin: "crm_disposition", closed_reason: "granot_dead_opportunity" },
  crm_bad_unusable: { closure_origin: "crm_disposition", closed_reason: "granot_bad_unusable" },
  granot_booked: { closure_origin: "crm_disposition", closed_reason: "granot_booked" },
  ...Object.fromEntries(["booked", "cancelled", "bad_lead", "duplicate", "no_sync"].map(reason => [reason, { closure_origin: "official", closed_reason: reason }])),
};
export function outcomeMongoPredicate(outcomes: readonly string[] | undefined): Record<string, unknown> {
  const wanted = (outcomes?.length ? outcomes : ATTENTION_OUTCOMES as readonly string[]).filter(outcome => OUTCOME_PREDICATES[outcome]);
  return { $or: wanted.map(outcome => OUTCOME_PREDICATES[outcome]!) };
}
/** `filter_keys.priority` as a Mongo predicate: a Granot code, `not_set` (a Lead without one) or `no_lead`. */
export function priorityMongoPredicate(keys: readonly string[] | undefined): Record<string, unknown> | null {
  if (!keys?.length) return null;
  return { $or: keys.map(key => key === "no_lead" ? { "subject.kind": { $ne: "lead" } }
    : key === "not_set" ? { "subject.kind": "lead", "lead_progress.granot_priority": null }
    : { "subject.kind": "lead", "lead_progress.granot_priority": key }) };
}
/** Strictly older than the keyset position in `(closed_at desc, _id desc)` order. */
export function keysetMongoPredicate(at: Keyset | null): Record<string, unknown> | null {
  if (!at) return null;
  const closedAt = new Date(at.closed_at), id = new mongoose.Types.ObjectId(at.id);
  return { $or: [{ closed_at: { $lt: closedAt } }, { closed_at: closedAt, _id: { $lt: id } }] };
}
export function closedRangePredicate(query: Pick<ClosedHistoryQuery, "closed_from" | "closed_before">): Record<string, unknown> {
  return { closed_at: { $ne: null, ...(query.closed_from ? { $gte: new Date(query.closed_from) } : {}), ...(query.closed_before ? { $lt: new Date(query.closed_before) } : {}) } };
}

type ClosedRow = z.infer<typeof attentionRowDtoSchema>;
/** The Closed view's predicate over one built row's keys (the snapshot read uses the same `filter_keys`). */
export function closedRowMatches(row: Pick<ClosedRow, "filter_keys" | "outcome">, query: Pick<ClosedHistoryQuery, "outcome" | "priority" | "closed_from" | "closed_before">, agents: readonly string[] | null) {
  const keys = row.filter_keys!;
  if (!row.outcome) return false;
  if (query.outcome?.length && !query.outcome.includes(row.outcome.reason as AttentionOutcome)) return false;
  if (query.priority?.length && !query.priority.includes(keys.priority ?? "not_set")) return false;
  if (agents?.length && !keys.agents.some(agent => agents.includes(agent))) return false;
  const at = Date.parse(row.outcome.closed_at);
  if (query.closed_from && at < Date.parse(query.closed_from)) return false;
  if (query.closed_before && at >= Date.parse(query.closed_before)) return false;
  return true;
}
/** The effective agent filter: a forced rep scope replaces whatever the caller asked for (S8-REP). */
export function effectiveAgents(query: Pick<ClosedHistoryQuery, "agent_id">, scope: ClosedHistoryScope): string[] | null {
  if (scope) return [scope.agent_id];
  return query.agent_id?.length ? query.agent_id : null;
}

/**
 * The closed-partition rows for one batch of records, exactly as the publish builds them: one batched
 * inputs load, one side-data load, one pending-assessment read. Records whose closure is no outcome
 * return null.
 */
async function closedRows(records: readonly RecordRow[], now: Date, context: { policy: Awaited<ReturnType<typeof resolvePolicy>>; coverage: Awaited<ReturnType<typeof readCaptureCoverage>> }) {
  if (!records.length) return [];
  const inputs = await loadOutreachInputsBatch(records, now);
  const [side, queued] = await Promise.all([
    loadOutreachSideData(records, inputs, { now }),
    getSalesIntelligenceJobModel().distinct("subject_key", { ...csiDataset(), stage: "move_assessment", status: { $in: ["pending", "leased", "retry"] },
      subject_key: { $in: records.map(record => subjectKey(record.subject)) } }),
  ]);
  const pending = new Set(queued.map(String));
  const out: Array<{ record: RecordRow; row: ClosedRow | null }> = [];
  for (const record of records) {
    const bundle = inputs.get(String(record._id))!;
    const key = subjectKey(record.subject);
    const outreach = await toOutreachDto(record, now, context.coverage, { policy: context.policy, inputs: bundle, side, assessmentPending: pending.has(key) });
    const lead = record.subject.kind === "lead" ? `${record.subject.model}:${String(record.subject.id)}` : null;
    const bookings = lead ? side.bookings.get(lead) ?? [] : [];
    const cancellations: FactsCancellation[] = bookings.flatMap(booking => (side.cancellations.get(String(booking._id)) ?? []).map(row => ({ ...row, booked_lead: booking._id })));
    const outcome = closedOutcome({ record, bookings, cancellations, agentNames: side.agentNames }, outreach.facts?.calls_total ?? null);
    if (!outcome) { out.push({ record, row: null }); continue; }
    const recordKeys = recordFilterKeys({ record, followups: bundle.actions }, outreach.facts!, outcome);
    // Publish §2.3: the closed card reduces to `Open` (no follow-ups, no actions).
    const closed = { ...outreach, followups: [], allowed_actions: [] };
    const base = { subject_key: key, subject: outreach.subject, outreach: closed, derived: outreach.derived, allowed_actions: [] };
    out.push({ record, row: { ...base, sort_keys: { ...attentionSortKeys(base), closed: outcome.closed_at, time_to_close: outcome.time_to_close_ms }, in_attention: false,
      partition: "closed", filter_keys: attentionFilterKeys(base, recordKeys), outcome } });
  }
  return out;
}

/** The Mongo filter for one keyset batch (every narrowing is re-checked on the built row). */
export function closedHistoryFilter(query: ClosedHistoryQuery, after: Keyset | null, agentRecordIds: readonly mongoose.Types.ObjectId[] | null, agents: readonly string[] | null) {
  const and: Record<string, unknown>[] = [outcomeMongoPredicate(query.outcome)];
  const priority = priorityMongoPredicate(query.priority);
  if (priority) and.push(priority);
  const keyset = keysetMongoPredicate(after);
  if (keyset) and.push(keyset);
  if (agents) and.push({ $or: [{ responsible_agent_id: { $in: agents.map(id => new mongoose.Types.ObjectId(id)) } }, ...(agentRecordIds?.length ? [{ _id: { $in: agentRecordIds } }] : [])] });
  return { state: "closed" as const, purged_at: null, ...closedRangePredicate(query), $and: and } as Record<string, unknown>;
}

export async function readClosedHistory(raw: z.input<typeof closedHistoryQuerySchema>, options: { scope?: ClosedHistoryScope; now?: Date } = {}): Promise<ClosedHistoryPageDto> {
  const query = closedHistoryQuerySchema.parse(raw);
  const scope = options.scope ?? null;
  const now = options.now ?? new Date();
  const { cursor, limit, ...filters } = query;
  const digest = closedHistoryDigest(filters, scope);
  let after = cursor ? decodeClosedHistoryCursor(cursor, digest) : null;
  const agents = effectiveAgents(query, scope);
  const [policy, coverage, retention, agentRecordIds] = await Promise.all([
    resolvePolicy(), readCaptureCoverage(), resolveRetentionDays(),
    // `filter_keys.agents` also names follow-up responsibility and promises (V10): one distinct per request.
    agents ? getOutreachFollowupModel().distinct("outreach_record_id", { $or: [{ responsible_agent_id: { $in: agents.map(id => new mongoose.Types.ObjectId(id)) } },
      { promised_by_agent_id: { $in: agents.map(id => new mongoose.Types.ObjectId(id)) } }] }) as Promise<mongoose.Types.ObjectId[]> : Promise.resolve(null),
  ]);
  const items: ClosedRow[] = [];
  let exhausted = false;
  for (let batch = 0; batch < HISTORY_MAX_BATCHES && items.length < limit; batch++) {
    const want = limit - items.length;
    const records = await getOutreachRecordModel().find(closedHistoryFilter(query, after, agentRecordIds, agents) as never)
      .sort({ closed_at: -1, _id: -1 }).limit(want + 1).lean() as RecordRow[];
    const page = records.slice(0, want);
    for (const { record, row } of await closedRows(page, now, { policy, coverage })) {
      after = { closed_at: record.closed_at!.toISOString(), id: String(record._id) };
      if (row && closedRowMatches(row, query, agents)) items.push(row);
    }
    if (records.length <= want) { exhausted = true; break; }
  }
  const next = !exhausted && after ? encodeClosedHistoryCursor(after, digest) : null;
  return closedHistoryPageDtoSchema.parse({ as_of: now.toISOString(), coverage,
    data: { items, cursor: next, retention: { days: retention.activity_days > 0 ? retention.activity_days : null, basis: "activity" } } });
}
