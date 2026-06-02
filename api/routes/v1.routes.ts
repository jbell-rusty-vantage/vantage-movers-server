import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { ZodError, type ZodType } from "zod";
import { connectMongo } from "../db";
import { logger as rootLogger } from "../logger";
import { requireApiSecret } from "../middleware/requireApiSecret";
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
import { sanitizeFormLeadBodyPreview } from "../utils/logging/sanitizeFormLeadForLog";
import {
  createBookedLead,
  createBookedLeadFromSource,
  createCallLead,
  createCancelledLead,
  createCustomer,
  createFormLead,
  createReferralBooking,
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
  analyticsQuerySchema,
  analyticsReportSchema,
  agentSalesReportQuerySchema,
  overviewQuerySchema,
  adminBrowseQuerySchema,
  adminSearchQuerySchema,
  bookedCallLeadReconciliationBatchSchema,
  browseCallLeadsQuerySchema,
  browseFormLeadsQuerySchema,
  callLeadEnrichmentBatchSchema,
  searchCallLeadsSchema,
  searchFormLeadsSchema,
  updateBookedLeadSchema,
  updateCallLeadSchema,
  updateCancelledLeadSchema,
  updateCustomerSchema,
  updateFormLeadSchema,
} from "../validation/v1.validation";
import {
  browseAdminResource,
  exportAdminResourceCsv,
  getAdminFacets,
  getAdminResourceDetail,
  globalAdminSearch,
  type AdminResource,
} from "../services/admin";
import {
  exportAgentSalesReportCsv,
  exportAnalyticsReportCsv,
  getAgentSalesReport,
  getAnalyticsReport,
  getOverviewReport,
} from "../services/analytics";

const router = Router();

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
] as const;

router.get("/api/v1/admin/search", handleAdminSearch);
router.get("/api/v1/admin/facets", handleAdminFacets);
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

router.get("/api/v1/form-leads", handleBrowseFormLeads);
router.get("/api/v1/form-leads/:id", handleFindOne(findFormLead));
router.post("/api/v1/form-leads/search", handleSearchFormLeads);
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
      const parsed = adminBrowseQuerySchema.pick({ database_scope: true }).parse(req.query);
      const data = await getAdminResourceDetail(resource, id, parsed.database_scope);
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
  const log = requestLogger(req);
  const rid = requestId(req);

  log.info({
    msg: "form_lead.request.received",
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
    msg: "form_lead.request.body_keys",
    requestId: rid,
    keys: bodyKeys,
  });

  log.info({
    msg: "form_lead.request.payload_preview",
    requestId: rid,
    preview: sanitizeFormLeadBodyPreview(rawBody),
  });

  try {
    await connectMongo();
    const parsed = createFormLeadSchema.parse(req.body);
    log.info({
      msg: "form_lead.validation.ok",
      requestId: rid,
      fields: Object.keys(parsed),
    });
    const data = await createFormLead(parsed);
    const leadId = data.lead._id.toString();
    log.info({
      msg: "form_lead.created",
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
        msg: "form_lead.validation.failed",
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
        msg: "form_lead.service.error",
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
        msg: "form_lead.create.failed",
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

function sendError(req: Request, res: Response, error: unknown) {
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
  const message = error instanceof Error ? error.message : "Unknown API error";
  return res.status(500).json({
    ok: false,
    error: message,
  });
}

export default router;
