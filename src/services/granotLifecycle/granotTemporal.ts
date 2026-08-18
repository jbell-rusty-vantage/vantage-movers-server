import mongoose from "mongoose";

export type GranotTemporalTuple = {
  captured_at: Date;
  observation_id: string;
};

export type GranotTemporalOrder = "newer" | "same" | "older";

const OBJECT_ID_HEX = /^[a-f0-9]{24}$/;

export function normalizeTemporalObservationId(value: string): string {
  return value.trim().toLowerCase();
}

export function compareGranotTemporal(
  incoming: GranotTemporalTuple,
  stored?: GranotTemporalTuple | null,
): GranotTemporalOrder {
  if (!stored) {
    return "newer";
  }
  const incomingId = normalizeTemporalObservationId(incoming.observation_id);
  const storedId = normalizeTemporalObservationId(stored.observation_id);
  const incomingTime = incoming.captured_at.getTime();
  const storedTime = stored.captured_at.getTime();
  if (incomingTime > storedTime) {
    return "newer";
  }
  if (incomingTime < storedTime) {
    return "older";
  }
  if (incomingId === storedId) {
    return "same";
  }
  return incomingId > storedId ? "newer" : "older";
}

export function olderTemporalWinnerFilter(
  incoming: GranotTemporalTuple,
): Record<string, unknown> {
  const observationId = normalizeTemporalObservationId(incoming.observation_id);
  if (!OBJECT_ID_HEX.test(observationId)) {
    throw new Error("temporal compare-and-swap requires a 24-character Observation ObjectId hex");
  }
  const incomingObjectId = new mongoose.Types.ObjectId(observationId);
  return {
    $or: [
      { "last_accepted_granot_observation.captured_at": { $lt: incoming.captured_at } },
      {
        "last_accepted_granot_observation.captured_at": incoming.captured_at,
        "last_accepted_granot_observation.observation_id": { $lt: incomingObjectId },
      },
    ],
  };
}
