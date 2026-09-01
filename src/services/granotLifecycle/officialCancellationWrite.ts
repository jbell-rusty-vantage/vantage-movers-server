import mongoose, { type ClientSession } from "mongoose";
import { CancelledLead } from "../../models/CancelledLead";
import type { GranotLifecycleConfirmCancellationCommandInput } from "../../validation/v1/granotLifecycle.validation";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CANCELLED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  type AggregateMutationPlan,
} from "../domainCommands/entityChange";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { persistSheetSyncIntent } from "../sheetSync";
import { createCancellationForVerifiedBookingInTransaction } from "../cancellations/cancelledLead.service";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type { LeadModel } from "./types";

export const CREATE_CANCELLATION_COMMAND_NAME = "createCancellation";

export type OfficialCancellationFailAfter =
  | "booking"
  | "cancellation"
  | "lead"
  | "changes"
  | "case"
  | "outbox";

export type OfficialCancellationWriteBooking = {
  _id: mongoose.Types.ObjectId;
  domain_revision: number;
  cancelled?: mongoose.Types.ObjectId | null;
  lead_ref?: mongoose.Types.ObjectId | null;
  lead_model?: LeadModel | null;
};

export async function applyOfficialCancellationWrite(input: {
  bookingBefore: OfficialCancellationWriteBooking & Record<string, unknown>;
  normalized_job_no: string;
  expected_booking_revision: number;
  official_cancellation_details: GranotLifecycleConfirmCancellationCommandInput["official_cancellation_details"];
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  session: ClientSession;
  now: Date;
  cancellationId: mongoose.Types.ObjectId;
  changeIds: mongoose.Types.ObjectId[];
  request_id?: string;
  test_fail_after?: OfficialCancellationFailAfter;
  resolveCase: (args: {
    outcome: "cancellation_created" | "already_satisfied";
    entity_id: mongoose.Types.ObjectId;
  }) => Promise<void>;
  base_refs: Array<{ model: string; id: string }>;
}): Promise<{ entity_refs: Array<{ model: string; id: string }>; warnings: [] }> {
  const existingCancellations = await CancelledLead.find({ booked_lead: input.bookingBefore._id })
    .session(input.session).limit(2).lean().exec();
  if (input.bookingBefore.cancelled || existingCancellations.length > 0) {
    const exact = existingCancellations.length === 1 &&
      String(existingCancellations[0]!._id) === String(input.bookingBefore.cancelled ?? "");
    if (!exact) {
      throw lifecycle(
        "Official Cancellation chain is incompatible with the Booking",
        "IDENTITY_CONFLICT",
        409,
        input.request_id,
      );
    }
    await input.resolveCase({
      outcome: "already_satisfied",
      entity_id: existingCancellations[0]!._id,
    });
    return {
      entity_refs: cancellationRefs(input.base_refs, existingCancellations[0]!._id),
      warnings: [],
    };
  }
  if (input.bookingBefore.domain_revision !== input.expected_booking_revision) {
    throw lifecycle("Booking revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
  }

  let created: Awaited<ReturnType<typeof createCancellationForVerifiedBookingInTransaction>>;
  try {
    created = await createCancellationForVerifiedBookingInTransaction({
      booking_before: input.bookingBefore as unknown as Parameters<
        typeof createCancellationForVerifiedBookingInTransaction
      >[0]["booking_before"],
      expected_domain_revision: input.expected_booking_revision,
      normalized_job_no: input.normalized_job_no,
      cancellation_id: input.cancellationId,
      official_details: input.official_cancellation_details,
      ...(input.test_fail_after === "booking" ||
      input.test_fail_after === "cancellation" ||
      input.test_fail_after === "lead"
        ? { test_fail_after: input.test_fail_after }
        : {}),
    }, { session: input.session, now: input.now });
  } catch (error) {
    if (error instanceof Error && error.message === "DOMAIN_REVISION_CONFLICT") {
      throw lifecycle("Booking or Lead revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
    }
    if (error instanceof Error && error.message === "GRANOT_IDENTITY_CONFLICT") {
      throw lifecycle("Booking Lead identity changed", "IDENTITY_CONFLICT", 409, input.request_id);
    }
    throw error;
  }
  const cancellationAfter = created.cancellation.toObject() as unknown as Record<string, unknown>;
  const mutations: AggregateMutationPlan[] = [
    {
      change_id: input.changeIds[0]!,
      entity: { model: "BookedLead", id: String(input.bookingBefore._id) },
      revision_before: input.bookingBefore.domain_revision,
      fields: collectDocumentFieldChanges(
        input.bookingBefore,
        created.booking_after,
        BOOKED_LEAD_CHANGE_PATHS,
      ),
    },
    {
      change_id: input.changeIds[1]!,
      entity: { model: "CancelledLead", id: String(input.cancellationId) },
      revision_before: 0,
      fields: collectDocumentFieldChanges(null, cancellationAfter, CANCELLED_LEAD_CHANGE_PATHS),
    },
  ];
  if (
    created.lead_before && created.lead_after &&
    input.bookingBefore.lead_ref && input.bookingBefore.lead_model
  ) {
    mutations.push({
      change_id: input.changeIds[2]!,
      entity: { model: input.bookingBefore.lead_model, id: String(input.bookingBefore.lead_ref) },
      revision_before: Number(created.lead_before.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(
        created.lead_before,
        created.lead_after,
        input.bookingBefore.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
      ),
    });
  }
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: CREATE_CANCELLATION_COMMAND_NAME,
    command_execution_id: input.command_execution_id,
    context: input.context,
    mutations,
  });
  failAfter(input.test_fail_after, "changes");
  await input.resolveCase({
    outcome: "cancellation_created",
    entity_id: input.cancellationId,
  });
  failAfter(input.test_fail_after, "case");
  await persistSheetSyncIntent({
    resource: "cancellation_chain",
    operation: "cancelled_lead.create",
    cancellationId: String(input.cancellationId),
  }, input.session);
  failAfter(input.test_fail_after, "outbox");
  return {
    entity_refs: cancellationRefs(input.base_refs, input.cancellationId),
    warnings: [],
  };
}

function cancellationRefs(
  baseRefs: Array<{ model: string; id: string }>,
  cancellationId: mongoose.Types.ObjectId,
) {
  return [
    ...baseRefs,
    { model: "CancelledLead", id: String(cancellationId) },
  ];
}

function lifecycle(
  message: string,
  key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES,
  status: number,
  requestId?: string,
) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId);
}

function failAfter(
  selected: OfficialCancellationFailAfter | undefined,
  current: OfficialCancellationFailAfter,
) {
  if (selected === current) {
    throw new Error(`UNIT27_INJECTED_FAILURE_AFTER_${current.toUpperCase()}`);
  }
}
