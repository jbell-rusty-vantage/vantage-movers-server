# Show The Owner The Newest Conversations Without The Transcript Or The Summary Text, Show This Lead's Conversations The Same Way, Load One Conversation Or Say It Is Missing, Then Paint The Opened Card With The Redacted Transcript And The Sectioned Summary — Never Issue The Audio URL, Never Redact Fresh STT, Never Seed The Known Call, Never Write The Lead — operational story

- Status: recommended
- Service: `conversations` (Wave A, in-progress)
- Pass: 1 of this service — `reads.ts`
- Remaining in this service: `redaction.ts`, `media.ts`, `seedFromArtifacts.ts`
- Target: `src/services/conversations/reads.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (Owner-only reads of seeded Lead Conversation evidence; list and by-lead hide transcript / summary text; detail shows the already-redacted transcript plus sectioned summary; audio URL and seed stay elsewhere). Distinct from leftover RingCentral ingest: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (Call Lead write — **not** a Lead Conversation). Distinct from leftover Admin Dashboard desks: already-recommended [admin-browse.md](admin-browse.md) (`form-leads` / `call-leads` / `booked-leads` / `cancelled-leads` / `customers` / `agents` — **not** conversations). Distinct from leftover Job Number timeline: unlisted Wave A `src/services/jobNumberTimeline/` (typed owner chain — **does not import** this file). Sibling redaction / signed audio / artifact seed live in `redaction.ts`, `media.ts`, `seedFromArtifacts.ts` (later passes). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md) and [Conversation Match](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Lead Conversation Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: Wave B `src/routes/conversations-admin.routes.ts` (mounted from `v1.routes.ts`: `GET /api/v1/admin/conversations` → `listConversations`; `GET /api/v1/admin/conversations/by-lead/:model/:id` → `listConversationsByLead`; `GET /api/v1/admin/conversations/:id` → `getConversationById` then `toConversationDetail`; `GET /api/v1/admin/conversations/:id/audio-url` → **same** `getConversationById`, then sibling `issueConversationAudioUrl`). Barrel: `conversations/index.ts` (re-exports the three reads, both painters, and the sibling redact / audio names). Tests: `reads.test.ts` (list-card projection + `assertListProjectionSafe` only — **never** calls `listConversations` / `listConversationsByLead` / `getConversationById`). Route proof: `conversations-admin.routes.test.ts` (stubbed list / by-lead / get / audio; Owner vs Admin 403 on audio; detail mismatch section null when the summary says there is no contradiction). `v1.routes.test.ts` only proves the four paths are mounted. `v1.service.ts` does **not** re-export this file. `adminBrowse.service.ts` does **not** import this file. Operator `scripts/conversations/seed-known-conversation.ts` **asks** sibling `media.ts` + `seedFromArtifacts.ts`, not this file. Not this **interface**: `redactTranscript`, `issueConversationAudioUrl`, `uploadConversationMp3`, `parseConversationArtifact`, `buildSeededTranscript`, `browseAdminResource`, leftover `ingestCallLeadFromRingCentral`.
- Seams callers need: desk list vs this-lead list (same card, different query); load the document vs paint the opened card (audio-url **and** detail share the load); list card vs opened card (flags and cents stay, words do not). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no audio-issue **seam** in this file. There is no redact **seam** in this file. There is no seed **seam**. Owner-actor lives on the route (`requireRegistryOwnerActor`), not here.
- Split later (only if the file outgrows one sitting): this ~200-line file is one sitting if you read it as show the owner the newest conversations without the words — show this lead’s conversations the same way — load one conversation or say it is missing — paint the opened card with the redacted transcript and the sectioned summary. If it later splits by **story**: `showTheOwnerTheNewestConversationsWithoutTheWords.ts` / `paintTheOpenedConversation.ts` — never `list.ts` / `get.ts` / `create.ts` / `update.ts` / `delete.ts`. Signed audio stays the sibling. Redaction stays the sibling. Artifact seed stays the sibling.

`listConversations` / `listConversationsByLead` / `getConversationById` are executor mechanics. The owner question is: *I opened the conversation desk. Show me the newest fifty conversations — tell me whether each one has a transcript, a summary, and a CRM mismatch, but do not put the words on that card. When I am on a Form Lead or a Call Lead, show me that lead’s conversations the same way. When I open one conversation, load it or say it is missing; then paint the redacted transcript and the six summary sections. If the mismatch section says there is no contradiction, leave that section empty and keep `has_mismatch` false. The signed audio URL is a different beat. This file does not redact fresh STT. This file does not seed the known inbound Call Lead. This file does not write the Lead or the Booking.*

Who strips cards / SSN / email already lives in sibling `redaction.ts`. Who uploads the private mp3 and issues the five-minute URL already lives in sibling `media.ts`. Who splits `## Summary` / `## Transcript` and stamps the seeded bags already lives in sibling `seedFromArtifacts.ts`. Do not pull those in.

