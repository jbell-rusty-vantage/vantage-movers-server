# Talk Through The Leftover Agent And Merchant Catalog — operational story

- Status: recommended
- Service: `catalog` (Wave A, visited)
- Pass: 1 of this service — `catalog.service.ts`
- Remaining in this service: none — `index.ts` already skipped as a barrel
- Target: `src/services/catalog/catalog.service.ts`
- Knowledge: `docs/knowledge/services/catalog.md` (this leftover facade + Registry `catalogRegistry.ts` as authority). Binder remember: `docs/knowledge/services/agent-allocation.md`. Booking merchant field: `docs/knowledge/services/bookings.md`. Employee options: `docs/knowledge/services/employee-bookings.md`. Owner transaction / audit / cache: `docs/knowledge/services/operations-registry.md`. This checkout’s `CONTEXT.md` does not define Agent / Merchant — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` leftover admin list/detail/create/update (`GET|POST /admin/catalog/agents`, `GET|POST|PATCH /admin/agents`, `GET|POST|PATCH /admin/merchants` — no `/admin/catalog/merchants` alias). Activation and dependency preview **skip this file** (`setAgentActivation` / `setMerchantActivation` / `previewRegistryDependency` + a pasted flatten). `employeeBookings/getEmployeeBookingOptions.service.ts` (`listCatalogItems` active). `admin/filterCatalog.ts` (`listCatalogItems` include-inactive for registry facets). `agents/agentAllocation.service.ts` (`resolveAgentByName`). `bookedLead.service.ts` / `referralBooking.service.ts` / `leadlessBooking.service.ts` / `employeeBookingPreparation.ts` (`resolveActiveMerchantName`). Barrel: `catalog/index.ts`. Tests: `catalog.service.test.ts` (list filter + two Agent remember paths + Merchant display name). Registry tests stay in `catalogRegistry.test.ts`.
- Seams callers need: leftover flattened card vs full Registry card; Agent remember returns the Registry card, Merchant remember returns the display **name**; `includeInactive` on leftover list and Agent remember only; leftover POST/PATCH vs route-owned `/activation` and `/dependencies`
- Split later (only if the file outgrows one sitting): keep one file — leftover cards and name remember are one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`listCatalogItems` / `getCatalogItem` / `createCatalogItem` / `updateCatalogItem` are executor mechanics. The owner question is: *the leftover catalog is how leftover admin pages, employee booking options, and Booking writes still talk to Agents and Merchants. The Operations Registry owns the cards. Show a flattened leftover card. Record or correct a card through Registry upsert. Remember a named Agent (the full Registry card) or a named Merchant (display name only) for a Booking. Do not invent an Agent. Do not activate here. Do not preview who still depends on a card.*

Registry `createOrUpdate*` / activation / dependency preview are `operationsRegistry/catalogRegistry.ts`. Who shares the Binder is `agentAllocation.service.ts`. Receiver stamp from a Granot username is `receiverAgentCrmUsername.ts`. Do not pull those in.

## What this file actually does

Four operations, not “a catalog CRUD service,” and not the Owner Registry transaction:

1. **Show leftover catalog cards** — list or fetch one Agent or Merchant from the Registry. Flatten to `CatalogItem` (`id` and `_id` are the same string; Granot username from `granot_crm_username` or nested `granot_identity.username`). Drop aliases, nested identity, `archived_at`, and `deactivation_reason`. Default list is active only. `includeInactive` is the leftover admin page and registry facets. Employee booking options call the active list.
2. **Record or correct a leftover catalog card** — leftover POST has no id; leftover PATCH has an id. Both call Registry `createOrUpdateAgent` / `createOrUpdateMerchant` with a signed Owner actor, then flatten. Agent may send `role` and `granot_crm_username`. Merchant may not. Registry decides create / rename / update / activate / deactivate and writes the Change row. This file does not open a transaction.
3. **Remember the named Agent** — fold the name, look up `$or: [{ normalized_name }, { name_aliases }]`. Default: active only (`Unknown or inactive agent`). `{ includeInactive: true }` may return a deactivated Agent (`Unknown agent` if missing). Return the **full** `RegistryCatalogItem`. Do **not** create. Binder allocation is the caller. `resolveActiveAgentByName` is the same remember with no options.
4. **Remember the named Merchant's display name** — active only (`Unknown or inactive merchant`). Return canonical display `name`, not an id. Book This Lead, Referral, Leadless, and employee prepare store that string on `BookedLead.merchant`. There is no include-inactive **seam**.

`normalizeCatalogName` is a one-line pass-through to `normalizeAgentName`. It is not a fifth operation.

## Organization

Keep one file. This is the screenplay for “leftover readers still talk to Agents and Merchants through this catalog.” Registry upsert, activation, dependency preview, Binder split, username receiver stamp, and admin facet merge already live in deeper **modules**. Do not pull those in. Do not invent a `CatalogService` class. Do not invent a `begin` / `complete` **seam** — leftover POST/PATCH are not a command. The command lives in Registry.

Do not split this 157-line file by list / get / create / update. Leftover cards and name remember are one leftover catalog. `kind === "agents" | "merchants"` stays a child of each operation, not two folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listCatalogItems` | `showLeftoverCatalogCards` | leftover admin list, employee options (active), registry facets (`includeInactive`) |
| `getCatalogItem` | `showOneLeftoverCatalogCard` | leftover admin detail |
| `createCatalogItem` | `recordALeftoverCatalogCard` | leftover POST; Registry upsert with no id |
| `updateCatalogItem` | `correctALeftoverCatalogCard` | leftover PATCH; same upsert with id |
| `resolveAgentByName` | `rememberTheNamedAgent` | Binder allocation; full Registry card; `includeInactive` is Best Relocation |
| `resolveActiveAgentByName` | `rememberTheNamedActiveAgent` | one-line active-only remember; tests + barrel only |
| `resolveActiveMerchantName` | `rememberTheNamedMerchantDisplayName` | Booking writes store the display name |
| `CatalogItem` | `LeftoverCatalogCard` | leftover page / employee form projection |
| `CatalogKind` | `LeftoverCatalogKind` | `"agents"` \| `"merchants"` |

