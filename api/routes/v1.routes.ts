import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { ZodError, type ZodType } from "zod";
import { connectMongo } from "../db";
import { withRuntimeDomainOverrides } from "../config/domain";
import { shouldCaptureHttp5xx } from "../config/domain/observability";
import { logger as rootLogger } from "../logger";
import { requireApiSecret } from "../middleware/requireApiSecret";
import extensionAuthRoutes from "./extension-auth.routes";
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
import { searchCallLeads } from "../services/callLeadSearch.service";
import { browseCallLeads, browseFormLeads } from "../services/search";
import {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
} from "../services/callLeadEnrichment.service";
import {
  previewBookedCallLeadReconciliation,
  syncBookedCallLeadReconciliation,
} from "../services/bookedCallLeadReconciliation.service";
import { checkGoogleMapsGeocodingHealth } from "../services/googleMaps/geocoding";
import { sanitizeFormLeadBodyPreview } from "../utils/logging/sanitizeFormLeadForLog";
import {
  createBookedLead,
  createBookedLeadFromSource,
  createCallLead,
  createCancelledLead,
  createCustomer,
  createFormLead,
  createReferralBooking,
  createLeadlessBooking,
  deleteBookedLead,
  deleteCallLead,
  deleteCancelledLead,
  deleteCustomer,
  deleteFormLead,
  findFormLead,
  findAllBookedLeads,
  findAllCancelledLeads,
  findAllCustomers,
  updateBookedLead,
  updateCallLead,
  updateCancelledLead,
  updateCustomer,
  updateFormLead,
  V1ServiceError,
} from "../services/v1.service";
import { AppError } from "../services/errors";
import {
  createBookedLeadFromSourceSchema,
  createBookedLeadSchema,
  createCallLeadSchema,
  createCancelledLeadSchema,
  createCustomerSchema,
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
  cplRateUpdateSchema,
  leadSourceCompanyCreateSchema,
  leadSourceCompanyUpdateSchema,
  listMovingCarriersQuerySchema,
  movingCarrierCreateSchema,
  movingCarrierImportSchema,
  movingCarrierUpdateSchema,
  listGranotCrmSourcesQuerySchema,
  sheetSyncJobsQuerySchema,
  sheetSyncRunsQuerySchema,
  sheetSyncRetrySchema,
  adminTestimonialsQuerySchema,
  listTestimonialsQuerySchema,
  bookedCallLeadReconciliationBatchSchema,
  browseCallLeadsQuerySchema,
  browseFormLeadsQuerySchema,
  callLeadEnrichmentBatchSchema,
  searchCallLeadsSchema,
  searchFormLeadsSchema,
  uploadGranotCrmCsvSchema,
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
} from "../validation/v1.validation";
import {
  browseAdminResource,
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
  type CatalogKind,
} from "../services/catalog";
import { listCplRates, updateCplRate } from "../services/cpl/cplRate.service";
import {
  createLeadSourceCompany,
  getLeadSourceCompany,
  listLeadSourceCompanies,
  updateLeadSourceCompany,
} from "../services/leadSourceCompanies";
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

const router = Router();

router.use(extensionAuthRoutes);
router.use("/api/v1", requireApiSecret);

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
] as const;

router.get("/api/v1/admin/search", handleAdminSearch);
router.get("/api/v1/admin/facets", handleAdminFacets);
router.get("/api/v1/admin/catalog/agents", handleCatalogList("agents"));
router.get("/api/v1/admin/catalog/merchants", handleCatalogList("merchants"));
router.post("/api/v1/admin/agents", handleCatalogCreate("agents"));
router.patch("/api/v1/admin/agents/:id", handleCatalogUpdate("agents"));
router.get("/api/v1/admin/merchants", handleCatalogList("merchants"));
router.get("/api/v1/admin/merchants/:id", handleCatalogDetail("merchants"));
router.post("/api/v1/admin/merchants", handleCatalogCreate("merchants"));
router.patch("/api/v1/admin/merchants/:id", handleCatalogUpdate("merchants"));
router.get("/api/v1/admin/cpl-rates", handleCplRatesList);
router.patch("/api/v1/admin/cpl-rates/:label", handleCplRateUpdate);
router.get("/api/v1/admin/source-companies", handleLeadSourceCompaniesList);
router.get("/api/v1/admin/source-companies/:id", handleLeadSourceCompanyDetail);
router.post("/api/v1/admin/source-companies", handleLeadSourceCompanyCreate);
router.patch("/api/v1/admin/source-companies/:id", handleLeadSourceCompanyUpdate);
router.get("/api/v1/admin/testimonials", handleAdminTestimonialsList);
router.get("/api/v1/admin/testimonials/reviewer-names", handleAdminTestimonialReviewerNames);
router.get("/api/v1/admin/testimonials/:id", handleAdminTestimonialDetail);
router.get("/api/v1/admin/moving-carriers", handleMovingCarriersList);
router.post("/api/v1/admin/moving-carriers", handleMovingCarrierCreate);
router.post("/api/v1/admin/moving-carriers/import", handleMovingCarrierImport);
router.patch("/api/v1/admin/moving-carriers/:id", handleMovingCarrierUpdate);
for (const resource of adminResources) {
  router.get(`/api/v1/admin/${resource}`, handleAdminBrowse(resource));
  router.get(`/api/v1/admin/${resource}/:id`, handleAdminDetail(resource));
  router.get(`/api/v1/admin/exports/${resource}.csv`, handleAdminExport(resource));
}
for (const report of analyticsReports) {
  router.get(`/api/v1/admin/analytics/${report}`, handleAnalyticsReport(report));
}
router.get("/api/v1/admin/analytics/overview", handleOverviewReport());
router.get("/api/v1/admin/exports/analytics/:report.csv", handleAnalyticsExport);
router.get("/api/v1/admin/reports/agent-sales", handleAgentSalesReport);
router.get("/api/v1/admin/exports/reports/agent-sales.csv", handleAgentSalesReportExport);

