# Keep The Exact Granot Labels The Owner Uses For HTTP Automation, And Only Hand Selected IDs To A Run When The Registry Says They May Be Applied — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 3 of this service — `sourceCatalog.ts`
- Remaining in this service: `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/sourceCatalog.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — **Source catalog vs apply routing**: `supported_operations` is list/create; apply readiness is the additive `evaluateGranotAutomationCompatibility` projection; `resolveGranotAutomationSources` (the `source_ids` path, including run-groups) fails closed with `INVALID_GRANOT_SOURCES` and per-source issues; **known gap**: `createGranotRun` with `source_labels` only does **not** call resolve. Create-source limit 200; exact duplicate label → `GRANOT_SOURCE_ALREADY_EXISTS`. Reviewed Granot CRM family inventory: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`granotCrmSources.ts` owns Registry semantics; `granotAutomationSources.ts` owns the Owner `granot_crm_source` pointer). Distinct from readiness answer (no Mongo): [recommendations/granot-lifecycle-automation-compatibility.md](granot-lifecycle-automation-compatibility.md). Distinct from session collect + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from standalone collect/preview: [recommendations/granot-http-collector-automation.md](granot-http-collector-automation.md). Distinct from admin create / plan / approve / worker: later `runWorkflow.ts`. Distinct from Form planning: later `formWorkflow.ts`. Distinct from Form match: later `granotFormLeadMatcher.ts`. Distinct from plan seal: later `lifecycleStatement.ts`. Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from processor fail-closed policy: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` still says the catalog does not record which Lead workflows a source supports — the code already persists `supported_operations`; do not rewrite HANDOFF in this pass. This checkout’s `CONTEXT.md` does not define Granot Automation Source / Granot CRM Source / Granot Observation Receipt — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three runtime import sites + the seed script + two test files.** Admin list/create: `routes/granot-automation.routes.ts` `GET|POST /api/v1/admin/granot-automation/runs/sources` (`requireApiSecret` + `requireRegistryOwnerActor`; Zod owns unsafe-label / unique-operations; this file owns the 200 cap, exact-label conflict, and additive compatibility). Run create: `runWorkflow.ts` `createGranotRun` calls `resolveGranotAutomationSources` **only** when `sourceIds` is present; `createGranotRunGroup` always calls it (injectable `runtime.resolveSources`; default is this export) and refuses to insert either child until resolve returns. Seed: `scripts/granot-automation/seed-sources.ts` (`pnpm granot:seed` style) calls `seedGranotAutomationSources`. Tests: `sourceCatalog.test.ts` (canonicalize + leftover catalog partition + AC-38 envelope / authority); `granot-automation.routes.test.ts` (200 cap, nine-label partition, unique label, indexes, conflict message does **not** name a seed label); `runWorkflow.test.ts` stubs resolve and never loads Mongo. Not callers: `index.ts`, `automation.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `granotLifecycle/automationApply.ts`, `operationsRegistry/granotAutomationSources.ts` (attaches the pointer; this file only reads it), public Form/Call write, CSV sync.
- Seams callers need: list/create (`supported_operations` + additive unreadiness) vs apply resolve (Registry routes + `available_for_apply`); `source_ids` / run-group fail-closed vs label-only `createGranotRun` (known gap — leave it); leftover catalog partition vs Registry-route partition; create-without-pointer starts `missing_reference`; seed the exact nine vs never infer Forms/Inbounds from the words
- Split later (only if the file outgrows one sitting): keep one file — this ~454-line module is one screenplay for “keep the exact Granot labels the owner uses for HTTP automation, and only hand selected IDs to a run when the Registry says they may be applied.” If it later splits: `showTheOwnerTheExactGranotLabelsTheyCanPick.ts` / `addAnExactGranotLabelTheOwnerDeclared.ts` / `plantTheNineKnownGranotLabels.ts` / `failClosedUnlessTheseIdsMayBeAppliedThenSplitThemByRegistryRoute.ts` — story files, never `list.ts` / `create.ts` / `seed.ts` / `resolve.ts` / `update.ts` / `delete.ts`, and never merge readiness evaluation, Registry pointer attach, Form planning, or admin run insert into this file

`listGranotAutomationSources` / `createGranotAutomationSource` / `seedGranotAutomationSources` / `resolveGranotAutomationSources` are executor mechanics. The owner question is: *The owner keeps a catalog of exact Granot Leads & Advertising labels and says whether each one is for Form Leads, Call Leads, or both. Show the active ones, with an honest “may we apply?” card from the Registry pointer. Let them add a new exact label — it starts un-pointed, so it cannot be applied yet. Plant the nine known labels and refuse if any of those nine went missing or got the wrong workflow. When they pick IDs for a run or a run-group, refuse unless every ID is a real, active, classified, Registry-ready source whose routes permit the Form or Call work they asked for. Then split the ready sources into the Form pile and the Call pile so the run module never partitions labels itself. This file does not attach the Registry pointer. This file does not plan. This file does not write a Lead.*

Readiness evaluation, Registry pointer attach, session collect, Form planning, durable run insert, and approved apply already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “keep the exact labels, then fail closed before a run” story, not “a Granot source CRUD service,” and not the admin run:

1. **Show the owner the exact Granot labels they can pick** — active rows only, optional `form_leads` / `call_leads` filter on the catalog field, newest-label sort, hard cap 200. Project each row plus additive `compatibility` from `sayWhetherThisHttpAutomationSourceMayBeApplied` (today `evaluateGranotAutomationCompatibility`): load every Registry Granot CRM source including disabled, count how many share a `normalized_granot_label`, and attach the unreadiness even when the source is still listable. A listed source may be `missing_reference`. This function does not hide unreadiness. This function does not throw `INVALID_GRANOT_SOURCES`.

2. **Add an exact Granot label the owner declared** — trim the label, refuse when the collection already has 200 documents (active **and** inactive count), insert `created_from: "admin"` with the declared `supported_operations`. Exact duplicate label → `GRANOT_SOURCE_ALREADY_EXISTS`. Evaluate compatibility with **no** Registry pointer — a new admin label starts `missing_reference` until an Owner or reviewed migration attaches an exact Registry row (`operationsRegistry/granotAutomationSources.ts`). This function does not attach that pointer. This function does not infer Forms vs Inbounds from the words in the label.

3. **Plant the nine known Granot labels** — upsert the checked-in nine (`10best Inbounds`, `Best Relocation Forms`, `BestRelocation Inbounds`, `Main Site Forms`, `TBM Forms`, `TBM Forms Prime`, `TBM Prime Inbounds`, `Top10 Forms`, `Top10 Inbounds`) by exact label. `$set` `supported_operations` so an existing seed row is reclassified; `$setOnInsert` label / active / `created_from: "seed"`. Count inserted / updated / unchanged / missing. After the upsert, refuse if any of the nine is missing, or if any of the nine still has the wrong workflow pair. Do not classify an unknown owner-created label by name. Do not deactivate extras. This function does not attach a Registry pointer.

4. **Fail closed unless these IDs may be applied, then split them by Registry route** — canonicalize ObjectIds (malformed or case-folded duplicates → `INVALID_GRANOT_SOURCES`). Load every selected row. Missing, inactive, or unclassified (`supported_operations` not one or two unique `form_leads` / `call_leads`) fail the same code. Project compatibility for the requested operations. Any source whose `available_for_apply !== true` fails with that source’s first issue code and `source_id`. Then keep only sources whose **Registry** `lifecycle_routes` permit the requested Form or Call work (`doTheseRegistryRoutesPermitThisFormOrCallWork`). An empty pile for a requested operation fails. Hand back `Map<form_leads|call_leads, sources>`. This function does not insert a run. This function does not read raw `source_labels`.

There is no fifth mutate operation. `canonicalizeGranotSourceIds` stays exported because tests lock case-fold + duplicate-before-lookup. `partitionGranotAutomationSources` is the leftover catalog-field split — resolve does **not** call it; resolve calls private `partitionGranotAutomationSourcesByRegistry`. `toItem` / `validSupportedOperations` / `projectAutomationSources` are folds, not public stories.

## Organization

Keep one file as the screenplay for “keep the exact Granot labels the owner uses for HTTP automation, and only hand selected IDs to a run when the Registry says they may be applied.” Readiness evaluation, Registry pointer attach, session collect, Form planning, durable run insert, and approved apply already live in deeper **modules**. Do not pull those in. Do not invent a `GranotSourceCatalogService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — list / create / seed / resolve are not a Domain Command. Do not invent a second readiness **adapter** beside `evaluateGranotAutomationCompatibility`.

