import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import { isRegistryError, requireRegistryOwnerActor } from "../services/operationsRegistry";
import { REGISTRY_ERROR_CODES } from "../services/errors/registryErrorCodes";
import {
  sendAdminInviteEmail,
  type AdminInviteEmailDeps,
  type AdminInviteEmailInput,
  type AdminInviteEmailResult,
} from "../services/adminInvites/inviteEmail.service";

/**
 * S8-USERS: the admin dashboard asks the main server to email an Admin user
 * invite link. Mounted behind `requireApiSecret` (x-api-secret) and, in the
 * handler, the signed Owner actor headers (`VANTAGE_ADMIN_PROXY_SIGNING_SECRET`,
 * same canonical payload as the admin proxy). The body carries the link, so the
 * handler never logs the body, the link or the recipient.
 */
export const ADMIN_INVITE_EMAIL_PATH = "/api/v1/internal/admin-invite-email";

const bodySchema = z
  .object({
    to: z.string().trim().toLowerCase().email().max(254),
    link: z
      .string()
      .max(2048)
      .url()
      .refine((value) => /^https?:\/\//i.test(value), "link must be http(s)"),
    expires_at: z.string().datetime(),
  })
  .strict();

export type AdminInviteEmailRouterDeps = {
  send?: (input: AdminInviteEmailInput, deps?: AdminInviteEmailDeps) => Promise<AdminInviteEmailResult>;
};

const UNAUTHENTICATED_CODES = new Set<string>([
  REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
  REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID,
  REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED,
]);

export function createAdminInviteEmailRouter(deps: AdminInviteEmailRouterDeps = {}): Router {
  const router = Router();
  const send = deps.send ?? sendAdminInviteEmail;

  router.post(ADMIN_INVITE_EMAIL_PATH, async (req: Request, res: Response) => {
    try {
      requireRegistryOwnerActor(req, (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth);
    } catch (error) {
      if (isRegistryError(error) && UNAUTHENTICATED_CODES.has(error.registryCode)) {
        return res.status(401).json({ ok: false, code: "unauthorized", error: "Signed Owner actor required." });
      }
      return res.status(403).json({ ok: false, code: "forbidden", error: "Owner only." });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      // Field paths only: never echo the submitted link.
      return res.status(400).json({
        ok: false,
        code: "invalid_input",
        error: "Invalid invite email request.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
      });
    }

    const result = await send({
      to: parsed.data.to,
      link: parsed.data.link,
      expiresAt: new Date(parsed.data.expires_at),
    });
    return res.status(200).json({ ok: true, data: result });
  });

  return router;
}

const router = createAdminInviteEmailRouter();
export default router;
