import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { attentionRowDtoSchema, attentionPageDtoSchema, ATTENTION_SORTS, ATTENTION_SORT_DEFAULT_DIRECTION, ATTENTION_VIEWS, ATTENTION_FRESHNESS,
  ATTENTION_CLOSED_SORTS, ATTENTION_OUTCOMES, type AttentionFilterKeysDto, type AttentionMetricsDto } from "../dto";
import { attentionIndexEntry, decodeAttentionIndex, encodeAttentionIndex, entryMatchesAttentionQuery, sortAttentionEntries,
  type AttentionIndexEntry, type AttentionMatchContext } from "./attentionIndex";
import { closedOutcome, outcomeReason, recordFilterKeys, type FactsCancellation, type RecordFilterKeys } from "./facts";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { assessmentSortKeys } from "../assessment/presentation";
import { CsiError } from "../auth";
import { resolvePolicy } from "../policy";
import { payloadHash } from "../transactions";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { deriveOutreachFacts, loadOutreachInputsBatch, loadOutreachSideData, toOutreachDto } from "./reads";
import { subjectKey } from "./types";
import { jsonValue } from "./store";

function repeatedQuery<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].sort() : undefined;
  }, z.array(schema).min(1).optional());
}

const ATTENTION_STATES = ["unworked", "open", "waiting_on_customer", "identity_review", "closed"] as const;
const bool = z.enum(["true", "false"]).optional();
const instant = z.iso.datetime({ offset: true }).optional();
/** Closed-view parameters (final spec §8); any other view rejects them instead of ignoring them. */
const CLOSED_ONLY_PARAMS = ["outcome", "closed_from", "closed_to"] as const;

/**
 * Final spec §7.3 / §8, data spec §3.4. No new parameter has a default, so a request without it
 * parses to the same object (and the same cursor digest) as before S2. `rep_unread` is Phase 5
 * (S5) and is rejected as an unknown parameter until then.
 */
export const attentionQuerySchema = z.object({
  scope: z.literal("production").optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  band: repeatedQuery(z.coerce.number().int().min(1).max(7)),
  needs_review: bool,
  state: repeatedQuery(z.enum(ATTENTION_STATES)),
  agent_id: repeatedQuery(z.string().regex(/^[a-f\d]{24}$/i)),
  unassigned: bool,
  attachment: z.enum(["lead", "none"]).optional(),
  // Granot Priority codes; the literal `not_set` selects rows without a Priority.
  priority: repeatedQuery(z.string().regex(/^(not_set|[A-Za-z0-9]{1,8})$/)),
  has_recording: bool,
  has_assessment: bool,
  newer_call: bool,
  ti_min: z.coerce.number().int().min(0).max(100).optional(),
  ml_min: z.coerce.number().int().min(0).max(100).optional(),
  received_from: instant,
  received_to: instant,
  // Calendar days in America/New_York from the snapshot `as_of`: move date in [today, today + n].
  move_date_within: z.coerce.number().int().min(0).max(366).optional(),
  move_date_passed: bool,
  outcome: repeatedQuery(z.enum(ATTENTION_OUTCOMES)),
  closed_from: instant,
  closed_to: instant,
  // §14.1 / Move assessment §8: one sort parameter and one cursor mechanism for time and score sorts.
  // The server never switches view; the Admin selects `all_outreach` with a score sort.
  sort: z.enum(ATTENTION_SORTS).default("attention"),
  direction: z.enum(["asc", "desc"]).optional(),
  view: z.enum(ATTENTION_VIEWS).default("attention"),
  // `fresh` excludes rows whose frozen assessment is stale; absent means `all`.
  freshness: z.enum(ATTENTION_FRESHNESS).optional(),
}).strict().superRefine((query, ctx) => {
  if (query.view === "closed") return;
  for (const param of CLOSED_ONLY_PARAMS) if (query[param] !== undefined) ctx.addIssue({ code: "custom", path: [param], message: "Only with view=closed" });
  if ((ATTENTION_CLOSED_SORTS as readonly string[]).includes(query.sort)) ctx.addIssue({ code: "custom", path: ["sort"], message: "Only with view=closed" });
});
export type AttentionSort = (typeof ATTENTION_SORTS)[number];
export type AttentionQuery = z.infer<typeof attentionQuerySchema>;

