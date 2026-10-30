import type { GranotCollectorCredentials } from "./index";

/** The same two-stage login bindings for automation and job navigation. Never serialize these. */
export function readGranotCredentials(): GranotCollectorCredentials {
  const value = (primary: string, legacy: string) => {
    const result = process.env[primary]?.trim() || process.env[legacy]?.trim();
    if (!result) throw new Error("Granot credentials unavailable");
    return result;
  };
  return {
    networkUsername: value("GRANOT_NETWORK_USERNAME", "MAIN_LOGIN_USERNAME"),
    networkPassword: value("GRANOT_NETWORK_PASSWORD", "MAIN_LOGIN_PASSWORD"),
    username: value("GRANOT_USERNAME", "SPECIFIC_USERNAME"),
    password: value("GRANOT_PASSWORD", "SPECIFIC_PASSWORD"),
  };
}
