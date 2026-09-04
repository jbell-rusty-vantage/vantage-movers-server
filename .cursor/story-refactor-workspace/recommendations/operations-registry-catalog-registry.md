# Record Or Correct An Agent Or Merchant Card — Keep The Old Folded Name As An Alias On Rename — Set Or Correct An Agent Granot Username And Reset Verification — Archive The Card Never Delete It — Count Who Still Depends On It — Write The Registry Change In The Same Transaction — Forget Agent Merchant Catalog And Facet Caches Only After Commit — Never Rewrite Booking Or Lead Snapshots — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 1 of this service — `catalogRegistry.ts`
- Remaining in this service: `sourceRegistry.ts`, `sourceResolution.ts`, `cplSchedule.ts`, `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/catalogRegistry.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (catalog lifecycle: deactivate never delete; rename keeps the prior folded name as an alias; Owner may set or correct an Agent Granot username; nested `granot_identity` is authoritative; changing a username resets verification; existing Booking and Lead snapshots are not rewritten). Facade DTO / leftover HTTP: [`docs/knowledge/services/catalog.md`](../../../docs/knowledge/services/catalog.md) (this file is the authority; leftover `catalog.service.ts` flattens). Binder remember: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md). Receiver stamp: [`docs/knowledge/services/agents-receiver-agent-crm-username.md`](../../../docs/knowledge/services/agents-receiver-agent-crm-username.md) if present, else already-recommended [recommendations/agents-receiver-agent-crm-username.md](agents-receiver-agent-crm-username.md). Distinct from already-recommended leftover facade: [recommendations/catalog-catalog.md](catalog-catalog.md) (**asks** this file; never opens the transaction). Distinct from leftover `normalizeAgentName`: `agents/agentName.ts`. Distinct from skipped sibling: `catalogNormalization.ts` (`normalizeGranotCrmUsername` — six-line uppercase fold). Distinct from leftover sibling: `registryAudit.ts` (`withRegistryMutation` — mutation + Registry Change in one transaction, cache invalidate after commit). Distinct from leftover Source Company / Source Granularity writes: `sourceRegistry.ts` (next pass). This checkout’s `CONTEXT.md` does not define Agent / Merchant — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: leftover `catalog.service.ts` (`list` / `get` / `createCatalogItem` / `updateCatalogItem` / `resolveRegistry*ByName`). Wave B `v1.routes.ts` `/activation` (**asks** `setAgentActivation` / `setMerchantActivation` and pastes its own flatten) and `/dependencies` (**asks** `previewRegistryDependency`). Already-recommended Form Lead / Call Lead correction (**asks** `getRegistryAgent` to stamp `receiver_agent`). Already-recommended `receiverAgentCrmUsername.ts` (`findAgentByGranotCrmUsername` is a one-line alias of `resolveAgentByGranotUsername`). Barrel: `operationsRegistry/index.ts`. Tests: `catalogRegistry.test.ts` (two list-filter stubs). Leftover facade tests stay in `catalog.service.test.ts`.
- Seams callers need: leftover flattened card vs full Owner catalog card; leftover POST (no id) vs leftover PATCH (id) vs `/activation` (archive/restore only); Owner actor on every write; mutation + Registry Change before commit vs cache invalidate after commit (`withRegistryMutation`); name/alias remember vs nested-username remember; Agent dependents counted by id vs Merchant dependents counted by display name
- Split later (only if the file outgrows one sitting): this ~664-line file is one sitting if you read it as record or correct an Agent or Merchant card, keep the old folded name as an alias on rename, set or correct an Agent Granot username and reset verification, archive the card never delete it, count who still depends on it, write the Registry Change in the same transaction, forget agent / merchant / catalog / facet caches only after commit, never rewrite Booking or Lead snapshots. If it later splits: `recordOrCorrectAnAgent.ts` / `recordOrCorrectAMerchant.ts` / `archiveOrRestoreACatalogCard.ts` / `countWhoStillDependsOnThisCard.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover flatten, leftover `withRegistryMutation`, leftover Source Company writes, leftover Binder split, or leftover username receiver stamp into this file

`createOrUpdateAgent` / `createOrUpdateMerchant` / `setAgentActivation` / `setMerchantActivation` are executor mechanics. The owner question is: *Agents and Merchants are deactivated, never deleted. The Owner records a card, renames it and keeps the old folded name as an alias so old Bookings still resolve, sets or corrects an Agent Granot username (verification starts over), or archives it. Before archive, the Owner can count how many Bookings and Leads still point at this card. The write and one Registry Change share a transaction. Caches forget only after commit. Existing Booking allocations and Lead receiver snapshots are not rewritten. Do not invent an Agent on a Booking path. Do not flatten the card here — leftover catalog already does that.*

