/**
 * Outreach lifecycle repair C2a: why open desk subjects have no callable number (read-only diagnostic).
 * `ops/sales-outreach/subjects-without-numbers.ts` is the CLI.
 *
 * Two populations, classified with the All Numbers link rules (CONTRACT §3, `numberActivity/leadLink.ts`):
 * - `contact_number_ids` empty, with one reason (first match wins, in this order):
 *   `lead_missing` (the Lead row is gone), `no_phone` (no phone path), `phone_not_e164` (a phone path
 *   that forms no E.164), `company_number` (every E.164 is one of our DIDs), `lead_not_candidate` (a
 *   Duplicate or Bad Lead: never a link candidate), `no_contact_number` (no row for any E.164; C2b mints
 *   it), `number_purged`, `stale_subject` (a number's link holds the Lead but the subject was not
 *   re-synced: desk-resync drift), `excluded_by_owner` (the Owner unlinked the Lead), `link_truncated`
 *   (the number lists `OTHER_LEADS_MAX` other Leads and this one is beyond them), `link_pending` (the
 *   number exists and the Lead is a candidate, but the link was not recomputed yet);
 * - `contact_number_ids` non-empty but the Lead is no number's `lead`: `shadowed`, with the shadowing
 *   Lead's state (`active_subject` = a non-closed desk subject, `closed_subject`, `not_enrolled`, or
 *   `no_lead` when the subject's numbers have no Lead at all). Calls to those numbers never credit it.
 *
 * Read-only by construction (the `DeskStateReader` of OPS-0 plus its driver guard in the CLI). The output
 * is counts plus at most `LISTED_ROWS` rows of ids, the received time, the reason and the phone masked to
 * its last four digits; no name, no full phone.
 */
import type { Document, ObjectId } from "mongodb";
import { SALES_OUTREACH_LEAD_MODELS } from "../../src/config/domain/salesOutreach";
import { buildDirectoryLookup, type DirectoryLookup } from "../../src/services/numberActivity/directory";
import { leadPhoneE164s, OTHER_LEADS_MAX, type LeadRow } from "../../src/services/numberActivity/leadLink";
import { LEAD_COLLECTIONS, type DeskStateReader } from "./sales-outreach-desk-state";

export const NUMBERLESS_REASONS = [
  "lead_missing", "no_phone", "phone_not_e164", "company_number", "lead_not_candidate", "no_contact_number", "number_purged",
  "stale_subject", "excluded_by_owner", "link_truncated", "link_pending",
] as const;
export type NumberlessReason = (typeof NUMBERLESS_REASONS)[number];
export const SHADOW_STATES = ["active_subject", "closed_subject", "not_enrolled", "no_lead"] as const;
export type ShadowState = (typeof SHADOW_STATES)[number];
/** Rows listed in the output (the counts cover every subject). */
export const LISTED_ROWS = 200;
/** Subjects per page (the reader caps a find at 1,000). */
export const SUBJECT_PAGE = 500;

export type DiagnosticArgs = Readonly<{ target: string; out: string | null; pretty: boolean }>;

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --out=<file.json>        also write the summary to this file
 *   --pretty                 indent the JSON
 * There is no write mode, so no `--apply`; unknown flags are refused.
 */
export function parseDiagnosticArgs(argv: readonly string[]): DiagnosticArgs {
  let target: string | null = null;
  let out: string | null = null;
  let pretty = false;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length).trim();
    else if (arg === "--pretty") pretty = true;
    else if (arg === "--apply") throw new Error("subjects-without-numbers is read-only; there is no --apply");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (out !== null && !out) throw new Error("--out=<file.json> needs a path");
  return { target, out, pretty };
}

/** `+12025550100` → `…0100`. */
export const maskE164 = (e164: string | null | undefined): string | null => (e164 ? `…${e164.replace(/\D/g, "").slice(-4)}` : null);

const LEAD_PHONE_PATHS = ["normalized_phone_number", "ingested_contact_snapshot.normalized_phone_number",
  "granot_contact_snapshot.normalized_phone_number", "ringcentral.original_caller.normalized_phone_number"] as const;
