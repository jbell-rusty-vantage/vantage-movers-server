import { BSON, type ClientSession, type Db, type Document, type ObjectId } from "mongodb";
import { gunzipSync } from "node:zlib";
import type { GranotObservationReceiptDocument } from "../../models/GranotObservationReceipt";
import { decodeChains, digest, type ArchivedChain } from "./archiveCodec";
import { readArchiveObject, type ArchiveRead } from "./archiveObjects";
import { evidenceForReceipt, readEvidenceIds, readEvidencePage, type EvidenceLocator } from "./evidencePage";

/**
 * Read-back by original ID for the three Granot record kinds. Each reader returns the MongoDB
 * document while it is hot, otherwise the exact document restored from its verified GCS
 * generation. A retired record leaves only a compact locator behind:
 * - receipts: `granot_archived_receipts` (one row per original receipt ID);
 * - Observations and Decisions: `granot_history_archive_chunks.evidence_ids` (Lead evidence pages).
 * A corrupt or missing object fails loudly; it never reads as "absent".
 */
export const webhookReceiptFormat = "completed-webhook-bson-v1";
/** A retired browser-extension or HTTP-automation receipt. The locator keeps the unique operation key. */
export const channelReceiptFormat = "channel-receipt-bson-v1";
export const RETIRED_RECEIPT_FORMATS = [webhookReceiptFormat, channelReceiptFormat] as const;
export const RETIRED_CHANNELS = ["granot_http_automation", "browser_extension"] as const;
const WEBHOOK_ROUTES = ["lead_created", "priority_updated"];

export const archivedReceipts = (db: Db) => db.collection("granot_archived_receipts");
export type ReadBackOptions = { session?: ClientSession; read?: ArchiveRead };

/** Decodes one retired receipt object and proves it is the receipt the locator names. */
export function restoreRetiredReceipt(bytes: Buffer, hash: string, id: ObjectId, format: string) {
  if (digest(bytes) !== hash) throw new Error("Retired receipt checksum mismatch");
  const raw = gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
  const receipt = BSON.deserialize(raw) as GranotObservationReceiptDocument;
  const channel = receipt.observation_channel as string;
  const shaped = format === webhookReceiptFormat
    ? channel === "granot_webhook" && WEBHOOK_ROUTES.includes(String(receipt.route_event_class))
    : format === channelReceiptFormat && (RETIRED_CHANNELS as readonly string[]).includes(channel) &&
      typeof receipt.channel_operation_id === "string";
  if (!id.equals(receipt._id) || receipt.processing?.state !== "completed" || !shaped) {
    throw new Error("Retired receipt identity mismatch");
  }
  return { raw, receipt };
}

/** A receipt that has left `granot_webhook_receipts`, by original ID. `null` when no locator exists. */
export async function readRetiredReceipt(db: Db, id: ObjectId, options: ReadBackOptions = {}) {
  const { session, read = readArchiveObject } = options;
  const locator = await archivedReceipts(db).findOne({ _id: id }, { session });
  if (!locator) return null;
  if ((RETIRED_RECEIPT_FORMATS as readonly string[]).includes(locator.format)) {
    if (!locator.generation) throw new Error("Retired receipt generation missing");
    const { receipt } = restoreRetiredReceipt(await read(db.databaseName, locator.hash, locator.generation), locator.hash, id, locator.format);
    // Reconciliation can repoint the latest Decision after retirement; the locator owns that pointer.
    receipt.processing.latest_decision_id = locator.processing.latest_decision_id;
    receipt.processing.certified_lead = locator.processing.certified_lead;
    return receipt;
  }
  if (locator.evidence_archive) {
    const page = await readEvidencePage(db, locator.evidence_archive, read);
    return evidenceForReceipt(page, { _id: id }, locator.evidence_archive).receipt as GranotObservationReceiptDocument;
  }
  if (locator.job && locator.hash) return (await monthChain(db, id, locator, read)).receipt as GranotObservationReceiptDocument;
  return null;
}

async function monthChain(db: Db, id: ObjectId, locator: Document, read: ArchiveRead): Promise<ArchivedChain> {
  const chain = decodeChains(await read(db.databaseName, locator.hash, locator.generation), locator.hash, locator.job)
    .find((c) => String(c.receipt._id) === String(id));
  if (!chain) throw new Error("Granot archived receipt missing from its verified page");
  return chain;
}

/** Receipt by original ID: MongoDB while hot, otherwise its verified archive. */
export async function readGranotReceipt(db: Db, id: ObjectId, options: ReadBackOptions = {}) {
  return (await db.collection<GranotObservationReceiptDocument>("granot_webhook_receipts").findOne({ _id: id }, { session: options.session }))
    ?? readRetiredReceipt(db, id, options);
}

