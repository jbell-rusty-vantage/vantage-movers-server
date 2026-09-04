# Point This HTTP Automation Source At This Granot Name — Refuse Unless You Are Owner And Named A Reason — If It Already Points There, Still Write The Registry Change And Still Forget Caches, But Do Not Update The Pointer — Write The Automation-Source Registry Change In The Same Transaction — Forget Policy List And Health Caches Only After Commit — Never Create The Label — Never Apply A Run — Never Ask Whether The Source May Be Applied — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 12 of this service — `granotAutomationSources.ts`
- Remaining in this service: `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/granotAutomationSources.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only exact `GranotAutomationSource.granot_crm_source` link; same transaction/audit/cache-after-commit rules; entity type `granot_automation_source`; classification apply is `scripts/migrations/granot-lifecycle-source-registry.ts`; `--scope=link_only_automation_sources` is one of two scoped apply modes; “the reviewed `link_only_automation_sources` apply already ran through this audited command”). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (runtime Granot policy reads go through `sourcePolicy.ts`, not here; mutation + Registry Change share one transaction; cache invalidation only after commit). Already-recommended Granot name cards: [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (**does not** write this pointer). Already-recommended Admin enrich: [recommendations/operations-registry-granot-crm-source-projections.md](operations-registry-granot-crm-source-projections.md) (**reads** linked automation rows; **does not** attach a pointer). Already-recommended HTTP automation catalog: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md) (list/create/seed/resolve; create-without-pointer starts `missing_reference`; **does not** import this file). Already-recommended apply readiness: [recommendations/granot-lifecycle-automation-compatibility.md](granot-lifecycle-automation-compatibility.md) (this file **does not** ask it). Transaction/audit: leftover `registryAudit.ts` (`withRegistryMutation`). Cache keys: leftover `granotCrmSourceCache.ts` (`GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS`). This checkout’s `CONTEXT.md` does not define Granot Automation Source / Granot CRM Source / HTTP automation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Classification apply `scripts/migrations/granot-lifecycle-source-registry.ts` **asks** `setGranotAutomationSourceReference` only when the planned automation mutation is `action: "link"` and `intended_reference` is set (`migrationActor` is `actorType: "system"` / `actorRole: "owner"`). Barrel: `operationsRegistry/index.ts` (the command only; the command type is **not** barrelled). Tests: `granotAutomationSources.test.ts` (`[AC-38]` write + audit-before-commit + caches after commit; replay no-op `$set`; audit failure leaves the pointer unapplied; Admin `FORBIDDEN`). There is **no** Wave B HTTP route. Already-recommended `sourceCatalog.ts` create/seed **do not** import this file. Already-recommended Admin enrich **loads** `GranotAutomationSource` rows and **does not** call this command. `sourcePolicy.ts` / HTTP apply / SMS command **do not import this file**.
- Seams callers need: Owner actor on every write (migration uses `actorRole: "owner"`); `withRegistryMutation` (pointer + one `granot_automation_source` Registry Change before commit vs `granot_lifecycle_source_policy` / `granot_lifecycle_source_list` / `granot_lifecycle_source_health` forget after commit); replay that already points there (same command, no `$set`, still a Change); first-link / repoint (`$set` the ObjectId). There is no HTTP **adapter**.
- Split later (only if the file outgrows one sitting): this ~88-line file is one sitting if you read it as point this HTTP automation source at this Granot name — refuse unless you are Owner and named a reason — if it already points there, still write the Registry Change and still forget caches, but do not update the pointer — write the automation-source Registry Change in the same transaction — forget policy list and health caches only after commit — never create the label — never apply a run — never ask whether the source may be applied. If it later splits, do not invent a second story file for “replay” vs “first link” — those are one command. Never `create.ts` / `update.ts` / `delete.ts` / `link.ts`, and never merge sibling Granot name write, HTTP automation catalog create/seed/resolve, apply-readiness, `sourcePolicy` resolve, Admin enrich, SMS command, `withRegistryMutation`, cache keys, classification-apply orchestration, or Wave B HTTP into this file

`setGranotAutomationSourceReference` is executor mechanics. The owner question is: *An HTTP automation source is a label the Owner picks for a Granot run. A Granot name is the Registry card that says what a matching observation may become. This file only points the label at that card. Refuse unless they are Owner and named a trimmed reason. Load both rows inside the transaction. A missing automation source or a missing Granot name is not found. If the pointer already is that name, still write one `granot_automation_source` Registry Change and still forget policy, list, and health caches after commit — do not `$set`. If the pointer is empty or points elsewhere, `$set` the ObjectId. The write and the Change share a transaction. This file does not create the label. This file does not turn the label on or off. This file does not ask whether the source may be applied. This file does not start a run. This file does not resolve a live observation.*

Sibling Granot name write, HTTP automation catalog, apply-readiness, `sourcePolicy` resolve, Admin enrich, SMS command, `withRegistryMutation`, cache keys, classification-apply orchestration, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “point this HTTP automation source at this Granot name — refuse unless you are Owner and named a reason — if it already points there, still write the Registry Change and still forget caches, but do not update the pointer — write the automation-source Registry Change in the same transaction — forget policy list and health caches only after commit — never create the label — never apply a run — never ask whether the source may be applied” story, not “a Granot automation source CRUD service,” and not catalog create / apply / resolve:

1. **Point this HTTP automation source at this Granot name** — `setGranotAutomationSourceReference`. Owner only (`actor.actorRole !== "owner"` → `FORBIDDEN` / `Registry mutations require an Owner actor.`). Reason trimmed; empty → `DEPENDENCY_CONFLICT` with **overridden** `statusCode: 400` (`An explicit reason is required for Granot automation source reference changes.`). There is no 10-to-1000 length. Audit is always `entityType: "granot_automation_source"`, `entityId: command.id`, `action: "update"` — first link from `null` is still `update`. Invalidate `GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS` **after** commit. Inside the transaction: load `GranotAutomationSource` by `command.id` or `NOT_FOUND` (`Granot automation source not found.`). Load `GranotCrmSource` by `command.granot_crm_source` (`select { _id: 1 }` only) or `NOT_FOUND` (`Granot CRM source not found.`). Compare string ids. Same pointer: set `audit.before` / `audit.after` to that id and return `{ id, granot_crm_source }` — **no** `$set`, **no** `audit.metadata`. Different pointer (including `null` → first name): `$set { granot_crm_source: toObjectId(nextId) }`, set `before` / `after`, set `audit.metadata = { request_id: actor.requestId, reason }`. Classification apply **asks** this for each planned `link`. This beat does **not** create a `GranotAutomationSource`. This beat does **not** write `label` / `active` / `supported_operations`. This beat does **not** ask `evaluateGranotAutomationCompatibility`. This beat does **not** check whether the Granot name is operationally on or lifecycle-enabled. This beat does **not** start a run.

There is no second list operation. There is no create. There is no apply. `withRegistryMutation` is the transaction **adapter**. Classification apply is a second write **adapter**, not a second owner story. Already-recommended catalog create/seed is how the label exists; this file only attaches the pointer. Wave B HTTP is not an **adapter** here — there is no route.

Do not export the mutate closure as a public **seam**. Do not export `GranotAutomationSourceReferenceCommand` as domain language for “create a source.”

## Organization

Keep one file as the screenplay for “point this HTTP automation source at this Granot name, refuse unless you are Owner and named a reason, if it already points there still write the Registry Change and still forget caches but do not update the pointer, write the automation-source Registry Change in the same transaction, forget policy list and health caches only after commit, never create the label, never apply a run, never ask whether the source may be applied.” Sibling Granot name write, HTTP automation catalog, apply-readiness, `sourcePolicy` resolve, Admin enrich, SMS command, `withRegistryMutation`, cache keys, classification-apply orchestration, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `GranotAutomationSourceService` class. Do not invent a begin / complete **seam** — `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second pointer **adapter** beside this command. Do not invent a second readiness **adapter** beside already-recommended `evaluateGranotAutomationCompatibility`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `link.ts` as a CRUD folder. Those are persistence verbs, and “link” is the migration plan action, not a second owner story. Do not move `createGranotAutomationSource` into this file so “one file owns automation sources.” Do not move `evaluateGranotAutomationCompatibility` into this file so “the pointer write owns apply.” Do not silently start resolving observations here so “the write stays hot.”

