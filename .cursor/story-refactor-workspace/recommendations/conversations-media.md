# Put The Private Mp3 In The Locker Under The Recording Id, Then Issue The Five-Minute Get-Only Listen URL For That Pathname — Never Store A RingCentral Content Uri, Never Embed A Forever Blob Link On The Desk, Never Audit, Never Persist The Conversation, Never Redact, Never Seed The Known Call, Never Write The Lead — operational story

- Status: recommended
- Service: `conversations` (Wave A, in-progress)
- Pass: 3 of this service — `media.ts`
- Remaining in this service: `seedFromArtifacts.ts`
- Target: `src/services/conversations/media.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (audio bytes live in a private Vercel Blob object; Owner `GET .../audio-url` is a short-lived signed URL and is audited; RingCentral `contentUri` is never stored). Owner spec §5.5 / §7.6 (`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`) names this file as the locker: `put()` under `conversations/{provider_recording_id}.mp3`, `access: "private"`, `multipart` above 4MB, `addRandomSuffix: false`; playback is a short-lived server-issued signed URL, never a blob URL embedded in a list payload. Distinct from leftover Owner desk reads: already-recommended [conversations-reads.md](conversations-reads.md) (paints media **without** `blob_url` — **does not import** this file; audio-url **asks** sibling `getConversationById`, then this file). Distinct from leftover PCI strip: already-recommended [conversations-redaction.md](conversations-redaction.md) (**does not import** this file). Distinct from leftover artifact seed: later `seedFromArtifacts.ts` (`buildSeededMedia` stamps `blob_pathname` / `blob_url` / `bytes` from this file’s return — **does not import** this file; `conversationBlobPathname` lives on Wave B `src/config/domain/conversations.ts`). Distinct from leftover RingCentral ingest / webhook / Call Log: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) / [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) / [ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (Call Lead write and capture — **not** a locker; `src/` has **no** `contentUri` reader). Distinct from leftover Google Drive OAuth / picker: already-recommended [google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) / [google-drive-oauth-picker.md](google-drive-oauth-picker.md) (owner spreadsheet connection — **not** conversation audio). Distinct from leftover reporting live Google: already-recommended [reporting-live-google-orchestration.md](reporting-live-google-orchestration.md) / [reporting-reporting-drive-adapter.md](reporting-reporting-drive-adapter.md). Distinct from leftover observability audit: already-recommended [observability-record-operational-event.md](observability-record-operational-event.md) (Wave B `conversations-admin.routes.ts` **asks** `recordOperationalEvent` **after** this file returns — this file does **not** import it). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Lead Conversation Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: **two runtime import sites.** Operator `scripts/conversations/seed-known-conversation.ts` (`pnpm ops:seed-conversation`) **asks** `uploadConversationMp3` only after `--confirm-write` plus leftover `assertGranotLifecycleApplyAuthorized`, then stamps sibling `buildSeededMedia({ blobUrl: uploaded.url, bytes: uploaded.bytes })`. Wave B `src/routes/conversations-admin.routes.ts` (`GET /api/v1/admin/conversations/:id/audio-url`) **asks** sibling `getConversationById`, 404s `conversation_not_found`, 409s `conversation_audio_unavailable` when `media.blob_pathname` is missing **or** `media.purged_at` is set, then **asks** `issueConversationAudioUrl(pathname)`, then **asks** leftover `recordOperationalEvent` (`conversation.audio_url.issued`). Barrel: `conversations/index.ts` (re-exports both names). There is **no** `media.test.ts`. Route proof: `conversations-admin.routes.test.ts` (stubs `issueAudioUrl`; Owner vs Admin 403; audit key — **never** calls this file). Sibling `seedFromArtifacts.ts` / `seedFromArtifacts.test.ts` do **not** import this file. Already-recommended `reads.ts` / `redaction.ts` do **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `listConversations`, `toConversationDetail`, `redactTranscript`, `parseConversationArtifact`, `buildSeededTranscript`, `buildSeededMedia`, leftover `recordOperationalEvent`, leftover `requireRegistryOwnerActor`, leftover `conversationBlobPathname`.
- Seams callers need: recording id vs locker pathname (upload **derives** `conversations/{id}.mp3`; issue **trusts** the pathname the route already loaded); private `put` vs get-only signed listen; seed persist of returned `url` / `bytes` vs Owner listen of an ephemeral URL; five-minute `ttl_ms` vs thirty-day `cacheControlMaxAge` (different clocks). There is no persist **seam**. There is no begin / complete Domain Command **seam**. There is no owner-actor **seam**. There is no purged **seam**. There is no audit **seam**. There is no redact **seam**. There is no desk-paint **seam**. Owner-actor, 409-if-purged, and the audit row live on the route, not here.
- Split later (only if the file outgrows one sitting): this ~91-line file is one sitting if you read it as put the private mp3 in the locker under the recording id, then issue the five-minute get-only listen URL for that pathname — never store a RingCentral content URI, never embed a forever blob link on the desk. If it later splits by **story**: `putThePrivateMp3InTheLockerUnderTheRecordingId.ts` / `issueTheFiveMinuteListenUrlForThisPathname.ts` — never `create.ts` / `update.ts` / `delete.ts` / `upload.ts` / `download.ts`. Desk reads stay the sibling. Redaction stays the sibling. Artifact seed stays the sibling.

`uploadConversationMp3` / `issueConversationAudioUrl` are executor mechanics. The owner question is: *An agent just recorded a customer call. Put the mp3 in a private locker under that recording id so the pathname is derivable and a public blob URL never exists. When I press play on the opened card, issue a five-minute get-only listen URL for the pathname we already stored — not the forever blob link, not a RingCentral content URI. This file does not decide whether the Owner may listen. This file does not 409 a purged recording. This file does not write the audit row. This file does not persist the conversation. This file does not redact the transcript. This file does not seed the known inbound Call Lead. This file does not write the Lead or the Booking.*

Who paints the opened card without `blob_url` already lives in already-recommended `reads.ts`. Who strips cards / SSN / email already lives in already-recommended `redaction.ts`. Who splits `## Summary` / `## Transcript` and stamps the seeded media bag already lives in later `seedFromArtifacts.ts`. Who loads the document, refuses a missing or purged pathname, and writes `conversation.audio_url.issued` already lives on Wave B `conversations-admin.routes.ts`. Do not pull those in.