/** Lead fields the classification reads (phones stay in memory; only the masked tail is printed). */
export const DIAGNOSTIC_LEAD_PROJECTION = { _id: 1, timestamp: 1, duplicate: 1, bad_lead: 1, ...Object.fromEntries(LEAD_PHONE_PATHS.map((p) => [p, 1])) };

const pathValue = (row: Document, path: string): unknown => path.split(".").reduce<unknown>((value, key) =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
const hasAnyPhonePath = (row: Document) => LEAD_PHONE_PATHS.some((path) => {
  const value = pathValue(row, path);
  return typeof value === "string" && value.trim().length > 0;
});

export type DiagnosticNumber = {
  _id: unknown;
  e164: string;
  purged_at?: Date | null;
  lead?: { model: string; id: unknown } | null;
  other_leads?: Array<{ model: string; id: unknown }>;
  lead_link?: { excluded?: Array<{ model: string; id: unknown }> } | null;
};
const same = (a: { model: string; id: unknown } | null | undefined, model: string, id: unknown) => Boolean(a && a.model === model && String(a.id) === String(id));
const holds = (number: DiagnosticNumber, model: string, id: unknown) =>
  same(number.lead, model, id) || (number.other_leads ?? []).some((lead) => same(lead, model, id));

/**
 * The reason a subject with no `contact_number_ids` has none. Pure. `numbersByE164` holds every stored
 * number for the Lead's E.164s (purged rows included).
 */
export function classifyNumberless(input: {
  lead_model: string;
  lead_id: unknown;
  lead: Document | null;
  numbersByE164: ReadonlyMap<string, DiagnosticNumber>;
  directory: DirectoryLookup | null;
}): { reason: NumberlessReason; e164: string | null } {
  const { lead, lead_model: model, lead_id: id } = input;
  if (!lead) return { reason: "lead_missing", e164: null };
  if (!hasAnyPhonePath(lead)) return { reason: "no_phone", e164: null };
  const e164s = leadPhoneE164s(lead as LeadRow);
  if (!e164s.length) return { reason: "phone_not_e164", e164: null };
  const external = e164s.filter((e164) => !input.directory?.companyNumberByE164(e164));
  if (!external.length) return { reason: "company_number", e164: e164s[0]! };
  const first = external[0]!;
  if (lead.duplicate === true || lead.bad_lead) return { reason: "lead_not_candidate", e164: first };
  const numbers = external.map((e164) => input.numbersByE164.get(e164)).filter((n): n is DiagnosticNumber => Boolean(n));
  if (!numbers.length) return { reason: "no_contact_number", e164: first };
  const live = numbers.filter((number) => !number.purged_at);
  if (!live.length) return { reason: "number_purged", e164: numbers[0]!.e164 };
  const holding = live.find((number) => holds(number, model, id));
  if (holding) return { reason: "stale_subject", e164: holding.e164 };
  const excluded = live.find((number) => (number.lead_link?.excluded ?? []).some((lead) => same(lead, model, id)));
  if (excluded) return { reason: "excluded_by_owner", e164: excluded.e164 };
  const full = live.find((number) => (number.other_leads ?? []).length >= OTHER_LEADS_MAX);
  if (full) return { reason: "link_truncated", e164: full.e164 };
  return { reason: "link_pending", e164: live[0]!.e164 };
}

/** The Lead that holds the subject's numbers when it is no number's `lead` (null: the subject is credited). */
export function shadowingLead(lead_model: string, lead_id: unknown, numbers: readonly DiagnosticNumber[]):
  { shadowed: false } | { shadowed: true; lead: { model: string; id: unknown } | null; e164: string | null } {
  const live = numbers.filter((number) => !number.purged_at);
  if (live.some((number) => same(number.lead, lead_model, lead_id))) return { shadowed: false };
  const sorted = [...live].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const withLead = sorted.find((number) => number.lead);
  return { shadowed: true, lead: withLead?.lead ?? null, e164: (withLead ?? sorted[0])?.e164 ?? null };
}

export type DiagnosticRow = {
  subject_id: string;
  status: string;
  lead_model: string;
  lead_id: string;
  received_at: string | null;
  reason: NumberlessReason | "shadowed";
  shadow_state: ShadowState | null;
  e164_masked: string | null;
};

export type DiagnosticSummary = {
  database: string;
  generated_at: string;
  directory_loaded: boolean;
  open_subjects_checked: number;
  without_numbers: { total: number; by_reason: Record<NumberlessReason, number>; by_status: Record<string, number> };
  shadowed: { total: number; by_state: Record<ShadowState, number> };
  /** Plan §2 C2 acceptance: 0 active subjects with `contact_number_ids: []` whose Lead has a usable, external, candidate phone. */
  active_without_number_lead_has_phone: number;
  rows: DiagnosticRow[];
  rows_truncated: boolean;
};

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
/** Reasons that mean the Lead has a phone that could be (or is) a Contact Number. */
const PHONE_REASONS: ReadonlySet<NumberlessReason> = new Set(["no_contact_number", "number_purged", "stale_subject", "excluded_by_owner",
  "link_truncated", "link_pending"]);

async function loadDirectory(reader: DeskStateReader, account: string | null): Promise<DirectoryLookup | null> {
  const [row] = await reader.find("ringcentral_directory_snapshots", account ? { provider_account_id: account } : {},
    { projection: { _id: 1, provider_account_id: 1, taken_at: 1, extensions: 1, company_numbers: 1, queues: 1 }, sort: { taken_at: -1 }, limit: 1 });
  if (!row) return null;
  return buildDirectoryLookup({ _id: row._id, provider_account_id: row.provider_account_id, taken_at: row.taken_at,
    extensions: row.extensions ?? [], company_numbers: row.company_numbers ?? [], queues: row.queues ?? [] });
}

const NUMBER_PROJECTION = { _id: 1, e164: 1, purged_at: 1, "lead.model": 1, "lead.id": 1, "other_leads.model": 1, "other_leads.id": 1,
  "lead_link.excluded": 1 };

export async function collectSubjectsWithoutNumbers(reader: DeskStateReader,
  context: { database: string; now: Date; account: string | null }): Promise<DiagnosticSummary> {
  const directory = await loadDirectory(reader, context.account);
  const byReason = zero(NUMBERLESS_REASONS);
  const byShadow = zero(SHADOW_STATES);
  const byStatus: Record<string, number> = {};
  const rows: DiagnosticRow[] = [];
  let rowsTruncated = false;
  let checked = 0;
  let activeLeadHasPhone = 0;
  const push = (row: DiagnosticRow) => {
    if (rows.length < LISTED_ROWS) rows.push(row);
    else rowsTruncated = true;
  };

  let after: ObjectId | null = null;
  for (;;) {
    const subjects = await reader.find("sales_outreach_subjects", { status: { $ne: "closed" }, ...(after ? { _id: { $gt: after } } : {}) },
      { projection: { _id: 1, status: 1, lead_model: 1, lead_id: 1, received_at: 1, contact_number_ids: 1 }, sort: { _id: 1 }, limit: SUBJECT_PAGE });
    if (!subjects.length) break;
    after = subjects.at(-1)!._id as ObjectId;
    checked += subjects.length;
    const empty = subjects.filter((s) => !Array.isArray(s.contact_number_ids) || s.contact_number_ids.length === 0);
    const linked = subjects.filter((s) => Array.isArray(s.contact_number_ids) && s.contact_number_ids.length > 0);

    // Subjects without numbers: their Leads, then every stored number for the Leads' E.164s.
    const leads = new Map<string, Document>();
    for (const model of SALES_OUTREACH_LEAD_MODELS) {
      const ids = empty.filter((s) => s.lead_model === model).map((s) => s.lead_id);
      if (ids.length) for (const lead of await reader.find(LEAD_COLLECTIONS[model], { _id: { $in: ids } }, { projection: DIAGNOSTIC_LEAD_PROJECTION, limit: ids.length }))
        leads.set(`${model}:${String(lead._id)}`, lead);
    }
    const e164s = [...new Set([...leads.values()].flatMap((lead) => leadPhoneE164s(lead as LeadRow)))];
    const numbersByE164 = new Map<string, DiagnosticNumber>();
    for (let i = 0; i < e164s.length; i += SUBJECT_PAGE)
      for (const number of await reader.find("contact_numbers", { e164: { $in: e164s.slice(i, i + SUBJECT_PAGE) } }, { projection: NUMBER_PROJECTION, limit: SUBJECT_PAGE }))
        numbersByE164.set(String(number.e164), number as unknown as DiagnosticNumber);
    for (const subject of empty) {
      const lead = leads.get(`${String(subject.lead_model)}:${String(subject.lead_id)}`) ?? null;
      const { reason, e164 } = classifyNumberless({ lead_model: subject.lead_model, lead_id: subject.lead_id, lead, numbersByE164, directory });
      byReason[reason] += 1;
      byStatus[String(subject.status)] = (byStatus[String(subject.status)] ?? 0) + 1;
      if (subject.status === "active" && PHONE_REASONS.has(reason)) activeLeadHasPhone += 1;
      push({ subject_id: String(subject._id), status: String(subject.status), lead_model: String(subject.lead_model), lead_id: String(subject.lead_id),
        received_at: iso(subject.received_at), reason, shadow_state: null, e164_masked: maskE164(e164) });
    }

    // Subjects with numbers: shadowed when their Lead is no number's `lead`.
    const numbersById = new Map<string, DiagnosticNumber>();
    const idValues = linked.flatMap((s) => s.contact_number_ids as ObjectId[]);
    const unique = [...new Map(idValues.map((id) => [String(id), id])).values()];
    for (let i = 0; i < unique.length; i += SUBJECT_PAGE)
      for (const number of await reader.find("contact_numbers", { _id: { $in: unique.slice(i, i + SUBJECT_PAGE) } }, { projection: NUMBER_PROJECTION, limit: SUBJECT_PAGE }))
        numbersById.set(String(number._id), number as unknown as DiagnosticNumber);
    const shadows = linked.map((subject) => ({ subject, shadow: shadowingLead(subject.lead_model, subject.lead_id,
      (subject.contact_number_ids as unknown[]).map((id) => numbersById.get(String(id))).filter((n): n is DiagnosticNumber => Boolean(n))) }))
      .filter((entry) => entry.shadow.shadowed) as Array<{ subject: Document; shadow: { shadowed: true; lead: { model: string; id: unknown } | null; e164: string | null } }>;
    const shadowLeads = shadows.map((entry) => entry.shadow.lead).filter((lead): lead is { model: string; id: unknown } => Boolean(lead));
    const shadowSubjects = new Map<string, string>();
    for (let i = 0; i < shadowLeads.length; i += SUBJECT_PAGE) {
      const batch = shadowLeads.slice(i, i + SUBJECT_PAGE);
      for (const row of await reader.find("sales_outreach_subjects", { $or: batch.map((lead) => ({ lead_model: lead.model, lead_id: lead.id })) },
        { projection: { _id: 0, lead_model: 1, lead_id: 1, status: 1 }, limit: batch.length }))
        shadowSubjects.set(`${String(row.lead_model)}:${String(row.lead_id)}`, String(row.status));
    }
    for (const { subject, shadow } of shadows) {
      const status = shadow.lead ? shadowSubjects.get(`${shadow.lead.model}:${String(shadow.lead.id)}`) : undefined;
      const state: ShadowState = !shadow.lead ? "no_lead" : status === undefined ? "not_enrolled" : status === "closed" ? "closed_subject" : "active_subject";
      byShadow[state] += 1;
      push({ subject_id: String(subject._id), status: String(subject.status), lead_model: String(subject.lead_model), lead_id: String(subject.lead_id),
        received_at: iso(subject.received_at), reason: "shadowed", shadow_state: state, e164_masked: maskE164(shadow.e164) });
    }
    if (subjects.length < SUBJECT_PAGE) break;
  }

  return {
    database: context.database,
    generated_at: context.now.toISOString(),
    directory_loaded: Boolean(directory),
    open_subjects_checked: checked,
    without_numbers: { total: Object.values(byReason).reduce((a, b) => a + b, 0), by_reason: byReason, by_status: byStatus },
    shadowed: { total: Object.values(byShadow).reduce((a, b) => a + b, 0), by_state: byShadow },
    active_without_number_lead_has_phone: activeLeadHasPhone,
    rows,
    rows_truncated: rowsTruncated,
  };
}
