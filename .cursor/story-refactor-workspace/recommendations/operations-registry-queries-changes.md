# Show The Successful Registry Change Cards — Flatten Secrets On The Way Out Again — Never Stamp A Card — Never Count The Shelf — Never Write A Finding — Never Decide Who May Speak — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 18 of this service — `queries/changes.ts`
- Remaining in this service: `labelMappings.ts`, `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/queries/changes.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Authorization and audit: approved signed dashboard roles may read; Registry Changes are authoritative successful mutation history; Operational Events are reserved for failures, ambiguity, drift, and leftover-path walks — this file **reads** Change cards only; it does **not** write a Change and it does **not** load leftover Events). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (routes import queries from this folder; mutation and `operations_registry_changes` insert share one Mongo transaction — that write lives on already-recommended stamp, not here; audit snapshots must be bounded and redact secrets — this file **asks** skipped flatten on the way out). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (`withRegistryMutation` **writes** the card this file **reads**; already-recommended stamp **asks** skipped flatten before persist). Already-recommended leftover overview: [recommendations/operations-registry-queries-overview.md](operations-registry-queries-overview.md) (`getRegistryOverview` **counts** all-time Change rows; it does **not** load `items`). Already-recommended leftover health: [recommendations/operations-registry-queries-health.md](operations-registry-queries-health.md) (`getRegistryHealth` **asks** leftover `OperationsRegistryChange.findOne` whose `actor_id` matches `/^operations-registry-m\d+$/` — one leftover migration card, not this page). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B `requireRegistryReadActor` **asks** that file **before** this one). Skipped sibling flatten: `snapshotSanitizer.ts` (`sanitizeRegistrySnapshot` / `sanitizeRegistryMetadata` — this file **asks** both; it does **not** flatten). Leftover Wave B query: `src/validation/v1/operationsRegistry.validation.ts` (`registryChangesQuerySchema` — entity / actor / action / request / from / to / page / limit; empty strings become omitted; dates coerce; page ≥ 1; limit 1–100). Leftover next label mappings / leftover next Granot create / leftover next setup **write** cards through already-recommended stamp; they do **not** import this file. Leftover next Lead Source projection **does not** list Change cards. This checkout’s `CONTEXT.md` does not define Registry Change — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleOperationsRegistryChanges`: leftover `registryChangesQuerySchema.parse(req.query)`, leftover `requireRegistryReadActor`, then leftover `listRegistryChanges`; `GET /api/v1/admin/operations-registry/changes`). Barrel: `operationsRegistry/index.ts` (`listRegistryChanges` only — leftover `toListItem` / leftover `buildFilter` are **not** barrelled). Tests: **none on this file**. Wave B `v1.routes.test.ts` asserts leftover overview + leftover Lead Source projection + leftover setup route strings — it does **not** assert leftover `/changes` or leftover `/health`. Leftover `trustedActor.test.ts` signs leftover overview / leftover health **paths** — that is leftover who-may-speak’s **interface**, not this one. Skipped `snapshotSanitizer.test.ts` proves redact / bound / null — skipped flatten’s **interface**. Already-recommended `registryAudit.test.ts` proves stamp rollback / reused `request_id` — already-recommended stamp’s **interface**. Already-recommended leftover overview / leftover health **do not import this file**. Leftover next `queries/leadSourceProjection.ts` **does not** ask this list.
- Seams callers need: show-the-cards (`listRegistryChanges`: filter the successful history + page it + flatten each snapshot again on the way out). There is no stamp **seam**. There is no count-the-shelf **seam**. There is no health-finding **seam**. There is no leftover-migration-card **seam**. There is no who-may-speak **seam**. There is no flatten **seam** as a public export. There is no Operational Event **seam**.
- Split later (only if the file outgrows one sitting): this ~81-line file is one sitting if you read it as show the successful Registry Change cards — flatten secrets on the way out again — never stamp a card — never count the shelf — never write a finding — never decide who may speak. Do **not** split filter vs page vs flatten into three public modules a leftover dashboard could import independently so “overview only counts and health only looks for leftover `operations-registry-m*`” — Wave B already **asks** one list. Do **not** split leftover `toListItem` into a public flatten **adapter** leftover health could import so “one mapper owns the leftover migration card.” If it later splits: `showTheSuccessfulRegistryChangeCards.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `changes.ts`, and never merge leftover overview counts, leftover health findings, leftover next Lead Source projection, already-recommended stamp, leftover who-may-speak, skipped flatten, leftover Wave B Zod, leftover `EntityChange`, or Wave B HTTP into this file

`listRegistryChanges` is executor mechanics. The owner question is: *Show me the Registry Change cards that already landed. I can ask for one book, one actor, one action, one request, or a time window, a page at a time. Each card’s before / after / metadata is flattened again so a secret that slipped through the stamp still does not leave the building. This page does not write a card. This page does not say how many books sit on the shelf. This page does not say which book is broken. This page does not decide who may speak. This page does not mix leftover Operational Events into the list — those rows are failures and leftover-path walks, not successful history.*

Already-recommended stamp, already-recommended leftover overview, already-recommended leftover health, leftover next Lead Source projection, leftover who-may-speak, skipped flatten, leftover Wave B Zod, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “show the successful Registry Change cards — flatten secrets on the way out again — never stamp a card — never count the shelf — never write a finding — never decide who may speak” story, not “a changes CRUD helper,” and not leftover overview / leftover health / leftover stamp:

1. **Show the successful Registry Change cards** — after leftover `connectMongo`, leftover `buildFilter` keeps exact `entity_type` / `entity_id` / `actor_id` / `action` / `request_id` when present, and `created_at` `$gte` / `$lte` when leftover `from` / leftover `to` is present. Page defaults to `1` (`??` only). Limit defaults to `25` and is clamped `1…100` here even if Wave B Zod already capped it. Sort is `created_at` desc, then `_id` desc. One `Promise.all` loads the page (`skip` / `limit` / leftover `lean`) and leftover `countDocuments` on the same filter. `has_next_page` is `skip + items.length < total`. This beat does **not** write a Change. This beat does **not** count Agent / Merchant / Feed books. This beat does **not** write a finding. This beat does **not** load leftover Operational Events. This beat does **not** special-case leftover `actor_id` `/^operations-registry-m\d+$/` — a leftover migration card is just another row if the filter matches. This beat does **not** join the live Agent / Feed / Granot name.

2. **Flatten secrets on the way out again** — leftover `toListItem` maps `_id` → `id` string, copies entity / action / actor / `request_id`, sets `reason` to `doc.reason ?? null`, ISO-stamps `created_at`, and **asks** skipped `sanitizeRegistrySnapshot` for `before` / `after` and skipped `sanitizeRegistryMetadata` for `metadata`. Already-recommended stamp already **asked** the same flatten before persist. This beat runs again so a leftover pre-flatten card, or a raw insert that skipped the stamp, still redacts secret-like keys and bounds depth before Wave B returns `{ ok, data }`. This beat does **not** invent a second redact **adapter**. This beat does **not** echo a token that skipped flatten already replaced with `[redacted]`.

There is no stamp operation. There is no count-the-shelf operation. There is no finding operation. There is no who-may-speak operation. Leftover `buildFilter` / leftover `toListItem` are keep-or-drop / flatten-or-skip beats, not public **seams**.

Do not export `buildFilter` as a public **seam**. Do not export `toListItem` as a public **seam**. Do not export a standalone `countRegistryChanges` leftover overview could call without the page. Do not export leftover `getRegistryOverview` from this file.

## Organization

Keep one file as the screenplay for “show the successful Registry Change cards, flatten secrets on the way out again, never stamp a card, never count the shelf, never write a finding, never decide who may speak.” Already-recommended stamp, already-recommended leftover overview, already-recommended leftover health, leftover next Lead Source projection, leftover who-may-speak, skipped flatten, leftover Wave B Zod, leftover `OperationsRegistryChange` model, leftover `connectMongo`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RegistryChangesService` class. Do not invent a persist / finalize **seam** — this file is a read. Do not invent a second flatten **adapter** beside skipped `sanitizeRegistrySnapshot`. Do not invent a second who-may-speak **adapter** beside leftover `requireRegistryReadActor`. Do not invent a second stamp **adapter** beside already-recommended `withRegistryMutation`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`. Those are persistence nouns, not the owner story. Do not move leftover overview `registry_changes_total` into this file so “the list owns the shelf count.” Do not move leftover health’s leftover-migration `findOne` into this file so “one page owns leftover `operations-registry-m*`.” Do not move already-recommended stamp into this file so “one file owns the Change.” Do not silently merge leftover `EntityChange` rows so “all history is one list” — leftover `entity_changes` is a different collection and leftover next `domainCommands` is unvisited.

**External interface** stays small (this is the test surface). Show-the-cards and flatten-again are one story’s read, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listRegistryChanges` | `showTheSuccessfulRegistryChangeCards` | Wave B Owner/Admin Change history |

