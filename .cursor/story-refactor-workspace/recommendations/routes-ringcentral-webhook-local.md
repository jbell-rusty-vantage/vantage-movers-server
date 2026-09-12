# Echo The Validation-Token So RingCentral Keeps The Local Subscription, Append The Sanitized Delivery To A Gitignored JSONL, And Never Run Candidate Session Or Ingest — Never Let A File-Write Throw Become A 4xx Or 5xx, Never Create A Call Lead Here, Never Use The API Secret Or The Cron Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 16 of this service — `ringcentral-webhook-local.routes.ts`
- Remaining in this service: `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/ringcentral-webhook-local.routes.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2 owns live `POST /api/webhooks/ringcentral` — keep the raw event, then when `RINGCENTRAL_WEBHOOK_ENABLED` fold every party, remember each party, rebuild the session, ingest only when `ingestEligible` = qualified **and** terminal. Debug / local tooling names `GET /api/dev/ringcentral/*`, `pnpm ringcentral:webhook:monitor`, and `pnpm ringcentral:workflow:test` — **never this path**. Tests list cron route proofs, **not** this router). Distinct from already-recommended live inbound: [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md) (`/api/webhooks/ringcentral` echo + Mongo keep + maybe process + `/api/dev/ringcentral/*` — **does not import** this file; **this file never asks** keep / fold / party / session / promote). Distinct from leftover Wave A file append: skipped `local-webhook-capture.ts` (`appendLocalRingCentralWebhookEvent` + shared `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` = `/api/webhooks/ringcentral-local` + `LOCAL_WEBHOOK_EVENTS_FILE` = `ringcentral-local-webhook-events.jsonl` — this file **asks** append; that file never echoes a token and never answers HTTP). Distinct from already-recommended Wave A keep: [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) (`captureRingCentralWebhookEvent` / `sanitizeHeaders` — this file **asks** leftover `sanitizeHeaders` only; **never asks** Mongo keep). Distinct from leftover payload fold: skipped `webhook-event-normalizer.ts` (**this file never folds**). Distinct from already-recommended party persist / session persist / promote: [ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md) / [ringcentral-call-session-store.md](ringcentral-call-session-store.md) / [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (**this file never asks those**). Distinct from already-recommended subscribe: [ringcentral-webhook-subscriptions.md](ringcentral-webhook-subscriptions.md) (live inbound filter; **does not import** this file; leftover comments name gitignored `ringcentral-webhook-create-local.ts` / `pnpm ringcentral:webhook:create:local` as the intended local subscriber). Distinct from already-recommended Granot inbound: [routes-granot-webhook.md](routes-granot-webhook.md) (webhook secret, `202` only after commit, `503` on capture throw — **does not import** this file). Distinct from leftover Wave B Call Log trigger: next `ringcentral-cron.routes.ts` (`CRON_SECRET` — **this file does not use `CRON_SECRET`**). Distinct from leftover Wave B secret: leftover `requireApiSecret` / leftover HMAC / leftover Granot webhook secret / leftover live-host `x-debug-token` (**this file never uses those**). Distinct from leftover Wave A letters: [observability-record-operational-event.md](observability-record-operational-event.md) (**this file never asks** `recordOperationalEvent`; write fail is `log.error` `ringcentral.local_webhook.write_failed` only). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Call Qualification](../../../../CONTEXT.md) / [Call Lead Ingestion](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(ringCentralWebhookLocalRoutes)` on line 55 — **after** already-recommended live RingCentral webhook and already-recommended Granot webhook, **before** leftover crons, leftover Granot automation, leftover public v1, leftover Best Relocation, leftover reporting). Already-recommended Wave A keep / subscribe / live webhook / cron route tests prove those **interfaces**, not this router. Knowledge lists `ringcentral-cron.routes.test.ts` and evaluate / collapse / ingest file tests — **none** HTTP-post this path. Operator `hit-vantage-api` does **not** list `/api/webhooks/ringcentral-local`. `.gitignore` lists `ringcentral-local-webhook-events.jsonl` and `scripts/dev_ops/**` (create-local lives there when present; this checkout has no `ringcentral-webhook-create-local.ts` on disk). `package.json` has **no** `pnpm ringcentral:*` scripts; leftover `ringcentral-integration.mdc` says the same. Not this **interface**: leftover `appendLocalRingCentralWebhookEvent` itself, leftover `sanitizeHeaders` itself, leftover `captureRingCentralWebhookEvent`, leftover `normalizeRingCentralWebhookPayload`, leftover `ingestRingCentralQualifiedCall`, leftover `buildRingCentralTelephonyEventFilters`.
- Seams callers need: `app.ts` **before** public v1 vs Owner desks **after** the secret; Validation-Token echo vs Granot webhook secret vs `CRON_SECRET`; leftover shared path constant vs hardcoded `/api/webhooks/ringcentral`; leftover gitignored JSONL vs already-recommended Mongo keep; always **200** vs Granot `202` only after commit / `503` on capture throw; leftover write-fail still **200** `{ storedRawEvent: false }` vs leftover live webhook processing-throw still **200**; leftover `sanitizeHeaders` (drop `authorization` / `cookie` / `x-api-secret`, keep Validation-Token) vs leftover live keep of the same strip. There is no factory inject **seam**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no `RINGCENTRAL_WEBHOOK_ENABLED` **seam**. There is no live-host debug-token **seam**.
- Split later (only if the file outgrows one sitting): this ~87-line file is one sitting if you read it as echo the Validation-Token so RingCentral keeps the local subscription, append the sanitized delivery to a gitignored JSONL, and never run candidate session or ingest — never let a file-write throw become a 4xx or 5xx, never create a Call Lead here, never use the API secret or the cron secret. Do not split. Never `get.ts` / `post.ts` / `create.ts` / `update.ts` / `delete.ts` / `webhook.ts` / `debug.ts`. File append stays leftover skipped `local-webhook-capture.ts`. Header strip stays leftover `sanitizeHeaders` on already-recommended `webhook-capture.ts`. Live inbound stays already-recommended `ringcentral-webhook.routes.ts`. Call Log trigger stays leftover next `ringcentral-cron.routes.ts`.

`router.get("/api/webhooks/ringcentral-local")` / `router.post("/api/webhooks/ringcentral-local")` are HTTP verbs. The owner question is: *I pointed an ngrok tunnel at the local webhook so I can inspect raw RingCentral deliveries without minting a Call Lead. Echo the Validation-Token so they keep this local subscription. Append the sanitized headers and raw body as one JSON line to a gitignored file. If the file write fails, still answer 200 — RingCentral must not retry-storm a laptop disk miss. Do not fold parties. Do not remember a candidate. Do not rebuild a session. Do not hand shared ingest. Do not compare `x-api-secret`. Do not teach this file `CRON_SECRET`.*

Who append the JSONL already lives in leftover skipped `local-webhook-capture.ts`. Who strip secrets from headers already lives in leftover `sanitizeHeaders` on already-recommended `webhook-capture.ts`. Who keep a Mongo audit row already lives in already-recommended `webhook-capture.ts`. Who process a live delivery already lives in already-recommended `ringcentral-webhook.routes.ts`. Do not pull those in.

## What this file actually does

Two operations of one “echo the Validation-Token so RingCentral keeps the local subscription, append the sanitized delivery to a gitignored JSONL, and never run candidate session or ingest” story, not “a webhook CRUD dump,” and not Append This Local Delivery / Keep This Raw Delivery / Promote This Already-Qualified Inbound Call themselves:

1. **Prove the local webhook URL is reachable** — `GET /api/webhooks/ringcentral-local`. Answer `{ ok: true, provider: "ringcentral", route: RINGCENTRAL_LOCAL_WEBHOOK_ROUTE, method: "GET", ready: true, mode: "local-file-capture" }`. This beat does **not** echo Validation-Token. This beat does **not** append a line. This beat does **not** ask `requireApiSecret`. RingCentral subscription handshake POSTs Validation-Token; this GET is reachability only. `mode` is how an operator tells this URL apart from leftover live `GET /api/webhooks/ringcentral` (that GET has no `mode`).

2. **Accept this local RingCentral delivery — echo the token, append the JSONL, always answer 200** — `POST /api/webhooks/ringcentral-local`. Read Validation-Token from `validation-token` / `Validation-Token`. If the token is present, set response `Validation-Token` **before** try. **Ask** leftover `appendLocalRingCentralWebhookEvent({ receivedAt, validationTokenPresent, headers: sanitizeHeaders(headersToRecord(req)), payload: req.body ?? null })`. Append throw logs `ringcentral.local_webhook.write_failed` and leaves `storedPath` null — **no** 4xx / 5xx. Then log `ringcentral.local_webhook.received` with `storedPath`. Answer **200** `{ ok: true, provider: "ringcentral", mode: "local-file-capture", storedRawEvent: storedPath !== null }`. This beat does **not** ask `captureRingCentralWebhookEvent`. This beat does **not** ask `isRingCentralWebhookEnabled`. This beat does **not** ask `normalizeRingCentralWebhookPayload`. This beat does **not** ask `upsertRingCentralCallCandidateFromEvent`. This beat does **not** ask `processRingCentralCallSession`. This beat does **not** ask `ingestRingCentralQualifiedCall`. This beat does **not** ask `recordOperationalEvent`. This beat does **not** ask `requireGranotWebhookSecret`.

`getValidationToken` / `headersToRecord` are beats inside these operations, not extra owner stories. They are a copy of leftover live webhook’s same-named helpers. The default export is the `Router()` instance — there is **no** factory inject.

There is no third debug-board operation. Live evidence lives on already-recommended `GET /api/dev/ringcentral/*`. There is no fourth enable-flag operation. `RINGCENTRAL_WEBHOOK_ENABLED` is unread here.

## Organization

Keep one file. This is the screenplay for “echo the Validation-Token so RingCentral keeps the local subscription, append the sanitized delivery to a gitignored JSONL, and never run candidate session or ingest — never let a file-write throw become a 4xx or 5xx, never create a Call Lead here, never use the API secret or the cron secret.” Leftover file append / leftover header strip / already-recommended live inbound / already-recommended Mongo keep already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralLocalWebhookRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches leftover Granot webhook tests” without adding a paired HTTP proof. Do not invent a leftover enable-flag **adapter** so “local capture can be turned off the same way as live processing.” Do not invent a CRUD folder so `get.ts` / `post.ts` each get a file.

Do not move leftover `appendLocalRingCentralWebhookEvent` into this file so “the route owns the JSONL.” Do not move leftover `sanitizeHeaders` into this file so “the route owns the strip.” Do not mount this router inside leftover `v1.routes.ts` so “one file owns every webhook.” Do not merge this router into already-recommended `ringcentral-webhook.routes.ts` so “one file owns every RingCentral POST.” Do not merge this router into leftover next `ringcentral-cron.routes.ts` so “one file owns hybrid Call Qualification.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ringCentralLocalWebhookDesk` | `app.ts` mounts the instance **after** live RingCentral and Granot, **before** public v1 |
| `GET /api/webhooks/ringcentral-local` (today unexported handler) | `proveTheLocalWebhookUrlIsReachableOverHttp` | reachability; `mode: "local-file-capture"`; no token echo |
| `POST /api/webhooks/ringcentral-local` (today unexported handler) | `acceptThisLocalRingCentralDeliveryOverHttp` | echo token **then** append JSONL **always** 200 |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `storedRawEvent` / `storedPath` / `validationTokenPresent` as the domain language. Do **not** export `getValidationToken` / `headersToRecord` so “the test can unit the helper.” Do **not** add `createRingCentralLocalWebhookRouter({ append })` in this rename so “this desk matches leftover Granot” without a paired HTTP proof that live default still **asks** leftover skipped append.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after echo (write succeeded or not):

```ts
type AcceptedLocalRingCentralWebhookOverHttp = {
  ok: true
  provider: "ringcentral"
  mode: "local-file-capture"
  storedRawEvent: boolean
}
```

That is the handoff from “RingCentral may stop retrying this local delivery” to “an operator may tail the gitignored JSONL.” Do **not** add `storedPath` onto that bag (the absolute cwd path is a laptop fact, not a contract). Do **not** collapse GET ready into POST so “one verb owns handshake.”

Leave `appendLocalRingCentralWebhookEvent` / `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` on leftover skipped `local-webhook-capture.ts`. Leave `sanitizeHeaders` on already-recommended `webhook-capture.ts`. Leave live inbound on already-recommended `ringcentral-webhook.routes.ts`. Leave Call Log trigger on leftover next `ringcentral-cron.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-webhook-local.routes.ts
// I pointed an ngrok tunnel at the local webhook
// so I can inspect raw RingCentral deliveries
// without minting a Call Lead.
// Echo the Validation-Token so they keep this local subscription.
// Append the sanitized headers and raw body as one JSON line.
// If the file write fails, still answer 200.
// Do not fold parties. Do not remember a candidate.
// Do not rebuild a session. Do not hand shared ingest.
// Do not compare x-api-secret.
// Do not teach this file CRON_SECRET.

export function acceptThisRingCentralLocalWebhookDesk() {
  const desk = Router()
  desk.get(theSharedLocalWebhookPath, proveTheLocalWebhookUrlIsReachableOverHttp)
  desk.post(theSharedLocalWebhookPath, acceptThisLocalRingCentralDeliveryOverHttp)
  return desk
}

export default acceptThisRingCentralLocalWebhookDesk()

// ── 1. Prove the local URL is reachable ───────────────────

function proveTheLocalWebhookUrlIsReachableOverHttp(_req, res) {
  return res.json({
    ok: true,
    provider: "ringcentral",
    route: theSharedLocalWebhookPath,
    method: "GET",
    ready: true,
    mode: "local-file-capture",
  })
}

// ── 2. Accept this local delivery ─────────────────────────

async function acceptThisLocalRingCentralDeliveryOverHttp(req, res) {
  const token = readTheValidationToken(req)
  echoTheValidationTokenSoTheyKeepTheLocalSubscription(res, token)

  let storedPath = null
  try {
    storedPath = await appendThisSanitizedDeliveryToTheGitignoredJsonl({
      receivedAt: new Date().toISOString(),
      validationTokenPresent: token !== null,
      headers: stripSecretsFromTheHeaders(headersOnThisRequest(req)),
      payload: req.body ?? null,
    })
  } catch (error) {
    rememberTheFileWriteFailedWithoutChangingTheAnswer(error)
  }

  rememberWeReceivedThisLocalDelivery(req, token, storedPath)
  return acceptedAnywayEvenIfTheFileWriteFailed(res, storedPath !== null)
}
```

Read the desk path out loud: *RingCentral POSTed `/api/webhooks/ringcentral-local`. Echo the Validation-Token first so local subscription creation succeeds even if the laptop disk is full. Append the sanitized headers and raw body as one JSON line to `ringcentral-local-webhook-events.jsonl`. If that append throws, log `ringcentral.local_webhook.write_failed` and still answer 200 `{ storedRawEvent: false }`. Do not fold parties. Do not remember a candidate. Do not rebuild a session. Do not hand shared ingest. Do not write Mongo. Do not compare `x-api-secret`.*

That is the operation. `router.post("/api/webhooks/ringcentral-local")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Always 200 is the RingCentral retry seam, not a Granot copy.** Leftover live inbound and this file both answer 200 after a keep/append miss. Leftover Granot inbound **503**s a capture throw. Do not silently 503 a JSONL miss so “this desk matches leftover Granot capture.” Do not silently 202 so “every inbound webhook matches leftover Granot.” Validation-Token is already on the response before try — keep that order.

2. **Write fail is a log, not a letter.** Append throw logs `ringcentral.local_webhook.write_failed` and does **not** **ask** `recordOperationalEvent`. Leftover live promote throw **asks** `ringcentral.webhook.ingest_failed`. Do not silently emit that letter from this file so “one letter owns every RingCentral miss.”

3. **This desk never asks the live pipeline.** No fold, no inbound-number book, no party persist, no session persist, no promote, no `RINGCENTRAL_WEBHOOK_ENABLED`. Do not silently **ask** leftover `captureRingCentralWebhookEvent` so “local capture also writes Mongo.” Do not silently **ask** leftover `ingestRingCentralQualifiedCall` so “the local URL can mint a Call Lead while I tail the file.”

4. **The path constant is the subscription seam.** Leftover skipped `local-webhook-capture.ts` exports `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` so gitignored `ringcentral-webhook-create-local.ts` and this router cannot drift. Do not silently hardcode `"/api/webhooks/ringcentral"` so “one path owns every RingCentral POST.” Do not silently hardcode the string in this file and drop the import so “the route owns the URL.”

5. **`sanitizeHeaders` keeps Validation-Token.** Leftover strip drops `authorization` / `cookie` / `x-api-secret` and lowercases keys. The token stays on the JSONL line. Do not silently drop Validation-Token so “the file never holds handshake secrets” without a paired decision. Do not copy a second strip into this file so “the route owns sanitizing.”

6. **`getValidationToken` / `headersToRecord` are a copy of leftover live webhook.** Same token headers, same string/array header walk (live uses two `if`s; this file uses one). Do not silently extract a shared helper in this rename so “one helper owns every RingCentral POST” without a paired HTTP proof on **both** desks. Park the copy.

7. **The comment names a script this checkout does not have.** File comment and leftover skipped append say `pnpm ringcentral:webhook:create:local`. `package.json` has no `ringcentral:*` scripts. Leftover `ringcentral-integration.mdc` says there are none. Knowledge Debug table names `pnpm ringcentral:webhook:monitor`, not create-local, and never names this URL. Do not invent a `package.json` script in this rename so “the comment becomes true.” Do not drop the shared path because the script is gitignored.

8. **This desk never uses the API secret, HMAC, Granot webhook secret, the cron secret, or the live-host debug token.** `app.ts` mounts it after leftover live RingCentral and leftover Granot, before leftover public v1. Validation-Token is handshake, not payload auth. Do not remount `requireApiSecret` so “it matches leftover reporting.” Do not teach this file `CRON_SECRET` so “one file owns hybrid Call Qualification.” Do not hide GET behind leftover `x-debug-token` so “local reachability matches leftover `/api/dev/ringcentral/*`.”

9. **There is no factory inject.** Leftover Granot webhook tests inject `capture` / `publish`. Leftover live RingCentral webhook also exports only the live `Router()`. Do not add `createRingCentralLocalWebhookRouter` in this rename without a paired HTTP proof. Today there is **no** `ringcentral-webhook-local.routes.test.ts`.

10. **Leave sibling modules alone.** `appendLocalRingCentralWebhookEvent` / `sanitizeHeaders` / leftover live inbound / leftover subscribe are already the right **depth**. This file orchestrates the HTTP **adapter**.

11. **Do not treat leftover live inbound, leftover Granot inbound, leftover Call Log cron, leftover Owner inbound-number desk, leftover subscribe, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, or leftover Granot automation as this story.** Next `twilio-message-status.routes.ts` is Twilio status. Next `ringcentral-cron.routes.ts` is the Call Log trigger. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisRingCentralLocalWebhookDesk` (mounted on `app.ts` **after** live RingCentral and Granot, **before** public v1 as the default export) and the two HTTP operations above.

Today there is **no** `ringcentral-webhook-local.routes.test.ts`. Wave A file tests prove leftover keep / leftover subscribe through those **interfaces**. Add an HTTP proof that names the operation (do not boot live RingCentral, do not write the gitignored JSONL into the repo, do not walk `createRingCentralCallLead` in the route file):

**Handshake / who may speak**
- This desk is mounted from `app.ts` **after** `ringCentralWebhookRoutes` and `granotWebhookRoutes`, **before** `v1Routes`.
- GET answers `{ ready: true, mode: "local-file-capture" }` with no Validation-Token echo and no append.
- POST with Validation-Token sets response `Validation-Token` **before** append.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` are **not** accepted here.

**Append, never process**
- POST **asks** leftover `appendLocalRingCentralWebhookEvent` with leftover `sanitizeHeaders` on the request headers and `payload: req.body ?? null`.
- Append throw still **200** `{ storedRawEvent: false }` and logs `ringcentral.local_webhook.write_failed`.
- Append success **200** `{ storedRawEvent: true, mode: "local-file-capture" }`.
- This beat does **not** ask `captureRingCentralWebhookEvent` / `isRingCentralWebhookEnabled` / `normalizeRingCentralWebhookPayload` / `upsertRingCentralCallCandidateFromEvent` / `processRingCentralCallSession` / `ingestRingCentralQualifiedCall` / `recordOperationalEvent`.

**Path**
- Both verbs use leftover `RINGCENTRAL_LOCAL_WEBHOOK_ROUTE` (`/api/webhooks/ringcentral-local`), not leftover `/api/webhooks/ringcentral`.

**Mount**
- `app.ts` should keep `app.use(ringCentralWebhookLocalRoutes)` after leftover live RingCentral and leftover Granot, before leftover crons and `v1Routes`.
- Leftover Call Log cron stays mounted later and is not this desk.

**Not this file**
- File append stays on leftover skipped `local-webhook-capture.ts`.
- Header strip stays on already-recommended [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md).
- Live inbound stays on already-recommended [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md).
- Subscribe stays on already-recommended [ringcentral-webhook-subscriptions.md](ringcentral-webhook-subscriptions.md).
- Call Log trigger stays on next `ringcentral-cron.routes.ts`.

Do **not** add a test per helper (`readTheValidationToken`, `echoTheValidationTokenSoTheyKeepTheLocalSubscription`, `headersOnThisRequest`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory inject in this rename so “the test can no longer see the live leftover append default.” If a later implementer adds inject, the HTTP proof must still name the live default.

## What I would not do

- A `RingCentralLocalWebhookRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, provider: "ringcentral" })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `webhook.ts` / `debug.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the always-200 **seam**: do not 503 a JSONL throw so “this desk matches leftover Granot.”
- Breaking the never-process **seam**: do not ask leftover keep / fold / party / session / promote from this file.
- Breaking the shared-path **seam**: do not hardcode leftover `/api/webhooks/ringcentral` here.
- Breaking the unguarded-inbound **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` here.
- Treating leftover `appendLocalRingCentralWebhookEvent`, leftover `sanitizeHeaders`, leftover `captureRingCentralWebhookEvent`, leftover live inbound, leftover Granot inbound, leftover Call Log cron, leftover Owner inbound-number desk, leftover subscribe, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, leftover Granot automation, leftover webhook / cron routers, or leftover Owner apply as this story.
- Inventing a leftover factory-inject / leftover enable-flag / leftover cron-secret / leftover Zod / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently 503 a file-write throw, 202 a keep, asking leftover ingest, remounting `requireApiSecret`, teaching this file `CRON_SECRET`, adding a `package.json` `ringcentral:*` script so “the comment becomes true,” or merging this router into leftover live inbound while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
