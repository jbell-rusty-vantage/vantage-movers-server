import { BSON, type Db, type Document } from "mongodb";
import { gunzipSync } from "node:zlib";
import { CLOUD_STORAGE_NAMESPACES, CloudStorageError, granotHistoryObjectName, isCloudStorageError, type ObjectState, type ObjectStore } from "../cloudStorage";
import { archiveObjectReferenced } from "./archiveReferences";
import { decodeChains, digest } from "./archiveCodec";
import { END_OF_LIFE_STATE } from "./endOfLife";
import { evidenceFormat, unpackEvidence } from "./evidencePage";

/**
 * Unreferenced older Granot objects (Owner decision 6, 2026-11-23; proposal §6 of
 * docs/operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md). Operator-only: no route or cron
 * imports this. Runbook: docs/knowledge/granot-lifecycle/storage-retention-operations.md#unreferenced-older-objects.
 *
 * An object qualifies only when no MongoDB locator names it and every document it holds (each chain's
 * receipt, Observation and Decisions) exists byte for byte in another object a live MongoDB row still
 * names: a newer month page of the same job, a Lead evidence page, or a retired-by-use receipt pack.
 * Its 90-day recovery clock then starts through the namespace review and `startRecoveryClock`, with
 * `archiveObjectReferenced` as the reference guard.
 */

/** Every MongoDB field that names a Granot object hash. `_id` of the catalog doubles as the hash of old chunk rows. */
export const GRANOT_LOCATOR_FIELDS: [collection: string, fields: string[]][] = [
  ["granot_history_archive_chunks", ["_id", "hash"]],
  ["granot_archived_receipts", ["hash", "evidence_archive.hash", "history_archive.hash"]],
  ["granot_webhook_receipts", ["evidence_archive.hash", "history_archive.hash"]],
  ["granot_closed_automation_runs", ["hash", "run_archive.hash"]],
  ["granot_automation_runs", ["archive_summary.hash"]],
  // An object under an end-of-life review is that pass's to finish.
  [END_OF_LIFE_STATE, ["_id"]],
];
const HASH = /^[a-f0-9]{64}$/;
const pick = (doc: Document, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v as Document | undefined)?.[k], doc);

/** The hash of every object a MongoDB row names, across `GRANOT_LOCATOR_FIELDS`, including rows already expiring. */
export async function referencedHashes(db: Db, readPreference: "primary" | "secondaryPreferred" = "secondaryPreferred") {
  const out = new Set<string>();
  for (const [name, fields] of GRANOT_LOCATOR_FIELDS) {
    const projection = Object.fromEntries(fields.map((f) => [f, 1]));
    const filter = { $or: fields.map((f) => ({ [f]: { $type: "string" } })) };
    for await (const row of db.collection(name).find(filter as Document, { projection, readPreference, batchSize: 5000 })) {
      for (const f of fields) {
        const value = pick(row, f);
        if (typeof value === "string" && HASH.test(value)) out.add(value);
      }
    }
  }
  return out;
}

/** BSON options that keep every value's original type, so a re-serialized document is its original bytes. */
const PRESERVE = { promoteValues: false, promoteLongs: false, promoteBuffers: false, bsonRegExp: true } as const;
const docDigest = (doc: Document) => digest(BSON.serialize(doc));
const id = (doc: Document) => String(doc._id);
export type DocKey = `${"r" | "o" | "d"}:${string}`;
export type DocDigests = Map<DocKey, string>;

/** The receipt, Observation and Decision digests of a list of chains (`{ receipt, observation, decisions }`). */
export function chainDigests(chains: Document[], keep: (chain: Document) => boolean = () => true): DocDigests {
  const out: DocDigests = new Map();
  for (const chain of chains) {
    if (!keep(chain)) continue;
    out.set(`r:${id(chain.receipt)}`, docDigest(chain.receipt));
    out.set(`o:${id(chain.observation)}`, docDigest(chain.observation));
    for (const d of chain.decisions) out.set(`d:${id(d)}`, docDigest(d));
  }
  return out;
}

export type Decoded =
  | { kind: "job_chunk"; job: string; chains: number; docs: DocDigests }
  | { kind: "other"; format: string }
  | { kind: "unreadable" };

/** Decodes one verified object. Only a version-1 job chunk (the month-page shape) can qualify. */
export function decodeObject(bytes: Buffer, hash: string): Decoded {
  let doc: Document;
  try {
    doc = BSON.deserialize(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }), PRESERVE);
  } catch {
    return { kind: "unreadable" };
  }
  const job = typeof doc.job === "string" ? doc.job : undefined;
  if (job && Array.isArray(doc.chains) && Number(doc.version?.valueOf?.() ?? doc.version) === 1) {
    try { decodeChains(bytes, hash, job); } catch { return { kind: "unreadable" }; }
    return { kind: "job_chunk", job, chains: doc.chains.length, docs: chainDigests(doc.chains) };
  }
  const format = typeof doc.format === "string" ? doc.format
    : typeof doc.observation_channel === "string" ? `receipt:${doc.observation_channel}` : "unknown";
  return { kind: "other", format };
}

/** Evidence page digests for one job, limited to the documents its catalog row committed (as `readEvidenceIds` reads them). */
export function evidenceDigests(bytes: Buffer, hash: string, job: string, committed: Set<string>): DocDigests {
  unpackEvidence(bytes, hash);
  const doc = BSON.deserialize(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }), PRESERVE);
  if (doc.format !== evidenceFormat) throw new Error("Invalid Granot evidence page");
  return chainDigests(doc.rows, (c) => c.observation?.identity?.normalized_job_no === job && committed.has(id(c.observation)));
}

export type Coverage = Map<DocKey, { digest: string; hash: string }[]>;
export type ObjectClass = "confirmed_superseded" | `held:${string}`;

