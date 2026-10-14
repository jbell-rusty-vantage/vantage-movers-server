import { createHash } from "node:crypto";
import { z } from "zod";

export const PILOT_LIMIT = 20;
export const PILOT_MAX_AGE_MS = 30 * 60_000;
export const leadRefSchema = z.object({ model: z.enum(["FormLead", "CallLead"]), id: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
export type LeadRef = z.infer<typeof leadRefSchema>;
export const selectionSchema = leadRefSchema.array().min(1).max(PILOT_LIMIT).superRefine((refs, ctx) => {
  if (new Set(refs.map(keyOf)).size !== refs.length) ctx.addIssue({ code: "custom", message: "Duplicate canonical Lead selection" });
});
export const keyOf = (lead: LeadRef) => `${lead.model}:${lead.id}`;
export const contentHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Exact private pins. The tracked report contains only counts and these rows' digest. */
export type CandidatePin = {
  lead: LeadRef;
  lead_revision: number;
  receiver_agent_id: string | null;
  job_hash: string;
  source_company_id: string | null;
  source_granularity_id: string | null;
  source_policy_hash: string;
  accepted_observation_id: string | null;
  accepted_at: string | null;
  decision_id: string | null;
  link_id: string | null;
  link_revision: number | null;
  subject_id: string | null;
  subject_revision: number | null;
  sheet_lineage_hash: string;
  checks: Record<string, boolean>;
  holds: string[];
};

export type PilotManifest = {
  contract: "pool-pilot-v1";
  database: string;
  captured_at: string;
  expires_at: string;
  configuration_revision: number;
  configuration_hash: string;
  selection_hash: string;
  candidates: CandidatePin[];
  ready: boolean;
  writes: 0;
  provider_freshness: "accepted_canonical_evidence_only";
};

export function buildManifest(input: Omit<PilotManifest, "contract" | "expires_at" | "selection_hash" | "ready" | "writes" | "provider_freshness">): PilotManifest {
  selectionSchema.parse(input.candidates.map(c => c.lead));
  const candidates = [...input.candidates].sort((a, b) => keyOf(a.lead).localeCompare(keyOf(b.lead)));
  const captured = new Date(input.captured_at);
  if (!Number.isFinite(+captured)) throw new Error("Invalid manifest time");
  return { ...input, candidates, contract: "pool-pilot-v1", expires_at: new Date(+captured + PILOT_MAX_AGE_MS).toISOString(),
    selection_hash: contentHash(candidates), ready: candidates.every(c => c.holds.length === 0 && Object.values(c.checks).every(Boolean)), writes: 0,
    provider_freshness: "accepted_canonical_evidence_only" };
}

export function assertFreshManifest(manifest: PilotManifest, database: string, now = new Date()): void {
  if (manifest.contract !== "pool-pilot-v1" || manifest.database !== database || !manifest.ready || manifest.writes !== 0) throw new Error("Manifest is not a ready pilot for this database");
  selectionSchema.parse(manifest.candidates.map(c => c.lead));
  if (contentHash(manifest.candidates) !== manifest.selection_hash) throw new Error("Manifest pins were changed");
  if (new Date(manifest.captured_at) > now || new Date(manifest.expires_at) <= now || +new Date(manifest.expires_at) - +new Date(manifest.captured_at) !== PILOT_MAX_AGE_MS) throw new Error("Manifest is expired or has an invalid freshness boundary");
  if (manifest.candidates.some(c => c.holds.length || !Object.values(c.checks).every(Boolean))) throw new Error("Manifest contains held candidates");
}

/** Does not leak Lead IDs, Job Numbers, Agent IDs, or customer contact into tracked evidence. */
export function publicSummary(manifest: PilotManifest) {
  const reasons: Record<string, number> = {};
  for (const candidate of manifest.candidates) for (const hold of candidate.holds) reasons[hold] = (reasons[hold] ?? 0) + 1;
  return { contract: manifest.contract, database: manifest.database, captured_at: manifest.captured_at, expires_at: manifest.expires_at,
    configuration_revision: manifest.configuration_revision, configuration_hash: manifest.configuration_hash, selection_hash: manifest.selection_hash,
    selected: manifest.candidates.length, models: { FormLead: manifest.candidates.filter(c => c.lead.model === "FormLead").length, CallLead: manifest.candidates.filter(c => c.lead.model === "CallLead").length },
    ready: manifest.ready, held: manifest.candidates.filter(c => c.holds.length).length, hold_reasons: reasons,
    writes: manifest.writes, provider_freshness: manifest.provider_freshness };
}

/** Receiver readiness limits the first pilot; it never defines canonical shared Lead eligibility. */
export function expansionCohorts(candidates: readonly CandidatePin[]) {
  const coherent = candidates.filter(c => c.holds.every(reason => reason === "assigned_desk_rep") && Object.entries(c.checks).every(([check, ok]) => check === "assigned_desk_rep" || ok));
  return {
    pilot_ready: coherent.filter(c => c.checks.assigned_desk_rep === true),
    unassigned_review: coherent.filter(c => c.receiver_agent_id === null),
    assigned_other_review: coherent.filter(c => c.receiver_agent_id !== null && c.checks.assigned_desk_rep !== true),
    held: candidates.filter(c => !coherent.includes(c)),
    coherent,
  };
}
