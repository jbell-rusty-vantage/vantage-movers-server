/**
 * Raise (or set) the Owner's Sales Intelligence monthly AI ceiling through the official settings
 * command, as the active Owner: writes a new policy version, updates the current budget period's
 * ceiling and resumes jobs paused on budget_exhausted. Read-only without --confirm-write.
 *   node --env-file=.env --import tsx scripts/dev_ops/set-csi-monthly-ceiling.ts --cents 50000 [--owner-id ID] --confirm-write
 */
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { readCsiSettings, commandCsiSettings } from "../../src/services/salesIntelligence/settings";

function option(name: string) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }

async function ownerActor(ownerId: string | undefined) {
  const secret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  if (!secret) throw new Error("Owner actor signing is not configured");
  const candidates = await mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).collection("extension_users")
    .find({ active: true, ...(ownerId ? { _id: new mongoose.Types.ObjectId(ownerId) } : {}), $or: [{ roles: "owner" }, { role: "owner", roles: { $exists: false } }] }, { projection: { _id: 1, email: 1 } }).limit(2).toArray();
  if (candidates.length !== 1) throw new Error("Select one active Owner with --owner-id");
  const owner = candidates[0];
  const fields = { adminId: String(owner._id), email: String(owner.email), role: "owner", timestamp: String(Date.now()),
    requestId: `csi-set-ceiling:${Date.now()}`, method: "PATCH", path: "/api/v1/admin/sales-intelligence/settings" };
  const request: Request = Object.assign(Object.create(express.request), { method: fields.method, originalUrl: fields.path,
    vantageAuth: { kind: "user", userId: fields.adminId, email: fields.email, roles: ["owner"] },
    headers: { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, secret) } });
  return requireCsiOwner(request);
}

async function main() {
  const cents = Number(option("--cents"));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("--cents must be a nonnegative integer");
  await connectMongo();
  const current = await readCsiSettings();
  console.log(JSON.stringify({ current_ceiling_cents: current.policy.monthly_ceiling_cents, per_recording_ceiling_cents: current.policy.per_recording_ceiling_cents, revision: current.revision, source: current.source }));
  if (!process.argv.includes("--confirm-write")) return;
  const actor = await ownerActor(option("--owner-id"));
  const { version: _version, ...policy } = current.policy;
  const result = await commandCsiSettings({ actor, idempotency_key: `set-ceiling:${cents}:${current.revision}`,
    command: { command: "update_settings", expected_revision: current.revision, policy: { ...policy, monthly_ceiling_cents: cents }, reason: `Monthly ceiling set to ${cents} cents by the operator` } });
  console.log(JSON.stringify(result).slice(0, 600));
  const after = await readCsiSettings();
  console.log(JSON.stringify({ ceiling_cents: after.policy.monthly_ceiling_cents, revision: after.revision }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
