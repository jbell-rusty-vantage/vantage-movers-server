# Show The Signed Owner The Newest Conversations Without The Words After The Secret, Show This Lead's Conversations The Same Way, Issue A Five-Minute Listen URL And Write Who Listened, Then Open One Conversation With The Already-Redacted Transcript — Never Put This Desk Before The Secret, Never Paint Words On The List, Never Sign Before Load, Never Embed A Forever Blob Link, Never Discover Or Attach, Never Seed, Never Write The Lead — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 7 of this service — `conversations-admin.routes.ts`
- Remaining in this service: `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/conversations-admin.routes.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (Owner-only reads; list and by-lead hide transcript / summary text; detail shows the already-redacted transcript plus sectioned summary; `GET .../:id/audio-url` is a short-lived signed URL and is audited; Lead and Booking are not mutated). Owner spec §5.9 (`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`) names this file as a separate router because it serves transcript text and therefore a stricter posture than the rest of the Daily View; shipped four GETs; deferred `discover` / `retry` / `detach` / `attach` stay off this desk. Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(conversationsAdminRoutes)` on line 294, **after** `/api/v1` secret and after leftover Job Number timeline — this file **is** that mount). Distinct from already-recommended unguarded desks: [routes-extension-auth.md](routes-extension-auth.md) and [routes-google-drive-oauth.md](routes-google-drive-oauth.md) (those sit **before** the secret). Distinct from already-recommended sibling after-secret desks: [routes-ringcentral-registry.md](routes-ringcentral-registry.md), [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md), [routes-job-number-timeline-admin.md](routes-job-number-timeline-admin.md) (none of those paint a transcript or issue a listen URL). Distinct from already-recommended Wave A desk reads: [conversations-reads.md](conversations-reads.md) (`listConversations` / `listConversationsByLead` / `getConversationById` / `toConversationDetail` — this file **asks** those; it does **not** hop Mongo itself). Distinct from already-recommended locker: [conversations-media.md](conversations-media.md) (`issueConversationAudioUrl` — this file **asks** it after load + purged check; it does **not** `put`). Distinct from already-recommended PCI strip: [conversations-redaction.md](conversations-redaction.md) (**does not import** this file; this file **must not** import `redactTranscript`). Distinct from already-recommended artifact seed: [conversations-seed-from-artifacts.md](conversations-seed-from-artifacts.md) (**does not import** this file; this file **must not** seed `CHRIS_HUGHES_SEED`). Distinct from already-recommended audit write: [observability-record-operational-event.md](observability-record-operational-event.md) (`recordOperationalEvent` — this file **asks** it **after** leftover `issueConversationAudioUrl` returns; leftover `conversation.audio_url.issued`). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` — this file **asks** it on **all four** paths; signed Admin is **403**; an extension Owner Bearer may **not** read these paths). Distinct from leftover Wave B config: `src/config/domain/conversations.ts` (`LEAD_CONVERSATION_LEAD_MODELS` for leftover Zod `model`; leftover `CONVERSATION_AUDIO_URL_TTL_MS` lives on the locker, not here). Distinct from leftover Wave B Zod barrel: `src/validation/v1/` has **no** conversation schema — leftover `leadParamsSchema` / leftover `idParamsSchema` live in this file. Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it). Distinct from leftover Admin browse: [admin-browse.md](admin-browse.md) has **no** `conversations` resource. Distinct from leftover operator seed: `scripts/conversations/seed-known-conversation.ts` (upsert — not this desk). Distinct from leftover Daily Operations: project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount, and do not merge this desk into it so “one Daily View owns every transcript.” This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md), [Conversation Match](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Routes Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: **one runtime mount plus one focused route test plus a folder mount proof.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(conversationsAdminRoutes)` on line 294, **after** `router.use("/api/v1", requireApiSecret)` and after leftover Job Number timeline). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `conversations-admin.routes.test.ts` (injects leftover `createConversationsAdminRouter` deps; signs leftover HMAC; names Owner list without transcript text, Owner by-lead without transcript / summary sentences, Owner detail with leftover `transcript.text` plus leftover `sections.mismatch === null` on the all-clear sentence, Admin **403** on leftover audio-url with **no** audit, Owner leftover audio-url **200** + leftover `conversation.audio_url.issued`). It does **not** name leftover Zod `400` `"invalid_conversation_query"`. It does **not** name leftover `404` `"conversation_not_found"`. It does **not** name leftover `409` `"conversation_audio_unavailable"`. It does **not** name Admin **403** on list / by-lead / detail. It does **not** name unsigned / missing-HMAC refuse body. It does **not** prove leftover `by-lead` / leftover `audio-url` are registered **before** leftover `/:id`. Folder `v1.routes.test.ts` only proves the four paths are mounted (`/api/v1/admin/conversations`, `/by-lead/:model/:id`, `/:id/audio-url`, `/:id`). Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists **none** of this desk. Already-recommended Wave A `reads.test.ts` / `media.ts` (no `media.test.ts`) / `seedFromArtifacts.test.ts` / `redaction.test.ts` prove leftover paint / locker / seed / PCI through the service, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/conversations*`. Not this **interface**: leftover `listConversations`, leftover `toConversationDetail`, leftover `issueConversationAudioUrl`, leftover `redactTranscript`, leftover `parseConversationArtifact`, leftover `uploadConversationMp3`, leftover `recordOperationalEvent` itself, leftover `browseAdminResource`.
- Seams callers need: after `/api/v1` secret (parent mount) vs Drive / extension desks **before**; leftover `GET .../by-lead/:model/:id` and leftover `GET .../:id/audio-url` **before** leftover `GET .../:id` (Express first-match; four HTTP **adapters** on one factory); leftover `requireRegistryOwnerActor` on **all four** paths (no leftover read-actor hatch — signed Admin is **403**); leftover load vs leftover paint (audio-url **and** detail share leftover `getConversationById`; only detail **asks** leftover `toConversationDetail`); leftover `404` `"conversation_not_found"` vs leftover `409` `"conversation_audio_unavailable"` (missing / purged pathname — never leftover `200` with an empty URL); leftover audit **after** leftover `issueConversationAudioUrl` returns (not before sign, not on 404 / 409 / 403); leftover factory `createConversationsAdminRouter(deps)` (test injection) vs default export (live mount); leftover `sendError` leftover `isRegistryError` → `{ ok: false, code: registryCode, error: message, request_id }` vs leftover `ZodError` → `400` `"invalid_conversation_query"` (no leftover `issues`) vs unhandled → `500` `{ error: error.message }` (**does** echo leftover `error.message`, unlike already-recommended Job Number timeline leftover `"Internal error"`). There is no begin / complete Domain Command **seam** in this file. There is no redact **seam**. There is no seed **seam**. There is no locker-put **seam**. There is no discover / attach write **seam**.
- Split later (only if the file outgrows one sitting): this ~171-line file is one sitting if you read it as show the signed Owner the newest conversations without the words after the secret, show this Lead’s conversations the same way, issue a five-minute listen URL and write who listened, then open one conversation with the already-redacted transcript — never put this desk before the secret, never paint words on the list, never sign before load, never embed a forever blob link, never discover or attach, never seed, never write the Lead. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `audio.ts`. Desk paint stays already-recommended `reads.ts`. Locker sign stays already-recommended `media.ts`. Audit persist stays already-recommended `recordOperationalEvent.ts`. PCI strip stays already-recommended `redaction.ts`. Artifact seed stays already-recommended `seedFromArtifacts.ts`.

`router.get("/api/v1/admin/conversations")` / `router.get(".../by-lead/:model/:id")` / `router.get(".../:id/audio-url")` / `router.get(".../:id")` are HTTP verbs. The owner question is: *The Owner opened the conversation desk. Someone already passed the API secret. First show the newest conversations — say whether each one has a transcript, a summary, and a CRM mismatch, but do not put the words on that card. When they are on a Form Lead or a Call Lead, show that Lead’s conversations the same way. When they press play, load the conversation or say it is missing; if the recording is gone or purged, refuse listen; if it is there, issue a five-minute URL and write who listened. When they open one card, paint the already-redacted transcript and the six summary sections. Do not put this desk before the secret. Do not redact fresh STT here. Do not seed the known inbound Call Lead. Do not discover, attach, or detach. Do not embed a forever blob link. Do not write the Lead or the Booking.*

Who paints the list card and the opened card already lives in already-recommended `reads.ts`. Who issues the five-minute get-only URL already lives in already-recommended `media.ts`. Who writes the happening down already lives in already-recommended `recordOperationalEvent.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Who strips cards / SSN / email already lives in already-recommended `redaction.ts`. Who stamps the seeded bags already lives in already-recommended `seedFromArtifacts.ts`. Do not pull those in.

