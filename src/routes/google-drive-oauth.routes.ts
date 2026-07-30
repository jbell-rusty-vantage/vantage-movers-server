import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { getGoogleDriveOAuthConfig } from "../config/domain";
import { logger } from "../logger";
import {
  requireApiSecret,
  type VantageAuthContext,
} from "../middleware/requireApiSecret";
import { AppError } from "../services/errors";
import {
  beginGoogleDriveOAuth,
  completeGoogleDriveOAuth,
  createGoogleDriveFolder,
  createOAuthTestSpreadsheet,
  disconnectGoogleDrive,
  getGoogleDriveConnectionStatus,
} from "../services/googleDriveOAuth";
import {
  googleDriveCreateFolderSchema,
  googleDriveTestSpreadsheetSchema,
  googleOAuthCallbackQuerySchema,
  googleOAuthErrorQuerySchema,
} from "../validation/v1.validation";

const router = Router();
const BASE_PATH = "/api/v1/admin/google-drive";

router.get(`${BASE_PATH}/oauth/callback`, handleOAuthCallback);

router.post(
  `${BASE_PATH}/oauth/authorize`,
  requireApiSecret,
  requireOwnerConnectionAccess,
  async (_req, res) => {
    try {
      const data = await beginGoogleDriveOAuth();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

router.get(
  `${BASE_PATH}/status`,
  requireApiSecret,
  requireOwnerConnectionAccess,
  async (_req, res) => {
    try {
      const data = await getGoogleDriveConnectionStatus();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

router.post(
  `${BASE_PATH}/folders`,
  requireApiSecret,
  requireOwnerConnectionAccess,
  async (req, res) => {
    try {
      const input = googleDriveCreateFolderSchema.parse(req.body ?? {});
      const data = await createGoogleDriveFolder({
        name: input.name,
        parentFolderId: input.parent_folder_id,
      });
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

router.delete(
  `${BASE_PATH}/connection`,
  requireApiSecret,
  requireOwnerConnectionAccess,
  async (_req, res) => {
    try {
      const data = await disconnectGoogleDrive();
      return res.json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

router.post(
  `${BASE_PATH}/test-spreadsheet`,
  requireApiSecret,
  requireOwnerConnectionAccess,
  async (req, res) => {
    try {
      const input = googleDriveTestSpreadsheetSchema.parse(req.body ?? {});
      const data = await createOAuthTestSpreadsheet({
        title: input.title,
        folderId: input.folder_id,
      });
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

async function handleOAuthCallback(req: Request, res: Response) {
  const denied = googleOAuthErrorQuerySchema.safeParse(req.query);
  if (denied.success) {
    logger.warn({
      msg: "google_drive.oauth.denied",
      googleError: denied.data.error,
    });
    return sendCompletionPage(
      res,
      false,
      "Google Drive authorization was cancelled or denied.",
    );
  }

  try {
    const query = googleOAuthCallbackQuerySchema.parse(req.query);
    const status = await completeGoogleDriveOAuth(query.code, query.state);
    if (!status.connected) {
      throw new Error("Google Drive connection was not persisted");
    }
    logger.info({
      msg: "google_drive.oauth.connected",
      ownerDomain: emailDomain(status.owner_email),
    });
    return sendCompletionPage(
      res,
      true,
      "Google Drive is connected. You can close this window and return to Vantage.",
    );
  } catch (error) {
    logger.error({
      msg: "google_drive.oauth.callback_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage:
        error instanceof Error ? error.message : "OAuth callback failed",
    });
    return sendCompletionPage(
      res,
      false,
      error instanceof AppError
        ? error.message
        : "Google Drive authorization could not be completed.",
      error instanceof AppError ? error.statusCode : 500,
    );
  }
}

function requireOwnerConnectionAccess(
  req: Request,
  res: Response,
  next: () => void,
): void {
  const auth = (
    req as Request & { vantageAuth?: VantageAuthContext }
  ).vantageAuth;
  if (!auth || auth.kind === "scoped_key") {
    res.status(403).json({ ok: false, error: "Owner access is required" });
    return;
  }

  if (auth.kind === "user") {
    let ownerEmail: string;
    try {
      ownerEmail = getGoogleDriveOAuthConfig().ownerEmail;
    } catch (error) {
      sendApiError(res, error);
      return;
    }
    if (
      auth.role !== "owner" ||
      auth.email.trim().toLowerCase() !== ownerEmail
    ) {
      res.status(403).json({ ok: false, error: "Owner access is required" });
      return;
    }
  }
  next();
}

function sendApiError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request",
      issues: error.issues,
    });
  }
  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json({ ok: false, error: error.message });
  }

  logger.error({
    msg: "google_drive.api.failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage:
      error instanceof Error ? error.message : "Google Drive request failed",
  });
  return res.status(500).json({
    ok: false,
    error: "Google Drive integration is not configured or temporarily unavailable",
  });
}

function sendCompletionPage(
  res: Response,
  success: boolean,
  message: string,
  statusCode = success ? 200 : 400,
) {
  const redirectUrl = completionRedirectUrl(success);
  if (redirectUrl) {
    return res.redirect(303, redirectUrl);
  }

  res.status(statusCode);
  res.type("html");
  return res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${success ? "Google Drive connected" : "Google Drive connection failed"}</title>
  </head>
  <body>
    <main>
      <h1>${success ? "Google Drive connected" : "Connection failed"}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`);
}

function completionRedirectUrl(success: boolean): string | undefined {
  try {
    const configured =
      getGoogleDriveOAuthConfig().completionRedirectUrl;
    if (!configured) return undefined;
    const url = new URL(configured);
    url.searchParams.set(
      "google_drive",
      success ? "connected" : "error",
    );
    return url.toString();
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function emailDomain(email: string): string {
  return email.split("@")[1] ?? "unknown";
}

export default router;
