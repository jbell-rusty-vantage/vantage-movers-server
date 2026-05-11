import type { NextFunction, Request, Response } from "express";

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.LEAD_WEBHOOK_SECRET?.trim();
  const providedSecret = req.header("x-webhook-secret")?.trim();

  if (!expectedSecret) {
    return res.status(500).json({
      ok: false,
      error: "LEAD_WEBHOOK_SECRET is not set",
    });
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  return next();
}
