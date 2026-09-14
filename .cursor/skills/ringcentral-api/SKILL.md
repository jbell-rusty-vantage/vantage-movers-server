---
name: ringcentral-api
description: Call RingCentral RingEX APIs (JWT OAuth, Call Log, recordings, telephony webhooks, Analytics, RingSense) from vantage-main-server using native fetch. Use when writing or running a scripts/dev_ops/ringcentral probe, exploring call history, recordings, subscriptions, or analytics, or when the user mentions the RingCentral API, Call Log, RingSense, or RC JWT.
---

# RingCentral API

Work from `vantage-main-server`. This skill is the **RingCentral platform** (their servers). For **this server's** HTTP API use `.cursor/skills/hit-vantage-api/`. For Call Qualification / Call Lead Ingest invariants, read the Service — do not invent them here.

Never read `.env` into chat. Never print, log, or commit `RC_JWT`, `RC_CLIENT_SECRET`, access tokens, refresh tokens, or Authorization headers.

## Official docs

Prefer live RingCentral docs over memory for path, query, body, and permission names.

| What | URL |
|------|-----|
| Developer Guide (hub) | https://developers.ringcentral.com/guide |
| RingEX API Reference | https://developers.ringcentral.com/api-reference |
| First call / app setup | https://developers.ringcentral.com/guide/getting-started |
| URIs, `~`, HTTP methods | https://developers.ringcentral.com/guide/basics/uris |
| JWT → access token | https://developers.ringcentral.com/guide/authentication/jwt-flow |

Family pages, endpoint tables, and unused platform APIs: [reference.md](reference.md).

Production host is `https://platform.ringcentral.com`. This repo uses `RC_SERVER_URL` (same path prefix). `~` in a path means the authorized account or extension.

## Client (reuse, do not fork)

Use native `fetch` through the existing client. Do not add Axios or a RingCentral SDK unless the user explicitly asks.

```ts
import {
  getValidToken,
  ringCentralRequest,
  RingCentralApiError,
} from "../../../src/services/ringcentral/client";
```

`ringCentralRequest(method, endpoint, body?)` prepends `RC_SERVER_URL`, sends `Authorization: Bearer`, JSON-encodes a body when present, and on `401` clears the token cache, re-exchanges the JWT, and retries once.

Auth lives in `src/services/ringcentral/auth.ts`:

- JWT exchange: `POST ${RC_SERVER_URL}/restapi/oauth/token` with Basic (`RC_CLIENT_ID`:`RC_CLIENT_SECRET`) and `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
- Refresh: same URL, `grant_type=refresh_token`
- Reuse a cached token when it expires more than 120s from now

Required env: `RC_SERVER_URL`, `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, `RC_JWT`. Runtime code reads them with `getRequiredEnv()` from `src/config/domain`.

Local scripts should set `process.env.RC_TOKEN_STORE = process.env.RC_TOKEN_STORE ?? "file"` so tokens land in gitignored `.ringcentral-token-cache.json` instead of Mongo.

Binary recording audio is **not** JSON. Fetch `contentUri` with `getValidToken()` and `Accept: audio/mpeg` (see `ringcentral-download-recording-samples.ts`). `ringCentralRequest` is for JSON metadata.

## Prototype with scripts

The way to explore the RingCentral API in this repo is a TypeScript file under `scripts/dev_ops/ringcentral/`. Write a script first. Do not start by editing `src/services/ringcentral/` unless the user asked to change production ingest, cron, or webhooks.

Scripts are disposable probes: confirm an endpoint, dump a sanitized shape, join Call Log to Mongo, or answer an Owner question. Promote a finding into `src/services/` only after the question is settled and the Service owns the invariant.

There are **no** `pnpm ringcentral:*` scripts. From `vantage-main-server`:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/<script>.ts
```

Copy this checklist:

```
RC probe
- [ ] 1. Name the question (one endpoint family, one window, one output)
- [ ] 2. Open the official Guide + API Reference page for that family
- [ ] 3. New file in scripts/dev_ops/ringcentral/ — import ringCentralRequest
- [ ] 4. GET / read first. POST/DELETE (subscriptions, downloads) needs an explicit ask
- [ ] 5. Page + sleep on Call Log. Retry 429. Bound max pages
- [ ] 6. Print counts / ids / statuses. Never echo tokens or raw JWT
- [ ] 7. Write artifacts to a gitignored path (repo-root *.json names already in .gitignore, or scripts/dev_ops/ringcentral/output/)
```

### New script skeleton

```ts
process.env.RC_TOKEN_STORE = process.env.RC_TOKEN_STORE ?? "file";

