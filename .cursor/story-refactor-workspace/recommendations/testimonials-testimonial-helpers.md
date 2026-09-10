# Notice This BBB Review Has Redacted PII, Fold The Reviewer Name, Read The Review Date As UTC Midnight, Then Stamp The Content Fingerprint So Upsert Can Key On Source Plus Fingerprint — Never Upsert The Review, Never Publish, Never Show The Main Site The Curated Reviews — operational story

- Status: recommended
- Service: `testimonials` (Wave A, visited)
- Pass: 2 of this service — `testimonial.helpers.ts`
- Remaining in this service: none
- Target: `src/services/testimonials/testimonial.helpers.ts`
- Knowledge: [`docs/knowledge/services/testimonial.md`](../../../docs/knowledge/services/testimonial.md) (read-only public and admin testimonials; ingest stays in helpers and ops scripts — normalize name → parse date → fingerprint → upsert on `(source, content_fingerprint)`). Distinct from already-recommended [testimonials-testimonial.md](testimonials-testimonial.md) (Main Site / owner reads; **does not import** this file). Distinct from leftover Customer wipe: already-recommended [customers-customer.md](customers-customer.md). Distinct from leftover Eastern wall clock: already-recommended [historical-consolidation-date-parsing.md](historical-consolidation-date-parsing.md) and live `parseFloridaCalendarDate` (UTC midnight of the owner calendar day). Distinct from leftover SHA-256 envelopes: already-recommended [historical-consolidation-stable-json.md](historical-consolidation-stable-json.md) (fold then hash a bag) and [durable-work-checksum.md](durable-work-checksum.md) (versioned envelope). Distinct from leftover Lead display-name fold: already-recommended [leads-lead-name.md](leads-lead-name.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Main Site](../../../../CONTEXT.md); do not invent a Testimonial glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Testimonial Service file in this rename.
- Callers: barrel `testimonials/index.ts` (re-exports the four folds). Tests: `testimonial.helpers.test.ts` (**only** `hasBbbRedaction` — glued `REMOVEDdelivered`, standalone `REMOVED` / `REMOVE`, and a clean sentence). `normalizeReviewerName`, `parseReviewDate`, and `buildContentFingerprint` have **no** test. Sibling `testimonial.service.ts` does **not** import this file. Wave B `v1.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Operator `scripts/api/starter.ts` hits `GET /api/v1/testimonials` over HTTP — not an import. **No ops ingest script in this checkout imports these folds**, even though knowledge says documents are loaded externally using this file. The marketing-site client (`vantage-movers-clients`) is not in this checkout. Not this **interface**: `listTestimonials`, `listAdminTestimonials`, `getAdminTestimonial`, `listAdminTestimonialReviewerNames`, `buildTestimonialFilter`, `buildAdminTestimonialFilter`, `browseAdminResource`, `wipeThisCustomerAndTheirBookings`, leftover `parseEasternDate`, leftover `parseFloridaCalendarDate`, leftover `sha256` / `canonicalJson`.
- Seams callers need: redaction gate (boolean) vs name fold (stored + fingerprint input) vs UTC-midnight date (stored + fingerprint day key) vs content fingerprint (unique with `source`). Knowledge ingest order is fold name → parse date → stamp fingerprint → upsert. Upsert is **outside** this file. There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no list **seam**. There is no publish **seam**. There is no Sheet Sync **seam**. There is no Owner-actor **seam**.
- Split later (only if the file outgrows one sitting): this ~45-line file is one sitting if you read it as notice BBB redacted PII — fold the reviewer name — read the review date as UTC midnight — stamp the content fingerprint. If it later splits by **story**: do not. One gate plus one name plus one date plus one stamp. Never `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `parse.ts`. The Main Site list stays the sibling. Upsert stays ops/script.

`hasBbbRedaction` / `normalizeReviewerName` / `parseReviewDate` / `buildContentFingerprint` are executor mechanics. The owner question is: *Ops is about to load a BBB review. Tell me if the text still has the BBB `REMOVED` / `REMOVE` token so I can refuse a redacted row. Fold the reviewer so later owner search can hit `normalized_reviewer_name`. Read `YYYY-MM-DD` as UTC midnight, not Eastern, and throw if the shape is wrong. Stamp SHA-256 of `source|folded name|YYYY-MM-DD|trimmed text` so the unique index `(source, content_fingerprint)` can upsert without colliding. This file does not upsert the review. This file does not publish. This file does not show the Main Site the curated reviews.*

