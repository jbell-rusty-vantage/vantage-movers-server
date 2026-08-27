import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import { recordOperationalEvent } from "../services/observability";
import {
  getConversationById,
  issueConversationAudioUrl,
  listConversations,
  listConversationsByLead,
  toConversationDetail,
} from "../services/conversations";
import { LEAD_CONVERSATION_LEAD_MODELS } from "../config/domain/conversations";

const leadParamsSchema = z.object({
  model: z.enum(LEAD_CONVERSATION_LEAD_MODELS),
  id: z.string().trim().min(1),
});

const idParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export type ConversationsAdminDeps = {
  connect?: typeof connectMongo;
  list?: typeof listConversations;
  listByLead?: typeof listConversationsByLead;
  getById?: typeof getConversationById;
  issueAudioUrl?: typeof issueConversationAudioUrl;
  auditAudio?: typeof recordOperationalEvent;
};

export function createConversationsAdminRouter(
  deps: ConversationsAdminDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const list = deps.list ?? listConversations;
  const listByLead = deps.listByLead ?? listConversationsByLead;
  const getById = deps.getById ?? getConversationById;
  const issueAudioUrl = deps.issueAudioUrl ?? issueConversationAudioUrl;
  const auditAudio = deps.auditAudio ?? recordOperationalEvent;

  router.get("/api/v1/admin/conversations", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const data = await list();
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/conversations/by-lead/:model/:id", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const params = leadParamsSchema.parse(req.params);
      const data = await listByLead(params);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/conversations/:id/audio-url", async (req, res) => {
    try {
      await connect();
      const actor = requireRegistryOwnerActor(req, auth(req));
      const { id } = idParamsSchema.parse(req.params);
      const conversation = await getById(id);
      if (!conversation) {
        return res.status(404).json({
          ok: false,
          error: "conversation_not_found",
          request_id: requestId(req) ?? null,
        });
      }
      const pathname = conversation.media?.blob_pathname;
      if (!pathname || conversation.media?.purged_at) {
        return res.status(409).json({
          ok: false,
          error: "conversation_audio_unavailable",
          request_id: requestId(req) ?? null,
        });
      }
      const data = await issueAudioUrl(pathname);
      await auditAudio({
        level: "info",
        eventKey: "conversation.audio_url.issued",
        category: "admin",
        workflow: "conversations",
        summary: "Owner issued a short-lived conversation audio URL",
        request: req,
        entity: { type: "LeadConversation", id: String(conversation._id) },
        jobNo: conversation.normalized_job_no,
        details: {
          conversation_id: String(conversation._id),
          actor_id: actor.actorId,
          expires_at: data.expires_at,
        },
        piiPolicy: "none",
        reportable: true,
      });
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/conversations/:id", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const { id } = idParamsSchema.parse(req.params);
      const conversation = await getById(id);
      if (!conversation) {
        return res.status(404).json({
          ok: false,
          error: "conversation_not_found",
          request_id: requestId(req) ?? null,
        });
      }
      return res.status(200).json({ ok: true, data: toConversationDetail(conversation) });
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
      error: "invalid_conversation_query",
      request_id: requestIdValue ?? null,
    });
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
    request_id: requestIdValue ?? null,
  });
}

const router = createConversationsAdminRouter();
export default router;
