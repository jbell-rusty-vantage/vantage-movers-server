import mongoose from "mongoose";
import { connectMongo } from "../../db";
import {
  ExtensionUser,
  type ExtensionUserDocument,
} from "../../models/ExtensionUser";
import { verifyPassword } from "./password";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type VerifiedAccessToken,
} from "./tokens";
import type { AuthTokens, PublicExtensionUser } from "./types";

export async function authenticateExtensionUser(
  email: string,
  password: string,
): Promise<{ user: PublicExtensionUser; tokens: AuthTokens } | null> {
  await connectMongo();

  const normalizedEmail = normalizeEmail(email);
  const user = await ExtensionUser.findOne({ email: normalizedEmail, active: true });
  if (!user) {
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    return null;
  }

  user.last_login_at = new Date();
  await user.save();

  return {
    user: toPublicExtensionUser(user),
    tokens: issueTokens(user),
  };
}

export async function refreshExtensionSession(
  refreshToken: string,
): Promise<{ user: PublicExtensionUser; tokens: AuthTokens } | null> {
  let payload: ReturnType<typeof verifyRefreshToken>;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(payload.sub)) {
    return null;
  }

  await connectMongo();
  const user = await ExtensionUser.findOne({ _id: payload.sub, active: true });
  if (!user || user.token_version !== payload.token_version) {
    return null;
  }

  return {
    user: toPublicExtensionUser(user),
    tokens: issueTokens(user),
  };
}

export async function getExtensionUserFromAccessToken(
  accessToken: string,
): Promise<PublicExtensionUser | null> {
  let payload: VerifiedAccessToken;

  try {
    payload = verifyAccessToken(accessToken);
  } catch {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(payload.sub)) {
    return null;
  }

  await connectMongo();
  const user = await ExtensionUser.findOne({ _id: payload.sub, active: true });
  if (!user || user.email !== payload.email || user.role !== payload.role) {
    return null;
  }

  return toPublicExtensionUser(user);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function issueTokens(user: ExtensionUserDocument): AuthTokens {
  return {
    accessToken: signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    }),
    refreshToken: signRefreshToken({
      sub: user._id.toString(),
      token_version: user.token_version,
    }),
  };
}

function toPublicExtensionUser(user: ExtensionUserDocument): PublicExtensionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
  };
}
