import type { ClientSession, Db, Document } from "mongodb";
import { isObjectIdString, toObjectId } from "../../utils/objectId";
import type { ArchivedChain } from "./archiveCodec";

/**
 * Owner decision 8 (2026-11-23): a Lead's current winner may leave MongoDB once it is a proven winner.
 * Off until the Owner writes `granot_retention_control` `{ _id: "proven-winner-release-v1", enabled_at }`;
 * deleting the row is the rollback. Retired winners stay readable by original ID.
 */
export const PROVEN_WINNER_CONTROL = "proven-winner-release-v1";
export const PROVEN_WINNER_MIN_AGE_MS = 30 * 86_400_000;
const MODELS = { FormLead: "form_leads", CallLead: "call_leads" } as const;
/** Owner/lead decision on #276: a reference from an open case or discrepancy keeps the winner hot; resolved ones release. */
const OPEN_CASES = ["granot_booking_reconciliation_cases", "granot_release_reconciliation_cases", "granot_booking_discrepancies", "granot_release_discrepancies"];
const CASE_PATHS = ["evidence.observation_id", "evidence.decision_id", "priority_pairing.creating_booked_observation_id", "priority_pairing.preceding_priority_5_observation_id"];
type Model = keyof typeof MODELS;

/** Every value at a dotted path, through arrays (case `evidence` is an array). */
function values(row: unknown, path: string[]): string[] {
  if (row == null) return [];
  if (Array.isArray(row)) return row.flatMap((x) => values(x, path));
  if (!path.length) return [String(row)];
  return values((row as Document)[path[0]], path.slice(1));
}

export async function provenWinnerReleaseEnabled(db: Db, session?: ClientSession) {
  const row = await db
    .collection<{ _id: string; enabled_at?: Date }>("granot_retention_control")
    .findOne({ _id: PROVEN_WINNER_CONTROL }, { session, projection: { enabled_at: 1 } });
  return row?.enabled_at instanceof Date;
}

/** The latest of capture, receipt completion and every Decision: the chain's acceptance time. */
function acceptedAt({ observation: o, receipt: r, decisions }: ArchivedChain) {
  return Math.max(
    +o.captured_at,
    r.processing?.completed_at instanceof Date ? +r.processing.completed_at : -Infinity,
    ...decisions.map((d) => (d.decided_at instanceof Date ? +d.decided_at : Infinity)),
  );
}

/** The Lead the receipt certified, when the receipt, its latest Decision and the live Decision agree. */
function certifiedLead({ receipt: r, decisions }: ArchivedChain) {
  const cert = r.processing?.certified_lead as { model?: string; id?: unknown; decision_id?: unknown } | undefined;
  const latest = r.processing?.latest_decision_id;
  if (!cert || !(cert.model === "FormLead" || cert.model === "CallLead") || !isObjectIdString(String(cert.id))) return null;
  if (!latest || String(cert.decision_id) !== String(latest)) return null;
  const d = decisions[0];
  if (decisions.length > 1 || (d && (String(d._id) !== String(latest) || d.execution_mode !== "live"
    || d.target?.model !== cert.model || String(d.target?.id) !== String(cert.id)))) return null;
  return { model: cert.model as Model, id: String(cert.id), decision: String(latest) };
}

/**
 * Chains that are their certified Lead's current winner, accepted at least 30 days before `now`, whose
 * Lead still carries the v2 proof Pool admission reads instead of the Observation (`admission.ts`).
 * An open case or discrepancy that references the chain keeps it hot. Empty while the control row is
 * absent. Everything else keeps the reference and winner holds.
 */
export async function provenWinners(db: Db, chains: ArchivedChain[], now: Date, session?: ClientSession, enabled?: boolean) {
  const found = new Set<string>();
  if (!(enabled ?? (await provenWinnerReleaseEnabled(db, session)))) return found;
  const candidates = chains.flatMap((chain) => {
    const lead = certifiedLead(chain);
    return lead && +now - acceptedAt(chain) >= PROVEN_WINNER_MIN_AGE_MS ? [{ chain, lead }] : [];
  });
  for (const model of Object.keys(MODELS) as Model[]) {
    const subset = candidates.filter((c) => c.lead.model === model);
    if (!subset.length) continue;
    const rows = await db.collection(MODELS[model]).find(
      { _id: { $in: subset.map((c) => toObjectId(c.lead.id)) } },
      { session, projection: { last_accepted_granot_observation: 1 }, maxTimeMS: 3000 },
    ).toArray();
    const winners = new Map(rows.map((r: Document) => [String(r._id), r.last_accepted_granot_observation]));
    for (const { chain: { observation: o, receipt: r }, lead } of subset) {
      const w = winners.get(lead.id), proof = w?.evidence;
      if (
        w && String(w.observation_id) === String(o._id) &&
        w.captured_at instanceof Date && +w.captured_at === +o.captured_at &&
        proof?.version === 2 && proof.source_scope?.granot_crm_source_id &&
        String(proof.decision_id) === lead.decision && String(proof.receipt_id) === String(r._id)
      )
        found.add(String(o._id));
    }
  }
  if (!found.size) return found;
  const owner = new Map<string, string>();
  for (const { chain: c } of candidates) {
    if (!found.has(String(c.observation._id))) continue;
    for (const id of [c.observation._id, c.receipt._id, c.receipt.processing?.latest_decision_id, ...c.decisions.map((d) => d._id)])
      if (id) owner.set(String(id), String(c.observation._id));
  }
  const ids = [...owner.keys()].map(toObjectId);
  const choices = [...ids, ...owner.keys()];
  for (const name of OPEN_CASES) {
    const rows = await db.collection(name).find(
      { state: "open", $or: CASE_PATHS.map((k) => ({ [k]: { $in: choices } })) },
      { session, projection: Object.fromEntries(CASE_PATHS.map((k) => [k, 1])), maxTimeMS: 3000 },
    ).toArray();
    for (const row of rows)
      for (const path of CASE_PATHS) {
        for (const id of values(row, path.split("."))) {
          const key = owner.get(id);
          if (key) found.delete(key);
        }
      }
  }
  return found;
}
