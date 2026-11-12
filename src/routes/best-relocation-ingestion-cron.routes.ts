import { Router } from "express";
const router = Router();
/** Compatibility endpoint acknowledges old schedulers without reading sources or Mongo. */
router.all("/api/cron/best-relocation-ingest-heartbeat", (_req, res) => {
  return res.json({ ok: true, skipped: true, reason: "retired" });
});
export function envGateEnabled(_value?: string): boolean { return false; }
export function ingestionHeartbeatSkipReason(_input: {
  env_enabled: boolean; application_enabled: boolean; next_due_at: Date | null; now: Date;
}): "retired" { return "retired"; }
export default router;
