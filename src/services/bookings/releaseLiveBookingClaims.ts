import type { ClientSession } from "mongoose";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { toObjectId } from "../../utils/objectId";
import {
  collectDocumentFieldChanges,
  RECORD_LINK_CHANGE_PATHS,
  type PlannedAggregateMutation,
} from "../domainCommands/entityChange";
import { V1ServiceError } from "../v1ServiceError";

export type ReleasedRecordLinkMutation = PlannedAggregateMutation & {
  entity: { model: "GranotRecordLink"; id: string };
  revision_already_advanced: true;
};

/**
 * Drops live Booking claims that later commands still treat as current.
 * The Lead document is not deleted. Call this inside the Booking delete
 * transaction, before `booking.deleteOne`.
 */
export async function releaseLiveBookingClaims(
  bookingId: string,
  session?: ClientSession,
): Promise<{ linkMutation?: ReleasedRecordLinkMutation }> {
  const bookingObjectId = toObjectId(bookingId);
  const linkMutation = await releaseActiveRecordLink(bookingObjectId, session);
  await releaseOpenBookingCases(bookingObjectId, session);
  return { linkMutation };
}

async function releaseActiveRecordLink(
  bookingId: ReturnType<typeof toObjectId>,
  session?: ClientSession,
): Promise<ReleasedRecordLinkMutation | undefined> {
  const Link = getGranotRecordLinkModel();
  const matches = await Link.find({
    provider: "granot",
    state: "active",
    booking_ref: bookingId,
  })
    .session(session ?? null)
    .limit(2)
    .lean()
    .exec();
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new V1ServiceError("More than one active Record Link names this Booking", 409);
  }
  const before = matches[0]!;
  const revisionBefore = Number(before.domain_revision ?? 0);
  // Model updateOne rejects booking_ref. This compare-and-swap is command-owned.
  const updated = await Link.collection.updateOne(
    {
      _id: before._id,
      state: "active",
      booking_ref: bookingId,
      domain_revision: revisionBefore,
    },
    { $unset: { booking_ref: "" }, $inc: { domain_revision: 1 } },
    session ? { session } : {},
  );
  if (updated.matchedCount !== 1) {
    throw new V1ServiceError("Record Link moved during Booking delete", 409);
  }
  const after = await Link.findById(before._id).session(session ?? null).lean().exec();
  if (!after) {
    throw new V1ServiceError("Record Link disappeared during Booking delete", 409);
  }
  return {
    entity: { model: "GranotRecordLink", id: String(before._id) },
    revision_before: revisionBefore,
    fields: collectDocumentFieldChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      RECORD_LINK_CHANGE_PATHS,
    ),
    revision_already_advanced: true,
  };
}

async function releaseOpenBookingCases(
  bookingId: ReturnType<typeof toObjectId>,
  session?: ClientSession,
): Promise<void> {
  const Case = getGranotBookingReconciliationCaseModel();
  const openCases = await Case.find({
    state: "open",
    deterministic_booking_id: bookingId,
  })
    .session(session ?? null)
    .lean()
    .exec();
  for (const openCase of openCases) {
    const updated = await Case.updateOne(
      {
        _id: openCase._id,
        state: "open",
        deterministic_booking_id: bookingId,
        case_revision: openCase.case_revision,
      },
      { $unset: { deterministic_booking_id: "" }, $inc: { case_revision: 1 } },
      session ? { session } : {},
    );
    if (updated.matchedCount !== 1) {
      throw new V1ServiceError("Booking reconciliation case moved during Booking delete", 409);
    }
  }
}
