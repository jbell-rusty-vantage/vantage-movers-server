# Remember The Moving Carrier Catalog Row On The Default Mongo Connection, Unique-Index One Carrier Per DOT, One Per MC, And One Non-Empty Granot Carrier Code, And Index Folded Name Without Uniqueness — Never Resolve A Tariff Cell Here, Never Stamp The Seed List, Never Unique-Index Folded Name So Carrier Matches Merchant, Never Drop Field-Level DOT Or MC Uniques So Service Identity Matches The Schema, Never Invent A Selected-Database Getter, Never Copy Booking AutoIndex-False Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 15 of this service — `MovingCarrier.ts`
- Remaining in this service: `ExtensionUser.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/MovingCarrier.ts`
- Knowledge: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only [Tariff Adjustment](../../../../CONTEXT.md) to `TARIFF_SHEET_ID` / `Master`; Carrier is the resolved [Moving Carrier](../../../../CONTEXT.md) legal name and DOT for the [Granot Carrier Code](../../../../CONTEXT.md); lookup is `moving_carriers.granot_carrier_code`; unknown codes are 400; **not Sheet Sync**; seed stamp is `pnpm db:seed-granot-carrier-codes -- --apply`). Schema-and-CRUD rule names this collection: required `name` / `normalized_name` / `dot_number` / `mc_number` / `active` / `created_from`; optional `granot_carrier_code` (uppercase letters/numbers, unique among non-empty); empty patch unsets; duplicate code is 409; **not Operations Registry catalog**. There is **no** dedicated Moving Carrier Service file — do not add a Models Service file in this rename so “the Service sentence wins.” Already-recommended desk catalog: [moving-carriers-moving-carrier.md](moving-carriers-moving-carrier.md) (list / record / correct / CSV — identity there is DOT+MC; **this file unique-indexes DOT alone and MC alone plus a redundant compound**, **never** unique-indexes `normalized_name`). Already-recommended seed plan: [moving-carriers-granot-carrier-code-seed.md](moving-carriers-granot-carrier-code-seed.md) (`planGranotCarrierCodeSeed` matches **DOT only** — **this file never plans**, never `$set`s a code). Already-recommended Tariff resolve: [tariff-resolve-carrier.md](tariff-resolve-carrier.md) (`lookupMovingCarrierByGranotCode` **asks** `MovingCarrier.findOne({ granot_carrier_code })` with **no** `active` filter — **this file never paints** `` `${name} ${dot_number}` ``). Already-recommended Merchant row: [models-merchant.md](models-merchant.md) (unique folded name **plus** non-unique `name_aliases`; **do not copy unique folded name here**, **do not invent aliases here**). Already-recommended Booking row: [models-booked-lead.md](models-booked-lead.md) (required string `merchant` — **not** a carrier ObjectId; `autoIndex: false` — **do not copy that fence here**). Distinct from leftover Granot-code fold: Wave B `src/config/domain/granotCarrierCodes.ts` (`normalizeGranotCarrierCode` — same trim / strip space / uppercase as this file’s setter; 21-row seed list stays unused here). Distinct from leftover next login: next `ExtensionUser.ts` (unique email — **not a carrier**). Distinct from historical relax: this checkout has **no** `historical/MovingCarrier.ts` — leftover historical-consolidation **does not** `validateSync` this collection. Distinct from leftover overview / leftover health: those files **do not** count `moving_carriers`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Moving Carrier](../../../../CONTEXT.md), [Granot Carrier Code](../../../../CONTEXT.md); this checkout does **not** define them — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites `docs/tariff-adjustment/tariff-adjustment-specification.md`; that folder is absent in this checkout — do not invent it. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no `getMovingCarrierModel`.** Already-recommended `movingCarrier.service.ts` **asks** default `MovingCarrier` for `find` / `countDocuments` / `create` / `findByIdAndUpdate` / CSV `findOne({ dot_number, mc_number })` / replace `find({ active: true })`. Already-recommended `resolveCarrier.ts` **asks** `MovingCarrier.findOne({ granot_carrier_code })` then selects `name` + `dot_number` only, lean — **no** `active` filter. Operator `scripts/seed-granot-carrier-codes.ts` **asks** `MovingCarrier.find({})` `{ dot_number, granot_carrier_code, name }`, then (only with `--apply`) `collection.dropIndex("granot_carrier_code_1")`, `syncIndexes()`, and `updateOne({ dot_number }, { $set: { granot_carrier_code } })`. Tests on the desk **interface**: `movingCarrier.service.test.ts` stubs `MovingCarrier.create` / `find` / `findOne` / `countDocuments`. Folder `tariff.service.test.ts` injects `lookup` and never hits this model. `granotCarrierCodeSeed.test.ts` does **not** import this file. There is no `MovingCarrier.test.ts`. Nobody leftover-inspects leftover `MovingCarrier.schema.indexes()`. Leftover overview / leftover health / leftover historical-consolidation / leftover Registry catalog **do not** import this file. `adminBrowse.service.ts` **does not** import this file. Not this **interface**: `listMovingCarriers` itself, `createMovingCarrier` itself, `updateMovingCarrier` itself, `importMovingCarriersFromCsv` itself, `resolveTariffCarrierCell` itself, `planGranotCarrierCodeSeed` itself, leftover `normalizeGranotCarrierCode` itself.
- Seams callers need: default `MovingCarrier` (first-registered connection — desk write / Tariff code find / seed load / seed `--apply` stamp) vs already-recommended Merchant same default-export pattern vs already-recommended evidence `getCplLeadCorrectionModel` (**no default export**) vs Form selected-database getter; field-level unique `{ dot_number: 1 }` **and** `{ mc_number: 1 }` **plus** compound unique `{ dot_number, mc_number }` vs desk / CSV identity `"{dot}::{mc}"`; partial unique `{ granot_carrier_code }` where `{ $type: "string", $gt: "" }` vs setter that returns `undefined` for blank / non-string; schema `lowercase` + `trim` on `normalized_name` **when that path is set** vs leftover `normalizeCarrierName` that also collapses whitespace; schema `trim` on DOT / MC vs leftover `normalizeCarrierNumber` that also strips interior space; setter fold vs leftover `normalizeGranotCarrierCode` (same trim / strip / uppercase); Tariff find with **no** `active` filter vs desk list default-active; seed match by DOT only vs desk identity DOT+MC; `created_from` default `"admin"` vs CSV stamp `"csv_import"`; `toJSON` / `toObject` `virtuals: true` **with no virtuals declared**; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence vs seed `dropIndex` + `syncIndexes`. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Tariff-paint **seam**. There is no selected-database getter **seam**. There is no Operations Registry **seam**.
- Split later (only if the file outgrows one sitting): this ~50-line file is one sitting if you read it as remember the Moving Carrier catalog row on the default Mongo connection, unique-index one carrier per DOT, one per MC, and one non-empty Granot Carrier Code, and index folded name without uniqueness — never resolve a Tariff cell here, never stamp the seed list, never unique-index folded name so carrier matches Merchant, never drop field-level DOT or MC uniques so service identity matches the schema, never invent a selected-database getter, never copy Booking autoIndex-false without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `dot.ts` / `code.ts`. Desk write stays `movingCarrier.service.ts`. Tariff paint stays already-recommended `resolveCarrier.ts`. Seed plan stays already-recommended `granotCarrierCodeSeed.ts`. Seed `--apply` stays the script. Next login stays `ExtensionUser.ts`.

