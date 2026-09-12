# Session story-routes-ringcentral-webhook-2026-09-12T0118Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `ringcentral-webhook.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 325 (through `routes-granot-webhook.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `ringcentral-webhook.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-ringcentral-webhook.md`
- operations named: echo the Validation-Token so RingCentral keeps the subscription, keep the raw delivery, then when processing is on attribute the inbound number, remember each party, rebuild the session, and when the session is qualified and over hand it to shared Call Lead ingest — never let a processing throw become a 4xx or 5xx, never ingest a live call still under two minutes, never create a Call Lead outside the shared gate, never use the API secret or the cron secret
- remaining in this service: `ringcentral-webhook-local.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `ringcentral-webhook-local.routes.ts`

## Messages posted

- 2026-09-12T0118Z next

## Ideas parked

- Always 200 is the RingCentral retry seam. Do not 503 a processing throw so this desk matches leftover Granot capture.
- Outer catch lies `storedRawEvent: false` after keep already succeeded.
- Promote throw is `ringcentral.webhook.ingest_failed` + `ingestAction: "ingest_failed"`; outer catch is log only.
- `MONGO_URI` skip is only on party persist and session persist. Enrich still loads the inbound-number book.
- `ingestEligible` is qualified and over. Do not ingest `pending_buffer`.
- `shouldWebhookCallLogValidate` is unread here. Knowledge names it future hardening.
- No factory inject and no `ringcentral-webhook.routes.test.ts`.
- Debug 404 hides the live-host desk. Non-live hosts always open.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Always 200 vs leftover Granot 503 on capture throw
- Warning body `storedRawEvent: false` vs keep already succeeding
- Unread `shouldWebhookCallLogValidate` vs knowledge future-hardening sentence
- Debug 404 hide vs leftover Owner HMAC 401
- No route HTTP proof vs leftover Granot webhook inject-and-post
