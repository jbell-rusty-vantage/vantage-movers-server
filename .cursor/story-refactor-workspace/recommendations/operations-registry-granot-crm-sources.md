# Record Or Correct Which Granot Label This Workspace Uses And What A Matching Observation May Become — Show The Owner Every Card — Leave Unreviewed Cards Operationally On, Lifecycle Off, Deferred, And Observation-Only — Refuse A Duplicate Folded Label — Require An Active Company And Matching Feeds Before Lifecycle Effects May Turn On — Write The Registry Change In The Same Transaction — Forget Policy List And Health Caches Only After Commit — Never Resolve A Live Observation — Never Send A Text — Never Link An Automation Source — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 9 of this service — `granotCrmSources.ts`
- Remaining in this service: `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/granotCrmSources.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only create/update/enable-disable for leftover `GranotCrmSource` lifecycle semantics; mutation and one leftover `granot_crm_source` leftover `OperationsRegistryChange` share a transaction; policy/list/health cache keys invalidate only after commit; unreviewed rows stay disabled/deferred/observation-only — **code defaults leftover `enabled: true` and leftover `lifecycle_enabled: false`**, so “disabled” in that sentence is leftover lifecycle-off, not leftover operational-off; runtime resolution lives in leftover `granotLifecycle/sourcePolicy.ts`, not here). Runtime read: [`docs/knowledge/granot-lifecycle/source-policy.md`](../../../docs/knowledge/granot-lifecycle/source-policy.md) (leftover `sourcePolicy.ts` leftover-loads leftover `GranotCrmSource` itself and does **not** import this file). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (runtime Granot policy reads go through leftover `sourcePolicy.ts`; mutation + leftover Registry Change share one transaction; cache invalidation only after commit; leftover CRM Source texting is leftover `setGranotCrmSourceOutboundSms`, not this file). Already-recommended leftover Source Company / Feed cards: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (this file leftover-loads leftover `LeadSourceCompany` / leftover `LeadSourceGranularity` for leftover semantics refs — it does **not** record a company or activate a Feed). Already-recommended leftover HTTP automation catalog: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md) (**asks** leftover `listRegistryGranotCrmSources({ includeDisabled: true })` to attach leftover routes / leftover compatibility — it does **not** mutate). Leftover transaction/audit: leftover `registryAudit.ts` (`withRegistryMutation`). Leftover cache keys: leftover `granotCrmSourceCache.ts` (`GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS`). Leftover SMS attach on read: leftover `crmSourceOutboundSms.ts` (`toSmsView`) — next pass. Leftover Admin enrich: leftover `granotCrmSourceProjections.ts` (**asks** leftover list/get, then leftover-projects labels / leftover automation / leftover latest audit). Leftover semantics **adapter**: leftover `models/granotCrmSourceSemantics.ts` (`validateGranotCrmSourceSemantics`). Leftover label fold: leftover `granotLifecycle/sourceLabel.ts` (`normalizeGranotSourceLabel`). This checkout’s `CONTEXT.md` does not define Granot CRM Source — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B leftover `PATCH /api/v1/admin/granot-crm-sources/:id` (**asks** leftover `createOrUpdateGranotCrmSource` with leftover `id`, then leftover-re-reads leftover `getProjectedGranotCrmSource` — it does **not** return this file’s leftover card). Wave B leftover `PATCH .../:id/activation` (**asks** leftover `setGranotCrmSourceLifecycleEnabled`, then leftover-re-reads leftover projection). Wave B leftover `GET` list/detail leftover-ask leftover projections, **not** this file. Leftover `granotCrmSourceProjections.ts` (**asks** leftover `listRegistryGranotCrmSources({ includeDisabled: true })` / leftover `getRegistryGranotCrmSource`). Already-recommended leftover `granotHttpCollector/sourceCatalog.ts` (**asks** leftover list with leftover `includeDisabled: true`). Leftover classification apply leftover `scripts/migrations/granot-lifecycle-source-registry.ts` (**asks** leftover `createOrUpdateGranotCrmSource` with leftover `id` on leftover reviewed families). Leftover Paid Overflow leftover `scripts/migrations/paid-overflow-source-registry.ts` (**asks** leftover create with no leftover `id`, then leftover SMS on leftover sibling). Barrel: `operationsRegistry/index.ts` (leftover list / leftover get / leftover create-or-update / leftover activation; leftover `normalizeCommandLabel` is **not** barrelled). Tests: `granotCrmSources.test.ts` (leftover Owner vs leftover Admin; leftover missing reason; leftover in-transaction leftover semantics; leftover sanitized leftover `granot_crm_source` leftover audit; leftover audit-fail rollback; leftover request-id replay; leftover inactive-company fail-closed; leftover activation leftover-reuses leftover command; leftover read-after-write; leftover opt-in replica create + leftover duplicate folded label). There is **no** leftover HTTP POST create. Leftover `sourcePolicy.ts` / leftover health / leftover overview **do not import this file**.
- Seams callers need: leftover PATCH (leftover `id`, leftover Owner, leftover reason) vs leftover migration create (no leftover `id`) vs leftover `/activation` (leftover switch only, leftover-re-asks leftover record-or-correct); leftover Owner actor on every write; leftover `withRegistryMutation` (card + leftover `granot_crm_source` leftover Registry Change before commit vs leftover `granot_lifecycle_source_policy` / leftover `granot_lifecycle_source_list` / leftover `granot_lifecycle_source_health` forget after commit); leftover HTTP leftover-re-read through leftover projections (not this leftover return)
- Split later (only if the file outgrows one sitting): this ~511-line file is one sitting if you read it as record or correct which Granot label this workspace uses and what a matching observation may become — show the Owner every card — leave unreviewed cards operationally on, lifecycle off, deferred, and observation-only — refuse a duplicate folded label — require an active company and matching Feeds before lifecycle effects may turn on — write the Registry Change in the same transaction — forget policy list and health caches only after commit — never resolve a live observation — never send a text — never link an automation source. If it later splits: `showTheOwnerTheGranotCrmSourceCards.ts` / `recordOrCorrectAGranotCrmSourcePolicy.ts` / `turnLifecycleEffectsOnOrOffForThisGranotCrmSource.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `activation.ts`, and never merge leftover runtime leftover `sourcePolicy` resolve, leftover SMS command, leftover Admin projection, leftover automation-source link, leftover `withRegistryMutation`, leftover semantics **adapter**, leftover label fold, leftover cache keys, leftover Source Company / Feed write, leftover classification-apply orchestration, leftover Paid Overflow SMS, or Wave B leftover HTTP into this file

