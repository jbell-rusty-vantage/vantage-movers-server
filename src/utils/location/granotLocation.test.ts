import assert from "node:assert/strict";
import test from "node:test";
import { parseGranotCityState, parseGranotZip } from "./granotLocation";

test("parseGranotCityState accepts multi-word cities and normalizes state", () => {
  assert.deepEqual(parseGranotCityState(" New Orleans,la "), {
    city: "New Orleans",
    state: "LA",
  });
});

test("Granot location parsing rejects placeholder and malformed values", () => {
  assert.equal(parseGranotCityState(","), undefined);
  assert.equal(parseGranotCityState("Barnesville"), undefined);
  assert.equal(parseGranotZip("0"), undefined);
  assert.equal(parseGranotZip(""), undefined);
  assert.equal(parseGranotZip("30201"), "30201");
  assert.equal(parseGranotZip("07801"), "07801");
});
