# Show The Main Site The Curated Reviews They Asked For, Show The Owner The Same Reviews With The Customer Attached, Open One Review Or Say It Is Missing, Then Hand The Owner The Sorted Reviewer-Name Catalog — Never Publish A Review, Never Fingerprint Ingest, Never Force `published=true` — operational story

- Status: recommended
- Service: `testimonials` (Wave A, in-progress)
- Pass: 1 of this service — `testimonial.service.ts`
- Remaining in this service: `testimonial.helpers.ts`
- Target: `src/services/testimonials/testimonial.service.ts`
- Knowledge: [`docs/knowledge/services/testimonial.md`](../../../docs/knowledge/services/testimonial.md) (read-only public and admin testimonials; ingest stays in helpers and ops scripts). Distinct from leftover Customer wipe: already-recommended [customers-customer.md](customers-customer.md) (Customer `testimonials` virtual is **not** cascaded). Distinct from Admin Dashboard desks: already-recommended [admin-browse.md](admin-browse.md) (`form-leads` / `call-leads` / `booked-leads` / `cancelled-leads` / `customers` / `agents` — **not** testimonials). Distinct from leftover last-200 lists on Form / Call / Customer. Sibling ingest fold / BBB redaction / fingerprint lives in `testimonial.helpers.ts` (next pass). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Main Site](../../../../CONTEXT.md); do not invent a Testimonial glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Testimonial Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`GET /api/v1/testimonials` → `listTestimonials`; `GET /api/v1/admin/testimonials` → `listAdminTestimonials`; `GET /api/v1/admin/testimonials/reviewer-names` → `listAdminTestimonialReviewerNames`; `GET /api/v1/admin/testimonials/:id` → `getAdminTestimonial`). Barrel: `testimonials/index.ts` (re-exports the four reads **and** the two filter builders). Tests: `testimonial.service.test.ts` (Zod coerce on both query schemas; `buildTestimonialFilter` / `buildAdminTestimonialFilter` as the tested surface; stubbed `listTestimonials` page; stubbed `listAdminTestimonials` populate + asc sort; stubbed reviewer-name distinct). `getAdminTestimonial` has **no** test. `v1.service.ts` does **not** re-export this file. `adminBrowse.service.ts` does **not** import this file. Sibling `testimonial.helpers.ts` is **not** imported here. Operator `scripts/api/starter.ts` hits `GET /api/v1/testimonials` over HTTP — not an import. The marketing-site client (`vantage-movers-clients`) is not in this checkout. Not this **interface**: `buildContentFingerprint`, `hasBbbRedaction`, `normalizeReviewerName`, `parseReviewDate`, `browseAdminResource`, `wipeThisCustomerAndTheirBookings`, leftover `findAllFormLeads`.
- Seams callers need: Main Site card vs owner card (customer + `source_company` + timestamps); omitted `published` is “include unpublished,” not “only live copy”; page (`items` + `total` + `has_next_page`) vs reviewer-name catalog (string array, no page). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no ingest-fingerprint **seam**. There is no Sheet Sync **seam**. There is no Owner-actor **seam** (routes sit behind `x-api-secret` only).
- Split later (only if the file outgrows one sitting): this ~230-line file is one sitting if you read it as show the Main Site the curated reviews they asked for — show the owner the same reviews with the customer attached — open one review or say it is missing — hand the owner the reviewer-name catalog. If it later splits by **story**: `showTheMainSiteTheCuratedReviews.ts` / `showTheOwnerTheSameReviewsWithTheCustomerAttached.ts` — never `list.ts` / `get.ts` / `create.ts` / `update.ts` / `delete.ts`. Ingest fingerprint stays the sibling. Admin lead desks stay `admin/`.

`listTestimonials` / `listAdminTestimonials` / `getAdminTestimonial` / `listAdminTestimonialReviewerNames` are executor mechanics. The owner question is: *The Main Site asked for curated reviews. Give them the page they filtered — do not silently hide unpublished rows unless they sent `published=true`. Hide the fingerprint, the folded reviewer name, the Customer, and the source company from that card. When I open the owner desk, show the same reviews with the Customer attached, let me search the reviewer, and let me flip newest/oldest. When I open one review and it is gone, say so. When I paint the reviewer filter, hand me the sorted names. This file does not publish a review. This file does not fingerprint ingest. This file does not force `published=true`.*