`MovingCarrier` is a Mongoose model name. The owner question is: *Owner just recorded this carrier so a later Tariff Adjustment can turn a Granot Carrier Code into a legal name and DOT. Hold the row on `moving_carriers`. Keep DOT unique, MC unique, and a non-empty Granot Carrier Code unique so a second code 409s. Index folded name for desk search without uniqueness. Fold the code on write. Tariff find does not hide an inactive carrier. Today’s live callers still use the default connection — do not invent a getter in this rename. Do not paint a Tariff cell. Do not stamp the seed list. Do not unique-index folded name. Do not drop the field-level DOT or MC uniques so “schema identity matches CSV.” Do not stamp folded name on validate. Do not copy Merchant aliases. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who list / record / correct / import already lives in already-recommended `movingCarrier.service.ts`. Who paint `` `${name} ${dot_number}` `` already lives in already-recommended `resolveCarrier.ts`. Who plan `will_set` / `will_replace` already lives in already-recommended `granotCarrierCodeSeed.ts`. Who drop `granot_carrier_code_1` and `$set` already lives in `scripts/seed-granot-carrier-codes.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Moving Carrier catalog row, unique-index one carrier per DOT, one per MC, and one non-empty Granot Carrier Code, and index folded name without uniqueness” story, not “a Moving Carrier model CRUD dump,” and not Record A Moving Carrier / Resolve This Tariff Cell / Stamp The Seed List themselves:

1. **Hold the Moving Carrier as the Tariff-resolve catalog row** — collection `moving_carriers`, timestamps, `toJSON` / `toObject` virtuals **with no virtuals declared**. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** `name_aliases`. **No** inverse Lead virtuals. Declares required `name` (trim), required `normalized_name` (trim, schema `lowercase`, **indexed not unique**), required `dot_number` (trim, **field unique**), required `mc_number` (trim, **field unique**), optional `granot_carrier_code` (trim, schema `uppercase`, setter folds trim / strip interior space / uppercase and returns `undefined` for blank or non-string), required `active` (default `true`, indexed), required `created_from` (trim, default `"admin"`). This beat does **not** invent `normalized_name` from `name`. This beat does **not** collapse whitespace on the name. This beat does **not** strip interior space on DOT / MC (schema `trim` only). This beat does **not** paint `` `${name} ${dot_number}` ``. A Tariff Adjustment may still refuse 400 when resolve find misses.

2. **Keep one carrier per DOT, one per MC, and one non-empty Granot Carrier Code — and index folded name plus active+name without uniqueness on the name** — field-level unique `{ dot_number: 1 }` and `{ mc_number: 1 }`. Compound unique `{ dot_number: 1, mc_number: 1 }` (weaker than either field unique — today’s contract, not a missing drop). Partial unique `{ granot_carrier_code: 1 }` where `{ granot_carrier_code: { $type: "string", $gt: "" } }`. Non-unique `{ normalized_name: 1 }` and `{ active: 1, name: 1 }` browse indexes. Field `active` is also indexed alone. None of the compounds are named. None have a `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Desk / CSV identity is `"{dot}::{mc}"`. This schema’s field uniques refuse a second row that shares only DOT or only MC. Seed `--apply` later drops `granot_carrier_code_1` and `syncIndexes` so the partial unique is the live one. This beat does **not** unique-index `normalized_name`. This beat does **not** find a Tariff cell from this file.