/**
 * `SALES_INTELLIGENCE_ATTENTION_V2` (data spec §9, TEAM-1 §7), default off. On: the publish keeps
 * the 90-day closed partition, writes `metrics` and the index array on the header. Off: the publish
 * writes today's rows (plus the additive `partition` / `filter_keys` row fields).
 */
export function attentionV2Enabled(): boolean {
  return csiFlag("ATTENTION_V2");
}

/**
 * §14.1 ordering keys, computed once at publish from the frozen row. Never `updatedAt`, `projected_at` or `as_of`.
 * Score keys (Move assessment §8) come from the row's frozen `outreach.move_assessment`, whose applicability
 * was already applied: closed/terminal → null + `not_applicable`; stale keeps its number.
 */
export function attentionSortKeys(row: Pick<z.infer<typeof attentionRowDtoSchema>, "outreach" | "derived">) {
  const record = row.outreach;
  const open = record?.followups.filter(a => a.status === "open") ?? [];
  const dues = open.map(a => a.attention_due_at).filter((at): at is string => Boolean(at));
  if (record?.state === "unworked" && record.subject.kind === "lead" && record.subject.model === "FormLead" && record.first_action_due_at) dues.push(record.first_action_due_at);
  return {
    next_action_due: dues.length ? dues.sort()[0]! : null,
    lead_received: record?.subject.kind === "lead" ? record.trigger_at ?? null : null,
    last_human_contact: record?.last_meaningful_contact_at ?? null,
    last_lead_progress: record?.lead_progress?.last_progress_at ?? null,
    ...assessmentSortKeys(record?.move_assessment),
    // Data spec §3.3 (S1): from the row's frozen `facts`; null without a Number (never 0).
    last_call: record?.facts?.last_call_at ?? null,
    interactions: record?.facts?.calls_total ?? null,
  };
}
/**
 * Global order over the whole filtered snapshot: value order, nulls last in both directions, ties on subject_key.
 * Time keys compare as ISO strings, score keys numerically; there is no implicit band or confidence prefix.
 */
export function sortAttentionRows<T extends Pick<z.infer<typeof attentionRowDtoSchema>, "subject_key" | "sort_keys">>(rows: readonly T[], sort: AttentionSort, direction: "asc" | "desc"): T[] {
  return sortAttentionEntries(rows, sort, direction);
}

/**
 * Data spec §3.4 over one row's frozen keys (the same predicate the read runs over the index).
 * `context.as_of` is the snapshot's publish time; the move-date filters need it. D7 / V10: a rep
 * matches the record they own and every follow-up they are responsible for or promised.
 */
export function rowMatchesAttentionQuery(row: z.infer<typeof attentionRowDtoSchema>, query: AttentionQuery, context?: AttentionMatchContext) {
  return entryMatchesAttentionQuery(attentionIndexEntry(row, 0), query, context);
}

/** Filter keys of one published row: the record's (`recordFilterKeys`) plus the derived band, review badge and state. */
export function attentionFilterKeys(row: Pick<z.infer<typeof attentionRowDtoSchema>, "derived" | "outreach">, record: RecordFilterKeys): AttentionFilterKeysDto {
  return { band: row.derived.attention_band ?? null, needs_review: Boolean(row.derived.review_badges?.length), state: row.outreach?.state ?? null, ...record };
}

const DAY_MS = 86_400_000;
export const ATTENTION_CLOSED_RETENTION_MS = 90 * DAY_MS;
const METRICS_WINDOW_MS = 7 * DAY_MS;
const PENDING_ASSESSMENT = new Set(["pending", "not_assessed"]);
/**
 * Data spec §3.6 / final spec §6, over the rows of one publish. `leadsReceived7d` is counted during
 * the walk (it covers closed records outside the partition). "Active rows" are the active partition
 * minus closed work (badge-only closed rows stay out of the tiles).
 */
