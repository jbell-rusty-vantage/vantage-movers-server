import {
  createGoogleServiceAccountAuth,
  getGoogleServiceAccountProjectId,
} from "../googleAuth/serviceAccount";
import { logger } from "../../logger";
import { stateNameToCode } from "../../utils/location/stateNamesToCodes";

const MAPS_GEOCODING_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/maps-platform.geocode",
];

type GoogleMapsAuthContext = {
  auth: ReturnType<typeof createGoogleServiceAccountAuth>;
  projectId: string;
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

let cachedAuthContext: Promise<GoogleMapsAuthContext> | null = null;
let loggedAuthFailure = false;

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
    const url = new URL("https://geocode.googleapis.com/v4/geocode/address");
    url.searchParams.set("address.postalCode", zip);
    url.searchParams.set("address.regionCode", "US");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": projectId,
      },
    });

    if (!response.ok) {
      logger.warn({
        msg: "google_maps.geocoding.zip_state_failed",
        zip,
        status: response.status,
        response: await response.text(),
      });
      return undefined;
    }

    const data = (await response.json()) as GoogleGeocodeResponse;
    return extractStateCodeFromGoogleGeocodeResponse(data);
  } catch (error) {
    logAuthOrRequestFailure(error);
    return undefined;
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
  const projectId = getGoogleServiceAccountProjectId();
  if (!projectId) {
    throw new Error(
      "Google Maps geocoding auth requires project_id in the service account JSON or GOOGLE_CLOUD_PROJECT.",
    );
  }

  const auth = createGoogleServiceAccountAuth(MAPS_GEOCODING_SCOPES);
  return { auth, projectId };
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