3. **Bind the default Mongo connection** — default export `MovingCarrier` is `mongoose.models.MovingCarrier ?? mongoose.model(...)`. There is **no** `getMovingCarrierModel`. There is **no** `getMongoDatabaseName()`. There is **no** `useDb`. Desk write / Tariff code find / seed load / seed `--apply` stamp **ask** the default export. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes` (the script does). This beat does **not** invent `getMovingCarrierModel` so “carrier matches Form.” This beat does **not** delete the default export so “carrier matches evidence.”

`MovingCarrierDocument` is the inferred row type. There is no status enum export. There is no named-index export.

There is no record-this-carrier-on-the-desk operation. `movingCarrier.service.ts` elects that. There is no resolve-this-Tariff-cell operation. `resolveTariffCarrierCell` elects that. There is no stamp-the-seed-list operation. The script elects that.

## Organization

Keep one file. This is the screenplay for “remember the Moving Carrier catalog row on the default Mongo connection, unique-index one carrier per DOT, one per MC, and one non-empty Granot Carrier Code, and index folded name without uniqueness — never resolve a Tariff cell here, never stamp the seed list, never unique-index folded name so carrier matches Merchant, never drop field-level DOT or MC uniques so service identity matches the schema, never invent a selected-database getter, never copy Booking autoIndex-false without a migration.” Desk write / Tariff paint / seed plan / seed `--apply` already live in deeper **modules**. Do not pull those in. Do not invent a `MovingCarrierModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getMovingCarrierModel` **adapter** so “carrier matches Form” without a paired proof that desk write, Tariff code find, seed load, and seed `--apply` still read the same `moving_carriers`. Do not invent an `autoIndex: false` **adapter** so “carrier matches Booking” without a reviewed index migration. Do not invent a unique `{ normalized_name: 1 }` **adapter** so “carrier matches Merchant.” Do not invent a `pre("validate")` that stamps `normalized_name` or strips DOT / MC so “hand insert matches desk.” Do not invent `name_aliases` so “carrier matches Merchant.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `dot.ts` / `code.ts` / `normalize.ts` each get a file.

Do not move leftover `normalizeGranotCarrierCode` into this file so “the row owns the fold.” Do not merge this file into already-recommended `Merchant.ts` so “one unique folded name owns payees and carriers.” Do not merge this file into next `ExtensionUser.ts` so “one default catalog owns logins and carriers.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `MovingCarrier` | `movingCarrierOnTheDefaultConnection` | desk write, Tariff code find, seed load, and seed `--apply` still import the default model |
| `MovingCarrierDocument` | `MovingCarrierRow` | inferred document + `_id` |

Keep the old names as one-line aliases until `movingCarrier.service.ts`, `resolveCarrier.ts`, and `scripts/seed-granot-carrier-codes.ts` migrate. Do not make callers learn `dot_number` / `granot_carrier_code` as the only language. Do **not** add `getMovingCarrierModel` so “every aggregate has a getter” — live writes already share one default **adapter**. Do **not** delete the default `MovingCarrier` export so “everyone must call a getter that does not exist.” Do **not** export a named unique-DOT catalog that this schema does not name.

**No class for the workflow.** The one type that *does* earn a name is the pending carrier-identity contract:

```ts
type MovingCarrierCatalogIdentity = {
  dot_number: { unique: true }
  mc_number: { unique: true }
  compound_dot_and_mc: { unique: true }
  granot_carrier_code: { unique: true; partial: "non_empty_string" }
  normalized_name: { unique: false; indexed: true }
}
```

That is the handoff from “this process remembered a carrier” to “a second DOT 11000s, a second MC 11000s, a second non-empty Granot Carrier Code 11000s, and folded name stays a search key without uniqueness.” Do **not** drop `{ dot_number: { unique: true } }` or `{ mc_number: { unique: true } }` onto that type so “schema identity matches CSV `{dot}::{mc}`.” Do **not** add `{ normalized_name: { unique: true } }` so “carrier matches Merchant.”

Leave already-recommended `Merchant.ts` on that file. Leave next `ExtensionUser.ts` on that file. Leave desk write on `movingCarrier.service.ts`. Leave Tariff paint on `resolveCarrier.ts`. Leave seed `--apply` on the script.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// MovingCarrier.ts
// Owner just recorded this carrier
// so a later Tariff Adjustment can turn a Granot Carrier Code
// into a legal name and DOT.
// Hold the row on moving_carriers.
// Keep DOT unique, MC unique,
// and a non-empty Granot Carrier Code unique.
// Index folded name for desk search without uniqueness.
// Fold the code on write.
// Tariff find does not hide an inactive carrier.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not paint a Tariff cell.
// Do not stamp the seed list.
// Do not unique-index folded name.
// Do not drop the field-level DOT or MC uniques
// so "schema identity matches CSV."
// Do not stamp folded name on validate.
// Do not copy Merchant aliases.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const movingCarrierOnTheDefaultConnection =
  mongoose.models.MovingCarrier ?? mongoose.model("MovingCarrier", movingCarrierSchema)

export { movingCarrierOnTheDefaultConnection as MovingCarrier }

// ── 1. Hold the Moving Carrier as the Tariff-resolve catalog row ─

const movingCarrierSchema = rememberTheMovingCarrierRow() // collection moving_carriers; default autoIndex; no virtuals declared

function rememberTheMovingCarrierRow() {
  const schema = new Schema(
    {
      name: requiredTrimmedDisplayName(),
      normalized_name: requiredFoldedNameIndexedNotUnique(), // lowercase + trim when set; not invented from name
      dot_number: requiredTrimmedDotUniqueAlone(),
      mc_number: requiredTrimmedMcUniqueAlone(),
      granot_carrier_code: optionalFoldedGranotCarrierCode(), // setter: trim, strip space, uppercase; blank → undefined
      active: requiredActiveDefaultTrueIndexed(),
      created_from: requiredOriginDefaultAdmin(),            // CSV create still stamps "csv_import"
    },
    { collection: "moving_carriers", timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
  )
  keepOneCarrierPerDotPerMcAndPerNonEmptyGranotCode(schema)
  return schema
}

function foldTheGranotCarrierCodeOnWrite(value) {
  // today's setter — same fold as leftover normalizeGranotCarrierCode
  // non-string or blank → undefined
}

// ── 2. One carrier per DOT, per MC, and per non-empty code ─

function keepOneCarrierPerDotPerMcAndPerNonEmptyGranotCode(schema) {
  // today's field-level unique dot_number
  // today's field-level unique mc_number
  // today's compound unique { dot_number, mc_number } — weaker than either field unique
  // today's partial unique granot_carrier_code among non-empty strings
  // today's non-unique normalized_name + { active, name } browse
  // none named
}

// ── 3. Default Mongo connection ───────────────────────────

// movingCarrierOnTheDefaultConnection above
```

