import type { GranotCollectorCredentials } from "./index";

function value(primary: string, legacy: string): string {
  const result = process.env[primary]?.trim() || process.env[legacy]?.trim();
  if (!result) throw new Error("Granot credentials unavailable");
  return result;
}

/** Network-only navigation must not require or read the automation user's credentials. */
export function readGranotNetworkCredentials(): Pick<GranotCollectorCredentials, "networkUsername" | "networkPassword"> {
  return {
    networkUsername: value("GRANOT_NETWORK_USERNAME", "MAIN_LOGIN_USERNAME"),
    networkPassword: value("GRANOT_NETWORK_PASSWORD", "MAIN_LOGIN_PASSWORD"),
  };
}

/** The existing two-stage automation login bindings. Never serialize these. */
export function readGranotCredentials(): GranotCollectorCredentials {
  return { ...readGranotNetworkCredentials(), username: value("GRANOT_USERNAME", "SPECIFIC_USERNAME"), password: value("GRANOT_PASSWORD", "SPECIFIC_PASSWORD") };
}
