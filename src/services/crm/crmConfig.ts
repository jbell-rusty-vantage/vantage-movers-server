import "dotenv/config";

/**
 * Granot CRM endpoint construction and form-lead config constants.
 *
 * Reads `CRM_API_ID` and `CRM_MOVER_REF` from `process.env` at module
 * load time (matching the original `crm.service.ts` behavior so importers
 * keep the same initialization semantics on Vercel cold start).
 *
 * The endpoint URL embeds those two env values as query parameters; both
 * are credentials and must never be written to logs. Use
 * `crmEndpointForLog()` whenever an operational log line needs to show
 * which endpoint was called.
 */

export const CRM_API_ID_ENV_VAR = "CRM_API_ID" as const;
export const CRM_MOVER_REF_ENV_VAR = "CRM_MOVER_REF" as const;

const API_ID = process.env[CRM_API_ID_ENV_VAR];
const MOVER_REF = process.env[CRM_MOVER_REF_ENV_VAR];

/**
 * Full Granot lead gateway endpoint, including the API_ID/MOVERREF query
 * parameters. Exposed for compatibility with the historical
 * `crm.service.ts` export; production code should prefer to read it
 * once at the top of `submitFormLeadToCrm` and never put this value into
 * a log line.
 */
export const CRM_FORM_LEAD_ENDPOINT = `https://lead.hellomoving.com/LEADSGWHTTP.lidgw?&API_ID=${API_ID}&MOVERREF=${MOVER_REF}`;

/**
 * Default Granot CRM `label` value (the company-facing source label).
 * Used whenever the create-form-lead request does not provide
 * `crm_company_label` or provides a blank one.
 */
export const CRM_FORM_LEAD_LABEL = "Main Site Forms" as const;

/**
 * Returns the CRM endpoint with its `API_ID` and `MOVERREF` query
 * parameter values replaced by `[redacted]`. Use this in any log line
 * that needs to surface which gateway was contacted without leaking
 * the credentials embedded in the URL.
 */
export function crmEndpointForLog(
  endpoint: string = CRM_FORM_LEAD_ENDPOINT,
): string {
  return endpoint
    .replace(/API_ID=[^&]*/i, "API_ID=[redacted]")
    .replace(/MOVERREF=[^&]*/i, "MOVERREF=[redacted]");
}
