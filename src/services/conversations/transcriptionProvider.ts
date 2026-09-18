import { createHash } from "node:crypto";
import { BlobAccessError, get } from "@vercel/blob";
import { csiMediaMaxBytes, csiProviderConfiguration } from "../../config/domain/salesIntelligence";

export type SttSegment = { text: string; start_ms?: number | null; end_ms?: number | null; speaker?: "rep" | "customer" | "unknown" };
export type SttResult = { text: string; segments?: SttSegment[]; actualCents: number | null };
export type SttProvider = (input: { audio: Uint8Array; contentType: string; model: string; signal: AbortSignal }) => Promise<SttResult>;
export type StoredAudio = { pathname: string; bytes: number; digest: string; contentType: string };
export type BlobAudioReader = (media: StoredAudio, signal: AbortSignal) => Promise<Uint8Array>;

/** Only fixed codes escape the adapter. SDK errors can contain raw transcript/response bodies. */
export class TranscriptionProviderError extends Error {
  constructor(readonly reason: "permission_denied" | "throttled" | "transient" | "media_invalid") { super(reason); }
}

export function validateStoredAudio(media: StoredAudio, audio: Uint8Array) {
  if (!media.pathname.startsWith("conversations/") || media.pathname.includes(":") ||
      !Number.isSafeInteger(media.bytes) || media.bytes <= 0 || media.bytes > csiMediaMaxBytes() ||
      audio.byteLength !== media.bytes || createHash("sha256").update(audio).digest("hex") !== media.digest) {
    throw new TranscriptionProviderError("media_invalid");
  }
}

/** Server-side private Blob read, bounded in memory; never follows a stored provider URL. */
export const readStoredAudio: BlobAudioReader = async (media, signal) => {
  if (!media.pathname.startsWith("conversations/") || media.pathname.includes(":") || media.bytes > csiMediaMaxBytes()) {
    throw new TranscriptionProviderError("media_invalid");
  }
  const config = csiProviderConfiguration();
  if (!config.blobToken || !config.blobStoreId) throw new TranscriptionProviderError("permission_denied");
  try {
    const result = await get(media.pathname, { access: "private", token: config.blobToken, storeId: config.blobStoreId, abortSignal: signal });
    if (!result || result.statusCode !== 200) throw new TranscriptionProviderError("media_invalid");
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > media.bytes || length > csiMediaMaxBytes()) throw new TranscriptionProviderError("media_invalid");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const audio = Buffer.concat(chunks);
    validateStoredAudio(media, audio);
    return audio;
  } catch (error) {
    if (error instanceof TranscriptionProviderError) throw error;
    throw new TranscriptionProviderError(error instanceof BlobAccessError ? "permission_denied" : "transient");
  }
};

/** Null means provider did not report billing; never substitute the admission estimate as actual. */
export function gatewayActualCents(cost: unknown): number | null {
  if ((typeof cost !== "number" && typeof cost !== "string") || cost === "") return null;
  const dollars = Number(cost);
  const cents = Math.ceil(dollars * 100);
  return Number.isFinite(dollars) && dollars >= 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function gatewaySttProvider(fetchImplementation?: typeof fetch): SttProvider {
  return async input => {
    const config = csiProviderConfiguration();
    if (!config.gatewayKey) throw new TranscriptionProviderError("permission_denied");
    try {
      const { createGateway } = await import("@ai-sdk/gateway");
      // Low-level SDK call deliberately avoids transcribe()'s automatic retries and warning logger.
      // One job claim is one billed provider call; no timestamp or diarization requirement.
      const gateway = createGateway({ apiKey: config.gatewayKey, fetch: fetchImplementation });
      const result = await gateway.transcriptionModel(input.model).doGenerate({
        audio: input.audio, mediaType: input.contentType, abortSignal: input.signal,
      });
      return {
        text: result.text,
        segments: result.segments.map(segment => ({ text: segment.text, start_ms: segment.startSecond * 1000, end_ms: segment.endSecond * 1000, speaker: "unknown" })),
        actualCents: gatewayActualCents(result.providerMetadata?.gateway?.cost),
      };
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
      throw new TranscriptionProviderError(status === 401 || status === 403 ? "permission_denied" : status === 429 ? "throttled" : "transient");
    }
  };
}
