import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { AppError } from "../services/errors";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import {
  createExtensionUser,
  deleteExtensionUser,
  listExtensionUsers,
  updateExtensionUser,
  type AdminExtensionUser,
  type CreateExtensionUserInput,
  type UpdateExtensionUserInput,
} from "../services/extensionUsers";
import {
  createExtensionUserSchema,
  extensionUserIdParamSchema,
  updateExtensionUserSchema,
} from "../validation/v1/extensionUsers.validation";

export type ExtensionUsersAdminDeps = {
  connect?: typeof connectMongo;
  list?: () => Promise<AdminExtensionUser[]>;
  create?: (input: CreateExtensionUserInput) => Promise<AdminExtensionUser>;
  update?: (id: string, input: UpdateExtensionUserInput) => Promise<AdminExtensionUser>;
  delete?: (id: string) => Promise<{ id: string }>;
};

export function createExtensionUsersAdminRouter(
  deps: ExtensionUsersAdminDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const list = deps.list ?? listExtensionUsers;
  const create = deps.create ?? createExtensionUser;
  const update = deps.update ?? updateExtensionUser;
  const remove = deps.delete ?? deleteExtensionUser;

  router.get("/api/v1/admin/extension-users", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const data = await list();
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.post("/api/v1/admin/extension-users", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const parsed = createExtensionUserSchema.parse(req.body);
      const data = await create(parsed);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.patch("/api/v1/admin/extension-users/:id", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const { id } = extensionUserIdParamSchema.parse(req.params);
      const parsed = updateExtensionUserSchema.parse(req.body);
      const data = await update(id, parsed);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.delete("/api/v1/admin/extension-users/:id", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const { id } = extensionUserIdParamSchema.parse(req.params);
      const data = await remove(id);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  return router;
}

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function requestId(req: Request): string | undefined {
  const header = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id");
  return header?.trim() || undefined;
}

function sendError(res: Response, error: unknown, requestIdValue?: string) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
    request_id: requestIdValue ?? null,
  });
}

const router = createExtensionUsersAdminRouter();
export default router;
