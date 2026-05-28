import type { FormLeadDocument } from "../../models/FormLead";
import { logger } from "../../logger";
import {
  CRM_FORM_LEAD_ENDPOINT,
  crmEndpointForLog,
} from "./crmConfig";
import {
  buildCrmFormLeadPayload,
  encodeCrmFormBody,
  summarizeCrmPayloadForLog,
} from "./formLeadPayload";
import type { CrmFormLeadPayload, CrmSubmitResult } from "./types";

/**
 * Submits a `FormLead` to the Granot CRM lead gateway.
 *
 * Behavior preserved from the original `crm.service.ts`:
 *   - Always returns a `CrmSubmitResult` (never throws).
 *   - On network errors, sets `ok: false`, `status: 0`, `error` to the
 *     error message, and returns the constructed payload so callers
 *     can still persist what was attempted.
 *   - On HTTP errors (4xx/5xx), sets `ok: false` and returns the
 *     `responseText` from Granot for audit.
 *
 * Logging notes (Vercel-safe):
 *   - The endpoint URL has CRM credentials in its query string; we
 *     log only `crmEndpointForLog()` which redacts them.
 *   - The CRM payload contains customer PII (name/email/phone); we
 *     log only `summarizeCrmPayloadForLog()` which masks it.
 */
export async function submitFormLeadToCrm(
  lead: FormLeadDocument,
  options: { companyLabel?: string } = {},
): Promise<CrmSubmitResult> {
  const payload: CrmFormLeadPayload = buildCrmFormLeadPayload(
    lead,
    options.companyLabel,
  );
  const leadId = lead._id.toString();
  const payloadSummary = summarizeCrmPayloadForLog(payload);
  const safeEndpoint = crmEndpointForLog();

  logger.info({
    msg: "crm.form_lead.submit.started",
    leadId,
    endpoint: safeEndpoint,
    payload: payloadSummary,
  });

  try {
    const response = await fetch(CRM_FORM_LEAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeCrmFormBody(payload),
    });

    const responseText = await response.text();
    const ok = response.ok;

    logger.info({
      msg: ok
        ? "crm.form_lead.submit.completed"
        : "crm.form_lead.submit.http_error",
      leadId,
      endpoint: safeEndpoint,
      status: response.status,
      responseText,
    });

    return {
      ok,
      status: response.status,
      responseText,
      payload,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CRM error";
    logger.error(
      {
        err: error,
        msg: "crm.form_lead.submit.failed",
        leadId,
        endpoint: safeEndpoint,
      },
      "CRM form lead submission failed",
    );

    return {
      ok: false,
      status: 0,
      responseText: "",
      payload,
      error: message,
    };
  }
}
