# Materialize This Historical `$oid` / `$date` Bag Into Live Mongo Values, Fold The Live Document Back To Comparable Extended JSON, Then Prove Only The Planned Fields Still Match — Never Stamp SHA-256, Never Write Mongo, Never Plan A Booking — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, visited)
- Pass: 14 of this service — `mongoValues.ts`
- Remaining in this service: none
- Target: `src/services/historicalConsolidation/mongoValues.ts`
- Knowledge: none for this folder. The hardening plan is [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (deterministic ObjectId mappings; apply must refuse a manifest if target collection checksums or database identity have changed; compare-and-swap; restore updates only when the live field still equals the manifest-applied value). Staged-merge spec: [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Acceptance: same inputs / rules / decisions are byte-equivalent). Already-recommended siblings: [historical-consolidation-planner.md](historical-consolidation-planner.md) (plants `{ $oid }` / `{ $date }` on sealed documents — does **not** import this file), [historical-consolidation-apply.md](historical-consolidation-apply.md) (**asks** `mongoDocument` for insert / `$set` / precondition, `matchesPlanned` on compare-and-swap miss, `comparable` then leftover `sha256` for collection checksums), [historical-consolidation-verify.md](historical-consolidation-verify.md) (**asks** `matchesPlanned` only), [historical-consolidation-rollback.md](historical-consolidation-rollback.md) (**asks** `matchesPlanned` then `mongoDocument` on leftover `before`), [historical-consolidation-schema-validation.md](historical-consolidation-schema-validation.md) (**asks** `materializeMongoValue` then `comparable` against live Mongoose serialize / cast), [historical-consolidation-stable-json.md](historical-consolidation-stable-json.md) (`stableJson` / `sha256` — apply checksums **ask** `comparable` **first**, then leftover `sha256`; this file does **not** hash). Distinct from leftover `stableJson.ts` (Date folds to a raw ISO string; this file folds a Date to `{ $date: ISO }` and an ObjectId to `{ $oid: hex }`). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (`canonicalJson` refuses `undefined` / functions / circles / class instances and does **not** know `$oid`). Distinct from already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) (private `stableJson` drops `undefined`; never **asks** this file). Distinct from live `src/utils/objectId.ts` (`toObjectId` / `newObjectIdHex` — random or parse, not extended-JSON walk). Distinct from leftover planner `objectId()` / `dateString()` helpers (read `$oid` / `$date` off a planted bag; they do **not** construct `ObjectId` / `Date`). Distinct from `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner *or* this walk). `package.json` still names `pnpm historical:apply` / `pnpm historical:verify` / `pnpm historical:rollback`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Extended JSON” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **already-recommended apply, verify, rollback, and schema validation.** `apply.ts` imports `comparable`, `mongoDocument`, `matchesPlanned` from this file (not the barrel). `verify.ts` imports `matchesPlanned` only. `rollback.ts` imports `mongoDocument`, `matchesPlanned`. `schemaValidation.ts` imports `comparable`, `materializeMongoValue`. Barrel `historicalConsolidation/index.ts` does **not** re-export any of the four. There is no `mongoValues.test.ts`. Folder `rollback.test.ts` **asks** leftover `buildRollbackUpdate`, which **asks** `mongoDocument` as a sibling **ask** — ObjectId / Date restore through leftover rollback is **not** this **interface**. Folder `schemaValidation.test.ts` **asks** leftover `validateManifestOperations` — nested-path accept / reject is **not** this **interface**. Folder `manifest.test.ts` plants `{ $date }` on a Customer insert and **asks** leftover `parseHistoricalManifest` — not this **interface**. Scripts in this checkout do **not** import this file. Already-recommended planner plants `$oid` / `$date` and never **asks** this file. Not this **interface**: `planHistoricalConsolidation`, `applyHistoricalManifest`, `preflightHistoricalManifest`, `verifyHistoricalManifest`, `rollbackHistoricalManifest`, `buildRollbackUpdate`, `validateManifestOperations`, `sha256` / `stableJson` / `assertArtifactHash`, `canonicalJson`, `toObjectId` / `newObjectIdHex`, leftover planner `objectId()` / `dateString()`.
- Seams callers need: materialize (`$oid` / `$date` → live `ObjectId` / `Date`) vs fold (`ObjectId` / `Date` → comparable extended JSON) vs prove (`matchesPlanned` — planned keys only); `mongoDocument` Record cast vs `materializeMongoValue` unknown walk; singleton `{ $oid }` / `{ $date }` vs recurse (so leftover `$exists` operators survive); comparable-then-`sha256` checksum vs leftover `stableJson` Date-as-ISO. There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no Mongo write **adapter**. There is no hash **adapter**. There is no HTTP **adapter**. There is no filesystem **adapter**.
- Split later (only if the file outgrows one sitting): this ~27-line file is one sitting if you read it as materialize this bag, fold the live document back, then prove only the planned fields. If it later splits by **story**: do not. One materialize plus one fold plus one prove. Never `create.ts` / `update.ts` / `delete.ts` / `oid.ts` / `date.ts`. Apply writes, verify prove-after-write, rollback restore, Mongoose parity, leftover SHA-256, and planner `$oid` planting stay siblings / other services.

`materializeMongoValue` / `mongoDocument` / `comparable` / `matchesPlanned` are executor mechanics. The owner question is: *The planner already planted `{ $oid: hex }` and `{ $date: ISO }` on the sealed document. Turn those wrappers into a live `ObjectId` and a live `Date` so apply can insert or `$set`, schema validation can hand Mongoose a real value, and rollback can restore `before`. Fold a live document the other way — `ObjectId` to `{ $oid: hex }`, `Date` to `{ $date: ISO }`, keys sorted — so apply can checksum a collection and schema validation can compare a serialized Mongoose document to the plan. Later, prove only the planned fields still match the live document. Extra live keys do not fail the prove. This file does not stamp SHA-256. This file does not write Mongo. This file does not plan a Booking.*

Who plants `$oid` / `$date`, who writes the insert, who checksums after the fold, and who stamps leftover `sha256` already live in other **modules**. Do not pull those in.

## What this file actually does

Three “materialize, fold, prove” stories in one sitting, not “a BSON helper,” and not Plan This Historical Merge / Apply This Approved Manifest / Stamp This Historical Bag:

1. **Materialize this historical `$oid` / `$date` bag into live Mongo values** — `materializeMongoValue(value)` and the Record cast `mongoDocument(value)`. Walk arrays. A singleton `{ $oid: string }` becomes `new ObjectId(hex)`. A singleton `{ $date: string }` becomes `new Date(iso)`. Any other object — including leftover `{ $exists: false }` on a precondition — is walked key by key. Null / `undefined` / non-objects return as-is. Already-recommended apply **asks** `mongoDocument` for leftover `document`, leftover `set`, and leftover `precondition` (so `$exists` survives into the compare-and-swap filter). Already-recommended rollback **asks** `mongoDocument(before)` inside leftover `buildRollbackUpdate`. Already-recommended schema validation **asks** `materializeMongoValue` on leftover `document` and each leftover `set` field. This beat does **not** sort keys. This beat does **not** write Mongo. This beat does **not** accept Mongo extended JSON v2 `{ $date: { $numberLong } }` — only a string `$date`. This beat does **not** treat `{ $oid, extra }` as an ObjectId; extra keys force a recurse.

2. **Fold this live Mongo value into comparable extended JSON** — `comparable(value)`. An `ObjectId` (the `mongodb` class this file imports) becomes `{ $oid: toHexString() }`. A `Date` becomes `{ $date: toISOString() }`. Arrays keep index order. Objects sort remaining keys with `localeCompare` (no locale argument) and walk each value. Already-recommended apply preflight **asks** this beat on every `_id`-sorted live document **before** leftover `sha256` when the registry is empty. Already-recommended schema validation **asks** it on both the serialized Mongoose document and the materialized plan. This beat does **not** drop `undefined`. This beat does **not** refuse Infinity. This beat does **not** hash. This beat does **not** fold a Date the way leftover `stableJson` does (raw ISO text).

3. **Prove only the planned fields still match the live document** — `matchesPlanned(actual, planned)`. For each planned key, `JSON.stringify(comparable(actual[key])) === JSON.stringify(comparable(materializeMongoValue(expected)))`. Extra keys on the live document are ignored. Already-recommended apply **asks** this beat when leftover `updateOne` `matchedCount !== 1` — a live document that still matches leftover `set` is a successful compare-and-swap, not a throw. Already-recommended verify **asks** it for leftover `document` on insert and leftover `set` on update. Already-recommended rollback **asks** it before delete / deactivate / restore; a miss is a conflict, not a throw. This beat does **not** compare leftover `before`. This beat does **not** compare leftover `_id` unless the planned bag planted it. This beat does **not** require the live document to be a subset of the plan.

There is no fourth hash or write operation. `mongoDocument` is the Record cast story 1 already-recommended apply / rollback **ask**. Local recurse is a fold inside stories 1–2.

## Organization

Keep one file. This is the screenplay for “materialize this historical bag, fold the live document back, then prove only the planned fields.” `$oid` / `$date` planting already lives on already-recommended `planner.ts`. Insert / compare-and-swap already live on already-recommended `apply.ts`. Prove-after-write already lives on already-recommended `verify.ts`. Restore already lives on already-recommended `rollback.ts`. Mongoose parity already lives on already-recommended `schemaValidation.ts`. Leftover SHA-256 already lives on already-recommended `stableJson.ts`. Do not pull those in. Do not invent a `HistoricalMongoValuesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a hash **adapter** so “one fold owns comparable and `sha256`.” Do not invent a Mongo write **adapter** so “materialize inserts `_id`.” Do not invent an HTTP **adapter** so “a route can decode `$oid`.” Do not invent a CRUD folder so “materialize / fold / prove each get a file.”

