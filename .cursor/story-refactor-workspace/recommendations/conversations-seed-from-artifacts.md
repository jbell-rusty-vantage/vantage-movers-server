# Parse The Already-Paid Artifact Into The Summary And The Spoken Transcript, Stamp The Redacted Transcript Bag And The Sectioned Summary, Stamp Media From The Locker Return — Never Persist, Never Call STT, Never Call The Summarizer, Never Upload, Never Write The Lead — operational story

- Status: recommended
- Service: `conversations` (Wave A, visited)
- Pass: 4 of this service — `seedFromArtifacts.ts`
- Remaining in this service: none
- Target: `src/services/conversations/seedFromArtifacts.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (one Owner-seeded inbound Call Lead `P5562014` / Chris Hughes replayed from existing artifacts; no new STT or summary call; raw STT never reaches Mongo; summaries never write back to a Lead or Booking; documents arrive from `pnpm ops:seed-conversation`). Owner spec §5.2 (`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`) names a larger seed — RingCentral Call Log fetch, download, vet, live STT, live summarizer, CLI `--lead-id` / `--call-log-id`, path `scripts/dev_ops/conversations/seed-known-conversation.ts`. This file and today’s operator script do **none** of that: they replay `CHRIS_HUGHES_SEED.sample_markdown` / `sample_audio` from `scripts/conversations/seed-known-conversation.ts`. Distinct from leftover Owner desk reads: already-recommended [conversations-reads.md](conversations-reads.md) (**asks** `extractSummarySection` / `hasCrmMismatch` only — **does not import** parse or the three stamp bags). Distinct from leftover PCI strip: already-recommended [conversations-redaction.md](conversations-redaction.md) (`buildSeededTranscript` **asks** `redactTranscript`; this file does **not** walk spoken STT itself). Distinct from leftover locker: already-recommended [conversations-media.md](conversations-media.md) (script **asks** `uploadConversationMp3`, then this file stamps `buildSeededMedia` from the returned `url` / `bytes` — **does not import** that file). Distinct from leftover RingCentral ingest / webhook / Call Log: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) / [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) / [ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (Call Lead write and capture — **not** a Lead Conversation seed). Distinct from leftover Granot lifecycle apply authorize: leftover `assertGranotLifecycleApplyAuthorized` sits on the script after `--confirm-write`, not here. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Lead Conversation Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: **two runtime import sites.** Operator `scripts/conversations/seed-known-conversation.ts` (`pnpm ops:seed-conversation`) **asks** `CHRIS_HUGHES_SEED`, `parseConversationArtifact`, `buildSeededTranscript`, `buildSeededSummary`, and `buildSeededMedia`. Dry-run (no `--confirm-write`) parses and prints the plan, then returns. Write path **asks** leftover `assertGranotLifecycleApplyAuthorized`, already-recommended `uploadConversationMp3`, then the three stamp bags, then `LeadConversation.findOneAndUpdate` upsert — that persist is the script, not this file. Already-recommended `reads.ts` **asks** `extractSummarySection` and `hasCrmMismatch` to paint `has_mismatch` and the six opened-card sections. Tests: `seedFromArtifacts.test.ts` (parse + overview extract + no-mismatch on the all-clear sentence; `buildSeededTranscript` refuses `4111` and `pat@example.com`; mismatch true on a deposit contradiction). Barrel: `conversations/index.ts` does **not** re-export this file. Wave B `conversations-admin.routes.ts` does **not** import this file. Already-recommended `media.ts` / `redaction.ts` do **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `listConversations`, `toConversationDetail`, `redactTranscript`, `uploadConversationMp3`, `issueConversationAudioUrl`, leftover `assertGranotLifecycleApplyAuthorized`, leftover `recordOperationalEvent`, leftover `LeadConversation.findOneAndUpdate`.
- Seams callers need: artifact markdown vs parsed `{ summary_markdown, transcript }`; raw spoken string vs redacted transcript bag (`text` + `chars` + `redactions` + `model` + `created_at`); stored summary markdown vs six desk sections plus the mismatch flag; locker return (`url` / `bytes`) vs stamped media bag (`blob_pathname` re-derived, `blob_url` stored, `purged_at` null). There is no persist **seam**. There is no begin / complete Domain Command **seam**. There is no upload **seam**. There is no STT **seam**. There is no summarizer **seam**. Owner-actor and `--confirm-write` live on the script, not here.
- Split later (only if the file outgrows one sitting): this ~126-line file is one sitting if you read it as parse the already-paid artifact, stamp the redacted transcript bag and the sectioned summary, stamp media from the locker return — never persist, never call STT, never call the summarizer, never upload. If it later splits by **story**: `parseTheAlreadyPaidConversationArtifact.ts` / `stampTheRedactedTranscriptBag.ts` / `stampTheSectionedSummaryBag.ts` / `stampMediaFromTheLockerReturn.ts` — never `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `build.ts`. Desk reads stay the sibling. Redaction stays the sibling. The locker stays the sibling. The operator upsert stays the script.