Leftover flatten, leftover transaction/audit, leftover Source Company writes, leftover Binder split, leftover username receiver stamp, and Wave B `/activation` HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “record or correct an Agent or Merchant card — keep the old folded name as an alias on rename — set or correct an Agent Granot username and reset verification — archive the card never delete it — count who still depends on it — write the Registry Change in the same transaction — forget agent merchant catalog and facet caches only after commit — never rewrite Booking or Lead snapshots” story, not “an Agent/Merchant CRUD service,” and not leftover catalog flatten:

1. **Show the Owner catalog cards** — `listRegistryAgents` / `listRegistryMerchants` / `getRegistryAgent` / `getRegistryMerchant`. Default list is `{ active: true }`. `includeInactive` is the leftover admin page and registry facets. Get-by-id has **no** active filter — Form Lead / Call Lead correction can stamp a deactivated Agent. Returns the full `RegistryCatalogItem` (aliases, nested identity, `archived_at`, `deactivation_reason`). This beat does **not** flatten. This beat does **not** open a transaction.

2. **Find a card by name, alias, or nested Granot username** — `resolveRegistryAgentByName` / `resolveRegistryMerchantByName` match `$or: [{ normalized_name }, { name_aliases }]` after leftover `normalizeAgentName`. Default: active only. `includeInactive` may return an archived card. `resolveAgentByGranotUsername` folds through skipped `normalizeGranotCrmUsername` and queries **only** `granot_identity.username` (test-locked; never the flat field). Missing → `undefined`. Leftover facade turns miss into `Unknown or inactive …`. This beat does **not** create.

3. **Record or correct an Agent** — `createOrUpdateAgent`. Owner only. No id → insert (`created_from` default `admin`, `role` default `agent`, `active` default true). Id → load or `NOT_FOUND`. Canonicalize display name (trim + collapse spaces; keep caller casing). Fold uniqueness with leftover `normalizeAgentName`. Rename refuses if another Agent already uses that folded name or alias (`DUPLICATE_IDENTIFIER`). Rename `mergeAlias`es the old folded name so prior names keep resolving. Owner may set or correct `granot_crm_username`: uniqueness is global against nested **or** flat; a change writes `granot_identity: { username, verified: false }` and the flat copy. Optional `active` on the same command can archive or restore (same `$set` / `$unset` as operation 5). **Ask** leftover `withRegistryMutation`. Audit `action` is persisted `create` | `update` | `rename` | `activate` | `deactivate` — do not rename those strings. Invalidate `agents`, `catalog`, `facets` **after** commit. This beat does **not** rewrite `BookedLead.agent_allocations` or Lead `receiver_agent_name_snapshot`.

4. **Record or correct a Merchant** — `createOrUpdateMerchant`. Same name / alias / optional archive story. No Granot username. Invalidate `merchants`, `catalog`, `facets`. Booking writes store the display **name**, not the id — this beat still does not rewrite those strings.

5. **Archive or restore a card — never delete** — `setAgentActivation` / `setMerchantActivation` → shared `setCatalogActivation`. Owner only. `active: false` sets `archived_at` + optional `deactivation_reason`. `active: true` `$unset`s those two fields. Wave B `/activation` **asks** this and pastes leftover flatten. Leftover PATCH may also send `active` through operations 3–4. There is no delete export. This beat does **not** count dependents first.

6. **Count who still depends on this card** — `previewRegistryDependency`. Read, no mutate. Agent: `BookedLead.agent_allocations.agent` + `FormLead.receiver_agent` + `CallLead.receiver_agent` (ids). Merchant: `BookedLead.merchant` `$in` `[name, ...name_aliases]` (display strings). `total` is the sum. Missing card → `NOT_FOUND`. Wave B `/dependencies` **asks** this with a read actor.

There is no seventh Booking-create operation. There is no Sheet Sync operation. There is no leftover flatten operation. Leftover `withRegistryMutation` is the transaction **adapter**. Leftover `catalog.service.ts` is the leftover-page **adapter**. Wave B `/activation` is a second archive **adapter**, not a second owner story.

`assertOwner` / `mutableAudit` / `toCatalogItem` sit on the write and show paths. They are not extra owner operations. Do not invent a dashboard for `RegistryCatalogKind` in this rename. Do not export `setCatalogActivation` / `assertCatalogNameAvailable` / `mergeAlias` as a public **seam**.

