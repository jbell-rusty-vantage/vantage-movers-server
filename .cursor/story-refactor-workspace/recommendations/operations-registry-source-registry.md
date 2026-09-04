# Record Or Correct A Source Company And Its Feed — Create Them Inactive — Keep Slug And Key Immutable — Activate A Feed Only When The Company Is Live, The CPL Schedule Holds, Exact Identifiers Are Unique, And It Becomes Or Stays The Channel Default — Deactivate A Default Only With A Replacement Or By Removing Automatic Use — Attribute A Lead Fail-Closed — Count Who Still Depends — Write The Registry Change In The Same Transaction — Forget Source Caches Only After Commit — Never Rewrite Lead Snapshots — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 2 of this service — `sourceRegistry.ts`
- Remaining in this service: `sourceResolution.ts`, `cplSchedule.ts`, `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/sourceRegistry.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Source Company / Source Granularity are deactivated, never deleted; `company_slug` and `granularity_key` are immutable; exact key / CRM label / source-site must resolve uniquely among active same-channel records; a current default cannot be deactivated without a same-command replacement or explicit removal of automatic channel use; `direct_write` requires a complete spreadsheet mapping and does not itself enable Sheet Sync; first-class granularities are the live book; embedded `granularities[]` is migration/rollback evidence only). Leftover nested book: already-recommended [recommendations/lead-source-companies-lead-source-company.md](lead-source-companies-lead-source-company.md). Lead assignment **asks** this file’s fail-closed resolve: leftover `leads/leadSourceCompany.ts` (`resolveLeadSourceAssignment` → `resolveSourceAttribution`). Matching rules live in leftover sibling `sourceResolution.ts` (next pass) — this file loads active cards and **asks** `previewSourceAttribution`. CPL coverage on activate **asks** leftover `validateCplSchedule` — leftover `cplSchedule.ts` owns the periods. Leftover transaction/audit: `registryAudit.ts` (`withRegistryMutation`). Distinct from leftover Agent/Merchant cards: already-recommended [recommendations/operations-registry-catalog-registry.md](operations-registry-catalog-registry.md). Distinct from leftover Granot CRM source policy: leftover `granotCrmSources.ts`. This checkout’s `CONTEXT.md` does not define Source Company / Source Granularity — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `v1.routes.ts` leftover POST/PATCH `/source-companies` and `/source-granularities` (**asks** `createOrUpdate*`; company create then re-reads by slug, company update/activate then re-reads by id, granularity returns the mutation), `/activation` (**asks** `setSource*Activation`), `/dependencies` (**asks** `previewSourceDependency`), `POST /admin/source-resolution/preview` (**asks** `previewSourceResolution`), leftover CPL snapshot (**asks** `listSourceGranularities`). Leftover `leads/leadSourceCompany.ts` (**asks** `resolveSourceAttribution`). Leftover Employee Booking options + submit prep (**asks** `listSourceCompanies` / `listSourceGranularities` / `getSourceCompany` and then checks `active === true`). Leftover `admin/filterCatalog.ts` (**asks** both lists with `includeInactive: true`). Types only: leftover `analytics/sourceHierarchy.ts`. Paid Overflow migration **asks** create then activate in order. Barrel: `operationsRegistry/index.ts`. Tests: **none** on this **interface** — leftover `sourceModels.test.ts` is model/Zod defaults; leftover `sourceResolution.test.ts` proves leftover matching, not this file.
- Seams callers need: leftover POST (no id, always inactive) vs leftover PATCH (id, never `active`) vs `/activation` (archive/restore only); Owner preview (status stays on the preview) vs fail-closed Lead attribution (ambiguous / not-found throw + Operational Event); Owner actor on every write; mutation + Registry Change before commit vs cache invalidate after commit (`withRegistryMutation`); company deactivate only after every feed is off vs feed activate only when the company is live
- Split later (only if the file outgrows one sitting): this ~995-line file is one sitting if you read it as record or correct a Source Company and its Feed, create them inactive, keep slug and key immutable, activate a Feed only when the company is live / the CPL schedule holds / exact identifiers are unique / it becomes or stays the channel default, deactivate a default only with a replacement or by removing automatic use, attribute a Lead fail-closed, count who still depends, write the Registry Change in the same transaction, forget source caches only after commit, never rewrite Lead snapshots. If it later splits: `recordOrCorrectASourceCompany.ts` / `recordOrCorrectASourceFeed.ts` / `archiveOrRestoreASourceCompany.ts` / `archiveOrRestoreASourceFeed.ts` / `attributeALeadToASource.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover matching, leftover CPL periods, leftover nested book, leftover Lead assignment, leftover Agent/Merchant cards, or leftover Granot CRM source policy into this file

