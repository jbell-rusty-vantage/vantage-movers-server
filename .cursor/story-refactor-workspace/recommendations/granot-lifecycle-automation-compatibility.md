# Say Whether This HTTP Automation Source May Be Applied — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 5 of this service — `automationCompatibility.ts`
- Remaining in this service: `normalization.ts`, `sourcePolicy.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/automationCompatibility.ts`
- Knowledge: no dedicated file. Owner rules live in `docs/knowledge/services/granot-http-collector.md` (Source catalog vs apply routing) and the Admin projection note in `docs/knowledge/services/operations-registry.md`. Distinct from processor fail-closed Registry policy: `docs/knowledge/granot-lifecycle/source-policy.md` + next module `sourcePolicy.ts`. Distinct from approved apply: `recommendations/granot-lifecycle-automation-apply.md` + `docs/knowledge/granot-lifecycle/automation-apply.md`. Distinct from receipt insert / queue wake-up / Owner extension apply: `recommendations/granot-lifecycle-capture.md`, `recommendations/granot-lifecycle-queue-publisher.md`, `recommendations/granot-lifecycle-extension-apply.md`. Distinct from attaching the Registry pointer: `operationsRegistry/granotAutomationSources.ts`. This checkout’s `CONTEXT.md` does not define Granot Automation Source / Granot CRM Source / Granot Observation Receipt — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `granotHttpCollector/sourceCatalog.ts` (`listGranotAutomationSources` / `projectAutomationSources` additive `compatibility`; `createGranotAutomationSource` always evaluates with no pointer; `resolveGranotAutomationSources` fails closed on `available_for_apply !== true`; `partitionGranotAutomationSourcesByRegistry` reuses the route fold). `operationsRegistry/granotCrmSourceProjections.ts` (Admin CRM-source detail: each linked automation row plus this readiness). Tests: `automationCompatibility.test.ts`, `sourceCatalog.test.ts` (authority + `INVALID_GRANOT_SOURCES` shape). Not callers: `automationApply.ts`, `runWorkflow.ts` (it calls `resolveGranotAutomationSources`, not this file), `sourcePolicy.ts`, webhook routes, extension apply.
- Seams callers need: ready vs a bounded unavailable status; `supported_operations` is catalog list/create, Registry `lifecycle_routes` are apply authority; injected `referenced` + `normalized_label_match_count` (this file does not load Mongo); create-without-pointer starts `missing_reference`
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `form-ready.ts` / `call-ready.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`evaluateGranotAutomationCompatibility` is executor mechanics. The owner question is: *the owner wants to run HTTP automation against this source. May we apply? Only if they already pointed at exactly one enabled, lifecycle-enabled, non-deferred Granot CRM source whose routes allow the Form or Call work they asked for. A missing pointer, a missing Registry row, two rows sharing the label, a disabled or deferred source, or routes that refuse this operation — say no, with one bounded issue. Do not apply. Do not resolve processor policy. Do not write a receipt.*

Registry writes, processor policy, approved apply, receipt insert, claim/drain, and attaching the CRM pointer already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a compatibility CRUD service,” and not apply / policy / catalog resolve:

1. **Say whether this HTTP automation source may be applied** — take an optional Granot CRM source id, the Form/Call operations the caller is asking for, the referenced Registry row (or “not found”), and how many Registry rows share that row’s normalized label. Trim the id; empty becomes missing. No id, or a pointed id whose row is missing, is `missing_reference` (`granot_crm_source_reference_missing`) and `available_for_apply: false`. A found row whose label count is greater than one is `source_ambiguous`. A found unique row that is operationally disabled, lifecycle-disabled, or `deferred` is `source_disabled`. A found unique enabled row whose `lifecycle_routes` do not include `FormLead` for `form_leads` or `CallLead` for `call_leads` (for any requested operation) is `operation_not_permitted`. Otherwise `ready` and `available_for_apply: true` with empty issues. This function does not load Mongo. It does not throw `INVALID_GRANOT_SOURCES`. It does not read `supported_operations`. It does not read `lead_created_policy`. It does not evaluate the eight processor effect gates. It does not write a receipt or a Lead.

There is no second mutate operation. `automationOperationPermittedByRoutes` is the route-permit fold for that one question. Form vs Call are two requested operations on one readiness check, not two stories in this file.

## Organization

Keep one file. This is the screenplay for “say whether this HTTP automation source may be applied.” Catalog load/resolve, Registry attach, processor policy, and approved apply already live in deeper **modules**. Do not pull those in. Do not invent an `AutomationCompatibilityService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a pure readiness answer, not a Domain Command. Do not invent a processor-shaped effect-gate **seam** that has only one real adapter here.