**External interface** stays small (this is the test surface). Point-the-label is one story’s Owner pointer, not a CRUD verb:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `setGranotAutomationSourceReference` | `pointThisHttpAutomationSourceAtThisGranotName` | classification apply `link`; any later Owner caller |
| `GranotAutomationSourceReferenceCommand` | `PointThisHttpAutomationSourceAtThisGranotName` | `{ id, granot_crm_source, reason }` |

Keep the old names as one-line aliases until classification apply, the barrel, and `granotAutomationSources.test.ts` migrate. Do not make callers learn `setGranotAutomationSourceReference` / `ReferenceCommand` as the domain language.

**Principle: old exports stay as aliases.** `setGranotAutomationSourceReference` remains the imported name until the migration **asks** the story name. Persisted Change `entity_type` (`granot_automation_source`) and `action` (`update`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The type that *does* earn a name is the Owner pointer the command already returns:

```ts
type ThisHttpAutomationSourceNowPointsAtThisGranotName = {
  id: string
  granot_crm_source: string
}
```

That is the handoff from “the Owner (or reviewed migration) pointed this label at this Granot name” to “Admin enrich can list the link, catalog resolve can ask apply-readiness.” Do **not** add `compatibility` so “the write owns apply.” Do **not** add `label` / `active` / `supported_operations` so “the pointer is the catalog row.” Do **not** add `lifecycle_enabled` so “the pointer write owns the Granot name.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add `createGranotAutomationSource` / `seedGranotAutomationSources` / `resolveGranotAutomationSources` as public **seams** — already-recommended catalog already owns those. Do not add `evaluateGranotAutomationCompatibility` as a public **seam** — already-recommended apply-readiness already owns that. Do not add `createOrUpdateGranotCrmSource` as a public **seam** — sibling cards already own that. Do not add `listProjectedGranotCrmSources` as a public **seam** — already-recommended Admin enrich already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotAutomationSources.ts
// An HTTP automation source is a label the Owner picks for a Granot run.
// A Granot name is the Registry card that says what a matching
// observation may become.
// This file only points the label at that card.
// Refuse unless they are Owner and named a reason.
// If it already points there, still write the Registry Change
// and still forget caches — do not update the pointer.
// The write and one granot_automation_source Registry Change
// share a transaction.
// Policy, list, and health caches forget only after commit.
// This file does not create the label.
// This file does not apply a run.
// This file does not ask whether the source may be applied.

// ── 1. Point this HTTP automation source at this Granot name ──

export async function pointThisHttpAutomationSourceAtThisGranotName(command, actor)

function refuseUnlessTheActorIsOwner(actor)
function requireAnExplicitReason(reason)
async function loadTheAutomationSourceInsideTheTransactionOrRefuseMissing(id, session)
async function loadTheGranotNameInsideTheTransactionOrRefuseMissing(id, session)
function thePointerAlreadyIsThisGranotName(beforeId, nextId)
async function writeThePointerAndOneAutomationSourceChange(command, actor, session)
```

Read the primary path out loud: *The Owner (or the reviewed classification apply) presents an HTTP automation source and a Granot name. Refuse unless they are Owner and named a reason. Load both rows inside the transaction. A missing label or a missing name is not found. If the pointer already is that name, write one `granot_automation_source` Registry Change and forget policy, list, and health caches after commit — do not `$set`. If the pointer is empty or points elsewhere, `$set` the ObjectId, write the same Change, and forget the same caches only after commit. Do not create the label. Do not apply a run. Do not ask whether the source may be applied.*

That is the operation. `setGranotAutomationSourceReference` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Empty reason uses `DEPENDENCY_CONFLICT`.** A missing reason is not a missing company or Feed. Sibling confirmation-text policy does the same leftover. Default HTTP for that code is 409; this file **overrides** `statusCode: 400`. Do not silently swap the code or drop the override in this rename without a paired interface test.

2. **Replay still writes a Change and still forgets caches.** The test named “replay of the same automation reference is a no-op write” only proves `$set` did not run. `withRegistryMutation` still inserts `granot_automation_source` `update` with `before === after` and still invalidates the three lifecycle keys. Classification apply skips planned `noop` and never **asks** this path; a later Owner retry would. Do not silently skip audit and cache forget on replay so “no-op means no-op” without a paired audit + cache test. Do not silently `$set` on replay so “every call writes.”

3. **`audit.metadata` is only set on a real `$set`.** First link and repoint stamp `{ request_id, reason }`. Replay does not. `request_id` and `reason` already live on the Change from the actor and `audit.reason`. Do not silently drop metadata so “one place owns those fields” without a paired audit snapshot test. Do not silently add metadata on replay so “every Change looks the same.”

4. **First link from `null` still audits `action: "update"`.** There is no `create` / `link` action on this Change. Classification apply’s plan action is `link`; the stored Change is `update`. Do not silently stamp `create` or `link` so “the action matches the plan” without a paired audit + migration verify test. Do not silently skip the Change on first link so “null was not a before.”

5. **The write does not ask whether the source may be applied.** It does not load `enabled` / `lifecycle_enabled` / `lifecycle_disposition` / `lifecycle_routes` on the Granot name. It does not look at `active` / `supported_operations` on the automation source. A pointer can land on a deferred, lifecycle-off, or operationally-off name. Catalog resolve and Admin enrich **ask** apply-readiness later. Do not silently refuse an unreadiness here so “the write owns apply” without a paired catalog + enrich test.

6. **There is no HTTP route.** Knowledge HTTP for Granot names is `GET/PATCH /api/v1/admin/granot-crm-sources`. This command is barrelled and only **asked** by classification apply. Admin create of a new label starts `missing_reference` until this write (or a reviewed apply) runs. Do not silently add a PATCH from this rename so “Owner UI can point.” Do not silently hide the barrel export so “no HTTP means no public seam.”

7. **Missing automation source and missing Granot name share `NOT_FOUND`.** Messages differ. The CRM load is `_id` only — it does not prove the name is reviewable. Do not silently merge the messages so “one miss string.” Do not silently 400 a bad ObjectId here; today Mongoose `findById` miss is the path.

8. **Leave sibling modules alone.** `withRegistryMutation`, `createGranotAutomationSource`, `seedGranotAutomationSources`, `resolveGranotAutomationSources`, `evaluateGranotAutomationCompatibility`, `createOrUpdateGranotCrmSource`, and `listProjectedGranotCrmSources` are already the right depth. This file orchestrates the Owner pointer.

9. **Do not silently change persisted Change `entity_type` or `action` strings.** `granot_automation_source` / `update` are audit history. Story names live on the functions.

## Testing

The **interface** is the test surface: `pointThisHttpAutomationSourceAtThisGranotName`.

Today `granotAutomationSources.test.ts` already proves Owner write order (`transaction-start` → `audit` → `transaction-commit`), caches after commit, replay skips `$set`, audit failure leaves the pointer unapplied and does not invalidate, and Admin `FORBIDDEN`. Keep those. Add tests that name the operation:

**Point this HTTP automation source at this Granot name**
- Owner first link from `null` → stored pointer is the Granot name, Registry Change `entityType: "granot_automation_source"`, `action: "update"`, `before.granot_crm_source` is `null`, caches `granot_lifecycle_source_policy` / `granot_lifecycle_source_list` / `granot_lifecycle_source_health` forgotten **after** commit (already partly on disk — keep the order).
- Non-owner actor → `FORBIDDEN` (already on disk — keep it). Empty / whitespace reason → 400 `DEPENDENCY_CONFLICT` with the explicit-reason message. Keep that code until a paired change.
- Missing automation source → `NOT_FOUND` (`Granot automation source not found.`). Missing Granot name → `NOT_FOUND` (`Granot CRM source not found.`).
- Replay that already points there → no `$set`, Change still written with `before === after`, caches still forgotten today. Keep that until a paired “true no-op” change.
- Repoint from name A to name B → `$set` B, `before` is A, `after` is B, `metadata.request_id` present only on this path today.
- Audit failure aborts the write and does **not** invalidate caches (already on disk — keep it).
- A pointer onto a lifecycle-off or deferred Granot name **succeeds** today. Keep that until a paired readiness-on-write change. Do not retest apply-readiness tables here.

Do **not** add a test per helper (`refuseUnlessTheActorIsOwner`, `thePointerAlreadyIsThisGranotName`, `writeThePointerAndOneAutomationSourceChange`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover `createGranotAutomationSource`, leftover `evaluateGranotAutomationCompatibility` tables, leftover sibling Granot name write, leftover Admin enrich, or leftover classification-apply planning here. Those already have (or will have) their own interface tests. Classification apply **asks** this command; prove the command, not the planner.

## What I would not do

- A `GranotAutomationSourceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `withRegistryMutation`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `link.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a pointer and must not forget caches.
- Treating leftover HTTP automation catalog create/seed/resolve, leftover apply-readiness, leftover sibling Granot name write, leftover Admin enrich, leftover SMS command, leftover `sourcePolicy` resolve, leftover classification-apply orchestration, leftover HTTP apply, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not swap `DEPENDENCY_CONFLICT` on an empty reason without a paired test; do not skip audit and cache forget on replay without a paired test; do not `$set` on replay; do not drop or add `audit.metadata` without a paired audit test; do not stamp Change `action` `create` / `link` so the plan wins; do not refuse unreadiness on this write so the pointer owns apply; do not add an HTTP PATCH from this rename; do not merge the two `NOT_FOUND` messages; do not move catalog create or apply-readiness into this file; do not rename persisted Change `entity_type` / `action` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
