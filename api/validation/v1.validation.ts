/**
 * v1 validation compatibility barrel.
 *
 * The domain-specific schemas, refinements, and inferred types now live in
 * `api/validation/v1/`, organized to mirror the service folders:
 *
 *   - `v1/common.ts`            -> shared scalar zod schemas and the generic
 *                                  `requireAtLeastOne` refinement
 *   - `v1/leads.validation.ts`  -> services/leads + services/search
 *   - `v1/bookings.validation.ts` -> services/bookings + services/agents
 *   - `v1/cancellations.validation.ts` -> services/cancellations
 *   - `v1/customers.validation.ts` -> services/customers
 *   - `v1/operations.validation.ts` -> services/enrichment + services/reconciliation
 *
 * This file is intentionally kept as a pure re-export so that routes and
 * services can continue to import every schema and inferred input type from
 * `../validation/v1.validation` without churn. Do not add new logic here;
 * add it to the appropriate `v1/*.validation.ts` module instead.
 */

export {
  objectIdSchema,
  sourceCompanySchema,
  localSchema,
  leadModelSchema,
  moveSizeSchema,
} from "./v1/common";

export {
  createFormLeadSchema,
  updateFormLeadSchema,
  searchFormLeadsSchema,
  createCallLeadSchema,
  updateCallLeadSchema,
  searchCallLeadsSchema,
  type CreateFormLeadInput,
  type UpdateFormLeadInput,
  type SearchFormLeadsInput,
  type CreateCallLeadInput,
  type UpdateCallLeadInput,
  type SearchCallLeadsInput,
} from "./v1/leads.validation";

export {
  createBookedLeadSchema,
  createBookedLeadFromSourceSchema,
  updateBookedLeadSchema,
  type CreateBookedLeadInput,
  type CreateBookedLeadFromSourceInput,
  type UpdateBookedLeadInput,
} from "./v1/bookings.validation";

export {
  createCancelledLeadSchema,
  updateCancelledLeadSchema,
  type CreateCancelledLeadInput,
  type UpdateCancelledLeadInput,
} from "./v1/cancellations.validation";

export {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "./v1/customers.validation";

export {
  callLeadEnrichmentBatchSchema,
  bookedCallLeadReconciliationBatchSchema,
  type CallLeadEnrichmentBatchInput,
  type CallLeadEnrichmentRowInput,
  type BookedCallLeadReconciliationBatchInput,
  type BookedCallLeadReconciliationRowInput,
} from "./v1/operations.validation";
