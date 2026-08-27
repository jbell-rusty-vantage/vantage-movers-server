# Find The Existing Form Lead This Granot Row Already Is — Exact Tracking Reference First, Then Mongo Id After That Misses, Then The One Same-Source Phone Or Email Hit — Never Create One — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 5 of this service — `granotFormLeadMatcher.ts`
- Remaining in this service: `lifecycleStatement.ts`, `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/granotFormLeadMatcher.ts`
- Knowledge: [`docs/knowledge/services/form-lead-search.md`](../../../docs/knowledge/services/form-lead-search.md) — **Internal callers**: exact non-duplicate Tracking Reference, then Mongo `_id` (`isObjectIdString`), then fallback that **requires phone or email**, then `searchFormLeads` (limit 25, duplicates off); matcher then source-gates by `resolveSourceCompanyFromLabel` and may use Granot `prior` `0`/`1`/`5` to break quoted ties; ambiguous after that gate → `conflict`. HTTP: `POST /api/v1/form-leads/granot-match`. Distinct from scored search itself: [recommendations/search-form-lead-search.md](search-form-lead-search.md) (this file **ignores** `status` / `lead` and re-picks from `matches`). Distinct from CSV `resolveFormLead`: that path treats `mongoose.isValidObjectId(ref_no)` as a lead id and **skips** search; this file tries exact `FormLead.ref_no` first, then `_id`. [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) names the matcher only as “`resolveGranotFormLead` then a missing-field patch” under the Form planner — **`applies_to` omits this file**. Distinct from Form plan + missing-field patch: [recommendations/granot-http-collector-form-workflow.md](granot-http-collector-form-workflow.md). Distinct from session collect + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from standalone collect/preview: [recommendations/granot-http-collector-automation.md](granot-http-collector-automation.md). Distinct from fail-closed source resolve: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md). Distinct from plan seal: later `lifecycleStatement.ts`. Distinct from admin create / plan / approve / worker: later `runWorkflow.ts`. Distinct from Form Lead Correction write: [recommendations/form-lead.md](form-lead.md). Distinct from Duplicate Lead quarantine: [recommendations/leads-duplicate-lead.md](leads-duplicate-lead.md). Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` still says Form exact identity is only `Granot ref_no === FormLead.ref_no` and “Never add `_id`, `lid`, or `normalized_lid` interpretations” — `[AC-03]` and this file already allow Mongo `_id` after exact `ref_no` misses and lock `lid` off the leftover `granotFormIdentityFields` on `formWorkflow.ts`; do not delete `mongo_id` so HANDOFF “wins.” This checkout’s `CONTEXT.md` does not define Form Lead / Tracking Reference / Duplicate Lead / Granot HTTP collector — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **two runtime import sites + the leftover re-export + the planner test file.** Public match: `routes/v1.routes.ts` `POST /api/v1/form-leads/granot-match` parses `resolveGranotFormLeadSchema` (same identity keys + required `source_label` + optional `prior`; at least one of `ref_no` / `name` / `email` / `phone_number`) and serializes a found lead to a small public card. Planner: `formWorkflow.ts` `planRow` forwards `ref_no` / `phone` / `email` / `customer` / `sourceLabel` / `prior` and injects the lookup **adapters**; `conflict` / `no_match` become plan classes; `found` then proposes the missing-field patch. Leftover re-export: `formWorkflow.ts` still exports `selectGranotFormFallback` and owns `granotFormIdentityFields` because `formWorkflow.test.ts` imports them there. Tests: `formWorkflow.test.ts` (exact `ref_no` wins and must not fall back; duplicate exact refs are `conflict` / `duplicate_exact_ref`; Mongo id only after exact miss; fallback after exact miss; source-company warning on exact; fallback source-gate / quoted-prior / name-only refuse). Zod: `v1.validation.test.ts` (`resolveGranotFormLeadSchema` keeps provider refs and requires a Granot source). Not callers: `index.ts`, `automation.ts`, `sourceCatalog.ts`, `lifecycleStatement.ts`, `runWorkflow.ts` (calls the planner, not this file), `granotCrmCsv/sync.service.ts` `resolveFormLead`, `searchFormLeads` HTTP, `updateFormLead`, `granotLifecycle/automationApply.ts`. There is **no** `granotFormLeadMatcher.test.ts`.
- Seams callers need: public `granot-match` (default Mongo lookups) vs planner inject (`findExactRefMatches` / `findByMongoId` / `search`); exact Tracking Reference vs Mongo id vs same-source fallback; `found` (optional source-mismatch **warning**) vs `conflict` vs `no_match`; search **verdict** vs matcher **re-pick** from `matches`; leftover `selectGranotFormFallback` / `granotFormIdentityFields` on `formWorkflow.ts` vs identity that lives here; Form match (this file) vs Form plan (sibling proposes the patch)
- Split later (only if the file outgrows one sitting): keep one file — this ~229-line module is one screenplay for “find the existing Form Lead this Granot row already is.” If it later splits: `findTheExistingFormLeadThisGranotRowAlreadyIs.ts` / `pickTheOneSameSourceFormLeadAmongTheseScoredHits.ts` — story files, never `match.ts` / `search.ts` / `fallback.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge HTML parse, missing-field patch, plan seal, approve, apply, scored Form search, or CSV ObjectId skip into this file

