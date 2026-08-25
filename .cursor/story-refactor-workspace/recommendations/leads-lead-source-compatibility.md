# Employee Booking Source Fit — operational story

- Status: recommended
- Service: `leads` (Wave A, visited after this pass)
- Pass: 12 of this service — `leadSourceCompatibility.ts`
- Remaining in this service: none (`index.ts` already skipped)
- Target: `src/services/leads/leadSourceCompatibility.ts`
- Knowledge: `docs/knowledge/services/employee-bookings.md` (auto-match needs source-compatible / exact granularity; Owner case warnings `source_conflict` / `source_unassigned` / `same_company_legacy` are overrideable). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define a source-fit term — do not invent a glossary copy.
- Callers: `employeeBookings/leadCandidateQueries.ts` (score every candidate, stamp warnings), `employeeBookings/bookingLeadReconciliation.service.ts` (`deriveLiveLeadWarnings` on attach / reassign / search). Enrichment and booked-call-lead reconciliation use `callLeadSourceMatch.ts` (or a paste of it), not this file.
- Seams callers need: the four-way score (same site / same company / still unassigned / disagree) vs the caller’s warning codes and auto-match rules. This file does not warn and does not attach.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

One operation, not “a compatibility helper” and not the employee matcher:

1. **Score how this Lead fits the booking’s source** — the employee booking is already prepared with a Source Company and Source Granularity. A Form or Call already showed up by LID, job, phone, email, or name. Fold both sides (trim, lowercase). Then answer with exactly one of four: the same site (`exact_granularity`), the same company but not that site (`same_company`), the Lead still has no assigned source (`unassigned`), or the assigned sources disagree (`conflict`).

`classifyLeadSourceCompatibility` is executor mechanics. The owner question is: *this employee booking already named a Source Company and Source Granularity. This Lead already matched on identity. How well does its source fit — same site, same company, still blank, or a different company?*

This file does **not** find candidates. It does **not** pick a winner (LID, job, phone+email+name). That pick is `evaluateEmployeeBookingMatch`. It does **not** write a source, claim an unassigned Lead, or require `source_resolution`. Those are employee attach / Owner case beats. `assignLeadSource` already stamped the booking. `thisCallLeadMayTakeThisCrmSource` (previous module) is a yes/no OR-ladder for Follow Up / booked-jobs, not this four-way.

## Organization

Keep one file. This is the screenplay for “how well does this Lead’s source fit the booking we just prepared.” Candidate load, auto-match rules, warning overrides, and claiming a source on attach already live in `employeeBookings`. Do not pull those in. Do not invent a `LeadSourceCompatibilityService` class.

Do not split this 94-line file. The four answers are one score, not four folders. Do not move it into `employeeBookings/` “because only those two files import it” — the dialect lives next to the other source-fit file so the next reader sees both. Do not merge it into `callLeadSourceMatch.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `classifyLeadSourceCompatibility` | `scoreHowThisLeadFitsTheBookingSource` | candidate list + live attach warnings; auto-match reads the four answers differently |
| `SourceCompatibility` | `EmployeeBookingSourceFit` | `exact_granularity` \| `same_company` \| `unassigned` \| `conflict` — callers persist the raw string |

Keep the old names as one-line aliases until the two employee-booking callers migrate. Do not make callers learn `classify` / `Compatibility` as the domain language.

Export the booking bag. Today `SourceExpectation` is file-private. Both callers already build the same three fields from `prepared.sourceAssignment`. Name it so the **seam** is visible:

```ts
type BookingSourceWeAlreadyAssigned = {
  source_company?: string | null
  lead_source_company?: string | null
  source_granularity_key?: string | null
}

