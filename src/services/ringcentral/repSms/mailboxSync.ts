import { randomBytes } from "node:crypto";
import { logger } from "../../../logger";
import { repSmsSyncScope } from "../../../config/domain/ringcentralRepSms";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore } from "../../durableWork/leases";
import type { LeaseToken } from "../../durableWork/types";
import { syncStateLeaseModel } from "../../numberActivity/reconcileCallLog";
import { isProviderThrottle, providerSuppliedRetryAfter, throttleRetryAfterMs } from "../../numberActivity/callLogClient";
import { resolveRepIdentityAt, type TemporalRepLink } from "../../salesIntelligence/repIdentity/resolve";
import { wakeOutreachContactChange, type ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import type { RingCentralCallPriority } from "../rateLimitGate";
import { upsertRepSmsEvidence, type RepSmsEvidenceStore, mongoRepSmsEvidenceStore } from "./evidenceStore";
import type { RepMailbox } from "./mailboxes";
import { mapProviderMessage, type MailboxIdentityAt, type ProviderMessage } from "./mapper";
import { fetchMessageSync, isMessageSyncTokenExpired, type MessageSyncFetcher, type MessageSyncInput, type MessageSyncPage } from "./syncClient";

/**
 * One rep mailbox's message sync (RINGCENTRAL-CAPTURE §5).
 *
 * Under a short per-mailbox lease (`sales_intelligence_sync_state`, scope `rep_sms:<extensionId>`):
 * `ISync` with the stored token, or `FSync` from 7 days back on first run / token loss (FAST-TRACK:
 * the 7-day SMS history), following pages while a page is full, inside a small Light budget. Each
 * SMS record is mapped (metadata only) and upserted into `ringcentral_rep_sms_evidence`; the desk is
 * woken for every row that materially changed. The token, `known_complete_through` (= the provider
 * `syncTime`) and `last_success_at` advance **only** when every record of the run was stored; any
 * failure leaves the old token so the next run replays the same changes.
 *
 * The caller decides the gate (`controls.rep_sms_capture_enabled`) and that the mailbox is a reviewed
 * `sales_rep` mailbox; this function only syncs.
 */
export const REP_SMS_FSYNC_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
export const REP_SMS_RECORD_COUNT = 250;
export const REP_SMS_PAGE_BUDGET = 4;
export const REP_SMS_LEASE_TTL_MS = 60_000;
/** High priority (webhook-driven) waits briefly for a Light slot; the low-priority poll never waits. */
export const REP_SMS_HIGH_PRIORITY_GATE_WAIT_MS = 10_000;

export type StoredMessageSync = {
  extension_id?: string | null;
  token?: string | null;
  sync_time?: Date | null;
  last_full_sync_at?: Date | null;
  last_success_at?: Date | null;
  coverage_from?: Date | null;
  consecutive_expiries?: number;
} | null;

export type MailboxSyncState = { message_sync?: StoredMessageSync; known_complete_through?: Date | null; consecutive_failures?: number };

export type MailboxSyncWrite = {
  message_sync: NonNullable<StoredMessageSync>;
  known_complete_through: Date | null;
  consecutive_failures: number;
  last_run: { started_at: Date; finished_at: Date; runtime_ms: number; pages: number; records: number; upserts: number; throttled_count: number; error_code: string | null };
};

export type MailboxSyncStore = {
  acquire(scope: string, owner: string, ttlMs: number, now: Date): Promise<LeaseToken | null>;
  load(scope: string): Promise<MailboxSyncState>;
  write(scope: string, token: LeaseToken, update: MailboxSyncWrite, now: Date): Promise<boolean>;
  release(token: LeaseToken, now: Date): Promise<void>;
};

export function mongoMailboxSyncStore(): MailboxSyncStore {
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const Model = getSalesIntelligenceSyncStateModel;
  return {
    acquire: (scope, owner, ttlMs, now) => leases.acquire({ scope, owner, ttl_ms: ttlMs, now }),
    load: async (scope) => ((await Model().findOne({ scope }).lean()) ?? {}) as MailboxSyncState,
    write: async (scope, token, update, now) => {
      const result = await Model().updateOne(
        { scope, lease_owner: token.owner, lease_epoch: token.epoch, leased_until: { $gt: now } },
        { $set: { ...update, lease_owner: null, leased_until: now } },
      );
      return result.modifiedCount === 1;
    },
    release: async (token, now) => {
      await leases.release({ token, now });
    },
  };
}

/** Reviewed identity of one mailbox at any instant, from its `rep_identity_links` history (exact at message time). */
export async function loadMailboxIdentity(mailbox: Pick<RepMailbox, "rc_account_id" | "extension_id">): Promise<MailboxIdentityAt> {
  const rows = (await getRepIdentityLinkModel()
    .find({ rc_account_id: mailbox.rc_account_id, rc_extension_id: mailbox.extension_id })
    .lean()) as unknown as TemporalRepLink[];
  return (at) => {
    const resolution = resolveRepIdentityAt(rows, mailbox.rc_account_id, mailbox.extension_id, at);
    return resolution.status === "reviewed" && resolution.agent_id && resolution.link_id
      ? { agent_id: resolution.agent_id, link_id: resolution.link_id }
      : null;
  };
}

export type MailboxSyncSummary = {
  extension_id: string;
  skipped: boolean;
  skip_reason: "lease_held" | null;
  sync_type: "FSync" | "ISync" | null;
  requests: number;
  records: number;
  inserted: number;
  updated: number;
  unchanged: number;
  stale: number;
  ignored: number;
  failures: number;
  expired: boolean;
  token_stored: boolean;
  known_complete_through: string | null;
  woken: number;
  error_code: "provider_throttled" | "provider_request_failed" | "provider_permission_denied" | "evidence_write_failed" | "lease_lost" | null;
  throttle_retry_after_ms: number | null;
  throttle_retry_after_observed: boolean;
};

export type MailboxSyncDeps = {
  now: () => Date;
  fetchSync: MessageSyncFetcher;
  store: MailboxSyncStore;
  evidence: RepSmsEvidenceStore;
  identity: (mailbox: RepMailbox) => Promise<MailboxIdentityAt>;
  wake: (sources: ContactChangeSource[]) => Promise<unknown>;
  owner: string;
  priority: RingCentralCallPriority;
};

export async function runRepSmsMailboxSync(mailbox: RepMailbox, overrides: Partial<MailboxSyncDeps> = {}): Promise<MailboxSyncSummary> {
  const deps: MailboxSyncDeps = {
    now: () => new Date(),
    fetchSync: fetchMessageSync,
    store: overrides.store ?? mongoMailboxSyncStore(),
    evidence: overrides.evidence ?? mongoRepSmsEvidenceStore(),
    identity: loadMailboxIdentity,
    wake: (sources) => wakeOutreachContactChange(sources),
    owner: `rep-sms-sync:${randomBytes(8).toString("hex")}`,
    priority: "high",
    ...overrides,
  };
  const scope = repSmsSyncScope(mailbox.extension_id);
  const startedAt = deps.now();
  const summary: MailboxSyncSummary = {
    extension_id: mailbox.extension_id,
    skipped: false,
    skip_reason: null,
    sync_type: null,
    requests: 0,
    records: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    stale: 0,
    ignored: 0,
    failures: 0,
    expired: false,
    token_stored: false,
    known_complete_through: null,
    woken: 0,
    error_code: null,
    throttle_retry_after_ms: null,
    throttle_retry_after_observed: false,
  };
  const lease = await deps.store.acquire(scope, deps.owner, REP_SMS_LEASE_TTL_MS, startedAt);
  if (!lease) return { ...summary, skipped: true, skip_reason: "lease_held" };

  try {
    const state = await deps.store.load(scope);
    const prev = state.message_sync ?? null;
    const expiries = prev?.consecutive_expiries ?? 0;
    const requestOptions = {
      priority: deps.priority,
      maxWaitMs: deps.priority === "high" ? REP_SMS_HIGH_PRIORITY_GATE_WAIT_MS : 0,
    };
    const fsyncFrom = new Date(startedAt.getTime() - REP_SMS_FSYNC_LOOKBACK_MS);
    const records: unknown[] = [];
    let last: MessageSyncPage | null = null;
    const fetch = async (input: MessageSyncInput) => {
      summary.requests += 1;
      last = await deps.fetchSync(input, requestOptions);
      records.push(...last.records);
      return last;
    };

    let full = !prev?.token;
    try {
      if (!full) {
        try {
          await fetch({ extensionId: mailbox.extension_id, syncType: "ISync", syncToken: prev!.token! });
          summary.sync_type = "ISync";
        } catch (error) {
          if (!isMessageSyncTokenExpired(error)) throw error;
          summary.expired = true;
          full = true;
        }
      }
      if (full) {
        await fetch({ extensionId: mailbox.extension_id, syncType: "FSync", dateFrom: fsyncFrom, recordCount: REP_SMS_RECORD_COUNT });
        summary.sync_type = "FSync";
      }
      // ISync: a full page means more changes wait behind the returned token.
      while (
        summary.sync_type === "ISync" &&
        last!.records.length >= REP_SMS_RECORD_COUNT &&
        last!.syncToken &&
        summary.requests < REP_SMS_PAGE_BUDGET
      ) {
        await fetch({ extensionId: mailbox.extension_id, syncType: "ISync", syncToken: last!.syncToken });
      }
    } catch (error) {
      if (isProviderThrottle(error)) {
        summary.error_code = "provider_throttled";
        summary.throttle_retry_after_ms = throttleRetryAfterMs(error, 60_000);
        summary.throttle_retry_after_observed = providerSuppliedRetryAfter(error);
      } else if ((error as { status?: unknown } | null)?.status === 403 || (error as { status?: unknown } | null)?.status === 401) {
        summary.error_code = "provider_permission_denied";
      } else {
        summary.error_code = "provider_request_failed";
      }
    }

    const page = last as MessageSyncPage | null;
    const sources: ContactChangeSource[] = [];
    let complete = summary.error_code === null && Boolean(page?.syncToken);
    if (summary.error_code === null && !page?.syncToken) summary.error_code = "provider_request_failed";
    if (summary.error_code === null) {
      const identityAt = await deps.identity(mailbox);
      const context = { provider_account_id: mailbox.rc_account_id, extension_id: mailbox.extension_id, sender_numbers: mailbox.sender_numbers, identityAt };
      for (const raw of records) {
        if (typeof raw !== "object" || raw === null) {
          summary.ignored += 1;
          continue;
        }
        summary.records += 1;
        const mapped = mapProviderMessage(raw as ProviderMessage, context);
        if (!mapped.ok) {
          summary.ignored += 1;
          continue;
        }
        try {
          const result = await upsertRepSmsEvidence(mapped.evidence, { now: deps.now(), syncKind: summary.sync_type ?? "ISync" }, deps.evidence);
          summary[result.outcome] += 1;
          if (result.outcome === "inserted" || result.outcome === "updated") {
            sources.push({ source_kind: "sms", source_id: result.id, source_revision: `r${result.source_revision}` });
          }
        } catch (error) {
          summary.failures += 1;
          complete = false;
          logger.warn({ msg: "sales_outreach.rep_sms_sync.record_failed", extensionId: mailbox.extension_id, errorName: error instanceof Error ? error.name : "Error" });
        }
      }
      if (summary.failures) summary.error_code = "evidence_write_failed";
    }

    if (sources.length) {
      summary.woken = sources.length;
      await deps.wake(sources);
    }

    const finishedAt = deps.now();
    const syncTime = page?.syncTime ?? startedAt;
    const nextSync: NonNullable<StoredMessageSync> = complete
      ? {
          extension_id: mailbox.extension_id,
          token: page!.syncToken,
          sync_time: syncTime,
          last_full_sync_at: summary.sync_type === "FSync" ? finishedAt : prev?.last_full_sync_at ?? null,
          last_success_at: finishedAt,
          coverage_from:
            summary.sync_type === "FSync"
              ? page!.olderRecordsExist
                ? oldestCreation(records) ?? fsyncFrom
                : fsyncFrom
              : prev?.coverage_from ?? null,
          consecutive_expiries: summary.expired ? expiries + 1 : summary.sync_type === "ISync" ? 0 : expiries,
        }
      : {
          extension_id: mailbox.extension_id,
          // An expired token cannot replay; drop it so the next run bootstraps directly.
          token: summary.expired ? null : prev?.token ?? null,
          sync_time: prev?.sync_time ?? null,
          last_full_sync_at: prev?.last_full_sync_at ?? null,
          last_success_at: prev?.last_success_at ?? null,
          coverage_from: prev?.coverage_from ?? null,
          consecutive_expiries: summary.expired ? expiries + 1 : expiries,
        };
    summary.token_stored = complete;
    const knownCompleteThrough = complete ? syncTime : state.known_complete_through ?? null;
    summary.known_complete_through = knownCompleteThrough?.toISOString() ?? null;
    const written = await deps.store.write(
      scope,
      lease,
      {
        message_sync: nextSync,
        known_complete_through: knownCompleteThrough,
        consecutive_failures: complete ? 0 : (state.consecutive_failures ?? 0) + 1,
        last_run: {
          started_at: startedAt,
          finished_at: finishedAt,
          runtime_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          pages: summary.requests,
          records: summary.records,
          upserts: summary.inserted + summary.updated,
          throttled_count: summary.error_code === "provider_throttled" ? 1 : 0,
          error_code: summary.error_code,
        },
      },
      finishedAt,
    );
    if (!written) {
      summary.error_code = "lease_lost";
      summary.token_stored = false;
    }
    logger[summary.error_code ? "warn" : "info"]({
      msg: "sales_outreach.rep_sms_sync.completed",
      extensionId: mailbox.extension_id,
      syncType: summary.sync_type,
      requests: summary.requests,
      records: summary.records,
      inserted: summary.inserted,
      updated: summary.updated,
      failures: summary.failures,
      tokenStored: summary.token_stored,
      errorCode: summary.error_code,
    });
    return summary;
  } catch (error) {
    // Unexpected failure (identity read, state write): free the mailbox for the next run.
    await deps.store.release(lease, deps.now()).catch(() => undefined);
    throw error;
  }
}

function oldestCreation(records: readonly unknown[]): Date | null {
  let out: Date | null = null;
  for (const raw of records) {
    const value = (raw as { creationTime?: unknown } | null)?.creationTime;
    if (typeof value !== "string") continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime()) && (!out || d < out)) out = d;
  }
  return out;
}