export function attentionMetrics(rows: readonly z.infer<typeof attentionRowDtoSchema>[], leadsReceived7d: number, asOf: Date): AttentionMetricsDto {
  let notCalled = 0, overdue = 0, awaiting = 0;
  const booked: number[] = [];
  let booked7d = 0;
  for (const row of rows) {
    if (row.partition === "closed") {
      if (row.outcome?.reason !== "booked" || Date.parse(row.outcome.closed_at) < +asOf - METRICS_WINDOW_MS) continue;
      booked7d++;
      if (row.outcome.time_to_close_ms != null) booked.push(row.outcome.time_to_close_ms);
      continue;
    }
    if (row.outreach?.state === "closed") continue;
    if (row.derived.attention_band === 2) notCalled++;
    if (row.derived.attention_band === 1) overdue++;
    const facts = row.outreach?.facts;
    const status = row.outreach?.move_assessment?.status ?? "not_assessed";
    if (facts && (facts.newer_call_since_assessment || ((facts.conversations_total ?? 0) >= 1 && PENDING_ASSESSMENT.has(status)))) awaiting++;
  }
  booked.sort((a, b) => a - b);
  const median = booked.length ? (booked.length % 2 ? booked[(booked.length - 1) / 2]! : (booked[booked.length / 2 - 1]! + booked[booked.length / 2]!) / 2) : null;
  return { as_of: asOf.toISOString(), leads_received_7d: leadsReceived7d, not_called_yet: notCalled, callbacks_overdue: overdue, awaiting_assessment: awaiting,
    booked_7d: booked7d, booked_7d_median_days: median == null ? null : Math.floor(median / DAY_MS) };
}
const PUBLISH_PAGE = 500;
/** Own cron, `maxDuration` 120s. 40s was the shared ensure slot and expired mid-walk. */
export const ATTENTION_PUBLISH_BUDGET_MS = 90_000;
const ATTENTION_INLINE_BYTES = 12_000_000;
const ATTENTION_CHUNK_BYTES = 900_000;
const ATTENTION_DECODE_MAX_BYTES = 64_000_000;
export const ATTENTION_FRESH_MS = 300_000;

/** Internal lossless cache only; no change to the public Attention DTO. */
export function compressAttentionRows(rows: readonly unknown[]): string | null {
  const raw = Buffer.from(JSON.stringify(rows));
  if (raw.length > ATTENTION_DECODE_MAX_BYTES) return null;
  const encoded = gzipSync(raw).toString("base64");
  return Buffer.byteLength(encoded) <= ATTENTION_INLINE_BYTES ? encoded : null;
}
export function decompressAttentionRows(encoded: string): unknown[] {
  const rows: unknown = JSON.parse(gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: ATTENTION_DECODE_MAX_BYTES }).toString("utf8"));
  if (!Array.isArray(rows)) throw new Error("Invalid Attention cache");
  return rows;
}

/** Conversation reviews keep their stable key and open their actual Number. */
export function attentionReviewSubject(key: string, conversationNumbers: ReadonlyMap<string, string>) {
  const parts = key.split(":");
  if (parts[0] === "number" && /^[a-f\d]{24}$/i.test(parts[1] ?? "")) return { kind: "number_review" as const, contact_number_id: parts[1]! };
  if (parts[0] === "lead" && ["FormLead", "CallLead"].includes(parts[1] ?? "") && /^[a-f\d]{24}$/i.test(parts[2] ?? "")) return { kind: "lead" as const, model: parts[1] as "FormLead" | "CallLead", id: parts[2]! };
  const number = parts[0] === "conversation" ? conversationNumbers.get(parts[1]!) : undefined;
  return number ? { kind: "number_review" as const, contact_number_id: number } : null;
}