type LeadSourceWeCanScore = {
  source_company?: unknown
  lead_source_company?: unknown
  source_granularity_key?: unknown
}
```

Do not replace those with enrichment’s `CallLeadSourceParsedRow`. Do not add channel, snapshots, or `source_label` — this score never reads them.

**No class for the workflow.** The type that *does* earn a name is the four-way answer the matcher already switches on. A `*Service` with `classify()` would be a folder with one function.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadSourceCompatibility.ts
// The employee booking already has a Source Company and Source Granularity.
// A Form or Call already showed up by LID, job, phone, email, or name.
// This file does not find that Lead.
// It scores how well the Lead’s source fits the booking:
// same site, same company, still unassigned, or a different company.

// ── 1. Score how this Lead fits the booking’s source ──────

export function scoreHowThisLeadFitsTheBookingSource(lead, expected)

function foldTheSourceToken(value)            // string: trim + lowercase; empty → missing
function foldTheRegistryCompanyId(value)      // string or ObjectId.toString(); same fold

function thisLeadIsTheSameSite(lead, expected)
  // both Registry company ids present and equal
  // AND both granularity keys present and equal

function thisLeadIsTheSameCompanyById(lead, expected)
  // both Registry company ids present and equal
  // (granularity missing or different — still same company)

function thisLeadMatchesTheLeftoverCompanyString(lead, expected)
  // both leftover source_company strings present and equal after fold
  // + matching granularity keys → same site
  // else → same company

function thisLeadHasNoAssignedSource(lead)
  // leftover empty / "not_provided" AND no lead_source_company

function theseSourcesDisagree()               // everything else
```

Read the score out loud: *Fold both sides. If the Registry company ids match and the granularity keys match, this is the same site. If only the company ids match, this is the same company. If we have no ids to compare, the leftover company strings may still agree — and if the granularity keys agree too, call that the same site. If the Lead has no leftover company (or `not_provided`) and no Registry company id, it is still unassigned. Anything else disagrees.*

That is the operation. `classifyLeadSourceCompatibility` is not.

The caller then names the warning: same site is silent; same company is `same_company_legacy`; unassigned is `source_unassigned`; disagree is `source_conflict`. Auto-match links same-site, or same-company **only when the Lead snapshot has no granularity key**. LID/job hits that are unassigned or same-company-with-a-key become pending `source_conflict`. Keep that mapping in `employeeBookings`. Do not return warning codes from this file.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two compatibility dialects.** This file is a four-way score and folds tokens. `callLeadSourceMatch.ts` is a yes/no OR-ladder and compares with exact `===` / `String()`. Employee booking scores here. Enrichment imports the other; booked-call-lead reconciliation pastes it. Do not route enrichment through this score. Do not replace this score with the yes/no. Do not “agree” the two files.

2. **Unassigned is stricter here.** `thisLeadHasNoAssignedSource` requires leftover empty/`not_provided` **and** no `lead_source_company`. A document with `source_company: "not_provided"` and a populated `lead_source_company` is `conflict` **here**. The other file would call that unassigned and let Follow Up claim it. Do not drop the Registry-id check so the two “unassigned”s match.

3. **Leftover strings can become “same site” without Registry ids.** When both leftover `source_company` values fold equal and both granularity keys fold equal, the answer is `exact_granularity` even if `lead_source_company` is missing on one or both sides. That is today’s ladder. Do not require ids for same-site during the rename. Do not silently stop promoting leftover+granularity to same-site.

4. **Same company id with a different granularity is `same_company`, not conflict.** The first id+key gate already took same-site. The second id gate returns `same_company` when keys differ. Auto-match then refuses if the snapshot still has a granularity key (`isSourceCompatibleForAutoAttach`). Do not return `conflict` here so “different site means disagree.” The Owner warning is `same_company_legacy`, and they may override it.

5. **This file folds; the other file does not.** `Top10` vs `top10`, `  top10-forms  ` vs `top10-forms`, and mixed-case ObjectId hex all match here. They miss on the Follow Up yes/no. Do not remove trim/lowercase so the dialects “agree.” Do not add fold to `callLeadSourceMatch.ts` in this pass.

6. **Expected-only company does not fail closed.** If the Lead is blank and the booking is fully assigned, the answer is `unassigned`, not `conflict`. The matcher treats LID/job unassigned as pending `source_conflict`. Keep that in the matcher. Do not change blank-Lead + assigned-booking to `conflict` so the names line up.

