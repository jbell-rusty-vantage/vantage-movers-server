# Remember The Merchant Catalog Row On The Default Mongo Connection, Unique-Index One Payee Per Folded Name, And Index Aliases For Name-Or-Alias Lookup Without Uniqueness — Never Resolve A Booking Merchant String Here, Never Unique-Index Aliases So Registry Availability Matches The Schema, Never Invent A Selected-Database Getter, Never Copy Agent Granot Usernames Or Inverse Lead Virtuals, Never Copy Booking AutoIndex-False Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 14 of this service — `Merchant.ts`
- Remaining in this service: `MovingCarrier.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/Merchant.ts`
- Knowledge: [`docs/knowledge/services/catalog.md`](../../../docs/knowledge/services/catalog.md) (System of Record is Operations Registry catalog collection `merchants`. Mutations go through `createOrUpdateMerchant` / activation. Lookup is `$or: [{ normalized_name }, { name_aliases }]`. Merchant public resolve has **no** include-inactive option and returns **display name**, not ObjectId. Booking writes store canonical display `name` on `BookedLead.merchant`. Knowledge resource list names the catalog facade and this file — do not add a Models Service file in this rename so “the Service sentence wins”). Catalog lifecycle: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (deactivate never delete; rename keeps the prior folded name as an alias; existing Booking snapshots are **not** rewritten). Already-recommended catalog write: [operations-registry-catalog-registry.md](operations-registry-catalog-registry.md) (`createOrUpdateMerchant` `assertCatalogNameAvailable` `$or` name-or-alias — **this file unique-indexes `normalized_name` only**, **never** unique-indexes `name_aliases`). Already-recommended catalog facade: [catalog-catalog.md](catalog-catalog.md) (`resolveActiveMerchantName` **asks** Registry — **this file never lists**, never returns a display string). Already-recommended Agent row: [models-agent.md](models-agent.md) (unique folded name **plus** sparse Granot username uniques **plus** inverse Form / Call virtuals; `created_from` default `"booked_lead"` — **do not copy Granot uniques or inverse virtuals here**, **do not flip this `created_from` default so “Merchant matches Agent”**). Already-recommended Booking row: [models-booked-lead.md](models-booked-lead.md) (required string `merchant` — **not** ObjectId `ref: "Merchant"`; `autoIndex: false` — **do not copy that fence here**, **do not `$set` a Booking snapshot here**). Distinct from next carrier: next `MovingCarrier.ts` (unique DOT / MC / Granot Carrier Code; `normalized_name` is **indexed not unique** — **do not copy this unique folded name onto next**). Distinct from Extension User login: next `ExtensionUser.ts` (email login — **not a Merchant**). Distinct from historical relax: this checkout has **no** `historical/Merchant.ts` — historical-consolidation `validateSync` **asks** this default `Merchant`. Distinct from Sheet Sync register: `sheetSync/drainer/jobPlanner.ts` **does not** import this file (Booking merchant is a string snapshot — no populate needed). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Merchant](../../../../CONTEXT.md), [Active Merchant](../../../../CONTEXT.md); this checkout does **not** define Merchant — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no `getMerchantModel`.** `operationsRegistry/catalogRegistry.ts` **asks** default `Merchant` for list / get / `$or` name-or-alias resolve / `createOrUpdate` / activation / `assertCatalogNameAvailable` / `previewRegistryDependency` `findById` then `BookedLead.countDocuments({ merchant: { $in: [name, ...name_aliases] } })`. Already-recommended catalog facade **asks** Registry, not this file (`catalog.service.test.ts` stubs `Merchant.findOne` for display-name return). `granotLifecycle/bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `referralBooking.ts` / `releaseOwnerCommands.ts` and `domainCommands/bookings.ts` **ask** `Merchant.findOne({ _id, active: true })` then snapshot `merchant.name`. `granotLifecycle/projections.ts` **asks** `Merchant.findOne({ name: booking.merchant, active: true })` — exact display name, not `$or` fold-or-alias. `operationsRegistry/queries/overview.ts` **asks** `Merchant.countDocuments({})` and `{ active: true }`. `operationsRegistry/queries/health.ts` **asks** `Merchant.countDocuments({ active: false })`. `historicalConsolidation/schemaValidation.ts` **asks** default `Merchant` to `validateSync` a planned insert. Scripts `operations-registry-agent-merchant-compatibility.ts` / `operations-registry-inventory.ts` / `dump-operations-name-link-inventory.ts` / `dump-operations-registry-seed-surface.ts` **ask** default `Merchant.find`. `adminFacets.service.test.ts` / `admin.service.test.ts` / analytics tests stub `Merchant.find`. Owner Booking replica tests `insertOne` onto `Merchant.collection`. There is no `Merchant.test.ts`. Nobody inspects `Merchant.schema.indexes()`. Not this **interface**: `createOrUpdateMerchant` itself, `resolveActiveMerchantName` itself, `previewRegistryDependency` itself, Owner `loadActiveCatalog` itself, `validateManifestOperations` itself.
- Seams callers need: default `Merchant` (first-registered connection — Registry write / Owner active-id load / projection exact-name find / overview count / health inactive count / historical-consolidation validate) vs already-recommended Agent same default-export pattern vs already-recommended evidence `getCplLeadCorrectionModel` (**no default export**) vs Form selected-database getter; field-level unique `{ normalized_name: 1 }` vs Registry `$or` name-or-alias availability (aliases are **not** unique on this schema); schema `lowercase` + `trim` on `normalized_name` **when that path is set** vs `normalizeAgentName` that also collapses whitespace; Booking snapshot display **string** vs Owner Booking load by ObjectId + `active: true` vs projection exact `name` + `active: true`; `created_from` default `"admin"` vs already-recommended Agent default `"booked_lead"`; `toJSON` / `toObject` `virtuals: true` **with no virtuals declared**; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Booking-merchant-resolve **seam**. There is no selected-database getter **seam**.
- Split later (only if the file outgrows one sitting): this ~30-line file is one sitting if you read it as remember the Merchant catalog row on the default Mongo connection, unique-index one payee per folded name, and index aliases for name-or-alias lookup without uniqueness — never resolve a Booking merchant string here, never unique-index aliases so Registry availability matches the schema, never invent a selected-database getter, never copy Agent Granot usernames or inverse Lead virtuals, never copy Booking autoIndex-false without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `aliases.ts`. Catalog write stays `catalogRegistry.ts`. Booking display-name remember stays already-recommended booking writes. Next carrier stays `MovingCarrier.ts`.

`Merchant` is a Mongoose model name. The owner question is: *Owner just named this payee in the catalog — or a Booking is about to remember their display name. Hold the row on `merchants`. Keep folded name unique so Registry rename elects one payee. Index aliases so Registry resolve can `$or` fold-or-alias. Booking writes store the display name, not this id. Today’s live callers still use the default connection — do not invent a getter in this rename. Do not resolve a Booking merchant string. Do not unique-index aliases. Do not stamp folded name on validate. Do not copy Agent’s Granot username uniques or inverse Lead virtuals. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who record / rename / activate already lives in `catalogRegistry.ts`. Who remember this Booking’s display merchant already lives in `resolveActiveMerchantName` plus Owner `loadActiveCatalog`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Merchant catalog row, unique-index one payee per folded name, and index aliases for name-or-alias lookup without uniqueness” story, not “a Merchant model CRUD dump,” and not Record A Catalog Card / Remember This Booking’s Merchant Display Name themselves:

1. **Hold the Merchant as the catalog System of Record row** — collection `merchants`, timestamps, `toJSON` / `toObject` virtuals **with no virtuals declared**. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** `role`. **No** Granot username paths. **No** inverse Lead virtuals. Declares required `name` (trim), required `normalized_name` (trim, schema `lowercase`, **unique**), required `active` (default `true`), required `created_from` (trim, default `"admin"`), `name_aliases[]` (default `[]`), optional `archived_at` / `deactivation_reason`. This beat does **not** invent `normalized_name` from `name`. This beat does **not** collapse whitespace. This beat does **not** `$set` a Booking `merchant` string. A Booking may still refuse when Registry find misses.

2. **Keep one Merchant per folded name, and index aliases for name-or-alias lookup — without uniqueness on aliases** — field-level unique `{ normalized_name: 1 }`. Non-unique `{ name_aliases: 1 }` browse index. Neither is named. Neither has a `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Registry availability **also** refuses a folded name that already lives on another Merchant’s `name_aliases`. This schema’s unique does **not** cover aliases. Projection find **does not** use aliases — it finds exact display `name`. This beat does **not** unique-index `name_aliases`. This beat does **not** find a Booking from this file.