Who stamps `content_fingerprint`, who parses the BBB date, and who notices `REMOVED` already live in the sibling **module**. Who writes the document is an ops script, not a route. Do not pull those in.

## What this file actually does

Four “show the curated reviews” stories in one sitting, not “a testimonial CRUD service,” and not Fingerprint This BBB Review:

1. **Show the Main Site the curated reviews they asked for** — `listTestimonials`. Fold only the flags the site sent (`source`, `published`, `featured`). Omitted flags stay off the filter (`{}` when the site sent nothing). Sort is always `review_date` desc, then `createdAt` desc. Page and count in the same moment. Map onto the public card. **Not on that card:** `content_fingerprint`, `normalized_reviewer_name`, `source_company`, `customer`, timestamps. `published` / `featured` on the card are `=== true`. `business_response` needs both `responded_at` and `text` or it becomes `null`. This beat does **not** default `published: true`. This beat does **not** populate Customer. This beat does **not** write Mongo.

2. **Show the owner the same reviews with the Customer attached** — `listAdminTestimonials`. Reuse the Main Site flags, then fold owner filters (`q` escaped-regex on `reviewer_name` **or** `normalized_reviewer_name`, exact `reviewer_name`, `rating`, Customer ObjectId, `review_date` from / to). Populate `customer` (`full_name`, `phone_number`, `email`). Owner may flip `direction`; `sort` is `review_date` only, and `createdAt` rides the same direction. Extra card fields: `source_company`, `customer { id, full_name, phone_number, email }`, `createdAt`, `updatedAt`. An unpopulated ObjectId / string Customer yields empty name / phone / email. This beat does **not** expose `content_fingerprint`. This beat does **not** write Mongo.

3. **Open one review for the owner, or say it is missing** — `getAdminTestimonial`. Same populate and same owner card as the desk. Missing id → `V1ServiceError("Testimonial not found", 404)`. This beat does **not** 404 a Duplicate Lead (testimonials have no duplicate flag). This beat does **not** refuse a combined database scope (there is no scope).

4. **Hand the owner the sorted reviewer-name catalog** — `listAdminTestimonialReviewerNames`. `distinct("reviewer_name")` excluding null / empty. Trim. Drop blanks. `localeCompare` with `{ sensitivity: "base" }`. No page. No `q`. This is the filter dropdown, not the desk.

There is no fifth write or ingest operation. `buildTestimonialFilter` / `buildAdminTestimonialFilter` are fold beats inside stories 1–2. They are exported today only because the test file and the barrel treat them as the **interface** — that is a leak, not a second owner story.

## Organization

Keep one file. This is the screenplay for “show the Main Site the curated reviews they asked for, then show the owner the same reviews with the Customer attached.” Fingerprint / BBB redaction / date parse already live in sibling `testimonial.helpers.ts`. Customer wipe already lives in already-recommended `customer.service.ts`. Admin lead desks already live in already-recommended `adminBrowse.service.ts`. Zod already lives in Wave B `testimonials.validation.ts`. Do not pull those in. Do not invent a `TestimonialService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a write **adapter** so “list can publish.” Do not invent a Sheet Sync **adapter** so “a featured flag can project.” Do not invent an Owner-actor **seam** this route does not have. Do not invent a CRUD folder so “list / get / create each get a file.”

Do not move `buildContentFingerprint` into this file so “one service owns testimonials.” Do not teach `adminBrowse.service.ts` a `testimonials` resource so “one desk owns every collection.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listTestimonials` | `showTheMainSiteTheCuratedReviewsTheyAskedFor` | public GET; omitted `published` includes unpublished |
| `listAdminTestimonials` | `showTheOwnerTheSameReviewsWithTheCustomerAttached` | owner desk; populate + extra filters + extra card fields |
| `getAdminTestimonial` | `openOneReviewForTheOwner` | owner detail; 404 if missing |
| `listAdminTestimonialReviewerNames` | `handTheOwnerTheSortedReviewerNameCatalog` | owner filter dropdown; not a page |
| `TestimonialListItem` | `MainSiteReviewCard` | public card; no fingerprint / customer / source company |
| `AdminTestimonialItem` | `OwnerReviewCard` | public card plus customer + `source_company` + timestamps |
| `ListTestimonialsResult` | `MainSiteReviewPage` | `items` + `page` + `limit` + `total` + `has_next_page` |
| `AdminTestimonialsResult` | `OwnerReviewPage` | same page shape, owner cards |
| `buildTestimonialFilter` | leftover public-filter leak | tests + barrel only — unexport after the test migrates |
| `buildAdminTestimonialFilter` | leftover owner-filter leak | tests + barrel only — unexport after the test migrates |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `testimonials/index.ts`, and `testimonial.service.test.ts` migrate. Do not make callers learn `$or` / `populate` / `localeCompare` as the domain language. Do **not** keep the filter builders as a public **seam** after the test moves onto the four reads. Do **not** put `listTestimonials` onto leftover `v1.service.ts` so “every public list lives on the barrel.” Do **not** rename `published` / `featured` / `review_date`. Do **not** add `content_fingerprint` onto the Main Site card so “the site can de-dupe.”