/** Split an ordered row list so each sibling document stays under Mongo's 16 MB ceiling. */
export function splitAttentionChunks<T>(rows: readonly T[], maxBytes = ATTENTION_CHUNK_BYTES): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 2;
  for (const row of rows) {
    const piece = Buffer.byteLength(JSON.stringify(row));
    const next = current.length === 0 ? piece + 2 : size + 1 + piece;
    if (current.length > 0 && next > maxBytes) {
      chunks.push(current);
      current = [row];
      size = piece + 2;
    } else {
      current.push(row);
      size = next;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Worker-created read snapshot. Aborts instead of publishing a truncated
 * Attention list.
 *
 * Band membership is decided from batch-loaded record state before any Owner
 * detail DTO is built: `derive()` needs only followups, restrictions, review
 * items, the Contact Number and the 24-hour attempt audit, and those load for
 * a whole page in five `$in` queries. Only records that actually earned a band
 * or a badge pay for a DTO. Policy and Coverage are publish-wide invariants and
 * are resolved once. Before this the publish paid roughly twelve round trips
 * for every non-purged record — about 48,000 inside a 40-second budget at
 * production volume — which is why it never landed (14 §2).
 *
 * Move assessment §8: the same frozen list also carries every other non-closed
 * record (`in_attention: false`) so `view=all_outreach` and the score sorts read
 * one snapshot. Those rows reuse the page's batched inputs and side data, and
 * the queued-assessment set is one query per publish, so no per-row read is added.
 */
export async function publishAttentionSnapshot(options: { deadlineMs?: number; attentionV2?: boolean; layout?: "auto" | "chunked"; chunkBytes?: number } = {}) {
  const now = new Date();
  const deadline = +now + (options.deadlineMs ?? ATTENTION_PUBLISH_BUDGET_MS);
  // Data spec §3.5–§3.7 behind SALES_INTELLIGENCE_ATTENTION_V2; off keeps today's publish.
  const v2 = options.attentionV2 ?? attentionV2Enabled();
  const closedSince = +now - ATTENTION_CLOSED_RETENTION_MS, receivedSince = +now - METRICS_WINDOW_MS;
  let leadsReceived7d = 0;
  const [policy, coverage, queued] = await Promise.all([resolvePolicy(), readCaptureCoverage(),
    getSalesIntelligenceJobModel().distinct("subject_key", { ...csiDataset(), stage: "move_assessment", status: { $in: ["pending", "leased", "retry"] } })]);
  const pendingAssessments = new Set(queued.map(String));
  const rows: z.infer<typeof attentionRowDtoSchema>[] = [];
  const closedRows: z.infer<typeof attentionRowDtoSchema>[] = [];
  let after: string | undefined;
  for (;;) {
    if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
    const page = await getOutreachRecordModel().find({ purged_at: null, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PUBLISH_PAGE).lean();
    const inputs = await loadOutreachInputsBatch(page, now);
    const desk = [];
    for (const record of page) {
      // §3.6 `leads_received_7d`: every walked record, any state (the walk already excludes purged records).
      if (record.trigger_kind === "lead_arrival" && record.trigger_at && +record.trigger_at >= receivedSince) leadsReceived7d++;
      const bundle = inputs.get(String(record._id));
      if (!bundle) continue;
      const facts = deriveOutreachFacts(record, bundle, { now, policy, coverage });
      const inAttention = Boolean(facts.attention_band || facts.review_badges.length);
      // §3.5: closed work with an outcome, closed in the last 90 days. A closed row that also has a
      // review badge keeps its in-Attention row and is emitted in the closed partition as well.
      const closedKeep = v2 && record.state === "closed" && Boolean(record.closed_at && +record.closed_at >= closedSince) && outcomeReason(record) !== null;
      const active = inAttention || record.state !== "closed";
      if (!active && !closedKeep) continue;
      desk.push({ record, bundle, inAttention, active, closedKeep });
    }
    if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
    if (desk.length) {
      const side = await loadOutreachSideData(desk.map(item => item.record), inputs);
      for (const { record, bundle, inAttention, active, closedKeep } of desk) {
        if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
        const key = subjectKey(record.subject);
        const outreach = await toOutreachDto(record, now, coverage, { policy, inputs: bundle, side, assessmentPending: pendingAssessments.has(key) });
        const lead = record.subject.kind === "lead" ? `${record.subject.model}:${String(record.subject.id)}` : null;
        const bookings = lead ? side.bookings.get(lead) ?? [] : [];
        const cancellations: FactsCancellation[] = bookings.flatMap(booking => (side.cancellations.get(String(booking._id)) ?? []).map(row => ({ ...row, booked_lead: booking._id })));
        const outcome = closedKeep ? closedOutcome({ record, bookings, cancellations, agentNames: side.agentNames }, outreach.facts?.calls_total ?? null) : null;
        const facts = outreach.facts!;
        const recordKeys = recordFilterKeys({ record, followups: bundle.actions }, facts, outcome);
        if (active) {
          const row = { subject_key: key, subject: outreach.subject, outreach, derived: outreach.derived, allowed_actions: outreach.allowed_actions };
          // The active row never names a closure outcome, even for badge-only closed work.
          rows.push({ ...row, sort_keys: attentionSortKeys(row), in_attention: inAttention, partition: "active",
            filter_keys: attentionFilterKeys(row, { ...recordKeys, outcome: null, closed_at: null }) });
        }
        if (closedKeep && outcome) {
          // §2.3: the closed card reduces to `Open`, which keeps 90 days of history inside the inline budget.
          const closed = { ...outreach, followups: [], allowed_actions: [] };
          const row = { subject_key: key, subject: outreach.subject, outreach: closed, derived: outreach.derived, allowed_actions: [] };
          closedRows.push({ ...row, sort_keys: { ...attentionSortKeys(row), closed: outcome.closed_at, time_to_close: outcome.time_to_close_ms }, in_attention: false,
            partition: "closed", filter_keys: attentionFilterKeys(row, recordKeys), outcome });
        }
      }
    }
    if (page.length < PUBLISH_PAGE) break;
    after = String(page.at(-1)!._id);
  }
  const reviews = await getSalesIntelligenceReviewItemModel().find({ state: "open" }).lean();
  const conversationIds = [...new Set(reviews.map(review => review.subject_key).filter(key => /^conversation:[a-f\d]{24}$/i.test(key)).map(key => key.split(":")[1]!))];
  const conversations = conversationIds.length ? await getLeadConversationModel().find({ _id: { $in: conversationIds } }).select({ contact_number_id: 1 }).lean() : [];
  const conversationNumbers = new Map(conversations.flatMap(conversation => conversation.contact_number_id ? [[String(conversation._id), String(conversation.contact_number_id)] as const] : []));
  const published = new Set(rows.map(r => r.subject_key));
  for (const review of reviews) {
    if (published.has(review.subject_key)) continue;
    const subject = attentionReviewSubject(review.subject_key, conversationNumbers);
    // A missing/purged conversation cannot supply a navigable Number; its review
    // remains in the review store and must not prevent every other row publishing.
    if (!subject) continue;
    const same = reviews.filter(r => r.subject_key === review.subject_key);
    const derived = { overdue: false, no_owner: false, no_next_action: false, cooldown: false,
      attention_band: null, reasons: [], review_item_ids: same.map(r => String(r._id)), review_badges: [...new Set(same.map(r => r.cause_kind))], call_blockers: ["review_only"], age_wall_ms: 0, age_staffed_ms: 0, policy_version: policy.version };
    rows.push(attentionRowDtoSchema.parse({ subject_key: review.subject_key, subject, outreach: null, allowed_actions: [], derived,
      sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, ...assessmentSortKeys(null), last_call: null, interactions: null }, in_attention: true,
      partition: "active", filter_keys: { band: null, needs_review: true, state: null, agents: [], attachment: subject.kind === "lead" ? "lead" : "none", priority: null,
        has_recording: false, has_assessment: false, newer_call: false, ti: null, ml: null, received_at: null, move_date: null, outcome: null, closed_at: null } }));
    published.add(review.subject_key);
  }
  const orderTime = (r: z.infer<typeof attentionRowDtoSchema>) => {
    if (r.derived.attention_band === 2) return r.outreach?.first_action_due_at ?? r.outreach?.trigger_at ?? "9999";
    const actions = r.outreach?.followups.filter(a => a.status === "open" && (r.derived.attention_band !== 1 || (a.kind === "call" && a.origin === "rep_promise")) &&
      (r.derived.attention_band !== 3 || a.origin === "system_default")) ?? [];
    return actions.map(a => a.attention_due_at).filter((at): at is string => Boolean(at)).sort()[0] ?? r.outreach?.trigger_at ?? "9999";
  };
  rows.sort((a,b) => (a.derived.attention_band ?? 8) - (b.derived.attention_band ?? 8) || orderTime(a).localeCompare(orderTime(b)) || a.subject_key.localeCompare(b.subject_key));
  // Closed rows follow every active row (their `attention` order is newest closure first); views never mix them.
  closedRows.sort((a, b) => String(b.outcome?.closed_at).localeCompare(String(a.outcome?.closed_at)) || a.subject_key.localeCompare(b.subject_key));
  const metrics = v2 ? attentionMetrics([...rows, ...closedRows], leadsReceived7d, now) : null;
  const encoded = z.array(attentionRowDtoSchema).parse(jsonValue([...rows, ...closedRows]));
  const snapshot_id = `outreach:${randomUUID()}`;
  const expires_at = null;
  const header = { snapshot_id, owner_id: "system", filter_digest: payloadHash({}), policy_version: policy.version, ...csiDataset(), as_of: now, expires_at, chunk_index: null, parent_snapshot_id: null };
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const compressed = options.layout === "chunked" ? null : compressAttentionRows(encoded);
  const inline = !compressed && options.layout !== "chunked" && Buffer.byteLength(JSON.stringify(encoded)) <= ATTENTION_INLINE_BYTES;
  const chunks = compressed || inline ? null : splitAttentionChunks(encoded, options.chunkBytes);
  // §3.7: the index names where each row lives, so the read materializes only its page.
  const index = v2 ? encodeAttentionIndex(chunks
    ? chunks.flatMap((part, chunk) => part.map((row, position) => attentionIndexEntry(row, position, chunk)))
    : encoded.map((row, position) => attentionIndexEntry(row, position))) : null;
  const v2Header = v2 ? { metrics, index_gzip_base64: index } : {};
  const counts = { total_items: encoded.length, ...(v2 ? { closed_items: closedRows.length } : {}) };
  await withTransaction(async session => {
    if (compressed) {
      await Snapshot.create([{ ...header, ...v2Header, rows: [], rows_gzip_base64: compressed, counts }], { session });
    } else if (inline) {
      await Snapshot.create([{ ...header, ...v2Header, rows: encoded, counts }], { session });
    } else {
      await Snapshot.create([{ ...header, ...v2Header, rows: [], counts: { ...counts, chunks: chunks!.length } }], { session });
      await Snapshot.insertMany(chunks!.map((part, chunk_index) => ({ ...header, snapshot_id: `${snapshot_id}:chunk:${chunk_index}`, parent_snapshot_id: snapshot_id, chunk_index, rows: part, counts: { total_items: part.length } })), { session });
    }
    // Privileged cache-lifecycle update only: never mutate immutable rows or
    // cursor identities. Keep superseded headers AND chunks for five minutes.
    // The transaction leaves the previous list untouched if publication fails.
    await Snapshot.collection.updateMany({ ...csiDataset(), as_of: { $lt: now }, expires_at: null },
      { $set: { expires_at: new Date(Date.now() + ATTENTION_FRESH_MS) } }, { session });
  });
  return { status: "published", snapshot_id, total_items: encoded.length, ...(v2 ? { closed_items: closedRows.length } : {}) };
}
/** Cursor digest: the default request keeps the pre-sort `filters` shape; anything else binds sort, direction, view and `fresh`. */
export function attentionCursorDigest(input: Omit<AttentionQuery, "cursor" | "limit" | "direction"> & { direction: "asc" | "desc" }) {
  const { sort, direction, view, freshness, ...filters } = input;
  const fresh = freshness === "fresh" ? { freshness } : {};
  return payloadHash(sort === "attention" && view === "attention" && freshness !== "fresh" ? filters : { ...filters, sort, direction, view, ...fresh });
}
type StoredRow = z.infer<typeof attentionRowDtoSchema>;
/** No writes on GET, including pagination; cursors bind immutable as-of rows and filters. */
export async function readAttention(raw: z.input<typeof attentionQuerySchema>, deps: { coverage?: typeof readCaptureCoverage; now?: Date } = {}) {
  const now = deps.now ?? new Date(), coverage = deps.coverage ?? readCaptureCoverage;
  const query = attentionQuerySchema.parse(raw);
  const direction = query.direction ?? ATTENTION_SORT_DEFAULT_DIRECTION[query.sort];
  // The cursor binds snapshot, view, filters, freshness, sort and direction (§14.1, Move assessment §8). The default
  // request (Attention order, Attention view, all freshness) keeps the pre-sort digest shape and a time sort keeps the
  // LP-06 shape, so cursors minted before this contract still resolve. `freshness=all` is the same as omitting it.
  // S2 parameters have no defaults, so a request without them hashes exactly as before.
  const { cursor, limit, sort, direction: _direction, view, freshness, ...filters } = query;
  const digest = attentionCursorDigest({ ...filters, sort, direction, view, freshness });
  const cursorSchema = z.object({ snapshot_id: z.string().startsWith("outreach:"), offset: z.number().int().nonnegative(), digest: z.string() }).strict();
  let page: z.infer<typeof cursorSchema> | null = null;
  if (cursor) { try { page = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); } catch { throw new CsiError("INVALID_INPUT"); } }
  if (page && page.digest !== digest) throw new CsiError("INVALID_INPUT");
  // The dataset filter already selects Attention snapshots; a `/^outreach:/`
  // regex on top of it only stopped the lookup using an index (14 §10).
  // Chunk siblings share as_of with their header. Only a header (missing or
  // null chunk_index) is a snapshot the desk can bind to.
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const snapshot = await Snapshot.findOne({ ...csiDataset(), ...(page ? { snapshot_id: page.snapshot_id } : {}),
    $and: [{ $or: [{ expires_at: null }, { expires_at: { $gt: now } }] },
      { chunk_index: null }] }).sort({ as_of: -1 }).lean();
  const pending = async () => attentionPageDtoSchema.parse({ as_of: now.toISOString(), coverage: await coverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection" } });
  if (!snapshot) {
    if (page) throw new CsiError("ATTENTION_SNAPSHOT_EXPIRED");
    return attentionPageDtoSchema.parse({ as_of: now.toISOString(), coverage: await coverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection", sort: query.sort, direction, view: query.view, freshness: freshness ?? "all" } });
  }
  // Rows were validated on write against the same schema and the snapshot is
  // immutable, so a paginated GET filters and counts without re-validating and
  // re-validates only the page it returns (14 §2). Data spec §3.7 / D9: with an
  // index on the header the read filters, sorts and counts over the index and
  // materializes only the page (inline: the row array once; chunked: only the
  // chunks the page names). A snapshot without an index is read as before.
  const chunkCount = snapshot.counts?.chunks ?? 0;
  const inlineRows = (): StoredRow[] => (snapshot.rows_gzip_base64 ? decompressAttentionRows(snapshot.rows_gzip_base64) : Array.isArray(snapshot.rows) ? snapshot.rows : []) as StoredRow[];
  const encodedIndex = (snapshot as { index_gzip_base64?: string | null }).index_gzip_base64;
  let stored: StoredRow[] | null = null;
  let entries: AttentionIndexEntry[];
  if (encodedIndex) {
    entries = decodeAttentionIndex(encodedIndex);
  } else {
    stored = inlineRows();
    if (chunkCount > 0) {
      const parts = await Snapshot.find({ ...csiDataset(), parent_snapshot_id: snapshot.snapshot_id }).sort({ chunk_index: 1 }).lean();
      if (parts.length !== chunkCount) return pending();
      stored = parts.flatMap(part => (Array.isArray(part.rows) ? part.rows : []) as StoredRow[]);
    }
    entries = stored.map((row, position) => attentionIndexEntry(row, position));
  }
  // Filter, then sort the whole frozen snapshot, then paginate (§14.1). Attention order is the stored band order.
  const context = { as_of: snapshot.as_of };
  const matched = sortAttentionEntries(entries.filter(entry => entryMatchesAttentionQuery(entry, query, context)), query.sort, direction);
  const offset = page?.offset ?? 0, reasons: Record<string, number> = {};
  for (const entry of matched) for (const reason of entry.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const slice = matched.slice(offset, offset + limit);
  let items: StoredRow[];
  if (stored) {
    items = slice.map(entry => stored![entry.position]!);
  } else if (slice.some(entry => entry.chunk_index != null)) {
    const wanted = [...new Set(slice.map(entry => entry.chunk_index!))];
    const parts = await Snapshot.find({ ...csiDataset(), parent_snapshot_id: snapshot.snapshot_id, chunk_index: { $in: wanted } }).lean();
    if (parts.length !== wanted.length) return pending();
    const byChunk = new Map(parts.map(part => [part.chunk_index as number, (Array.isArray(part.rows) ? part.rows : []) as StoredRow[]]));
    items = slice.map(entry => byChunk.get(entry.chunk_index!)?.[entry.position] as StoredRow);
  } else {
    const all = slice.length ? inlineRows() : [];
    items = slice.map(entry => all[entry.position]!);
  }
  // The index and the rows are written in one transaction; a mismatch means a corrupt snapshot, never a silent wrong page.
  if (items.some((row, i) => row?.subject_key !== slice[i]!.subject_key)) throw new Error("Attention index does not match its rows");
  const metrics = (snapshot as { metrics?: AttentionMetricsDto | null }).metrics;
  return attentionPageDtoSchema.parse({ as_of: snapshot.as_of.toISOString(), coverage: await coverage(), data: { items, snapshot_id: snapshot.snapshot_id,
    cursor: offset + limit < matched.length ? Buffer.from(JSON.stringify({ snapshot_id: snapshot.snapshot_id, offset: offset + limit, digest })).toString("base64url") : null,
    total_items: matched.length, reason_counts: reasons, status: "ready", stale: +now >= +snapshot.as_of + ATTENTION_FRESH_MS, sort: query.sort, direction, view: query.view, freshness: freshness ?? "all",
    ...(metrics ? { metrics } : {}) } });
}
