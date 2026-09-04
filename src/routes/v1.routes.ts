import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { ZodError, type ZodType } from "zod";
import { connectMongo } from "../db";
import { withRuntimeDomainOverrides } from "../config/domain";
import { shouldCaptureHttp5xx } from "../config/domain/observability";
import { logger as rootLogger } from "../logger";
import { requireApiSecret } from "../middleware/requireApiSecret";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import extensionAuthRoutes from "./extension-auth.routes";
import googleDriveOAuthRoutes from "./google-drive-oauth.routes";
import ringCentralRegistryRoutes from "./ringcentral-registry.routes";
import granotLifecycleAdminRoutes from "./granot-lifecycle-admin.routes";
import jobNumberTimelineAdminRoutes from "./job-number-timeline-admin.routes";
import conversationsAdminRoutes from "./conversations-admin.routes";
import extensionUsersAdminRoutes from "./extension-users-admin.routes";
import { createExtensionGranotApplyRouter } from "./extension-granot-apply.routes";
import { createTariffAdjustmentsRouter } from "./tariff-adjustments.routes";
import {
  recordOperationalEvent,
  getObservabilityOverview,
  getObservabilityFacets,
  listOperationalEvents,
  getOperationalEventDetail,
  listOperationalIncidents,
  getOperationalIncidentDetail,
  updateOperationalIncidentStatus,
  updateOperationalIncidentStatuses,
  deleteObservabilityRecord,
  deleteObservabilityRecords,
  listNotificationDeliveries,
  exportOperationalEventsCsv,
  exportOperationalIncidentsCsv,
  runOperationalReport,
  listOperationalReportRuns,
  getOperationalReportRunDetail,
  exportReportRunCsv,
} from "../services/observability";
import { searchFormLeads } from "../services/formLeadSearch.service";
import {
  resolveGranotFormLead,
  type GranotFormLeadLike,
} from "../services/granotHttpCollector/granotFormLeadMatcher";
import { searchCallLeads } from "../services/callLeadSearch.service";
import { browseCallLeads, browseFormLeads } from "../services/search";
import { previewCallLeadEnrichment } from "../services/callLeadEnrichment.service";
import { previewBookedCallLeadReconciliation } from "../services/bookedCallLeadReconciliation.service";
import { checkGoogleMapsGeocodingHealth } from "../services/googleMaps/geocoding";
import { sanitizeFormLeadBodyPreview } from "../utils/logging/sanitizeFormLeadForLog";
import {
  createCustomer,
  deleteCustomer,
  findFormLeadForEnrichment,
  findAllBookedLeads,
  findAllCancelledLeads,
  findAllCustomers,
  updateCustomer,
  V1ServiceError,
} from "../services/v1.service";
import {
  existingWriteContextFromRequest,
  runExistingCreateBookedLeadFromSource,
  runExistingCreateBookingFromLead,
  runExistingCreateCallLead,
  runExistingCreateCancellation,
  runExistingCreateFormLead,
  runExistingCreateLeadlessBooking,
  runExistingCreateReferralBooking,
  runExistingDeleteBookedLead,
  runExistingDeleteCallLead,
  runExistingDeleteCancelledLead,
  runExistingDeleteFormLead,
  runExistingUpdateBookedLead,
  runExistingUpdateCancelledLead,
  runExistingUpdateSourceOwnedLead,
} from "../services/domainCommands";
import {
  getBookingLeadReconciliationCase,
  getEmployeeBookingOptions,
  listBookingLeadReconciliationCases,
  refreshBookingLeadCandidates,
  reopenBookingLeadReconciliation,
  resolveBookingLeadReconciliation,
  searchBookingLeadCandidates,
  submitEmployeeBooking,
  updatePendingEmployeeBooking,
} from "../services/employeeBookings";
import { deriveTrustedOwnerActor } from "../services/employeeBookings/reconciliationPolicy";
import { AppError } from "../services/errors";
import {
  getRegistryOverview,
  getRegistryHealth,
  listRegistryChanges,
  listLeadSourceProjections,
  getLeadSourceProjection,
  createLeadSourceSetup,
  previewLeadSourceSetup,
  requireRegistryReadActor,
  requireRegistryOwnerActor,
  isRegistryError,
  previewRegistryDependency,
  setAgentActivation,
  setMerchantActivation,
  createOrUpdateSourceCompany,
  createOrUpdateSourceGranularity,
  createOrUpdateGranotCrmSource,
  createGranotNameFromOwnerIntent,
  listRecentGranotCrmSourceSms,
  setGranotCrmSourceOutboundSms,
  getProjectedGranotCrmSource,
  getSourceCompany,
  getSourceCompanyBySlug,
  getSourceGranularity,
  listProjectedGranotCrmSources,
  listSourceCompanies,
  listSourceGranularities,
  setGranotCrmSourceLifecycleEnabled,
  applySimpleCplSchedule,
  listCplSchedule,
  mutateAdvancedCplSchedule,
  previewCplCorrection,
  createCplCorrection,
  getCplCorrectionJob,
  cancelCplCorrectionJob,
  createDefaultCplCorrectionDependencies,
  previewSourceDependency,
  previewSourceResolution,
  previewLabelResolution,
  createLabelMapping,
  listLabelMappings,
  setLabelMappingActivation,
  setSourceCompanyActivation,
  setSourceGranularityActivation,
  type RegistryCatalogItem,
  type SourceCompanyCommand,
  type AdvancedCplOperation,
} from "../services/operationsRegistry";
import {
  bookingLeadCandidateSearchSchema,
  bookingLeadReconciliationListQuerySchema,
  createBookedLeadFromSourceSchema,
  createBookedLeadSchema,
  createCallLeadSchema,
  createCancelledLeadSchema,
  createCustomerSchema,
  createEmployeeBookingSubmissionSchema,
  createFormLeadSchema,
  createReferralBookingSchema,
  createLeadlessBookingSchema,
  analyticsQuerySchema,
  analyticsReportSchema,
  agentSalesReportQuerySchema,
  overviewQuerySchema,
  adminBrowseQuerySchema,
  adminSearchQuerySchema,
  catalogCreateSchema,
  catalogListQuerySchema,
  catalogUpdateSchema,
  catalogActivationSchema,
  leadSourceCompanyCreateSchema,
  leadSourceCompanyUpdateSchema,
  sourceGranularityListQuerySchema,
  sourceGranularityCreateSchema,
  sourceGranularityUpdateSchema,
  sourceActivationSchema,
  sourceResolutionPreviewSchema,
  sourceLabelMappingCreateSchema,
  sourceLabelMappingActivationSchema,
  sourceLabelMappingListQuerySchema,
  sourceLabelResolutionPreviewSchema,
  granotCrmSourceRegistryUpdateSchema,
  granotCrmSourceLifecycleActivationSchema,
  granotCrmSourceOutboundSmsSchema,
  granotCrmSourceOutboundSmsRecentQuerySchema,
  ownerGranotNameCreateSchema,
  leadSourceSetupCommandSchema,
  leadSourceListQuerySchema,
  leadSourceDetailQuerySchema,
  listMovingCarriersQuerySchema,
  movingCarrierCreateSchema,
  movingCarrierImportSchema,
  movingCarrierUpdateSchema,
  listGranotCrmSourcesQuerySchema,
  sheetSyncJobsQuerySchema,
  sheetSyncRunsQuerySchema,
  sheetSyncRetrySchema,
  sheetContainsSchema,
  adminTestimonialsQuerySchema,
  listTestimonialsQuerySchema,
  bookedCallLeadReconciliationBatchSchema,
  browseCallLeadsQuerySchema,
  browseFormLeadsQuerySchema,
  callLeadEnrichmentBatchSchema,
  refreshBookingLeadCandidatesSchema,
  reopenBookingLeadReconciliationSchema,
  resolveBookingLeadReconciliationSchema,
  searchCallLeadsSchema,
  searchFormLeadsSchema,
  resolveGranotFormLeadSchema,
  uploadGranotCrmCsvSchema,
  updatePendingEmployeeBookingSchema,
  updateBookedLeadSchema,
  updateCallLeadSchema,
  updateCancelledLeadSchema,
  updateCustomerSchema,
  updateFormLeadSchema,
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
  leadMessagesQuerySchema,
  leadMessageRetrySchema,
  registryChangesQuerySchema,
  registryOverviewQuerySchema,
  registryHealthQuerySchema,
  cplSnapshotQuerySchema,
  simpleCplScheduleSchema,
  advancedCplScheduleCommandSchema,
  cplCorrectionPreviewSchema,
  createCplCorrectionSchema,
  cancelCplCorrectionSchema,
  type LeadSourceCompanyCreateInput,
  type LeadSourceCompanyUpdateInput,
} from "../validation/v1.validation";
import {
  browseAdminResource,
  checkSheetContains,
  exportAdminResourceCsv,
  getAdminFacets,
  getAdminResourceDetail,
  getSheetSyncHealth,
  getSheetSyncRunDetail,
  globalAdminSearch,
  listSheetSyncJobs,
  listSheetSyncRuns,
  retrySheetSyncJobs,
  type AdminResource,
} from "../services/admin";
import {
  createCatalogItem,
  getCatalogItem,
  listCatalogItems,
  updateCatalogItem,
  type CatalogItem,
  type CatalogKind,
} from "../services/catalog";
import { listCplRates } from "../services/cpl/cplRate.service";
import {
  exportAgentSalesReportCsv,
  exportAnalyticsReportCsv,
  getAgentSalesReport,
  getAnalyticsReport,
  getOverviewReport,
} from "../services/analytics";
import {
  getAdminTestimonial,
  listAdminTestimonialReviewerNames,
  listAdminTestimonials,
  listTestimonials,
} from "../services/testimonials";
import {
  createMovingCarrier,
  importMovingCarriersFromCsv,
  listMovingCarriers,
  updateMovingCarrier,
} from "../services/movingCarriers";
import {
  listGranotCrmSources,
  seedGranotCrmSources,
  uploadGranotCrmCsv,
} from "../services/granotCrmCsv";
import {
  getLeadMessage,
  listLeadMessages,
  requestLeadMessageRetry,
} from "../services/leadMessaging";