Read the primary path out loud: *hold the Moving Carrier on `moving_carriers` with a required display name, a required folded name that is indexed not unique, a required DOT, a required MC, optional folded Granot Carrier Code, `created_from` default `"admin"`, and `active` default true. Do not invent the folded name on validate. Keep DOT unique, MC unique, and a non-empty Granot Carrier Code unique so a second code 409s. Index folded name for desk search without uniqueness. Fold the code on write. Tariff find does not hide an inactive carrier. If this process already sits on the first-registered connection, that is the model desk write, Tariff resolve, and the seed script already import. Do not paint a Tariff cell here. Do not stamp the seed list. Do not unique-index folded name. Do not invent a getter.*

That is the operation. An unnamed schema dump is not. `createMovingCarrier` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The schema unique-indexes DOT alone and MC alone. Desk / CSV identity is DOT+MC.** Field-level `unique: true` on each number means a second carrier with the same DOT and a different MC still `11000`s. The compound `{ dot_number, mc_number }` unique is weaker than either field unique — it never elects a row the field uniques would allow. Already-recommended desk `refuseADuplicateCarrier` then says “already exists for that DOT and MC” even when only one field collided. Do not drop the field-level uniques so “schema identity matches CSV `{dot}::{mc}`” without a paired proof that two live carriers may share a DOT today **or** that Tariff seed-by-DOT still elects one row. Do not drop the compound so “the weaker unique is noise.” Do not unique-index `normalized_name` so “carrier matches Merchant.”

