# Classify This Historical Lead Batch — Forms Stay Inside The April 30 Cohort And Exact Granularity, Calls Use The Earlier-Only Ninety-Day Window, Then Form Fill Is Company-Scoped And Time-Unbounded — Never Query Mongo, Never Zero CPL, Never Keep A Live Flag Unless The Planner Said So — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 1 of this service — `classification.ts`
- Remaining in this service: `planner.ts`, `manifest.ts`, `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/classification.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Decisions 4–8 and the Classification rule matrix: exact Source Granularity; 2026-04-30 Form cohort wall; preserve a matched modern live Form Lead `duplicate`; Call 90-day earlier-only window; Form Fill after Form judgment, time-unbounded, Source Company + phone). Already-recommended live sibling: [leads-duplicate-lead.md](leads-duplicate-lead.md) (`duplicateLead.service.ts` — Mongo Form Duplicate Lead + Form Fill write; same cutoff instant, no Call window, no `preserve_duplicate`). Call Lead Service: [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md) (Form Fill read at ingest; RingCentral 90-day is a different story). RingCentral sibling: already-recommended `ringcentral-duplicate-guard.ts` (live Mongo Call window; comment still says Source Company). Distinct from leftover `planner.ts` (builds candidates, **asks** this file, then stamps `duplicate` / `form_fill` / `cpl = 0` / `duplicate_zero` and plans insert or update — do not pull that in). Distinct from leftover `manifest.ts` (seals the plan). Distinct from leftover `apply.ts` / `verify.ts` / `rollback.ts` (mutate / prove / undo). Distinct from reporting `loadCanonicalLeadCohort` and Best Relocation `CanonicalLeadDoc` (those names collide with this file’s `CanonicalLead`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Duplicate Lead” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **one leftover planner, plus the folder test.** Leftover `planner.ts` imports `classifyHistoricalLeads`, `FORM_DUPLICATE_CUTOFF`, and `CanonicalLead` from this file (not the barrel). After identity is already collapsed, it maps each `LeadCandidate` through `toClassifierLead` (live id present → seed `duplicate` from the planned document; `preserve_duplicate` only when leftover form parse found a live match **and** the timestamp is on or after the cutoff), **asks** `classifyHistoricalLeads`, then writes `document.duplicate`, zeros CPL on a Duplicate Lead, stamps Call `form_fill`, and **asks** leftover `planLeadOperation`. The same cutoff ISO string is hashed into leftover `policy_hashes.form_duplicate_cutoff`. Barrel `historicalConsolidation/index.ts` re-exports `classifyHistoricalLeads`, `FORM_DUPLICATE_CUTOFF`, and `CALL_DUPLICATE_WINDOW_MS`. Folder test `classification.test.ts` **asks** `classifyHistoricalLeads` five times (cohort + granularity wall; keep a matched modern live flag; 90-day Call window and “a Duplicate Lead is not an anchor”; Form Fill across cutoff at company scope; fail closed without granularity). Scripts do **not** import this file. `CALL_DUPLICATE_WINDOW_MS` has **no caller outside this file**. Not this **interface**: leftover `findDuplicateFormLeadMatch` / `hasFormFillForCallLead` / `markMatchingCallLeadsWithFormFill`, leftover `classifyRingCentralCallLeadDuplicate`, leftover `planHistoricalConsolidation`.
- Seams callers need: in-memory batch vs live Mongo classifier; Form cohort wall vs Call rolling window; exact Source Granularity (Duplicate Lead) vs Source Company (Form Fill); keep-the-live-flag (`preserve_duplicate`) vs reclassify; fail closed (throw) vs “not a Duplicate Lead.” There is no begin / complete Domain Command **seam**. There is no Mongo **adapter**. There is no CPL **adapter**. There is no Sheet Sync **adapter**.
- Split later (only if the file outgrows one sitting): this ~50-line file is one sitting if you read it as classify this historical lead batch. If it later splits: `classifyTheseHistoricalFormLeadsInsideTheCutoffCohort.ts`, `classifyTheseHistoricalCallLeadsInsideTheNinetyDayWindow.ts`, `stampHistoricalFormFillAfterFormJudgment.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover planner, leftover live `duplicateLead.service.ts`, leftover RingCentral guard, and leftover CPL zeroing stay siblings / other services.

`classifyHistoricalLeads` is executor mechanics. The owner question is: *The merge already turned sheet rows into one lead each. Walk the batch in time order. A Form Lead is a Duplicate Lead only when an earlier non-duplicate Form Lead in the same exact Source Granularity and the same April 30 cohort shares the phone or the email — unless the planner said this modern row already has a live flag, in which case keep that flag. A Call Lead is a Duplicate Lead only when an earlier non-duplicate Call Lead in the same exact Source Granularity shares the phone inside ninety days. After every Form Lead has been judged, a Call Lead is Form Fill when any non-duplicate Form Lead at the same Source Company shares the phone, even across the cutoff. This file does not talk to Mongo. This file does not zero CPL. This file does not decide whether to insert or update.*

