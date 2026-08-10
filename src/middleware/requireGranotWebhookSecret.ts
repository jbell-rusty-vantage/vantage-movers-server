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

  const providedSecret =
    req.header("x-api-secret")?.trim() || getBodySecret(req.body);
  if (!providedSecret || !secretsEqual(providedSecret, expectedSecret)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  removeBodySecret(req.body);

  return next();
}

function getBodySecret(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)["x-api-secret"];
  return typeof value === "string" ? value.trim() : undefined;
}

function removeBodySecret(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return;
  }

  delete (body as Record<string, unknown>)["x-api-secret"];
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