`resolveGranotFormLead` / `selectGranotFormFallback` / `findExactRefMatches` / `findByMongoId` are executor mechanics. The owner question is: *Someone handed us a Granot Booked Jobs or Follow Up row — a Tracking Reference, maybe a phone, maybe an email, a source label, and a prior. Find the existing Form Lead that row already is. Try the Tracking Reference as an exact non-duplicate `FormLead.ref_no` first. Two of those is a fight — stop, do not keep looking. One of those is the lead, even if its Source Company disagrees with the Granot label (say so, do not refuse). If that exact field missed and the ref looks like a Mongo id, try the non-duplicate `_id`. Still miss? Only then may we fall back, and only with a phone or an email — never a name alone. Search Form Leads, then ignore that search’s found / ambiguous verdict and re-pick: same Source Company as the Granot label, then the best score, then quoted versus prior `0` / `1` / `5` when still tied. Zero after the gate is no_match. More than one is conflict. This file does not create a Form Lead. This file does not write. This file does not propose a patch.*

Session collect, scored Form search, Form plan, plan seal, durable admin runs, approved apply, CSV identity, and Form Lead Correction already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “name the existing Form Lead this Granot row already is” story, not “a Form Lead CRUD service,” and not the planner’s missing-field patch:

1. **Find the existing Form Lead this Granot row already is** — trim the Tracking Reference (`nbsp` → space, collapse whitespace). If it is present, ask Mongo for non-duplicate `FormLead.ref_no` equals that string (limit 3 — enough to see a fight). More than one → `conflict` / `duplicate_exact_ref` / `match_method: "none"`; do not search, do not try `_id`. Exactly one → `found` / `ref_no_exact`; if the lead’s `source_company` disagrees with `resolveSourceCompanyFromLabel(source_label)`, **warn** and still return the lead. Zero exact hits **and** the cleaned ref is an ObjectId string → ask Mongo for that non-duplicate `_id`; a hit is `found` / `mongo_id` (same warn-don’t-refuse). Still miss, or there was never a ref: fallback requires a cleaned phone **or** email. Name alone → `no_match` / `"Fallback matching requires phone or email."` without calling search. Otherwise call `searchFormLeads` (`limit: 25`, `include_duplicates: false`) and hand `matches` — not `status`, not `lead` — to the same-source pick. This function does not write. This function does not create. This function does not propose a patch.

