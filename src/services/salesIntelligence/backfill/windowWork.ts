import type { ClientSession } from "mongoose";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";

export type WindowWorkLease = {
  window_id: string;
  owner: string;
  epoch: number;
};

export function windowWorkFence(lease: WindowWorkLease, now: Date) {
  return {
    _id: lease.window_id,
    work_lease_owner: lease.owner,
    work_lease_epoch: lease.epoch,
    work_leased_until: { $gt: now },
  };
}

export async function claimWindowWork(input: {
  window_id: string;
  owner: string;
  ttl_ms: number;
  now: Date;
  checkpoint_page?: number;
  session?: ClientSession;
}) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const leased_until = new Date(input.now.getTime() + input.ttl_ms);
  const row = await Window.findOneAndUpdate(
    {
      _id: input.window_id,
      permission_paused: { $ne: true },
      ...(input.checkpoint_page === undefined ? {} : { checkpoint_page: input.checkpoint_page }),
      status: { $in: ["planned", "partial", "running"] },
      $or: [{ retry_after_until: null }, { retry_after_until: { $lte: input.now } }],
      $and: [
        {
          $or: [
            { work_lease_owner: null },
            { work_leased_until: { $lte: input.now } },
          ],
        },
      ],
    },
    {
      $set: {
        status: "running",
        work_lease_owner: input.owner,
        work_leased_until: leased_until,
      },
      $inc: { work_lease_epoch: 1 },
    },
    { session: input.session ?? null, returnDocument: "after", runValidators: true },
  );
  if (!row) return null;
  return {
    window_id: String(row._id),
    owner: input.owner,
    epoch: row.work_lease_epoch,
  } satisfies WindowWorkLease;
}

export async function renewWindowWork(lease: WindowWorkLease, ttl_ms: number, now: Date) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const leased_until = new Date(now.getTime() + ttl_ms);
  const result = await Window.updateOne(windowWorkFence(lease, now), {
    $set: { work_leased_until: leased_until },
  });
  return result.modifiedCount === 1;
}

export async function releaseWindowWork(lease: WindowWorkLease, now: Date) {
  await getSalesIntelligenceSyncWindowModel().updateOne(windowWorkFence(lease, now), {
    $set: { work_lease_owner: null, work_leased_until: now },
  });
}

export async function commitWindowPage(
  lease: WindowWorkLease,
  now: Date,
  update: {
    checkpoint_page: number;
    records: number;
    status: "partial" | "complete";
    last_error_code: string | null;
    completed_at?: Date;
    activation_status?: "pending";
  },
  session?: ClientSession,
) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const result = await Window.updateOne(windowWorkFence(lease, now), {
    $set: {
      status: update.status,
      checkpoint_page: update.checkpoint_page,
      last_error_code: update.last_error_code,
      work_lease_owner: null,
      work_leased_until: now,
      retry_after_until: null,
      attempts: 0,
      ...(update.completed_at ? { completed_at: update.completed_at } : {}),
      ...(update.activation_status ? { activation_status: update.activation_status } : {}),
    },
    $inc: { pages_done: 1, records: update.records },
  }, { session });
  return result.modifiedCount === 1;
}

export async function markWindowThrottle(
  lease: WindowWorkLease,
  now: Date,
  retry_after_until: Date,
) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const result = await Window.updateOne(windowWorkFence(lease, now), {
    $set: {
      status: "partial",
      last_error_code: "provider_throttled",
      retry_after_until,
      work_lease_owner: null,
      work_leased_until: now,
    },
  });
  return result.modifiedCount === 1;
}

export async function markWindowRetryableFailure(
  lease: WindowWorkLease,
  now: Date,
  error_code: string,
  retry_after_until: Date | null,
) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const result = await Window.updateOne(windowWorkFence(lease, now), {
    $set: {
      status: "partial",
      last_error_code: error_code,
      retry_after_until,
      work_lease_owner: null,
      work_leased_until: now,
    },
    $inc: { attempts: 1 },
  });
  return result.modifiedCount === 1;
}

export async function markWindowFailed(lease: WindowWorkLease, now: Date, error_code: string) {
  const Window = getSalesIntelligenceSyncWindowModel();
  const result = await Window.updateOne(windowWorkFence(lease, now), {
    $set: {
      status: "failed",
      last_error_code: error_code,
      work_lease_owner: null,
      work_leased_until: now,
    },
    $inc: { attempts: 1 },
  });
  return result.modifiedCount === 1;
}

export async function pauseWindowPermission(lease: WindowWorkLease, now: Date) {
  return getSalesIntelligenceSyncWindowModel().updateOne(windowWorkFence(lease, now), {
    $set: { status: "partial", permission_paused: true, last_error_code: "provider_permission_denied",
      work_lease_owner: null, work_leased_until: now },
  });
}
