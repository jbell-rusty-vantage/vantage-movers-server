# Show The Desk The Moving Carriers They Asked For, Record One So Tariff Can Later Resolve Its Granot Code, Correct One Including Clearing The Code, Then Load A CSV That Patches Or Replaces The Catalog — Never Delete A Carrier, Never Resolve A Tariff Row, Never Stamp The Seed List — operational story

- Status: recommended
- Service: `movingCarriers` (Wave A, in-progress)
- Pass: 1 of this service — `movingCarrier.service.ts`
- Remaining in this service: `granotCarrierCodeSeed.ts`
- Target: `src/services/movingCarriers/movingCarrier.service.ts`
- Knowledge: none as a dedicated Service file. Closest: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only Tariff Adjustment; Carrier cell is Moving Carrier legal name + DOT looked up by `moving_carriers.granot_carrier_code`; unknown codes are 400). Distinct from leftover Tariff resolve: unlisted Wave A `src/services/tariff/resolveCarrier.ts` (`resolveTariffCarrierCell` / `lookupMovingCarrierByGranotCode` — **does not import** this file). Distinct from leftover Agent / Merchant catalog: already-recommended [catalog-catalog.md](catalog-catalog.md) (Operations Registry cards — **not** Moving Carrier). Distinct from leftover Admin Dashboard desks: already-recommended [admin-browse.md](admin-browse.md) (`form-leads` / `call-leads` / `booked-leads` / `cancelled-leads` / `customers` / `agents` — **not** `moving-carriers`). Distinct from leftover Granot CSV store: already-recommended [granot-crm-csv-upload.md](granot-crm-csv-upload.md) (S3 latest + history — **not** this catalog). Sibling seed plan lives in `granotCarrierCodeSeed.ts` (next pass; `scripts/seed-granot-carrier-codes.ts` **asks** that file, not this one). `package.json` still names `pnpm db:ingest-moving-carriers` → `scripts/ingest-moving-carriers.ts`; **that script is not on this checkout**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — tariff knowledge links [Moving Carrier](../../../../CONTEXT.md) and [Granot Carrier Code](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Moving Carrier Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`GET /api/v1/moving-carriers` **and** `GET /api/v1/admin/moving-carriers` → same `listMovingCarriers`; `POST /api/v1/admin/moving-carriers` → `createMovingCarrier`; `PATCH /api/v1/admin/moving-carriers/:id` → `updateMovingCarrier`; `POST /api/v1/admin/moving-carriers/import` → `importMovingCarriersFromCsv`). Barrel: `movingCarriers/index.ts` (re-exports the four writes/reads **and** `parseMovingCarrierCsv`). Tests: `movingCarrier.service.test.ts` (name-fold whitespace; CSV header aliases + in-file DOT+MC duplicate; in-file Granot-code duplicate; stubbed list `q` + default `active`; stubbed patch import create + reactivate; stubbed replace deactivate). `createMovingCarrier` and `updateMovingCarrier` have **no** test. `v1.service.ts` does **not** re-export this file. `adminBrowse.service.ts` does **not** import this file. Sibling `granotCarrierCodeSeed.ts` is **not** imported here. Unlisted `tariff/resolveCarrier.ts` queries `MovingCarrier` directly. Operator `scripts/seed-granot-carrier-codes.ts` **asks** the sibling planner. Not this **interface**: `planGranotCarrierCodeSeed`, `resolveTariffCarrierCell`, `browseAdminResource`, leftover `listCatalogItems`, leftover `uploadGranotCrmCsv`.
- Seams callers need: public list vs admin list are the **same** card (Granot code stays on both); omitted `include_inactive` is “active only” (Zod `active` defaults `true`), not “only live copy unless they sent `published`”; page (`items` + `total` + `has_next_page`) vs CSV apply result (`created` / `updated` / `deactivated` / `skipped` / `errors`); empty-string Granot code on PATCH unsets, omitted code leaves it; CSV parse vs apply (parse is exported today only because the test file and the barrel treat it as the **interface**). There is no delete **seam**. There is no begin / complete Domain Command **seam**. There is no Tariff-resolve **seam**. There is no Sheet Sync **seam**. There is no Owner-actor **seam** (routes sit behind `x-api-secret` only). There is no seed-stamp **seam**.
- Split later (only if the file outgrows one sitting): this ~460-line file is one sitting if you read it as show the desk the Moving Carriers they asked for — record one so Tariff can later resolve its Granot code — correct one including clearing the code — load a CSV that patches or replaces the catalog. If it later splits by **story**: `showTheDeskTheMovingCarriersTheyAskedFor.ts` / `loadMovingCarriersFromACsvThatPatchesOrReplacesTheCatalog.ts` — never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `import.ts`. Tariff resolve stays unlisted `tariff/`. Seed plan stays the sibling.