`createOrUpdateSourceCompany` / `createOrUpdateSourceGranularity` / `setSourceCompanyActivation` / `setSourceGranularityActivation` / `previewSourceResolution` / `resolveSourceAttribution` are executor mechanics. The owner question is: *Source Companies and Feeds are deactivated, never deleted. The Owner records a company and a Feed. Both start inactive. Slug and key never change. A Feed goes live only when its company is already live, its CPL schedule holds, no other active same-channel Feed already uses its CRM label or source site, and this command makes it the company’s channel default (or it already is). Turning off a default needs a replacement Feed or an explicit “stop using a default for this channel.” Incoming Leads are attributed fail-closed: one match, or an Operational Event. Before archive, the Owner can count how many Form Leads and Call Leads still point here. The write and one Registry Change share a transaction. Caches forget only after commit. Existing Lead source snapshots are not rewritten. Do not invent a company on a Lead path. Do not write the leftover nested `granularities[]` book.*

Leftover matching, leftover CPL periods, leftover nested book, leftover Lead assignment, leftover Agent/Merchant cards, leftover Granot CRM source policy, leftover transaction/audit, leftover telemetry, and Wave B `/activation` HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Seven operations of one “record or correct a Source Company and its Feed — create them inactive — keep slug and key immutable — activate a Feed only when the company is live, the CPL schedule holds, exact identifiers are unique, and it becomes or stays the channel default — deactivate a default only with a replacement or by removing automatic use — attribute a Lead fail-closed — count who still depends — write the Registry Change in the same transaction — forget source caches only after commit — never rewrite Lead snapshots” story, not “a Source Company CRUD service,” and not leftover nested-book matching:

1. **Show the Owner source companies and Feeds** — `listSourceCompanies` / `getSourceCompany` / `getSourceCompanyBySlug` / `listSourceGranularities` / `getSourceGranularity`. Default list is `{ active: true }`. `includeInactive` is leftover admin, registry facets, and leftover filter catalog. List of Feeds may also filter by company id and channel. Get-by-id and get-by-slug have **no** active filter — leftover Employee Booking submit then refuses `active !== true`. Returns the full Owner card (`SourceCompanyItem` / `SourceGranularityItem`: aliases, sheet config, defaults, `archived_at`, `deactivation_reason`, embedded `granularities[]` as leftover evidence). This beat does **not** flatten. This beat does **not** open a transaction. This beat does **not** attribute a Lead.

2. **Record or correct a Source Company** — `createOrUpdateSourceCompany`. Owner only. No id → insert (`created_from` default `admin`, **`active: false`**, `granularities: []`). Id → load or `NOT_FOUND`. `company_slug` is folded (`normalizeKey`) and **immutable** after create. Duplicate slug → `DUPLICATE_IDENTIFIER`. Name required. `direct_write` refuses without a spreadsheet id. Defaults cannot be set on create (no Feeds exist yet). On correct, a default must belong to the same company and channel, and must already be active when the company itself is active. **Ask** leftover `withRegistryMutation`. Audit `action` is persisted `create` | `update` — do not rename those strings. Invalidate `source_companies`, `source_attribution`, `facets` **after** commit. This beat does **not** activate. This beat does **not** rewrite Form Lead / Call Lead source snapshots.

3. **Record or correct a Source Feed** — `createOrUpdateSourceGranularity`. Owner only. No id → insert (`active: false`, `schedule_revision: 0`). Company must exist. `source_company` and `granularity_key` are **immutable**. `channel` is immutable once the Feed is active **or** has `activated_at` (a never-activated draft may still change channel). `granularity_key` is unique across every Feed, not per company. `owner_label` and `crm_label` are required. **Ask** leftover `withRegistryMutation`. Invalidate `source_granularities`, `source_attribution`, `facets`. This beat does **not** write CPL periods. This beat does **not** append the leftover nested `granularities[]` on the company.

