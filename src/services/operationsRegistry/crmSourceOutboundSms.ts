import {
  DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
  unknownOutboundSmsPlaceholders,
} from "../leadMessaging/granotCreatedLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadMessageModel } from "../../models/LeadMessage";
import type { OutboundSmsConsentBasis } from "../../config/domain";
import { maskContactLabel } from "../granotLifecycle/projections";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { isObjectIdString } from "../../utils/objectId";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import { GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS } from "./granotCrmSourceCache";
import { RegistryError } from "./errors";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type OutboundSmsCommand = {
  granot_crm_source_id: string;
  enabled: boolean;
  body_template: string;
  consent_basis: OutboundSmsConsentBasis;
  reason: string;
};

export type OwnerOutboundSmsView = {
  granot_crm_source_id: string;
  enabled: boolean;
  trigger: "granot_lead_created";
  body_template: string;
  template_version: number;
  consent_basis: OutboundSmsConsentBasis;
  consent_attested_by?: {
    actor_type?: string;
    actor_id?: string;
    actor_label?: string;
    actor_role?: string;
  };
  consent_attested_at?: string;
  activated_at?: string;
  deactivated_at?: string;
  deactivation_reason?: string;
};

export type RecentOutboundSmsRow = {
  id: string;
  sent_at: string | null;
  status: string;
  provider_status: string | null;
  destination_masked: string;
  purpose: string;
  template_version: number | null;
};

export async function setGranotCrmSourceOutboundSms(
  command: OutboundSmsCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<OwnerOutboundSmsView> {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
  const reason = command.reason.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw invalid("An explicit reason of 10 to 1000 characters is required.");
  }
  if (!isObjectIdString(command.granot_crm_source_id)) {
    throw invalid("granot_crm_source_id must be a valid ObjectId.");
  }
  const template = command.body_template.trim();
  if (!template) {
    throw invalid("The text template cannot be empty.");
  }
  if (template.length > 320) {
    throw invalid("The text template cannot exceed 320 characters.");
  }
  const unknown = unknownOutboundSmsPlaceholders(template);
  if (unknown.length > 0) {
    throw invalid(
      `The template can only use {first_name} and {company}. Unknown: ${unknown.join(", ")}.`,
    );
  }
  if (command.enabled && command.consent_basis === "not_attested") {
    throw invalid("Texting stays off until a consent basis is recorded.");
  }

  const Source = getGranotCrmSourceModel();
  const audit: RegistryAuditInput = {
    entityType: "granot_crm_source_sms_policy",
    entityId: command.granot_crm_source_id,
    action: command.enabled ? "activate" : "update",
    reason,
  };
  return withRegistryMutation(
    {
      actor,
      audit,
      invalidateKeys: [...GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS],
      mutate: async (session) => {
        const before = await Source.findById(command.granot_crm_source_id)
          .session(session)
          .lean()
          .exec();
        if (!before) {
          throw new RegistryError("Granot CRM source not found.", {
            registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
          });
        }
        if (command.enabled && before.lead_created_policy !== "create_if_missing") {
          throw new RegistryError(
            "This Granot name does not create leads yet, so there is nothing to text about.",
            {
              registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
              statusCode: 400,
              remediation: {
                summary:
                  "Set this Granot name to match it, and create the lead if we don't have it, then turn texting on.",
                action: "open_granot_names",
              },
            },
          );
        }
        if (command.enabled && before.enabled === false) {
          throw invalid("An inactive Granot name cannot send texts.");
        }

        const previous = toSmsView(String(before._id), before.outbound_sms);
        const templateChanged = previous.body_template !== template;
        const basisReverted =
          command.consent_basis === "not_attested" &&
          previous.consent_basis !== "not_attested";
        const enabled = command.enabled && !templateChanged && !basisReverted;
        const now = new Date();
        const basisChanged =
          command.consent_basis !== previous.consent_basis &&
          command.consent_basis !== "not_attested";
        const outbound_sms = {
          enabled,
          trigger: "granot_lead_created" as const,
          body_template: template,
          template_version: templateChanged
            ? previous.template_version + 1
            : previous.template_version,
          consent_basis: command.consent_basis,
          consent_attested_by: basisChanged
            ? {
                actor_type: actor.actorType,
                actor_id: actor.actorId,
                actor_label: actor.actorLabel,
                actor_role: actor.actorRole,
              }
            : previous.consent_attested_by,
          consent_attested_at: basisChanged
            ? now
            : previous.consent_attested_at
              ? new Date(previous.consent_attested_at)
              : undefined,
          daily_cap:
            typeof (before.outbound_sms as { daily_cap?: number } | undefined)
              ?.daily_cap === "number"
              ? (before.outbound_sms as { daily_cap: number }).daily_cap
              : 0,
          activated_at: enabled
            ? previous.activated_at
              ? new Date(previous.activated_at)
              : now
            : previous.activated_at
              ? new Date(previous.activated_at)
              : undefined,
          deactivated_at: enabled ? undefined : now,
          deactivation_reason: enabled
            ? undefined
            : basisReverted
              ? "consent_basis_reverted"
              : templateChanged
                ? "template_changed"
                : "owner_disabled",
        };

        const after = await Source.findByIdAndUpdate(
          command.granot_crm_source_id,
          { $set: { outbound_sms } },
          { session, returnDocument: "after", runValidators: true },
        ).orFail();
        const view = toSmsView(String(after._id), after.outbound_sms);
        audit.before = { ...previous };
        audit.after = { ...view };
        return view;
      },
    },
    deps,
  );
}

