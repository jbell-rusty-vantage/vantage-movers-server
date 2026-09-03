import assert from "node:assert/strict";
import test from "node:test";
import { ConflictError } from "../errors";
import {
  createExtensionUser,
  listExtensionUsers,
  type AdminExtensionUser,
  type ExtensionUserStore,
} from "./extensionUsers.service";

function memoryStore(seed: AdminExtensionUser[] = []): ExtensionUserStore & {
  created: Array<{ email: string; password_hash: string; role: string }>;
} {
  const users = [...seed];
  const created: Array<{ email: string; password_hash: string; role: string }> = [];
  return {
    created,
    async findByEmail(email) {
      const user = users.find((row) => row.email === email);
      return user ? { id: user.id } : null;
    },
    async create(input) {
      created.push(input);
      const user: AdminExtensionUser = {
        id: `user-${users.length + 1}`,
        email: input.email,
        role: input.role,
        active: true,
        created_at: "2026-09-03T16:00:00.000Z",
        last_login_at: null,
      };
      users.push(user);
      return user;
    },
    async list() {
      return [...users];
    },
  };
}

test("createExtensionUser stores a hashed password and never returns the secret", async () => {
  const store = memoryStore();
  const user = await createExtensionUser(
    { email: "  Owner@Vantage.com ", password: "secret-pass", role: "owner" },
    { store, hashPassword: async (password) => `hashed:${password}` },
  );

  assert.equal(user.email, "owner@vantage.com");
  assert.equal(user.role, "owner");
  assert.equal(user.active, true);
  assert.equal("password" in user, false);
  assert.equal("password_hash" in user, false);
  assert.deepEqual(store.created, [
    {
      email: "owner@vantage.com",
      password_hash: "hashed:secret-pass",
      role: "owner",
    },
  ]);
});

test("createExtensionUser rejects a duplicate email", async () => {
  const store = memoryStore([
    {
      id: "existing",
      email: "rep@vantage.com",
      role: "sales",
      active: true,
      created_at: "2026-09-01T12:00:00.000Z",
      last_login_at: null,
    },
  ]);

  await assert.rejects(
    () =>
      createExtensionUser(
        { email: "Rep@Vantage.com", password: "secret-pass", role: "sales" },
        { store, hashPassword: async () => "hashed" },
      ),
    (error: unknown) =>
      error instanceof ConflictError &&
      error.message === "An Extension User already uses this email.",
  );
  assert.equal(store.created.length, 0);
});

test("listExtensionUsers returns the stored rows without secrets", async () => {
  const listed = await listExtensionUsers({
    store: memoryStore([
      {
        id: "owner-1",
        email: "owner@vantage.com",
        role: "owner",
        active: true,
        created_at: "2026-09-03T16:00:00.000Z",
        last_login_at: "2026-09-03T17:00:00.000Z",
      },
    ]),
  });

  assert.deepEqual(listed, [
    {
      id: "owner-1",
      email: "owner@vantage.com",
      role: "owner",
      active: true,
      created_at: "2026-09-03T16:00:00.000Z",
      last_login_at: "2026-09-03T17:00:00.000Z",
    },
  ]);
  assert.equal("password_hash" in listed[0]!, false);
});