2. **There is no validate hook — and that is today’s contract.** Desk stamps `normalized_name` via leftover `normalizeCarrierName` (trim, collapse whitespace, lowercase) and stamps DOT / MC via leftover `normalizeCarrierNumber` (trim, strip interior space). Schema `lowercase` / `trim` only fold the name path when a caller set it, and they do **not** collapse whitespace. Schema DOT / MC only `trim`. A hand insert `"1883 785"` and desk `"1883785"` would be two unique DOT keys. Do not add `pre("validate")` `stampTheFoldedNameAndStripTheNumbers` so “hand insert matches desk” — a silent stamp would change who a later Tariff or seed find returns.

3. **The Granot-code setter and leftover `normalizeGranotCarrierCode` already fold the same way.** Both trim, strip interior space, and uppercase. The setter also returns `undefined` for a non-string. Desk PATCH empty string `$unset`s before this setter runs. Do not delete the setter so “fold lives only in config” without a paired proof that a hand `create({ granot_carrier_code: " c2c " })` still stores `"C2C"`. Do not teach the setter to `$unset` so “blank matches PATCH” — `$unset` lives on already-recommended desk correct.

4. **There is no selected-database getter — and that is today’s contract, not a missing Form copy and not a missing evidence copy.** Desk write, Tariff code find, seed load, and seed `--apply` **ask** default `MovingCarrier`. Already-recommended evidence **asks** `getCplLeadCorrectionModel` with **no** default export. Already-recommended Merchant **asks** default `Merchant` and has no getter. Do not invent `getMovingCarrierModel` so “carrier matches Form.” Do not delete the default `MovingCarrier` export so “carrier matches evidence.”

