import type { Db, Document, ClientSession } from "mongodb";
import { Types } from "mongoose";
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

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const chainIds = (c: ArchivedChain) => [
  c.observation._id,
  c.receipt._id,
  ...(c.receipt.processing?.latest_decision_id ? [c.receipt.processing.latest_decision_id] : []),
  ...c.decisions.map((d) => d._id),
];

/**
 * The Form Lead reads for a batch. Every writer of a Form Lead's provenance paths is the Granot lifecycle
 * writing its own Decision target (`synchronizeLeadFromGranot`, `createLeadFromGranot`); the Call-only writers
 * (RingCentral convergence, the Call move-date repair) never touch a Form. A November 20 production check found
 * no Form whose referenced Observation has a Decision naming another Lead. So:
 * - the Form Lead targets of the chains' Decisions are read by `_id`;
 * - a chain none of whose Decisions has a target (or that has no Decision left) keeps the full path scan,
 *   because nothing names the Lead that may hold it (production holds such references from older
 *   `lead_created` Observations);
 * - a chain whose Decisions target only Call Leads needs no Form read.
 * The paths are still compared row by row, so a target that moved on holds nothing.
 */
function formLeadFilters(chains: ArchivedChain[], paths: string[]): Document[] {
  const ids = new Set<string>();
  for (const chain of chains)
    for (const decision of chain.decisions) {
      const target = decision?.target as { model?: unknown; id?: unknown } | undefined;
      if (target?.model === "FormLead" && typeof target.id === "string" && OBJECT_ID.test(target.id)) ids.add(target.id.toLowerCase());
    }
  const untargeted = chains.filter((chain) => !chain.decisions.some((decision) => decision?.target));
  const scan = untargeted.flatMap(chainIds);
  return [
    ...(ids.size ? [{ _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) } }] : []),
    ...(scan.length ? [{ $or: paths.map((k) => ({ [k]: { $in: [...scan, ...scan.map(String)] } })) }] : []),
  ];
}

/** Keep anything still referenced even if the consuming case already has an independent copy. */
export async function referencedChains(
  db: Db,
  chains: ArchivedChain[],
  session?: ClientSession,
) {
  const owner = new Map<string, string>();
  const ids = chains.flatMap(chainIds);
  for (const c of chains)
    for (const id of chainIds(c))
      owner.set(String(id), String(c.observation._id));
  const choices = [...ids, ...ids.map(String)];
  const held = new Map<string, Set<string>>();
  if (!ids.length) return held;
  for (const [name, paths] of Object.entries(references)) {
    const filters = name === "form_leads"
      ? formLeadFilters(chains, paths)
      : [{ $or: paths.map((k) => ({ [k]: { $in: choices } })) }];
    for (const filter of filters) {
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
  }
  return held;
}
