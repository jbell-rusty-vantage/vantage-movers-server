import type { NextFunction, Request, Response } from "express";

export function requireApiSecret(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.VANTAGE_API_SECRET?.trim();
  const providedSecret = req.header("x-api-secret")?.trim();

  if (!expectedSecret) {
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_API_SECRET is not set",
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
