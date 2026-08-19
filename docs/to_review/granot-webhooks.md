# Granot webhook capture

> **Stale vs current.** This note describes pre-processor capture. Current fulfillment through Unit 25: [`docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md`](../granot-lead-lifecycle/sprint-progress-through-unit-25.md). Current capture: [`.cursor/businesslogic/granotLifecycle.capture.md`](../../.cursor/businesslogic/granotLifecycle.capture.md). Current processor: [`.cursor/businesslogic/granotLifecycle.processor.md`](../../.cursor/businesslogic/granotLifecycle.processor.md). Payload-profile notes below remain useful.

Granot sends three server-to-server JSON webhook event classes:

- `POST /api/webhooks/granot/lead-created`
- `POST /api/webhooks/granot/priority-updated`
- `POST /api/webhooks/granot/booking-status-changed`

The preferred request format is `Content-Type: application/json` with the
dedicated secret in the `x-api-secret` header. For compatibility with Granot's
current client, `application/x-www-form-urlencoded` requests may instead send
`x-api-secret` as a body field. The server removes that field before durable
capture, so the secret is never stored with the payload.

The server reads the expected secret from `GRANOT_WEBHOOK_SECRET`. This is
intentionally separate from `VANTAGE_API_SECRET` and is accepted only by the
three Granot webhook routes.

The capture model remains intentionally open because Granot has not supplied a
stable, versioned contract. Live deliveries now provide representative shapes,
but they already contain casing drift, unsupported priority values, and route /
payload event-type disagreement. Authenticated deliveries are stored unchanged
in `granot_webhook_receipts`, along with sanitized headers, receipt time,
route-derived event type, and an initial `received` processing status. No lead,
priority, booking, or cancellation mutation occurs yet.

The proposed domain model, live collection profile, matching strategy,
provenance model, idempotency boundaries, event-specific behavior, and staged
rollout are documented in
[`granot-webhook-domain-service-model.md`](./granot-webhook-domain-service-model.md).

Important findings from the 2026-08-13 read-only profile:

- live priority values include `0`, `1`, `2`, `3`, `5`, `7`, `8`, and `9`;
- the route event class can disagree with the payload `event_type`;
- payload key casing has already drifted;
- no stable provider event ID, occurrence time, or source revision is present;
- current header capture stores infrastructure credential/signature and client
  network headers, so it should move from a denylist to a small allowlist before
  processing/admin surfaces are expanded.

The route returns `202` only after MongoDB stores the receipt. It returns `503`
when durable capture fails so the sender can retry.

## Local secret generation

Run `pnpm granot:webhook:generate-secret` once. It creates the git-ignored file
`.env.granot-webhook.local` with restricted local permissions and never prints
the secret to the terminal. Copy its value into Vercel and send the value to the
Granot developer through an appropriately secure channel.

## Vercel configuration

In the Vercel project, open **Settings -> Environment Variables** and add:

- Name: `GRANOT_WEBHOOK_SECRET`
- Value: the value after `=` in `.env.granot-webhook.local`
- Environments: Production, plus Preview only when webhook preview testing is desired

Redeploy after adding or changing the variable. Do not add this secret to source
control or reuse the main Vantage API secret.
