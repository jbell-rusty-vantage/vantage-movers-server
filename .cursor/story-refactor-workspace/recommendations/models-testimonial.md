# Remember The Curated Review Row On The Default Mongo Connection, Unique-Index One Review Per Source Plus Content Fingerprint, And Index Published Browse Plus Folded Reviewer Plus Customer Without Uniqueness — Never List The Main Site Reviews Here, Never Stamp The Fingerprint, Never Upsert, Never Invent A Selected-Database Getter, Never Copy Booking AutoIndex-False Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 17 of this service — `Testimonial.ts`
- Remaining in this service: `schemaHelpers.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/Testimonial.ts`
- Knowledge: [`docs/knowledge/services/testimonial.md`](../../../docs/knowledge/services/testimonial.md) (System of Record is Mongo `testimonials` — curated review content for the public marketing site (**Main Site**) and Owner/admin browse. **Read-only** list and admin detail. **No create/update/delete routes.** Documents are loaded externally using `testimonial.helpers.ts`. Unique is `{ source, content_fingerprint }`. List index is `{ source, published, review_date }`. Public DTO hides fingerprint / folded reviewer / `source_company` / Customer / timestamps. Omitted `published` includes unpublished rows). Already-recommended Main Site / owner reads: [testimonials-testimonial.md](testimonials-testimonial.md) (`listTestimonials` / `listAdminTestimonials` / `getAdminTestimonial` / `listAdminTestimonialReviewerNames` **ask** default `Testimonial` — **this file never lists**, never paints a card, never 404s). Already-recommended ingest folds: [testimonials-testimonial-helpers.md](testimonials-testimonial-helpers.md) (`normalizeReviewerName` / `parseReviewDate` / `buildContentFingerprint` / `hasBbbRedaction` — **this file never hashes**, never folds the reviewer, never upserts). Already-recommended Customer row: [models-customer.md](models-customer.md) (inverse `testimonials` virtual — **this file holds the forward ObjectId**; Customer wipe does **not** cascade Testimonials). Already-recommended Customer wipe: [customers-customer.md](customers-customer.md). Distinct from leftover prior login: already-recommended [models-extension-user.md](models-extension-user.md) (unique folded email — **do not copy that unique here**). Distinct from leftover next field catalog: next `schemaHelpers.ts` (`sourceCompanyField` is required, default `"not_provided"`, indexed — **this file’s optional `source_company` is not that helper**). Distinct from leftover Admin Dashboard desks: already-recommended [admin-browse.md](admin-browse.md) (`form-leads` / `call-leads` / `booked-leads` / `cancelled-leads` / `customers` / `agents` — **not** testimonials). Distinct from historical relax: this checkout has **no** `historical/Testimonial.ts` — leftover historical-consolidation **does not** `validateSync` this collection. Distinct from leftover overview / leftover health / leftover Registry: those files **do not** count `testimonials`. Knowledge names ops/script ingest; **no ops ingest script in this checkout imports the four folds**. Operator `scripts/api/starter.ts` hits `GET /api/v1/testimonials` over HTTP — not this model. The marketing-site client (`vantage-movers-clients`) is not in this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Main Site](../../../../CONTEXT.md); this checkout does **not** define Testimonial — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites Mongo as System of Record; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no `getTestimonialModel`.** Already-recommended `testimonials/testimonial.service.ts` **asks** default `Testimonial` for public `find` + `countDocuments` (no populate), owner `find` + `countDocuments` with `.populate("customer", "full_name phone_number email")`, owner `findById` with the same populate, and `distinct("reviewer_name")` excluding null / empty. Already-recommended `testimonial.service.test.ts` stubs `Testimonial.find` / `countDocuments` / `distinct`. Already-recommended Customer schema leftover-registers inverse virtual `testimonials` by string `ref: "Testimonial"` — it does **not** import this file. Already-recommended helpers **do not** import this file. Wave B `v1.routes.ts` leftover-asks the four reads, not this model. Wave B `testimonials.validation.ts` leftover-imports leftover `TESTIMONIAL_SOURCES` from `config/domain`, **not** from this file. There is no `Testimonial.test.ts`. Nobody leftover-inspects leftover `Testimonial.schema.indexes()`. Leftover overview / leftover health / leftover historical-consolidation / leftover Registry / leftover `adminBrowse.service.ts` / leftover `v1.service.ts` **do not** import this file. Not this **interface**: `listTestimonials` itself, `listAdminTestimonials` itself, `getAdminTestimonial` itself, `listAdminTestimonialReviewerNames` itself, leftover `buildContentFingerprint` / leftover `normalizeReviewerName` itself, leftover `wipeThisCustomerAndTheirBookings` itself.
- Seams callers need: default `Testimonial` (first-registered connection — Main Site find / owner populate find / owner detail / reviewer-name distinct) vs already-recommended Extension User / Merchant / Moving Carrier same default-export pattern vs already-recommended evidence `getCplLeadCorrectionModel` (**no default export**) vs Form selected-database getter; unique `{ source, content_fingerprint }` vs leftover helper SHA-256 of `source|folded name|YYYY-MM-DD|trimmed text`; schema `lowercase` + `trim` on `normalized_reviewer_name` **when that path is set** vs leftover `normalizeReviewerName` that also does not collapse whitespace; field-level browse indexes (`source`, `published`, `review_date`, `normalized_reviewer_name`, `customer`) vs named-in-knowledge unique pair and list compound; `featured` filterable **and not indexed**; `published` default `true` vs leftover list omitting `published` (includes unpublished); optional `source_company` (trim, **not** leftover `sourceCompanyField`) vs required Lead `source_company`; forward `customer` ObjectId vs already-recommended Customer inverse virtual; `TESTIMONIAL_SOURCES` enum currently `BBB` only vs Zod leftover-import from `config/domain`; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no list **seam**. There is no fingerprint **seam**. There is no upsert **seam**. There is no selected-database getter **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~70-line file is one sitting if you read it as remember the curated review row on the default Mongo connection, unique-index one review per source plus content fingerprint, and index published browse plus folded reviewer plus customer without uniqueness — never list the Main Site reviews here, never stamp the fingerprint, never upsert, never invent a selected-database getter, never copy Booking autoIndex-false without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `fingerprint.ts` / `publish.ts`. Main Site / owner reads stay `testimonial.service.ts`. Fingerprint / name fold / date parse stay `testimonial.helpers.ts`. Upsert stays the missing ops script. Next field catalog stays `schemaHelpers.ts`.

