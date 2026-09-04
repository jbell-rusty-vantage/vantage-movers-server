import assert from "node:assert/strict";
import test from "node:test";
import { ConflictError, NotFoundError } from "../errors";
import {
  createExtensionUser,
  deleteExtensionUser,
  listExtensionUsers,
  toAdminExtensionUser,
  updateExtensionUser,
  type AdminExtensionUser,
  type ExtensionUserStore,
  type StoredExtensionUserRecord,
} from "./extensionUsers.service";

type MemoryRow = StoredExtensionUserRecord;

function memoryStore(seed: MemoryRow[] = []): ExtensionUserStore & {
  created: Array<{ email: string; password_hash: string; roles: string[] }>;
  rows: MemoryRow[];
} {
  const users = seed.map((row) => ({ ...row }));
  const created: Array<{ email: string; password_hash: string; roles: string[] }> = [];
  return {
    created,
    rows: users,
    async findByEmail(email) {
      const user = users.find((row) => row.email === email);
      return user ? { id: user.id } : null;
    },
    async findById(id) {
      const user = users.find((row) => row.id === id);
      return user ? { ...user } : null;
    },
    async create(input) {
      created.push(input);
      const user: MemoryRow = {
        id: `user-${users.length + 1}`,
        email: input.email,
        password_hash: input.password_hash,
        roles: input.roles,
        token_version: 0,
        active: true,
        created_at: "2026-09-03T16:00:00.000Z",
        last_login_at: null,
      };
      users.push(user);
      return toAdmin(user);
    },
    async update(id, patch) {
      const user = users.find((row) => row.id === id);
      if (!user) {
        return null;
      }
      if (patch.email !== undefined) {
        user.email = patch.email;
      }
      if (patch.password_hash !== undefined) {
        user.password_hash = patch.password_hash;
      }
      if (patch.roles !== undefined) {
        user.roles = patch.roles;
        delete user.role;
      }
      if (patch.increment_token_version) {
        user.token_version += 1;
      }
      return toAdmin(user);
    },
    async delete(id) {
      const index = users.findIndex((row) => row.id === id);
      if (index < 0) {
        return null;
      }
      users.splice(index, 1);
      return { id };
    },
    async list() {
      return users.map(toAdmin);
    },
  };
}

function toAdmin(user: MemoryRow): AdminExtensionUser {
  return toAdminExtensionUser({
    _id: { toString: () => user.id },
    email: user.email,
    roles: user.roles,
    role: user.role,
    active: user.active,
    created_at: user.created_at,
    last_login_at: user.last_login_at ?? null,
  });
}

test("createExtensionUser persists canonical roles and never returns the secret", async () => {
  const store = memoryStore();
  const user = await createExtensionUser(
    {
      email: "  Rep@Vantage.com ",
      password: "secret-pass",
      roles: ["customer_service", "sales"],
    },
    { store, hashPassword: async (password) => `hashed:${password}` },
  );

  assert.deepEqual(user.roles, ["sales", "customer_service"]);
  assert.equal(user.email, "rep@vantage.com");
  assert.equal("password" in user, false);
  assert.equal("password_hash" in user, false);
  assert.equal("role" in user, false);
  assert.deepEqual(store.created, [
    {
      email: "rep@vantage.com",
      password_hash: "hashed:secret-pass",
      roles: ["sales", "customer_service"],
    },
  ]);
});