## Organization

Keep one file as the screenplay for “record or correct an Agent or Merchant card, keep the old folded name as an alias on rename, set or correct an Agent Granot username and reset verification, archive the card never delete it, count who still depends on it, write the Registry Change in the same transaction, forget agent / merchant / catalog / facet caches only after commit, never rewrite Booking or Lead snapshots.” Leftover flatten, leftover `withRegistryMutation`, leftover Source Company writes, leftover Binder split, leftover username receiver stamp, and Wave B `/activation` HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CatalogRegistryService` class. Do not invent a begin / complete **seam** — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a leftover-flatten **adapter** beside `toLegacyCatalogItem`. Do not invent a second name-fold **adapter** beside leftover `normalizeAgentName`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `agent.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move leftover flatten into this file so “one file owns the leftover page.” Do not move `withRegistryMutation` into this file so “catalog owns audit.” Do not silently rewrite Booking snapshots so “rename stays consistent.” Do not silently auto-create an Agent from Binder remember.

**External interface** stays small (this is the test surface). Show, find, record-or-correct, archive, and count-dependents are one story’s catalog cards, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listRegistryAgents` / `listRegistryMerchants` | `showTheOwnerAgentCards` / `showTheOwnerMerchantCards` | leftover list, employee options (active), registry facets (`includeInactive`) |
| `getRegistryAgent` / `getRegistryMerchant` | `showOneOwnerAgentCard` / `showOneOwnerMerchantCard` | leftover detail; Form/Call Lead receiver stamp by id (inactive still found) |
| `resolveRegistryAgentByName` / `resolveRegistryMerchantByName` | `findTheAgentByNameOrAlias` / `findTheMerchantByNameOrAlias` | leftover Binder / Booking remember; default active |
| `resolveAgentByGranotUsername` | `findTheAgentByNestedGranotUsername` | leftover username receiver stamp; nested field only |
| `createOrUpdateAgent` | `recordOrCorrectAnAgent` | leftover POST (no id) and PATCH (id); Owner; transaction |
| `createOrUpdateMerchant` | `recordOrCorrectAMerchant` | leftover POST/PATCH; no username |
| `setAgentActivation` / `setMerchantActivation` | `archiveOrRestoreAnAgent` / `archiveOrRestoreAMerchant` | Wave B `/activation`; never delete |
| `previewRegistryDependency` | `countWhoStillDependsOnThisCard` | Wave B `/dependencies`; read actor; no write |
| `RegistryCatalogItem` | `OwnerCatalogCard` | full card with aliases + nested identity |

Keep the old names as one-line aliases until leftover catalog, Wave B `/activation`, Form/Call Lead receiver stamp, and leftover username remember migrate. Do not make callers learn `createOrUpdate` / `setCatalogActivation` / `toCatalogItem` as the domain language.

**Principle: old exports stay as aliases.** `createOrUpdateAgent` remains the imported name until leftover POST/PATCH migrates. `setAgentActivation` remains the imported name until Wave B `/activation` migrates. Persisted Registry Change `action` values (`create` / `update` / `rename` / `activate` / `deactivate`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The type that *does* earn a name is the Owner card leftover catalog already receives and this file already returns:

```ts
type OwnerCatalogCard = {
  id: string
  name: string
  normalized_name: string
  name_aliases: string[]
  active: boolean
  role?: string
  granot_identity?: {
    username: string
    verified: boolean
    verified_at?: Date
    last_observed_at?: Date
  }
  granot_crm_username?: string
  archived_at?: Date
  deactivation_reason?: string
  created_from: string
  createdAt?: Date
  updatedAt?: Date
}
```

That is the handoff from “the Owner catalog wrote a card” to “leftover catalog may flatten it, Binder may remember the full Agent card, Booking writes may take the Merchant display name.” Do **not** add `_id` so “leftover pages can skip flatten,” do **not** add `booking_ids` so “dependents live on the card,” and do **not** drop `name_aliases` so “the leftover DTO wins.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add `toLegacyCatalogItem` as a public **seam** — leftover `catalog.service.ts` already owns that. Do not add `normalizeAgentName` as a public **seam** — leftover `agents/agentName.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// catalogRegistry.ts
// Agents and Merchants are deactivated, never deleted.
// The Owner records a card, renames it and keeps the old folded name
// as an alias so old Bookings still resolve,
// sets or corrects an Agent Granot username (verification starts over),
// or archives it.
// Before archive, the Owner can count how many Bookings and Leads
// still point at this card.
// The write and one Registry Change share a transaction.
// Caches forget only after commit.
// Existing Booking allocations and Lead receiver snapshots are not rewritten.
// Do not invent an Agent on a Booking path.
// Do not flatten the card here.

