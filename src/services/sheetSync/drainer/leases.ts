import { SheetSyncLease } from "../../../models/SheetSyncLease";
import {
  MongoLeaseStore,
  type LeaseToken,
  type MongoLeaseModel,
} from "../../durableWork";

const store = new MongoLeaseStore(
  SheetSyncLease as unknown as MongoLeaseModel,
);

export async function acquireLease(
  scope: string,
  owner: string,
  ttlMs: number,
): Promise<LeaseToken | null> {
  const now = new Date();
  return store.acquire({ scope, owner, ttl_ms: ttlMs, now });
}

export async function renewLease(
  token: LeaseToken,
  ttlMs: number,
  now = new Date(),
): Promise<LeaseToken | null> {
  return store.renew({ token, ttl_ms: ttlMs, now });
}

export async function assertLeaseHeld(
  token: LeaseToken,
  now = new Date(),
): Promise<boolean> {
  return store.assertHeld({ token, now });
}

export async function releaseLease(
  token: LeaseToken,
  now = new Date(),
): Promise<boolean> {
  return store.release({ token, now });
}
