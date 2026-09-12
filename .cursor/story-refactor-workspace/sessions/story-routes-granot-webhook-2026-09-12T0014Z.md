# Session story-routes-granot-webhook-2026-09-12T0014Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `granot-webhook.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 324 (through `routes-reporting.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `granot-webhook.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-granot-webhook.md`
- operations named: after the Granot webhook secret, keep this delivery as an Observation Receipt, then wake the drain — never answer 202 before commit, never let a failed wake-up change the receipt, never write a Lead or Booking here
- remaining in this service: `ringcentral-webhook.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `ringcentral-webhook.routes.ts`

## Messages posted

- 2026-09-12T0014Z next

## Ideas parked

- `202` cannot precede commit. Capture throw is 503 and never publishes.
- Live `publishGranotLifecycleReceiptWakeup` never throws. This file still try/catches an injected throw and logs `granot_lifecycle.queue.publish_failed` without incrementing the queue-publish metric or emitting the event.
- The second `401` after `requireGranotWebhookSecret` is defense. Wave B middleware owns the compare.
- Three URLs share one handler. `route_event_class` comes from the table, never payload `event_type`.
- Payload keys are evidence, not a schema. Do not add Zod in this rename.
- This desk never claims. Owner apply captures then `claimAndProcessOrPoll`. This file publishes `{ receipt_id }` and stops.
- This desk never uses `requireApiSecret`, HMAC, or `CRON_SECRET`. Mounted before public v1, after the RingCentral webhook.
- Capture-fail letters live here. Publish-fail letters live in Wave A `queuePublisher.ts`.
- Existing `granot-webhook.routes.test.ts` already HTTP-proves the interface. Missing: mount order, `CRON_SECRET` refuse, payload `event_type` losing to the route class.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Live publisher never throws vs route catch for injected throw (log only, no metric / event)
- Capture-fail letters in this file vs publish-fail letters in Wave A
- Webhook secret here vs API secret / HMAC / cron secret on sibling desks
- This desk publishes then stops vs Owner apply claims immediately