`listRegistryGranotCrmSources` / `getRegistryGranotCrmSource` / `createOrUpdateGranotCrmSource` / `setGranotCrmSourceLifecycleEnabled` are executor mechanics. The owner question is: *A Granot CRM Source is not a Source Company. It is the Owner card that says which Granot label this workspace uses, which live company and Feeds a matching observation may attach to, and whether that observation may become a Lead, only link, or only be watched. The Owner may see every card. An unreviewed card stays operationally on, lifecycle off, deferred, and observation-only. Recording or correcting the card is Owner-only and needs an explicit reason. The write leftover-asks leftover semantics inside the transaction: leftover `create_if_missing` is legal only on leftover `source_scoped_lead`; leftover `referral_booking` and leftover `deferred` leftover-require leftover `observation_only` and leftover-forbid leftover Lead routes; leftover `source_scoped_lead` leftover-requires a company and leftover routes. Turning leftover lifecycle effects on leftover-requires leftover operational `enabled`, a leftover policy version, a leftover folded label for leftover `source_scoped_lead`, and leftover-active leftover company / leftover Feeds that leftover-match leftover channel and leftover move type. Two cards may not share a leftover folded leftover `normalized_granot_label`. The write and one leftover `granot_crm_source` leftover Registry Change share a transaction. Policy, list, and health caches forget only after commit. This file does not leftover-resolve a live leftover observation. It does not leftover-send a text. It does not leftover-link a leftover Granot Automation Source. There is no leftover delete.*