## What this file actually does

Four operations for the conversation **desk**, not “a conversation CRUD dump,” and not Show The Newest Conversations / Issue The Five-Minute Listen URL themselves:

1. **Show the newest conversations without the words** — `GET /api/v1/admin/conversations`. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor(req, auth(req))`. **Ask** leftover `list` (injected, or leftover `listConversations`). Answer **200** `{ ok: true, data }`. This beat does **not** parse a query. This beat does **not** **ask** leftover `getById`. This beat does **not** remount leftover `requireApiSecret`. This beat does **not** page.

2. **Show this Lead’s conversations without the words** — `GET /api/v1/admin/conversations/by-lead/:model/:id`. Same connect + leftover Owner gate. Parse leftover `leadParamsSchema` (`model` leftover `FormLead` | leftover `CallLead`; leftover `id` trim min 1). **Ask** leftover `listByLead` (injected, or leftover `listConversationsByLead`). Answer **200** `{ ok: true, data }`. A junk Lead id that still passes Zod becomes leftover `[]` from the service, not leftover `404`. This beat does **not** attach the Call Lead document. This beat does **not** **ask** leftover `toConversationDetail`.

3. **Issue a five-minute listen URL and write who listened** — `GET /api/v1/admin/conversations/:id/audio-url`. Registered **before** leftover `GET .../:id`. Same connect + leftover Owner gate (keeps leftover `actor` for the audit). Parse leftover `idParamsSchema`. **Ask** leftover `getById`. Miss → **404** `{ ok: false, error: "conversation_not_found", request_id }`. Missing leftover `media.blob_pathname` **or** leftover `media.purged_at` → **409** `{ ok: false, error: "conversation_audio_unavailable", request_id }` and **does not** **ask** leftover `issueAudioUrl`. Else **ask** leftover `issueAudioUrl(pathname)`, then leftover `auditAudio` (`conversation.audio_url.issued`, leftover `actor_id`, leftover `conversation_id`, leftover `expires_at`, leftover `piiPolicy: "none"`, leftover `reportable: true`). Answer **200** `{ ok: true, data }`. This beat does **not** **ask** leftover `toConversationDetail`. This beat does **not** return leftover `media.blob_url`. This beat does **not** `put` a new object.

4. **Open one conversation with the already-redacted transcript** — `GET /api/v1/admin/conversations/:id`. Same connect + leftover Owner gate. Parse leftover `idParamsSchema`. **Ask** leftover `getById`. Miss → **404** `"conversation_not_found"`. Found → **200** `{ ok: true, data: toConversationDetail(conversation) }`. This beat does **not** **ask** leftover `issueAudioUrl`. This beat does **not** re-redact leftover `transcript.text`. This beat does **not** write an audit row.

`auth` / `requestId` / leftover `sendError` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `requestId` prefers leftover `x-vantage-admin-request-id`, else leftover `x-request-id`. Leftover `sendError` is leftover `isRegistryError` → leftover `error.statusCode` + leftover `code: registryCode` + leftover `request_id`; leftover `ZodError` → **400** `{ ok: false, error: "invalid_conversation_query", request_id }` with **no** leftover `issues`; else **500** `{ ok: false, error: error.message }` (**does** echo leftover `Error.message`; a non-Error becomes leftover `"Internal error"`). They are private. Leftover `sendError` does **not** log.

There is no fifth discover / attach / detach / retry operation. Spec §5.9 names those as deferred mutations. Leftover list / leftover by-lead / leftover listen / leftover open are four HTTP **adapters** on one factory. Leftover `404` and leftover `409` are two refuse **adapters** on the listen path — do not collapse them so “one missing owns play.”

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed Owner see the newest conversations without the words, see this Lead’s conversations the same way, press play for a five-minute URL that is written down, then open one card with the already-redacted transcript — never paint words on the list, never sign before load, never embed a forever blob link, never discover or attach.” Already-recommended leftover reads / leftover locker / leftover audit / leftover speaking gate / leftover PCI / leftover seed already live in deeper **modules**. Do not pull those in. Do not invent a `ConversationsAdminRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a write **adapter** so “the desk can attach a Lead.” Do not invent a redact **adapter** so “detail is extra safe.” Do not invent a CRUD folder so `list.ts` / `get.ts` / `audio.ts` each get a file.