2. **Pick the one same-source Form Lead among these scored search hits** — empty `matches` → `not_found`. The Granot label must resolve to a Source Company; an unknown label is `not_found` / `sourceGated` even if search scored hits. Keep only leads whose `source_company` equals that company; none left → `not_found` / `sourceGated` (reason later: “No same-source FormLead matched phone, email, or name.”). Keep only the best score among those. If more than one remains **and** `prior` is `"0"`, `"1"`, or `"5"`, keep those whose `quoted` matches the prior (`1` / `5` → quoted true; `0` → quoted false); if that filter would empty the set, keep the tied set. Exactly one → `found`. Else `conflict` / `ambiguous_fallback`. This function does not call Mongo. This function does not honor search `status`.

There is no third mutate operation. `found()` is the warn-don’t-refuse fold for exact / Mongo hits. `clean()` is the nbsp/whitespace fold. `findExactRefMatches` / `findByMongoId` are default Mongo **adapters**, not public stories. `granotFormIdentityFields` is a leftover constant on `formWorkflow.ts`, not an export of this file.

## Organization

Keep one file as the screenplay for “find the existing Form Lead this Granot row already is.” HTML parse, scored Form search, missing-field patch, plan seal, durable run lock, approved apply, CSV ObjectId skip, and Form Lead Correction already live in deeper **modules**. Do not pull those in. Do not invent a `GranotFormLeadMatcherService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this file does not write Mongo. Do not invent a second search **adapter** beside `dependencies.search` / `searchFormLeads`. Do not invent a second Source Company **adapter** beside `resolveSourceCompanyFromLabel`.

Do not move this into `formWorkflow.ts` so “match and patch are one sitting.” Do not move this into `search/formLeadSearch.service.ts` so “every Form identity lives with the scorer.” Do not move this into `granotCrmCsv/sync.service.ts` so “CSV and HTTP share one ObjectId skip.” Do not split `match.ts` / `fallback.ts` / `create.ts` / `update.ts`. Do not delete `mongo_id` in this rename so HANDOFF “wins.” Do not move `granotFormIdentityFields` here so “the leftover finally lives with identity” — CONTRADICTIONS already records the leftover on the planner; keep the alias / leftover until the planner tests migrate.

**External interface** stays small (this is the test surface). Find-the-lead and pick-among-hits are one story’s ladder, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveGranotFormLead` | `findTheExistingFormLeadThisGranotRowAlreadyIs` | public `POST /form-leads/granot-match`; planner `planRow` |
| `selectGranotFormFallback` | `pickTheOneSameSourceFormLeadAmongTheseScoredHits` | find uses it; planner tests still import the leftover re-export |
| `GranotFormLeadMatchResult` | `WhetherThisGranotRowIsExactlyOneExistingFormLead` | `found` / `conflict` / `no_match` handoff to plan or HTTP |
| `GranotFormLeadMatchInput` | `TheGranotRowWeAreTryingToName` | ref / phone / email / name / label / prior |
| `GranotFormLeadMatcherDependencies` | `HowToLookUpFormLeadsThisTime` | inject exact / Mongo id / search **adapters** |
| `GranotFormLeadMatchMethod` | `HowWeNamedThisLead` | `ref_no_exact` / `mongo_id` / `fallback` / `none` |
| `GranotFormLeadLike` | `TheLiveFormLeadTheCallerMayRead` | planner calls `lead.get(path)`; HTTP serializes a card |

Keep the old names as one-line aliases until `formWorkflow.ts`, `v1.routes.ts`, and the planner tests migrate. Do not make callers learn `findExactRefMatches` / `findByMongoId` / `found` / `clean` as the domain language.

**Principle: old exports stay as aliases.** `resolveGranotFormLead` and `selectGranotFormFallback` remain the imported names until the planner and the public match route point at the story names. `formWorkflow.ts` keeps `export { selectGranotFormFallback } from "./granotFormLeadMatcher"`.

**No class for the workflow.** The type that *does* earn a name is the found / fight / miss handoff we give the planner and the public route:

```ts
type WhetherThisGranotRowIsExactlyOneExistingFormLead =
  | {
      status: "found"
      match_method: "ref_no_exact" | "mongo_id" | "fallback"
      lead: TheLiveFormLeadTheCallerMayRead
      candidate_count: number
      warnings: string[]          // source-company mismatch on exact / mongo only
    }
  | {
      status: "conflict" | "no_match"
      match_method: "none"
      candidate_count: number
      reason: string              // duplicate_exact_ref | ambiguous_fallback | prose
      warnings: string[]
    }
```

That is the handoff from “we have a Granot row” to “propose a patch, or tell the extension we cannot tell.” Do **not** add a `create` status so “no_match can become a new Form Lead,” do **not** add `lid` / `normalized_lid` so “identity fields are complete,” and do **not** put `patch` on this result so “match owns the proposal.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotFormLeadMatcher.ts
// Someone handed us a Granot Booked Jobs or Follow Up row.
// Find the existing Form Lead that row already is.
// Try the Tracking Reference as an exact non-duplicate FormLead.ref_no first.
// Two of those is a fight — stop.
// One of those is the lead, even if its Source Company disagrees
// with the Granot label (warn, do not refuse).
// If that exact field missed and the ref looks like a Mongo id,
// try the non-duplicate _id.
// Still miss? Only then may we fall back, and only with a phone or an email.
// Search Form Leads, then ignore that search’s verdict and re-pick:
// same Source Company, then the best score,
// then quoted versus prior 0 / 1 / 5 when still tied.
// This file does not create a Form Lead. This file does not write.
// This file does not propose a patch.

// ── 1. Find the existing Form Lead this Granot row already is ──

export async function findTheExistingFormLeadThisGranotRowAlreadyIs(
  row,
  { findExactTrackingReferences, findByMongoId, searchFormLeads } = {},
)

function tryTheExactTrackingReferenceFirst(cleanedRef)          // >1 conflict; 1 found+warn
function thenTryTheMongoIdOnlyIfTheRefLooksLikeOneAndExactMissed(cleanedRef)
function refuseFallbackUnlessPhoneOrEmail(phone, email)
function searchThenRepickIgnoringTheSearchVerdict(phone, email, name, label, prior)
function warnWhenExactIdentityDisagreesOnSourceCompany(lead, sourceLabel)  // do not refuse

// ── 2. Pick the one same-source Form Lead among these scored hits ──

export function pickTheOneSameSourceFormLeadAmongTheseScoredHits(
  matches,
  sourceLabel,
  prior,
)

