import { createHash } from "node:crypto";
import mongoose from "mongoose";
import type { LeadDesiredStatePlan } from "./leadDesiredState";
import type { LeadModel } from "./types";

export const GRANOT_LEAD_WRITE_PATHS = [
  "job_no",
  "normalized_job_no",
  "granot_priority",
  "quoted",
  "receiver_agent",
  "receiver_agent_source",
  "receiver_agent_source_value",
  "granot_contact_snapshot",
  "name",
  "first_name",
  "last_name",
  "phone_number",
  "normalized_phone_number",
  "email",
  "pickup_city",
  "pickup_zip",
  "pickup_state",
  "delivery_city",
  "destination_zip",
  "delivery_zip",
  "delivery_state",
  "move_date",
  "cubic_feet",
  "local",
  "granot_move_size",
  "granot_service_type",
] as const;

export type GranotLeadWritePath = (typeof GRANOT_LEAD_WRITE_PATHS)[number];

export const GRANOT_CONTACT_PATHS = [
  "name",
  "first_name",
  "last_name",
  "phone_number",
  "normalized_phone_number",
  "email",
] as const;

export type GranotContactPath = (typeof GRANOT_CONTACT_PATHS)[number];

export const GRANOT_MOVE_PATHS = [
  "pickup_city",
  "pickup_zip",
  "pickup_state",
  "delivery_city",
  "destination_zip",
  "delivery_zip",
  "delivery_state",
  "move_date",
  "cubic_feet",
  "local",
  "granot_move_size",
  "granot_service_type",
] as const;

export type GranotMovePath = (typeof GRANOT_MOVE_PATHS)[number];

export type GranotAuthorizedLeadDesiredState = {
  set: Partial<Record<GranotLeadWritePath, unknown>>;
  changed_paths: GranotLeadWritePath[];
  contact_changed_paths: GranotContactPath[];
  move_changed_paths: GranotMovePath[];
  temporal_winner: { observation_id: string; captured_at: Date };
};

export const FORBIDDEN_DESIRED_STATE_METADATA_PATHS = [
  "last_accepted_granot_observation",
  "current_contact_provenance",
  "current_move_provenance",
  "granot_contact_revision",
  "last_granot_contact_change",
  "last_granot_contact_change.changed_paths",
  "domain_revision",
  "last_change_id",
  "last_changed_at",
  "ingestion_origin",
  "ingested_contact_snapshot",
  "ingested_move_snapshot",
  "lead_source_company",
  "source_granularity_id",
  "cpl",
  "booked",
  "cancelled",
  "move_size",
  "estimate",
  "payment",
  "balance",
] as const;

const WRITE_PATH_SET = new Set<string>(GRANOT_LEAD_WRITE_PATHS);
const CONTACT_PATH_SET = new Set<string>(GRANOT_CONTACT_PATHS);
const MOVE_PATH_SET = new Set<string>(GRANOT_MOVE_PATHS);
const FORBIDDEN_PATH_SET = new Set<string>(FORBIDDEN_DESIRED_STATE_METADATA_PATHS);

export class AuthorizedDesiredStateError extends Error {
  readonly code = "GRANOT_AUTHORIZED_DESIRED_STATE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AuthorizedDesiredStateError";
  }
}

export function toAuthorizedLeadDesiredState(input: {
  plan: LeadDesiredStatePlan;
  lead_model: LeadModel;
  temporal_winner: { observation_id: string; captured_at: Date };
}): GranotAuthorizedLeadDesiredState {
  const set: Partial<Record<GranotLeadWritePath, unknown>> = {};
  for (const path of input.plan.changed_paths) {
    if (!WRITE_PATH_SET.has(path) || FORBIDDEN_PATH_SET.has(path)) {
      continue;
    }
    const writePath = path as GranotLeadWritePath;
    if (writePath in input.plan.desired_values) {
      set[writePath] = input.plan.desired_values[writePath];
    }
  }
  const changed_paths = sortUnique(
    Object.keys(set).filter((path): path is GranotLeadWritePath =>
      WRITE_PATH_SET.has(path),
    ),
  );
  const desired: GranotAuthorizedLeadDesiredState = {
    set,
    changed_paths,
    contact_changed_paths: changed_paths.filter((path): path is GranotContactPath =>
      CONTACT_PATH_SET.has(path),
    ),
    move_changed_paths: changed_paths.filter((path): path is GranotMovePath =>
      MOVE_PATH_SET.has(path),
    ),
    temporal_winner: {
      observation_id: String(input.temporal_winner.observation_id),
      captured_at: new Date(input.temporal_winner.captured_at),
    },
  };
  assertAuthorizedLeadDesiredState(desired, input.lead_model);
  return desired;
}

