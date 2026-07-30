import assert from "node:assert/strict";
import { test } from "node:test";
import { createRingCentralAccountRouteValidator } from "./ringCentralValidation";

test("M5 account validator shares one RingCentral inventory load across numbers", async () => {
  let loads = 0;
  const validator = createRingCentralAccountRouteValidator(async () => {
    loads += 1;
    return [
      {
        id: "phone-number-1",
        phoneNumber: "+1 (888) 308-3612",
        type: "TollFree",
        usageType: "CompanyNumber",
        extension: {
          id: "queue-1",
          name: "TBM Prime Inbounds",
        },
      },
    ];
  });

  const [matched, missing] = await Promise.all([
    validator("+18883083612"),
    validator("+18880000000"),
  ]);

  assert.equal(loads, 1);
  assert.equal(matched.status, "valid");
  assert.equal(matched.code, "RINGCENTRAL_NUMBER_ACCESSIBLE");
  assert.equal(missing.status, "invalid");
  assert.equal(missing.code, "RINGCENTRAL_NUMBER_NOT_FOUND");
});
