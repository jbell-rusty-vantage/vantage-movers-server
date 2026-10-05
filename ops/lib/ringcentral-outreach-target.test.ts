import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNamedTarget, parseOutreachSubscriptionArgs, parseProofArgs } from "./ringcentral-outreach-target";

test("subscription command: named account + database required, dry run by default, purposes, unknown flags refused", () => {
  assert.deepEqual(parseOutreachSubscriptionArgs(["--target=800000000001", "--database=vantagemovers"]), {
    target: "800000000001",
    database: "vantagemovers",
    purposes: ["calls", "rep_sms"],
    apply: false,
  });
  assert.deepEqual(parseOutreachSubscriptionArgs(["--target=1", "--database=db", "--purpose=rep_sms", "--apply"]).purposes, ["rep_sms"]);
  assert.equal(parseOutreachSubscriptionArgs(["--target=1", "--database=db", "--apply", "--dry-run"]).apply, false);
  assert.throws(() => parseOutreachSubscriptionArgs(["--database=db"]), /--target/);
  assert.throws(() => parseOutreachSubscriptionArgs(["--target=~", "--database=db"]), /--target/);
  assert.throws(() => parseOutreachSubscriptionArgs(["--target=1"]), /--database/);
  assert.throws(() => parseOutreachSubscriptionArgs(["--target=1", "--database=db", "--purpose=fax"]), /--purpose/);
  assert.throws(() => parseOutreachSubscriptionArgs(["--target=1", "--database=db", "--force"]), /Unknown argument/);
});

test("proof command: named target, optional sent-within window", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  assert.deepEqual(parseProofArgs(["--target=1", "--database=db"], now), { target: "1", database: "db", sampleSince: null });
  assert.equal(parseProofArgs(["--target=1", "--database=db", "--sent-within-minutes=60"], now).sampleSince?.toISOString(), "2026-10-05T14:00:00.000Z");
  assert.throws(() => parseProofArgs(["--target=1", "--database=db", "--sent-within-minutes=0"], now), /1–1440/);
  assert.throws(() => parseProofArgs(["--target=1", "--database=db", "--apply"], now), /Unknown argument/);
});

test("named target must equal this process's account and database", () => {
  assertNamedTarget({ target: "1", configuredAccountId: "1", database: "db", resolvedDatabase: "db" });
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: null, database: "db", resolvedDatabase: "db" }), /not configured/);
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: "2", database: "db", resolvedDatabase: "db" }), /account 2/);
  assert.throws(() => assertNamedTarget({ target: "1", configuredAccountId: "1", database: "prod", resolvedDatabase: "testvantagemovers" }), /resolves/);
});
