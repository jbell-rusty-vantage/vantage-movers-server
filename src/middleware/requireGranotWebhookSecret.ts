import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { getGranotWebhookSecret } from "../config/domain/granotWebhook";

export type GranotWebhookAuthenticationMethod = "body_secret" | "header_secret";

export type GranotWebhookAuthContext = {
  authentication_method: GranotWebhookAuthenticationMethod;
};

export type GranotWebhookSecretForm =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "present"; value: string };

export type EvaluatedGranotWebhookAuth =
  | {
      ok: true;
      authentication_method: GranotWebhookAuthenticationMethod;
      validated_header: boolean;
      validated_body: boolean;
    }
  | { ok: false };

type RequestWithGranotWebhookAuth = Request & {
  granotWebhookAuth?: GranotWebhookAuthContext;
};

export const GRANOT_WEBHOOK_UNAUTHORIZED_BODY = {
  ok: false,
  code: "GRANOT_WEBHOOK_UNAUTHORIZED",
  error: "Unauthorized",
} as const;

export const GRANOT_WEBHOOK_UNCONFIGURED_BODY = {
  ok: false,
  error: "Granot webhook authentication is not configured",
} as const;

export function getGranotWebhookAuth(
  req: Request,
): GranotWebhookAuthContext | undefined {
  return (req as RequestWithGranotWebhookAuth).granotWebhookAuth;
}

export function readGranotWebhookHeaderSecret(
  headers: IncomingHttpHeaders,
): GranotWebhookSecretForm {
  return readSecretForm(headers["x-api-secret"]);
}

export function readGranotWebhookBodySecret(body: unknown): GranotWebhookSecretForm {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "absent" };
  }
  if (!Object.prototype.hasOwnProperty.call(body, "x-api-secret")) {
    return { kind: "absent" };
  }
  return readSecretForm((body as Record<string, unknown>)["x-api-secret"]);
}

export function deleteGranotWebhookBodySecret(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return;
  }
  delete (body as Record<string, unknown>)["x-api-secret"];
}

export function deleteGranotWebhookHeaderSecret(headers: IncomingHttpHeaders): void {
  delete headers["x-api-secret"];
}

export function evaluateGranotWebhookAuthentication(
  expectedSecret: string,
  headerForm: GranotWebhookSecretForm,
  bodyForm: GranotWebhookSecretForm,
): EvaluatedGranotWebhookAuth {
  if (headerForm.kind === "invalid" || bodyForm.kind === "invalid") {
    return { ok: false };
  }
  if (headerForm.kind === "absent" && bodyForm.kind === "absent") {
    return { ok: false };
  }

  if (headerForm.kind === "present" && bodyForm.kind === "present") {
    const headerMatches = secretsEqual(headerForm.value, expectedSecret);
    const bodyMatches = secretsEqual(bodyForm.value, expectedSecret);
    if (!headerMatches || !bodyMatches) {
      return { ok: false };
    }
    return {
      ok: true,
      authentication_method: "header_secret",
      validated_header: true,
      validated_body: true,
    };
  }

  if (headerForm.kind === "present") {
    if (!secretsEqual(headerForm.value, expectedSecret)) {
      return { ok: false };
    }
    return {
      ok: true,
      authentication_method: "header_secret",
      validated_header: true,
      validated_body: false,
    };
  }

  if (bodyForm.kind !== "present" || !secretsEqual(bodyForm.value, expectedSecret)) {
    return { ok: false };
  }
  return {
    ok: true,
    authentication_method: "body_secret",
    validated_header: false,
    validated_body: true,
  };
}

export function requireGranotWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const headerForm = readGranotWebhookHeaderSecret(req.headers);
  const bodyForm = readGranotWebhookBodySecret(req.body);
  deleteGranotWebhookHeaderSecret(req.headers);
  deleteGranotWebhookBodySecret(req.body);

  const expectedSecret = getGranotWebhookSecret();
  if (!expectedSecret) {
    return res.status(500).json(GRANOT_WEBHOOK_UNCONFIGURED_BODY);
  }

  const evaluated = evaluateGranotWebhookAuthentication(
    expectedSecret,
    headerForm,
    bodyForm,
  );
  if (!evaluated.ok) {
    return res.status(401).json(GRANOT_WEBHOOK_UNAUTHORIZED_BODY);
  }

  (req as RequestWithGranotWebhookAuth).granotWebhookAuth = {
    authentication_method: evaluated.authentication_method,
  };
  return next();
}

function readSecretForm(value: unknown): GranotWebhookSecretForm {
  if (value === undefined) {
    return { kind: "absent" };
  }
  if (Array.isArray(value) || typeof value !== "string") {
    return { kind: "invalid" };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { kind: "absent" };
  }
  return { kind: "present", value: trimmed };
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