const router = Router();

router.use(extensionAuthRoutes);
router.use(googleDriveOAuthRoutes);
router.use("/api/v1", requireApiSecret);
router.use(ringCentralRegistryRoutes);
router.use(granotLifecycleAdminRoutes);
router.use(jobNumberTimelineAdminRoutes);
router.use(conversationsAdminRoutes);
router.use(extensionUsersAdminRoutes);

type RequestWithLogger = Request & {
  log?: Logger;
  id?: string | number | object;
  originalUrl?: string;
  url?: string;
  path?: string;
};

const adminResources = [
  "form-leads",
  "call-leads",
  "booked-leads",
  "cancelled-leads",
  "customers",
  "agents",
] as const satisfies readonly AdminResource[];

const analyticsReports = [
  "summary",
  "revenue-trend",
  "source-company-performance",
  "agent-performance",
  "booking-cancellation-ratio",
  "source-company-funnel",
  "cancellation-reasons",
  "lead-source-performance",
  "local-vs-long-distance",
  "geographic-lanes",
  "pickup-state-performance",
  "delivery-state-performance",
  "receiver-agent-performance",
  "receiver-agent-trend",
  "receiver-agent-source-breakdown",
  "sms-successfully-sent-then-booked",
] as const;

router.get("/api/v1/admin/search", handleAdminSearch);
router.get("/api/v1/admin/facets", handleAdminFacets);
router.get("/api/v1/admin/catalog/agents", handleCatalogList("agents"));
router.get("/api/v1/admin/catalog/merchants", handleCatalogList("merchants"));
// GET /api/v1/admin/agents and /:id are browse/detail (metrics). Do not
// register catalog list/detail on those paths — Express first-match would
// hide handleAdminBrowse and the Agents table would omit booking metrics.
router.post("/api/v1/admin/agents", handleCatalogCreate("agents"));
router.patch("/api/v1/admin/agents/:id", handleCatalogUpdate("agents"));
router.post("/api/v1/admin/agents/:id/activation", handleCatalogActivation("agents"));
router.get("/api/v1/admin/agents/:id/dependencies", handleCatalogDependencies("agents"));
router.get("/api/v1/admin/merchants", handleCatalogList("merchants"));
router.get("/api/v1/admin/merchants/:id", handleCatalogDetail("merchants"));
router.post("/api/v1/admin/merchants", handleCatalogCreate("merchants"));
router.patch("/api/v1/admin/merchants/:id", handleCatalogUpdate("merchants"));
router.post(
  "/api/v1/admin/merchants/:id/activation",
  handleCatalogActivation("merchants"),
);
router.get(
  "/api/v1/admin/merchants/:id/dependencies",
  handleCatalogDependencies("merchants"),
);
router.get("/api/v1/admin/cpl-rates", handleCplRatesList);
router.get("/api/v1/admin/source-companies", handleLeadSourceCompaniesList);
router.get("/api/v1/admin/source-companies/:id", handleLeadSourceCompanyDetail);
router.post("/api/v1/admin/source-companies", handleLeadSourceCompanyCreate);
router.patch(
  "/api/v1/admin/source-companies/:id",
  handleLeadSourceCompanyUpdate,
);
router.post(
  "/api/v1/admin/source-companies/:id/activation",
  handleSourceCompanyActivation,
);
router.get(
  "/api/v1/admin/source-companies/:id/dependencies",
  handleSourceCompanyDependencies,
);
router.get("/api/v1/admin/source-granularities", handleSourceGranularitiesList);
router.get(
  "/api/v1/admin/source-granularities/:id",
  handleSourceGranularityDetail,
);
router.post("/api/v1/admin/source-granularities", handleSourceGranularityCreate);
router.patch(
  "/api/v1/admin/source-granularities/:id",
  handleSourceGranularityUpdate,
);
router.post(
  "/api/v1/admin/source-granularities/:id/activation",
  handleSourceGranularityActivation,
);
router.get(
  "/api/v1/admin/source-granularities/:id/dependencies",
  handleSourceGranularityDependencies,
);
router.get("/api/v1/admin/granot-crm-sources", handleGranotCrmSourcesList);
router.post("/api/v1/admin/granot-crm-sources", handleGranotCrmSourceCreate);
router.get("/api/v1/admin/granot-crm-sources/:id", handleGranotCrmSourceDetail);
router.patch("/api/v1/admin/granot-crm-sources/:id", handleGranotCrmSourceUpdate);
router.patch(
  "/api/v1/admin/granot-crm-sources/:id/activation",
  handleGranotCrmSourceActivation,
);
router.patch(
  "/api/v1/admin/granot-crm-sources/:id/outbound-sms",
  handleGranotCrmSourceOutboundSms,
);
router.get(
  "/api/v1/admin/granot-crm-sources/:id/outbound-sms/recent",
  handleGranotCrmSourceOutboundSmsRecent,
);
router.post(
  "/api/v1/admin/source-resolution/preview",
  handleSourceResolutionPreview,
);
router.post(
  "/api/v1/admin/source-label-mappings",
  handleSourceLabelMappingCreate,
);
router.patch(
  "/api/v1/admin/source-label-mappings/:id/activation",
  handleSourceLabelMappingActivation,
);
router.get(
  "/api/v1/admin/source-label-mappings",
  handleSourceLabelMappingsList,
);
router.post(
  "/api/v1/admin/source-label-resolution/preview",
  handleSourceLabelResolutionPreview,
);
router.get("/api/v1/admin/cpl/snapshot", handleCplSnapshot);
router.post("/api/v1/admin/cpl/simple-schedule", handleSimpleCplSchedule);
router.get(
  "/api/v1/admin/source-granularities/:id/cpl-periods",
  handleCplPeriods,
);
router.post(
  "/api/v1/admin/source-granularities/:id/cpl-schedule/commands",
  handleAdvancedCplScheduleCommand,
);
router.post(
  "/api/v1/admin/cpl-corrections/preview",
  handleCplCorrectionPreview,
);
router.post("/api/v1/admin/cpl-corrections", handleCplCorrectionCreate);
router.get("/api/v1/admin/cpl-corrections/:id", handleCplCorrectionDetail);
router.post(
  "/api/v1/admin/cpl-corrections/:id/cancel",
  handleCplCorrectionCancel,
);
router.get("/api/v1/admin/testimonials", handleAdminTestimonialsList);
router.get(
  "/api/v1/admin/testimonials/reviewer-names",
  handleAdminTestimonialReviewerNames,
);
router.get("/api/v1/admin/testimonials/:id", handleAdminTestimonialDetail);
router.get("/api/v1/admin/moving-carriers", handleMovingCarriersList);
router.post("/api/v1/admin/moving-carriers", handleMovingCarrierCreate);
router.post("/api/v1/admin/moving-carriers/import", handleMovingCarrierImport);
router.patch("/api/v1/admin/moving-carriers/:id", handleMovingCarrierUpdate);
for (const resource of adminResources) {
  router.get(`/api/v1/admin/${resource}`, handleAdminBrowse(resource));
  router.get(`/api/v1/admin/${resource}/:id`, handleAdminDetail(resource));
  router.get(
    `/api/v1/admin/exports/${resource}.csv`,
    handleAdminExport(resource),
  );
}
for (const report of analyticsReports) {
  router.get(
    `/api/v1/admin/analytics/${report}`,
    handleAnalyticsReport(report),
  );
}
router.get("/api/v1/admin/analytics/overview", handleOverviewReport());
router.get(
  "/api/v1/admin/exports/analytics/:report.csv",
  handleAnalyticsExport,
);
router.get("/api/v1/admin/reports/agent-sales", handleAgentSalesReport);
router.get(
  "/api/v1/admin/exports/reports/agent-sales.csv",
  handleAgentSalesReportExport,
);

