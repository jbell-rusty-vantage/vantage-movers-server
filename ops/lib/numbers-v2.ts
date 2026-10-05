/**
 * Pure halves of the All Numbers v2 operator scripts (`ops/numbers-v2/migrate.ts`, `cleanup.ts`):
 * argument parsing and the lead-link seed from the retained Number↔Lead attachments. No Mongo here,
 * so the rules are unit-tested without a database.
 */
export type NumbersV2Args = {
  target: string;
  apply: boolean;
  /** Re-run every non-purged number, not only the ones without `summary_version`. */
  all: boolean;
  /** Re-apply the attachment seed even on stamped numbers (overwrites link decisions made since). */
  reseed: boolean;
  /** Stop after this many numbers (a first trial); null = all. */
  limit: number | null;
  /** Resume after this Contact Number id (keyset). */
  after: string | null;
};

/**
 * `--target=<database>` is required and must equal the database this process resolves. Dry run by
 * default; `--apply` writes. Unknown flags are refused, except the production-writer guard's own
 * `--allow-schema-drift`.
 */
export function parseNumbersV2Args(argv: readonly string[], options: { allowed?: readonly string[] } = {}): NumbersV2Args {
  const allowed = new Set(options.allowed ?? ["--apply", "--all", "--reseed", "--limit", "--after"]);
  const args: NumbersV2Args = { target: "", apply: false, all: false, reseed: false, limit: null, after: null };
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    if (flag === "--target") args.target = (value ?? "").trim();
    else if (flag === "--allow-schema-drift") continue;
    else if (!allowed.has(flag)) throw new Error(`Unknown argument: ${arg}`);
    else if (flag === "--apply") args.apply = true;
    else if (flag === "--all") args.all = true;
    else if (flag === "--reseed") args.reseed = true;
    else if (flag === "--limit") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("--limit=<positive integer>");
      args.limit = n;
    } else if (flag === "--after") {
      if (!value || !/^[a-f\d]{24}$/i.test(value)) throw new Error("--after=<24-hex Contact Number id>");
      args.after = value;
    }
  }
  if (!args.target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(args.target)) throw new Error("--target must be a plain database name");
  return args;
}

type Ref = { model: "FormLead" | "CallLead"; id: unknown };
export type SeedEdge = {
  lead_ref: Ref;
  state: string;
  certainty?: string | null;
  decided_at?: Date | null;
  decided_by?: string | null;
};
export type LeadLinkSeed = {
  /** The Owner-confirmed attached Lead with the newest decision, pinned at that decision. */
  pin: { model: "FormLead" | "CallLead"; id: string; set_at: Date; set_by: string | null } | null;
  /** Leads the Owner rejected on this number. */
  excluded: Array<{ model: "FormLead" | "CallLead"; id: string }>;
};

/**
 * CONTRACT §5 phase A: `state: attached` with certainty `owner_confirmed` becomes an Owner pin at
 * `decided_at` (several: the newest decision wins); Owner-rejected edges become `excluded`.
 * Automatic, Exact and candidate edges seed nothing: the automatic rule recomputes them.
 */
export function seedLeadLinkFromAttachments(edges: readonly SeedEdge[]): LeadLinkSeed {
  const confirmed = edges
    .filter((edge) => edge.state === "attached" && edge.certainty === "owner_confirmed" && edge.decided_at)
    .sort((a, b) => +b.decided_at! - +a.decided_at! || String(b.lead_ref.id).localeCompare(String(a.lead_ref.id)));
  const top = confirmed[0];
  const pin = top ? { model: top.lead_ref.model, id: String(top.lead_ref.id), set_at: top.decided_at!, set_by: top.decided_by ?? null } : null;
  const excluded = new Map<string, { model: "FormLead" | "CallLead"; id: string }>();
  for (const edge of edges) {
    if (edge.state !== "rejected") continue;
    const ref = { model: edge.lead_ref.model, id: String(edge.lead_ref.id) };
    if (pin && pin.model === ref.model && pin.id === ref.id) continue;
    excluded.set(`${ref.model}:${ref.id}`, ref);
  }
  return { pin, excluded: [...excluded.values()].sort((a, b) => `${a.model}:${a.id}`.localeCompare(`${b.model}:${b.id}`)) };
}

/** Fields the phase B cleanup unsets from `contact_numbers` (CONTRACT §2 "Remove in phase B"). */
export const NUMBER_V1_FIELDS = [
  "kind",
  "classification",
  "classification_reason",
  "classification_set_by",
  "classification_set_at",
  "contact_eligibility",
  "rollups",
] as const;
