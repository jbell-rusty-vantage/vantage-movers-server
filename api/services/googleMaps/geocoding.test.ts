import assert from "node:assert/strict";
import { test } from "node:test";
import { extractStateCodeFromGoogleGeocodeResponse } from "./geocoding";

test("extractStateCodeFromGoogleGeocodeResponse uses postal address state code", () => {
  const stateCode = extractStateCodeFromGoogleGeocodeResponse({
    results: [
      {
        postalAddress: {
          administrativeArea: "ca",
        },
      },
    ],
  });

  assert.equal(stateCode, "CA");
});

test("extractStateCodeFromGoogleGeocodeResponse converts state component name", () => {
  const stateCode = extractStateCodeFromGoogleGeocodeResponse({
    results: [
      {
        addressComponents: [
          {
            longText: "New York",
            shortText: "NY",
            types: ["administrative_area_level_1", "political"],
          },
        ],
      },
    ],
  });

  assert.equal(stateCode, "NY");
});