`Testimonial` is a Mongoose model name. The owner question is: *Ops just loaded this BBB review — or the Main Site is about to ask for curated copy. Hold the row on `testimonials`. Keep source plus content fingerprint unique so a second identical review 11000s. Index published plus review date so the Main Site can page newest first. Index the folded reviewer so owner `q` can hit it without uniqueness. Keep the optional Customer pointer so owner populate can attach a name. Today’s live callers still use the default connection — do not invent a getter in this rename. Do not list the reviews. Do not stamp the fingerprint. Do not fold the reviewer on validate. Do not upsert. Do not force `published=true` on find. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who show the Main Site / owner already lives in already-recommended `testimonial.service.ts`. Who notice BBB redaction / fold the reviewer / read UTC midnight / stamp the fingerprint already lives in already-recommended `testimonial.helpers.ts`. Who write the document is an ops script that is **absent** in this checkout. Do not pull those in.

## What this file actually does

Three operations of one “remember the curated review row, unique-index one review per source plus content fingerprint, and index published browse plus folded reviewer plus customer without uniqueness” story, not “a Testimonial model CRUD dump,” and not Show The Main Site The Curated Reviews / Stamp The Content Fingerprint themselves:

1. **Hold the Testimonial as the curated review row** — collection `testimonials`, timestamps, `toJSON` / `toObject` virtuals **with no virtuals declared**. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** inverse Customer virtual (that lives on already-recommended `Customer.ts`). Declares required `source` (enum leftover `TESTIMONIAL_SOURCES`, default `"BBB"`, field-indexed), optional `source_company` (trim — **not** leftover `sourceCompanyField`), required `reviewer_name` (trim), required `normalized_reviewer_name` (trim, schema `lowercase`, field-indexed), required `review_date` (Date, field-indexed), required `rating` (`min: 1`, `max: 5`), required `review_text` (trim), optional `business_response` (`{ responded_at, text }` subdoc, `_id: false`, default `null`), optional `customer` (ObjectId `ref: "Customer"`, field-indexed, default `null`), required `content_fingerprint` (trim), required `published` (default `true`, field-indexed), required `featured` (default `false`, **not** indexed). This beat does **not** invent `normalized_reviewer_name` from `reviewer_name`. This beat does **not** hash `content_fingerprint`. This beat does **not** parse `YYYY-MM-DD`. This beat does **not** refuse leftover `REMOVED`. A Main Site find may still include unpublished rows when the query omitted `published`.