4. **Archive or restore a Source Company — never delete** — `setSourceCompanyActivation`. Owner only. Activate: leftover `assertActiveDefaultsValid` — if any Feed of a channel is already live, that channel’s default must be an active same-company Feed. Deactivate: every Feed of this company must already be archived (`dependencyConflict` otherwise). `active: false` sets `archived_at` + optional reason. `active: true` `$unset`s those two fields. Shared `SourceActivationCommand` also carries `replacement_default_id` / `remove_automatic_use_for_channel`; **this beat ignores them**. Wave B `/activation` **asks** this then re-reads the company. There is no delete export. This beat does **not** count Lead dependents first.

5. **Archive or restore a Source Feed — never delete** — `setSourceGranularityActivation`. Owner only. Activate: the company must already be live; leftover `validateCplSchedule` must accept the unarchived periods (`active: true` — empty schedule fails); leftover `assertExactIdentifiersAvailable` refuses when another **active same-channel** Feed already uses this `crm_label` or a `source_site` (case-insensitive); if this Feed is not already the company’s channel default, `replacement_default_id` must be **this** Feed’s id so the same command writes the default. First activate stamps `activated_at` once. Deactivate when this Feed is the current default: same-command `replacement_default_id` (active, same company, same channel) **or** `remove_automatic_use_for_channel`; otherwise `dependencyConflict`. Wave B `/activation` **asks** this and returns the mutation. Paid Overflow migration **asks** this after it has written a schedule. This beat does **not** count Lead dependents first.

6. **Attribute a hint to a company and Feed** — `previewSourceResolution` / `resolveSourceAttribution`. Both load **active** lists (operation 1 defaults) and **ask** leftover `previewSourceAttribution`. Owner preview (`POST /admin/source-resolution/preview`) returns `resolved` | `ambiguous` | `not_found`. Fail-closed Lead path records leftover telemetry; `resolved` returns the attribution; `ambiguous` writes Operational Event `operations_registry.source_resolution_ambiguous` and throws `AMBIGUOUS_RESOLUTION`; `not_found` writes `operations_registry.source_resolution_not_found` and throws `NOT_FOUND`. Leftover `resolveLeadSourceAssignment` **asks** the fail-closed export and turns a Registry error into a `source_company` ValidationError. This beat does **not** invent a company. This beat does **not** include inactive cards.

7. **Count who still depends on this company or Feed** — `previewSourceDependency`. Read, no mutate. Company: Form Lead + Call Lead `lead_source_company`. Feed: Form Lead + Call Lead `source_granularity_id`. `total` is the sum. Wave B `/dependencies` **asks** this with a read actor. Missing card is **not** `NOT_FOUND` — the counts are just zero.

There is no eighth Lead-create operation. There is no Sheet Sync operation. There is no leftover nested-book write. There is no CPL-period write. Leftover `withRegistryMutation` is the transaction **adapter**. Leftover `previewSourceAttribution` is the matching **adapter**. Leftover `validateCplSchedule` is the coverage **adapter**. Wave B `/activation` is a second archive **adapter**, not a second owner story.

`assertOwner` / `mutableAudit` / `toCompanyItem` / `toGranularityItem` sit on the write and show paths. They are not extra owner operations. Do not invent a dashboard for `RegistrySourceChannel` in this rename. Do not export `validateCompanyDefaults` / `assertActiveDefaultsValid` / `assertExactIdentifiersAvailable` / `normalizeKey` as a public **seam**.

## Organization

