# Read The Leftover Fourteen-Slot CPL Book — operational story

- Status: recommended
- Service: `cpl` (Wave A, visited)
- Pass: 1 of this service — `cplRate.service.ts`
- Remaining in this service: none — the folder has one service module
- Target: `src/services/cpl/cplRate.service.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md` (`cplSchedule.ts` + `resolveCpl` are authority; Lead writes go through `leads/leadCplResolution.ts`). Lead snapshots: `docs/knowledge/services/form-lead.md` / `call-lead.md` (Registry periods, not `cpl.ts` / `getCplForSource`). Compatibility rule: `.cursor/rules/cpl-operations.mdc` (`cpl_rates` and embedded granularity CPL are read-only migration data). No dedicated Service file for this leftover book. This checkout’s `CONTEXT.md` does not define CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `config/domain/cpl.ts` (`getCplRate` is the **second** try inside `getCplForSource`, after leftover nested `getCplForLeadSource` throws). `routes/v1.routes.ts` `handleCplRatesList` (`GET /api/v1/admin/cpl-rates` — v1 secret only; no Registry actor). Tests: `cplRate.service.test.ts` (list + 14-slot seed), `config/domain/cpl.test.ts` (`invalidateCplRateCache` + leftover-then-`cpl_rates` fallback). Inventory still lists a ghost `updateCplRate`. Live Owner snapshot is `GET /api/v1/admin/cpl/snapshot` → Registry periods — not these exports.
- Seams callers need: leftover nested Source Company prices vs leftover 14-slot `cpl_rates`; seed-then-cache vs Mongo-down checked-in defaults (do not remember the empty miss); leftover admin list vs Owner schedule snapshot
- Split later (only if the file outgrows one sitting): keep one file — leftover slot read and leftover admin list are one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`getCplRate` / `listCplRates` / `ensureCplRatesSeeded` are executor mechanics. The owner question is: *the old 14-slot CPL price list still sits in Mongo (`cpl_rates`). If leftover code asks what a company + channel (+ Best Relocation form Move Type) costs, write any missing slot from the checked-in defaults and read that book. If the leftover Source Company book already has nested prices, the leftover admin list shows those instead and never opens `cpl_rates`. This is not pricing a Lead. This is not the Owner schedule. There is no write here — `updateCplRate` is a ghost.*

Lead pricing is `leads/leadCplResolution.ts`. Owner periods are `operationsRegistry/cplSchedule.ts`. Owner rewrite of prior Leads is `cplCorrections.ts`. Leftover nested match is `leadSourceCompanies/leadSourceCompany.service.ts`. Do not pull those in.

## What this file actually does

Two operations, not “a CPL CRUD service,” and not Lead pricing:

1. **Read leftover slot CPL** — mark a leftover book read (`legacy_cpl_rates`, consumer `unknown`). Load the 14-slot `cpl_rates` book (seed any missing **label** from `CPL_RATE_DEFINITIONS` with `$setOnInsert`, cache 30 seconds). If this company / channel / Best Relocation form Move Type is in the book, return that number. Mongo down or a key the book never stored → checked-in default (unknown triple → 0). Do **not** remember an empty miss, so the next call retries Mongo.
2. **List leftover CPL for the leftover admin page** — mark a leftover book read (consumer `admin_list`). If the leftover Source Company book has any company, flatten nested `granularity.cpl` (inactive companies included) and return that. Only when that flatten is empty: seed the 14 slots and return the definition list merged with `cpl_rates` rows. `GET /api/v1/admin/cpl-rates`. Not `GET /api/v1/admin/cpl/snapshot`.

There is no owner write. Comments and inventory still talk about `updateCplRate`. The function is not in this file. `invalidateCplRateCache` is a process **seam** for tests, not a third operation.

## Organization

Keep one file. This is the screenplay for “the old 14-slot book is still here for leftover readers.” Registry periods, Lead snapshots, leftover Source Company match, and Owner correction already live in deeper **modules**. Do not pull those in. Do not invent a `CplRateService` class. Do not invent a `begin` / `complete` **seam** — this file is leftover read + leftover seed, not a command.

