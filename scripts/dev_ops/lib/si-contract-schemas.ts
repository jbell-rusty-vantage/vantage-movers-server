/**
 * Schemas the contract-freeze tooling needs that the server does not export (CF-PREP, 2026-09-23).
 *
 * 1. **Production Admin consumer schemas** (flag-off compatibility, TEAM-1 §5 / data spec §9 S2, S4).
 *    `attentionSchema` is re-exported from the S2-DESK verbatim copy
 *    (`src/services/salesIntelligence/outreach/attention.adminSchema.fixture.ts`). `timelineSchema`
 *    and `numberSearchSchema` below are verbatim copies of `vantage-admin@539a628`
 *    `lib/api/salesIntelligence.ts` lines 106 (`coverage`), 108-111 (`attachedLeadProgressSchema`),
 *    113-119 (`numberSearchSchema`) and 121-123 (`timelineSchema`). The Admin repo was not edited.
 *    Do not edit these copies to make a fixture pass; re-copy when the production Admin changes.
 * 2. **`ownerRunDataSchema`**: `GET /analysis-runs/:id` has no server Zod schema (`readOwnerRun` in
 *    `analysis/ownerReads.ts` returns an untyped `ownerRead`). This strict schema is transcribed from
 *    that function so the fixture still fails on an unknown or missing key. Open gap: the server
 *    should export one (then point the registry at it and delete this copy).
 * 3. **`statusFixtureSchema`**: calls whose contract is a status and headers, not a JSON read
 *    (the media route, the flag-off `GET /outreach/:id/timeline`).
 */
import { z } from "zod";
import { csiDateSchema } from "../../../src/validation/v1/salesIntelligence";

// ── 1. Production Admin (vantage-admin@539a628), verbatim ──────────────────────────────────────
export { attentionSchema, leadProgressSchema } from "../../../src/services/salesIntelligence/outreach/attention.adminSchema.fixture";
import { leadProgressSchema } from "../../../src/services/salesIntelligence/outreach/attention.adminSchema.fixture";
/* eslint-disable */
const coverage = z.object({ known_through: z.string().nullable(), gaps: z.array(z.object({ from:z.string(), to:z.string(), reason:z.string() })), ai_paused:z.boolean() });
// §7 Number card: the one resolved Lead's progress, or an explicit multiple/none. Never merged across Leads.
export const attachedLeadProgressSchema = z.object({ status: z.enum(['resolved','multiple','none']),
  lead_ref: z.object({ model: z.enum(['FormLead','CallLead']), id: z.string() }).optional(), lead_progress: leadProgressSchema.nullable().optional(),
  booking: z.object({ id: z.string(), cancelled: z.boolean() }).nullable().optional(), outreach_state: z.string().nullable().optional(),
  lead_display: z.object({ name: z.string().nullable(), job_no: z.string().nullable() }).nullable().optional() });
export const numberSearchSchema = z.object({ as_of:z.string(), coverage, data:z.object({
  items:z.array(z.object({ id:z.string(), revision:z.number(), e164:z.string(), provider_names:z.array(z.string()),
    classification:z.string(), eligibility:z.string(), linked:z.boolean(), last_activity_at:z.string(), first_observed_at:z.string().optional(),
    rollups:z.object({ interactions_total:z.number(), human_conversations_total:z.number(), attached_lead_count:z.number(), candidate_lead_count:z.number(), last_human_conversation_at:z.string().nullable().optional() }),
    attached_lead_progress: attachedLeadProgressSchema.optional() })),
  cursor:z.string().nullable(),
  // LP-06: the order the server applied to this page; absent on pre-sort servers.
  sort:z.object({ sort:z.string(), direction:z.enum(['asc','desc']) }).optional() }) });
export const timelineSchema = z.object({ as_of:z.string(), coverage, data:z.object({ number_id:z.string(),
  items:z.array(z.object({ id:z.string(), kind:z.string(), happened_at:z.string(), observed_at:z.string(), description:z.string(),
    evidence_refs:z.array(z.string()), detail:z.record(z.string(),z.json()) })), cursor:z.string().nullable() }) });
/* eslint-enable */

// ── 2. GET /analysis-runs/:id (transcribed from analysis/ownerReads.ts readOwnerRun) ─────────────
const iso = csiDateSchema;
const text = z.string().nullish();
export const ownerRunDataSchema = z.object({
  // runSummary(run)
  id: z.string(), revision: z.number().int(), status: z.string(), mode: z.string(), conversation_id: z.string().nullable(),
  created_at: iso, completed_at: iso.nullable(),
  current: z.boolean(), editable: z.boolean(),
  output: z.json().nullable(), output_digest: z.string().nullable(), suggestion_output_digest: z.string().nullable(),
  model_version: text, prompt_version: text, processing_reason: text, original_evidence_available: z.boolean(),
  analysis_pipeline: text, usage: z.json().nullable(), per_recording_ceiling_exceeded: z.boolean(),
  reanalysis_requests: z.array(z.object({ id: z.string(), run_id: z.string(), mode: z.string(), focus_finding_id: z.string().nullable(),
    status: z.string(), reason: text, created_at: iso }).strict()),
  contact_number_id: z.string(),
  outreach: z.object({ id: z.string(), revision: z.number().int(), state: z.string() }).strict().nullable(),
  findings: z.array(z.object({ id: z.string(), revision: z.number().int(), assertion: z.json(), review_state: z.string(), validation: z.json().optional(),
    effects: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), reason: text, target_id: z.string().nullable(), applied_at: iso }).strict()) }).strict()),
  actions: z.array(z.object({ id: z.string(), revision: z.number().int(), kind: z.string(), description: z.string(), due_at: iso.nullable(),
    responsible_agent_id: z.string().nullable(), status: z.string(), origin: z.string() }).strict()),
  instructions: z.array(z.object({ id: z.string(), instruction_id: z.string(), revision: z.number().int(), finding_id: z.string().nullable(),
    field: z.string(), prior: z.json().optional(), current: z.json().optional(), actor: z.string(), happened_at: iso,
    assessment: z.string(), reason: z.string(), finding_ids: z.array(z.string()), stale: z.boolean() }).strict()),
  instructions_complete: z.boolean(),
  history: z.array(z.object({ id: z.string(), event: z.string(), actor: z.string(), happened_at: iso, prior: z.json().optional(), current: z.json().optional() }).strict()),
  history_next_cursor: z.string().nullable(),
}).strict();

// ── 3. Status/header fixtures ────────────────────────────────────────────────────────────────
/** `{ status, headers, body }` written by the capture for a call whose contract is its status (no binary is stored). */
export const statusFixtureSchema = (status: number, body: z.ZodType = z.unknown()) => z.object({
  status: z.literal(status),
  headers: z.record(z.string(), z.string()),
  body,
}).strict();
export const errorBodySchema = (code: string, error?: string) => z.object({
  ok: z.literal(false), code: z.literal(code), error: error ? z.literal(error) : z.string(), request_id: z.string(),
}).strict();