router.get("/api/v1/admin/sheet-sync/health", handleSheetSyncHealth);
router.get("/api/v1/admin/google-maps/geocoding-health", handleGoogleMapsGeocodingHealth);
router.get("/api/v1/admin/sheet-sync/jobs", handleSheetSyncJobs);
router.get("/api/v1/admin/sheet-sync/runs", handleSheetSyncRuns);
router.get("/api/v1/admin/sheet-sync/runs/:id", handleSheetSyncRunDetail);
router.post("/api/v1/admin/sheet-sync/retry", handleSheetSyncRetry);

router.get("/api/v1/admin/observability/overview", handleObservabilityOverview);
router.get("/api/v1/admin/observability/facets", handleObservabilityFacets);
router.get("/api/v1/admin/observability/events", handleObservabilityEvents);
router.get("/api/v1/admin/observability/events/:id", handleObservabilityEventDetail);
router.get("/api/v1/admin/observability/incidents", handleObservabilityIncidents);
router.patch(
  "/api/v1/admin/observability/incidents/status",
  handleObservabilityIncidentBatchStatus,
);
router.get("/api/v1/admin/observability/incidents/:id", handleObservabilityIncidentDetail);
router.patch(
  "/api/v1/admin/observability/incidents/:id/status",
  handleObservabilityIncidentStatus,
);
router.get("/api/v1/admin/observability/notifications", handleObservabilityNotifications);
router.get("/api/v1/admin/observability/reports", handleObservabilityReports);
router.post("/api/v1/admin/observability/reports/run", handleObservabilityReportRun);
router.get("/api/v1/admin/observability/reports/:id", handleObservabilityReportDetail);
router.post(
  "/api/v1/admin/observability/:collection/delete",
  handleObservabilityBatchDelete,
);
router.delete(
  "/api/v1/admin/observability/:collection/:id",
  handleObservabilityRecordDelete,
);
router.get("/api/v1/admin/exports/observability/events.csv", handleObservabilityEventsExport);
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
router.get("/api/v1/form-leads/:id", handleFindOne(findFormLead));
router.post("/api/v1/form-leads/search", handleSearchFormLeads);
router.post("/api/v1/create-form-test", handleCreateFormLeadTest);
router.post("/api/v1/form-leads", handleCreateFormLead);
router.patch("/api/v1/form-leads/:id", handleUpdateFormLead);
router.delete("/api/v1/form-leads/:id", handleDelete(deleteFormLead));

router.get("/api/v1/call-leads", handleBrowseCallLeads);
router.post("/api/v1/call-leads/search", handleSearchCallLeads);
router.post("/api/v1/call-leads/enrichment/preview", handleCallLeadEnrichmentPreview);
router.post("/api/v1/call-leads/enrichment/sync", handleCallLeadEnrichmentSync);
router.post(
  "/api/v1/call-leads/booked-reconciliation/preview",
  handleBookedCallLeadReconciliationPreview,
);
router.post(
  "/api/v1/call-leads/booked-reconciliation/sync",
  handleBookedCallLeadReconciliationSync,
);
router.post("/api/v1/call-leads", handleCreate(createCallLeadSchema, createCallLead));
router.patch("/api/v1/call-leads/:id", handleUpdate(updateCallLeadSchema, updateCallLead));
router.delete("/api/v1/call-leads/:id", handleDelete(deleteCallLead));

router.get("/api/v1/booked-leads", handleFindAll(findAllBookedLeads));
router.post("/api/v1/booked-leads", handleCreate(createBookedLeadSchema, createBookedLead));
router.post(
  "/api/v1/booked-leads/from-source",
  handleCreate(createBookedLeadFromSourceSchema, createBookedLeadFromSource),
);
router.post("/api/v1/referral-bookings", handleCreate(createReferralBookingSchema, createReferralBooking));
router.post(
  "/api/v1/leadless-bookings",
  handleCreate(createLeadlessBookingSchema, createLeadlessBooking),
);
router.patch("/api/v1/booked-leads/:id", handleUpdate(updateBookedLeadSchema, updateBookedLead));
router.delete("/api/v1/booked-leads/:id", handleDelete(deleteBookedLead));

