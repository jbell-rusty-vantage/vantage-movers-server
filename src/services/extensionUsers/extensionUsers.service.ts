import { hashPassword, normalizeEmail } from "../../auth/extension";
import {
  normalizeExtensionRoles,
  resolveStoredExtensionRoles,
  rolesSetsEqual,
  type CurrentExtensionRole,
} from "../../auth/extension/roles";
import {
  ExtensionUser,
  type ExtensionUserDocument,
} from "../../models/ExtensionUser";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";

const DUPLICATE_EMAIL_MESSAGE = "An Extension User already uses this email.";
const NOT_FOUND_MESSAGE = "Extension User not found.";

export type AdminExtensionUser = {
  id: string;
  email: string;
  roles: CurrentExtensionRole[];
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type CreateExtensionUserInput = {
  email: string;
  password: string;
  roles: CurrentExtensionRole[];
};

export type UpdateExtensionUserInput = {
  email?: string;
  password?: string;
  roles?: CurrentExtensionRole[];
};

export type StoredExtensionUserRecord = {
  id: string;
  email: string;
  roles?: unknown;
  role?: unknown;
  password_hash: string;
  token_version: number;
  active: boolean;
  created_at: Date | string;
  last_login_at?: Date | string | null;
};

export type ExtensionUserStoreUpdate = {
  email?: string;
  password_hash?: string;
  roles?: CurrentExtensionRole[];
  increment_token_version: boolean;
  set_password_changed_at: boolean;
};

export type ExtensionUserStore = {
  findByEmail(email: string): Promise<{ id: string } | null>;
  findById(id: string): Promise<StoredExtensionUserRecord | null>;
  create(input: {
    email: string;
    password_hash: string;
    roles: CurrentExtensionRole[];
  }): Promise<AdminExtensionUser>;
  update(id: string, patch: ExtensionUserStoreUpdate): Promise<AdminExtensionUser | null>;
  delete(id: string): Promise<{ id: string } | null>;
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
  async findById(id) {
    const user = await ExtensionUser.findById(id)
      .select({
        email: 1,
        roles: 1,
        role: 1,
        password_hash: 1,
        token_version: 1,
        active: 1,
        created_at: 1,
        last_login_at: 1,
      })
      .lean();
    if (!user) {
      return null;
    }
    return {
      id: String(user._id),
      email: user.email,
      roles: user.roles,
      role: user.role,
      password_hash: user.password_hash,
      token_version: user.token_version,
      active: user.active,
      created_at: user.created_at,
      last_login_at: user.last_login_at ?? null,
    };
  },
  async create(input) {
    const now = new Date();
    const user = await ExtensionUser.create({
      email: input.email,
      password_hash: input.password_hash,
      roles: input.roles,
      active: true,
      token_version: 0,
      created_at: now,
      updated_at: now,
      password_changed_at: now,
    });
    return toAdminExtensionUser(user);
  },
  async update(id, patch) {
    const now = new Date();
    const $set: Record<string, unknown> = { updated_at: now };
    if (patch.email !== undefined) {
      $set.email = patch.email;
    }
    if (patch.password_hash !== undefined) {
      $set.password_hash = patch.password_hash;
    }
    if (patch.roles !== undefined) {
      $set.roles = patch.roles;
    }
    if (patch.set_password_changed_at) {
      $set.password_changed_at = now;
    }

    const update: Record<string, unknown> = {
      $set,
      $unset: { role: 1 },
    };
    if (patch.increment_token_version) {
      update.$inc = { token_version: 1 };
    }

    const user = await ExtensionUser.findByIdAndUpdate(id, update, { new: true });
    return user ? toAdminExtensionUser(user) : null;
  },
  async delete(id) {
    const user = await ExtensionUser.findByIdAndDelete(id).select({ _id: 1 }).lean();
    return user ? { id: String(user._id) } : null;
  },
  async list() {
    const users = await ExtensionUser.find()
      .sort({ created_at: -1 })
      .select({ email: 1, roles: 1, role: 1, active: 1, created_at: 1, last_login_at: 1 })
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
  const roles = requireNormalizedRoles(input.roles);
  const existing = await store.findByEmail(email);
  if (existing) {
    throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);
  }

  try {
    return await store.create({
      email,
      password_hash: await hash(input.password),
      roles,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);
    }
    throw error;
  }
}

export async function updateExtensionUser(
  id: string,
  input: UpdateExtensionUserInput,
  deps: ExtensionUserServiceDeps = {},
): Promise<AdminExtensionUser> {
  const store = deps.store ?? mongoStore;
  const hash = deps.hashPassword ?? hashPassword;
  const user = await store.findById(id);
  if (!user) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }

  const storedRoles = resolveStoredExtensionRoles(user);
  if (!storedRoles) {
    throw new BadRequestError("Extension User roles are invalid.");
  }

  const nextEmail = input.email !== undefined ? normalizeEmail(input.email) : user.email;
  const nextRoles =
    input.roles !== undefined ? requireNormalizedRoles(input.roles) : storedRoles;
  const passwordChanged = Boolean(input.password);
  const emailChanged = nextEmail !== user.email;
  const rolesChanged = input.roles !== undefined && !rolesSetsEqual(nextRoles, storedRoles);

  if (!emailChanged && !passwordChanged && !rolesChanged) {
    return toAdminExtensionUser({
      _id: { toString: () => user.id },
      email: user.email,
      roles: storedRoles,
      role: user.role,
      active: user.active,
      created_at: user.created_at,
      last_login_at: user.last_login_at ?? null,
    });
  }

  if (emailChanged) {
    const existing = await store.findByEmail(nextEmail);
    if (existing && existing.id !== id) {
      throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);
    }
  }

  try {
    const updated = await store.update(id, {
      email: emailChanged ? nextEmail : undefined,
      password_hash: passwordChanged && input.password ? await hash(input.password) : undefined,
      roles: nextRoles,
      increment_token_version: true,
      set_password_changed_at: passwordChanged,
    });
    if (!updated) {
      throw new NotFoundError(NOT_FOUND_MESSAGE);
    }
    return updated;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);
    }
    throw error;
  }
}

export async function deleteExtensionUser(
  id: string,
  deps: ExtensionUserServiceDeps = {},
): Promise<{ id: string }> {
  const store = deps.store ?? mongoStore;
  const deleted = await store.delete(id);
  if (!deleted) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  return deleted;
}

export function toAdminExtensionUser(
  user: Pick<ExtensionUserDocument, "email" | "active"> & {
    _id: { toString(): string };
    roles?: unknown;
    role?: unknown;
    created_at: Date | string;
    last_login_at?: Date | string | null;
  },
): AdminExtensionUser {
  const roles = resolveStoredExtensionRoles(user);
  if (!roles) {
    throw new BadRequestError("Extension User roles are invalid.");
  }
  return {
    id: user._id.toString(),
    email: user.email,
    roles,
    active: user.active,
    created_at: toIso(user.created_at),
    last_login_at: user.last_login_at ? toIso(user.last_login_at) : null,
  };
}

function requireNormalizedRoles(input: unknown): CurrentExtensionRole[] {
  const roles = normalizeExtensionRoles(input);
  if (!roles) {
    throw new BadRequestError("Invalid request payload");
  }
  return roles;
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