3. **Bind the default Mongo connection** — default export `Merchant` is `mongoose.models.Merchant ?? mongoose.model(...)`. There is **no** `getMerchantModel`. There is **no** `getMongoDatabaseName()`. There is **no** `useDb`. Registry write / Owner active-id load / projection exact-name find / overview count / health inactive count / historical-consolidation validate **ask** the default export. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`. This beat does **not** invent `getMerchantModel` so “Merchant matches Form.” This beat does **not** delete the default export so “Merchant matches evidence.”

`MerchantDocument` is the inferred row type. There is no status enum export. There is no named-index export.

There is no record-this-Merchant-in-the-catalog operation. `catalogRegistry.ts` elects that. There is no remember-this-Booking’s-merchant operation. `resolveActiveMerchantName` / Owner `loadActiveCatalog` elect that.

## Organization

Keep one file. This is the screenplay for “remember the Merchant catalog row on the default Mongo connection, unique-index one payee per folded name, and index aliases for name-or-alias lookup without uniqueness — never resolve a Booking merchant string here, never unique-index aliases so Registry availability matches the schema, never invent a selected-database getter, never copy Agent Granot usernames or inverse Lead virtuals, never copy Booking autoIndex-false without a migration.” Registry write / Booking display-name remember / Owner active-id load already live in deeper **modules**. Do not pull those in. Do not invent a `MerchantModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getMerchantModel` **adapter** so “Merchant matches Form” without a paired proof that Registry write, Owner active-id load, projection exact-name find, overview count, health inactive count, and historical-consolidation validate still read the same `merchants`. Do not invent an `autoIndex: false` **adapter** so “Merchant matches Booking” without a reviewed index migration. Do not invent a unique `{ name_aliases: 1 }` **adapter** so “alias uniqueness lives on the schema.” Do not invent a `pre("validate")` that stamps `normalized_name` so “hand insert matches Registry.” Do not invent inverse Lead virtuals so “Merchant matches Agent.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `aliases.ts` / `normalize.ts` each get a file.

Do not move `normalizeAgentName` into this file so “the row owns the fold.” Do not merge this file into already-recommended `Agent.ts` so “one catalog schema owns people and payees.” Do not merge this file into next `MovingCarrier.ts` so “one unique folded name owns payees and carriers.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `Merchant` | `merchantOnTheDefaultConnection` | Registry write, Owner active-id load, projection exact-name find, overview count, health inactive count, historical-consolidation validate still import the default model |
| `MerchantDocument` | `MerchantRow` | inferred document + `_id`; Registry `createMerchantDocument` types today |

Keep the old names as one-line aliases until `catalogRegistry.ts`, Owner Booking commands, projection, overview, health, historical-consolidation validate, and inventory scripts migrate. Do not make callers learn `normalized_name` / `name_aliases` as the domain language. Do **not** add `getMerchantModel` so “every aggregate has a getter” — live writes already share one default **adapter**. Do **not** delete the default `Merchant` export so “everyone must call a getter that does not exist.” Do **not** export a named unique-name catalog that this schema does not name.

**No class for the workflow.** The one type that *does* earn a name is the pending catalog-identity contract:

```ts
type MerchantCatalogIdentity = {
  normalized_name: { unique: true }
  name_aliases: { unique: false; indexed: true }
  booking_snapshot: "display_name_string"
}
```

That is the handoff from “this process remembered a payee” to “Registry rename elects one row by folded name, aliases stay find keys without uniqueness on this schema, and Booking writes store the display name not this id.” Do **not** add `{ name_aliases: { unique: true } }` onto that type so “alias uniqueness lives on the schema.” Do **not** add `{ booking_snapshot: "objectId" }` so “the Booking points at this row.”

Leave already-recommended `Agent.ts` on that file. Leave next `MovingCarrier.ts` on that file. Leave Registry write on `catalogRegistry.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// Merchant.ts
// Owner just named this payee in the catalog —
// or a Booking is about to remember their display name.
// Hold the row on merchants.
// Keep folded name unique so Registry rename elects one payee.
// Index aliases so Registry resolve can $or fold-or-alias.
// Booking writes store the display name, not this id.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not resolve a Booking merchant string.
// Do not unique-index aliases.
// Do not stamp folded name on validate.
// Do not copy Agent's Granot username uniques
// or inverse Lead virtuals.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const merchantOnTheDefaultConnection =
  mongoose.models.Merchant ?? mongoose.model("Merchant", merchantSchema)