`parseConversationArtifact` / `buildSeededTranscript` / `buildSeededSummary` / `buildSeededMedia` are executor mechanics. The owner question is: *We already paid for this inbound Chris Hughes recording. Split the markdown at `## Summary` and `## Transcript`. Before anyone writes the spoken half to Mongo, ask the sibling to strip cards and email, then stamp the transcript bag with the redacted text, the character count, the replacement count, and the replay STT model. Stamp the summary bag with the already-written six-heading markdown and the replay prompt version — do not call the summarizer. After the locker returns a private url and a byte count, stamp media with a derivable `conversations/{id}.mp3` pathname, that stored url, those bytes, `audio/mpeg`, and `purged_at` null. The opened card already reads the six headings and the mismatch flag from this same file. This file does not persist. This file does not upload. This file does not call STT. This file does not call the summarizer. This file does not write the Lead or the Booking.*

Who paints the opened card already lives in already-recommended `reads.ts` and **asks** only the section / mismatch folds. Who strips cards / SSN / email already lives in already-recommended `redaction.ts`. Who puts the private mp3 and issues the five-minute listen URL already lives in already-recommended `media.ts`. Who upserts `lead_conversations` already lives on `scripts/conversations/seed-known-conversation.ts`. Do not pull those in.

## What this file actually does

Four “replay the already-paid Chris Hughes call into stamp bags the operator may persist” stories in one sitting, not “a seed helper,” and not Show The Owner The Newest Conversations / Strip The Card / Put The Private Mp3:

1. **Parse the already-paid artifact into the summary and the spoken transcript** — `parseConversationArtifact(markdown)`. Require `## Summary` then a later `## Transcript`. Trim both bodies. Refuse a missing heading, a reversed pair, or an empty body. Run `normalizeSummaryMarkdown` on the summary (strip `\r\n`, `**`, and leading `1. ` numbers). Return `{ summary_markdown, transcript }`. This beat does **not** redact. This beat does **not** persist. This beat does **not** read the mp3.

2. **Stamp the redacted transcript bag** — `buildSeededTranscript(rawTranscript, createdAt)`. **Ask** sibling `redactTranscript`. Stamp `text` (redacted), `model` (`CONVERSATION_STT_MODEL` = `gpt-4o-mini-transcribe`), `chars` (redacted length, not raw), `redactions`, `created_at`. This beat does **not** persist. This beat does **not** refuse leftover `@` or leftover 13–19 digit runs — the operator script does that after this return. This beat does **not** call STT.