## What this file actually does

Four “show the owner the seeded conversation evidence” stories in one sitting, not “a conversation CRUD service,” and not Issue This Audio URL:

1. **Show the owner the newest conversations without the words** — `listConversations`. `find({})`, newest `started_at` then `_id`, hard `limit(50)`. Map each row onto the list card, then `assertListProjectionSafe`. The card keeps `has_transcript` / `has_summary` / `has_mismatch` / `cost_cents`. It does **not** own `transcript` or `summary` keys. `has_mismatch` is sibling `hasCrmMismatch` on `summary.text`. This beat does **not** filter `state`. This beat does **not** page. This beat does **not** write Mongo.

2. **Show the owner this lead’s conversations without the words** — `listConversationsByLead`. Same card and same safety assert. Query is `lead_ref.model` plus `lead_ref.id`. Invalid ObjectId → `[]` (not 404). No limit. Sort is newest `started_at` only. This beat does **not** 404 a missing Lead. This beat does **not** attach the Call Lead document.

3. **Load one conversation or say it is missing** — `getConversationById`. Invalid ObjectId → `null`. Found → the raw `LeadConversation` document. Wave B detail **and** audio-url both **ask** this beat. This beat does **not** paint the opened card. This beat does **not** issue a signed URL. This beat does **not** 404 — the route maps `null` to `conversation_not_found`.

4. **Paint the opened conversation with the redacted transcript and the sectioned summary** — `toConversationDetail`. Start from the list card, then add telephony / masked phones / `match_evidence` / media-without-`blob_url` / transcript / summary. Summary `sections` come from sibling `extractSummarySection` on the six headings. `sections.mismatch` is filled only when `hasCrmMismatch` is true; “no contradiction” stays `null`. This beat does **not** re-redact `transcript.text`. This beat does **not** put `blob_url` on the media card.

There is no fifth write or audio-issue operation. `toConversationListItem` / `assertListProjectionSafe` are fold beats inside stories 1–2 and 4. They are exported today only because the test file and the barrel treat them as the **interface** — that is a leak for the painters, and a leftover for the assert. The load **seam** is real: two route adapters share it.

## Organization

Keep one file. This is the screenplay for “show the owner the newest conversations without the words, then open one with the already-redacted transcript.” Redaction / signed audio / artifact seed already live in sibling **modules**. RingCentral Call Lead ingest already lives in already-recommended `ringcentral-call-lead-ingest.service.ts`. Admin lead desks already live in already-recommended `adminBrowse.service.ts`. Owner-actor already lives on Wave B `conversations-admin.routes.ts`. Do not pull those in. Do not invent a `ConversationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a write **adapter** so “list can attach a Lead.” Do not invent an audio **adapter** so “detail can return a forever URL.” Do not invent a CRUD folder so “list / get each get a file.”

Do not move `redactTranscript` into this file so “one service owns conversations.” Do not teach `adminBrowse.service.ts` a `conversations` resource so “one desk owns every collection.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listConversations` | `showTheOwnerTheNewestConversationsWithoutTheWords` | Owner desk; last 50; no words |
| `listConversationsByLead` | `showTheOwnerThisLeadsConversationsWithoutTheWords` | Lead drawer; same card; invalid id is empty |
| `getConversationById` | `loadTheConversationOrSayItIsMissing` | shared by opened card **and** audio-url |
| `toConversationDetail` | `paintTheOpenedConversationWithTheRedactedTranscriptAndTheSectionedSummary` | route paints after load; audio must not |
| `ConversationListItem` | `OwnerConversationListCard` | flags + cents; no `transcript` / `summary` keys |
| `ConversationDetail` | `OwnerOpenedConversation` | list card plus words, sections, media-without-url |
| `toConversationListItem` | leftover list-card leak | tests + detail painter — unexport after the list tests migrate |
| `assertListProjectionSafe` | leftover projection leak | tests only — unexport after the two list reads own the proof |