Do not split this ~145-line file into Form / Call folders. Those are two operations on one check. Do not move `unavailable` into `observability.ts` “because issues look like events.” Do not move the route fold into `sourcePolicy.ts` “because routes live on the Registry row.” Do not merge this file into `automationApply.ts` so “readiness and apply live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateGranotAutomationCompatibility` | `sayWhetherThisHttpAutomationSourceMayBeApplied` | catalog list/create/resolve + CRM-source projections |
| `automationOperationPermittedByRoutes` | `doTheseRegistryRoutesPermitThisFormOrCallWork` | resolve partition after ready; tests lock Call ≠ Form |
| `GranotAutomationSourceCompatibility` | `AutomationSourceApplyReadiness` | `{ available_for_apply, status, issues, granot_crm_source_id? }` callers project |
| `GRANOT_AUTOMATION_COMPATIBILITY_STATUSES` | `AutomationSourceApplyStatuses` | closed status table |
| `GRANOT_AUTOMATION_COMPATIBILITY_ISSUE_CODES` | `AutomationSourceApplyIssueCodes` | closed issue codes |

Keep the old names as one-line aliases until `sourceCatalog` and `granotCrmSourceProjections` migrate. Do not make callers learn `unavailable` / `normalized_label_match_count` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the readiness the catalog and Admin will show:

```ts
type AutomationSourceApplyReadiness = {
  granot_crm_source_id?: string
  available_for_apply: boolean
  status:
    | "ready"
    | "missing_reference"
    | "source_disabled"
    | "source_ambiguous"
    | "operation_not_permitted"
  issues: Array<{
    code:
      | "granot_crm_source_reference_missing"
      | "granot_crm_source_disabled"
      | "granot_crm_source_ambiguous"
      | "granot_crm_source_operation_not_permitted"
    message: string
  }>
}
```

That is the handoff from “we looked at the attached Registry row” to “the owner can see why this source stays disabled, or the resolve path can fail closed.” Do **not** add `lead_created_policy` / effect-gate names so “we match source policy,” and do **not** add `supported_operations` so “the catalog field is still the answer.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// automationCompatibility.ts
// The owner wants to run HTTP automation against this source.
// May we apply?
// Only if they already pointed at exactly one ready Granot CRM source
// whose routes allow this Form or Call work.
// A missing pointer, a missing row, two rows sharing the label,
// a disabled or deferred source, or routes that refuse the work — say no.
// This file does not load Mongo.
// This file does not throw.
// This file does not write a receipt.
// supported_operations is not the answer.

// ── 1. Say whether this HTTP automation source may be applied ──

export function sayWhetherThisHttpAutomationSourceMayBeApplied(input)

function theOwnerHasNotPointedAtAGranotCrmSource(id)
function thePointedRegistryRowIsMissing(id)
function moreThanOneRegistryRowSharesThisLabel(id, count)
function theRegistryRowIsDisabledOrDeferred(id, referenced)
function theRegistryRoutesRefuseTheRequestedWork(id, referenced, operations)
export function doTheseRegistryRoutesPermitThisFormOrCallWork(routes, operation)
  // form_leads → FormLead; call_leads → CallLead
function sayNoWithOneBoundedIssue(status, code, id?, message)
```

