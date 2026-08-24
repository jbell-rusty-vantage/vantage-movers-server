/**
 * Public barrel for the agents service folder.
 *
 * Booking creation, booking update, cancellation, and any future
 * agent-allocation-aware code import allocation helpers from here so
 * `v1.service.ts` no longer owns this subdomain.
 */

export { normalizeAgentName } from "./agentName";

export {
  deriveBookedLeadAgentAllocations,
  officialBookingAgentIds,
  officialBookingAllocations,
  patchAgentAllocations,
  primaryAgentName,
  receiverAttributionFromPrimaryAllocation,
  resolveAgentAllocations,
  resolveTotalBinderAmount,
  splitBinderEvenly,
  type AgentAllocationDocumentInput,
  type AgentAllocationInput,
} from "./agentAllocation.service";
