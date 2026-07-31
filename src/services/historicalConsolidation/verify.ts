import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { assertArtifactHash } from "./stableJson";
import { matchesPlanned } from "./mongoValues";
import { SIDE_EFFECT_COLLECTIONS } from "./apply";
import type { HistoricalManifest, VerificationResult } from "./types";

export async function verifyHistoricalManifest(manifest: HistoricalManifest, db: Db): Promise<VerificationResult> {
  assertArtifactHash(manifest);
  const errors: string[] = [];
  let verified = 0;
  for (const expected of manifest.expected_indexes) {
    const indexes = await db.collection(expected.collection).indexes();
    const actual = indexes.find((entry) => entry.name === expected.name);
    if (!actual || Boolean(actual.unique) !== expected.unique || JSON.stringify(actual.key) !== JSON.stringify(expected.key)) errors.push(`Missing or mismatched index ${expected.collection}.${expected.name}`);
  }
  for (const operation of manifest.operations) {
    const registry = await db.collection("historical_import_registry").findOne({ operation_id: operation.operation_id, manifest_hash: manifest.manifest_hash });
    if (!registry || !["applied", "verified"].includes(String(registry.state))) {
      errors.push(`Operation ${operation.operation_id} has no applied registry record`);
      continue;
    }
    const target = await db.collection(operation.collection).findOne({ _id: new ObjectId(operation.target_id) });
    const expected = operation.action === "insert" ? operation.document : operation.set;
    if (!target || !expected || !matchesPlanned(target, expected)) {
      errors.push(`Operation ${operation.operation_id} target does not match the manifest`);
      continue;
    }
    verified += 1;
  }
  await verifyExpectedCounts(manifest, db, errors);
  await verifyBookingIdentities(db, errors);
  await verifyReferences(manifest, db, errors);
  const start = await db.collection("historical_import_apply_journal").findOne({ manifest_hash: manifest.manifest_hash, kind: "apply_start" }, { sort: { created_at: 1 } });
  if (!start) errors.push("Apply journal has no apply_start record");
  const prohibited = Object.fromEntries(
    await Promise.all(
      SIDE_EFFECT_COLLECTIONS.map(async (name) => {
        const current = await db.collection(name).countDocuments();
        const baseline = Number(
          (start?.side_effect_baseline as Record<string, unknown> | undefined)?.[name] ?? current,
        );
        return [name, current - baseline];
      }),
    ),
  ) as Record<string, number>;
  for (const [name, count] of Object.entries(prohibited)) if (count !== 0) errors.push(`Prohibited side-effect collection ${name} changed by ${count} during apply`);
  if (errors.length === 0) {
    await db.collection("historical_import_registry").updateMany(
      { manifest_hash: manifest.manifest_hash, state: "applied" },
      { $set: { state: "verified", verified_at: new Date() }, $inc: { state_revision: 1 } },
    );
  }
  const result: VerificationResult = { manifest_hash: manifest.manifest_hash, target_database: db.databaseName, ok: errors.length === 0, checked_operations: manifest.operations.length, verified_operations: verified, errors, prohibited_side_effect_counts: prohibited };
  await db.collection("historical_import_apply_journal").insertOne({ manifest_hash: manifest.manifest_hash, kind: "verification", result, created_at: new Date() });
  return result;
}

async function verifyReferences(manifest: HistoricalManifest, db: Db, errors: string[]): Promise<void> {
  for (const operation of manifest.operations) {
    const planned = operation.action === "insert" ? operation.document : operation.set;
    if (!planned) continue;
    const referenceFields: Array<[string, string]> = operation.collection === "booked_leads"
      ? [["customer", "customers"], ["lead_ref", planned.lead_model === "CallLead" ? "call_leads" : "form_leads"]]
      : operation.collection === "cancelled_leads"
        ? [["booked_lead", "booked_leads"], ["customer", "customers"], ["lead_ref", planned.lead_model === "CallLead" ? "call_leads" : "form_leads"]]
        : operation.collection === "form_leads" || operation.collection === "call_leads"
          ? [["lead_source_company", "lead_source_companies"], ["source_granularity_id", "lead_source_granularities"], ["receiver_agent", "agents"]]
          : [];
    for (const [field, collection] of referenceFields) {
      const value = planned[field] as { $oid?: string } | string | undefined;
      const id = typeof value === "string" ? value : value?.$oid;
      if (!id || !ObjectId.isValid(id)) continue;
      const exists = Boolean(await db.collection(collection).findOne({ _id: new ObjectId(id) }, { projection: { _id: 1 } }));
      if (!exists) errors.push(`Operation ${operation.operation_id} has missing ${field} reference ${id} in ${collection}`);
    }
    if (operation.collection === "booked_leads") await verifyBookingAllocations(operation.operation_id, operation.target_id, db, errors);
  }
}

async function verifyExpectedCounts(manifest: HistoricalManifest, db: Db, errors: string[]): Promise<void> {
  for (const [collection, expected] of Object.entries(manifest.expected_counts)) {
    const actual = await db.collection(collection).countDocuments();
    if (actual !== expected.after) errors.push(`Collection ${collection} has ${actual} documents; manifest expected ${expected.after}`);
    if (expected.before + expected.inserts !== expected.after) errors.push(`Manifest count arithmetic is invalid for ${collection}`);
  }
}

async function verifyBookingIdentities(db: Db, errors: string[]): Promise<void> {
  const duplicates = await db.collection("booked_leads").aggregate<{ _id: string; count: number }>([
    { $match: { normalized_job_no: { $type: "string", $ne: "" } } },
    { $group: { _id: "$normalized_job_no", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  for (const duplicate of duplicates) errors.push(`Duplicate normalized_job_no ${duplicate._id} has ${duplicate.count} bookings`);
}

async function verifyBookingAllocations(operationId: string, targetId: string, db: Db, errors: string[]): Promise<void> {
  const booking = await db.collection("booked_leads").findOne({ _id: new ObjectId(targetId) });
  if (!booking) return;
  const allocations = Array.isArray(booking.agent_allocations) ? booking.agent_allocations as Array<Record<string, unknown>> : [];
  let allocationCents = 0;
  for (const allocation of allocations) {
    allocationCents += Math.round(Number(allocation.binder_amount) * 100);
    const agent = allocation.agent;
    if (!(agent instanceof ObjectId) || !await db.collection("agents").findOne({ _id: agent }, { projection: { _id: 1 } })) errors.push(`Operation ${operationId} has a missing agent allocation reference`);
  }
  const expectedCents = Math.round(Number(booking.total_binder_amount) * 100);
  if (!Number.isFinite(expectedCents) || allocationCents !== expectedCents) errors.push(`Operation ${operationId} allocation sum ${allocationCents} cents does not equal total binder ${expectedCents} cents`);
}
