import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  compareGranotTemporal,
  olderTemporalWinnerFilter,
  type GranotTemporalTuple,
} from "./granotTemporal";

const earlier = new Date("2026-08-17T15:00:00.000Z");
const later = new Date("2026-08-17T16:00:00.000Z");
const lowId = "64b7f4d9e6c2a1b0f3d5e780";
const highId = "64b7f4d9e6c2a1b0f3d5e789";

function tuple(captured_at: Date, observation_id: string): GranotTemporalTuple {
  return { captured_at, observation_id };
}

test("[AC-32] temporal comparator treats a missing stored winner as newer", () => {
  assert.equal(compareGranotTemporal(tuple(earlier, lowId), null), "newer");
  assert.equal(compareGranotTemporal(tuple(earlier, lowId), undefined), "newer");
});

test("[AC-32] temporal comparator compares captured_at before Observation ObjectId", () => {
  assert.equal(compareGranotTemporal(tuple(later, lowId), tuple(earlier, highId)), "newer");
  assert.equal(compareGranotTemporal(tuple(earlier, highId), tuple(later, lowId)), "older");
});

test("[AC-32] equal captured_at uses lowercase 24-character Observation ObjectId hex", () => {
  assert.equal(compareGranotTemporal(tuple(earlier, highId), tuple(earlier, lowId)), "newer");
  assert.equal(compareGranotTemporal(tuple(earlier, lowId), tuple(earlier, highId)), "older");
  assert.equal(
    compareGranotTemporal(tuple(earlier, highId.toUpperCase()), tuple(earlier, lowId)),
    "newer",
  );
});

test("[AC-32] exact same temporal tuple is same and never a second winner", () => {
  assert.equal(compareGranotTemporal(tuple(earlier, highId), tuple(earlier, highId)), "same");
  assert.equal(
    compareGranotTemporal(tuple(earlier, highId.toUpperCase()), tuple(earlier, highId)),
    "same",
  );
});

test("[AC-32] no source, channel, or Priority can be encoded in the temporal tuple", () => {
  const filter = olderTemporalWinnerFilter(tuple(later, highId));
  assert.deepEqual(Object.keys(filter), ["$or"]);
  const clauses = filter.$or as Array<Record<string, unknown>>;
  assert.equal(clauses.length, 2);
  assert.deepEqual(clauses[0], {
    "last_accepted_granot_observation.captured_at": { $lt: later },
  });
  assert.deepEqual(clauses[1], {
    "last_accepted_granot_observation.captured_at": later,
    "last_accepted_granot_observation.observation_id": {
      $lt: new mongoose.Types.ObjectId(highId),
    },
  });
  assert.equal(JSON.stringify(filter).includes("$exists"), false);
});
