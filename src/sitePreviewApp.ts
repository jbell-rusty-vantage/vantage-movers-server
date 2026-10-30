import express from "express";
import app from "./app";
import { assertSitePreviewEnvironment, isSitePreviewRequestAllowed } from "./config/sitePreview";

assertSitePreviewEnvironment(process.env);
const preview = express();
preview.use((req, res, next) => {
  if (!isSitePreviewRequestAllowed(req.method, req.path)) {
    res.status(404).json({ ok: false, error: "Route unavailable on the website preview API" });
    return;
  }
  next();
});
preview.use(app);
export default preview;
