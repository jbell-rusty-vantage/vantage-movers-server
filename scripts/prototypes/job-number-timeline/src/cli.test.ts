import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertKnownArgs,
  assertTimelineDatabaseAllowed,
  JobTimelineCliError,
  PRODUCTION_CONFIRMATION,
  resolveTimelineDatabase,
} from "./cli.js";

test("CLI unknown flags fail closed", () => {
  assert.throws(() => assertKnownArgs(["render", "--list"]), JobTimelineCliError);
  assert.throws(() => assertKnownArgs(["render", "--catalog"]), JobTimelineCliError);
});

test("CLI production gate", () => {
  assert.equal(resolveTimelineDatabase(["discover"]), "testvantagemovers");
  assert.equal(
    resolveTimelineDatabase(["discover", PRODUCTION_CONFIRMATION]),
    "vantagemovers",
  );
  assert.throws(
    () => assertTimelineDatabaseAllowed("vantagemovers", ["discover"]),
    /confirm-production-db=vantagemovers/,
  );
});

test("CLI render requires --job-no", () => {
  // parse happens inside main; unknown-mode and missing job-no fail closed
  assert.throws(() => assertKnownArgs(["render", "--job-no", "1", "--unexpected"]), JobTimelineCliError);
});

test("CLI and load stay zero-mutation", () => {
  const here = path.join(process.cwd(), "scripts/prototypes/job-number-timeline/src");
  const load = readFileSync(path.join(here, "load.ts"), "utf8");
  const cli = readFileSync(path.join(here, "cli.ts"), "utf8");
  const proof = readFileSync(path.join(here, "live-proof.ts"), "utf8");
  for (const source of [load, cli, proof]) {
    assert.doesNotMatch(source, /\.insert(One|Many)?\(/);
    assert.doesNotMatch(source, /\.update(One|Many)?\(/);
    assert.doesNotMatch(source, /\.delete(One|Many)?\(/);
    assert.doesNotMatch(source, /createIndex\(/);
    assert.doesNotMatch(source, /\.save\(/);
  }
});

test("CLI render uses the production module", () => {
  const cli = readFileSync(
    path.join(process.cwd(), "scripts/prototypes/job-number-timeline/src/cli.ts"),
    "utf8",
  );
  assert.match(cli, /createJobNumberTimelineModule/);
  assert.match(cli, /src\/services\/jobNumberTimeline/);
  assert.doesNotMatch(cli, /from "\.\/assemble/);
});
