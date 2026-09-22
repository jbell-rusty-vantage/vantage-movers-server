import { z } from "zod";

export const candidateSchema = z.object({
  model: z.enum(["FormLead", "CallLead"]), lead_id: z.string().regex(/^[a-f\d]{24}$/),
  arrived_at: z.coerce.date(), number_ids: z.array(z.string().regex(/^[a-f\d]{24}$/)),
  outreach_id: z.string().nullable(), outreach_state: z.string().nullable(),
  edges: z.array(z.object({ number_id: z.string(), state: z.string(), certainty: z.string() })),
  conversations: z.array(z.object({ id: z.string(), number_id: z.string(), interaction_id: z.string(),
    started_at: z.coerce.date(), duration_seconds: z.number().nullish(), state: z.string(),
    transcript: z.boolean(), media: z.boolean(), eligibility: z.string().optional() })),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const inventorySchema = z.object({ database: z.string(), from: z.coerce.date(), now: z.coerce.date(), candidates: z.array(candidateSchema) });

/** Readiness and recent evidence rank candidates; duration never gates eligibility. */
export function rankCandidate(candidate: Candidate): number {
  const usable = candidate.conversations.filter(c => c.eligibility !== "excluded");
  const ready = usable.some(c => c.transcript && c.state !== "complete") ? 400 : usable.some(c => c.transcript) ? 300 : usable.some(c => c.media) ? 200 : usable.length ? 100 : 0;
  const authority = candidate.edges.some(e => e.state === "attached" && e.certainty !== "likely") ? 50 : 0;
  return ready + authority;
}

/** One opportunity per number; alternate channels so Form Leads do not crowd out Call Leads. */
export function selectCandidates(candidates: Candidate[], limit: number): Candidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be 1–100");
  const eligible = candidates.filter(c => c.outreach_state !== "closed" && c.outreach_state !== "identity_review");
  const sorted = eligible.sort((a, b) => rankCandidate(b) - rankCandidate(a) || +b.arrived_at - +a.arrived_at || a.lead_id.localeCompare(b.lead_id));
  const pools = [sorted.filter(c => c.model === "FormLead"), sorted.filter(c => c.model === "CallLead")];
  const selected: Candidate[] = [], numbers = new Set<string>();
  while (selected.length < limit && pools.some(p => p.length)) {
    for (const pool of pools) {
      const next = pool.shift();
      if (!next || selected.length >= limit || next.number_ids.some(n => numbers.has(n))) continue;
      selected.push(next); next.number_ids.forEach(n => numbers.add(n));
    }
  }
  return selected;
}
