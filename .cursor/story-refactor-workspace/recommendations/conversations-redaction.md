# Strip The Card, The CVV, The Expiry, The SSN, The Routing Number, And The Email From The Spoken Transcript Before Anyone Writes Mongo — Luhn Cards And Labeled Tokens Only — Never Touch A Job Number, A Phone, Or Cubic Feet, Never Persist, Never Summarize, Never Seed The Known Call, Never Issue The Audio URL — operational story

- Status: recommended
- Service: `conversations` (Wave A, in-progress)
- Pass: 2 of this service — `redaction.ts`
- Remaining in this service: `media.ts`, `seedFromArtifacts.ts`
- Target: `src/services/conversations/redaction.ts`
- Knowledge: [`docs/knowledge/services/lead-conversation.md`](../../../docs/knowledge/services/lead-conversation.md) (deterministic `redactTranscript` before persistence; raw STT never reaches Mongo, a log, or disk). Owner spec §7.3 (`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`) names this file as the PCI control: Luhn 13–19 digit cards including digits spoken in groups, CVV near card context, expiry-shaped pairs, SSN, bank routing / account numbers; store the `redactions` count; never trust the model. Distinct from leftover Owner desk reads: already-recommended [conversations-reads.md](conversations-reads.md) (paints the **already-redacted** transcript — **does not import** this file). Distinct from leftover signed audio: later `media.ts` (private mp3 + five-minute URL — **does not import** this file). Distinct from leftover artifact seed: later `seedFromArtifacts.ts` (**asks** this file from `buildSeededTranscript`, then stamps `chars` / `redactions` — do not pull that persist beat in). Distinct from leftover Granot receipt credentials: already-recommended [granot-lifecycle-capture.md](granot-lifecycle-capture.md) / skipped `receiptEvidence.ts` (`redactCredentialKeys` — JSON key walk, not spoken STT). Distinct from leftover RingCentral webhook capture: already-recommended [ringcentral-webhook-capture.md](ringcentral-webhook-capture.md) (`redactSensitiveValues` — nested key walk). Distinct from leftover BBB review tokens: already-recommended [testimonials-testimonial-helpers.md](testimonials-testimonial-helpers.md) (`REMOVED` / `REMOVE` gate — boolean, not a rewrite). Distinct from leftover reporting live evidence: already-recommended [reporting-pii-safe-evidence.md](reporting-pii-safe-evidence.md). Distinct from leftover Job Number timeline: unlisted Wave A `src/services/jobNumberTimeline/masking.ts` (page walk — **does not import** this file). Distinct from leftover log phone fold: `maskPhoneForLog` (last-four mask — not a card). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Lead Conversation](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Lead Conversation Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still omit the four Owner conversation routes.
- Callers: **one runtime import site.** Later sibling `seedFromArtifacts.ts` — `buildSeededTranscript(rawTranscript, createdAt)` **asks** `redactTranscript` then stamps `text` / `chars` (redacted length) / `redactions` / `created_at`. Barrel: `conversations/index.ts` (re-exports `redactTranscript` + `RedactionResult`; **does not** re-export `luhnValid`). Tests: `redaction.test.ts` (happy-path seven tokens; Job Number / phone / cubic feet stay; Luhn-fail 16-digit stay — also **asks** leftover `luhnValid`). Sibling proof: `seedFromArtifacts.test.ts` (`buildSeededTranscript` refuses `4111` and `pat@example.com` — that is the persist **seam**, not this **interface**). Operator `scripts/conversations/seed-known-conversation.ts` **asks** sibling `buildSeededTranscript`, then refuses leftover `@` without `[REDACTED:EMAIL]` and leftover 13–19 digit runs on the **already-redacted** bag — it does **not** import this file. Wave B `conversations-admin.routes.ts` does **not** import this file. Already-recommended `reads.ts` does **not** import this file. Later `media.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `listConversations`, `toConversationDetail`, `issueConversationAudioUrl`, `uploadConversationMp3`, `parseConversationArtifact`, `buildSeededTranscript`, `buildSeededSummary`, leftover `redactCredentialKeys`, leftover `redactSensitiveValues`, leftover `hasBbbRedaction`, leftover `sanitizeLiveTestString`, leftover `maskPhoneForLog`.
- Seams callers need: raw spoken string vs redacted bag (`text` + `redactions`); Luhn card span vs unlabeled long digit run (Job Number / phone / cubic feet stay); labeled CVV / expiry / routing vs bare digits; typed email vs spoken `at` email. There is no persist **seam**. There is no begin / complete Domain Command **seam**. There is no summarizer **seam** in this file. There is no audio-issue **seam**. There is no desk-paint **seam**. Owner-actor lives on the route, not here.
- Split later (only if the file outgrows one sitting): this ~79-line file is one sitting if you read it as strip the card, the CVV, the expiry, the SSN, the routing number, and the email from the spoken transcript before anyone writes Mongo — Luhn cards and labeled tokens only — never touch a Job Number, a phone, or cubic feet. If it later splits by **story**: do not. One control. Never `create.ts` / `update.ts` / `delete.ts` / `redactCard.ts` / `luhn.ts`. Signed audio stays the sibling. Artifact seed stays the sibling. Desk reads stay the sibling.

`redactTranscript` / `luhnValid` are executor mechanics. The owner question is: *An agent just took a deposit over the phone. The spoken transcript may contain a card number, a CVV, an expiry, an SSN, a routing number, or an email. Before anyone writes that string to Mongo, a log, a disk, or a summarizer, replace those tokens. A Luhn-valid 13–19 digit span — including digits spoken in groups with spaces, dashes, or dots — becomes `[REDACTED:CARD]`. A labeled CVV, expiry, or routing number keeps the label and replaces the digits. A dashed SSN and a typed or spoken email become tokens. Count the replacements so the desk can see a payment call. Leave a Job Number, a spoken phone, cubic feet, and a 16-digit run that fails Luhn alone. This file does not persist. This file does not summarize. This file does not seed the known inbound Call Lead. This file does not issue the audio URL. This file does not write the Lead or the Booking.*

Who paints the already-redacted opened card already lives in already-recommended `reads.ts`. Who uploads the private mp3 and issues the five-minute URL already lives in later `media.ts`. Who splits `## Summary` / `## Transcript` and stamps the seeded bags already lives in later `seedFromArtifacts.ts` and **asks** this file. Do not pull those in.

## What this file actually does

One “strip payment and identity tokens from the spoken transcript before anyone persists it” story in one sitting, not “a redaction helper,” and not Show The Owner The Newest Conversations / Seed The Known Call / Issue This Audio URL:

1. **Strip the card, the CVV, the expiry, the SSN, the routing number, and the email from the spoken transcript before anyone writes Mongo** — `redactTranscript(raw)`. Walk the string in this order: Luhn card span → labeled CVV → labeled expiry → dashed SSN → labeled routing → typed email → spoken `at` email. Return `{ text, redactions }`. `redactions` is the replacement count, not a unique-token set. This beat does **not** persist. This beat does **not** log `raw`. This beat does **not** call STT. This beat does **not** call the summarizer. This beat does **not** write a Lead Conversation. This beat does **not** redact the summary markdown.

There is no second persist or summarize operation. `replaceCaptured` is a fold beat inside story 1 (keep the label, replace the captured digits). `luhnValid` is a fold beat inside the card span — it is exported today only because the test file treats it as the **interface**. That is a leak.

## Organization

Keep one file. This is the screenplay for “strip the card, the CVV, the expiry, the SSN, the routing number, and the email from the spoken transcript before anyone writes Mongo.” Desk reads already live on already-recommended `reads.ts`. Signed audio already lives on later `media.ts`. Artifact parse / seed bags already live on later `seedFromArtifacts.ts`. Granot credential-key walks, RingCentral webhook key walks, BBB `REMOVED` gates, reporting live-evidence folds, and Job Number timeline page walks already live in already-recommended **modules**. Do not pull those in. Do not invent a `RedactionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a persist **adapter** so “redact can write Mongo.” Do not invent a summarizer **adapter** so “the control can also prompt.” Do not invent a CRUD folder so “card / cvv / ssn each get a file.”

Do not move `redactTranscript` into `reads.ts` so “one service owns conversations.” Do not move it into `seedFromArtifacts.ts` so “the seed already redacts.” Do not teach `toConversationDetail` to **ask** this file so “detail is extra safe.” Do not split `create.ts` / `update.ts` / `delete.ts` / `redactCard.ts` / `luhn.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `redactTranscript` | `stripPaymentAndIdentityTokensFromTheSpokenTranscriptBeforeAnyonePersistsIt` | sibling seed **asks** this before the Mongo bag; tests prove the tokens without writing |
| `RedactionResult` | `RedactedSpokenTranscript` | `{ text, redactions }` — the bag seed stamps onto `transcript` |
| `luhnValid` | leftover Luhn leak | tests only — unexport after the card-span proof lives on the parent |

Keep the old names as one-line aliases until `conversations/index.ts`, later `seedFromArtifacts.ts`, and `redaction.test.ts` migrate. Do not make callers learn `CARD_SPAN` / `luhnValid` / `replaceCaptured` as the domain language. Do **not** keep `luhnValid` as a public **seam** after the test names the parent. Do **not** put `redactTranscript` onto leftover `v1.service.ts` so “every public fold lives on the barrel.” Do **not** rename `[REDACTED:CARD]` / `[REDACTED:CVV]` / `[REDACTED:EXPIRY]` / `[REDACTED:SSN]` / `[REDACTED:ROUTING]` / `[REDACTED:EMAIL]`. Do **not** add a `summary` field onto `RedactedSpokenTranscript` so “one bag can redact both.”

**No workflow class.** The one type that *does* earn a name is the bag sibling seed already stamps onto `LeadConversation.transcript`:

```ts
type RedactedSpokenTranscript = {
  text: string
  redactions: number
}
```

That is the handoff from “STT just spoke” to “Mongo may store these two fields.” Do **not** add `raw` onto this type so “the bag can skip the control.” Do **not** add `model` / `chars` / `created_at` so “redact can build the seeded transcript” — those belong on later `buildSeededTranscript`. Do **not** add `blob_url` so “the locker can play the audio.”

`replaceCaptured` and the seven regexes stay unexported. They are beats, not a second public operation. Do not export `CARD_SPAN` so “the seed script can reuse the card matcher” — the operator script already has its own leftover 13–19 digit refuse.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// redaction.ts
// An agent just took a deposit over the phone.
// The spoken transcript may contain a card number,
// a CVV, an expiry, an SSN, a routing number, or an email.
// Before anyone writes that string to Mongo, a log,
// a disk, or a summarizer, replace those tokens.
// A Luhn-valid 13–19 digit span becomes [REDACTED:CARD].
// A labeled CVV, expiry, or routing number keeps the label
// and replaces the digits.
// A dashed SSN and a typed or spoken email become tokens.
// Count the replacements so the desk can see a payment call.
// Leave a Job Number, a spoken phone, cubic feet,
// and a 16-digit run that fails Luhn alone.
// Do not persist.
// Do not summarize.
// Do not seed the known call.
// Do not issue the audio URL.
// Do not write the Lead.

// ── 1. Strip payment and identity tokens before anyone persists ──

export function stripPaymentAndIdentityTokensFromTheSpokenTranscriptBeforeAnyonePersistsIt(
  raw: string,
): RedactedSpokenTranscript

function replaceALuhnValidCardSpan(text)            // 13–19 digits; spaces / dashes / dots
function leaveADigitRunThatFailsLuhnAlone(digits)   // leftover luhnValid; unexport after tests move
function replaceALabeledCvv(text)                   // keep "CVV ", replace the 3–4 digits
function replaceALabeledExpiry(text)                // keep "expiry ", replace 07/2029
function replaceADashedSsn(text)
function replaceALabeledRoutingNumber(text)         // routing / aba + 9 digits
function replaceATypedEmail(text)
function replaceASpokenAtEmail(text)                // "chris at iCloud.com"
function countEachReplacement(n)
```

Read the control out loud: *Take the spoken transcript. Walk a 13–19 digit span that may have spaces, dashes, or dots. If the digits fail Luhn, leave them. If they pass, replace the whole span with `[REDACTED:CARD]` and count one. Then, only when the word CVV / CVC / CBB / CID / security code / magic three is present, replace the following 3–4 digits with `[REDACTED:CVV]` and keep the label. Do the same for expiry and for routing / ABA plus nine digits. Replace a dashed SSN. Replace a typed email and a spoken `name at host.tld`. Hand back the rewritten string and the count. A Job Number like `P5562014`, a phone like `402-555-1212`, `300` cubic feet, and quote `2114` stay. A 16-digit reference that fails Luhn stays. This file does not write Mongo. The sibling seed is who persists the bag. The desk is who paints the already-redacted words.*

That is the operation. `redactTranscript` is not a different story. `luhnValid` is not the **interface**.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`redactTranscript` is executor mechanics.** The owner story is “strip payment and identity tokens from the spoken transcript before anyone persists it.” Keep the old name as an alias. Do not grow a `RedactionService` with `redact` / `count` / `validate`.

2. **`luhnValid` is a test leak.** The barrel does **not** re-export it. Runtime callers of Luhn are the card-span beat. Unexport it after `redaction.test.ts` names the parent. Do not add a third HTTP route that accepts raw digits so “the desk can check a card.”

3. **Card span replaces the whole match; labeled tokens keep the word.** `4111-1111-1111-1111` becomes `[REDACTED:CARD]`. `CVV 123` becomes `CVV [REDACTED:CVV]`. That split is load-bearing: the owner still sees that a CVV was spoken. Do not replace the whole `CVV 123` span so “the label cannot leak a payment word,” and do not leave the card dashes so “the desk can see it was grouped.”

4. **Luhn is the card gate, not digit length.** 13–19 digits that fail Luhn stay (`1234567890123456`). Spec §7.3 requires Luhn. Do not redact every 16-digit run so “we never miss a card” — Job-adjacent references and quote strings would vanish. Do not drop Luhn so “the regex is enough.”

5. **Job Number, phone, and cubic feet stay on purpose.** Today’s second test locks `P5562014`, `402-555-1212`, `300`, and `2114` with `redactions === 0`. `CARD_SPAN` needs 13–19 digits; a 10-digit phone and a 4-digit quote never enter it. Do not add a phone redactor so “PII is consistent with email,” and do not redact `P5562014` so “long numbers look like cards.” Knowledge and already-recommended reads already mask phones on the opened card via stored `from_phone_masked` / `to_phone_masked`.

6. **CVV / expiry / routing require a label.** Bare `123`, `07/2029`, or `021000021` stay. Spec §7.3 says “CVV in proximity to card context” and “expiry-shaped pairs.” The code uses a **label** (`cvv` / `cvc` / `cbb` / `cid` / `security code` / `magic three`; `exp` / `expiry` / `expiration`; `routing` / `aba`), not distance to the last card span. Do not silently require a preceding `[REDACTED:CARD]` so “CVV without a card is safe,” and do not silently redact every `MM/YYYY` so “move dates cannot leak.” Do not “fix” `cbb` to `cvv` in this rename — that token is in the regex today.

7. **SSN requires dashes.** `\d{3}-\d{2}-\d{4}` only. `123456789` stays. Do not add an undashed 9-digit SSN so “we match the routing width,” and do not reuse the routing beat for SSN.

8. **Spec §7.3 lists bank routing / account numbers; this file only does labeled 9-digit routing.** There is no account-number pattern. Do not silently add an account redactor so “the spec sentence becomes true.” Park that gap. Wave A will recommend `seedFromArtifacts.ts` next after `media.ts` — do not write a whole-folder conversations recommendation.

9. **Email is extra versus the PCI list and locked by the test.** Spec §7.3’s PCI targets omit email. Spec later says withhold direct identifiers from the summarizer. Today’s happy-path test counts typed `pat@example.com` and spoken `chris at iCloud.com` as two of the seven replacements, and the host must not survive (`icloud.com` is gone). Do not drop email so “we match PCI only,” and do not add phone so “identifiers are complete.”

10. **Spoken email is `name at host.tld`, not “name at host dot tld.”** `SPOKEN_EMAIL` needs a literal `.` plus a two-letter TLD. Do not invent a `dot` spoken form in this rename. Do not treat `at` inside “Best phone is the 402 number” as an email.

11. **Replacement order is load-bearing.** Cards first, then CVV, expiry, SSN, routing, typed email, spoken email. A card span that ate digits cannot later look like a routing number. Do not silently reorder so “email can run first,” and do not run spoken email before typed email so “`pat@example.com` can also hit `at`.”

12. **`redactions` is a count of replacements, not unique kinds.** The happy-path fixture expects `7`. Two emails are two. Do not collapse to a set so “the desk shows kinds,” and do not count Luhn rejects.

13. **This file does not persist and does not re-redact on read.** Later `buildSeededTranscript` is the only runtime **ask**. Already-recommended `toConversationDetail` paints stored `transcript.text`. Knowledge: raw STT never reaches Mongo. Do not import `LeadConversation` so “redact can write.” Do not import `reads.ts` so “detail can run the control again.”

14. **This file does not summarize.** Spec §7.3 / §5.5 say the redacted text is what goes to the summarizer. There is no live STT / summarizer caller yet — the seed replays an already-written artifact and **asks** this file only on the transcript beat. `buildSeededSummary` writes summary markdown as-is. Do not call this file from `buildSeededSummary` so “the summary is extra safe” in this rename, and do not invent a summarizer prompt here. Leave that on the seed pass.

15. **Spec §7.3.4 is not this file.** “Consider not storing transcripts when `redactions > 0`” is a later product choice. This file returns the count. Do not drop `text` when the count is nonzero so “PCI is safer.” Do not hide `has_transcript` on the desk.

16. **Spoken English digit words are not a card.** Spec says “digits spoken in groups.” `CARD_SPAN` is digits with spaces / dashes / dots (`4111-1111-1111-1111`), not “four one one one.” Do not add an English-word PAN so “STT can say the names.”

17. **The operator script’s leftover refuse is not this control.** After sibling seed, the script throws on leftover `@` without `[REDACTED:EMAIL]` and on leftover 13–19 digit runs. That fence can false-trigger on a Luhn-fail run the control correctly left alone. Do not copy those checks into this file so “redact can refuse,” and do not loosen Luhn so “the script can stay.” Leave the script on the seed pass.

18. **Leave the sibling seed / audio / read folds alone.** `buildSeededTranscript` / `parseConversationArtifact` / `issueConversationAudioUrl` / `listConversations` are not imported here. Wave A will recommend `media.ts` then `seedFromArtifacts.ts` next. Do not write a whole-folder conversations recommendation.

19. **Do not treat Granot credential redaction, RingCentral webhook key walks, BBB `REMOVED`, reporting live evidence, or Job Number timeline masking as this story.** Those already-recommended **modules** walk keys or pages. This file walks spoken STT. Do not import `redactCredentialKeys` so “one redactor owns the company.”

20. **Do not silently add write routes or automated discovery.** Knowledge: automated discovery, Form Lead phone-window matching, and attach/detach remain deferred. Documents arrive from `pnpm ops:seed-conversation`. Do not invent `transcribeThisRecording` / `summarizeThisTranscript` so “the control can own the pipeline.”

21. **Owner-actor is not this file.** `requireRegistryOwnerActor` sits on every conversation route. This module does not see `vantageAuth`. Do not add an actor argument so “the service can 403.”

## Testing

The **interface** is the test surface: `stripPaymentAndIdentityTokensFromTheSpokenTranscriptBeforeAnyonePersistsIt` (old name `redactTranscript` as an alias) plus `RedactedSpokenTranscript`. The six tokens, the Luhn refuse, and the Job Number / phone / cubic-feet keep are part of that **interface**.

Today’s `redaction.test.ts` already names the parent for the happy path and the keep path, then also **asks** leftover `luhnValid` as if it were the **interface**. Replace the leftover Luhn **asks** with tests that stay on the parent:

**Strip payment and identity tokens from the spoken transcript before anyone persists it**
- Luhn-valid `4111-1111-1111-1111` → `[REDACTED:CARD]`; the digits do not survive.
- `expiry 07/2029` → `[REDACTED:EXPIRY]`; the label `expiry` may remain.
- `CVV 123` → `[REDACTED:CVV]`.
- `SSN 123-45-6789` → `[REDACTED:SSN]`.
- `routing 021000021` → `[REDACTED:ROUTING]`.
- `pat@example.com` and `chris at iCloud.com` → `[REDACTED:EMAIL]`; `icloud.com` does not survive.
- Happy-path `redactions === 7`.
- `Job P5562014` / `402-555-1212` / `300` cubic feet / quote `2114` → `redactions === 0` and the strings survive.
- `Reference 1234567890123456 is not a card.` → `redactions === 0` and the digits survive (Luhn fail).
- Bare `123` / bare `07/2029` / undashed `123456789` stay.
- Does not import `LeadConversation`.
- Does not import `reads.ts` / `media.ts` / `seedFromArtifacts.ts`.

Do **not** add a test per helper (`replaceALuhnValidCardSpan`, `replaceALabeledCvv`, `leaveADigitRunThatFailsLuhnAlone`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `buildSeededTranscript` / `parseConversationArtifact` / `toConversationDetail` / `issueConversationAudioUrl` here. Do not add Owner-actor 403 tests in the service file — that gap lives on the route. Do not re-test leftover `redactCredentialKeys` or leftover `hasBbbRedaction`.

## What I would not do

- A `RedactionService` class with `redact` / `count` / `validate` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `String.prototype.replace`.
- Moving this into a CRUD folder, or into `reads.ts` “because the desk shows redacted text.”
- Calling this file from `toConversationDetail` so “detail is extra safe” and the stored count no longer matches the painted text.
- Redacting every 16-digit run, every phone, or every Job Number so “PII is consistent.”
- Dropping email so “the PCI list is the only list,” or adding account-number / English-word PAN redactors so “the spec sentence becomes true.”
- Dropping `text` when `redactions > 0` so “payment calls store summary only.”
- Importing `LeadConversation` or the seed script so “redact can persist.”
- Pulling `media.ts` / `seedFromArtifacts.ts` / already-recommended `reads.ts` into this file.
- Importing leftover `redactCredentialKeys` / leftover `redactSensitiveValues` / leftover `hasBbbRedaction` so “one redactor owns the company.”
- Writing a Lead or Booking from a redacted transcript.
- Writing a whole-folder recommendation for `conversations` while `media.ts` and `seedFromArtifacts.ts` are still unchecked.
