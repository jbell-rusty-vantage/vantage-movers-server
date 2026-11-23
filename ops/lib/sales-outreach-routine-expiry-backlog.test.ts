import assert from "node:assert/strict";
import test from "node:test";
import { parseBacklogArgs } from "./sales-outreach-routine-expiry-backlog";

test("the backlog is a dry run unless --apply names a row limit", () => {
  assert.deepEqual(parseBacklogArgs(["--target=vantagemovers"]),
    { target: "vantagemovers", apply: false, limit: null, after: null, batch: 500, pause_ms: 250 });
  assert.equal(parseBacklogArgs(["--target=vantagemovers", "--apply", "--limit=5000"]).limit, 5000);
  for (const argv of [[], ["--target=vantagemovers", "--apply"], ["--target=vantagemovers", "--apply", "--limit=0"],
    ["--target=vantagemovers", "--batch=501"], ["--target=vantagemovers", "--limit=10"], ["--target=vantagemovers", "--after=nope"], ["--target=vantagemovers", "--delete"]])
    assert.throws(() => parseBacklogArgs(argv), Error, argv.join(" "));
});
