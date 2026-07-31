import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  activateRingCentralRoute,
  createOrUpdateRingCentralRoute,
  deactivateRingCentralRoute,
  getRingCentralInboundRoute,
  isRegistryError,
  listRingCentralInboundRoutes,
  previewRingCentralRouteDependencies,
  reassignRingCentralRoute,
  requireRegistryOwnerActor,
  requireRegistryReadActor,
  validateRingCentralRoute,
} from "../services/operationsRegistry";
import {
  ringCentralRouteAssignmentSchema,
  ringCentralRouteCreateSchema,
  ringCentralRouteListQuerySchema,
  ringCentralRouteReasonSchema,
  ringCentralRouteUpdateSchema,
} from "../validation/v1.validation";
import { isObjectIdString } from "../utils/objectId";

const router = Router();

router.get("/api/v1/admin/ringcentral/inbound-routes", async (req, res) => {
  try {
    await connectMongo();
    requireRegistryReadActor(req, auth(req));
    const query = ringCentralRouteListQuerySchema.parse(req.query);
    const data = await listRingCentralInboundRoutes({
      includeInactive: query.include_inactive,
      includeHistory: query.include_history,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(
  "/api/v1/admin/ringcentral/inbound-routes/:id",
  async (req, res) => {
    try {
      await connectMongo();
      requireRegistryReadActor(req, auth(req));
      const data = await getRingCentralInboundRoute(routeId(req));
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.post("/api/v1/admin/ringcentral/inbound-routes", async (req, res) => {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, auth(req));
    const command = ringCentralRouteCreateSchema.parse(req.body);
    const data = await createOrUpdateRingCentralRoute(command, actor);
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch("/api/v1/admin/ringcentral/inbound-routes/:id", async (req, res) => {
  try {
    await connectMongo();
    const actor = requireRegistryOwnerActor(req, auth(req));
    const id = routeId(req);
    const command = ringCentralRouteUpdateSchema.parse(req.body);
    const data = await createOrUpdateRingCentralRoute({ id, ...command }, actor);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/validate",
  async (req, res) => {
    try {
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, auth(req));
      const command = ringCentralRouteReasonSchema.parse(req.body ?? {});
      const data = await validateRingCentralRoute(
        { id: routeId(req), reason: command.reason },
        actor,
      );
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/activate",
  assignmentHandler("activate"),
);
router.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/reassign",
  assignmentHandler("reassign"),
);

router.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/deactivate",
  async (req, res) => {
    try {
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, auth(req));
      const command = ringCentralRouteReasonSchema.parse(req.body ?? {});
      const data = await deactivateRingCentralRoute(
        { id: routeId(req), reason: command.reason },
        actor,
      );
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.get(
  "/api/v1/admin/ringcentral/inbound-routes/:id/dependencies",
  async (req, res) => {
    try {
      await connectMongo();
      requireRegistryReadActor(req, auth(req));
      const data = await previewRingCentralRouteDependencies(routeId(req));
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

function assignmentHandler(action: "activate" | "reassign") {
  return async (req: Request, res: Response) => {
    try {
      await connectMongo();
      const actor = requireRegistryOwnerActor(req, auth(req));
      const command = ringCentralRouteAssignmentSchema.parse(req.body);
      const input = {
        id: routeId(req),
        source_granularity_id: command.source_granularity_id,
        reason: command.reason,
      };
      const data = action === "activate"
        ? await activateRingCentralRoute(input, actor)
        : await reassignRingCentralRoute(input, actor);
      return res.json({ ok: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function routeId(req: Request): string {
  const value = req.params.id;
  if (typeof value !== "string" || !isObjectIdString(value)) {
    throw new ZodError([]);
  }
  return value;
}

function sendError(res: Response, error: unknown) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody());
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request",
      issues: error.issues,
    });
  }
  throw error;
}

export default router;