**No workflow class.** The one type that *does* earn a name is the public card the Main Site already paints:

```ts
type MainSiteReviewCard = {
  id: string
  source: string
  reviewer_name: string
  review_date: Date
  rating: number
  review_text: string
  business_response: { responded_at: Date; text: string } | null
  published: boolean
  featured: boolean
}

type OwnerReviewCard = MainSiteReviewCard & {
  source_company: string
  customer: {
    id: string
    full_name: string
    phone_number: string
    email: string
  } | null
  createdAt: Date | null
  updatedAt: Date | null
}
```

That is the handoff from “we folded only the flags they sent” to “the Main Site can paint a review without the fingerprint or the Customer.” Do **not** add `content_fingerprint` onto `OwnerReviewCard` so “admin can see the upsert key.” Do **not** add a session or a Booking id onto `listTestimonials` so “the list writes Mongo.”

Leave fingerprint / BBB redaction / `YYYY-MM-DD` parse on sibling `testimonial.helpers.ts`. Leave Customer wipe on already-recommended `customer.service.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// testimonial.service.ts
// The Main Site asked for curated reviews.
// Give them the page they filtered.
// Do not hide unpublished rows unless they sent published=true.
// Hide the fingerprint, the folded name, the Customer,
// and the source company from that card.
// When the owner opens the desk, attach the Customer.
// When they open one review and it is gone, say so.
// When they paint the reviewer filter, hand the sorted names.
// Do not publish a review.
// Do not fingerprint ingest.

// ── 1. Show the Main Site the curated reviews they asked for ──

export async function showTheMainSiteTheCuratedReviewsTheyAskedFor(query)

function foldOnlyTheFlagsTheSiteSent(query)          // source / published / featured; omit = off
async function pullTheNewestReviewPage(filter, skip, limit)  // review_date desc, createdAt desc
async function countEveryMatchingReview(filter)
function paintTheMainSiteReviewCard(doc)             // hide fingerprint / customer / source_company
function keepBusinessResponseOnlyWhenBothPartsExist(value)
function skipPlusPageLengthMeansThereIsAnotherPage(skip, docs, total)

// ── 2. Show the owner the same reviews with the Customer attached ──

export async function showTheOwnerTheSameReviewsWithTheCustomerAttached(query)

function foldTheOwnerReviewFilters(query)            // public flags + q / reviewer / rating / customer / dates
function escapeTheReviewerSearch(q)                  // regex-escape; $or display + normalized
function attachTheCustomerContact(filter, direction)
function paintTheOwnerReviewCard(doc)                // public card + source_company + customer + timestamps
function paintTheCustomerOrEmptyContact(value)       // populate miss → id + empty strings

// ── 3. Open one review for the owner ──────────────────────

export async function openOneReviewForTheOwner(id)
  // populate; 404 "Testimonial not found"

// ── 4. Hand the owner the sorted reviewer-name catalog ────

export async function handTheOwnerTheSortedReviewerNameCatalog()

function takeDistinctReviewerNamesExcludingNullAndEmpty()
function trimAndDropBlankNames(names)
function sortReviewerNamesWithoutCase(names)         // localeCompare sensitivity: "base"
```

Read the Main Site path out loud: *Fold only the flags the site sent. If they omitted published, unpublished rows stay in. Pull the newest page by review date, then created-at. Count every match, not the page length. Paint a card that hides the fingerprint, the folded reviewer name, the Customer, and the source company. A business response without both a time and a text is null. Published and featured on the card are true only when the document says true.*