Keep the old names as one-line aliases until Wave B `conversations-admin.routes.ts`, `conversations/index.ts`, and `reads.test.ts` migrate. Do not make callers learn `find({})` / `limit(50)` / `hasOwn` as the domain language. Do **not** keep `assertListProjectionSafe` as a public **seam** after the test moves onto the two list reads. Do **not** put `listConversations` onto leftover `v1.service.ts` so “every public list lives on the barrel.” Do **not** rename `has_transcript` / `has_summary` / `has_mismatch` / `cost_cents`. Do **not** add `transcript.text` onto the list card so “the desk can preview.”

**No workflow class.** The one type that *does* earn a name is the list card the owner desk already paints:

```ts
type OwnerConversationListCard = {
  id: string
  state: string
  direction: string
  started_at: string
  duration_seconds: number
  match_method: string
  match_confidence: string
  normalized_job_no: string | null
  receiver_agent_name_snapshot: string | null
  lead_ref: { model: string; id: string } | null
  booking_ref: string | null
  has_transcript: boolean
  has_summary: boolean
  has_mismatch: boolean
  cost_cents: { stt: number; summary: number } | null
}

type OwnerOpenedConversation = OwnerConversationListCard & {
  rc_result: string
  telephony_session_id: string | null
  call_log_id: string
  from_phone_masked: string
  to_phone_masked: string
  match_evidence: LeadConversationDocument["match_evidence"]
  media: {
    blob_pathname: string | null
    bytes: number | null
    content_type: string | null
    stored_at: string | null
    purged_at: string | null
  } | null
  transcript: {
    text: string
    model: string
    chars: number
    redactions: number
    created_at: string
  } | null
  summary: {
    text: string
    model: string
    prompt_version: string
    created_at: string
    sections: {
      overview: string | null
      customer_wanted: string | null
      money_dates: string | null
      outcome: string | null
      promised: string | null
      mismatch: string | null
    }
  } | null
}
```

That is the handoff from “the desk can see that a transcript exists” to “the owner can read the already-redacted words without a forever audio link.” Do **not** add `blob_url` onto `OwnerOpenedConversation` so “detail can play without signing.” Do **not** add `transcript` onto `OwnerConversationListCard` so “the list matches detail.”

Leave redaction / signed audio / artifact seed on the sibling **modules**. Leave Call Lead ingest on already-recommended `ringcentral-call-lead-ingest.service.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reads.ts
// The owner opened the conversation desk.
// Show the newest fifty without the words.
// When they are on a Lead, show that Lead's conversations
// the same way.
// When they open one, load it or say it is missing.
// Then paint the already-redacted transcript and the
// six summary sections.
// If the mismatch heading says there is no contradiction,
// leave that section empty.
// Do not issue the audio URL.
// Do not redact fresh STT.
// Do not write the Lead.

// ── 1. Show the owner the newest conversations without the words ──

export async function showTheOwnerTheNewestConversationsWithoutTheWords()

async function pullTheNewestFiftyConversations()     // started_at desc, _id desc, limit 50
function paintTheConversationListCard(doc)           // flags + cents; no transcript / summary keys
function refuseAListCardThatLeakedTheWords(card)     // leftover assert; move into the two list reads

// ── 2. Show the owner this lead's conversations without the words ──

export async function showTheOwnerThisLeadsConversationsWithoutTheWords(lead)

function refuseABadLeadIdSilently(id)                // invalid ObjectId → []
async function pullThisLeadsConversationsNewestFirst(lead)  // no limit

// ── 3. Load one conversation or say it is missing ─────────

export async function loadTheConversationOrSayItIsMissing(id)
  // invalid ObjectId or miss → null; audio-url shares this load

// ── 4. Paint the opened conversation ──────────────────────

export function paintTheOpenedConversationWithTheRedactedTranscriptAndTheSectionedSummary(doc)

function keepTheListCardThenAddTheOpenedFields(doc)  // phones, match_evidence, media without blob_url
function splitTheSummaryIntoTheSixOwnerSections(text)
function leaveMismatchEmptyWhenTheSectionSaysThereIsNoContradiction(text)
```

Read the desk path out loud: *Pull the newest fifty conversations, any state. Paint a card that says whether a transcript, a summary, and a CRM mismatch exist, and how many cents STT and summary cost. Do not put the transcript or the summary on that card. `cost_cents.summary` is a number, not leaked summary text. When the owner is on a Lead, pull every conversation for that `lead_ref` and paint the same card. A junk Lead id is an empty list. When they open one conversation, load the document or return null. Then copy the list card and add the masked phones, the match evidence, the media pointer without `blob_url`, the already-redacted transcript, and the six summary sections. If the mismatch heading says there is no contradiction, `has_mismatch` stays false and `sections.mismatch` stays null.*

