import { withLocalDatabase } from "./local-database";
import { AGENT_LOCAL, GRANOT_REHEARSAL, OperatorError, publicFailure, SHEET_REPLICA } from "./local-safety";
import { GRANOT_RUNBOOK, HELP, parseCommand, RUNBOOK, type Command } from "./commands";
import { inspectSheetSync, traceSheetSync } from "./sheet-sync";
import { traceGranotAction } from "./granot-trace";
import { testSheetSync } from "./test-command";

export async function executeCommand(command: Command): Promise<unknown> {
  if (command.target === "production") throw new OperatorError("production_diagnostics_unsupported_use_reviewed_operator_path", 4);
  if (command.name === "help") return { status: "available", help: HELP };
  if (command.name === "granot-runbook") return { status: "available", path: GRANOT_RUNBOOK };
  if (command.name === "granot-trace") {
    const identity = command.profile === "granot-rehearsal" ? GRANOT_REHEARSAL : AGENT_LOCAL;
    return withLocalDatabase(identity, async (db) => ({
      ...await traceGranotAction(db, command.run!, command.action!),
      target: "local", profile: command.profile,
      identity: { database: identity.database, replicaSet: identity.replicaSet, address: identity.address },
    }));
  }
  if (command.name === "services") return { status: "available", services: [{ name: "sheet-sync", commands: ["inspect", "trace", "test", "runbook"], production: "unsupported", repair: "unsupported", runbook: RUNBOOK },
      { name: "granot", commands: ["trace", "runbook"], production: "unsupported", repair: "unsupported", runbook: GRANOT_RUNBOOK }],
    remaining_services: "Use docs/operations/README.md; no CLI support is claimed for other services." };
  if (command.name === "runbook") return { status: "available", path: RUNBOOK };
  if (command.name === "test") return testSheetSync(command.suite!);
  const identity = command.profile === "sheet-replica" ? SHEET_REPLICA : AGENT_LOCAL;
  return withLocalDatabase(identity, async (db) => {
    const data = command.name === "doctor"
      ? (await db.collection("sheet_sync_jobs").findOne({}, { projection: { _id: 1 }, maxTimeMS: 2_000 }),
        { status: "ready", scope: "local_primary_identity_and_read_privilege_only", node: process.versions.node,
          providers: "not_loaded", application_health: "unknown", runbook: RUNBOOK })
      : command.name === "inspect" ? await inspectSheetSync(db) : await traceSheetSync(db, command.job!);
    return { ...data, target: "local", profile: command.profile,
      identity: { database: identity.database, replicaSet: identity.replicaSet, address: identity.address } };
  });
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  let command: Command | undefined;
  try {
    command = parseCommand(args);
    const result = await executeCommand(command);
    if (command.name === "help" && !command.json) process.stdout.write(HELP);
    else process.stdout.write(`${JSON.stringify(result, null, command.json ? 0 : 2)}\n`);
  } catch (error) {
    const { exitCode, ...failure } = publicFailure(error);
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = exitCode;
  }
}
if (require.main === module) void main();