Do not move leftover `toConversationDetail` into this file so “the route owns the card.” Do not move leftover `issueConversationAudioUrl` into leftover `reads.ts` so “detail can play.” Do not mount this router before leftover `requireApiSecret` so “it matches Drive.” Do not merge this router into `v1.routes.ts` so “one file owns every admin path.” Do not merge this router into a missing Daily Operations desk so “one Daily View owns every transcript.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createConversationsAdminRouter` | `createOwnerConversationDesk` | leftover factory injects connect / list / by-lead / load / issue / audit for the route test |
| `default` router | `ownerConversationDesk` | already-recommended public v1 desk mounts the zero-arg instance **after** the secret |
| `GET .../conversations` (today unexported handler) | `showTheNewestConversationsWithoutTheWordsOverHttp` | Owner desk list; never leftover `getById` |
| `GET .../by-lead/:model/:id` (today unexported handler) | `showThisLeadsConversationsWithoutTheWordsOverHttp` | Owner Lead drawer; leftover Zod then leftover `listByLead`; junk id is empty |
| `GET .../:id/audio-url` (today unexported handler) | `issueAFiveMinuteListenUrlAndWriteWhoListenedOverHttp` | Owner play; registered before leftover `/:id`; leftover 404 / leftover 409 / leftover audit after sign |
| `GET .../:id` (today unexported handler) | `openOneConversationWithTheAlreadyRedactedTranscriptOverHttp` | Owner opened card; leftover load then leftover `toConversationDetail`; never leftover issue |
| `ConversationsAdminDeps` | `OwnerConversationDeskDeps` | test injection bag — connect / list / listByLead / getById / issueAudioUrl / auditAudio |

Keep the default export and the factory as one-line aliases until `v1.routes.ts` and the route test migrate. Do not make callers learn `leadParamsSchema` / `idParamsSchema` / `sendError` / `auth` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`listConversations` / `toConversationDetail` / `issueConversationAudioUrl` / `recordOperationalEvent`) here — those stay already-recommended Wave A. Do **not** add leftover `POST .../discover` / leftover `.../attach` / leftover `.../detach` / leftover `.../retry` so “the spec deferred list becomes true.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover listen path already paints after leftover `issueConversationAudioUrl` returns:

```ts
type OwnerConversationListenResponse = {
  ok: true
  data: { url: string; expires_at: string; ttl_ms: number }
}
```

That is the handoff from “the locker already signed a five-minute get” to “the Admin Dashboard may fetch audio without storing a forever blob link.” Do **not** add leftover `blob_url` onto that bag. Do **not** add leftover `transcript` onto that bag. Do **not** add leftover `actor_id` onto that bag — the audit already stored it.

A second named bag already exists for the opened card (already-recommended leftover `ConversationDetail`). Do **not** re-declare it here. Leave leftover `toConversationDetail` on already-recommended `reads.ts`.

Leave leftover `listConversations` / leftover `getConversationById` on already-recommended `reads.ts`. Leave leftover `issueConversationAudioUrl` on already-recommended `media.ts`. Leave leftover `recordOperationalEvent` on already-recommended `recordOperationalEvent.ts`. Leave leftover speaking gate on already-recommended `trustedActor.ts`. Leave leftover PCI on already-recommended `redaction.ts`. Leave leftover seed on already-recommended `seedFromArtifacts.ts`. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// conversations-admin.routes.ts
// Someone already passed the API secret.
// Let a signed Owner see the newest conversations without the words.
// When they are on a Lead, show that Lead's conversations the same way.
// When they press play, issue a five-minute listen URL and write who listened.
// When they open one card, paint the already-redacted transcript.
// Do not put this desk before the secret.
// Do not paint words on the list.
// Do not sign before load.
// Do not embed a forever blob link.
// Do not discover or attach.
// Do not seed.
// Do not write the Lead.

export function createOwnerConversationDesk(deps = {}) {
  const ownerConversationDesk = Router()
  const connect = deps.connect ?? connectMongo
  const listNewest = deps.list ?? listConversations
  const listThisLead = deps.listByLead ?? listConversationsByLead
  const loadOne = deps.getById ?? getConversationById
  const issueListenUrl = deps.issueAudioUrl ?? issueConversationAudioUrl
  const writeWhoListened = deps.auditAudio ?? recordOperationalEvent

  // ── 1. Show the newest conversations without the words ─

  ownerConversationDesk.get(
    "/api/v1/admin/conversations",
    showTheNewestConversationsWithoutTheWordsOverHttp,
  )

  // ── 2. Show this Lead's conversations without the words ─

  ownerConversationDesk.get(
    "/api/v1/admin/conversations/by-lead/:model/:id",
    showThisLeadsConversationsWithoutTheWordsOverHttp,
    // registered before /:id so "by-lead" is not a conversation id
  )

  // ── 3. Issue a five-minute listen URL and write who listened ─

  ownerConversationDesk.get(
    "/api/v1/admin/conversations/:id/audio-url",
    issueAFiveMinuteListenUrlAndWriteWhoListenedOverHttp,
    // registered before /:id so "audio-url" is not stolen
  )

  // ── 4. Open one conversation with the already-redacted transcript ─

  ownerConversationDesk.get(
    "/api/v1/admin/conversations/:id",
    openOneConversationWithTheAlreadyRedactedTranscriptOverHttp,
  )

  return ownerConversationDesk
}

async function showTheNewestConversationsWithoutTheWordsOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const data = await listNewest()
  return res.status(200).json({ ok: true, data })
}

async function showThisLeadsConversationsWithoutTheWordsOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const params = parseTheLeadDrawerParams(req.params) // Zod; bad model → 400
  const data = await listThisLead(params)             // junk ObjectId → []
  return res.status(200).json({ ok: true, data })
}

async function issueAFiveMinuteListenUrlAndWriteWhoListenedOverHttp(req, res) {
  await connect()
  const actor = requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const { id } = parseTheConversationId(req.params)
  const conversation = await loadOne(id)
  if (!conversation) {
    return refuseConversationMissing(res, requestId(req))
  }
  const pathname = conversation.media?.blob_pathname
  if (!pathname || conversation.media?.purged_at) {
    return refuseListenUnavailable(res, requestId(req))
  }
  const data = await issueListenUrl(pathname)         // never toConversationDetail
  await writeWhoListened({
    eventKey: "conversation.audio_url.issued",
    entity: { type: "LeadConversation", id: String(conversation._id) },
    details: { conversation_id, actor_id: actor.actorId, expires_at: data.expires_at },
  })
  return res.status(200).json({ ok: true, data })
}

async function openOneConversationWithTheAlreadyRedactedTranscriptOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const { id } = parseTheConversationId(req.params)
  const conversation = await loadOne(id)
  if (!conversation) {
    return refuseConversationMissing(res, requestId(req))
  }
  return res.status(200).json({
    ok: true,
    data: toConversationDetail(conversation),         // never issueListenUrl
  })
}

function refuseTheDesk(res, error, requestId) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestId ?? null,
    })
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "invalid_conversation_query",
      request_id: requestId ?? null,
    })
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
    request_id: requestId ?? null,
  })
}
```

