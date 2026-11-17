import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeCommand } from "./cli";
import { GRANOT_RUNBOOK, parseCommand } from "./commands";
import { AGENT_LOCAL, GRANOT_REHEARSAL, assertLocalIdentity, OperatorError } from "./local-safety";

const run = "1234567890abcdef12345678", action = "$literal:row #1";
const args = ["granot", "trace", "--target", "local", "--profile", "granot-rehearsal", "--run", run, "--action", action, "--json"];

test("Granot discovery and exact identifier command are available from onboarding", async () => {
  const parsed = parseCommand(args);
  assert.equal(parsed.name, "granot-trace");
  assert.equal(parsed.action, action);
  assert.equal(parsed.run, run);
  const result = await executeCommand(parseCommand(["runbook", "granot"]));
  assert.deepEqual(result, { status: "available", path: GRANOT_RUNBOOK });
  assert.match(readFileSync(GRANOT_RUNBOOK, "utf8"), /granot trace --run/);
});
test("Granot refuses unsupported production and bounded profile/argument mistakes", async () => {
  await assert.rejects(executeCommand(parseCommand(args.map((v) => v === "local" ? "production" : v))),
    (err) => err instanceof OperatorError && err.exitCode === 4);
  for (const bad of [
    args.slice(0, 6), args.map((v) => v === run ? "short" : v), args.map((v) => v === action ? "x".repeat(276) : v),
    args.map((v) => v === action ? "\u2066invisible" : v), args.map((v) => v === "granot-rehearsal" ? "sheet-replica" : v),
    [...args, "--repair"], [...args, "--run", run], ["granot", "trace", "--run", run, "--action", action],
  ]) assert.throws(() => parseCommand(bad));
  assert.doesNotThrow(() => assertLocalIdentity(GRANOT_REHEARSAL));
  assert.throws(() => assertLocalIdentity({ ...GRANOT_REHEARSAL, replicaSet: "sheetRecoveryProof" }));
  assert.throws(() => assertLocalIdentity({ ...AGENT_LOCAL, database: "vantagemovers" }));
});
