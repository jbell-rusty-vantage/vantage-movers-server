import assert from "node:assert/strict";
import test from "node:test";
import {
  isObjectIdString,
  toObjectId,
  toObjectIdOrUndefined,
} from "./objectId";

const SAMPLE = "507f1f77bcf86cd799439011";

test("isObjectIdString accepts 24-char hex ids", () => {
  assert.equal(isObjectIdString(SAMPLE), true);
  assert.equal(isObjectIdString("not-an-id"), false);
});

test("toObjectId parses hex strings", () => {
  assert.equal(toObjectId(SAMPLE).toString(), SAMPLE);
});

test("toObjectIdOrUndefined maps empty values to undefined", () => {
  assert.equal(toObjectIdOrUndefined(undefined), undefined);
  assert.equal(toObjectIdOrUndefined(null), undefined);
  assert.equal(toObjectIdOrUndefined(""), undefined);
  assert.equal(toObjectIdOrUndefined(SAMPLE)?.toString(), SAMPLE);
});
