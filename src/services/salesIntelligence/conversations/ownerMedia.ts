import { get } from "@vercel/blob";
import { csiProviderConfiguration } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { assertTrustedActor, type CsiActor } from "../auth";
import { duplicateKey } from "../transactions";

/**
 * S4-CONV `GET /conversations/:id/media` (data spec §6.9, §10; final spec §11.7; DECISIONS 2026-09-23
 * "Media route = server-side Range stream").
 *
 * The recording is a private Vercel Blob (`access: "private"`). The server streams it through an
 * injectable `BlobReader` with `Range` support; the blob URL and pathname never leave this module (no
 * DTO field, no response header, no error text). An audit row `media_played` (actor, conversation id)
 * is written **before** the blob is read. The browser's `<audio>` issues several Range requests per
 * play, so the audit row is keyed per (conversation, actor, 5-minute window): the first request writes
 * it, later requests in the same window find it (duplicate key) and stream.
 */
export const MEDIA_AUDIT_WINDOW_MS = 5 * 60_000;
export const MEDIA_PLAYED_EVENT = "media_played" as const;

export type ByteRange = { start: number; end: number };
export type BlobReadResult = {
  status: 200 | 206;
  content_type: string | null;
  content_length: number | null;
  /** `bytes a-b/size` exactly as the store answered a ranged read; null for a full read. */
  content_range: string | null;
  body: ReadableStream<Uint8Array>;
};
/** Reads one private blob. Null when the store has no such object. Implementations never put the pathname in an error message. */
export type BlobReader = (pathname: string, range: ByteRange | null, signal?: AbortSignal) => Promise<BlobReadResult | null>;

export class BlobReadFailed extends Error {
  constructor() { super("blob_read_failed"); }
}

/** Default reader: the server's private Blob credentials, the same `get(pathname, {access: "private"})` the transcription reader uses. */
export const privateBlobReader: BlobReader = async (pathname, range, signal) => {
  const config = csiProviderConfiguration();
  if (!config.blobToken || !config.blobStoreId) throw new BlobReadFailed();
  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(pathname, { access: "private", token: config.blobToken, storeId: config.blobStoreId, abortSignal: signal,
      ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}) });
  } catch {
    // SDK errors can carry the blob URL; only a fixed code escapes.
    throw new BlobReadFailed();
  }
  if (!result || result.statusCode !== 200) return null;
  const contentRange = result.headers.get("content-range");
  const length = Number(result.headers.get("content-length"));
  return { status: range && contentRange ? 206 : 200, content_type: result.blob.contentType || null,
    content_length: Number.isSafeInteger(length) && length >= 0 && result.headers.get("content-length") !== null ? length : null,
    content_range: range && contentRange ? contentRange : null, body: result.stream };
};

export type MediaConversationRow = {
  _id: unknown; contact_number_id?: unknown; content_purged_at?: Date | null;
  media?: { blob_pathname?: string | null; purged_at?: Date | null; bytes?: number | null; content_type?: string | null } | null;
};
export type MediaAuditRow = {
  semantic_key: string; subject_key: string; event_kind: typeof MEDIA_PLAYED_EVENT; command_id: null;
  actor: { kind: CsiActor["kind"]; id: string; request_id: string; run_id: string | null };
  happened_at: Date; recorded_at: Date; prior: { recording_state: "available" };
  current: { conversation_id: string; contact_number_id: string | null; range: string | null };
  invalidation: { kind: "number"; target_id: string; subject_key: string; revision: 1 };
};
export type OwnerMediaStore = {
  conversation(id: string): Promise<MediaConversationRow | null>;
  numberRetention(id: string): Promise<{ purged_at?: Date | null; content_purge_pending?: boolean | null } | null>;
  /** Inserts the audit row; `duplicate` when this window's row already exists. */
  audit(row: MediaAuditRow): Promise<"written" | "duplicate">;
};

export const mongoOwnerMediaStore: OwnerMediaStore = {
  conversation: async id => (await getLeadConversationModel().findById(id)
    .select("contact_number_id content_purged_at media.blob_pathname media.purged_at media.bytes media.content_type").lean()) as MediaConversationRow | null,
  numberRetention: async id => (await getContactNumberModel().findById(id).select("purged_at content_purge_pending").lean()) as { purged_at?: Date | null; content_purge_pending?: boolean | null } | null,
  audit: async row => {
    try { await getSalesIntelligenceAuditEventModel().create([row]); return "written"; }
    catch (error) { if (duplicateKey(error)) return "duplicate"; throw error; }
  },
};

