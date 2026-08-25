# Call Lead Source Fit — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 11 of this service — `callLeadSourceMatch.ts`
- Remaining in this service: `leadSourceCompatibility.ts`
- Target: `src/services/leads/callLeadSourceMatch.ts`
- Knowledge: `docs/knowledge/services/enrichment.md` (keep source-compatible or unassigned; assigned miss → `conflict`; unassigned claim warns), `docs/knowledge/services/booked-call-lead-reconciliation.md` (same ladder; job-no miss → `conflict`, phone miss → `no_match`). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define a source-fit term — do not invent a glossary copy.
- Callers: `enrichment/callLeadEnrichment.service.ts` (the only runtime import). Booked-call-lead reconciliation **copies** the five functions and does not import this file. Employee booking uses `leadSourceCompatibility.ts` (next module), not this one.
- Seams callers need: may this Call Lead take this CRM row’s source (yes / no) vs the sentence when an assigned Call Lead and the CRM row disagree vs the two human labels used in that sentence and in the “claiming unassigned” warning
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Three operations, not “a match helper” and not the phone/job pick:

1. **May this Call Lead take this CRM row’s source?** — Follow Up already found Call Leads by phone or job. An unassigned Call Lead (`source_company` empty or `not_provided`) may take any CRM source; sync will claim it. An assigned Call Lead may take the row when any one of these is true: same Registry company id, same Source Granularity key, or same leftover `source_company` string. If none of those hold, the answer is no.
2. **Name the sources for a human** — the CRM row’s label (assignment snapshots, then raw `source_label`, then leftover company, then `unknown`) and the Call Lead’s label (the same snapshots on the document, then granularity key, then leftover company, then `unknown`).
3. **Write the assigned-source conflict sentence** — only when the CRM row already has a leftover `source_company` **and** the Call Lead may not take that source. The sentence is `Matched call lead has source {lead}; CRM row source maps to {row}.` If the row has no leftover company, this file stays silent — the caller’s generic “no eligible candidate had source …” line is what the owner sees.

`isLeadSourceCompatible` / `buildAssignedSourceConflict` are executor mechanics. The owner question is: *this Follow Up (or booked-jobs) row found Call Leads by phone or job — may we attach it to this one, or do the assigned sources disagree?*

This file does **not** load Call Leads. It does **not** pick among candidates (open vs booked, recency, “newest eligible”). That pick is `selectSourceCompatibleCallLead` in enrichment, and a near-copy in booked-call-lead reconciliation. `assignLeadSource` (`leadSourceCompany.ts`) already stamped the row. `classifyLeadSourceCompatibility` (next module) is a four-way score for employee booking, not this yes/no.

## Organization

Keep one file. This is the screenplay for “does this assigned source fit.” Phone/job load, the open-pool pick, Sheet Sync, CPL on source claim, and the employee four-way score already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadSourceMatchService` class.

Do not split this 76-line file. Fit vs labels vs sentence are three **seams** on one story, not three folders. Do not move the pick into this file “because enrichment only calls it to filter.” Do not move this file into `enrichment/` “because only enrichment imports it” — reconciliation already tells the same story with a paste.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `isLeadSourceCompatible` | `thisCallLeadMayTakeThisCrmSource` | enrichment pick + post-pick guard; recon’s copy should import this later |
| `isUnassignedSource` | `thisCallLeadHasNoAssignedSource` | the “Claiming unassigned … as {label}” warning is the caller’s; this is the test it uses |
| `sourceDisplayLabel` | `nameTheCrmRowsSourceForAHuman` | conflict sentence + “no eligible candidate” + claim warning |
| `leadSourceDisplayLabel` | `nameTheCallLeadsSourceForAHuman` | the left half of the assigned-source sentence |
| `buildAssignedSourceConflict` | `sentenceWhenAssignedSourcesDisagree` | preview/sync `conflict` when the only hits are a different assigned company |

Keep the old names as one-line aliases until enrichment migrates and reconciliation stops pasting. Do not make callers learn `Compatible` / `DisplayLabel` / `Assigned` as the domain language.

`CallLeadSourceParsedRow` stays exported. It is the structural bag enrichment and the recon copy already share (`source_company`, `source_label`, optional `source_assignment`). Do not replace it with the employee `SourceExpectation`.

**No class for the workflow.** The type that *does* earn a name is the leftover-company test the sentence already requires:

```ts
type CrmRowLeftoverSourceCompany = string   // parsed.source_company — sentence stays silent without it
```

Unassigned is a fact about the **Call Lead’s** leftover `source_company`, not about the CRM row.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadSourceMatch.ts
// Follow Up (or booked-jobs) already found Call Leads by phone or job.
// This file does not find them.
// It answers: may this Call Lead take this CRM row’s source?
// If the Call Lead has no assigned company, yes — sync will claim it.
// If it is assigned, any one of: same Registry company,
// same granularity key, same leftover company string.
// If the assigned sources disagree, name both so preview will not write.

// ── 1. May this Call Lead take this CRM row’s source? ─────

export function thisCallLeadMayTakeThisCrmSource(lead, parsed)

export function thisCallLeadHasNoAssignedSource(sourceCompany)
  // empty / missing / "not_provided" — does not look at lead_source_company

function sameRegistryCompany(lead, parsed)          // both ids present; String() ===
function sameGranularityKey(lead, parsed)           // exact ===, no trim
function sameLeftoverCompanyString(lead, parsed)    // both present; exact ===

// ── 2. Name the sources for a human ───────────────────────

export function nameTheCrmRowsSourceForAHuman(parsed)
  // crm snapshot → granularity snapshot → company snapshot
  // → source_label → leftover source_company → "unknown"

export function nameTheCallLeadsSourceForAHuman(lead)
  // same snapshots on the document
  // → source_granularity_key → leftover source_company → "unknown"

// ── 3. Write the assigned-source conflict sentence ────────

export function sentenceWhenAssignedSourcesDisagree(lead, parsed)
  // silent when the row has no leftover source_company
  // silent when the Call Lead may take the row
  // else: "Matched call lead has source {lead}; CRM row source maps to {row}."
```

