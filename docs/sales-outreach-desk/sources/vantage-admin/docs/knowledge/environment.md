---
type: Reference
title: Environment variables
description: Every environment variable the admin dashboard reads, with defaults. Read this instead of searching process.env.
tags: [environment, configuration]
status: draft
stale_after: 2027-03-24
resource: lib/env/server.ts
applies_to:
  - lib/env/server.ts
  - lib/db/adminMongo.ts
  - scripts/seed-admin-user.ts
owners: [team:admin]
sources:
  - id: schema
    resource: lib/env/server.ts
  - id: example
    resource: .env.example
  - id: server-inventory
    resource: ../vantage-main-server/docs/knowledge/environment.md
---

# Environment variables

This is the inventory. Do not grep `process.env` to discover a name. Values are never stored here.

Admin has no OKF query command. The front matter matches the server knowledge stamp so the shape is the same. The server inventory is [`vantage-main-server/docs/knowledge/environment.md`](../../../vantage-main-server/docs/knowledge/environment.md).

The dashboard does not read `SALES_INTELLIGENCE_*`. Sales Intelligence on the local dashboard is whatever the API at `VANTAGE_API_BASE_URL` returns. Point that URL at `https://vantage-movers-main-server.vercel.app` to see production.

Schema: `lib/env/server.ts` (`getServerEnv()`). `.env.example` matches the schema plus the seed script. `next.config.ts` does not declare env. `NEXT_PUBLIC_APP_NAME` is the only `NEXT_PUBLIC_` name, and no client module reads it. The root layout title is the hardcoded string `Vantage Admin`.

## Must match the main server

| Name | Match |
| --- | --- |
| `VANTAGE_API_SECRET` | Same value as the server. Admin sends it as `x-api-secret`. |
| `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` | Same HMAC secret. Admin signs actor headers in `server/auth/trustedProxyHeaders.ts`. Required when `NODE_ENV=production` (minimum 16 characters). |
| `VANTAGE_API_BASE_URL` | Admin-only. The main server origin. Production is `https://vantage-movers-main-server.vercel.app`. The server does not read this name. |

## Application

| Name | Default | Required | Secret | What it does |
| --- | --- | --- | --- | --- |
| `MONGODB_URI` | none | yes | yes | Mongo connection string for the admin auth database (`lib/db/adminMongo.ts`). |
| `ADMIN_AUTH_DB_NAME` | none (example: `vantageadmin`) | yes | no | Database name for admin users and auth. |
| `MONGO_DNS_SERVERS` | none | no | no | Comma-separated DNS servers for Atlas SRV lookups on local Windows. Not in the Zod schema. Ignored when `VERCEL=1` or `NODE_ENV=production`. Example: `8.8.8.8,1.1.1.1`. |
| `ADMIN_ACCESS_TOKEN_SECRET` | none | yes | yes | HMAC secret for access tokens and proxy-audit fingerprints. Minimum 32 characters. |
| `ADMIN_REFRESH_TOKEN_SECRET` | none | yes | yes | Secret for refresh tokens. Minimum 32 characters. Use a different value from the access secret. |
| `ADMIN_ACCESS_TOKEN_TTL_SECONDS` | `900` | no | no | Access-token lifetime and the access-cookie `maxAge`. |
| `ADMIN_REFRESH_TOKEN_TTL_DAYS` | `7` | no | no | Refresh-token lifetime and the refresh-cookie `maxAge`. |
| `VANTAGE_API_BASE_URL` | none | yes | no | Origin for every proxy call. Must be `http` or `https`. |
| `VANTAGE_API_SECRET` | none | yes | yes | Shared API secret. Also hashes the public employee-booking client key. |
| `VANTAGE_API_PROTECTION_BYPASS` | none | no | yes | Preview-only Protection Bypass for the **server** project, sent as `x-vercel-protection-bypass`. Leave unset on Production Admin. This is not `VERCEL_AUTOMATION_BYPASS_SECRET`. Admin never reads that name. |
| `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` | none | required when `NODE_ENV=production` | yes | HMAC for signed actor headers. Optional outside production. Minimum 16 characters. |
| `NEXT_PUBLIC_APP_NAME` | `Vantage Admin` | no | no | Validated and unused. No client code reads it. |
| `EMPLOYEE_BOOKING_PUBLIC_ENABLED` | `false` | no | no | `true` or `false`. Anything other than `true` returns 404 from the public page and APIs. |
| `EMPLOYEE_BOOKING_API_BASE_URL` | `VANTAGE_API_BASE_URL` | no | no | Optional `http` or `https` origin for employee-booking calls. |
| `EMPLOYEE_BOOKING_PUBLIC_BODY_LIMIT_BYTES` | `16384` | no | no | Max body size for the public booking POST. Larger bodies return 413. |
| `NODE_ENV` | set by Next | platform | no | `production` requires the proxy signing secret, sets auth cookies `Secure`, and skips `MONGO_DNS_SERVERS`. |
| `VERCEL` | injected | platform | no | `1` skips `MONGO_DNS_SERVERS`. |

## Seed script

`pnpm seed:admin` runs `scripts/seed-admin-user.ts`. The script also calls `getServerEnv()`, so the required application variables must be set. These three are not in the Zod schema.

| Name | Default | Required | Secret | What it does |
| --- | --- | --- | --- | --- |
| `NEW_SEED_EMAIL` | none | for the seed script | no | Email of the admin user to create or update. |
| `NEW_SEED_PASSWORD` | none | for the seed script | yes | Password hashed into that user. |
| `NEW_SEED_ROLE` | `owner` | no | no | `owner` or `admin`. |

`ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` are local sign-in values named in the workspace rule for agents. Application code does not read them. They are not in `.env.example`.

## Not read by the app

- `VERCEL_AUTOMATION_BYPASS_SECRET` is a comment in `lib/env/server.ts` only. Do not copy it into `VANTAGE_API_PROTECTION_BYPASS`.
- `scripts/csi07-local.mjs` copies operating-system variables into a child process and assigns `SALES_INTELLIGENCE_*`, `TEST_MODE`, and `MONGO_URI` for that child. Admin source does not read those sales-intelligence names.
- GitHub Actions sets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_GIT_*` for the Vercel CLI. The app does not read them.