// ── 1. Show the Owner catalog cards ───────────────────────

export async function showTheOwnerAgentCards(options)
export async function showTheOwnerMerchantCards(options)
export async function showOneOwnerAgentCard(id)     // no active filter
export async function showOneOwnerMerchantCard(id)

// ── 2. Find a card ────────────────────────────────────────

export async function findTheAgentByNameOrAlias(name, options)
export async function findTheMerchantByNameOrAlias(name, options)
export async function findTheAgentByNestedGranotUsername(value, options)

// ── 3. Record or correct an Agent ─────────────────────────

export async function recordOrCorrectAnAgent(command, actor)

async function refuseIfAnotherAgentAlreadyUsesThisFoldedName(name, excludeId, session)
async function refuseIfAnotherAgentAlreadyHasThisGranotUsername(username, excludeId, session)
function keepTheOldFoldedNameAsAnAlias(aliases, oldFolded, newFolded)
function resetVerificationWhenTheGranotUsernameChanges(next, previous)

// ── 4. Record or correct a Merchant ───────────────────────

export async function recordOrCorrectAMerchant(command, actor)

async function refuseIfAnotherMerchantAlreadyUsesThisFoldedName(name, excludeId, session)

// ── 5. Archive or restore — never delete ──────────────────

export async function archiveOrRestoreAnAgent(command, actor)
export async function archiveOrRestoreAMerchant(command, actor)

async function archiveOrRestoreTheCatalogCard(kind, command, actor)
function stampArchiveFieldsOrClearThem(active, reason)

// ── 6. Count who still depends on this card ───────────────

export async function countWhoStillDependsOnThisCard(input)
async function countBookingsAndLeadsThatStillPointAtThisAgent(id)
async function countBookingsThatStillStoreThisMerchantName(card)
```

Read the primary path out loud: *The Owner presents a name. Canonicalize the display name and fold it for uniqueness. If this is a rename, refuse when another card already uses that folded name or alias, then keep the old folded name as an alias. If the Agent Granot username is changing, refuse when another Agent already has it, then write nested identity unverified. Optional archive on the same command stamps `archived_at`; restore clears it. Persist the card and one Registry Change in the same transaction. After commit, forget the agent, catalog, and facet caches. Do not rewrite Booking allocations. Do not invent an Agent. Do not flatten the card.*

That is the operation. `createOrUpdateAgent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Agent and Merchant record-or-correct are copies.** Name canonicalize, uniqueness, alias merge, optional archive, audit action, and `withRegistryMutation` repeat. Shared beats: refuse-name, keep-alias, stamp-or-clear-archive, write-change. Only username + invalidate key differ. One story, two **adapters**.

2. **Archive lives three times.** `recordOrCorrectAnAgent`, `recordOrCorrectAMerchant`, and `archiveOrRestoreTheCatalogCard` all `$set` `archived_at` / `deactivation_reason` and `$unset` on restore. Leftover PATCH `active` and Wave B `/activation` are two **adapters** for one archive story. Shared `stampArchiveFieldsOrClearThem`. Do not delete `/activation` so “PATCH is enough” in this rename — Wave B HTTP is a real caller.

3. **Empty name uses `IMMUTABLE_FIELD`.** `registryValidationError("Name is required.")` is a 400 with the immutable-field registry code. The name is not immutable. Do not silently swap the code in this rename without a paired interface test — leftover HTTP may already match it.

4. **Username find and username uniqueness disagree.** `findTheAgentByNestedGranotUsername` queries only `granot_identity.username` (test-locked). `refuseIfAnotherAgentAlreadyHasThisGranotUsername` queries nested **or** flat. CONTRADICTIONS.md already names this. Do not add the flat field to the find so “both wins,” and do not drop the flat field from uniqueness so “the find wins.”

5. **`showOneOwnerAgentCard` finds archived Agents.** Form Lead / Call Lead correction stamps `receiver_agent` from this get. Default lists hide inactive. Do not silently 404 archived ids so “show matches list” — that changes who a Lead correction may point at.