Read the fit out loud: *They already found Call Leads by phone or job. If this Call Lead has no assigned Source Company — empty or `not_provided` — it may take the CRM row; sync will write the CRM source and warn that we claimed an unassigned lead. If it is already assigned, it may take the row when the Registry company ids match, or the granularity keys match, or the leftover company strings match. Any one is enough. If none of those hold, it may not.*

Read the sentence out loud: *The CRM row already mapped to a leftover Source Company, and this Call Lead may not take it. Name the lead’s source. Name the row’s source. That is the `conflict` the owner sees. If the row never got a leftover company, stay silent — the caller has its own “no eligible candidate” line.*

That is the operation. `isLeadSourceCompatible` is not. The file name is not either: this is fit, not a match.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file does not match.** Enrichment loads by phone (25, leading-boundary regex + verify) then job (5). Then `selectSourceCompatibleCallLead` prefers not booked / not cancelled, filters with this predicate, and picks newest `timestamp` then `createdAt`. Keep the pick in enrichment. Do not add `pickTheSourceCompatibleCallLead` here so “source match is one function.”

2. **Reconciliation pastes this file.** `bookedCallLeadReconciliation.service.ts` has the same five functions, same ladders, same sentence. Its **pool** is different: never `created_on_unmatched`, never booked, never cancelled; a phone-path source miss is `no_match`, not `conflict`. A later pass should import these five and **leave that pool alone**. Do not paste the pick into this file. Do not change recon’s phone-miss status during this rename.

3. **Two compatibility dialects.** This file is a yes/no OR-ladder. `classifyLeadSourceCompatibility` (next module) is `exact_granularity` | `same_company` | `unassigned` | `conflict`, and unassigned there requires **no** `lead_source_company`. Employee booking scores with that file. Do not route enrichment through the four-way score. Do not replace the classifier with this yes/no.

4. **Unassigned ignores Registry company.** `thisCallLeadHasNoAssignedSource` looks only at leftover `source_company`. A document with `source_company: "not_provided"` and a populated `lead_source_company` is unassigned **here** (may take any CRM row). The classifier would not call that unassigned. Do not add `&& !lead.lead_source_company` so the two files “agree.”

5. **No normalize.** Registry ids are `String()` then `===`. Granularity key and leftover company are exact. The classifier trims and lowercases. Do not silently trim/lowercase here. A `Main_Site` leftover vs `main_site` is a miss today.

6. **Any one of three is enough.** Same company id with a different granularity key is a fit. Same granularity key with a different company id is also a fit. The classifier’s `exact_granularity` wants **both**. Do not require both here so “fit means same granularity.”

