import {
  createGoogleServiceAccountAuth,
  getGoogleServiceAccountProjectId,
} from "../googleAuth/serviceAccount";
import { logger } from "../../logger";
import { resolveAuthConfigSummary } from "../googleSheets/diagnostics";
import { stateNameToCode } from "../../utils/location/stateNamesToCodes";
import { shouldCaptureZipStateEvents } from "../../config/domain/observability";
import { recordOperationalEvent } from "../observability";

const MAPS_GEOCODING_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/maps-platform.geocode",
];

type GoogleMapsAuthContext = {
  auth: ReturnType<typeof createGoogleServiceAccountAuth>;
  projectId: string;
};

export type GoogleMapsGeocodingHealth = {
  ok: boolean;
  checkedAt: string;
  testZip: string;
  scopes: string[];
  auth: {
    ok: boolean;
    authSource: ReturnType<typeof resolveAuthConfigSummary>["authSource"];
    clientEmail: string | null;
    projectId: string | null;
    resolvedProjectId: string | null;
    privateKeyPresent: boolean;
    keyFile: string | null;
    error: string | null;
  };
  token: {
    ok: boolean;
    error: string | null;
  };
  geocoding: {
    ok: boolean;
    endpoint: string;
    status: number | null;
    statusText: string | null;
    stateCode: string | null;
    resultCount: number | null;
    responsePreview: string | null;
    error: string | null;
  };
};

type GoogleGeocodeAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type GoogleGeocodeResponse = {
  results?: Array<{
    postalAddress?: {
      administrativeArea?: string;
    };
    addressComponents?: GoogleGeocodeAddressComponent[];
  }>;
};

const GOOGLE_GEOCODING_ENDPOINT = "https://geocode.googleapis.com/v4/geocode/address";

let cachedAuthContext: Promise<GoogleMapsAuthContext> | null = null;
let loggedAuthConfig = false;
let loggedAuthFailure = false;
let recordedHttpFailureEvent = false;
let recordedUnavailableEvent = false;

export async function getGoogleStateCodeForZip(
  zipCode: string,
): Promise<string | undefined> {
  const zip = zipCode.trim();
  if (!/^\d{5}$/.test(zip)) {
    return undefined;
  }

  try {
    const { auth, projectId } = await getGoogleMapsAuthContext();
    const token = await getGoogleMapsAccessToken(auth);
    const url = new URL(GOOGLE_GEOCODING_ENDPOINT);
    url.searchParams.set("address.postalCode", zip);
    url.searchParams.set("address.regionCode", "US");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": projectId,
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger.warn({
        msg: "google_maps.geocoding.zip_state_failed",
        zip,
        status: response.status,
        projectId,
        response: responseBody,
      });
      // Record once per cold start: the caller falls back to Zippopotamus, so
      // a misconfigured Maps integration must not flood the event stream.
      if (!recordedHttpFailureEvent && shouldCaptureZipStateEvents()) {
        recordedHttpFailureEvent = true;
        await recordOperationalEvent({
          level: "warn",
          eventKey: "zip_state.google_maps.failed",
          category: "zip_state",
          workflow: "zip_state_lookup",
          summary: "Google Maps ZIP lookup returned an HTTP error.",
          details: {
            zip,
            status: response.status,
            provider: "google_maps",
            project_id: projectId,
          },
          notificationCandidate: false,
        });
      }
      return undefined;
    }

    const data = (await response.json()) as GoogleGeocodeResponse;
    return extractStateCodeFromGoogleGeocodeResponse(data);
  } catch (error) {
    logAuthOrRequestFailure(error);
    if (!recordedUnavailableEvent && shouldCaptureZipStateEvents()) {
      recordedUnavailableEvent = true;
      await recordOperationalEvent({
        level: "warn",
        eventKey: "zip_state.google_maps.unavailable",
        category: "zip_state",
        workflow: "zip_state_lookup",
        summary: "Google Maps ZIP lookup unavailable; falling back to Zippopotamus.",
        details: {
          provider: "google_maps",
          fallback: "zippopotamus",
          causeMessage: error instanceof Error ? error.message : String(error),
        },
        errorMessage: error instanceof Error ? error.message : String(error),
        notificationCandidate: false,
      });
    }
    return undefined;
  }
}