router.get("/api/v1/admin/sheet-sync/health", handleSheetSyncHealth);
router.get(
  "/api/v1/admin/google-maps/geocoding-health",
  handleGoogleMapsGeocodingHealth,
);
router.get("/api/v1/admin/sheet-sync/jobs", handleSheetSyncJobs);
router.get("/api/v1/admin/sheet-sync/runs", handleSheetSyncRuns);
router.get("/api/v1/admin/sheet-sync/runs/:id", handleSheetSyncRunDetail);
router.post("/api/v1/admin/sheet-sync/retry", handleSheetSyncRetry);
router.post("/api/v1/admin/sheet-sync/contains", handleSheetContains);
router.get(
  "/api/v1/admin/booking-lead-reconciliations",
  handleBookingLeadReconciliationsList,
);
router.get(
  "/api/v1/admin/booking-lead-reconciliations/:id",
  handleBookingLeadReconciliationDetail,
);
router.post(
  "/api/v1/admin/booking-lead-reconciliations/:id/candidates/search",
  handleBookingLeadCandidateSearch,
);
router.post(
  "/api/v1/admin/booking-lead-reconciliations/:id/candidates/refresh",
  handleBookingLeadCandidateRefresh,
);
router.patch(
  "/api/v1/admin/booking-lead-reconciliations/:id/booking",
  handlePendingEmployeeBookingUpdate,
);
router.post(
  "/api/v1/admin/booking-lead-reconciliations/:id/resolve",
  handleBookingLeadReconciliationResolve,
);
router.post(
  "/api/v1/admin/booking-lead-reconciliations/:id/reopen",
  handleBookingLeadReconciliationReopen,
);
router.get("/api/v1/admin/lead-messages", handleLeadMessagesList);
router.get("/api/v1/admin/lead-messages/:id", handleLeadMessageDetail);
router.post("/api/v1/admin/lead-messages/:id/retry", handleLeadMessageRetry);

router.get(
  "/api/v1/admin/operations-registry/overview",
  handleOperationsRegistryOverview,
);
router.get(
  "/api/v1/admin/operations-registry/lead-sources",
  handleLeadSourceProjectionList,
);
router.get(
  "/api/v1/admin/operations-registry/lead-sources/:id",
  handleLeadSourceProjectionDetail,
);
router.post(
  "/api/v1/admin/operations-registry/lead-source-setups/preview",
  handleLeadSourceSetupPreview,
);
router.post(
  "/api/v1/admin/operations-registry/lead-source-setups",
  handleLeadSourceSetupCreate,
);
router.get(
  "/api/v1/admin/operations-registry/health",
  handleOperationsRegistryHealth,
);
router.get(
  "/api/v1/admin/operations-registry/changes",
  handleOperationsRegistryChanges,
);

router.get("/api/v1/admin/observability/overview", handleObservabilityOverview);
router.get("/api/v1/admin/observability/facets", handleObservabilityFacets);
router.get("/api/v1/admin/observability/events", handleObservabilityEvents);
router.get(
  "/api/v1/admin/observability/events/:id",
  handleObservabilityEventDetail,
);
router.get(
  "/api/v1/admin/observability/incidents",
  handleObservabilityIncidents,
);
router.patch(
  "/api/v1/admin/observability/incidents/status",
  handleObservabilityIncidentBatchStatus,
);
router.get(
  "/api/v1/admin/observability/incidents/:id",
  handleObservabilityIncidentDetail,
);
router.patch(
  "/api/v1/admin/observability/incidents/:id/status",
  handleObservabilityIncidentStatus,
);
router.get(
  "/api/v1/admin/observability/notifications",
  handleObservabilityNotifications,
);
router.get("/api/v1/admin/observability/reports", handleObservabilityReports);
router.post(
  "/api/v1/admin/observability/reports/run",
  handleObservabilityReportRun,
);
router.get(
  "/api/v1/admin/observability/reports/:id",
  handleObservabilityReportDetail,
);
router.post(
  "/api/v1/admin/observability/:collection/delete",
  handleObservabilityBatchDelete,
);
router.delete(
  "/api/v1/admin/observability/:collection/:id",
  handleObservabilityRecordDelete,
);
router.get(
  "/api/v1/admin/exports/observability/events.csv",
  handleObservabilityEventsExport,
);
router.get(
  "/api/v1/admin/exports/observability/incidents.csv",
  handleObservabilityIncidentsExport,
);
router.get(
  "/api/v1/admin/exports/observability/reports/:id.csv",
  handleObservabilityReportExport,
);

router.get("/api/v1/granot-crm/csv/sources", handleGranotCrmCsvSources);
router.post("/api/v1/granot-crm/csv/uploads", handleGranotCrmCsvUpload);

router.get("/api/v1/form-leads", handleBrowseFormLeads);
router.post("/api/v1/form-leads/granot-match", handleResolveGranotFormLead);
router.get("/api/v1/form-leads/:id", handleFindOne(findFormLeadForEnrichment));
router.post("/api/v1/form-leads/search", handleSearchFormLeads);
router.post("/api/v1/create-form-test", handleCreateFormLeadTest);
router.post("/api/v1/form-leads", handleCreateFormLead);
router.use(createTariffAdjustmentsRouter());
router.use(createExtensionGranotApplyRouter());
router.patch("/api/v1/form-leads/:id", handleUpdateFormLead);
router.delete(
  "/api/v1/form-leads/:id",
  handleCanonicalDelete("deleteFormLead", (id, cascade, context) =>
    runExistingDeleteFormLead({ lead_id: id, cascade, context }),
  ),
);

router.get("/api/v1/call-leads", handleBrowseCallLeads);
router.post("/api/v1/call-leads/search", handleSearchCallLeads);
router.post(
  "/api/v1/call-leads/enrichment/preview",
  handleCallLeadEnrichmentPreview,
);
router.post(
  "/api/v1/call-leads/booked-reconciliation/preview",
  handleBookedCallLeadReconciliationPreview,
);
router.post(
  "/api/v1/call-leads",
  handleCanonicalCreate(
    createCallLeadSchema,
    "createCallLead",
    async (data, context) => (await runExistingCreateCallLead({ data, context })).data,
  ),
);
router.patch(
  "/api/v1/call-leads/:id",
  handleCanonicalUpdate(
    updateCallLeadSchema,
    "updateSourceOwnedLead",
    async (id, patch, context) =>
      (
        await runExistingUpdateSourceOwnedLead({
          lead_model: "CallLead",
          lead_id: id,
          patch,
          context,
        })
      ).data,
  ),
);
router.delete(
  "/api/v1/call-leads/:id",
  handleCanonicalDelete("deleteCallLead", (id, cascade, context) =>
    runExistingDeleteCallLead({ lead_id: id, cascade, context }),
  ),
);

router.get("/api/v1/booked-leads", handleFindAll(findAllBookedLeads));
router.post(
  "/api/v1/booked-leads",
  handleCanonicalCreate(
    createBookedLeadSchema,
    "createBookingFromLead",
    async (data, context) =>
      (await runExistingCreateBookingFromLead({ data, context })).data,
  ),
);
router.post(
  "/api/v1/booked-leads/from-source",
  handleCanonicalCreate(
    createBookedLeadFromSourceSchema,
    "createBookingFromLead",
    async (data, context) =>
      (await runExistingCreateBookedLeadFromSource({ data, context })).data,
  ),
);
router.post(
  "/api/v1/referral-bookings",
  handleCanonicalCreate(
    createReferralBookingSchema,
    "createExistingReferralBooking",
    async (data, context) =>
      (await runExistingCreateReferralBooking({ data, context })).data,
  ),
);
router.post(
  "/api/v1/leadless-bookings",
  handleCanonicalCreate(
    createLeadlessBookingSchema,
    "createLeadlessBooking",
    async (data, context) =>
      (await runExistingCreateLeadlessBooking({ data, context })).data,
  ),
);
router.get(
  "/api/v1/employee-booking-options",
  handleEmployeeBookingOptions,
);
router.post(
  "/api/v1/employee-booking-submissions",
  handleEmployeeBookingSubmission,
);
router.patch(
  "/api/v1/booked-leads/:id",
  handleCanonicalUpdate(
    updateBookedLeadSchema,
    "updateBookedLead",
    async (id, patch, context) =>
      (await runExistingUpdateBookedLead({ booking_id: id, patch, context })).data,
  ),
);
router.delete(
  "/api/v1/booked-leads/:id",
  handleCanonicalDelete("deleteBookedLead", (id, cascade, context) =>
    runExistingDeleteBookedLead({ booking_id: id, cascade, context }),
  ),
);