3. **Stamp the sectioned summary bag, then split the six headings so the opened card can paint them** — `buildSeededSummary(summaryMarkdown, createdAt)` stamps `text` (the already-normalized markdown), `model` (`CONVERSATION_SUMMARY_MODEL` = `gpt-4.1-nano`), `prompt_version` (`CONVERSATION_PROMPT_VERSION` = `owner-demo-v1`), `created_at`. It does **not** **ask** `redactTranscript`. It does **not** call the summarizer. `extractSummarySection` / `hasCrmMismatch` are the desk **adapter** of the same six headings: already-recommended `toConversationDetail` fills overview / customer_wanted / money_dates / outcome / promised, and fills `sections.mismatch` only when `hasCrmMismatch` is true. `hasCrmMismatch` is true only when “Mismatch vs CRM” exists and does **not** match `/no contradiction|no mismatch|does not conflict|align with the crm/i`. This beat does **not** persist.

4. **Stamp media from the locker return** — `buildSeededMedia({ providerRecordingId, blobUrl, bytes, storedAt })`. Re-derive `blob_pathname` via Wave B `conversationBlobPathname` (`conversations/{id}.mp3`). Store `blob_url` from the locker `url` (nullable). Stamp `bytes`, `content_type: "audio/mpeg"`, `stored_at`, `purged_at: null`. This beat does **not** import `media.ts`. This beat does **not** `put`. This beat does **not** sign a listen URL.

There is no fifth persist or discover operation. `normalizeSummaryMarkdown` is a fold beat inside story 1 (it is exported today only because the file treats it as the **interface** — that is a leak). `CHRIS_HUGHES_SEED` is the known-call identity the script upserts; it is not a fifth story. `SUMMARY_HEADINGS` stays unexported.

## Organization

Keep one file. This is the screenplay for “parse the already-paid artifact, stamp the redacted transcript bag and the sectioned summary, stamp media from the locker return.” Desk reads already live on already-recommended `reads.ts`. Redaction already lives on already-recommended `redaction.ts`. The locker already lives on already-recommended `media.ts`. Owner `--confirm-write`, leftover apply-authorize, Call Lead load, and the Mongo upsert already live on `scripts/conversations/seed-known-conversation.ts`. Pathname formula and the replay model constants already live on Wave B `src/config/domain/conversations.ts`. RingCentral ingest already lives in already-recommended **modules**. Do not pull those in. Do not invent a `SeedService` / `ArtifactService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a persist **adapter** so “stamp can write Mongo.” Do not invent an STT **adapter** so “parse can transcribe.” Do not invent a CRUD folder so “parse / build each get a file.”

Do not move `extractSummarySection` / `hasCrmMismatch` into `reads.ts` so “the desk owns headings.” Do not move `buildSeededTranscript` into `redaction.ts` so “redact can stamp the bag.” Do not move `buildSeededMedia` into `media.ts` so “the locker can write the document.” Do not teach this file `findOneAndUpdate` so “the service can persist.” Do not split `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `build.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseConversationArtifact` | `parseTheAlreadyPaidConversationArtifact` | operator seed **asks** this on the markdown file |
| `ParsedConversationArtifact` | `ParsedAlreadyPaidConversationArtifact` | `{ summary_markdown, transcript }` — the handoff into the two text bags |
| `buildSeededTranscript` | `stampTheRedactedTranscriptBag` | seed **asks** this after parse; **asks** sibling redact |
| `buildSeededSummary` | `stampTheSectionedSummaryBag` | seed **asks** this; desk must not |
| `buildSeededMedia` | `stampMediaFromTheLockerReturn` | seed **asks** this after leftover upload; locker must not |
| `extractSummarySection` | `readThisSummaryHeading` | already-recommended opened card **asks** the six headings |
| `hasCrmMismatch` | `sayWhetherTheSummaryContradictsCrm` | list card `has_mismatch` and opened `sections.mismatch` share this gate |
| `CHRIS_HUGHES_SEED` | `knownInboundChrisHughesCall` | operator identity — Lead / recording / artifact paths |
| `normalizeSummaryMarkdown` | leftover normalize leak | parse only — unexport after parse owns the strip |

