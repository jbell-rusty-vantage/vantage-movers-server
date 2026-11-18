import { Router, type Request } from "express";
import { requireApiSecret, type VantageAuthContext } from "../middleware/requireApiSecret";
import { isRegistryError, requireRegistryOwnerActor } from "../services/operationsRegistry";
import { getEstimatesFreshness } from "../services/granotHttpCollector/runWorkflow";

const router = Router();
router.get("/api/v1/admin/granot-automation/runs/freshness", requireApiSecret, async (req, res) => {
  try {
    const auth = (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
    requireRegistryOwnerActor(req, auth);
    return res.json({ ok: true, data: await getEstimatesFreshness() });
  } catch (error) {
    if (isRegistryError(error)) return res.status(error.statusCode).json(error.toHttpBody());
    return res.status(500).json({ ok: false, code: "GRANOT_AUTOMATION_FAILED", error: "Granot automation failed" });
  }
});

export default router;