Leftover runtime leftover `sourcePolicy` resolve, leftover SMS command, leftover Admin projection, leftover automation-source link, leftover `withRegistryMutation`, leftover semantics **adapter**, leftover label fold, leftover cache keys, leftover Source Company / Feed write, leftover classification-apply orchestration, leftover Paid Overflow SMS, leftover health findings, and Wave B leftover HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “record or correct which Granot label this workspace uses and what a matching observation may become — show the Owner every card — leave unreviewed cards operationally on, lifecycle off, deferred, and observation-only — refuse a duplicate folded label — require an active company and matching Feeds before lifecycle effects may turn on — write the Registry Change in the same transaction — forget policy list and health caches only after commit — never resolve a live observation — never send a text — never link an automation source” story, not “a Granot CRM source CRUD service,” and not leftover runtime leftover `sourcePolicy`:

1. **Show the Owner the Granot CRM source cards** — leftover `listRegistryGranotCrmSources` / leftover `getRegistryGranotCrmSource`. Leftover list leftover-sorts leftover `workspace_slug` and leftover-maps leftover `toRecord` (leftover `toSmsView` leftover-attaches leftover `outbound_sms` from leftover sibling). Leftover get leftover-404s leftover `NOT_FOUND` (`Granot CRM source not found.`). Both leftover-read leftover `granotCrmSourceCache` (leftover list key leftover `all` vs leftover `lifecycle_or_operational`; leftover detail by leftover id). Leftover `includeDisabled` does **not** change leftover `.find({})` — both leftover branches leftover-load every leftover row. Already-recommended leftover HTTP automation catalog and leftover Admin projection leftover-ask leftover `{ includeDisabled: true }`. Nobody leftover-asks leftover default leftover `false`. This beat does **not** leftover-open a leftover transaction. This beat does **not** leftover-resolve leftover `sourcePolicy`. This beat does **not** leftover-project leftover dependency labels.

2. **Record or correct a Granot CRM source policy** — leftover `createOrUpdateGranotCrmSource`. Leftover Owner only (`assertOwner` → leftover `FORBIDDEN`). Leftover reason leftover-required (trimmed; leftover `An explicit reason is required for Granot CRM source policy changes.`). Leftover `id` leftover-loads leftover `before` or leftover `NOT_FOUND`. Leftover intended leftover-merges leftover command onto leftover `before` (leftover defaults leftover `enabled: true`, leftover `lifecycle_enabled: false`, leftover `lifecycle_disposition: "deferred"`, leftover `lead_created_policy: "observation_only"`). Leftover `loadSemanticsRefs` leftover-loads leftover company and leftover Feeds on leftover session. Leftover **asks** leftover `validateGranotCrmSourceSemantics`. Leftover fail → leftover `DEPENDENCY_CONFLICT` 400. Leftover folded leftover `normalized_granot_label` leftover-unique except leftover self (`DUPLICATE_IDENTIFIER` / leftover `normalized_granot_label is already in use.`). Leftover `buildUpdate` leftover-requires leftover `granot_label` and leftover `workspace_slug`; leftover `crm_origin` leftover-falls to leftover `GRANOT_CRM_DEFAULT_ORIGIN`; leftover string leftover `source_company` leftover-falls to leftover `not_provided` (that leftover string is **not** leftover `lead_source_company`). Leftover no leftover `id` → leftover `Source.create`; leftover `id` → leftover `findByIdAndUpdate` `$set`. Leftover **asks** leftover `withRegistryMutation`. Leftover audit leftover `entityType: "granot_crm_source"`; leftover `action` leftover `create` | leftover `update` from leftover `id` presence — leftover `/activation` leftover-always leftover-sends leftover `id`, so leftover action stays leftover `update`. Leftover `policyProjection` leftover-keeps leftover id / leftover labels / leftover `enabled` / leftover lifecycle fields / leftover company / leftover routes / leftover version — leftover-omits leftover `workspace_slug`, leftover `crm_origin`, leftover `default_channel`, leftover `notes`, leftover `outbound_sms`, leftover secrets. Leftover invalidate leftover `GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS` **after** commit. Wave B leftover PATCH leftover-asks this then leftover-re-reads leftover projection. Leftover classification apply leftover-asks this with leftover `id`. Leftover Paid Overflow leftover-asks this with no leftover `id`. This beat does **not** leftover-write leftover `outbound_sms`. This beat does **not** leftover-write leftover `GranotAutomationSource`. This beat does **not** leftover-resolve a leftover observation. There is no leftover delete export.