Do not split this 200-line file by get / list / cache. Slot read and leftover list are one leftover book. The cache stays a child of slot read.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getCplRate` | `readLeftoverSlotCpl` | second try inside `getCplForSource` after leftover nested CPL throws |
| `listCplRates` | `listLeftoverCplForTheAdminPage` | `GET /admin/cpl-rates`; prefers leftover nested prices |
| `invalidateCplRateCache` | `forgetTheLeftoverFourteenSlotCache` | tests; no owner write exists to call this |
| `CplRateItem` | `LeftoverCplRow` | leftover admin page + 14-slot projection |

Keep the old names as one-line aliases until leftover `getCplForSource` and `GET /admin/cpl-rates` migrate or die. Do not make callers learn `ensure` / `loadCache` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the leftover row the admin page already gets:

```ts
type LeftoverCplRow = {
  id: string
  label: string
  source_company: string
  lead_source_company?: string   // leftover nested flatten only
  source_granularity_key?: string
  lead_type: "form" | "call"
  local?: LocalType
  cpl: number
}
```

That is the handoff from “here is an old company / channel” to “leftover UI can show a number.” There is no after-commit bag and no Lead stamp from this file.

`CPL_RATE_DEFINITIONS` / `cplRateCacheKey` stay in `config/domain/cplRateDefinitions.ts`. Do not move the 14-slot table into this service “so the book owns its defaults.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cplRate.service.ts
// The old 14-slot CPL book still sits in Mongo.
// Leftover readers may ask what a company and channel cost.
// If the leftover Source Company book already has nested prices,
// the leftover admin list shows those instead.
// This is not pricing a Lead. This is not the Owner schedule.

// ── 1. Read leftover slot CPL ─────────────────────────────

export async function readLeftoverSlotCpl(company, channel, moveType?)

async function markThatALeftoverBookWasRead(consumer)   // unknown | admin_list
async function loadTheLeftoverFourteenSlotBook()
async function seedAnyMissingFourteenSlots()            // $setOnInsert by label
function rememberTheBookForThirtySeconds(map)
function doNotRememberAnEmptyMiss()                     // Mongo down → retry next call
function readTheCheckedInDefaultWhenTheBookIsSilent(company, channel, moveType)
function bestRelocationFormsSplitOnMoveType(company, channel)

// ── 2. List leftover CPL for the leftover admin page ──────

export async function listLeftoverCplForTheAdminPage()

async function preferLeftoverNestedPricesWhenThatBookHasCompanies()
function flattenNestedGranularityCpl(company, granularity)
async function listTheFourteenSlotsWhenTheNestedBookIsEmpty()
function projectAFourteenSlotRow(definition, stored?)

export function forgetTheLeftoverFourteenSlotCache()    // tests; no owner write
```

Read the leftover slot path out loud: *mark that a leftover book was read. Load the 14-slot `cpl_rates` book — seed any missing label from the checked-in defaults, remember it for thirty seconds. If this company and channel (and Best Relocation form Move Type) are in the book, return that number. If Mongo is down, do not remember the empty miss — use the checked-in default and try Mongo again next time.*

Read the leftover admin list out loud: *mark that a leftover book was read. If the leftover Source Company book has any company, show nested `granularity.cpl` for every granularity, including inactive companies. Only when that flatten is empty, seed the 14 slots and show those. This is not the Owner snapshot.*

That is the operation. `getCplRate` is not. `updateCplRate` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This folder is not Lead pricing.** Comments say a 30-second cache keeps `getCplRate` fast on the “hot lead-create/update path.” Lead writes use `priceTheLead` → Registry periods. `getCplForSource` has no Form/Call ingest caller. Rename so leftover read is visible. Do **not** route ingest through this file “because the comment still says hot path.”

2. **`updateCplRate` is a ghost.** Cache JSDoc, `config/domain/cpl.ts` (“admin read/write”), the `CplRate` model (“Owner-editable”), and the operations-registry inventory still name a write. This file only seeds, lists, and reads. Do **not** add `updateCplRate` so the comments “win,” and do not invent a PATCH on `/admin/cpl-rates`. Owner writes are `applySimpleCplSchedule` / granularity schedule commands.

3. **Two leftover books, two answers.** Slot read only opens `cpl_rates`. Leftover list prefers nested `granularity.cpl` and only opens `cpl_rates` when that flatten is empty. After leftover Source Company seed, the admin fallback is dead. The unit test stubs an empty leftover full-find so it can still exercise 14-slot seed. Do **not** delete the `cpl_rates` fallback “because a seeded catalog always has companies,” and do not make slot read also flatten nested prices “so both leftover books agree.”

4. **`getCplForSource` comments lie about the first try.** The config comment says CPL is `cpl_rates`. The body tries leftover nested `getCplForLeadSource` first (`requireActive: false`), then this file. Config tests mock `CplRate` as if that were first. Lead writes use Registry. Do not drop the leftover first try so the comment “wins,” and do not call leftover CPL from Form/Call ingest. The first-try lie is `config/domain/cpl.ts` — do not “fix” it from this rename.

5. **Leftover admin list is not the Owner snapshot.** `GET /admin/cpl-rates` is v1-secret only and has no `requireRegistryReadActor`. `GET /admin/cpl/snapshot` is Registry-gated and reads current periods. Do **not** rewire `/cpl-rates` onto `listCplSchedule`, and do not add the Owner gate here “for consistency” in this rename.