Do not move this into `runWorkflow.ts` so “the run owns sources.” Do not move this into `operationsRegistry/` so “catalog lives with Registry writes.” Do not move this into `automationCompatibility.ts` so “readiness and resolve are one sitting.” Do not split `list.ts` / `create.ts` / `seed.ts` / `resolve.ts`. Do not delete the leftover `partitionGranotAutomationSources` in this rename so “one partition wins” — CONTRADICTIONS already records the leftover; resolve must keep using the Registry-route split.

**External interface** stays small (this is the test surface). List, add, seed, and fail-closed resolve are one story’s keep-and-refuse, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listGranotAutomationSources` | `showTheOwnerTheExactGranotLabelsTheyCanPick` | admin `GET .../runs/sources`; optional operation filter |
| `createGranotAutomationSource` | `addAnExactGranotLabelTheOwnerDeclared` | admin `POST .../runs/sources`; 201 + `missing_reference` |
| `seedGranotAutomationSources` | `plantTheNineKnownGranotLabels` | `scripts/granot-automation/seed-sources.ts` |
| `resolveGranotAutomationSources` | `failClosedUnlessTheseIdsMayBeAppliedThenSplitThemByRegistryRoute` | `createGranotRun` (`source_ids`) + `createGranotRunGroup` |
| `canonicalizeGranotSourceIds` | `makeTheseSourceIdsCanonicalOrRefuse` | resolve uses it; tests lock case-fold + duplicate |
| `partitionGranotAutomationSources` | keep as leftover alias | tests still lock the catalog-field split; resolve must not call it |
| `GranotAutomationSourceValidationError` | `TheseGranotSourcesCannotBeUsed` | admin 400 `INVALID_GRANOT_SOURCES` + per-source issues |
| `GranotAutomationSourceConflict` | `ThatExactGranotLabelAlreadyExists` | admin 409 `GRANOT_SOURCE_ALREADY_EXISTS` |
| `GranotAutomationSourceLimitReached` | `TheGranotLabelCatalogIsFull` | admin 409 `GRANOT_SOURCE_CATALOG_FULL` (200) |
| `GranotAutomationSourceItem` | `OneExactGranotLabelTheOwnerKeeps` | list / create / resolve handoff |
| `DEFAULT_GRANOT_AUTOMATION_SOURCES` | `TheNineKnownGranotLabels` | seed + route tests lock the Form/Call partition |
| `GRANOT_AUTOMATION_SOURCE_LIMIT` | `HowManyExactGranotLabelsWeWillKeep` | 200 |

Keep the old names as one-line aliases until the admin routes, `runWorkflow.ts`, and the seed script migrate. Do not make callers learn `projectAutomationSources` / `partitionGranotAutomationSourcesByRegistry` / `toItem` as the domain language.

**Principle: old exports stay as aliases.** `listGranotAutomationSources`, `createGranotAutomationSource`, `seedGranotAutomationSources`, and `resolveGranotAutomationSources` remain the imported names until the routes and run module point at the story names.

**No class for the workflow.** The three error classes stay error classes (HTTP map), not a workflow. The type that *does* earn a name is the ready piles we hand the run:

```ts
type TheReadyGranotLabelsSplitByTheWorkTheRegistryAllows = Map<
  "form_leads" | "call_leads",
  Array<{
    id: string
    label: string
    active: true
    supported_operations: Array<"form_leads" | "call_leads">
    created_from: "seed" | "admin"
    granot_crm_source?: string
    compatibility: { available_for_apply: true; status: "ready"; issues: [] }
  }>
