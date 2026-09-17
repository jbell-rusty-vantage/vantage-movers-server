import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { normalizeRingCentralWebhookPayload } from "../ringcentral/webhook-event-normalizer";
import {
  accountIdFromProviderPath,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
  type ApplyResult,
} from "./persistInteraction";
import type { RouteResolver, WebhookEndpoint, WebhookPartyObservation } from "./types";

/**
 * All-direction webhook observation. CSI-03 owns the durable capture-projection
 * job and fan-out; this module is the interface it calls with stored provider
 * evidence. No direction filter, no qualification, no Lead writes.
 *
 * Each telephony session in the batch is projected independently. One
 * session's failure does not block another; failures are reported per session
 * and as bounded operational events, never as provider bodies.
 */
export type ObserveDependencies = {
  now?: () => Date;
  directory?: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  apply?: typeof applyInteractionObservation;
  recordEvent?: typeof recordOperationalEvent;
  configuredAccountId?: string | null;
  /** Durable capture-projection job id (24-hex) recorded on every audit row this call writes. */
  request_id?: string | null;
};

export type SessionObservationResult =
  | { telephony_session_id: string; account_id: string; ok: true; result: ApplyResult }
  | {
      telephony_session_id: string;
      account_id: string | null;
      ok: false;
      error_code:
        | "account_unresolved"
        | "account_mismatch"
        | "identity_missing"
        | "projection_failed"
        | "retry_exhausted"
        | "persist_failed";
    };

/** Normalizes one raw telephony-session webhook payload into per-party observations. */
export function normalizeWebhookPartyObservations(
  payload: unknown,
  receivedAt: Date,
): WebhookPartyObservation[] {
  const base = normalizeRingCentralWebhookPayload(payload, receivedAt);
  const root = recordOf(payload);
  const body = recordOf(root?.body);
  const eventPath = str(root?.event);
  return base.map((event) => {
    const party = recordOf(event.rawParty);
    return {
      webhook_uuid: event.webhookUuid,
      subscription_id: event.subscriptionId,
      event_path: eventPath,
      event_time: event.eventTime ?? event.timestamp,
      received_at: receivedAt,
      sequence: event.sequence,
      account_id: str(party?.accountId) ?? str(body?.accountId) ?? accountIdFromProviderPath(eventPath),
      telephony_session_id: event.telephonySessionId,
      session_id: event.sessionId,
      party_id: event.partyId,
      extension_id: str(party?.extensionId) ?? str(recordOf(party?.extension)?.id),
      direction: event.direction,
      status_code: event.statusCode,
      call_started_at: event.callStartedAt ?? null,
      from: endpoint(recordOf(party?.from)),
      to: endpoint(recordOf(party?.to)),
      queue_call: event.queueCall,
      missed_call: event.missedCall,
      stand_alone: typeof party?.standAlone === "boolean" ? party.standAlone : null,
      recordings: Array.isArray(party?.recordings)
        ? party.recordings
            .map((r) => recordOf(r))
            .filter((r): r is Record<string, unknown> => r !== null && str(r.id) !== null)
            .map((r) => ({ id: str(r.id)!, active: typeof r.active === "boolean" ? r.active : null }))
        : [],
    };
  });
}

export async function observeRingCentralWebhookEvents(
  observations: readonly WebhookPartyObservation[],
  deps: ObserveDependencies = {},
): Promise<SessionObservationResult[]> {
  const now = deps.now ?? (() => new Date());
  const apply = deps.apply ?? applyInteractionObservation;
  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
  const loadDirectoryOnce = deps.directory ?? loadDirectoryLookup;
  // One directory load per account for the whole delivery, not per session.
  const directoryCache = new Map<string, Promise<DirectoryLookup>>();
  const loadDirectory = (accountId: string) => {
    let pending = directoryCache.get(accountId);
    if (!pending) {
      pending = loadDirectoryOnce(accountId);
      directoryCache.set(accountId, pending);
    }
    return pending;
  };
  const resolveRoute = deps.resolveRoute ?? (observations.length ? await defaultRouteResolver() : undefined);

  const bySession = new Map<string, WebhookPartyObservation[]>();
  for (const observation of observations) {
    const list = bySession.get(observation.telephony_session_id) ?? [];
    list.push(observation);
    bySession.set(observation.telephony_session_id, list);
  }

  const results: SessionObservationResult[] = [];
  for (const [telephonySessionId, events] of bySession) {
    let accountId: string | null = null;
    try {
      accountId = resolveProviderAccountId(
        events.map((e) => e.account_id),
        deps.configuredAccountId === undefined ? undefined : deps.configuredAccountId,
      );
      const directory = await loadDirectory(accountId);
      const result = await apply(
        accountId,
        {
          kind: "webhook",
          events,
          proof_ref: webhookProofRef(telephonySessionId, events),
        },
        { now, directory, resolveRoute, request_id: deps.request_id ?? null },
      );
      results.push({ telephony_session_id: telephonySessionId, account_id: accountId, ok: true, result });
    } catch (error) {
      const code = classify(error);
      results.push({ telephony_session_id: telephonySessionId, account_id: accountId, ok: false, error_code: code });
      logger.warn({
        msg: "sales_intelligence.capture.webhook.observe_failed",
        telephonySessionId,
        errorCode: code,
        errorName: error instanceof Error ? error.name : "Error",
      });
      await recordEvent({
        level: "warn",
        eventKey: "sales_intelligence.capture.webhook.observe_failed",
        category: "ringcentral",
        workflow: "sales_intelligence",
        summary: "All-direction webhook observation could not be projected.",
        details: { telephonySessionId, errorCode: code },
        notificationCandidate: false,
        reportable: false,
        piiPolicy: "none",
      });
    }
  }
  return results;
}

/**
 * Provider evidence reference for this session's slice of the delivery: every
 * receipt UUID that contributed, sorted for determinism. Falls back to the
 * session id when the payload carried no UUID; never a literal "unknown".
 */
function webhookProofRef(telephonySessionId: string, events: readonly WebhookPartyObservation[]): string {
  const uuids = [...new Set(events.map((e) => e.webhook_uuid).filter((u): u is string => !!u))].sort();
  if (!uuids.length) return `webhook:session:${telephonySessionId}`;
  const shown = uuids.slice(0, MAX_PROOF_UUIDS);
  const more = uuids.length - shown.length;
  return `webhook:${shown.join(",")}${more > 0 ? `,+${more}` : ""}`;
}

const MAX_PROOF_UUIDS = 8;

function classify(error: unknown): Extract<SessionObservationResult, { ok: false }>["error_code"] {
  if (error instanceof ProviderAccountError) return error.code;
  if (error instanceof InteractionPersistenceError) return error.code;
  return "persist_failed";
}

function endpoint(value: Record<string, unknown> | null): WebhookEndpoint {
  return {
    phone_number: str(value?.phoneNumber),
    name: str(value?.name),
    extension_id: str(value?.extensionId),
    extension_number: str(value?.extensionNumber),
  };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
