import type { Response } from "express";
import { ZodError } from "zod";
import type { SalesOutreachErrorCode } from "../../config/domain/salesOutreach";
import { logger } from "../../logger";
import { ServiceUnavailableError } from "../errors";
import { CsiError } from "../salesIntelligence/auth";

/** Bounded `path` / `code` pairs, never submitted values. */
export type OutreachIssue = Readonly<{ path: string; code: string; message?: string }>;

export class OutreachError extends Error {
  constructor(
    readonly code: SalesOutreachErrorCode,
    readonly issues?: readonly OutreachIssue[],
  ) {
    super(code);
    this.name = "OutreachError";
  }
}

const STATUS: Record<SalesOutreachErrorCode, number> = {
  FORBIDDEN: 403,
  REP_NOT_LINKED: 403,
  INVALID_INPUT: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CURSOR_EXPIRED: 409,
  CONFIGURATION_UNAVAILABLE: 503,
  PROJECTION_PENDING: 503,
  SERVICE_UNAVAILABLE: 503,
};

/** CSI command primitives the desk reuses keep their codes; anything else is a refusal or a server failure. */
function fromCsi(error: CsiError): OutreachError {
  switch (error.code) {
    case "REVISION_CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
    case "INVALID_INPUT":
    case "FORBIDDEN":
      return new OutreachError(error.code, error.issues);
    case "OWNER_REQUIRED":
      return new OutreachError("FORBIDDEN");
    case "UNSUPPORTED_SCOPE":
      return new OutreachError("INVALID_INPUT", [{ path: "scope", code: "unsupported_scope" }]);
    case "INDEX_REQUIRED":
      return new OutreachError("SERVICE_UNAVAILABLE", [{ path: "indexes", code: "index_required" }]);
    default:
      return new OutreachError("FORBIDDEN");
  }
}

export function zodIssues(error: ZodError): OutreachIssue[] {
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    ...(issue.code === "custom" && issue.message ? { message: issue.message.slice(0, 200) } : {}),
  }));
}

export function toOutreachError(error: unknown): OutreachError | null {
  if (error instanceof OutreachError) return error;
  if (error instanceof CsiError) return fromCsi(error);
  if (error instanceof ZodError) return new OutreachError("INVALID_INPUT", zodIssues(error));
  if (error instanceof ServiceUnavailableError) return new OutreachError("SERVICE_UNAVAILABLE");
  return null;
}

/** The CSI `{ ok:false, code, error, request_id }` envelope with the sod-v1 status mapping (CONTRACTS "HTTP interface"). */
export function sendOutreachError(res: Response, error: unknown, requestId: string, path: string): Response {
  const known = toOutreachError(error);
  if (!known) {
    logger.error({ msg: "sales_outreach.route_failed", path, errorName: error instanceof Error ? error.name : "Error" });
    return res.status(500).json({ ok: false, code: "INTERNAL", error: "Sales Outreach request failed", request_id: requestId });
  }
  return res.status(STATUS[known.code]).json({
    ok: false,
    code: known.code,
    error: "Sales Outreach request rejected",
    request_id: requestId,
    ...(known.issues?.length ? { issues: known.issues } : {}),
  });
}