Who lists the reviews, who attaches the Customer, and who writes the document already live in the sibling **module** and in ops scripts. Do not pull those in.

## What this file actually does

Four “prepare this BBB review for upsert” stories in one sitting, not “a testimonial helper,” and not Show The Main Site The Curated Reviews:

1. **Notice this BBB review has redacted PII** — `hasBbbRedaction`. Word-boundary `REMOVED` or `REMOVE`, case-insensitive. BBB paints a customer name as the literal token `REMOVED` (sometimes `REMOVE`). Today’s fixture locks `Thank you REMOVED`, `REMOVE and crew`, and `REMOVEDdelivered` with no space after the token. A clean “arrived on time” sentence is false. This beat does **not** redact the text. This beat does **not** upsert. This beat does **not** require a trailing word boundary, so English `remove` / `removed` / `removal` also match.

2. **Fold the reviewer name for matching** — `normalizeReviewerName`. `trim().toLowerCase()`. Knowledge ingest stores this on `normalized_reviewer_name` and later **asks** it as fingerprint input. The model also `trim`s and `lowercase`s the field. This beat does **not** collapse interior spaces. This beat does **not** strip punctuation. This beat does **not** compose first + last the way leftover Lead display-name does. This beat does **not** run on owner `q` (the sibling list regex-escapes the typed string and searches display **or** normalized).

3. **Read this review date as UTC midnight** — `parseReviewDate`. Shape must be exact `YYYY-MM-DD`. Then `new Date(`${trimmed}T00:00:00.000Z`)`. `NaN` throws `Invalid review date: ${value}`. A bad shape throws `Invalid review date (expected YYYY-MM-DD): ${value}` and echoes the raw string, not the trim. This beat does **not** **ask** leftover `parseEasternDate`. This beat does **not** **ask** leftover `parseFloridaCalendarDate`. This beat does **not** refuse a rolled calendar day: `2026-02-31` becomes `2026-03-03T00:00:00.000Z` and does **not** throw.

4. **Stamp the content fingerprint so upsert can key on source plus fingerprint** — `buildContentFingerprint`. Day key is `review_date.toISOString().slice(0, 10)`. Payload is `source|normalized_reviewer_name|dateKey|review_text.trim()` joined on `|`. SHA-256 hex. Unique index is `{ source, content_fingerprint }`. Knowledge upsert keys that pair. This beat does **not** fold the name itself — the caller must already have **asked** story 2. This beat does **not** parse the date itself — the caller must already have **asked** story 3 (or handed a `Date`). This beat does **not** include `rating`, `published`, `featured`, `business_response`, or `customer`. This beat does **not** write Mongo.

There is no fifth upsert or publish operation. Local `BBB_REDACTION_PATTERN` is a fold inside story 1.

## Organization