Keep the old names as one-line aliases until `scripts/conversations/seed-known-conversation.ts`, already-recommended `reads.ts`, and `seedFromArtifacts.test.ts` migrate. Do not make callers learn `SUMMARY_HEADINGS` / `search(/^## Summary/)` / `conversationBlobPathname` as the domain language. Do **not** keep `normalizeSummaryMarkdown` as a public **seam** after parse owns the strip. Do **not** put these names onto leftover `v1.service.ts` or `conversations/index.ts` so “every public fold lives on the barrel.” Do **not** rename the six heading strings. Do **not** add `raw` onto the transcript bag so “seed can skip redact.” Do **not** add `blob_pathname` as an input onto the media bag so “the locker pathname can disagree with config.”

**No workflow class.** The three types that *do* earn a name are the parsed artifact and the two persist bags the script already writes (media is the third bag):

```ts
type ParsedAlreadyPaidConversationArtifact = {
  summary_markdown: string
  transcript: string
}

type SeededRedactedTranscript = {
  text: string
  model: string
  chars: number
  redactions: number
  created_at: Date
}

type SeededSectionedSummary = {
  text: string
  model: string
  prompt_version: string
  created_at: Date
}

type SeededLockerMedia = {
  blob_pathname: string
  blob_url: string | null
  bytes: number
  content_type: "audio/mpeg"
  stored_at: Date
  purged_at: null
}
```

The first is the handoff from “the markdown is on disk” to “the two text bags may be stamped.” The transcript bag is the handoff from “sibling redact just ran” to “Mongo may store these five fields.” The summary bag is the handoff from “the artifact already named six headings” to “Mongo may store this markdown.” The media bag is the handoff from “the locker returned url and bytes” to “Mongo may store these six fields.” Do **not** add `raw` onto the transcript bag. Do **not** add `sections` onto the summary bag so “seed can pre-split” — the desk extracts at read time. Do **not** add `contentUri` onto the media bag. Do **not** drop `blob_url` in this rename — the script already stamps it; already-recommended `toConversationDetail` already omits it.

`SUMMARY_HEADINGS` stays unexported. It is the heading list extract already walks, not a second public operation.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// seedFromArtifacts.ts
// We already paid for this inbound Chris Hughes recording.
// Split the markdown at ## Summary and ## Transcript.
// Before anyone writes the spoken half to Mongo,
// ask the sibling to strip cards and email,
// then stamp the transcript bag.
// Stamp the summary bag with the already-written
// six-heading markdown — do not call the summarizer.
// After the locker returns a private url and a byte count,
// stamp media with a derivable pathname and purged_at null.
// The opened card already reads the six headings
// and the mismatch flag from this same file.
// Do not persist.
// Do not upload.
// Do not call STT.
// Do not call the summarizer.
// Do not write the Lead.

export const knownInboundChrisHughesCall = { /* today's CHRIS_HUGHES_SEED */ }

// ── 1. Parse the already-paid artifact ──

export function parseTheAlreadyPaidConversationArtifact(
  markdown: string,
): ParsedAlreadyPaidConversationArtifact

function requireSummaryThenTranscriptHeadings(markdown)
function stripBoldAndNumberedListMarkers(summaryBody)  // leftover normalizeSummaryMarkdown

// ── 2. Stamp the redacted transcript bag ──

export function stampTheRedactedTranscriptBag(
  rawTranscript: string,
  createdAt: Date,
): SeededRedactedTranscript
  // asks sibling stripPaymentAndIdentityTokensFromTheSpokenTranscriptBeforeAnyonePersistsIt

// ── 3. Stamp the sectioned summary bag, then split headings for the desk ──

export function stampTheSectionedSummaryBag(
  summaryMarkdown: string,
  createdAt: Date,
): SeededSectionedSummary

export function readThisSummaryHeading(
  summaryMarkdown: string,
  heading: (typeof SUMMARY_HEADINGS)[number],
): string | null

export function sayWhetherTheSummaryContradictsCrm(
  summaryMarkdown: string,
): boolean

// ── 4. Stamp media from the locker return ──

