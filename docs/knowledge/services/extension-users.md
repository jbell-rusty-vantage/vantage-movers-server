---
type: Service
title: Extension Users
description: Owner-only Admin Dashboard create and list for Extension User email, password, and Owner, Sales, or Customer Service role.
tags: [extension, owner]
status: draft
stale_after: 2026-12-03
resource: src/services/extensionUsers/extensionUsers.service.ts
applies_to:
  - src/services/extensionUsers/**
  - src/models/ExtensionUser.ts
  - src/routes/extension-users-admin.routes.ts
  - src/validation/v1/extensionUsers.validation.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/extensionUsers/extensionUsers.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-03T16:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/extensionUsers/extensionUsers.service.ts`  
**Domain terms used:** [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md), [Enrichment](../../../../CONTEXT.md), [Binding Estimate Fee](../../../../CONTEXT.md), [Tariff Adjustment](../../../../CONTEXT.md), [Admin Dashboard](../../../../CONTEXT.md)

# Extension Users

**System of record:** MongoDB `extension_users`.

**Role:** [Admin Dashboard](../../../../CONTEXT.md) create and list of [Extension User](../../../../CONTEXT.md) logins. Does not authenticate the Granot browser extension (`POST /api/v1/extension/auth/login`). Does not create an Agent. Does not run [Enrichment](../../../../CONTEXT.md), [Binding Estimate Fee](../../../../CONTEXT.md), or [Tariff Adjustment](../../../../CONTEXT.md).

Stored `role` is `owner`, `sales`, `customer_service`, or legacy `employee`. Create `role` is `owner`, `sales`, or `customer_service` — new users cannot be created as `employee`. Meanings stay in the glossary: [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md) (legacy).

## HTTP

`extension-users-admin.routes.ts`, mounted from `v1.routes.ts` after the `/api/v1` guard.

Owner-only (`requireRegistryOwnerActor`). Admin Dashboard Admin → `403`.

| Operation | Route | Success |
|-----------|-------|---------|
| List | `GET /api/v1/admin/extension-users` | `200 { ok: true, data }` |
| Create | `POST /api/v1/admin/extension-users` | `201 { ok: true, data }` |

Create body (`createExtensionUserSchema`): `{ email, password, role }`. Email must be a valid email; password min 8; `role` is `owner`, `sales`, or `customer_service`. Invalid body → `400`.

The service `normalizeEmail`s (trim + lowercase) before persist and hashes the password. Create always stores `active: true` and `token_version: 0`. Duplicate email → `409` `{ ok: false, error: "An Extension User already uses this email." }` (pre-check and unique-index race).

DTO (`id`, `email`, `role`, `active`, `created_at`, `last_login_at`): never includes password or `password_hash`. `last_login_at` is `null` until login. List is newest `created_at` first and has no `active` filter.

No PATCH, deactivate, or DELETE on these routes. `scripts/dev_ops/upsert-extension-user.ts` can change password, role, and active outside this HTTP service. `pnpm migration:extension-user-roles-sales-backfill` remaps selected leftover Employee logins to Sales (report is default; apply is gated and increments `token_version`). It does not create users.

## Invariants

- Unique email.
- Password never leaves the server after create.
- Admin Dashboard Admin cannot list or create.
- Creating an Extension User does not create an Agent.

## Not the same as

- [`catalog.md`](./catalog.md) — Agents and merchants.
- [`extension-apply.md`](../granot-lifecycle/extension-apply.md) — Owner apply after login.
- [`tariff.md`](./tariff.md) — Tariff Adjustment Submit after login.
