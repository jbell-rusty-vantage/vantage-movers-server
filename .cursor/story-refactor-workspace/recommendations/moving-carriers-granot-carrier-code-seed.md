# For Each Owner Seed, Find The Moving Carrier By DOT And Say Whether The Granot Code Is Missing, Already Set, Would Stamp, Or Would Replace A Different Code — Never Stamp Mongo, Never Drop The Unique Index, Never Resolve A Tariff Cell — operational story

- Status: recommended
- Service: `movingCarriers` (Wave A, visited)
- Pass: 2 of this service — `granotCarrierCodeSeed.ts`
- Remaining in this service: none
- Target: `src/services/movingCarriers/granotCarrierCodeSeed.ts`
- Knowledge: none as a dedicated Service file. Closest: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only Tariff Adjustment; Carrier cell is Moving Carrier legal name + DOT looked up by `moving_carriers.granot_carrier_code`; seed stamp is `pnpm db:seed-granot-carrier-codes -- --apply`). Distinct from already-recommended [moving-carriers-moving-carrier.md](moving-carriers-moving-carrier.md) (desk list / record / correct / CSV import — **does not import** this file; identity is DOT+MC). Distinct from leftover Tariff resolve: unlisted Wave A `src/services/tariff/resolveCarrier.ts` (`resolveTariffCarrierCell` / `lookupMovingCarrierByGranotCode` — **does not import** this file). Distinct from leftover Granot-code fold: Wave B `src/config/domain/granotCarrierCodes.ts` (`GRANOT_CARRIER_CODE_SEEDS` + leftover `normalizeGranotCarrierCode` — this file **asks** both). Distinct from leftover Agent / Merchant catalog: already-recommended [catalog-catalog.md](catalog-catalog.md). Distinct from leftover Granot CSV store: already-recommended [granot-crm-csv-upload.md](granot-crm-csv-upload.md). Distinct from leftover historical planners: already-recommended [historical-consolidation-planner.md](historical-consolidation-planner.md) (frozen-sheet merge — **not** a carrier stamp). Operator `scripts/seed-granot-carrier-codes.ts` **asks** this file, then (only with `--apply`) drops `granot_carrier_code_1`, `syncIndexes`, and `$set`s `will_set` / `will_replace`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — tariff knowledge links [Moving Carrier](../../../../CONTEXT.md) and [Granot Carrier Code](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Moving Carrier Service file in this rename.
- Callers: **one runtime import site + the test file.** Operator `scripts/seed-granot-carrier-codes.ts` (`pnpm db:seed-granot-carrier-codes`) loads every `MovingCarrier` `{ dot_number, granot_carrier_code, name }`, **asks** `planGranotCarrierCodeSeed(carriers, GRANOT_CARRIER_CODE_SEEDS)`, prints counts / missing / plans, and on `--apply` stamps only `will_set` / `will_replace`. Tests: `granotCarrierCodeSeed.test.ts` (default Owner map has 21 unique codes and DOTs including `C2C` / `4168983`; default-seed plan locks `already_set` / `will_set` / `will_replace` / `missing` on four live seed DOTs). Barrel `movingCarriers/index.ts` does **not** re-export this file. Sibling `movingCarrier.service.ts` does **not** import this file. Wave B `src/routes/v1.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Unlisted `tariff/resolveCarrier.ts` does **not** import this file. Not this **interface**: `listMovingCarriers`, `createMovingCarrier`, `updateMovingCarrier`, `importMovingCarriersFromCsv`, `parseMovingCarrierCsv`, `resolveTariffCarrierCell`, leftover `normalizeGranotCarrierCode` itself, leftover `GRANOT_CARRIER_CODE_SEEDS` uniqueness as a planner contract.
- Seams callers need: report vs `--apply` (this file is report only; the script owns stamp / index drop); seed-list walk vs catalog bag (one row per seed; extra carriers never appear); DOT-only match vs sibling DOT+MC identity; folded lookup vs returned `seed.dot_number` (apply keys the raw seed DOT, not the stored catalog DOT); leftover `normalizeGranotCarrierCode` vs local DOT fold. There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Tariff-resolve **seam**. There is no CSV-import **seam**. There is no `active` **seam**. There is no Owner-actor **seam**.
- Split later (only if the file outgrows one sitting): this ~65-line file is one sitting if you read it as for each Owner seed, find the Moving Carrier by DOT and say missing / already set / would stamp / would replace. If it later splits by **story**: do not. One plan. Never `create.ts` / `update.ts` / `delete.ts` / `apply.ts` / `missing.ts`. Desk catalog stays the sibling. Stamp stays the script. Tariff cell stays unlisted `tariff/`. Seed list stays Wave B config.

`planGranotCarrierCodeSeed` is executor mechanics. The owner question is: *I have an Owner name map of Granot Carrier Codes keyed by DOT. Before anyone stamps Mongo, walk that map against the live catalog. If the DOT is gone, say missing. If the folded code already matches, say already set. If the carrier has no code, say this would stamp. If the carrier has a different folded code, say this would replace and show me the current one. Match by DOT only — not MC. This file does not write Mongo. This file does not drop the unique Granot-code index. This file does not turn a code into a Tariff Carrier cell.*

Who lists / records / imports the catalog already lives in already-recommended `movingCarrier.service.ts`. Who `$set`s `will_set` / `will_replace` already lives in `scripts/seed-granot-carrier-codes.ts`. Who paints `"{name} {dot_number}"` already lives in unlisted `tariff/resolveCarrier.ts`. Who owns the 21-row map already lives in Wave B `granotCarrierCodes.ts`. Do not pull those in.

## What this file actually does

One “plan which seed Granot codes would stamp onto the catalog by DOT” story in one sitting, not “a seed CRUD helper,” and not Record A Moving Carrier / Resolve This Tariff Carrier Cell / Stamp The Live Catalog:

1. **For each Owner seed, find the Moving Carrier by DOT and say missing, already set, would stamp, or would replace** — `planGranotCarrierCodeSeed`. Default `seeds` is leftover `GRANOT_CARRIER_CODE_SEEDS`. Fold every catalog `dot_number` through leftover local `normalizeCarrierNumber` (`trim` + strip interior space — same fold as sibling record/import, and **not** lowercase). Last catalog row with that folded DOT wins the `Map`. Then, for each seed, fold the seed code through leftover `normalizeGranotCarrierCode` and look up the folded seed DOT. No row → `missing` (seed DOT as written, folded code, no `current_code`). Folded current equals folded seed → `already_set` (`current_code` is the folded current). Non-empty folded current differs → `will_replace` (`current_code` is the folded current). Empty / omitted / whitespace-only current → `will_set` (no `current_code`). Output length is always `seeds.length`. Catalog rows whose DOT is not on the seed list never appear. `name`, `mc_number`, and `active` are not on the input type and are not consulted. This beat does **not** `$set` Mongo. This beat does **not** drop `granot_carrier_code_1`. This beat does **not** throw when any seed is `missing` (the script does). This beat does **not** **ask** leftover `resolveTariffCarrierCell`.

There is no second apply or Tariff-append operation. Local `normalizeCarrierNumber` is a fold inside story 1.

## Organization

Keep one file. This is the screenplay for “for each Owner seed, find the Moving Carrier by DOT and say what a stamp would do.” Desk catalog already lives on already-recommended `movingCarrier.service.ts`. Stamp / index drop already live on `scripts/seed-granot-carrier-codes.ts`. Tariff cell resolve already lives on unlisted `tariff/resolveCarrier.ts`. Owner map + code fold already live on Wave B `granotCarrierCodes.ts`. Sibling DOT fold is a copy of this file’s `normalizeCarrierNumber` — do not merge the files so “one helper owns numbers.” Do not invent a `GranotCarrierCodeSeedService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Mongo **adapter** so “plan can apply.” Do not invent a Tariff-append **adapter** so “a `will_set` writes Master.” Do not invent an HTTP **adapter** so “the desk can preview the seed list.” Do not invent a CRUD folder so “missing / set / replace each get a file.”

Do not move `planGranotCarrierCodeSeed` into `movingCarrier.service.ts` so “one service owns carriers.” Do not teach `importMovingCarriersFromCsv` to **ask** this file so “CSV import also stamps the seed list.” Do not teach `resolveTariffCarrierCell` to **ask** this file so “unknown codes can be seeded first.” Do not put this export on `movingCarriers/index.ts` so “every planner lives on the barrel.” Do not split `create.ts` / `update.ts` / `delete.ts` / `apply.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planGranotCarrierCodeSeed` | `planWhichSeedGranotCodesWouldStampOntoTheCatalogByDot` | script report vs `--apply`; inject `seeds` in tests |
| `GranotCarrierCodeSeedRow` | `ACatalogRowWithDotAndOptionalCode` | DOT + optional current code — no name / MC / active |
| `GranotCarrierCodeSeedPlan` | `ThisSeedStampDecision` | one row per seed; `outcome` is the owner sentence |

Keep the old names as one-line aliases until `scripts/seed-granot-carrier-codes.ts` and `granotCarrierCodeSeed.test.ts` migrate. Do not make callers learn `Map` / `normalizeCarrierNumber` / `will_replace` as the only language — the story name is the walk; the four `outcome` strings stay, because the script filters `will_set` / `will_replace` and prints `missing`. Do **not** rename those four strings. Do **not** rename persisted `dot_number` / `granot_carrier_code`. Do **not** export leftover `normalizeCarrierNumber`. Do **not** put this planner onto leftover `v1.service.ts` or the moving-carriers barrel.

**No workflow class.** The one type that *does* earn a name is the decision the script already prints and later stamps:

```ts
type ThisSeedStampDecision = {
  granot_carrier_code: string
  dot_number: string
  outcome: "missing" | "already_set" | "will_set" | "will_replace"
  current_code?: string
}
```

That is the handoff from “we folded the catalog onto DOT” to “the operator can report, or `--apply` can `$set` only `will_set` / `will_replace`.” Do **not** add `name` / `mc_number` / `active` onto `ACatalogRowWithDotAndOptionalCode` so “plan can skip inactive or match DOT+MC.” Do **not** add a session or a spreadsheet id onto `planWhichSeedGranotCodesWouldStampOntoTheCatalogByDot` so “a `will_set` writes Master.” Do **not** add `updated` / `apply` onto `ThisSeedStampDecision` so “the planner owns the stamp.”

Leave the desk catalog on already-recommended `movingCarrier.service.ts`. Leave `--apply` on the script. Leave Tariff resolve on unlisted `tariff/resolveCarrier.ts`. Leave `GRANOT_CARRIER_CODE_SEEDS` on Wave B config.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotCarrierCodeSeed.ts
// The owner has a name map of Granot Carrier Codes keyed by DOT.
// Before anyone stamps Mongo, walk that map against the live catalog.
// Missing DOT → say missing.
// Same folded code → say already set.
// No code → say this would stamp.
// Different folded code → say this would replace, and show the current one.
// Match by DOT only — not MC.
// Do not write Mongo.
// Do not drop the unique Granot-code index.
// Do not turn a code into a Tariff Carrier cell.

// ── 1. For each Owner seed, find the Moving Carrier by DOT ──

export function planWhichSeedGranotCodesWouldStampOntoTheCatalogByDot(
  carriers,
  seeds = GRANOT_CARRIER_CODE_SEEDS,
)

function foldTheCatalogOntoDot(carriers)             // last folded DOT wins
function foldTheSeedCode(seed)                       // leftover normalizeGranotCarrierCode
function findTheCarrierByFoldedDot(byDot, seed)
function sayThisSeedDotIsMissing(seed, code)
function sayThisSeedCodeIsAlreadySet(seed, code, current)
function sayThisWouldReplaceADifferentCode(seed, code, current)
function sayThisWouldStampTheEmptyCode(seed, code)

export function planGranotCarrierCodeSeed(...)       // leftover alias
```

Read the plan path out loud: *Fold every catalog DOT. Last row with that folded DOT wins. For each Owner seed, fold the seed code and look up the folded seed DOT. No carrier → missing. Folded current equals folded seed → already set. A different non-empty current → would replace. Empty current → would stamp. Hand back one decision per seed. Extra catalog rows stay off the page. Do not write. Do not drop the index. Do not resolve a Tariff cell.*

That is the operation. `planGranotCarrierCodeSeed` is not a different story. The four `outcome` strings are beats, not four files.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Match is DOT only, not DOT+MC.** Sibling record / CSV identity is `"{dot}::{mc}"`. This walk keys folded DOT. The model also uniques `dot_number` alone, so live Mongo should have one row per DOT. Do **not** add MC onto the lookup so “seed plan matches import,” and do **not** silently drop the field-level DOT unique in this rename.

2. **Last catalog row with that folded DOT wins.** `new Map(carriers.map(...))` overwrites. The script’s `find({})` can still hand two rows if the unique was never applied. The planner does not warn. Do not “fix” last-wins into a `conflict` outcome so “duplicate DOTs are visible” without a product path.

3. **Returned `dot_number` is the seed’s raw string, not the catalog’s stored DOT.** Lookup folds both sides. `ThisSeedStampDecision.dot_number` is `seed.dot_number`. The script `--apply` then `updateOne({ dot_number: plan.dot_number })`. A catalog row stored as `"188 3785"` can plan `will_set` and still miss the update. Do not change the returned DOT to the stored catalog value so “apply always hits” in this rename — lock the raw-seed return on this **interface**, or change the script in a separate, tested pass.

4. **`current_code` is omitted on `will_set` and `missing`.** `already_set` and `will_replace` echo the folded current. Empty / omitted / `"   "` current folds to `""` and becomes `will_set` with no `current_code`. Do not echo `""` so “every row has the field,” and do not treat whitespace-only as `already_set` against a blank seed.

5. **The seed list drives the walk.** Extra catalog rows never appear. A carrier whose Granot code is not on the Owner map cannot be audited here. Do not invert the walk so “every catalog code is explained,” and do not add an `unknown_catalog_code` outcome so “plan owns drift.”

6. **`active` is invisible.** The input type has no `active`. The script loads `find({})`, so a deactivated carrier still plans `will_set` / `will_replace` and `--apply` still stamps it. Do not skip inactive rows so “seed only touches the desk’s default list,” and do not add `include_inactive` so “this planner matches list.”

7. **`name` is selected by the script and ignored here.** The planner never paints `"{name} {dot_number}"`. That cell is leftover `formatTariffCarrierCell`. Do not add `name` onto `ThisSeedStampDecision` so “report can show the legal name,” unless the script is a later, tested pass.

8. **Leftover DOT fold is a copy of the sibling’s `normalizeCarrierNumber`.** Same `trim` + strip interior space. Do not extract a shared `src/utils` number fold so “one helper owns DOT,” and do not import the sibling’s private function so “the catalog file owns seed plan.”

9. **Code fold already lives on Wave B config.** This file **asks** leftover `normalizeGranotCarrierCode`. Do not copy `toUpperCase` here so “the planner does not import config,” and do not move `GRANOT_CARRIER_CODE_SEEDS` into this file so “one module owns the Owner map.”

10. **Default-seed uniqueness is a config lock living in this test file.** Today’s first test asserts 21 unique codes and DOTs plus `C2C` / `4168983`. That is leftover `GRANOT_CARRIER_CODE_SEEDS`, not the planner. Keep one default-map assertion until Wave B config is visited. Do not treat `21` as this **interface** — injected `seeds` may be four rows.

11. **The outcome test couples to the live Owner map.** `4168983` / `1883785` / `3453793` / `4570153` are real seed DOTs. If the map drops `GUTZ`, `missing` fails. Inject a four-row `seeds` argument so the planner is the **interface**. Do not delete the default-map uniqueness test in the same breath unless Wave B already owns it.

12. **The script throws on any `missing`, drops the unique index, then stamps.** Report mode still exits non-zero when `counts.missing > 0`. `--apply` `dropIndex("granot_carrier_code_1")` + `syncIndexes()` + `updateOne` is **not** this file. Do not pull those side effects here so “plan can apply.” Do not swallow `missing` inside the planner so “report always exits 0.”

13. **Leave the desk catalog and Tariff resolve alone.** Sibling import stamps a code only when the CSV cell has one, and never from this map. `resolveTariffCarrierCell` looks up `{ granot_carrier_code }` and paints the cell. This file never **asks** either. Do not write a whole-folder movingCarriers recommendation — this was the last unchecked module.

14. **Do not invent an HTTP preview.** There is no `GET /api/v1/admin/moving-carriers/seed-plan`. The operator script is the **adapter**. Do not teach `listMovingCarriers` a `seed_outcome` so “the desk shows will_replace.”

15. **Do not silently add apply, MC match, or Tariff append.** `will_set` is a sentence, not a write. Do not call `updateMovingCarrier` so “stamp goes through the catalog story,” and do not call `appendTariffAdjustmentRows` so “a new code is immediately usable on Master.”

## Testing

The **interface** is the test surface: `planWhichSeedGranotCodesWouldStampOntoTheCatalogByDot`. The four `outcome` strings, returned seed DOT, folded seed code, optional `current_code`, last-wins DOT, and “extra catalog rows stay off the page” are part of that **interface**.

Today’s `granotCarrierCodeSeed.test.ts` locks leftover `GRANOT_CARRIER_CODE_SEEDS` uniqueness, then **asks** the default map with three catalog rows and finds four live seed DOTs. Injected `seeds`, DOT whitespace, code case, last-wins, whitespace-only current, and “extra rows ignored” are missing. That is not enough for the plan the operator script stamps from.

Replace the live-DOT-as-interface tests with tests that name the operation:

**For each Owner seed, find the Moving Carrier by DOT and say missing, already set, would stamp, or would replace**
- Inject four seeds. Catalog has matching folded code → `already_set` and `current_code` is the folded current.
- Catalog row with no `granot_carrier_code` / `null` / `""` / `"   "` → `will_set` and no `current_code`.
- Catalog row with a different folded code (`"old"` vs seed `"NEW"`) → `will_replace`, `current_code` is `"OLD"`, `granot_carrier_code` is `"NEW"`.
- Seed DOT absent from the bag → `missing`, no `current_code`, `dot_number` is the seed’s raw string.
- `" 1883785 "` in the catalog matches seed `"1883785"` (DOT fold). `" c2c "` current matches seed `"C2C"` (code fold).
- Two catalog rows with the same folded DOT → last row’s current code wins.
- Catalog row whose DOT is not on `seeds` does not appear. Output length equals `seeds.length`.
- Returned `dot_number` stays the seed’s raw string even when the catalog stored a spaced DOT.
- Does not call `MovingCarrier.updateOne`, does not drop an index, does not call `resolveTariffCarrierCell`.
- Keep one default-map assertion (unique codes, unique DOTs, includes `C2C` / `4168983`) until Wave B `granotCarrierCodes.ts` is visited. Do not treat `21` as a planner argument.

Do **not** add a test per helper (`foldTheCatalogOntoDot`, `sayThisWouldReplaceADifferentCode`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test sibling `importMovingCarriersFromCsv` or unlisted `resolveTariffCarrierCell` here. Do not add a Mongo apply test in this file — that gap lives on the script. Do not add Zod unknown-key tests — this file has no HTTP schema.

## What I would not do

- A `GranotCarrierCodeSeedService` class with `plan` / `apply` / `create` / `update`.
- Thirty two-line functions that only wrap `Map.get` or leftover `normalizeGranotCarrierCode`.
- Moving this into a CRUD folder, or into already-recommended `movingCarrier.service.ts` “because carriers own codes,” or into unlisted `tariff/` “because resolve reads the code,” or into Wave B `granotCarrierCodes.ts` “because the map lives there.”
- Putting `planGranotCarrierCodeSeed` on `movingCarriers/index.ts` or leftover `v1.service.ts`.
- Teaching CSV import or `listMovingCarriers` to **ask** this file.
- Inventing a before-commit / after-commit **seam**, an HTTP preview, or a Sheet Sync / Tariff-append job this plan does not have.
- Pulling `scripts/seed-granot-carrier-codes.ts` (index drop + `$set`) or `tariff/resolveCarrier.ts` (name + DOT cell) into this file.
- Matching by DOT+MC, skipping inactive rows, or returning the stored catalog DOT, without a separate product path.
- Renaming `missing` / `already_set` / `will_set` / `will_replace` — the script filters and prints those strings.
- Opening `errors` or `legacy-root` in the same pass. This was the last `movingCarriers` module.
