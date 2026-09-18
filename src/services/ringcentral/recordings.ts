import { ringCentralReadResponse } from "./client";

export class RecordingReadError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null = null) { super(`recording_http_${status}`); }
}
export type RecordingProvider = {
  metadata(accountId: string, recordingId: string, signal: AbortSignal): Promise<{ contentType: string | null; duration: number | null }>;
  content(accountId: string, recordingId: string, signal: AbortSignal): Promise<Response>;
};
export function retryAfterMs(value: string | null, now: Date): number {
  if (value && /^\d+(\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000;
    if (Number.isFinite(delay) && delay < 8.64e15 - now.getTime()) return Math.max(1000, delay);
  }
  if (value) { const date = Date.parse(value); if (Number.isFinite(date) && date > now.getTime()) return date - now.getTime(); }
  return 600_000;
}
export function recordingProvider(read = ringCentralReadResponse): RecordingProvider {
  const request = async (account: string, id: string, content: boolean, signal: AbortSignal) => {
    if (!/^[A-Za-z0-9_-]+$/.test(account) || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid_recording_identity");
    const response = await read(`/restapi/v1.0/account/${account}/recording/${id}${content ? "/content" : ""}`, signal);
    if (!response.ok || (content && response.status !== 200)) {
      await response.body?.cancel();
      throw new RecordingReadError(response.status, response.headers.get("retry-after"));
    }
    return response;
  };
  return {
    async metadata(account, id, signal) {
      const response = await request(account, id, false, signal);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("invalid_recording_metadata");
      // Deliberately discard contentUri and all other provider fields.
      const type = "contentType" in data ? data.contentType : null;
      const duration = "duration" in data ? data.duration : null;
      return { contentType: typeof type === "string" ? type : null, duration: typeof duration === "number" && duration >= 0 ? duration : null };
    },
    content: (account, id, signal) => request(account, id, true, signal),
  };
}