router.get("/api/v1/cancelled-leads", handleFindAll(findAllCancelledLeads));
router.post(
  "/api/v1/cancelled-leads",
  handleCanonicalCreate(
    createCancelledLeadSchema,
    "createCancellation",
    async (data, context) =>
      (await runExistingCreateCancellation({ data, context })).data,
  ),
);
router.patch(
  "/api/v1/cancelled-leads/:id",
  handleCanonicalUpdate(
    updateCancelledLeadSchema,
    "updateCancelledLead",
    async (id, patch, context) =>
      (
        await runExistingUpdateCancelledLead({
          cancellation_id: id,
          patch,
          context,
        })
      ).data,
  ),
);
router.delete(
  "/api/v1/cancelled-leads/:id",
  handleCanonicalDelete("deleteCancelledLead", (id, _cascade, context) =>
    runExistingDeleteCancelledLead({ cancellation_id: id, context }),
  ),
);

router.get("/api/v1/customers", handleFindAll(findAllCustomers));
router.post(
  "/api/v1/customers",
  handleCreate(createCustomerSchema, createCustomer),
);
router.patch(
  "/api/v1/customers/:id",
  handleUpdate(updateCustomerSchema, updateCustomer),
);
router.delete("/api/v1/customers/:id", handleDelete(deleteCustomer));

router.get("/api/v1/testimonials", handleListTestimonials);
router.get("/api/v1/moving-carriers", handleMovingCarriersList);