That is the operation. `listTestimonials` is not a different story. `buildTestimonialFilter` is not the **interface**.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two page implementations copy find + count + `has_next_page`.** Main Site and owner desks share skip / limit / `skip + docs.length < total`. One story, two **adapters** (public card vs owner card). Shared beats: fold, page, count, next-page. Only the filter extras, populate, sort direction, and card fields differ. Do not split them into `list.ts` / `adminList.ts` so “each route owns a file.”

2. **Omitted `published` includes unpublished.** `foldOnlyTheFlagsTheSiteSent` starts as `{}`. Knowledge already says the marketing site must send `published=true` if it wants only live copy. Do **not** default `{ published: true }` so “the Main Site cannot leak drafts.” That change is a product path, not this rename.

3. **The public card hides identity keys on purpose.** `content_fingerprint`, `normalized_reviewer_name`, `source_company`, `customer`, and timestamps are stored and admin-visible. They are not on `MainSiteReviewCard`. Do not add them “so the site can de-dupe” or “so the card matches admin.”

4. **`published` / `featured` on the card are `=== true`.** Missing / false / `"true"` become `false`. Do not treat truthy Mongo values as published so “legacy strings still show.”

5. **`business_response` is both parts or null.** A document with only `text` (or only `responded_at`) paints `null`. Do not keep a partial object so “the site can show a reply without a date.”

6. **Filter builders are a test leak.** `buildTestimonialFilter` / `buildAdminTestimonialFilter` are exported and are the first tests in `testimonial.service.test.ts`. Runtime callers are the two list functions. Unexport them after the test names the four reads. Do not add a third HTTP route that accepts a raw Mongo filter.

7. **Owner `q` and exact `reviewer_name` can both be set.** `q` adds `$or` on display + normalized. Exact `reviewer_name` then overwrites `filter.reviewer_name` (it does **not** overwrite `$or`). A search for `"Dana"` plus exact `"Dana P"` ANDs them. Do not collapse `q` into exact, and do not drop `$or` when exact is present so “one reviewer field owns search.”

8. **Owner `q` is regex-escaped.** `escapeTheReviewerSearch` treats the typed string as literal. `Dana P` does not become “Dana” then any character then “P”. Do not switch to unescaped “so spaces feel fuzzy,” and do not import sibling `normalizeReviewerName` onto `q` so “search always hits the folded field only.”

9. **Unpopulated Customer paints empty contact, not 404.** ObjectId or string → `{ id, full_name: "", phone_number: "", email: "" }`. Missing / null → `null`. Do not 404 the row because populate missed, and do not drop the id so “empty means no Customer.”

10. **`openOneReviewForTheOwner` is untested.** The list stubs never call `findById`. Lock 404 `"Testimonial not found"` and the same owner card (including empty-contact populate miss) on this **interface**. Do not treat the list populate stub as detail proof.

11. **Reviewer-name catalog trims after distinct.** Distinct already excludes null / `""`. A `"  Dana P  "` still comes back, then trim, then drop if blank, then case-insensitive sort. Do not `distinct` on `normalized_reviewer_name` so “the dropdown matches `q`,” and do not page this catalog.

12. **`has_next_page` is skip plus this page’s length, not `page * limit`.** A short last page still works when `total` is larger than `skip + docs.length`. Do not switch to `page * limit < total` so “empty pages still claim a next page.”

13. **Owner sort flips `createdAt` with `review_date`.** `direction === "asc"` is `{ review_date: 1, createdAt: 1 }`. Public list cannot flip. Zod only allows `sort=review_date`. Do not add `createdAt` as a public sort key so “the site can match admin.”

14. **Leave the sibling ingest fold alone.** `normalizeReviewerName`, `parseReviewDate`, `buildContentFingerprint`, `hasBbbRedaction` are not imported here. Knowledge says ingest is normalize → parse → fingerprint → upsert on `(source, content_fingerprint)`. This file never upserts. Wave A will recommend `testimonial.helpers.ts` next. Do not write a whole-folder testimonials recommendation.

15. **Do not treat Customer wipe or Admin Dashboard desks as this story.** Already-recommended wipe does not touch testimonials. `browseAdminResource` has no `testimonials` resource. `GET /api/v1/admin/testimonials` is this file, not `GET /api/v1/admin/{resource}`. Do not teach this file `database_scope`.