6. **Seed never updates.** `$setOnInsert` by label. A later checked-in `defaultCpl` does not rewrite a row that already exists. Do not turn seed into an upsert-merge so “the leftover book stays current.”

7. **Best Relocation forms split; nothing else does.** Cache key and checked-in default only consult `local` when `sourceCompany === "best_relocation_leads" && leadType === "form"`. Missing local → `long_distance`. Call slots and every other company ignore Move Type. Paid Overflow is form-only (the 14th slot). Do not add a call slot, and do not make every company split on `local` “because the schema has the field.”

8. **Mongo down must not poison the cache.** `loadCache` returns an empty `Map` and does not assign `cache`. The next `getCplRate` retries. Do not store that empty map so “we stop hammering Mongo.”

9. **Compatibility telemetry must not fail the read.** `recordDurableCompatibilityRead` swallows and falls back to an in-memory counter. Slot read uses consumer `unknown`; leftover list uses `admin_list`. Do not throw from the leftover read when the event write fails, and do not silently change `unknown` to a lead-create consumer so the hot-path comment looks true.

10. **A `cpl_rates` row whose label is not in `CPL_RATE_DEFINITIONS` is skipped.** Cache walk calls `findCplRateDefinition(doc.label)` and `continue`s. Leftover list-from-fourteen-slots walks definitions, not raw docs. Do not start returning orphan rows “so the collection is the book.”

11. **Leave sibling modules alone.** `getCplForLeadSource`, `priceTheLead`, `resolveCpl`, `listCplSchedule`, and `applySimpleCplSchedule` stay where they are. This file orchestrates leftover 14-slot seed/read and leftover admin flatten.

12. **Do not treat Owner schedule write as this story.** Periods, cents, covering windows, and correction jobs are `operationsRegistry`. Wave B may later rename `getCplForSource`; do not pull that config module into this pass.

## Testing

The **interface** is the test surface: `readLeftoverSlotCpl`, `listLeftoverCplForTheAdminPage`. Keep `forgetTheLeftoverFourteenSlotCache` exported because tests and the leftover config fallback need that **seam** — it is not a test leak.

Today’s `cplRate.service.test.ts` only stubs an empty leftover Source Company full-find, seeds the missing “Main Site Inbounds” slot, and asserts 14 rows. That proves the dead fallback, not the live leftover list. Fill the gaps the story names make obvious:

**Read leftover slot CPL**
- A cached `cpl_rates` row for `tbm_leads` / form returns that stored number (not the checked-in default when they differ).
- Best Relocation form `local` → the Locals slot; missing/`long_distance` → Forms; call ignores `local`.
- Unknown company / channel → 0 from the checked-in default, not a throw.
- Mongo `find` throws → checked-in default, and a second call retries Mongo (empty miss is not cached). Already implied by `getCplForSource` config tests — lock it on this **interface** too.
- Seed inserts only missing labels (`$setOnInsert`). A second read does not insert again.

**List leftover CPL for the leftover admin page**
- When leftover Source Company list returns any company, rows come from nested `granularity.cpl` (`lead_source_company` + `source_granularity_key` set). `CplRate.find` for the 14-slot book is not called. This is the live path after leftover seed.
- When leftover flatten is empty, seed missing 14-slot labels and return 14 definition rows. Already locked — keep it.
- Inactive leftover companies are included (`includeInactive: true`).

**Cache seam**
- `forgetTheLeftoverFourteenSlotCache` makes the next slot read hit Mongo again.

Do **not** add a test per helper (`seedAnyMissingFourteenSlots`, `bestRelocationFormsSplitOnMoveType`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add `updateCplRate` tests. Do not re-test `priceTheLead`, Registry snapshot HTTP, or leftover Source Company match here. `getCplForSource` first-try leftover nested is `config/domain/cpl.ts` — do not re-test that catch ladder here.

## What I would not do

- A `CplRateService` class with `get` / `list` / `update`.
- Thirty two-line functions that only wrap `cplRateCacheKey` or spread a definition.
- Moving this into a CRUD folder, or into `leads/` / `operationsRegistry/` / `config/domain/` “because it talks to CPL.”
- Adding `updateCplRate` or a PATCH so comments and inventory look true.
- Routing Lead ingest or Owner snapshot through this leftover book.
- Teaching slot read to flatten nested leftover prices, or deleting the 14-slot list fallback because leftover seed always has companies.
- Turning seed into an upsert-merge, or caching the Mongo-down empty map.
- Silently dropping `getCplForSource`’s leftover first try, or calling leftover CPL from Form/Call ingest.
- Pulling `cplRateDefinitions.ts` or `getCplForSource` into this Wave A file.