Keep the old name as a one-line alias until Wave B `v1.routes.ts` and the barrel migrate. Do not make callers learn `items` / `has_next_page` as the domain language.

**Principle: old exports stay as aliases.** `listRegistryChanges` remains the imported name until Wave B points at the story name. Persisted Change `action` strings (`create` / `update` / `activate` / `deactivate` / `rename` / `schedule_apply` / `validate` / `reassign` / `correction`), leftover `entity_type` strings (`agent` / `merchant` / `source_company` / `source_granularity` / `cpl_schedule` / `ringcentral_route` / `ringcentral_assignment` / `registry` / `granot_crm_source` / `granot_crm_source_sms_policy` / `granot_automation_source` / `source_label_mapping`), leftover `actor_type` strings (`owner` / `admin` / `system`), leftover unique `request_id`, and HTTP field names `items` / `page` / `limit` / `total` / `has_next_page` stay those strings — they are already-recommended stamp’s history and Wave B’s body, not story names.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover `types.ts` already exports (today `ListRegistryChangesResult`):

```ts
type ShowTheSuccessfulRegistryChangeCards = {
  items: ThisSuccessfulRegistryChangeCard[]
  page: number
  limit: number
  total: number
  has_next_page: boolean
}

type ThisSuccessfulRegistryChangeCard = {
  id: string
  entity_type: /* leftover RegistryChangeEntityType — persisted strings */
  entity_id: string
  action: /* leftover RegistryChangeAction — persisted strings */
  actor_type: /* leftover RegistryChangeActorType */
  actor_id: string
  actor_label: string
  actor_role: string
  request_id: string
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown>
  created_at: string
}
```

