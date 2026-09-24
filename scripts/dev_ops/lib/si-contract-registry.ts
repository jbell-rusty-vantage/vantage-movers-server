/**
 * Route registry for the Sales Intelligence contract freezes CF1–CF4 (TEAM-1 §5).
 *
 * One entry per Owner read a stage added or changed: the calls to make for each seeded state
 * (`si_seed_manifest` labels), the exact server Zod schema that validates the response, optional
 * production-Admin schemas that must also parse it (flag-off compatibility), and content checks that
 * turn "the field is optional in the schema" into "the fixture actually carries it".
 *
 * `mode: "on"` entries are captured with `SALES_INTELLIGENCE_ATTENTION_V2=true` and
 * `SALES_INTELLIGENCE_TIMELINE_V2=true` on the local API and a snapshot published with the flag on;
 * `mode: "off"` entries with both flags off and a flag-off snapshot, into `contracts/<Sn>/flag-off/`.
 *
 * Every schema is resolved from its real export; a missing export throws (no loose fallback).
 * The two exceptions are documented in `si-contract-schemas.ts`: `GET /analysis-runs/:id` (the server
 * exports no schema) and status/header fixtures (media, flag-off Outreach timeline).
 */
import type { ZodType } from "zod";
import type { SiManifestRow } from "./si-contract-common";

// "AC" is CF-AC's stage (Team 4, Attention evolution / Case File). AC0-SEED (2026-09-23) adds it here
// as a stub only: `ROUTES` gets its entries once AC2's new reads exist. `routesFor("AC", mode)`
// correctly returns `[]` until then, which `capture-si-contract.ts` already reports as "no entries".
// "S5c" is CF5c (Team 3, SEED-T3 2026-09-24): capture reconciliation (reconciliation addendum §3.7).
// "S8" is CF8 (Team 3, S8-REP): every Sales Intelligence route called as a rep, in and out of scope, the rep commands and the Owner's same reads.
export type Stage = "S1" | "S2" | "S3" | "S4" | "AC" | "S5c" | "S6" | "S7" | "S8" | "S9";
export type Mode = "on" | "off";
/** A follow-up call built from the previous response (cursor paging). */
export type ChainCall = { state: string; next: (body: any) => string | null };
export type CaptureCall = {
  state: string;
  path: string;
  /** Expected HTTP status (default 200). A non-200 call is stored as a status fixture `{status, headers, body}`; a non-JSON body (audio) is never stored. */
  expect?: number;
  /** Extra request headers (e.g. `Range`). */
  headers?: Record<string, string>;
  chain?: ChainCall[];
  /** CF8: a command call (default GET). A call with a body is stored with its `request` (method, path, body). */
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** CF8: `command` sends the call to `--command-base` (a disposable copy of the seed), so the read fixtures stay stable. */
  target?: "command";
};
/**
 * CF8: what a stage needs beyond the manifest rows, read from the seed database by the capture: the seeded Agents by name, and
 * the follow-ups the rep commands act on (`{ id, revision }` by role). Stages before S8 ignore it.
 */
export type CaptureEnv = { agents: Record<string, string>; followups: Record<string, { id: string; revision: number } | null> };
export type ResolvedSchema = { schema: ZodType; name: string; source: "server" | "script-local" | "admin@539a628" };
export type CheckContext = { rows: readonly SiManifestRow[] | null; state: string; file: string; agents?: Record<string, string> | null };
export type RouteEntry = {
  stage: Stage;
  mode: Mode;
  /** File prefix: `<slug>__<state>.json`. Unique per (stage, mode). */
  slug: string;
  /** Route template and the params the calls use, for CONTRACT.md. */
  route: string;
  params: string;
  /** `read` fixtures are `{ok: true, as_of, coverage, data}`; `status` fixtures are `{status, headers, body}`. */
  /**
   * CF5c: `script` fixtures have the `read` envelope but are written by `capture-si-s5c-local.ts`, not by an HTTP
   * call. The HTTP capture skips them; the fixture test validates them like reads.
   */
  kind: "read" | "status" | "script";
  calls: (rows: readonly SiManifestRow[], env: CaptureEnv) => CaptureCall[];
  schema: () => Promise<ResolvedSchema>;
  /** Production Admin consumer schemas that must parse the same fixture (non-strict, as the Admin parses). */
  admin?: Array<() => Promise<ResolvedSchema>>;
  /** Content assertions; each returned string is a failure. */
  checks?: (body: any, ctx: CheckContext) => string[];
};

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
const stateOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fixed = (list: CaptureCall[]) => () => list;
const perRow = (pick: (row: SiManifestRow) => Array<Omit<CaptureCall, "state"> & { suffix?: string }>) => (rows: readonly SiManifestRow[]) =>
  rows.flatMap(row => pick(row).map(({ suffix, ...call }) => ({ ...call, state: `${stateOf(row.label)}${suffix ? `-${suffix}` : ""}` })));
const byLabel = (rows: readonly SiManifestRow[], label: string) => rows.find(row => row.label === label) ?? null;
const q = (value: string) => encodeURIComponent(value);
/** One call per distinct Number (two Leads can share a phone). */
const perNumber = (pick: (row: SiManifestRow, numberId: string) => Array<Omit<CaptureCall, "state"> & { suffix?: string }>) => (rows: readonly SiManifestRow[]) => {
  const seen = new Set<string>();
  return perRow(row => {
    if (!row.contact_number_id || seen.has(row.contact_number_id)) return [];
    seen.add(row.contact_number_id);
    return pick(row, row.contact_number_id);
  })(rows);
};
const isoAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

type Mod = Record<string, unknown>;
const load = {
  siDto: () => import("../../../src/services/salesIntelligence/dto") as Promise<Mod>,
  detailDto: () => import("../../../src/services/salesIntelligence/outreach/detailDto") as Promise<Mod>,
  assessmentDto: () => import("../../../src/services/salesIntelligence/assessment/dto") as Promise<Mod>,
  numberDto: () => import("../../../src/services/numberActivity/dto") as Promise<Mod>,
  findings: () => import("../../../src/services/salesIntelligence/analysis/currentFindings") as Promise<Mod>,
  conversations: () => import("../../../src/services/salesIntelligence/analysis/ownerConversations") as Promise<Mod>,
  local: () => import("./si-contract-schemas") as Promise<Mod>,
};
async function exported(loader: () => Promise<Mod>, key: string, from: string): Promise<ZodType> {
  const value = (await loader())[key] as ZodType | undefined;
  if (!value || typeof (value as { safeParse?: unknown }).safeParse !== "function") throw new Error(`${key} is not exported by ${from}`);
  return value;
}
/** `ownerReadSchema(<export>)` from the server. */
const ownerReadOf = (loader: () => Promise<Mod>, key: string, from: string) => async (): Promise<ResolvedSchema> => {
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  return { schema: ownerReadSchema(await exported(loader, key, from)), name: `ownerReadSchema(${key})`, source: "server" };
};
const serverSchema = (loader: () => Promise<Mod>, key: string, from: string) => async (): Promise<ResolvedSchema> =>
  ({ schema: await exported(loader, key, from), name: key, source: "server" });
const adminSchema = (key: "attentionSchema" | "timelineSchema" | "numberSearchSchema" | "outreachReadSchema" | "ownerCoverageSchema" | "numberSchema") => async (): Promise<ResolvedSchema> =>
  ({ schema: await exported(load.local, key, "si-contract-schemas.ts"), name: `admin ${key}`, source: "admin@539a628" });

/** `GET /outreach/:id`: `data.outreach` is the strict detail DTO; instructions and nudges keep their pre-existing (untyped) contracts. */
async function outreachReadSchema(): Promise<ResolvedSchema> {
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  const { z } = await import("zod");
  const detail = await exported(load.detailDto, "outreachDetailDtoSchema", "outreach/detailDto.ts");
  return { schema: ownerReadSchema(z.object({ outreach: detail, owner_instructions: z.array(z.unknown()), nudges: z.unknown() }).strict()),
    name: "ownerReadSchema({ outreach: outreachDetailDtoSchema, owner_instructions, nudges })", source: "server" };
}
async function ownerRunSchema(): Promise<ResolvedSchema> {
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  return { schema: ownerReadSchema(await exported(load.local, "ownerRunDataSchema", "si-contract-schemas.ts")),
    name: "ownerReadSchema(ownerRunDataSchema) — script-local, the server exports no schema for readOwnerRun", source: "script-local" };
}
const statusSchema = (status: number, code?: string, error?: string) => async (): Promise<ResolvedSchema> => {
  const local = await load.local() as { statusFixtureSchema: (s: number, b?: ZodType) => ZodType; errorBodySchema: (c: string, e?: string) => ZodType };
  const { z } = await import("zod");
  return { schema: local.statusFixtureSchema(status, code ? local.errorBodySchema(code, error) : z.null()),
    name: `status ${status}${code ? ` ${code}` : ""}${error ? ` "${error}"` : ""}`, source: "script-local" };
};

// ── content checks ──────────────────────────────────────────────────────────────────────────
const has = (value: unknown, key: string) => value !== null && typeof value === "object" && key in (value as object);
const items = (body: any): any[] => (Array.isArray(body?.data?.items) ? body.data.items : []);
function attentionRowsCarryS1(body: any): string[] {
  const out: string[] = [];
  for (const [i, row] of items(body).entries()) {
    if (row.outreach && !has(row.outreach, "facts")) out.push(`items[${i}].outreach.facts missing`);
    if (row.sort_keys && (!has(row.sort_keys, "last_call") || !has(row.sort_keys, "interactions"))) out.push(`items[${i}].sort_keys.last_call/interactions missing`);
  }
  return out;
}
function attentionRowsCarryS2(body: any, closed: boolean): string[] {
  const out: string[] = [];
  for (const [i, row] of items(body).entries()) {
    if (!row.outreach) continue;
    if (!has(row, "partition") || !has(row, "filter_keys")) out.push(`items[${i}] partition/filter_keys missing`);
    if (closed && (row.partition !== "closed" || !row.outcome)) out.push(`items[${i}] closed view row without partition=closed + outcome`);
    if (!closed && row.partition === "closed") out.push(`items[${i}] closed row outside view=closed`);
  }
  return out;
}
const flagOnHeader = (body: any) => (body?.data?.metrics ? [] : ["data.metrics missing: the snapshot was not published with ATTENTION_V2 on"]);
const flagOffHeader = (body: any) => (has(body?.data, "metrics") ? ["data.metrics present: the snapshot was published with ATTENTION_V2 on"] : []);
function closedOutcome(expected: string) {
  return (body: any) => items(body).filter(row => row.outcome?.reason !== expected).map((_row, i) => `items[${i}].outcome.reason is not ${expected}`)
    .concat(items(body).length ? [] : [`no row with outcome ${expected}: seed state missing`]);
}
function notInClosed(label: string) {
  return (body: any, ctx: CheckContext) => {
    const id = ctx.rows ? byLabel(ctx.rows, label)?.outreach_record_id : null;
    return id && items(body).some(row => row.outreach?.id === id) ? [`${label} (closed over 90 days) is in the closed partition`] : [];
  };
}
/** `kinds[]` holds on every item; the two deep subjects (S-timeline-300, S-calls-60) must not page out empty. */
function timelineKinds(state: string) {
  const expected = state.endsWith("kinds-call") ? "call" : null;
  const deep = state.startsWith("s-timeline-300") || state.startsWith("s-calls-60");
  return (body: any) => {
    const out: string[] = [];
    if (expected && items(body).some(item => item.kind !== expected)) out.push(`kinds filter ${expected} returned another kind`);
    if (deep && !items(body).length) out.push("empty timeline page on a deep subject");
    return out;
  };
}

// ── S2 call lists ───────────────────────────────────────────────────────────────────────────
const OUTCOMES = ["booked", "cancelled", "bad_lead", "duplicate", "no_sync", "crm_dead", "crm_bad_unusable", "owner"] as const;
const ATTENTION_SORTS_S2 = ["lead_received", "attention", "last_call", "last_human_contact", "next_action_due", "last_lead_progress",
  "transaction_intent", "move_likelihood", "interactions"] as const;
function attentionS2Calls(): CaptureCall[] {
  const all = "/attention?view=all_outreach&limit=200";
  return [
    { state: "default", path: "/attention" },
    { state: "all-outreach", path: all },
    ...ATTENTION_SORTS_S2.map(sort => ({ state: `sort-${sort.replace(/_/g, "-")}`, path: `${all}&sort=${sort}` })),
    { state: "sort-last-call-asc", path: `${all}&sort=last_call&direction=asc` },
    { state: "sort-transaction-intent-fresh", path: `${all}&sort=transaction_intent&freshness=fresh` },
    { state: "filter-band-1", path: "/attention?band=1" },
    { state: "filter-band-2", path: "/attention?band=2" },
    { state: "filter-needs-review", path: `${all}&needs_review=true` },
    { state: "filter-state-unworked", path: `${all}&state=unworked` },
    { state: "filter-unassigned", path: `${all}&unassigned=true` },
    { state: "filter-attachment-lead", path: `${all}&attachment=lead` },
    { state: "filter-attachment-none", path: `${all}&attachment=none` },
    { state: "filter-priority-not-set", path: `${all}&priority=not_set` },
    { state: "filter-priority-1", path: `${all}&priority=1` },
    { state: "filter-priority-7", path: `${all}&priority=7` },
    { state: "filter-has-recording", path: `${all}&has_recording=true` },
    { state: "filter-has-assessment", path: `${all}&has_assessment=true` },
    { state: "filter-newer-call", path: `${all}&newer_call=true` },
    { state: "filter-ti-min-50", path: `${all}&ti_min=50` },
    { state: "filter-ml-min-50", path: `${all}&ml_min=50` },
    { state: "filter-received-7d", path: `${all}&received_from=${q(isoAgo(7))}&received_to=${q(isoAgo(-1))}` },
    { state: "filter-move-date-within-30", path: `${all}&move_date_within=30` },
    { state: "filter-move-date-passed", path: `${all}&move_date_passed=true` },
    { state: "page-1", path: "/attention?view=all_outreach&limit=5",
      chain: [{ state: "page-2", next: body => (body?.data?.cursor ? `/attention?view=all_outreach&limit=5&cursor=${q(body.data.cursor)}` : null) }] },
  ];
}
function attentionClosedCalls(): CaptureCall[] {
  const closed = "/attention?view=closed&limit=200";
  return [
    { state: "closed", path: closed },
    ...OUTCOMES.map(outcome => ({ state: `closed-outcome-${outcome.replace(/_/g, "-")}`, path: `${closed}&outcome=${outcome}` })),
    { state: "closed-outcome-booked-cancelled", path: `${closed}&outcome=booked&outcome=cancelled` },
    { state: "closed-outcome-comma-crm", path: `${closed}&outcome=crm_dead,crm_bad_unusable` },
    { state: "closed-sort-closed", path: `${closed}&sort=closed` },
    { state: "closed-sort-time-to-close", path: `${closed}&sort=time_to_close` },
    { state: "closed-sort-lead-received", path: `${closed}&sort=lead_received` },
    { state: "closed-last-30d", path: `${closed}&closed_from=${q(isoAgo(30))}&closed_to=${q(isoAgo(-1))}` },
  ];
}
function numbersS2Calls(): CaptureCall[] {
  return [
    { state: "default", path: "/numbers" },
    ...(["last_call", "first_call", "interactions", "last_human_conversation", "last_activity", "first_observed"] as const)
      .map(sort => ({ state: `sort-${sort.replace(/_/g, "-")}`, path: `/numbers?sort=${sort}` })),
    { state: "sort-interactions-asc", path: "/numbers?sort=interactions&direction=asc" },
    { state: "filter-has-recording", path: "/numbers?has_recording=true" },
    { state: "filter-has-outreach", path: "/numbers?has_outreach=true" },
    { state: "filter-has-recording-and-outreach", path: "/numbers?has_recording=true&has_outreach=true&sort=interactions" },
    { state: "page-1", path: "/numbers?sort=interactions&limit=5",
      chain: [{ state: "page-2", next: body => (body?.data?.cursor ? `/numbers?sort=interactions&limit=5&cursor=${q(body.data.cursor)}` : null) }] },
  ];
}
function numbersChecks(body: any, ctx: CheckContext): string[] {
  const out: string[] = [];
  const sort = /sort-([a-z-]+?)(-asc)?$/.exec(ctx.state)?.[1]?.replace(/-/g, "_");
  if (sort && body?.data?.sort?.sort !== sort) out.push(`data.sort.sort ${body?.data?.sort?.sort} ≠ requested ${sort}`);
  for (const [i, row] of items(body).entries()) {
    if (!has(row.rollups, "recordings_total") || !has(row.rollups, "outreach_records_total")) out.push(`items[${i}].rollups S1 counts missing`);
    if (ctx.state.includes("has-recording") && !(row.rollups?.recordings_total > 0)) out.push(`items[${i}] has_recording=true row with recordings_total ${row.rollups?.recordings_total}`);
    if (ctx.state.includes("outreach") && ctx.state.startsWith("filter") && !(row.rollups?.outreach_records_total > 0)) out.push(`items[${i}] has_outreach=true row with outreach_records_total 0`);
  }
  return out;
}