test("createExtensionUser rejects a duplicate email", async () => {
  const store = memoryStore([
    {
      id: "existing",
      email: "rep@vantage.com",
      password_hash: "hashed",
      roles: ["sales"],
      token_version: 0,
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
  ]);

  await assert.rejects(
    () =>
      createExtensionUser(
        { email: "Rep@Vantage.com", password: "secret-pass", roles: ["sales"] },
        { store, hashPassword: async () => "hashed" },
      ),
    (error: unknown) =>
      error instanceof ConflictError &&
      error.message === "An Extension User already uses this email.",
  );
  assert.equal(store.created.length, 0);
});

test("listExtensionUsers returns roles and dual-reads leftover employee", async () => {
  const listed = await listExtensionUsers({
    store: memoryStore([
      {
        id: "owner-1",
        email: "owner@vantage.com",
        password_hash: "hashed",
        roles: ["owner"],
        token_version: 1,
        active: true,
        created_at: "2026-09-03T16:00:00.000Z",
        last_login_at: "2026-09-03T17:00:00.000Z",
      },
      {
        id: "legacy-1",
        email: "legacy@vantage.com",
        password_hash: "hashed",
        role: "employee",
        token_version: 2,
        active: true,
        created_at: "2026-09-02T16:00:00.000Z",
        last_login_at: null,
      },
    ]),
  });

  assert.deepEqual(listed[0]?.roles, ["owner"]);
  assert.deepEqual(listed[1]?.roles, ["sales", "customer_service"]);
  assert.equal("role" in listed[0]!, false);
  assert.equal("employee" in (listed[1] ?? {}), false);
  assert.equal(listed[1]?.roles.includes("employee" as never), false);
});

test("toAdminExtensionUser dual-reads leftover employee as Sales plus Customer Service", () => {
  const admin = toAdminExtensionUser({
    _id: { toString: () => "legacy-1" },
    email: "legacy@vantage.com",
    role: "employee",
    active: true,
    created_at: "2026-09-02T16:00:00.000Z",
    last_login_at: null,
  });
  assert.deepEqual(admin.roles, ["sales", "customer_service"]);
  assert.equal("role" in admin, false);
});

test("updateExtensionUser bumps token_version only on actual email, password, or roles change", async () => {
  const store = memoryStore([
    {
      id: "user-1",
      email: "rep@vantage.com",
      password_hash: "hashed:old",
      roles: ["sales", "customer_service"],
      token_version: 4,
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
  ]);

  const sameRoles = await updateExtensionUser(
    "user-1",
    { roles: ["customer_service", "sales"] },
    { store, hashPassword: async () => "unused" },
  );
  assert.deepEqual(sameRoles.roles, ["sales", "customer_service"]);
  assert.equal(store.rows[0]?.token_version, 4);

  const sameEmail = await updateExtensionUser(
    "user-1",
    { email: "Rep@Vantage.com" },
    { store, hashPassword: async () => "unused" },
  );
  assert.equal(sameEmail.email, "rep@vantage.com");
  assert.equal(store.rows[0]?.token_version, 4);

  await updateExtensionUser(
    "user-1",
    { email: "new@vantage.com" },
    { store, hashPassword: async () => "unused" },
  );
  assert.equal(store.rows[0]?.token_version, 5);
  assert.equal(store.rows[0]?.email, "new@vantage.com");

  await updateExtensionUser(
    "user-1",
    { password: "new-secret" },
    { store, hashPassword: async (password) => `hashed:${password}` },
  );
  assert.equal(store.rows[0]?.token_version, 6);
  assert.equal(store.rows[0]?.password_hash, "hashed:new-secret");

  await updateExtensionUser(
    "user-1",
    { roles: ["owner"] },
    { store, hashPassword: async () => "unused" },
  );
  assert.equal(store.rows[0]?.token_version, 7);
  assert.deepEqual(store.rows[0]?.roles, ["owner"]);
});

test("updateExtensionUser rejects a duplicate email with the create message", async () => {
  const store = memoryStore([
    {
      id: "user-1",
      email: "rep@vantage.com",
      password_hash: "hashed",
      roles: ["sales"],
      token_version: 0,
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
    {
      id: "user-2",
      email: "taken@vantage.com",
      password_hash: "hashed",
      roles: ["owner"],
      token_version: 0,
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
  ]);

  await assert.rejects(
    () =>
      updateExtensionUser(
        "user-1",
        { email: "Taken@Vantage.com" },
        { store, hashPassword: async () => "hashed" },
      ),
    (error: unknown) =>
      error instanceof ConflictError &&
      error.message === "An Extension User already uses this email.",
  );
});

test("updateExtensionUser returns not found for a missing id", async () => {
  const store = memoryStore();
  await assert.rejects(
    () => updateExtensionUser("missing", { email: "a@b.com" }, { store }),
    (error: unknown) =>
      error instanceof NotFoundError && error.message === "Extension User not found.",
  );
});

test("deleteExtensionUser removes the row so the email can be reused", async () => {
  const store = memoryStore([
    {
      id: "user-1",
      email: "rep@vantage.com",
      password_hash: "hashed",
      roles: ["sales"],
      token_version: 1,
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
  ]);

  const deleted = await deleteExtensionUser("user-1", { store });
  assert.deepEqual(deleted, { id: "user-1" });
  assert.equal(store.rows.length, 0);

  const created = await createExtensionUser(
    { email: "rep@vantage.com", password: "secret-pass", roles: ["sales"] },
    { store, hashPassword: async () => "hashed" },
  );
  assert.equal(created.email, "rep@vantage.com");
});

test("deleteExtensionUser returns not found for a missing id", async () => {
  const store = memoryStore();
  await assert.rejects(
    () => deleteExtensionUser("missing", { store }),
    (error: unknown) =>
      error instanceof NotFoundError && error.message === "Extension User not found.",
  );
});