2. **Keep one review per source plus content fingerprint — and index published browse, folded reviewer, and customer without uniqueness** — unique `{ source: 1, content_fingerprint: 1 }`. Non-unique list `{ source: 1, published: 1, review_date: -1 }`. Field-level browse indexes on `source`, `published`, `review_date`, `normalized_reviewer_name`, and `customer`. Neither compound is named. There is no unique `{ normalized_reviewer_name }`. There is no unique `{ reviewer_name }`. There is no `{ featured: 1 }`. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Knowledge names the unique pair and the list compound. Knowledge does **not** name the five field-level indexes. This beat does **not** unique-index folded reviewer. This beat does **not** list unpublished-only. This beat does **not** find a Customer from this file.

3. **Bind the default Mongo connection** — default export `Testimonial` is `mongoose.models.Testimonial ?? mongoose.model(...)`. There is **no** `getTestimonialModel`. There is **no** `getMongoDatabaseName()`. There is **no** `useDb`. Main Site find / owner populate find / owner detail / reviewer-name distinct **ask** the default export. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`. This beat does **not** invent `getTestimonialModel` so “review matches Form.” This beat does **not** delete the default export so “review matches evidence.” This beat does **not** re-export leftover `TESTIMONIAL_SOURCES` — Zod leftover-imports that tuple from `config/domain`.

`TestimonialDocument` is the inferred row type. There is no status enum export. There is no named-index export. Local `BusinessResponseSchema` is a fold inside story 1.

There is no show-the-Main-Site-the-curated-reviews operation. `listTestimonials` elects that. There is no stamp-the-content-fingerprint operation. `buildContentFingerprint` elects that. There is no upsert-this-BBB-review operation. That script is absent here.

## Organization

Keep one file. This is the screenplay for “remember the curated review row on the default Mongo connection, unique-index one review per source plus content fingerprint, and index published browse plus folded reviewer plus customer without uniqueness — never list the Main Site reviews here, never stamp the fingerprint, never upsert, never invent a selected-database getter, never copy Booking autoIndex-false without a migration.” Main Site / owner reads / fingerprint / name fold / Customer wipe already live in deeper **modules**. Do not pull those in. Do not invent a `TestimonialModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getTestimonialModel` **adapter** so “review matches Form” without a paired proof that Main Site find, owner populate find, owner detail, and reviewer-name distinct still read the same `testimonials`. Do not invent an `autoIndex: false` **adapter** so “review matches Booking” without a reviewed index migration. Do not invent a unique `{ normalized_reviewer_name: 1 }` **adapter** so “one reviewer owns every review.” Do not invent a `pre("validate")` that stamps folded name or fingerprint so “hand insert matches helpers.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `fingerprint.ts` / `publish.ts` each get a file.

Do not move leftover `buildContentFingerprint` into this file so “the row owns the hash.” Do not move leftover `listTestimonials` into this file so “the row paints the card.” Do not merge this file into already-recommended `Customer.ts` so “one schema owns people and reviews.” Do not merge this file into next `schemaHelpers.ts` so “one field catalog owns Lead `source_company` and review `source_company`.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `Testimonial` | `testimonialOnTheDefaultConnection` | Main Site find, owner populate find, owner detail, and reviewer-name distinct still import the default model |
| `TestimonialDocument` | `TestimonialRow` | inferred document + `_id` |

Keep the old names as one-line aliases until `testimonial.service.ts` and `testimonial.service.test.ts` migrate. Do not make callers learn `content_fingerprint` / `normalized_reviewer_name` as the domain language. Do **not** add `getTestimonialModel` so “every aggregate has a getter” — live reads already share one default **adapter**. Do **not** delete the default `Testimonial` export so “everyone must call a getter that does not exist.” Do **not** re-export leftover `TESTIMONIAL_SOURCES` so “Zod should import the model” — Wave B `validation/` is still locked and already leftover-imports `config/domain`. Do **not** export a named unique-fingerprint catalog that this schema does not name.

**No class for the workflow.** The one type that *does* earn a name is the pending review-identity contract:

```ts
type TestimonialReviewIdentity = {
  source: "BBB"
  content_fingerprint: { unique_with_source: true }
  normalized_reviewer_name: { unique: false; indexed: true }
  published: { default: true; unique: false; indexed: true }
  featured: { default: false; indexed: false }
  customer: { unique: false; indexed: true; optional: true }
}
```

That is the handoff from “this process remembered a curated review” to “a second identical source-plus-fingerprint 11000s, owner `q` can hit the folded reviewer without uniqueness, and `featured` stays a filter flag without an index.” Do **not** add `{ normalized_reviewer_name: { unique: true } }` so “one reviewer owns every review.” Do **not** add `{ featured: { indexed: true } }` so “featured matches published.” Do **not** add `{ published: { default: false } }` so “unpublished is the insert default.”

Leave already-recommended `ExtensionUser.ts` on that file. Leave next `schemaHelpers.ts` on that file. Leave Main Site / owner reads on `testimonial.service.ts`. Leave fingerprint on `testimonial.helpers.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// Testimonial.ts
// Ops just loaded this BBB review —
// or the Main Site is about to ask for curated copy.
// Hold the row on testimonials.
// Keep source plus content fingerprint unique
// so a second identical review 11000s.
// Index published plus review date so the Main Site
// can page newest first.
// Index the folded reviewer so owner q can hit it
// without uniqueness.
// Keep the optional Customer pointer
// so owner populate can attach a name.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not list the reviews.
// Do not stamp the fingerprint.
// Do not fold the reviewer on validate.
// Do not upsert.
// Do not force published=true on find.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const testimonialOnTheDefaultConnection =
  mongoose.models.Testimonial ?? mongoose.model("Testimonial", testimonialSchema)