function handleFindAll(findAll: () => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const data = await findAll();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleAdminBrowse(resource: AdminResource) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = adminBrowseQuerySchema.parse(req.query);
      const data = await browseAdminResource(resource, parsed);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleAdminDetail(resource: AdminResource) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const parsed = adminBrowseQuerySchema.parse(req.query);
      const data = await getAdminResourceDetail(
        resource,
        id,
        parsed.database_scope,
        parsed,
      );
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

async function handleAdminSearch(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = adminSearchQuerySchema.parse(req.query);
    const data = await globalAdminSearch(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAdminFacets(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = adminBrowseQuerySchema
      .pick({ database_scope: true })
      .parse(req.query);
    const data = await getAdminFacets(parsed.database_scope);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function handleCatalogList(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      requireRegistryReadActor(req, getVantageAuth(req));
      const parsed = catalogListQuerySchema.parse(req.query);
      const items = await listCatalogItems(kind, {
        includeInactive: parsed.include_inactive === true,
      });
      return res.json({ ok: true, data: { items } });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCatalogDetail(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      requireRegistryReadActor(req, getVantageAuth(req));
      const data = await getCatalogItem(kind, id);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCatalogCreate(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
      const parsed = catalogCreateSchema.parse(req.body);
      const data = await createCatalogItem(kind, parsed, actor);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCatalogUpdate(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
      const parsed = catalogUpdateSchema.parse(req.body);
      const data = await updateCatalogItem(kind, id, parsed, actor);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCatalogActivation(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
      const parsed = catalogActivationSchema.parse(req.body);
      const command = { id, active: parsed.active, reason: parsed.reason };
      const item =
        kind === "agents"
          ? await setAgentActivation(command, actor)
          : await setMerchantActivation(command, actor);
      return res.json({ ok: true, data: toLegacyCatalogResponse(item) });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCatalogDependencies(kind: CatalogKind) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      requireRegistryReadActor(req, getVantageAuth(req));
      const data = await previewRegistryDependency({
        entity_type: kind === "agents" ? "agent" : "merchant",
        entity_id: id,
      });
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function toLegacyCatalogResponse(item: RegistryCatalogItem): CatalogItem {
  const username = item.granot_crm_username ?? item.granot_identity?.username;
  return {
    id: item.id,
    _id: item.id,
    name: item.name,
    normalized_name: item.normalized_name,
    active: item.active,
    created_from: item.created_from,
    ...(item.role ? { role: item.role } : {}),
    ...(username ? { granot_crm_username: username } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

async function handleCplRatesList(req: Request, res: Response) {
  try {
    await connectMongo();
    const items = await listCplRates();
    return res.json({ ok: true, data: { items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompaniesList(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = catalogListQuerySchema.parse(req.query);
    const items = await listSourceCompanies({
      includeInactive: parsed.include_inactive === true,
    });
    return res.json({ ok: true, data: { items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompanyDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getSourceCompany(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompanyCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = leadSourceCompanyCreateSchema.parse(req.body);
    await createOrUpdateSourceCompany(toSourceCompanyCommand(parsed), actor);
    const data = await getSourceCompanyBySlug(parsed.company_slug);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompanyUpdate(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = leadSourceCompanyUpdateSchema.parse(req.body);
    await createOrUpdateSourceCompany(toSourceCompanyCommand(parsed, id), actor);
    const data = await getSourceCompany(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceCompanyActivation(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceActivationSchema.parse(req.body);
    await setSourceCompanyActivation(
      {
        id,
        active: parsed.active,
        reason: parsed.reason,
        replacement_default_id: parsed.replacement_default_id,
        remove_automatic_use_for_channel: parsed.remove_automatic_use_for_channel,
      },
      actor,
    );
    const data = await getSourceCompany(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceCompanyDependencies(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await previewSourceDependency({
      entity_type: "source_company",
      entity_id: id,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularitiesList(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = sourceGranularityListQuerySchema.parse(req.query);
    const items = await listSourceGranularities({
      includeInactive: parsed.include_inactive === true,
      ...(parsed.source_company ? { sourceCompanyId: parsed.source_company } : {}),
      ...(parsed.channel ? { channel: parsed.channel } : {}),
    });
    return res.json({ ok: true, data: { items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularityDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getSourceGranularity(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularityCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceGranularityCreateSchema.parse(req.body);
    const data = await createOrUpdateSourceGranularity(
      {
        source_company: parsed.source_company,
        granularity_key: parsed.granularity_key,
        channel: parsed.channel,
        owner_label: parsed.owner_label,
        crm_label: parsed.crm_label,
        ...(parsed.aliases !== undefined ? { aliases: parsed.aliases } : {}),
        ...(parsed.local !== undefined ? { local: parsed.local } : {}),
        ...(parsed.source_sites !== undefined ? { source_sites: parsed.source_sites } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.sheet_tab_name !== undefined
          ? { sheet_tab_name: parsed.sheet_tab_name }
          : {}),
        ...(parsed.created_from ? { created_from: parsed.created_from } : {}),
        ...(parsed.reason ? { reason: parsed.reason } : {}),
      },
      actor,
    );
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularityUpdate(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceGranularityUpdateSchema.parse(req.body);
    const data = await createOrUpdateSourceGranularity(
      { id, ...parsed },
      actor,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularityActivation(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceActivationSchema.parse(req.body);
    const data = await setSourceGranularityActivation(
      {
        id,
        active: parsed.active,
        reason: parsed.reason,
        replacement_default_id: parsed.replacement_default_id,
        remove_automatic_use_for_channel: parsed.remove_automatic_use_for_channel,
      },
      actor,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceGranularityDependencies(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await previewSourceDependency({
      entity_type: "source_granularity",
      entity_id: id,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = ownerGranotNameCreateSchema.parse(req.body);
    const data = await createGranotNameFromOwnerIntent(parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourcesList(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const items = await listProjectedGranotCrmSources();
    return res.json({ ok: true, data: { items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getProjectedGranotCrmSource(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceUpdate(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = granotCrmSourceRegistryUpdateSchema.parse(req.body);
    const mutation = await createOrUpdateGranotCrmSource(
      {
        id,
        granot_label: parsed.granot_label,
        ...(parsed.default_channel ? { default_channel: parsed.default_channel } : {}),
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        lifecycle_enabled: parsed.lifecycle_enabled,
        lifecycle_disposition: parsed.lifecycle_disposition,
        lead_created_policy: parsed.lead_created_policy,
        lead_source_company: parsed.lead_source_company ?? null,
        lifecycle_routes: parsed.lifecycle_routes,
        ...(parsed.lifecycle_policy_version !== undefined
          ? { lifecycle_policy_version: parsed.lifecycle_policy_version }
          : {}),
        reason: parsed.reason,
      },
      actor,
    );
    const data = await getProjectedGranotCrmSource(id);
    return res.json({
      ok: true,
      data: {
        ...data,
        ...(mutation.customer_text_turned_off_due_to_policy_change
          ? {
              customer_text_turned_off_due_to_policy_change: true,
              customer_text_review_sentence:
                "Customer text will be turned off because this Granot name will no longer create Leads.",
            }
          : {}),
      },
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceOutboundSms(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = granotCrmSourceOutboundSmsSchema.parse(req.body);
    const data = await setGranotCrmSourceOutboundSms(
      {
        granot_crm_source_id: id,
        enabled: parsed.enabled,
        body_template: parsed.body_template,
        consent_basis: parsed.consent_basis,
        reason: parsed.reason,
      },
      actor,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceOutboundSmsRecent(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = granotCrmSourceOutboundSmsRecentQuerySchema.parse(req.query);
    const items = await listRecentGranotCrmSourceSms({
      granot_crm_source_id: id,
      limit: parsed.limit,
    });
    return res.json({ ok: true, data: { items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmSourceActivation(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = granotCrmSourceLifecycleActivationSchema.parse(req.body);
    await setGranotCrmSourceLifecycleEnabled(
      {
        id,
        lifecycle_enabled: parsed.lifecycle_enabled,
        reason: parsed.reason,
      },
      actor,
    );
    const data = await getProjectedGranotCrmSource(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceResolutionPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = sourceResolutionPreviewSchema.parse(req.body);
    const data = await previewSourceResolution(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceLabelMappingCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceLabelMappingCreateSchema.parse(req.body);
    const data = await createLabelMapping(parsed, actor);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceLabelMappingActivation(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = sourceLabelMappingActivationSchema.parse(req.body);
    const data = await setLabelMappingActivation(
      id,
      parsed.active,
      parsed.reason,
      actor,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceLabelMappingsList(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = sourceLabelMappingListQuerySchema.parse(req.query);
    const data = await listLabelMappings(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSourceLabelResolutionPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = sourceLabelResolutionPreviewSchema.parse(req.body);
    const data = await previewLabelResolution(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplSnapshot(req: Request, res: Response) {
  try {
    await connectMongo();
    cplSnapshotQuerySchema.parse(req.query);
    requireRegistryReadActor(req, getVantageAuth(req));
    const granularities = await listSourceGranularities();
    const now = new Date();
    const items = await Promise.all(
      granularities.map(async (granularity) => {
        const schedule = await listCplSchedule(granularity.id);
        const current = schedule.periods.find(
          (period) =>
            period.effective_from <= now &&
            (!period.effective_until || period.effective_until > now),
        );
        return {
          source_granularity: granularity,
          schedule_revision: schedule.revision,
          current_rate: current
            ? {
                status: "resolved",
                amount: current.amount_cents / 100,
                amount_cents: current.amount_cents,
                period_id: current.id,
              }
            : { status: "missing_rate", fallback_amount: 0 },
        };
      }),
    );
    return res.json({ ok: true, data: { generated_at: now.toISOString(), items } });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSimpleCplSchedule(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = simpleCplScheduleSchema.parse(req.body);
    const data = await applySimpleCplSchedule(parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplPeriods(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await listCplSchedule(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAdvancedCplScheduleCommand(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = advancedCplScheduleCommandSchema.parse(req.body);
    let operation: AdvancedCplOperation;
    switch (parsed.operation) {
      case "add_future":
        operation = {
          type: "add_future",
          effective_date: parsed.effective_date,
          amount: parsed.amount,
        };
        break;
      case "split":
        operation = {
          type: "split",
          period_id: parsed.period_id,
          effective_date: parsed.effective_date,
          amount: parsed.amount,
        };
        break;
      case "correct_period":
        operation = {
          type: "correct_period",
          period_id: parsed.period_id,
          amount: parsed.amount,
        };
        break;
      case "replace_schedule":
        operation = {
          type: "replace_schedule",
          periods: parsed.periods.map((period) => ({
            amount: period.amount,
            start_date: period.effective_from_date,
            end_date: period.effective_until_date,
          })),
        };
        break;
    }
    const data = await mutateAdvancedCplSchedule(
      {
        source_granularity_id: id,
        expected_revision: parsed.expected_revision,
        operation,
        reason: parsed.reason,
      },
      actor,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplCorrectionPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = cplCorrectionPreviewSchema.parse(req.body);
    const schedule = await listCplSchedule(parsed.source_granularity_id);
    const deps = createDefaultCplCorrectionDependencies({
      previewSampleLimit: parsed.sample_limit,
    });
    const preview = await previewCplCorrection(
      {
        source_granularity_id: parsed.source_granularity_id,
        target_schedule_revision: schedule.revision,
        window: {
          kind: "business_date",
          window_from_date: parsed.window_from,
          window_until_date: parsed.window_until,
        },
      },
      deps,
    );
    const data = {
      preview_hash: preview.preview_hash,
      selection: preview.selection,
      target_schedule_revision: preview.target_schedule_revision,
      impact: preview.impact,
    };
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplCorrectionCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = createCplCorrectionSchema.parse(req.body);
    const data = await createCplCorrection(
      {
        source_granularity_id: parsed.source_granularity_id,
        target_schedule_revision: parsed.target_schedule_revision,
        preview_hash: parsed.preview_hash,
        confirm: true,
        reason: parsed.reason,
        window: {
          kind: "business_date",
          window_from_date: parsed.window_from,
          window_until_date: parsed.window_until,
        },
      },
      actor,
      createDefaultCplCorrectionDependencies(),
    );
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplCorrectionDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getCplCorrectionJob(
      id,
      createDefaultCplCorrectionDependencies(),
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCplCorrectionCancel(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = cancelCplCorrectionSchema.parse(req.body);
    const data = await cancelCplCorrectionJob(
      id,
      actor,
      createDefaultCplCorrectionDependencies(),
      parsed.reason,
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function toSourceCompanyCommand(
  parsed: LeadSourceCompanyCreateInput | LeadSourceCompanyUpdateInput,
  id?: string,
): SourceCompanyCommand {
  return {
    ...(id ? { id } : {}),
    ...("company_slug" in parsed && parsed.company_slug
      ? { company_slug: parsed.company_slug }
      : {}),
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.owner_label !== undefined ? { owner_label: parsed.owner_label } : {}),
    ...(parsed.aliases !== undefined ? { aliases: parsed.aliases } : {}),
    ...(parsed.default_form_granularity !== undefined
      ? { default_form_granularity: parsed.default_form_granularity ?? null }
      : {}),
    ...(parsed.default_call_granularity !== undefined
      ? { default_call_granularity: parsed.default_call_granularity ?? null }
      : {}),
    ...(parsed.sheet_config?.spreadsheet_id !== undefined
      ? { spreadsheet_id: parsed.sheet_config.spreadsheet_id ?? null }
      : {}),
    ...(parsed.sheet_config?.has_bad_tabs !== undefined
      ? { has_bad_tabs: parsed.sheet_config.has_bad_tabs }
      : {}),
    ...(parsed.sheet_config?.projection_mode
      ? { projection_mode: parsed.sheet_config.projection_mode }
      : {}),
    ...(parsed.created_from ? { created_from: parsed.created_from } : {}),
    ...(parsed.reason ? { reason: parsed.reason } : {}),
  };
}

function handleAdminExport(resource: AdminResource) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = adminBrowseQuerySchema.parse(req.query);
      const data = await exportAdminResourceCsv(resource, parsed);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${data.filename}"`,
      );
      return res.status(200).send(data.csv);
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

async function handleSheetSyncHealth(req: Request, res: Response) {
  try {
    await connectMongo();
    const data = await getSheetSyncHealth();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGoogleMapsGeocodingHealth(req: Request, res: Response) {
  try {
    const zip = typeof req.query.zip === "string" ? req.query.zip : undefined;
    const data = await checkGoogleMapsGeocodingHealth(zip);
    return res.status(data.ok ? 200 : 503).json({ ok: data.ok, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceProjectionList(req: Request, res: Response) {
  try {
    leadSourceListQuerySchema.parse(req.query);
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await listLeadSourceProjections();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceProjectionDetail(req: Request, res: Response) {
  try {
    leadSourceDetailQuerySchema.parse(req.query);
    const id = getValidObjectId(req);
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getLeadSourceProjection(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceSetupPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    requireRegistryReadActor(req, getVantageAuth(req));
    const parsed = leadSourceSetupCommandSchema.parse(req.body);
    const data = await previewLeadSourceSetup(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceSetupCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, getVantageAuth(req));
    const parsed = leadSourceSetupCommandSchema.parse(req.body);
    const data = await createLeadSourceSetup(parsed, actor);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleOperationsRegistryOverview(req: Request, res: Response) {
  try {
    registryOverviewQuerySchema.parse(req.query);
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getRegistryOverview();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleOperationsRegistryHealth(req: Request, res: Response) {
  try {
    registryHealthQuerySchema.parse(req.query);
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await getRegistryHealth();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleOperationsRegistryChanges(req: Request, res: Response) {
  try {
    const parsed = registryChangesQuerySchema.parse(req.query);
    requireRegistryReadActor(req, getVantageAuth(req));
    const data = await listRegistryChanges(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityOverview(req: Request, res: Response) {
  try {
    const parsed = observabilityOverviewQuerySchema.parse(req.query);
    const data = await getObservabilityOverview(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityFacets(req: Request, res: Response) {
  try {
    const parsed = observabilityFacetsQuerySchema.parse(req.query);
    const data = await getObservabilityFacets(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityEvents(req: Request, res: Response) {
  try {
    const parsed = observabilityEventsQuerySchema.parse(req.query);
    const data = await listOperationalEvents(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityEventDetail(req: Request, res: Response) {
  try {
    const data = await getOperationalEventDetail(getValidObjectId(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityIncidents(req: Request, res: Response) {
  try {
    const parsed = observabilityIncidentsQuerySchema.parse(req.query);
    const data = await listOperationalIncidents(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityIncidentDetail(req: Request, res: Response) {
  try {
    const data = await getOperationalIncidentDetail(getValidObjectId(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityIncidentStatus(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    const parsed = observabilityIncidentStatusSchema.parse(req.body);
    const data = await updateOperationalIncidentStatus(id, parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityIncidentBatchStatus(
  req: Request,
  res: Response,
) {
  try {
    const parsed = observabilityIncidentBatchStatusSchema.parse(req.body);
    const data = await updateOperationalIncidentStatuses(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityNotifications(req: Request, res: Response) {
  try {
    const parsed = observabilityNotificationsQuerySchema.parse(req.query);
    const data = await listNotificationDeliveries(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityReports(req: Request, res: Response) {
  try {
    const parsed = observabilityReportsQuerySchema.parse(req.query);
    const data = await listOperationalReportRuns(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityReportRun(req: Request, res: Response) {
  try {
    const parsed = observabilityReportRunSchema.parse(req.body);
    const data = await runOperationalReport(parsed);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityReportDetail(req: Request, res: Response) {
  try {
    const data = await getOperationalReportRunDetail(getValidObjectId(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityRecordDelete(req: Request, res: Response) {
  try {
    const collection = observabilityDeleteCollectionSchema.parse(
      req.params.collection,
    );
    const data = await deleteObservabilityRecord(
      collection,
      getValidObjectId(req),
    );
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityBatchDelete(req: Request, res: Response) {
  try {
    const collection = observabilityDeleteCollectionSchema.parse(
      req.params.collection,
    );
    const parsed = observabilityBatchDeleteSchema.parse(req.body);
    const data = await deleteObservabilityRecords(collection, parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityReportExport(req: Request, res: Response) {
  try {
    const data = await exportReportRunCsv(getValidObjectId(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.filename}"`,
    );
    return res.status(200).send(data.csv);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityEventsExport(req: Request, res: Response) {
  try {
    const parsed = observabilityEventsQuerySchema.parse(req.query);
    const data = await exportOperationalEventsCsv(parsed);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.filename}"`,
    );
    return res.status(200).send(data.csv);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityIncidentsExport(req: Request, res: Response) {
  try {
    const parsed = observabilityIncidentsQuerySchema.parse(req.query);
    const data = await exportOperationalIncidentsCsv(parsed);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.filename}"`,
    );
    return res.status(200).send(data.csv);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSheetSyncJobs(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = sheetSyncJobsQuerySchema.parse(req.query);
    const data = await listSheetSyncJobs(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSheetSyncRuns(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = sheetSyncRunsQuerySchema.parse(req.query);
    const data = await listSheetSyncRuns(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSheetSyncRunDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const data = await getSheetSyncRunDetail(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSheetSyncRetry(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = sheetSyncRetrySchema.parse(req.body);
    const data = await retrySheetSyncJobs(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleSheetContains(req: Request, res: Response) {
  try {
    requireOwnerActor(req);
    await connectMongo();
    const parsed = sheetContainsSchema.parse(req.body);
    const data = await checkSheetContains(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadMessagesList(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = leadMessagesQuerySchema.parse(req.query);
    const data = await listLeadMessages({
      page: parsed.page,
      limit: parsed.limit,
      status: parsed.status,
      formLeadId: parsed.form_lead_id,
      phone: parsed.phone,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadMessageDetail(req: Request, res: Response) {
  try {
    await connectMongo();
    const data = await getLeadMessage(getValidObjectId(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadMessageRetry(req: Request, res: Response) {
  try {
    await connectMongo();
    leadMessageRetrySchema.parse(req.body);
    const data = await requestLeadMessageRetry(
      getValidObjectId(req),
      describeAuthActor(req),
    );
    return res.status(202).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function describeAuthActor(req: Request): string {
  const auth = (req as Request & { vantageAuth?: VantageAuthContext })
    .vantageAuth;
  if (!auth) return "unknown";
  if (auth.kind === "user") return `user:${auth.userId}`;
  if (auth.kind === "scoped_key") return `scoped_key:${auth.scopedKeyName}`;
  return "api_secret";
}

async function handleGranotCrmCsvSources(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = listGranotCrmSourcesQuerySchema.parse(req.query);
    if (parsed.seed) {
      await seedGranotCrmSources(parsed.crm_origin);
    }
    const sources = await listGranotCrmSources(parsed.crm_origin);
    return res.json({
      ok: true,
      data: {
        items: sources.map((source) => ({
          _id: source._id.toString(),
          crm_origin: source.crm_origin,
          workspace_slug: source.workspace_slug,
          granot_label: source.granot_label,
          default_channel: source.default_channel,
          source_company: source.source_company,
          csv_paths: source.csv_paths ?? {},
          enabled: source.enabled,
          notes: source.notes,
          last_ingestions: source.last_ingestions ?? {},
        })),
      },
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleGranotCrmCsvUpload(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = uploadGranotCrmCsvSchema.parse(req.body);
    const data = await uploadGranotCrmCsv(parsed);
    return res.status(data.status === "uploaded" ? 201 : 200).json({
      ok: true,
      data,
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function handleOverviewReport() {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = overviewQuerySchema.parse(req.query);
      const data = await getOverviewReport(parsed);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleAnalyticsReport(report: (typeof analyticsReports)[number]) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = analyticsQuerySchema.parse(req.query);
      const data = await getAnalyticsReport(report, parsed);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

async function handleAnalyticsExport(req: Request, res: Response) {
  try {
    await connectMongo();
    const report = analyticsReportSchema.parse(req.params.report);
    const parsed = analyticsQuerySchema.parse(req.query);
    const data = await exportAnalyticsReportCsv(report, parsed);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.filename}"`,
    );
    return res.status(200).send(data.csv);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAgentSalesReport(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = agentSalesReportQuerySchema.parse(req.query);
    const data = await getAgentSalesReport(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAgentSalesReportExport(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = agentSalesReportQuerySchema.parse(req.query);
    const data = await exportAgentSalesReportCsv(parsed);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.filename}"`,
    );
    return res.status(200).send(data.csv);
  } catch (error) {
    return sendError(req, res, error);
  }
}

function handleFindOne(findOne: (id: string) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const data = await findOne(id);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCanonicalCreate<T>(
  schema: ZodType<T>,
  commandName: string,
  create: (
    input: T,
    context: import("../services/domainCommands").CanonicalCommandContext,
  ) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = schema.parse(req.body);
      const data = await create(
        parsed,
        existingWriteContextFromRequest({
          req,
          command_name: commandName,
          payload: parsed,
        }),
      );
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCanonicalUpdate<T>(
  schema: ZodType<T>,
  commandName: string,
  update: (
    id: string,
    input: T,
    context: import("../services/domainCommands").CanonicalCommandContext,
  ) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const parsed = schema.parse(req.body);
      const data = await update(
        id,
        parsed,
        existingWriteContextFromRequest({
          req,
          command_name: commandName,
          payload: parsed,
          resource_id: id,
        }),
      );
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCanonicalDelete(
  commandName: string,
  remove: (
    id: string,
    cascade: boolean,
    context: import("../services/domainCommands").CanonicalCommandContext,
  ) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const cascade = req.query.cascade === "true";
      await remove(
        id,
        cascade,
        existingWriteContextFromRequest({
          req,
          command_name: commandName,
          payload: { id, cascade },
          resource_id: id,
        }),
      );
      return res.status(204).send();
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleCreate<T>(
  schema: ZodType<T>,
  create: (input: T) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = schema.parse(req.body);
      const data = await create(parsed);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function requestLogger(req: Request): Logger {
  return (req as RequestWithLogger).log ?? rootLogger;
}

function requestId(req: Request): string | number | object {
  return (req as RequestWithLogger).id ?? "unknown";
}

function requestPath(req: Request): string {
  const r = req as RequestWithLogger;
  return r.path ?? (r.originalUrl ?? r.url ?? "").split("?")[0];
}

function requestOriginalUrl(req: Request): string {
  const r = req as RequestWithLogger;
  return (r.originalUrl ?? r.url ?? "").split("?")[0];
}

async function handleSearchFormLeads(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = searchFormLeadsSchema.parse(req.body);
    const data = await searchFormLeads(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleResolveGranotFormLead(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = resolveGranotFormLeadSchema.parse(req.body);
    const result = await resolveGranotFormLead(parsed);
    return res.json({
      ok: true,
      data:
        result.status === "found"
          ? {
              ...result,
              lead: serializeGranotFormLead(result.lead),
            }
          : result,
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function serializeGranotFormLead(lead: GranotFormLeadLike) {
  return {
    _id: String(lead._id),
    ref_no: lead.ref_no,
    source_company: lead.source_company,
    quoted: lead.quoted,
    cubic_feet: lead.cubic_feet,
    pickup_city: lead.pickup_city,
    pickup_zip: lead.pickup_zip,
    pickup_state: lead.pickup_state,
    delivery_city: lead.delivery_city,
    destination_zip: lead.destination_zip,
    delivery_state: lead.delivery_state,
    booked: lead.booked ? String(lead.booked) : null,
    duplicate: lead.duplicate === true,
    receiver_agent: lead.receiver_agent ? String(lead.receiver_agent) : null,
    receiver_agent_name_snapshot: lead.receiver_agent_name_snapshot,
    receiver_agent_source: lead.receiver_agent_source,
    receiver_agent_source_value: lead.receiver_agent_source_value,
  };
}

async function handleSearchCallLeads(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = searchCallLeadsSchema.parse(req.body);
    const data = await searchCallLeads(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBrowseFormLeads(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = browseFormLeadsQuerySchema.parse(req.query);
    const data = await browseFormLeads(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBrowseCallLeads(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = browseCallLeadsQuerySchema.parse(req.query);
    const data = await browseCallLeads(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleListTestimonials(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = listTestimonialsQuerySchema.parse(req.query);
    const data = await listTestimonials(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAdminTestimonialsList(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = adminTestimonialsQuerySchema.parse(req.query);
    const data = await listAdminTestimonials(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAdminTestimonialDetail(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const data = await getAdminTestimonial(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleAdminTestimonialReviewerNames(
  _req: Request,
  res: Response,
) {
  try {
    await connectMongo();
    const data = await listAdminTestimonialReviewerNames();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(_req, res, error);
  }
}

async function handleMovingCarriersList(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = listMovingCarriersQuerySchema.parse(req.query);
    const data = await listMovingCarriers(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleMovingCarrierCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = movingCarrierCreateSchema.parse(req.body);
    const data = await createMovingCarrier(parsed);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleMovingCarrierUpdate(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = movingCarrierUpdateSchema.parse(req.body);
    const data = await updateMovingCarrier(id, parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleMovingCarrierImport(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = movingCarrierImportSchema.parse(req.body);
    const data = await importMovingCarriersFromCsv(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCallLeadEnrichmentPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = callLeadEnrichmentBatchSchema.parse(req.body);
    const data = await previewCallLeadEnrichment(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookedCallLeadReconciliationPreview(
  req: Request,
  res: Response,
) {
  try {
    await connectMongo();
    const parsed = bookedCallLeadReconciliationBatchSchema.parse(req.body);
    const data = await previewBookedCallLeadReconciliation(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleCreateFormLead(req: Request, res: Response) {
  return handleCreateFormLeadRequest(req, res, {
    logPrefix: "form_lead",
  });
}

async function handleCreateFormLeadTest(req: Request, res: Response) {
  return withRuntimeDomainOverrides(
    { testMode: true, sheetSyncMode: "legacy" },
    () =>
      handleCreateFormLeadRequest(req, res, {
        logPrefix: "form_lead_test",
      }),
  );
}

async function handleCreateFormLeadRequest(
  req: Request,
  res: Response,
  options: { logPrefix: "form_lead" | "form_lead_test" },
) {
  const { logPrefix } = options;
  const log = requestLogger(req);
  const rid = requestId(req);

  log.info({
    msg: `${logPrefix}.request.received`,
    requestId: rid,
    method: req.method,
    path: requestPath(req),
    originalUrl: requestOriginalUrl(req),
    origin: req.headers.origin ?? null,
    contentType: req.headers["content-type"] ?? null,
    contentLength: req.headers["content-length"] ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const rawBody = req.body;
  const bodyKeys =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? Object.keys(rawBody as Record<string, unknown>)
      : [];

  log.info({
    msg: `${logPrefix}.request.body_keys`,
    requestId: rid,
    keys: bodyKeys,
  });

  log.info({
    msg: `${logPrefix}.request.payload_preview`,
    requestId: rid,
    preview: sanitizeFormLeadBodyPreview(rawBody),
  });

  try {
    await connectMongo();
    const parsed = createFormLeadSchema.parse(req.body);
    log.info({
      msg: `${logPrefix}.validation.ok`,
      requestId: rid,
      fields: Object.keys(parsed),
    });
    const data = (
      await runExistingCreateFormLead({
        data: parsed,
        context: existingWriteContextFromRequest({
          req,
          command_name: "createFormLead",
          payload: parsed,
        }),
      })
    ).data;
    const leadId = data.lead._id.toString();
    log.info({
      msg: `${logPrefix}.created`,
      requestId: rid,
      leadId,
      email: data.lead.email,
      phone_number: data.lead.phone_number,
      sheetSyncStatus: data.sheet_sync_status,
      crmSyncStatus: data.crm_sync_status,
      crmCompanyLabel: data.crm_company_label,
      crmResponse: data.crm_response,
      messagingStatus: data.messaging_status,
      leadMessageId: data.lead_message_id,
    });
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      log.warn({
        msg: `${logPrefix}.validation.failed`,
        requestId: rid,
        issues: error.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
      return sendError(req, res, error);
    }

    // Covers both legacy `V1ServiceError` throws and the new typed
    // `AppError` subclasses (`NotFoundError`, `ConflictError`, ...) the
    // form-lead service migrated to. Without this, typed errors would
    // skip the structured warn-level log below and only surface as a
    // generic creation-failure error line.
    if (error instanceof AppError) {
      log.warn({
        msg: `${logPrefix}.service.error`,
        requestId: rid,
        statusCode: error.statusCode,
        errorCode: error.code,
        errorName: error.name,
        message: error.message,
        ...(error.metadata ? { metadata: error.metadata } : {}),
      });
      return sendError(req, res, error);
    }

    log.error(
      {
        err: error,
        msg: `${logPrefix}.create.failed`,
        requestId: rid,
      },
      "Form lead creation failed",
    );
    return sendError(req, res, error);
  }
}

async function handleUpdateFormLead(req: Request, res: Response) {
  const log = requestLogger(req);
  const rid = requestId(req);

  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = updateFormLeadSchema.parse(req.body);
    const lead = (
      await runExistingUpdateSourceOwnedLead({
        lead_model: "FormLead",
        lead_id: id,
        patch: parsed,
        context: existingWriteContextFromRequest({
          req,
          command_name: "updateSourceOwnedLead",
          payload: parsed,
          resource_id: id,
        }),
      })
    ).data;
    const updatedLead = lead as { email?: string; phone_number?: string };
    log.info({
      msg: "form_lead.updated",
      requestId: rid,
      leadId: id,
      email: updatedLead.email,
      phone_number: updatedLead.phone_number,
      updatedFields: Object.keys(parsed),
    });
    return res.json({ ok: true, data: lead });
  } catch (error) {
    return sendError(req, res, error);
  }
}

export function buildGranotSyncExpectedFilter(
  patch: Record<string, unknown>,
  sourceCompany: string,
  expectedSnapshot: Record<string, unknown>,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  for (const field of ["pickup_city", "delivery_city"]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      clauses.push({ [field]: { $in: [null, ""] } });
    }
  }
  for (const field of ["pickup_state", "delivery_state"]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      clauses.push({ [field]: { $in: [null, "", "not_found"] } });
    }
  }
  for (const field of ["pickup_zip", "destination_zip"]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      clauses.push({
        $or: [
          { [field]: { $in: [null, ""] } },
          { [field]: { $regex: /^0+$/ } },
        ],
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "receiver_agent")) {
    clauses.push({ receiver_agent: null });
  }
  return {
    source_company: sourceCompany,
    duplicate: { $ne: true },
    ...expectedSnapshot,
    ...(clauses.length > 0 ? { $and: clauses } : {}),
  };
}

function handleUpdate<T>(
  schema: ZodType<T>,
  update: (id: string, input: T) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const parsed = schema.parse(req.body);
      const data = await update(id, parsed);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

function handleDelete(
  remove: (id: string, cascade: boolean) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const id = getValidObjectId(req);
      await connectMongo();
      const cascade = req.query.cascade === "true";
      await remove(id, cascade);
      return res.status(204).send();
    } catch (error) {
      return sendError(req, res, error);
    }
  };
}

async function handleEmployeeBookingOptions(req: Request, res: Response) {
  try {
    const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
    if (auth?.kind !== "secret") {
      throw new V1ServiceError("Forbidden", 403);
    }
    await connectMongo();
    const data = await getEmployeeBookingOptions();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleEmployeeBookingSubmission(req: Request, res: Response) {
  try {
    const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
    if (auth?.kind !== "secret") {
      throw new V1ServiceError("Forbidden", 403);
    }
    await connectMongo();
    const parsed = createEmployeeBookingSubmissionSchema.parse(req.body);
    const clientKeyHash = req.header("x-public-client-key-hash")?.trim();
    if (!clientKeyHash || !/^[a-f0-9]{64}$/i.test(clientKeyHash)) {
      throw new V1ServiceError("A valid public client identifier is required", 400);
    }
    const data = await submitEmployeeBooking(parsed, {
      clientKeyHash,
    });
    return res.status(data.statusCode).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadReconciliationsList(
  req: Request,
  res: Response,
) {
  try {
    requireOwnerActor(req);
    await connectMongo();
    const parsed = bookingLeadReconciliationListQuerySchema.parse(req.query);
    const data = await listBookingLeadReconciliationCases(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadReconciliationDetail(
  req: Request,
  res: Response,
) {
  try {
    requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const data = await getBookingLeadReconciliationCase(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadCandidateSearch(req: Request, res: Response) {
  try {
    requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = bookingLeadCandidateSearchSchema.parse(req.body);
    const data = await searchBookingLeadCandidates(id, parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadCandidateRefresh(req: Request, res: Response) {
  try {
    const actor = requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = refreshBookingLeadCandidatesSchema.parse(req.body);
    const data = await refreshBookingLeadCandidates(id, parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handlePendingEmployeeBookingUpdate(
  req: Request,
  res: Response,
) {
  try {
    const actor = requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = updatePendingEmployeeBookingSchema.parse(req.body);
    const data = await updatePendingEmployeeBooking(id, parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadReconciliationResolve(
  req: Request,
  res: Response,
) {
  try {
    const actor = requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = resolveBookingLeadReconciliationSchema.parse(req.body);
    const data = await resolveBookingLeadReconciliation(id, parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookingLeadReconciliationReopen(
  req: Request,
  res: Response,
) {
  try {
    const actor = requireOwnerActor(req);
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = reopenBookingLeadReconciliationSchema.parse(req.body);
    const data = await reopenBookingLeadReconciliation(id, parsed, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function getValidObjectId(req: Request): string {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid Mongo ObjectId", 400);
  }

  return id;
}

function getVantageAuth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function requireOwnerActor(
  req: Request,
): { actor: string; ownerId?: string; ownerEmail?: string } {
  const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
  return deriveTrustedOwnerActor(auth, {
    adminUserId: req.header("x-vantage-admin-user-id"),
    adminEmail: req.header("x-vantage-admin-email"),
    adminRole: req.header("x-vantage-admin-role"),
  });
}

async function sendError(req: Request, res: Response, error: unknown) {
  const log = requestLogger(req);
  const rid = requestId(req);

  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    });
  }

  if (error instanceof mongoose.Error.VersionError) {
    return res.status(409).json({
      ok: false,
      error: "The record changed while this request was being processed",
    });
  }

  // `V1ServiceError` extends `AppError` (refactor plan 10), so this single
  // branch covers both legacy throws and the new typed subclasses
  // (`NotFoundError`, `ConflictError`, etc.). Response shape and status
  // are preserved for V1ServiceError -- public `message` and `statusCode`
  // map exactly as before.
  if (error instanceof AppError) {
    // 5xx AppErrors are dependency/infra failures (e.g. the 503 thrown by
    // `connectMongo` when Atlas is unreachable). Log them at error level
    // with the underlying cause so the raw driver/OpenSSL text is captured
    // here instead of being swallowed into the response body. Client-facing
    // 4xx AppErrors stay quiet -- they are expected outcomes.
    if (error.statusCode >= 500) {
      log.error(
        { err: error, requestId: rid, ...error.toLog() },
        "Request failed with server-side AppError",
      );
      await captureRouteFailureEvent(req, error, error.statusCode);
    }
    if (isRegistryError(error)) {
      return res.status(error.statusCode).json(error.toHttpBody());
    }
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
    });
  }

  // Truly unexpected error: log the full object (pino's `err` serializer
  // preserves name/message/stack) so operators can see the real cause
  // rather than pino-http's synthetic "failed with status code 500".
  log.error(
    { err: error, requestId: rid },
    "Unhandled error while processing request",
  );
  await captureRouteFailureEvent(req, error, 500);
  const message = error instanceof Error ? error.message : "Unknown API error";
  return res.status(500).json({
    ok: false,
    error: message,
  });
}

/**
 * Records an unexpected 5xx as an operational event, classified by route so the
 * owner sees `lead.route.failed`, `booking.route.failed`, etc. Best-effort and
 * gated by `OBSERVABILITY_CAPTURE_HTTP_5XX`.
 */
async function captureRouteFailureEvent(
  req: Request,
  error: unknown,
  statusCode: number,
): Promise<void> {
  if (!shouldCaptureHttp5xx()) {
    return;
  }
  const path = requestPath(req);
  const { eventKey, category, workflow } = classifyRouteFailure(path);
  const errorName = error instanceof Error ? error.name : "Error";
  const errorCode = error instanceof AppError ? error.code : undefined;
  await recordOperationalEvent({
    level: "error",
    eventKey,
    category,
    workflow,
    summary: `Unexpected ${statusCode} on ${req.method} ${path}.`,
    request: req,
    statusCode,
    details: {
      errorName,
      errorCode,
      causeMessage: error instanceof Error ? error.message : String(error),
    },
    errorMessage: error instanceof Error ? error.message : String(error),
    notificationCandidate: true,
  });
}

function classifyRouteFailure(path: string): {
  eventKey: string;
  category: "lead" | "booking" | "cancellation" | "http";
  workflow: string;
} {
  if (path.includes("/booked-leads")) {
    return {
      eventKey: "booking.route.failed",
      category: "booking",
      workflow: "booking_route",
    };
  }
  if (path.includes("/cancelled-leads")) {
    return {
      eventKey: "cancellation.route.failed",
      category: "cancellation",
      workflow: "cancellation_route",
    };
  }
  if (path.includes("/form-leads") || path.includes("/call-leads")) {
    return {
      eventKey: "lead.route.failed",
      category: "lead",
      workflow: "lead_route",
    };
  }
  return {
    eventKey: "http.request.5xx",
    category: "http",
    workflow: "http_request",
  };
}

export default router;