export function stampMediaFromTheLockerReturn(input: {
  providerRecordingId: string
  blobUrl: string | null
  bytes: number
  storedAt: Date
}): SeededLockerMedia
```

Read the seed out loud: *Take the Chris Hughes markdown. Find `## Summary` then `## Transcript`. If either heading is missing, reversed, or empty, stop. Strip bold and numbered-list markers from the summary so the six headings match the desk extract. Take the spoken half. Ask the sibling to replace cards and email. Stamp the redacted text, the replay STT model, the redacted character count, the replacement count, and now. Stamp the summary markdown as-is with the replay summary model and `owner-demo-v1`. When the locker has already put the mp3, re-derive `conversations/{recordingId}.mp3`, keep the private url, keep the headed byte count, mark `purged_at` null. The operator script is who upserts. The opened card is who splits the six headings and who hides an all-clear mismatch. This file does not write Mongo. This file does not call RingCentral. This file does not call STT or the summarizer.*

That is the operation. `parseConversationArtifact` is not a different story from “split the already-paid artifact.” `buildSeededTranscript` is not a redact helper.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`parseConversationArtifact` / `buildSeeded*` are executor mechanics.** The owner story is “parse the already-paid artifact, stamp the redacted transcript bag and the sectioned summary, stamp media from the locker return.” Keep the old names as aliases. Do not grow a `SeedService` with `parse` / `build` / `create`.

2. **This file does not persist.** The script `findOneAndUpdate`s `{ provider: "ringcentral", provider_recording_id }` after leftover authorize. Knowledge: the operator tool is the only writer until discovery ships. Do not import `LeadConversation` so “stamp can upsert,” and do not move the upsert here so “the service owns seed.”

3. **Spec §5.2 is a different seed.** The spec names Call Log `GET`, `contentUri` download, vet-before-paying, live STT, live summarizer, CLI `--lead-id` / `--call-log-id`, and `scripts/dev_ops/conversations/`. Today’s script replays `CHRIS_HUGHES_SEED` artifacts from `scripts/conversations/`. Knowledge already says “no new STT or summary call.” Do not silently add a RingCentral download or an OpenAI call so “the spec paragraph becomes true.” Park that gap.

4. **`CHRIS_HUGHES_SEED` is the known-call identity, not a discover list.** Hardcoded Lead `6a761d3d7ceae445794c57bd`, recording `3750152612023`, Job `P5562014`, match `call_lead_telephony_session` / `high`. The script refuses `--all` / `--limit`. Do not turn the constant into an array so “we can seed the folder,” and do not add CLI overrides so “the spec flags exist.”

5. **Parse is heading-order fail-closed.** Both headings required; transcript must start after summary; both bodies must be nonempty after trim. Do not swap in the first `##` so “loose markdown can seed,” and do not silently accept `### Summary`.

6. **`normalizeSummaryMarkdown` is a leftover export.** Only parse **asks** it. It strips `**` so `**Conversation overview:**` becomes a heading `extractSummarySection` can see, and strips `^\d+\.\s+`. Do not export it so “the desk can re-strip,” and do not stop stripping bold so “the artifact stays pretty” — the desk extract would miss every heading.

7. **`buildSeededTranscript` is the persist seam for redact.** It **asks** already-recommended `redactTranscript`, then stamps `chars` from the **redacted** length. Tests lock no `4111`, no `pat@example.com`, `[REDACTED:CARD]`, `redactions >= 2`. Do not skip the sibling **ask** so “the artifact is already clean,” and do not count `raw.length` so “chars match STT.”

8. **The script’s leftover `@` / 13–19 digit refuse sits after this file.** A Luhn-fail 16-digit run this sibling correctly left alone can still trip the script. Do not copy those checks into `stampTheRedactedTranscriptBag` so “seed can refuse,” and do not loosen Luhn so “the script can stay.” Leave the fence on the script.

9. **`buildSeededSummary` writes artifact markdown as-is.** Spec §7.3 / §5.5 say the redacted transcript is what goes to the summarizer. There is no live summarizer. Do not **ask** `redactTranscript` on the summary so “the bag is extra safe” — Job Numbers and dollars in “Quote / money / dates discussed” must stay. Do not invent a prompt call so “model and prompt_version become true.”