`listMovingCarriers` / `createMovingCarrier` / `updateMovingCarrier` / `importMovingCarriersFromCsv` are executor mechanics. The owner question is: *I need a Moving Carrier catalog so a later Tariff Adjustment can turn a Granot Carrier Code into a legal name and DOT. Show me the page I filtered — default active only. Let me record one by name, DOT, and MC, and optionally stamp a Granot code. Let me correct one, including clearing that code with an empty string. Let me load a CSV: patch creates missing rows, refreshes the name, reactivates, and stamps a code when the file has one; replace then deactivates every active carrier whose DOT+MC is missing from the file. Identity is DOT plus MC. A second Granot code is 409. This file does not delete a carrier. This file does not write the Tariff spreadsheet. This file does not stamp the seed list.*

Who turns a Granot code into `"{name} {dot_number}"` already lives in unlisted `tariff/resolveCarrier.ts`. Who plans `will_set` / `will_replace` against `GRANOT_CARRIER_CODE_SEEDS` already lives in sibling `granotCarrierCodeSeed.ts`. Do not pull those in.

## What this file actually does

Four “keep the Moving Carrier catalog that Tariff later resolves” stories in one sitting, not “a moving-carrier CRUD service,” and not Resolve This Tariff Carrier Cell:

1. **Show the desk the Moving Carriers they asked for** — `listMovingCarriers`. Public `GET /api/v1/moving-carriers` and admin `GET /api/v1/admin/moving-carriers` share this beat and the same card. Fold `include_inactive !== true` into `active: query.active` (Zod defaults `active: true`). `include_inactive: true` drops the active flag entirely — even if the caller also sent `active: false`. `q` is regex-escaped and `$or`s `name`, `normalized_name`, `dot_number`, `mc_number`, `granot_carrier_code`. Sort is always `name`, then `dot_number`, then `mc_number` (asc). Page and count in the same moment. `has_next_page` is `skip + docs.length < total`. The card includes `granot_carrier_code` when present, plus `id` / `_id` (same string), `created_from`, timestamps when they are `Date`s. `active` on the card is `=== true`. This beat does **not** hide the Granot code from the public list. This beat does **not** populate a Customer. This beat does **not** write Mongo.

2. **Record a Moving Carrier so Tariff can later resolve its Granot code** — `createMovingCarrier`. Fold display name (trim + collapse interior space), `normalized_name` (that fold, then lowercase), DOT / MC (trim + strip interior space). Optional Granot code goes through leftover `normalizeGranotCarrierCode`; blank becomes omitted. `active` defaults `true`. `created_from` trims or becomes `"admin"`. Mongo `11000` on `granot_carrier_code` → 409 `"Granot Carrier Code already in use"`. Any other `11000` with DOT+MC on the payload → 409 `"Moving carrier already exists for DOT {dot} and MC {mc}"`. This beat does **not** append a Tariff row. This beat does **not** open a Domain Command.

