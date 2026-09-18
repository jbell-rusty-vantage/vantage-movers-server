import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { csiFlag } from "../config/domain/salesIntelligence";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { getContactNumberDetail } from "../services/numberActivity/contactNumbers";
import { readCaptureCoverage } from "../services/numberActivity/coverage";
import { enqueueNumberRebuild } from "../services/numberActivity/rebuild";
import { numberSearchQuerySchema, searchNumberActivity } from "../services/numberActivity/search";
import { getNumberTimeline } from "../services/numberActivity/timeline";
import { CsiError, requireCsiOwner, assertCurrentScope } from "../services/salesIntelligence/auth";
import { csiCommandSchema, csiIdSchema } from "../validation/v1/salesIntelligence";
import { attachmentListQuerySchema, listAttachments } from "../services/salesIntelligence/attachment/reads";
import { commandAttachment } from "../services/salesIntelligence/attachment/commands";
import { commandOutreach } from "../services/salesIntelligence/followups/commands";
import { listReviewItems, readOutreach, readOutreachByLead } from "../services/salesIntelligence/outreach/reads";
import { attentionQuerySchema, readAttention } from "../services/salesIntelligence/outreach/attention";

/**
 * CSI-04 Owner routes for Number Activity (04 §0, §1 `/numbers` rows, §3).
 *
 * Mounted in `v1.routes.ts` after `requireApiSecret` and after the CSI
 * boundary router (flag + Owner + scope). Every handler still re-checks the
 * flag and the signed Owner identity so the router is safe if mounted alone.
 * Reads never mutate; the rebuild command only enqueues a durable job through
 * the idempotent command ledger (`Idempotency-Key` required). Full customer
 * numbers appear because these routes are Owner-only.
 */
export const CSI_ADMIN_PREFIX = "/api/v1/admin/sales-intelligence";

export type SalesIntelligenceAdminRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  owner?: typeof requireCsiOwner;
  search?: typeof searchNumberActivity;
  detail?: typeof getContactNumberDetail;
  timeline?: typeof getNumberTimeline;
  enqueueRebuild?: typeof enqueueNumberRebuild;
  coverage?: typeof readCaptureCoverage;
  attachments?: typeof listAttachments;
  attachmentCommand?: typeof commandAttachment;
  outreachCommand?: typeof commandOutreach;
};

const timelineQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const STATUS_BY_CODE: Partial<Record<CsiError["code"], number>> = {
  FEATURE_DISABLED: 404,
  OWNER_REQUIRED: 403,
  UNSUPPORTED_SCOPE: 403,
  INVALID_INPUT: 400,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  ILLEGAL_TRANSITION: 409,
  IDENTITY_BLOCKED: 409,
  CONTACT_RESTRICTED: 409,
  OFFICIAL_STATE_BLOCKS_REOPEN: 409,
  EVIDENCE_SCOPE_INVALID: 400,
  SUBMISSION_CONFLICT: 409,
  ATTENTION_SNAPSHOT_EXPIRED: 409,
};

