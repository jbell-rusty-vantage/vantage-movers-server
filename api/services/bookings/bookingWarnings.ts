import type { AgentAllocationDocumentInput } from "../agents";

/**
 * Builds the human-readable warnings list returned alongside a booked lead
 * create/update response.
 *
 * Currently flags any agent allocated a zero binder amount; the warning
 * shape and message phrasing match the original implementation so existing
 * route consumers see the same strings.
 */
export function buildBookedLeadWarnings(
  allocations: Pick<AgentAllocationDocumentInput, "agent_name_snapshot" | "binder_amount">[],
): string[] {
  return allocations
    .filter((allocation) => allocation.binder_amount === 0)
    .map((allocation) => `${allocation.agent_name_snapshot} has a zero binder amount`);
}