Keep one file. This is the screenplay for “notice this BBB review has redacted PII, fold the reviewer, read the date as UTC midnight, then stamp the fingerprint.” Main Site / owner reads already live on already-recommended `testimonial.service.ts`. Customer wipe already lives on already-recommended `customer.service.ts`. Leftover Eastern clocks already live on leftover `dateParsing.ts` / leftover `parseFloridaCalendarDate`. Leftover bag hashes already live on leftover `stableJson.ts` / leftover `checksum.ts`. Zod already lives in Wave B `testimonials.validation.ts`. Do not pull those in. Do not invent a `TestimonialHelpersService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an upsert **adapter** so “helpers can write the unique index.” Do not invent a publish **adapter** so “fingerprint can set `published=true`.” Do not invent a list **adapter** so “the Main Site can de-dupe.” Do not invent a CRUD folder so “hash / parse / normalize each get a file.”

Do not move `buildContentFingerprint` into `testimonial.service.ts` so “one service owns testimonials.” Do not teach `listTestimonials` to **ask** this file so “the public card can hide a key it computed.” Do not split `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `parse.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `hasBbbRedaction` | `noticeThisBbbReviewHasRedactedPii` | ops gate before upsert; boolean, not a rewrite |
| `normalizeReviewerName` | `foldTheReviewerNameForMatching` | stored on the document **and** handed to the fingerprint |
| `parseReviewDate` | `readThisReviewDateAsUtcMidnight` | stored `review_date`; fingerprint slices the same instant |
| `buildContentFingerprint` | `stampTheContentFingerprintSoUpsertCanKeyOnSourcePlusFingerprint` | unique with `source`; SHA-256 of source \| folded name \| day \| trimmed text |

Keep the old names as one-line aliases until `testimonials/index.ts` and `testimonial.helpers.test.ts` migrate. Do not make callers learn `createHash("sha256")` / `T00:00:00.000Z` / `\b(?:REMOVED|REMOVE)` as the domain language. Do **not** export `BBB_REDACTION_PATTERN`. Do **not** put these four folds onto leftover `v1.service.ts` so “every public helper lives on the barrel.” Do **not** rename `content_fingerprint` / `normalized_reviewer_name` / `review_date`. Do **not** add `rating` onto the fingerprint so “a star change is a new review.”

**No workflow class.** The one type that *does* earn a name is the bag the fingerprint already takes:

```ts
type ThisBbbReviewFingerprintInput = {
  source: TestimonialSource
  normalized_reviewer_name: string
  review_date: Date
  review_text: string
}
```

That is the handoff from “we folded the name and read the date as UTC midnight” to “stamp the unique key.” Do **not** add `published` / `featured` / `customer` onto this bag so “the stamp can publish.” Do **not** add a session or a Booking id onto `stampTheContentFingerprintSoUpsertCanKeyOnSourcePlusFingerprint` so “the stamp writes Mongo.”

Leave the Main Site list on already-recommended `testimonial.service.ts`. Leave upsert on the missing ops script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// testimonial.helpers.ts
// Ops is about to load a BBB review.
// Tell me if the text still has REMOVED or REMOVE.
// Fold the reviewer so owner search can hit the stored name.
// Read YYYY-MM-DD as UTC midnight, not Eastern.
// Stamp SHA-256 of source|folded name|day|trimmed text
// so upsert can key on (source, content_fingerprint).
// Do not upsert the review.
// Do not publish.
// Do not show the Main Site the curated reviews.

// ── 1. Notice this BBB review has redacted PII ────────────

export function noticeThisBbbReviewHasRedactedPii(text: string): boolean
  // \b(?:REMOVED|REMOVE)/i — no trailing word boundary

// ── 2. Fold the reviewer name for matching ────────────────

export function foldTheReviewerNameForMatching(value: string): string
  // trim + toLowerCase only

// ── 3. Read this review date as UTC midnight ──────────────

export function readThisReviewDateAsUtcMidnight(value: string): Date
function refuseThisReviewDateWhenTheShapeIsNotYearMonthDay(value)
function stampUtcMidnightOrSayTheInstantIsInvalid(trimmed, raw)

// ── 4. Stamp the content fingerprint ──────────────────────

export function stampTheContentFingerprintSoUpsertCanKeyOnSourcePlusFingerprint(
  input: ThisBbbReviewFingerprintInput,
): string
function takeTheUtcDayKeyFromTheInstant(review_date: Date)
function joinSourceFoldedNameDayAndTrimmedText(input, dateKey)
```

Read the ingest-prepare path out loud: *Notice whether this BBB review still has the `REMOVED` or `REMOVE` token. Fold the reviewer with trim and lowercase so the stored `normalized_reviewer_name` matches later owner search. Read `YYYY-MM-DD` as UTC midnight — throw on any other shape, and do not ask Eastern. Stamp SHA-256 of `source`, the folded name, the UTC day, and the trimmed review text so upsert can key on `(source, content_fingerprint)`. Do not upsert. Do not publish. Do not show the Main Site the curated reviews.*

That is the operation. `buildContentFingerprint` is not a different story. `normalizeReviewerName` is not the **interface** by itself.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The redaction gate matches English `remove`.** `\b(?:REMOVED|REMOVE)` is case-insensitive and has no trailing `\b`. `Please remove the boxes`, `removed`, and `removal` are true. Today’s fixture only proves tokens BBB actually paints and one clean sentence. Do **not** add a trailing word boundary in this rename so “ordinary English is safe” — that would change `REMOVEDdelivered`, which the fixture already locks as true.

2. **`REMOVE` is a prefix of `REMOVED`, and the alternation does not need a trailing boundary.** Glued `REMOVEDdelivered` matches because `\b` sits after `!` (or a space) and `REMOVED` eats the token. Do not switch to a start-anchored whole-string match so “partial tokens die” — BBB pastes the token inside a sentence.

