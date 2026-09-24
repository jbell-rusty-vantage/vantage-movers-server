import { jsonValue } from "../../../src/services/salesIntelligence/outreach/store";
import { payloadHash } from "../../../src/services/salesIntelligence/transactions";
import type { FingerprintOutreachAction, FingerprintOutreachRecord } from "../../../src/services/salesIntelligence/analysis/sources";

/**
 * The whole Number fingerprint exactly as `01bcf18` computed it, before the AC1 Outreach split: the
 * same `fingerprint_base` with the old Outreach inputs (record state, closure, assignment, every
 * follow-up). Team 4's one-time scheduler re-stamp (decision T4-D4) used it until Team 3 removed that
 * migration on 2026-09-24, after the read-only production check showed `rewrite = 0` over 2,516 Numbers
 * (reconciliation addendum §3.6). It lives on here only for `refingerprint-numbers.ts`, the S10
 * quiet-state verifier (step 7).
 */
export function legacyOutreachFingerprint(sources: {
  fingerprint_base: object;
  outreach: ReadonlyArray<FingerprintOutreachRecord & { responsible_agent_id?: unknown; assignment?: unknown }>;
  actions: ReadonlyArray<FingerprintOutreachAction & { promised_by_agent_id?: unknown; source_interaction_id?: unknown }>;
}) {
  // 01bcf18 refused more than 200 actions of any origin (EVIDENCE_LIMIT_REACHED), so it never stored a value for such a Number.
  if (sources.actions.length > 200) return "legacy:over_action_bound";
  return payloadHash(jsonValue({ ...sources.fingerprint_base,
    outreach: sources.outreach.map(r => ({ id: String(r._id), subject: r.subject, state: r.state === "waiting_on_customer" ? "open" : r.state,
      closed_reason: r.closed_reason, owner: r.responsible_agent_id, assignment: r.assignment })),
    actions: sources.actions.map(a => ({ id: String(a._id), kind: a.kind, description: a.description, status: a.status, due: a.due_at,
      owner: a.responsible_agent_id, promised: a.promised_by_agent_id, source: a.source_interaction_id, origin: a.origin })) }));
}
