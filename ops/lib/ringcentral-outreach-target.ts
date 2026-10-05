/**
 * Pure argument handling for the Sales Outreach Desk RingCentral operator scripts
 * (`ops/ringcentral/outreach-subscriptions.ts`, `ops/ringcentral/prove-rep-sms-access.ts`).
 *
 * The target is named, never inferred: `--target=<RingCentral account id>` must equal the account
 * this process is configured for (`RINGCENTRAL_ACCOUNT_ID`), and scripts that read or write Mongo
 * also take `--database=<name>` that must equal the database this process resolves. A mismatch
 * refuses before any provider or database call.
 */
export type OutreachSubscriptionPurpose = "calls" | "rep_sms";
export type OutreachSubscriptionArgs = {
  target: string;
  database: string;
  purposes: OutreachSubscriptionPurpose[];
  apply: boolean;
};

export function parseOutreachSubscriptionArgs(argv: readonly string[]): OutreachSubscriptionArgs {
  let target: string | null = null;
  let database: string | null = null;
  let purpose = "all";
  let apply = false;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--database=")) database = arg.slice("--database=".length).trim();
    else if (arg.startsWith("--purpose=")) purpose = arg.slice("--purpose=".length).trim();
    else if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--allow-schema-drift") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target || !/^\d+$/.test(target)) throw new Error("--target=<RingCentral account id> is required (digits)");
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error("--database=<database name> is required");
  const purposes: OutreachSubscriptionPurpose[] =
    purpose === "all" ? ["calls", "rep_sms"] : purpose === "calls" || purpose === "rep_sms" ? [purpose] : [];
  if (!purposes.length) throw new Error("--purpose must be calls, rep_sms or all");
  return { target, database, purposes, apply };
}

export type ProofArgs = { target: string; database: string; sampleSince: Date | null };

export function parseProofArgs(argv: readonly string[], now: Date): ProofArgs {
  let target: string | null = null;
  let database: string | null = null;
  let sinceMinutes: number | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--database=")) database = arg.slice("--database=".length).trim();
    else if (arg.startsWith("--sent-within-minutes=")) {
      const value = Number(arg.slice("--sent-within-minutes=".length));
      if (!Number.isSafeInteger(value) || value < 1 || value > 24 * 60) throw new Error("--sent-within-minutes must be 1–1440");
      sinceMinutes = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target || !/^\d+$/.test(target)) throw new Error("--target=<RingCentral account id> is required (digits)");
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error("--database=<database name> is required");
  return { target, database, sampleSince: sinceMinutes === null ? null : new Date(now.getTime() - sinceMinutes * 60_000) };
}

export function assertNamedTarget(input: {
  target: string;
  configuredAccountId: string | null;
  database: string;
  resolvedDatabase: string;
}): void {
  if (!input.configuredAccountId) throw new Error("Refusing: RINGCENTRAL_ACCOUNT_ID is not configured for this process");
  if (input.target !== input.configuredAccountId)
    throw new Error(`Refusing: --target=${input.target} but this process is configured for RingCentral account ${input.configuredAccountId}`);
  if (input.database !== input.resolvedDatabase)
    throw new Error(`Refusing: --database=${input.database} but this process resolves the database "${input.resolvedDatabase}"`);
}
