import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put, head } from "@vercel/blob";

const AUDIO_TYPES: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/mp4": "m4a", "audio/aac": "aac" };
export class MediaValidationError extends Error {
  constructor(readonly code: "media_too_large" | "unsupported_content_type" | "content_type_mismatch" | "invalid_media" | "content_length_mismatch") { super(code); }
}
export type ImmutableUpload = (input: { pathname: string; filePath: string; bytes: number; contentType: string; signal: AbortSignal }) => Promise<{ pathname: string }>;
export const uploadImmutableConversationMedia: ImmutableUpload = async input => {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (!token || !storeId) throw new Error("private_blob_not_configured");
  const options = { storeId, token, abortSignal: input.signal };
  try {
    const uploaded = await put(input.pathname, createReadStream(input.filePath), {
      ...options, access: "private", contentType: input.contentType, addRandomSuffix: false, allowOverwrite: false,
      multipart: input.bytes > 4 * 1024 * 1024,
    });
    if (uploaded.pathname !== input.pathname) throw new Error("immutable_path_mismatch");
    return { pathname: uploaded.pathname };
  } catch (error) {
    // Crash after upload/before Mongo commit: reuse the same digest object; never overwrite it.
    const existing = await head(input.pathname, options).catch(() => { throw error; });
    if (existing.pathname !== input.pathname || existing.size !== input.bytes || existing.contentType !== input.contentType) throw new Error("immutable_blob_conflict");
    return { pathname: input.pathname };
  }
};

function verifiedType(header: string | null, metadata: string | null) {
  const normalize = (value: string | null) => value?.split(";")[0]?.trim().toLowerCase() ?? null;
  const type = normalize(header), meta = normalize(metadata);
  if (!type || !AUDIO_TYPES[type]) throw new MediaValidationError("unsupported_content_type");
  if (meta && AUDIO_TYPES[meta] !== AUDIO_TYPES[type]) throw new MediaValidationError("content_type_mismatch");
  return { contentType: type, extension: AUDIO_TYPES[type]! };
}
function matchesSignature(prefix: Buffer, extension: string) {
  if (extension === "wav") return prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WAVE";
  if (extension === "ogg") return prefix.toString("ascii", 0, 4) === "OggS";
  if (extension === "flac") return prefix.toString("ascii", 0, 4) === "fLaC";
  if (extension === "m4a") return prefix.toString("ascii", 4, 8) === "ftyp";
  if (extension === "mp3") return prefix.toString("ascii", 0, 3) === "ID3" || (prefix[0] === 255 && ((prefix[1] ?? 0) & 224) === 224);
  return prefix[0] === 255 && ((prefix[1] ?? 0) & 246) === 240;
}
/** Spool to a private bounded temporary file while hashing, then stream upload after the digest is known. No full-file RAM buffer. Always remove transient bytes. */
export async function storeRecordingStream(input: {
  response: Response; metadataContentType: string | null; accountId: string; recordingId: string;
  maxBytes: number; signal: AbortSignal; upload?: ImmutableUpload;
}) {
  const filePath = join(tmpdir(), `csi-media-${randomUUID()}`);
  let created = false;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(input.accountId) || !/^[A-Za-z0-9_-]+$/.test(input.recordingId)) throw new Error("invalid_media_identity");
    const { contentType, extension } = verifiedType(input.response.headers.get("content-type"), input.metadataContentType);
    const rawLength = input.response.headers.get("content-length");
    const length = rawLength === null ? null : /^\d+$/.test(rawLength) ? Number(rawLength) : NaN;
    if (length !== null && (!Number.isSafeInteger(length) || length > input.maxBytes)) throw new MediaValidationError("media_too_large");
    if (!input.response.body) throw new MediaValidationError("invalid_media");
    const file = await open(filePath, "wx", 0o600); created = true;
    const hash = createHash("sha256");
    let bytes = 0, prefix = Buffer.alloc(0);
    const reader = input.response.body.getReader();
    try {
      while (true) {
        input.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > input.maxBytes) throw new MediaValidationError("media_too_large");
        if (prefix.length < 16) prefix = Buffer.concat([prefix, Buffer.from(chunk.value).subarray(0, 16 - prefix.length)]);
        hash.update(chunk.value);
        // FileHandle.writeFile consumes this chunk fully (write() may short-write).
        await file.writeFile(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await file.close(); }
    if (!bytes || !matchesSignature(prefix, extension)) throw new MediaValidationError("invalid_media");
    if (length !== null && length !== bytes) throw new MediaValidationError("content_length_mismatch");
    const digest = hash.digest("hex");
    const pathname = `conversations/${input.accountId}/${input.recordingId}/${digest}.${extension}`;
    const stored = await (input.upload ?? uploadImmutableConversationMedia)({ pathname, filePath, bytes, contentType, signal: input.signal });
    if (stored.pathname !== pathname) throw new Error("immutable_path_mismatch");
    return { blob_pathname: pathname, bytes, content_type: contentType, media_digest_sha256: digest };
  } finally {
    if (!input.response.body?.locked) await input.response.body?.cancel().catch(() => undefined);
    if (created) await unlink(filePath);
  }
}