Read the desk path out loud: *Someone already passed the API secret. A signed Owner opens the desk. Show the newest conversations without the words. When they are on a Lead, show that Lead’s conversations the same way. When they press play, load the conversation or say it is missing; refuse listen when the recording is gone or purged; otherwise issue a five-minute URL and write who listened. When they open one card, paint the already-redacted transcript. Do not sign before load. Do not embed a forever blob link. Do not discover or attach.*

That is the operation. `router.get("/api/v1/admin/conversations/:id")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Drive and extension login do not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. Leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Owner transcripts can run without a secret.”

2. **`by-lead` and `audio-url` must stay registered before `/:id`.** Today leftover `GET .../by-lead/:model/:id` and leftover `GET .../:id/audio-url` sit above leftover `GET .../:id`. If leftover `/:id` moved first, leftover `"by-lead"` would become a conversation id and leftover `"audio-url"` would never match as a suffix on some Express stacks. Keep the registered-before-id order. Do not silently swap them so “detail is the primary path.” Do not silently merge leftover listen onto leftover `GET .../:id?play=1` so “one id path owns words and audio.”

3. **Load and paint stay split.** Leftover listen **and** leftover open **ask** leftover `getConversationById`. Only leftover open **asks** leftover `toConversationDetail`. Already-recommended Wave A rec already names that split as load-bearing. Do not fold leftover paint into leftover `getById` so “get returns the DTO” — leftover listen would then drag the transcript into a signing route. Do not make leftover listen **ask** leftover `toConversationDetail`.

4. **`404` `"conversation_not_found"` is not `409` `"conversation_audio_unavailable"`.** Miss / invalid ObjectId (service `null`) is leftover `404` on leftover listen **and** leftover open. Missing leftover `blob_pathname` **or** leftover `purged_at` is leftover `409` on leftover listen only, and leftover `issueAudioUrl` is not called. Do not silently map leftover purged onto leftover `404` so “one missing owns play.” Do not silently answer leftover `200` `{ url: null }` so “the desk can hide the button.”

5. **Audit is after a successful sign, not on refuse.** Leftover `writeWhoListened` runs after leftover `issueAudioUrl` returns. Admin **403**, leftover `404`, and leftover `409` must not write leftover `conversation.audio_url.issued`. The route test already locks Admin **403** with leftover `audits.length === 0`. It does **not** lock leftover 404 / leftover 409 skip. Do not silently audit before leftover `issueAudioUrl` so “we log the click.” Do not silently import leftover `recordOperationalEvent` into leftover `media.ts` so “the locker can log.”

6. **Spec §5.9 says `writeAuditLog`. The file **asks** leftover `recordOperationalEvent`.** Knowledge says “audited.” Already-recommended observability rec is the write. Do not invent a `writeAuditLog` helper so “the spec sentence becomes true.” Do not drop leftover `piiPolicy: "none"` / leftover `reportable: true` so “listen is quieter.”

7. **Unhandled `500` echoes leftover `error.message`.** Already-recommended Job Number timeline leftover `sendError` maps unhandled to leftover `"Internal error"` and logs leftover `job-number-timeline.admin.unhandled`. This desk echoes leftover `Error.message` and does **not** log. A leftover `"BLOB_READ_WRITE_TOKEN is not set"` or leftover `"Mongo is not connected"` would leave the body. Do not silently import leftover Job Number leftover `sendError` so “one refuse owns every Owner desk” without a paired test. Do not silently swallow leftover blob throws into leftover `"Internal error"` in this rename — park the gap.

8. **Every leftover `ZodError` becomes `"invalid_conversation_query"`.** Leftover list path has no Zod today, so the lie is latent. Leftover blank leftover `id` and leftover `model=Booking` never reach leftover `listByLead` / leftover `getById`. Do not silently add leftover `issues` so “it matches leftover v1 `Invalid request payload`” without a paired test. Do not move leftover `leadParamsSchema` / leftover `idParamsSchema` onto leftover `src/validation/v1/` in this rename.

9. **By-lead junk ObjectId is empty, not 404.** Leftover Zod only requires leftover `id` trim min 1. Leftover `listConversationsByLead("not-an-objectid")` returns leftover `[]`. Leftover open / leftover listen map leftover `getConversationById` leftover `null` onto leftover `404`. Do not silently 404 the Lead drawer so “bad ids look like detail.”

10. **Admin is not a reader here.** Sibling leftover Granot cases **ask** leftover `requireRegistryReadActor` (signed Admin may see the intake queue). This desk **asks** leftover Owner on **all four** paths because it serves transcript text (spec §5.9). The route test only locks Admin **403** on leftover listen. Do not silently switch leftover list to leftover read-actor so “Admin can see flags without words.” Do not teach leftover extension Owner Bearer to read these paths so “the extension can open the desk.”

11. **Operator skill and the host rule miss all four paths.** Leftover `.cursor/skills/hit-vantage-api/SKILL.md` and the always-applied API host rule list **none** of `GET /api/v1/admin/conversations*`. Folder `v1.routes.test.ts` lists the four mounts. Do not drop leftover `GET .../audio-url` so “the skill list wins.” Do not edit the host rule or the skill in this rename. Do not treat the skill as this desk’s **interface**.

12. **Deferred mutations stay off this desk.** Spec §5.9 names leftover `POST .../discover` / leftover `.../retry` / leftover `.../detach` / leftover `.../attach` with leftover `Idempotency-Key`. Knowledge: automated discovery, Form Lead phone-window matching, and attach/detach remain deferred. Documents arrive from `pnpm ops:seed-conversation`. Do not invent those POSTs so “the spec list becomes true.”

13. **This file does not re-redact and does not seed.** Leftover `transcript.text` is painted as stored. Already-recommended leftover `buildSeededTranscript` already **asks** leftover `redactTranscript` before persist. Do not import leftover `redaction.ts` so “detail is extra safe.” Do not import leftover `CHRIS_HUGHES_SEED` so “the desk can replay.”

14. **Opened media still omits leftover `blob_url`.** Already-recommended leftover `toConversationDetail` keeps leftover `blob_pathname` and drops leftover `blob_url`. Leftover listen returns leftover signed `url`, not leftover `media.blob_url`. Do not return leftover `media.blob_url` from leftover listen so “we can skip signing.”

15. **Leave sibling modules alone.** Leftover `listConversations` / leftover `getConversationById` / leftover `toConversationDetail` / leftover `issueConversationAudioUrl` / leftover `recordOperationalEvent` / leftover `requireRegistryOwnerActor` are already the right **depth**. This file orchestrates the HTTP **adapters**.

## Testing

The **interface** is the test surface: leftover `createOwnerConversationDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `showTheNewestConversationsWithoutTheWordsOverHttp` / `showThisLeadsConversationsWithoutTheWordsOverHttp` / `issueAFiveMinuteListenUrlAndWriteWhoListenedOverHttp` / `openOneConversationWithTheAlreadyRedactedTranscriptOverHttp`.

