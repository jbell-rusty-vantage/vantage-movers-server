import type {
  LeaseAcquireInput,
  LeaseStore,
  LeaseToken,
} from "./types";

type LeaseDocument = {
  scope: string;
  lease_owner?: string | null;
  leased_until?: Date | null;
  lease_epoch?: number | null;
};

export type MongoLeaseModel = {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): PromiseLike<LeaseDocument | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): PromiseLike<{ modifiedCount?: number }>;
  findOne(
    filter: Record<string, unknown>,
  ): PromiseLike<LeaseDocument | null>;
};

export class MongoLeaseStore implements LeaseStore {
  constructor(private readonly model: MongoLeaseModel) {}

  async acquire(input: LeaseAcquireInput): Promise<LeaseToken | null> {
    assertLeaseInput(input.scope, input.owner, input.ttl_ms);
    const leasedUntil = new Date(input.now.getTime() + input.ttl_ms);
    try {
      const lease = await this.model.findOneAndUpdate(
        {
          scope: input.scope,
          $or: [
            { leased_until: { $lte: input.now } },
            { leased_until: null },
            { leased_until: { $exists: false } },
          ],
        },
        {
          $set: {
            lease_owner: input.owner,
            leased_until: leasedUntil,
          },
          $inc: { lease_epoch: 1 },
          $setOnInsert: { scope: input.scope },
        },
        {
          returnDocument: "after",
          upsert: true,
        },
      );
      return lease ? toToken(lease) : null;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  async renew(input: {
    token: LeaseToken;
    ttl_ms: number;
    now: Date;
  }): Promise<LeaseToken | null> {
    assertLeaseInput(input.token.scope, input.token.owner, input.ttl_ms);
    const leasedUntil = new Date(input.now.getTime() + input.ttl_ms);
    const lease = await this.model.findOneAndUpdate(
      activeTokenFilter(input.token, input.now),
      { $set: { leased_until: leasedUntil } },
      { returnDocument: "after" },
    );
    return lease ? toToken(lease) : null;
  }

  async release(input: {
    token: LeaseToken;
    now: Date;
  }): Promise<boolean> {
    const result = await this.model.updateOne(
      activeTokenFilter(input.token, input.now),
      {
        $set: {
          lease_owner: null,
          leased_until: input.now,
        },
      },
    );
    return result.modifiedCount === 1;
  }

  async assertHeld(input: {
    token: LeaseToken;
    now: Date;
  }): Promise<boolean> {
    const lease = await this.model.findOne(
      activeTokenFilter(input.token, input.now),
    );
    return lease !== null;
  }
}

export function activeTokenFilter(
  token: LeaseToken,
  now: Date,
): Record<string, unknown> {
  return {
    scope: token.scope,
    lease_owner: token.owner,
    lease_epoch: token.epoch,
    leased_until: { $gt: now },
  };
}

function toToken(lease: LeaseDocument): LeaseToken {
  if (
    !lease.lease_owner ||
    !lease.leased_until ||
    !Number.isInteger(lease.lease_epoch) ||
    Number(lease.lease_epoch) < 1
  ) {
    throw new Error("Lease store returned an invalid fenced lease.");
  }
  return {
    scope: lease.scope,
    owner: lease.lease_owner,
    epoch: Number(lease.lease_epoch),
    leased_until: lease.leased_until,
  };
}

function assertLeaseInput(scope: string, owner: string, ttlMs: number): void {
  if (!scope.trim() || !owner.trim()) {
    throw new TypeError("Lease scope and owner are required.");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("Lease ttl_ms must be positive.");
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