>
```

That is the handoff from “the owner picked IDs” to “each child run receives only the exact labels whose Registry routes permit that Form or Call work.” Do **not** add raw `source_labels` so “label-only create can skip resolve,” and do **not** add `supported_operations` as the split key so “the list field wins.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceCatalog.ts
// The owner keeps exact Granot Leads & Advertising labels
// and says whether each one is for Form Leads, Call Leads, or both.
// Show the active ones, with an honest "may we apply?" card.
// Let them add a new exact label — it starts un-pointed.
// Plant the nine known labels. Refuse if those nine went missing
// or got the wrong workflow. Never guess Forms vs Inbounds from the words.
// When they pick IDs for a run, refuse unless every ID is real, active,
// classified, and Registry-ready for the Form or Call work they asked for.
// Then split the ready sources by Registry route.
// This file does not attach the Registry pointer.
// This file does not plan. This file does not write a Lead.

// ── 1. Show the owner the exact Granot labels they can pick ──

export async function showTheOwnerTheExactGranotLabelsTheyCanPick(whichWorkflow?)

async function decorateEachLabelWithWhetherTheRegistryWouldAllowApply(
  rows,
  requestedOperations?,
)

// ── 2. Add an exact Granot label the owner declared ──

export async function addAnExactGranotLabelTheOwnerDeclared(ask)
function refuseWhenTheCatalogAlreadyHoldsTwoHundredLabels(count)

// ── 3. Plant the nine known Granot labels ──

export async function plantTheNineKnownGranotLabels()
function refuseIfARequiredSeededLabelIsMissing(missing)
function refuseIfASeededLabelHasTheWrongWorkflow(misclassified)

// ── 4. Fail closed unless these IDs may be applied, then split them ──

export async function failClosedUnlessTheseIdsMayBeAppliedThenSplitThemByRegistryRoute(
  ids,
  operations,
)
export function makeTheseSourceIdsCanonicalOrRefuse(ids)

function refuseMissingInactiveOrUnclassifiedIds(rows, askedIds)
function refuseIdsTheRegistryWouldNotApply(projected)
function splitTheReadySourcesByRegistryRoute(ready, routesBySourceId, operations)

function leftoverSplitByCatalogSupportedOperations(sources, operations)  // do not call from resolve
```