export function assertAuthorizedLeadDesiredState(
  desired: GranotAuthorizedLeadDesiredState,
  lead_model: LeadModel,
): void {
  if (
    !desired.temporal_winner?.observation_id ||
    !mongoose.Types.ObjectId.isValid(desired.temporal_winner.observation_id) ||
    String(desired.temporal_winner.observation_id).length !== 24 ||
    !(desired.temporal_winner.captured_at instanceof Date) ||
    Number.isNaN(desired.temporal_winner.captured_at.getTime())
  ) {
    throw new AuthorizedDesiredStateError(
      "temporal_winner must be a valid Observation ObjectId and capture time.",
    );
  }

  const setKeys = Object.keys(desired.set);
  if (new Set(setKeys).size !== setKeys.length) {
    throw new AuthorizedDesiredStateError("desired state set contains duplicate paths.");
  }
  if (new Set(desired.changed_paths).size !== desired.changed_paths.length) {
    throw new AuthorizedDesiredStateError("changed_paths contains duplicates.");
  }
  const expectedPaths = sortUnique(setKeys);
  if (JSON.stringify(desired.changed_paths) !== JSON.stringify(expectedPaths)) {
    throw new AuthorizedDesiredStateError(
      "changed_paths must be the sorted unique keys of set.",
    );
  }

  for (const path of setKeys) {
    if (FORBIDDEN_PATH_SET.has(path)) {
      throw new AuthorizedDesiredStateError(`${path} is server-derived and may not appear in set.`);
    }
    if (!WRITE_PATH_SET.has(path)) {
      throw new AuthorizedDesiredStateError(`${path} is not an allowlisted Lead write path.`);
    }
  }

  if (desired.set.quoted === false) {
    throw new AuthorizedDesiredStateError("quoted:false is forbidden.");
  }

  if (lead_model === "FormLead" && "delivery_zip" in desired.set) {
    throw new AuthorizedDesiredStateError("FormLead cannot set delivery_zip.");
  }
  if (lead_model === "CallLead" && "destination_zip" in desired.set) {
    throw new AuthorizedDesiredStateError("CallLead cannot set destination_zip.");
  }

  const expectedContact = sortUnique(
    desired.changed_paths.filter((path): path is GranotContactPath =>
      CONTACT_PATH_SET.has(path),
    ),
  );
  const expectedMove = sortUnique(
    desired.changed_paths.filter((path): path is GranotMovePath =>
      MOVE_PATH_SET.has(path),
    ),
  );
  if (JSON.stringify(desired.contact_changed_paths) !== JSON.stringify(expectedContact)) {
    throw new AuthorizedDesiredStateError(
      "contact_changed_paths must match current-contact leaves in changed_paths.",
    );
  }
  if (JSON.stringify(desired.move_changed_paths) !== JSON.stringify(expectedMove)) {
    throw new AuthorizedDesiredStateError(
      "move_changed_paths must match qualified move leaves in changed_paths.",
    );
  }
}

export function hashGranotContactLeaves(contact: Record<string, unknown> | null | undefined): string {
  const leaves: Record<string, unknown> = {};
  for (const path of GRANOT_CONTACT_PATHS) {
    const value = contact?.[path];
    leaves[path] = value === undefined ? null : canonicalizeForHash(value);
  }
  return createHash("sha256").update(JSON.stringify(leaves)).digest("hex");
}

export function synchronizeLeadPayloadChecksum(input: {
  lead_ref: { model: LeadModel; id: string };
  expected_domain_revision: number;
  desired_state: GranotAuthorizedLeadDesiredState;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        lead_ref: input.lead_ref,
        expected_domain_revision: input.expected_domain_revision,
        desired_state: {
          set: canonicalizeForHash(input.desired_state.set),
          changed_paths: input.desired_state.changed_paths,
          contact_changed_paths: input.desired_state.contact_changed_paths,
          move_changed_paths: input.desired_state.move_changed_paths,
          temporal_winner: {
            observation_id: input.desired_state.temporal_winner.observation_id,
            captured_at: input.desired_state.temporal_winner.captured_at.toISOString(),
          },
        },
      }),
    )
    .digest("hex");
}

export function synchronizeLeadIdempotencyKey(observationId: string): string {
  return `granot:synchronize-lead:${observationId}`;
}

function canonicalizeForHash(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeForHash(entry)]),
    );
  }
  return value;
}

function sortUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
