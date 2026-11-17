import { OperatorError } from "./local-safety";

export const GRANOT_RUNBOOK = "docs/operations/granot.md";
export const HELP = `pnpm vantage -- services
pnpm vantage -- runbook granot
pnpm vantage -- granot trace --run <run-id> --action <exact-action-id> --target local [--profile agent|granot-rehearsal] [--json]
`;
type Discovery = { name: "help" | "services" | "granot-runbook"; json: boolean };
type Trace = { name: "granot-trace"; json: boolean; target: "local" | "production"; profile: "agent" | "granot-rehearsal"; run: string; action: string };
export type Command = Discovery | Trace;

export function parseCommand(input: string[]): Command {
  const args = input[0] === "--" ? input.slice(1) : [...input];
  const words: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    if (!["--json", "--help", "--target", "--profile", "--run", "--action"].includes(arg) || options.has(arg)) throw new OperatorError("invalid_arguments", 2);
    if (["--json", "--help"].includes(arg)) options.set(arg, "true");
    else {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new OperatorError("invalid_arguments", 2);
      options.set(arg, value);
    }
  }
  const path = words.join(" ");
  const json = options.has("--json");
  if (["", "help", "services", "runbook granot"].includes(path)) {
    if ([...options.keys()].some(key => key !== "--json" && key !== "--help")) throw new OperatorError("invalid_arguments", 2);
    const name = options.has("--help") ? "help" : path === "services" ? "services" : path === "runbook granot" ? "granot-runbook" : "help";
    return { name, json };
  }
  if (path !== "granot trace") throw new OperatorError("unsupported_command", 2);
  if (options.size === 1 && options.has("--help")) return { name: "help", json };
  const run = options.get("--run")?.toLowerCase();
  const action = options.get("--action");
  const target = options.get("--target");
  const profile = options.get("--profile") ?? "agent";
  if (options.has("--help") || !run || !/^[a-f0-9]{24}$/.test(run) || !action ||
      action.trim() !== action || action.length > 275 || /[\p{Cc}\p{Cf}]/u.test(action) ||
      (target !== "local" && target !== "production") || (profile !== "agent" && profile !== "granot-rehearsal")) {
    throw new OperatorError("invalid_arguments", 2);
  }
  return { name: "granot-trace", json, run, action, target, profile };
}