export { merchantOnTheDefaultConnection as Merchant }

// ── 1. Hold the Merchant as the catalog System of Record row ─

const merchantSchema = rememberTheMerchantRow() // collection merchants; default autoIndex; no virtuals declared

function rememberTheMerchantRow() {
  const schema = new Schema(
    {
      name: requiredTrimmedDisplayName(),
      normalized_name: requiredFoldedName(),          // lowercase + trim when set; not invented from name
      active: requiredActiveDefaultTrue(),
      created_from: requiredOriginDefaultAdmin(),     // catalog create still stamps "admin"
      name_aliases: optionalFoldedAliasList(),
      archived_at: optionalArchivedAt(),
      deactivation_reason: optionalDeactivationReason(),
    },
    { collection: "merchants", timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
  )
  keepOneMerchantPerFoldedNameAndIndexAliasesWithoutUniqueness(schema)
  return schema
}

// ── 2. One payee per folded name; aliases are lookup ──────

function keepOneMerchantPerFoldedNameAndIndexAliasesWithoutUniqueness(schema) {
  // today's field-level unique normalized_name
  // today's non-unique name_aliases browse index
  // neither named
}

// ── 3. Default Mongo connection ───────────────────────────

// merchantOnTheDefaultConnection above
```

Read the primary path out loud: *hold the Merchant on `merchants` with a required display name, a required folded name, `created_from` default `"admin"`, and optional aliases. Do not invent the folded name on validate. Keep folded name unique so Registry rename elects one payee. Index aliases for find without making them unique on this schema. Booking writes store the display name, not this id. If this process already sits on the first-registered connection, that is the model Registry and Owner Booking already import. Do not resolve a Booking merchant string here. Do not unique-index aliases. Do not invent a getter.*

That is the operation. An unnamed schema dump is not. `createOrUpdateMerchant` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The unique is folded name only. Registry also refuses aliases on another row.** `assertCatalogNameAvailable` `$or` `{ normalized_name }` **or** `{ name_aliases }`. This schema’s unique covers only `normalized_name`. A hand insert could share an alias with another Merchant without 11000. Do not unique-index `name_aliases` so “alias uniqueness lives on the schema” without a paired proof that rename `mergeAlias` still keeps the old folded name resolvable **and** that two Merchants may not share an alias string today. Do not drop uniqueness on `normalized_name` so “Merchant matches Customer’s never-unique browse.”

2. **There is no validate hook — and that is today’s contract.** Registry stamps `normalized_name` via `normalizeAgentName` (trim, collapse whitespace, lowercase). Schema `lowercase` / `trim` only fold the path when a caller set it, and they do **not** collapse whitespace. A hand insert `"paper  check"` and Registry `"paper check"` would be two unique keys. Do not add `pre("validate")` `stampTheFoldedNameFromDisplay` so “hand insert matches Registry” — a silent stamp would change who a later `$or` find returns.

3. **There is no selected-database getter — and that is today’s contract, not a missing Form copy and not a missing evidence copy.** Registry write, Owner active-id load, projection exact-name find, overview count, health inactive count, historical-consolidation validate **ask** default `Merchant`. Already-recommended evidence **asks** `getCplLeadCorrectionModel` with **no** default export. Already-recommended fourteen-slot **asks** default `CplRate` and has no getter. Do not invent `getMerchantModel` so “Merchant matches Form.” Do not delete the default `Merchant` export so “Merchant matches evidence.”

4. **Booking snapshot is a display string, not this ObjectId.** `BookedLead.merchant` is required `String`. Public booking **asks** `resolveActiveMerchantName` and stores `merchant.name`. Owner Booking **asks** `findOne({ _id, active: true })` then snapshots `merchant.name`. Do not change Booking `merchant` to ObjectId `ref: "Merchant"` from this file so “the Booking points at the row.” Snapshots stay on already-recommended `BookedLead.ts`.

5. **Projection finds exact display `name` + `active: true` — not Registry `$or` fold-or-alias.** After rename the live display name changes and the Booking snapshot does **not**. `Merchant.findOne({ name: booking.merchant, active: true })` can miss a still-active payee whose current `name` no longer equals the snapshot. Do not add `$or` fold-or-alias onto projection from this rename so “find matches Registry.” That find lives on already-recommended `projections.ts`.

6. **Health copy says inactive Merchants remain valid for explicit Owner booking selection — Owner Booking asks `{ _id, active: true }` and public resolve has no include-inactive option.** Do not flip Owner find to include inactive so “health copy wins.” Do not rewrite health copy from this file so “the sentence matches find.” Park that fight in CONTRADICTIONS.

7. **`toJSON` / `toObject` enable virtuals but this file declares none.** Already-recommended Agent declares inverse Form / Call virtuals. Do not invent a `booked_leads` virtual so “Merchant matches Agent” — Booking points by display string, not `_id`. Do not drop `virtuals: true` so “options match unused virtuals” without a paired `toObject({ virtuals: true })` proof on `documentToCatalogLean`.

8. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. The unique folded name and alias browse index are not named. Do not silently set `autoIndex: false` so “Merchant matches Booking” without a paired report that boot still creates the unique folded name **or** that a migration will. Do not invent `pnpm migration:merchant-indexes` in this rename.

9. **Overview counts this collection — historical-consolidation validates it.** Already-recommended evidence is the opposite (nobody counts / validates `cpl_lead_corrections`). Do not drop overview counts so “Merchant matches evidence.” Do not invent `historical/Merchant.ts` so “every catalog row has a historical relax.”

10. **Leave sibling modules alone.** Registry write, Booking display-name remember, Owner active-id load, projection exact-name find, already-recommended Agent Granot uniques, next `MovingCarrier.ts`, and already-recommended Form / Call / Booking are already the right **depth**. This file holds the Merchant row. `createOrUpdateMerchant` / `resolveActiveMerchantName` / Owner `loadActiveCatalog` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `Merchant` validate, the unique folded name, the non-unique alias browse index.

There is no `Merchant.test.ts`. Today’s proofs sit on callers. `catalog.service.test.ts` already names display-name return through a stubbed `Merchant.findOne`. `catalogRegistry.test.ts` stubs `Merchant.find` for the default active filter and `includeInactive`. Owner Booking replica tests insert a synthetic row then ask `{ _id, active: true }`. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Merchant requires `name` and `normalized_name`.
- Validate does **not** invent `normalized_name` from `name`.
- Validate does **not** collapse internal whitespace on `normalized_name`.
- `created_from` defaults to `"admin"`.
- `active` defaults to `true`.
- There is no Granot username path.
- There is no `role` path.
- There is no `getMerchantModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.
- `toJSON` / `toObject` virtuals stay true and `form_leads_received` / `call_leads_received` / `booked_leads` are not virtuals.

**Catalog identity uniques**
- `normalized_name` is unique.
- `name_aliases` is indexed and **not** unique.
- There is no unique `{ name_aliases: 1 }`.
- Neither compound is named.
- There is no named unique-name catalog export.

**Default connection**
- `Merchant` remains exported as the default model.
- The getter `getMerchantModel` does not exist.
- The default export is `mongoose.models.Merchant ?? mongoose.model(...)`.
- The default export does not call `getMongoDatabaseName()` or `useDb`.

Do **not** add a test per helper (`requiredFoldedName`, `keepOneMerchantPerFoldedNameAndIndexAliasesWithoutUniqueness`). Those names exist so the parent reads. Do **not** record a Merchant from this file’s tests. Do **not** resolve a Booking merchant string from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique indexes.”

There is no named index export to keep for a second migration **adapter**.

## What I would not do

- A `MerchantModelService` / `MerchantService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `aliases.ts` / `normalize.ts` split for cleanliness.
- Inventing a unique `{ name_aliases: 1 }` **seam** so “alias uniqueness lives on the schema.”
- Breaking the default-connection **seam** by inventing `getMerchantModel` without a paired proof. Today’s Registry write already uses the default, not a getter.
- Deleting the default `Merchant` export so “Merchant matches evidence” without a paired proof that Registry still asks the default model.
- Treating `createOrUpdateMerchant` / activation as this story. Those functions own the Owner transaction and the Change row.
- Treating `resolveActiveMerchantName` as this story. That function returns the display name for a Booking write.
- Treating Owner `loadActiveCatalog` as this story. That find asks `{ _id, active: true }` then snapshots `merchant.name`.
- Treating already-recommended `Agent.ts` as this story. That row owns Granot usernames and inverse Lead virtuals.
- Treating next `MovingCarrier.ts` as this story. That unique is DOT / MC / Granot Carrier Code.
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database find **adapter** that has only one live home.
- Silently stamping `normalized_name` on validate so “hand insert matches Registry.”
- Silently changing Booking `merchant` to ObjectId so “the Booking points at the row.”
- Silently adding `$or` fold-or-alias onto projection so “find matches Registry.”
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