5. **Tariff find does not filter `active`.** `lookupMovingCarrierByGranotCode` **asks** `{ granot_carrier_code }` only. Desk list defaults active-only. Replace-import may deactivate a carrier whose code still paints Master. Do not add `{ active: true }` onto Tariff find from this rename so “inactive carriers 400.” That find lives on already-recommended `resolveCarrier.ts`.

6. **Seed matches DOT only — which this schema’s field unique already elects.** `planGranotCarrierCodeSeed` / `--apply` `updateOne({ dot_number })` never consult MC. Field unique `{ dot_number }` means that update can hit at most one row. Do not add MC onto the seed filter from this file so “seed matches CSV identity.” Seed stamp stays the script.

7. **Seed `--apply` drops `granot_carrier_code_1` then `syncIndexes`.** This file declares the partial unique and does **not** name it. Mongoose’s default name is `granot_carrier_code_1`. The drop is how a leftover non-partial unique is replaced. Do not name the partial unique from this rename so “the script can stop dropping.” Do not call `syncIndexes` from this file so “boot matches `--apply`.”

8. **`toJSON` / `toObject` enable virtuals but this file declares none.** Already-recommended Merchant does the same. Already-recommended Agent declares inverse Form / Call virtuals. Do not invent a `tariff_adjustments` virtual so “carrier matches Agent” — Tariff writes Google, not this id. Do not drop `virtuals: true` so “options match unused virtuals” without a paired `toObject({ virtuals: true })` proof on leftover `toMovingCarrierItem`.

9. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. These uniques are not named. Do not silently set `autoIndex: false` so “carrier matches Booking” without a paired report that boot still creates the DOT / MC / partial-code uniques **or** that a migration will. Do not invent `pnpm migration:moving-carrier-indexes` in this rename.

10. **Overview does not count this collection — historical-consolidation does not validate it.** Already-recommended Merchant is the opposite (overview counts / historical validates). Do not add overview counts so “carrier matches Merchant.” Do not invent `historical/MovingCarrier.ts` so “every catalog row has a historical relax.” Do not teach leftover Registry catalog this collection so “one desk owns payees and carriers.”

11. **Leave sibling modules alone.** Desk write, Tariff paint, seed plan, seed `--apply`, already-recommended Merchant unique folded name, next `ExtensionUser.ts`, and already-recommended Form / Call / Booking are already the right **depth**. This file holds the Moving Carrier row. `createMovingCarrier` / `resolveTariffCarrierCell` / `planGranotCarrierCodeSeed` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `MovingCarrier` validate, the field-level DOT and MC uniques, the compound unique, the partial Granot-code unique, the non-unique folded-name browse index.

