import assert from "node:assert/strict";
import { test } from "node:test";
import { RegistryError } from "./errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";

test("RegistryError exposes stable registry_code and remediation in HTTP body", () => {
  const error = new RegistryError("Registry mutations require an Owner actor.", {
    registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    remediation: {
      summary: "Sign in as Owner to mutate registry state.",
      action: "switch_role",
    },
  });

  assert.equal(error.statusCode, 403);
  assert.deepEqual(error.toHttpBody(), {
    ok: false,
    error: "Registry mutations require an Owner actor.",
    registry_code: REGISTRY_ERROR_CODES.FORBIDDEN,
    remediation: {
      summary: "Sign in as Owner to mutate registry state.",
      action: "switch_role",
    },
  });
});

test("RegistryError maps registry codes to app log codes without changing legacy error field", () => {
  const error = new RegistryError("Signed dashboard actor context has expired.", {
    registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED,
  });

  assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED);
  assert.equal(error.code, "app.unauthorized");
  assert.equal(error.toHttpBody().registry_code, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED);
});