That is the operation. `listConversations` is not a different story. `assertListProjectionSafe` is not the **interface**.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The two list reads copy map + assert.** Desk and by-lead share paint + `refuseAListCardThatLeakedTheWords`. One story, two **adapters** (newest fifty vs this Lead). Shared beats: paint the card, refuse leaked words. Only the query and the invalid-id rule differ. Do not split them into `list.ts` / `listByLead.ts` so “each route owns a file.”

2. **Load and paint are split across the route.** `loadTheConversationOrSayItIsMissing` returns the raw document. Wave B calls `toConversationDetail` only on `GET .../:id`. That split is load-bearing because audio-url **asks** the same load and must not paint. Do **not** fold paint into `getConversationById` so “get returns the DTO” — audio would then drag the transcript into a signing route. Do **not** make audio-url call `toConversationDetail`.

3. **List tests never call the list reads.** `reads.test.ts` constructs a document, paints the card, and asserts the leftover. Mongo `find` / `sort` / `limit(50)` / by-lead `[]` on a bad id are unproven on this **interface**. Route tests stub `list` / `listByLead` and never **ask** this file. Lock the two list reads here.

4. **`cost_cents.summary` is not leaked summary text.** The leftover assert only forbids top-level keys `transcript` and `summary`. Knowledge and the current test lock cents on the list card. Do not drop `cost_cents` so “the word summary cannot appear,” and do not treat nested `cost_cents.summary` as a leak.

5. **Invalid ObjectId is empty on by-lead and missing on load.** By-lead → `[]`. Load → `null` → route `conversation_not_found`. Do not 404 the by-lead drawer so “bad ids look like detail,” and do not return `[]` from load so “audio-url can 200.”

6. **Desk list is `find({})` with no state filter.** `discovered` / `failed` / `dead_letter` rows appear in the newest fifty. Knowledge does not hide them. Do not add `state: "complete"` so “the desk only shows finished calls.”

7. **Desk list hard-limits 50; by-lead has no limit.** Do not page the desk so “it matches testimonials,” and do not `limit(50)` the Lead drawer so “one Lead cannot show an older call.”

8. **`has_mismatch` and `sections.mismatch` share one sibling fold.** `hasCrmMismatch` is true only when the “Mismatch vs CRM” section exists and does **not** match `/no contradiction|no mismatch|does not conflict|align with the crm/i`. The route test locks `sections.mismatch === null` on “There is no contradiction…”. Do not fill the section whenever the heading exists so “the owner can read the all-clear sentence,” and do not move that regex into this file so “reads owns mismatch.” Leave the fold on `seedFromArtifacts.ts` until that pass.

9. **Opened media omits `blob_url` on purpose.** The document may store it. The card keeps `blob_pathname` / `bytes` / `content_type` / `stored_at` / `purged_at`. Knowledge: RingCentral `contentUri` is never stored; the playable URL is the short-lived sibling sign. Do not add `blob_url` “so detail can play without `/audio-url`.”

10. **This file does not re-redact.** `transcript.text` is painted as stored. Sibling seed already **asks** `redactTranscript` before persist. Knowledge: raw STT never reaches Mongo. Do not call `redactTranscript` again so “detail is extra safe,” and do not import `redaction.ts` here.

11. **ObjectId construction uses `mongoose.isValidObjectId` plus `new mongoose.Types.ObjectId`.** Library typing already **asks** `toObjectId` / `isObjectIdString` in `src/utils/objectId.ts`. Rename may switch the helper. Do not keep a second construction style so “conversations stay local,” and do not change the empty-vs-null invalid-id rules while swapping the helper.

12. **Painters are a test leak.** `toConversationListItem` / `assertListProjectionSafe` are the first (and only) assertions in `reads.test.ts`. Runtime callers of the assert are the two list reads. Unexport them after the test names those reads. Do not add a third HTTP route that accepts a raw Mongo document.

13. **Leave the sibling seed / audio / redact folds alone.** `extractSummarySection` / `hasCrmMismatch` are imported here and also tested on `seedFromArtifacts.test.ts`. `CHRIS_HUGHES_SEED` / `parseConversationArtifact` / `uploadConversationMp3` are not imported here. Wave A will recommend those modules next. Do not write a whole-folder conversations recommendation.