Do not move `comparable` into leftover `stableJson.ts` so “one fold owns live and historical.” Do not move `matchesPlanned` into leftover `verify.ts` so “prove owns the compare.” Do not merge this into leftover `toObjectId` so “one ObjectId owns every hex.” Do not split `create.ts` / `update.ts` / `delete.ts` / `oid.ts` / `date.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `materializeMongoValue` | `materializeThisHistoricalOidAndDateBag` | schema validation must hand Mongoose a live `ObjectId` / `Date`; apply / rollback **ask** the same walk through the Record cast |
| `mongoDocument` | `materializeThisHistoricalBagAsAMongoDocument` | apply insert / `$set` / precondition and rollback `$set` need a `Record`, not `unknown` |
| `comparable` | `foldThisLiveMongoValueIntoComparableExtendedJson` | apply checksums must fold ObjectId / Date **before** leftover `sha256`; schema validation must compare serialize vs plan |
| `matchesPlanned` | `proveOnlyThesePlannedFieldsStillMatchTheLiveDocument` | apply compare-and-swap, verify, and rollback must ignore extra live keys (server-owned revision defaults, later owner writes) |

Keep the old names as one-line aliases until already-recommended `apply.ts`, `verify.ts`, `rollback.ts`, and `schemaValidation.ts` migrate. Do not make callers learn `new ObjectId` / `toHexString` / `localeCompare` as the domain language. Do **not** export a deep-equal helper from here. Do **not** put `matchesPlanned` onto a live Booking route so “HTTP can compare a document.” Do **not** rename `$oid` / `$date`. Do **not** rename leftover `{ $exists: false }` survival. Do **not** replace singleton-only `$oid` / `$date` with “any object that has the key” — leftover precondition operators would become ObjectIds.

**No workflow class.** The one type that *does* earn a name is the sealed extended-JSON field callers already pass into materialize / prove:

```ts
type ThisHistoricalExtendedJsonField =
  | { $oid: string }
  | { $date: string }
  | { $exists: false }
  | Record<string, unknown>
