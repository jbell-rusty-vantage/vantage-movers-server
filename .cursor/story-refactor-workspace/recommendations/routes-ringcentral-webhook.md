# Echo The Validation-Token So RingCentral Keeps The Subscription, Keep The Raw Delivery, Then When Processing Is On Attribute The Inbound Number, Remember Each Party, Rebuild The Session, And When The Session Is Qualified And Over Hand It To Shared Call Lead Ingest — Never Let A Processing Throw Become A 4xx Or 5xx, Never Ingest A Live Call Still Under Two Minutes, Never Create A Call Lead Outside The Shared Gate, Never Use The API Secret Or The Cron Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 15 of this service — `ringcentral-webhook.routes.ts`
- Remaining in this service: `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/ringcentral-webhook.routes.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2: `POST /api/webhooks/ringcentral` always keeps the raw event, then when `RINGCENTRAL_WEBHOOK_ENABLED` normalizes every party, upserts candidates, rebuilds each touched session, and ingests only when `ingestEligible` = qualified **and** terminal; hybrid webhook + Call Log both build `RingCentralQualifiedCall` and **ask** `ingestRingCentralQualifiedCall`; `RINGCENTRAL_WEBHOOK_CALL_LOG_VALIDATE` is named as future hardening and is **off**; debug table names `GET /api/dev/ringcentral/*`; tests list cron route proofs, **not** this router). Distinct from already-recommended Wave A keep: [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) (`captureRingCentralWebhookEvent` — this file **asks** it **always**, even when processing is off; that file never throws, never folds every party, never ingests). Distinct from leftover payload fold: skipped `webhook-event-normalizer.ts` (`normalizeRingCentralWebhookPayload` maps **every** party; already-recommended keep previews **parties[0]** only). Distinct from already-recommended party persist: [ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md) (`upsertRingCentralCallCandidateFromEvent` then `storeRingCentralCallCandidateDecision` — this file **asks** those only when processing is on **and** `MONGO_URI` is set). Distinct from already-recommended session persist: [ringcentral-call-session-store.md](ringcentral-call-session-store.md) (`processRingCentralCallSession` — this file **asks** it per telephony session, then ingests when `document.ingestEligible`). Distinct from already-recommended promote: [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` — this file’s `ingestSessionLead` **asks** it with `ingestionSource: "webhook"` and `callLogId: null`; that file never reads a webhook body). Distinct from already-recommended inbound-number book: [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (`loadRingCentralRouteSnapshot` / `resolveRingCentralInboundRoute` — this file enriches **before** party persist). Distinct from leftover last-seen: `recordRingCentralRouteObservation(..., "webhook")` on already-recommended [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (this file **asks** it on a resolve hit; leftover Owner inbound-number desk never stamps last-seen). Distinct from already-recommended subscribe: [ringcentral-webhook-subscriptions.md](ringcentral-webhook-subscriptions.md) (owns the live inbound filter; **does not import** this file). Distinct from already-recommended Owner inbound-number desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (after `requireApiSecret`; **does not import** this file). Distinct from already-recommended Granot inbound: [routes-granot-webhook.md](routes-granot-webhook.md) (`/api/webhooks/granot/*` webhook secret, `202` only after commit, `503` on capture throw, never writes a Lead — **does not import** this file). Distinct from leftover Wave B local file: next `ringcentral-webhook-local.routes.ts` (`/api/webhooks/ringcentral-local` Validation-Token echo + gitignored JSONL — **no** candidate / session / ingest). Distinct from leftover Wave B Call Log trigger: next `ringcentral-cron.routes.ts` (`/api/cron/ringcentral-call-log-sync` `CRON_SECRET` — **this file does not use `CRON_SECRET`**). Distinct from leftover Wave A Call Log sweep: [ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) / leftover vet [ringcentral-call-log-vetting.md](ringcentral-call-log-vetting.md) (same promote gate; `ingestionSource: "call_log_sync"`). Distinct from leftover Wave A config: leftover `ringcentral-config.ts` (`isRingCentralWebhookEnabled` defaults **true**; `shouldWebhookCallLogValidate` defaults **false** and this file **never asks it**; `getRingCentralRuntimeConfig` is debug only). Distinct from leftover Wave A letters: [observability-record-operational-event.md](observability-record-operational-event.md) (`ringcentral.webhook.ingest_failed` on promote throw — normalize / enrich / party / session throw is **only a log**, `200` `webhook_acknowledged_processing_failed`). Distinct from leftover Wave B secret: leftover `requireApiSecret` / leftover HMAC / leftover Granot webhook secret (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Call Qualification](../../../../CONTEXT.md) / [Call Lead Ingestion](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(ringCentralWebhookRoutes)` on line 53, **first** webhook mount — **before** already-recommended Granot webhook, leftover RingCentral local webhook, leftover crons, leftover Granot automation, leftover public v1, leftover Best Relocation, leftover reporting). Already-recommended Wave A keep / party persist / session persist / promote / snapshot / last-seen / Call Log / cron route tests prove those **interfaces**, not this router. Knowledge lists `ringcentral-cron.routes.test.ts` and evaluate / collapse / ingest file tests — **none** HTTP-post this path. Operator `hit-vantage-api` does **not** list `/api/webhooks/ringcentral` or `/api/dev/ringcentral/*`. Not this **interface**: leftover `captureRingCentralWebhookEvent` itself, leftover `normalizeRingCentralWebhookPayload` itself, leftover `upsertRingCentralCallCandidateFromEvent` itself, leftover `processRingCentralCallSession` itself, leftover `ingestRingCentralQualifiedCall` itself, leftover `loadRingCentralRouteSnapshot` itself, leftover `appendLocalRingCentralWebhookEvent`, leftover `runRingCentralCallLogSync`.
- Seams callers need: `app.ts` **before** public v1 vs Owner desks **after** the secret; Validation-Token echo vs Granot webhook secret vs `CRON_SECRET`; keep-always vs process-only-when-enabled; always **200** vs Granot `202` only after commit / `503` on capture throw; `ingestEligible` (qualified **and** terminal) vs Call Log finalized duration; `ingestSessionLead` HTTP **adapter** vs `ingestRingCentralQualifiedCall` promotion gate; live-host debug token vs unguarded POST; `MONGO_URI` skip on party / session vs enrich still loading the inbound-number book. There is no factory inject **seam**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Call-Log-validate **seam** (the flag exists; this file never **asks** it).
- Split later (only if the file outgrows one sitting): this ~510-line file is one sitting if you read it as echo the Validation-Token so RingCentral keeps the subscription, keep the raw delivery, then when processing is on attribute the inbound number, remember each party, rebuild the session, and when the session is qualified and over hand it to shared Call Lead ingest — never let a processing throw become a 4xx or 5xx, never ingest a live call still under two minutes, never create a Call Lead outside the shared gate, never use the API secret or the cron secret. If it later splits: `echoTheValidationTokenAndKeepThisRawDelivery.ts` / `attributeRememberRebuildThenHandSharedIngestWhenQualifiedAndOver.ts` / `showTheLastRingCentralWebhookEvidenceOnTheDebugBoard.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `webhook.ts` / `debug.ts` / `ingest.ts`. Keep stays already-recommended `webhook-capture.ts`. Fold stays leftover `webhook-event-normalizer.ts`. Party persist stays already-recommended `call-candidate-store.ts`. Session persist stays already-recommended `call-session-store.ts`. Promote stays already-recommended `ringcentral-call-lead-ingest.service.ts`. Inbound-number book stays already-recommended `ringCentralSnapshot.ts`. Last-seen stays leftover `recordRingCentralRouteObservation`. Local JSONL stays leftover next `ringcentral-webhook-local.routes.ts`. Call Log trigger stays leftover next `ringcentral-cron.routes.ts`.

`router.get("/api/webhooks/ringcentral")` / `router.post("/api/webhooks/ringcentral")` / `router.get("/api/dev/ringcentral/*")` are HTTP verbs. The owner question is: *RingCentral just POSTed a telephony-sessions delivery — or asked whether this URL is still there. Echo the Validation-Token so they keep the subscription. Keep the raw delivery as an audit row even when webhook processing is off. When processing is on, fold every party, ask the inbound-number book which live call Feed this number pointed at when the call started, stamp last-seen, remember each party, rebuild the session, and when collapse says qualified **and** over, hand shared Call Lead ingest a webhook descriptor with no Call Log id. If normalize, enrich, party persist, session persist, or promote throws, RingCentral still hears 200 — they must not retry-storm. Do not ingest a live `pending_buffer` call. Do not create a Call Lead in this file. Do not compare `x-api-secret`. Do not teach this file `CRON_SECRET`. Operators may inspect the last events, candidates, sessions, processed calls, and runtime config on `/api/dev/ringcentral/*` when the live-host debug token allows.*

Who keep the raw delivery already lives in already-recommended `webhook-capture.ts`. Who fold every party already lives in leftover `webhook-event-normalizer.ts`. Who remember the party already lives in already-recommended `call-candidate-store.ts`. Who rebuild the session already lives in already-recommended `call-session-store.ts`. Who promote already lives in already-recommended `ringcentral-call-lead-ingest.service.ts`. Who say which live call Feed this number pointed at already lives in already-recommended `ringCentralSnapshot.ts`. Do not pull those in.

## What this file actually does

Three operations of one “echo the Validation-Token so RingCentral keeps the subscription, keep the raw delivery, then when processing is on attribute the inbound number, remember each party, rebuild the session, and when the session is qualified and over hand it to shared Call Lead ingest” story, not “a webhook CRUD dump,” and not Keep This Raw Delivery / Promote This Already-Qualified Inbound Call themselves:

1. **Prove the webhook URL is reachable** — `GET /api/webhooks/ringcentral`. Answer `{ ok: true, provider: "ringcentral", route, method: "GET", ready: true }`. This beat does **not** echo Validation-Token. This beat does **not** keep a delivery. This beat does **not** ask `requireApiSecret`. RingCentral subscription handshake POSTs Validation-Token; this GET is reachability only.

2. **Accept this RingCentral telephony delivery — echo the token, keep the raw event, then maybe process, always answer 200** — `POST /api/webhooks/ringcentral`. Read Validation-Token from `validation-token` / `Validation-Token`. Strip secrets from headers. Preview the first party for the receive log. If the token is present, set response `Validation-Token` **before** try. **Ask** `captureRingCentralWebhookEvent` **always** (Wave A never throws; no-`MONGO_URI` logs redacted and `{ storedRawEvent: false }`). If `isRingCentralWebhookEnabled()` is off (default **on**) answer **200** `{ processingEnabled: false, normalizedPartyEvents: 0, candidateUpdates: [], sessionUpdates: [] }` and stop. Else fold every party (`normalizeRingCentralWebhookPayload`), enrich inbound-number book + last-seen (`enrichRingCentralSourceEvents`), remember each party (`processCandidateUpdates` skips when `MONGO_URI` is missing), rebuild each touched session and hand shared ingest when `document.ingestEligible` (`processSessionsAndIngest` same `MONGO_URI` skip). Answer **200** with `storedRawEvent` / `duplicateRawEvent` / `processingEnabled: true` / counts / candidate and session updates. Outer catch logs `ringcentral.webhook.processing.failed` and still answers **200** `{ storedRawEvent: false, normalizedPartyEvents: 0, candidateUpdates: [], warning: "webhook_acknowledged_processing_failed" }` — even when keep already succeeded. `ingestSessionLead` builds `RingCentralQualifiedCall` `ingestionSource: "webhook"` `callLogId: null` from `document.leadPreview`. Promote throw logs `ringcentral.webhook.ingest_failed`, **asks** `recordOperationalEvent` `notificationCandidate: true`, returns `"ingest_failed"` — does **not** fail the POST. This beat does **not** ask `shouldWebhookCallLogValidate`. This beat does **not** ask `createRingCentralCallLead`. This beat does **not** ask `requireGranotWebhookSecret`.

3. **Show the operator the last RingCentral webhook evidence** — seven `GET /api/dev/ringcentral/*` HTTP **adapters** behind `requireRingCentralDebugAccess`. Non-live hosts always open. The live host needs `x-debug-token` matching `RINGCENTRAL_DEV_DEBUG_TOKEN`; miss **404** `{ ok: false, error: "Not found" }` (not 401 — hide the desk). Lists clamp `limit` 1–100, default 20. Paths ask `listRingCentralWebhookEvents` / `listRingCentralCallCandidates` / `listRingCentralCallCandidateDecisions` / `listRingCentralCallSessions` / `listRingCentralCallSessionDecisions` / `listProcessedCalls` / `getRingCentralRuntimeConfig`. `GET .../call-candidates/:telephonySessionId` asks find-by-session + find session; empty `:id` **400**. This beat does **not** keep a delivery. This beat does **not** promote. This beat does **not** echo Validation-Token.

`getValidationToken` / `headersToRecord` / `getEventHeaders` / `parseLimit` / `getSingleRouteParam` / `requireRingCentralDebugAccess` are beats inside these operations, not extra owner stories. The default export is the `Router()` instance — there is **no** factory inject.

There is no fourth Call-Log-validate operation. `shouldWebhookCallLogValidate` lives on leftover config and the debug GET config bag only. GET ready and POST handshake are two HTTP **adapters** for “RingCentral must keep this URL.” The seven debug GETs are HTTP **adapters** for operation 3.

## Organization

Keep one file. This is the screenplay for “echo the Validation-Token so RingCentral keeps the subscription, keep the raw delivery, then when processing is on attribute the inbound number, remember each party, rebuild the session, and when the session is qualified and over hand it to shared Call Lead ingest — never let a processing throw become a 4xx or 5xx, never ingest a live call still under two minutes, never create a Call Lead outside the shared gate, never use the API secret or the cron secret.” Already-recommended keep / leftover fold / already-recommended party persist / already-recommended session persist / already-recommended promote / already-recommended inbound-number book / leftover last-seen already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralWebhookRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches Granot webhook tests” without adding a paired HTTP proof. Do not invent a Call-Log-validate **adapter** so “the flag becomes true here.” Do not invent a CRUD folder so `webhook.ts` / `debug.ts` / `ingest.ts` each get a file.

Do not move `captureRingCentralWebhookEvent` into this file so “the route owns the audit row.” Do not move `ingestRingCentralQualifiedCall` into this file so “the webhook owns promote.” Do not mount this router inside leftover `v1.routes.ts` so “one file owns every webhook.” Do not merge this router into leftover next `ringcentral-webhook-local.routes.ts` so “one file owns every RingCentral POST.” Do not merge this router into leftover next `ringcentral-cron.routes.ts` so “one file owns hybrid Call Qualification.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ringCentralWebhookDesk` | `app.ts` mounts the instance **first**, **before** Granot webhook and public v1 |
| `GET /api/webhooks/ringcentral` (today unexported handler) | `proveTheWebhookUrlIsReachableOverHttp` | reachability; no token echo |
| `POST /api/webhooks/ringcentral` (today unexported handler) | `acceptThisRingCentralTelephonyDeliveryOverHttp` | echo token **then** keep **then** maybe process **always** 200 |
| `GET /api/dev/ringcentral/webhook-events` (today unexported handler) | `showRecentRawDeliveriesWithoutTheRawBodyOrHeadersOverHttp` | debug **adapter** on already-recommended keep list |
| `GET /api/dev/ringcentral/call-candidates` (today unexported handler) | `showRecentPartiesWithoutTheRawLatestPartyOverHttp` | debug **adapter** on already-recommended party list |
| `GET /api/dev/ringcentral/call-candidate-decisions` (today unexported handler) | `showRecentPartyDecisionTicksOverHttp` | every-tick trail |
| `GET /api/dev/ringcentral/call-sessions` (today unexported handler) | `showRecentSessionsWithoutTheLeadPreviewOverHttp` | debug **adapter** on already-recommended session list |
| `GET /api/dev/ringcentral/call-session-decisions` (today unexported handler) | `showRecentSessionStatusChangesOverHttp` | quieter trail |
| `GET /api/dev/ringcentral/processed-calls` (today unexported handler) | `showRecentProcessedCallLedgerRowsOverHttp` | promote idempotency board |
| `GET /api/dev/ringcentral/config` (today unexported handler) | `showTheRingCentralRuntimeFlagsOverHttp` | `getRingCentralRuntimeConfig` including the unread Call-Log validate flag |
| `GET /api/dev/ringcentral/call-candidates/:telephonySessionId` (today unexported handler) | `showThisTelephonySessionPartiesAndSessionOverHttp` | find + session together |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `storedRawEvent` / `duplicateRawEvent` / `ingestAction` / `webhook_acknowledged_processing_failed` as the domain language. Do **not** export `processCandidateUpdates` / `processSessionsAndIngest` / `ingestSessionLead` / `enrichRingCentralSourceEvents` so “the test can unit the helper.” Do **not** add `createRingCentralWebhookRouter({ capture, ingest })` in this rename so “this desk matches Granot” without a paired HTTP proof that live defaults still **ask** Wave A.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after keep (processing on or off):

```ts
type AcceptedRingCentralWebhookOverHttp = {
  ok: true
  provider: "ringcentral"
  storedRawEvent: boolean
  duplicateRawEvent?: boolean
  processingEnabled: boolean
  normalizedPartyEvents: number
  candidateUpdates: Array<{
    telephonySessionId: string
    partyId: string
    decisionStatus: string
    wouldCreateCallLead: boolean
    decisionReason: string
  }>
  sessionUpdates?: Array<{
    telephonySessionId: string
    decisionStatus: string
    statusChanged: boolean
    wouldCreateCallLead: boolean
    ingestEligible: boolean
    ingestAction: string | null
  }>
  warning?: "webhook_acknowledged_processing_failed"
}
```

That is the handoff from “RingCentral may stop retrying this delivery” to “later Call Log may promote the same physical call through the same gate.” Do **not** add `published` onto that bag (this desk does not poke a queue). Do **not** collapse GET ready into POST so “one verb owns handshake.”

Leave `captureRingCentralWebhookEvent` on already-recommended `webhook-capture.ts`. Leave `normalizeRingCentralWebhookPayload` on leftover skipped `webhook-event-normalizer.ts`. Leave `upsertRingCentralCallCandidateFromEvent` on already-recommended `call-candidate-store.ts`. Leave `processRingCentralCallSession` on already-recommended `call-session-store.ts`. Leave `ingestRingCentralQualifiedCall` on already-recommended `ringcentral-call-lead-ingest.service.ts`. Leave `loadRingCentralRouteSnapshot` / `resolveRingCentralInboundRoute` on already-recommended `ringCentralSnapshot.ts`. Leave last-seen on leftover `recordRingCentralRouteObservation`. Leave local JSONL on leftover next `ringcentral-webhook-local.routes.ts`. Leave Call Log trigger on leftover next `ringcentral-cron.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-webhook.routes.ts
// RingCentral just POSTed a telephony-sessions delivery.
// Echo the Validation-Token so they keep the subscription.
// Keep the raw delivery even when processing is off.
// When processing is on, attribute the inbound number,
// remember each party, rebuild the session,
// and when qualified and over,
// hand shared Call Lead ingest a webhook descriptor.
// If processing throws, still answer 200.
// Do not ingest a live pending_buffer call.
// Do not create a Call Lead here.
// Do not compare x-api-secret.
// Do not teach this file CRON_SECRET.

export function acceptThisRingCentralWebhookDesk() {
  const desk = Router()
  desk.get("/api/webhooks/ringcentral", proveTheWebhookUrlIsReachableOverHttp)
  desk.post("/api/webhooks/ringcentral", acceptThisRingCentralTelephonyDeliveryOverHttp)
  desk.get("/api/dev/ringcentral/webhook-events", showRecentRawDeliveriesOverHttp)
  desk.get("/api/dev/ringcentral/call-candidates", showRecentPartiesOverHttp)
  desk.get("/api/dev/ringcentral/call-candidate-decisions", showRecentPartyDecisionTicksOverHttp)
  desk.get("/api/dev/ringcentral/call-sessions", showRecentSessionsOverHttp)
  desk.get("/api/dev/ringcentral/call-session-decisions", showRecentSessionStatusChangesOverHttp)
  desk.get("/api/dev/ringcentral/processed-calls", showRecentProcessedCallLedgerRowsOverHttp)
  desk.get("/api/dev/ringcentral/config", showTheRingCentralRuntimeFlagsOverHttp)
  desk.get(
    "/api/dev/ringcentral/call-candidates/:telephonySessionId",
    showThisTelephonySessionPartiesAndSessionOverHttp,
  )
  return desk
}

export default acceptThisRingCentralWebhookDesk()

// ── 1. Prove the URL is reachable ─────────────────────────

function proveTheWebhookUrlIsReachableOverHttp(_req, res) {
  return res.json({
    ok: true,
    provider: "ringcentral",
    route: "/api/webhooks/ringcentral",
    method: "GET",
    ready: true,
  })
}

// ── 2. Accept this telephony delivery ─────────────────────

async function acceptThisRingCentralTelephonyDeliveryOverHttp(req, res) {
  const token = readTheValidationToken(req)
  echoTheValidationTokenSoTheyKeepTheSubscription(res, token)
  rememberWeReceivedThisDelivery(req, token)           // first-party preview only

  try {
    const kept = await keepThisRawDeliveryAsAnAuditRow(req)  // always; never throws

    if (!webhookProcessingIsOn()) {
      return acceptedWithoutProcessing(res, kept)
    }

    const parties = foldEveryPartyOnThisDelivery(req)
    const attributed = await attributeTheInboundNumberAndStampLastSeen(parties)
    const candidateUpdates = await rememberEachPartyWhenMongoIsConfigured(attributed)
    const sessionUpdates = await rebuildEachTouchedSessionAndHandSharedIngestWhenQualifiedAndOver(attributed)
    return acceptedAfterProcessing(res, kept, parties, candidateUpdates, sessionUpdates)
  } catch (error) {
    rememberProcessingFailedWithoutChangingTheAnswer(error)
    return acknowledgedAnywayEvenIfKeepAlreadySucceeded(res)  // 200 warning
  }
}

async function attributeTheInboundNumberAndStampLastSeen(parties) {
  const book = await loadTheInboundNumberBook()
  return Promise.all(parties.map(async (party) => {
    if (!party.callStartedAt) return party
    const resolution = sayWhichLiveCallFeedThisNumberPointedAtWhenTheCallStarted(
      book,
      party.normalizedToPhoneNumber ?? party.toPhoneNumber,
      party.callStartedAt,
    )
    if (!resolution) return party
    await stampLastSeenOnTheWebhookPath(resolution.route_id, party.receivedAt, party.toName)
    return { ...party, targetMatched: true, sourceCompany, sourceLabel, routeResolution }
  }))
}

async function rememberEachPartyWhenMongoIsConfigured(parties) {
  if (!mongoUriIsConfigured()) return []
  return rememberEachPartyAndAppendThisTicksDecision(parties)
}

async function rebuildEachTouchedSessionAndHandSharedIngestWhenQualifiedAndOver(parties) {
  if (!mongoUriIsConfigured()) return []
  const sessionIds = uniqueTelephonySessionIds(parties)
  const updates = []
  for (const id of sessionIds) {
    const rebuilt = await loadEveryPartyThenAskAlreadyRecommendedCollapseAndPersistTheSession(id)
    if (!rebuilt) continue
    let ingestAction = null
    if (rebuilt.document.ingestEligible) {
      ingestAction = await handSharedIngestThisWebhookQualifiedCall(rebuilt.document)
    }
    updates.push({ ...rebuilt, ingestAction })
  }
  return updates
}

async function handSharedIngestThisWebhookQualifiedCall(document) {
  const preview = document.leadPreview
  if (!preview) return null
  try {
    const result = await promoteThisAlreadyQualifiedInboundCallIntoACallLead({
      ingestionSource: "webhook",
      callLogId: null,
      // phones / route / answered / terminal / duration
    })
    return result.action
  } catch (error) {
    rememberThePromoteFailedWithoutFailingTheWebhook(document, preview, error)
    return "ingest_failed"
  }
}

// ── 3. Show the last evidence on the debug board ──────────

function refuseTheDebugBoardOnTheLiveHostWithoutTheDebugToken(req, res, next) {
  if (!thisHostIsLive()) return next()
  if (debugTokenMatches(req)) return next()
  return res.status(404).json({ ok: false, error: "Not found" })
}
```

Read the desk path out loud: *RingCentral POSTed `/api/webhooks/ringcentral`. Echo the Validation-Token first so subscription creation succeeds even if Mongo is down. Keep the raw delivery as an audit row — processing off does not skip that keep. When processing is on, fold every party, ask the inbound-number book which live call Feed this number pointed at when the call started, stamp last-seen, remember each party, rebuild the session, and when collapse says qualified and over, hand shared Call Lead ingest a webhook descriptor with no Call Log id. If that promote throws, record the letter and still answer 200. If normalize or persist throws after keep already succeeded, still answer 200 — even though today’s body then lies `storedRawEvent: false`. Do not ingest a live pending_buffer call. Do not create a Call Lead in this file.*

That is the operation. `router.post("/api/webhooks/ringcentral")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Always 200 is the RingCentral retry seam, not a Granot copy.** Knowledge and Wave A keep lock this: capture never throws; this file still answers 200 after a processing throw. Do not silently 503 a processing miss so “this desk matches leftover Granot capture.” Do not silently 202 so “every inbound webhook matches leftover Granot.” Validation-Token is already on the response before try — keep that order.

2. **The catch lies about keep.** After `captureRingCentralWebhookEvent` succeeds, a later normalize / enrich / party / session throw answers `{ storedRawEvent: false, warning: "webhook_acknowledged_processing_failed" }`. Wave A keep already returned `{ storedRawEvent, duplicate }`. Do not silently echo the captured bag on the warning path in this rename without a paired test. Park the lie.

3. **Promote throw is a letter, not a webhook failure.** `ingestSessionLead` catches, **asks** `recordOperationalEvent` `ringcentral.webhook.ingest_failed`, returns `"ingest_failed"`, and the POST still 200s with that `ingestAction`. Outer catch is for everything else and does **not** emit that event. Do not silently emit `ingest_failed` from the outer catch so “one letter owns every throw.”

4. **`MONGO_URI` skip is only on party persist and session persist.** Enrich still **asks** `loadRingCentralRouteSnapshot` (Mongo through leftover Registry). Missing URI can therefore throw in enrich and hit the lying 200 warning, while candidate/session would have returned `[]`. Do not silently skip enrich when URI is missing so “one skip owns every Mongo beat” without a paired test.

5. **`ingestEligible` is qualified and over.** Already-recommended collapse stamps it. This file **asks** shared ingest only then. Do not silently ingest `pending_buffer` so “webhooks can mint a Lead at two minutes while the caller is still on the line.” Do not silently **ask** `shouldWebhookCallLogValidate` so “the leftover flag becomes true here.” Knowledge names that flag as future hardening, off by default.

6. **This desk never uses the API secret, HMAC, Granot webhook secret, or the cron secret.** `app.ts` mounts it first, before leftover Granot webhook and leftover public v1. Validation-Token is handshake, not payload auth. Do not remount `requireApiSecret` so “it matches leftover reporting.” Do not teach this file `CRON_SECRET` so “one file owns hybrid Call Qualification.”

7. **Debug 404 hides the desk.** The live host without a matching `x-debug-token` answers `{ ok: false, error: "Not found" }`, not 401. Non-live hosts always open. Do not silently 401 so “debug matches leftover Owner HMAC.” Do not move the seven GETs into a `debug.ts` CRUD file.

8. **There is no factory inject.** Granot webhook tests inject `capture` / `publish`. This file exports only the live `Router()`. Do not add `createRingCentralWebhookRouter` in this rename without a paired HTTP proof. Today there is **no** `ringcentral-webhook.routes.test.ts`.

9. **Leave sibling modules alone.** `captureRingCentralWebhookEvent` / `normalizeRingCentralWebhookPayload` / `upsertRingCentralCallCandidateFromEvent` / `processRingCentralCallSession` / `ingestRingCentralQualifiedCall` / `loadRingCentralRouteSnapshot` / `recordRingCentralRouteObservation` are already the right **depth**. This file orchestrates the HTTP **adapter**.

10. **Do not treat leftover Granot inbound, leftover local JSONL, leftover Call Log cron, leftover Owner inbound-number desk, leftover subscribe, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, or leftover Granot automation as this story.** Next `ringcentral-webhook-local.routes.ts` is local-file capture. Next `ringcentral-cron.routes.ts` is the Call Log trigger. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisRingCentralWebhookDesk` (mounted on `app.ts` **first**, **before** public v1 as the default export) and the three HTTP operations above.

Today there is **no** `ringcentral-webhook.routes.test.ts`. Wave A file tests prove keep / fold / party / session / promote / snapshot through those **interfaces**. Add an HTTP proof that names the operation (do not boot live RingCentral or walk `createRingCentralCallLead` in the route file):

**Handshake / who may speak**
- This desk is mounted from `app.ts` **before** `granotWebhookRoutes` and **before** `v1Routes`.
- GET answers `{ ready: true }` with no Validation-Token echo and no keep.
- POST with Validation-Token sets response `Validation-Token` **before** keep / process.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / `CRON_SECRET` are **not** accepted here.

**Keep, then maybe process**
- Keep **asks** `captureRingCentralWebhookEvent` even when `RINGCENTRAL_WEBHOOK_ENABLED` is off.
- Processing off **200** `{ processingEnabled: false, normalizedPartyEvents: 0 }` and does **not** ask fold / party persist / session persist / promote.
- Processing on folds every party, enriches the inbound-number book, remembers each party when `MONGO_URI` is set, rebuilds each touched session, and **asks** `ingestRingCentralQualifiedCall` only when `document.ingestEligible`.
- Missing `MONGO_URI` still enriches (snapshot load) and returns empty candidate / session updates when processing is on.
- Promote throw records `ringcentral.webhook.ingest_failed` and still **200** with `ingestAction: "ingest_failed"`.
- Normalize / enrich / party / session throw still **200** `webhook_acknowledged_processing_failed` (name today’s `storedRawEvent: false` lie vs keep already succeeding).
- This beat does **not** ask `shouldWebhookCallLogValidate` / `createRingCentralCallLead` / `claimAndProcessOrPoll`.

**Debug board**
- Non-live hosts list open without a token.
- Live-host missing / wrong `x-debug-token` **404** `"Not found"`.
- Session page **400** when `telephonySessionId` is empty.
- Limit clamps 1–100, default 20.

**Mount**
- `app.ts` should keep `app.use(ringCentralWebhookRoutes)` before `granotWebhookRoutes` and `v1Routes`.
- Leftover local webhook and leftover Call Log cron stay mounted later and are not this desk.

**Not this file**
- Keep stays on already-recommended [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md).
- Fold stays on leftover skipped `webhook-event-normalizer.ts`.
- Party persist stays on already-recommended [ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md).
- Session persist stays on already-recommended [ringcentral-call-session-store.md](ringcentral-call-session-store.md).
- Promote stays on already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md).
- Inbound-number book stays on already-recommended [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md).
- Local JSONL stays on next `ringcentral-webhook-local.routes.ts`.
- Call Log trigger stays on next `ringcentral-cron.routes.ts`.

Do **not** add a test per helper (`readTheValidationToken`, `echoTheValidationTokenSoTheyKeepTheSubscription`, `handSharedIngestThisWebhookQualifiedCall`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory inject in this rename so “the test can no longer see the live Wave A defaults.” If a later implementer adds inject, the HTTP proof must still name the live defaults.

## What I would not do

- A `RingCentralWebhookRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, provider: "ringcentral" })`.
- Moving this into a CRUD folder (`webhook.ts` / `debug.ts` / `ingest.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the always-200 **seam**: do not 503 a processing throw so “this desk matches leftover Granot.”
- Breaking the keep-always **seam**: do not skip capture when processing is off.
- Breaking the qualified-and-over **seam**: do not ingest a live `pending_buffer` call.
- Breaking the shared-promote **seam**: do not call `createRingCentralCallLead` from this file.
- Breaking the unguarded-inbound **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / `CRON_SECRET` here.
- Treating leftover `captureRingCentralWebhookEvent`, leftover `normalizeRingCentralWebhookPayload`, leftover `upsertRingCentralCallCandidateFromEvent`, leftover `processRingCentralCallSession`, leftover `ingestRingCentralQualifiedCall`, leftover `loadRingCentralRouteSnapshot`, leftover `recordRingCentralRouteObservation`, leftover Granot inbound, leftover local JSONL, leftover Call Log cron, leftover Owner inbound-number desk, leftover subscribe, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, leftover Granot automation, leftover webhook / cron routers, or leftover Owner apply as this story.
- Inventing a leftover factory-inject / leftover Call-Log-validate / leftover cron-secret / leftover Zod / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently 503 a processing throw, 202 a keep, ingesting `pending_buffer`, asking `shouldWebhookCallLogValidate`, remounting `requireApiSecret`, teaching this file `CRON_SECRET`, or splitting webhook / debug / ingest into three files while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
