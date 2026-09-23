import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { attentionRowDtoSchema, attentionPageDtoSchema, ATTENTION_SORTS, ATTENTION_SORT_DEFAULT_DIRECTION, ATTENTION_VIEWS, ATTENTION_FRESHNESS } from "../dto";
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

export const attentionQuerySchema = z.object({
  scope: z.literal("production").optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  band: repeatedQuery(z.coerce.number().int().min(1).max(7)),
  needs_review: z.enum(["true", "false"]).optional(),
  state: repeatedQuery(z.enum(ATTENTION_STATES)),
  agent_id: repeatedQuery(z.string().regex(/^[a-f\d]{24}$/i)),
  // §14.1 / Move assessment §8: one sort parameter and one cursor mechanism for time and score sorts.
  // The server never switches view; the Admin selects `all_outreach` with a score sort.
  sort: z.enum(ATTENTION_SORTS).default("attention"),
  direction: z.enum(["asc", "desc"]).optional(),
  view: z.enum(ATTENTION_VIEWS).default("attention"),
  // `fresh` excludes rows whose frozen assessment is stale; absent means `all`.
  freshness: z.enum(ATTENTION_FRESHNESS).optional(),
}).strict();
export type AttentionSort = (typeof ATTENTION_SORTS)[number];

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
  };
}
/**
 * Global order over the whole filtered snapshot: value order, nulls last in both directions, ties on subject_key.
 * Time keys compare as ISO strings, score keys numerically; there is no implicit band or confidence prefix.
 */
export function sortAttentionRows<T extends Pick<z.infer<typeof attentionRowDtoSchema>, "subject_key" | "sort_keys">>(rows: readonly T[], sort: AttentionSort, direction: "asc" | "desc"): T[] {
  if (sort === "attention") return [...rows];
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a.sort_keys?.[sort] ?? null, right = b.sort_keys?.[sort] ?? null;
    if (left === null && right === null) return a.subject_key.localeCompare(b.subject_key);
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sign * order || a.subject_key.localeCompare(b.subject_key);
  });
}