Read the resolve path out loud: *make the IDs canonical or refuse. Load every selected row. A missing, inactive, or unclassified ID is unavailable. Ask the sibling whether the attached Registry row may be applied for this Form or Call work. If any source is not ready, stop and name that source. Then keep only the sources whose Registry routes permit the requested work. An empty Form pile or an empty Call pile is still a refuse. Hand the ready piles to the run. Do not invent a label match. Do not insert a run here.*

That is the operation. `list` / `create` / `seed` / `resolve` as four CRUD verbs is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`supported_operations` is the list/create field, not apply authority.** Knowledge and `[AC-38]` already lock that. List may show a source that supports `form_leads` and is still `missing_reference`. Resolve throws. Do not start filtering the list to `available_for_apply` so “the owner only sees ready sources,” and do not let resolve split on `supported_operations` so “the leftover partition wins.”

2. **Leftover `partitionGranotAutomationSources` still filters on the catalog field.** Resolve uses `partitionGranotAutomationSourcesByRegistry` + the sibling route fold. Tests still lock the leftover. CONTRADICTIONS already records this. Do not silently merge the two splits in this rename, and do not delete the leftover so “one function is cleaner.”

3. **Label-only run create is the caller’s gap, not this file.** Knowledge already says `createGranotRun` with `source_labels` only does not call `resolveGranotAutomationSources`. Do not teach this file to accept raw labels so “the gap closes,” and do not silently close that gap in `runWorkflow.ts` from this pass.

4. **Create without a pointer is always missing.** `addAnExactGranotLabelTheOwnerDeclared` evaluates with `requested_operations` only. Attaching `granot_crm_source` stays in `operationsRegistry/granotAutomationSources.ts`. Do not label-match a Registry row from this file so “a new source can run.”

5. **Seed `$set`s the nine workflows and refuses a miss.** `$setOnInsert` must not be the only write — the nine rows already exist. An unknown owner-created label is never classified by `Forms` / `Inbounds` in the name. HANDOFF still describes the pre-`supported_operations` catalog; do not “fix” HANDOFF so the story “owns the folder note.”

6. **The 200 cap counts every document, including inactive.** List only returns active. A deactivated label still occupies a slot. Do not change the count to active-only in this rename so “we can add more,” and do not start returning inactive rows on the list so “the cap is visible.”

7. **Canonicalize before lookup, and treat case-folded hex as the same ID.** `507F1F77…` and `507f1f77…` are duplicates. Malformed IDs never reach Mongo. Do not move ObjectId validation into the readiness sibling so “canonicalize lives once” — that stay here.

8. **Compatibility issues ride the first code on resolve.** List shows the full unreadiness card. Resolve throws `INVALID_GRANOT_SOURCES` with `source_id` + the first issue. Do not throw from the readiness sibling so “fail closed lives in one place.”

9. **Do not silently merge this into `runWorkflow.ts` or `automationCompatibility.ts`.** Knowledge already splits catalog resolve vs run insert vs readiness answer. This pass does not reorder that.

10. **Leave sibling modules alone.** Readiness evaluation, Registry pointer attach, session collect, Form planning, plan seal, approved apply, and processor source policy are already the right **depth**. This file orchestrates catalog rows + fail-closed resolve only.

## Testing

The **interface** is the test surface: `showTheOwnerTheExactGranotLabelsTheyCanPick`, `addAnExactGranotLabelTheOwnerDeclared`, `plantTheNineKnownGranotLabels`, `failClosedUnlessTheseIdsMayBeAppliedThenSplitThemByRegistryRoute`, `makeTheseSourceIdsCanonicalOrRefuse`, and the three error classes.

