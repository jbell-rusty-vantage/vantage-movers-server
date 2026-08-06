# Granot webhook capture

Granot sends three server-to-server JSON webhook event classes:

- `POST /api/webhooks/granot/lead-created`
- `POST /api/webhooks/granot/priority-updated`
- `POST /api/webhooks/granot/booking-status-changed`

Every request must send `Content-Type: application/json` and the dedicated
secret as `x-api-secret`. The server reads the expected secret from
`GRANOT_WEBHOOK_SECRET`. This is intentionally separate from
`VANTAGE_API_SECRET` and is accepted only by the three Granot webhook routes.

The payload contract is intentionally open until Granot supplies real examples.
Authenticated deliveries are stored unchanged in `granot_webhook_receipts`,
along with sanitized headers, receipt time, route-derived event type, and an
initial `received` processing status. Authentication headers are never stored.
No lead, priority, booking, or cancellation mutation occurs yet.

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
