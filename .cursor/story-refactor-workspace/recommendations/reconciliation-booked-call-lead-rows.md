# Read The Booked Jobs Row So We Can Match It — operational story

- Status: recommended
- Service: `reconciliation` (Wave A, visited)
- Pass: 2 of this service — `bookedCallLeadRows.ts`
- Remaining in this service: none — checklist complete
- Target: `src/services/reconciliation/bookedCallLeadRows.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md` (parse is step 1; `job_no` required; source required and must resolve; `section === "bookedJobs"` or `prior === "5"`; `book_date` is `MM/DD/YYYY` through `parseFloridaCalendarDate`). Distinct from the sibling screenplay: `recommendations/reconciliation-booked-call-lead.md`. Distinct from Follow Up row parse: `docs/knowledge/services/enrichment.md` + `recommendations/enrichment-call-lead-enrichment-rows.md`. Distinct from Call locate: `recommendations/leads-lead-location.md` (`deriveLocal` only). Distinct from Source Assignment: `recommendations/leads-source-company.md` (this file catches `ValidationError` and warns, then refuses if leftover label lookup also misses). CSV `job_no` required: `.cursor/rules/granot-crm-csv-s3-sync.mdc`. This checkout’s `CONTEXT.md` does not define Call Lead / Booking Chain / Job Number — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `bookedCallLeadReconciliation.service.ts` (`parseBookedCallLeadRow` then `validateParsedRow`; `cleanValue` again on stored `job_no`). Barrel: `reconciliation/index.ts` re-exports the two parsed types only — not the functions. Direct HTTP / CSV / automation do **not** import this file; they hand `BookedCallLeadReconciliationRowInput` to the sibling. `granotCrmCsv/sync.service.ts` `toBookedPayload` spreads Follow Up cells plus `section: "bookedJobs"`, `prior`, and `book_date`; it omits `from`, `to`, and `granot_crm_username`. `granotHttpCollector` `mapBookedRow` sends those three. Zod lives in `validation/v1/operations.validation.ts`.
- Seams callers need: the cleaned row the sibling can match vs the invalid-reasons list when Job Number is missing, source is missing or unknown, or the row is neither Booked Jobs nor a Follow Up whose prior is 5; the same placeholder fold on a stored `job_no` so a CRM `n/a` and a stored `n/a` compare as empty
- Split later (only if the file outgrows one sitting): keep one file — reading the row and refusing a blank Booked-Jobs identity are one sitting. Never `parse.ts` / `validate.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`parseBookedCallLeadRow` / `validateParsedRow` / `cleanValue` are executor mechanics. The owner question is: *someone pasted a Granot Booked Jobs row. After we fold placeholders, keep cities, look up states, try the catalog source, parse book date, and normalize the phone — is there still a Job Number and a known source, and is this actually a Booked Jobs row (or a Follow Up row whose prior is 5)? This file never finds a Call Lead or a Booking and never writes one.*

Booking-then-open-call pick, source-fit, field diff, CSV write, Sheet Sync, Follow Up row parse, Call locate, and Registry assignment already live in other **modules**. Do not pull those in.

## What this file actually does

One story with two adapters, not “a booked-jobs row helper,” and not Follow Up parse:

1. **Read this Booked Jobs row** — fold NBSP / extra spaces / `na` `n/a` `none` `null` `-` `--`. Keep `section` as typed. Parse Granot `from` / `to` as `City, ST` (city only). Parse `from_zip` / `to_zip` as a real 5-digit zip (`0` and `00000` drop). Ask the zip book for each zip that remains. **Do not warn** when the book misses (Follow Up parse does). Classify Move Type only when both states are known (`deriveLocal`). Try leftover `resolveSourceCompanyFromLabel` on the cleaned source label (empty cell → `undefined`, not `not_provided`). Unless `VANTAGE_TEST_RUNNER=true`, also ask Source Assignment for channel `call`; a `ValidationError` becomes `Skipped unknown source "…"`. Other errors throw. Normalize phone from the **raw** cell (not the folded display phone). Lowercase a plausible email; skip a bad one with a warning. Parse `est_cf` after stripping commas; skip a non-number with a warning. Parse `book_date` only as `M/D/YYYY` or `MM/DD/YYYY`, then hand `YYYY-MM-DD` to `parseFloridaCalendarDate`; a bad string warns and drops the date. This adapter never queries `CallLead` / `BookedLead` and never mutates Mongo.

2. **Refuse when Job Number, known source, or Booked-Jobs identity is missing** — after the read, if there is no `job_no`, push `Missing required job_no.` If there is no `source_label`, push `Missing required source.` If the label is there and leftover plus catalog still left `source_company` empty, push `Unknown source "…"`. If `section` is not `"bookedJobs"` **and** `prior` is not `"5"`, push `Row is not from Booked Jobs and prior is not 5.` A row can still be readable (cities, phone, email) and refuse. This adapter does not invent a Job Number or a source.

There is no third match operation. `no_match` / `conflict` / `updateable` live in the sibling. Phone-only is not enough here.

## Organization

Keep one file. This is the screenplay for “read the Booked Jobs row so we can match it.” Granot `City, ST` / zip parse, zip-book lookup, leftover **label** aliases, Registry Source Assignment, phone normalize, Move Type classify, and Florida calendar dates already live in deeper **modules**. Do not pull those in. Do not invent a `BookedCallLeadRowsService` class. Do not invent a canonical-command `begin` / `complete` **seam**. Do not invent a Form-shaped locate **seam** that has only one real adapter.

Do not merge this file with `callLeadEnrichmentRows.ts` “because the cleaners look the same.” Follow Up may match by phone alone, warns on zip-book misses, and uses `resolveSourceCompany` (empty → `not_provided`). This read refuses without `job_no` **and** a known source, keeps `section` / `prior` / `book_date`, and stays silent on a zip-book miss. Do not move the read into `leadLocation.service.ts` “because it already classifies.” Do not move Source Assignment catch/warn into `leadSourceCompany.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseBookedCallLeadRow` | `readThisBookedJobsRow` | sibling preview + CSV apply share the same cleaned row |
| `validateParsedRow` | `refuseWhenJobOrSourceOrBookedJobsIdentityIsMissing` | sibling marks `invalid` before any `BookedLead.findOne` / `CallLead.find` |
| `cleanValue` | `foldTheCrmPlaceholder` | sibling compares stored `job_no` with the same fold |
| `ParsedBookedCallLeadRow` | `BookedJobsRowWeCanMatch` | the cleaned shape the sibling matches and diffs |
| `ParsedBookedCallLeadRowWithWarnings` | `BookedJobsRowWeCanMatchWithWarnings` | parse warnings ride on the card |

Keep the old names as one-line aliases until the sibling and the reconciliation barrel migrate. Do not make callers learn `PLACEHOLDERS` / `shouldResolveCatalogSource` / `parseOptionalDate` as the domain language.

`parseOptionalDate` / `cleanEmail` / `parseOptionalNumber` stay children of the read. `cleanZip` is unused here (`parseGranotZip` owns zips, including all-zero). Un-export it once nothing needs it (the sibling never imported it).

`shouldResolveCatalogSource` stays a test **seam**, the same way Source Assignment injects a resolver. It is not a second public operation. Default remains “ask the catalog unless `VANTAGE_TEST_RUNNER=true`.”

**No class for the workflow.** The type that *does* earn a name is the cleaned row:

```ts
type BookedJobsRowWeCanMatch = {
  row_id: string
  row_index?: number
  section?: "bookedJobs" | "followUpEstimates"
  job_no?: string
  source_company?: SourceCompany          // leftover label map or catalog; empty cell is undefined
  source_assignment?: LeadSourceAssignment
  source_label?: string                   // folded CRM source cell
  prior?: string                          // folded; only "5" opens a Follow Up row
  book_date?: Date                        // Florida calendar date, or undefined
  name?: string
  phone_number?: string                   // folded display; not what we match with
  granot_crm_username?: string
  normalized_phone_number?: string        // match key; from the raw cell
  email?: string
  pickup_city?: string                    // from City, ST — state from that string is dropped
  pickup_zip?: string
  delivery_city?: string
  delivery_zip?: string
  pickup_state?: string                   // zip book only
  delivery_state?: string
  local?: LocalType
  cubic_feet?: number
}

