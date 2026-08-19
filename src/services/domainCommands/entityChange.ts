import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import {
  DELETED_ENTITY_CHANGE_PATH,
  EntityChange,
  getEntityChangeModel,
  type EntityChangeField,
  type EntityChangeSourceSystem,
} from "../../models/EntityChange";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { isObjectIdString, toObjectId } from "../../utils/objectId";
import type { EntityRef } from "../granotLifecycle/types";
import type { CanonicalCommandContext, CommandOrigin } from "./types";

const CONTACT_OR_ADDRESS_PATH =
  /(^|\.)(name|first_name|last_name|display_name|phone|phone_number|normalized_phone_number|email|normalized_email|customer_name|customer_phone|customer_email|address|street|city|zip|pickup_zip|destination_zip|pickup_city|delivery_city|pickup_state|delivery_state|origin|destination)(\.|$)/i;

const STORED_PATHS = new Set([
  "quoted",
  "priority",
  "granot_priority",
  "granot_move_size",
  "granot_service_type",
  "cubic_feet",
  "est_cf",
  "receiver_agent",
  "receiver_agent_name_snapshot",
  "receiver_agent_source",
  "receiver_agent_source_value",
  "receiver_agent_set_at",
  "agent_allocations",
  "booked",
  "cancelled",
  "booked_lead",
  "lead_ref",
  "lead_model",
  "source_scope",
  "disputed",
  "dispute_reason",
  "last_observation_id",
  "last_observed_at",
  "deposit_amount",
  "total_binder_amount",
  "refund_amount",
  "book_date",
  "cancel_date",
  "move_date",
  "timestamp",
  "job_no",
  "normalized_job_no",
  "merchant",
  "duplicate",
  "bad_lead",
  "form_fill",
  "post_to_granot",
  "local",
  "source_company",
  "lead_source_company",
  "source_granularity_id",
  "source_granularity_key",
  "ingestion_origin",
  "cpl",
  "cpl_resolution_status",
  "cpl_rate_period",
  "cpl_resolution_version",
  "cpl_resolved_at",
  "lid",
  "ref_no",
  "is_referral_booking",
  "is_leadless_booking",
  "over_2000",
  "over_4000",
  "source",
  "move_size",
]);

export const FORM_LEAD_CHANGE_PATHS = [
  "quoted",
  "cubic_feet",
  "name",
  "first_name",
  "last_name",
  "phone_number",
  "normalized_phone_number",
  "email",
  "job_no",
  "normalized_job_no",
  "pickup_zip",
  "destination_zip",
  "pickup_city",
  "delivery_city",
  "pickup_state",
  "delivery_state",
  "move_date",
  "move_size",
  "timestamp",
  "local",
  "source_company",
  "lead_source_company",
  "source_granularity_id",
  "source_granularity_key",
  "source_company_label_snapshot",
  "source_granularity_label_snapshot",
  "crm_source_label_snapshot",
  "ingestion_origin",
  "ingested_contact_snapshot",
  "ingested_move_snapshot",
  "cpl",
  "cpl_rate_period",
  "cpl_resolution_status",
  "cpl_resolution_version",
  "cpl_resolved_at",
  "lid",
  "ref_no",
  "duplicate",
  "bad_lead",
  "post_to_granot",
  "booked",
  "cancelled",
  "receiver_agent",
  "receiver_agent_name_snapshot",
  "receiver_agent_source",
  "receiver_agent_source_value",
  "receiver_agent_set_at",
  "granot_priority",
  "granot_contact_snapshot",
  "granot_move_size",
  "granot_service_type",
  "current_contact_provenance",
  "current_move_provenance",
  "last_accepted_granot_observation",
  "granot_contact_revision",
  "last_granot_contact_change",
  "over_2000",
  "over_4000",
] as const;