export async function checkGoogleMapsGeocodingHealth(
  testZip = "10001",
): Promise<GoogleMapsGeocodingHealth> {
  const checkedAt = new Date().toISOString();
  const zip = /^\d{5}$/.test(testZip.trim()) ? testZip.trim() : "10001";
  const authSummary = getSafeAuthConfigSummary();
  const health: GoogleMapsGeocodingHealth = {
    ok: false,
    checkedAt,
    testZip: zip,
    scopes: MAPS_GEOCODING_SCOPES,
    auth: {
      ok: false,
      authSource: authSummary.summary.authSource,
      clientEmail: authSummary.summary.clientEmail ?? null,
      projectId: authSummary.summary.projectId ?? null,
      resolvedProjectId: getGoogleServiceAccountProjectId() ?? authSummary.summary.projectId ?? null,
      privateKeyPresent: authSummary.summary.privateKeyPresent,
      keyFile: authSummary.summary.keyFile ?? null,
      error: authSummary.error,
    },
    token: {
      ok: false,
      error: null,
    },
    geocoding: {
      ok: false,
      endpoint: GOOGLE_GEOCODING_ENDPOINT,
      status: null,
      statusText: null,
      stateCode: null,
      resultCount: null,
      responsePreview: null,
      error: null,
    },
  };

  if (authSummary.error) {
    return health;
  }

  try {
    const { auth, projectId } = await getGoogleMapsAuthContext();
    health.auth.ok = true;
    health.auth.resolvedProjectId = projectId;

    const token = await getGoogleMapsAccessToken(auth);
    health.token.ok = true;

    const url = new URL(GOOGLE_GEOCODING_ENDPOINT);
    url.searchParams.set("address.postalCode", zip);
    url.searchParams.set("address.regionCode", "US");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": projectId,
      },
    });
    const responseBody = await response.text();
    health.geocoding.status = response.status;
    health.geocoding.statusText = response.statusText;
    health.geocoding.responsePreview = responseBody.slice(0, 1000) || null;

    if (!response.ok) {
      health.geocoding.error = `Google Geocoding API returned HTTP ${response.status}`;
      return health;
    }

    const data = JSON.parse(responseBody) as GoogleGeocodeResponse;
    const stateCode = extractStateCodeFromGoogleGeocodeResponse(data);
    health.geocoding.ok = Boolean(stateCode);
    health.geocoding.stateCode = stateCode ?? null;
    health.geocoding.resultCount = data.results?.length ?? 0;
    health.geocoding.error = stateCode ? null : "Google response did not include a state code";
    health.ok = health.auth.ok && health.token.ok && health.geocoding.ok;
    return health;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!health.token.ok) {
      health.token.error = message;
    } else {
      health.geocoding.error = message;
    }
    return health;
  }
}

export function extractStateCodeFromGoogleGeocodeResponse(
  data: GoogleGeocodeResponse,
): string | undefined {
  for (const result of data.results ?? []) {
    const postalAddressState = toStateCode(result.postalAddress?.administrativeArea);
    if (postalAddressState) {
      return postalAddressState;
    }

    const stateComponent = result.addressComponents?.find((component) =>
      component.types?.includes("administrative_area_level_1"),
    );
    const stateCode =
      toStateCode(stateComponent?.shortText) ?? toStateCode(stateComponent?.longText);
    if (stateCode) {
      return stateCode;
    }
  }

  return undefined;
}

function getSafeAuthConfigSummary(): {
  summary: ReturnType<typeof resolveAuthConfigSummary>;
  error: string | null;
} {
  try {
    return { summary: resolveAuthConfigSummary(), error: null };
  } catch (error) {
    return {
      summary: {
        authSource: "missing",
        privateKeyPresent: false,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getGoogleMapsAuthContext(): Promise<GoogleMapsAuthContext> {
  cachedAuthContext ??= createGoogleMapsAuthContext();
  try {
    return await cachedAuthContext;
  } catch (error) {
    cachedAuthContext = null;
    throw error;
  }
}

async function createGoogleMapsAuthContext(): Promise<GoogleMapsAuthContext> {
  logGoogleMapsAuthConfigOnce();
  const projectId = getGoogleServiceAccountProjectId();
  if (!projectId) {
    throw new Error(
      "Google Maps geocoding auth requires project_id in the service account JSON or GOOGLE_CLOUD_PROJECT.",
    );
  }

  const auth = createGoogleServiceAccountAuth(MAPS_GEOCODING_SCOPES);
  return { auth, projectId };
}

function logGoogleMapsAuthConfigOnce(): void {
  if (loggedAuthConfig) {
    return;
  }

  loggedAuthConfig = true;
  const authSummary = resolveAuthConfigSummary();
  logger.info({
    msg: "google_maps.auth.config",
    authSource: authSummary.authSource,
    clientEmail: authSummary.clientEmail ?? null,
    projectId: getGoogleServiceAccountProjectId() ?? authSummary.projectId ?? null,
    privateKeyPresent: authSummary.privateKeyPresent,
    keyFile: authSummary.keyFile ?? null,
    scopes: MAPS_GEOCODING_SCOPES,
  });
}

async function getGoogleMapsAccessToken(
  auth: ReturnType<typeof createGoogleServiceAccountAuth>,
): Promise<string> {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!token) {
    throw new Error("Failed to obtain Google Maps geocoding access token.");
  }

  return token;
}

function toStateCode(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return stateNameToCode(trimmed) ?? undefined;
}

function logAuthOrRequestFailure(error: unknown): void {
  if (loggedAuthFailure) {
    return;
  }

  loggedAuthFailure = true;
  logger.warn(
    {
      err: error,
      msg: "google_maps.geocoding.unavailable",
    },
    "Google Maps geocoding unavailable; falling back to Zippopotamus",
  );
}
