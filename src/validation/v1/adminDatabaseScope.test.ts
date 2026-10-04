import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import {
  adminBrowseQuerySchema,
  adminSearchQuerySchema,
  analyticsQuerySchema,
  overviewQuerySchema,
} from "../v1.validation";

const RETIRED_MESSAGE = /historical database was retired/;

const schemas = [
  ["admin browse", (scope?: string) => adminBrowseQuerySchema.parse(withScope({}, scope))],
  ["admin search", (scope?: string) => adminSearchQuerySchema.parse(withScope({ q: "Jane" }, scope))],
  ["analytics", (scope?: string) => analyticsQuerySchema.parse(withScope({}, scope))],
  ["overview", (scope?: string) => overviewQuerySchema.parse(withScope({}, scope))],
] as const;

for (const [name, parse] of schemas) {
  test(`${name} query keeps an omitted or explicit production scope`, () => {
    assert.equal(parse().database_scope, undefined);
    assert.equal(parse("production").database_scope, "production");
  });

  test(`${name} query rejects the retired historical and combined scopes`, () => {
    for (const scope of ["historical", "combined"]) {
      assert.throws(
        () => parse(scope),
        (error: unknown) =>
          error instanceof ZodError &&
          error.issues.some(
            (issue) => issue.path[0] === "database_scope" && RETIRED_MESSAGE.test(issue.message),
          ),
      );
    }
  });
}

function withScope(input: Record<string, unknown>, scope?: string): Record<string, unknown> {
  return scope === undefined ? input : { ...input, database_scope: scope };
}
