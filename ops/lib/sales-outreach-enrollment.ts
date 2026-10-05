/**
 * Argument handling for `ops/sales-outreach/enrollment.ts` (pure, unit-tested).
 *
 *   --target=<database>                 required; must equal the database this process resolves
 *   report | apply | verify             mode (default: report, read-only)
 *   --selection=backfill                the FAST-01 backfill scope from the persisted configuration (default)
 *   --leads=<file.json>                 explicit selection: a JSON array of {"model","id"} Lead refs
 *   --kind=expansion|pilot              enrollment kind (default expansion)
 *   --cohort=<id>                       cohort id (default <kind>:<New York date>)
 *   --run-key=<key>                     required for apply/verify; the run's idempotency identity
 *   --out=<file.json>                   also write the full report (selection + manifest) to a file
 */
export type EnrollmentCliArgs = Readonly<{
  target: string;
  mode: "report" | "apply" | "verify";
  selection: Readonly<{ mode: "backfill_scope" }> | Readonly<{ mode: "selected"; file: string }>;
  kind: "expansion" | "pilot";
  cohort_id: string | null;
  run_key: string | null;
  out: string | null;
}>;

const KEY = /^[A-Za-z0-9:._-]{1,120}$/;

export function parseEnrollmentArgs(argv: readonly string[]): EnrollmentCliArgs {
  let target: string | null = null;
  let mode: EnrollmentCliArgs["mode"] = "report";
  let selection: EnrollmentCliArgs["selection"] = { mode: "backfill_scope" };
  let kind: EnrollmentCliArgs["kind"] = "expansion";
  let cohort_id: string | null = null;
  let run_key: string | null = null;
  let out: string | null = null;
  const value = (arg: string, name: string) => arg.slice(name.length + 3).trim();
  for (const arg of argv) {
    if (arg === "report" || arg === "apply" || arg === "verify") mode = arg;
    else if (arg.startsWith("--target=")) target = value(arg, "target");
    else if (arg === "--selection=backfill") selection = { mode: "backfill_scope" };
    else if (arg.startsWith("--leads=")) selection = { mode: "selected", file: value(arg, "leads") };
    else if (arg.startsWith("--kind=")) {
      const k = value(arg, "kind");
      if (k !== "expansion" && k !== "pilot") throw new Error(`--kind must be expansion or pilot, not ${k}`);
      kind = k;
    } else if (arg.startsWith("--cohort=")) cohort_id = value(arg, "cohort");
    else if (arg.startsWith("--run-key=")) run_key = value(arg, "run-key");
    else if (arg.startsWith("--out=")) out = value(arg, "out");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (mode !== "report" && !run_key) throw new Error(`--run-key=<key> is required for ${mode}`);
  if (run_key !== null && !KEY.test(run_key)) throw new Error("--run-key may contain only letters, digits and : . _ - (max 120)");
  if (cohort_id !== null && !KEY.test(cohort_id)) throw new Error("--cohort may contain only letters, digits and : . _ - (max 120)");
  if (selection.mode === "selected" && !selection.file) throw new Error("--leads=<file.json> needs a path");
  return { target, mode, selection, kind, cohort_id, run_key, out };
}
