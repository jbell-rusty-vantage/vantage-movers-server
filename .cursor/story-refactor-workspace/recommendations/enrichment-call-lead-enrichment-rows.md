# Read The Follow Up Row So We Can Match It — operational story

- Status: recommended
- Service: `enrichment` (Wave A, visited)
- Pass: 2 of this service — `callLeadEnrichmentRows.ts`
- Remaining in this service: none — checklist complete
- Target: `src/services/enrichment/callLeadEnrichmentRows.ts`
- Knowledge: `docs/knowledge/services/enrichment.md` (parse is step 1 of preview/match; unknown CRM source labels warn unless `VANTAGE_TEST_RUNNER=true`). Distinct from the sibling screenplay: `recommendations/enrichment-call-lead-enrichment.md`. Distinct from booked-jobs row parse: `docs/knowledge/services/booked-call-lead-reconciliation.md` + `src/services/reconciliation/bookedCallLeadRows.ts` (next service). Distinct from Call locate: `recommendations/leads-lead-location.md` (`deriveLocal` only). Distinct from Source Assignment: `recommendations/leads-source-company.md` (this file catches `ValidationError` and warns). CSV column gaps: `.cursor/rules/granot-crm-csv-s3-sync.mdc`. This checkout’s `CONTEXT.md` does not define Call Lead Enrichment / Call Lead / Job Number — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `callLeadEnrichment.service.ts` (`parseEnrichmentRow` then `validateParsedRow`; `cleanValue` again on stored `job_no`). Barrel: `enrichment/index.ts` re-exports the two parsed types only — not the functions. Direct HTTP / CSV / automation do **not** import this file; they hand `CallLeadEnrichmentRowInput` to the sibling. `granotCrmCsv/sync.service.ts` `toEnrichmentPayload` omits `from`, `to`, and `granot_crm_username`. `granotHttpCollector` `mapEnrichmentRow` sends those three. Zod lives in `validation/v1/operations.validation.ts`.
- Seams callers need: the cleaned row the sibling can match vs the invalid-reasons list when neither a normalized phone nor a Job Number remains; the same placeholder fold on a stored `job_no` so a CRM `n/a` and a stored `n/a` compare as empty
- Split later (only if the file outgrows one sitting): keep one file — reading the row and refusing a blank identity are one sitting. Never `parse.ts` / `validate.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`parseEnrichmentRow` / `validateParsedRow` / `cleanValue` are executor mechanics. The owner question is: *someone pasted a Granot Follow Up row. After we fold placeholders, keep cities, look up states, try the catalog source, and normalize the phone — is there still a phone or a Job Number we can match with? This file never finds a Call Lead and never writes one.*

Phone-then-job pick, source-fit, field diff, CSV write, Sheet Sync, booked-jobs row parse, Call locate, and Registry assignment already live in other **modules**. Do not pull those in.

## What this file actually does

One story with two adapters, not “an enrichment row helper,” and not booked-jobs parse:

1. **Read this Follow Up row** — fold NBSP / extra spaces / `na` `n/a` `none` `null` `-` `--`. Parse Granot `from` / `to` as `City, ST` (city only). Parse `from_zip` / `to_zip` as a real 5-digit zip (`0` and `00000` drop). Ask the zip book for each zip that remains. Warn when a zip is present and the book misses. Classify Move Type only when both states are known (`deriveLocal`). Try leftover `resolveSourceCompany` on the cleaned source label (empty cell → `not_provided`). Unless `VANTAGE_TEST_RUNNER=true`, also ask Source Assignment for channel `call`; a `ValidationError` becomes `Skipped unknown source "…"`. Other errors throw. Normalize phone from the **raw** cell (not the folded display phone). Lowercase a plausible email; skip a bad one with a warning. Parse `est_cf` after stripping commas; skip a non-number with a warning. This adapter never queries `CallLead` and never mutates Mongo.

2. **Refuse when neither phone nor Job Number remains** — after the read, if there is no `normalized_phone_number` and no `job_no`, return the one sentence the sibling copies onto `invalid`. A row can still be readable (cities, source, email) and refuse. This adapter does not invent a phone or a Job Number.

There is no third match operation. `no_match` / `conflict` / `updateable` live in the sibling.

## Organization

Keep one file. This is the screenplay for “read the Follow Up row so we can match it.” Granot `City, ST` / zip parse, zip-book lookup, leftover company aliases, Registry Source Assignment, phone normalize, and Move Type classify already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadEnrichmentRowsService` class. Do not invent a canonical-command `begin` / `complete` **seam**. Do not invent a Form-shaped locate **seam** that has only one real adapter.

