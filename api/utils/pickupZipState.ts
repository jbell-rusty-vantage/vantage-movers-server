import { stateNameToCode } from "./stateNamesToCodes";

type ZippopotamusPlace = {
  state?: string;
  "state abbreviation"?: string;
};

type ZippopotamusZipResponse = {
  places?: ZippopotamusPlace[];
};

export async function getStateCodeForPickupZip(pickupZip: string): Promise<string | undefined> {
  const zip = pickupZip.trim();
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
    const stateCode = place?.["state abbreviation"]?.trim().toUpperCase();
    if (stateCode) {
      return stateCode;
    }

    return place?.state ? (stateNameToCode(place.state) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}