## What this file actually does

Two “lock the recording privately, then issue a five-minute listen URL when the owner presses play” stories in one sitting, not “a blob helper,” and not Show The Owner The Newest Conversations / Strip The Card / Seed The Known Call:

1. **Put the private mp3 in the locker under the recording id** — `uploadConversationMp3({ providerRecordingId, filePath })`. Derive `conversations/{providerRecordingId}.mp3`. `stat` the local file. Require `BLOB_STORE_ID` and `BLOB_READ_WRITE_TOKEN`. `put` the read stream with `access: "private"`, `contentType: "audio/mpeg"`, `addRandomSuffix: false`, `allowOverwrite: true`, `multipart` only when the file is larger than 4MB, `cacheControlMaxAge` thirty days. `head` the uploaded URL for `bytes`. Return `{ pathname, url, bytes, contentType }`. This beat does **not** persist a Lead Conversation. This beat does **not** download from RingCentral. This beat does **not** vet duration or voicemail. This beat does **not** redact. This beat does **not** issue a listen URL.

2. **Issue the five-minute get-only listen URL for this pathname** — `issueConversationAudioUrl(pathname)`. TTL is `CONVERSATION_AUDIO_URL_TTL_MS` (five minutes). Require the same two env credentials. `issueSignedToken` with `operations: ["get"]` and `validUntil = now + ttl`. `presignUrl` with `operation: "get"` and `access: "private"`. Return `{ url, expires_at, ttl_ms }`. This beat does **not** load the conversation. This beat does **not** 409 `purged_at`. This beat does **not** write `conversation.audio_url.issued`. This beat does **not** return `media.blob_url`. This beat does **not** put a new object.