3. **This file does not redact.** `noticeThisBbbReviewHasRedactedPii` is a boolean. It does not rewrite `review_text`. Do not invent `stripBbbRedaction` so “ingest can save a cleaned quote.”

4. **Name fold is trim + lowercase only.** Interior double spaces and punctuation stay. The model will `trim` / `lowercase` again on persist. Do not import leftover `composeTheLeadDisplayName` so “one name owns the company,” and do not collapse spaces so “Dana  P matches Dana P” without an **interface** proof.

5. **Fingerprint does not fold the name or parse the date.** The caller must already have **asked** stories 2 and 3. Handing `" Dana P "` as `normalized_reviewer_name` stamps spaces into the hex. Handing a 4pm Eastern `Date` slices to the next UTC day (`2026-09-10T20:00:00-04:00` → `2026-09-11`). Do not call `foldTheReviewerNameForMatching` or `readThisReviewDateAsUtcMidnight` inside the stamp so “one function owns ingest” unless the **interface** still proves today’s payload bytes.

6. **`source` is inside the fingerprint and again on the unique index.** Payload starts with `source`. Index is `{ source, content_fingerprint }`. A later second source would not collide with a BBB row even if the text matched, because the hex would move. Do not drop `source` from the payload so “the index already has it,” and do not drop `source` from the index so “the hex already has it.”

7. **Day key is ISO slice, not the raw `YYYY-MM-DD` string.** `parseReviewDate` returns UTC midnight, so the slice matches the input day. A caller who skipped parse can shift the day. Do not switch the key to `review_date.toLocaleDateString("en-US")` so “the owner’s calendar wins.”

8. **February 31 does not throw.** Regex is `\d{4}-\d{2}-\d{2}` only. `2026-02-31` becomes `2026-03-03T00:00:00.000Z`. `2026-09-31` becomes `2026-10-01`. Month `13` / `00` are `NaN` and throw. Do **not** “fix” overflow in this rename so “every calendar day is real” — lock the roll on the **interface** first, or leave it.

9. **Throw text echoes the raw string on a bad shape, the trimmed string on `NaN`.** `Invalid review date (expected YYYY-MM-DD): ${value}` uses the caller’s original. `Invalid review date: ${value}` after the `Date` constructor uses the same original `value` too — both messages echo `value`, not `trimmed`. A `"  2026-13-01  "` fails the regex (spaces) and echoes the padded string. Do not trim before the shape check so “spaces are forgiven.”

10. **Slash dates, ISO datetimes, and single-digit months throw.** `2026/09/10`, `2026-09-10T12:00:00Z`, and `2026-9-10` are not `YYYY-MM-DD`. Do not **ask** leftover `parseEasternDate` so “slash BBB exports work,” and do not **ask** leftover `parseFloridaCalendarDate` so “one midnight owns the company.”

11. **Fingerprint ignores stars, publish, reply, and Customer.** A later `rating` or `published` patch is the same review. Do not add those fields so “a featured flag is a new row.” Knowledge unique key is `(source, content_fingerprint)` only.

12. **`review_text.trim()` is the only text fold on the stamp.** Case stays. Leading/trailing spaces drop. The model `trim`s on persist. Do not lowercase the text so “Thank You matches thank you” without an **interface** proof that existing hexes still match.

13. **Three of four exports have no test.** Only the redaction gate is locked. Do not treat `testimonial.service.test.ts` (sibling list stubs) as this **interface**. Do not treat the missing ops script as proof the hex is stable.

14. **Knowledge names an ingest script this checkout does not have.** The Service says documents are loaded externally using this file. No `scripts/` import **asks** these four folds. Do not invent `upsertThisBbbReview` here so “the sentence becomes true,” and do not delete the folds so “no leftover caller means dead code.”

15. **Leave the sibling list alone.** Already-recommended `listTestimonials` hides `content_fingerprint` and `normalized_reviewer_name`. Owner `q` does not **ask** `foldTheReviewerNameForMatching`. Do not import this file into the list so “search always hits the folded field only.”

16. **Do not silently add write routes.** Knowledge: no create / update / delete HTTP. Do not invent `publishThisReview` / `ingestThisBbbReview` so “admin can load from the desk.”

## Testing