3. **Correct a Moving Carrier, including clearing its Granot code** — `updateMovingCarrier`. Partial `$set` / `$unset`. Empty-string `granot_carrier_code` unsets the field. Omitted code leaves it. Missing id → 404 `"Moving carrier not found"`. Same 409 mapping as record, except a DOT+MC collision without payload numbers says `"Moving carrier already exists for that DOT and MC"`. This beat does **not** refuse a booked Lead (carriers have no booking flag). This beat does **not** delete the document.

4. **Load Moving Carriers from a CSV that patches or replaces the catalog** — `importMovingCarriersFromCsv`. Parse first (story-4 fold). Identity is `"{dot}::{mc}"`. For each valid row: missing DOT+MC → create `active: true`, `created_from: "csv_import"`, Granot code only when the row has one; existing → refresh name / `normalized_name`, force `active: true`, stamp Granot code only when the row has one **and** it differs. Then, if `mode === "replace"` and the file had at least one identity, every **currently active** carrier whose DOT+MC is not in that set is deactivated. Patch never deactivates. This beat does **not** unset a Granot code from a blank CSV cell. This beat does **not** change DOT or MC on an existing row. This beat does **not** wrap the loop in a transaction — a mid-file `11000` throws and leaves earlier creates/updates in place, and replace-deactivate never runs.

There is no fifth delete or Tariff-append operation. `parseMovingCarrierCsv` / `normalizeCarrierName` / `buildMovingCarrierFilter` are fold beats inside stories 1 and 4. The first two are exported today only because the test file and the barrel treat them as the **interface** — that is a leak, not a second owner story.

## Organization

Keep one file. This is the screenplay for “show the desk the Moving Carriers they asked for, then keep the catalog Tariff later resolves.” Tariff cell resolve already lives in unlisted `tariff/resolveCarrier.ts`. Seed plan already lives in sibling `granotCarrierCodeSeed.ts`. CSV cell/header parse already lives in `src/utils/csvParse`. Granot-code fold already lives in `src/config/domain/granotCarrierCodes.ts`. Zod already lives in Wave B `movingCarriers.validation.ts`. Do not pull those in. Do not invent a `MovingCarrierService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Tariff-append **adapter** so “create can write Master.” Do not invent a Sheet Sync **adapter** so “a Granot code can project.” Do not invent an Owner-actor **seam** this route does not have. Do not invent a CRUD folder so “list / create / update / import each get a file.”

Do not move `resolveTariffCarrierCell` into this file so “one service owns carriers.” Do not teach `adminBrowse.service.ts` a `moving-carriers` resource so “one desk owns every collection.” Do not merge sibling `planGranotCarrierCodeSeed` so “import can also stamp the seed list.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `import.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listMovingCarriers` | `showTheDeskTheMovingCarriersTheyAskedFor` | public GET and admin GET share this card |
| `createMovingCarrier` | `recordAMovingCarrierSoTariffCanLaterResolveItsGranotCode` | admin POST; unique DOT+MC and unique Granot code |
| `updateMovingCarrier` | `correctAMovingCarrierIncludingClearingItsGranotCode` | admin PATCH; empty string unsets the code |
| `importMovingCarriersFromCsv` | `loadMovingCarriersFromACsvThatPatchesOrReplacesTheCatalog` | admin import; patch vs replace deactivate |
| `MovingCarrierItem` | `MovingCarrierCard` | same card on public list, admin list, create, patch, and import items |
| `ListMovingCarriersResult` | `MovingCarrierPage` | `items` + `page` + `limit` + `total` + `has_next_page` |
| `MovingCarrierImportResult` | `MovingCarrierCsvApplyResult` | counts + skipped errors + imported cards |
| `parseMovingCarrierCsv` | leftover parse leak | tests + barrel only — unexport after the test migrates |
| `normalizeCarrierName` | leftover name-fold leak | tests only — unexport after the test names record/import |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `movingCarriers/index.ts`, and `movingCarrier.service.test.ts` migrate. Do not make callers learn `$or` / `identityKey` / `$unset` as the domain language. Do **not** keep the parser as a public **seam** after the test moves onto import. Do **not** put `listMovingCarriers` onto leftover `v1.service.ts` so “every public list lives on the barrel.” Do **not** add a public-only card that hides `granot_carrier_code` so “the site cannot leak codes” — both GETs already share this card. Do **not** rename persisted `dot_number` / `mc_number` / `granot_carrier_code`.

**No workflow class.** The one type that *does* earn a name is the catalog card the desk already paints:

```ts
type MovingCarrierCard = {
  id: string
  _id: string
  name: string
  normalized_name: string
  dot_number: string
  mc_number: string
  granot_carrier_code?: string
  active: boolean
  created_from: string
  createdAt?: Date
  updatedAt?: Date
}

