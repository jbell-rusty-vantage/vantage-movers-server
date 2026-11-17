import { AGENT_LOCAL, GRANOT_REHEARSAL, OperatorError, publicFailure } from "./local-safety";
import { GRANOT_RUNBOOK, HELP, parseCommand, type Command } from "./commands";
import { withLocalDatabase } from "./local-database";
import { traceGranotAction } from "./granot-trace";

export async function executeCommand(command: Command): Promise<unknown> {
  if (command.name === "help") return { status: "available", help: HELP };
  if (command.name === "granot-runbook") return { status: "available", path: GRANOT_RUNBOOK };
  if (command.name === "granot-trace") {
    if (command.target === "production") throw new OperatorError("production_diagnostics_unsupported_use_reviewed_operator_path", 4);
    const identity = command.profile === "granot-rehearsal" ? GRANOT_REHEARSAL : AGENT_LOCAL;
    return withLocalDatabase(identity, async db => ({
      ...await traceGranotAction(db, command.run, command.action),
      target: "local", profile: command.profile,
      identity: { database: identity.database, replicaSet: identity.replicaSet, address: identity.address },
    }));
  }
  return { status: "available", services: [{ name: "granot", commands: ["trace", "runbook"],
    production: "unsupported", repair: "unsupported", runbook: GRANOT_RUNBOOK }] };
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
