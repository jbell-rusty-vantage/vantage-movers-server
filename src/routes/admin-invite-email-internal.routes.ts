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
 *
 * V-T3 m16: the link must be the Admin's own accept-invite page: its origin equals the configured admin base URL
 * (`SALES_INTELLIGENCE_ADMIN_BASE_URL`, the same variable the nudge record links read) and its path is
 * `<base path>/accept-invite`, with no query or userinfo. Without that variable the server answers
 * `not_configured`, so the admin falls back to copy-link; any other link is `invalid_link` (nothing is sent).
 */
export const ADMIN_INVITE_EMAIL_PATH = "/api/v1/internal/admin-invite-email";
export const ACCEPT_INVITE_PATH = "/accept-invite";

/** The configured admin base URL (https, or http on loopback for local runs), or null when unset or unusable. */
export function configuredAdminBaseUrl(raw: string | undefined = process.env.SALES_INTELLIGENCE_ADMIN_BASE_URL): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Whether `link` is `<base>/accept-invite#…` on the configured admin origin. */
export function isAdminAcceptInviteLink(link: string, base: URL): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const expectedPath = `${base.pathname.replace(/\/+$/, "")}${ACCEPT_INVITE_PATH}`;
  return url.origin === base.origin && url.pathname === expectedPath && !url.search && !url.username && !url.password && url.hash.startsWith("#token=") && url.hash.length > "#token=".length;
}

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

    const base = configuredAdminBaseUrl();
    if (!base) return res.status(200).json({ ok: true, data: { status: "not_configured" } });
    if (!isAdminAcceptInviteLink(parsed.data.link, base)) {
      // Never echo the submitted link.
      return res.status(400).json({ ok: false, code: "invalid_link", error: "The invite link must be the Admin's accept-invite page." });
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