// ── registry ────────────────────────────────────────────────────────────────────────────────
const attentionServer = serverSchema(load.siDto, "attentionPageDtoSchema", "salesIntelligence/dto.ts");

export const ROUTES: RouteEntry[] = [
  // ── S1 (CF1): card facts on the desk rows and the Outreach record ─────────────────────────
  { stage: "S1", mode: "on", slug: "attention", route: "GET /attention", params: "default; view=all_outreach&limit=200", kind: "read",
    calls: fixed([{ state: "default", path: "/attention" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: body => [...attentionRowsCarryS1(body), ...flagOnHeader(body)] },
  { stage: "S1", mode: "on", slug: "outreach", route: "GET /outreach/:id", params: "one call per seeded Outreach record (every card state)", kind: "read",
    calls: perRow(row => (row.outreach_record_id ? [{ path: `/outreach/${row.outreach_record_id}` }] : [])), schema: outreachReadSchema,
    checks: body => (has(body?.data?.outreach, "facts") ? [] : ["data.outreach.facts missing"]) },

  // ── S2 (CF2): desk filters, sorts, closed partition, metrics; Numbers sorts and filters ──
  { stage: "S2", mode: "on", slug: "attention", route: "GET /attention", params: "every §7.2 sort, every §7.3 filter, cursor page 2", kind: "read",
    calls: attentionS2Calls, schema: attentionServer, admin: [adminSchema("attentionSchema")],
    checks: body => [...flagOnHeader(body), ...attentionRowsCarryS2(body, false)] },
  { stage: "S2", mode: "on", slug: "attention-closed", route: "GET /attention?view=closed", params: "outcome[] (each), sort=closed|time_to_close|lead_received, closed_from/closed_to", kind: "read",
    calls: attentionClosedCalls, schema: attentionServer,
    checks: (body, ctx) => {
      const outcome = /closed-outcome-([a-z-]+)$/.exec(ctx.state)?.[1]?.replace(/-/g, "_");
      const single = outcome && (OUTCOMES as readonly string[]).includes(outcome) ? closedOutcome(outcome)(body) : [];
      const pair = ctx.state === "closed-outcome-booked-cancelled" ? ["booked", "cancelled"] : ctx.state === "closed-outcome-comma-crm" ? ["crm_dead", "crm_bad_unusable"] : null;
      const multi = pair ? items(body).filter(row => !pair.includes(row.outcome?.reason)).map((_r, i) => `items[${i}].outcome.reason outside ${pair.join("|")}`)
        .concat(items(body).length >= 2 ? [] : [`expected rows for both ${pair.join(" and ")}`]) : [];
      return [...multi,...flagOnHeader(body), ...attentionRowsCarryS2(body, true), ...single, ...notInClosed("S-closed-over-90d")(body, ctx)];
    } },
  { stage: "S2", mode: "on", slug: "numbers", route: "GET /numbers", params: "sort=last_call|first_call|interactions|…, has_recording, has_outreach, cursor page 2", kind: "read",
    calls: numbersS2Calls, schema: serverSchema(load.numberDto, "numberSearchPageDtoSchema", "numberActivity/dto.ts"),
    admin: [adminSchema("numberSearchSchema")], checks: numbersChecks },
  // Flag off (both flags false, flag-off snapshot): the production Admin must parse what it reads today.
  { stage: "S2", mode: "off", slug: "attention", route: "GET /attention (flags off)", params: "default; view=all_outreach; view=closed", kind: "read",
    calls: fixed([{ state: "default", path: "/attention" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" },
      { state: "closed", path: "/attention?view=closed&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")],
    checks: (body, ctx) => [...flagOffHeader(body), ...(ctx.state === "closed" && items(body).length ? ["view=closed on a flag-off snapshot must be empty"] : [])] },

  // ── S3 (CF3): analysis page reads and every model-output presentation ────────────────────
  { stage: "S3", mode: "on", slug: "outreach-assessment", route: "GET /outreach/:id/assessment", params: "one call per seeded Outreach record", kind: "read",
    calls: perRow(row => (row.outreach_record_id ? [{ path: `/outreach/${row.outreach_record_id}/assessment` }] : [])),
    schema: ownerReadOf(load.assessmentDto, "outreachAssessmentDtoSchema", "assessment/dto.ts") },
  { stage: "S3", mode: "on", slug: "assessment", route: "GET /assessments/:artifactId", params: "one call per seeded artifact (every version)", kind: "read",
    calls: perRow(row => row.artifact_ids.map((id, i) => ({ suffix: row.artifact_ids.length > 1 ? `v${i + 1}` : "", path: `/assessments/${id}` }))),
    schema: ownerReadOf(load.assessmentDto, "assessmentSectionSchema", "assessment/dto.ts") },
  { stage: "S3", mode: "on", slug: "assessment-evidence", route: "GET /assessments/:artifactId/evidence", params: "one call per seeded artifact", kind: "read",
    calls: perRow(row => row.artifact_ids.map((id, i) => ({ suffix: row.artifact_ids.length > 1 ? `v${i + 1}` : "", path: `/assessments/${id}/evidence` }))),
    schema: ownerReadOf(load.assessmentDto, "evidenceSectionSchema", "assessment/dto.ts") },
  { stage: "S3", mode: "on", slug: "run-presentation", route: "GET /analysis-runs/:id/presentation", params: "one call per seeded run", kind: "read",
    calls: perRow(row => row.run_ids.map((id, i) => ({ suffix: `run${i + 1}`, path: `/analysis-runs/${id}/presentation` }))),
    schema: ownerReadOf(load.assessmentDto, "runPresentationSchema", "assessment/dto.ts") },
  { stage: "S3", mode: "on", slug: "analysis-run", route: "GET /analysis-runs/:id", params: "one call per seeded run", kind: "read",
    calls: perRow(row => row.run_ids.map((id, i) => ({ suffix: `run${i + 1}`, path: `/analysis-runs/${id}` }))), schema: ownerRunSchema },
  { stage: "S3", mode: "on", slug: "outreach-findings", route: "GET /outreach/:id/findings", params: "default per record; include_superseded=true where runs exist", kind: "read",
    calls: perRow(row => (row.outreach_record_id ? [{ path: `/outreach/${row.outreach_record_id}/findings` },
      ...(row.run_ids.length ? [{ suffix: "include-superseded", path: `/outreach/${row.outreach_record_id}/findings?include_superseded=true` }] : [])] : [])),
    schema: serverSchema(load.findings, "currentFindingsResponseSchema", "analysis/currentFindings.ts"),
    checks: (body, ctx) => (ctx.state.startsWith("s-findings") && !items(body).length ? ["S-findings has no current findings"] : []) },

  // ── S4 (CF4): timeline v2, conversations, transcript, media, Number detail and rows ────────
  { stage: "S4", mode: "on", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", params: "limit=50 per record; cursor page 2; kinds[]=call", kind: "read",
    calls: perRow(row => {
      if (!row.outreach_record_id) return [];
      const base = `/outreach/${row.outreach_record_id}/timeline`;
      const deep = row.label === "S-timeline-300" || row.label === "S-calls-60";
      return [{ path: `${base}?limit=50`, ...(deep ? { chain: [{ state: `${stateOf(row.label)}-page-2`, next: (body: any) => (body?.data?.cursor ? `${base}?limit=50&cursor=${q(body.data.cursor)}` : null) }] } : {}) },
        ...(deep ? [{ suffix: "kinds-call", path: `${base}?limit=50&kinds[]=call` }] : [])];
    }),
    schema: serverSchema(load.numberDto, "timelineV2PageDtoSchema", "numberActivity/dto.ts"),
    checks: (body, ctx) => [...(body?.data?.scope === "outreach" ? [] : ["data.scope is not outreach"]), ...timelineKinds(ctx.state)(body)] },
  { stage: "S4", mode: "on", slug: "number-timeline", route: "GET /numbers/:id/timeline (v2)", params: "limit=50 per Number; cursor page 2; kinds[]=call", kind: "read",
    calls: perNumber((row, numberId) => {
      const base = `/numbers/${numberId}/timeline`;
      const deep = row.label === "S-timeline-300" || row.label === "S-calls-60";
      return [{ path: `${base}?limit=50`, ...(deep ? { chain: [{ state: `${stateOf(row.label)}-page-2`, next: (body: any) => (body?.data?.cursor ? `${base}?limit=50&cursor=${q(body.data.cursor)}` : null) }] } : {}) },
        ...(deep ? [{ suffix: "kinds-call", path: `${base}?limit=50&kinds[]=call` }] : [])];
    }),
    schema: serverSchema(load.numberDto, "timelineV2PageDtoSchema", "numberActivity/dto.ts"), admin: [adminSchema("timelineSchema")],
    checks: (body, ctx) => [...(body?.data?.scope === "number" && body?.data?.number_id ? [] : ["data.scope/number_id not a v2 Number page"]),
      ...timelineKinds(ctx.state)(body)] },
  { stage: "S4", mode: "on", slug: "number-conversations", route: "GET /numbers/:id/conversations", params: "default per Number with conversations; limit=2 + cursor page 2 on S-calls-60", kind: "read",
    calls: perNumber((row, numberId) => (row.conversation_ids.length ? [{ path: `/numbers/${numberId}/conversations` },
      ...(row.label === "S-calls-60" ? [{ suffix: "limit-2", path: `/numbers/${numberId}/conversations?limit=2`,
        chain: [{ state: `${stateOf(row.label)}-limit-2-page-2`, next: (body: any) => (body?.data?.next_cursor ? `/numbers/${numberId}/conversations?limit=2&cursor=${q(body.data.next_cursor)}` : null) }] }] : [])] : [])),
    schema: serverSchema(load.conversations, "ownerConversationsResponseSchema", "analysis/ownerConversations.ts") },
  { stage: "S4", mode: "on", slug: "conversation-transcript", route: "GET /conversations/:id/transcript", params: "first 3 conversations per row; offset=2&limit=3 on the first", kind: "read",
    calls: perRow(row => row.conversation_ids.slice(0, 3).flatMap((id, i) => [{ suffix: `c${i + 1}`, path: `/conversations/${id}/transcript` },
      ...(i === 0 && row.label === "S-findings" ? [{ suffix: `c${i + 1}-offset-2`, path: `/conversations/${id}/transcript?offset=2&limit=3` }] : [])])),
    schema: serverSchema(load.conversations, "ownerTranscriptResponseSchema", "analysis/ownerConversations.ts") },
  { stage: "S4", mode: "on", slug: "number", route: "GET /numbers/:id", params: "one call per distinct seeded Number", kind: "read",
    calls: perNumber((_row, numberId) => [{ path: `/numbers/${numberId}` }]),
    schema: serverSchema(load.numberDto, "numberDetailReadDtoSchema", "numberActivity/dto.ts") },
  { stage: "S4", mode: "on", slug: "numbers", route: "GET /numbers", params: "default; limit=200 (every row: resolved / multiple / none)", kind: "read",
    calls: fixed([{ state: "default", path: "/numbers" }, { state: "limit-200", path: "/numbers?limit=200" }]),
    schema: serverSchema(load.numberDto, "numberSearchPageDtoSchema", "numberActivity/dto.ts"), admin: [adminSchema("numberSearchSchema")],
    checks: body => items(body).flatMap((row, i) => (row.attached_lead_progress && !has(row.attached_lead_progress, "outreach_records_total")
      ? [`items[${i}].attached_lead_progress.outreach_records_total missing`] : [])) },
  // Media (captured last: the retained call writes one `media_played` audit row): headers and status only, never the body. The local API blanks the Blob credentials (serve-csi-local.ts), so:
  // purged media → 404 before any audit or read; retained media → the `media_played` audit row commits, then the
  // absent store makes the read fail (500 "Sales Intelligence request failed"). See contracts/S4/CONTRACT.md.
  { stage: "S4", mode: "on", slug: "conversation-media-purged", route: "GET /conversations/:id/media", params: "Range: bytes=0-99; S-audio-purged first conversation (media purged)", kind: "status",
    calls: perRow(row => (row.label === "S-audio-purged" && row.conversation_ids[0] ? [{ path: `/conversations/${row.conversation_ids[0]}/media`, expect: 404, headers: { Range: "bytes=0-99" } }] : [])),
    schema: statusSchema(404, "INVALID_INPUT", "Recording not found") },
  { stage: "S4", mode: "on", slug: "conversation-media-retained", route: "GET /conversations/:id/media", params: "Range: bytes=0-99; S-audio-purged second conversation (media retained, no Blob store)", kind: "status",
    calls: perRow(row => (row.label === "S-audio-purged" && row.conversation_ids[1] ? [{ path: `/conversations/${row.conversation_ids[1]}/media`, expect: 500, headers: { Range: "bytes=0-99" } }] : [])),
    schema: statusSchema(500, "INVALID_INPUT", "Sales Intelligence request failed") },
  // Flag off: GET /numbers/:id/timeline is today's v1 read (the production Admin parses it); GET /outreach/:id/timeline is 404 FEATURE_DISABLED.
  { stage: "S4", mode: "off", slug: "number-timeline", route: "GET /numbers/:id/timeline (v1, flags off)", params: "limit=50 per Number", kind: "read",
    calls: perNumber((_row, numberId) => [{ path: `/numbers/${numberId}/timeline?limit=50` }]),
    schema: serverSchema(load.numberDto, "numberTimelinePageDtoSchema", "numberActivity/dto.ts"), admin: [adminSchema("timelineSchema")],
    checks: body => (has(body?.data, "scope") ? ["flag-off Number timeline carries the v2 `scope` key"] : []) },
  { stage: "S4", mode: "off", slug: "outreach-timeline", route: "GET /outreach/:id/timeline (flags off)", params: "S-timeline-300", kind: "status",
    calls: perRow(row => (row.label === "S-timeline-300" && row.outreach_record_id ? [{ path: `/outreach/${row.outreach_record_id}/timeline`, expect: 404 }] : [])),
    schema: statusSchema(404, "FEATURE_DISABLED", "Sales Intelligence is disabled") },
];

// ── CF-AC (Team 4, 2026-09-24): Attention evolution fields on the desk, the Outreach detail and the timeline ──
/** Every new reason a flags-on AC snapshot must carry somewhere (spec §9). */
export const AC_REASONS = ["promised_by:rep", "promised_by:customer", "promised_by:owner", "new_not_yet_due", "no_call_yet", "no_callback_after_inbound",
  "called_before_form", "promise_unreached", "rep_discretion", "unreached"] as const;
const AC_NEW_REASONS = AC_REASONS.filter(r => r !== "no_call_yet");
const isAcNew = (reason: string) => (AC_NEW_REASONS as readonly string[]).includes(reason);
const CONTACT_FACTS = ["last_inbound_human_at", "last_attributable_outbound_at", "prior_contact_at", "last_activity_at"] as const;
const acLabel = (row: SiManifestRow) => row.label.startsWith("AC-");
function acAttentionOn(body: any, ctx: CheckContext): string[] {
  const out: string[] = [...flagOnHeader(body)];
  const rows = items(body);
  for (const [i, row] of rows.entries()) {
    const band = row.derived?.attention_band, rank = row.sort_keys?.band2_due_rank;
    if (!row.outreach) continue;
    if (band === 2 && rank !== (row.derived.reasons.includes("new_not_yet_due") ? 1 : 0)) out.push(`items[${i}] band 2 with band2_due_rank ${rank}`);
    if (band !== 2 && rank !== null && rank !== undefined) out.push(`items[${i}] band ${band} with band2_due_rank ${rank}`);
  }
  const band2 = rows.filter(row => row.derived?.attention_band === 2).map(row => row.sort_keys?.band2_due_rank ?? 0);
  if (ctx.state === "default" && band2.some((rank, i) => i > 0 && rank < band2[i - 1]!)) out.push("band 2 rows are not ordered no_call_yet before new_not_yet_due");
  if (ctx.state === "all-outreach") {
    const seen = new Set(rows.flatMap(row => row.derived?.reasons ?? []));
    for (const reason of AC_REASONS) if (!seen.has(reason)) out.push(`no row carries reason ${reason}`);
    if (!band2.includes(0) || !band2.includes(1)) out.push("band2_due_rank 0 and 1 not both present");
  }
  return out;
}
function acAttentionOff(body: any): string[] {
  const out = [...flagOnHeader(body)];
  for (const [i, row] of items(body).entries()) {
    const reasons: string[] = row.derived?.reasons ?? [];
    if (reasons.some(isAcNew)) out.push(`items[${i}] flag-off row carries ${reasons.filter(isAcNew).join(",")}`);
    if (row.sort_keys && "band2_due_rank" in row.sort_keys) out.push(`items[${i}] flag-off row carries band2_due_rank`);
  }
  return out;
}
/** Per seeded AC state: the field the fixture must actually show (spec §9). */
const AC_DETAIL: Record<string, (o: any) => string[]> = {
  "ac-callback-customer-exact": o => (o.derived.reasons.includes("promised_by:customer") && o.derived.attention_band === 1 ? [] : ["not band 1 promised_by:customer"]),
  "ac-callback-owner-exact": o => (o.derived.reasons.includes("promised_by:owner") && o.derived.attention_band === 1 ? [] : ["not band 1 promised_by:owner"]),
  "ac-callback-rep-day": o => (o.derived.attention_band === 4 ? [] : [`band ${o.derived.attention_band}, expected 4`]),
  "ac-inbound-after-promise": o => (o.followups.some((a: any) => a.disposition === "customer_called") ? [] : ["no customer_called follow-up"]),
  "ac-promise-chain-source": o => {
    const chain = o.followups.filter((a: any) => a.promise_chain);
    return [...(chain.length === 2 && chain.every((a: any) => a.supersedes_id && a.origin === "system_default") ? [] : [`${chain.length} retry successors with promise_chain+supersedes_id`]),
      ...(o.derived.reasons.includes("promise_unreached") ? [] : ["no promise_unreached"])];
  },
  "ac-progress-0-to-1": o => (o.followups.some((a: any) => a.default_kind === "quote_followup" && a.status === "open") ? [] : ["no open quote default"]),
  "ac-default-superseded": o => (o.followups.some((a: any) => a.default_kind === "quote_followup" && a.status === "superseded" && a.cancel_reason === "superseded_by_specific_plan")
    ? [] : ["no superseded quote default"]),
  "ac-progress-accepted-3": o => (o.derived.reasons.includes("rep_discretion") ? [] : ["no rep_discretion"]),
  "ac-attempts-same-rep": o => (o.assignment.origin === "first_attempts" && o.assignment.agent ? [] : [`assignment origin ${o.assignment.origin}`]),
  "ac-attempts-two-reps": o => (o.assignment.agent === null ? [] : ["assigned"]),
  "ac-inbound-only-240": o => (o.last_inbound_human_at && o.derived.reasons.includes("no_callback_after_inbound") ? [] : ["no last_inbound_human_at + no_callback_after_inbound"]),
  "ac-called-before-form-6d": o => (o.prior_contact_at && o.derived.reasons.includes("called_before_form") ? [] : ["no prior_contact_at + called_before_form"]),
  "ac-called-before-form-8d": o => (o.prior_contact_at === null ? [] : ["prior_contact_at set at 8 days"]),
  "ac-going-cold-unreached": o => (o.last_attributable_outbound_at && o.derived.reasons.includes("unreached") ? [] : ["no unreached"]),
};
function acDetailOn(body: any, ctx: CheckContext): string[] {
  const o = body?.data?.outreach;
  if (!o) return ["data.outreach missing"];
  const missing = CONTACT_FACTS.filter(field => !has(o, field));
  return [...(missing.length ? [`contact facts missing: ${missing.join(", ")}`] : []), ...(AC_DETAIL[ctx.state]?.(o) ?? [])];
}
function acDetailOff(body: any): string[] {
  const reasons: string[] = body?.data?.outreach?.derived?.reasons ?? [];
  return reasons.some(isAcNew) ? [`flag-off detail carries ${reasons.filter(isAcNew).join(",")}`] : [];
}
const TIMELINE_EXPECT: Record<string, (list: any[]) => string[]> = {
  "ac-promise-chain-source": list => (list.filter(i => i.kind === "followup_created" && /Try again: promised callback not reached/.test(JSON.stringify(i))).length === 2 ? [] : ["two retry followup_created entries expected"]),
  "ac-progress-0-to-1": list => (list.some(i => i.kind === "followup_created" && /Follow up on the quote/.test(JSON.stringify(i))) ? [] : ["no default followup_created"]),
  "ac-default-superseded": list => (list.some(i => i.kind === "followup_superseded" && /Follow up on the quote/.test(JSON.stringify(i))) ? [] : ["no followup_superseded for the default"]),
};
const AC_TIMELINE_STATES = Object.keys(TIMELINE_EXPECT);
const acRows = (rows: readonly SiManifestRow[]) => rows.filter(acLabel);
const detailCalls = (only?: readonly string[]) => (rows: readonly SiManifestRow[]) => perRow(row => (row.outreach_record_id && (!only || only.includes(stateOf(row.label)))
  ? [{ path: `/outreach/${row.outreach_record_id}` }] : []))(acRows(rows));
const AC_OFF_DETAIL = ["ac-promise-chain-source", "ac-attempts-same-rep", "ac-default-superseded", "ac-progress-0-to-1", "ac-called-before-form-6d", "ac-callback-customer-exact"];
ROUTES.push(
  { stage: "AC", mode: "on", slug: "attention", route: "GET /attention", params: "limit=200 default; view=all_outreach; band=1; band=2; band=4", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" },
      { state: "band-1", path: "/attention?band=1&limit=200" }, { state: "band-2", path: "/attention?band=2&limit=200" }, { state: "band-4", path: "/attention?band=4&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: acAttentionOn },
  { stage: "AC", mode: "on", slug: "outreach", route: "GET /outreach/:id", params: "one call per seeded AC state", kind: "read",
    calls: detailCalls(), schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: acDetailOn },
  { stage: "AC", mode: "on", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", params: "limit=200: the retry chain, the quote default, the superseded default", kind: "read",
    calls: rows => perRow(row => (row.outreach_record_id && AC_TIMELINE_STATES.includes(stateOf(row.label)) ? [{ path: `/outreach/${row.outreach_record_id}/timeline?limit=200` }] : []))(acRows(rows)),
    schema: serverSchema(load.numberDto, "timelineV2PageDtoSchema", "numberActivity/dto.ts"),
    checks: (body, ctx) => TIMELINE_EXPECT[ctx.state]?.(items(body)) ?? [] },
  // Flag off: ATTENTION_V2 and TIMELINE_V2 stay on (as in production); the three Team 4 flags are off and the snapshot is republished with ATTENTION_EVOLUTION off.
  { stage: "AC", mode: "off", slug: "attention", route: "GET /attention (Team 4 flags off)", params: "limit=200 default; view=all_outreach", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: acAttentionOff },
  { stage: "AC", mode: "off", slug: "outreach", route: "GET /outreach/:id (Team 4 flags off)", params: AC_OFF_DETAIL.join(", "), kind: "read",
    calls: detailCalls(AC_OFF_DETAIL), schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: acDetailOff },
);

// ── CF5c (Team 3, SEED-T3 2026-09-24): capture reconciliation (reconciliation addendum §3.7) ─────────────────
// Flags on: production's (ATTENTION_V2, TIMELINE_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, CAPTURE_WEBHOOK) plus
// Team 3's NUMBERS_HAS_CALLS_DEFAULT. Flag off: the same without NUMBERS_HAS_CALLS_DEFAULT (production today). The S5c
// call-state fields, `live_call` and `capture_health` are unflagged, so both sets carry them.
const T3 = { live: "T3-live-call", pending: "T3-pending-finalization", states: "T3-capture-states", form: "T3-form-created-number" } as const;
const T3_LABELS: readonly string[] = [T3.live, T3.pending, T3.states, T3.form];
const t3Rows = (rows: readonly SiManifestRow[]) => rows.filter(row => T3_LABELS.includes(row.label));
const t3Row = (ctx: CheckContext, label: string) => (ctx.rows ? byLabel(ctx.rows, label) : null);
/** Strip a call's suffix (`-kinds-call`) and the script/synthetic marker so a check keys on the seed label. */
const t3State = (state: string) => state.replace(/__(script|synthetic)$/, "").replace(/-kinds-call$/, "");
const callItem = (body: any, interactionId: string | undefined) => items(body).find(item => item.kind === "call" && item.call?.interaction_id === interactionId)?.call ?? null;

function t3InProgressCall(body: any, interactionId: string | undefined, what: string): string[] {
  const call = callItem(body, interactionId);
  if (!call) return [`${what}: call ${interactionId} not on the page`];
  const out: string[] = [];
  if (call.in_progress !== true || call.terminal !== false) out.push(`${what}: in_progress ${call.in_progress}, terminal ${call.terminal}`);
  if (call.call_log_state !== null) out.push(`${what}: call_log_state ${call.call_log_state}, expected null`);
  if (call.result !== null || call.duration_seconds !== null) out.push(`${what}: result/duration not null while in progress`);
  return out;
}
/** Per seeded Number: the call-state facts its Calls tab and timeline must show (§3.1, §3.3). */
function t3CallChecks(body: any, ctx: CheckContext): string[] {
  const state = t3State(ctx.state);
  const out: string[] = [];
  if (state === "t3-live-call") out.push(...t3InProgressCall(body, t3Row(ctx, T3.live)?.interaction_ids?.[0], "live call"));
  if (state === "t3-pending-finalization") out.push(...t3InProgressCall(body, t3Row(ctx, T3.pending)?.interaction_ids?.[0], "pending call"));
  if (state === "t3-capture-states") {
    const [settled, pts, unknown, recovered, late] = t3Row(ctx, T3.states)?.interaction_ids ?? [];
    const expect = (id: string | undefined, what: string, test: (call: any) => boolean) => {
      const call = callItem(body, id);
      if (!call) out.push(`${what}: call ${id} not on the page`);
      else if (!test(call)) out.push(`${what}: ${JSON.stringify({ direction: call.direction, terminal: call.terminal, call_log_state: call.call_log_state, in_progress: call.in_progress, observed_reason: call.observed_reason })}`);
    };
    const final = (call: any) => call.terminal === true && call.in_progress === false;
    expect(settled, "settled", call => final(call) && call.call_log_state === "settled" && call.observed_reason === null);
    expect(pts, "provisional then settled", call => final(call) && call.call_log_state === "settled");
    expect(unknown, "Unknown direction", call => final(call) && call.direction === "Unknown");
    expect(recovered, "recovered", call => final(call) && call.observed_reason === "recovered");
    expect(late, "late capture", call => final(call) && call.observed_reason === "late_capture");
  }
  if (ctx.state.endsWith("kinds-call") && items(body).some(item => item.kind !== "call")) out.push("kinds[]=call returned another kind");
  return out;
}
/** Desk and detail: `live_call` next to `call_progress` (§3.2); a record without a live call reads null. */
function t3LiveChecks(outreach: any, label: string, row: any | null, ctx: CheckContext): string[] {
  const liveId = t3Row(ctx, label)?.interaction_ids?.[0];
  if (label === T3.live) {
    const out: string[] = [];
    if (outreach?.live_call?.interaction_id !== liveId) out.push(`${label}: live_call ${JSON.stringify(outreach?.live_call ?? null)} ≠ ${liveId}`);
    if (outreach?.call_progress?.state !== "in_progress") out.push(`${label}: call_progress ${JSON.stringify(outreach?.call_progress ?? null)}`);
    if (row && row.filter_keys?.live_call !== true) out.push(`${label}: filter_keys.live_call ${row.filter_keys?.live_call}`);
    return out;
  }
  if (label === T3.pending) return outreach?.live_call?.interaction_id === liveId && (!row || row.filter_keys?.live_call === true) ? [] : [`${label}: live_call not set`];
  return (outreach?.live_call ?? null) === null && (!row || row.filter_keys?.live_call === false) ? [] : [`${label}: live_call set on a record without a live call`];
}
function t3AttentionChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  for (const label of [T3.live, T3.pending, T3.states]) {
    const id = t3Row(ctx, label)?.outreach_record_id;
    const row = items(body).find(item => item.outreach?.id === id) ?? null;
    if (!row) { if (ctx.state === "all-outreach") out.push(`${label}: no desk row`); continue; }
    out.push(...t3LiveChecks(row.outreach, label, row, ctx));
  }
  return out;
}
function t3DetailChecks(body: any, ctx: CheckContext): string[] {
  const label = t3Rows(ctx.rows ?? []).find(row => stateOf(row.label) === ctx.state)?.label;
  return label && label !== T3.form ? t3LiveChecks(body?.data?.outreach, label, null, ctx) : [];
}
function t3NumbersChecks(mode: Mode) {
  return (body: any, ctx: CheckContext): string[] => {
    const out: string[] = [];
    const formId = t3Row(ctx, T3.form)?.contact_number_id;
    const form = items(body).find(item => item.id === formId);
    const hidesFormOnly = mode === "on" && ctx.state !== "include-form-only";
    if (mode === "off" && has(body?.data, "filters")) out.push("flag off: data.filters echoed without a param");
    if (mode === "on" && body?.data?.filters?.has_calls !== hidesFormOnly) out.push(`data.filters.has_calls ${body?.data?.filters?.has_calls}, expected ${hidesFormOnly}`);
    if (hidesFormOnly) {
      if (form) out.push("the form-created Number is listed under the has_calls default");
      if (items(body).some(item => item.has_calls !== true)) out.push("a Number without calls is listed under the has_calls default");
    } else if (ctx.state !== "default") {
      if (!form) out.push("the form-created Number is missing");
      else if (form.created_via !== "form_lead" || form.has_calls !== false) out.push(`form-created Number: created_via ${form.created_via}, has_calls ${form.has_calls}`);
    }
    return out;
  };
}
function t3CoverageChecks(body: any, ctx: CheckContext): string[] {
  const health = body?.data?.coverage?.capture_health;
  if (!health) return ["data.coverage.capture_health missing"];
  const out: string[] = [];
  if (/t3seed-(healthy|expired)-[0-9a-f-]{20,}/.test(JSON.stringify(body))) out.push("a full subscription id is in the response");
  const want = (status: string, reasons: string[], state?: string) => {
    if (health.status !== status) out.push(`capture_health.status ${health.status}, expected ${status}`);
    for (const reason of reasons) if (!health.reasons.includes(reason)) out.push(`capture_health.reasons lacks ${reason}`);
    if (state && health.webhook.state !== state) out.push(`webhook.state ${health.webhook.state}, expected ${state}`);
  };
  if (ctx.state === "seed") {
    want("attention", ["quarantine", "pending_finalization"], "healthy");
    if (health.webhook.subscription_id_suffix !== "00a1b2") out.push(`subscription_id_suffix ${health.webhook.subscription_id_suffix}`);
    if (health.call_log.quarantined_count !== 1 || !(health.in_progress_calls >= 2) || !(health.pending_finalization >= 1)) out.push("seeded counts not shown");
  }
  if (ctx.state === "capture-health-ok__synthetic") want("ok", [], "healthy");
  if (ctx.state === "capture-health-broken__synthetic") want("broken", ["webhook_down", "quarantine_over_24h", "pending_finalization"], "down");
  return out;
}
function t3CaseFileChecks(body: any, ctx: CheckContext): string[] {
  const data = body?.data, state = t3State(ctx.state);
  if (state === "t3-live-call") return data?.coverage?.excluded_in_progress >= 1 && data?.case_file?.excluded_in_progress >= 1 && /still in progress not shown/.test(data?.case_file?.text ?? "")
    ? [] : ["the live call's Case File does not report excluded_in_progress"];
  if (state === "t3-capture-states") return !has(data?.coverage, "excluded_in_progress") && /recovered by a capture repair on/.test(data?.case_file?.text ?? "")
    ? [] : ["the capture-states Case File lacks the recovery wording (or reports an in-progress call)"];
  return [];
}
async function coverageRouteSchema(): Promise<ResolvedSchema> {
  const { ownerCoverageDtoSchema } = await import("../../../src/services/salesIntelligence/dto");
  const { z } = await import("zod");
  return { schema: z.object({ data: z.object({ as_of: z.string(), coverage: ownerCoverageDtoSchema }).strict() }).strict(),
    name: "{ data: { as_of, coverage: ownerCoverageDtoSchema } } (GET /coverage)", source: "server" };
}
async function caseFileScriptSchema(): Promise<ResolvedSchema> {
  const { caseFileArtifactSchema } = await import("../../../src/services/salesIntelligence/casefile/page");
  const { z } = await import("zod");
  return { schema: z.object({ as_of: z.string(), capture: z.literal("script"), data: z.object({ outreach_record_id: z.string().nullable(), contact_number_id: z.string(),
    // `CaseFile.coverage` (casefile/types.ts) has no Zod export: transcribed strictly here.
    coverage: z.object({ truncated_sources: z.array(z.string()), timeline_dropped: z.number().int().nonnegative(), excluded_in_progress: z.number().int().positive().optional() }).strict(),
    case_file: caseFileArtifactSchema }).strict() }).strict(),
    name: "script capture { coverage: CaseFile.coverage, case_file: caseFileArtifactSchema }", source: "script-local" };
}
const t3DetailCalls = (labels: readonly string[]) => (rows: readonly SiManifestRow[]) =>
  perRow(row => (labels.includes(row.label) && row.outreach_record_id ? [{ path: `/outreach/${row.outreach_record_id}` }] : []))(rows);
const t3TimelineCalls = (labels: readonly string[], scope: "numbers" | "outreach", kindsCall: boolean) => (rows: readonly SiManifestRow[]) =>
  perRow(row => {
    const id = scope === "numbers" ? row.contact_number_id : row.outreach_record_id;
    if (!labels.includes(row.label) || !id) return [];
    const base = `/${scope}/${id}/timeline?limit=50`;
    return [{ path: base }, ...(kindsCall ? [{ suffix: "kinds-call", path: `${base}&kinds[]=call` }] : [])];
  })(rows);
const t3FormNumberCall = (rows: readonly SiManifestRow[]) => perRow(row => (row.label === T3.form && row.contact_number_id ? [{ path: `/numbers/${row.contact_number_id}` }] : []))(rows);
const t3FormNumberCheck = (body: any) => (body?.data?.created_via === "form_lead" && body?.data?.has_calls === false ? [] : [`Number detail: created_via ${body?.data?.created_via}, has_calls ${body?.data?.has_calls}`]);
const timelineServer = serverSchema(load.numberDto, "timelineV2PageDtoSchema", "numberActivity/dto.ts");
const numbersServer = serverSchema(load.numberDto, "numberSearchPageDtoSchema", "numberActivity/dto.ts");
const numberDetailServer = serverSchema(load.numberDto, "numberDetailReadDtoSchema", "numberActivity/dto.ts");
const T3_CALL_LABELS = [T3.live, T3.pending, T3.states];
ROUTES.push(
  { stage: "S5c", mode: "on", slug: "attention", route: "GET /attention", params: "limit=200 default; view=all_outreach&limit=200", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: t3AttentionChecks },
  { stage: "S5c", mode: "on", slug: "outreach", route: "GET /outreach/:id", params: "T3-live-call, T3-pending-finalization, T3-capture-states, T3-form-created-number", kind: "read",
    calls: t3DetailCalls(T3_LABELS), schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: t3DetailChecks },
  { stage: "S5c", mode: "on", slug: "number-timeline", route: "GET /numbers/:id/timeline (v2) = the Number Calls list with kinds[]=call", params: "limit=50; limit=50&kinds[]=call",
    kind: "read", calls: t3TimelineCalls(T3_CALL_LABELS, "numbers", true), schema: timelineServer, admin: [adminSchema("timelineSchema")], checks: t3CallChecks },
  { stage: "S5c", mode: "on", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", params: "limit=50", kind: "read",
    calls: t3TimelineCalls(T3_CALL_LABELS, "outreach", false), schema: timelineServer, checks: t3CallChecks },
  { stage: "S5c", mode: "on", slug: "numbers", route: "GET /numbers", params: "default; limit=200; include_form_only=true&limit=200 (NUMBERS_HAS_CALLS_DEFAULT on)", kind: "read",
    calls: fixed([{ state: "default", path: "/numbers" }, { state: "limit-200", path: "/numbers?limit=200" }, { state: "include-form-only", path: "/numbers?include_form_only=true&limit=200" }]),
    schema: numbersServer, admin: [adminSchema("numberSearchSchema")], checks: t3NumbersChecks("on") },
  { stage: "S5c", mode: "on", slug: "number", route: "GET /numbers/:id", params: "T3-form-created-number", kind: "read",
    calls: t3FormNumberCall, schema: numberDetailServer, admin: [adminSchema("numberSchema")], checks: t3FormNumberCheck },
  { stage: "S5c", mode: "on", slug: "coverage", route: "GET /coverage", params: "seed (real); capture-health-ok / -broken (synthetic: composeCaptureHealth in a copy of the real response)",
    kind: "read", calls: fixed([{ state: "seed", path: "/coverage" }]), schema: coverageRouteSchema, admin: [adminSchema("ownerCoverageSchema")], checks: t3CoverageChecks },
  { stage: "S5c", mode: "on", slug: "case-file", route: "script: casefile/assemble.ts (no route exposes the Case File)", params: "T3-live-call, T3-capture-states", kind: "script",
    calls: () => [], schema: caseFileScriptSchema, checks: t3CaseFileChecks },
  // Flag off: NUMBERS_HAS_CALLS_DEFAULT off, every production flag on; the production Admin must parse each.
  { stage: "S5c", mode: "off", slug: "attention", route: "GET /attention (NUMBERS_HAS_CALLS_DEFAULT off)", params: "limit=200 default; view=all_outreach&limit=200", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: t3AttentionChecks },
  { stage: "S5c", mode: "off", slug: "outreach", route: "GET /outreach/:id (NUMBERS_HAS_CALLS_DEFAULT off)", params: "T3-live-call, T3-capture-states", kind: "read",
    calls: t3DetailCalls([T3.live, T3.states]), schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: t3DetailChecks },
  { stage: "S5c", mode: "off", slug: "number-timeline", route: "GET /numbers/:id/timeline (v2, NUMBERS_HAS_CALLS_DEFAULT off)", params: "limit=50; limit=50&kinds[]=call", kind: "read",
    calls: t3TimelineCalls([T3.live, T3.states], "numbers", true), schema: timelineServer, admin: [adminSchema("timelineSchema")], checks: t3CallChecks },
  { stage: "S5c", mode: "off", slug: "numbers", route: "GET /numbers (NUMBERS_HAS_CALLS_DEFAULT off)", params: "default; limit=200", kind: "read",
    calls: fixed([{ state: "default", path: "/numbers" }, { state: "limit-200", path: "/numbers?limit=200" }]),
    schema: numbersServer, admin: [adminSchema("numberSearchSchema")], checks: t3NumbersChecks("off") },
  { stage: "S5c", mode: "off", slug: "number", route: "GET /numbers/:id (NUMBERS_HAS_CALLS_DEFAULT off)", params: "T3-form-created-number", kind: "read",
    calls: t3FormNumberCall, schema: numberDetailServer, admin: [adminSchema("numberSchema")], checks: t3FormNumberCheck },
  { stage: "S5c", mode: "off", slug: "coverage", route: "GET /coverage (NUMBERS_HAS_CALLS_DEFAULT off)", params: "seed", kind: "read",
    calls: fixed([{ state: "seed", path: "/coverage" }]), schema: coverageRouteSchema, admin: [adminSchema("ownerCoverageSchema")], checks: t3CoverageChecks },
);

// ── CF6 / CF7 / CF9 (Team 3, SEED-T3 part 2, 2026-09-24): assignment addendum §2, §3, §5, §2.2a, §6–§7 ─────────
// Flags on: production's (ATTENTION_V2, TIMELINE_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, CAPTURE_WEBHOOK) plus every Team 3
// flag that has code on the branch (NUMBERS_HAS_CALLS_DEFAULT, PRIORITY5_CLOSURE, OVERVIEW, RECEIVER_ASSIGNMENT, RECEIVER_LATEST_WINS).
// Flag off (`flag-off/`): production today, i.e. every Team 3 flag off, with the snapshot republished with PRIORITY5_CLOSURE and OVERVIEW off.
const labelRow = (ctx: CheckContext, label: string) => (ctx.rows ? byLabel(ctx.rows, label) : null);
const rowByRecord = (body: any, recordId: string | null | undefined) => items(body).find(item => item.outreach?.id === recordId) ?? null;
const labelCalls = (labels: readonly string[], path: (row: SiManifestRow) => string | null, suffix?: string) => (rows: readonly SiManifestRow[]) =>
  perRow(row => { const p = labels.includes(row.label) ? path(row) : null; return p ? [{ path: p, ...(suffix ? { suffix } : {}) }] : []; })(rows);
const P5 = { accepted: "T3-p5-accepted", uncertain: "T3-p5-uncertain", toOne: "T3-p5-to-1", upgrade: "T3-p5-booking-upgrade" } as const;
const RECEIVER_LABELS = ["T3-receiver-manual", "T3-receiver-granot", "T3-receiver-extension", "T3-receiver-sheet", "T3-receiver-ringcentral", "T3-granot-rep-change"] as const;
const RECEIVER_SOURCE: Record<string, string> = { "t3-receiver-manual": "manual", "t3-receiver-granot": "granot_username_match", "t3-receiver-extension": "extension_match",
  "t3-receiver-sheet": "best_relocation_sheet", "t3-receiver-ringcentral": "ringcentral_answered", "t3-granot-rep-change": "granot_username_match" };
const ACROSS = ["T3-promise-across-a", "T3-promise-across-b"] as const;

function s6ClosedChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body), ...attentionRowsCarryS2(body, true)];
  const accepted = rowByRecord(body, labelRow(ctx, P5.accepted)?.outreach_record_id), upgraded = rowByRecord(body, labelRow(ctx, P5.upgrade)?.outreach_record_id);
  const toOne = rowByRecord(body, labelRow(ctx, P5.toOne)?.outreach_record_id);
  if (ctx.state !== "closed-outcome-booked") {
    // The outcome's Priority is the Lead's current code: 5 "Booked in Granot" for the accepted 5; 1 "Quoted" after 5 → 1 (still closed granot_booked, reopen review open).
    for (const [what, row, code, label] of [["T3-p5-accepted", accepted, "5", "Booked in Granot"], ["T3-p5-to-1", toOne, "1", "Quoted"]] as const) {
      if (!row) out.push(`${what}: no closed row`);
      else if (row.outcome?.reason !== "granot_booked" || row.outcome?.priority?.code !== code || row.outcome?.priority?.label !== label || row.filter_keys?.outcome !== "granot_booked")
        out.push(`${what}: outcome ${JSON.stringify(row.outcome)}, filter_keys.outcome ${row.filter_keys?.outcome}`);
    }
  }
  if (ctx.state !== "closed-outcome-granot-booked") {
    if (!upgraded) out.push("T3-p5-booking-upgrade: no closed row");
    else if (upgraded.outcome?.reason !== "booked") out.push(`T3-p5-booking-upgrade: outcome ${upgraded.outcome?.reason}, expected the upgraded official booked`);
  }
  const want = ctx.state === "closed-outcome-granot-booked" ? "granot_booked" : ctx.state === "closed-outcome-booked" ? "booked" : null;
  if (want) out.push(...closedOutcome(want)(body));
  return out;
}
function s6ActiveChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  const uncertain = rowByRecord(body, labelRow(ctx, P5.uncertain)?.outreach_record_id);
  if (!uncertain) { if (ctx.state === "all-outreach") out.push("T3-p5-uncertain: no active row"); }
  else {
    if (uncertain.partition === "closed") out.push("T3-p5-uncertain is closed");
    if (uncertain.filter_keys?.needs_review !== true) out.push(`T3-p5-uncertain: filter_keys.needs_review ${uncertain.filter_keys?.needs_review} (the review badge)`);
    if (!uncertain.derived?.review_badges?.includes("disposition_review")) out.push(`T3-p5-uncertain: derived.review_badges ${JSON.stringify(uncertain.derived?.review_badges)} lacks disposition_review`);
    if (uncertain.outreach?.lead_progress?.provenance !== "uncertain") out.push(`T3-p5-uncertain: lead_progress.provenance ${uncertain.outreach?.lead_progress?.provenance}`);
  }
  for (const label of [P5.accepted, P5.upgrade]) if (rowByRecord(body, labelRow(ctx, label)?.outreach_record_id)) out.push(`${label} is on an active view`);
  return out;
}
function s6DetailChecks(body: any, ctx: CheckContext): string[] {
  const o = body?.data?.outreach;
  if (!o) return ["data.outreach missing"];
  const out: string[] = [];
  if (!has(o, "assignment") || !has(o.assignment, "origin") || !has(o.assignment, "agent")) out.push("assignment {agent, origin} missing");
  const lp = o.lead_progress;
  if (ctx.state === "t3-p5-accepted" && (o.state !== "closed" || lp?.closure?.basis !== "granot_booked" || lp?.priority_label !== "Booked in Granot" || lp?.disposition !== "crm_booked"))
    out.push(`accepted 5: state ${o.state}, lead_progress ${JSON.stringify({ disposition: lp?.disposition, closure: lp?.closure, label: lp?.priority_label })}`);
  if (ctx.state === "t3-p5-uncertain" && (o.state === "closed" || lp?.provenance !== "uncertain" || lp?.disposition !== "crm_booked")) out.push(`uncertain 5: state ${o.state}, provenance ${lp?.provenance}`);
  if (ctx.state === "t3-p5-to-1" && (o.state !== "closed" || lp?.granot_priority !== "1" || !lp?.reopen_review_id)) out.push(`5 → 1: state ${o.state}, code ${lp?.granot_priority}, reopen_review_id ${lp?.reopen_review_id}`);
  if (ctx.state === "t3-p5-booking-upgrade" && (o.state !== "closed" || lp?.closure?.basis === "granot_booked")) out.push(`upgrade: state ${o.state}, closure ${JSON.stringify(lp?.closure)}`);
  if (ctx.state.startsWith("t3-promise-across") && o.assignment?.origin !== "owner") out.push(`Owner assignment: origin ${o.assignment?.origin}`);
  // S6-AGENT (lands later): once the detail carries `receiver_agent`, it must show the seeded source.
  if (has(o, "receiver_agent") && RECEIVER_SOURCE[ctx.state] && o.receiver_agent?.source !== RECEIVER_SOURCE[ctx.state]) out.push(`receiver_agent.source ${o.receiver_agent?.source}, expected ${RECEIVER_SOURCE[ctx.state]}`);
  return out;
}

const PRESETS = { new: ["0", "not_set"], quoted: ["1"], other: ["3", "4", "7", "8", "9"] } as const;
const VIEWS = { attention: { param: "", count: "attention" }, "all-outreach": { param: "view=all_outreach&", count: "active" }, closed: { param: "view=closed&", count: "closed" } } as const;
function s7AttentionCalls(): CaptureCall[] {
  const calls: CaptureCall[] = [{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" },
    { state: "all-outreach-no-lead", path: "/attention?view=all_outreach&priority=no_lead&limit=200" }];
  for (const [view, v] of Object.entries(VIEWS)) {
    calls.push({ state: `${view}-preset-new`, path: `/attention?${v.param}priority=0&priority=not_set&limit=200` });
    calls.push({ state: `${view}-preset-quoted`, path: `/attention?${v.param}priority=1&limit=200` });
    calls.push({ state: `${view}-preset-other`, path: `/attention?${v.param}priority=${PRESETS.other.join(",")}&limit=200` });
  }
  return calls;
}
function s7AttentionChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  const counts = body?.data?.priority_counts;
  if (!counts) out.push("data.priority_counts missing");
  else for (const key of ["no_lead", "not_set", "0", "1", "3", "4", "7", "8", "9", "5"]) if (!has(counts, key)) out.push(`priority_counts lacks ${key}`);
  const preset = /^(attention|all-outreach|closed)-preset-(new|quoted|other)$/.exec(ctx.state);
  const keyOf = (row: any) => row.filter_keys?.priority ?? "not_set";
  if (preset) {
    const keys: readonly string[] = PRESETS[preset[2] as keyof typeof PRESETS];
    const rows = items(body).filter(row => row.outreach);
    const outside = rows.filter(row => !keys.includes(keyOf(row)));
    if (outside.length) out.push(`${outside.length} rows outside the preset ${keys.join(",")}: ${[...new Set(outside.map(keyOf))].join(",")}`);
    if (preset[1] === "closed") out.push(...attentionRowsCarryS2(body, true));
    const view = VIEWS[preset[1] as keyof typeof VIEWS];
    const expected = counts ? keys.reduce((sum, key) => sum + (counts[key]?.[view.count] ?? 0), 0) : null;
    if (expected !== null && typeof body?.data?.total_items === "number" && body.data.total_items !== expected) out.push(`total_items ${body.data.total_items} ≠ Σ priority_counts.${view.count} ${expected} (C: a chip's count equals its rows)`);
  }
  if (ctx.state === "all-outreach" && !items(body).some(row => row.filter_keys?.priority === "no_lead")) out.push("no row carries filter_keys.priority no_lead");
  if (ctx.state === "all-outreach-no-lead" && (!items(body).length || items(body).some(row => row.filter_keys?.priority !== "no_lead"))) out.push("priority=no_lead returned another key (or nothing)");
  return out;
}
function s7ClosedHistoryCalls(): CaptureCall[] {
  const base = "/outreach/closed-history";
  const paged = (state: string, query: string): CaptureCall => ({ state: `${state}-page-1`, path: `${base}?${query}`,
    chain: [{ state: `${state}-page-2`, next: body => (body?.data?.cursor ? `${base}?${query}&cursor=${q(body.data.cursor)}` : null) }] });
  return [
    paged("default", "limit=5"),
    paged("outcome-booked-granot-booked", "outcome=booked&outcome=granot_booked&limit=2"),
    paged("priority-8", "priority=8&limit=1"),
    { state: "priority-5", path: `${base}?priority=5&limit=50` },
    { state: "before-90d", path: `${base}?closed_before=${q(isoAgo(90))}&limit=50` },
  ];
}
function s7ClosedHistoryChecks(body: any, ctx: CheckContext): string[] {
  const out: string[] = [];
  const rows = items(body);
  if (!rows.length) out.push("empty page");
  if (body?.data?.retention?.basis !== "activity") out.push("retention missing");
  for (const [i, row] of rows.entries()) {
    if (row.partition !== "closed" || !row.outcome || row.in_attention !== false) out.push(`items[${i}] is not a closed-partition row with an outcome`);
    if (i > 0 && Date.parse(row.sort_keys?.closed ?? row.outcome?.closed_at ?? "") > Date.parse(rows[i - 1].sort_keys?.closed ?? rows[i - 1].outcome?.closed_at ?? "")) out.push(`items[${i}] out of closed_at desc order`);
    if (!has(row.filter_keys, "responsible")) out.push(`items[${i}].filter_keys.responsible missing`);
  }
  if (ctx.state.startsWith("outcome-booked-granot-booked") && rows.some(row => !["booked", "granot_booked"].includes(row.outcome?.reason))) out.push("outcome filter not held");
  if (ctx.state.startsWith("priority-8") && rows.some(row => row.filter_keys?.priority !== "8")) out.push("priority=8 filter not held");
  if (ctx.state === "priority-5" && (rows.some(row => row.filter_keys?.priority !== "5") || !rows.some(row => row.outcome?.reason === "granot_booked"))) out.push("priority=5 filter not held or no granot_booked row");
  if (ctx.state === "before-90d") {
    for (const label of ["T3-closed-200d", "S-closed-over-90d"]) if (!rowByRecord(body, labelRow(ctx, label)?.outreach_record_id)) out.push(`${label} not in Closed history before 90 days`);
    const old = rowByRecord(body, labelRow(ctx, "T3-closed-200d")?.outreach_record_id);
    if (old && (old.outcome?.reason !== "crm_dead" || old.outcome?.priority?.code !== "8")) out.push(`T3-closed-200d outcome ${JSON.stringify(old.outcome)}`);
  }
  if (ctx.state.endsWith("page-1") && !body?.data?.cursor) out.push("page 1 has no cursor for a page 2");
  return out;
}

const etDayKey = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
// CF8/CF9: the rep the S8 captures act as (a reviewed rep with records, follow-ups, a promise across records and closed work),
// and the other seeded reps whose names and values must never reach the rep's Overview (C11).
const REP_NAME = "Dana Reyes";
const OTHER_REP_NAMES = ["Marcus Bell", "Tina Cho"] as const;
/** The local API (`serve-csi-local.ts`) re-signs a request carrying this header as the named rep, exactly as the admin proxy does. */
const asRep = (env: CaptureEnv): Record<string, string> => ({ "x-csi-local-actor": `rep:${env.agents[REP_NAME]}` });
/** A rep-scoped Overview (S8-REP, E23, C11): the rep's own row, anonymous `team_medians`, and no other rep's name, id or values. */
function repOverviewChecks(body: any, agents?: Record<string, string> | null): string[] {
  const d = body?.data;
  if (!d) return ["data missing"];
  const out: string[] = [];
  const rep = agents?.[REP_NAME] ?? null;
  if (!d.scope?.agent_id) out.push("scope.agent_id missing: not a rep-scoped Overview");
  if (rep && d.scope?.agent_id !== rep) out.push(`scope.agent_id ${d.scope?.agent_id} is not the rep ${rep} (the server must force it)`);
  if (d.reps?.length !== 1 || d.reps[0].agent?.name !== REP_NAME || d.reps[0].agent?.id !== d.scope?.agent_id) out.push(`reps ${JSON.stringify(d.reps?.map((r: any) => r.agent?.name))}: expected exactly the rep's own row`);
  if (!d.team_medians || !(d.team_medians.reps >= 1)) out.push("team_medians missing on a rep read");
  if (d.unmapped !== null || d.unassigned !== null) out.push("unmapped / unassigned not null on a rep read (C11)");
  if ((d.spend?.by_rep ?? []).some((r: any) => r.agent_id !== d.scope?.agent_id)) out.push("spend.by_rep carries another rep or the Unassigned row (C11)");
  const text = JSON.stringify(d);
  for (const name of OTHER_REP_NAMES) if (text.includes(name)) out.push(`C11: another rep's name (${name}) in a rep's Overview`);
  for (const [name, id] of Object.entries(agents ?? {})) if (name !== REP_NAME && text.includes(id)) out.push(`C11: another rep's Agent id (${name}) in a rep's Overview`);
  if (!["ok", "attention", "broken"].includes(d.now?.capture_health?.status)) out.push("now.capture_health.status missing");
  return out;
}
function s9OverviewCalls(_rows: readonly SiManifestRow[], env: CaptureEnv): CaptureCall[] {
  const today = etDayKey(new Date());
  const scoped = (body: any) => { const id = body?.data?.reps?.find((r: any) => r.agent?.name === "Dana Reyes")?.agent?.id; return id ? `/overview?agent_id=${id}` : null; };
  // CF8 addition (S8-REP): the rep's own Overview for the same periods, as the rep (forced scope + team_medians).
  const rep = env?.agents?.[REP_NAME] ? asRep(env) : null;
  return [
    { state: "default", path: "/overview", chain: [{ state: "owner-one-rep-scope", next: scoped }] },
    { state: "today", path: "/overview?period=today" },
    { state: "last-7-days", path: "/overview?period=last_7_days" },
    { state: "custom", path: `/overview?period=custom&from=${dayMinus(today, 3)}&to=${today}` },
    { state: "preset-new", path: "/overview?period=last_7_days&priority=0,not_set" },
    ...(rep ? [
      { state: "rep-today", path: "/overview?period=today", headers: rep },
      { state: "rep-last-7-days", path: "/overview?period=last_7_days", headers: rep },
      { state: "rep-custom", path: `/overview?period=custom&from=${dayMinus(today, 3)}&to=${today}`, headers: rep },
    ] : []),
  ];
}
function s9OverviewChecks(body: any, ctx: CheckContext): string[] {
  const d = body?.data;
  if (!d) return ["data missing"];
  if (ctx.state.startsWith("rep-")) {
    const out = repOverviewChecks(body, ctx.agents);
    const period = /^rep-(today|last-7-days|custom)$/.exec(ctx.state)?.[1]?.replace(/-/g, "_");
    if (period && d.periods?.activity?.key !== period) out.push(`periods.activity.key ${d.periods?.activity?.key}, expected ${period}`);
    return out;
  }
  const out: string[] = [];
  if (!["ok", "attention", "broken"].includes(d.now?.capture_health?.status)) out.push("now.capture_health.status missing");
  if (ctx.state === "owner-one-rep-scope") {
    if (d.reps?.length !== 1 || d.reps[0].agent?.name !== "Dana Reyes" || !d.team_medians || d.unmapped !== null || d.unassigned !== null) out.push("one-rep scope: expected one rep row, team_medians, null unmapped/unassigned");
    return out;
  }
  if (d.team_medians) out.push("team_medians on an unscoped Owner read");
  if (!(d.now?.live_calls >= 1)) out.push(`now.live_calls ${d.now?.live_calls}, expected ≥ 1 (T3-live-call)`);
  const rep = (name: string) => d.reps?.find((r: any) => r.agent?.name === name);
  if (ctx.state !== "preset-new") for (const name of ["Dana Reyes", "Marcus Bell"]) if (!(rep(name)?.interactions?.calls > 0)) out.push(`${name}: no calls in ${d.periods?.activity?.key}`);
  if (ctx.state !== "preset-new" && !d.unmapped?.extensions?.includes("107")) out.push(`unmapped.extensions ${JSON.stringify(d.unmapped?.extensions)} lacks 107`);
  if (!d.unassigned) out.push("unassigned null on an Owner read");
  if (["default", "last-7-days"].includes(ctx.state)) {
    const t = d.spend?.total;
    if (!(t?.rate > 0 && t?.legacy > 0 && t?.unpriced_leads >= 1 && t?.zero_leads >= 1)) out.push(`spend.total by basis ${JSON.stringify(t)}`);
    if (!(d.spend?.by_source?.length >= 2)) out.push("spend.by_source has fewer than 2 sources");
    if (!d.spend?.by_rep?.some((r: any) => r.agent_id === null)) out.push("spend.by_rep has no Unassigned (null) row");
  }
  if (ctx.state === "today") {
    const bands = d.desk?.flow?.bands;
    if (!(bands?.capture_repair >= 1) || !(bands?.excluded_baseline_or_policy >= 1) || !(bands?.moves >= 1)) out.push(`desk.flow.bands ${JSON.stringify(bands)}`);
  }
  return out;
}
const BAND = { call: "T3-band-call", repair: "T3-band-repair", owner: "T3-band-owner", policy: "AC-callback-customer-exact", baseline: "S-followup-due" } as const;
const BAND_CAUSE: Record<string, string[]> = { "t3-band-call": ["baseline", "call"], "t3-band-repair": ["baseline", "capture_repair"], "t3-band-owner": ["baseline", "owner"],
  "ac-callback-customer-exact": ["baseline", "policy"], "s-followup-due": ["baseline"] };
function s9BandSinceRows(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  const active = items(body).filter(row => row.outreach && row.partition !== "closed");
  if (!active.some(row => row.outreach.band_since?.estimated === true)) out.push("no row with band_since.estimated true");
  if (ctx.state === "all-outreach") {
    const call = rowByRecord(body, labelRow(ctx, BAND.call)?.outreach_record_id);
    if (!call || call.outreach.band_since?.estimated !== false) out.push(`T3-band-call band_since ${JSON.stringify(call?.outreach?.band_since)}, expected a measured (estimated false) start`);
  }
  for (const [i, row] of active.entries()) if (!has(row.outreach, "band_since") || !has(row.filter_keys, "responsible") || !has(row.filter_keys, "overdue")) out.push(`items[${i}] lacks band_since / filter_keys.responsible / overdue`);
  return out;
}
function s9DetailChecks(body: any, ctx: CheckContext): string[] {
  const since = body?.data?.outreach?.band_since;
  if (since === undefined) return ["data.outreach.band_since missing"];
  if (ctx.state === "s-followup-due" && since?.estimated !== true) return [`baseline record band_since ${JSON.stringify(since)}, expected estimated true`];
  if (ctx.state === "t3-band-call" && since?.estimated !== false) return [`T3-band-call band_since ${JSON.stringify(since)}`];
  return [];
}
function s9TimelineChecks(body: any, ctx: CheckContext): string[] {
  const state = ctx.state.replace(/-band-changed$/, "");
  const bands = items(body).filter(item => item.kind === "band_changed");
  const out: string[] = [];
  if (ctx.state.endsWith("-band-changed") && items(body).some(item => item.kind !== "band_changed")) out.push("kinds[]=band_changed returned another kind");
  const causes = new Set(bands.map(item => item.detail?.cause?.kind));
  for (const cause of BAND_CAUSE[state] ?? []) if (!causes.has(cause)) out.push(`no band_changed with cause ${cause} (causes: ${[...causes].join(",")})`);
  for (const item of bands) {
    const cause = item.detail?.cause?.kind;
    if (cause === "baseline" && item.detail?.estimated !== true) out.push("baseline band_changed not estimated");
    if (item.routine !== !["call", "capture_repair", "owner"].includes(cause)) out.push(`band_changed ${cause}: routine ${item.routine}`);
  }
  return out;
}
async function overviewSchema(): Promise<ResolvedSchema> {
  const { overviewDtoSchema } = await import("../../../src/services/salesIntelligence/overview/dto");
  const { z } = await import("zod");
  return { schema: z.object({ data: overviewDtoSchema }).strict(), name: "{ data: overviewDtoSchema } (GET /overview)", source: "server" };
}
const closedHistoryServer = serverSchema(() => import("../../../src/services/salesIntelligence/outreach/closedHistory") as Promise<Mod>, "closedHistoryPageDtoSchema", "outreach/closedHistory.ts");
const bandTimelineCalls = (rows: readonly SiManifestRow[]) => perRow(row => {
  if (!(Object.values(BAND) as string[]).includes(row.label) || !row.outreach_record_id) return [];
  const base = `/outreach/${row.outreach_record_id}/timeline?limit=50`;
  return [{ suffix: "band-changed", path: `${base}&kinds[]=band_changed` }, ...(row.label === BAND.call ? [{ path: base }] : [])];
})(rows);
const P5_ALL = [P5.accepted, P5.uncertain, P5.toOne, P5.upgrade];
ROUTES.push(
  // ── CF6 ──
  { stage: "S6", mode: "on", slug: "attention-closed", route: "GET /attention?view=closed", params: "view=closed&limit=200; &outcome=granot_booked; &outcome=booked", kind: "read",
    calls: fixed([{ state: "closed", path: "/attention?view=closed&limit=200" }, { state: "closed-outcome-granot-booked", path: "/attention?view=closed&outcome=granot_booked&limit=200" },
      { state: "closed-outcome-booked", path: "/attention?view=closed&outcome=booked&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s6ClosedChecks },
  { stage: "S6", mode: "on", slug: "attention", route: "GET /attention", params: "limit=200 default; view=all_outreach&limit=200 (the uncertain 5 with its review badge)", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s6ActiveChecks },
  { stage: "S6", mode: "on", slug: "outreach", route: "GET /outreach/:id", params: `${[...P5_ALL, ...RECEIVER_LABELS, ...ACROSS].join(", ")}`, kind: "read",
    calls: labelCalls([...P5_ALL, ...RECEIVER_LABELS, ...ACROSS], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: s6DetailChecks },
  { stage: "S6", mode: "on", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", params: "limit=50: the Priority 5 closures, the reopen review, the upgrade", kind: "read",
    calls: labelCalls(P5_ALL, row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null)), schema: timelineServer },
  { stage: "S6", mode: "off", slug: "attention", route: "GET /attention (Team 3 flags off)", params: "limit=200 default; view=all_outreach; view=closed", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }, { state: "closed", path: "/attention?view=closed&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: flagOnHeader },
  { stage: "S6", mode: "off", slug: "outreach", route: "GET /outreach/:id (Team 3 flags off)", params: `${[...P5_ALL, ACROSS[0]].join(", ")}`, kind: "read",
    calls: labelCalls([...P5_ALL, ACROSS[0]], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: body => (has(body?.data?.outreach, "band_since") ? ["flag-off detail carries band_since"] : []) },
  { stage: "S6", mode: "off", slug: "number-timeline", route: "GET /numbers/:id/timeline (v2, Team 3 flags off)", params: "T3-p5-accepted, T3-p5-booking-upgrade", kind: "read",
    calls: labelCalls([P5.accepted, P5.upgrade], row => (row.contact_number_id ? `/numbers/${row.contact_number_id}/timeline?limit=50` : null)),
    schema: timelineServer, admin: [adminSchema("timelineSchema")] },

  // ── CF7 ── (S7 is unflagged: the production Admin must parse these as they are)
  { stage: "S7", mode: "on", slug: "attention", route: "GET /attention", params: "priority presets New 0,not_set / Quoted 1 / Other 3,4,7,8,9 in view attention, all_outreach, closed; priority=no_lead", kind: "read",
    calls: s7AttentionCalls, schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s7AttentionChecks },
  { stage: "S7", mode: "on", slug: "closed-history", route: "GET /outreach/closed-history", params: "limit=5 pages 1–2; outcome=booked&outcome=granot_booked&limit=2 pages 1–2; priority=8&limit=1 pages 1–2; priority=5; closed_before=90 days ago",
    kind: "read", calls: s7ClosedHistoryCalls, schema: closedHistoryServer, checks: s7ClosedHistoryChecks },

  // ── CF9 ──
  { stage: "S9", mode: "on", slug: "overview", route: "GET /overview", params: "default (activity Today, spend Last 7 days); period=today; last_7_days; custom (3 ET days back → today); preset New; Owner one-rep scope (agent_id); CF8: as the rep (Dana Reyes) for today, last_7_days, custom",
    kind: "read", calls: s9OverviewCalls, schema: overviewSchema, checks: s9OverviewChecks },
  { stage: "S9", mode: "on", slug: "attention", route: "GET /attention", params: "limit=200 default; view=all_outreach&limit=200 (band_since, filter_keys.responsible/overdue)", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s9BandSinceRows },
  { stage: "S9", mode: "on", slug: "outreach", route: "GET /outreach/:id", params: Object.values(BAND).join(", "), kind: "read",
    calls: labelCalls(Object.values(BAND), row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: s9DetailChecks },
  { stage: "S9", mode: "on", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", params: "limit=50&kinds[]=band_changed per cause; limit=50 on T3-band-call", kind: "read",
    calls: bandTimelineCalls, schema: timelineServer, checks: s9TimelineChecks },
  { stage: "S9", mode: "off", slug: "overview", route: "GET /overview (OVERVIEW off)", params: "no params", kind: "status",
    calls: fixed([{ state: "feature-off", path: "/overview", expect: 404 }]), schema: statusSchema(404, "FEATURE_DISABLED", "Sales Intelligence is disabled") },
  { stage: "S9", mode: "off", slug: "attention", route: "GET /attention (OVERVIEW off)", params: "limit=200 default; view=all_outreach", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")],
    checks: body => [...flagOnHeader(body), ...(items(body).some(row => row.outreach && has(row.outreach, "band_since")) ? ["a flag-off row carries band_since"] : [])] },
  { stage: "S9", mode: "off", slug: "outreach", route: "GET /outreach/:id (OVERVIEW off)", params: `${BAND.call}, ${BAND.baseline}`, kind: "read",
    calls: labelCalls([BAND.call, BAND.baseline], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: body => (has(body?.data?.outreach, "band_since") ? ["flag-off detail carries band_since"] : []) },
  { stage: "S9", mode: "off", slug: "outreach-timeline", route: "GET /outreach/:id/timeline (OVERVIEW off)", params: "limit=50 on T3-band-call (no band_changed)", kind: "read",
    calls: labelCalls([BAND.call], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null)), schema: timelineServer,
    checks: body => (items(body).some(item => item.kind === "band_changed") ? ["band_changed on a flag-off timeline"] : []) },
  { stage: "S9", mode: "off", slug: "outreach-timeline-band-changed", route: "GET /outreach/:id/timeline?kinds[]=band_changed (OVERVIEW off)", params: "T3-band-call: rejected as an unknown kind", kind: "status",
    calls: rows => labelCalls([BAND.call], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50&kinds[]=band_changed` : null))(rows).map(c => ({ ...c, expect: 400 })),
    schema: statusSchema(400, "INVALID_INPUT") },
  { stage: "S9", mode: "off", slug: "number-timeline", route: "GET /numbers/:id/timeline (v2, OVERVIEW off)", params: "T3-band-call", kind: "read",
    calls: labelCalls([BAND.call], row => (row.contact_number_id ? `/numbers/${row.contact_number_id}/timeline?limit=50` : null)),
    schema: timelineServer, admin: [adminSchema("timelineSchema")] },
);

// ── CF8 (S8-REP, assignment addendum §4.2, E8–E11, E23, C6, C11): every Sales Intelligence route as a rep ──
// The rep is Dana Reyes (seed Agent), signed by the local API exactly as the admin proxy signs a rep session. In her E11 scope:
// records she is responsible for (AC-*, T3-*), S-findings and T3-promise-across-b through follow-ups she promised. Out of scope:
// every S-* record without her, and their Numbers / conversations. Commands run against `--command-base` (a disposable copy).
const S8 = {
  findings: "S-findings", owned: "AC-callback-owner-exact", promisedOnly: "T3-promise-across-b", closed: "T3-p5-accepted",
  outRecords: ["S-audio-purged", "T3-band-call", "S-number-only"], outTimeline: "S-timeline-300", outAssessment: "S-engagement",
  outFindings: "S-suggestion-open", outNumbers: ["S-audio-purged", "S-calls-60"], outConversation: "S-audio-purged",
} as const;
/** A well-formed id no seeded row has: the "missing record" answer an out-of-scope id must be identical to. */
const S8_MISSING_ID = "5eed00000000000000000dea";
const repId = (ctx: CheckContext) => ctx.agents?.[REP_NAME] ?? null;
const rowAgents = (row: any): string[] => row?.filter_keys?.agents ?? [];
/** As `labelCalls`, with the call's headers (rep or not) and target. */
const s8Label = (labels: readonly string[], path: (row: SiManifestRow) => string | null, extra: (env: CaptureEnv) => Partial<CaptureCall> = () => ({}), suffix?: string) =>
  (rows: readonly SiManifestRow[], env: CaptureEnv) => labelCalls(labels, path, suffix)(rows).map(call => ({ ...call, ...extra(env) }));
const repOf = (env: CaptureEnv) => ({ headers: asRep(env) });
const labelOfState = (ctx: CheckContext) => ctx.rows?.find(row => stateOf(row.label) === ctx.state.replace(/-(include-superseded|after-commands)$/, "")) ?? null;

const S8_VIEW_COUNT = (state: string) => (state.startsWith("closed") ? "closed" : state.startsWith("default") ? "attention" : "active");
function s8RepDeskCalls(_rows: readonly SiManifestRow[], env: CaptureEnv): CaptureCall[] {
  const h = asRep(env), other = env.agents[OTHER_REP_NAMES[0]];
  const all = "/attention?view=all_outreach&limit=200";
  return [
    { state: "default", path: "/attention?limit=200", headers: h },
    { state: "all-outreach", path: all, headers: h },
    { state: "closed", path: "/attention?view=closed&limit=200", headers: h },
    // The rep asks for another rep and for Unassigned: the server ignores both and forces agent_id = the rep.
    { state: "all-outreach-param-agent-other-rep", path: `${all}&agent_id=${other}`, headers: h },
    { state: "all-outreach-param-unassigned", path: `${all}&unassigned=true`, headers: h },
    { state: "default-param-agent-other-rep", path: `/attention?limit=200&agent_id=${other}`, headers: h },
    { state: "all-outreach-preset-other", path: `${all}&priority=${PRESETS.other.join(",")}`, headers: h },
    { state: "page-1", path: "/attention?view=all_outreach&limit=5", headers: h,
      chain: [{ state: "page-2", next: body => (body?.data?.cursor ? `/attention?view=all_outreach&limit=5&cursor=${q(body.data.cursor)}` : null) }] },
  ];
}
function s8RepDeskChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  const rep = repId(ctx);
  if (!rep) return [...out, "no rep Agent id in the stage manifest"];
  const rows = items(body).filter(row => row.outreach);
  if (!rows.length) out.push("empty rep desk page");
  const outside = rows.filter(row => !rowAgents(row).includes(rep));
  if (outside.length) out.push(`${outside.length} rows outside the rep's scope (filter_keys.agents lacks the rep)`);
  const counts = body?.data?.priority_counts;
  if (!counts) out.push("data.priority_counts missing");
  else if (!ctx.state.startsWith("page")) {
    const view = S8_VIEW_COUNT(ctx.state);
    const keys = ctx.state.endsWith("preset-other") ? PRESETS.other : Object.keys(counts);
    const sum = keys.reduce((total: number, key: string) => total + (counts[key]?.[view] ?? 0), 0);
    if (body?.data?.total_items !== sum) out.push(`total_items ${body?.data?.total_items} ≠ Σ rep priority_counts.${view} ${sum} (the rep's chips count the rep's rows)`);
  }
  if (ctx.state.endsWith("preset-other") && rows.some(row => !(PRESETS.other as readonly string[]).includes(row.filter_keys?.priority ?? "not_set"))) out.push("preset Other returned another Priority");
  out.push(...attentionRowsCarryS2(body, ctx.state.startsWith("closed")));
  return out;
}
function s8OwnerDeskChecks(body: any, ctx: CheckContext): string[] {
  const out = [...flagOnHeader(body)];
  const rep = repId(ctx);
  const rows = items(body).filter(row => row.outreach);
  if (!rep) return [...out, "no rep Agent id in the stage manifest"];
  if (ctx.state.endsWith("agent-rep")) {
    if (!rows.length || rows.some(row => !rowAgents(row).includes(rep))) out.push("the Owner's agent_id=<rep> page is empty or holds another rep's row");
  } else if (!rows.some(row => !rowAgents(row).includes(rep))) out.push("the Owner's unscoped desk holds only the rep's rows (expected the whole desk)");
  return out;
}
function s8DetailChecks(rep: boolean) {
  return (body: any, ctx: CheckContext): string[] => {
    const out: string[] = [];
    const row = labelOfState(ctx);
    if (row && body?.data?.outreach?.id !== row.outreach_record_id) out.push(`data.outreach.id ${body?.data?.outreach?.id} is not ${row.label}'s record`);
    const nudges = body?.data?.nudges;
    if (rep && (!nudges || nudges.items?.length !== 0 || nudges.next_cursor !== null)) out.push("a rep's detail carries Owner→rep nudges");
    return out;
  };
}
function s8ClosedHistoryChecks(rep: boolean) {
  return (body: any, ctx: CheckContext): string[] => {
    const out: string[] = [];
    const agent = repId(ctx);
    const rows = items(body);
    if (!rows.length) out.push("empty page");
    if (body?.data?.retention?.basis !== "activity") out.push("retention missing");
    for (const [i, row] of rows.entries()) if (row.partition !== "closed" || !row.outcome) out.push(`items[${i}] is not a closed-partition row with an outcome`);
    const mine = (row: any) => rowAgents(row).includes(agent!) || row.filter_keys?.responsible === agent;
    if (rep && rows.some(row => !mine(row))) out.push("a rep's Closed history holds a row outside the rep's scope");
    if (!rep && !rows.some(row => !mine(row))) out.push("the Owner's Closed history holds only the rep's rows");
    if (ctx.state.endsWith("page-1") && !body?.data?.cursor) out.push("page 1 has no cursor for a page 2");
    return out;
  };
}
function s8OwnerOverviewChecks(body: any, ctx: CheckContext): string[] {
  const d = body?.data;
  if (!d) return ["data missing"];
  if (ctx.state === "agent-rep") return d.reps?.length === 1 && d.reps[0].agent?.name === REP_NAME && d.team_medians && d.unmapped === null ? [] : ["Owner agent_id=<rep>: expected one rep row + team_medians"];
  return d.team_medians === undefined && d.scope === null && d.reps?.some((r: any) => r.agent?.name === OTHER_REP_NAMES[0]) ? [] : ["the Owner's unscoped Overview: expected scope null, no team_medians, every rep"];
}
/** 404 bodies: an out-of-scope id gets exactly what a missing one gets (same code and message, C6). */
const s8NotFound = (error: string) => statusSchema(404, "INVALID_INPUT", error);
const s8OwnerOnly = statusSchema(403, "OWNER_REQUIRED", "Sales Intelligence request rejected");

// Commands: `{ status, headers, body, request }` fixtures (the request is what the rep UI sends).
async function commandFixtureSchema(status: number, body: "ok" | { code: string; error?: string }): Promise<ResolvedSchema> {
  const { z } = await import("zod");
  const request = z.object({ method: z.enum(["POST", "PATCH"]), path: z.string(), body: z.record(z.string(), z.unknown()) }).strict();
  const issues = z.array(z.object({ path: z.string(), code: z.string() }).strict());
  const responseBody = body === "ok"
    ? z.object({ ok: z.literal(true), data: z.object({ response: z.object({ id: z.string(), revision: z.number().int(), outreach_revision: z.number().int(), state: z.string() }).strict(),
      replayed: z.boolean() }).strict() }).strict()
    : z.object({ ok: z.literal(false), code: z.literal(body.code), error: body.error ? z.literal(body.error) : z.string(), request_id: z.string(), issues: issues.optional() }).strict();
  return { schema: z.object({ status: z.literal(status), headers: z.record(z.string(), z.string()), body: responseBody, request }).strict(),
    name: `command ${status}${body === "ok" ? " {ok, data: {response, replayed}}" : ` ${body.code}`} + request`, source: "script-local" };
}
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type CommandCall = CaptureCall & { method: "POST" | "PATCH" };
function s8CommandCalls(kind: "ok" | "refused" | "invalid") {
  return (rows: readonly SiManifestRow[], env: CaptureEnv): CaptureCall[] => {
    const own = env.followups.own, other = env.followups.other_rep_promise, promised = env.followups.rep_promised_not_responsible;
    const record = byLabel(rows, S8.owned)?.outreach_record_id;
    if (!own || !record) return [];
    const c = (state: string, method: "POST" | "PATCH", path: string, body: Record<string, unknown>, expect: number): CommandCall =>
      ({ state, method, path, body, expect, headers: asRep(env), target: "command" });
    const f = (id: string) => `/followups/${id}`;
    if (kind === "refused") return [
      c("close-record", "POST", `/outreach/${record}/commands`, { command: "close", expected_revision: 1, reason: "lost" }, 403),
      c("assign-record", "POST", `/outreach/${record}/commands`, { command: "assign", expected_revision: 1, responsible_agent_id: env.agents[OTHER_REP_NAMES[0]] }, 403),
      c("add-note-record", "POST", `/outreach/${record}/commands`, { command: "add_note", expected_revision: 1, text: "Left a voicemail" }, 403),
      c("create-followup", "POST", "/followups", { command: "create_followup", expected_revision: 1, outreach_record_id: record, action: { kind: "call", description: "Call back", due_at: null } }, 403),
      c("cancel-own-followup", "POST", `${f(own.id)}/cancel`, { command: "cancel_followup", expected_revision: own.revision, reason: "Duplicate" }, 403),
      c("redate-with-description", "PATCH", f(own.id), { command: "patch_followup", expected_revision: own.revision, changes: { due_at: inDays(3), description: "Call about the quote" }, reason: "Customer asked for Monday" }, 403),
      c("complete-with-next", "POST", `${f(own.id)}/complete`, { command: "complete_followup", expected_revision: own.revision, disposition: "spoke_with_customer", note: "Spoke",
        next: { kind: "call", description: "Call again", due_at: null } }, 403),
      ...(other ? [c("complete-other-rep-followup", "POST", `${f(other.id)}/complete`, { command: "complete_followup", expected_revision: other.revision, disposition: "spoke_with_customer", note: "Spoke with the customer" }, 403)] : []),
      ...(promised ? [c("complete-promised-not-responsible", "POST", `${f(promised.id)}/complete`, { command: "complete_followup", expected_revision: promised.revision, disposition: "spoke_with_customer", note: "Spoke with the customer" }, 403)] : []),
    ];
    if (kind === "invalid") return [
      c("complete-missing-note", "POST", `${f(own.id)}/complete`, { command: "complete_followup", expected_revision: own.revision, disposition: "spoke_with_customer" }, 400),
      c("complete-blank-note", "POST", `${f(own.id)}/complete`, { command: "complete_followup", expected_revision: own.revision, disposition: "spoke_with_customer", note: "   " }, 400),
      c("snooze-blank-reason", "POST", `${f(own.id)}/snooze`, { command: "snooze_followup", expected_revision: own.revision, until: inDays(2), reason: " " }, 400),
      c("redate-blank-reason", "PATCH", f(own.id), { command: "patch_followup", expected_revision: own.revision, changes: { due_at: inDays(3) }, reason: " " }, 400),
    ];
    // Allowed (E9), in order on the rep's own open follow-up: snooze, re-date, complete. Each bumps its revision by one.
    return [
      c("snooze-own", "POST", `${f(own.id)}/snooze`, { command: "snooze_followup", expected_revision: own.revision, until: inDays(2), reason: "Customer is at work until Friday" }, 200),
      c("redate-own", "PATCH", f(own.id), { command: "patch_followup", expected_revision: own.revision + 1, changes: { due_at: inDays(3), date_note: "Monday morning" }, reason: "Customer asked for Monday" }, 200),
      c("complete-own", "POST", `${f(own.id)}/complete`, { command: "complete_followup", expected_revision: own.revision + 2, disposition: "spoke_with_customer", note: "Spoke with the customer; quote sent" }, 200),
    ];
  };
}
function s8CommandChecks(body: any, ctx: CheckContext): string[] {
  const code = body?.code, issues = JSON.stringify(body?.issues ?? []);
  const want: Record<string, (b: any) => boolean> = {
    "redate-with-description": () => code === "FORBIDDEN" && issues.includes("changes.description"),
    "complete-with-next": () => code === "FORBIDDEN" && issues.includes("\"next\""),
    "complete-missing-note": () => code === "INVALID_INPUT" && issues.includes("\"note\""),
    // A blank (whitespace) note or reason fails the command schema itself: the generic 400 "Invalid request", no issues.
    "complete-blank-note": b => code === "INVALID_INPUT" && b?.error === "Invalid request",
    "snooze-blank-reason": b => code === "INVALID_INPUT" && b?.error === "Invalid request",
    "redate-blank-reason": b => code === "INVALID_INPUT" && b?.error === "Invalid request",
    "complete-own": b => b?.data?.response?.state !== undefined && b?.data?.replayed === false,
  };
  const check = want[ctx.state];
  return check && !check(body) ? [`${ctx.state}: unexpected body ${JSON.stringify(body).slice(0, 200)}`] : [];
}
function s8AfterCommandChecks(body: any): string[] {
  const followups: any[] = body?.data?.outreach?.followups ?? body?.data?.followups ?? [];
  const text = JSON.stringify(body);
  const out: string[] = [];
  if (!text.includes("Spoke with the customer; quote sent") && !followups.some(f => f.status === "completed")) out.push("the rep's completed follow-up is not visible after the commands");
  return out;
}
const s8Cmd = (kind: "ok" | "refused" | "invalid") => ({ kind: "status" as const, calls: s8CommandCalls(kind) });

ROUTES.push(
  // ── CF8, flags on (production's six + Team 3's five + REP_ACCESS) ──
  // Desk: forced agent_id, rep-scoped tiles and chip counts; the Owner's same reads for comparison.
  { stage: "S8", mode: "on", slug: "rep-attention", route: "GET /attention (as the rep)", params: "default; all_outreach; closed; &agent_id=<other rep>; &unassigned=true; default &agent_id=<other rep>; preset Other; limit=5 pages 1–2",
    kind: "read", calls: s8RepDeskCalls, schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s8RepDeskChecks },
  { stage: "S8", mode: "on", slug: "owner-attention", route: "GET /attention (Owner)", params: "default; all_outreach; all_outreach&agent_id=<rep> (the Owner's view of the rep's scope)", kind: "read",
    calls: (_rows, env) => [{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" },
      { state: "all-outreach-agent-rep", path: `/attention?view=all_outreach&limit=200&agent_id=${env.agents[REP_NAME]}` }],
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: s8OwnerDeskChecks },
  // Record reads in scope (responsible; promised only; closed) and out of scope (404, identical to a missing id).
  { stage: "S8", mode: "on", slug: "rep-outreach", route: "GET /outreach/:id (as the rep, in scope)", params: `${S8.findings} (promised follow-up), ${S8.owned} (responsible), ${S8.promisedOnly} (promised, other rep responsible), ${S8.closed} (closed)`,
    kind: "read", calls: s8Label([S8.findings, S8.owned, S8.promisedOnly, S8.closed], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null), repOf),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: s8DetailChecks(true) },
  { stage: "S8", mode: "on", slug: "owner-outreach", route: "GET /outreach/:id (Owner)", params: `the same four records, and ${S8.outRecords[0]}`, kind: "read",
    calls: s8Label([S8.findings, S8.owned, S8.promisedOnly, S8.closed, S8.outRecords[0]], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: s8DetailChecks(false) },
  { stage: "S8", mode: "on", slug: "rep-outreach-out-of-scope", route: "GET /outreach/:id (as the rep, out of scope / missing)", params: `${S8.outRecords.join(", ")}; missing id`, kind: "status",
    calls: (rows, env) => [...s8Label(S8.outRecords, row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null), repOf)(rows, env).map(call => ({ ...call, expect: 404 })),
      { state: "missing-id", path: `/outreach/${S8_MISSING_ID}`, expect: 404, headers: asRep(env) }],
    schema: s8NotFound("Number not found") },
  { stage: "S8", mode: "on", slug: "owner-outreach-missing", route: "GET /outreach/:id (Owner, missing id)", params: "missing id: the body a rep's out-of-scope read must equal", kind: "status",
    calls: fixed([{ state: "missing-id", path: `/outreach/${S8_MISSING_ID}`, expect: 404 }]), schema: s8NotFound("Number not found") },
  { stage: "S8", mode: "on", slug: "rep-outreach-timeline", route: "GET /outreach/:id/timeline (as the rep)", params: `limit=50: ${S8.findings}, ${S8.owned}`, kind: "read",
    calls: s8Label([S8.findings, S8.owned], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null), repOf), schema: timelineServer },
  { stage: "S8", mode: "on", slug: "rep-outreach-timeline-out-of-scope", route: "GET /outreach/:id/timeline (as the rep, out of scope)", params: S8.outTimeline, kind: "status",
    calls: (rows, env) => s8Label([S8.outTimeline], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null), repOf)(rows, env).map(call => ({ ...call, expect: 404 })),
    schema: s8NotFound("Outreach not found") },
  { stage: "S8", mode: "on", slug: "rep-outreach-assessment", route: "GET /outreach/:id/assessment (as the rep)", params: S8.findings, kind: "read",
    calls: s8Label([S8.findings], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/assessment` : null), repOf),
    schema: ownerReadOf(load.assessmentDto, "outreachAssessmentDtoSchema", "assessment/dto.ts") },
  { stage: "S8", mode: "on", slug: "rep-outreach-assessment-out-of-scope", route: "GET /outreach/:id/assessment (as the rep, out of scope)", params: S8.outAssessment, kind: "status",
    calls: (rows, env) => s8Label([S8.outAssessment], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/assessment` : null), repOf)(rows, env).map(call => ({ ...call, expect: 404 })),
    schema: s8NotFound("Outreach not found") },
  { stage: "S8", mode: "on", slug: "rep-outreach-findings", route: "GET /outreach/:id/findings (as the rep)", params: `${S8.findings}; include_superseded=true`, kind: "read",
    calls: (rows, env) => [...s8Label([S8.findings], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/findings` : null), repOf)(rows, env),
      ...s8Label([S8.findings], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/findings?include_superseded=true` : null), repOf, "include-superseded")(rows, env)],
    schema: serverSchema(load.findings, "currentFindingsResponseSchema", "analysis/currentFindings.ts"), checks: body => (items(body).length ? [] : ["S-findings has no current findings for the rep"]) },
  { stage: "S8", mode: "on", slug: "rep-outreach-findings-out-of-scope", route: "GET /outreach/:id/findings (as the rep, out of scope)", params: S8.outFindings, kind: "status",
    calls: (rows, env) => s8Label([S8.outFindings], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/findings` : null), repOf)(rows, env).map(call => ({ ...call, expect: 404 })),
    schema: s8NotFound("Outreach not found") },
  // Number- and conversation-keyed reads: in scope through an in-scope record on the Number.
  { stage: "S8", mode: "on", slug: "rep-number-conversations", route: "GET /numbers/:id/conversations (as the rep)", params: `${S8.findings}'s Number`, kind: "read",
    calls: s8Label([S8.findings], row => (row.contact_number_id ? `/numbers/${row.contact_number_id}/conversations` : null), repOf),
    schema: serverSchema(load.conversations, "ownerConversationsResponseSchema", "analysis/ownerConversations.ts") },
  { stage: "S8", mode: "on", slug: "rep-number-conversations-out-of-scope", route: "GET /numbers/:id/conversations (as the rep, out of scope)", params: S8.outNumbers.join(", "), kind: "status",
    calls: (rows, env) => s8Label(S8.outNumbers, row => (row.contact_number_id ? `/numbers/${row.contact_number_id}/conversations` : null), repOf)(rows, env).map(call => ({ ...call, expect: 404 })),
    schema: s8NotFound("Number not found") },
  { stage: "S8", mode: "on", slug: "rep-conversation-transcript", route: "GET /conversations/:id/transcript (as the rep)", params: `${S8.findings} first conversation`, kind: "read",
    calls: (rows, env) => perRow(row => (row.label === S8.findings && row.conversation_ids[0] ? [{ suffix: "c1", path: `/conversations/${row.conversation_ids[0]}/transcript`, headers: asRep(env) }] : []))(rows),
    schema: serverSchema(load.conversations, "ownerTranscriptResponseSchema", "analysis/ownerConversations.ts") },
  { stage: "S8", mode: "on", slug: "rep-conversation-transcript-out-of-scope", route: "GET /conversations/:id/transcript (as the rep, out of scope)", params: `${S8.outConversation} first conversation`, kind: "status",
    calls: (rows, env) => perRow(row => (row.label === S8.outConversation && row.conversation_ids[0] ? [{ suffix: "c1", path: `/conversations/${row.conversation_ids[0]}/transcript`, expect: 404, headers: asRep(env) }] : []))(rows),
    schema: s8NotFound("Conversation not found") },
  // Media out of scope: 404 before any audit row, for a purged (c1) and a retained (c2; the Owner gets the audited 500 with no Blob store) recording.
  { stage: "S8", mode: "on", slug: "rep-conversation-media-out-of-scope", route: "GET /conversations/:id/media (as the rep, out of scope)", params: `Range: bytes=0-99; ${S8.outConversation} c1 (purged), c2 (retained)`, kind: "status",
    calls: (rows, env) => perRow(row => (row.label === S8.outConversation ? row.conversation_ids.slice(0, 2).map((id, i) => ({ suffix: `c${i + 1}`, path: `/conversations/${id}/media`, expect: 404,
      headers: { ...asRep(env), Range: "bytes=0-99" } })) : []))(rows),
    schema: s8NotFound("Recording not found") },
  // Media in scope: the route audits `media_played` with the rep as actor, so it runs on the disposable copy (no Blob store locally: 500 after the audit).
  { stage: "S8", mode: "on", slug: "rep-conversation-media", route: "GET /conversations/:id/media (as the rep, in scope; on the command copy)", params: `Range: bytes=0-99; ${S8.findings} c3 (media retained)`, kind: "status",
    calls: (rows, env) => perRow(row => (row.label === S8.findings && row.conversation_ids[2] ? [{ suffix: "c3", path: `/conversations/${row.conversation_ids[2]}/media`, expect: 500,
      headers: { ...asRep(env), Range: "bytes=0-99" }, target: "command" as const }] : []))(rows),
    schema: statusSchema(500, "INVALID_INPUT", "Sales Intelligence request failed") },
  { stage: "S8", mode: "on", slug: "rep-conversation-media-no-recording", route: "GET /conversations/:id/media (as the rep, in scope, no stored recording; on the command copy)", params: `Range: bytes=0-99; ${S8.findings} c1 (no media)`, kind: "status",
    calls: (rows, env) => perRow(row => (row.label === S8.findings && row.conversation_ids[0] ? [{ suffix: "c1", path: `/conversations/${row.conversation_ids[0]}/media`, expect: 404,
      headers: { ...asRep(env), Range: "bytes=0-99" }, target: "command" as const }] : []))(rows),
    schema: s8NotFound("Recording not found") },
  // Closed history and Overview: forced to the rep.
  { stage: "S8", mode: "on", slug: "rep-closed-history", route: "GET /outreach/closed-history (as the rep)", params: "limit=2 pages 1–2; &agent_id=<other rep>", kind: "read",
    calls: (_rows, env) => [{ state: "default-page-1", path: "/outreach/closed-history?limit=2", headers: asRep(env),
      chain: [{ state: "default-page-2", next: body => (body?.data?.cursor ? `/outreach/closed-history?limit=2&cursor=${q(body.data.cursor)}` : null) }] },
      { state: "param-agent-other-rep", path: `/outreach/closed-history?limit=50&agent_id=${env.agents[OTHER_REP_NAMES[0]]}`, headers: asRep(env) }],
    schema: closedHistoryServer, checks: s8ClosedHistoryChecks(true) },
  { stage: "S8", mode: "on", slug: "owner-closed-history", route: "GET /outreach/closed-history (Owner)", params: "limit=50", kind: "read",
    calls: fixed([{ state: "default", path: "/outreach/closed-history?limit=50" }]), schema: closedHistoryServer, checks: s8ClosedHistoryChecks(false) },
  { stage: "S8", mode: "on", slug: "rep-overview", route: "GET /overview (as the rep)", params: "default; &agent_id=<other rep> (ignored)", kind: "read",
    calls: (_rows, env) => [{ state: "default", path: "/overview", headers: asRep(env) }, { state: "param-agent-other-rep", path: `/overview?agent_id=${env.agents[OTHER_REP_NAMES[0]]}`, headers: asRep(env) }],
    schema: overviewSchema, checks: (body, ctx) => repOverviewChecks(body, ctx.agents) },
  { stage: "S8", mode: "on", slug: "owner-overview", route: "GET /overview (Owner)", params: "default; agent_id=<rep>", kind: "read",
    calls: (_rows, env) => [{ state: "default", path: "/overview" }, { state: "agent-rep", path: `/overview?agent_id=${env.agents[REP_NAME]}` }],
    schema: overviewSchema, checks: s8OwnerOverviewChecks },
  // Owner-only reads a rep can't open (403 OWNER_REQUIRED), including a Number and artifacts inside the rep's scope.
  { stage: "S8", mode: "on", slug: "rep-owner-only", route: "GET <Owner-only read> (as the rep)", params: "numbers, number, number timeline, settings, coverage, reps, review-items, nudges, attachments, assessment, run presentation, conversation findings",
    kind: "status", calls: (rows, env) => {
      const row = byLabel(rows, S8.findings);
      const h = asRep(env);
      return [
        { state: "numbers", path: "/numbers" }, { state: "settings", path: "/settings" }, { state: "coverage", path: "/coverage" }, { state: "reps", path: "/reps" },
        { state: "review-items", path: "/review-items" }, { state: "nudges", path: "/nudges" }, { state: "attachments", path: "/attachments" },
        ...(row?.contact_number_id ? [{ state: "number-in-scope", path: `/numbers/${row.contact_number_id}` }, { state: "number-timeline-in-scope", path: `/numbers/${row.contact_number_id}/timeline?limit=50` }] : []),
        ...(row?.artifact_ids[0] ? [{ state: "assessment-artifact-in-scope", path: `/assessments/${row.artifact_ids[0]}` }] : []),
        ...(row?.run_ids[0] ? [{ state: "run-presentation-in-scope", path: `/analysis-runs/${row.run_ids[0]}/presentation` }] : []),
        ...(row?.conversation_ids[0] ? [{ state: "conversation-findings-in-scope", path: `/conversations/${row.conversation_ids[0]}/findings` }] : []),
      ].map(call => ({ ...call, expect: 403, headers: h }));
    }, schema: s8OwnerOnly },
  // Commands (E9), on the disposable copy: refused, invalid (a note is required), then allowed on the rep's own follow-up.
  { stage: "S8", mode: "on", slug: "rep-command-refused", route: "POST|PATCH <command route> (as the rep)", params: "close / assign / add_note / create_followup / cancel_followup / re-date with another field / complete with next / another rep's promise / a promise the rep made but isn't responsible for",
    ...s8Cmd("refused"), schema: () => commandFixtureSchema(403, { code: "FORBIDDEN", error: "Sales Intelligence request rejected" }), checks: s8CommandChecks },
  { stage: "S8", mode: "on", slug: "rep-command-invalid", route: "POST|PATCH <follow-up command> (as the rep, no note)", params: "complete without / with a blank note; snooze and re-date with a blank reason",
    ...s8Cmd("invalid"), schema: () => commandFixtureSchema(400, { code: "INVALID_INPUT" }), checks: s8CommandChecks },
  { stage: "S8", mode: "on", slug: "rep-command", route: "POST /followups/:id/snooze · PATCH /followups/:id · POST /followups/:id/complete (as the rep, own follow-up)", params: `${S8.owned}'s open follow-up: snooze, re-date (due_at + date_note), complete; each with a note`,
    ...s8Cmd("ok"), schema: () => commandFixtureSchema(200, "ok"), checks: s8CommandChecks },
  // After the commands (on the copy): what the rep and the Owner read.
  { stage: "S8", mode: "on", slug: "rep-outreach-after-commands", route: "GET /outreach/:id (as the rep, on the command copy, after the commands)", params: S8.owned, kind: "read",
    calls: s8Label([S8.owned], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null), env => ({ ...repOf(env), target: "command" as const })),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: (body, ctx) => [...s8DetailChecks(true)(body, ctx), ...s8AfterCommandChecks(body)] },
  { stage: "S8", mode: "on", slug: "owner-outreach-timeline-after-commands", route: "GET /outreach/:id/timeline (Owner, on the command copy, after the commands)", params: `${S8.owned} limit=50`, kind: "read",
    calls: s8Label([S8.owned], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null), () => ({ target: "command" as const })),
    schema: timelineServer, checks: body => {
      // What the Owner sees today: the completion (rep confirmed, actor kind rep) and the snooze with the rep's note. The re-date has no timeline item (see evidence/CF8.md).
      const done = items(body).find(item => item.kind === "followup_completed" && item.detail?.completion_basis === "rep_confirmation");
      const snooze = items(body).find(item => item.kind === "followup_snoozed" && item.detail?.actor_kind === "rep" && item.detail?.note === "Customer is at work until Friday");
      return [...(done?.actor?.kind === "rep" ? [] : ["no followup_completed (rep_confirmation, actor rep) on the Owner's timeline"]), ...(snooze ? [] : ["no rep snooze with its note on the Owner's timeline"])];
    } },

  // ── CF8 flag off (REP_ACCESS off; everything else as flags on): a rep is refused exactly as today; the Owner's reads are unchanged ──
  { stage: "S8", mode: "off", slug: "rep-refused", route: "<rep route> (as the rep, REP_ACCESS off)", params: "attention, outreach detail, timeline, closed history, overview, conversations, complete own follow-up",
    kind: "status", calls: (rows, env) => {
      const row = byLabel(rows, S8.findings), own = env.followups.own, h = asRep(env);
      return [
        { state: "attention", path: "/attention" }, { state: "closed-history", path: "/outreach/closed-history" }, { state: "overview", path: "/overview" },
        ...(row?.outreach_record_id ? [{ state: "outreach", path: `/outreach/${row.outreach_record_id}` }, { state: "outreach-timeline", path: `/outreach/${row.outreach_record_id}/timeline?limit=50` }] : []),
        ...(row?.contact_number_id ? [{ state: "number-conversations", path: `/numbers/${row.contact_number_id}/conversations` }] : []),
        ...(own ? [{ state: "complete-own-followup", method: "POST" as const, path: `/followups/${own.id}/complete`,
          body: { command: "complete_followup", expected_revision: own.revision, disposition: "spoke_with_customer", note: "Spoke with the customer" } }] : []),
      ].map(call => ({ ...call, expect: 403, headers: h }));
    }, schema: async () => {
      const { z } = await import("zod");
      const local = await load.local() as { errorBodySchema: (c: string, e?: string) => ZodType };
      return { schema: z.object({ status: z.literal(403), headers: z.record(z.string(), z.string()), body: local.errorBodySchema("OWNER_REQUIRED", "Sales Intelligence access denied"),
        request: z.object({ method: z.enum(["POST", "PATCH"]), path: z.string(), body: z.record(z.string(), z.unknown()) }).strict().optional() }).strict(),
        name: "status 403 OWNER_REQUIRED \"Sales Intelligence access denied\" (boundary; + request on the command)", source: "script-local" };
    } },
  { stage: "S8", mode: "off", slug: "owner-attention", route: "GET /attention (Owner, REP_ACCESS off)", params: "default; all_outreach", kind: "read",
    calls: fixed([{ state: "default", path: "/attention?limit=200" }, { state: "all-outreach", path: "/attention?view=all_outreach&limit=200" }]),
    schema: attentionServer, admin: [adminSchema("attentionSchema")], checks: flagOnHeader },
  { stage: "S8", mode: "off", slug: "owner-outreach", route: "GET /outreach/:id (Owner, REP_ACCESS off)", params: `${S8.findings}, ${S8.owned}`, kind: "read",
    calls: s8Label([S8.findings, S8.owned], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)),
    schema: outreachReadSchema, admin: [adminSchema("outreachReadSchema")], checks: s8DetailChecks(false) },
  { stage: "S8", mode: "off", slug: "owner-outreach-timeline", route: "GET /outreach/:id/timeline (Owner, REP_ACCESS off)", params: `${S8.findings} limit=50`, kind: "read",
    calls: s8Label([S8.findings], row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null)), schema: timelineServer },
  { stage: "S8", mode: "off", slug: "owner-closed-history", route: "GET /outreach/closed-history (Owner, REP_ACCESS off)", params: "limit=50", kind: "read",
    calls: fixed([{ state: "default", path: "/outreach/closed-history?limit=50" }]), schema: closedHistoryServer },
  { stage: "S8", mode: "off", slug: "owner-overview", route: "GET /overview (Owner, REP_ACCESS off)", params: "default", kind: "read",
    calls: fixed([{ state: "default", path: "/overview" }]), schema: overviewSchema },
);

export const routesFor = (stage: Stage, mode: Mode = "on") => ROUTES.filter(route => route.stage === stage && route.mode === mode);
/** Longest slug first so `outreach-assessment__x` never matches `outreach`. */
export function routeForFile(stage: Stage, mode: Mode, file: string): RouteEntry | null {
  const slug = file.split("__")[0];
  return routesFor(stage, mode).find(route => route.slug === slug) ?? null;
}
