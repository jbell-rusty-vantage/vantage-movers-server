/**
 * Controlled transient failure injection for live-test worker resume proofs.
 * Active only when configured explicitly before a worker invocation.
 */

let transientWriteFailuresRemaining = 0;
let transientWriteFailureRunId: string | null = null;

export function configureLiveTestTransientWriteFailures(input: {
  count: number;
  runId: string;
}): void {
  transientWriteFailuresRemaining = Math.max(0, input.count);
  transientWriteFailureRunId = input.runId;
}

export function resetLiveTestTransientWriteFailures(): void {
  transientWriteFailuresRemaining = 0;
  transientWriteFailureRunId = null;
}

export function consumeLiveTestTransientWriteFailure(runId: string): boolean {
  if (!transientWriteFailureRunId || transientWriteFailureRunId !== runId) {
    return false;
  }
  if (transientWriteFailuresRemaining <= 0) return false;
  transientWriteFailuresRemaining -= 1;
  return true;
}

export function peekLiveTestTransientWriteFailures(): number {
  return transientWriteFailuresRemaining;
}
