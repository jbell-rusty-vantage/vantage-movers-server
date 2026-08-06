import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getGranotWebhookSecret } from "../config/domain/granotWebhook";

export function requireGranotWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expectedSecret = getGranotWebhookSecret();
  if (!expectedSecret) {
    return res.status(500).json({
      ok: false,
      error: "Granot webhook authentication is not configured",
    });
  }

  const providedSecret = req.header("x-api-secret")?.trim();
  if (!providedSecret || !secretsEqual(providedSecret, expectedSecret)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  return next();
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
