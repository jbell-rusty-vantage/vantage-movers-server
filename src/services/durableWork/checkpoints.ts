import type { DurableCheckpoint, LeaseToken } from "./types";

export class NonMonotonicCheckpointError extends Error {
  readonly code = "NON_MONOTONIC_CHECKPOINT";

  constructor(message: string) {
    super(message);
    this.name = "NonMonotonicCheckpointError";
  }
}

export function assertCheckpointAdvance(
  current: DurableCheckpoint | null | undefined,
  next: DurableCheckpoint,
): void {
  if (!Number.isInteger(next.version) || next.version < 1) {
    throw new NonMonotonicCheckpointError(
      "Checkpoint version must be a positive integer.",
    );
  }
  if (!Number.isInteger(next.completed_units) || next.completed_units < 0) {
    throw new NonMonotonicCheckpointError(
      "Checkpoint completed_units must be a non-negative integer.",
    );
  }
  if (!next.phase.trim()) {
    throw new NonMonotonicCheckpointError("Checkpoint phase is required.");
  }
  if (current && next.version <= current.version) {
    throw new NonMonotonicCheckpointError(
      "Checkpoint version must strictly increase.",
    );
  }
  if (current && next.completed_units < current.completed_units) {
    throw new NonMonotonicCheckpointError(
      "Checkpoint completed_units cannot decrease.",
    );
  }
}

export function buildCheckpointCompareAndSet(input: {
  run_id: string;
  lease: LeaseToken;
  current_version: number | null;
  next: DurableCheckpoint;
  now: Date;
}): {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
} {
  const expectedVersion =
    input.current_version === null
      ? { $in: [null, 0] }
      : input.current_version;
  if (
    input.current_version !== null &&
    input.next.version <= input.current_version
  ) {
    throw new NonMonotonicCheckpointError(
      "Checkpoint version must strictly increase.",
    );
  }
  return {
    filter: {
      _id: input.run_id,
      lease_owner: input.lease.owner,
      lease_epoch: input.lease.epoch,
      leased_until: { $gt: input.now },
      "checkpoint.version": expectedVersion,
    },
    update: { $set: { checkpoint: input.next } },
  };
}

export function assertMonotonicCounters(
  current: Record<string, number>,
  next: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(next)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new NonMonotonicCheckpointError(
        `Counter ${key} must be a non-negative finite number.`,
      );
    }
    if (value < (current[key] ?? 0)) {
      throw new NonMonotonicCheckpointError(
        `Counter ${key} cannot decrease.`,
      );
    }
  }
}