14. **Do not treat RingCentral ingest or Admin Dashboard desks as this story.** Already-recommended ingest writes a Call Lead. `browseAdminResource` has no `conversations` resource. `GET /api/v1/admin/conversations` is this file, not `GET /api/v1/admin/{resource}`. Do not teach this file `database_scope`.

15. **Do not silently add write routes or automated discovery.** Knowledge: automated discovery, Form Lead phone-window matching, and attach/detach remain deferred. Documents arrive from `pnpm ops:seed-conversation`. Do not invent `attachThisConversationToALead` / `discoverRingCentralRecordings` so “the desk can ingest.”

16. **Owner-actor is not this file.** `requireRegistryOwnerActor` sits on every conversation route. This module does not see `vantageAuth`. Do not add an actor argument so “the service can 403.”

## Testing

The **interface** is the test surface: `showTheOwnerTheNewestConversationsWithoutTheWords`, `showTheOwnerThisLeadsConversationsWithoutTheWords`, `loadTheConversationOrSayItIsMissing`, `paintTheOpenedConversationWithTheRedactedTranscriptAndTheSectionedSummary`. The list card, the opened card, `has_mismatch`, and `sections.mismatch` are part of that **interface**.

Today’s `reads.test.ts` never stubs `find` / `findById`. It only paints a fixture and **asks** the leftover assert. Route tests stub the three reads and lock HTTP. That is not enough for the newest-fifty story or the bad-Lead empty list.

Replace the leftover-assert tests with tests that name the operation:

**Show the owner the newest conversations without the words**
- `find({})`, `sort({ started_at: -1, _id: -1 })`, `limit(50)`.
- List card has `has_transcript` / `has_summary` / `has_mismatch` / `cost_cents` and does **not** own `transcript` or `summary`.
- `JSON.stringify(card)` does not include transcript text or summary sentences.
- `cost_cents.summary` stays a number on the card.
- A `failed` row is still in `find({})`. Do not “fix” the query so the assertion can expect `{ state: "complete" }`.

**Show the owner this lead’s conversations without the words**
- Query is `{ "lead_ref.model": "CallLead", "lead_ref.id": ObjectId(id) }`, `sort({ started_at: -1 })`, no `limit`.
- `id: "not-an-objectid"` → `[]` and no `find`.
- Same list card as the desk (no words).
- A missing Lead still queries; it does not 404.

**Load one conversation or say it is missing**
- Invalid ObjectId → `null` and no `findById`.
- Missing id → `null`.
- Found row is the raw document (`transcript.text` still present). This export does **not** return `OwnerOpenedConversation`.

**Paint the opened conversation**
- List-card fields survive on the opened card.
- `media.blob_url` is absent even when the document has one.
- `sections.mismatch` is `null` when the summary says there is no contradiction; `has_mismatch` is false.
- A contradicting “Mismatch vs CRM” section fills `sections.mismatch` and sets `has_mismatch` true.
- Transcript text is stored text. Do not expect a second redact pass.

Do **not** add a test per helper (`paintTheConversationListCard`, `refuseAListCardThatLeakedTheWords`, `leaveMismatchEmptyWhenTheSectionSaysThereIsNoContradiction`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `redactTranscript` / `parseConversationArtifact` / `issueConversationAudioUrl` here. Do not add Owner-actor 403 tests in the service file — that gap lives on the route. Do not re-test `browseAdminResource` or RingCentral ingest.

## What I would not do

- A `ConversationService` class with `list` / `get` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `LeadConversation.find` or `findById`.
- Moving this into a CRUD folder, or into `admin/` “because the owner desk lists things.”
- Folding `toConversationDetail` into `getConversationById` so “get returns the DTO” and audio-url inherits the words.
- Putting `transcript` or `summary` on the list card so it “matches detail.”
- Putting `blob_url` on the opened media card so the owner can play without `/audio-url`.
- Teaching `adminBrowse.service.ts` a `conversations` resource, or teaching this file `database_scope`.
- Inventing a before-commit / after-commit **seam**, an attach write, or automated RingCentral discovery this read path does not have.
- Pulling `redaction.ts` / `media.ts` / `seedFromArtifacts.ts` into this file.
- Writing a Lead or Booking from a conversation summary.
- Writing a whole-folder recommendation for `conversations` while `redaction.ts`, `media.ts`, and `seedFromArtifacts.ts` are still unchecked.
