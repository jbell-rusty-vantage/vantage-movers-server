/** Observe a peer's active lease without claiming it or changing retry policy. */
export async function waitForBackfillPeer(
  loadJob: () => Promise<{ status: string; leased_until?: Date | null } | null>,
  sleep: (ms: number) => Promise<unknown>,
  now: () => number = Date.now,
) {
  const deadline = now() + 740_000;
  while (now() < deadline) {
    const job = await loadJob();
    if (job?.status !== "leased" || !job.leased_until || job.leased_until.getTime() <= now()) return;
    await sleep(Math.min(2_000, deadline - now()));
  }
}

/** Resume only durable, immediately due step boundaries. The worker owns retry policy and all state writes. */
export async function continueStructuredAnalysis<Result extends { status: string; reason?: string }>(
  invoke: () => Promise<Result>,
  loadJob: () => Promise<{ status: string; next_attempt_at: Date; result?: unknown } | null>,
  now: () => number = Date.now,
): Promise<Result> {
  while (true) {
    const result = await invoke();
    if (result.status !== "retry" || !["step_checkpoint", "step_timeout"].includes(result.reason ?? "")) return result;
    const job = await loadJob();
    const reason = job?.result && typeof job.result === "object" && "reason" in job.result ? job.result.reason : null;
    if (!job || job.status !== "retry" || reason !== result.reason || job.next_attempt_at.getTime() > now()) return result;
  }
}

/** Stop admitting work after a failure; active items finish and report their outcomes. */
export async function runBoundedBackfill<T>(items: readonly T[], concurrency: number,
  run: (item: T, stop: () => void) => Promise<boolean>) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("Concurrency must be 1..4");
  let next = 0, stopped = false;
  const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      try { if (!await run(item, () => { stopped = true; })) stopped = true; }
      catch (error) { stopped = true; throw error; }
    }
  }));
  const rejected = workers.find(worker => worker.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
}
