import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { ZodError, type ZodType } from "zod";
import { connectMongo } from "../db";
import { logger as rootLogger } from "../logger";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { searchFormLeads } from "../services/formLeadSearch.service";
import { sanitizeFormLeadBodyPreview } from "../utils/sanitizeFormLeadForLog";
import {
  createBookedLead,
  createCallLead,
  createCancelledLead,
  createCustomer,
  createFormLead,
  deleteBookedLead,
  deleteCallLead,
  deleteCancelledLead,
  deleteCustomer,
  deleteFormLead,
  findAllBookedLeads,
  findAllCallLeads,
  findAllCancelledLeads,
  findAllCustomers,
  findAllFormLeads,
  updateBookedLead,
  updateCallLead,
  updateCancelledLead,
  updateCustomer,
  updateFormLead,
  V1ServiceError,
} from "../services/v1.service";
import {
  createBookedLeadSchema,
  createCallLeadSchema,
  createCancelledLeadSchema,
  createCustomerSchema,
  createFormLeadSchema,
  searchFormLeadsSchema,
  updateBookedLeadSchema,
  updateCallLeadSchema,
  updateCancelledLeadSchema,
  updateCustomerSchema,
  updateFormLeadSchema,
} from "../validation/v1.validation";

const router = Router();

router.use("/api/v1", requireApiSecret);

router.get("/api/v1/form-leads", handleFindAll(findAllFormLeads));
router.post("/api/v1/form-leads/search", handleSearchFormLeads);
router.post("/api/v1/form-leads", handleCreateFormLead);
router.patch("/api/v1/form-leads/:id", handleUpdate(updateFormLeadSchema, updateFormLead));
router.delete("/api/v1/form-leads/:id", handleDelete(deleteFormLead));

router.get("/api/v1/call-leads", handleFindAll(findAllCallLeads));
router.post("/api/v1/call-leads", handleCreate(createCallLeadSchema, createCallLead));
router.patch("/api/v1/call-leads/:id", handleUpdate(updateCallLeadSchema, updateCallLead));
router.delete("/api/v1/call-leads/:id", handleDelete(deleteCallLead));

router.get("/api/v1/booked-leads", handleFindAll(findAllBookedLeads));
router.post("/api/v1/booked-leads", handleCreate(createBookedLeadSchema, createBookedLead));
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
  return async (_req: Request, res: Response) => {
    try {
      await connectMongo();
      const data = await findAll();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
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
      return sendError(res, error);
    }
  };
}

function requestLogger(req: Request): Logger {
  return req.log ?? rootLogger;
}

function requestId(req: Request): string | number | object {
  return req.id ?? "unknown";
}

async function handleSearchFormLeads(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = searchFormLeadsSchema.parse(req.body);
    const data = await searchFormLeads(parsed);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}

async function handleCreateFormLead(req: Request, res: Response) {
  const log = requestLogger(req);
  const rid = requestId(req);

  log.info({
    msg: "form_lead.request.received",
    requestId: rid,
    method: req.method,
    path: req.path,
    originalUrl: (req.originalUrl ?? "").split("?")[0],
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
      sheetSyncStatus: data.sheet_sync_status,
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
      return sendError(res, error);
    }

    if (error instanceof V1ServiceError) {
      log.warn({
        msg: "form_lead.service.error",
        requestId: rid,
        statusCode: error.statusCode,
        message: error.message,
      });
      return sendError(res, error);
    }

    log.error(
      {
        err: error,
        msg: "form_lead.create.failed",
        requestId: rid,
      },
      "Form lead creation failed",
    );
    return sendError(res, error);
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
      return sendError(res, error);
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
      return sendError(res, error);
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

function sendError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    });
  }

  if (error instanceof V1ServiceError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
    });
  }

  const message = error instanceof Error ? error.message : "Unknown API error";
  return res.status(500).json({
    ok: false,
    error: message,
  });
}

export default router;