Who parses the sheet row, who keeps the live flag, who zeros CPL, and who writes the manifest already live in leftover **modules**. Do not pull those in.

## What this file actually does

Three “judge this already-identified batch” stories in one sitting, not “a duplicate helper,” and not Plan The Historical Merge / Classify A Live Quote / Guard A RingCentral Call:

1. **Classify historical Form Leads inside the April 30 cohort** — `classifyHistoricalLeads` Form arm. Sort the batch by `timestamp` then `id`. Refuse a blank `source_granularity_id`. Refuse a non-finite timestamp. Split the Form population at `FORM_DUPLICATE_CUTOFF` (`2026-04-30T04:00:00.000Z` = 2026-04-30 00:00 America/New_York). An earlier non-duplicate Form Lead in the **same** cohort and the **same** exact Source Granularity is an anchor when normalized phone matches or normalized email matches. Default: `duplicate = anchors.length > 0`, `duplicate_anchor_ids` lists those ids. A Duplicate Lead is never later used as an anchor. There is no rolling Form window. This beat does **not** query Mongo. This beat does **not** say `matchedBy: email | phone | both`.

2. **Keep a matched modern live Form Lead flag** — same Form arm, `preserve_duplicate`. When leftover planner set `preserve_duplicate` (live Form Lead exists **and** timestamp ≥ cutoff), `duplicate` is `Boolean(lead.duplicate)` and anchors are still collected but do not override the flag. When `preserve_duplicate` is absent or false, the cohort rule wins. This beat does **not** look up the live document. This beat does **not** apply to Call Leads in leftover planner (Call candidates never set the flag).

3. **Classify historical Call Leads in the earlier-only ninety-day window, then stamp Form Fill** — Call arm, then the return map. Call anchors: same exact Source Granularity, not already a Duplicate Lead, both sides have a phone, `0 ≤ this.timestamp − anchor.timestamp ≤ CALL_DUPLICATE_WINDOW_MS` (90 days inclusive). After every Form Lead has a `duplicate` flag, `form_fill` is true when any **non-duplicate** Form Lead with a phone shares `source_company_id` and `normalized_phone`. Form Fill has no cutoff and no granularity. Return the combined list sorted by time then id. This beat does **not** mark Form Leads. This beat does **not** write Call rows. This beat does **not** emit Sheet Sync jobs.

There is no fourth mutate operation. `order` is the sort beat operations 1–3 **ask**. Re-export through the barrel is convenience; leftover planner imports this file directly.

## Organization

Keep one file. This is the screenplay for “classify this historical lead batch.” Identity collapse, sheet parse, CPL zeroing, and insert-or-update already live on leftover `planner.ts`. Live Mongo Form Duplicate Lead and Form Fill writes already live on already-recommended `duplicateLead.service.ts`. Live RingCentral Call window already lives on already-recommended `ringcentral-duplicate-guard.ts`. Do not pull those in. Do not invent a `HistoricalClassificationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Mongo **adapter** that has only this in-memory walk. Do not invent a CRUD folder so “form classify and call classify each get a file named create/update.”

Do not merge this into already-recommended `duplicateLead.service.ts` so “one function owns live and historical.” Do not route this batch through `FormLead.find` so “the application-owned rule is imported.” Do not move leftover CPL zeroing here so “classification owns price.” Do not split `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `classifyHistoricalLeads` | `classifyThisHistoricalLeadBatch` | leftover planner must judge the collapsed batch in memory |
| `FORM_DUPLICATE_CUTOFF` | `theFormDuplicateCohortBoundary` | leftover planner hashes the ISO instant into the plan; the Form arm **asks** the same Date |
| `CALL_DUPLICATE_WINDOW_MS` | `theCallDuplicateNinetyDayWindow` | barrel re-export; no leftover caller **asks** it today |
| `CanonicalLead` | `ALeadInTheHistoricalBatch` | leftover `toClassifierLead` plants the row this file judges |
| `ClassifiedLead` | `AJudgedHistoricalLead` | leftover planner copies `duplicate` / `duplicate_anchor_ids` / `form_fill` onto the planned document |

Keep the old names as one-line aliases until leftover `planner.ts` and the folder test migrate. Do not make callers learn `Array#filter` / `Date#getTime` as the domain language. Do **not** rename persisted field names (`duplicate`, `form_fill`) — leftover planner writes those onto planned Form / Call documents. Do **not** rename the cutoff instant or the 90-day millisecond count — leftover `policy_hashes.form_duplicate_cutoff` and the Call window tests lock them.

**No workflow class.** The two types that *do* earn a name are the planted row and the judged row:

```ts
type ALeadInTheHistoricalBatch = {
  id: string
  kind: "form" | "call"
  timestamp: string
  source_company_id: string
  source_granularity_id: string
  normalized_phone?: string | null
  normalized_email?: string | null
  duplicate?: boolean
  preserve_duplicate?: boolean
}

type AJudgedHistoricalLead = ALeadInTheHistoricalBatch & {
  duplicate: boolean
  duplicate_anchor_ids: string[]
  form_fill?: boolean
}

type TheFormDuplicateCohortBoundary = Date // 2026-04-30T04:00:00.000Z
```

`CanonicalLead` is the lie next to reporting and Best Relocation. The planted row is “one already-identified historical event,” not a reporting cohort and not a Best Relocation adopt doc.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// classification.ts
// The merge already turned sheet rows into one lead each.
// Walk the batch: which Form Leads and Call Leads are Duplicate Leads,
// and which Call Leads already filled the form?

// ── 1. Form Duplicate Lead inside the April 30 cohort ─────

export function classifyThisHistoricalLeadBatch(leads)
export const theFormDuplicateCohortBoundary = new Date("2026-04-30T04:00:00.000Z")

function orderTheBatchByTimeThenId(leads)
function refuseWithoutExactGranularity(lead)
function refuseABrokenTimestamp(lead)
function thisFormLeadsCohort(when) // historical < cutoff; modern >= cutoff
function earlierNonDuplicateFormAnchorsInTheSameCohortAndGranularity(lead, judgedForms)
function keepTheMatchedModernLiveDuplicateFlag(lead) // preserve_duplicate

// ── 2. Call Duplicate Lead in the earlier-only 90-day window

export const theCallDuplicateNinetyDayWindow = 90 * 24 * 60 * 60 * 1000

function earlierNonDuplicateCallAnchorsInTheNinetyDayWindow(lead, judgedCalls)

// ── 3. Form Fill after every Form Lead has been judged ─────