3. **Turn leftover lifecycle effects on or off for this card** — leftover `setGranotCrmSourceLifecycleEnabled`. Leftover-loads leftover row **outside** leftover transaction (leftover `NOT_FOUND` if missing). Leftover-rebuilds leftover `GranotCrmSourceCommand` from leftover that leftover snapshot plus leftover `lifecycle_enabled` / leftover `reason`. Leftover-**asks** leftover operation 2. Wave B leftover `/activation` leftover-asks this then leftover-re-reads leftover projection. Leftover test leftover-names leftover “reuses the audited Owner command.” This beat does **not** leftover-stamp leftover `activate` / leftover `deactivate` leftover audit actions. This beat does **not** leftover-skip leftover semantics.

There is no fourth leftover SMS operation. There is no leftover runtime leftover resolve. There is no leftover automation-source leftover link. Leftover `withRegistryMutation` is the leftover transaction **adapter**. Leftover `validateGranotCrmSourceSemantics` is the leftover semantics **adapter**. Leftover `toSmsView` is the leftover SMS-view **adapter**. Leftover `normalizeGranotSourceLabel` is the leftover fold **adapter**. Wave B leftover PATCH / leftover `/activation` leftover HTTP are leftover second leftover write **adapters**, not leftover second leftover owner stories. Leftover HTTP leftover GET leftover-asks leftover projections — that leftover enrich is leftover next leftover module, not leftover this leftover story.

`assertOwner` / leftover `requiredReason` / leftover `intendedSemantics` / leftover `buildUpdate` / leftover `loadSemanticsRefs` / leftover `toRecord` / leftover `policyProjection` / leftover `mutableAudit` sit on leftover show and leftover write paths. They are not leftover extra leftover owner operations. Do not leftover-export leftover `normalizeCommandLabel` (leftover pass-through of leftover `normalizeGranotSourceLabel`; leftover unused outside this leftover file) as a leftover public **seam**. Do not leftover-export leftover `resetGranotCrmSourceCachesForTests` as leftover domain leftover language — leftover tests leftover-re-export leftover sibling leftover cache leftover reset.

## Organization

