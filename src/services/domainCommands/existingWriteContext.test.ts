import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import type { VantageAuthContext } from "../../middleware/requireApiSecret";
import { existingWriteContextFromRequest } from "./existingWriteContext";
import { DomainCommandContextError } from "./types";

function requestWithAuth(auth: VantageAuthContext): Request {
  return {
    header() {
      return undefined;
    },
    vantageAuth: auth,
  } as unknown as Request;
}

test("existing write context maps an Owner extension user to an owner actor", () => {
  const context = existingWriteContextFromRequest({
    req: requestWithAuth({
      kind: "user",
      userId: "owner-1",
      email: "owner@example.invalid",
      role: "owner",
    }),
    command_name: "create_form_lead",
    payload: {},
  });

  assert.equal(context.actor.actor_type, "owner");
  assert.equal(context.actor.actor_role, "owner");
  assert.equal(context.actor.actor_id, "owner-1");
});

for (const role of ["sales", "customer_service", "employee"] as const) {
  test(`existing write context rejects a ${role} extension user`, () => {
    assert.throws(
      () =>
        existingWriteContextFromRequest({
          req: requestWithAuth({
            kind: "user",
            userId: `${role}-1`,
            email: `${role}@example.invalid`,
            role,
          }),
          command_name: "create_form_lead",
          payload: {},
        }),
      (error: unknown) =>
        error instanceof DomainCommandContextError &&
        error.message === "Existing write commands require an owner or admin actor.",
    );
  });
}