Read the primary path out loud: *The owner opened the automation source list, created a new label, or selected source ids for a run. The catalog already loaded the optional Granot CRM pointer and counted how many Registry rows share that label. If they never attached a pointer, say missing reference — a new admin label starts that way. If they pointed at an id we cannot find, say the same status and keep the id. If two Registry rows share the normalized label, say ambiguous — never first-row wins. If the one row is off, lifecycle-off, or deferred, say disabled. If they asked for Form work and the routes only name Call Lead — or the other way around — say the operation is not permitted. Otherwise say ready. Never treat the catalog `supported_operations` list as the answer. Never apply from this file. Never resolve processor policy. Never throw `INVALID_GRANOT_SOURCES` — the resolve caller does that when `available_for_apply` is not true.*

That is the operation. `doTheseRegistryRoutesPermitThisFormOrCallWork` is not a different story. `applyThisOwnerApprovedHttpAutomationAction` is not this check.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`supported_operations` is catalog list/create, not apply authority.** Knowledge and `[AC-09]` / `[AC-38]` already lock that. A source can list `form_leads` and still be `missing_reference` or `operation_not_permitted`. `partitionGranotAutomationSources` (sibling, leftover) still filters on that catalog field. `partitionGranotAutomationSourcesByRegistry` uses this file’s route fold. Do not start reading `supported_operations` here so “the list field wins,” and do not delete the leftover partition so this readiness “owns every split.”

2. **This file answers; resolve throws.** `sayWhetherThisHttpAutomationSourceMayBeApplied` never throws. `resolveGranotAutomationSources` maps `available_for_apply !== true` to `INVALID_GRANOT_SOURCES` plus the first issue code/message. List and Admin projections show the same unreadiness without throwing. Do not throw from here so “fail closed lives in one place,” and do not stop resolve from throwing so “the status is enough.”

3. **Create without a pointer is always missing.** `createGranotAutomationSource` calls this with `requested_operations` only — no id, no referenced row. New admin labels start `missing_reference` until an Owner or reviewed migration attaches an exact Registry row (`granotAutomationSources.ts`). Do not invent a ready default so “a new source can run,” and do not attach a label-matched Registry row from this file.

4. **Label-only run create is the caller’s gap, not this file.** Knowledge already says `createGranotRun` with `source_labels` only does not call `resolveGranotAutomationSources`. This evaluator is still honest when someone later asks. Do not teach this file to accept a raw label so “label create can skip resolve,” and do not silently close that gap in this rename.

5. **`deferred` is `source_disabled` here; processor policy says `deferred`.** This file collapses `enabled === false`, `lifecycle_enabled === false`, and `lifecycle_disposition === "deferred"` into one status / `granot_crm_source_disabled`. `sourcePolicy.ts` maps deferred to `deferred` / `source_deferred` and operational disable to `policy_blocked` / `source_disabled`. Do not split this status so “every channel matches source policy,” and do not collapse source policy so “every disable looks like automation.”

6. **Empty requested operations can still be ready.** `requested.length > 0 && blocked.length > 0` is the only refuse. Callers pass catalog `supported_operations` or the run’s operations, so the empty path is unused today. Do not treat empty as `operation_not_permitted` so “ready always means we checked a route,” and do not start requiring operations so list-without-filter breaks.

7. **Missing id and missing row share `missing_reference`.** No id omits `granot_crm_source_id` on the answer. A pointed id with `referenced: null` (or undefined) keeps the id. Tests lock both. Do not invent `source_not_found` so Admin can tell them apart, and do not drop the id on the pointed-miss so “missing is missing.”

8. **Ambiguity is a caller-supplied count, after the row exists.** Default `normalized_label_match_count` is `1`. The check runs only once `referenced` is present. Catalog and CRM projections count every Registry row with that `normalized_granot_label`, including disabled ones (`includeDisabled: true`). Do not look up the label from this file so “count cannot lie,” and do not skip the count when the row is disabled so “disabled wins first.”

9. **This file does not load Mongo and does not normalize labels.** Callers pass the Registry snapshot. `normalizeGranotSourceLabel` stays in `sourceLabel.ts` and is a source-policy beat. Do not import the Registry model here so “readiness is self-contained,” and do not NFKC-fold the id so “ids look like labels.”

