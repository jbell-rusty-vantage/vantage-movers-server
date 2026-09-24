import mongoose from "mongoose";
import { CSI_MODEL_REGISTRY } from "../../src/models/salesIntelligence/registry";
import { LEAD_CONVERSATION_INDEXES } from "../../src/models/LeadConversation";
import {
  CALL_LEAD_ATTACHMENT_INDEXES,
  FORM_LEAD_ATTACHMENT_INDEXES,
} from "../../src/models/leadContactPhoneIndexes";
import type { CsiIndex } from "../../src/models/salesIntelligence/common";
import { ENTITY_CHANGE_INDEXES } from "../../src/models/EntityChange";
import { GRANOT_OBSERVATION_INDEXES } from "../../src/models/GranotObservation";
import { OUTREACH_BAND_TRANSITION_INDEXES } from "../../src/models/salesIntelligence/outreach";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
export type AccountMapping = {
  conversation_id: string;
  provider_account_id: string;
  evidence_ref: string;
};
export function csiIndexInventory(): Array<{
  collection: string;
  indexes: readonly CsiIndex[];
}> {
  return [
    ...CSI_MODEL_REGISTRY.map((v) => ({
      collection: v.model().collection.collectionName,
      indexes: v.indexes,
    })),
    { collection: "lead_conversations", indexes: LEAD_CONVERSATION_INDEXES },
    // S9-PUBLISH (addendum §6.3): band history, `{ record_id: 1, at: -1 }` and `{ at: 1 }`.
    { collection: "outreach_band_transitions", indexes: OUTREACH_BAND_TRANSITION_INDEXES },
    // CSI-owned additions only; the Lead collections' own indexes are not
    // managed here (14 §3 attachment reverse lookup).
    { collection: "form_leads", indexes: FORM_LEAD_ATTACHMENT_INDEXES },
    { collection: "call_leads", indexes: CALL_LEAD_ATTACHMENT_INDEXES },
    {
      collection: "entity_changes",
      indexes: [
        { name: "entity_change_applied_scan", key: { applied_at: 1, _id: 1 } },
        // Data spec §2.7 / D10: the story readers and the Owner timeline read
        // Granot changes per Lead; declared on the model, which has autoIndex off.
        modelIndex(ENTITY_CHANGE_INDEXES, "entity_change_entity_applied"),
      ],
    },
    // D10: indexes the story readers and the Owner timeline already query in
    // production. These models set `autoIndex: false` and no other migration
    // builds them, so this report is the only proof they exist on Atlas. The
    // names are the ones the models declare (Mongo's default name where the
    // model gives none), so `--apply` never collides with an existing index.
    {
      collection: "granot_observations",
      indexes: [
        modelIndex(GRANOT_OBSERVATION_INDEXES, "granot_observation_normalized_job_no_captured"),
        modelIndex(GRANOT_OBSERVATION_INDEXES, "granot_observation_normalized_phone_captured"),
      ],
    },
    {
      collection: "booked_leads",
      indexes: [
        { name: "lead_ref_1_lead_model_1", key: { lead_ref: 1, lead_model: 1 } },
        { name: "job_no_1", key: { job_no: 1 } },
      ],
    },
    {
      collection: "cancelled_leads",
      indexes: [
        { name: "booked_lead_1", key: { booked_lead: 1 } },
        { name: "lead_ref_1", key: { lead_ref: 1 } },
      ],
    },
    {
      collection: "lead_messages",
      indexes: [
        { name: "lead_message_lead_ref_created", key: { "lead_ref.model": 1, "lead_ref.id": 1, createdAt: -1 } },
        { name: "lead_message_to", key: { to: 1 } },
      ],
    },
  ];
}
function modelIndex(indexes: ReadonlyArray<{ name: string; key: Record<string, 1 | -1> }>, name: string): CsiIndex {
  const found = indexes.find((index) => index.name === name);
  if (!found) throw new Error(`Index ${name} is not declared on its model`);
  return { name: found.name, key: { ...found.key } };
}
async function indexes(collection: mongoose.mongo.Collection) {
  try {
    return await collection.indexes();
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === 26) return [];
    throw e;
  }
}
function matches(a: mongoose.mongo.IndexDescriptionInfo, e: CsiIndex) {
  return (
    a.name === e.name &&
    canonicalJson(a.key) === canonicalJson(e.key) &&
    Boolean(a.unique) === Boolean(e.unique) &&
    Boolean(a.sparse) === Boolean(e.sparse) &&
    canonicalJson(a.partialFilterExpression ?? null) ===
      canonicalJson(e.partialFilterExpression ?? null) &&
    a.expireAfterSeconds === e.expireAfterSeconds
  );
}
/** Never infers accounts from global configuration, phones, or timestamps. Mapping is a reviewed per-record evidence artifact. */
export async function reportCsiMigration(mappings: AccountMapping[] = []) {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) throw new Error("Mongo unavailable");
  const mapping = new Map(mappings.map((v) => [v.conversation_id, v]));
  if (
    mapping.size !== mappings.length ||
    mappings.some(
      (v) =>
        !/^[a-f\d]{24}$/i.test(v.conversation_id) ||
        !v.provider_account_id.trim() ||
        !v.evidence_ref.trim(),
    )
  )
    throw new Error("Invalid reviewed account mapping");
  const unresolved: string[] = [];
  const mappingConflicts: string[] = [];
  const seen = new Set<string>();
  const recordingKeys = new Set<string>();
  const recordingConflicts: string[] = [];
  const conversations = db.collection("lead_conversations");
  for await (const row of conversations.find(
    {},
    {
      projection: {
        provider: 1,
        provider_account_id: 1,
        provider_recording_id: 1,
      },
    },
  )) {
    const id = String(row._id);
    seen.add(id);
    const proposed = mapping.get(id);
    if (
      proposed &&
      row.provider_account_id &&
      row.provider_account_id !== proposed.provider_account_id
    )
      mappingConflicts.push(id);
    const account = row.provider_account_id || proposed?.provider_account_id;
    if (typeof account !== "string" || !account.trim()) {
      unresolved.push(id);
      continue;
    }
    const key = canonicalJson([
      row.provider,
      account,
      row.provider_recording_id,
    ]);
    if (recordingKeys.has(key)) recordingConflicts.push(id);
    recordingKeys.add(key);
  }
  for (const id of mapping.keys()) if (!seen.has(id)) mappingConflicts.push(id);
  const collections = [];
  for (const item of csiIndexInventory()) {
    const collection = db.collection(item.collection);
    const observed = await indexes(collection);
    const conflicts: string[] = [];
    for (const spec of item.indexes.filter((v) => v.unique)) {
      const group = Object.fromEntries(
        Object.keys(spec.key).map((k, i) => [`k${i}`, `$${k}`]),
      );
      const duplicates = await collection
        .aggregate([
          ...(spec.partialFilterExpression
            ? [{ $match: spec.partialFilterExpression }]
            : []),
          { $group: { _id: group, count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 1 },
        ])
        .toArray();
      if (duplicates.length) conflicts.push(spec.name);
    }
    const missing = item.indexes
      .filter((e) => !observed.some((a) => matches(a, e)))
      .map((v) => v.name);
    const retired_unique_indexes =
      item.collection === "outreach_followups"
        ? observed
            .filter(
              (v) =>
                v.unique &&
                v.name !== "_id_" &&
                !item.indexes.some((e) => e.name === v.name),
            )
            .map((v) => v.name!)
        : [];
    const incompatible = item.indexes
      .filter((e) => observed.some((a) => a.name === e.name && !matches(a, e)))
      .map((v) => v.name);
    collections.push({
      collection: item.collection,
      missing,
      incompatible,
      conflicts,
      retired_unique_indexes,
    });
  }
  return {
    version: "csi-migration-v1",
    database: db.databaseName,
    unresolved_account_ids: unresolved,
    mapping_conflict_ids: mappingConflicts,
    recording_conflict_ids: recordingConflicts,
    collections,
    ready:
      unresolved.length +
        mappingConflicts.length +
        recordingConflicts.length ===
        0 &&
      collections.every(
        (v) =>
          !v.conflicts.length &&
          !v.incompatible.length &&
          !v.retired_unique_indexes.length,
      ),
  };
}
export async function applyCsiMigration(mappings: AccountMapping[] = []) {
  const report = await reportCsiMigration(mappings);
  if (!report.ready)
    throw new Error(
      "CSI migration conflicts require review; no changes applied",
    );
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db!;
  for (const item of mappings) {
    const result = await db.collection("lead_conversations").updateOne(
      {
        _id: new mongoose.Types.ObjectId(item.conversation_id),
        $or: [
          { provider_account_id: null },
          { provider_account_id: { $exists: false } },
        ],
      },
      {
        $set: {
          provider_account_id: item.provider_account_id,
          account_attribution_evidence_ref: item.evidence_ref,
        },
      },
    );
    if (!result.matchedCount) {
      const row = await db
        .collection("lead_conversations")
        .findOne({ _id: new mongoose.Types.ObjectId(item.conversation_id) });
      if (row?.provider_account_id !== item.provider_account_id)
        throw new Error("Account attribution changed during migration");
    }
  }
  // Builds replacement fences before dropping the legacy narrower recording fence.
  for (const item of csiIndexInventory())
    for (const { key, ...options } of item.indexes)
      await db
        .collection(item.collection)
        .createIndex(key as mongoose.mongo.IndexSpecification, {
          ...options,
          unique: Boolean(options.unique),
        });
  const verified = await reportCsiMigration();
  if (!verified.ready || verified.collections.some((v) => v.missing.length))
    throw new Error("CSI index verification failed");
  const legacy = (await indexes(db.collection("lead_conversations"))).filter(
    (v) =>
      v.unique &&
      canonicalJson(v.key) ===
        canonicalJson({ provider: 1, provider_recording_id: 1 }),
  );
  for (const item of legacy)
    await db.collection("lead_conversations").dropIndex(item.name!);
  return reportCsiMigration();
}
