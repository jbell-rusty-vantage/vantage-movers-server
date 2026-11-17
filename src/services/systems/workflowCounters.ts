/** Fixed-cardinality, process-local counters. No payloads, identifiers or external writes. */
export const CAPACITY_WORKFLOWS = [
  "granot_capture", "granot_decision", "outreach", "sheet_sync", "granot_automation",
  "granot_retention", "number_retention", "archive",
] as const;
export const CAPACITY_COUNTERS = [
  "capture_rows", "capture_bson_bytes", "business_changed", "business_unchanged",
  "nominations", "claims", "completions", "archive_read_bytes", "archive_write_bytes",
  "eligible", "stamped", "removed", "review_attempts",
] as const;
export type CapacityWorkflow = typeof CAPACITY_WORKFLOWS[number];
export type CapacityCounter = typeof CAPACITY_COUNTERS[number];
type Counters = Partial<Record<CapacityCounter, number>>;

/**
 * Counts observed successful calls/rows, including retries that successfully repeat work.
 * Not fleet totals, unique entity counts, transaction attempts, or evidence of absence.
 * Call after commit when a counter describes committed work. Crashed processes lose totals.
 */
export function createWorkflowCounters(startedAt = new Date()) {
  const since = startedAt.toISOString();
  const counters = new Map<CapacityWorkflow, Counters>();
  const saturated = new Set<CapacityWorkflow>();
  return {
    record(workflow: CapacityWorkflow, values: Counters): void {
      if (!(CAPACITY_WORKFLOWS as readonly string[]).includes(workflow)) return;
      const row = counters.get(workflow) ?? {};
      for (const key of CAPACITY_COUNTERS) {
        const value = values[key];
        if (value === undefined || !Number.isSafeInteger(value) || value < 0) continue;
        const sum = (row[key] ?? 0) + value;
        if (!Number.isSafeInteger(sum)) {
          saturated.add(workflow);
          row[key] = Number.MAX_SAFE_INTEGER;
        } else row[key] = sum;
      }
      counters.set(workflow, row);
    },
    snapshot(at = new Date()) {
      return {
        version: 1 as const,
        scope: "process" as const,
        semantics: "observed_successful_work_including_repeats" as const,
        interval_started_at: since,
        interval_ended_at: at.toISOString(),
        complete: false as const,
        workflows: CAPACITY_WORKFLOWS.filter((name) => counters.has(name)).map((workflow) => ({
          workflow, counts: { ...counters.get(workflow) }, saturated: saturated.has(workflow),
        })),
      };
    },
  };
}
const processCounters = createWorkflowCounters();
export const recordWorkflowCounters = processCounters.record;
export const getWorkflowCounterSnapshot = processCounters.snapshot;