export function rowMatchesAttentionQuery(
  row: z.infer<typeof attentionRowDtoSchema>,
  query: z.infer<typeof attentionQuerySchema>,
) {
  // View first. `attention` keeps band/badge rows (older rows without the marker count as in Attention);
  // `all_outreach` adds every eligible open row but still hides closed work unless `state=closed` is selected.
  if (query.view !== "all_outreach" && row.in_attention === false) return false;
  if (query.view === "all_outreach" && row.outreach?.state === "closed" && !query.state?.includes("closed")) return false;
  if (query.freshness === "fresh" && row.sort_keys?.assessment_stale === true) return false;
  if (query.band?.length && (row.derived.attention_band == null || !query.band.includes(row.derived.attention_band))) return false;
  if (query.state?.length && (!row.outreach?.state || !query.state.includes(row.outreach.state as (typeof ATTENTION_STATES)[number]))) return false;
  if (query.agent_id?.length) {
    const ids = new Set(query.agent_id);
    const assigned = row.outreach?.assignment.agent?.id;
    const followupHit = row.outreach?.followups.some((action) => action.assignment.agent?.id && ids.has(action.assignment.agent.id));
    if (!(assigned && ids.has(assigned)) && !followupHit) return false;
  }
  if (query.needs_review !== undefined && Boolean(row.derived.review_badges?.length) !== (query.needs_review === "true")) return false;
  return true;
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
export async function publishAttentionSnapshot(options: { deadlineMs?: number } = {}) {
  const now = new Date();
  const deadline = +now + (options.deadlineMs ?? ATTENTION_PUBLISH_BUDGET_MS);
  const [policy, coverage, queued] = await Promise.all([resolvePolicy(), readCaptureCoverage(),
    getSalesIntelligenceJobModel().distinct("subject_key", { ...csiDataset(), stage: "move_assessment", status: { $in: ["pending", "leased", "retry"] } })]);
  const pendingAssessments = new Set(queued.map(String));
  const rows: z.infer<typeof attentionRowDtoSchema>[] = [];
  let after: string | undefined;
  for (;;) {
    if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
    const page = await getOutreachRecordModel().find({ purged_at: null, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PUBLISH_PAGE).lean();
    const inputs = await loadOutreachInputsBatch(page, now);
    const desk = [];
    for (const record of page) {
      const bundle = inputs.get(String(record._id));
      if (!bundle) continue;
      const facts = deriveOutreachFacts(record, bundle, { now, policy, coverage });
      const inAttention = Boolean(facts.attention_band || facts.review_badges.length);
      if (!inAttention && record.state === "closed") continue;
      desk.push({ record, bundle, inAttention });
    }
    if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
    if (desk.length) {
      const side = await loadOutreachSideData(desk.map(item => item.record), inputs);
      for (const { record, bundle, inAttention } of desk) {
        if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
        const key = subjectKey(record.subject);
        const outreach = await toOutreachDto(record, now, coverage, { policy, inputs: bundle, side, assessmentPending: pendingAssessments.has(key) });
        const row = { subject_key: key, subject: outreach.subject, outreach, derived: outreach.derived, allowed_actions: outreach.allowed_actions };
        rows.push({ ...row, sort_keys: attentionSortKeys(row), in_attention: inAttention });
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
    rows.push(attentionRowDtoSchema.parse({ subject_key: review.subject_key, subject, outreach: null, allowed_actions: [], derived: { overdue: false, no_owner: false, no_next_action: false, cooldown: false,
      attention_band: null, reasons: [], review_item_ids: same.map(r => String(r._id)), review_badges: [...new Set(same.map(r => r.cause_kind))], call_blockers: ["review_only"], age_wall_ms: 0, age_staffed_ms: 0, policy_version: policy.version },
      sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, ...assessmentSortKeys(null) }, in_attention: true }));
    published.add(review.subject_key);
  }
  const orderTime = (r: z.infer<typeof attentionRowDtoSchema>) => {
    if (r.derived.attention_band === 2) return r.outreach?.first_action_due_at ?? r.outreach?.trigger_at ?? "9999";
    const actions = r.outreach?.followups.filter(a => a.status === "open" && (r.derived.attention_band !== 1 || (a.kind === "call" && a.origin === "rep_promise")) &&
      (r.derived.attention_band !== 3 || a.origin === "system_default")) ?? [];
    return actions.map(a => a.attention_due_at).filter((at): at is string => Boolean(at)).sort()[0] ?? r.outreach?.trigger_at ?? "9999";
  };
  rows.sort((a,b) => (a.derived.attention_band ?? 8) - (b.derived.attention_band ?? 8) || orderTime(a).localeCompare(orderTime(b)) || a.subject_key.localeCompare(b.subject_key));
  const encoded = z.array(attentionRowDtoSchema).parse(jsonValue(rows));
  const snapshot_id = `outreach:${randomUUID()}`;
  const expires_at = null;
  const header = { snapshot_id, owner_id: "system", filter_digest: payloadHash({}), policy_version: policy.version, ...csiDataset(), as_of: now, expires_at, chunk_index: null, parent_snapshot_id: null };
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const compressed = compressAttentionRows(encoded);
  await withTransaction(async session => {
    if (compressed) {
      await Snapshot.create([{ ...header, rows: [], rows_gzip_base64: compressed, counts: { total_items: rows.length } }], { session });
    } else if (Buffer.byteLength(JSON.stringify(encoded)) <= ATTENTION_INLINE_BYTES) {
      await Snapshot.create([{ ...header, rows: encoded, counts: { total_items: rows.length } }], { session });
    } else {
      const chunks = splitAttentionChunks(encoded);
      await Snapshot.create([{ ...header, rows: [], counts: { total_items: rows.length, chunks: chunks.length } }], { session });
      await Snapshot.insertMany(chunks.map((part, chunk_index) => ({ ...header, snapshot_id: `${snapshot_id}:chunk:${chunk_index}`, parent_snapshot_id: snapshot_id, chunk_index, rows: part, counts: { total_items: part.length } })), { session });
    }
    // Privileged cache-lifecycle update only: never mutate immutable rows or
    // cursor identities. Keep superseded headers AND chunks for five minutes.
    // The transaction leaves the previous list untouched if publication fails.
    await Snapshot.collection.updateMany({ ...csiDataset(), as_of: { $lt: now }, expires_at: null },
      { $set: { expires_at: new Date(Date.now() + ATTENTION_FRESH_MS) } }, { session });
  });
  return { status: "published", snapshot_id, total_items: rows.length };
}
/** Cursor digest: the default request keeps the pre-sort `filters` shape; anything else binds sort, direction, view and `fresh`. */
export function attentionCursorDigest(input: Omit<z.infer<typeof attentionQuerySchema>, "cursor" | "limit" | "direction"> & { direction: "asc" | "desc" }) {
  const { sort, direction, view, freshness, ...filters } = input;
  const fresh = freshness === "fresh" ? { freshness } : {};
  return payloadHash(sort === "attention" && view === "attention" && freshness !== "fresh" ? filters : { ...filters, sort, direction, view, ...fresh });
}
/** No writes on GET, including pagination; cursors bind immutable as-of rows and filters. */
export async function readAttention(raw: z.input<typeof attentionQuerySchema>, deps: { coverage?: typeof readCaptureCoverage; now?: Date } = {}) {
  const now = deps.now ?? new Date(), coverage = deps.coverage ?? readCaptureCoverage;
  const query = attentionQuerySchema.parse(raw);
  const direction = query.direction ?? ATTENTION_SORT_DEFAULT_DIRECTION[query.sort];
  // The cursor binds snapshot, view, filters, freshness, sort and direction (§14.1, Move assessment §8). The default
  // request (Attention order, Attention view, all freshness) keeps the pre-sort digest shape and a time sort keeps the
  // LP-06 shape, so cursors minted before this contract still resolve. `freshness=all` is the same as omitting it.
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
  const snapshot = await getSalesIntelligenceAttentionSnapshotModel().findOne({ ...csiDataset(), ...(page ? { snapshot_id: page.snapshot_id } : {}),
    $and: [{ $or: [{ expires_at: null }, { expires_at: { $gt: now } }] },
      { chunk_index: null }] }).sort({ as_of: -1 }).lean();
  if (!snapshot) {
    if (page) throw new CsiError("ATTENTION_SNAPSHOT_EXPIRED");
    return attentionPageDtoSchema.parse({ as_of: now.toISOString(), coverage: await coverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection", sort: query.sort, direction, view: query.view, freshness: freshness ?? "all" } });
  }
  // Rows were validated on write against the same schema and the snapshot is
  // immutable, so a paginated GET filters and counts over the stored rows and
  // re-validates only the page it returns. Re-parsing a multi-megabyte array
  // on every page view was pure read-path cost (14 §2).
  const chunkCount = snapshot.counts?.chunks ?? 0;
  let stored = (Array.isArray(snapshot.rows) ? snapshot.rows : []) as z.infer<typeof attentionRowDtoSchema>[];
  if (snapshot.rows_gzip_base64) stored = decompressAttentionRows(snapshot.rows_gzip_base64) as z.infer<typeof attentionRowDtoSchema>[];
  if (chunkCount > 0) {
    const parts = await getSalesIntelligenceAttentionSnapshotModel().find({ ...csiDataset(), parent_snapshot_id: snapshot.snapshot_id }).sort({ chunk_index: 1 }).lean();
    if (parts.length !== chunkCount) {
      return attentionPageDtoSchema.parse({ as_of: now.toISOString(), coverage: await coverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection" } });
    }
    stored = parts.flatMap(part => (Array.isArray(part.rows) ? part.rows : []) as z.infer<typeof attentionRowDtoSchema>[]);
  }
  // Filter, then sort the whole frozen snapshot, then paginate (§14.1). Attention order is the stored band order.
  const rows = sortAttentionRows(stored.filter((row) => rowMatchesAttentionQuery(row, query)), query.sort, direction);
  const offset = page?.offset ?? 0, reasons: Record<string, number> = {};
  for (const row of rows) for (const reason of row.derived.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  return attentionPageDtoSchema.parse({ as_of: snapshot.as_of.toISOString(), coverage: await coverage(), data: { items: rows.slice(offset, offset + limit), snapshot_id: snapshot.snapshot_id,
    cursor: offset + limit < rows.length ? Buffer.from(JSON.stringify({ snapshot_id: snapshot.snapshot_id, offset: offset + limit, digest })).toString("base64url") : null,
    total_items: rows.length, reason_counts: reasons, status: "ready", stale: +now >= +snapshot.as_of + ATTENTION_FRESH_MS, sort: query.sort, direction, view: query.view, freshness: freshness ?? "all" } });
}