Keep one file as the screenplay for “record or correct a Source Company and its Feed, create them inactive, keep slug and key immutable, activate a Feed only when the company is live / the CPL schedule holds / exact identifiers are unique / it becomes or stays the channel default, deactivate a default only with a replacement or by removing automatic use, attribute a Lead fail-closed, count who still depends, write the Registry Change in the same transaction, forget source caches only after commit, never rewrite Lead snapshots.” Leftover matching, leftover CPL periods, leftover nested book, leftover Lead assignment, leftover Agent/Merchant cards, leftover Granot CRM source policy, leftover `withRegistryMutation`, leftover telemetry, and Wave B `/activation` HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `SourceRegistryService` class. Do not invent a begin / complete **seam** — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second matching **adapter** beside leftover `previewSourceAttribution`. Do not invent a second coverage **adapter** beside leftover `validateCplSchedule`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `company.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move leftover matching into this file so “one file owns attribution.” Do not move leftover CPL periods into this file so “activate owns the schedule.” Do not silently start writing `LeadSourceCompany.granularities[]` so “the nested book stays in sync.” Do not silently rewrite Lead source snapshots so “rename stays consistent.”

**External interface** stays small (this is the test surface). Show, record-or-correct, archive, attribute, and count-dependents are one story’s source cards, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listSourceCompanies` / `listSourceGranularities` | `showTheOwnerSourceCompanies` / `showTheOwnerSourceFeeds` | leftover list, Employee Booking options (active), leftover filter catalog (`includeInactive`) |
| `getSourceCompany` / `getSourceGranularity` | `showOneOwnerSourceCompany` / `showOneOwnerSourceFeed` | leftover detail; Employee Booking submit then checks active |
| `getSourceCompanyBySlug` | `showOneOwnerSourceCompanyBySlug` | leftover POST create re-read |
| `createOrUpdateSourceCompany` | `recordOrCorrectASourceCompany` | leftover POST (no id, inactive) and PATCH (id); Owner; transaction |
| `createOrUpdateSourceGranularity` | `recordOrCorrectASourceFeed` | leftover POST/PATCH; never writes nested `granularities[]` |
| `setSourceCompanyActivation` | `archiveOrRestoreASourceCompany` | Wave B `/activation`; all Feeds off first; never delete |
| `setSourceGranularityActivation` | `archiveOrRestoreASourceFeed` | Wave B `/activation`; company live + CPL + unique identifiers + default; never delete |
| `previewSourceResolution` | `previewHowThisHintWouldAttribute` | Owner preview; status stays on the preview |
| `resolveSourceAttribution` | `attributeALeadFailClosed` | leftover Lead assignment; throw + Operational Event |
| `previewSourceDependency` | `countWhoStillDependsOnThisSource` | Wave B `/dependencies`; read actor; no write |
| `SourceCompanyItem` / `SourceGranularityItem` | `OwnerSourceCompanyCard` / `OwnerSourceFeedCard` | full card with aliases, sheet config, defaults, archive fields |

Keep the old names as one-line aliases until leftover HTTP, leftover Lead assignment, leftover Employee Booking, leftover filter catalog, and the Paid Overflow migration migrate. Do not make callers learn `createOrUpdate` / `setSource*Activation` / `toCompanyItem` as the domain language.