6. **Archive does not count dependents first.** `countWhoStillDependsOnThisCard` is a separate read. Do not silently refuse archive when `total > 0` so “we protect Bookings.” Knowledge says deactivate, never delete; dependents stay pointing at the archived card.

7. **Merchant dependents are strings; Agent dependents are ids.** Booking writes store Merchant display `name`. Rename keeps the old folded name as an alias so those strings still match. Do not silently rewrite `BookedLead.merchant` in this pass. Knowledge already forbids snapshot rewrite.

8. **Today’s file test only stubs list filters.** No record, rename, username, archive, or dependent-count proof. That is not enough for a story this long.

9. **Leave sibling modules alone.** Leftover `withRegistryMutation`, leftover `toLegacyCatalogItem`, leftover `normalizeAgentName`, leftover `findAgentByGranotCrmUsername`, leftover `resolveActiveMerchantName`, and leftover `sourceRegistry.ts` are already the right **depth**. This file orchestrates the Owner card.

10. **Do not silently change persisted audit `action` strings.** `create` / `update` / `rename` / `activate` / `deactivate` are `OperationsRegistryChange` history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `recordOrCorrectAnAgent`, `recordOrCorrectAMerchant`, `archiveOrRestoreAnAgent` / `archiveOrRestoreAMerchant`, `countWhoStillDependsOnThisCard`, `showTheOwner*Cards`, `findTheAgentByNameOrAlias`, `findTheAgentByNestedGranotUsername`.

Today’s `catalogRegistry.test.ts` only stubs `Agent.find` / `Merchant.find` for the default active filter and `includeInactive`. Leftover `catalog.service.test.ts` proves leftover flatten and leftover remember, not this **interface**.

Replace the stub style with tests that name the operation:

**Record or correct**
- Owner records an Agent with no id → insert, `created_from: admin`, `role: agent`, `active: true`, Registry Change `action: "create"`, caches `agents` / `catalog` / `facets` forgotten **after** commit.
- Non-owner actor → `FORBIDDEN` (`Registry mutations require an Owner actor.`).
- Duplicate folded name or alias → `DUPLICATE_IDENTIFIER`. Empty name after canonicalize → 400 `Name is required.`
- Rename keeps the old folded name in `name_aliases` and writes `action: "rename"`. Prior `findTheAgentByNameOrAlias(oldName)` still hits.
- Agent Granot username change writes nested `{ username, verified: false }` and the flat copy. Another Agent already holding that username (nested **or** flat) → `DUPLICATE_IDENTIFIER`.
- Missing id on correct → `NOT_FOUND`. Audit failure (leftover `withRegistryMutation` throw) aborts the write and does **not** invalidate caches.

**Archive**
- `archiveOrRestoreAnAgent({ active: false })` sets `archived_at` and optional reason; Change `action: "deactivate"`. Restore `$unset`s those fields; `action: "activate"`.
- Leftover PATCH `active` through `recordOrCorrectAnAgent` writes the same archive fields. Default `showTheOwnerAgentCards` then hides the row. `includeInactive` still shows it.
- There is no delete path. Bookings that already point at the card are unchanged.

**Find / show / dependents**
- Name remember matches alias after rename. Default excludes inactive. `{ includeInactive: true }` may return an archived card.
- Nested-username find does **not** match a card that only has the flat `granot_crm_username`.
- `showOneOwnerAgentCard` returns an archived Agent (Form/Call Lead stamp).
- Agent dependent total = bookings + form leads received + call leads received. Merchant total = bookings whose `merchant` is the display name or an alias. Preview does not write a Change row.

Do **not** add a test per helper (`keepTheOldFoldedNameAsAnAlias`, `stampArchiveFieldsOrClearThem`, `canonicalName`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`archiveOrRestoreAnAgent` stays exported because Wave B `/activation` is a second real **adapter**, not a test leak. Leftover `withRegistryMutation` owns the transaction-failure proof; do **not** retest leftover sanitizer here.

## What I would not do

- A `CatalogRegistryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation` or leftover `normalizeAgentName`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `agent.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a card and must not forget caches.
- Treating leftover catalog flatten, leftover Source Company writes, leftover Binder split, leftover username receiver stamp, leftover CPL schedule, or Wave B `/activation` HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not rewrite Booking / Lead snapshots; do not auto-create an Agent; do not add the flat username to the nested find; do not refuse archive when dependents exist; do not 404 archived get-by-id; do not rename persisted Change `action` strings; do not move leftover flatten or leftover `withRegistryMutation` into this file; do not swap `IMMUTABLE_FIELD` on empty name without a paired test.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
