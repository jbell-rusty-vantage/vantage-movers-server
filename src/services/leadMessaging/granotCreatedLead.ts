import {
  getLeadMessagingMode,
  isGranotLeadCreatedSmsEnabled,
  type LeadMessagingMode,
  type OutboundSmsConsentBasis,
} from "../../config/domain";
import { logger } from "../../logger";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { isObjectIdString } from "../../utils/objectId";
import type { GranotLeadCreatedPolicy } from "../granotLifecycle/types";
import {
  dispatchOrQueuePersistedLeadMessage,
  persistLeadMessageIntent,
} from "./leadMessaging.service";

export const GRANOT_LEAD_CREATED_SMS_OPT_OUT = "Reply STOP to opt out.";
export const GRANOT_LEAD_CREATED_SMS_MESSAGE_KEY = "granot_lead_created_confirmation";
export const DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE =
  "Hi {first_name}, this is Vantage Movers. We got your request and we'll call you shortly to go over your move.";

const ALLOWED_PLACEHOLDERS = new Set(["first_name", "company"]);

export type GranotSmsGate =
  | "messaging_mode_enabled"
  | "granot_sms_flag"
  | "source_policy_create_if_missing"
  | "lead_source_sms_enabled"
  | "consent_basis_recorded"
  | "destination_and_capacity";

export type GranotSmsEvaluation = {
  evaluated_gates: Array<{ gate: GranotSmsGate; allowed: boolean }>;
  allowed: boolean;
  blocked_reason: GranotSmsGate | null;
};

export type GranotCreatedLeadSmsInput = {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  observation_id: string;
  lead_source_company_id: string;
  granot_crm_source_id: string;
  destination_phone?: string;
  first_name?: string;
};

export function evaluateGranotLeadSmsGates(facts: {
  messaging_mode: LeadMessagingMode;
  granot_sms_flag: boolean;
  lead_created_policy: GranotLeadCreatedPolicy;
  outbound_sms_enabled: boolean;
  consent_basis: OutboundSmsConsentBasis;
  destination: string | null;
}): GranotSmsEvaluation {
  const evaluated_gates: GranotSmsEvaluation["evaluated_gates"] = [
    {
      gate: "messaging_mode_enabled",
      allowed: facts.messaging_mode !== "disabled",
    },
    {
      gate: "granot_sms_flag",
      allowed: facts.granot_sms_flag === true,
    },
    {
      gate: "source_policy_create_if_missing",
      allowed: facts.lead_created_policy === "create_if_missing",
    },
    {
      gate: "lead_source_sms_enabled",
      allowed: facts.outbound_sms_enabled === true,
    },
    {
      gate: "consent_basis_recorded",
      allowed: facts.consent_basis !== "not_attested",
    },
    {
      gate: "destination_and_capacity",
      allowed: Boolean(facts.destination?.trim()),
    },
  ];
  const blocked = evaluated_gates.find((gate) => !gate.allowed) ?? null;
  return {
    evaluated_gates,
    allowed: blocked === null,
    blocked_reason: blocked?.gate ?? null,
  };
}

export function renderGranotLeadSmsBody(input: {
  template: string;
  first_name?: string;
  lead_source_name: string;
}): string {
  const firstName = input.first_name?.trim() || "there";
  const rendered = input.template
    .replaceAll("{first_name}", firstName)
    .replaceAll("{company}", input.lead_source_name);
  const withoutOptOut = rendered
    .replace(/\s*Reply STOP to opt out\.?/gi, "")
    .trimEnd();
  return `${withoutOptOut} ${GRANOT_LEAD_CREATED_SMS_OPT_OUT}`;
}

export function unknownOutboundSmsPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([a-z_]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => name && !ALLOWED_PLACEHOLDERS.has(name));
}