```

That is the handoff from “the planner planted wrappers” to “apply can insert a live document.” Do **not** add `checksum_version` onto this card so “durable-work can share the fold.” Do **not** add a session or a Booking id onto `materializeMongoValue` so “the walk writes Mongo.”

Leave leftover `sha256` on already-recommended `stableJson.ts`. Leave insert on already-recommended `apply.ts`. Leave leftover planner `objectId()` / `dateString()` on already-recommended `planner.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// mongoValues.ts
// The planner already planted { $oid } and { $date } on the sealed bag.
// Turn those wrappers into a live ObjectId and a live Date.
// Fold a live document the other way so checksums and schema parity can compare.
// Prove only the planned fields still match. Extra live keys do not fail.
// Do not stamp SHA-256.
// Do not write Mongo.
// Do not plan a Booking.

// ── 1. Materialize this historical $oid / $date bag ──

export function materializeThisHistoricalOidAndDateBag(value: unknown): unknown
export function materializeThisHistoricalBagAsAMongoDocument(
  value: Record<string, unknown>,
): Record<string, unknown>
function turnASingletonOidWrapperIntoALiveObjectId(record)
function turnASingletonDateWrapperIntoALiveDate(record)
function leaveExistsOperatorsAndOtherBagsToRecurse(record)

