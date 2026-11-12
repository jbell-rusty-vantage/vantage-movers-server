import express from "express";
import app from "./app";
import { assertSitePreviewEnvironment, isSitePreviewRequestAllowed } from "./config/sitePreview";
import { requireApiSecret } from "./middleware/requireApiSecret";
import { connectMongo } from "./db";
import { analyticsQuerySchema } from "./validation/v1/analytics.validation";
import { getAnalyticsReport } from "./services/analytics/analytics.service";
import { AppError } from "./services/errors";

assertSitePreviewEnvironment(process.env);
const preview = express();
preview.use((req, res, next) => {
  if (!isSitePreviewRequestAllowed(req.method, req.path)) {
    res.status(404).json({ ok: false, error: "Route unavailable on the website preview API" });
    return;
  }
  next();
});
// Preview-only read surface; does not expose admin commands or lifecycle writes.
preview.get("/api/v1/site-preview/website-outcomes", requireApiSecret, async (req, res) => {
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ ok: false, error: "Invalid report interval" }); return; }
  try {
    await connectMongo();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, source_sha: process.env.DEPLOYMENT_COMMIT_SHA ?? null, data: await getAnalyticsReport("website-outcomes", parsed.data) });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ ok: false, error: error instanceof AppError ? error.message : "Report unavailable" });
  }
});
preview.use(app);
export default preview;
