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
  browseFormLeadsQuerySchema,
  browseCallLeadsQuerySchema,
  createCallLeadSchema,
  updateCallLeadSchema,
  searchCallLeadsSchema,
  type CreateFormLeadInput,
  type UpdateFormLeadInput,
  type SearchFormLeadsInput,
  type BrowseFormLeadsQuery,
  type BrowseCallLeadsQuery,
  type CreateCallLeadInput,
  type UpdateCallLeadInput,
  type SearchCallLeadsInput,
} from "./v1/leads.validation";

export {
  createBookedLeadSchema,
  createBookedLeadFromSourceSchema,
  createReferralBookingSchema,
  createLeadlessBookingSchema,
  updateBookedLeadSchema,
  type CreateBookedLeadInput,
  type CreateBookedLeadFromSourceInput,
  type CreateReferralBookingInput,
  type CreateLeadlessBookingInput,
  type UpdateBookedLeadInput,
} from "./v1/bookings.validation";

export {
  bookingLeadCandidateSearchSchema,
  bookingLeadReconciliationListQuerySchema,
  createEmployeeBookingSubmissionSchema,
  createReconciliationCallLeadSchema,
  createReconciliationFormLeadSchema,
  refreshBookingLeadCandidatesSchema,
  reopenBookingLeadReconciliationSchema,
  resolveBookingLeadReconciliationSchema,
  updatePendingEmployeeBookingSchema,
  type BookingLeadCandidateSearchInput,
  type BookingLeadReconciliationListQuery,
  type CreateEmployeeBookingSubmissionInput,
  type CreateReconciliationCallLeadInput,
  type CreateReconciliationFormLeadInput,
  type RefreshBookingLeadCandidatesInput,
  type ReopenBookingLeadReconciliationInput,
  type ResolveBookingLeadReconciliationInput,
  type UpdatePendingEmployeeBookingInput,
} from "./v1/employeeBookings.validation";

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

export {
  adminBrowseQuerySchema,
  catalogCreateSchema,
  catalogListQuerySchema,
  catalogUpdateSchema,
  cplRateUpdateSchema,
  leadSourceCompanyCreateSchema,
  leadSourceCompanyUpdateSchema,
  adminDatabaseScopeSchema,
  adminSearchQuerySchema,
  type AdminBrowseQuery,
  type AdminDatabaseScope,
  type AdminSearchQuery,
  type CatalogCreateInput,
  type CatalogListQuery,
  type CatalogUpdateInput,
  type CplRateUpdateInput,
  type LeadSourceCompanyCreateInput,
  type LeadSourceCompanyUpdateInput,
} from "./v1/admin.validation";

export {
  analyticsQuerySchema,
  analyticsReportSchema,
  agentSalesReportQuerySchema,
  overviewQuerySchema,
  type AnalyticsQuery,
  type AnalyticsReport,
  type AgentSalesReportQuery,
  type OverviewQuery,
} from "./v1/analytics.validation";

export {
  sheetSyncJobsQuerySchema,
  sheetSyncRunsQuerySchema,
  sheetSyncRetrySchema,
  type SheetSyncJobsQuery,
  type SheetSyncRunsQuery,
  type SheetSyncRetryInput,
} from "./v1/sheetSync.validation";

export {
  adminTestimonialsQuerySchema,
  listTestimonialsQuerySchema,
  type AdminTestimonialsQuery,
  type ListTestimonialsQuery,
} from "./v1/testimonials.validation";

export {
  listMovingCarriersQuerySchema,
  movingCarrierCreateSchema,
  movingCarrierImportSchema,
  movingCarrierUpdateSchema,
  type ListMovingCarriersQuery,
  type MovingCarrierCreateInput,
  type MovingCarrierImportInput,
  type MovingCarrierUpdateInput,
} from "./v1/movingCarriers.validation";

export {
  listGranotCrmSourcesQuerySchema,
  uploadGranotCrmCsvSchema,
  type ListGranotCrmSourcesQuery,
  type UploadGranotCrmCsvInput,
} from "./v1/granotCsv.validation";

export {
  observabilityOverviewQuerySchema,
  observabilityFacetsQuerySchema,
  observabilityEventsQuerySchema,
  observabilityIncidentsQuerySchema,
  observabilityNotificationsQuerySchema,
  observabilityIncidentStatusSchema,
  observabilityIncidentBatchStatusSchema,
  observabilityDeleteCollectionSchema,
  observabilityBatchDeleteSchema,
  observabilityReportsQuerySchema,
  observabilityReportRunSchema,
  type ObservabilityOverviewQuery,
  type ObservabilityFacetsQuery,
  type ObservabilityEventsQuery,
  type ObservabilityIncidentsQuery,
  type ObservabilityNotificationsQuery,
  type ObservabilityIncidentStatusInput,
  type ObservabilityIncidentBatchStatusInput,
  type ObservabilityDeleteCollection,
  type ObservabilityBatchDeleteInput,
  type ObservabilityReportsQuery,
  type ObservabilityReportRunInput,
} from "./v1/observability.validation";

export {
  leadMessagesQuerySchema,
  leadMessageRetrySchema,
  type LeadMessagesQuery,
} from "./v1/leadMessaging.validation";
