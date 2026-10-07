/**
 * Systems tab (doc 11b): where every property lives, and how long until the database and the Master Sheets are
 * full. Mounted behind `requireApiSecret` in `v1.routes.ts`. Owner-only: the dashboard proxy signs the actor and
 * the server verifies it, like the Operations Registry. Policy lives in `services/systems/`; these handlers parse,
 * gate and translate errors.
 */
import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import { logger } from "../logger";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { isRegistryError, requireRegistryOwnerActor } from "../services/operationsRegistry";
import type { RegistryActorContext } from "../services/operationsRegistry/types";
import { getSystemsCapacity, getSystemsLocations, patchSystemsLocations } from "../services/systems";
import {
  firstSystemsValidationMessage,
  systemsCapacityQuerySchema,
  systemsLocationsPatchSchema,
} from "../validation/v1/systems.validation";

export type SystemsAdminRouteDeps = {
  connect?: typeof connectMongo;
  locations?: typeof getSystemsLocations;
  patchLocations?: typeof patchSystemsLocations;
  capacity?: typeof getSystemsCapacity;
  requireOwner?: (req: Request) => RegistryActorContext;
};

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function sendError(req: Request, res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({ ok: false, error: firstSystemsValidationMessage(error), issues: error.issues });
  }
  if (isRegistryError(error)) {
    const status = error.statusCode === 409 ? 409 : 403;
    return res.status(status).json({
      ok: false,
      error: status === 409 ? error.message : "Systems is for the Owner only.",
      registry_code: error.registryCode,
      remediation: error.remediation,
    });
  }
  ((req as Request & { log?: typeof logger }).log ?? logger).error({ msg: "systems.request_failed", err: error });
  return res.status(500).json({ ok: false, error: "Systems could not be read. Try again in a minute." });
}

export function createSystemsAdminRouter(deps: SystemsAdminRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const requireOwner = deps.requireOwner ?? ((req: Request) => requireRegistryOwnerActor(req, auth(req)));

  router.get("/api/v1/admin/systems/locations", async (req, res) => {
    try {
      requireOwner(req);
      await connect();
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, data: await (deps.locations ?? getSystemsLocations)() });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.patch("/api/v1/admin/systems/locations", async (req, res) => {
    try {
      const actor = requireOwner(req);
      const patch = systemsLocationsPatchSchema.parse(req.body);
      await connect();
      return res.json({ ok: true, data: await (deps.patchLocations ?? patchSystemsLocations)(patch, actor) });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.get("/api/v1/admin/systems/capacity", async (req, res) => {
    try {
      requireOwner(req);
      const query = systemsCapacityQuerySchema.parse(req.query);
      await connect();
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, data: await (deps.capacity ?? getSystemsCapacity)(query) });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  return router;
}

export default createSystemsAdminRouter();