type BookedJobsRowWeCanMatchWithWarnings = BookedJobsRowWeCanMatch & {
  warnings?: string[]
}
```

Drop `source_cpl` from the type. Nothing assigns it. Do **not** start copying a CPL onto the parsed row so “the type looks priced.” Pricing stays in the sibling after a write.

Do **not** collapse this into `locateTheCallMove` so “every Call path locates the same way.” This read keeps cities, a silent zip-book miss, `section` / `prior` / `book_date`, and a source attempt that locate does not own.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookedCallLeadRows.ts
// Someone pasted a Granot Booked Jobs row.
// Fold the placeholders. Keep the city. Ask the zip book for the state.
// Try the catalog source. Parse the book date. Normalize the phone.
// If there is still a Job Number and a known source,
// and this is Booked Jobs (or Follow Up prior 5), the sibling may match.
// This file does not find a Call Lead or a Booking.
// This file does not write a Call Lead or a Booking.
// This file is not Follow Up row parse.
// Phone-only is not enough.

// ── 1. Read this Booked Jobs row ──────────────────────────

export async function readThisBookedJobsRow(row)

function foldTheCrmPlaceholder(value)              // today's cleanValue
function keepTheCityFromCityCommaState(from, to)   // parseGranotCityState; drop ST
function keepARealFiveDigitZip(fromZip, toZip)     // parseGranotZip; 0 / 00000 drop
async function askTheZipBookAndStaySilentWhenItMisses(pickupZip, deliveryZip)
function classifyOnlyWhenBothStatesAreKnown(pickupState, deliveryState)
function leftoverCompanyFromTheDisplayLabel(sourceLabel) // FromLabel; empty → undefined
async function tryTheCatalogSourceOrWarn(sourceLabel, leftover, local)
function normalizeThePhoneFromTheRawCell(phone)    // not the folded display
function keepAPlausibleEmailOrWarn(email, warnings)
function keepAFiniteCubicFeetOrWarn(estCf, warnings)
function keepAFloridaBookDateOrWarn(bookDate, warnings) // MM/DD/YYYY only

// ── 2. Refuse when Job, source, or Booked-Jobs identity is missing

export function refuseWhenJobOrSourceOrBookedJobsIdentityIsMissing(parsed)
  // no job_no → missing job
  // no source_label → missing source
  // label but no leftover/catalog company → unknown source
  // not bookedJobs and prior !== "5" → not a Booked Jobs row
```

