/**
 * Narrow public surface for the Granot CRM integration.
 *
 * Re-exports every symbol the legacy `api/services/crm.service.ts`
 * facade exposed so callers can switch their imports from
 * `"../crm.service"` to `"../crm"` without changes to call sites.
 *
 * Internal helpers (`encodeCrmFormBody`, `crmEndpointForLog`, env-var
 * name constants) are intentionally re-exported as well; tests and
 * downstream observability code may want them.
 */

export {
  CRM_API_ID_ENV_VAR,
  CRM_FORM_LEAD_ENDPOINT,
  CRM_FORM_LEAD_LABEL,
  CRM_MOVER_REF_ENV_VAR,
  crmEndpointForLog,
} from "./crmConfig";

export {
  buildCrmFormLeadPayload,
  encodeCrmFormBody,
  formatCrmMoveDate,
  splitNameForCrm,
  summarizeCrmPayloadForLog,
} from "./formLeadPayload";

export { submitFormLeadToCrm } from "./crm.service";

export type { CrmFormLeadPayload, CrmSubmitResult } from "./types";
