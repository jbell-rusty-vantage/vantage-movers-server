import {
  assertCheckpointAdvance,
  assertMonotonicCounters,
} from "./checkpoints";
import type {
  DurableCheckpoint,
  DurableRunStore,
  RunTransitionInput,
  RunTransitionResult,
} from "./types";

type RunSnapshot<TStatus extends string> = {
  status: TStatus;
  lease_owner?: string | null;
  leased_until?: Date | null;
  lease_epoch?: number | null;
  checkpoint?: DurableCheckpoint | null;
  counters?: Record<string, number> | null;
};

export type MongoDurableRunModel<TStatus extends string> = {
  findById(id: string): PromiseLike<RunSnapshot<TStatus> | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): PromiseLike<{ modifiedCount?: number }>;
};

export type StatusGraph<TStatus extends string> = Readonly<
  Record<TStatus, readonly TStatus[]>
>;

export class InvalidRunTransitionError extends Error {
  readonly code = "INVALID_RUN_TRANSITION";

  constructor(from: string, to: string) {
    super(`Run status transition ${from} -> ${to} is not allowed.`);
    this.name = "InvalidRunTransitionError";
  }
}

export class MongoDurableRunStore<TStatus extends string>
  implements DurableRunStore<TStatus>
{
  constructor(
    private readonly model: MongoDurableRunModel<TStatus>,
    private readonly graph: StatusGraph<TStatus>,
  ) {}

  async transition(
    input: RunTransitionInput<TStatus>,
  ): Promise<RunTransitionResult> {
    const current = await this.model.findById(input.run_id);
    if (!current) return { applied: false, reason: "run_missing" };
    if (!input.expected_statuses.includes(current.status)) {
      return { applied: false, reason: "status_mismatch" };
    }
    if (!(this.graph[current.status] ?? []).includes(input.next_status)) {
      throw new InvalidRunTransitionError(current.status, input.next_status);
    }
    if (!leaseMatches(current, input)) {
      return { applied: false, reason: "lease_lost" };
    }
    if (input.checkpoint) {
      assertCheckpointAdvance(current.checkpoint, input.checkpoint);
    }
    if (input.counters) {
      assertMonotonicCounters(current.counters ?? {}, input.counters);
    }

    const set: Record<string, unknown> = {
      status: input.next_status,
    };
    if (input.checkpoint) set.checkpoint = input.checkpoint;
    if (input.failure !== undefined) set.failure = input.failure;
    for (const [key, value] of Object.entries(input.counters ?? {})) {
      set[`counters.${key}`] = value;
    }
    const counterCompareAndSet = Object.keys(
      input.counters ?? {},
    ).map((key) => {
      const path = `counters.${key}`;
      return Object.prototype.hasOwnProperty.call(
        current.counters ?? {},
        key,
      )
        ? { [path]: current.counters?.[key] }
        : {
            $or: [
              { [path]: 0 },
              { [path]: { $exists: false } },
            ],
          };
    });
    const result = await this.model.updateOne(
      {
        _id: input.run_id,
        status: { $in: input.expected_statuses },
        lease_owner: input.lease.owner,
        lease_epoch: input.lease.epoch,
        leased_until: { $gt: input.now },
        ...(current.checkpoint
          ? { "checkpoint.version": current.checkpoint.version }
          : {
              $or: [
                { checkpoint: null },
                { checkpoint: { $exists: false } },
              ],
            }),
        ...(counterCompareAndSet.length > 0
          ? { $and: counterCompareAndSet }
          : {}),
      },
      { $set: set },
    );
    if (result.modifiedCount === 1) return { applied: true };

    const latest = await this.model.findById(input.run_id);
    if (!latest) return { applied: false, reason: "run_missing" };
    if (!input.expected_statuses.includes(latest.status)) {
      return { applied: false, reason: "status_mismatch" };
    }
    return { applied: false, reason: "lease_lost" };
  }
}

function leaseMatches<TStatus extends string>(
  current: RunSnapshot<TStatus>,
  input: RunTransitionInput<TStatus>,
): boolean {
  return (
    current.lease_owner === input.lease.owner &&
    current.lease_epoch === input.lease.epoch &&
    current.leased_until instanceof Date &&
    current.leased_until.getTime() > input.now.getTime()
  );
}
