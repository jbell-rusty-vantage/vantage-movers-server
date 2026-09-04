---
type: Service
title: Extension Users
description: Owner-only Admin Dashboard create, list, edit, and delete for Extension User email, password, and roles[]. Leftover Employee dual-reads as Sales plus Customer Service; credential or roles change increments access-token token_version.
tags: [extension, owner]
status: draft
stale_after: 2026-12-04
resource: src/services/extensionUsers/extensionUsers.service.ts
applies_to:
  - src/services/extensionUsers/**
  - src/models/ExtensionUser.ts
  - src/routes/extension-users-admin.routes.ts
  - src/validation/v1/extensionUsers.validation.ts
  - src/auth/extension/**
  - scripts/migrations/extension-user-roles-array.ts
  - scripts/migrations/extension-user-roles-array.lib.ts
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
  at: 2026-09-04T21:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/extensionUsers/extensionUsers.service.ts`  
**Domain terms used:** [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md), [Enrichment](../../../../CONTEXT.md), [Binding Estimate Fee](../../../../CONTEXT.md), [Tariff Adjustment](../../../../CONTEXT.md), [Admin Dashboard](../../../../CONTEXT.md)

# Extension Users

**System of record:** MongoDB `extension_users`.

**Role:** [Admin Dashboard](../../../../CONTEXT.md) create, list, edit, and delete of [Extension User](../../../../CONTEXT.md) logins. Does not authenticate the Granot browser extension (`POST /api/v1/extension/auth/login`). Does not create an Agent. Does not run [Enrichment](../../../../CONTEXT.md), [Binding Estimate Fee](../../../../CONTEXT.md), or [Tariff Adjustment](../../../../CONTEXT.md).

Stored field is `roles: Array<"owner" | "sales" | "customer_service">`. At least one. Unique values. Canonical persist order: owner, sales, customer_service. Writes never store `employee`. Dual-read leftover singular `role`: leftover [Employee](../../../../CONTEXT.md) → `["sales", "customer_service"]`; leftover current role → `[role]`. Access is the union of held roles — meanings stay in the glossary: [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md) (retired).

## HTTP

`extension-users-admin.routes.ts`, mounted from `v1.routes.ts` after the `/api/v1` guard.

Owner-only (`requireRegistryOwnerActor`). Admin Dashboard Admin → `403`.

| Operation | Route | Success |
|-----------|-------|---------|
| List | `GET /api/v1/admin/extension-users` | `200 { ok: true, data }` |
| Create | `POST /api/v1/admin/extension-users` | `201 { ok: true, data }` |
| Edit | `PATCH /api/v1/admin/extension-users/:id` | `200 { ok: true, data }` |
| Delete | `DELETE /api/v1/admin/extension-users/:id` | `200 { ok: true, data: { id } }` |

Create body: `{ email, password, roles }`. PATCH body: `{ email?, password?, roles? }` — omitted fields stay unchanged; empty password string is omitted; at least one of email, password, or roles must remain. `roles` is a non-empty array of `owner`, `sales`, or `customer_service`. `employee` or empty `roles` → `400`. Invalid ObjectId → `400`. Unknown id → `404`. Duplicate email → `409` `{ ok: false, error: "An Extension User already uses this email." }`.

The service `normalizeEmail`s (trim + lowercase) before persist and hashes a provided password. Create always stores `active: true` and `token_version: 0`. Write paths `$set` `roles` and `$unset` leftover `role`. DTO (`id`, `email`, `roles`, `active`, `created_at`, `last_login_at`): never includes password or `password_hash`. List is newest `created_at` first, dual-reads leftover Employee as Sales plus Customer Service, and has no `active` filter.

Delete hard-removes the Mongo document. That email may be used on a new create. These routes do not deactivate or reactivate.

## Session invalidation

Access tokens are `{ sub, email, roles, token_version }` (`src/auth/extension/`). An actual email, password, or roles-set change increments `token_version` (roles-set compare is membership, not array order). A no-op PATCH does not. Password change also sets `password_changed_at`. Delete does not bump version — the user is gone. `getExtensionUserFromAccessToken` requires a matching email, roles set, and `token_version`.

## Migration

`pnpm migration:extension-user-roles-array` converts leftover singular `role` to `roles[]` (leftover Employee → Sales plus Customer Service). Report is default. Apply is gated (`--apply --confirm-production=<db>`) and increments `token_version` only on converted rows. This desk applied once against the configured database; apply is not a standing production runbook. It does not print passwords or hashes.

`pnpm migration:extension-user-roles-sales-backfill` remains the earlier email-list remap of selected leftover Employee logins to Sales. It does not create users.

`scripts/dev_ops/upsert-extension-user.ts` can still change password, roles, and active outside this HTTP service.

## Invariants

- Unique email.
- Password never leaves the server after create or edit.
- Admin Dashboard Admin cannot list, create, edit, or delete.
- Creating an Extension User does not create an Agent.
- Employee cannot be created or PATCHed.

## Not the same as

- [`catalog.md`](./catalog.md) — Agents and merchants.
- [`extension-apply.md`](../granot-lifecycle/extension-apply.md) — Owner apply after login.
- [`tariff.md`](./tariff.md) — Tariff Adjustment Submit after login.
