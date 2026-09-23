/**
 * Route registry for the Sales Intelligence contract freeze (TEAM-1 §5). One entry per Owner read a
 * stage added or changed: how to build its path for each seeded state and which server Zod schema
 * validates the response (with the `ok` envelope stripped). Later stages append entries here.
 *
 * `schema` is resolved lazily so a route whose server schema does not exist yet still captures;
 * `test-si-contract-fixtures.ts` then reports it as a loose parse with a note.
 */
import type { ZodType } from "zod";
import type { SiManifestRow } from "./si-contract-common";

export type Stage = "S1" | "S2" | "S3" | "S4";
export type CaptureCall = { state: string; path: string };
export type ResolvedSchema = { schema: ZodType; name: string; exact: boolean };
export type RouteEntry = {
  stage: Stage;
  /** File prefix: `<slug>__<state>.json`. */
  slug: string;
  /** Route template, for the CONTRACT.md tables. */
  route: string;
  calls: (rows: readonly SiManifestRow[]) => CaptureCall[];
  schema: () => Promise<ResolvedSchema>;
};

const state = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fixed = (list: Array<[string, string]>) => () => list.map(([s, path]) => ({ state: s, path }));
const perRow = (pick: (row: SiManifestRow) => string | null | Array<[string, string]>) => (rows: readonly SiManifestRow[]) =>
  rows.flatMap(row => {
    const value = pick(row);
    if (value === null) return [];
    if (Array.isArray(value)) return value.map(([suffix, path]) => ({ state: `${state(row.label)}${suffix ? `-${suffix}` : ""}`, path }));
    return [{ state: state(row.label), path: value }];
  });

async function ownerRead(data: () => Promise<ZodType | undefined>, name: string): Promise<ResolvedSchema> {
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  const { z } = await import("zod");
  const inner = await data().catch(() => undefined);
  return inner ? { schema: ownerReadSchema(inner), name: `ownerReadSchema(${name})`, exact: true }
    : { schema: ownerReadSchema(z.unknown()), name: `ownerReadSchema(unknown) — ${name} not exported yet`, exact: false };
}
async function direct(load: () => Promise<ZodType | undefined>, name: string): Promise<ResolvedSchema> {
  const schema = await load().catch(() => undefined);
  if (schema) return { schema, name, exact: true };
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  const { z } = await import("zod");
  return { schema: ownerReadSchema(z.unknown()), name: `ownerReadSchema(unknown) — ${name} not exported yet`, exact: false };
}
type Mod = Record<string, unknown>;
const exported = (load: () => Promise<Mod>, key: string) => async () => (await load())[key] as ZodType | undefined;
const siDto = () => import("../../../src/services/salesIntelligence/dto") as Promise<Mod>;
const assessmentDto = () => import("../../../src/services/salesIntelligence/assessment/dto") as Promise<Mod>;
const numberDto = () => import("../../../src/services/numberActivity/dto") as Promise<Mod>;

/** `GET /outreach/:id` data: the outreach DTO is strict; instructions and nudges keep their own contracts. */
async function outreachReadSchema(): Promise<ResolvedSchema> {
  const { ownerReadSchema } = await import("../../../src/services/salesIntelligence/dto");
  const { outreachDetailDtoSchema } = await import("../../../src/services/salesIntelligence/outreach/detailDto");
  const { z } = await import("zod");
  return { schema: ownerReadSchema(z.object({ outreach: outreachDetailDtoSchema, owner_instructions: z.array(z.unknown()), nudges: z.unknown() }).strict()),
    name: "ownerReadSchema({ outreach: outreachDetailDtoSchema, owner_instructions, nudges })", exact: true };
}

const ATTENTION_S2: Array<[string, string]> = [
  ["closed", "/attention?view=closed"], ["closed-booked", "/attention?view=closed&outcome=booked"], ["closed-sort-time-to-close", "/attention?view=closed&sort=time_to_close"],
  ["sort-last-call", "/attention?view=all_outreach&sort=last_call"], ["sort-interactions", "/attention?view=all_outreach&sort=interactions"],
  ["filter-has-recording", "/attention?view=all_outreach&has_recording=true"], ["filter-attachment-none", "/attention?view=all_outreach&attachment=none"],
  ["filter-priority-not-set", "/attention?view=all_outreach&priority=not_set"], ["filter-newer-call", "/attention?view=all_outreach&newer_call=true"],
  ["filter-move-date-passed", "/attention?view=all_outreach&move_date_passed=true"], ["filter-band-1", "/attention?band=1"],
];