/** Objects written this recently may be awaiting the catalog row that names them. */
export const RECENT_MS = 24 * 3_600_000;

/**
 * Pure verdict for one unreferenced object. Order: provider state first (a hold, a clock, a fresh
 * write), then content (only job chunks), then coverage: every document must exist byte for byte
 * in another live archive.
 */
export function classifyObject(state: Pick<ObjectState, "holds" | "independentHold" | "retentionLocked" | "recoveryClockStartedAt" | "updated">,
  decoded: Decoded, coverage: Coverage, now: Date): { class: ObjectClass; covering: string[] } {
  const held = (reason: string) => ({ class: `held:${reason}` as ObjectClass, covering: [] });
  if (state.recoveryClockStartedAt) return held("already_on_clock");
  if (Object.keys(state.holds).length || state.independentHold || state.retentionLocked) return held("hold_present");
  if (+now - Date.parse(state.updated) < RECENT_MS) return held("recent");
  if (decoded.kind === "unreadable") return held("unreadable");
  if (decoded.kind === "other") return held(`not_job_chunk:${decoded.format}`);
  if (!decoded.docs.size) return held("empty");
  const covering = new Set<string>();
  let differs = false;
  for (const [key, want] of decoded.docs) {
    const copies = coverage.get(key);
    if (!copies?.length) return held("chain_not_archived_elsewhere");
    const match = copies.find((c) => c.digest === want);
    if (!match) { differs = true; continue; }
    covering.add(match.hash);
  }
  if (differs) return held("newer_copy_differs");
  return { class: "confirmed_superseded", covering: [...covering].sort() };
}

export type ManifestEntry = {
  hash: string; generation: string; size: number; class: ObjectClass;
  job?: string; chains?: number; covering?: string[];
};

/** The review hold token of this pass, constant so a later run resumes its own review. */
export const UNREFERENCED_REVIEW_TOKEN = "unreferenced-v1";
const DRAIN_SKEW_MS = 60_000;
const drainMs = CLOUD_STORAGE_NAMESPACES["granot-history"].review!.drainMs;

export type ApplyGuards = {
  /** True while any MongoDB row names the object (`archiveObjectReferenced` plus end-of-life state). */
  referenced: (hash: string) => Promise<boolean>;
  /** True while a MongoDB row still names a covering object, so the newer copy is still served. */
  covered: (hash: string) => Promise<boolean>;
};

export type ApplyOutcome =
  | "review_started" | "draining" | "released" | "already_released"
  | "object_missing" | "generation_changed" | "hold_present" | "review_in_progress"
  | "now_referenced" | "covering_gone" | "clock_refused";

/**
 * One manifest entry. Step 1 places the namespace review hold (replacing a publisher hold); step 2,
 * once the 800 s drain has passed since the hold, starts the recovery clock under the reference guard.
 * Both steps re-verify the generation and that no row names the object and that its covering objects
 * are still named. Re-running is safe: state lives on the object (hold token, `customTime`).
 */
export async function applyEntry(store: ObjectStore, database: string, entry: ManifestEntry, guards: ApplyGuards, now: Date): Promise<ApplyOutcome> {
  const name = granotHistoryObjectName(store.prefix, database, entry.hash);
  const object = await store.stat(name);
  if (!object) return "object_missing";
  if (object.generation !== entry.generation) return "generation_changed";
  if (object.recoveryClockStartedAt && !Object.keys(object.holds).length && !object.independentHold) return "already_released";
  if (object.independentHold || object.retentionLocked) return "hold_present";
  const review = object.holds.review;
  if (review && review !== UNREFERENCED_REVIEW_TOKEN) return "review_in_progress";
  if (Object.keys(object.holds).some((h) => h !== "review" && h !== "publisher")) return "hold_present";
  const ref = { name, generation: object.generation, sha256: entry.hash };
  // Abandoning a review puts the publisher hold back, never no hold (as end of life does).
  const protect = () => store.hold(ref, { holder: "publisher", replaces: ["review"] });
  const blocked = async (): Promise<ApplyOutcome | null> => {
    if (await guards.referenced(entry.hash)) return "now_referenced";
    for (const h of entry.covering ?? []) if (!(await guards.covered(h))) return "covering_gone";
    return entry.covering?.length ? null : "covering_gone";
  };
  const reason = await blocked();
  if (reason) {
    if (review) await protect();
    return reason;
  }
  if (!review) {
    await store.hold(ref, { holder: "review", token: UNREFERENCED_REVIEW_TOKEN, replaces: ["publisher"] });
    return "review_started";
  }
  // The module enforces the namespace drain (800 s from the hold's provider `updated`); add skew margin.
  if (+now - Date.parse(object.updated) < drainMs + DRAIN_SKEW_MS) return "draining";
  try {
    await store.startRecoveryClock(ref, { reviewToken: UNREFERENCED_REVIEW_TOKEN, references: () => guards.referenced(entry.hash) });
    return "released";
  } catch (error) {
    if (isCloudStorageError(error, "hold_not_drained")) return "draining";
    if (isCloudStorageError(error, "generation_mismatch")) return "generation_changed";
    if (isCloudStorageError(error, "referenced") || isCloudStorageError(error, "held")) {
      await protect().catch(() => undefined);
      return error instanceof CloudStorageError && error.code === "referenced" ? "now_referenced" : "clock_refused";
    }
    throw error;
  }
}

/** The production reference guard: any locator (`archiveObjectReferenced`, at one snapshot) or an end-of-life review. */
export async function objectReferenced(db: Db, hash: string) {
  if (await db.collection(END_OF_LIFE_STATE).findOne({ _id: hash as never }, { projection: { _id: 1 } })) return true;
  return archiveObjectReferenced(db, hash);
}