Read the primary path out loud: *fold the CRM cells. Keep Barnesville from `Barnesville,GA`. Drop a `0` zip. Ask the zip book only for zips that remain; if a zip is there and the book misses, leave that state blank and do not warn. Same states → local. Empty source cell → leftover `undefined`, not `not_provided`. Unknown catalog source → warning; if the display-label map also misses, the row is invalid. Parse book date only as `05/21/2026`. Normalize the phone from what Granot typed. If the Job Number folded away, or the source is missing or unknown, or this is a Follow Up row whose prior is not 5, the row is invalid — even when a phone is present. Otherwise hand the cleaned row to the sibling. Do not look up a Call Lead or a Booking here.*

That is the operation. `parseBookedCallLeadRow` is not a different story. Follow Up `parseEnrichmentRow` is not this read.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file is almost a paste of `callLeadEnrichmentRows.ts`.** Same placeholder set, same zip/city parse, same catalog try/catch, same email / `est_cf` cleaners. The stories diverge on purpose: Follow Up may match by phone alone and warns on zip-book misses; this read refuses without `job_no` and a known source, keeps `section` / `prior` / `book_date`, and stays silent on a zip miss. Do not merge the parsers so “CRM rows share one helper,” and do not start allowing phone-only here so “invalid matches Follow Up.”

2. **Empty source is leftover `undefined` here.** `resolveSourceCompanyFromLabel` returns `undefined` on an empty cell. Follow Up uses `resolveSourceCompany(undefined)` → leftover `not_provided`, and may still match by phone. An empty booked-jobs source arrives with no `source_company` and becomes `invalid`. Do not switch this file to `resolveSourceCompany` so “row parsers match,” and do not make Follow Up call `FromLabel` so “empty means undefined everywhere.” CONTRADICTIONS already has this pair.

3. **`FromLabel` is the display-label map, not slugs or aliases.** `resolveSourceCompany` also matches leftover slugs (`best_relocation_leads`) and config aliases. A source cell that is already a slug: this file’s leftover is `undefined`; the catalog may still assign unless the test-runner fence is on. With the fence on, that slug row is `Unknown source`. Follow Up’s leftover would have kept the slug. Do not call `resolveSourceCompany` here so “test-runner slugs resolve,” and do not teach Follow Up `FromLabel` so “both leftover maps are the label book.”

4. **Knowledge says unknown labels warn and fail validation.** Parse always warns on catalog `ValidationError`. Validate fails only when leftover `FromLabel` also left `source_company` empty. A display label that is in `SOURCE_LABEL_TO_COMPANY` still validates after a catalog skip. Do not promote every catalog miss to `invalid` so the knowledge sentence “wins,” and do not drop the unknown-source validate so “parse already warned.”

5. **`City, ST` keeps the city and throws away the state.** `parseGranotCityState("Barnesville,GA")` knows `GA`. This file stores `pickup_city` and then asks the zip book for `pickup_state`. A missing or `0` zip leaves the state blank even when Granot typed `GA`. Follow Up at least warns on a zip-book miss; this file does not. Do not start copying the parsed ST so “the row has a state,” do not add the Follow Up zip-miss warning so “CRM parses match,” and do not call `locateTheCallMove` so “Call locate owns states.”