function nonDuplicateFormsWithAPhone(judgedForms)
function thisCallAlreadyFilledTheForm(call, forms) // company + phone; no time bound
```

Read the primary path out loud: *Sort the batch by time then id. Refuse a lead with no exact Source Granularity or a broken timestamp. Walk Form Leads first: if this quote is before 30 April 2026 Eastern, only earlier pre-cutoff Form Leads at the same granularity with the same phone or email can make it a Duplicate Lead; if it is on or after the cutoff, only the modern cohort can. When the planner said keep the live modern flag, keep it. A Duplicate Lead is never an anchor for the next one. Then walk Call Leads: an earlier non-duplicate Call Lead at the same granularity with the same phone inside ninety days makes this one a Duplicate Lead. After every Form Lead has been judged, a Call Lead is Form Fill when any non-duplicate Form Lead at the same Source Company shares the phone — even across the cutoff.*

That is the operation. `order` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`CanonicalLead` is a collision.** Reporting `loadCanonicalLeadCohort` and Best Relocation `CanonicalLeadDoc` already use “canonical lead” for other rows. Rename the planted type so this batch cannot be mistaken for a reporting cohort or an adopt doc. Do not merge those types.

2. **Leftover planner never sends email.** `toClassifierLead` always plants `normalized_email: null`. The Form arm still matches email. Keep the email beat — the spec matrix says phone **or** email — but do not silently drop it because the current caller is phone-only. Point a test at an email-only pair.

3. **The cutoff Date is copied, not shared.** Already-recommended `duplicateLead.service.ts` owns a private `FORM_DUPLICATE_CUTOFF` at the same instant. Leftover planner hashes **this** export. Do not import the live constant here, and do not move this Date into config “for cleanliness.” Two copies that must stay equal is the drift. Name both so the twin is visible.

4. **`CALL_DUPLICATE_WINDOW_MS` is a barrel orphan.** Leftover planner does not import it. The Call arm closes over the same binding. Keep the export as an alias. Do not delete it so “no caller means dead code,” and do not make leftover planner import it so “the hash matches Forms.”

5. **`preserve_duplicate` is a Form-only leftover handshake.** The type accepts it on any planted row. Leftover Call parse never sets it. When true, anchors are still computed and ignored for the flag. Do not start preserving Call live `duplicate` here so “both kinds keep the live flag,” and do not drop unused anchor ids on a preserved row so “the list matches the flag.”

6. **Form Fill is a different scope on purpose.** Duplicate Lead is exact granularity + cohort or window. Form Fill is Source Company + phone with no cutoff. Spec Decision 7 and the folder test (“Form Fill is time-unbounded and Source Company scoped”) lock that. Do not raise Form Fill to granularity, and do not loosen Form Duplicate Lead to company.

7. **This file reimplements the live rules in memory.** The July spec said planning should import application-owned rule functions with an injected repository. Leftover planner **asks** this walk instead of `findDuplicateFormLeadMatch`. That is a known spec gap. Do not silently route this batch through Mongo so “the sentence becomes true.” Planning must stay write-free.

8. **Spec sort vs this sort.** The spec’s deterministic order includes live-before-imported, workbook, tab, row, checksum. This file sorts `timestamp` then `id`. Leftover planner is supposed to collapse live overlap **before** this walk. Do not add workbook keys here so “the spec list lives in the classifier.”

9. **No `matchedBy`.** Live classification returns email / phone / both. This file returns only `duplicate_anchor_ids`. Do not add `matchedBy` so “historical matches the owner event.” Leftover planner stores the ids on `canonical_entities`, not an owner event.

10. **Leave sibling modules and other duplicate stories alone.** Leftover `planLeadOperation` (CPL `duplicate_zero`, insert vs update, which live fields are authoritative), leftover `hasFormFillForCallLead` / `markMatchingCallLeadsWithFormFill`, and leftover `classifyRingCentralCallLeadDuplicate` are not this file. The RingCentral comment still says Source Company; this Call arm is exact granularity. Do not “fix” the guard from here.

11. **July spec § Authority is stale.** It still says live `duplicateLead.service.ts` and the RingCentral guard allow company matching. Current `findDuplicateFormLeadMatch` already throws without exact `source_granularity_id`. Do not loosen this walk so “we match the old sentence.”

## Testing

The **interface** is the test surface: `classifyThisHistoricalLeadBatch` (today `classifyHistoricalLeads`).

Today’s `classification.test.ts` already names five beats: Form cohort + exact granularity; keep a matched modern live flag; Call 90-day window and “a Duplicate Lead is not an anchor”; Form Fill across the cutoff at company scope; fail closed without granularity.

Keep those. Add only what the **interface** still hides:

**Classify historical Form Leads**
- Two matching pre-cutoff Form Leads in one Source Granularity → later is a Duplicate Lead; first is the only anchor.
- Matching Form Leads on opposite sides of `2026-04-30T04:00:00.000Z` → neither is a Duplicate Lead.
- Matching Form Leads in different Source Granularities → never duplicates.
- Email-only pair in the same cohort and granularity → later is a Duplicate Lead (even though leftover planner currently plants `null` email).
- Form Lead with neither phone nor email and `preserve_duplicate` false → not a Duplicate Lead.
- Invalid timestamp → throw. Missing granularity → throw (already locked).

**Keep the live modern flag**
- `preserve_duplicate: true` and planted `duplicate: true` → stays true even with no earlier anchor (already locked).
- `preserve_duplicate: true` and planted `duplicate: false` with an earlier modern anchor → stays false (the live flag wins).
- `preserve_duplicate` absent with an earlier modern anchor → Duplicate Lead from the cohort rule.

**Classify historical Call Leads**
- Same granularity + phone exactly 90 days later → Duplicate Lead; more than 90 days → not.
- A Duplicate Call Lead is not an anchor for a later Call Lead (already locked).
- Call Lead with no phone → not a Duplicate Lead and not Form Fill.

**Stamp Form Fill**
- Non-duplicate Form Lead at the same Source Company + phone, opposite side of the cutoff → `form_fill: true` (already locked).
- Form Lead that is itself a Duplicate Lead does not count.
- Same phone, different Source Company → not Form Fill.
- Form Fill does not require matching Source Granularity.

Do **not** add a test per helper (`thisFormLeadsCohort`, `earlierNonDuplicateCallAnchorsInTheNinetyDayWindow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`FORM_DUPLICATE_CUTOFF` and `CALL_DUPLICATE_WINDOW_MS` may stay exported as aliases. They are not a second test surface.

## What I would not do

- A `HistoricalClassificationService` class with `classify` / `isDuplicate` / `hasFormFill`.
- Thirty two-line functions that only wrap `Array#filter`.
- Moving this into a CRUD folder, or a `duplicates/` folder that also swallows live Form Duplicate Lead and RingCentral.
- Treating leftover `planHistoricalConsolidation`, leftover `findDuplicateFormLeadMatch`, or leftover `classifyRingCentralCallLeadDuplicate` as this story.
- Inventing a Mongo **seam** that has only this in-memory walk as an **adapter**.
- Silently routing this batch through `FormLead.find` so “planning imports the application-owned rule.”
- Moving leftover CPL zeroing, `bad_lead`, or insert-or-update into this file.
- Collapsing company-scope Form Fill and exact-granularity Duplicate Lead into one filter “for consistency.”
- Moving `FORM_DUPLICATE_CUTOFF` into config, or deleting the live private copy, so “one Date owns both stories.”
- Changing the cutoff instant, the 90-day inclusive window, or the fail-closed granularity throw.
- Opening `planner.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
