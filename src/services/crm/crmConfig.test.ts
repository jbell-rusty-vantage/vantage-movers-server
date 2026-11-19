import assert from "node:assert/strict";
import test from "node:test";
import { crmEndpointForLog } from "./crmConfig";

test("crmEndpointForLog defaults to the module-loaded CRM_FORM_LEAD_ENDPOINT and never leaks credentials", () => {
  const logged = crmEndpointForLog();
  assert.match(logged, /API_ID=\[redacted\]/);
  assert.match(logged, /MOVERREF=\[redacted\]/);
});
