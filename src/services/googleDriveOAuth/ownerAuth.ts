import type { Request, Response } from "express";
import type { VantageAuthContext } from "../../middleware/requireApiSecret";
import { getGoogleDriveOAuthConfig } from "../../config/domain";
import {
  requireRegistryOwnerActor,
  type RegistryActorContext,
} from "../operationsRegistry";
import { isRegistryError } from "../operationsRegistry/errors";
import {
  googleDriveOwnerAccessRequiredResponse,
  sanitizeGoogleDriveApiError,
} from "./oauthSecurity";

export function requireGoogleDriveOwnerActor(req: Request): RegistryActorContext {
  const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
  if (!auth || auth.kind === "scoped_key") {
    throw new GoogleDriveOwnerAccessRequiredError();
  }

  const actor = requireRegistryOwnerActor(req, auth);
  const configuredOwnerEmail = getGoogleDriveOAuthConfig().ownerEmail;
  if (actor.actorLabel !== configuredOwnerEmail) {
    throw new GoogleDriveOwnerAccessRequiredError();
  }
  return actor;
}

export function enforceGoogleDriveOwnerAccess(
  req: Request,
  res: Response,
  next: () => void,
): void {
  try {
    requireGoogleDriveOwnerActor(req);
    next();
  } catch (error) {
    if (error instanceof GoogleDriveOwnerAccessRequiredError) {
      const response = googleDriveOwnerAccessRequiredResponse();
      res.status(response.status).json(response.body);
      return;
    }
    if (isRegistryError(error)) {
      res.status(error.statusCode).json(error.toHttpBody());
      return;
    }
    const serialized = sanitizeGoogleDriveApiError(error);
    res.status(serialized.status).json(serialized.body);
  }
}

export class GoogleDriveOwnerAccessRequiredError extends Error {
  constructor() {
    super("Signed owner dashboard access is required.");
    this.name = "GoogleDriveOwnerAccessRequiredError";
  }
}