6. **CSV Booked Jobs never sends `from`, `to`, or `granot_crm_username`.** `toBookedPayload` spreads `toEnrichmentPayload` (job / source / customer / phone / email / zips / `est_cf`) and adds `section: "bookedJobs"`, `prior`, and `book_date`. HTTP automation `mapBookedRow` sends the three omitted fields. Preview from the extension can too. Do not add those keys to CSV so “CSV looks like preview,” and do not drop city / username parse here so “CSV does not use them.”

7. **`source_cpl` is dead.** The parsed type declares it. The return never sets it. The sibling prices after a write via `resolveLeadCplSnapshot`. Do not populate `source_cpl` from the assignment so the field “means something.” Follow Up has the same leftover field.

8. **`cleanZip` is unused.** Zips go through `parseGranotZip`, which also rejects all-zero. Follow Up exports the same unused helper. Do not start calling `cleanZip` here so “both parsers use it” — it would accept `00000` as a zip (`/^\d{5}$/`) while `parseGranotZip` would not.

9. **Two placeholder books.** This file’s set has no `0`. `granotLocation`’s set does. A source / name / phone cell of `0` survives `foldTheCrmPlaceholder` and may try catalog resolve. A zip of `0` drops. Do not add `0` to this set so “placeholders match,” and do not drop `0` from Granot location so “one set.”

10. **Phone match key is the raw cell.** `phone_number` is folded for display. `normalized_phone_number` runs `normalizePhoneNumberForMatch(row.phone)`. `n/a` still normalizes to undefined (no digits). The sibling’s customer insert uses the folded `phone_number`, not the match key. Do not normalize the folded display so “one clean,” and do not write the match key onto the Call Lead — the sibling already refuses to patch `phone_number`.

11. **Catalog skip is a test runner fence, not a domain flag.** `VANTAGE_TEST_RUNNER=true` skips Source Assignment so unit tests do not hit Mongo. Knowledge already says so. Do not skip whenever `TEST_MODE=true` so “local never talks to the catalog,” and do not delete the fence so “parse always assigns.”

12. **Missing `job_no` is `invalid` even when a phone is present.** CSV booked rows without `job_no` stay unapplied; the rule forbids guessing from phone-only data. Follow Up may match by phone alone. Do not drop the job require so “every CRM row can match by phone,” and do not start emitting `booking_missing` from this file — this file only returns reason strings.

13. **`book_date` accepts only `M/D/YYYY` here.** `parseOptionalDate` requires `/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/`, reshapes to `YYYY-MM-DD`, then calls `parseFloridaCalendarDate`. The helper already accepts both US and ISO, and `Date.UTC` will roll `02/30/2026` rather than throw. Zod accepts any string, including `2026-05-21`. An ISO book date therefore warns and drops. Do not start calling the helper on the raw cell so “ISO from Zod wins,” and do not add calendar-valid reject so “Owner confirm `book_date` and CRM `book_date` match.” Knowledge already names `MM/DD/YYYY`.

14. **A Follow Up row handed here without `prior === "5"` is `invalid`.** CSV booked exports always send `section: "bookedJobs"`, so the prior-5 door is unused on that path. Ordinary Follow Up call rows stay in enrichment. Do not drop the prior-5 door so “booked-jobs is bookedJobs only,” and do not route prior-5 through enrichment so “every Follow Up row is one file.”

15. **Leave sibling modules alone.** Booking-then-open-call pick, source-fit, job-number leave-as-is, CSV write, and after-commit Sheet Sync stay in `bookedCallLeadReconciliation.service.ts`. `parseGranotCityState` / `parseGranotZip` stay in `utils/location/granotLocation.ts`. `getStateCodeForZip` stays in the zip book. `deriveLocal` stays in `leadLocation`. `resolveLeadSourceAssignment` stays in `leadSourceCompany.ts`. `resolveSourceCompanyFromLabel` stays in `config/domain`. `parseFloridaCalendarDate` stays in `utils/easternTime`. `normalizePhoneNumberForMatch` stays in `utils/phone`.

16. **Do not treat Follow Up parse or `/booked-reconciliation/sync` as this story.** `callLeadEnrichmentRows.ts` is already recommended. `applyExtensionGranotItem` is Wave A later. Do not write a whole-folder reconciliation recommendation — this pass closes the folder by finishing the last module, not by covering the sibling again.

## Testing