Keep one file as the screenplay for “record or correct which Granot label this workspace uses and what a matching observation may become, show the Owner every card, leave unreviewed cards operationally on / lifecycle off / deferred / observation-only, refuse a duplicate folded label, require an active company and matching Feeds before lifecycle effects may turn on, write the Registry Change in the same transaction, forget policy list and health caches only after commit, never resolve a live observation, never send a text, never link an automation source.” Leftover runtime leftover `sourcePolicy` resolve, leftover SMS command, leftover Admin projection, leftover automation-source link, leftover `withRegistryMutation`, leftover semantics **adapter**, leftover label fold, leftover cache keys, leftover Source Company / Feed write, leftover classification-apply orchestration, leftover Paid Overflow SMS, leftover health findings, and Wave B leftover HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmSourceService` class. Do not invent a leftover begin / leftover complete **seam** — leftover `withRegistryMutation` is already the leftover before-commit / leftover after-commit **adapter**. Do not invent a leftover second leftover semantics **adapter** beside leftover `validateGranotCrmSourceSemantics`. Do not invent a leftover second leftover fold **adapter** beside leftover `normalizeGranotSourceLabel`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `activation.ts` as a CRUD folder. Those are persistence verbs, and leftover `/activation` leftover-re-asks leftover record-or-correct. Do not move leftover `resolveSourcePolicy` into this file so “one file owns policy.” Do not move leftover `setGranotCrmSourceOutboundSms` into this file so “the card owns SMS.” Do not silently start resolving observations here so “writes stay hot.”

**External interface** stays small (this is the test surface). Show, record-or-correct, and the lifecycle switch are one story’s Owner cards, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listRegistryGranotCrmSources` | `showTheOwnerTheGranotCrmSourceCards` | leftover Admin projection list; leftover HTTP automation catalog |
| `getRegistryGranotCrmSource` | `showOneOwnerGranotCrmSourceCard` | leftover Admin projection detail; leftover read-after-write proof |
| `createOrUpdateGranotCrmSource` | `recordOrCorrectAGranotCrmSourcePolicy` | leftover PATCH; leftover classification apply; leftover Paid Overflow create |
| `setGranotCrmSourceLifecycleEnabled` | `turnLifecycleEffectsOnOrOffForThisGranotCrmSource` | Wave B leftover `/activation`; leftover-re-asks leftover record-or-correct |
| `GranotCrmSourceRecord` | `OwnerGranotCrmSourceCard` | Owner card leftover HTTP projection starts from |
| `GranotCrmSourceCommand` | `RecordOrCorrectAGranotCrmSourcePolicy` | Owner write + leftover reason |
| `GranotCrmSourceLifecycleActivationCommand` | `TurnLifecycleEffectsOnOrOff` | leftover `/activation` body + leftover reason |
| `GranotCrmSourceLifecycleRoute` | `WhichFeedThisObservationMayAttachTo` | leftover `route_key` / leftover `lead_model` / leftover `move_type` / leftover Feed leftover id |

Keep the old names as one-line aliases until leftover HTTP, leftover projections, leftover HTTP automation catalog, leftover classification apply, leftover Paid Overflow, leftover barrel, and leftover `granotCrmSources.test.ts` migrate. Do not make callers learn leftover `createOrUpdate` / leftover `setGranotCrmSourceLifecycleEnabled` / leftover `toRecord` as the domain language.