Keep the old names as one-line aliases until leftover admin routes, employee options, facets, Binder remember, and Booking merchant writes migrate. Do not make callers learn `createOrUpdate` / `toLegacy` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the leftover card leftover pages already get:

```ts
type LeftoverCatalogCard = {
  id: string
  _id: string
  name: string
  normalized_name: string
  active: boolean
  created_from: string
  role?: string
  granot_crm_username?: string
  createdAt?: Date
  updatedAt?: Date
}
```

That is the handoff from “Registry has a card” to “leftover UI can show it without aliases or nested identity.” There is no after-commit bag: Registry invalidates `agents` / `merchants` / `catalog` / `facets` after its own commit. Agent remember returns `RegistryCatalogItem` on purpose — do not flatten that **seam** so “every export returns CatalogItem.”

`normalizeCatalogName` stays an alias of `normalizeAgentName` until the barrel drops it. Do not move the fold into this file “so the catalog owns names.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// catalog.service.ts
// Leftover admin pages, employee booking options,
// and Booking writes still talk to Agents and Merchants here.
// The Operations Registry owns the cards.
// Show a flattened leftover card.
// Record or correct a card through Registry upsert.
// Remember a named Agent (full Registry card)
// or a named Merchant (display name only).
// Do not invent an Agent.
// Do not activate here.
// Do not preview who still depends on a card.

// ── 1. Show leftover catalog cards ────────────────────────

export async function showLeftoverCatalogCards(kind, { includeInactive } = {})
export async function showOneLeftoverCatalogCard(kind, id)

async function loadRegistryCards(kind, options)
function flattenToALeftoverCatalogCard(item)   // id+_id; username from either field

// ── 2. Record or correct a leftover catalog card ──────────

