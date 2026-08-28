# Parse The Leftover Granot CSV Download Into Identifiable Data Rows, Skip Totals And Blanks, Then Key By Job, Mongo Ref, Or Phone — Never Apply A Lead From Here — operational story

- Status: recommended
- Service: `granotCrmCsv` (Wave A, visited after this pass)
- Pass: 4 of this service — `parser.ts`
- Remaining in this service: none (`keys.ts` / `storage.ts` / `types.ts` / `index.ts` already skipped)
- Target: `src/services/granotCrmCsv/parser.ts`
- Knowledge: none as a dedicated Service file. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) — current Granot CSV downloads can omit `job_no` even when the browser page shows Job Numbers; Follow Up then can only match by phone, and Booked reconciliation without `job_no` must stay `invalid` rather than guess. This file is the leftover parse / row-identity screenplay those later walks consume. Distinct from generic quoted-CSV split / header-and-cell fold: `src/utils/csvParse.ts` (`parseCsvRecords`, `normalizeCsvHeader`, `normalizeCsvCell`) — this file imports those and then decides Granot identity. Distinct from store-the-download (history / latest / meta / ingestion row, parse only to count): [recommendations/granot-crm-csv-upload.md](granot-crm-csv-upload.md). Distinct from walk-the-latest-file apply (dry-run unless asked): [recommendations/granot-crm-csv-sync.md](granot-crm-csv-sync.md) (that file already calls `parseGranotCsv` + `cleanValue`). Distinct from leftover CSV workspace catalog plant / show / bind: [recommendations/granot-crm-csv-registry.md](granot-crm-csv-registry.md). Distinct from S3 key fold / get / put: sibling `keys.ts` / `storage.ts`. Distinct from Follow Up refresh / Booked Call reconciliation write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (they receive a mapped row; they do not parse). Distinct from Form Lead Correction / Form search: [recommendations/form-lead.md](form-lead.md) / [`docs/knowledge/services/form-lead-search.md`](../../../docs/knowledge/services/form-lead-search.md) (`resolveFormLead` ObjectId skip is sync’s later beat). Distinct from Lead phone match: [recommendations/leads-lead-phone-matching.md](leads-lead-phone-matching.md) + `src/utils/phone.ts` `normalizePhoneNumberForMatch` — this file’s last-10 digit fold is a leftover CSV key, not the Lead sieve. Distinct from HTTP session collect (Job Numbers on the page): [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from HTTP Form identity (exact `FormLead.ref_no`, then Mongo `_id`): [recommendations/granot-http-collector-form-lead-matcher.md](granot-http-collector-form-lead-matcher.md). Distinct from trusted Granot create / processor identity: [recommendations/granot-lifecycle-trusted-lead-create-validation.md](granot-lifecycle-trusted-lead-create-validation.md) / [recommendations/granot-lifecycle-identity.md](granot-lifecycle-identity.md). Distinct from `src/utils/objectId.ts` `isObjectIdString` (wraps `mongoose.isValidObjectId`): this file uses a private 24-hex regex. This checkout’s `CONTEXT.md` does not define leftover Granot CSV row identity / `rowKey` — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **two runtime import sites plus the barrel and one folder test.** Store: `upload.service.ts` calls `parseGranotCsv` only to count (`counts.total` / `counts.dataRows`); caller-supplied `row_count` / `data_row_count` win when present. Apply: `sync.service.ts` calls `parseGranotCsv` then walks `parsed.rows` (optional `limit` slice per file) and imports `cleanValue` for Form `ref_no` / phone / email / name / `prior` and for `stringCell`. Barrel: `granotCrmCsv/index.ts` re-exports `parseGranotCsv` — not `cleanValue`. Test: `parser.test.ts` (one case: header fold + totals skip + `job:P123`). Not callers: `registry.ts` / `keys.ts` / `storage.ts`, public Form/Call write, HTTP automation collect/apply, Owner Registry Granot CRM Source write, `leadPhoneMatching.ts`, `objectId.ts`. `isGranotDataRow` / `buildRowKey` / `cellsToRecord` / `normalizePhoneKey` / `emptyParsed` are private.
- Seams callers need: leftover Granot identity parse (this file) vs generic CSV split (util); parse-for-counts (upload) vs parse-for-walk (sync); data-row gate vs row-key ladder (same story, two beats); 24-hex `ref_no` (this file) vs `mongoose.isValidObjectId` (sync Form steal); last-10 leftover phone key vs Lead `normalizePhoneNumberForMatch`; `cleanValue` fold reused by sync match/patch; this file never applies a Lead
- Split later (only if the file outgrows one sitting): keep one file — this ~125-line module is one screenplay for “parse the leftover Granot CSV download into identifiable data rows, skip totals and blanks, then key by Job, Mongo ref, or phone.” If it later splits: `parseTheLeftoverGranotCsvDownloadIntoIdentifiableDataRows.ts` / `decideWhetherThisRecordIsALeftoverGranotDataRow.ts` / `giveTheLeftoverGranotCsvRowAStableIdentityKey.ts` — story files, never `parse.ts` / `validate.ts` / `key.ts` / `create.ts`, and never merge generic CSV split, S3 store, leftover catalog, or Lead apply into this file

`parseGranotCsv` / `cleanValue` are executor mechanics. The owner question is: *We have leftover Follow Up or Booked CSV text. Split the file. Fold headers so `job no` becomes `job_no`. Skip blank lines and Granot total rows. A leftover data row is a row with a Job Number, or a 24-hex Mongo `ref_no`, or a phone plus a customer name. Give that row a stable key — Job first, then Mongo ref, then phone plus email, then phone, then customer plus Granot `no`. Count how many records we saw, how many were data, how many we skipped. This file does not store S3. This file does not apply a Lead. This file does not equal the page’s Job Numbers.*

Generic CSV split, store, leftover catalog, S3 get/put, Form correction, Follow Up refresh, and Booked reconciliation already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “parse leftover Granot CSV identity” story, not “a CSV CRUD parser,” and not the later apply:

1. **Parse the leftover Granot CSV download into identifiable data rows** — ask the generic util to split quoted records (BOM / CRLF already folded there; all-whitespace records already dropped there). Empty text → empty headers, empty rows, zeros. Otherwise fold the first record as headers (`job no` → `job_no`). Walk every later record. Skip a record whose cells are all trim-empty (usually already gone in the util). Map header → folded cell. If it is not a leftover data row, increment `skippedRows`. If it is, stamp `rowIndex` (the record index, header = 0) and `rowKey`, keep the folded cells. Return headers, rows, and counts: `total` is `records.length - 1` (or 0), `dataRows` is kept rows, `skippedRows` is refused records that still arrived. This function does not store S3. This function does not apply a Lead. This function does not invent a missing `job_no`.

2. **Decide whether this record is a leftover Granot data row** — fold `job_no`, `ref_no`, `phone`, `customer` with `cleanValue` (trim; empty and leftover `\u00a0` become missing). A Job Number keeps the row. A `ref_no` that matches `/^[a-f\d]{24}$/i` keeps the row. Else both phone and customer must be present. A totals row (`est_cf` filled, identity empty) is skipped. A phone-only or customer-only row is skipped. This function does not call `mongoose.isValidObjectId`. This function does not call `normalizePhoneNumberForMatch`. This function does not treat Granot `prior` / `book_date` as identity.

3. **Give the leftover data row a stable identity key** — same folds, then the first hit wins: `job:<job_no>` as typed (not `normalized_job_no`); else `ref:<24-hex ref_no>`; else `contact:<last-10-or-remaining-digits>|<lowercased email>` when both exist; else `phone:<digits>`; else `row:<lowercased customer or unknown>:<Granot no or 0>`. Phone digits: strip non-digits; 10+ keep the last 10; 1–9 keep what is left; none → missing. This function does not look up a Lead. This function does not collapse two rows that share a phone.

There is no fourth mutate operation. `cleanValue` is the exported empty-cell fold sync already reuses. `normalizePhoneKey` / `cellsToRecord` / `emptyParsed` are private folds.

## Organization

Keep one file as the screenplay for “parse the leftover Granot CSV download into identifiable data rows, skip totals and blanks, then key by Job, Mongo ref, or phone.” Generic CSV split, store, leftover catalog, S3 get/put, and Lead apply already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmCsvParserService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — parse is not a Domain Command. Do not invent a second CSV-split **adapter** beside `parseCsvRecords`. Do not invent a second ObjectId **adapter** beside `isObjectIdString` / `mongoose.isValidObjectId` (name the regex mismatch; do not silently switch). Do not invent a second phone **adapter** beside `normalizePhoneNumberForMatch`.

Do not move this into `sync.service.ts` so “apply owns identity.” Do not move this into `upload.service.ts` so “store owns counts.” Do not move this into `src/utils/csvParse.ts` so “one CSV parser.” Do not move row keys into enrichment or reconciliation so “the write owns `row_id`.” Do not split `parse.ts` / `validate.ts` / `key.ts`. Do not silently require `job_no` so “CSV equals the extension.” Do not silently teach the data-row gate to use `mongoose.isValidObjectId` so “parse and sync share one ObjectId test.”

**External interface** stays small (this is the test surface). Parse, data-row gate, and row key are one story’s leftover identity, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseGranotCsv` | `parseTheLeftoverGranotCsvDownloadIntoIdentifiableDataRows` | upload counts + sync walk; barrel |
| `cleanValue` | `foldTheLeftoverGranotCsvCell` | sync Form match / `prior` / `stringCell`; not on the barrel |

Keep the old names as one-line aliases until upload, sync, and the barrel migrate. Do not make callers learn `isGranotDataRow` / `buildRowKey` / `rowIndex` as the domain language.

**Principle: old exports stay as aliases.** `parseGranotCsv` and `cleanValue` remain the imported names until store and apply point at the story names.

**No class for the workflow.** The type that *does* earn a name is the leftover data row we hand from the gate to the key:

```ts
type LeftoverGranotCsvDataRow = {
  rowIndex: number
  rowKey: string
  // today's folded cells (job_no, ref_no, customer, phone, email, …)
}
```

That is the handoff from “this record is a leftover Granot data row” to “store may count it; apply may walk it.” Do **not** put `leadId` / `quoted` / `cubic_feet` on that object so “parse can apply,” do **not** add `normalized_job_no` so “CSV equals lifecycle identity,” and do **not** add `is_form_lead` so “parse steals sync’s ObjectId test.”

`GranotCsvRecord` / `GranotCsvDataRow` / `ParsedGranotCsv` stay on sibling `types.ts` until that module’s skip. Do not move the parse card here “so the parser owns its type.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// parser.ts
// We have leftover Follow Up or Booked CSV text.
// Split the file. Fold headers so job no becomes job_no.
// Skip blank lines and Granot total rows.
// A leftover data row has a Job Number,
// or a 24-hex Mongo ref_no,
// or a phone plus a customer name.
// Key by Job, then Mongo ref, then phone plus email, then phone,
// then customer plus Granot no.
// Count what we saw, kept, and skipped.
// This file does not store S3.
// This file does not apply a Lead.
// This file does not invent a missing Job Number.

// ── 1. Parse the leftover Granot CSV into identifiable data rows ─

export function parseTheLeftoverGranotCsvDownloadIntoIdentifiableDataRows(csvText)

function splitTheQuotedCsvRecords(csvText)            // sibling util; already drops all-whitespace records
function foldTheLeftoverHeaders(firstRecord)          // job no → job_no
function skipARecordWhoseCellsAreAllEmpty(cells)      // usually already gone in the util
function mapFoldedHeadersOntoFoldedCells(headers, cells)
function countWhatWeSawKeptAndSkipped(records, rows, skippedRows)

// ── 2. Decide whether this record is a leftover Granot data row ─

function decideWhetherThisRecordIsALeftoverGranotDataRow(record)
  // job_no keeps it
  // 24-hex ref_no keeps it
  // else phone AND customer
  // totals / phone-only / customer-only are skipped

export function foldTheLeftoverGranotCsvCell(value)    // trim; empty and leftover nbsp → missing

// ── 3. Give the leftover data row a stable identity key ────

function giveTheLeftoverGranotCsvRowAStableIdentityKey(record)
  // job:<as typed>
  // else ref:<24-hex>
  // else contact:<digits>|<email>
  // else phone:<digits>
  // else row:<customer or unknown>:<no or 0>

function foldTheLeftoverPhoneForARowKey(value)         // last 10 when long; leftover short digits kept
```

Read the primary path out loud: *Split the leftover Granot CSV. Fold the headers. Skip blanks and totals. Keep a row that has a Job Number, or a 24-hex Mongo ref, or a phone plus a customer. Key it by Job, then Mongo ref, then phone plus email, then phone, then customer plus Granot no. Count what we saw. Stop. Do not store S3. Do not apply a Lead. Do not invent a Job Number the file omitted.*

That is the operation. `parseGranotCsv` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Blank-row skip is mostly dead.** `parseCsvRecords` already drops records where every cell trims empty. The test’s `,,,,,,` line never reaches this file. `skippedRows` then counts only totals / identity-less records that still arrived (the `,,,,,,1200` fixture). Name the util drop (`splitTheQuotedCsvRecords`) vs this file’s skip (`skipARecordWhoseCellsAreAllEmpty`). Do not delete the local skip in this rename so “the util already did it” — a quoted space-only cell can still arrive.

2. **`cleanValue`’s leftover `\u00a0` check is late.** `normalizeCsvCell` already turns nbsp into a space and trims before `cellsToRecord`. After parse, `cleanValue("\u00a0")` is only live if a caller passes a raw cell (sync does `cleanValue(String(row.x ?? ""))` on already-folded strings). Name the double fold. Do not silently drop the nbsp branch so “the util won.”

3. **Data-row gate and row key disagree on phone.** The gate accepts any trimmed phone plus customer — `"n/a"` keeps the row. The key then strips digits; no digits → `row:<customer>:<no>`. A 1–9 digit phone still keys `phone:<digits>` even though Lead match would ignore fewer than 8. Name `decideWhetherThisRecordIsALeftoverGranotDataRow` vs `foldTheLeftoverPhoneForARowKey`. Do not silently require 10 digits at the gate so “keys match Lead match.”

4. **24-hex regex vs `mongoose.isValidObjectId`.** This file keeps `ref_no` only on `/^[a-f\d]{24}$/i`. Sync’s `looksLikeFormLead` / `resolveFormLead` use `mongoose.isValidObjectId` (also `isObjectIdString`). A 12-character string can pass Mongoose and fail the regex. If that row also has phone + customer, parse keys it `phone:` / `contact:` and sync may still steal it as a Form `_id`. Name the mismatch. Do not switch this file to `isObjectIdString` in this rename so “one ObjectId test,” and do not tighten sync’s gate here — that is the apply story.

5. **Row key is not Lead identity and not HTTP Form identity.** `job:<as typed>` is not `normalized_job_no`. There is no exact `FormLead.ref_no` lookup. Phone last-10 is not `normalizePhoneNumberForMatch` (that helper refuses < 8 digits and keeps some international forms). Two leftover rows can share `phone:5551112222`. Do not import `leadPhoneMatching` or the HTTP matcher so “one identity ladder.”

6. **`rowIndex` is the record index, not the nth data row.** Header is 0; the first data record is 1; skipped totals still consume an index. Sync sends that number to enrichment as `row_index`. Upload ignores it and stores counts. Do not renumber kept rows as 0…n so “indexes are dense.”

7. **Counts can lie relative to the caller.** Upload prefers caller `row_count` / `data_row_count` over `parsed.counts`. Sync walks `parsed.rows` and may slice `limit` per file — `counts.dataRows` is still the full kept set. This file must not start reading upload input so “counts match the ingestion row.”

8. **Missing `job_no` is allowed.** The software rule already says current downloads omit it while the page shows Job Numbers. A Follow Up row can still be a data row via phone + customer and key `phone:` / `contact:`. Do not refuse those rows so “CSV equals the extension,” and do not invent a Job Number from the page.

9. **One test, one key.** `parser.test.ts` locks header fold, totals skip, and `job:P123`. It does not lock 24-hex `ref:`, phone + customer keep, phone-only skip, customer-only skip, `contact:` vs `phone:`, empty text, or the 24-hex vs Mongoose mismatch. Do not treat that fixture as the whole identity story.

10. **Leave sibling modules alone.** `parseCsvRecords` / `normalizeCsvHeader` / `normalizeCsvCell`, `uploadGranotCrmCsv`, `runGranotCrmCsvSync`, `isObjectIdString`, and `normalizePhoneNumberForMatch` are already the right **depth**. This file parses leftover Granot identity. Apply, store, and Lead match are different stories.

## Testing

The **interface** is the test surface: `parseTheLeftoverGranotCsvDownloadIntoIdentifiableDataRows` and `foldTheLeftoverGranotCsvCell` (today `parseGranotCsv`, `cleanValue`).

Today’s `parser.test.ts` only stubs one happy path. Replace “headers plus one Job key” with tests that name the operation:

**Parse into identifiable rows**
- Empty text → empty headers, empty rows, all counts 0.
- `job no` / `Ref No` fold to `job_no` / `ref_no`.
- A Job Number row is kept with `rowKey` `job:<as typed>` and `rowIndex` equal to its record index (header = 0).
- A totals row (`est_cf` only) increments `skippedRows` and does not appear in `rows`.
- `counts.total` is non-header records that survived the util (the all-empty `,,,,,,` line is already gone — lock that; do not expect this file to count it).
- Upload may ignore these counts when the caller sent `row_count` — that assertion belongs on the store test, not here.

**Data-row gate**
- `job_no` alone keeps the row.
- 24-hex `ref_no` without Job, phone, or customer keeps the row.
- Phone plus customer, no Job, no 24-hex ref, keeps the row.
- Phone only, or customer only, is skipped.
- A non-24-hex `ref_no` (for example 12 characters) does **not** keep the row unless phone + customer (or Job) also exist — lock the regex, do not “fix” it to `mongoose.isValidObjectId`.

**Row key**
- Job wins over a 24-hex ref on the same row.
- 24-hex ref wins over phone + customer.
- Phone + email → `contact:<last-10>|<lowercased email>`.
- Phone, no email, customer present → `phone:<digits>` (not `row:`).
- Customer, no usable phone digits → `row:<lowercased customer>:<no or 0>`.
- Does not emit `normalized_job_no` or a Lead id.

**What this file must not do**
- Does not import or call `uploadGranotCrmCsv`, `runGranotCrmCsvSync`, `updateFormLead`, `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, or `createFormLead`.
- Does not import `leadPhoneMatching` or the HTTP Form matcher.
- Does not invent a Job Number when the cell is empty.

Do **not** add a test per helper (`foldTheLeftoverHeaders`, `mapFoldedHeadersOntoFoldedCells`, `foldTheLeftoverPhoneForARowKey`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`cleanValue` stays exported because sync is a second real **adapter**, not a test leak. Prefer proving it through parse + the sync cases that already need empty `prior` / `ref_no`.

## What I would not do

- A `GranotCrmCsvParserService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `parseCsvRecords` or `trim`.
- Moving this into a CRUD folder (`parse.ts` / `validate.ts` / `key.ts` / `create.ts`) for cleanliness.
- Breaking the parse-for-counts / parse-for-walk **seam**, or silently applying a Lead from this file so “identity is useful.”
- Treating `uploadGranotCrmCsv`, `runGranotCrmCsvSync`, leftover catalog bind, HTTP collect, Form Lead Ingestion, Lead phone match, or Granot `createLeadFromGranot` as this story.
- Inventing a Domain Command `begin` / `complete` **seam** that has only one **adapter**.
- Inventing a second CSV-split **adapter** beside `parseCsvRecords`.
- Merging this leftover identity into `src/utils/csvParse.ts`, enrichment, or reconciliation so “one parser / one `row_id`.”
- Silently requiring `job_no`, or switching the ref gate to `mongoose.isValidObjectId`, so CSV equals the extension or sync.
- Silently importing `normalizePhoneNumberForMatch` so leftover keys match Lead match.
- Jumping to `crm` while this checklist still had `parser.ts` unchecked (it does not, after this pass).
- Writing a whole-folder recommendation for `granotCrmCsv`.