That is the handoff from “the successful history was filtered, paged, and flattened again” to “Wave B returns `{ ok, data }`.” Do **not** add leftover overview `counts` / `signing` / `runtime` onto this bag so “the list owns the shelf.” Do **not** add leftover `findings` onto this bag so “the list owns health.” Do **not** add leftover `owner_message` onto a card so “the list speaks Owner.” Do **not** store a token on `before` / `after`. Do **not** add leftover Operational Event rows onto `items` so “failures appear next to successful cards.”

Do not add `requireRegistryReadActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add `sanitizeRegistrySnapshot` as a public **seam** — skipped `snapshotSanitizer.ts` already owns bounded redact. Do not add `withRegistryMutation` as a public **seam** — already-recommended stamp already owns the write. Do not add `getRegistryOverview` as a public **seam** — already-recommended leftover overview already owns the shelf. Do not add `getRegistryHealth` as a public **seam** — already-recommended leftover health already owns findings. Do not add `getLeadSourceProjection` as a public **seam** — leftover next `queries/leadSourceProjection.ts` already owns the Feed page.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queries/changes.ts
// Show the Registry Change cards that already landed.
// Filter by book, actor, action, request, or when.
// Flatten each snapshot again before the owner sees it.
// Do not write a card.
// Do not count the shelf.
// Do not say which book is broken.
// Do not decide who may speak.

// ── 1. Show the successful Registry Change cards ──

function keepOnlyTheCardsTheOwnerAskedFor(query) // leftover buildFilter — exact entity / actor / action / request; created_at window when from/to present
function howManyCardsFitOnThisPage(query) // page ?? 1; limit default 25 clamped 1…100

export async function showTheSuccessfulRegistryChangeCards(query)

// ── 2. Flatten secrets on the way out again ──

function flattenThisCardBeforeTheOwnerSeesIt(doc) // leftover toListItem — asks skipped sanitizeRegistrySnapshot / sanitizeRegistryMetadata
```