export async function listRecentGranotCrmSourceSms(input: {
  granot_crm_source_id: string;
  limit?: number;
}): Promise<RecentOutboundSmsRow[]> {
  if (!isObjectIdString(input.granot_crm_source_id)) {
    throw invalid("granot_crm_source_id must be a valid ObjectId.");
  }
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const rows = await getLeadMessageModel()
    .find({ granot_crm_source: input.granot_crm_source_id })
    .select({
      sent_at: 1,
      accepted_at: 1,
      createdAt: 1,
      status: 1,
      provider_status: 1,
      to: 1,
      purpose: 1,
      source_template_version: 1,
      template_version: 1,
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    sent_at:
      row.sent_at instanceof Date
        ? row.sent_at.toISOString()
        : row.accepted_at instanceof Date
          ? row.accepted_at.toISOString()
          : row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : null,
    status: String(row.status),
    provider_status: row.provider_status ?? null,
    destination_masked: maskContactLabel({ phone_number: row.to }),
    purpose: String(row.purpose),
    template_version: row.source_template_version ?? row.template_version ?? null,
  }));
}

export function toSmsView(
  sourceId: string,
  value: unknown,
): OwnerOutboundSmsView {
  const row =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const attested =
    row.consent_attested_by && typeof row.consent_attested_by === "object"
      ? (row.consent_attested_by as Record<string, unknown>)
      : undefined;
  return {
    granot_crm_source_id: sourceId,
    enabled: row.enabled === true,
    trigger: "granot_lead_created",
    body_template:
      typeof row.body_template === "string" && row.body_template.trim()
        ? row.body_template
        : DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
    template_version:
      typeof row.template_version === "number" && row.template_version > 0
        ? row.template_version
        : 1,
    consent_basis:
      row.consent_basis === "customer_submitted_form" ||
      row.consent_basis === "existing_relationship"
        ? row.consent_basis
        : "not_attested",
    ...(attested
      ? {
          consent_attested_by: {
            actor_type: stringValue(attested.actor_type),
            actor_id: stringValue(attested.actor_id),
            actor_label: stringValue(attested.actor_label),
            actor_role: stringValue(attested.actor_role),
          },
        }
      : {}),
    ...(row.consent_attested_at
      ? { consent_attested_at: new Date(String(row.consent_attested_at)).toISOString() }
      : {}),
    ...(row.activated_at
      ? { activated_at: new Date(String(row.activated_at)).toISOString() }
      : {}),
    ...(row.deactivated_at
      ? { deactivated_at: new Date(String(row.deactivated_at)).toISOString() }
      : {}),
    ...(typeof row.deactivation_reason === "string" && row.deactivation_reason
      ? { deactivation_reason: row.deactivation_reason }
      : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}
