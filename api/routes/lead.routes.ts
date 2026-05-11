import { Router } from "express";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import { requireWebhookSecret } from "../middleware/requireWebhookSecret";
import { createLead, LeadSheetSyncError } from "../services/lead.service";
import { createLeadSchema } from "../validation/lead.validation";

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

    const message = error instanceof Error ? error.message : "Unknown lead intake error";
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

export default router;
