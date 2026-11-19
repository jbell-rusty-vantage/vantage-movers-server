import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNamedTarget } from "./ringcentral-outreach-target";

test("named target must equal this process's account and database", () => {
  assertNamedTarget({ target: "1", configuredAccountId: "1", database: "db", resolvedDatabase: "db" });
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: null, database: "db", resolvedDatabase: "db" }), /not configured/);
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: "2", database: "db", resolvedDatabase: "db" }), /account 2/);
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: "1", database: "prod", resolvedDatabase: "testvantagemovers" }), /resolves/);
});