10. **Replay models are stamps, not proof of a call.** `gpt-4o-mini-transcribe` / `gpt-4.1-nano` / `owner-demo-v1` come from Wave B config. The script plan prints “(replay, no new call).” Do not live-call those model names so “the fields match the vendor.”

11. **`extractSummarySection` / `hasCrmMismatch` stay here.** Already-recommended reads **ask** them. The six headings and the all-clear regex are the desk **seam**, not a seed-only helper. Do not move them into `reads.ts` so “the desk owns headings” — parse already normalizes so those headings match. Do not fill `sections.mismatch` whenever the heading exists so “the owner can read the all-clear sentence.”

12. **`hasCrmMismatch` is a negative regex, not an LLM.** Empty section → false. “There is no contradiction between the transcript and the CRM record.” → false (locked by parse test + route detail). “Deposit on the call was $500, CRM has $814.” → true. Do not invert the regex so “any mismatch heading is a flag,” and do not import a Lead / Booking so “seed can diff CRM.”

13. **`buildSeededMedia` re-derives the pathname and stores the locker url.** Already-recommended media rec parked the stored-`blob_url` question on this pass. The opened card omits `blob_url`. Knowledge: playable URL is the five-minute sign. Do not drop `blob_url` in this rename — the script already stamps `uploaded.url`. Do not pass `uploaded.pathname` in so “two formulas can drift.” Do not import `uploadConversationMp3` so “stamp can put.”

14. **`purged_at: null` is the seed-time janitor answer.** Spec §5.7 is deferred. Wave B audio-url 409s when `purged_at` is set. Do not set a thirty-day expiry here so “retention can start.”

15. **This file does not upload and does not issue a listen URL.** The script **asks** already-recommended `uploadConversationMp3` only after `--confirm-write`. Dry-run still parses. Do not import `media.ts` so “one file owns seed plus locker.”

16. **This file does not load the Call Lead.** The script `findById`s `CHRIS_HUGHES_SEED.lead_id` and refuses a miss. Booking ref prefers `lead.booked`. Do not import `CallLead` so “the identity can verify,” and do not write `lead_ref` here.

17. **The barrel does not re-export this file.** `conversations/index.ts` ships reads, redact, and locker names. Seed stays operator + sibling extract. Do not add these names to the barrel so “every conversation fold is public,” and do not add them to leftover `v1.service.ts`.

18. **Cost cents are not this file.** The script hardcodes `{ stt: 3, summary: 0 }`. Do not stamp `cost_cents` onto a bag so “seed can price,” and do not call a vendor usage API.

19. **Do not treat RingCentral ingest, discovery, or attach/detach as this story.** Knowledge: those remain deferred. Do not invent `discoverRingCentralRecordings` / `transcribeThisRecording` / `summarizeThisTranscript` so “the seed can own the pipeline.”

20. **Leave the sibling read / redact / locker folds alone.** `toConversationDetail` / `redactTranscript` / `uploadConversationMp3` are not defined here. `redactTranscript` is imported. Do not pull the upsert, the locker `put`, or the desk painters into this file.

21. **Owner-actor is not this file.** Conversation routes use `requireRegistryOwnerActor`. The script uses leftover Granot apply-authorize plus `--confirm-write`. This module does not see `vantageAuth`. Do not add an actor argument so “the service can 403.”

## Testing

The **interface** is the test surface: `parseTheAlreadyPaidConversationArtifact` (old name `parseConversationArtifact` as an alias) plus `ParsedAlreadyPaidConversationArtifact`, `stampTheRedactedTranscriptBag` (old name `buildSeededTranscript`), `stampTheSectionedSummaryBag` (old name `buildSeededSummary`), `stampMediaFromTheLockerReturn` (old name `buildSeededMedia`), `readThisSummaryHeading` / `sayWhetherTheSummaryContradictsCrm` (old names `extractSummarySection` / `hasCrmMismatch`), and `knownInboundChrisHughesCall` (old name `CHRIS_HUGHES_SEED`).