/** Observation by original ID: MongoDB while hot, otherwise its verified Lead evidence page. */
export async function readGranotObservation(db: Db, id: ObjectId, options: ReadBackOptions = {}) {
  return (await db.collection("granot_observations").findOne({ _id: id }, { session: options.session }))
    ?? (await readEvidenceIds(db, [id], "observation", options.session, options.read))[0] ?? null;
}

/** Synchronization Decision by original ID: MongoDB while hot, otherwise its verified Lead evidence page. */
export async function readGranotDecision(db: Db, id: ObjectId, options: ReadBackOptions = {}) {
  return (await db.collection("synchronization_decisions").findOne({ _id: id }, { session: options.session }))
    ?? (await readEvidenceIds(db, [id], "decision", options.session, options.read))[0] ?? null;
}

/** The locator's unique operation key: duplicate delivery and changed input keep working after retirement. */
export const RETIRED_OPERATION_INDEX = {
  key: { observation_channel: 1, channel_operation_id: 1 },
  options: { name: "granot_archived_receipt_operation_unique", unique: true, partialFilterExpression: { channel_operation_id: { $type: "string" } } },
} as const;

const indexSeen = new Map<string, { ready: boolean; at: number }>();
/**
 * Whether `granot_archived_receipt_operation_unique` exists. Retirement of a channel operation
 * refuses until it does, so without it no retired operation can exist and lookups are skipped
 * (no locator scan on the capture path). A seen index is cached for the process; an absent one is
 * rechecked at most once a minute. `fresh` bypasses the cache (the online pass, backlog --apply).
 */
export async function retiredOperationIndexReady(db: Db, fresh = false) {
  const key = db.databaseName, cached = indexSeen.get(key);
  if (!fresh && cached && (cached.ready || Date.now() - cached.at < 60_000)) return cached.ready;
  const indexes = await archivedReceipts(db).listIndexes().toArray().catch(() => []);
  const ready = indexes.some((index) => index.name === RETIRED_OPERATION_INDEX.options.name && index.unique === true);
  indexSeen.set(key, { ready, at: Date.now() });
  return ready;
}

/**
 * The retired operation, by its unique channel key, for duplicate delivery and changed-input
 * detection. `null` without a query while the operation index is absent.
 */
export async function readRetiredOperation(db: Db, channel: string, operation: string, session?: ClientSession) {
  if (!(await retiredOperationIndexReady(db))) return null;
  return archivedReceipts(db).findOne(
    { observation_channel: channel, channel_operation_id: operation },
    { session, projection: { _id: 1, payload_sha256: 1, channel_operation_kind: 1 } },
  );
}

/**
 * Receipts that retire on use may ever leave MongoDB: inbound Lead webhooks and Lead-snapshot
 * channel operations. Only these get a review date, so the review queue holds nothing else.
 */
export function isRetirementCandidate(r: { observation_channel?: string; route_event_class?: string; channel_operation_kind?: string }) {
  return r.observation_channel === "granot_webhook"
    ? WEBHOOK_ROUTES.includes(String(r.route_event_class))
    : (RETIRED_CHANNELS as readonly string[]).includes(String(r.observation_channel)) && r.channel_operation_kind === "lead_snapshot_apply";
}

/** Receipt, Observation and Decisions of one original receipt ID, hot or retired (operator diagnostics). */
export async function readGranotChain(db: Db, receiptId: ObjectId, read: ArchiveRead = readArchiveObject) {
  const locator = await archivedReceipts(db).findOne({ _id: receiptId });
  if (locator && !locator.format && !locator.evidence_archive && locator.job) return monthChain(db, receiptId, locator, read);
  const receipt = await readGranotReceipt(db, receiptId, { read });
  if (!receipt) return null;
  const evidence = (locator?.evidence_archive ?? (receipt as Document).evidence_archive) as EvidenceLocator | undefined;
  if (evidence) return { ...evidenceForReceipt(await readEvidencePage(db, evidence, read), { _id: receiptId }, evidence), receipt };
  const latest = receipt.processing?.latest_decision_id as ObjectId | undefined;
  const decision = latest ? await readGranotDecision(db, latest, { read }) : null;
  const observation = (await db.collection("granot_observations").findOne({ receipt_id: receiptId }))
    ?? (decision ? await readGranotObservation(db, decision.observation_id, { read }) : null);
  if (!observation) throw new Error("Archived receipt evidence missing");
  const decisions: Document[] = await db.collection("synchronization_decisions").find({ observation_id: observation._id }).sort({ attempt: 1 }).toArray();
  if (decision && !decisions.some((d) => String(d._id) === String(decision._id))) decisions.push(decision);
  return { receipt, observation, decisions };
}
