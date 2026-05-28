/**
 * Compatibility re-export facade for the Granot CRM integration.
 *
 * The implementation now lives under `./crm/` (split per refactor plan
 * 11: `crmConfig`, `formLeadPayload`, `crm.service`, `types`, `index`).
 * This file keeps the historical `import { ... } from "../crm.service"`
 * paths working while in-flight branches and external callers migrate
 * to `import { ... } from "../crm"`.
 *
 * New code should import directly from `./crm`.
 */

export {
  CRM_FORM_LEAD_ENDPOINT,
  CRM_FORM_LEAD_LABEL,
  buildCrmFormLeadPayload,
  formatCrmMoveDate,
  splitNameForCrm,
  submitFormLeadToCrm,
} from "./crm";

export type { CrmFormLeadPayload, CrmSubmitResult } from "./crm";