Today’s `seedFromArtifacts.test.ts` proves parse + overview extract + all-clear mismatch false, transcript redact before store, and mismatch true on a deposit contradiction. It never **asks** `buildSeededSummary` / `buildSeededMedia` / `CHRIS_HUGHES_SEED`, and it never proves a missing-heading throw. Keep the three existing proofs. Add tests that stay on the parent:

**Parse the already-paid artifact**
- Happy fixture splits summary vs transcript; overview extract contains the priced-move sentence; transcript still contains `Best email` **before** the stamp beat.
- Missing `## Summary`, missing `## Transcript`, reversed headings, or an empty body throw `Artifact is missing ## Summary or ## Transcript.` / `Artifact summary or transcript is empty.`
- Bold and `1. ` markers are gone from `summary_markdown` so `Conversation overview` extract works.

**Stamp the redacted transcript bag**
- Keep the current proof: no `4111`, no `pat@example.com`, `[REDACTED:CARD]` present, `redactions >= 2`.
- `model === "gpt-4o-mini-transcribe"`.
- `chars ===` redacted `text.length`, not raw length.
- Does not import `LeadConversation`.
- Does not copy the script `@` / 13–19 digit refuse.

**Stamp the sectioned summary bag**
- `text` is the parsed `summary_markdown` (not re-redacted).
- `model === "gpt-4.1-nano"` and `prompt_version === "owner-demo-v1"`.
- Does not **ask** `redactTranscript`.
- Does not import a summarizer client.

**Split headings / mismatch (desk seam)**
- Keep the current all-clear → `hasCrmMismatch` false and contradiction → true proofs.
- Empty or missing “Mismatch vs CRM” → false.
- Already-recommended opened card still fills `sections.mismatch` only when the gate is true — do **not** re-test `toConversationDetail` here.

**Stamp media from the locker return**
- `blob_pathname === "conversations/{providerRecordingId}.mp3"`.
- `blob_url` is the input url (including `null`).
- `content_type === "audio/mpeg"` and `purged_at === null`.
- Does not import `media.ts` / `@vercel/blob`.

**Known inbound Chris Hughes call**
- `normalized_job_no === "P5562014"`, `lead_model === "CallLead"`, `direction === "Inbound"`, `match_method === "call_lead_telephony_session"`.
- Artifact and audio paths stay under `ringcentral-recording-samples/booked-lead-matches/`.

Do **not** add a test per helper (`requireSummaryThenTranscriptHeadings`, `stripBoldAndNumberedListMarkers`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `redactTranscript` token tables here — the stamp proof is “redact ran before the bag.” Do not re-test `toConversationDetail` / `uploadConversationMp3`. Do not add a live Mongo upsert or a live blob put. Do not add Owner-actor 403 tests in the service file — that gap lives on the route and the script.

## What I would not do

- A `SeedService` / `ArtifactService` class with `parse` / `build` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `String.prototype.search` or a sibling **ask**.
- Moving this into a CRUD folder, or into `reads.ts` “because the desk already extracts headings.”
- Importing `LeadConversation` so “stamp can upsert.”
- Importing `media.ts` so “seed can put the mp3.”
- Importing a RingCentral client or an OpenAI client so “the spec §5.2 paragraph becomes true.”
- Calling `redactTranscript` from the summary bag so “the summary is extra safe.”
- Copying the script `@` / 13–19 digit refuse into the transcript stamp.
- Moving `extractSummarySection` / `hasCrmMismatch` into `reads.ts` so “the desk owns headings.”
- Putting these names on `conversations/index.ts` or leftover `v1.service.ts`.
- Dropping stored `media.blob_url` in this rename, or returning it from already-recommended issue.
- Writing a Lead or Booking from the artifact.
- Writing a whole-folder recommendation for `conversations` — this was the last unchecked module.
- Opening `extensionUsers`, `jobNumberTimeline`, or `tariff` in the same pass.