export { testimonialOnTheDefaultConnection as Testimonial }

// ── 1. Hold the Testimonial as the curated review row ─

const testimonialSchema = rememberTheCuratedReviewRow() // collection testimonials; default autoIndex; no virtuals declared

function rememberTheCuratedReviewRow() {
  const schema = new Schema(
    {
      source: requiredBbbSourceDefaultIndexed(),      // enum TESTIMONIAL_SOURCES; default "BBB"
      source_company: optionalTrimmedSourceCompany(), // not leftover sourceCompanyField
      reviewer_name: requiredTrimmedDisplayName(),
      normalized_reviewer_name: requiredFoldedReviewer(), // lowercase + trim when set; not invented from reviewer_name
      review_date: requiredReviewDateIndexed(),
      rating: requiredStarOneToFive(),
      review_text: requiredTrimmedText(),
      business_response: optionalBusinessResponse(),  // { responded_at, text } or null; _id false
      customer: optionalCustomerPointerIndexed(),     // ObjectId ref Customer; default null
      content_fingerprint: requiredTrimmedFingerprint(), // hash lives on leftover buildContentFingerprint
      published: requiredPublishedDefaultTrueIndexed(),
      featured: requiredFeaturedDefaultFalseNotIndexed(),
    },
    { collection: "testimonials", timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
  )
  keepOneReviewPerSourcePlusFingerprintAndIndexBrowseWithoutUniqueness(schema)
  return schema
}

function optionalBusinessResponse() {
  // today's BusinessResponseSchema — required responded_at + text when present
}

// ── 2. One review per source plus fingerprint ─────────────

function keepOneReviewPerSourcePlusFingerprintAndIndexBrowseWithoutUniqueness(schema) {
  // today's unique { source, content_fingerprint }
  // today's list { source, published, review_date: -1 }
  // today's field-level source / published / review_date / normalized_reviewer_name / customer
  // featured is not indexed
  // none named
}

// ── 3. Default Mongo connection ───────────────────────────

// testimonialOnTheDefaultConnection above
```

Read the primary path out loud: *hold the Testimonial on `testimonials` with a required BBB source, a required display reviewer, a required folded reviewer, a required review date, stars 1–5, required text, a required content fingerprint, `published` default true, and `featured` default false. Do not invent the folded name or the fingerprint on validate. Keep source plus fingerprint unique so a second identical review 11000s. Index published plus review date so the Main Site can page newest first. Index the folded reviewer and the optional Customer without uniqueness. If this process already sits on the first-registered connection, that is the model Main Site find and owner populate already import. Do not list the reviews here. Do not stamp the fingerprint. Do not upsert. Do not invent a getter.*

That is the operation. An unnamed schema dump is not. `listTestimonials` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The unique is source plus content fingerprint. Helpers stamp the hash. This file never hashes.** Leftover `buildContentFingerprint` SHA-256s `source|folded name|YYYY-MM-DD|trimmed text`. Schema `trim`s `content_fingerprint` when a caller set it. A hand insert of a raw sentence would store that sentence and still unique-index it. Do not add `pre("validate")` `stampTheFingerprintFromHelpers` so “hand insert matches ingest” — a silent stamp would change who a later upsert 11000s, and leftover fingerprint does **not** fold the name or parse the date itself. Do not drop uniqueness on the pair so “the missing ops script is enough.” Do not unique-index `content_fingerprint` alone so “one hash owns every source.”

2. **There is no validate hook that stamps folded reviewer — and that is today’s contract.** Leftover `normalizeReviewerName` is `trim().toLowerCase()` and does not collapse whitespace. Schema `lowercase` / `trim` only fold the path when a caller set it. A hand insert that omits `normalized_reviewer_name` fails required, not a silent stamp. Do not add `pre("validate")` `stampTheFoldedReviewerFromDisplay` so “hand insert matches helpers.” Do not unique-index `normalized_reviewer_name` so “one reviewer owns every review” — owner `q` leftover-regexes display **or** folded name, and two BBB reviews from the same person on different days are allowed.

3. **`published` defaults `true` on insert. Public list omitting `published` includes unpublished rows.** Knowledge says the website must send `published=true` if it wants only live copy. This schema’s default does **not** hide unpublished rows from a `{}` find. Do not add `{ published: true }` onto leftover `buildTestimonialFilter({})` from this rename so “the site only sees live copy.” That filter lives on already-recommended `testimonial.service.ts`. Do not flip the schema default to `false` so “unpublished is the insert default.”

4. **Knowledge names two compounds. This schema also field-indexes five paths. `featured` is filterable and not indexed.** Field-level `source` / `published` / `review_date` overlap the list compound that already starts with `source` then `published`. Owner and public leftover-filters may send `featured`. There is no `{ featured: 1 }`. Do not drop the field-level indexes so “knowledge names only two compounds” without a paired explain that leftover `find({ published: true })` and leftover `find({ customer })` still use an index. Do not add `{ featured: 1 }` from this rename so “featured matches published.” Do not unique-index `{ source, published, review_date }` so “one newest published BBB row owns the day.”

5. **There is no selected-database getter — and that is today’s contract, not a missing Form copy and not a missing evidence copy.** Main Site find, owner populate find, owner detail, and reviewer-name distinct **ask** default `Testimonial`. Already-recommended evidence **asks** `getCplLeadCorrectionModel` with **no** default export. Already-recommended Extension User / Merchant / Moving Carrier **ask** the default export and have no getter. Do not invent `getTestimonialModel` so “review matches Form.” Do not delete the default `Testimonial` export so “review matches evidence.”

6. **`source_company` is optional trim, not leftover Lead `sourceCompanyField`.** Next `schemaHelpers.ts` leftover-exports required `source_company` default `"not_provided"` with a field index. This path is optional, not indexed, and admin-only on the owner card. Do not copy leftover `sourceCompanyField` here so “every source_company matches Lead.” Do not require `source_company` so “admin always has a company.” Do not index it so “admin `source_company` matches `customer`.”

7. **Forward Customer pointer vs inverse virtual vs wipe.** This file leftover-indexes optional `customer`. Already-recommended Customer leftover-registers inverse `testimonials`. Owner list leftover-populates the **forward** pointer. Customer wipe leftover-does **not** cascade Testimonials. Leftover historical Customer drops the inverse virtual. Do not cascade Testimonials from leftover wipe in this rename. Do not add an inverse virtual onto this file so “review matches Customer.” Do not invent `historical/Testimonial.ts` so “every review has a historical relax.”

8. **`toJSON` / `toObject` enable virtuals but this file declares none.** Already-recommended Customer declares the inverse `testimonials` virtual. Do not invent a `customer_row` virtual so “Testimonial matches Customer.” Do not drop `virtuals: true` so “options match unused virtuals” without a paired `toObject({ virtuals: true })` proof on leftover owner populate.

9. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. These indexes are not named. Do not silently set `autoIndex: false` so “review matches Booking” without a paired report that boot still creates the unique source-plus-fingerprint **or** that a migration will. Do not invent `pnpm migration:testimonial-indexes` in this rename.

10. **Overview does not count this collection — historical-consolidation does not validate it.** Already-recommended Merchant is the opposite (overview counts / historical validates). Do not add overview counts so “review matches Merchant.” Do not teach leftover Registry catalog or leftover `adminBrowse` this collection so “one desk owns payees and reviews.” Do not put leftover `TESTIMONIAL_SOURCES` onto this file so “Zod should import the model.”

11. **Knowledge says ops upserts with the four folds. That script is absent here.** Already parked on leftover `testimonials-testimonial-helpers.md`. Do not invent an upsert write on this file so “the Service sentence has a home.” Do not import leftover helpers from this file so “the row stamps its own key.”

12. **Leave sibling modules alone.** Main Site / owner reads, fingerprint / name fold / date parse, already-recommended Customer inverse virtual, leftover next `schemaHelpers.ts`, and already-recommended Form / Call / Booking are already the right **depth**. This file holds the curated review row. `listTestimonials` / `buildContentFingerprint` / `wipeThisCustomerAndTheirBookings` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `Testimonial` validate, the unique source-plus-fingerprint index, the non-unique list / folded-reviewer / customer indexes.

There is no `Testimonial.test.ts`. Today’s proofs sit on callers. `testimonial.service.test.ts` already names omitted-`published` `{}` find, owner populate + sort, and reviewer-name distinct through stubs. `testimonial.helpers.test.ts` already names leftover `REMOVED` / `REMOVE` and does **not** hit this model. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Testimonial requires `source`, `reviewer_name`, `normalized_reviewer_name`, `review_date`, `rating`, `review_text`, and `content_fingerprint`.
- Validate folds `" Dana P "` to `"dana p"` on `normalized_reviewer_name` and does **not** invent that path from `reviewer_name`.
- Validate does **not** hash `content_fingerprint` from text.
- `source` defaults to `"BBB"` and refuses a string outside leftover `TESTIMONIAL_SOURCES`.
- `rating` refuses `0` and `6`.
- `published` defaults to `true`.
- `featured` defaults to `false`.
- `customer` defaults to `null`.
- `business_response` defaults to `null`.
- `source_company` is optional and is **not** leftover `sourceCompanyField`.
- There is no Customer / Lead virtual on this schema.
- There is no `getTestimonialModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.
- `toJSON` / `toObject` virtuals stay true.

**Review identity uniques**
- `{ source, content_fingerprint }` is unique.
- `{ source, published, review_date: -1 }` is indexed and **not** unique.
- `normalized_reviewer_name` is indexed and **not** unique.
- `customer` is indexed and **not** unique.
- `featured` is **not** indexed.
- Neither compound is named.
- There is no named unique-fingerprint catalog export.

**Default connection**
- `Testimonial` remains exported as the default model.
- The getter `getTestimonialModel` does not exist.
- The default export is `mongoose.models.Testimonial ?? mongoose.model(...)`.
- The default export does not call `getMongoDatabaseName()` or `useDb`.
- Leftover `TESTIMONIAL_SOURCES` is **not** re-exported from this file.

Do **not** add a test per helper (`requiredFoldedReviewer`, `keepOneReviewPerSourcePlusFingerprintAndIndexBrowseWithoutUniqueness`). Those names exist so the parent reads. Do **not** list testimonials from this file’s tests. Do **not** stamp a fingerprint from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique index.”

There is no named index export to keep for a second migration **adapter**.

## What I would not do

- A `TestimonialModelService` / `TestimonialService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `fingerprint.ts` / `publish.ts` split for cleanliness.
- Inventing a unique `{ normalized_reviewer_name: 1 }` **seam** so “one reviewer owns every review.”
- Breaking the default-connection **seam** by inventing `getTestimonialModel` without a paired proof. Today’s Main Site find already uses the default, not a getter.
- Deleting the default `Testimonial` export so “review matches evidence” without a paired proof that Main Site find still asks the default model.
- Treating `listTestimonials` / `listAdminTestimonials` / `getAdminTestimonial` / `listAdminTestimonialReviewerNames` as this story. Those functions own the cards and the 404.
- Treating leftover `buildContentFingerprint` / leftover `normalizeReviewerName` / leftover `parseReviewDate` / leftover `hasBbbRedaction` as this story. Those functions stamp the key and notice `REMOVED`.
- Treating leftover `wipeThisCustomerAndTheirBookings` as this story. That wipe does **not** cascade Testimonials.
- Treating already-recommended `ExtensionUser.ts` as this story. That unique is folded email.
- Treating next `schemaHelpers.ts` as this story. That file leftover-exports Lead `sourceCompanyField` / `sheetSyncSchema`.
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database find **adapter** that has only one live home.
- Silently stamping `normalized_reviewer_name` or `content_fingerprint` on validate so “hand insert matches helpers.”
- Silently adding `{ published: true }` onto leftover public find so “the site only sees live copy.”
- Silently adding `{ featured: 1 }` so “featured matches published.”
- Silently copying leftover `sourceCompanyField` onto this optional `source_company`.
- Silently inventing an upsert write so “knowledge has a home.” That script is absent in this checkout.
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
