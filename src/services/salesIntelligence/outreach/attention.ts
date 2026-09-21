import { randomUUID } from "node:crypto";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { attentionRowDtoSchema, attentionPageDtoSchema } from "../dto";
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
}).strict();

export function rowMatchesAttentionQuery(
  row: z.infer<typeof attentionRowDtoSchema>,
  query: z.infer<typeof attentionQuerySchema>,
) {
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
const PUBLISH_PAGE = 50;
/** Own cron, `maxDuration` 120s. 40s was the shared ensure slot and expired mid-walk. */
export const ATTENTION_PUBLISH_BUDGET_MS = 90_000;
const ATTENTION_INLINE_BYTES = 12_000_000;
const ATTENTION_CHUNK_BYTES = 900_000;

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
 */
export async function publishAttentionSnapshot(options: { deadlineMs?: number } = {}) {
  const now = new Date();
  const deadline = +now + (options.deadlineMs ?? ATTENTION_PUBLISH_BUDGET_MS);
  const [policy, coverage] = await Promise.all([resolvePolicy(), readCaptureCoverage()]);
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
      if (!facts.attention_band && !facts.review_badges.length) continue;
      desk.push({ record, bundle });
    }
    if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
    if (desk.length) {
      const side = await loadOutreachSideData(desk.map(item => item.record), inputs);
      for (const { record, bundle } of desk) {
        if (Date.now() > deadline) return { status: "incomplete", reason: "snapshot_budget" };
        const outreach = await toOutreachDto(record, now, coverage, { policy, inputs: bundle, side });
        rows.push({ subject_key: subjectKey(record.subject), subject: outreach.subject, outreach, derived: outreach.derived, allowed_actions: outreach.allowed_actions });
      }
    }
    if (page.length < PUBLISH_PAGE) break;
    after = String(page.at(-1)!._id);
  }
  const reviews = await getSalesIntelligenceReviewItemModel().find({ state: "open" }).lean();
  for (const review of reviews) {
    if (rows.some(r => r.subject_key === review.subject_key)) continue;
    const parts = review.subject_key.split(":");
    const subject = parts[0] === "number" ? { kind: "number_review" as const, contact_number_id: parts[1]! } :
      { kind: "lead" as const, model: parts[1] as "FormLead" | "CallLead", id: parts[2]! };
    const same = reviews.filter(r => r.subject_key === review.subject_key);
    rows.push(attentionRowDtoSchema.parse({ subject_key: review.subject_key, subject, outreach: null, allowed_actions: [], derived: { overdue: false, no_owner: false, no_next_action: false, cooldown: false,
      attention_band: null, reasons: [], review_item_ids: same.map(r => String(r._id)), review_badges: [...new Set(same.map(r => r.cause_kind))], call_blockers: ["review_only"], age_wall_ms: 0, age_staffed_ms: 0, policy_version: policy.version } }));
  }
  const orderTime = (r: z.infer<typeof attentionRowDtoSchema>) => {
    if (r.derived.attention_band === 2) return r.outreach?.first_action_due_at ?? r.outreach?.trigger_at ?? "9999";
    const actions = r.outreach?.followups.filter(a => a.status === "open" && (r.derived.attention_band !== 1 || (a.kind === "call" && a.origin === "rep_promise")) &&
      (r.derived.attention_band !== 3 || a.origin === "system_default")) ?? [];
    return actions.map(a => a.attention_due_at).filter((at): at is string => Boolean(at)).sort()[0] ?? r.outreach?.trigger_at ?? "9999";
  };
  rows.sort((a,b) => (a.derived.attention_band ?? 8) - (b.derived.attention_band ?? 8) || orderTime(a).localeCompare(orderTime(b)) || a.subject_key.localeCompare(b.subject_key));
  const encoded = jsonValue(rows) as z.infer<typeof attentionRowDtoSchema>[];
  const snapshot_id = `outreach:${randomUUID()}`;
  const expires_at = new Date(+now + 300_000);
  const header = { snapshot_id, owner_id: "system", filter_digest: payloadHash({}), policy_version: policy.version, ...csiDataset(), as_of: now, expires_at, chunk_index: null, parent_snapshot_id: null };
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  if (Buffer.byteLength(JSON.stringify(encoded)) <= ATTENTION_INLINE_BYTES) {
    await Snapshot.create({ ...header, rows: encoded, counts: { total_items: rows.length } });
  } else {
    const chunks = splitAttentionChunks(encoded);
    await withTransaction(async session => {
      await Snapshot.create([{ ...header, rows: [], counts: { total_items: rows.length, chunks: chunks.length } }], { session });
      await Snapshot.insertMany(chunks.map((part, chunk_index) => ({ ...header, snapshot_id: `${snapshot_id}:chunk:${chunk_index}`, parent_snapshot_id: snapshot_id, chunk_index, rows: part, counts: { total_items: part.length } })), { session });
    });
  }
  return { status: "published", snapshot_id, total_items: rows.length };
}
/** No writes on GET, including pagination; cursors bind immutable as-of rows and filters. */
export async function readAttention(raw: z.input<typeof attentionQuerySchema>) {
  const query = attentionQuerySchema.parse(raw);
  const { cursor, limit, ...filters } = query, digest = payloadHash(filters);
  const cursorSchema = z.object({ snapshot_id: z.string().startsWith("outreach:"), offset: z.number().int().nonnegative(), digest: z.string() }).strict();
  let page: z.infer<typeof cursorSchema> | null = null;
  if (cursor) { try { page = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); } catch { throw new CsiError("INVALID_INPUT"); } }
  if (page && page.digest !== digest) throw new CsiError("INVALID_INPUT");
  // The dataset filter already selects Attention snapshots; a `/^outreach:/`
  // regex on top of it only stopped the lookup using an index (14 §10).
  // Chunk siblings share as_of with their header. Only a header (missing or
  // null chunk_index) is a snapshot the desk can bind to.
  const snapshot = await getSalesIntelligenceAttentionSnapshotModel().findOne({ ...csiDataset(), ...(page ? { snapshot_id: page.snapshot_id } : {}), expires_at: { $gt: new Date() }, $or: [{ chunk_index: null }, { chunk_index: { $exists: false } }] }).sort({ as_of: -1 }).lean();
  if (!snapshot) {
    if (page) throw new CsiError("ATTENTION_SNAPSHOT_EXPIRED");
    return attentionPageDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection" } });
  }
  // Rows were validated on write against the same schema and the snapshot is
  // immutable, so a paginated GET filters and counts over the stored rows and
  // re-validates only the page it returns. Re-parsing a multi-megabyte array
  // on every page view was pure read-path cost (14 §2).
  const chunkCount = snapshot.counts?.chunks ?? 0;
  let stored = (Array.isArray(snapshot.rows) ? snapshot.rows : []) as z.infer<typeof attentionRowDtoSchema>[];
  if (chunkCount > 0) {
    const parts = await getSalesIntelligenceAttentionSnapshotModel().find({ ...csiDataset(), parent_snapshot_id: snapshot.snapshot_id }).sort({ chunk_index: 1 }).lean();
    if (parts.length !== chunkCount) {
      return attentionPageDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), data: { items: [], snapshot_id: null, cursor: null, total_items: null, reason_counts: {}, status: "pending_projection" } });
    }
    stored = parts.flatMap(part => (Array.isArray(part.rows) ? part.rows : []) as z.infer<typeof attentionRowDtoSchema>[]);
  }
  const rows = stored.filter((row) => rowMatchesAttentionQuery(row, query));
  const offset = page?.offset ?? 0, reasons: Record<string, number> = {};
  for (const row of rows) for (const reason of row.derived.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  return attentionPageDtoSchema.parse({ as_of: snapshot.as_of.toISOString(), coverage: await readCaptureCoverage(), data: { items: rows.slice(offset, offset + limit), snapshot_id: snapshot.snapshot_id,
    cursor: offset + limit < rows.length ? Buffer.from(JSON.stringify({ snapshot_id: snapshot.snapshot_id, offset: offset + limit, digest })).toString("base64url") : null,
    total_items: rows.length, reason_counts: reasons, status: "ready" } });
}
