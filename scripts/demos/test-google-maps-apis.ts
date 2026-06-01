import process from "node:process";
import { google } from "googleapis";

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [key: string]: unknown;
};

type ApiTestResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const MAPS_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/maps-platform.geocode",
];

function getServiceAccountCredentials(): ServiceAccountCredentials {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const value =
    rawJson ??
    (base64Json
      ? Buffer.from(base64Json, "base64").toString("utf8")
      : undefined);

  if (!value) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64).",
    );
  }

  const parsed = JSON.parse(value) as ServiceAccountCredentials;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  if (!parsed.client_email?.trim() || !parsed.private_key?.trim()) {
    throw new Error("Service account JSON is missing client_email or private_key.");
  }

  return parsed;
}

async function getAccessToken(
  credentials: ServiceAccountCredentials,
): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: MAPS_SCOPES,
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!token) {
    throw new Error("Failed to obtain Google OAuth access token.");
  }

  return token;
}

function formatApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string; code?: number };
      message?: string;
    };
    const message =
      parsed.error?.message ??
      parsed.message ??
      body.slice(0, 300);
    const statusLabel = parsed.error?.status ?? String(status);
    return `${statusLabel}: ${message}`;
  } catch {
    return `${status}: ${body.slice(0, 300)}`;
  }
}

async function googleMapsRequest(
  url: string,
  options: {
    token: string;
    projectId: string;
    method?: "GET" | "POST";
    body?: unknown;
    fieldMask?: string;
  },
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    "X-Goog-User-Project": options.projectId,
  };

  if (options.fieldMask) {
    headers["X-Goog-FieldMask"] = options.fieldMask;
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const body = await response.text();
  return { status: response.status, body };
}

function extractStateFromGeocode(body: string): string | undefined {
  const parsed = JSON.parse(body) as {
    results?: Array<{
      postalAddress?: { administrativeArea?: string };
      addressComponents?: Array<{ shortText?: string; types?: string[] }>;
    }>;
  };

  const result = parsed.results?.[0];
  const fromPostal = result?.postalAddress?.administrativeArea?.trim();
  if (fromPostal) {
    return fromPostal;
  }

  const stateComponent = result?.addressComponents?.find((component) =>
    component.types?.includes("administrative_area_level_1"),
  );
  return stateComponent?.shortText?.trim();
}

async function testGeocodingZipToState(
  token: string,
  projectId: string,
): Promise<ApiTestResult> {
  const name = "Geocoding API (ZIP -> state)";
  const url =
    "https://geocode.googleapis.com/v4/geocode/address?address.postalCode=90210&address.regionCode=US";

  const { status, body } = await googleMapsRequest(url, { token, projectId });
  if (status !== 200) {
    return { name, ok: false, detail: formatApiError(status, body) };
  }

  const state = extractStateFromGeocode(body);
  if (state !== "CA") {
    return {
      name,
      ok: false,
      detail: `Expected CA for ZIP 90210, got ${state ?? "no state"}`,
    };
  }

  return { name, ok: true, detail: "90210 resolved to CA" };
}

async function testGeocodingAddressToLatLng(
  token: string,
  projectId: string,
): Promise<ApiTestResult> {
  const name = "Geocoding API (address -> lat/lng)";
  const address = "1600 Amphitheatre Parkway, Mountain View, CA";
  const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}`;

  const { status, body } = await googleMapsRequest(url, {
    token,
    projectId,
    fieldMask: "results.location,results.formattedAddress",
  });

  if (status !== 200) {
    return { name, ok: false, detail: formatApiError(status, body) };
  }

  const parsed = JSON.parse(body) as {
    results?: Array<{
      location?: { latitude?: number; longitude?: number };
      formattedAddress?: string;
    }>;
  };

  const result = parsed.results?.[0];
  const lat = result?.location?.latitude;
  const lng = result?.location?.longitude;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return { name, ok: false, detail: "No coordinates returned" };
  }

  return {
    name,
    ok: true,
    detail: `${result?.formattedAddress ?? address} -> ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };
}

async function testGeocodingReverse(
  token: string,
  projectId: string,
): Promise<ApiTestResult> {
  const name = "Geocoding API (reverse geocode)";
  const url =
    "https://geocode.googleapis.com/v4/geocode/location/37.4225508,-122.0846338";

  const { status, body } = await googleMapsRequest(url, {
    token,
    projectId,
    fieldMask: "results.formattedAddress",
  });

  if (status !== 200) {
    return { name, ok: false, detail: formatApiError(status, body) };
  }

  const parsed = JSON.parse(body) as {
    results?: Array<{ formattedAddress?: string }>;
  };
  const formattedAddress = parsed.results?.[0]?.formattedAddress?.trim();

  if (!formattedAddress) {
    return { name, ok: false, detail: "No formatted address returned" };
  }

  return { name, ok: true, detail: formattedAddress };
}