// ── 2. Fold this live Mongo value into comparable extended JSON ──

export function foldThisLiveMongoValueIntoComparableExtendedJson(value: unknown): unknown
function foldThisObjectIdToOidHex(value: ObjectId)
function foldThisDateToDateIso(value: Date)
function sortTheseKeysByLocaleCompareThenWalk(value: Record<string, unknown>)

// ── 3. Prove only the planned fields still match ──

export function proveOnlyThesePlannedFieldsStillMatchTheLiveDocument(
  actual: Record<string, unknown>,
  planned: Record<string, unknown>,
): boolean
function stringifyEachPlannedKeyAfterBothSidesAreComparable(actual, planned)
```

Read the primary path out loud: *Turn each singleton `{ $oid: hex }` into a live ObjectId and each singleton `{ $date: ISO }` into a live Date so apply can insert or `$set` and rollback can restore `before`. Leave leftover `{ $exists: false }` alone so the compare-and-swap filter still means “this field was absent.” Fold a live document the other way — ObjectId to `{ $oid: hex }`, Date to `{ $date: ISO }`, keys sorted — so apply can checksum a collection before leftover `sha256` and schema validation can compare Mongoose serialize to the plan. Prove only the planned fields still match the live document. Extra live keys do not fail. Do not stamp SHA-256. Do not write Mongo. Do not plan a Booking.*

That is the operation. `matchesPlanned` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`mongoDocument` is a one-line cast of `materializeMongoValue`.** Keep it as the Record **seam** apply / rollback already **ask**. Do not grow a second walk. Do not delete the export so “one name owns both” until those callers migrate.

2. **This fold is not leftover `stableJson`.** Leftover `stableJson` turns a `Date` into raw ISO text and does not know `ObjectId`. This file turns a `Date` into `{ $date: ISO }` and an `ObjectId` into `{ $oid: hex }`. Apply checksums **ask** `comparable` first, then leftover `sha256`. Do not route `comparable` through leftover `stableJson` so “one fold owns the company” — existing `target_collection_checksums` would move.

3. **`matchesPlanned` is planned-keys only.** Live server-owned leftover `domain_revision` / leftover `change_history_started_at` / leftover `quoted` and later owner writes must not fail verify or rollback. Do not switch to “deep equal the whole document” in this rename.

4. **Singleton `$oid` / `$date` is load-bearing.** Leftover `{ $exists: false }` has one key that is not `$oid` or `$date`, so materialize recurses and the operator survives into apply’s filter. Do not treat “any object with `$oid`” as an ObjectId.

5. **`$date` is a string only.** Planner plants ISO text. Mongo extended JSON v2 `{ $date: { $numberLong } }` would recurse, not become a Date. Do not “fix” v2 in this rename without an **interface** proof that today’s fixtures still materialize.

6. **Invalid `$date` materializes to an Invalid Date.** `comparable` then `toISOString()` throws. `matchesPlanned` would throw instead of returning false. Do not swallow that into `false` in this rename.

7. **`instanceof ObjectId` is the `mongodb` class this file imports.** Driver `findOne` rows match. A foreign ObjectId that is not that class walks as a plain object. Do not swap to leftover `toObjectId` / leftover `mongoose.Types.ObjectId` so “one class owns every id” without proving apply checksums and schema parity still fold.

8. **`comparable` sorts with `localeCompare` and does not drop `undefined` or refuse Infinity.** Leftover `stableJson` drops `undefined` and throws on Infinity. Checksum path drops `undefined` only later, inside leftover `sha256` → leftover `stableJson`. Do not make `comparable` drop / refuse so “the two folds agree” — schema validation compares `comparable` to `comparable`, not to leftover `stableJson`.

9. **There is no `mongoValues.test.ts`.** `rollback.test.ts` **asks** leftover `buildRollbackUpdate`. `schemaValidation.test.ts` **asks** leftover `validateManifestOperations`. Do not treat those fixtures as this **interface**.

10. **Leave sibling modules and live writes alone.** `planHistoricalConsolidation`, `applyHistoricalManifest`, `verifyHistoricalManifest`, `rollbackHistoricalManifest`, `validateManifestOperations`, leftover `sha256`, leftover `toObjectId`, leftover planner `objectId()` / `dateString()`, and `ingest-historical-sheets.ts` are not this file. Do not inline them so “the walk is one sitting.”

## Testing

The **interface** is the test surface: `materializeThisHistoricalOidAndDateBag`, `materializeThisHistoricalBagAsAMongoDocument`, `foldThisLiveMongoValueIntoComparableExtendedJson`, `proveOnlyThesePlannedFieldsStillMatchTheLiveDocument` (today `materializeMongoValue`, `mongoDocument`, `comparable`, `matchesPlanned`).

There is no `mongoValues.test.ts`. `rollback.test.ts` through leftover `buildRollbackUpdate` is **not** this **interface**. `schemaValidation.test.ts` through leftover `validateManifestOperations` is **not** this **interface**. `apply.ts` checksums through leftover `preflightHistoricalManifest` are **not** this **interface**.

Add only what this **interface** still hides. Do **not** point leftover `applyHistoricalManifest` at live `vantagemovers` from this fixture.

**Materialize this historical `$oid` / `$date` bag**
- `{ $oid: "507f1f77bcf86cd799439011" }` becomes an `ObjectId` whose hex is that string.
- `{ $date: "2026-07-31T12:00:00.000Z" }` becomes a `Date` whose ISO is that string.
- `{ $exists: false }` stays `{ $exists: false }` (not an ObjectId).
- `{ booked: { $oid: hex }, updatedAt: { $date: iso } }` materializes nested wrappers; `mongoDocument` returns the same bag as a `Record`.
- `{ $oid: hex, extra: 1 }` does **not** become an ObjectId (extra keys recurse).
- Do **not** require leftover `applyHistoricalManifest` as this beat.

**Fold this live Mongo value into comparable extended JSON**
- A live `ObjectId` folds to `{ $oid: hex }`.
- A live `Date` folds to `{ $date: ISO }`.
- `{ b: 1, a: 2 }` equals `{ a: 2, b: 1 }` after fold (key order cannot change the compare).
- A Date fold is **not** leftover `stableJson`’s raw ISO string.
- Do **not** require leftover `sha256` as this beat.

**Prove only the planned fields still match**
- Live `{ name: "Jane", domain_revision: 0 }` matches planned `{ name: "Jane" }` (extra live keys ignored).
- Live `{ booked: ObjectId(hex) }` matches planned `{ booked: { $oid: hex } }`.
- A moved planned field returns false.
- Do **not** require leftover `verifyHistoricalManifest` as this beat.
- Do **not** require leftover `rollbackHistoricalManifest` as this beat.

Do **not** add a test per helper (`turnASingletonOidWrapperIntoALiveObjectId`, `sortTheseKeysByLocaleCompareThenWalk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The four function names may stay exported as aliases. They are the test surface. Do **not** export leftover `sha256` from here so “the fixture owns checksums.”