**Principle: old exports stay as aliases.** `createOrUpdateGranotCrmSource` remains the imported name until leftover PATCH / leftover classification apply / leftover Paid Overflow migrate. `setGranotCrmSourceLifecycleEnabled` remains the imported name until Wave B leftover `/activation` migrates. Persisted leftover Registry Change leftover `action` values (`create` / `update`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The type that *does* earn a name is the Owner card leftover HTTP projection already starts from and leftover SMS view already attaches onto:

```ts
type OwnerGranotCrmSourceCard = {
  id: string
  crm_origin: string
  workspace_slug: string
  granot_label: string
  normalized_granot_label?: string
  default_channel: "form" | "call" | "unknown"
  source_company: string
  enabled: boolean
  notes?: string
  lifecycle_enabled: boolean
  lifecycle_disposition: "source_scoped_lead" | "referral_booking" | "deferred"
  lead_created_policy: "link_only" | "create_if_missing" | "observation_only"
  lead_source_company?: string
  lifecycle_routes: Array<{
    route_key: string
    lead_model: "FormLead" | "CallLead"
    move_type: "local" | "long_distance" | "any"
    source_granularity_id: string
  }>
  lifecycle_policy_version: string
  outbound_sms?: OwnerOutboundSmsView
}
```

That is the handoff from “the Owner catalog wrote which Granot label this workspace uses” to “leftover `sourcePolicy` may resolve it at runtime, leftover Admin projection may enrich it, leftover HTTP automation catalog may attach leftover routes.” Do **not** add leftover `available_for_apply` so “apply lives on the card” — leftover projections already own that. Do **not** drop leftover `outbound_sms` from today’s leftover `GranotCrmSourceRecord` in this rename without a paired interface test — leftover `toSmsView` already attaches it. Do **not** add leftover `selected_lead_model` so “resolve lives here.”

Do not add leftover `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add leftover `validateGranotCrmSourceSemantics` as a public **seam** from this file — leftover `models/granotCrmSourceSemantics.ts` already owns that. Do not add leftover `resolveSourcePolicy` as a public **seam** — leftover `granotLifecycle/sourcePolicy.ts` already owns that. Do not add leftover `setGranotCrmSourceOutboundSms` as a public **seam** — leftover `crmSourceOutboundSms.ts` already owns that (next pass). Do not add leftover `getProjectedGranotCrmSource` as a public **seam** — leftover `granotCrmSourceProjections.ts` already owns that. Do not add leftover `setGranotAutomationSourceReference` as a public **seam** — leftover `granotAutomationSources.ts` already owns that. Do not add leftover `normalizeGranotSourceLabel` as a public **seam** from this file — leftover `granotLifecycle/sourceLabel.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotCrmSources.ts
// A Granot CRM Source is not a Source Company.
// It is the Owner card that says which Granot label this workspace uses,
// which live company and Feeds a matching observation may attach to,
// and whether that observation may become a Lead, only link, or only be watched.
// The Owner may see every card.
// An unreviewed card stays operationally on, lifecycle off, deferred, and observation-only.
// Recording or correcting the card is Owner-only and needs an explicit reason.
// create_if_missing is legal only on source_scoped_lead.
// referral_booking and deferred require observation_only and forbid Lead routes.
// source_scoped_lead requires a company and routes.
// Turning lifecycle effects on requires operational enabled, a policy version,
// a folded label for source_scoped_lead,
// and an active company plus Feeds that match channel and move type.
// Two cards may not share a folded normalized_granot_label.
// The write and one granot_crm_source Registry Change share a transaction.
// Policy, list, and health caches forget only after commit.
// This file does not resolve a live observation.
// This file does not send a text.
// This file does not link a Granot Automation Source.
// There is no delete.

// ── 1. Show the Owner the cards ───────────────────────────

export async function showTheOwnerTheGranotCrmSourceCards(options)
export async function showOneOwnerGranotCrmSourceCard(id)

function attachTheSmsViewTheSiblingAlreadyOwns(row)     // leftover toSmsView; do not write SMS

// ── 2. Record or correct the policy ───────────────────────

export async function recordOrCorrectAGranotCrmSourcePolicy(command, actor)

function refuseUnlessTheActorIsOwner(actor)
function requireAnExplicitReason(reason)
async function loadTheCardInsideTheTransactionOrRefuseMissing(id, session)
function mergeTheIntendedPolicyOntoTheLiveCard(command, before)
async function loadTheCompanyAndFeedsThisPolicyPointsAt(intended, session)
function refuseWhenSemanticsFail(intended, refs)        // leftover validateGranotCrmSourceSemantics
async function refuseADuplicateFoldedLabel(normalizedLabel, excludeId, session)
function rememberWorkspaceSlugAndDefaultOrigin(command, before)
async function writeTheCardAndOneGranotCrmSourceChange(command, actor, session)
function projectWhatTheAuditMayKeep(before, after)      // leftover policyProjection; no secrets

// ── 3. Turn lifecycle effects on or off ───────────────────

export async function turnLifecycleEffectsOnOrOffForThisGranotCrmSource(command, actor)

async function loadTheLiveCardThenAskRecordOrCorrectWithOnlyTheSwitchChanged(command, actor)
```

Read the primary path out loud: *The Owner presents a Granot label and says what a matching observation may become. Refuse unless they are Owner and named a reason. Merge that onto the live card — or start operationally on, lifecycle off, deferred, observation-only. Load the company and Feeds this policy points at. Ask semantics inside the transaction. create_if_missing is legal only on source_scoped_lead. referral_booking and deferred require observation_only and forbid Lead routes. source_scoped_lead requires a company and routes. Turning lifecycle effects on also requires operational enabled, a policy version, a folded label for source_scoped_lead, and an active company plus Feeds that match channel and move type. Two cards may not share a folded normalized_granot_label. Write the card and one granot_crm_source Registry Change in the same transaction. Forget policy, list, and health caches only after commit. Do not resolve a live observation. Do not send a text. Do not link a Granot Automation Source. There is no delete.*

That is the operation. `createOrUpdateGranotCrmSource` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`includeDisabled` is a lying option.** List keys cache `all` vs `lifecycle_or_operational`, then `.find(options.includeDisabled ? {} : {})`. Both branches load every row. Callers always pass `true`. Do not silently filter `enabled` / `lifecycle_enabled` so "the key wins" without a paired projection + HTTP automation catalog test. Do not drop `includeDisabled` from the interface so "one list is enough" without checking `sourceCatalog.ts`.

2. **Knowledge says unreviewed rows stay disabled.** Code defaults `enabled: true` and `lifecycle_enabled: false`. "Disabled" in operations-registry.md is lifecycle-off, not operational-off. Do not silently default `enabled: false` so "knowledge wins" without a paired Paid Overflow + classification apply test.

3. **`source_company` is not `lead_source_company`.** `buildUpdate` falls the string `source_company` to `not_provided`. `lead_source_company` is the ObjectId semantics require for `source_scoped_lead`. Do not silently write `lead_source_company` into `source_company` so "one field owns the company."

4. **`/activation` re-asks record-or-correct with a snapshot loaded outside the transaction.** A concurrent PATCH can be overwritten by stale fields from that first load. Audit `action` stays `update`, never `activate` / `deactivate`. Do not silently add `activate` so "activation looks like Source Feed archive." Do not silently reload only `lifecycle_enabled` inside `withRegistryMutation` without a paired `/activation` race test.

5. **HTTP PATCH re-reads projection, not this return.** GET asks projections, not list/get. There is no HTTP POST create. Paid Overflow creates with no `id`. Do not silently add POST so "create has a route" in this rename. Do not silently return `GranotCrmSourceRecord` from PATCH so "the mutation is enough" without checking HTTP.

6. **Knowledge says clients cannot submit `create_if_missing`.** `granotCrmSourceRegistryUpdateSchema` accepts it, and `granot-crm-sources.routes.test.ts` names "accepts `create_if_missing` and rejects client normalized labels." Do not silently reject `create_if_missing` on PATCH so "knowledge wins."

7. **`normalizeCommandLabel` is an unused pass-through.** It re-exports `normalizeGranotSourceLabel` and is not barrelled. Do not export it as domain language. Do not move fold into this file so "the card owns NFKC."

8. **Missing `workspace_slug` / `granot_label` uses `DEPENDENCY_CONFLICT`.** `invalid()` is a 400 with the dependency-conflict registry code. A missing slug is not a dependency. Do not silently swap the code in this rename without a paired interface test.

9. **Leave sibling modules alone.** `withRegistryMutation`, `validateGranotCrmSourceSemantics`, `normalizeGranotSourceLabel`, `toSmsView`, `resolveSourcePolicy`, `listProjectedGranotCrmSources`, and `setGranotAutomationSourceReference` are already the right depth. This file orchestrates the Owner Granot CRM source cards.

10. **Do not silently change persisted audit `action` strings.** `create` / `update` are `OperationsRegistryChange` history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `recordOrCorrectAGranotCrmSourcePolicy`, `turnLifecycleEffectsOnOrOffForThisGranotCrmSource`, `showTheOwnerTheGranotCrmSourceCards`, `showOneOwnerGranotCrmSourceCard`.

Today `granotCrmSources.test.ts` already proves Owner vs Admin, missing reason, in-transaction semantics, sanitized `granot_crm_source` audit, audit-fail rollback, request-id replay, inactive-company fail-closed, activation reuses the command, read-after-write, and opt-in replica create + duplicate folded label. Keep those. Add tests that name the operation:

**Show**
- `showTheOwnerTheGranotCrmSourceCards()` and `{ includeDisabled: true }` return the same rows today. Keep that proof until a paired projection + catalog change actually filters.
- `showOneOwnerGranotCrmSourceCard` 404s missing ids (`NOT_FOUND`). After a committed write, a follow-up get is not a cached precommit policy projection (already on disk — keep it).
- List attaches `outbound_sms` via `toSmsView`. Do not retest SMS enable rules here.

**Record or correct**
- Owner records with no id -> insert, Registry Change `action: "create"`, `entityType: "granot_crm_source"`, caches `granot_lifecycle_source_policy` / `granot_lifecycle_source_list` / `granot_lifecycle_source_health` forgotten **after** commit. Defaults: `enabled: true`, `lifecycle_enabled: false`, `lifecycle_disposition: "deferred"`, `lead_created_policy: "observation_only"` when those fields are omitted.
- Non-owner actor -> `FORBIDDEN`. Missing / blank reason -> 400 with the explicit-reason message (already on disk — keep it).
- Duplicate folded `normalized_granot_label` -> `DUPLICATE_IDENTIFIER` (already on replica — keep it).
- Inactive Source Company while `lifecycle_enabled` and `source_scoped_lead` -> fail closed, no write, no audit (already on disk — keep it).
- `create_if_missing` with `deferred` or `referral_booking` -> 400. `source_scoped_lead` without company or routes -> 400. `referral_booking` with routes -> 400.
- Audit failure aborts the write and does **not** invalidate caches (already on disk — keep it).
- Missing `workspace_slug` / `granot_label` on create -> 400 `DEPENDENCY_CONFLICT` today. Keep that code until a paired change.

**Turn lifecycle effects on or off**
- `/activation` rebuilds the full command from the pre-transaction snapshot and asks record-or-correct. Audit `action` is `update`, not `activate`.
- Turning lifecycle on without `lifecycle_policy_version`, without operational `enabled`, or without a folded label on `source_scoped_lead` -> 400, no write.

Do **not** add a test per helper (`refuseUnlessTheActorIsOwner`, `refuseADuplicateFoldedLabel`, `projectWhatTheAuditMayKeep`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`setGranotCrmSourceLifecycleEnabled` stays exported because Wave B `/activation` is a second real **adapter**, not a test leak. Do **not** retest leftover `validateGranotCrmSourceSemantics` route-structure tables or leftover `toSmsView` consent rules here.

## What I would not do

- A `GranotCrmSourceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation` or leftover `validateGranotCrmSourceSemantics`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `activation.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a card and must not forget caches.
- Treating leftover runtime `sourcePolicy` resolve, leftover SMS command, leftover Admin projection, leftover automation-source link, leftover Source Company / Feed write, leftover classification-apply orchestration, leftover Paid Overflow SMS, leftover label fold, leftover health findings, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not filter `includeDisabled` without a paired projection + catalog test; do not default `enabled: false` so knowledge wins; do not write `lead_source_company` into `source_company`; do not stamp audit `activate` / `deactivate` on `/activation`; do not add HTTP POST create; do not reject `create_if_missing` on PATCH so knowledge wins; do not export `normalizeCommandLabel` as domain language; do not move `resolveSourcePolicy` or `setGranotCrmSourceOutboundSms` into this file; do not swap `DEPENDENCY_CONFLICT` on missing slug without a paired test; do not rename persisted Change `action` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