There is no `MovingCarrier.test.ts`. Today’s proofs sit on callers. `movingCarrier.service.test.ts` already names whitespace fold and CSV DOT+MC / Granot-code duplicates through stubs. `tariff.service.test.ts` already names `"c2c"` → painted name and DOT through an injected lookup. `granotCarrierCodeSeed.test.ts` already names `already_set` / `will_set` / `will_replace` / `missing` without this model. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Moving Carrier requires `name`, `normalized_name`, `dot_number`, and `mc_number`.
- Validate does **not** invent `normalized_name` from `name`.
- Validate does **not** collapse internal whitespace on `normalized_name`.
- Validate does **not** strip interior space on `dot_number` / `mc_number`.
- The `granot_carrier_code` setter folds `" c2c "` to `"C2C"` and blank / non-string to `undefined`.
- `created_from` defaults to `"admin"`.
- `active` defaults to `true`.
- There is no `name_aliases` path.
- There is no `getMovingCarrierModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.
- `toJSON` / `toObject` virtuals stay true and no inverse Lead / Tariff virtuals are declared.

**Catalog identity uniques**
- `dot_number` is unique.
- `mc_number` is unique.
- `{ dot_number, mc_number }` is unique.
- `granot_carrier_code` is unique only where the value is a non-empty string.
- `normalized_name` is indexed and **not** unique.
- `{ active, name }` is indexed and **not** unique.
- There is no unique `{ normalized_name: 1 }`.
- None of the compounds are named.
- There is no named unique-DOT catalog export.

**Default connection**
- `MovingCarrier` remains exported as the default model.
- The getter `getMovingCarrierModel` does not exist.
- The default export is `mongoose.models.MovingCarrier ?? mongoose.model(...)`.
- The default export does not call `getMongoDatabaseName()` or `useDb`.

Do **not** add a test per helper (`requiredTrimmedDotUniqueAlone`, `keepOneCarrierPerDotPerMcAndPerNonEmptyGranotCode`). Those names exist so the parent reads. Do **not** record a Moving Carrier from this file’s tests. Do **not** paint a Tariff cell from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique indexes.” Do **not** `dropIndex("granot_carrier_code_1")` from this file’s tests.

There is no named index export to keep for a second migration **adapter**.

## What I would not do

- A `MovingCarrierModelService` / `MovingCarrierService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `dot.ts` / `code.ts` / `normalize.ts` split for cleanliness.
- Inventing a unique `{ normalized_name: 1 }` **seam** so “carrier matches Merchant.”
- Dropping field-level `{ dot_number }` / `{ mc_number }` uniques so “schema identity matches CSV `{dot}::{mc}`” without a paired proof.
- Breaking the default-connection **seam** by inventing `getMovingCarrierModel` without a paired proof. Today’s desk write already uses the default, not a getter.
- Deleting the default `MovingCarrier` export so “carrier matches evidence” without a paired proof that desk write still asks the default model.
- Treating `createMovingCarrier` / `updateMovingCarrier` / `importMovingCarriersFromCsv` as this story. Those functions own the desk write and the 409 mapping.
- Treating `resolveTariffCarrierCell` as this story. That function paints legal name then DOT.
- Treating `planGranotCarrierCodeSeed` or `scripts/seed-granot-carrier-codes.ts` as this story. Those own the report and the `--apply` stamp / index drop.
- Treating already-recommended `Merchant.ts` as this story. That unique is folded name.
- Treating next `ExtensionUser.ts` as this story. That unique is email.
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database find **adapter** that has only one live home.
- Silently stamping `normalized_name` or stripped DOT / MC on validate so “hand insert matches desk.”
- Silently adding `{ active: true }` onto Tariff find so “inactive carriers 400.”
- Silently adding MC onto the seed filter so “seed matches CSV identity.”
- Silently “fixing” a missing Tariff spec folder while recommending a rename. `docs/tariff-adjustment/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
