import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { getGoogleDriveOAuthConfig } from "../config/domain";
import { logger } from "../logger";
import { requireApiSecret } from "../middleware/requireApiSecret";
import {
  beginGoogleDriveOAuth,
  completeGoogleDriveOAuth,
  createGoogleDriveFolder,
  createOAuthTestSpreadsheet,
  disconnectGoogleDrive,
  getGoogleDriveConnectionStatus,
  getGoogleDriveOAuthPublicConfig,
  sanitizeGoogleDriveConnectionStatus,
} from "../services/googleDriveOAuth";
import {
  bootstrapGooglePicker,
  verifyGooglePickerSelection,
} from "../services/googleDriveOAuth/picker.service";
import { enforceGoogleDriveOwnerAccess } from "../services/googleDriveOAuth/ownerAuth";
import {
  publicMessageForCategory,
  sanitizeGoogleDriveApiError,
  sanitizeGoogleDriveCallbackLog,
} from "../services/googleDriveOAuth/oauthSecurity";
import {
  googleDriveCreateFolderSchema,
  googleDriveTestSpreadsheetSchema,
  googleOAuthCallbackQuerySchema,
  googleOAuthErrorQuerySchema,
} from "../validation/v1.validation";
import {
  googlePickerBootstrapSchema,
  googlePickerSelectionVerifySchema,
} from "../validation/reportingDestination.validation";
import { emitReportingOAuthHealthFailure } from "../services/reporting/reportingObservability";

const router = Router();
const BASE_PATH = "/api/v1/admin/google-drive";

router.get(`${BASE_PATH}/oauth/callback`, handleOAuthCallback);

router.post(
  `${BASE_PATH}/oauth/authorize`,
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  async (_req, res) => {
    try {
      const data = await beginGoogleDriveOAuth();
      return res.json({ ok: true, data });
    } catch (error) {
      await recordOAuthHealthFailure(error);
      return sendApiError(res, error);
    }
  },
);

router.get(
  `${BASE_PATH}/status`,
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  async (_req, res) => {
    try {
      const [status, publicConfig] = await Promise.all([
        getGoogleDriveConnectionStatus(),
        Promise.resolve(getGoogleDriveOAuthPublicConfig()),
      ]);
      const data = {
        ...sanitizeGoogleDriveConnectionStatus(status),
        config: publicConfig,
      };
      return res.json({ ok: true, data });
    } catch (error) {
      await recordOAuthHealthFailure(error);
      return sendApiError(res, error);
    }
  },
);

router.post(
  `${BASE_PATH}/picker/bootstrap`,
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  async (req, res) => {
    try {
      const input = googlePickerBootstrapSchema.parse(req.body ?? {});
      const data = await bootstrapGooglePicker(input.flow);
      return res.json({ ok: true, data });
    } catch (error) {
      await recordOAuthHealthFailure(error);
      return sendApiError(res, error);
    }
  },
);

router.post(
  `${BASE_PATH}/picker/selections/verify`,
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  async (req, res) => {
    try {
      const input = googlePickerSelectionVerifySchema.parse(req.body ?? {});
      const data = await verifyGooglePickerSelection({
        selectionNonce: input.selection_nonce,
        fileId: input.file_id,
        displayName: input.display_name,
        displayUrl: input.display_url,
        parentFolderId: input.parent_folder_id,
      });
      return res.json({ ok: true, data });
    } catch (error) {
      return sendApiError(res, error);
    }
  },
);

router.post(
  `${BASE_PATH}/folders`,
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
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
  enforceGoogleDriveOwnerAccess,
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
  enforceGoogleDriveOwnerAccess,
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
      category: "oauth_provider_error",
    });
    return sendCompletionPage(
      res,
      false,
      publicMessageForCategory("oauth_provider_error"),
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
      category: "connected",
    });
    return sendCompletionPage(
      res,
      true,
      "Google Drive is connected. You can close this window and return to Vantage.",
    );
  } catch (error) {
    const sanitized = sanitizeGoogleDriveCallbackLog(error);
    await emitReportingOAuthHealthFailure({
      reason: sanitized.category,
    }).catch(() => undefined);
    logger.error({
      msg: "google_drive.oauth.callback_failed",
      category: sanitized.category,
      errorName: sanitized.errorName,
    });
    return sendCompletionPage(
      res,
      false,
      publicMessageForCategory(sanitized.category),
      sanitized.category === "google_drive_unavailable" ? 500 : 400,
    );
  }
}

async function recordOAuthHealthFailure(error: unknown): Promise<void> {
  if (error instanceof ZodError) return;
  const serialized = sanitizeGoogleDriveApiError(error);
  await emitReportingOAuthHealthFailure({
    reason: String(serialized.body.code ?? "oauth_health_failed"),
  }).catch(() => undefined);
}

function sendApiError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      error: "Invalid request",
      issues: error.issues,
    });
  }
  const serialized = sanitizeGoogleDriveApiError(error);
  if (serialized.status >= 500) {
    logger.error({
      msg: "google_drive.api.failed",
      category: serialized.body.code,
    });
  }
  return res.status(serialized.status).json(serialized.body);
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

export default router;
