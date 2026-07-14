import assert from "node:assert/strict";
import test from "node:test";
import {
  CRM_API_ID_ENV_VAR,
  CRM_FORM_LEAD_ENDPOINT,
  CRM_MOVER_REF_ENV_VAR,
  crmEndpointForLog,
} from "./crmConfig";

test("CRM env var name constants are stable and match what is read at module load", () => {
  assert.equal(CRM_API_ID_ENV_VAR, "CRM_API_ID");
  assert.equal(CRM_MOVER_REF_ENV_VAR, "CRM_MOVER_REF");
});

test("CRM_FORM_LEAD_ENDPOINT is the Granot lead gateway URL with API_ID and MOVERREF params", () => {
  assert.match(
    CRM_FORM_LEAD_ENDPOINT,
    /^https:\/\/lead\.hellomoving\.com\/LEADSGWHTTP\.lidgw\?&API_ID=.*&MOVERREF=.*$/,
  );
});

test("crmEndpointForLog redacts API_ID and MOVERREF values from the endpoint URL", () => {
  const fake =
    "https://lead.hellomoving.com/LEADSGWHTTP.lidgw?&API_ID=abc123&MOVERREF=mover456";
  assert.equal(
    crmEndpointForLog(fake),
    "https://lead.hellomoving.com/LEADSGWHTTP.lidgw?&API_ID=[redacted]&MOVERREF=[redacted]",
  );
});

test("crmEndpointForLog defaults to the module-loaded CRM_FORM_LEAD_ENDPOINT and never leaks credentials", () => {
  const logged = crmEndpointForLog();
  assert.match(logged, /API_ID=\[redacted\]/);
  assert.match(logged, /MOVERREF=\[redacted\]/);
});
