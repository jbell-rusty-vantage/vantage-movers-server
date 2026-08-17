import { GranotAutomationSource } from "../../models/GranotAutomationSource";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { toObjectId } from "../../utils/objectId";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "./errors";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import { GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS } from "./granotCrmSourceCache";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type GranotAutomationSourceReferenceCommand = {
  id: string;
  granot_crm_source: string;
  reason: string;
};

export async function setGranotAutomationSourceReference(
  command: GranotAutomationSourceReferenceCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<{ id: string; granot_crm_source: string }> {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
  const reason = command.reason.trim();
  if (!reason) {
    throw new RegistryError(
      "An explicit reason is required for Granot automation source reference changes.",
      { registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT, statusCode: 400 },
    );
  }
  const audit: RegistryAuditInput = {
    entityType: "granot_automation_source",
    entityId: command.id,
    action: "update",
    reason,
  };
  return withRegistryMutation(
    {
      actor,
      audit,
      invalidateKeys: [...GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS],
      mutate: async (session) => {
        const current = await GranotAutomationSource.findById(command.id)
          .session(session)
          .lean()
          .exec();
        if (!current) {
          throw new RegistryError("Granot automation source not found.", {
            registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
          });
        }
        const referenced = await getGranotCrmSourceModel()
          .findById(command.granot_crm_source)
          .session(session)
          .select({ _id: 1 })
          .lean()
          .exec();
        if (!referenced) {
          throw new RegistryError("Granot CRM source not found.", {
            registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
          });
        }
        const nextId = String(referenced._id);
        const beforeId = current.granot_crm_source
          ? String(current.granot_crm_source)
          : null;
        if (beforeId === nextId) {
          audit.before = { granot_crm_source: beforeId };
          audit.after = { granot_crm_source: nextId };
          return { id: command.id, granot_crm_source: nextId };
        }
        await GranotAutomationSource.updateOne(
          { _id: current._id },
          { $set: { granot_crm_source: toObjectId(nextId) } },
          { session },
        ).exec();
        audit.before = { granot_crm_source: beforeId };
        audit.after = { granot_crm_source: nextId };
        audit.metadata = { request_id: actor.requestId, reason };
        return { id: command.id, granot_crm_source: nextId };
      },
    },
    deps,
  );
}