function keepOnlyLeadsFromThisGranotLabelsSourceCompany(matches, sourceLabel)
function keepOnlyTheBestScoreThenQuotedVersusPriorWhenStillTied(candidates, prior)
```

Read the find path out loud: *clean the Tracking Reference. If we have one, look for exact non-duplicate `ref_no`. Two hits, say conflict and stop. One hit, that is the lead — warn if the Source Company disagrees, do not keep looking. Zero hits and the ref looks like a Mongo id, try `_id` the same way. Still nothing? We need a phone or an email. Name alone is no_match. Search Form Leads, throw away found / ambiguous, and re-pick the same-source best score, using quoted versus prior only when that set is still a tie. One lead, say found. Zero, say no_match. More than one, say conflict. Do not create a Form Lead. Do not write. Do not propose a patch.*

That is the operation. `resolveGranotFormLead` as a matcher verb is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This matcher never creates a Form Lead.** Knowledge already says Form planning is `no_match` / `conflict` only. Public `granot-match` is the same find. Do not add a `create` status so “missing WordPress leads get ingested,” and do not call `createFormLead` / `createLeadFromGranot` from here.

2. **Exact Tracking Reference beats every later step.** `[AC-03]` locks it. Duplicate exact refs are `conflict` and must not call search or `_id`. One exact hit must not call fallback even when phone / email / prior are present. Do not “also search to confirm,” and do not treat an ObjectId-shaped ref as `_id` before the exact `ref_no` field misses.

3. **HANDOFF forbids `_id`; tests require it.** HANDOFF Safety says never add `_id` / `lid` / `normalized_lid`. `[AC-03]` locks Mongo id after exact `ref_no` miss and locks `lid` off leftover `granotFormIdentityFields`. Do not delete `mongo_id` so HANDOFF “wins,” and do not add `lid` so “identity fields are complete.”

4. **CSV ObjectId skip is a different story.** CSV `resolveFormLead` treats `mongoose.isValidObjectId(ref_no)` as a lead id and never enters Form Lead Search. This file uses the same `isObjectIdString` helper (`mongoose.isValidObjectId`) **only after** exact `ref_no` misses. Do not skip the exact field so “CSV and HTTP share one ObjectId path,” and do not teach CSV to call this file so “one matcher.”

5. **Exact / Mongo warn on source mismatch; fallback refuses.** `found()` compares `resolveSourceCompanyFromLabel(source_label)` to `lead.source_company` and only pushes a warning. Fallback drops every other company, and an unknown label is source-gated `not_found`. Do not refuse an exact hit because the company disagrees so “one source gate,” and do not warn-and-keep a wrong-source fallback so “exact and fallback match.”

6. **The search verdict is not this answer.** `searchFormLeads` may return `found` or `ambiguous`. This file reads `matches` only. A search `found` can still become matcher `no_match` / `conflict`. A search `ambiguous` can still become matcher `found` after the source gate and quoted-prior break. CONTRADICTIONS already records this on the search recommendation. Do not honor `status` / `lead` so “one identity verdict,” and do not move source-gate / quoted-prior into `formLeadSearch.service.ts`.

7. **Name alone must not query.** Fallback requires phone or email before `searchFormLeads`. The public Zod refine still accepts name-only (`requireAtLeastOneTruthySearchField`). HTTP can therefore call this file with only `name` + `source_label` and receive `no_match` without a Mongo search. Do not start searching on name so the refine “wins,” and do not delete `name` from the schema so “the matcher owns Zod.”

8. **Quoted-prior is a fallback tie-break only.** It runs only when more than one same-source best-score candidate remains **and** `prior` is `"0"`, `"1"`, or `"5"`. If that filter would empty the set, the tied set stays (and then conflicts). Exact / Mongo hits never look at `quoted` or `prior`. Do not apply quoted-prior to a `ref_no_exact` hit so “prior 5 must be quoted,” and do not treat prior `"2"` as a quoted filter.

9. **Duplicates stay quarantined on every rung.** Exact `ref_no`, Mongo `_id`, and fallback search all use `duplicate: { $ne: true }` / `include_duplicates: false`. Do not return a Duplicate Lead so “the owner can still see it,” and do not add `include_duplicates` to this **interface**.

10. **Identity leftovers live on the planner.** `granotFormIdentityFields` and the `selectGranotFormFallback` re-export stay on `formWorkflow.ts` because tests import them there. Do not move the constant in this rename so “the leftover finally lives here,” and do not delete the re-export so “one export site.”

11. **Knowledge `applies_to` omits this file.** `granot-http-collector.md` lists `formWorkflow.ts` and talks about `resolveGranotFormLead` as a planner step. The detailed ladder lives on `form-lead-search.md`. Do not invent a new Service file, and do not silently add this path to `applies_to` in this rename.

12. **Leave sibling modules alone.** Session collect, scored Form search, Form plan, plan seal, durable run lock, approved apply, CSV identity, and Form Lead Correction are already the right **depth**. This file orchestrates exact → Mongo id → same-source re-pick only.

## Testing

The **interface** is the test surface: `findTheExistingFormLeadThisGranotRowAlreadyIs`, `pickTheOneSameSourceFormLeadAmongTheseScoredHits`. Today those tests live on `formWorkflow.test.ts` through the planner export and the leftover re-export. Keep them. Prefer claiming them on this **interface** (new `granotFormLeadMatcher.test.ts` or the same file importing these names) rather than adding a second copy. Inject lookup **adapters** — do not re-test HTML parse, missing-field patch, or `updateFormLead` here.

**Find the existing Form Lead this Granot row already is**
- Exact `ref_no` is `ref_no_exact` and must not call fallback or Mongo id (already `[AC-03]` via the planner; keep it, claim it here).
- Duplicate exact refs are `conflict` / `duplicate_exact_ref` and must not fall back (already locked; keep it).
- Mongo id runs only after exact `ref_no` miss (already `[AC-03]`; keep it).
- Fallback after exact miss can still `found` (already locked; keep it).
- Exact match with a source-company mismatch stays `found` and warns (already locked; keep it).
- Name-only (no phone, no email) is `no_match` / `"Fallback matching requires phone or email."` and must not call search (already locked; keep it).
- A fallback hit from a different Source Company is `no_match` / same-source prose (already locked via the planner; keep it).
- Public Zod accepts name-only + `source_label`; this function still refuses to search (add this on **this** interface — today’s Zod test only parses).
- Search `status: "found"` plus a wrong-source-only `matches` list is still matcher `no_match` (add this).
- Search `status: "ambiguous"` plus one same-source best score is matcher `found` / `fallback` (add this).
- An ObjectId-shaped ref that **also** matches `FormLead.ref_no` stays `ref_no_exact` and must not call `findByMongoId` (add this).
- Do not add a test that this function writes a Form Lead, receipt, or patch.

**Pick the one same-source Form Lead among these scored search hits**
- Same-source + quoted-prior `5` prefers the quoted lead among equal scores (already locked via leftover re-export; keep it).
- A higher-scoring other-company hit loses to a lower-scoring same-source hit (already locked; keep it).
- Unknown `source_label` is `not_found` / `sourceGated` even when `matches` is non-empty (add this).
- Prior `"2"` does not filter on `quoted` — two same-source best scores stay `conflict` (add this).
- Quoted-prior that would empty the set leaves the tied same-source best scores and then conflicts (add this).
- Do not add a test that this function calls `searchFormLeads` or Mongo.

Do **not** add a test per helper (`tryTheExactTrackingReferenceFirst`, `warnWhenExactIdentityDisagreesOnSourceCompany`, `keepOnlyTheBestScoreThenQuotedVersusPriorWhenStillTied`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. Planner classification / patch / `schema_version` / `granotApplyEnabled` tests stay on `formWorkflow.test.ts` / the run-workflow pass; they are not this **interface**.

Do **not** re-test HTML parse, scored Form search weights, CSV ObjectId skip, missing-field patch, plan seal, approve, apply, or Form Lead Correction write here.

## What I would not do

- A `GranotFormLeadMatcherService` class with `match` / `search` / `fallback` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `FormLead.find` or `searchFormLeads`.
- Moving this into a CRUD folder (`match.ts` / `search.ts` / `fallback.ts` / `create.ts` / `update.ts` / `delete.ts`), or into `formWorkflow.ts` / `search/formLeadSearch.service.ts` / `granotCrmCsv/sync.service.ts` “for cleanliness.”
- Creating a Form Lead from `no_match`, or calling `createFormLead` / `createLeadFromGranot` / `updateFormLead` from this file.
- Deleting `mongo_id` so HANDOFF’s “never add `_id`” sentence “wins.”
- Adding `lid` / `normalized_lid` so leftover `granotFormIdentityFields` “looks complete.”
- Honoring `searchFormLeads` `status` / `lead` so “one identity verdict.”
- Refusing an exact / Mongo hit because Source Company disagrees so “one source gate.”
- Searching on name alone so the public Zod refine “wins.”
- Teaching CSV to call this file, or skipping exact `ref_no` for ObjectId-shaped refs so “CSV and HTTP share one path.”
- Putting `patch` or `lifecycle_apply` on the match result so “match owns the proposal.”
- Moving `granotFormIdentityFields` here, or deleting the `formWorkflow.ts` re-export, so “one export site.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Form Lead / Tracking Reference.
- Writing a whole-folder recommendation for `granotHttpCollector`.