export const ROUTES: RouteEntry[] = [
  // ── S1: card facts on the desk and the Outreach record ─────────────────────────────────
  { stage: "S1", slug: "attention", route: "GET /attention", calls: fixed([["default", "/attention"], ["all-outreach", "/attention?view=all_outreach&limit=200"]]),
    schema: () => direct(exported(siDto, "attentionPageDtoSchema"), "attentionPageDtoSchema") },
  { stage: "S1", slug: "outreach", route: "GET /outreach/:id", calls: perRow(row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}` : null)), schema: outreachReadSchema },
  // ── S2: desk filters, sorts, closed partition; Numbers sorts ───────────────────────────
  { stage: "S2", slug: "attention", route: "GET /attention (filters, sorts, view=closed)", calls: fixed(ATTENTION_S2),
    schema: () => direct(exported(siDto, "attentionPageDtoSchema"), "attentionPageDtoSchema") },
  { stage: "S2", slug: "numbers", route: "GET /numbers (sorts, filters)", calls: fixed([["default", "/numbers"], ["sort-last-call", "/numbers?sort=last_call"],
    ["sort-first-call", "/numbers?sort=first_call"], ["sort-interactions", "/numbers?sort=interactions"], ["filter-has-recording", "/numbers?has_recording=true"],
    ["filter-has-outreach", "/numbers?has_outreach=true"]]), schema: () => direct(exported(numberDto, "numberSearchPageDtoSchema"), "numberSearchPageDtoSchema") },
  // ── S3: analysis page reads and the model-output presentation ──────────────────────────
  { stage: "S3", slug: "outreach-assessment", route: "GET /outreach/:id/assessment", calls: perRow(row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/assessment` : null)),
    schema: () => ownerRead(exported(assessmentDto, "outreachAssessmentDtoSchema"), "outreachAssessmentDtoSchema") },
  { stage: "S3", slug: "assessment", route: "GET /assessments/:artifactId", calls: perRow(row => row.artifact_ids.filter(Boolean).map((id, i) => [row.artifact_ids.length > 1 ? `v${i + 1}` : "", `/assessments/${id}`])),
    schema: () => ownerRead(exported(assessmentDto, "assessmentSectionSchema"), "assessmentSectionSchema") },
  { stage: "S3", slug: "run-presentation", route: "GET /analysis-runs/:id/presentation", calls: perRow(row => row.run_ids.map((id, i) => [`run${i + 1}`, `/analysis-runs/${id}/presentation`])),
    schema: () => ownerRead(exported(assessmentDto, "runPresentationSchema"), "runPresentationSchema") },
  { stage: "S3", slug: "outreach-findings", route: "GET /outreach/:id/findings", calls: perRow(row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/findings` : null)),
    schema: () => ownerRead(exported(assessmentDto, "currentFindingsDtoSchema"), "currentFindingsDtoSchema") },
  { stage: "S3", slug: "analysis-run", route: "GET /analysis-runs/:id", calls: perRow(row => row.run_ids.map((id, i) => [`run${i + 1}`, `/analysis-runs/${id}`])),
    schema: () => ownerRead(exported(siDto, "ownerRunDtoSchema"), "ownerRunDtoSchema") },
  // ── S4: timeline, conversations, transcript, Number detail ─────────────────────────────
  { stage: "S4", slug: "outreach-timeline", route: "GET /outreach/:id/timeline", calls: perRow(row => (row.outreach_record_id ? `/outreach/${row.outreach_record_id}/timeline?limit=50` : null)),
    schema: () => direct(exported(siDto, "outreachTimelinePageDtoSchema"), "outreachTimelinePageDtoSchema") },
  { stage: "S4", slug: "number-timeline", route: "GET /numbers/:id/timeline", calls: perRow(row => (row.contact_number_id ? `/numbers/${row.contact_number_id}/timeline?limit=50` : null)),
    schema: () => direct(exported(numberDto, "numberTimelinePageDtoSchema"), "numberTimelinePageDtoSchema") },
  { stage: "S4", slug: "number-conversations", route: "GET /numbers/:id/conversations", calls: perRow(row => (row.contact_number_id && row.conversation_ids.length ? `/numbers/${row.contact_number_id}/conversations` : null)),
    schema: () => direct(exported(numberDto, "numberConversationsPageDtoSchema"), "numberConversationsPageDtoSchema") },
  { stage: "S4", slug: "conversation-transcript", route: "GET /conversations/:id/transcript", calls: perRow(row => row.conversation_ids.slice(0, 3).map((id, i) => [`c${i + 1}`, `/conversations/${id}/transcript`])),
    schema: () => direct(exported(numberDto, "conversationTranscriptDtoSchema"), "conversationTranscriptDtoSchema") },
  { stage: "S4", slug: "number", route: "GET /numbers/:id", calls: perRow(row => (row.contact_number_id ? `/numbers/${row.contact_number_id}` : null)),
    schema: () => direct(exported(numberDto, "numberDetailReadDtoSchema"), "numberDetailReadDtoSchema") },
  { stage: "S4", slug: "numbers", route: "GET /numbers", calls: fixed([["default", "/numbers"], ["limit-200", "/numbers?limit=200"]]),
    schema: () => direct(exported(numberDto, "numberSearchPageDtoSchema"), "numberSearchPageDtoSchema") },
];

export const routesFor = (stage: Stage) => ROUTES.filter(route => route.stage === stage);
/** Longest slug first so `outreach-assessment__x` never matches `outreach`. */
export function routeForFile(stage: Stage, file: string): RouteEntry | null {
  const slug = file.split("__")[0];
  return routesFor(stage).find(route => route.slug === slug) ?? null;
}
