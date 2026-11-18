import * as cheerio from "cheerio";
export type GranotSectionKey = "bookedJobs" | "followUpEstimates";

export type GranotReportRow = {
  collectedAt?: string;
  id: string;
  rowIndex: number;
  values: Record<string, string>;
};

export type GranotSourceCollection = {
  sourceLabel: string;
  contentHash: string;
  sectionSchemas: Record<
    GranotSectionKey,
    "table" | "empty" | "missing" | "invalid"
  >;
  sections: Record<GranotSectionKey, GranotReportRow[]>;
};

export type GranotCollectorCredentials = {
  networkUsername: string;
  networkPassword: string;
  username: string;
  password: string;
};

export type GranotCollectorDependencies = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type GranotSessionRequest = (
  path: string,
  init?: { method?: "GET" | "POST"; body?: URLSearchParams },
) => Promise<string>;

/** Cookie jar plus the session id after the two-page Granot login. */
export type GranotAuthenticatedSession = {
  sessionToken: string;
  request: GranotSessionRequest;
};

export class GranotCollectorError extends Error {
  constructor(
    public readonly code:
      | "authentication_failed"
      | "invalid_request"
      | "invalid_session"
      | "schema_drift"
      | "response_too_large"
      | "provider_error",
    message: string,
  ) {
    super(message);
    this.name = "GranotCollectorError";
  }
}

