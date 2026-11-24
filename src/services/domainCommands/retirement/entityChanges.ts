import { randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import { logger } from "../../../logger";
import { toObjectId } from "../../../utils/objectId";
import { ENTITY_CHANGE_COLLECTION } from "../../../models/EntityChange";
import type { ObjectStore } from "../../cloudStorage";
import { LEAD_LINK_CHANGE_SCOPE, LEAD_LINK_RESCAN_MS } from "../../numberActivity/leadLinkJobs";
import type { RawRow } from "../../salesIntelligence/retirement/pack";
import { OUTREACH_LEAD_CHANGE_SCOPE } from "../../salesOutreach/subjects/feed";
import { ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION } from "./archivedEntityChanges";
import {
  acquireLease, advance, catalogIndexes, deleteExact, emptyRun, lookupArchivedRow, openRetirementStore, packAndCatalog, readRawBatch,
  recordError, releaseLease, RETIREMENT_BATCH, RETIREMENT_PASS_INTERVAL_MS, RETIREMENT_SETTLE_MS, tally,
  type RetirementRun, type Verdict,
} from "./shared";

/**
 * Validated retirement of the Granot re-snapshot incident's Entity Changes (Owner decision 5, 2026-11-23: the narrow rule of
 * docs/operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md §5). Oct 15–Nov 16 `synchronizeLeadFromGranot` rewrote
 * `last_accepted_granot_observation` and `current_move_provenance` on about 1,100 Call Leads 1,600–10,600 times a day.
 *
 * Only those rows are reviewed: a Call Lead row from `synchronizeLeadFromGranot` whose changed paths are only those two
 * (so never a creation, job-number or `receiver_agent` row). One leaves MongoDB when, also:
 * 1. a later revision exists for the Call Lead;
 * 2. both `(applied_at, _id)` tails (Outreach feed, Number Activity lead-link) are past it by more than their 120 s
 *    overlap; a tail whose state row is missing makes nothing reviewable;
 * 3. it is outside the Lead's newest 50 by `applied_at` (the Sales Intelligence lead history reads those);
 * 4. no Granot receipt, Observation or Decision named in `provenance` is still hot;
 * 5. it is packed to GCS (90 days), read back byte for byte and catalogued by `_id` range and Call Lead, then deleted in a
 *    snapshot transaction that rechecks its exact bytes.
 * The Granot timelines and the Job Number Timeline read retired rows back by entity (`archivedEntityChanges.ts`).
 * The scan walks `entity_change_entity_revision_unique` in Lead order, so one Lead's rows share few packs.
 */
export const ENTITY_CHANGE_RETIREMENT_CONTROL_ID = "entity_changes_incident_v1";
export const ENTITY_CHANGE_ARCHIVE_PACK_INDEXES = catalogIndexes("entity_change", [
  { name: "entity_change_pack_entity", key: { entity_model: 1, entity_ids: 1 } },
]);
export const INCIDENT_PATHS = ["last_accepted_granot_observation", "current_move_provenance"] as const;
/** Owner rule: the Sales Intelligence lead history reads each Lead's newest 50 (`history/reads.ts` `LIMITS.changes`). */
export const NEWEST_KEPT = 50;
const SCAN_HINT = "entity_change_entity_revision_unique";
const INCIDENT_FILTER = {
  "entity.model": "CallLead", command_name: "synchronizeLeadFromGranot",
  changed_paths: { $ne: [], $not: { $elemMatch: { $nin: [...INCIDENT_PATHS] } } },
};

type Cursor = { entity_id: string; revision_after: number };
export type IncidentFacts = {
  /** Rows at or after this instant are not yet past both tails (or still settling). */
  until: Date;
  /** Per Call Lead id: `applied_at` of its 50th newest row; `null` when it has fewer. Only strictly older rows may leave. */
  floors: Map<string, Date | null>;
  /** Per Call Lead id: its newest `revision_after`. */
  latest: Map<string, number>;
  /** Granot receipt, Observation and Decision ids still in their hot collections. */
  hot: Set<string>;
};

const provenanceIds = (row: Document) =>
  ["receipt_id", "observation_id", "decision_id"].map((k) => row.provenance?.[k]).filter((v) => v != null).map(String);

/** Whether a row is one of the incident revisions this rule may retire. Pure. */
export function isIncidentRevision(row: Document) {
  const paths: unknown[] = Array.isArray(row.changed_paths) ? row.changed_paths : [];
  return row.entity?.model === "CallLead" && row.command_name === "synchronizeLeadFromGranot" && row.revision_before > 0
    && paths.length > 0 && paths.every((p) => (INCIDENT_PATHS as readonly unknown[]).includes(p));
}

/** The §5 proof predicate for one row. Pure. */
export function entityChangeVerdict(row: Document, facts: IncidentFacts): Verdict {
  if (!isIncidentRevision(row)) return { verdict: "hold", reason: "not_incident_revision" };
  const lead = String(row.entity.id);
  if (!((facts.latest.get(lead) ?? -1) > row.revision_after)) return { verdict: "hold", reason: "latest_revision" };
  if (!(row.applied_at instanceof Date) || +row.applied_at >= +facts.until) return { verdict: "hold", reason: "tail_not_past" };
  const floor = facts.floors.get(lead);
  if (!floor || +row.applied_at >= +floor) return { verdict: "hold", reason: "newest_50" };
  if (provenanceIds(row).some((id) => facts.hot.has(id))) return { verdict: "hold", reason: "granot_record_hot" };
  return { verdict: "retire" };
}

const changesOf = (db: Db) => db.collection(ENTITY_CHANGE_COLLECTION);

/**
 * The newest `applied_at` a row may have: both tails' cursors less their 120 s overlap, and the settle. `null` when a tail
 * has never written its cursor (its first pass reads from "now", but a reset could read anything).
 */
export async function reviewUntil(db: Db, now: Date): Promise<Date | null> {
  const states = await db.collection("sales_intelligence_sync_state").find({ scope: { $in: [OUTREACH_LEAD_CHANGE_SCOPE, LEAD_LINK_CHANGE_SCOPE] } },
    { projection: { scope: 1, "cursor.entity_change_applied_at": 1 } }).toArray();
  const cursors = states.map((s) => s.cursor?.entity_change_applied_at).filter((d): d is Date => d instanceof Date);
  if (cursors.length !== 2) return null;
  return new Date(Math.min(+now - RETIREMENT_SETTLE_MS, ...cursors.map((c) => +c - LEAD_LINK_RESCAN_MS)));
}

/** Everything a batch's verdicts read: per Lead its newest revision and 50th newest instant, and the hot Granot records. */
export async function loadIncidentFacts(db: Db, rows: readonly Document[], until: Date): Promise<IncidentFacts> {
  const leads = [...new Set(rows.map((r) => String(r.entity?.id)))];
  const floors = new Map<string, Date | null>(), latest = new Map<string, number>();
  for (const lead of leads) {
    const scope = { "entity.model": "CallLead", "entity.id": lead };
    const [newest] = await changesOf(db).find(scope, { sort: { revision_after: -1 }, limit: 1, projection: { revision_after: 1 } }).toArray();
    const [floor] = await changesOf(db).find(scope, { sort: { applied_at: -1 }, skip: NEWEST_KEPT - 1, limit: 1, projection: { applied_at: 1 },
      hint: "entity_change_entity_applied" }).toArray();
    latest.set(lead, Number(newest?.revision_after ?? -1));
    // Only rows strictly older than the 50th newest leave, so a tie at that instant stays whichever way the reader sorts it.
    floors.set(lead, floor?.applied_at instanceof Date ? floor.applied_at : null);
  }
  const ids = [...new Set(rows.flatMap(provenanceIds))].filter((id) => /^[a-f0-9]{24}$/.test(id));
  const oids = ids.map(toObjectId);
  const hot = new Set<string>();
  if (oids.length) {
    for (const name of ["granot_webhook_receipts", "granot_observations", "synchronization_decisions"]) {
      for (const d of await db.collection(name).find({ _id: { $in: oids } }, { projection: { _id: 1 } }).toArray()) hot.add(String(d._id));
    }
  }
  return { until, floors, latest, hot };
}

async function nextBatch(db: Db, cursor: Cursor | null, size: number) {
  const after = cursor ? { $or: [{ "entity.id": { $gt: cursor.entity_id } }, { "entity.id": cursor.entity_id, revision_after: { $gt: cursor.revision_after } }] } : {};
  return readRawBatch(changesOf(db).find({ ...INCIDENT_FILTER, ...after },
    { raw: true, sort: { "entity.model": 1, "entity.id": 1, revision_after: 1 }, limit: size, hint: SCAN_HINT }) as never);
}

/** Reads (read-only) the next incident rows after the stored cursor and their verdicts, for `dry-run` and the worker. */
export async function reviewIncidentBatch(db: Db, cursor: Cursor | null, until: Date, size = RETIREMENT_BATCH) {
  const rows = await nextBatch(db, cursor, size);
  const facts = await loadIncidentFacts(db, rows.map((r) => r.doc), until);
  return { rows, verdicts: rows.map((r) => entityChangeVerdict(r.doc, facts)) };
}

export async function retireIncidentEntityChanges(db: Db, options: {
  now?: Date; store?: ObjectStore; maxBatches?: number; budgetMs?: number; batchSize?: number; owner?: string; clock?: () => number;
} = {}): Promise<RetirementRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const owner = options.owner ?? `entity-change-retirement:${randomUUID()}`;
  const lease = await acquireLease<Cursor>(db, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, owner, now);
  if (!lease.control) return emptyRun(lease.status);
  const run = emptyRun("ran");
  let cursor: Cursor | null = lease.control.cursor ?? null;
  try {
    const rested = lease.control.pass_completed_at;
    if (!cursor && rested instanceof Date && +now - +rested < RETIREMENT_PASS_INTERVAL_MS) { run.status = "resting"; return run; }
    const until = await reviewUntil(db, now);
    if (!until) { run.status = "not_reviewable"; return run; }
    const { store, recoveryDays } = await openRetirementStore(db, options.store);
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const { rows, verdicts } = await reviewIncidentBatch(db, cursor, until, options.batchSize);
      if (!rows.length) {
        cursor = null; run.pass_completed = true;
        await advance(db, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, owner, { cursor: null, pass_completed_at: now }, clock);
        break;
      }
      const proven: RawRow[] = [], provenDocs: Document[] = [];
      rows.forEach((r, i) => { if (verdicts[i]!.verdict === "retire") { proven.push({ raw: r.raw, id: String(r.doc._id) }); provenDocs.push(r.doc); } });
      if (proven.length) {
        const held: Record<string, number> = {};
        for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
        const times = provenDocs.map((d) => +d.applied_at);
        const packed = await packAndCatalog(db, { store, recoveryDays, catalog: ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, rows: proven,
          day: new Date(Math.min(...times)), now, fields: {
            entity_model: "CallLead", entity_ids: [...new Set(provenDocs.map((d) => String(d.entity.id)))],
            first_applied_at: new Date(Math.min(...times)), last_applied_at: new Date(Math.max(...times)), reviewed: rows.length, held_reasons: held,
          } });
        run.deleted += await deleteExact(db, ENTITY_CHANGE_COLLECTION, proven);
        run.packs++; run.packed_bytes += packed.packed_bytes; run.raw_bytes += proven.reduce((s, r) => s + r.raw.length, 0);
      }
      const last = rows.at(-1)!.doc;
      cursor = { entity_id: String(last.entity.id), revision_after: Number(last.revision_after) };
      run.batches++; tally(run, verdicts);
      if (!(await advance(db, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, owner, { cursor }, clock))) break;
    }
  } catch (error) {
    recordError(run, error);
    throw error;
  } finally {
    run.cursor = cursor ? `${cursor.entity_id}@${cursor.revision_after}` : null;
    await releaseLease(db, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, owner, now, run);
    logger.info({ msg: "domain_commands.entity_change_retirement.run", ...run });
  }
  return run;
}

/** Restores one retired Entity Change by original `_id` from its verified pack, or `null` when no live pack holds it. */
export const lookupArchivedEntityChange = (db: Db, id: string, store?: ObjectStore) =>
  lookupArchivedRow(db, ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, id, store);