## What I would not do

- A `HistoricalMongoValuesService` class with `create` / `update` / `delete` / `parse`.
- Thirty two-line functions that only wrap `new ObjectId` / `toISOString`.
- Moving this into a CRUD folder, or a `bson/` folder that also swallows leftover `stableJson.ts`, leftover `planner.ts`, leftover `apply.ts`, and leftover `toObjectId`.
- Splitting `create.ts` / `update.ts` / `delete.ts` / `oid.ts` / `date.ts`.
- Treating `planHistoricalConsolidation`, `applyHistoricalManifest`, `verifyHistoricalManifest`, `rollbackHistoricalManifest`, `validateManifestOperations`, leftover `sha256`, leftover `toObjectId`, leftover planner `objectId()` / `dateString()`, or `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this walk as an **adapter**.
- Inventing a hash **adapter** so “one fold owns comparable and leftover `sha256`.”
- Inventing a Mongo write **adapter** so “materialize inserts `_id`.”
- Inventing an HTTP **adapter** so “a route can decode `$oid`.”
- Routing `comparable` through leftover `stableJson` so “Date is raw ISO everywhere.”
- Switching `matchesPlanned` to whole-document deep equal so “extra live keys fail.”
- Treating any object with an `$oid` key as an ObjectId so “`$exists` becomes an id.”
- Opening `testimonials` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