The **interface** is the test surface: `noticeThisBbbReviewHasRedactedPii`, `foldTheReviewerNameForMatching`, `readThisReviewDateAsUtcMidnight`, `stampTheContentFingerprintSoUpsertCanKeyOnSourcePlusFingerprint` (today `hasBbbRedaction`, `normalizeReviewerName`, `parseReviewDate`, `buildContentFingerprint`).

Today’s `testimonial.helpers.test.ts` only locks the redaction gate. That is not enough for the UTC-midnight story or the unique-key hex.

Replace the single helper test with tests that name the operation:

**Notice this BBB review has redacted PII**
- `"Thank you REMOVED"` is true. `"REMOVE and crew"` is true.
- `"Great service! REMOVEDdelivered right to our door"` is true (today’s glued fixture).
- `"The movers were excellent and they arrived on time."` is false.
- Do **not** require a trailing word boundary in this fixture. Do **not** add an English-`remove` assertion that would fail today’s pattern unless the product path changes the gate.

**Fold the reviewer name for matching**
- `"  Dana P  "` becomes `"dana p"`.
- Interior `"Dana  P"` stays `"dana  p"` (double space is not collapsed).
- Do **not** require leftover `composeTheLeadDisplayName` as this beat.

**Read this review date as UTC midnight**
- `"2026-09-10"` is `2026-09-10T00:00:00.000Z`.
- `"2026/09/10"`, `"2026-09-10T12:00:00Z"`, and `"2026-9-10"` throw `/expected YYYY-MM-DD/`.
- `"2026-13-01"` throws `/Invalid review date/`.
- `"2026-02-31"` is `2026-03-03T00:00:00.000Z` (overflow does **not** throw). Do not “fix” this so the assertion can expect a throw.
- Do **not** require leftover `parseEasternDate` or leftover `parseFloridaCalendarDate` as this beat.

**Stamp the content fingerprint so upsert can key on source plus fingerprint**
- Same `{ source: "BBB", normalized_reviewer_name: "dana p", review_date: 2026-09-10T00:00:00.000Z, review_text: "  Great crew.  " }` stamps the same 64 lowercase hex as SHA-256 of `BBB|dana p|2026-09-10|Great crew.`.
- Leading/trailing text spaces drop; `"Great crew."` and `"  Great crew.  "` match. `"great crew."` does **not**.
- A 4pm Eastern `Date` for 2026-09-10 slices to `2026-09-11`. Do not “fix” the key to the owner calendar.
- Changing `rating` / `published` is not an argument — those fields are not on the bag.
- Do **not** require leftover `sha256` / leftover `canonicalJson` as this beat.
- Do **not** require `listTestimonials` as this beat.

Do **not** add a test per helper (`refuseThisReviewDateWhenTheShapeIsNotYearMonthDay`, `takeTheUtcDayKeyFromTheInstant`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `listTestimonials` / omitted `published` / owner 404 here. Do not add an upsert Mongo fixture — that write is not this **interface**. Do not add Zod unknown-key tests in this file.

## What I would not do

- A `TestimonialHelpersService` class with `normalize` / `parse` / `hash` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `trim`, `toLowerCase`, or `createHash("sha256")`.
- Moving this into a CRUD folder, or into `testimonial.service.ts` “because one service owns testimonials.”
- Splitting `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `parse.ts`.
- Treating `listTestimonials`, leftover `parseEasternDate`, leftover `parseFloridaCalendarDate`, leftover `sha256`, leftover `canonicalJson`, or Customer wipe as this story.
- Inventing a Domain Command **seam** that has only this fold as an **adapter**.
- Inventing an upsert **adapter** so “helpers can write `(source, content_fingerprint)`.”
- Inventing a publish **adapter** so “fingerprint can force `published=true`.”
- Inventing a list **adapter** so “the Main Site can de-dupe on the card.”
- Adding a trailing `\b` onto the redaction gate so “English `remove` is safe” without an **interface** proof that `REMOVEDdelivered` stays true.
- Calling fold / parse inside the stamp so “one function owns ingest” without proving today’s hexes.
- Asking Eastern or Florida midnight so “one date owns the company.”
- Deleting the folds because this checkout has no ops import.
- Pulling already-recommended `testimonial.service.ts` into this file.
- Opening `movingCarriers` in this pass, or writing a whole-folder recommendation for `testimonials`.
