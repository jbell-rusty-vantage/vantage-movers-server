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
export type Stage = "S1" | "S2" | "S3" | "S4" | "AC" | "S5c";
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
};
export type ResolvedSchema = { schema: ZodType; name: string; source: "server" | "script-local" | "admin@539a628" };
export type CheckContext = { rows: readonly SiManifestRow[] | null; state: string; file: string };
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
  calls: (rows: readonly SiManifestRow[]) => CaptureCall[];
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

export const routesFor = (stage: Stage, mode: Mode = "on") => ROUTES.filter(route => route.stage === stage && route.mode === mode);
/** Longest slug first so `outreach-assessment__x` never matches `outreach`. */
export function routeForFile(stage: Stage, mode: Mode, file: string): RouteEntry | null {
  const slug = file.split("__")[0];
  return routesFor(stage, mode).find(route => route.slug === slug) ?? null;
}
