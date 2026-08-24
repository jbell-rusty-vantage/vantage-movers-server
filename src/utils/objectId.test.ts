import assert from "node:assert/strict";
import test from "node:test";
import {
  isObjectIdString,
  newObjectIdHex,
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

test("newObjectIdHex returns a distinct 24-char hex id", () => {
  const first = newObjectIdHex();
  const second = newObjectIdHex();
  assert.match(first, /^[a-f0-9]{24}$/);
  assert.match(second, /^[a-f0-9]{24}$/);
  assert.notEqual(first, second);
  assert.equal(toObjectId(first).toString(), first);
});