Today `conversations-admin.routes.test.ts` already names Owner list without leftover `transcript`, Owner by-lead without leftover transcript / leftover “Patrick priced,” Owner detail leftover `transcript.text` plus leftover `sections.mismatch === null`, Admin leftover listen **403** with no audit, and Owner leftover listen **200** + leftover `conversation.audio_url.issued`. It misses leftover Zod `400`, leftover `404`, leftover `409`, Admin **403** on list / by-lead / detail, unsigned refuse body, and registered-before-id order. Folder `v1.routes.test.ts` only lists the four mounts. Already-recommended Wave A files prove leftover paint / locker / seed / PCI through the service — not this desk.

Keep the inject-and-sign style. Add the missing operations (do not boot leftover Mongo hop, leftover Vercel Blob, leftover RingCentral, leftover STT, or leftover seed in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route leftover `requireApiSecret`.
- All four paths **ask** leftover `requireRegistryOwnerActor`. Signed Admin **403**. Sales / Employee leftover `FORBIDDEN`. Extension Owner Bearer leftover `FORBIDDEN`.
- Unsigned / missing HMAC is leftover `isRegistryError` with leftover `code` + leftover `request_id` (not leftover Granot `OWNER_REQUIRED` remap, not leftover v1 `registry_code`).

**Newest without the words**
- Owner leftover `GET .../conversations` **asks** leftover `list` and does **not** **ask** leftover `getById`.
- Response has leftover `has_transcript` and does **not** own leftover `transcript`.
- `JSON.stringify(body)` does not include leftover transcript text.

**This Lead without the words**
- Leftover `GET .../by-lead/:model/:id` is registered **before** leftover `GET .../:id`.
- Owner leftover `model=CallLead` **asks** leftover `listByLead` and answers **200**.
- Leftover `model=Booking` answers **400** `{ error: "invalid_conversation_query" }` and does **not** **ask** leftover `listByLead`.
- Leftover injected empty list for a junk ObjectId answers **200** `[]`, not leftover `404`.

**Five-minute listen + who listened**
- Leftover `GET .../:id/audio-url` is registered **before** leftover `GET .../:id`.
- Owner **asks** leftover `getById` then leftover `issueAudioUrl(pathname)` then leftover `auditAudio`.
- This beat does **not** **ask** leftover `toConversationDetail`.
- Injected leftover `null` answers **404** `"conversation_not_found"` and does **not** **ask** leftover `issueAudioUrl` and does **not** audit.
- Injected leftover `purged_at` or missing leftover `blob_pathname` answers **409** `"conversation_audio_unavailable"` and does **not** **ask** leftover `issueAudioUrl` and does **not** audit.
- Admin **403** and leftover `audits.length === 0`.

**Opened card**
- Owner leftover `GET .../:id` **asks** leftover `getById` then leftover `toConversationDetail`.
- This beat does **not** **ask** leftover `issueAudioUrl`.
- Injected leftover `null` answers **404** `"conversation_not_found"`.
- Leftover `sections.mismatch` stays `null` when the summary says there is no contradiction.

**Not this file**
- Newest-fifty / by-lead empty ObjectId / leftover `blob_url` omit stay on already-recommended [conversations-reads.md](conversations-reads.md).
- Five-minute get-only sign / private `put` stay on already-recommended [conversations-media.md](conversations-media.md).
- PCI strip stays on already-recommended [conversations-redaction.md](conversations-redaction.md).
- Artifact parse / seed bags stay on already-recommended [conversations-seed-from-artifacts.md](conversations-seed-from-artifacts.md).
- Best-effort persist / Incident / email stay on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).
- HMAC / preview hatch stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Unguarded login / Drive callback stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md) / [routes-google-drive-oauth.md](routes-google-drive-oauth.md).
- Job Number sample / typed chain stay on already-recommended [routes-job-number-timeline-admin.md](routes-job-number-timeline-admin.md).

Do **not** add a test per helper (`whoTheSecretAlreadyAdmitted`, `parseTheLeadDrawerParams`, `refuseListenUnavailable`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `ConversationsAdminRoutesService` class with `create` / `update` / `delete` / `list`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `list.ts` / `get.ts` / `audio.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Owner transcripts in front of `x-api-secret`.
- Breaking the registered-before-id **seam**: do not let leftover `/:id` hide leftover `by-lead` or leftover `audio-url`.
- Breaking the load / paint **seam**: do not fold leftover `toConversationDetail` into leftover `getById` so leftover listen inherits the words.
- Treating leftover `listConversations`, leftover `issueConversationAudioUrl`, leftover `redactTranscript`, leftover `CHRIS_HUGHES_SEED`, leftover Drive / extension desks, leftover Job Number desk, leftover inbound-number desk, leftover webhook / cron routers, or leftover Admin browse as this story.
- Inventing a discover / attach / redact / locker-put **adapter** that has only one caller in this pass.
- Silently remounting leftover `requireApiSecret`, mapping leftover purged onto leftover `404`, returning leftover `media.blob_url` from leftover listen, importing leftover `redactTranscript` so “detail is extra safe,” adding leftover `POST .../discover`, editing the host rule / operator skill, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
