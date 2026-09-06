import type { CommandOrigin } from "../domainCommands/types";
import { ValidationError } from "../errors";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  CallLeadIngestionOrigin,
  FormLeadIngestionOrigin,
} from "../granotLifecycle/types";
import {
  ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS,
  ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS,
  PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS,
} from "../../models/granotLifecycleSchemas";

export type AssignableFormLeadIngestionOrigin =
  (typeof ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS)[number];
export type AssignableCallLeadIngestionOrigin =
  (typeof ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS)[number];

export type IngestedContactSnapshotInput = {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
};

export type IngestedMoveSnapshotInput = {
  pickup_city?: string | null;
  pickup_zip?: string | null;
  pickup_state?: string | null;
  delivery_city?: string | null;
  destination_zip?: string | null;
  delivery_state?: string | null;
  move_date?: Date | null;
  move_size?: string | null;
};

export type IngestedContactSnapshot = {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion";
};

export type IngestedMoveSnapshot = {
  pickup_city?: string;
  pickup_zip?: string;
  pickup_state?: string;
  delivery_city?: string;
  destination_zip?: string;
  delivery_state?: string;
  move_date?: Date;
  move_size?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion";
};

export function assertAssignableFormLeadIngestionOrigin(
  origin: FormLeadIngestionOrigin,
): asserts origin is AssignableFormLeadIngestionOrigin {
  if (
    !(ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS as readonly string[]).includes(origin)
  ) {
    throw new ValidationError(
      "Unproven Form Lead create path; refusing to assign ingestion_origin",
      { metadata: { ingestion_origin: origin } },
    );
  }
}

export function assertAssignableCallLeadIngestionOrigin(
  origin: CallLeadIngestionOrigin,
): asserts origin is AssignableCallLeadIngestionOrigin {
  if (
    !(ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS as readonly string[]).includes(origin)
  ) {
    throw new ValidationError(
      "Unproven Call Lead create path; refusing to assign ingestion_origin",
      { metadata: { ingestion_origin: origin } },
    );
  }
}

export function deriveFormLeadIngestionOrigin(input: {
  commandOrigin?: CommandOrigin;
  actorType?: "owner" | "admin" | "system" | "employee";
}): AssignableFormLeadIngestionOrigin {
  if (input.commandOrigin === "external_sheet_ingestion") {
    return "best_relocation_sheet";
  }
  if (input.commandOrigin === "granot_lifecycle") {
    return "granot_lead_created";
  }
  if (input.commandOrigin === "vantage_admin") {
    if (input.actorType === "owner" || input.actorType === "admin") {
      return "vantage_admin";
    }
    if (input.actorType === "system" || input.actorType === undefined) {
      return "wordpress_form";
    }
  }
  if (input.commandOrigin === undefined) {
    return "wordpress_form";
  }
  throw new ValidationError(
    "Unproven Form Lead create path; refusing to guess ingestion_origin",
    { metadata: { commandOrigin: input.commandOrigin, actorType: input.actorType } },
  );
}

export function deriveCallLeadIngestionOrigin(input: {
  commandOrigin?: CommandOrigin;
}): AssignableCallLeadIngestionOrigin {
  if (input.commandOrigin === "external_sheet_ingestion") {
    return "best_relocation_sheet";
  }
  if (input.commandOrigin === "granot_lifecycle") {
    return "granot_lead_created";
  }
  if (input.commandOrigin === "vantage_admin" || input.commandOrigin === undefined) {
    return "vantage_admin";
  }
  if (input.commandOrigin === "ringcentral") {
    return "ringcentral";
  }
  throw new ValidationError(
    "Unproven Call Lead create path; refusing to guess ingestion_origin",
    { metadata: { commandOrigin: input.commandOrigin } },
  );
}

export function buildIngestedContactSnapshot(
  input: IngestedContactSnapshotInput,
  now: Date,
): IngestedContactSnapshot {
  return {
    first_name: optionalText(input.first_name),
    last_name: optionalText(input.last_name),
    name: optionalText(input.name),
    phone_number: optionalText(input.phone_number),
    normalized_phone_number: normalizePhoneNumberForMatch(input.phone_number),
    email: optionalText(input.email)?.toLowerCase(),
    captured_at: now,
    evidence_status: "captured_at_ingestion",
  };
}

export function buildIngestedMoveSnapshot(
  input: IngestedMoveSnapshotInput,
  now: Date,
): IngestedMoveSnapshot {
  return {
    pickup_city: optionalText(input.pickup_city),
    pickup_zip: optionalText(input.pickup_zip),
    pickup_state: optionalText(input.pickup_state),
    delivery_city: optionalText(input.delivery_city),
    destination_zip: optionalText(input.destination_zip),
    delivery_state: optionalText(input.delivery_state),
    move_date: input.move_date ?? undefined,
    move_size: optionalText(input.move_size),
    captured_at: now,
    evidence_status: "captured_at_ingestion",
  };
}

export function noSyncOnCreate(
  origin: FormLeadIngestionOrigin | CallLeadIngestionOrigin,
  requested?: boolean | null,
): boolean {
  if (origin === "vantage_admin") {
    return requested ?? true;
  }
  return false;
}

export function formLeadCreationProvenanceFields(input: {
  origin: FormLeadIngestionOrigin;
  now: Date;
  contact: IngestedContactSnapshotInput;
  move: IngestedMoveSnapshotInput;
  job_no?: string | null;
}): {
  ingestion_origin: AssignableFormLeadIngestionOrigin;
  job_no?: string;
  normalized_job_no?: string;
  ingested_contact_snapshot: IngestedContactSnapshot;
  ingested_move_snapshot: IngestedMoveSnapshot;
} {
  assertAssignableFormLeadIngestionOrigin(input.origin);
  const job_no = optionalText(input.job_no);
  return {
    ingestion_origin: input.origin,
    job_no,
    normalized_job_no: normalizeJobNo(job_no),
    ingested_contact_snapshot: buildIngestedContactSnapshot(input.contact, input.now),
    ingested_move_snapshot: buildIngestedMoveSnapshot(input.move, input.now),
  };
}

export function callLeadCreationProvenanceFields(input: {
  origin: CallLeadIngestionOrigin;
  now: Date;
  contact: IngestedContactSnapshotInput;
}): {
  ingestion_origin: AssignableCallLeadIngestionOrigin;
  ingested_contact_snapshot: IngestedContactSnapshot;
  quoted: false;
} {
  assertAssignableCallLeadIngestionOrigin(input.origin);
  return {
    ingestion_origin: input.origin,
    ingested_contact_snapshot: buildIngestedContactSnapshot(input.contact, input.now),
    quoted: false,
  };
}

export function omitForbiddenLeadLifecycleFields<T extends Record<string, unknown>>(
  input: T,
): T {
  const copy = { ...input };
  for (const field of PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS) {
    delete copy[field];
  }
  return copy;
}

function optionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
