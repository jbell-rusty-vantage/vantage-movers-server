import { OperatorError } from "./local-safety";
import { DEFAULT_SAMPLE_LIMIT, RECONCILE_TAB_NAMES } from "./sheet-reconcile";

export const RUNBOOK = "docs/operations/sheet-sync.md";
export const GRANOT_RUNBOOK = "docs/operations/granot.md";
export const HELP = `Vantage service operator (no .env loaded)
pnpm vantage -- services
pnpm vantage -- doctor [--profile agent|sheet-replica] [--json]
pnpm vantage -- sheet-sync inspect --target local [--profile agent|sheet-replica] [--json]
pnpm vantage -- sheet-sync trace --job <24-hex-job-id> --target local [--profile agent|sheet-replica] [--json]
pnpm vantage -- sheet-sync reconcile --sheet-snapshot <file.json> [--tab <name>] [--samples <n>] [--json]
pnpm vantage -- sheet-sync reconcile --production-read [--tab <name>] [--samples <n>] [--json]
pnpm vantage -- granot trace --run <24-hex-run-id> --action <exact-action-id> --target local [--profile agent|granot-rehearsal] [--json]
pnpm vantage -- runbook granot
pnpm vantage -- test sheet-sync --suite fast|replica [--json]
pnpm vantage -- runbook sheet-sync [stalled]
reconcile: read-only two-way placement check of the Master Sheets (missing, wrong tab,
duplicate, orphan and excluded rows). Local target: agent replica + a workbook snapshot file.
--production-read reads production MongoDB (find) and Sheets (spreadsheets.get, values.get)
from this checkout's .env with TEST_MODE=false, prints what it will read, and writes nothing.
Calls and Duplicate Calls are Owner-managed: report only. Tabs: ${RECONCILE_TAB_NAMES.join(", ")}.
All other production inspection and all repairs are unsupported in this slice.
For JSON pipelines use pnpm --silent vantage -- <command> --json (suppresses pnpm banners).
Exit codes: 0 command completed (partial evidence stays labeled); 2 invalid usage;
3 unavailable/refused/permission denied; 4 unsupported; 5 test failed.
`;
export type Command = { name: "help" | "services" | "doctor" | "inspect" | "trace" | "reconcile" | "test" | "runbook" | "granot-trace" | "granot-runbook";
  json: boolean; profile: "agent" | "sheet-replica" | "granot-rehearsal"; run?: string; action?: string; target?: "local" | "production"; job?: string; suite?: "fast" | "replica";
  productionRead?: boolean; tab?: string; samples?: number; snapshot?: string };
export function parseCommand(input: string[]): Command {
  const args = input[0] === "--" ? input.slice(1) : [...input];
  const words: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    if (!["--json", "--help", "--target", "--profile", "--job", "--suite", "--run", "--action", "--production-read", "--tab", "--samples", "--sheet-snapshot"].includes(arg) || options.has(arg)) throw new OperatorError("invalid_arguments", 2);
    if (["--json", "--help", "--production-read"].includes(arg)) options.set(arg, "true");
    else {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new OperatorError("invalid_arguments", 2);
      options.set(arg, value);
    }
  }
  const path = words.join(" ");
  const names: Record<string, Command["name"]> = { "": "help", help: "help", services: "services", doctor: "doctor", "granot trace": "granot-trace", "runbook granot": "granot-runbook", "sheet-sync inspect": "inspect", "sheet-sync trace": "trace", "sheet-sync reconcile": "reconcile", "test sheet-sync": "test", "runbook sheet-sync": "runbook", "runbook sheet-sync stalled": "runbook" };
  const name = names[path];
  if (!name) throw new OperatorError("unsupported_command", 2);
  if (options.has("--help")) {
    if (options.size !== 1) throw new OperatorError("invalid_arguments", 2);
    return { name: "help", json: false, profile: "agent" };
  }
  const allowed: Record<Command["name"], string[]> = {
    help: ["--json"], services: ["--json"], runbook: ["--json"], doctor: ["--json", "--profile"],
    "granot-runbook": ["--json"], "granot-trace": ["--json", "--target", "--profile", "--run", "--action"],
    inspect: ["--json", "--target", "--profile"], reconcile: ["--json", "--target", "--production-read", "--tab", "--samples", "--sheet-snapshot"], trace: ["--json", "--target", "--profile", "--job"], test: ["--json", "--suite"],
  };
  if ([...options.keys()].some((key) => !allowed[name].includes(key))) throw new OperatorError("invalid_arguments", 2);
  if (name === "reconcile") return parseReconcile(options);
  const profile = options.get("--profile") ?? "agent";
  const target = options.get("--target");
  const job = options.get("--job");
  const suite = options.get("--suite");
  const run = options.get("--run")?.toLowerCase();
  const action = options.get("--action");
  const allowedProfiles = name === "granot-trace" ? ["agent", "granot-rehearsal"] : ["agent", "sheet-replica"];
  if (!allowedProfiles.includes(profile)
    || (name === "granot-trace" && (!run || !/^[0-9a-f]{24}$/.test(run) || !action ||
      action.trim() !== action || action.length > 275 || /[\p{Cc}\p{Cf}]/u.test(action)))
    || (["inspect", "trace", "granot-trace"].includes(name) && !["local", "production"].includes(target ?? ""))
    || (name === "trace" && !/^[a-fA-F0-9]{24}$/.test(job ?? ""))
    || (name === "test" && !["fast", "replica"].includes(suite ?? ""))) throw new OperatorError("invalid_arguments", 2);
  return { name, json: options.has("--json"), profile: profile as Command["profile"], target: target as Command["target"], job, ...(name === "granot-trace" ? { run, action } : {}), suite: suite as Command["suite"] };
}

function parseReconcile(options: Map<string, string>): Command {
  const productionRead = options.has("--production-read");
  const target = options.get("--target") ?? (productionRead ? "production" : "local");
  const tab = options.get("--tab");
  const samples = Number(options.get("--samples") ?? DEFAULT_SAMPLE_LIMIT);
  const snapshot = options.get("--sheet-snapshot");
  if (!["local", "production"].includes(target) || (productionRead && target !== "production") || (target === "production" && snapshot)
    || (tab !== undefined && !RECONCILE_TAB_NAMES.includes(tab))
    || !Number.isInteger(samples) || samples < 0 || samples > 10_000) throw new OperatorError("invalid_arguments", 2);
  return { name: "reconcile", json: options.has("--json"), profile: "agent", target: target as Command["target"], productionRead, tab, samples, snapshot };
}
