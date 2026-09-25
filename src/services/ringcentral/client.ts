import { getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import {
  clearRingCentralTokenCache,
  exchangeJwtForToken,
  getValidToken,
} from "./auth";
import {
  acquireRingCentralSlot,
  providerRetryAfterMs,
  recordRingCentralThrottle,
  RingCentralGateDeniedError,
  type RingCentralCallPriority,
} from "./rateLimitGate";

export { getValidToken } from "./auth";

/** Bound this consumer's wait without changing the shared token refresh contract. */
async function awaitRecordingAuth<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject);
    });
  } finally { signal.removeEventListener("abort", onAbort); }
}

/** Additive raw GET transport for bounded streaming consumers. Shares token refresh; never follows a contentUri or cross-origin redirect. */
export async function ringCentralReadResponse(endpoint: string, signal: AbortSignal, deps: {
  fetch?: typeof fetch;
  token?: typeof getValidToken;
  refresh?: () => Promise<unknown>;
  server?: string;
  /** Rate-gate lane (default high). A refused slot answers a local 429 with Retry-After; nothing is sent. */
  priority?: RingCentralCallPriority;
} = {}): Promise<Response> {
  if (!/^\/restapi\/v1\.0\/account\/[^/]+\/recording\/[^/]+(?:\/content)?$/.test(endpoint)) throw new Error("invalid_recording_endpoint");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await awaitRecordingAuth(signal, deps.token ?? getValidToken);
    try {
      await acquireRingCentralSlot(endpoint, { priority: deps.priority, signal });
    } catch (error) {
      if (!(error instanceof RingCentralGateDeniedError)) throw error;
      return new Response(null, {
        status: 429,
        statusText: "Rate gate closed",
        headers: { "retry-after": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))), "x-vantage-rate-gate": error.reason },
      });
    }
    const response = await (deps.fetch ?? fetch)(`${deps.server ?? getRequiredEnv("RC_SERVER_URL")}${endpoint}`, {
      method: "GET", headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal,
    });
    if (response.status === 429) {
      await recordRingCentralThrottle(endpoint, {
        retryAfterMs: providerRetryAfterMs(response.headers).ms,
        headerGroup: response.headers.get("x-rate-limit-group"),
      });
    }
    if (response.status !== 401 || attempt === 1) return response;
    await response.body?.cancel();
    if (deps.refresh) await awaitRecordingAuth(signal, deps.refresh);
    else {
      await awaitRecordingAuth(signal, clearRingCentralTokenCache);
      await awaitRecordingAuth(signal, exchangeJwtForToken);
    }
  }
  throw new Error("recording_auth_failed");
}

export class RingCentralApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly endpoint: string,
    readonly method: string,
    readonly responseBody: unknown,
    readonly throttle: {
      /** Provider (or rate-gate) wait before the next request in this group. */
      retryAfterMs?: number;
      /** `X-Rate-Limit-Group` of a provider 429, or the gate group. */
      rateLimitGroup?: string | null;
      /** True when the local rate gate refused the send; RingCentral saw no request. */
      gated?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "RingCentralApiError";
  }

  /** Read by `throttleRetryAfterMs` / `providerSuppliedRetryAfter`. */
  get retryAfterMs(): number | undefined {
    return this.throttle.retryAfterMs;
  }
}

export type RingCentralRequestOptions = {
  /** Rate-gate lane. Low-priority work may use only part of the Heavy budget and does not wait. */
  priority?: RingCentralCallPriority;
  /** Longest wait for a Heavy slot before reporting a throttle (default: high 70 s, low 0). */
  maxWaitMs?: number;
};

export async function ringCentralRequest(
  method: string,
  endpoint: string,
  body?: unknown,
  options: RingCentralRequestOptions = {},
): Promise<any> {
  try {
    await acquireRingCentralSlot(endpoint, { priority: options.priority, maxWaitMs: options.maxWaitMs });
  } catch (error) {
    if (!(error instanceof RingCentralGateDeniedError)) throw error;
    throw new RingCentralApiError(
      "RingCentral rate gate closed; request not sent",
      429,
      "Rate gate closed",
      endpoint,
      method,
      null,
      { retryAfterMs: error.retryAfterMs, rateLimitGroup: error.group, gated: true },
    );
  }
  return ringCentralRequestWithRetry(method, endpoint, body, true);
}

async function ringCentralRequestWithRetry(
  method: string,
  endpoint: string,
  body: unknown,
  retryOnUnauthorized: boolean,
): Promise<any> {
  const token = await getValidToken();
  const response = await fetch(`${getRequiredEnv("RC_SERVER_URL")}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && retryOnUnauthorized) {
    logger.warn({
      msg: "ringcentral.request.unauthorized_retrying",
      method,
      endpoint,
      status: response.status,
    });
    await clearRingCentralTokenCache();
    await exchangeJwtForToken();
    return ringCentralRequestWithRetry(method, endpoint, body, false);
  }

  const payload = await readResponseBody(response);
  if (!response.ok) {
    const throttled = response.status === 429;
    const retryAfter = throttled ? providerRetryAfterMs(response.headers) : null;
    const rateLimitGroup = throttled ? response.headers.get("x-rate-limit-group") : null;
    logger.warn({
      msg: "ringcentral.request.failed",
      method,
      endpoint,
      status: response.status,
      statusText: response.statusText,
      ...(throttled ? { rateLimitGroup, retryAfterMs: retryAfter?.ms ?? null } : {}),
    });
    if (throttled && retryAfter) {
      await recordRingCentralThrottle(endpoint, { retryAfterMs: retryAfter.ms, headerGroup: rateLimitGroup });
    }
    throw new RingCentralApiError(
      `RingCentral request failed with status ${response.status}`,
      response.status,
      response.statusText,
      endpoint,
      method,
      payload,
      retryAfter?.observed ? { retryAfterMs: retryAfter.ms, rateLimitGroup } : { rateLimitGroup },
    );
  }

  logger.debug({
    msg: "ringcentral.request.succeeded",
    method,
    endpoint,
    status: response.status,
    statusText: response.statusText,
  });

  return payload;
}

async function readResponseBody(response: Response): Promise<any> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