export function createSalesIntelligenceAdminRouter(deps: SalesIntelligenceAdminRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const flag = deps.flag ?? csiFlag;
  const owner = deps.owner ?? requireCsiOwner;
  const search = deps.search ?? searchNumberActivity;
  const detail = deps.detail ?? getContactNumberDetail;
  const timeline = deps.timeline ?? getNumberTimeline;
  const enqueueRebuild = deps.enqueueRebuild ?? enqueueNumberRebuild;

  const guard = (req: Request) => {
    if (!flag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const actor = owner(req);
    assertCurrentScope(req.query.scope, req.body?.scope);
    return actor;
  };
  const fail = (req: Request, res: Response, error: unknown) => {
    const requestId = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable";
    if (error instanceof ZodError) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "Invalid request", request_id: requestId });
    }
    if (error instanceof CsiError) {
      const status = STATUS_BY_CODE[error.code] ?? 500;
      return res.status(status).json({
        ok: false,
        code: error.code,
        error: error.code === "FEATURE_DISABLED" ? "Sales Intelligence is disabled" : "Sales Intelligence request rejected",
        request_id: requestId,
      });
    }
    logger.error({
      msg: "sales_intelligence.admin.route_failed",
      path: req.path,
      errorName: error instanceof Error ? error.name : "Error",
    });
    return res.status(500).json({ ok: false, code: "INVALID_INPUT", error: "Sales Intelligence request failed", request_id: requestId });
  };
  const notFound = (req: Request, res: Response) =>
    res.status(404).json({
      ok: false,
      code: "INVALID_INPUT",
      error: "Number not found",
      request_id: req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable",
    });

  router.get(`${CSI_ADMIN_PREFIX}/coverage`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      const coverage = await (deps.coverage ?? readCaptureCoverage)();
      return res.json({ ok: true, data: { as_of: new Date().toISOString(), coverage } });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/numbers`, async (req, res) => {
    try {
      guard(req);
      const query = numberSearchQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, ...(await search(query)) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id`, async (req, res) => {
    try {
      guard(req);
      const id = csiIdSchema.parse(req.params.id);
      await connect();
      const row = await detail(id);
      if (!row) return notFound(req, res);
      return res.json({ ok: true, ...row });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id/timeline`, async (req, res) => {
    try {
      guard(req);
      const id = csiIdSchema.parse(req.params.id);
      const query = timelineQuerySchema.parse(req.query);
      await connect();
      const page = await timeline(id, { cursor: query.cursor, limit: query.limit });
      if (!page) return notFound(req, res);
      return res.json({ ok: true, ...page });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${CSI_ADMIN_PREFIX}/numbers/:id/rebuild`, async (req, res) => {
    try {
      const actor = guard(req);
      const id = csiIdSchema.parse(req.params.id);
      const idempotencyKey = req.header("idempotency-key")?.trim();
      if (!idempotencyKey) throw new CsiError("INVALID_INPUT");
      const command = csiCommandSchema.parse(req.body);
      if (command.command !== "rebuild_number") throw new CsiError("INVALID_INPUT");
      await connect();
      const result = await enqueueRebuild({
        actor,
        number_id: id,
        expected_revision: command.expected_revision,
        reason: command.reason,
        idempotency_key: idempotencyKey,
      });
      return res.status(202).json({ ok: true, data: result });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/attachments`, async (req, res) => {
    try {
      guard(req);
      const query = attachmentListQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await (deps.attachments ?? listAttachments)(query) });
    } catch (error) { return fail(req, res, error); }
  });
  for (const [path, action] of [["/attachments/attach", "attach_lead"], ["/attachments/:id/reject", "reject_attachment"],
    ["/attachments/:id/detach", "detach_attachment"]] as const) {
    router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
      try {
        const actor = guard(req);
        if (!flag("ATTACHMENT_REFRESH")) throw new CsiError("FEATURE_DISABLED");
        const command = csiCommandSchema.parse(req.body);
        if (command.command !== action || (command.command !== "attach_lead" && command.command !== "reject_attachment" && command.command !== "detach_attachment")) throw new CsiError("INVALID_INPUT");
        const idempotency_key = req.header("idempotency-key")?.trim();
        if (!idempotency_key) throw new CsiError("INVALID_INPUT");
        const attachment_id = action === "attach_lead" ? undefined : csiIdSchema.parse("id" in req.params ? req.params.id : undefined);
        await connect();
        return res.json({ ok: true, data: await (deps.attachmentCommand ?? commandAttachment)({ actor, idempotency_key, attachment_id, command }) });
      } catch (error) { return fail(req, res, error); }
    });
  }
  router.get(`${CSI_ADMIN_PREFIX}/outreach/by-lead/:model/:id`, async (req, res) => {
    try { guard(req); const model = z.enum(["FormLead", "CallLead"]).parse(req.params.model); const id = csiIdSchema.parse(req.params.id);
      await connect(); const result = await readOutreachByLead(model, id); if (!result) return notFound(req, res); return res.json({ ok: true, ...result }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/attention`, async (req, res) => {
    try { guard(req); const query = attentionQuerySchema.parse(req.query); await connect(); return res.json({ ok: true, ...(await readAttention(query)) }); }
    catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.id); await connect(); const result = await readOutreach(id); if (!result) return notFound(req, res); return res.json({ ok: true, ...result }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/review-items`, async (req, res) => {
    try { guard(req); const query = timelineQuerySchema.parse(req.query); if (query.cursor) csiIdSchema.parse(query.cursor); await connect();
      return res.json({ ok: true, ...(await listReviewItems(query)) }); } catch (error) { return fail(req, res, error); }
  });
  for (const [method, path, commands] of [
    ["post", "/outreach/:id/commands", ["mark_worked", "assign", "set_waiting", "close", "reopen", "add_note"]],
    ["post", "/followups", ["create_followup"]], ["patch", "/followups/:id", ["patch_followup"]],
    ["post", "/followups/:id/complete", ["complete_followup"]], ["post", "/followups/:id/snooze", ["snooze_followup"]],
    ["post", "/followups/:id/cancel", ["cancel_followup"]], ["post", "/restrictions/:id/resolve", ["resolve_restriction"]],
    ["post", "/review-items/:id/resolve", ["resolve_review"]], ["post", "/interactions/:id/contact-type", ["set_contact_type"]],
    ["post", "/numbers/:id/open-review", ["open_number_review"]],
  ] as const) router[method](`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      const actor = guard(req); if (!flag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
      const command = csiCommandSchema.parse(req.body);
      if (!(commands as readonly string[]).includes(command.command)) throw new CsiError("INVALID_INPUT");
      const target_id = command.command === "create_followup" ? command.outreach_record_id : csiIdSchema.parse("id" in req.params ? req.params.id : undefined);
      const idempotency_key = req.header("idempotency-key")?.trim(); if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      await connect(); return res.json({ ok: true, data: await (deps.outreachCommand ?? commandOutreach)({ actor, target_id, idempotency_key, command }) });
    } catch (error) { return fail(req, res, error); }
  });
  return router;
}