Read the primary path out loud: *Open Mongo. Keep only the cards the owner asked for — this book, this actor, this action, this request, this window. Take one page, newest first, at most one hundred. Count how many cards match so the owner knows whether another page remains. Flatten each card’s before / after / metadata again so a secret does not leave the building. Do not stamp a card. Do not count the shelf. Do not write a finding. Do not decide who may speak.*

That is the operation. `listRegistryChanges` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no test on this interface.** Wave B does not even assert leftover `GET .../changes` is registered (it asserts leftover overview + leftover Lead Source projection + leftover setup). Leftover who-may-speak signs leftover overview / leftover health paths. Skipped flatten tests redact in isolation. Already-recommended stamp tests the write. A later implementer must add the tests below before renaming.

2. **`page` is not clamped. `limit` is.** `query.page ?? 1` keeps `0` (and any negative) because `??` only replaces nullish. Wave B Zod `min(1)` saves HTTP. A barrel caller passing `page: 0` computes `skip = -limit`. Do not silently clamp `page` to ≥ 1 so “the service matches Zod” without a paired barrel / TEST_MODE skip test. Do not silently remove the leftover `limit` clamp so “Zod owns paging” — the barrel can call this file without Zod.

3. **`from` after `to` is accepted.** The filter becomes `{ created_at: { $gte: from, $lte: to } }` and the page is empty. Wave B Zod coerces dates and does not order them. Do not silently swap the bounds or throw so “the window is valid” in this rename.

4. **The filter is exact match only.** Leftover health finds leftover migration evidence with `actor_id: { $regex: /^operations-registry-m\d+$/ }`. This file matches leftover `actor_id` as a string. The owner cannot ask “every leftover `operations-registry-m*` card” without knowing the exact id. Do not silently add a regex / leftover `actor_type=system` filter so “the list can find leftover migration cards.” Do not silently pin the latest leftover migration card to page 1 so “health and list agree.”

5. **The filter omits leftover `actor_type` and leftover `actor_role`.** Those fields are on every card and on leftover `toListItem`. Do not silently add them so “the owner can hide leftover `system`” without a paired Wave B Zod + leftover dashboard test. Do not silently drop them from the DTO so “the list only shows who / what / when.”

6. **Flatten runs twice — on stamp and on read.** Already-recommended stamp already **asks** skipped flatten before persist. Do not silently drop leftover `toListItem`’s flatten so “write already redacted.” A leftover card stamped before flatten, or a raw `OperationsRegistryChange.create` that skipped the stamp, would leak. Do not silently move skipped flatten into this file so “the list owns redact.”

7. **`reason: doc.reason ?? null` keeps `""`.** Already-recommended stamp trims and omits empty. A leftover empty string from a raw insert becomes `""`, not `null`. Do not silently coerce `""` to `null` so “the DTO is clean” without a paired stamp test that empty reason stays omitted on write.

8. **`total` is the filtered match count, not leftover overview `registry_changes_total`.** Overview is all-time, unfiltered. This page’s `total` shrinks with the filter. Do not silently copy leftover overview’s all-time count onto this bag so “the numbers match.” Do not silently count leftover Events into `total` so “failures are history.”

9. **This collection is not leftover `EntityChange`.** Leftover `entity_changes` is leftover next `domainCommands` evidence. Leftover `operations_registry_changes` is Registry card history. Do not silently `$union` the two so “one history page” — knowledge already splits successful Registry Changes from other mutation evidence.

10. **Sort is `created_at` desc, then `_id` desc.** Leftover `request_id` is unique; leftover `created_at` can collide. Do not silently drop the `_id` tie-break so “time is enough.”

11. **Leave sibling modules alone.** Already-recommended `withRegistryMutation`, leftover `getRegistryOverview`, leftover `getRegistryHealth`, leftover `requireRegistryReadActor`, skipped `sanitizeRegistrySnapshot` / leftover `sanitizeRegistryMetadata`, leftover `registryChangesQuerySchema`, leftover next `getLeadSourceProjection`, and leftover `OperationsRegistryChange` are already the right **depth**. This file lists and flattens again; it does not stamp, count the shelf, judge the shelf, or decide who may speak.