Do not merge this file with `bookedCallLeadRows.ts` “because the cleaners look the same.” Booked-jobs rows carry `section` / `prior` / `book_date`, refuse without `job_no` **and** a known source, and use `resolveSourceCompanyFromLabel` (empty → undefined). Do not move the read into `leadLocation.service.ts` “because it already classifies.” Do not move Source Assignment catch/warn into `leadSourceCompany.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseEnrichmentRow` | `readThisFollowUpRow` | sibling preview + CSV apply share the same cleaned row |
| `validateParsedRow` | `refuseWhenNeitherPhoneNorJobRemains` | sibling marks `invalid` before any `CallLead.find` |
| `cleanValue` | `foldTheCrmPlaceholder` | sibling compares stored `job_no` with the same fold |
| `ParsedCallLeadEnrichmentRow` | `FollowUpRowWeCanMatch` | the cleaned shape the sibling matches and diffs |
| `ParsedCallLeadEnrichmentRowWithWarnings` | `FollowUpRowWeCanMatchWithWarnings` | parse warnings ride on the card |

Keep the old names as one-line aliases until the sibling and the enrichment barrel migrate. Do not make callers learn `PLACEHOLDERS` / `shouldResolveCatalogSource` as the domain language.

`cleanRequired` is `foldTheCrmPlaceholder` with another name — stop exporting it as a second operation. `cleanEmail` / `parseOptionalNumber` stay children of the read. `cleanZip` is unused here (`parseGranotZip` owns zips, including all-zero). Un-export those three once the sibling stops needing them (it never imported them).

`shouldResolveCatalogSource` stays a test **seam**, the same way Source Assignment injects a resolver. It is not a second public operation. Default remains “ask the catalog unless `VANTAGE_TEST_RUNNER=true`.”

**No class for the workflow.** The type that *does* earn a name is the cleaned row:

```ts
type FollowUpRowWeCanMatch = {
  row_id: string
  row_index?: number
  job_no?: string
  source_company?: SourceCompany          // leftover slug; empty cell is not_provided
  source_label?: string                   // folded CRM source cell
  source_assignment?: LeadSourceAssignment
  name?: string
  phone?: string                          // folded display; not what we match with
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

type FollowUpRowWeCanMatchWithWarnings = FollowUpRowWeCanMatch & {
  warnings?: string[]
}
```

Drop `source_cpl` from the type. Nothing assigns it. Do **not** start copying a CPL onto the parsed row so “the type looks like booked-jobs.” Pricing stays in the sibling after a write.

Do **not** collapse this into `locateTheCallMove` so “every Call path locates the same way.” This read keeps cities, zip-miss warnings, and a source attempt that locate does not own.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadEnrichmentRows.ts
// Someone pasted a Granot Follow Up row.
// Fold the placeholders. Keep the city. Ask the zip book for the state.
// Try the catalog source. Normalize the phone.
// If there is still a phone or a Job Number, the sibling may match.
// This file does not find a Call Lead.
// This file does not write a Call Lead.
// This file is not booked-jobs row parse.

// ── 1. Read this Follow Up row ────────────────────────────

export async function readThisFollowUpRow(row)

function foldTheCrmPlaceholder(value)              // today's cleanValue
function keepTheCityFromCityCommaState(from, to)   // parseGranotCityState; drop ST
function keepARealFiveDigitZip(fromZip, toZip)     // parseGranotZip; 0 / 00000 drop
async function askTheZipBookAndWarnWhenItMisses(pickupZip, deliveryZip)
function classifyOnlyWhenBothStatesAreKnown(pickupState, deliveryState)
function leftoverCompanyFromTheLabel(sourceLabel)  // resolveSourceCompany; empty → not_provided
async function tryTheCatalogSourceOrWarn(sourceLabel, leftover, local)
function normalizeThePhoneFromTheRawCell(phone)    // not the folded display
function keepAPlausibleEmailOrWarn(email, warnings)
function keepAFiniteCubicFeetOrWarn(estCf, warnings)

// ── 2. Refuse when neither phone nor Job Number remains ───

export function refuseWhenNeitherPhoneNorJobRemains(parsed)
  // no normalized phone and no job_no → one invalid sentence
