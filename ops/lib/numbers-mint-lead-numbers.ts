/**
 * Pure halves of `ops/numbers-v2/mint-lead-numbers.ts` (outreach lifecycle repair C2b): argument
 * parsing and the per-Lead decision. No Mongo here, so the rules are unit-tested without a database;
 * the writes are proven on the replica (`ops/numbers-v2/all-numbers.replica.test.ts`).
 */
import type { DirectoryLookup } from "../../src/services/numberActivity/directory";
import { leadNumberE164 } from "../../src/services/numberActivity/leadContactNumber";
import type { LeadModel, LeadRow } from "../../src/services/numberActivity/leadLink";
import { ALLOW_SCHEMA_DRIFT_FLAG } from "./production-writer-guard";

/** `desk`: the Leads of open desk subjects. `all`: every Call Lead. */
export const MINT_SCOPES = ["desk", "all"] as const;
export type MintScope = (typeof MINT_SCOPES)[number];
export type MintArgs = Readonly<{ target: string; scope: MintScope; apply: boolean; limit: number | null }>;

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --scope=desk|all         default desk
 *   --apply                  write (default: dry run, read-only)
 *   --limit=<n>              mint at most n numbers (a first trial); default all
 *   --allow-schema-drift     passed through to the production-writer guard
 */
export function parseMintArgs(argv: readonly string[]): MintArgs {
  let target = "";
  let scope: MintScope = "desk";
  let apply = false;
  let limit: number | null = null;
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    if (flag === "--target") target = (value ?? "").trim();
    else if (flag === "--apply" && value === null) apply = true;
    else if (flag === "--scope") {
      if (!(MINT_SCOPES as readonly string[]).includes(value ?? "")) throw new Error("--scope=desk|all");
      scope = value as MintScope;
    } else if (flag === "--limit") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("--limit=<positive integer>");
      limit = n;
    } else if (arg === ALLOW_SCHEMA_DRIFT_FLAG) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  return { target, scope, apply, limit };
}

export type MintSkip = "no_phone" | "company_number" | "duplicate" | "bad_lead";
export type MintDecision =
  | { kind: "skip"; reason: MintSkip }
  /** A number with this E.164 already exists (or an earlier Lead of this run mints it). */
  | { kind: "numbered"; e164: string }
  | { kind: "mint"; e164: string };

/** The ensure-function's input from a Lead row (live phone; a Call Lead's original caller as fallback). */
export function mintSourceOf(row: LeadRow) {
  return {
    _id: String(row._id),
    timestamp: row.timestamp ?? row.createdAt ?? null,
    duplicate: row.duplicate === true,
    bad_lead: row.bad_lead ? String(row.bad_lead) : null,
    normalized_phone_number: row.normalized_phone_number ?? null,
    original_caller_phone: row.ringcentral?.original_caller?.normalized_phone_number ?? null,
  };
}

/**
 * What the script does for one Lead: the same rules as `ensureLeadContactNumber` (skip Duplicates, Bad
 * Leads, no usable phone, our own DIDs; reuse an existing E.164), decided from a batch read of the
 * existing numbers. `planned` holds the E.164s an earlier Lead of this run mints, so two Leads on one
 * phone mint one number.
 */
export function decideLeadMint(model: LeadModel, row: LeadRow, existing: ReadonlySet<string>, planned: ReadonlySet<string>,
  directory: DirectoryLookup | null): MintDecision {
  const plan = leadNumberE164(model, mintSourceOf(row));
  if ("skip" in plan) return { kind: "skip", reason: plan.skip };
  if (existing.has(plan.e164) || planned.has(plan.e164)) return { kind: "numbered", e164: plan.e164 };
  if (directory?.companyNumberByE164(plan.e164)) return { kind: "skip", reason: "company_number" };
  return { kind: "mint", e164: plan.e164 };
}

export type MintTally = {
  leads_checked: number;
  /** The Lead's phone already has a Contact Number (nothing to mint; the lead link owns its link). */
  numbers_reused: number;
  numbers_to_create: number;
  skipped: Record<MintSkip, number>;
};

export const emptyMintTally = (): MintTally => ({
  leads_checked: 0, numbers_reused: 0, numbers_to_create: 0, skipped: { no_phone: 0, company_number: 0, duplicate: 0, bad_lead: 0 },
});

export function tallyMint(tally: MintTally, decision: MintDecision): void {
  tally.leads_checked += 1;
  if (decision.kind === "skip") tally.skipped[decision.reason] += 1;
  else if (decision.kind === "numbered") tally.numbers_reused += 1;
  else tally.numbers_to_create += 1;
}
