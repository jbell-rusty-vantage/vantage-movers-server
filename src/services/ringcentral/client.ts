import { getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import {
  clearRingCentralTokenCache,
  exchangeJwtForToken,
  getValidToken,
} from "./auth";

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
} = {}): Promise<Response> {
  if (!/^\/restapi\/v1\.0\/account\/[^/]+\/recording\/[^/]+(?:\/content)?$/.test(endpoint)) throw new Error("invalid_recording_endpoint");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await awaitRecordingAuth(signal, deps.token ?? getValidToken);
    const response = await (deps.fetch ?? fetch)(`${deps.server ?? getRequiredEnv("RC_SERVER_URL")}${endpoint}`, {
      method: "GET", headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal,
    });
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
  ) {
    super(message);
    this.name = "RingCentralApiError";
  }
}

export async function ringCentralRequest(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<any> {
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
    logger.warn({
      msg: "ringcentral.request.failed",
      method,
      endpoint,
      status: response.status,
      statusText: response.statusText,
    });
    throw new RingCentralApiError(
      `RingCentral request failed with status ${response.status}`,
      response.status,
      response.statusText,
      endpoint,
      method,
      payload,
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
