import { randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import { logger } from "../../../logger";
import { DOMAIN_COMMAND_EXECUTION_COLLECTION } from "../../../models/DomainCommandExecution";
import { toObjectId } from "../../../utils/objectId";
import type { ObjectStore } from "../../cloudStorage";
import { synchronizeLeadIdempotencyKey } from "../../granotLifecycle/authorizedDesiredState";
import { createLeadFromGranotIdempotencyKey } from "../../granotLifecycle/createLeadFromGranot";
import type { RawRow } from "../../salesIntelligence/retirement/pack";
import {
  acquireLease, advance, catalogIndexes, deleteExact, emptyRun, lookupArchivedRow, openRetirementStore, packAndCatalog, readRawBatch,
  recordError, releaseLease, RETIREMENT_BATCH, RETIREMENT_PASS_INTERVAL_MS, RETIREMENT_SETTLE_MS, tally,
  type RetirementRun, type Verdict,
} from "./shared";

/**
 * Validated retirement of Domain Command receipts, phases 1–2 (Owner decision 5, 2026-11-23; proposal §5 of
 * docs/operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md). A receipt is the replay fence of its
 * `{origin, idempotency_key}` (`idempotency.ts`); it may leave only when no producer can generate that key again:
 * - **Phase 1, `external_sheet_ingestion`.** The origin is retired (226dba24): the executor refuses every new operation
 *   of that origin before it runs, and no code builds that context any more. A replay with no stored receipt now raises
 *   "permanently retired" instead of returning the old outcome; nothing can send one.
 * - **Phase 2, Granot processor receipts** (`granot:synchronize-lead:<Observation>`, `granot:create-lead:<Observation>`,
 *   the fixed processor actor). The processor builds the key only from a hot receipt (`defaultLoadReceipt`) and its
 *   Observation. Once Granot retention has removed both from MongoDB, nothing restores them hot; a redelivery meets the
 *   retired-operation fence or becomes a new receipt with a new Observation, so a new key.
 * Every other receipt is held: scheduled-estimate and Form-sibling keys are deterministic on other sources, Owner and Admin
 * keys are client-supplied (phase 4), RingCentral keys replay from the Call Log (phase 3). No compact fence row stays.
 * In every phase each `entity_refs` record must still exist. Proven rows are packed to GCS (90 days), read back byte for
 * byte, catalogued by `_id` range, then deleted in a snapshot transaction that rechecks their exact bytes.
 */
export const COMMAND_EXECUTION_RETIREMENT_CONTROL_ID = "command_executions_v1";
export const COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION = "domain_command_execution_archive_packs";
export const COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES = catalogIndexes("command_execution", []);
export const RETIRABLE_ORIGINS = ["external_sheet_ingestion", "granot_lifecycle"] as const;
const PROCESSOR_ACTOR_ID = "granot-lifecycle-processor";
/** The collections an `entity_refs` model of phases 1–2 lives in. Any other model holds. */
const LIVE_COLLECTIONS: Record<string, string> = { FormLead: "form_leads", CallLead: "call_leads", GranotRecordLink: "granot_record_links" };
const OBJECT_ID = /^[a-f0-9]{24}$/;

export type CommandFacts = {
  /** Rows applied at or after this instant are still settling. */
  until: Date;
  /** Granot receipt and Observation ids still in their hot collections. */
  hot: Set<string>;
  /** `<model>:<id>` of every referenced record that exists. */
  live: Set<string>;
};

/** The receipt and Observation a processor key was built from, or `null` when the key is not one of them. */
function processorSource(row: Document): { receipt: string; observation: string } | null {
  const observation = String(row.provenance?.observation_id ?? ""), receipt = String(row.provenance?.source_receipt_id ?? "");
  if (row.actor?.actor_id !== PROCESSOR_ACTOR_ID || !OBJECT_ID.test(observation) || !OBJECT_ID.test(receipt)) return null;
  const keyed = row.idempotency_key === synchronizeLeadIdempotencyKey(observation) || row.idempotency_key === createLeadFromGranotIdempotencyKey(observation);
  return keyed ? { receipt, observation } : null;
}

/** A receipt's references other than itself (Owner discrepancy commands also list their own execution). */
const refsOf = (row: Document): Array<{ model: string; id: string }> => (Array.isArray(row.entity_refs) ? row.entity_refs : [])
  .filter((r: Document) => !(r?.model === "CommandExecution" && String(r.id) === String(row._id)))
  .map((r: Document) => ({ model: String(r?.model), id: String(r?.id) }));

/** The phase 1–2 proof for one receipt. Pure. */
export function commandExecutionVerdict(row: Document, facts: CommandFacts): Verdict {
  if (!(row.applied_at instanceof Date) || +row.applied_at >= +facts.until) return { verdict: "hold", reason: "settling" };
  if (row.origin === "granot_lifecycle") {
    const source = processorSource(row);
    if (!source) return { verdict: "hold", reason: "key_not_receipt_bound" };
    if (facts.hot.has(source.receipt)) return { verdict: "hold", reason: "source_receipt_hot" };
    if (facts.hot.has(source.observation)) return { verdict: "hold", reason: "source_observation_hot" };
  } else if (row.origin !== "external_sheet_ingestion") {
    return { verdict: "hold", reason: "origin_out_of_scope" };
  }
  const refs = refsOf(row);
  if (!refs.length) return { verdict: "hold", reason: "no_entity_refs" };
  if (refs.some((r) => !LIVE_COLLECTIONS[r.model])) return { verdict: "hold", reason: "entity_ref_unsupported" };
  if (refs.some((r) => !facts.live.has(`${r.model}:${r.id}`))) return { verdict: "hold", reason: "entity_ref_missing" };
  return { verdict: "retire" };
}

const executionsOf = (db: Db) => db.collection(DOMAIN_COMMAND_EXECUTION_COLLECTION);

/** Everything a batch's verdicts read: hot Granot sources and the referenced records that exist. */
export async function loadCommandFacts(db: Db, rows: readonly Document[], until: Date): Promise<CommandFacts> {
  const sources = rows.flatMap((r) => { const s = r.origin === "granot_lifecycle" ? processorSource(r) : null; return s ? [s] : []; });
  const hot = new Set<string>();
  for (const [name, ids] of [["granot_webhook_receipts", sources.map((s) => s.receipt)], ["granot_observations", sources.map((s) => s.observation)]] as const) {
    if (!ids.length) continue;
    for (const d of await db.collection(name).find({ _id: { $in: ids.map(toObjectId) } }, { projection: { _id: 1 } }).toArray()) hot.add(String(d._id));
  }
  const live = new Set<string>();
  const byModel = new Map<string, Set<string>>();
  for (const ref of rows.flatMap(refsOf)) if (LIVE_COLLECTIONS[ref.model] && OBJECT_ID.test(ref.id)) (byModel.get(ref.model) ?? byModel.set(ref.model, new Set()).get(ref.model)!).add(ref.id);
  for (const [model, ids] of byModel) {
    for (const d of await db.collection(LIVE_COLLECTIONS[model]!).find({ _id: { $in: [...ids].map(toObjectId) } }, { projection: { _id: 1 } }).toArray()) live.add(`${model}:${String(d._id)}`);
  }
  return { until, hot, live };
}

/** Reads (read-only) the next phase 1–2 receipts after `cursor` (`_id` order) and their verdicts, for `dry-run` and the worker. */
export async function reviewCommandBatch(db: Db, cursor: string | null, now: Date, size = RETIREMENT_BATCH) {
  const rows = await readRawBatch(executionsOf(db).find({ origin: { $in: [...RETIRABLE_ORIGINS] }, ...(cursor ? { _id: { $gt: toObjectId(cursor) } } : {}) },
    { raw: true, sort: { _id: 1 }, limit: size }) as never);
  const facts = await loadCommandFacts(db, rows.map((r) => r.doc), new Date(+now - RETIREMENT_SETTLE_MS));
  return { rows, verdicts: rows.map((r) => commandExecutionVerdict(r.doc, facts)) };
}

export async function retireProvenCommandExecutions(db: Db, options: {
  now?: Date; store?: ObjectStore; maxBatches?: number; budgetMs?: number; batchSize?: number; owner?: string; clock?: () => number;
} = {}): Promise<RetirementRun> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const owner = options.owner ?? `command-execution-retirement:${randomUUID()}`;
  const lease = await acquireLease<string>(db, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, owner, now);
  if (!lease.control) return emptyRun(lease.status);
  const run = emptyRun("ran");
  let cursor: string | null = lease.control.cursor ?? null;
  try {
    const rested = lease.control.pass_completed_at;
    if (!cursor && rested instanceof Date && +now - +rested < RETIREMENT_PASS_INTERVAL_MS) { run.status = "resting"; return run; }
    const { store, recoveryDays } = await openRetirementStore(db, options.store);
    while (run.batches < (options.maxBatches ?? 4) && clock() - started < (options.budgetMs ?? 40_000)) {
      const { rows, verdicts } = await reviewCommandBatch(db, cursor, now, options.batchSize);
      if (!rows.length) {
        cursor = null; run.pass_completed = true;
        await advance(db, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, owner, { cursor: null, pass_completed_at: now }, clock);
        break;
      }
      const proven: RawRow[] = [], provenDocs: Document[] = [];
      rows.forEach((r, i) => { if (verdicts[i]!.verdict === "retire") { proven.push({ raw: r.raw, id: String(r.doc._id) }); provenDocs.push(r.doc); } });
      if (proven.length) {
        const held: Record<string, number> = {}, origins: Record<string, number> = {};
        for (const v of verdicts) if (v.verdict === "hold") held[v.reason] = (held[v.reason] ?? 0) + 1;
        for (const d of provenDocs) origins[d.origin] = (origins[d.origin] ?? 0) + 1;
        const times = provenDocs.map((d) => +d.applied_at);
        const packed = await packAndCatalog(db, { store, recoveryDays, catalog: COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, rows: proven,
          day: new Date(Math.min(...times)), now, fields: {
            origins, first_applied_at: new Date(Math.min(...times)), last_applied_at: new Date(Math.max(...times)), reviewed: rows.length, held_reasons: held,
          } });
        run.deleted += await deleteExact(db, DOMAIN_COMMAND_EXECUTION_COLLECTION, proven);
        run.packs++; run.packed_bytes += packed.packed_bytes; run.raw_bytes += proven.reduce((s, r) => s + r.raw.length, 0);
      }
      cursor = String(rows.at(-1)!.doc._id);
      run.batches++; tally(run, verdicts);
      if (!(await advance(db, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, owner, { cursor }, clock))) break;
    }
  } catch (error) {
    recordError(run, error);
    throw error;
  } finally {
    run.cursor = cursor;
    await releaseLease(db, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, owner, now, run);
    logger.info({ msg: "domain_commands.command_execution_retirement.run", ...run });
  }
  return run;
}

/** Restores one retired receipt by original `_id` from its verified pack, or `null` when no live pack holds it. */
export const lookupArchivedCommandExecution = (db: Db, id: string, store?: ObjectStore) =>
  lookupArchivedRow(db, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, id, store);