12. **Do not silently change persisted leftover `action` / leftover `entity_type` / leftover `request_id` strings.** Those are already-recommended stamp’s history and Wave B query enums. Story names live on the functions.

## Testing

The **interface** is the test surface: `showTheSuccessfulRegistryChangeCards` (today `listRegistryChanges`). Do not make leftover `buildFilter` / leftover `toListItem` the named surface.

Today there is **no** `queries/changes.test.ts`. Wave B does not assert this route string. Add tests that name the operation:

**Show the successful Registry Change cards**
- Empty collection → `{ items: [], page: 1, limit: 25, total: 0, has_next_page: false }`.
- Three cards, default query → newest first, `total: 3`, `has_next_page: false`.
- `limit: 1` on three cards → one item, `has_next_page: true`. Page `2` → the middle card, still `has_next_page: true`. Page `3` → oldest, `has_next_page: false`.
- Filter leftover `entity_type: "agent"` + leftover `entity_id` returns only that book’s cards. A leftover `source_company` card on the same leftover `entity_id` string does **not** appear.
- Filter leftover `request_id` returns 0 or 1 (unique index).
- Filter leftover `from` / leftover `to` keeps a card whose `created_at` is inside the window and drops one outside.
- `from` after `to` → empty page, `total: 0` (lock today’s empty-window behavior).
- A leftover `actor_id: "operations-registry-m4"` card appears only when the owner asks for that exact id — not because leftover health looks for leftover `/^operations-registry-m\d+$/`.
- The bag has **no** `counts` key, **no** `findings` key, **no** leftover Event rows, and **no** live Agent / Feed join.
- Do not add a leftover `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.

**Flatten secrets on the way out again**
- A stored `before: { api_key: "x", nested: { token: "y" } }` returns `[redacted]` on those keys. Do not retest skipped flatten’s depth bound / null cases here — skipped `snapshotSanitizer.test.ts` already owns that **adapter**. Prove this file **asks** it on `before` / `after` / `metadata`.
- A stored `reason: undefined` → `null`. A stored `reason: ""` stays `""` (lock that).
- Do not retest leftover `withRegistryMutation` rollback or leftover `REGISTRY_DUPLICATE_IDENTIFIER` here. Already-recommended stamp already owns those **adapters**.

Do **not** add a test per helper (`keepOnlyTheCardsTheOwnerAskedFor`, `flattenThisCardBeforeTheOwnerSeesIt`, `howManyCardsFitOnThisPage`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover overview shelf counts, leftover health finding codes, leftover `FINDING_TRANSLATION_TABLE` rows, leftover who-may-speak signatures, leftover stamp rollback, leftover Lead Source projection round-trips, or Wave B route mounts here. Those already have (or will have) their own interface tests. Wave B **asks** the show. Prove the page, not the finding.

## What I would not do

- A `RegistryChangesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `find` / leftover `countDocuments`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`) for cleanliness.
- Breaking the show-the-cards / flatten-again **seam**. A public leftover `buildFilter` leftover health could import without the page is the forbidden split. Returning leftover overview `counts` or leftover `findings` from this file is the same break. Calling leftover `withRegistryMutation` from this file is the same break.
- Treating leftover overview, leftover health, leftover next Lead Source projection, leftover next label mappings, leftover next Granot create, leftover next setup, already-recommended stamp, leftover who-may-speak, skipped flatten, leftover Wave B Zod, leftover `EntityChange`, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not clamp `page` to ≥ 1 without a paired skip test; do not remove the leftover `limit` clamp; do not swap `from` / `to`; do not add leftover `actor_id` regex or leftover `actor_type` / leftover `actor_role` filters; do not pin leftover `operations-registry-m*` cards; do not drop the read-time flatten; do not coerce `reason: ""` to `null`; do not copy leftover overview’s all-time count onto this bag; do not merge leftover Operational Events or leftover `EntityChange` rows; do not drop the `_id` sort tie-break; do not move leftover `requireRegistryReadActor` or skipped flatten into this file; do not rename persisted leftover `action` / leftover `entity_type` / leftover `request_id` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