type MovingCarrierCsvApplyResult = {
  mode: "patch" | "replace"
  total_rows: number
  valid_rows: number
  created: number
  updated: number
  deactivated: number
  skipped: number
  errors: Array<{ row: number; message: string }>
  items: MovingCarrierCard[]
}
```

That is the handoff from “we folded name / DOT / MC / optional Granot code” to “the desk can pick a carrier and Tariff can later resolve the code.” Do **not** add a session or a spreadsheet id onto `recordAMovingCarrierSoTariffCanLaterResolveItsGranotCode` so “create writes Master.” Do **not** add `items` onto the page that omit `granot_carrier_code` so “public GET matches testimonials.”

Leave Tariff resolve on unlisted `tariff/resolveCarrier.ts`. Leave seed plan on sibling `granotCarrierCodeSeed.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// movingCarrier.service.ts
// The desk needs a Moving Carrier catalog
// so a later Tariff Adjustment can turn a Granot Carrier Code
// into a legal name and DOT.
// Show the page they filtered — default active only.
// Record one by name, DOT, and MC, and optionally stamp a code.
// Correct one, including clearing that code with an empty string.
// Load a CSV: patch creates, refreshes, reactivates;
// replace then deactivates anyone missing from the file.
// Identity is DOT plus MC.
// A second Granot code is 409.
// Do not delete a carrier.
// Do not write the Tariff spreadsheet.
// Do not stamp the seed list.

// ── 1. Show the desk the Moving Carriers they asked for ──

export async function showTheDeskTheMovingCarriersTheyAskedFor(query)

function foldOnlyTheFlagsTheDeskSent(query)          // include_inactive drops active; else query.active
function escapeTheCarrierSearch(q)                   // regex-escape; $or name / folded / DOT / MC / code
async function pullTheNameSortedCarrierPage(filter, skip, limit)
async function countEveryMatchingCarrier(filter)
function paintTheMovingCarrierCard(doc)              // hide empty Granot code; active === true
function skipPlusPageLengthMeansThereIsAnotherPage(skip, docs, total)

// ── 2. Record a Moving Carrier so Tariff can later resolve its Granot code ──

export async function recordAMovingCarrierSoTariffCanLaterResolveItsGranotCode(input)

function foldTheCarrierIdentity(input)               // display name, folded name, DOT, MC, optional code
function defaultCreatedFromAdmin(value)              // trim or "admin"
async function writeTheMovingCarrier(payload)
function refuseADuplicateCarrier(error, payload)     // Granot code 409 vs DOT+MC 409

// ── 3. Correct a Moving Carrier, including clearing its Granot code ──

export async function correctAMovingCarrierIncludingClearingItsGranotCode(id, patch)

function assignTheGranotCodeOrClearIt(value, set, unset)  // "" → $unset; omit → leave
async function persistTheCorrection(id, set, unset)       // 404 if missing; same 409 mapping

// ── 4. Load Moving Carriers from a CSV that patches or replaces the catalog ──

