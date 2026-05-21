import type { FormLeadDocument } from "../models/FormLead";
import { generateLeadId } from "../utils/ids";
import { logger } from "../logger";
import "dotenv/config";

const API_ID = process.env.CRM_API_ID;
const MOVER_REF = process.env.CRM_MOVER_REF;

export const CRM_FORM_LEAD_ENDPOINT = `https://lead.hellomoving.com/LEADSGWHTTP.lidgw?&API_ID=${API_ID}&MOVERREF=${MOVER_REF}`;

export const CRM_FORM_LEAD_LABEL = "Get Movers";

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

export type CrmSubmitResult = {
  ok: boolean;
  status: number;
  responseText: string;
  payload: CrmFormLeadPayload;
  error?: string;
};

export function splitNameForCrm(name: string): {
  firstname: string;
  lastname: string;
} {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstname: "", lastname: "" };
  }

  if (parts.length === 1) {
    return { firstname: parts[0], lastname: parts[0] };
  }

  return {
    firstname: parts[0],
    lastname: parts[parts.length - 1],
  };
}

export function formatCrmMoveDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function buildCrmFormLeadPayload(
  lead: FormLeadDocument,
  companyLabel: string = CRM_FORM_LEAD_LABEL,
): CrmFormLeadPayload {
  const { firstname, lastname } = splitNameForCrm(lead.name);

  return {
    label: companyLabel.trim() || CRM_FORM_LEAD_LABEL,
    firstname,
    lastname,
    ozip: lead.pickup_zip,
    dzip: lead.destination_zip,
    email: lead.email ?? "",
    phone1: lead.phone_number,
    movesize: lead.move_size,
    movedte: formatCrmMoveDate(lead.move_date),
    notes: lead.lid?.trim() || generateLeadId(),
    leadno: lead._id.toString(),
  };
}

function encodeFormBody(payload: CrmFormLeadPayload): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    params.set(key, value);
  }

  return params.toString();
}

export async function submitFormLeadToCrm(
  lead: FormLeadDocument,
  options: { companyLabel?: string } = {},
): Promise<CrmSubmitResult> {
  const payload = buildCrmFormLeadPayload(lead, options.companyLabel);
  const leadId = lead._id.toString();

  logger.info({
    msg: "crm.form_lead.submit.started",
    leadId,
    endpoint: CRM_FORM_LEAD_ENDPOINT,
    payload,
  });

  try {
    const response = await fetch(CRM_FORM_LEAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeFormBody(payload),
    });

    const responseText = await response.text();
    const ok = response.ok;

    logger.info({
      msg: ok
        ? "crm.form_lead.submit.completed"
        : "crm.form_lead.submit.http_error",
      leadId,
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
