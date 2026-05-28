/**
 * Shared input/output types for the Granot CRM form-lead submission flow.
 *
 * These types are intentionally close to the wire shape Granot expects so
 * `formLeadPayload.ts` can build them directly and `crm.service.ts` can
 * send them without further transformation.
 *
 * Field naming preserves the historical Granot vocabulary (`ozip`, `dzip`,
 * `movedte`, `leadno`) -- do NOT rename without coordinating with the
 * Granot Hello Moving lead gateway and the form-lead Cursor rule
 * (`.cursor/rules/form-lead-granot-crm.mdc`).
 */
export type CrmFormLeadPayload = {
  label: string;
  firstname: string;
  lastname: string;
  ozip: string;
  dzip: string;
  email: string;
  phone1: string;
  movesize: string;
  movedte: string;
  notes: string;
  leadno: string;
};

/**
 * Result returned by `submitFormLeadToCrm`.
 *
 * `payload` is the exact body that was (or would have been) sent to
 * Granot. Callers store it on the FormLead audit response so the
 * Mongo record reflects what Granot received.
 */
export type CrmSubmitResult = {
  ok: boolean;
  status: number;
  responseText: string;
  payload: CrmFormLeadPayload;
  error?: string;
};
