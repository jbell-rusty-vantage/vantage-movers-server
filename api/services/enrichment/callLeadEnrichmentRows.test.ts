import assert from "node:assert/strict";
import test from "node:test";
import { parseEnrichmentRow } from "./callLeadEnrichmentRows";

test("parseEnrichmentRow enriches valid cities while ignoring zero and comma placeholders", async () => {
  const parsed = await parseEnrichmentRow({
    row_id: "P5559324",
    from: "Barnesville,GA",
    from_zip: "0",
    to: ",",
    to_zip: "0",
  });

  assert.equal(parsed.pickup_city, "Barnesville");
  assert.equal(parsed.pickup_zip, undefined);
  assert.equal(parsed.delivery_city, undefined);
  assert.equal(parsed.delivery_zip, undefined);
});