router.get("/api/v1/cancelled-leads", handleFindAll(findAllCancelledLeads));
router.post("/api/v1/cancelled-leads", handleCreate(createCancelledLeadSchema, createCancelledLead));
router.patch("/api/v1/cancelled-leads/:id", handleUpdate(updateCancelledLeadSchema, updateCancelledLead));
router.delete("/api/v1/cancelled-leads/:id", handleDelete(async (id) => deleteCancelledLead(id)));

router.get("/api/v1/customers", handleFindAll(findAllCustomers));
router.post("/api/v1/customers", handleCreate(createCustomerSchema, createCustomer));
router.patch("/api/v1/customers/:id", handleUpdate(updateCustomerSchema, updateCustomer));
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
      const data = await getAdminResourceDetail(resource, id, parsed.database_scope, parsed);
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
    const parsed = adminBrowseQuerySchema.pick({ database_scope: true }).parse(req.query);
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
      const parsed = catalogCreateSchema.parse(req.body);
      const data = await createCatalogItem(kind, parsed);
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
      const parsed = catalogUpdateSchema.parse(req.body);
      const data = await updateCatalogItem(kind, id, parsed);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(req, res, error);
    }
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

async function handleCplRateUpdate(req: Request, res: Response) {
  try {
    const label = (Array.isArray(req.params.label) ? req.params.label[0] : req.params.label) ?? "";
    await connectMongo();
    const parsed = cplRateUpdateSchema.parse(req.body);
    const data = await updateCplRate(label, parsed.cpl);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompaniesList(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = catalogListQuerySchema.parse(req.query);
    const items = await listLeadSourceCompanies({
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
    const data = await getLeadSourceCompany(id);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompanyCreate(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = leadSourceCompanyCreateSchema.parse(req.body);
    const data = await createLeadSourceCompany(parsed);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleLeadSourceCompanyUpdate(req: Request, res: Response) {
  try {
    const id = getValidObjectId(req);
    await connectMongo();
    const parsed = leadSourceCompanyUpdateSchema.parse(req.body);
    const data = await updateLeadSourceCompany(id, parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function handleAdminExport(resource: AdminResource) {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const parsed = adminBrowseQuerySchema.parse(req.query);
      const data = await exportAdminResourceCsv(resource, parsed);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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

async function handleObservabilityIncidentBatchStatus(req: Request, res: Response) {
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
    const collection = observabilityDeleteCollectionSchema.parse(req.params.collection);
    const data = await deleteObservabilityRecord(collection, getValidObjectId(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleObservabilityBatchDelete(req: Request, res: Response) {
  try {
    const collection = observabilityDeleteCollectionSchema.parse(req.params.collection);
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
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
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

function handleCreate<T>(schema: ZodType<T>, create: (input: T) => Promise<unknown>) {
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

async function handleAdminTestimonialReviewerNames(_req: Request, res: Response) {
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

async function handleCallLeadEnrichmentSync(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = callLeadEnrichmentBatchSchema.parse(req.body);
    const data = await syncCallLeadEnrichment(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookedCallLeadReconciliationPreview(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = bookedCallLeadReconciliationBatchSchema.parse(req.body);
    const data = await previewBookedCallLeadReconciliation(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function handleBookedCallLeadReconciliationSync(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = bookedCallLeadReconciliationBatchSchema.parse(req.body);
    const data = await syncBookedCallLeadReconciliation(parsed);
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
    const data = await createFormLead(parsed);
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
    const lead = await updateFormLead(id, parsed);
    log.info({
      msg: "form_lead.updated",
      requestId: rid,
      leadId: id,
      email: lead.email,
      phone_number: lead.phone_number,
      updatedFields: Object.keys(parsed),
    });
    return res.json({ ok: true, data: lead });
  } catch (error) {
    return sendError(req, res, error);
  }
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

function handleDelete(remove: (id: string, cascade: boolean) => Promise<unknown>) {
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

function getValidObjectId(req: Request): string {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid Mongo ObjectId", 400);
  }

  return id;
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
  const errorCode =
    error instanceof AppError ? error.code : undefined;
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
    return { eventKey: "booking.route.failed", category: "booking", workflow: "booking_route" };
  }
  if (path.includes("/cancelled-leads")) {
    return {
      eventKey: "cancellation.route.failed",
      category: "cancellation",
      workflow: "cancellation_route",
    };
  }
  if (path.includes("/form-leads") || path.includes("/call-leads")) {
    return { eventKey: "lead.route.failed", category: "lead", workflow: "lead_route" };
  }
  return { eventKey: "http.request.5xx", category: "http", workflow: "http_request" };
}

export default router;
