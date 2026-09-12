# Session story-routes-ringcentral-webhook-local-2026-09-12T0222Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `ringcentral-webhook-local.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 326 (through `routes-ringcentral-webhook.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `ringcentral-webhook-local.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-ringcentral-webhook-local.md`
- operations named: echo the Validation-Token so RingCentral keeps the local subscription, append the sanitized delivery to a gitignored JSONL, and never run candidate session or ingest — never let a file-write throw become a 4xx or 5xx, never create a Call Lead here, never use the API secret or the cron secret
- remaining in this service: `twilio-message-status.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `twilio-message-status.routes.ts`

## Messages posted

- 2026-09-12T0222Z next

## Ideas parked

- Always 200 is the RingCentral retry seam. Do not 503 a JSONL throw so this desk matches leftover Granot capture.
- Write fail is `ringcentral.local_webhook.write_failed` only — not `recordOperationalEvent`.
- This desk never asks keep / fold / party / session / promote / `RINGCENTRAL_WEBHOOK_ENABLED`.
- Shared `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` is the subscription seam. Do not hardcode `/api/webhooks/ringcentral`.
- `sanitizeHeaders` keeps Validation-Token on the JSONL line.
- `getValidationToken` / `headersToRecord` are a copy of leftover live webhook.
- Comment names `pnpm ringcentral:webhook:create:local`; `package.json` has no `ringcentral:*` scripts.
- No factory inject and no `ringcentral-webhook-local.routes.test.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Always 200 vs leftover Granot 503 on capture throw
- Comment / leftover append name `pnpm ringcentral:webhook:create:local` vs no package.json script and leftover integration rule
- Knowledge Debug table names monitor + `/api/dev/ringcentral/*`, never this URL
- Duplicated token/header helpers vs leftover live webhook