7. **`same_company` via leftover does not look at Registry ids.** If ids are missing or unequal, leftover strings can still score `same_company` (or same-site when keys match). Do not require a Registry id on both sides before accepting leftover.

8. **The file does not warn.** `leadCandidateQueries` and `deriveLiveLeadWarnings` map the four answers onto `source_conflict` / `source_unassigned` / `same_company_legacy`. `exact_granularity` is silent. Do not return those warning strings from this file. Do not add `channel_conflict` — channel is the caller (form booking vs Call Lead).

9. **The file does not attach.** Owner attach of a `source_conflict` needs `source_resolution` and exact warning overrides. Claiming an unassigned source, repricing CPL, and Sheet Sync are `bookingLeadAttachment`. Keep writes there.

10. **Owner TODOs at the top are not this story.** “Break types into folders,” “replace unknowns,” “dedicated utils module” would scatter a 94-line screenplay. Leave the comments. Do not create `types/` or `utils/normalizeString.ts` while renaming.

11. **Leave sibling modules alone.** `assignLeadSource` already stamped the booking. Phone / LID / job load, Duplicate / Form Fill, Granot identity, and the Follow Up yes/no stay where they are. `leads/index.ts` does not export this file; do not add it to the barrel “for completeness.”

12. **Do not finish `bookings` from here.** This is the last `leads` module. The next run enumerates `src/services/bookings/`. Do not write a bookings recommendation in this pass.

## Testing

The **interface** is the test surface: `scoreHowThisLeadFitsTheBookingSource`.

Today’s `leadSourceCompatibility.test.ts` only locks “a different leftover company is `conflict`” and “blank / `not_provided` is `unassigned`.” That misses the same-site ladder, the leftover promotion, the stricter unassigned, and the fold.

Keep those two cases. Add the rest at the **interface**, not `foldTheSourceToken` alone.

**Score how this Lead fits the booking’s source**
- Same Registry company id + same granularity key → `exact_granularity` (ObjectId vs hex; mixed case).
- Same Registry company id, different granularity key → `same_company` (not `conflict`).
- Same leftover company string + same granularity key, no Registry ids → `exact_granularity`.
- Same leftover company string, missing or different granularity → `same_company`.
- Leftover `Top10` vs `top10` → they match here (fold).
- Blank Lead, or leftover `not_provided` with no `lead_source_company` → `unassigned`, even when the booking is fully assigned.
- Leftover `not_provided` **with** a populated `lead_source_company` → `conflict` (stricter than Follow Up).
- Assigned leftover that does not fold-equal the booking, and ids miss → `conflict`.
- Empty / whitespace leftover folds to missing (same as blank).

Do **not** add a test per helper (`thisLeadIsTheSameSite`, `foldTheRegistryCompanyId`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Employee-booking tests should keep proving: LID/job at `conflict` or unassigned is pending `source_conflict`; `same_company` with a granularity key does not auto-link; `exact_granularity` may auto-link; Owner attach of `source_conflict` needs `source_resolution`. Do not re-test `assignLeadSource` or the Follow Up yes/no here.

## What I would not do

- A `LeadSourceCompatibilityService` class with `classify` / `isCompatible`.
- Thirty two-line functions that only wrap `===`.
- Moving this into a CRUD folder, a `types/` folder, or into `employeeBookings/` “because only those callers import it.”
- Merging this four-way score with `callLeadSourceMatch.ts`, or routing Follow Up / recon through it.
- Dropping the `lead_source_company` check on unassigned, or removing trim/lowercase, so the two dialects “agree.”
- Returning `conflict` when company ids match and granularity keys differ.
- Returning warning codes (`source_conflict`, `same_company_legacy`) from this file.
- Writing source / CPL / sheets, or requiring `source_resolution`, from this file.
- Treating Follow Up claim, Duplicate Form Lead, or Granot identity as this story.
- Opening `bookings` in the same pass.