7. **The sentence needs a leftover company on the row.** `if (!parsed.source_company) return undefined` even when the Call Lead is assigned and the assignment ids disagree. Enrichment parse sets leftover `source_company` from the assignment stamp, or from a legacy slug, or leaves it empty when the catalog skip-warns (`Skipped unknown source`). That empty path uses the caller’s generic line, not this sentence. Keep the short-circuit. Do not start emitting the sentence from snapshots alone during the rename.

8. **Post-pick sentence is dead on today’s pick.** `resolveEnrichmentRow` calls `sentenceWhenAssignedSourcesDisagree` again after a successful pick. The pick already returned a lead this predicate accepted, so the second call cannot fire. Keep the export — recon’s booking path and a future caller that skips the pick still need the sentence. Do not delete it as unused.

9. **`leadSourceDisplayLabel` has no other runtime import.** Only this sentence uses it. Keep the export. Recon’s paste needs the same name when it stops copying. Do not hide it as a child so the sentence becomes the only **interface**.

10. **Employee `sourceDisplayLabel` is a different field.** Prepared employee bookings store a display string. `bookingLeadAttachment` has a local helper of the same name. Do not import this CRM-row ladder there.

11. **This file does not write.** Claiming an unassigned source — stamping `source_company` / assignment, repricing CPL, Sheet Sync — is enrichment sync. Keep writes there.

12. **Leave sibling modules alone.** `assignLeadSource` already stamped the row before this file runs. Phone sieve / booking phone pick, Duplicate / Form Fill, Granot identity, and the four-way classifier stay where they are.

## Testing

The **interface** is the test surface: `thisCallLeadMayTakeThisCrmSource`, `thisCallLeadHasNoAssignedSource`, `nameTheCrmRowsSourceForAHuman`, `nameTheCallLeadsSourceForAHuman`, `sentenceWhenAssignedSourcesDisagree`.

There is no `callLeadSourceMatch.test.ts` today. Enrichment tests lock the **caller**: prefer the compatible phone among two companies, `conflict` when the only hit is another assigned company, unassigned claim warns and lists `source_company` as a change. They do not lock the OR-ladder, the unassigned-vs-`lead_source_company` hole, or the silent sentence.

Add a focused test file. The whole module is pure. Prove the **interface**, not `sameRegistryCompany` alone.

**May this Call Lead take this CRM row’s source?**
- Empty / missing `source_company` → yes (any CRM row).
- `source_company: "not_provided"` → yes, even when `lead_source_company` is populated.
- Same `lead_source_company` (ObjectId vs hex string) → yes, even if granularity keys differ.
- Same `source_granularity_key`, different company id → yes.
- Same leftover `source_company` string only → yes.
- Assigned lead, all three miss → no.
- Leftover `Main_Site` vs `main_site` → no (no normalize).

**Name the sources / write the sentence**
- CRM row label prefers `crm_source_label_snapshot` over leftover company (`10best Inbounds`, not `tbm_leads`).
- Call Lead label prefers the document’s CRM snapshot, then granularity key before leftover company.
- Assigned miss + row has leftover company → the exact `Matched call lead has source …; CRM row source maps to …` sentence.
- Assigned miss + row has **no** leftover `source_company` → `undefined` (caller’s generic line).
- Unassigned lead + row has leftover company → `undefined` (not a conflict; claim is the caller’s next beat).

Do **not** add a test per helper (`sameRegistryCompany`, `sameGranularityKey`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Enrichment tests should keep proving: two-company phone pick prefers the fit; assigned miss is `conflict` and sync does not write; unassigned warns `Claiming unassigned call lead source as …`. Recon tests (when they exist) should keep proving phone-path source miss is `no_match`. Do not re-test `assignLeadSource` or the employee four-way score here.

## What I would not do

- A `CallLeadSourceMatchService` class with `isCompatible` / `buildConflict` / `label`.
- Thirty two-line functions that only wrap `===`.
- Moving this into a CRUD folder, or into `enrichment/` “because only enrichment imports it.”
- Pulling `selectSourceCompatibleCallLead` (or recon’s pick) into this file.
- Routing employee booking through this yes/no, or enrichment through `classifyLeadSourceCompatibility`.
- Adding `!lead_source_company` to unassigned, or trim/lowercase, so the two dialects “agree.”
- Requiring company **and** granularity so fit means `exact_granularity`.
- Emitting the conflict sentence when the row has no leftover `source_company`.
- Changing recon’s phone-path source miss from `no_match` to `conflict` while deleting the paste.
- Writing source / CPL / sheets from this file.
- Treating Granot identity, Duplicate Form Lead, or booking phone pick as this story.