There is no third persist or audit operation. `blobStoreId` / `blobToken` are fold beats inside both stories (throw when the env is empty). They are unexported. That is correct.

## Organization

Keep one file. This is the screenplay for “put the private mp3 in the locker under the recording id, then issue the five-minute get-only listen URL for that pathname.” Desk reads already live on already-recommended `reads.ts`. Redaction already lives on already-recommended `redaction.ts`. Artifact parse / seed bags already live on later `seedFromArtifacts.ts`. Owner-actor, purged 409, and the audit row already live on Wave B `conversations-admin.routes.ts`. Pathname formula and the five-minute constant already live on Wave B `src/config/domain/conversations.ts`. RingCentral ingest, Google Drive OAuth, reporting Drive, and observability already live in already-recommended **modules**. Do not pull those in. Do not invent a `MediaService` / `BlobService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a persist **adapter** so “upload can write Mongo.” Do not invent an audit **adapter** so “issue can log.” Do not invent a CRUD folder so “upload / download each get a file.”

Do not move `issueConversationAudioUrl` into `reads.ts` so “detail can play.” Do not move `uploadConversationMp3` into `seedFromArtifacts.ts` so “the seed already uploads.” Do not teach `toConversationDetail` to **ask** this file so “the opened card can ship a forever URL.” Do not split `create.ts` / `update.ts` / `delete.ts` / `upload.ts` / `download.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `uploadConversationMp3` | `putThePrivateMp3InTheLockerUnderTheRecordingId` | operator seed **asks** this after `--confirm-write`; returns the locker bag the seed stamps |
| `issueConversationAudioUrl` | `issueTheFiveMinuteListenUrlForThisPathname` | audio-url route **asks** this after load + purged check; desk must not |

Keep the old names as one-line aliases until `conversations/index.ts`, `scripts/conversations/seed-known-conversation.ts`, and Wave B `conversations-admin.routes.ts` migrate. Do not make callers learn `put` / `head` / `issueSignedToken` / `presignUrl` as the domain language. Do **not** export `blobStoreId` / `blobToken` so “the seed can reuse the env fold.” Do **not** put either name onto leftover `v1.service.ts` so “every public fold lives on the barrel.” Do **not** rename `pathname` / `expires_at` / `ttl_ms`. Do **not** add `conversation_id` onto the listen bag so “the locker can audit.”

**No workflow class.** The two types that *do* earn a name are the locker bag sibling seed already stamps onto `LeadConversation.media`, and the listen bag the route already returns:

```ts
type StoredPrivateConversationRecording = {
  pathname: string
  url: string
  bytes: number
  contentType: string
}

type IssuedConversationListenUrl = {
  url: string
  expires_at: string
  ttl_ms: number
}
```

The first is the handoff from “the mp3 is on disk” to “Mongo may store these four fields.” The second is the handoff from “the Owner pressed play” to “the desk may fetch audio for five minutes.” Do **not** add `raw` / `contentUri` onto the locker bag so “the locker can skip the private put.” Do **not** add `blob_url` onto the listen bag so “issue can return the forever link.” Do **not** add `actor_id` / `conversation_id` onto the listen bag so “issue can write the audit.” Do **not** add `purged_at` onto either type so “the locker can 409” — that refuse stays on the route.

`blobStoreId`, `blobToken`, the `stat`, the `head`, and the two-step sign-then-presign stay unexported. They are beats, not a second public operation. Do not export `conversationBlobPathname` from this file — Wave B config already owns it, and later `buildSeededMedia` already **asks** that config.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// media.ts
// An agent just recorded a customer call.
// Put the mp3 in a private locker under that recording id
// so the pathname is derivable and a public blob URL never exists.
// When the owner presses play, issue a five-minute
// get-only listen URL for the pathname we already stored.
// Do not store a RingCentral content URI.
// Do not embed a forever blob link on the desk.
// Do not decide whether the Owner may listen.
// Do not 409 a purged recording.
// Do not write the audit row.
// Do not persist the conversation.
// Do not redact.
// Do not seed the known call.
// Do not write the Lead.

