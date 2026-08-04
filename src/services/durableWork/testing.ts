import {
  assertCheckpointAdvance,
  assertMonotonicCounters,
} from "./checkpoints";
import { InvalidRunTransitionError, type StatusGraph } from "./runTransitions";
import type {
  DurableCheckpoint,
  DurableRunStore,
  LeaseAcquireInput,
  LeaseStore,
  LeaseToken,
  RunTransitionInput,
  RunTransitionResult,
  StructuredRunFailure,
} from "./types";

export class InMemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, LeaseToken>();
  private readonly epochs = new Map<string, number>();

  async acquire(input: LeaseAcquireInput): Promise<LeaseToken | null> {
    const current = this.leases.get(input.scope);
    if (current && current.leased_until.getTime() > input.now.getTime()) {
      return null;
    }
    const epoch = (this.epochs.get(input.scope) ?? 0) + 1;
    const token = {
      scope: input.scope,
      owner: input.owner,
      epoch,
      leased_until: new Date(input.now.getTime() + input.ttl_ms),
    };
    this.epochs.set(input.scope, epoch);
    this.leases.set(input.scope, token);
    return copyToken(token);
  }

  async renew(input: {
    token: LeaseToken;
    ttl_ms: number;
    now: Date;
  }): Promise<LeaseToken | null> {
    if (!this.isHeld(input.token, input.now)) return null;
    const renewed = {
      ...input.token,
      leased_until: new Date(input.now.getTime() + input.ttl_ms),
    };
    this.leases.set(input.token.scope, renewed);
    return copyToken(renewed);
  }

  async release(input: {
    token: LeaseToken;
    now: Date;
  }): Promise<boolean> {
    if (!this.isHeld(input.token, input.now)) return false;
    this.leases.delete(input.token.scope);
    return true;
  }

  async assertHeld(input: {
    token: LeaseToken;
    now: Date;
  }): Promise<boolean> {
    return this.isHeld(input.token, input.now);
  }

  private isHeld(token: LeaseToken, now: Date): boolean {
    const current = this.leases.get(token.scope);
    return (
      current?.owner === token.owner &&
      current.epoch === token.epoch &&
      current.leased_until.getTime() > now.getTime()
    );
  }
}

export type InMemoryRun<TStatus extends string> = {
  id: string;
  status: TStatus;
  lease: LeaseToken;
  checkpoint: DurableCheckpoint | null;
  counters: Record<string, number>;
  failure: StructuredRunFailure | null;
};

export class InMemoryDurableRunStore<TStatus extends string>
  implements DurableRunStore<TStatus>
{
  private readonly runs = new Map<string, InMemoryRun<TStatus>>();

  constructor(private readonly graph: StatusGraph<TStatus>) {}

  seed(run: InMemoryRun<TStatus>): void {
    this.runs.set(run.id, structuredClone(run));
  }

  read(runId: string): InMemoryRun<TStatus> | undefined {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async transition(
    input: RunTransitionInput<TStatus>,
  ): Promise<RunTransitionResult> {
    const run = this.runs.get(input.run_id);
    if (!run) return { applied: false, reason: "run_missing" };
    if (!input.expected_statuses.includes(run.status)) {
      return { applied: false, reason: "status_mismatch" };
    }
    if (!(this.graph[run.status] ?? []).includes(input.next_status)) {
      throw new InvalidRunTransitionError(run.status, input.next_status);
    }
    if (
      run.lease.owner !== input.lease.owner ||
      run.lease.epoch !== input.lease.epoch ||
      run.lease.leased_until.getTime() <= input.now.getTime()
    ) {
      return { applied: false, reason: "lease_lost" };
    }
    if (input.checkpoint) {
      assertCheckpointAdvance(run.checkpoint, input.checkpoint);
      run.checkpoint = structuredClone(input.checkpoint);
    }
    if (input.counters) {
      assertMonotonicCounters(run.counters, input.counters);
      Object.assign(run.counters, input.counters);
    }
    if (input.failure !== undefined) {
      run.failure = input.failure ? structuredClone(input.failure) : null;
    }
    run.status = input.next_status;
    return { applied: true };
  }
}

function copyToken(token: LeaseToken): LeaseToken {
  return { ...token, leased_until: new Date(token.leased_until) };
}
