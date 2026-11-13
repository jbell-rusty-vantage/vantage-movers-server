import express, { type Request, type Response } from "express";
import { pipeline } from "node:stream/promises";
import { ZodError } from "zod";
import { requireApiSecret } from "../../middleware/requireApiSecret";
import { requireRegistryOwnerActor } from "../operationsRegistry/trustedActor";
import { CmsError, paginationSchema, restoreSchema, saveSchema, uploadSchema, type CmsActor } from "./contract";
import * as store from "./store";

export const cmsDependencies = { ...store };
type Handler = (req: Request, res: Response) => Promise<void>;
function endpoint(handler: Handler): Handler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof CmsError) { res.status(error.status).json({ ok: false, error: error.message, code: error.code }); return; }
      if (error instanceof ZodError) { res.status(400).json({ ok: false, error: "Invalid content request.", code: "CMS_INVALID_REQUEST" }); return; }
      res.status(503).json({ ok: false, error: "Preview content is temporarily unavailable.", code: "CMS_UNAVAILABLE" });
    }
  };
}
function owner(req: Request): CmsActor {
  try {
    // requireOwner always requires a signature, including local/preview environments.
    const actor = requireRegistryOwnerActor(req);
    return { id: actor.actorId, email: actor.actorLabel, requestId: actor.requestId };
  } catch { throw new CmsError("A signed Owner dashboard session is required.", 403, "CMS_OWNER_REQUIRED"); }
}
export function createSitePreviewCmsRouter() {
  const router = express.Router();
  router.use(requireApiSecret);
  router.use(express.json({ limit: "3mb" }));
  router.get("/", endpoint(async (_req, res) => { res.json({ ok: true, data: await cmsDependencies.readPublicContent() }); }));
  router.get("/testimonials", endpoint(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    res.json({ ok: true, data: await cmsDependencies.listCmsTestimonials(page, limit) });
  }));
  router.get("/media/:id", endpoint(async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") throw new CmsError("Image not found.", 404, "CMS_IMAGE_NOT_FOUND");
    const media = await cmsDependencies.readMedia(id);
    res.setHeader("Content-Type", media.contentType);
    res.setHeader("Content-Length", media.size);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    await pipeline(media.stream, res);
  }));
  router.get("/admin", endpoint(async (req, res) => { owner(req); res.json({ ok: true, data: await cmsDependencies.readContent() }); }));
  router.put("/admin", endpoint(async (req, res) => {
    const actor = owner(req);
    const input = saveSchema.parse(req.body);
    res.json({ ok: true, data: await cmsDependencies.saveContent(input, actor) });
  }));
  router.get("/admin/history", endpoint(async (req, res) => {
    owner(req);
    const { page, limit } = paginationSchema.parse(req.query);
    res.json({ ok: true, data: await cmsDependencies.listHistory(page, limit) });
  }));
  router.post("/admin/restore", endpoint(async (req, res) => {
    const actor = owner(req);
    res.json({ ok: true, data: await cmsDependencies.restoreContent(restoreSchema.parse(req.body), actor) });
  }));
  router.get("/admin/testimonials", endpoint(async (req, res) => {
    owner(req);
    const { page, limit } = paginationSchema.parse(req.query);
    res.json({ ok: true, data: await cmsDependencies.listCmsTestimonials(page, limit, true) });
  }));
  router.post("/admin/media", endpoint(async (req, res) => {
    const actor = owner(req);
    res.status(201).json({ ok: true, data: await cmsDependencies.uploadMedia(uploadSchema.parse(req.body), actor) });
  }));
  router.use((error: Error & { status?: number }, _req: Request, res: Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({ ok: false, error: "Invalid or oversized content request.", code: "CMS_INVALID_REQUEST" });
  });
  return router;
}