export const CALL_LEAD_CHANGE_PATHS = [
  "quoted",
  "cubic_feet",
  "name",
  "first_name",
  "last_name",
  "phone_number",
  "normalized_phone_number",
  "email",
  "job_no",
  "normalized_job_no",
  "form_fill",
  "post_to_granot",
  "duplicate",
  "booked",
  "cancelled",
  "local",
  "source_company",
  "lead_source_company",
  "source_granularity_id",
  "source_granularity_key",
  "source_company_label_snapshot",
  "source_granularity_label_snapshot",
  "crm_source_label_snapshot",
  "ingestion_origin",
  "ingested_contact_snapshot",
  "cpl",
  "cpl_rate_period",
  "cpl_resolution_status",
  "cpl_resolution_version",
  "cpl_resolved_at",
  "timestamp",
  "receiver_agent",
  "receiver_agent_name_snapshot",
  "receiver_agent_source",
  "receiver_agent_source_value",
  "receiver_agent_set_at",
  "pickup_city",
  "pickup_zip",
  "pickup_state",
  "delivery_city",
  "delivery_zip",
  "delivery_state",
  "move_date",
  "granot_priority",
  "granot_contact_snapshot",
  "granot_move_size",
  "granot_service_type",
  "current_contact_provenance",
  "current_move_provenance",
  "last_accepted_granot_observation",
  "granot_contact_revision",
  "last_granot_contact_change",
  "ringcentral",
  "ringcentral_convergence",
  "over_2000",
  "over_4000",
] as const;

export const RECORD_LINK_CHANGE_PATHS = [
  "lead_ref",
  "booking_ref",
  "source_scope",
  "disputed",
  "dispute_reason",
] as const;

export const BOOKED_LEAD_CHANGE_PATHS = [
  "job_no",
  "normalized_job_no",
  "book_date",
  "deposit_amount",
  "total_binder_amount",
  "merchant",
  "agent_allocations",
  "source",
  "local",
  "over_2000",
  "over_4000",
  "cancelled",
  "lead_ref",
  "lead_model",
  "is_referral_booking",
  "is_leadless_booking",
  "customer_name",
  "customer_phone",
] as const;

export const CANCELLED_LEAD_CHANGE_PATHS = [
  "cancel_date",
  "refund_amount",
  "reason",
  "cancelled_by",
  "booked_lead",
  "job_no",
  "agent",
  "merchant",
  "customer_name",
  "customer_phone",
] as const;

export type PlannedAggregateMutation = Omit<AggregateMutationPlan, "change_id">;

export type AggregateMutationPlan = {
  change_id: mongoose.Types.ObjectId;
  entity: EntityRef;
  revision_before: number;
  fields: Array<{ path: string; before?: unknown; after?: unknown }>;
  deleted?: boolean;
};

export function sourceSystemForOrigin(
  origin: CommandOrigin,
): EntityChangeSourceSystem {
  if (origin === "granot_lifecycle") return "granot";
  if (origin === "ringcentral") return "ringcentral";
  return "vantage";
}

export function classifyEntityChangePath(
  path: string,
): "stored" | "reference_only" {
  if (path === DELETED_ENTITY_CHANGE_PATH) return "reference_only";
  if (CONTACT_OR_ADDRESS_PATH.test(path)) return "reference_only";
  if (STORED_PATHS.has(path) || path.split(".").some((part) => STORED_PATHS.has(part))) {
    return "stored";
  }
  return "reference_only";
}