export async function loadMovingCarriersFromACsvThatPatchesOrReplacesTheCatalog(input)

function readTheCarrierCsvOrRefuseEmpty(csvText)     // leftover parse leak today
function refuseARowMissingNameDotOrMc(row)
function refuseADuplicateIdentityInThisFile(dot, mc)
function refuseADuplicateGranotCodeInThisFile(code)
async function createTheMissingCarrierFromThisRow(row)    // active, created_from csv_import
async function refreshTheExistingCarrierFromThisRow(doc, row)  // name / reactivate / stamp code if present
async function deactivateActiveCarriersMissingFromThisFile(identityKeys)  // replace only

export function parseMovingCarrierCsv(csvText)       // leftover — unexport after tests move
export function normalizeCarrierName(name)           // leftover — unexport after tests move
```

Read the CSV path out loud: *Read the file or refuse empty. Fold headers so Carrier Name / DOT / MC / Granot Carrier Code (or `agent`) land. Skip a row that is missing name, DOT, or MC. Skip a second DOT+MC in this file. Skip a second Granot code in this file. For each valid row, find by DOT+MC: missing becomes a new active `csv_import` carrier; present refreshes the name, forces active, and stamps a code only when the file has one. If this was replace and the file had any identity, deactivate every active carrier whose DOT+MC never appeared. A Mongo duplicate throws and stops the rest.*

That is the operation. `importMovingCarriersFromCsv` is not a different story. `parseMovingCarrierCsv` is not the **interface**.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Public list and admin list are the same card.** Both GETs call `showTheDeskTheMovingCarriersTheyAskedFor`. `granot_carrier_code` stays on the public page. Do **not** invent a Main-Site-style hide so “codes cannot leak,” and do **not** teach `adminBrowse.service.ts` a `moving-carriers` resource so “one desk owns every collection.”

2. **`include_inactive: true` drops `active`, it does not invert it.** Zod still defaults `active: true`. `include_inactive: true` plus `active: false` still returns inactive **and** active. Do not AND them so “both flags work,” and do not default `{ active: true }` inside the service so Zod’s default is ignored.

3. **Import identity is DOT+MC, but the model also uniques DOT alone and MC alone.** Compound `{ dot_number, mc_number }` is the story the CSV tells. Field-level `unique: true` on each number means a second carrier with the same DOT and a different MC still `11000`s. `refuseADuplicateCarrier` then says “already exists for that DOT and MC” even when only one field collided. Do **not** silently drop the field-level uniques in this rename. Lock the lying 409 on this **interface**, or change the model in a separate, tested pass.

4. **CSV-internal duplicates skip; Mongo duplicates throw.** A second `1883785` / `679114` **in the file** is `skipped` + an error row and the apply continues. A second `1883785` / `679114` **already in Mongo under a race, or a Granot-code clash** throws 409 and stops the file. Replace-deactivate never runs after that throw. Do not “fix” the throw into a per-row skip so “import always finishes,” and do not wrap the loop in a transaction so “replace is atomic” without a product path.

5. **CSV never clears a Granot code.** PATCH empty string `$unset`s. A blank `Granot Carrier Code` cell becomes `undefined` and leaves the existing code. Do not treat blank as unset so “patch and import match,” and do not stamp `GRANOT_CARRIER_CODE_SEEDS` from a missing column so “import owns the seed list.”

6. **CSV never changes DOT or MC on an existing row.** Find is `{ dot_number, mc_number }`. Name / folded name / `active: true` / optional new Granot code are the only updates. Do not re-key identity from a later column so “ops can fix a typo in the file.”

7. **Replace deactivates every active carrier missing from this file.** Not “missing from this source company.” Not “created_from csv_import only.” A one-row replace file deactivates the rest of the catalog. Do not scope deactivate to `created_from: "csv_import"` so “hand-entered carriers survive,” unless a later product path says so.

8. **`updated` counts a save, not a material change check after `set`.** Name change, reactivate, or Granot stamp each increment. An existing row with no `updates` is still pushed onto `items` and is **not** counted as updated. Do not count those unchanged rows as updated so “items.length === created + updated.”

9. **Parser header aliases include `agent` as Granot code.** `granot_carrier_code` / `granot_code` / `agent` all fold through leftover `normalizeGranotCarrierCode`. Do not drop `agent` so “the column name is honest,” and do not treat `agent` as an Agent catalog id so “carriers join Registry.”

10. **`parseMovingCarrierCsv` and `normalizeCarrierName` are a test leak.** Runtime caller of parse is import. Runtime callers of the name fold are record / correct / parse. Unexport both after the test names the four stories. Do not add a third HTTP route that accepts a raw parsed-row array.

11. **Record and import-create copy the 409 mapping.** One story, two **adapters** (admin POST vs CSV row). Shared beats: fold identity, write, refuse duplicate. Only `created_from` (`admin` vs `csv_import`) and “code omitted vs code present” differ. Do not split them into `create.ts` / `importCreate.ts`.

12. **`createMovingCarrier` and `updateMovingCarrier` are untested.** Today’s stubs never call `create` / `findByIdAndUpdate`. Lock 409 Granot vs 409 DOT+MC, 404 `"Moving carrier not found"`, and empty-string unset on this **interface**. Do not treat the import create stub as POST proof.

13. **`package.json` names a missing ingest script.** `pnpm db:ingest-moving-carriers` points at `scripts/ingest-moving-carriers.ts`. That file is not in this checkout. Do not invent the script so the package map “wins,” and do not teach import to read a disk path so “the script can come back.”

14. **Leave Tariff resolve and the seed planner alone.** `resolveTariffCarrierCell` looks up `{ granot_carrier_code }` and paints `"{name} {dot_number}"`. Sibling `planGranotCarrierCodeSeed` matches seeds by DOT only. This file never **asks** either. Wave A will recommend `granotCarrierCodeSeed.ts` next. Do not write a whole-folder movingCarriers recommendation.

15. **Do not treat leftover Agent catalog or Admin Dashboard desks as this story.** Already-recommended catalog is Registry Agents / Merchants. `browseAdminResource` has no `moving-carriers` resource. `GET /api/v1/admin/moving-carriers` is this file, not `GET /api/v1/admin/{resource}`. Do not teach this file `database_scope`.

16. **Do not silently add delete or Tariff append.** There is no DELETE route. Deactivate is PATCH `active: false` or replace-import. Do not invent `removeThisMovingCarrier` so “CRUD is complete,” and do not call `appendTariffAdjustmentRows` so “a new code is immediately usable on Master.”

## Testing

The **interface** is the test surface: `showTheDeskTheMovingCarriersTheyAskedFor`, `recordAMovingCarrierSoTariffCanLaterResolveItsGranotCode`, `correctAMovingCarrierIncludingClearingItsGranotCode`, `loadMovingCarriersFromACsvThatPatchesOrReplacesTheCatalog`. The card, `has_next_page`, 409 / 404, empty-string unset, and patch-vs-replace counts are part of that **interface**.

Today’s `movingCarrier.service.test.ts` stubs `find` / `findOne` / `create` / `countDocuments` and treats `parseMovingCarrierCsv` / `normalizeCarrierName` as the first assertions. List only locks `active: true` plus a `$or`. Create, patch, 409, 404, and empty-string unset are missing. That is not enough for the catalog Tariff later resolves.

Replace the parser-as-interface tests with tests that name the operation:

**Show the desk the Moving Carriers they asked for**
- Default query → `find({ active: true })`, `sort({ name: 1, dot_number: 1, mc_number: 1 })`, `countDocuments({ active: true })`.
- `include_inactive: true` → `find({})` even when `active: false` was also sent.
- `q: "188"` adds escaped `$or` on name, folded name, DOT, MC, Granot code.
- Public GET and admin GET are the same card. `granot_carrier_code` stays when present.
- `active` on the card is `false` when the document stores `false`.
- `has_next_page` is true when `skip + docs.length < total`.
- Do not pass `direction` on this export. Sort cannot flip.

**Record a Moving Carrier so Tariff can later resolve its Granot code**
- `"  ALL-ROADS   EXPRESS CORP "` + `" 1883785 "` → name `"ALL-ROADS EXPRESS CORP"`, `normalized_name` `"all-roads express corp"`, DOT `"1883785"`.
- Omitted `created_from` → `"admin"`. Omitted `active` → `true`. Blank Granot code is omitted, not `""`.
- `11000` on `granot_carrier_code` → 409 `"Granot Carrier Code already in use"`.
- `11000` otherwise → 409 naming both DOT and MC from the payload.
- Does not call `resolveTariffCarrierCell` or write a spreadsheet.

**Correct a Moving Carrier, including clearing its Granot code**
- `granot_carrier_code: ""` → `$unset: { granot_carrier_code: 1 }` and no `$set` of that field.
- Omitted `granot_carrier_code` leaves the stored code.
- Missing id → 404 `"Moving carrier not found"`.
- Do not 404 because `active` is false.

**Load Moving Carriers from a CSV that patches or replaces the catalog**
- Empty text → 400 `"CSV is empty"`.
- Header aliases `Carrier Name,DOT,MC,Granot Carrier Code` (and `agent`) fold; `" allroad "` becomes `"ALLROAD"`.
- In-file second DOT+MC → skipped + `"Duplicate carrier identity in CSV: DOT …, MC …"`; apply continues.
- In-file second Granot code → skipped + `"Duplicate Granot Carrier Code in CSV: …"`.
- Patch: missing identity creates `created_from: "csv_import"` + `active: true`; existing inactive row reactivates and refreshes the name; `deactivated === 0`.
- Existing row with the same name / already-active / no new code is listed in `items` and is **not** counted as updated.
- Blank Granot cell does **not** unset an existing code.
- Replace: active carrier whose DOT+MC is absent from the file becomes `active: false` and increments `deactivated`.
- Mongo `11000` mid-file throws 409 and does **not** run replace-deactivate.
- Do not “fix” the empty parser so the assertion can expect a transaction.

Do **not** add a test per helper (`foldTheCarrierIdentity`, `refuseADuplicateIdentityInThisFile`, `assignTheGranotCodeOrClearIt`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `planGranotCarrierCodeSeed` or unlisted `resolveTariffCarrierCell` here. Do not add Zod unknown-key tests in the service file — that gap lives on the schema. Do not re-test `browseAdminResource` or leftover catalog Agents.

## What I would not do

- A `MovingCarrierService` class with `create` / `update` / `delete` / `import`.
- Thirty two-line functions that only wrap `MovingCarrier.find` or `create`.
- Moving this into a CRUD folder, or into `admin/` “because the owner desk lists things,” or into unlisted `tariff/` “because resolve reads the code.”
- Hiding `granot_carrier_code` on the public list so it “matches testimonials.”
- Teaching `adminBrowse.service.ts` a `moving-carriers` resource, or teaching this file `database_scope`.
- Inventing a before-commit / after-commit **seam**, a DELETE route, or a Sheet Sync / Tariff-append job this catalog write does not have.
- Pulling `granotCarrierCodeSeed.ts` (seed plan) or `tariff/resolveCarrier.ts` (name + DOT cell) into this file.
- Treating a blank CSV Granot cell as `$unset`, or scoping replace-deactivate to `created_from: "csv_import"`, without a separate product path.
- Inventing `scripts/ingest-moving-carriers.ts` so `package.json` “wins.”
- Writing a whole-folder recommendation for `movingCarriers` while `granotCarrierCodeSeed.ts` is still unchecked.