/**
 * RFC 9110 single byte range against a known size. `ignore` → serve the whole object (absent, malformed or
 * multi-range headers may be ignored); `unsatisfiable` → 416.
 */
export function parseByteRange(header: string | undefined | null, size: number | null): { kind: "ignore" } | { kind: "range"; range: ByteRange } | { kind: "unsatisfiable" } {
  if (!header || size === null || !Number.isSafeInteger(size) || size < 0) return { kind: "ignore" };
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return { kind: "ignore" };
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", range: { start: Math.max(size - suffix, 0), end: size - 1 } };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "ignore" };
  if (match[2] && end < start) return { kind: "ignore" };
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", range: { start, end: Math.min(end, size - 1) } };
}

export type OwnerMediaOutcome =
  | { kind: "not_found" }
  | { kind: "range_not_satisfiable"; headers: Record<string, string> }
  | { kind: "stream"; status: 200 | 206; headers: Record<string, string>; body: ReadableStream<Uint8Array> };
export type OwnerMediaDeps = { store?: OwnerMediaStore; readBlob?: BlobReader; now?: () => Date };

const AUDIO_TYPE = /^audio\/[a-z0-9.+-]+$/i;
const BASE_HEADERS = { "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/** Owner-only (the route guard). Every header is built here; nothing from the store response is forwarded. */
export async function openOwnerConversationMedia(input: { conversation_id: string; actor: CsiActor; range?: string | null; signal?: AbortSignal },
  deps: OwnerMediaDeps = {}): Promise<OwnerMediaOutcome> {
  assertTrustedActor(input.actor, "owner");
  const id = csiIdSchema.parse(input.conversation_id);
  const store = deps.store ?? mongoOwnerMediaStore;
  const conversation = await store.conversation(id);
  const pathname = conversation?.media?.blob_pathname ?? null;
  if (!conversation || !pathname || conversation.media?.purged_at || conversation.content_purged_at) return { kind: "not_found" };
  const numberId = conversation.contact_number_id == null ? null : String(conversation.contact_number_id);
  if (numberId) {
    const number = await store.numberRetention(numberId);
    if (number?.purged_at || number?.content_purge_pending) return { kind: "not_found" };
  }
  const size = typeof conversation.media?.bytes === "number" && Number.isSafeInteger(conversation.media.bytes) ? conversation.media.bytes : null;
  const parsed = parseByteRange(input.range, size);
  if (parsed.kind === "unsatisfiable") return { kind: "range_not_satisfiable", headers: { ...BASE_HEADERS, "Content-Range": `bytes */${size}` } };

  // Audit first: no byte is read before the row exists.
  const now = (deps.now ?? (() => new Date()))();
  const window = Math.floor(now.getTime() / MEDIA_AUDIT_WINDOW_MS) * MEDIA_AUDIT_WINDOW_MS;
  const subject = `conversation:${id}`;
  await store.audit({ semantic_key: `${MEDIA_PLAYED_EVENT}:${id}:${input.actor.id}:${window}`, subject_key: subject, event_kind: MEDIA_PLAYED_EVENT, command_id: null,
    actor: { kind: input.actor.kind, id: input.actor.id, request_id: input.actor.request_id, run_id: input.actor.run_id },
    happened_at: now, recorded_at: now, prior: { recording_state: "available" },
    current: { conversation_id: id, contact_number_id: numberId, range: parsed.kind === "range" ? `bytes=${parsed.range.start}-${parsed.range.end}` : null },
    invalidation: { kind: "number", target_id: numberId ?? id, subject_key: subject, revision: 1 } });

  const range = parsed.kind === "range" ? parsed.range : null;
  const blob = await (deps.readBlob ?? privateBlobReader)(pathname, range, input.signal);
  if (!blob) return { kind: "not_found" };
  const stored = conversation.media?.content_type;
  const contentType = stored && AUDIO_TYPE.test(stored) ? stored : blob.content_type && AUDIO_TYPE.test(blob.content_type) ? blob.content_type : "application/octet-stream";
  const headers: Record<string, string> = { ...BASE_HEADERS, "Content-Type": contentType, "Content-Disposition": "inline" };
  if (blob.status === 206 && range) {
    const total = size ?? Number(/\/(\d+)$/.exec(blob.content_range ?? "")?.[1] ?? NaN);
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${Number.isSafeInteger(total) ? total : "*"}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return { kind: "stream", status: 206, headers, body: blob.body };
  }
  const length = blob.content_length ?? size;
  if (length !== null) headers["Content-Length"] = String(length);
  return { kind: "stream", status: 200, headers, body: blob.body };
}
