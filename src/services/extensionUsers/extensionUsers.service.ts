import { hashPassword, normalizeEmail } from "../../auth/extension";
import {
  ExtensionUser,
  type ExtensionRole,
  type ExtensionUserDocument,
} from "../../models/ExtensionUser";
import { ConflictError } from "../errors";

export type AdminExtensionUser = {
  id: string;
  email: string;
  role: ExtensionRole;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type CreateExtensionUserInput = {
  email: string;
  password: string;
  role: ExtensionRole;
};

export type ExtensionUserStore = {
  findByEmail(email: string): Promise<{ id: string } | null>;
  create(input: {
    email: string;
    password_hash: string;
    role: ExtensionRole;
  }): Promise<AdminExtensionUser>;
  list(): Promise<AdminExtensionUser[]>;
};

export type ExtensionUserServiceDeps = {
  store?: ExtensionUserStore;
  hashPassword?: (password: string) => Promise<string>;
};

const mongoStore: ExtensionUserStore = {
  async findByEmail(email) {
    const user = await ExtensionUser.findOne({ email }).select({ _id: 1 }).lean();
    return user ? { id: String(user._id) } : null;
  },
  async create(input) {
    const now = new Date();
    const user = await ExtensionUser.create({
      email: input.email,
      password_hash: input.password_hash,
      role: input.role,
      active: true,
      token_version: 0,
      created_at: now,
      updated_at: now,
      password_changed_at: now,
    });
    return toAdminExtensionUser(user);
  },
  async list() {
    const users = await ExtensionUser.find()
      .sort({ created_at: -1 })
      .select({ email: 1, role: 1, active: 1, created_at: 1, last_login_at: 1 })
      .lean();
    return users.map(toAdminExtensionUser);
  },
};

export async function listExtensionUsers(
  deps: ExtensionUserServiceDeps = {},
): Promise<AdminExtensionUser[]> {
  const store = deps.store ?? mongoStore;
  return store.list();
}

export async function createExtensionUser(
  input: CreateExtensionUserInput,
  deps: ExtensionUserServiceDeps = {},
): Promise<AdminExtensionUser> {
  const store = deps.store ?? mongoStore;
  const hash = deps.hashPassword ?? hashPassword;
  const email = normalizeEmail(input.email);
  const existing = await store.findByEmail(email);
  if (existing) {
    throw new ConflictError("An Extension User already uses this email.");
  }

  try {
    return await store.create({
      email,
      password_hash: await hash(input.password),
      role: input.role,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("An Extension User already uses this email.");
    }
    throw error;
  }
}

export function toAdminExtensionUser(
  user: Pick<
    ExtensionUserDocument,
    "email" | "role" | "active" | "created_at" | "last_login_at"
  > & { _id: { toString(): string } },
): AdminExtensionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    active: user.active,
    created_at: toIso(user.created_at),
    last_login_at: user.last_login_at ? toIso(user.last_login_at) : null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === 11000,
  );
}
