import type { Db, Document, ClientSession } from "mongodb";
import type { ArchivedChain } from "./archiveCodec";

const leadPaths = [
  "last_accepted_granot_observation.observation_id",
  "granot_contact_snapshot.observation_id",
  "current_contact_provenance.observation_id",
  "current_move_provenance.observation_id",
  "last_granot_contact_change.observation_id",
  "ringcentral_convergence.observation_id",
];
const casePaths = [
  "evidence.observation_id",
  "evidence.decision_id",
  "priority_pairing.creating_booked_observation_id",
  "priority_pairing.preceding_priority_5_observation_id",
];
const references: Record<string, string[]> = {
  form_leads: leadPaths,
  call_leads: leadPaths,
  granot_record_links: ["established_by_decision_id", "last_observation_id"],
  granot_booking_reconciliation_cases: casePaths,
  granot_release_reconciliation_cases: casePaths,
  granot_booking_discrepancies: casePaths,
  granot_release_discrepancies: casePaths,
  sales_outreach_pool_work: [
    "accepted_observation_id",
    "episodes.observation_id",
  ],
  sales_outreach_subjects: ["priority.observation_id"],
  lead_messages: ["observation_id"],
  entity_changes: [
    "provenance.observation_id",
    "provenance.decision_id",
    "provenance.receipt_id",
  ],
};
function values(row: unknown, path: string[]): string[] {
  if (row == null) return [];
  if (Array.isArray(row)) return row.flatMap((x) => values(x, path));
  if (!path.length) return [String(row)];
  return values((row as Document)[path[0]], path.slice(1));
}

/** Keep anything still referenced even if the consuming case already has an independent copy. */
export async function referencedChains(
  db: Db,
  chains: ArchivedChain[],
  session?: ClientSession,
) {
  const owner = new Map<string, string>();
  const ids = chains.flatMap((c) => [
    c.observation._id,
    c.receipt._id,
    ...c.decisions.map((d) => d._id),
  ]);
  for (const c of chains)
    for (const id of [
      c.observation._id,
      c.receipt._id,
      ...c.decisions.map((d) => d._id),
    ])
      owner.set(String(id), String(c.observation._id));
  const choices = [...ids, ...ids.map(String)];
  const held = new Map<string, Set<string>>();
  if (!ids.length) return held;
  for (const [name, paths] of Object.entries(references)) {
    const filter = { $or: paths.map((k) => ({ [k]: { $in: choices } })) };
    const cursor = db
      .collection(name)
      .find(filter, {
        session,
        projection: Object.fromEntries(paths.map((k) => [k, 1])),
        maxTimeMS: 3000,
      });
    for await (const row of cursor)
      for (const path of paths)
        for (const id of values(row, path.split("."))) {
          const key = owner.get(id);
          if (key) {
            const reasons = held.get(key) ?? new Set();
            reasons.add(name + "." + path);
            held.set(key, reasons);
          }
        }
  }
  return held;
}