16. **Do not silently add write routes.** Knowledge: no create / update / delete HTTP. Documents arrive from helpers + ops scripts. Do not invent `publishThisReview` / `featureThisReview` so “admin can toggle from the desk.”

## Testing

The **interface** is the test surface: `showTheMainSiteTheCuratedReviewsTheyAskedFor`, `showTheOwnerTheSameReviewsWithTheCustomerAttached`, `openOneReviewForTheOwner`, `handTheOwnerTheSortedReviewerNameCatalog`. The public card, the owner card, and `has_next_page` are part of that **interface**.

Today’s `testimonial.service.test.ts` stubs `find` / `countDocuments` / `distinct` and treats the two filter builders as the first assertions. Zod coerce tests lock query-string `"true"` / `"2"` / `"BBB"`. That is not enough for the omitted-`published` story or the missing-review 404.

Replace the filter-builder tests with tests that name the operation:

**Show the Main Site the curated reviews they asked for**
- Empty query → `find({})`, `sort({ review_date: -1, createdAt: -1 })`, `countDocuments({})`. Unpublished rows are **in**.
- `published: true` is the only way unpublished rows leave. Do not “fix” the empty query so the assertion can expect `{ published: true }`.
- `featured: false` is `{ featured: false }`, not “omit the flag.”
- Public card has no `content_fingerprint`, no `normalized_reviewer_name`, no `source_company`, no `customer`, no timestamps.
- `published` / `featured` on the card are `false` when the document stores `false` or omits the field.
- `business_response` with only `text` (or only `responded_at`) paints `null`.
- `has_next_page` is true when `skip + docs.length < total` (page 2, limit 5, one doc, total 16 — today’s stub).
- Sort cannot flip. Do not pass `direction` on this export.

**Show the owner the same reviews with the Customer attached**
- Populate `{ path: "customer", select: "full_name phone_number email" }`.
- `direction: "asc"` → `{ review_date: 1, createdAt: 1 }`.
- `q: "Dana P"` adds escaped `$or` on `reviewer_name` and `normalized_reviewer_name`.
- `q` plus exact `reviewer_name` keeps both `$or` and exact `reviewer_name`.
- Owner card includes `source_company`, populated customer id / name / phone / email, timestamps.
- Unpopulated ObjectId customer → `{ id, full_name: "", phone_number: "", email: "" }`.
- Card still hides `content_fingerprint`.

**Open one review for the owner**
- Missing id → 404 `"Testimonial not found"`.
- Found row uses the same owner card + populate as the desk.
- Do not 404 because `published` is false.

**Hand the owner the sorted reviewer-name catalog**
- Distinct field is `reviewer_name` with `{ $nin: [null, ""] }`.
- `"  Dana P  "` becomes `"Dana P"`. `""` after trim is dropped.
- Sort is `Anne A`, `Dana P`, `Robert C` (base sensitivity). No page keys.

Do **not** add a test per helper (`foldOnlyTheFlagsTheSiteSent`, `escapeTheReviewerSearch`, `keepBusinessResponseOnlyWhenBothPartsExist`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `hasBbbRedaction` / fingerprint / `YYYY-MM-DD` parse here. Do not add Zod unknown-key tests in the service file — that gap lives on the schema. Do not re-test `browseAdminResource` or Customer wipe.

## What I would not do

- A `TestimonialService` class with `list` / `get` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Testimonial.find` or `countDocuments`.
- Moving this into a CRUD folder, or into `admin/` “because the owner desk lists things.”
- Defaulting `{ published: true }` so the Main Site “cannot leak drafts.”
- Putting `content_fingerprint` or `customer` on the public card so it “matches admin.”
- Teaching `adminBrowse.service.ts` a `testimonials` resource, or teaching this file `database_scope`.
- Inventing a before-commit / after-commit **seam**, a publish write, or a Sheet Sync job this read path does not have.
- Pulling `testimonial.helpers.ts` (fingerprint / BBB redaction / date parse) into this file.
- Cascading testimonials from Customer wipe, or attaching a Customer from this list.
- Writing a whole-folder recommendation for `testimonials` while `testimonial.helpers.ts` is still unchecked.