export async function sendGranotCreatedLeadConfirmation(
  input: GranotCreatedLeadSmsInput,
  dependencies: {
    persist?: typeof persistLeadMessageIntent;
    dispatch?: typeof dispatchOrQueuePersistedLeadMessage;
    messagingMode?: LeadMessagingMode;
    granotSmsFlag?: boolean;
    now?: Date;
    loadContext?: () => Promise<{
      lead_created_policy: GranotLeadCreatedPolicy;
      outbound_sms?: {
        enabled?: boolean;
        consent_basis?: OutboundSmsConsentBasis;
        body_template?: string;
        template_version?: number;
      };
      company_name: string;
    } | null>;
  } = {},
): Promise<{ message_id: string | null; status: string }> {
  try {
    if (
      !isObjectIdString(input.observation_id) ||
      !isObjectIdString(input.lead_source_company_id) ||
      !isObjectIdString(input.granot_crm_source_id) ||
      !isObjectIdString(input.lead_ref.id)
    ) {
      return { message_id: null, status: "blocked:invalid_refs" };
    }

    const loaded = dependencies.loadContext
      ? await dependencies.loadContext()
      : await loadSendContext(input);
    const outbound = loaded?.outbound_sms;
    const evaluation = evaluateGranotLeadSmsGates({
      messaging_mode: dependencies.messagingMode ?? getLeadMessagingMode(),
      granot_sms_flag:
        dependencies.granotSmsFlag ?? isGranotLeadCreatedSmsEnabled(),
      lead_created_policy: loaded?.lead_created_policy ?? "observation_only",
      outbound_sms_enabled: outbound?.enabled === true,
      consent_basis: outbound?.consent_basis ?? "not_attested",
      destination: input.destination_phone?.trim() || null,
    });
    if (!evaluation.allowed) {
      logger.info({
        msg: "lead_messaging.granot_created.blocked",
        observationId: input.observation_id,
        blockedReason: evaluation.blocked_reason,
        leadModel: input.lead_ref.model,
      });
      return {
        message_id: null,
        status: `blocked:${evaluation.blocked_reason}`,
      };
    }

    const template =
      outbound?.body_template?.trim() || DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE;
    const body = renderGranotLeadSmsBody({
      template,
      first_name: input.first_name,
      lead_source_name: loaded?.company_name?.trim() || "Vantage Movers",
    });
    const persist = dependencies.persist ?? persistLeadMessageIntent;
    const message = await persist({
      lead_ref: input.lead_ref,
      destinationPhone: input.destination_phone!,
      body,
      purpose: "granot_lead_created_confirmation",
      message_key: GRANOT_LEAD_CREATED_SMS_MESSAGE_KEY,
      template_version: outbound?.template_version ?? 1,
      origin: "granot_lead_created",
      consent_basis:
        outbound?.consent_basis === "customer_submitted_form" ||
        outbound?.consent_basis === "existing_relationship"
          ? outbound.consent_basis
          : "existing_relationship",
      observation_id: input.observation_id,
      lead_source_company: input.lead_source_company_id,
      granot_crm_source: input.granot_crm_source_id,
      testMode: false,
    });
    const dispatch = dependencies.dispatch ?? dispatchOrQueuePersistedLeadMessage;
    return await dispatch(message);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      logger.info({
        msg: "lead_messaging.granot_created.already_sent",
        observationId: input.observation_id,
      });
      return { message_id: null, status: "already_sent" };
    }
    logger.error({
      err: error,
      msg: "lead_messaging.granot_created.failed",
      observationId: input.observation_id,
      granotCrmSourceId: input.granot_crm_source_id,
    });
    return { message_id: null, status: "failed" };
  }
}

async function loadSendContext(input: GranotCreatedLeadSmsInput): Promise<{
  lead_created_policy: GranotLeadCreatedPolicy;
  outbound_sms?: {
    enabled?: boolean;
    consent_basis?: OutboundSmsConsentBasis;
    body_template?: string;
    template_version?: number;
  };
  company_name: string;
} | null> {
  const [crmSource, company] = await Promise.all([
    getGranotCrmSourceModel().findById(input.granot_crm_source_id).lean().exec(),
    getLeadSourceCompanyModel().findById(input.lead_source_company_id).lean().exec(),
  ]);
  if (!crmSource) return null;
  return {
    lead_created_policy: crmSource.lead_created_policy,
    outbound_sms: crmSource.outbound_sms
      ? {
          enabled: crmSource.outbound_sms.enabled,
          consent_basis: crmSource.outbound_sms.consent_basis,
          body_template: crmSource.outbound_sms.body_template ?? undefined,
          template_version: crmSource.outbound_sms.template_version,
        }
      : undefined,
    company_name: company?.name?.trim() || company?.owner_label?.trim() || "Vantage Movers",
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}
