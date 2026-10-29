# routes-ringcentral-webhook-local

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/ringcentral-webhook-local.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

4. **The path constant is the subscription seam.** Leftover skipped `local-webhook-capture.ts` exports `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` so gitignored `ringcentral-webhook-create-local.ts` and this router cannot drift. Do not silently hardcode `"/api/webhooks/ringcentral"` so “one path owns every RingCentral POST.” Do not silently hardcode the string in this file and drop the import so “the route owns the URL.”

5. **`sanitizeHeaders` keeps Validation-Token.** Leftover strip drops `authorization` / `cookie` / `x-api-secret` and lowercases keys. The token stays on the JSONL line. Do not silently drop Validation-Token so “the file never holds handshake secrets” without a paired decision. Do not copy a second strip into this file so “the route owns sanitizing.”

6. **`getValidationToken` / `headersToRecord` are a copy of leftover live webhook.** Same token headers, same string/array header walk (live uses two `if`s; this file uses one). Do not silently extract a shared helper in this rename so “one helper owns every RingCentral POST” without a paired HTTP proof on **both** desks. Park the copy.

9. **There is no factory inject.** Leftover Granot webhook tests inject `capture` / `publish`. Leftover live RingCentral webhook also exports only the live `Router()`. Do not add `createRingCentralLocalWebhookRouter` in this rename without a paired HTTP proof. Today there is **no** `ringcentral-webhook-local.routes.test.ts`.

10. **Leave sibling modules alone.** `appendLocalRingCentralWebhookEvent` / `sanitizeHeaders` / leftover live inbound / leftover subscribe are already the right **depth**. This file orchestrates the HTTP **adapter**.
