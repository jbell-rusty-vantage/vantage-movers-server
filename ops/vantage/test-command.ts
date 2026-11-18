import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_LOCAL, localChildEnvironment, OperatorError, SHEET_REPLICA } from "./local-safety";
import { withLocalDatabase } from "./local-database";

/** Only the scrubbed synthetic child output reaches this local file; never a parent/driver error. */
export function saveTestFailure(stdout: string, stderr: string): string {
  const directory = mkdtempSync(join(tmpdir(), "vantage-synthetic-proof-"));
  const path = join(directory, "failure.log");
  writeFileSync(path, Buffer.from(`${stdout}\n${stderr}`).subarray(0, 2_000_000), { mode: 0o600, flag: "wx" });
  return path;
}

export function sheetTestInvocation(suite: "fast" | "replica", parent: NodeJS.ProcessEnv) {
  const identity = suite === "replica" ? SHEET_REPLICA : AGENT_LOCAL;
  return {
    executable: process.execPath,
    args: suite === "replica" ? ["--import", "tsx", "ops/sheet-sync-recovery/replica.ts"]
      : ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", "--test-reporter=tap", "src/services/sheetSync/**/*.test.ts"],
    env: localChildEnvironment(parent, identity),
    cwd: resolve(__dirname, "../.."),
  };
}
export async function testSheetSync(suite: "fast" | "replica") {
  if (suite === "replica") await withLocalDatabase(SHEET_REPLICA, async (db) => {
    // A read privilege failure must stop before the harness can import models/build indexes.
    await db.collection("sheet_sync_jobs").findOne({}, { projection: { _id: 1 }, maxTimeMS: 2_000 });
  });
  const invocation = sheetTestInvocation(suite, process.env);
  const output = await new Promise<string>((resolveOutput, reject) => {
    execFile(invocation.executable, invocation.args, {
      env: invocation.env, cwd: invocation.cwd, shell: false, timeout: 180_000, maxBuffer: 2_000_000,
    }, (error, stdout, stderr) => {
      if (error) {
        let evidenceFile: string | undefined;
        try { evidenceFile = saveTestFailure(stdout, stderr); } catch { /* A failed log must not mask the proof failure. */ }
        reject(new OperatorError("sheet_sync_test_failed_output_redacted", 5, evidenceFile));
      }
      else resolveOutput(stdout);
    });
  });
  const pass = suite === "replica" ? (output.match(/^PASS /gm) ?? []).length
    : Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
  const skipped = Number(output.match(/^# skipped (\d+)$/m)?.[1] ?? 0);
  if (!pass || skipped) throw new OperatorError("sheet_sync_test_missing_proof", 5);
  return { status: "passed", suite, passed: pass, skipped,
    effects: suite === "replica" ? "isolated PID database created and dropped; synthetic workbook only" : "offline test mocks" };
}