export function buildEntityChangeFields(
  fields: Array<{ path: string; before?: unknown; after?: unknown }>,
): EntityChangeField[] {
  const unique = new Map<string, { path: string; before?: unknown; after?: unknown }>();
  for (const field of fields) {
    if (!field.path.trim()) continue;
    unique.set(field.path, field);
  }
  return [...unique.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((field) => {
      const value_mode = classifyEntityChangePath(field.path);
      if (value_mode === "reference_only") {
        return { path: field.path, value_mode };
      }
      return {
        path: field.path,
        value_mode,
        ...(field.before !== undefined ? { before: field.before } : {}),
        ...(field.after !== undefined ? { after: field.after } : {}),
      };
    });
}

export function buildDeleteChangeFields(): EntityChangeField[] {
  return [{ path: DELETED_ENTITY_CHANGE_PATH, value_mode: "reference_only" }];
}

export function changedPathsFromFields(
  fields: readonly EntityChangeField[],
): string[] {
  return [...new Set(fields.map((field) => field.path))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function collectDocumentFieldChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  paths: readonly string[],
): Array<{ path: string; before?: unknown; after?: unknown }> {
  const changes: Array<{ path: string; before?: unknown; after?: unknown }> = [];
  for (const path of paths) {
    const previous = before ? readPath(before, path) : undefined;
    const next = after ? readPath(after, path) : undefined;
    if (sameJson(previous, next)) continue;
    changes.push({
      path,
      ...(previous !== undefined ? { before: previous } : {}),
      ...(next !== undefined ? { after: next } : {}),
    });
  }
  return changes;
}

export async function persistEntityChangeMutations(input: {
  session?: ClientSession;
  now: Date;
  command_name: string;
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  mutations: readonly AggregateMutationPlan[];
}): Promise<void> {
  if (input.mutations.length === 0) return;
  const Change = getEntityChangeModel();
  for (const mutation of input.mutations) {
    const fields = mutation.deleted
      ? buildDeleteChangeFields()
      : buildEntityChangeFields(mutation.fields);
    if (fields.length === 0) continue;
    const changed_paths = changedPathsFromFields(fields);
    const document = new Change({
      _id: mutation.change_id,
      entity: mutation.entity,
      command_execution_id: input.command_execution_id,
      command_name: input.command_name,
      provenance: {
        source_system: sourceSystemForOrigin(input.context.provenance.origin),
        ...(input.context.provenance.observation_channel
          ? { observation_channel: input.context.provenance.observation_channel }
          : {}),
        actor: input.context.actor,
        initiator: input.context.initiator,
        ...(objectIdOrUndefined(input.context.provenance.source_receipt_id)
          ? {
              receipt_id: objectIdOrUndefined(
                input.context.provenance.source_receipt_id,
              ),
            }
          : {}),
        ...(objectIdOrUndefined(input.context.provenance.observation_id)
          ? {
              observation_id: objectIdOrUndefined(
                input.context.provenance.observation_id,
              ),
            }
          : {}),
        ...(objectIdOrUndefined(input.context.provenance.decision_id)
          ? {
              decision_id: objectIdOrUndefined(
                input.context.provenance.decision_id,
              ),
            }
          : {}),
        ...(objectIdOrUndefined(input.context.provenance.case_id)
          ? { case_id: objectIdOrUndefined(input.context.provenance.case_id) }
          : {}),
        ...(objectIdOrUndefined(input.context.provenance.discrepancy_id)
          ? {
              discrepancy_id: objectIdOrUndefined(
                input.context.provenance.discrepancy_id,
              ),
            }
          : {}),
        ...(input.context.provenance.run_id
          ? { run_id: input.context.provenance.run_id }
          : {}),
        request_id: input.context.actor.request_id,
      },
      changed_paths,
      fields,
      revision_before: mutation.revision_before,
      revision_after: mutation.revision_before + 1,
      applied_at: input.now,
    });
    await document.save({ session: input.session });
    if (!mutation.deleted) {
      await stampAggregateRevision({
        entity: mutation.entity,
        change_id: mutation.change_id,
        revision_before: mutation.revision_before,
        applied_at: input.now,
        session: input.session,
      });
    }
  }
}

async function stampAggregateRevision(input: {
  entity: EntityRef;
  change_id: mongoose.Types.ObjectId;
  revision_before: number;
  applied_at: Date;
  session?: ClientSession;
}): Promise<void> {
  const model = writableAggregateModel(input.entity.model);
  const result = await model.collection.updateOne(
    {
      _id: toObjectId(input.entity.id),
      domain_revision: input.revision_before,
    },
    {
      $set: {
        last_change_id: input.change_id,
        last_changed_at: input.applied_at,
        domain_revision: input.revision_before + 1,
      },
    },
    input.session ? { session: input.session } : {},
  );
  if (result.matchedCount === 0) {
    throw new Error("DOMAIN_REVISION_CONFLICT");
  }
}

function writableAggregateModel(model: EntityRef["model"]) {
  switch (model) {
    case "FormLead":
      return getFormLeadModel();
    case "CallLead":
      return getCallLeadModel();
    case "BookedLead":
      return BookedLead;
    case "CancelledLead":
      return CancelledLead;
    case "GranotRecordLink":
      return getGranotRecordLinkModel();
    default:
      throw new Error(`EntityChange stamping is not owned for ${model}`);
  }
}

function objectIdOrUndefined(
  value: string | null | undefined,
): mongoose.Types.ObjectId | undefined {
  if (!value || !isObjectIdString(value)) return undefined;
  return toObjectId(value);
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export { EntityChange, DELETED_ENTITY_CHANGE_PATH };