10. **Whitespace-only ids are missing.** `trim() || undefined` treats `"   "` as no pointer. Catalog ids are ObjectIds; this file does not validate ObjectId shape. Do not require `mongoose.isValidObjectId` here so “canonicalize lives once” — that stay on `canonicalizeGranotSourceIds`.

11. **Processor gates and creation policy are out of scope.** Ready here does not mean `create_if_missing`, `link_only`, company/granularity active, or any of the eight `EFFECT_GATE_NAMES`. Reviewed family inventory stays in operations-registry knowledge. Do not hard-code Best Relocation / Main Site / TBM labels, and do not call `resolveSourcePolicy` so “one Registry read wins.”

12. **Leave sibling modules alone.** `resolveGranotAutomationSources` / `projectAutomationSources` stay in `sourceCatalog.ts`. CRM-source Admin enrich stays in `granotCrmSourceProjections.ts`. Attaching `granot_crm_source` stays in `granotAutomationSources.ts`. `applyThisOwnerApprovedHttpAutomationAction` stays the previous module. `resolveSourcePolicy` stays the later `sourcePolicy.ts` pass. This file only answers readiness from facts the caller already has.

13. **Do not treat approved apply, webhook `202`, Owner extension apply, Follow Up CSV write, or processor Decisions as this story.** Those capture, claim, or write. This file only says whether the source may be selected. Do not write a whole-folder recommendation for `granotLifecycle`.

## Testing

The **interface** is the test surface: `sayWhetherThisHttpAutomationSourceMayBeApplied` (today `evaluateGranotAutomationCompatibility`). `{ available_for_apply, status, issues, granot_crm_source_id }` is part of that **interface**. `doTheseRegistryRoutesPermitThisFormOrCallWork` stays exported because the resolve partition is a second real **adapter**, not a test leak.

Today’s `automationCompatibility.test.ts` already locks missing pointer, pointed-but-missing row (keeps the id), label-count `2` → ambiguous, disabled / lifecycle-disabled / deferred → `source_disabled`, Call routes refusing `form_leads`, and ready Form policy without treating `supported_operations` as authority. Keep those. Add the gaps that name the operation:

**Say whether this HTTP automation source may be applied**
- `call_leads` against Form-only routes → `operation_not_permitted`.
- Both operations requested, only Form routes present → `operation_not_permitted` (one blocked operation fails the whole check).
- Whitespace-only `granot_crm_source_id` → `missing_reference`, no id on the answer.
- Omitted `normalized_label_match_count` on a found row → ready (default 1), not ambiguous.
- Empty `requested_operations` on an otherwise ready row → `ready` (current contract; do not “fix”).
- `lead_created_policy: "observation_only"` on an otherwise ready row is ignored — still `ready`.
- This function does not throw.

Do **not** add a test per helper (`theOwnerHasNotPointedAtAGranotCrmSource`, `sayNoWithOneBoundedIssue`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test `INVALID_GRANOT_SOURCES`, ObjectId canonicalize, duplicate source ids, or leftover `supported_operations` partition here — `sourceCatalog.test.ts` already locks those. Do not re-test `GRANOT_AUTOMATION_APPLY_ENABLED`, plan seal, or `applyThisOwnerApprovedHttpAutomationAction`. Do not re-test `resolveSourcePolicy` eight-gate snapshots. Do not add a test that this file loads Mongo or writes a receipt — it must not. Do not add a test that a label string without a Registry id is `ready`.

## What I would not do

- An `AutomationCompatibilityService` class with `create` / `update` / `evaluate`.
- Thirty two-line functions that only wrap the status table.
- Moving this into a CRUD folder, or into `sourceCatalog.ts` / `sourcePolicy.ts` / `automationApply.ts` “for cleanliness.”
- Treating `supported_operations` as apply authority.
- Throwing `INVALID_GRANOT_SOURCES` from this file, or attaching a Registry row by label.
- Splitting `deferred` to match source policy, or collapsing source policy to match this file.
- Reading `lead_created_policy` or the eight effect gates so “one Registry answer wins.”
- Teaching approved apply, webhook capture, or Owner extension apply to call this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
