import { Router } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import { requireWebhookSecret } from "../middleware/requireWebhookSecret";
import {
  createLead,
  LeadCompanySourceError,
  LeadSheetSyncError,
  updateLead,
} from "../services/lead.service";
import { createLeadSchema, updateLeadSchema } from "../validation/lead.validation";

const router = Router();

router.post("/webhooks/leads", requireWebhookSecret, async (req, res) => {
  try {
    const parsed = createLeadSchema.parse(req.body);

    await connectMongo();
    const lead = await createLead(parsed);

    return res.status(201).json({
      ok: true,
      leadId: lead.leadId,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: "Invalid lead payload",
        issues: error.issues,
      });
    }

    if (error instanceof LeadSheetSyncError) {
      return res.status(502).json({
        ok: false,
        error: error.message,
        leadId: error.leadId,
      });
    }

    if (error instanceof LeadCompanySourceError) {
      return res.status(400).json({
        ok: false,
        error: error.message,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown lead intake error";
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

router.patch("/webhooks/leads/:leadMongoId", requireWebhookSecret, async (req, res) => {
  try {
    const rawLeadMongoId = req.params.leadMongoId;
    const leadMongoId = Array.isArray(rawLeadMongoId) ? rawLeadMongoId[0] : rawLeadMongoId;
    if (!mongoose.isValidObjectId(leadMongoId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid lead Mongo ID",
      });
    }

    const parsed = updateLeadSchema.parse(req.body);

    await connectMongo();
    const lead = await updateLead(leadMongoId, parsed);
    if (!lead) {
      return res.status(404).json({
        ok: false,
        error: "Lead not found",
      });
    }

    return res.status(200).json({
      ok: true,
      leadId: lead.leadId,
      mongoLeadId: lead._id.toString(),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: "Invalid lead update payload",
        issues: error.issues,
      });
    }

    if (error instanceof LeadSheetSyncError) {
      return res.status(502).json({
        ok: false,
        error: error.message,
        leadId: error.leadId,
      });
    }

    if (error instanceof LeadCompanySourceError) {
      return res.status(400).json({
        ok: false,
        error: error.message,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown lead update error";
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

export default router;
