import { getRequiredEnv } from "../../config/domain";
import { logger } from "../../logger";
import {
  clearRingCentralTokenCache,
  exchangeJwtForToken,
  getValidToken,
} from "./auth";

export { getValidToken } from "./auth";

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