The **interface** is the test surface: `readThisBookedJobsRow` and `refuseWhenJobOrSourceOrBookedJobsIdentityIsMissing` (today `parseBookedCallLeadRow` / `validateParsedRow`). `foldTheCrmPlaceholder` is exercised through the sibling’s stored-`job_no` compare and through the read, not as its own suite.

There is **no** `bookedCallLeadRows.test.ts`. Today’s `bookedCallLeadReconciliation.service.test.ts` only stubs a missing Booking and an open Call Lead for phone/source pick. It never hits missing `job_no`, unknown source, prior-not-5, or a bad `book_date`. That is not enough for a story that decides whether the sibling may even look.

Add tests that name the operation. Inject Source Assignment (or keep the test-runner fence) so parse tests do not need a live Registry:

**Read this Booked Jobs row**
- `from: "Barnesville,GA"`, `from_zip: "0"`, `to: ","`, `to_zip: "0"` → city `Barnesville`, no zips, no states, no `local`, **no** zip-miss warning. Do not start asserting `GA`.
- Both zips resolve to the same state → `local: "local"`. Different states → `long_distance`. One zip misses → that state undefined; `local` unset; **no** warning naming the zip.
- Empty / `n/a` source → leftover `source_company` undefined (not `not_provided`). Do not “fix” this to Follow Up’s leftover.
- Unknown display label when the catalog is on → warning `Skipped unknown source "…"`; leftover stays whatever `FromLabel` returned. A slug that is not in the label map stays leftover-empty unless the catalog assigns it.
- `VANTAGE_TEST_RUNNER=true` → no Source Assignment call. A leftover-empty label then fails refuse.
- Raw phone `5551234567` → `normalized_phone_number: "5551234567"`. `n/a` / too-short → undefined phone match key. Folded `phone_number` may be undefined while the raw key is still set — prove today’s raw-cell path, do not “fix” it.
- Bad email → undefined + skip warning. Plausible email → lowercase.
- `est_cf: "1,200"` → `1200`. `est_cf: "n/a"` → undefined, no warning. `est_cf: "abc"` → undefined + skip warning.
- `job_no: "n/a"` → undefined. `job_no: "P5559324"` → that string (no digit-core fold).
- `book_date: "05/21/2026"` → a Florida calendar `Date`. `book_date: "2026-05-21"` → undefined + skip warning (prove today’s `MM/DD/YYYY` gate, do not “fix” it to the helper’s ISO path). `book_date: "n/a"` → undefined, no warning.

**Refuse when Job Number, known source, or Booked-Jobs identity is missing**
- No `job_no`, even with a normalized phone → `Missing required job_no.` Sibling tests already prove this becomes `invalid` with no `BookedLead.findOne` once those cases exist.
- No `source_label` → `Missing required source.`
- Label present, leftover and catalog both empty → `Unknown source "…"`.
- `section: "followUpEstimates"` and `prior !== "5"` → the prior-not-5 sentence. `section: "bookedJobs"` with no prior → empty reasons (CSV path). `section: "followUpEstimates"` and `prior: "5"` plus job + known source → empty reasons.
- Phone only, readable cities, no job → still refuses. A valid Booked Jobs identity with no phone → empty reasons (sibling may still `no_match`).

Do **not** add a test per helper (`keepTheCityFromCityCommaState`, `keepAFloridaBookDateOrWarn`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test booking-then-open-call pick, source-fit, CSV write, Follow Up parse, `locateTheCallMove`, or `applyExtensionGranotItem` here. Do not add a test that CSV sends `from` / `to` / `granot_crm_username` — it must not, today. Do not add a test that `POST /booked-reconciliation/sync` imports this file — it must not.

## What I would not do

- A `BookedCallLeadRowsService` class with `parse` / `validate` / `clean`.
- Thirty two-line functions that only wrap `trim()`.
- Moving this into a CRUD folder, or splitting `parse.ts` / `validate.ts` “for cleanliness.”
- Merging this file with `callLeadEnrichmentRows.ts`, or moving the read into `leadLocation` / `leadSourceCompany`.
- Switching empty source to `resolveSourceCompany` / `not_provided`, or allowing phone-only so invalid matches Follow Up.
- Copying `City, ST` into `pickup_state`, adding Follow Up zip-miss warnings, or writing Form `not_found` onto a Booked Jobs row.
- Adding `from` / `to` / `granot_crm_username` to CSV `toBookedPayload`, or dropping those parses because CSV omits them.
- Populating `source_cpl`, calling `cleanZip`, or accepting ISO `book_date` so “the Florida helper wins.”
- Treating Follow Up parse or Owner receipt apply as this story.
- Writing a whole-folder recommendation for `reconciliation`.
