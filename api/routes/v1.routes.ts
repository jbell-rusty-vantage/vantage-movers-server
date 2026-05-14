import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { ZodError, type ZodType } from "zod";
import { connectMongo } from "../db";
import { requireApiSecret } from "../middleware/requireApiSecret";
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
  updateBookedLeadSchema,
  updateCallLeadSchema,
  updateCancelledLeadSchema,
  updateCustomerSchema,
  updateFormLeadSchema,
} from "../validation/v1.validation";

const router = Router();

router.use("/api/v1", requireApiSecret);

router.get("/api/v1/form-leads", handleFindAll(findAllFormLeads));
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

async function handleCreateFormLead(req: Request, res: Response) {
  try {
    await connectMongo();
    const parsed = createFormLeadSchema.parse(req.body);
    const data = await createFormLead(parsed);
    res.status(201).json({ ok: true, data });
    console.log("Sent FormLead create response; background sheet sync remains asynchronous", {
      statusCode: res.statusCode,
    });
    return;
  } catch (error) {
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