**Principle: old exports stay as aliases.** `createOrUpdateSourceCompany` remains the imported name until leftover POST/PATCH migrates. `setSourceGranularityActivation` remains the imported name until Wave B `/activation` and the Paid Overflow migration migrate. Persisted Registry Change `action` values (`create` / `update` / `activate` / `deactivate`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The types that *do* earn names are the Owner cards leftover HTTP already returns and leftover Employee Booking already filters:

```ts
type OwnerSourceCompanyCard = {
  id: string
  company_slug: string
  name: string
  owner_label: string
  aliases: string[]
  active: boolean
  default_form_granularity?: string
  default_call_granularity?: string
  sheet_config: {
    spreadsheet_id?: string
    has_bad_tabs: boolean
    projection_mode: "derived_import" | "direct_write"
  }
  archived_at?: Date
  deactivation_reason?: string
  created_from: string
}

type OwnerSourceFeedCard = {
  id: string
  source_company: string
  granularity_key: string
  channel: "form" | "call"
  owner_label: string
  crm_label: string
  aliases: string[]
  source_sites: string[]
  priority: number
  active: boolean
  schedule_revision: number
  activated_at?: Date
  archived_at?: Date
  deactivation_reason?: string
}
```

That is the handoff from “the Owner catalog wrote a company and a Feed” to “leftover Lead assignment may attribute, leftover Employee Booking may offer the live pair, leftover filter catalog may include the archived row.” Do **not** add `booking_ids` so “dependents live on the card,” do **not** drop `granularities[]` from today’s `SourceCompanyItem` in this rename so “the dead nested book disappears from the HTTP page” without a paired interface test, and do **not** add `cpl_periods` so “activate owns the schedule.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add `previewSourceAttribution` as a public **seam** from this file — leftover `sourceResolution.ts` already owns that (and the barrel already re-exports it). Do not add `validateCplSchedule` as a public **seam** — leftover `cplSchedule.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceRegistry.ts
// Source Companies and Feeds are deactivated, never deleted.
// The Owner records a company and a Feed. Both start inactive.
// Slug and key never change.
// A Feed goes live only when its company is already live,
// its CPL schedule holds,
// no other active same-channel Feed already uses its CRM label or source site,
// and this command makes it the company’s channel default (or it already is).
// Turning off a default needs a replacement Feed
// or an explicit “stop using a default for this channel.”
// Incoming Leads are attributed fail-closed: one match, or an Operational Event.
// Before archive, the Owner can count how many Form Leads and Call Leads still point here.
// The write and one Registry Change share a transaction.
// Caches forget only after commit.
// Existing Lead source snapshots are not rewritten.
// Do not invent a company on a Lead path.
// Do not write the leftover nested granularities[] book.

// ── 1. Show the Owner source cards ────────────────────────

export async function showTheOwnerSourceCompanies(options)
export async function showTheOwnerSourceFeeds(options)
export async function showOneOwnerSourceCompany(id)          // no active filter
export async function showOneOwnerSourceCompanyBySlug(slug)  // no active filter
export async function showOneOwnerSourceFeed(id)

// ── 2. Record or correct a Source Company ─────────────────

export async function recordOrCorrectASourceCompany(command, actor)

async function refuseIfAnotherCompanyAlreadyUsesThisSlug(slug, excludeId, session)
async function refuseDefaultsOnCreate(command)
async function refuseDirectWriteWithoutASpreadsheet(command, before)
async function refuseADefaultThatIsNotTheSameCompanyAndChannel(companyId, formId, callId, requireActive, session)

// ── 3. Record or correct a Source Feed ────────────────────

export async function recordOrCorrectASourceFeed(command, actor)

async function refuseIfTheCompanyIsMissing(companyId, session)
function refuseIfSlugOrKeyOrCompanyWouldChange(before, command)
function refuseIfChannelWouldChangeAfterFirstActivate(before, command)
async function refuseIfAnotherFeedAlreadyUsesThisKey(key, excludeId, session)

// ── 4. Archive or restore a Source Company — never delete ─

export async function archiveOrRestoreASourceCompany(command, actor)

async function refuseCompanyActivateWhenALiveFeedHasNoLiveDefault(company, session)
async function refuseCompanyArchiveWhileAnyFeedIsStillLive(companyId, session)

// ── 5. Archive or restore a Source Feed — never delete ────

export async function archiveOrRestoreASourceFeed(command, actor)

async function refuseFeedActivateWhenTheCompanyIsArchived(company)
async function refuseFeedActivateWhenTheCplScheduleDoesNotHold(feed, session)
async function refuseFeedActivateWhenAnotherLiveFeedAlreadyUsesThisExactIdentifier(feed, session)
async function makeThisFeedTheChannelDefaultInTheSameCommand(company, feed, command, session)
async function replaceOrClearTheDefaultWhenArchivingThisFeed(company, feed, command, session)

// ── 6. Attribute a hint ───────────────────────────────────

export async function previewHowThisHintWouldAttribute(input)   // Owner preview
export async function attributeALeadFailClosed(input)           // Lead writes

async function loadTheLiveSourceCards()
function writeAnAmbiguousAttributionEvent(preview)
function writeAMissingAttributionEvent(preview)

// ── 7. Count who still depends ────────────────────────────

export async function countWhoStillDependsOnThisSource(input)
async function countFormAndCallLeadsThatStillPointAtThisCompany(id)
async function countFormAndCallLeadsThatStillPointAtThisFeed(id)
```

Read the primary path out loud: *The Owner records a company. Fold the slug. Refuse a duplicate. Insert it inactive with an empty leftover nested book. Then record a Feed on that company. Fold the key. Refuse a duplicate. Insert it inactive. Write a CPL schedule in the leftover schedule module. Activate the company only when every live channel already has a live default — or none are live yet. Activate the Feed only when the company is live, the schedule holds, no other live same-channel Feed already uses this CRM label or source site, and this command makes the Feed the channel default. Persist the card and one Registry Change in the same transaction. After commit, forget the source and facet caches. A later Lead hint loads only live cards, asks leftover matching, and either attributes or writes an Operational Event. Do not rewrite Lead snapshots. Do not invent a company. Do not write the nested book.*

That is the operation. `createOrUpdateSourceCompany` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Company and Feed record-or-correct share the Owner / transaction / audit / invalidate shell and little else.** Slug vs key, company vs channel immutability, defaults vs exact identifiers, and “created inactive” repeat as two copies of `withRegistryMutation`. Shared beats: refuse-owner, write-change, forget-caches. The cards are different stories on the same **adapter**. Do not merge them into `createOrUpdateSource` so “one upsert.”

2. **`SourceActivationCommand` lies on the company path.** `replacement_default_id` and `remove_automatic_use_for_channel` only decide Feed archive. Wave B company `/activation` still parses and forwards them. Company activate ignores them and instead **asks** leftover `assertActiveDefaultsValid`. Do not silently start honoring a replacement on company activate so “the command type wins.”

3. **Empty name / missing slug uses `DEPENDENCY_CONFLICT`.** Leftover `invalid()` is a 400 with the dependency-conflict registry code. A missing name is not a dependency. Catalog’s leftover empty-name path used `IMMUTABLE_FIELD` — also a lying code. Do not silently swap the code in this rename without a paired interface test.

4. **Leftover HTTP re-reads company writes and trusts Feed writes.** Company POST **asks** `recordOrCorrectASourceCompany` then `showOneOwnerSourceCompanyBySlug`. Company PATCH / company `/activation` re-read by id. Feed POST/PATCH/`/activation` return the mutation. Do not silently drop the re-read so “the mutation is enough” without checking leftover HTTP — the extra read is a leftover **adapter**, not this story.

5. **`showOneOwnerSourceCompany` finds archived companies.** Leftover Employee Booking submit then refuses `active !== true`. Default lists hide inactive. Leftover filter catalog **asks** `includeInactive: true`. Do not silently 404 archived ids so “show matches list” — that changes who leftover submit may load before it refuses.

6. **Archive does not count dependents first.** `countWhoStillDependsOnThisSource` is a separate read. A missing id returns zeros, not `NOT_FOUND`. Do not silently refuse archive when `total > 0` so “we protect Leads.” Knowledge says deactivate, never delete; dependents keep their history.

7. **`LeadSourceCompany.granularities[]` is written once as `[]` and never updated.** `toCompanyItem` still passes the array through. Knowledge already calls the nested book migration/rollback evidence. Do not silently `$push` the new Feed so “the nested book stays in sync.” Do not silently drop the field from the HTTP card without a paired interface test.

8. **Activate a Feed does not write CPL periods.** It **asks** leftover `validateCplSchedule`. An empty schedule fails. Paid Overflow writes the schedule in leftover `cplSchedule.ts` first. Do not silently invent an open zero period so “activate can succeed.”

9. **Preview and fail-closed resolve are two adapters of leftover matching.** Both load **active** cards only. Do not silently pass `includeInactive` so “Owner correction can preview an archived Feed.” Do not move leftover `previewSourceAttribution` into this file so “one file owns attribution.” Matching rules stay in leftover `sourceResolution.ts` (next pass).

10. **Today’s folder has no test on this interface.** Leftover `sourceModels.test.ts` proves Mongoose defaults and leftover Zod (`active` and nested `granularities` rejected on create). Leftover `sourceResolution.test.ts` proves leftover matching with in-memory cards. Activation preconditions, created-inactive, immutable slug/key, and fail-closed events are unproven here.

11. **Leave sibling modules alone.** Leftover `withRegistryMutation`, leftover `previewSourceAttribution`, leftover `validateCplSchedule`, leftover `resolveLeadSourceAssignment`, leftover `listLeadSourceCompanies`, leftover Agent/Merchant cards, and leftover `sourceResolution.ts` are already the right **depth**. This file orchestrates the Owner source cards.

12. **Do not silently change persisted audit `action` strings.** `create` / `update` / `activate` / `deactivate` are `OperationsRegistryChange` history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `recordOrCorrectASourceCompany`, `recordOrCorrectASourceFeed`, `archiveOrRestoreASourceCompany`, `archiveOrRestoreASourceFeed`, `attributeALeadFailClosed`, `previewHowThisHintWouldAttribute`, `countWhoStillDependsOnThisSource`, `showTheOwnerSourceCompanies`, `showOneOwnerSourceCompany`.

Today there is no `sourceRegistry.test.ts`. Leftover `sourceModels.test.ts` and leftover `sourceResolution.test.ts` do not prove this **interface**.

Add tests that name the operation:

**Record or correct**
- Owner records a company with no id → insert, `created_from: admin`, **`active: false`**, `granularities: []`, Registry Change `action: "create"`, caches `source_companies` / `source_attribution` / `facets` forgotten **after** commit.
- Non-owner actor → `FORBIDDEN` (`Registry mutations require an Owner actor.`).
- Duplicate slug → `DUPLICATE_IDENTIFIER`. Empty name → 400. `direct_write` without a spreadsheet id → 400.
- Defaults on create → 400 (`Set default granularities after creating the Source Company and its granularities.`).
- Slug change on correct → `IMMUTABLE_FIELD`. Missing id → `NOT_FOUND`.
- Owner records a Feed → insert `active: false`, `schedule_revision: 0`. Missing company → `NOT_FOUND`. Duplicate key → `DUPLICATE_IDENTIFIER`. Company or key change on correct → `IMMUTABLE_FIELD`. Channel change after `activated_at` → `IMMUTABLE_FIELD`. Channel change on a never-activated draft still succeeds.
- Audit failure (leftover `withRegistryMutation` throw) aborts the write and does **not** invalidate caches. Nested `granularities[]` on the company stays `[]`.

**Archive**
- `archiveOrRestoreASourceFeed({ active: true })` refuses when the company is archived, when leftover `validateCplSchedule` throws, when another live same-channel Feed already uses this CRM label or source site, or when this Feed is not the default and `replacement_default_id` is not this Feed. Success stamps `activated_at` once and may write the company default in the same transaction. Change `action: "activate"`.
- Archiving the current default without replacement or `remove_automatic_use_for_channel` → `DEPENDENCY_CONFLICT`. Replacement must be active, same company, same channel.
- `archiveOrRestoreASourceCompany({ active: false })` refuses while any Feed is still live. Restore `$unset`s archive fields. Leftover PATCH never sends `active` — Wave B `/activation` is the archive **adapter**.
- There is no delete path. Form Leads / Call Leads that already point at the card are unchanged.

**Attribute / show / dependents**
- Owner preview returns `ambiguous` / `not_found` without throwing. Fail-closed resolve throws `AMBIGUOUS_RESOLUTION` / `NOT_FOUND` and writes the matching Operational Event. Success records leftover telemetry success.
- Attribution loads **active** cards only. An archived Feed does not resolve.
- `showOneOwnerSourceCompany` returns an archived company (Employee Booking then refuses). Default `showTheOwnerSourceCompanies` hides it. `{ includeInactive: true }` still shows it.
- Company dependent total = form leads + call leads on `lead_source_company`. Feed total uses `source_granularity_id`. Missing id → zeros, not `NOT_FOUND`. Preview does not write a Change row.

Do **not** add a test per helper (`refuseDefaultsOnCreate`, `makeThisFeedTheChannelDefaultInTheSameCommand`, `normalizeKey`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`archiveOrRestoreASourceFeed` stays exported because Wave B `/activation` and the Paid Overflow migration are second real **adapters**, not a test leak. Leftover `previewSourceAttribution` owns the matching-rule proof; leftover `validateCplSchedule` owns the coverage-rule proof; do **not** retest leftover sanitizer here.

## What I would not do

- A `SourceRegistryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation`, leftover `previewSourceAttribution`, or leftover `validateCplSchedule`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `company.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a card and must not forget caches.
- Treating leftover nested-book matching, leftover Lead assignment, leftover CPL period writes, leftover Agent/Merchant cards, leftover Granot CRM source policy, leftover filter-catalog flatten, or Wave B `/activation` HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not rewrite Lead source snapshots; do not auto-create a company; do not `$push` into nested `granularities[]`; do not invent a CPL period on activate; do not refuse archive when dependents exist; do not 404 archived get-by-id; do not honor `replacement_default_id` on company activate; do not pass inactive cards into attribution; do not rename persisted Change `action` strings; do not move leftover matching or leftover `withRegistryMutation` into this file; do not swap `DEPENDENCY_CONFLICT` on empty name without a paired test; do not export `normalizeKey` just because an Owner-UI issue asked.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
