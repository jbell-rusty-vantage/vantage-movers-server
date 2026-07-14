import { getGoogleStateCodeForZip } from "../../services/googleMaps/geocoding";
import { stateNameToCode } from "./stateNamesToCodes";

type ZippopotamusPlace = {
  state?: string;
  "state abbreviation"?: string;
};

type ZippopotamusZipResponse = {
  places?: ZippopotamusPlace[];
};

export async function getStateCodeForZip(zipCode: string): Promise<string | undefined> {
  const zip = zipCode.trim();
  if (!/^\d{5}$/.test(zip)) {
    return undefined;
  }

  const googleStateCode = await getGoogleStateCodeForZip(zip);
  if (googleStateCode) {
    return googleStateCode;
  }

  return getZippopotamusStateCodeForZip(zip);
}

async function getZippopotamusStateCodeForZip(
  zipCode: string,
): Promise<string | undefined> {
  const zip = zipCode.trim();
  if (!/^\d{5}$/.test(zip)) {
    return undefined;
  }

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as ZippopotamusZipResponse;
    const place = data.places?.[0];
    const stateCodeFromName = place?.state
      ? (stateNameToCode(place.state) ?? undefined)
      : undefined;
    if (stateCodeFromName) {
      return stateCodeFromName;
    }

    const stateCode = place?.["state abbreviation"]?.trim().toUpperCase();
    if (stateCode) {
      return stateCode;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function getStateCodeForPickupZip(pickupZip: string): Promise<string | undefined> {
  return getStateCodeForZip(pickupZip);
}
