import mongoose from "mongoose";
import { connectMongo } from "../../db";
import {
  ExtensionUser,
  type ExtensionUserDocument,
} from "../../models/ExtensionUser";
import { verifyPassword } from "./password";
import {
  resolveStoredExtensionRoles,
  rolesSetsEqual,
  type CurrentExtensionRole,
} from "./roles";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type AccessTokenPayload,
  type VerifiedAccessToken,
} from "./tokens";
import type { AuthTokens, PublicExtensionUser } from "./types";

export type StoredExtensionUserForAccess = {
  email: string;
  active?: boolean;
  token_version: number;
  roles?: unknown;
  role?: unknown;
};

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

  const roles = resolveStoredExtensionRoles(user);
  if (!roles) {
    return null;
  }

  user.last_login_at = new Date();
  await user.save();

  return {
    user: toPublicExtensionUser(user, roles),
    tokens: issueTokens(user, roles),
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

  if (!mongoose.isValidObjectId(payload.sub)) {
    return null;
  }

  await connectMongo();
  const user = await ExtensionUser.findOne({ _id: payload.sub, active: true });
  if (!user || !refreshTokenMatchesStoredUser(payload, user)) {
    return null;
  }

  const roles = resolveStoredExtensionRoles(user);
  if (!roles) {
    return null;
  }

  return {
    user: toPublicExtensionUser(user, roles),
    tokens: issueTokens(user, roles),
  };
}

export async function getExtensionUserFromAccessToken(
  accessToken: string,
  lookup: AccessTokenUserLookup = mongoAccessTokenLookup,
): Promise<PublicExtensionUser | null> {
  let payload: VerifiedAccessToken;

  try {
    payload = verifyAccessToken(accessToken);
  } catch {
    return null;
  }

  if (!mongoose.isValidObjectId(payload.sub)) {
    return null;
  }

  const user = await lookup.findActiveById(payload.sub);
  if (!user || !accessTokenMatchesStoredUser(payload, user)) {
    return null;
  }

  const roles = resolveStoredExtensionRoles(user);
  if (!roles) {
    return null;
  }

  return toPublicExtensionUser(user, roles);
}

export function accessTokenMatchesStoredUser(
  payload: Pick<AccessTokenPayload, "email" | "roles" | "token_version">,
  user: StoredExtensionUserForAccess | null | undefined,
): boolean {
  if (!user || user.active === false) {
    return false;
  }
  if (payload.email !== user.email) {
    return false;
  }
  const storedRoles = resolveStoredExtensionRoles(user);
  if (!storedRoles || payload.roles.length === 0) {
    return false;
  }
  if (!rolesSetsEqual(payload.roles, storedRoles)) {
    return false;
  }
  if (typeof payload.token_version !== "number" || payload.token_version !== user.token_version) {
    return false;
  }
  return true;
}

export function refreshTokenMatchesStoredUser(
  payload: { token_version: number },
  user: StoredExtensionUserForAccess | null | undefined,
): boolean {
  if (!user || user.active === false) {
    return false;
  }
  return user.token_version === payload.token_version;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function issueTokens(
  user: Pick<ExtensionUserDocument, "email" | "token_version"> & {
    _id: { toString(): string };
  },
  roles: CurrentExtensionRole[],
): AuthTokens {
  return {
    accessToken: signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      roles,
      token_version: user.token_version,
    }),
    refreshToken: signRefreshToken({
      sub: user._id.toString(),
      token_version: user.token_version,
    }),
  };
}

export function toPublicExtensionUser(
  user: { email: string; _id: { toString(): string } },
  roles: CurrentExtensionRole[],
): PublicExtensionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    roles,
  };
}

export type AccessTokenUserLookup = {
  findActiveById(id: string): Promise<StoredExtensionUserForAccess & { _id: { toString(): string } } | null>;
};

const mongoAccessTokenLookup: AccessTokenUserLookup = {
  async findActiveById(id) {
    await connectMongo();
    return ExtensionUser.findOne({ _id: id, active: true });
  },
};