Today’s `sourceCatalog.test.ts` locks canonicalize case-fold + duplicate + malformed, the leftover catalog-field partition, AC-38 `INVALID_GRANOT_SOURCES` envelope shape, and “readiness without a pointer is `missing_reference` even when `supported_operations` says `form_leads`.” That last case calls the **sibling** evaluator, not this file’s resolve. `granot-automation.routes.test.ts` locks the 200 cap, the nine-label Form/Call partition, unique label, and that the conflict message does not name `TBM Forms`. `runWorkflow.test.ts` stubs `resolveSources`. Keep those. Add the gaps on **this** interface:

**Show the owner the exact Granot labels they can pick**
- Active rows return label + `supported_operations` + additive `compatibility` (already the projection; add a service test).
- `operation=form_leads` does not return a call-only source (add this).
- A listed source with no Registry pointer is still returned, with `available_for_apply: false` / `missing_reference` (add this).
- Inactive rows are omitted (add this).
- Do not add a test that list throws `INVALID_GRANOT_SOURCES`.

**Add an exact Granot label the owner declared**
- A new admin label returns `created_from: "admin"` and `compatibility.status === "missing_reference"` (add this).
- Exact duplicate label is `GRANOT_SOURCE_ALREADY_EXISTS` (add this at the service, not only the 409 map).
- The 201st document (counting inactive) is `GRANOT_SOURCE_CATALOG_FULL` (add this).
- The label words `Forms` / `Inbounds` do not change `supported_operations` (the caller sent the array; add this if a later helper starts guessing).
- Do not add a test that create writes `granot_crm_source`.

**Plant the nine known Granot labels**
- First seed inserts the nine exact labels with the locked Form/Call partition (route tests already lock the arrays; add a service upsert test).
- Second seed is idempotent: inserted 0, the nine still present (add this).
- A missing required label after upsert throws `INVALID_GRANOT_SOURCES` (add this).
- A seeded label whose `supported_operations` were flipped away from the checked-in pair throws (the `$set` should have repaired it; if a later write races, the post-read refuse stays).
- An extra owner-created label is not classified and is not deleted (add this).
- Do not add a test that seed attaches a Registry pointer.

**Fail closed unless these IDs may be applied, then split them by Registry route**
- Ready Form + Call IDs return two piles; a source whose Registry routes permit both appears in both (add this; today’s leftover-partition test is **not** this).
- Malformed or case-folded duplicate IDs throw before Mongo (already locked for canonicalize; keep it).
- Missing / inactive / unclassified IDs throw `INVALID_GRANOT_SOURCES` with no `source_id` on the existence/inactive issues (add this).
- `available_for_apply !== true` throws with that source’s `source_id` and first issue code (AC-38 envelope exists; call **resolve**, not only `new` the error).
- An empty Registry-route pile for a requested operation throws even when `supported_operations` includes that operation (add this — this is the leftover vs Registry split).
- Do not add a test that resolve inserts a `GranotAutomationRun`, writes a receipt, or accepts raw `source_labels`.

Do **not** add a test per helper (`decorateEachLabelWithWhetherTheRegistryWouldAllowApply`, `refuseMissingInactiveOrUnclassifiedIds`, `leftoverSplitByCatalogSupportedOperations`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. The leftover partition tests may stay until a later pass deletes the leftover export; they are not resolve coverage.

Do **not** re-test readiness status tables, Registry pointer attach, session collect, Form planning, plan seal, approve, apply, or processor source policy here.

## What I would not do

- A `GranotSourceCatalogService` class with `list` / `create` / `seed` / `resolve` / `update` / `delete`.
- Thirty two-line functions that only wrap `GranotAutomationSource.find` or `toItem`.
- Moving this into a CRUD folder (`list.ts` / `create.ts` / `seed.ts` / `resolve.ts` / `update.ts` / `delete.ts`), or into `runWorkflow.ts` / `automationCompatibility.ts` / `operationsRegistry/` “for cleanliness.”
- Treating `supported_operations` as apply authority, or splitting resolve on that leftover field.
- Silently merging leftover `partitionGranotAutomationSources` with the Registry-route split.
- Teaching this file to accept raw `source_labels` so the known `createGranotRun` gap “closes.”
- Attaching `granot_crm_source` by label match so “a new source can run.”
- Inferring Form vs Call from the words `Forms` or `Inbounds`.
- Filtering the list to `available_for_apply` so “the owner only sees ready sources.”
- Changing the 200 cap to active-only, or listing inactive rows, so “the cap is honest.”
- Calling `updateFormLead`, `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, or `applyAutomationPlanAction` from this file.
- Inserting a `GranotAutomationRun` from resolve so “the catalog owns the group.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Granot Automation Source.
- Writing a whole-folder recommendation for `granotHttpCollector`.