import { ringCentralRequest } from "../../../src/services/ringcentral/client";

async function main(): Promise<void> {
  const account = await ringCentralRequest("GET", "/restapi/v1.0/account/~");
  console.log({ accountId: account?.id, name: account?.name });

  const query = new URLSearchParams({
    dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    dateTo: new Date().toISOString(),
    direction: "Inbound",
    type: "Voice",
    view: "Detailed",
    perPage: "50",
    page: "1",
  });
  const page = await ringCentralRequest(
    "GET",
    `/restapi/v1.0/account/~/call-log?${query.toString()}`,
  );
  console.log({ records: page?.records?.length ?? 0 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

Reuse helpers instead of copying pagination:

- `_owner-prototype-lib.ts` — `rcRequest` (429 backoff), `fetchAccountCallLogPages`, phone-number / queue / analytics fetches
- `ringcentral-diagnose.ts` — auth + scope smoke test (run this first on a new machine)

Rate limits: Call Log is heavy. Sleep ~4s between pages (`CALL_LOG_PAUSE_MS`). On `429`, wait and retry (owner lib uses 20s × attempt, max 4).

Do **not** create Call Leads, download audio, or spend model credits from a probe unless the user asked. Production qualification stays in `ingestRingCentralQualifiedCall`.

## API families this repo already uses

| Family | Typical path | Official docs |
|--------|--------------|---------------|
| OAuth / JWT | `/restapi/oauth/token` | https://developers.ringcentral.com/guide/authentication/jwt-flow |
| Account / extensions / numbers / queues | `/restapi/v1.0/account/~…` | https://developers.ringcentral.com/api-reference |
| Call Log | `GET /restapi/v1.0/account/~/call-log` | https://developers.ringcentral.com/guide/voice/call-log |
| Recordings | `/restapi/v1.0/account/~/recording/{id}` | https://developers.ringcentral.com/guide/voice/call-log/recordings |
| Subscriptions (webhooks) | `/restapi/v1.0/subscription` | https://developers.ringcentral.com/guide/notifications/webhooks/creating-webhooks |
| Telephony session events | filter `/restapi/v1.0/account/~/telephony/sessions` | https://developers.ringcentral.com/guide/voice/telephony-session-notifications |
| Call Analytics | `POST /analytics/calls/v1/accounts/~/aggregation/fetch` | https://developers.ringcentral.com/guide/analytics/quick-start |
| RingSense / ACE | `/ai/ringsense/v1/public/accounts/~/domains/pbx/…` | https://developers.ringcentral.com/ringsense-api |

Call Log is the production qualification source of truth for cron. Analytics is **aggregates only** (not caller-level leads). RingSense and recording **content** are probe-only today — the production pipeline does not fetch media.

`view=Detailed` is required when you need legs, recording metadata, or `telephonySessionId`. A completed call can take 15–30s to appear in Call Log; live state is telephony-session webhooks.

## Existing runners

| Script | Use |
|--------|-----|
| `ringcentral-diagnose.ts` | Auth, scopes, extension/account/call-log/recording access |
| `ringcentral-call-log-validate.ts` | Call Log shape + account vs extension visibility |
| `ringcentral-call-lead-api-probe.ts` | Qualification-oriented Call Log + Analytics probe |
| `ringcentral-webhook-list.ts` / `create` / `delete` | Subscription CRUD |
| `ringcentral-recording-transcript-probe.ts` | Recording + RingSense existence (no transcript text) |
| `owner-prototype-*.ts` | Owner reports joining RC to Mongo (see `OWNER-PROTOTYPE-README.md`) |

Webhook create/delete is live account state. Confirm the delivery URL and say so before creating or deleting subscriptions.

## Additional resources

- Endpoint catalog and unused RingEX families: [reference.md](reference.md)
- Runtime / env / cron: `.cursor/rules/ringcentral-integration.mdc`
- Call Qualification Service: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
