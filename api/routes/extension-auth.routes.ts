import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import {
  authenticateExtensionUser,
  getExtensionUserFromAccessToken,
  refreshExtensionSession,
  type PublicExtensionUser,
} from "../auth/extension";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post("/api/v1/extension/auth/login", async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const session = await authenticateExtensionUser(parsed.email, parsed.password);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    return res.json({
      ok: true,
      data: {
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
      },
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post("/api/v1/extension/auth/refresh", async (req, res) => {
  try {
    const parsed = refreshSchema.parse(req.body);
    const session = await refreshExtensionSession(parsed.refreshToken);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid refresh token" });
    }

    return res.json({
      ok: true,
      data: {
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
      },
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.get("/api/v1/extension/auth/me", async (req, res) => {
  const user = await readBearerUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  return res.json({ ok: true, data: { user } });
});

router.post("/api/v1/extension/auth/logout", (_req, res) => {
  return res.json({ ok: true });
});

async function readBearerUser(req: Request): Promise<PublicExtensionUser | null> {
  const authorization = req.header("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();
  if (!token) {
    return null;
  }

  return getExtensionUserFromAccessToken(token);
}

function sendAuthError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    });
  }

  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Extension auth failed",
  });
}

export default router;
