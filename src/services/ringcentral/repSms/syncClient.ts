import { ringCentralRequest, RingCentralApiError, type RingCentralRequestOptions } from "../client";

/**
 * Per-mailbox message sync (RINGCENTRAL-CAPTURE §5): `GET /restapi/v1.0/account/~/extension/{id}/
 * message-sync`, Light group. `FSync` starts a chain from `dateFrom` (newest records first, at most
 * `recordCount`, `olderRecordsExist` when it had to stop); `ISync` returns what changed since the
 * stored `syncToken`, status updates included — which is why the sync, not the webhook event, is the
 * source of truth (update events carry no message ids). SMS only.
 */
export type MessageSyncInput =
  | { extensionId: string; syncType: "FSync"; dateFrom: Date; recordCount: number }
  | { extensionId: string; syncType: "ISync"; syncToken: string };

export type MessageSyncPage = {
  records: unknown[];
  syncType: "FSync" | "ISync" | null;
  syncToken: string | null;
  syncTime: Date | null;
  olderRecordsExist: boolean;
};

export type MessageSyncFetcher = (input: MessageSyncInput, options?: RingCentralRequestOptions) => Promise<MessageSyncPage>;

export function messageSyncEndpoint(input: MessageSyncInput): string {
  if (!/^\d+$/.test(input.extensionId)) throw new Error("invalid_extension_id");
  const query = new URLSearchParams(
    input.syncType === "FSync"
      ? { syncType: "FSync", messageType: "SMS", dateFrom: input.dateFrom.toISOString(), recordCount: String(input.recordCount) }
      : { syncType: "ISync", syncToken: input.syncToken },
  );
  return `/restapi/v1.0/account/~/extension/${input.extensionId}/message-sync?${query.toString()}`;
}

export const fetchMessageSync: MessageSyncFetcher = async (input, options = {}) =>
  parseMessageSyncPayload(await ringCentralRequest("GET", messageSyncEndpoint(input), undefined, options));

export function parseMessageSyncPayload(payload: unknown): MessageSyncPage {
  const body = (payload ?? {}) as { records?: unknown; syncInfo?: Record<string, unknown> };
  const info = body.syncInfo ?? {};
  const token = typeof info.syncToken === "string" && info.syncToken.trim() ? info.syncToken : null;
  const time = typeof info.syncTime === "string" ? new Date(info.syncTime) : null;
  return {
    records: Array.isArray(body.records) ? body.records : [],
    syncType: info.syncType === "FSync" || info.syncType === "ISync" ? info.syncType : null,
    syncToken: token,
    syncTime: time && !Number.isNaN(time.getTime()) ? time : null,
    olderRecordsExist: info.olderRecordsExist === true,
  };
}

/** An invalid or expired sync token answers 400 (or a `MSG-*` code); either means "start over with FSync". */
export function isMessageSyncTokenExpired(error: unknown): boolean {
  if (!(error instanceof RingCentralApiError)) return false;
  if (error.status === 400) return true;
  const code = (error.responseBody as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" && code.startsWith("MSG-") && error.status >= 400 && error.status < 500 && error.status !== 403 && error.status !== 429;
}