const SESSION_TOKEN_RE = /~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:~|["'<\s]|$)/i;

export function getGranotDateWindowProblem(
  dateWindow: { from: string; to: string },
): string | undefined {
  const from = parseCalendarDate(dateWindow.from);
  const to = parseCalendarDate(dateWindow.to);
  if (!from) return "Granot from date must be a real MM/DD/YYYY calendar date";
  if (!to) return "Granot to date must be a real MM/DD/YYYY calendar date";
  if (from.getTime() > to.getTime()) {
    return "Granot to date must be on or after the from date";
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseCalendarDate(value: string): Date | undefined {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

/**
 * Two-page Granot login shared by Leads & Advertising and Estimates in Process.
 * Does not open a report. `SAVEPASS` is dropped before the network POST.
 */
export async function openGranotAuthenticatedSession(
  credentials: GranotCollectorCredentials,
  dependencies: GranotCollectorDependencies = {},
): Promise<GranotAuthenticatedSession> {
  const { client, userLoginPage } = await authenticateGranotNetwork(credentials, dependencies);
  const userAction = readFormAction(userLoginPage);
  if (!userAction) {
    throw new GranotCollectorError("authentication_failed", "Granot network login did not reach the user login page");
  }
  const userForm = readFormValues(userLoginPage);
  userForm.set("USERNAME", credentials.username);
  userForm.set("PASSWORD", credentials.password);
  userForm.set("LOGON", "Login");
  const mainPage = await client.request(userAction, { method: "POST", body: userForm });
  const sessionToken = mainPage.match(SESSION_TOKEN_RE)?.[1];
  if (!sessionToken) {
    throw new GranotCollectorError("authentication_failed", "Granot user login did not create an authenticated session");
  }
  return { sessionToken, request: (path, init) => client.request(path, init) };
}

/** Company/network authentication only. Never submits a Granot user login or replaces a supplied user's context. */
export async function openGranotNetworkSession(
  credentials: Pick<GranotCollectorCredentials, "networkUsername" | "networkPassword">,
  dependencies: GranotCollectorDependencies = {},
): Promise<{ request: GranotSessionRequest }> {
  const { client } = await authenticateGranotNetwork(credentials, dependencies);
  return { request: (path, init) => client.request(path, init) };
}

async function authenticateGranotNetwork(
  credentials: Pick<GranotCollectorCredentials, "networkUsername" | "networkPassword">,
  dependencies: GranotCollectorDependencies,
) {
  const client = new GranotHttpClient(dependencies);
  const loginPage = await client.request("/wc.dll?mp~NetLogonWc~VANTAGE");
  const networkAction = readFormAction(loginPage);
  if (!networkAction) {
    throw classifyExpectedPageError(loginPage, "network login");
  }

  const networkForm = readFormValues(loginPage);
  networkForm.set("LOGON_USER", credentials.networkUsername);
  networkForm.set("PASSWORD", credentials.networkPassword);
  networkForm.delete("SAVEPASS");
  const userLoginPage = await client.request(networkAction, {
    method: "POST",
    body: networkForm,
  });
  if (!readFormAction(userLoginPage)) {
    throw new GranotCollectorError(
      "authentication_failed",
      "Granot network login did not reach the user login page",
    );
  }

  return { client, userLoginPage };
}

class GranotHttpClient {
  private readonly cookies = new Map<string, string>();
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(dependencies: GranotCollectorDependencies) {
    this.fetchImplementation = dependencies.fetch ?? fetch;
    this.baseUrl = new URL(
      dependencies.baseUrl ?? "https://eagle.hellomoving.com",
    );
    this.timeoutMs = dependencies.timeoutMs ?? 20_000;
    this.maxResponseBytes = dependencies.maxResponseBytes ?? 10_000_000;
  }

  async request(
    path: string,
    init: { method?: "GET" | "POST"; body?: URLSearchParams } = {},
  ): Promise<string> {
    let url = new URL(path.replace(/&amp;/g, "&"), this.baseUrl);
    let method = init.method ?? "GET";
    let body = init.body;

    for (let redirects = 0; redirects < 10; redirects += 1) {
      if (url.origin !== this.baseUrl.origin) {
        throw new GranotCollectorError(
          "provider_error",
          "Granot attempted a cross-origin redirect",
        );
      }
      const headers = new Headers();
      const cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
      if (cookie) headers.set("cookie", cookie);
      if (method === "POST") {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }

      let response: Response;
      try {
        response = await this.fetchImplementation(url.href, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new GranotCollectorError(
          "provider_error",
          `Granot request failed: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }
      this.absorbCookies(response.headers);

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        url = new URL(response.headers.get("location")!, url);
        method =
          response.status === 307 || response.status === 308 ? method : "GET";
        if (method === "GET") body = undefined;
        continue;
      }
      if (!response.ok) {
        throw new GranotCollectorError(
          "provider_error",
          `Granot returned HTTP ${response.status}`,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > this.maxResponseBytes
      ) {
        throw new GranotCollectorError(
          "response_too_large",
          "Granot response exceeded the configured size limit",
        );
      }
      const bytes = await readResponseBody(response, this.maxResponseBytes);
      return new TextDecoder().decode(bytes);
    }

    throw new GranotCollectorError(
      "provider_error",
      "Granot exceeded the redirect limit",
    );
  }

  private absorbCookies(headers: Headers): void {
    const values =
      "getSetCookie" in headers &&
      typeof (headers as Headers & { getSetCookie(): string[] }).getSetCookie ===
        "function"
        ? (headers as Headers & { getSetCookie(): string[] }).getSetCookie()
        : [headers.get("set-cookie")].filter(
            (value): value is string => Boolean(value),
          );
    for (const raw of values) {
      const pair = raw.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(
          pair.slice(0, separator),
          pair.slice(separator + 1),
        );
      }
    }
  }
}

async function readResponseBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      throw new GranotCollectorError(
        "response_too_large",
        "Granot response exceeded the configured size limit",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function readFormAction(html: string): string | undefined {
  const $ = cheerio.load(html);
  const action = $("form").first().attr("action")?.trim();
  if (action) return action;
  return html.match(/\.action\s*=\s*["']([^"']+)["']/i)?.[1];
}

function readFormValues(html: string): URLSearchParams {
  const $ = cheerio.load(html);
  const values = new URLSearchParams();
  $("form")
    .first()
    .find("input[name]")
    .each((_index, input) => {
      const name = $(input).attr("name");
      if (name) values.set(name, $(input).attr("value") ?? "");
    });
  return values;
}

function hasInput(html: string, name: string): boolean {
  const $ = cheerio.load(html);
  return $(`input[name="${name}"]`).length > 0;
}

function classifyExpectedPageError(
  html: string,
  expected: string,
): GranotCollectorError {
  const text = normalizeText(cheerio.load(html)("body").text()).toLowerCase();
  if (
    text.includes("security alert") ||
    text.includes("close window") ||
    text.includes("user login") ||
    text.includes("network login")
  ) {
    return new GranotCollectorError(
      "invalid_session",
      `Granot session became invalid before ${expected}`,
    );
  }
  return new GranotCollectorError(
    "schema_drift",
    `Granot did not return the expected ${expected} page`,
  );
}