export async function recordALeftoverCatalogCard(kind, input, owner)
export async function correctALeftoverCatalogCard(kind, id, input, owner)

async function upsertTheRegistryCard(kind, command, owner)
function agentFieldsTheLeftoverFormMaySend(input)     // role, granot username
function merchantFieldsTheLeftoverFormMaySend(input)  // name, active, reason only

// ── 3. Remember the named Agent ───────────────────────────

export async function rememberTheNamedAgent(name, { includeInactive } = {})
export async function rememberTheNamedActiveAgent(name)  // no options

function refuseAnUnknownOrInactiveAgent(name, includeInactive)

// ── 4. Remember the named Merchant's display name ─────────

export async function rememberTheNamedMerchantDisplayName(name)

function refuseAnUnknownOrInactiveMerchant(name)
```

Read the leftover card path out loud: *ask the Registry for Agents or Merchants. Flatten each card so leftover pages see `id` and `_id` as the same string and one Granot username. Hide aliases and nested identity. Active only unless the leftover admin page or registry facets asked for inactive too.*

Read record / correct out loud: *the leftover form sent a name, and maybe a role or Granot username. Hand that to Registry upsert with the Owner actor. POST has no id. PATCH has an id. Flatten what comes back. Registry writes the Change row. This file does not.*

Read Agent remember out loud: *fold the name. Find the Registry Agent by normalized name or alias. Inactive is a miss unless Best Relocation asked to include them. Hand the full Registry card to Binder allocation. Do not insert an Agent.*

Read Merchant remember out loud: *find the active Merchant. Hand back the display name the Booking will store. There is no id and no inactive path.*

That is the operation. `createCatalogItem` is not. `updateCatalogItem` is not a different story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This folder is not the Owner catalog write.** Knowledge Role says list/detail/resolve plus Owner create, rename, username, **and activation**. Activation and dependency preview live on the route and call Registry directly. This file never sees them. Rename so leftover show / leftover upsert / name remember are visible. Do **not** move `setAgentActivation` here “because knowledge lists activation on Catalog Service.”

2. **Create and update are one upsert.** Both call `createOrUpdate*` and flatten. The only leftover difference is “no id” vs “id.” Registry then picks create / rename / update / activate / deactivate from the payload. Do not invent a local insert so `createCatalogItem` looks like create, and do not split this file into `create.ts` / `update.ts`.

3. **The leftover card flatten is pasted twice.** `toLegacyCatalogItem` lives here. `toLegacyCatalogResponse` in `v1.routes.ts` is the same projection for `/activation`. Do not silently delete the route copy in this rename, and do not teach `/activation` to call this file “for DRY” without a test that the flattened username still comes from either field.

4. **Two remember return types are the point.** Agent remember returns `RegistryCatalogItem` (aliases + identity). Leftover list/get drop those. Merchant remember returns a **string**. Knowledge already says merchant resolution is display name, not ObjectId. Do not flatten Agent remember, and do not start returning a Merchant id so “both remembers look the same.”

5. **`resolveActiveAgentByName` has no runtime caller.** Binder allocation calls `resolveAgentByName` and passes `includeInactive` for Best Relocation. Knowledge Downstream and the “Not the same as” line still say allocation consumes `resolveActiveAgentByName`. Tests are the live caller. Do not delete the alias so knowledge “wins,” and do not change allocation to the active-only export.

6. **Facets do not import this file.** Knowledge Downstream names `adminFacets.service.ts`. The import is `admin/filterCatalog.ts` (the first-class catalog loader → `listCatalogItems(..., { includeInactive: true })`). Facets cache and historical overlay sit one **module** deeper. Do not pull facet merge into this rename, and do not change leftover list to active-only “because employee options already filter active.”

7. **Merchant leftover writes drop Agent-only fields.** `role` and `granot_crm_username` are ignored on merchant upsert. Do not start storing them on `Merchant` so the leftover form can send one body.

8. **`CATALOGS` is a ghost.** Zod still says omitted `created_from` defaults from `CATALOGS` in this file. The map is gone. Registry defaults `created_from` to `"admin"`. Do not add `CATALOGS` back so the comment wins.

9. **Leave sibling modules alone.** `createOrUpdateAgent`, `createOrUpdateMerchant`, `setAgentActivation`, `previewRegistryDependency`, `resolveAgentAllocations`, `applyGranotCrmUsernameReceiverMatch`, and the first-class catalog loader in `filterCatalog.ts` stay where they are. This file orchestrates leftover flatten and leftover name remember.

10. **Do not treat Registry catalog write as this story.** Uniqueness, alias merge, Granot username verify-reset, Change rows, and cache invalidation are `catalogRegistry.ts`. Wave A will open `operationsRegistry` later. Do not pull that folder into this pass.

## Testing

The **interface** is the test surface: `showLeftoverCatalogCards`, `showOneLeftoverCatalogCard`, `recordALeftoverCatalogCard`, `correctALeftoverCatalogCard`, `rememberTheNamedAgent`, `rememberTheNamedMerchantDisplayName`. Keep `rememberTheNamedActiveAgent` exported because today’s tests call it — it is not a third remember story.

Today’s `catalog.service.test.ts` stubs `Agent.find` / `findOne` and `Merchant.findOne`. It locks active list filter, active-only Agent miss copy, include-inactive Agent filter (`normalized_name` **or** `name_aliases`), and Merchant display-name return. That is the remember **seam**, not leftover flatten or leftover upsert. Fill the gaps the story names make obvious:

**Show leftover catalog cards**
- Active list asks Registry with `{ active: true }` (already locked for Agents — keep it; add Merchants).
- `includeInactive: true` does not add `active: true` (leftover admin + registry facets).
- Flatten sets `id` and `_id` to the same string, copies `granot_crm_username` when nested identity is the only username, and omits `name_aliases` / `granot_identity` / `archived_at`.

**Record or correct a leftover catalog card**
- Leftover record calls `createOrUpdateAgent` / `createOrUpdateMerchant` with no id and the Owner actor, then flattens.
- Leftover correct passes the id through. Agent may send `role` and `granot_crm_username`. Merchant command does not.
- Missing Owner actor is Registry’s refusal, not a new 400 in this file. Stub the Registry upsert; do not re-test Change rows here.

**Remember the named Agent**
- Active miss → `Unknown or inactive agent: {name}` (already locked).
- `includeInactive: true` returns an inactive Agent and uses `$or: [{ normalized_name }, { name_aliases }]` (already locked). Missing then → `Unknown agent: {name}`.
- Returned value is a `RegistryCatalogItem`, not a leftover card.

**Remember the named Merchant's display name**
- Folded `"paper   check"` → stored `"Paper Check"` (already locked).
- Miss / inactive → `Unknown or inactive merchant: {name}`. No include-inactive path.

Do **not** add a test per helper (`flattenToALeftoverCatalogCard`, `agentFieldsTheLeftoverFormMaySend`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Registry uniqueness, alias merge, Granot username collision, `/activation`, or `/dependencies` here. Those are `catalogRegistry.ts` and the leftover route. Do not add `normalizeCatalogName` unit tests.

## What I would not do

- A `CatalogService` class with `create` / `update` / `list` / `get`.
- Thirty two-line functions that only wrap `kind === "agents"`.
- Moving this into a CRUD folder, or into `operationsRegistry/` / `agents/` / `admin/` “because it talks to those.”
- Teaching leftover remember to insert an Agent so Book This Lead comments about “upsert reference `agents`” look true.
- Flattening Agent remember, or returning a Merchant id, so both remembers look the same.
- Moving `/activation` or `/dependencies` into this file so knowledge Role looks true.
- Adding `CATALOGS` back, or storing Agent-only fields on Merchant.
- Silently deleting the route’s pasted flatten, or pulling `catalogRegistry.ts` into this Wave A pass.