// ── 1. Put the private mp3 in the locker ──

export async function putThePrivateMp3InTheLockerUnderTheRecordingId(input: {
  providerRecordingId: string
  filePath: string
}): Promise<StoredPrivateConversationRecording>

function deriveTheLockerPathname(providerRecordingId)  // conversations/{id}.mp3
function requireTheBlobStoreId()
function requireTheBlobWriteToken()
function putThePrivateMpeg(pathname, stream, size)     // private; overwrite; multipart > 4MB
function readTheStoredByteCount(uploadedUrl)           // head after put

// ── 2. Issue the five-minute get-only listen URL ──

export async function issueTheFiveMinuteListenUrlForThisPathname(
  pathname: string,
): Promise<IssuedConversationListenUrl>

function signAGetOnlyTokenUntil(pathname, validUntil)
function presignTheListenUrl(signed, pathname, validUntil)
```

Read the locker out loud: *Take the local mp3 and the RingCentral recording id. Name the object `conversations/{id}.mp3` so a later listen can find it without a random suffix. Put it privately. Overwrite if the owner re-seeds the same id. Use multipart only when the file is larger than 4MB. Head the object for the byte count. Hand the seed the pathname, the private blob URL, the bytes, and `audio/mpeg`. Later, when the Owner presses play, take only the pathname the route already loaded. Sign a get-only token that dies in five minutes. Presign that listen URL. Hand back the URL, `expires_at`, and `ttl_ms`. A missing store id or write token throws before any blob call. This file does not look up the conversation. The route is who 409s a purged recording and who writes the audit. The desk is who paints media without `blob_url`.*

That is the operation. `uploadConversationMp3` is not a different story from “put it in the locker.” `issueConversationAudioUrl` is not a download helper.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`uploadConversationMp3` / `issueConversationAudioUrl` are executor mechanics.** The owner story is “put the private mp3 in the locker under the recording id, then issue the five-minute get-only listen URL for that pathname.” Keep the old names as aliases. Do not grow a `MediaService` with `upload` / `download` / `delete`.

2. **The two env folds throw before any blob call.** Empty `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` become `BLOB_STORE_ID is not set` / `BLOB_READ_WRITE_TOKEN is not set`. Do not invent a typed `BlobConfigError` in this rename, and do not read the token from Wave B `getRequiredEnv()` so “one config owns every secret” — this file’s env names are conversation-locker specific and are not in a checked-in `.env.example`.

3. **Pathname is derivable on purpose.** `addRandomSuffix: false` plus Wave B `conversationBlobPathname` means the seed can stamp `blob_pathname` without asking the locker a second time. Later `buildSeededMedia` **re-derives** the pathname from the recording id and also stores `uploaded.url`. Do not add a random suffix so “objects cannot collide,” and do not stop returning `pathname` so “the seed can only use config.”

4. **`allowOverwrite: true` is the re-seed seam.** `pnpm ops:seed-conversation -- --confirm-write` upserts the same `provider_recording_id`. A second run must replace the object. Do not flip overwrite off so “we never clobber audio,” and do not delete-then-put so “overwrite is explicit.”

5. **Multipart is a size gate, not a second upload story.** `fileStat.size > 4 * 1024 * 1024`. Spec §5.5 names that cut. Do not multipart every file so “one code path,” and do not raise the cut so “small files are cheaper.”

6. **`cacheControlMaxAge` thirty days is not the listen TTL.** The put cache is thirty days. The listen URL dies in five minutes (`CONVERSATION_AUDIO_URL_TTL_MS` / route stub `ttl_ms: 300000`). Do not silently set cache to five minutes so “the clocks match,” and do not stretch the signed TTL to thirty days so “the Owner can scrub the call.”

7. **`head` after `put` is how `bytes` is born.** The return uses `metadata.size`, not `fileStat.size`. A truncated put would disagree with the local file. Do not drop `head` so “stat is enough,” and do not persist `fileStat.size` so “we skip a round trip.”

8. **Issue is get-only.** `issueSignedToken({ operations: ["get"] })` then `presignUrl({ operation: "get", access: "private" })`. Do not add `put` / `delete` onto the token so “the desk can replace audio,” and do not skip `issueSignedToken` so “`presignUrl` alone is shorter.”

9. **Issue trusts the pathname.** The route already loaded `conversation.media.blob_pathname` and already refused a missing or purged object. This file does not import `LeadConversation`. Do not load the document here so “the locker can 409,” and do not accept `providerRecordingId` on issue so “we can re-derive” — a purged row would still sign.

10. **This file does not audit.** Wave B writes `conversation.audio_url.issued` with `actor_id`, `conversation_id`, and `expires_at` **after** this file returns. Knowledge: listening is an auditable act. Do not import `recordOperationalEvent` so “the locker can log,” and do not drop the route audit so “signing is enough.”

11. **This file does not decide the Owner.** `requireRegistryOwnerActor` sits on every conversation route. Admin 403 is proven on the route test with a stubbed issuer. Do not add an actor argument so “the service can 403.”

12. **Spec §7.6 says this file persists `call_log_id` and re-resolves `contentUri`.** The file does neither. The seed stamps `call_log_id` onto the conversation. `src/` has **no** `contentUri` reader. Do not silently add a RingCentral download so “the spec sentence becomes true.” Park that gap. Wave A will recommend `seedFromArtifacts.ts` next — do not write a whole-folder conversations recommendation.

13. **Spec §5.5 “vet before paying” is not this file.** Skip-when-under-60s / voicemail / implausible bytes lives on the deferred pipeline. The seed uploads a known 482-second fixture. Do not add a duration refuse here so “the locker can save money.”

14. **Spec §5.7 janitor is deferred.** There is no purge export, no cron, no `delete`. `purged_at` is a route 409 on the stored date. Do not add `purgeTheLockerObject` so “retention can start,” and do not clear `blob_url` here so “purge is safer.”

15. **The private `url` from `put` is stored; the signed `url` is not.** Seed writes `media.blob_url = uploaded.url`. Already-recommended `toConversationDetail` omits `blob_url`. The list card never had it. Do not return `media.blob_url` from issue so “we can skip signing,” and do not drop `url` from the locker bag so “Mongo cannot store a forever link” in this rename — the seed already stamps it. Leave the stored-URL question on the seed pass.

16. **This file does not persist and does not re-sign on detail.** Already-recommended `toConversationDetail` paints pathname / bytes / content type / stored_at / purged_at. Knowledge: audio loads its signed URL only when the Owner presses play. Do not import `reads.ts` so “detail can ship a URL.” Do not import `LeadConversation` so “upload can write.”

17. **This file does not redact and does not seed.** Already-recommended `redactTranscript` walks spoken STT. Later `buildSeededTranscript` **asks** that file. This file never sees text. Do not import `redaction.ts` so “the locker can scrub ID3,” and do not import `CHRIS_HUGHES_SEED` so “upload knows the fixture.”

18. **Do not treat Google Drive OAuth, reporting Drive, or RingCentral token stores as this story.** Those already-recommended **modules** connect a spreadsheet or a telephony API. This file puts one private mpeg and signs a five-minute get. Do not import `put` helpers from reporting so “one blob client owns the company.”

19. **Do not silently add write routes or automated discovery.** Knowledge: automated discovery, Form Lead phone-window matching, and attach/detach remain deferred. Documents arrive from `pnpm ops:seed-conversation`. Do not invent `downloadThisRecordingFromRingCentral` / `streamThisMp3ThroughTheApi` so “the locker can own the pipeline.”

20. **Leave the sibling seed / read / redact folds alone.** `buildSeededMedia` / `parseConversationArtifact` / `toConversationDetail` / `redactTranscript` are not imported here. Wave A will recommend `seedFromArtifacts.ts` next. Do not write a whole-folder conversations recommendation.

21. **Owner-actor is not this file.** Same as already-recommended reads / redaction. This module does not see `vantageAuth`.

## Testing

The **interface** is the test surface: `putThePrivateMp3InTheLockerUnderTheRecordingId` (old name `uploadConversationMp3` as an alias) plus `StoredPrivateConversationRecording`, and `issueTheFiveMinuteListenUrlForThisPathname` (old name `issueConversationAudioUrl` as an alias) plus `IssuedConversationListenUrl`. There is **no** `media.test.ts` today. Route tests stub the issue beat. Add tests that stay on the parent — inject the blob **adapter** (`put` / `head` / `issueSignedToken` / `presignUrl`) or a test double; do not hit a live store.

**Put the private mp3 in the locker under the recording id**
- Pathname is `conversations/{providerRecordingId}.mp3`.
- `put` is called with `access: "private"`, `contentType: "audio/mpeg"`, `addRandomSuffix: false`, `allowOverwrite: true`.
- `multipart` is false at 4MB and true above 4MB.
- `cacheControlMaxAge` is thirty days (`60 * 60 * 24 * 30`).
- Return `bytes` comes from `head`, not from `stat`.
- Empty `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` throw before `put`.
- Does not import `LeadConversation`.
- Does not import `reads.ts` / `redaction.ts` / `seedFromArtifacts.ts`.

**Issue the five-minute get-only listen URL for this pathname**
- `ttl_ms === 300000` and `expires_at` is the ISO of `now + ttl`.
- Signed token `operations` is `["get"]` only.
- `presignUrl` uses `operation: "get"` and `access: "private"`.
- Return `url` is the presigned URL, not `media.blob_url`.
- Empty env throws before `issueSignedToken`.
- Does not import `LeadConversation` / `recordOperationalEvent`.
- Does not 409 on a pathname string — the route owns purged.

Do **not** add a test per helper (`deriveTheLockerPathname`, `requireTheBlobStoreId`, `signAGetOnlyTokenUntil`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `buildSeededMedia` / `toConversationDetail` / `redactTranscript` here. Do not add Owner-actor 403 tests in the service file — that gap lives on the route. Do not re-test leftover `recordOperationalEvent`. Do not add a live Vercel Blob proof.

## What I would not do

- A `MediaService` / `BlobService` class with `upload` / `download` / `delete` / `create` / `update`.
- Thirty two-line functions that only wrap `@vercel/blob` `put` / `head` / `presignUrl`.
- Moving this into a CRUD folder, or into `reads.ts` “because the desk plays audio.”
- Calling this file from `toConversationDetail` so “detail can play without pressing play.”
- Returning stored `media.blob_url` from issue so “we can skip signing.”
- Adding `put` / `delete` onto the signed token so “the desk can replace audio.”
- Stretching the listen TTL to the thirty-day cache, or shrinking the cache to five minutes, so “the clocks match.”
- Importing `LeadConversation` or the seed script so “upload can persist.”
- Importing `recordOperationalEvent` so “issue can audit.”
- Adding a RingCentral `contentUri` download so “the spec sentence becomes true.”
- Adding duration / voicemail vetting or a purge export so “the locker can own the pipeline.”
- Pulling `seedFromArtifacts.ts` / already-recommended `reads.ts` / already-recommended `redaction.ts` into this file.
- Importing leftover Google Drive / reporting Drive helpers so “one blob client owns the company.”
- Writing a Lead or Booking from a stored recording.
- Writing a whole-folder recommendation for `conversations` while `seedFromArtifacts.ts` is still unchecked.