async function testAddressValidation(
  token: string,
  projectId: string,
): Promise<ApiTestResult> {
  const name = "Address Validation API";
  const url = "https://addressvalidation.googleapis.com/v1:validateAddress";

  const { status, body } = await googleMapsRequest(url, {
    token,
    projectId,
    method: "POST",
    body: {
      address: {
        regionCode: "US",
        locality: "Mountain View",
        addressLines: ["1600 Amphitheatre Pkwy"],
      },
    },
  });

  if (status !== 200) {
    return { name, ok: false, detail: formatApiError(status, body) };
  }

  const parsed = JSON.parse(body) as {
    result?: {
      verdict?: { addressComplete?: boolean };
      address?: { formattedAddress?: string };
    };
  };

  const formattedAddress = parsed.result?.address?.formattedAddress?.trim();
  if (!formattedAddress) {
    return { name, ok: false, detail: "No validated address returned" };
  }

  const complete = parsed.result?.verdict?.addressComplete ? "complete" : "partial";
  return {
    name,
    ok: true,
    detail: `${formattedAddress} (${complete})`,
  };
}

async function testPlacesAutocomplete(
  token: string,
  projectId: string,
): Promise<{ result: ApiTestResult; placeId?: string }> {
  const name = "Places API (autocomplete)";
  const url = "https://places.googleapis.com/v1/places:autocomplete";

  const { status, body } = await googleMapsRequest(url, {
    token,
    projectId,
    method: "POST",
    fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
    body: {
      input: "1600 Amphitheatre Parkway Mountain View",
      includedRegionCodes: ["us"],
    },
  });

  if (status !== 200) {
    return {
      result: { name, ok: false, detail: formatApiError(status, body) },
    };
  }

  const parsed = JSON.parse(body) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
      };
    }>;
  };

  const prediction = parsed.suggestions?.[0]?.placePrediction;
  const placeId = prediction?.placeId?.trim();
  const text = prediction?.text?.text?.trim();

  if (!placeId || !text) {
    return {
      result: { name, ok: false, detail: "No autocomplete suggestion returned" },
    };
  }

  return {
    result: { name, ok: true, detail: text },
    placeId,
  };
}

async function testPlacesDetails(
  token: string,
  projectId: string,
  placeId: string,
): Promise<ApiTestResult> {
  const name = "Places API (place details)";
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

  const { status, body } = await googleMapsRequest(url, {
    token,
    projectId,
    fieldMask: "id,formattedAddress,location",
  });

  if (status !== 200) {
    return { name, ok: false, detail: formatApiError(status, body) };
  }

  const parsed = JSON.parse(body) as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  };

  if (!parsed.id || !parsed.formattedAddress) {
    return { name, ok: false, detail: "Missing place details in response" };
  }

  const lat = parsed.location?.latitude;
  const lng = parsed.location?.longitude;
  const coords =
    typeof lat === "number" && typeof lng === "number"
      ? ` @ ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : "";

  return {
    name,
    ok: true,
    detail: `${parsed.formattedAddress}${coords}`,
  };
}

async function main(): Promise<void> {
  const credentials = getServiceAccountCredentials();
  const projectId = credentials.project_id?.trim();

  if (!projectId) {
    throw new Error("Service account JSON is missing project_id.");
  }

  console.log("Google Maps API connectivity test");
  console.log(`Service account: ${credentials.client_email}`);
  console.log(`Project ID: ${projectId}`);
  console.log("");

  const token = await getAccessToken(credentials);
  console.log("OAuth access token acquired.\n");

  const results: ApiTestResult[] = [];

  results.push(await testGeocodingZipToState(token, projectId));
  results.push(await testGeocodingAddressToLatLng(token, projectId));
  results.push(await testGeocodingReverse(token, projectId));
  results.push(await testAddressValidation(token, projectId));

  const autocomplete = await testPlacesAutocomplete(token, projectId);
  results.push(autocomplete.result);

  if (autocomplete.placeId) {
    results.push(
      await testPlacesDetails(token, projectId, autocomplete.placeId),
    );
  } else {
    results.push({
      name: "Places API (place details)",
      ok: false,
      detail: "Skipped because autocomplete did not return a place ID",
    });
  }

  let failures = 0;
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`${status}  ${result.name}`);
    console.log(`      ${result.detail}`);
    if (!result.ok) {
      failures += 1;
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} test(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log("All Google Maps API checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
