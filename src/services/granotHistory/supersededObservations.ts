import type { ClientSession, Db } from "mongodb";
import { isObjectIdString, toObjectId } from "../../utils/objectId";
import type { ArchivedChain } from "./archiveCodec";

/** A superseded candidate cannot become the temporal winner again. Preserve every current winner. */
export async function supersededObservations(
  db: Db,
  chains: ArchivedChain[],
  session?: ClientSession,
) {
  const found = new Set<string>();
  for (const [model, collection] of [
    ["FormLead", "form_leads"],
    ["CallLead", "call_leads"],
  ] as const) {
    const subset = chains.filter(
      (c) => c.decisions[0]?.target?.model === model,
    );
    if (!subset.length) continue;
    const ids = subset.flatMap((c) => {
      const id = c.decisions[0].target.id;
      return isObjectIdString(id) ? [toObjectId(id)] : [];
    });
    const rows = await db
      .collection(collection)
      .find(
        { _id: { $in: ids } },
        {
          session,
          projection: { last_accepted_granot_observation: 1 },
          maxTimeMS: 3000,
        },
      )
      .toArray();
    const byId = new Map(
      rows.map((r) => [String(r._id), r.last_accepted_granot_observation]),
    );
    for (const c of subset) {
      const win = byId.get(String(c.decisions[0].target.id)),
        o = c.observation;
      if (
        win?.captured_at instanceof Date &&
        win.observation_id &&
        String(win.observation_id) !== String(o._id) &&
        (+win.captured_at > +o.captured_at ||
          (+win.captured_at === +o.captured_at &&
            String(win.observation_id) > String(o._id)))
      )
        found.add(String(o._id));
    }
  }
  return found;
}
