import mongoose from "mongoose";
import type { BookedLeadDocument } from "../../models/BookedLead";
import type {
  CreateBookedLeadFromSourceInput,
  CreateBookedLeadInput,
} from "../../validation/v1.validation";
import { resolveAgentByName } from "../catalog";
import { V1ServiceError } from "../v1ServiceError";
import { normalizeAgentName } from "./agentName";
import { toObjectId } from "../../utils/objectId";

/**
 * Shape of an agent allocation as accepted from request input.
 *
 * Re-uses the validated tuple element from `CreateBookedLeadInput` so this
 * type stays in lock-step with the zod schema.
 */
export type AgentAllocationInput = CreateBookedLeadInput["agent_allocations"][number];

/**
 * Shape of an agent allocation once it has been resolved against the `Agent`
 * collection. This is what gets stored on `BookedLead.agent_allocations` and
 * is also the patch/replace operand inside the booking update flow.
 */
export type AgentAllocationDocumentInput = {
  agent: mongoose.Types.ObjectId;
  agent_name_snapshot: string;
  binder_amount: number;
};

export function receiverAttributionFromPrimaryAllocation(
  allocations: AgentAllocationDocumentInput[],
  sourceValue: string,
  setAt = new Date(),
  existingReceiver?: unknown,
) {
  if (existingReceiver) return undefined;
  const primary = allocations[0];
  if (!primary) return undefined;
  return {
    receiver_agent: primary.agent,
    receiver_agent_name_snapshot: primary.agent_name_snapshot,
    receiver_agent_source: "best_relocation_sheet" as const,
    receiver_agent_source_value: sourceValue,
    receiver_agent_set_at: setAt,
  };
}

/**
 * Derives the agent allocation list for a booked-from-source request.
 *
 * Behavior preserved from `v1.service.ts`:
 *   - Trims and collapses whitespace on both `agent` and `split_agent`.
 *   - Rejects requests where `split_agent` normalizes to the same name as
 *     `agent` with a 400 `V1ServiceError`.
 *   - Without a split, returns a single allocation for the full
 *     `binder_amount`.
 *   - With a split, splits the binder evenly between the two agents.
 */
export function deriveBookedLeadAgentAllocations(
  input: Pick<CreateBookedLeadFromSourceInput, "agent" | "split_agent" | "binder_amount">,
): AgentAllocationInput[] {
  const agent = input.agent.trim().replace(/\s+/g, " ");
  const splitAgent = input.split_agent?.trim().replace(/\s+/g, " ") || undefined;
  if (splitAgent && normalizeAgentName(agent) === normalizeAgentName(splitAgent)) {
    throw new V1ServiceError("split_agent must be different from agent", 400);
  }

  if (!splitAgent) {
    return [{ agent_name: agent, binder_amount: input.binder_amount }];
  }

  const halfBinderAmount = input.binder_amount / 2;
  return [
    { agent_name: agent, binder_amount: halfBinderAmount },
    { agent_name: splitAgent, binder_amount: halfBinderAmount },
  ];
}

/**
 * Upserts every supplied allocation against the `Agent` collection and
 * returns the document-ready form for storage on a `BookedLead`.
 *
 * Rejects duplicate agent names within the same allocation list with a 400
 * `V1ServiceError`. The duplicate check uses `normalizeAgentName` so casing
 * and whitespace differences still count as duplicates.
 */
export async function resolveAgentAllocations(
  allocations: AgentAllocationInput[],
  options: { includeInactive?: boolean } = {},
): Promise<AgentAllocationDocumentInput[]> {
  const normalizedNames = new Set<string>();
  const resolved: AgentAllocationDocumentInput[] = [];

  for (const allocation of allocations) {
    const name = allocation.agent_name.trim().replace(/\s+/g, " ");
    const normalizedName = normalizeAgentName(name);
    if (normalizedNames.has(normalizedName)) {
      throw new V1ServiceError(`Duplicate agent allocation for "${name}"`, 400);
    }
    normalizedNames.add(normalizedName);

    const agent = await resolveAgentByName(name, options);
    resolved.push({
      agent: toObjectId(agent.id),
      agent_name_snapshot: agent.name,
      binder_amount: allocation.binder_amount,
    });
  }

  return resolved;
}

/**
 * Merges incoming allocations onto the existing list by agent id.
 *
 * Used by the booking update flow when `agent_allocation_mode` is `patch`:
 * existing entries for agents not present in the incoming list survive,
 * matching entries are replaced wholesale, and brand-new agents are appended.
 */
export function patchAgentAllocations(
  existingAllocations: AgentAllocationDocumentInput[],
  incomingAllocations: AgentAllocationDocumentInput[],
): AgentAllocationDocumentInput[] {
  const byAgentId = new Map(
    existingAllocations.map((allocation) => [allocation.agent.toString(), allocation]),
  );

  for (const allocation of incomingAllocations) {
    byAgentId.set(allocation.agent.toString(), allocation);
  }

  return [...byAgentId.values()];
}

/**
 * Computes the booked lead's `total_binder_amount` from its allocation list
 * and validates it against an optional submitted total.
 *
 * Throws a 400 `V1ServiceError` when the submitted total disagrees with the
 * allocation sum by more than 0.001 (floating-point tolerance).
 */
export function resolveTotalBinderAmount(
  allocations: Pick<AgentAllocationDocumentInput, "binder_amount">[],
  submittedTotal?: number,
): number {
  const allocationTotal = allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  if (submittedTotal !== undefined && Math.abs(allocationTotal - submittedTotal) >= 0.001) {
    throw new V1ServiceError("total_binder_amount must equal the sum of agent binder amounts", 400);
  }

  return submittedTotal ?? allocationTotal;
}

/**
 * Returns the snapshot name of the booking's primary agent, used by the
 * cancellation flow to populate `CancelledLead.agent`.
 *
 * Falls back to an empty string when the booking somehow has no allocations
 * (defensive; the `BookedLead` schema requires a non-empty list).
 */
export function primaryAgentName(
  booking: Pick<BookedLeadDocument, "agent_allocations">,
): string {
  return booking.agent_allocations?.[0]?.agent_name_snapshot ?? "";
}