```

Read the primary path out loud: *fold the CRM cells. Keep Barnesville from `Barnesville,GA`. Drop a `0` zip. Ask the zip book only for zips that remain; if a zip is there and the book misses, warn and leave that state blank. Same states → local. Empty source cell → leftover `not_provided`. Unknown catalog source → warning, do not throw. Normalize the phone from what Granot typed. If that phone is unusable and the Job Number folded away, the row is invalid. Otherwise hand the cleaned row to the sibling. Do not look up a Call Lead here.*

That is the operation. `parseEnrichmentRow` is not a different story. Booked-jobs `parseBookedCallLeadRow` is not this read.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file is almost a paste of `bookedCallLeadRows.ts`.** Same placeholder set, same zip/city parse, same catalog try/catch, same email / `est_cf` cleaners. The stories diverge on purpose: Follow Up may match by phone alone; booked-jobs refuse without `job_no` and a known source; booked-jobs keep `section` / `prior` / `book_date`; this file warns on zip-book misses and booked-jobs does not. Do not merge the parsers so “CRM rows share one helper,” and do not start requiring a source here so “invalid matches booked-jobs.”

2. **Empty source is leftover `not_provided` here.** `resolveSourceCompany(undefined)` returns `not_provided`. Booked-jobs uses `resolveSourceCompanyFromLabel`, which returns `undefined` on an empty cell. An unassigned Follow Up row therefore arrives with `source_company: "not_provided"` and may still get `source_assignment` only when the catalog ran. Do not switch this file to `FromLabel` so “row parsers match,” and do not make booked-jobs call `resolveSourceCompany` so “empty means not_provided everywhere.”

3. **`City, ST` keeps the city and throws away the state.** `parseGranotCityState("Barnesville,GA")` knows `GA`. This file stores `pickup_city` and then asks the zip book for `pickup_state`. A missing or `0` zip leaves the state blank even when Granot typed `GA`. The existing test locks city-without-zip and does not assert state. Do not start copying the parsed ST so “the row has a state,” and do not call `locateTheCallMove` so “Call locate owns states.”

4. **CSV Follow Up never sends `from`, `to`, or `granot_crm_username`.** `toEnrichmentPayload` maps job / source / customer / phone / email / zips / `est_cf` only. HTTP automation `mapEnrichmentRow` sends the three omitted fields. Preview from the extension can too. Do not add those keys to CSV so “CSV looks like preview,” and do not drop city / username parse here so “CSV does not use them.”

5. **`source_cpl` is dead.** The parsed type declares it. The return never sets it. The sibling prices after a write via `resolveLeadCplSnapshot`. Do not populate `source_cpl` from the assignment so the field “means something.”

6. **`cleanRequired` is a pass-through.** It is `cleanValue`. Job Number already goes through the same fold. Delete the alias once callers use `foldTheCrmPlaceholder`. Do not add a “required” throw so the name wins.

7. **`cleanZip` is unused.** Zips go through `parseGranotZip`, which also rejects all-zero. The booked-jobs file still exports the same unused `cleanZip`. Do not start calling `cleanZip` here so “both parsers use it” — it would accept `00000` as a zip (`/^\d{5}$/`) while `parseGranotZip` would not.

8. **Two placeholder books.** This file’s set has no `0`. `granotLocation`’s set does. A source / name / phone cell of `0` survives `foldTheCrmPlaceholder` and may try catalog resolve. A zip of `0` drops. Do not add `0` to this set so “placeholders match,” and do not drop `0` from Granot location so “one set.”

9. **Phone match key is the raw cell.** `phone` is folded for display. `normalized_phone_number` runs `normalizePhoneNumberForMatch(row.phone)`. `n/a` still normalizes to undefined (no digits). Do not normalize the folded display so “one clean,” and do not fold before normalize so a leading placeholder character can strip a real number.

10. **Catalog skip is a test runner fence, not a domain flag.** `VANTAGE_TEST_RUNNER=true` skips Source Assignment so unit tests do not hit Mongo. Knowledge already says so. Do not skip whenever `TEST_MODE=true` so “local never talks to the catalog,” and do not delete the fence so “parse always assigns.”

11. **Unknown source is a warning, not `invalid`.** `ValidationError` from Source Assignment is swallowed. Other errors rethrow. `refuseWhenNeitherPhoneNorJobRemains` does not care about source. The sibling may still match by phone and later `conflict` on assigned-source fit. Do not promote unknown source to `invalid` so “we refuse earlier,” and do not throw the validation so “assignment is honest.”

12. **Zip-book miss is a warning, not `not_found`.** Form locate writes `not_found`. This read leaves the state undefined and still classifies only when both states exist. Do not write `not_found` onto a Follow Up row so “Call and Form look the same.”

13. **Leave sibling modules alone.** Phone-then-job pick, source-fit, job-number leave-as-is, CSV write, and Sheet Sync stay in `callLeadEnrichment.service.ts`. `parseGranotCityState` / `parseGranotZip` stay in `utils/location/granotLocation.ts`. `getStateCodeForZip` stays in the zip book. `deriveLocal` stays in `leadLocation`. `resolveLeadSourceAssignment` stays in `leadSourceCompany.ts`. `normalizePhoneNumberForMatch` stays in `utils/phone`.

14. **Do not treat booked-jobs parse or `/enrichment/sync` as this story.** `bookedCallLeadRows.ts` is the next service’s first module. `applyExtensionGranotItem` is Wave A later. Do not write a whole-folder enrichment recommendation.

## Testing

The **interface** is the test surface: `readThisFollowUpRow` and `refuseWhenNeitherPhoneNorJobRemains` (today `parseEnrichmentRow` / `validateParsedRow`). `foldTheCrmPlaceholder` is exercised through the sibling’s stored-`job_no` compare and through the read, not as its own suite.

Today’s `callLeadEnrichmentRows.test.ts` only locks `Barnesville,GA` + `0` / `,` zips. That is not enough for a story that also decides source, phone, email, and invalid.

Replace the one-off with tests that name the operation. Inject Source Assignment (or keep the test-runner fence) so parse tests do not need a live Registry:

**Read this Follow Up row**
- `from: "Barnesville,GA"`, `from_zip: "0"`, `to: ","`, `to_zip: "0"` → city `Barnesville`, no zips, no states, no `local`. Do not start asserting `GA`.
- Both zips resolve to the same state → `local: "local"`. Different states → `long_distance`. One zip misses → that state undefined; `local` unset; warning names the zip.
- Empty / `n/a` source → leftover `source_company: "not_provided"`. Do not “fix” this to `undefined`.
- Unknown source when the catalog is on → warning `Skipped unknown source "…"`, no throw; leftover company is whatever `resolveSourceCompany` returned.
- `VANTAGE_TEST_RUNNER=true` → no Source Assignment call.
- Raw phone `5551234567` → `normalized_phone_number: "5551234567"`. `n/a` / too-short → undefined phone match key. Folded `phone` may be undefined while the raw key is still set — prove today’s raw-cell path, do not “fix” it.
- Bad email → undefined + skip warning. Plausible email → lowercase.
- `est_cf: "1,200"` → `1200`. `est_cf: "n/a"` → undefined, no warning. `est_cf: "abc"` → undefined + skip warning.
- `job_no: "n/a"` → undefined. `job_no: "P5559324"` → that string (no digit-core fold).

**Refuse when neither phone nor Job Number remains**
- No normalized phone and no `job_no` → the current invalid sentence. Sibling tests already prove this becomes `invalid` with no `CallLead.find`.
- Phone only, or Job Number only → empty reasons. A readable row with cities and no identity still refuses.

Do **not** add a test per helper (`keepTheCityFromCityCommaState`, `keepAFiniteCubicFeetOrWarn`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test phone-then-job pick, source-fit, CSV write, booked-jobs parse, `locateTheCallMove`, or `applyExtensionGranotItem` here. Do not add a test that CSV sends `from` / `to` / `granot_crm_username` — it must not, today.

## What I would not do

- A `CallLeadEnrichmentRowsService` class with `parse` / `validate` / `clean`.
- Thirty two-line functions that only wrap `trim()`.
- Moving this into a CRUD folder, or splitting `parse.ts` / `validate.ts` “for cleanliness.”
- Merging this file with `bookedCallLeadRows.ts`, or moving the read into `leadLocation` / `leadSourceCompany`.
- Switching empty source to `FromLabel` / `undefined`, or requiring a source so invalid matches booked-jobs.
- Copying `City, ST` into `pickup_state`, or writing Form `not_found` onto a Follow Up row.
- Adding `from` / `to` / `granot_crm_username` to CSV `toEnrichmentPayload`, or dropping those parses because CSV omits them.
- Populating `source_cpl`, calling `cleanZip`, or promoting unknown source to `invalid`.
- Treating booked-jobs parse or Owner receipt apply as this story.
- Writing a whole-folder recommendation for `enrichment`.
