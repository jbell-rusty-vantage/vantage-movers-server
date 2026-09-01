# Say Whether This Already-Qualified Inbound Call Is A Business Duplicate Lead — Exact Source Granularity Plus The Same Caller Phone Plus A Different Earlier Non-Duplicate Call Lead Inside The Earlier-Only Ninety-Day Window; Never The Same Physical Call; Never The Adopted Lead; Never An Unresolved Granot Candidate; Never Source Company Alone; Never Evaluate; Never Create; Never Adopt — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 8 of this service — `ringcentral-duplicate-guard.ts`
- Remaining in this service: `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/ringcentral-duplicate-guard.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (Duplicate correctness: exact Source Granularity + normalized phone + a different non-duplicate Call Lead in the earlier-only 90-day window, `timestamp >= call time - 90 days` and `< call time`; Source Company alone is never the boundary; adoption excludes the adopted Lead ID and this physical call; unresolved `granot_lead_created` `pending`/`conflict` rows with no RingCentral identity cannot cause a false duplicate. Idempotency vs business duplicate table: leftover processed-call ledger is the same physical call; this file is a different prior call. Config note: leftover `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` is debug metadata only). Related: [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md) (RingCentral create receives `duplicate` already decided; `cpl = 0` / `duplicate_zero`; this file does **not** price). Distinct from already-recommended Form Lead / Form Fill: [recommendations/leads-duplicate-lead.md](leads-duplicate-lead.md) (`classifyDuplicateFormLead` / `detectFormFillForCallLead` — Form cohort + company-scope Form Fill; never the 90-day Call rule). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` **asks** this file only when leftover convergence did not adopt). Distinct from leftover convergence: `attemptRingCentralCallLeadConvergence` / `adoptRingCentralCall` (**asks** this file inside leftover adopt with `callLeadIdToExclude`). Distinct from leftover processed-call ledger: `findProcessedCall` / `upsertProcessedCall` (same physical call, not a business Duplicate Lead). Distinct from leftover evaluate / leftover Call Log vet / leftover shadow / leftover Call Lead write / leftover config names. Distinct from Wave B webhook HTTP. This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key / Duplicate Lead — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: leftover `ringcentral-call-lead-ingest.service.ts` (`deps.classifyDuplicate` after leftover adopt failed; no `callLeadIdToExclude`; `callTimestamp = startTime ?? answeredAt ?? now`); leftover `callLeadConvergence.service.ts` (`applyAdoption` **asks** this file with `callLeadIdToExclude: input.call_lead_id` and leftover `startTime`); this file’s `ringcentral-duplicate-guard.test.ts` (fourteen cases). Already-recommended evaluate / leftover Call Log vet / leftover processed-call store / leftover shadow / leftover Call Lead write / leftover Form Lead duplicate / leftover analytics / leftover seed — **do not import this file**.
- Seams callers need: public classify (leftover ingest and leftover convergence both **ask** the same export); leftover adopt exclude (`callLeadIdToExclude` plus this session / call-log identity) vs leftover create classify (identity only); injectable `findRecentCallLeads` (file-test **adapter** that skips Mongo); earlier-only 90-day window (`RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS`, not leftover `RINGCENTRAL_DUPLICATE_WINDOW_HOURS`)
- Split later (only if the file outgrows one sitting): this ~190-line file is one sitting if you read it as say whether this already-qualified inbound call is a business Duplicate Lead — exact Source Granularity plus the same caller phone plus a different earlier non-duplicate Call Lead inside the earlier-only ninety-day window; never the same physical call; never the adopted Lead; never an unresolved Granot candidate; never Source Company alone; never evaluate; never create; never adopt. If it later splits: `refuseWithoutExactSourceGranularity.ts` / `lookUpEarlierNonDuplicateCallLeads.ts` / `dropThisPhysicalCallAndUnresolvedGranotCandidates.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `classify.ts`, and never merge leftover ingest, leftover convergence candidates, leftover processed-call ledger, leftover Form Lead duplicate, leftover Form Fill, leftover evaluate, leftover Call Log vet, leftover Call Lead write, or leftover config hours into this file

`classifyRingCentralCallLeadDuplicate` / `RingCentralDuplicateDeps` / `findRecentCallLeads` are executor mechanics. The owner question is: *A webhook session or a Call Log record has already qualified. Is this a second call from the same caller at the same exact Source Granularity, or the first one we should pay for? Look only at earlier non-duplicate Call Leads in the ninety days before this call’s Florida timestamp. The same physical call is not a Duplicate Lead of itself. The Lead leftover convergence is about to adopt is not a Duplicate Lead of itself. An unresolved Granot-created pending or conflict row with no RingCentral identity is not a prior Lead. Source Company alone is never the boundary. Do not evaluate the two-minute rule. Do not create a Call Lead. Do not adopt. Do not write `duplicate` or zero CPL — leftover ingest and leftover convergence apply the flag after this file answers.*

Already-recommended promote, leftover convergence, leftover processed-call ledger, leftover evaluate, leftover Call Log vet, leftover Form Lead duplicate, leftover Form Fill, leftover Call Lead write, leftover config names, leftover shadow, leftover analytics, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “say whether this already-qualified inbound call is a business Duplicate Lead — exact Source Granularity plus the same caller phone plus a different earlier non-duplicate Call Lead inside the earlier-only ninety-day window; never the same physical call; never the adopted Lead; never an unresolved Granot candidate; never Source Company alone; never evaluate; never create; never adopt” story, not “a duplicate helper,” and not leftover Form Lead classify / leftover processed-call skip:

1. **Say whether this already-qualified inbound call is a business Duplicate Lead** — `classifyRingCentralCallLeadDuplicate(input, deps?)`. Refuse without `sourceGranularityId`. No normalized caller phone → `no_caller_phone`, `isDuplicate: false`, Mongo never **asked**. Else Florida `toFloridaTimestamp(callTimestamp ?? now)`, window `[call time - 90 days, call time)` (`$gte from`, `$lt to`). Default `findRecentCallLeads` queries `CallLead` by exact `source_granularity_id` + `normalized_phone_number` + `duplicate: { $ne: true }` + earlier-only timestamp + `_id $ne callLeadIdToExclude` + `$nor` unresolved Granot (`granot_lead_created` + `pending`/`conflict` + empty session / call-log identity). Then the in-memory sieve: re-normalize `phone_number`, drop this `_id`, drop unresolved Granot again, drop `telephony_session_id` / `session_id` / `call_log_id` when the caller passed them. Zero matches → `unique`. Else `same_source_phone_within_window`, `existingLeadId` is the newest match, `matchCount` is how many. This beat does **not** write `duplicate`. This beat does **not** price. This beat does **not** evaluate. This beat does **not** adopt. This beat does **not** create.

There is no evaluate operation. There is no promote operation. There is no Form Fill operation. There is no processed-call skip. Leftover `ingestRingCentralQualifiedCall` is the promotion **adapter** that **asks** this file after leftover adopt failed. Leftover `adoptRingCentralCall` is the adoption **adapter** that **asks** this file with `callLeadIdToExclude`. Already-recommended `classifyDuplicateFormLead` is the Form Lead **adapter**. Leftover `findProcessedCall` is the same-physical-call **adapter**.

`RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS` / `RingCentralDuplicateClassification` / `RingCentralDuplicateInput` / `RingCentralDuplicateDeps` sit on the classify path. They are not extra owner operations. Do not invent a dashboard for `matchCount` in this rename. Do not export `isUnresolvedGranotCandidate` as a public **seam**. Do not export `findRecentCallLeads` as a public **seam** — leftover ingest and leftover convergence **ask** `classifyRingCentralCallLeadDuplicate`, not the lookup.

## Organization

Keep one file as the screenplay for “say whether this already-qualified inbound call is a business Duplicate Lead — exact Source Granularity plus the same caller phone plus a different earlier non-duplicate Call Lead inside the earlier-only ninety-day window; never the same physical call; never the adopted Lead; never an unresolved Granot candidate; never Source Company alone; never evaluate; never create; never adopt.” Already-recommended promote, leftover convergence, leftover processed-call ledger, leftover evaluate, leftover Call Log vet, leftover Form Lead duplicate, leftover Form Fill, leftover Call Lead write, leftover config names, leftover shadow, leftover analytics, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralDuplicateGuardService` class. Do not invent a begin / complete **seam** — this file never writes Mongo. Do not invent a Form Lead **adapter** beside already-recommended `classifyDuplicateFormLead`. Do not invent a promote **adapter** beside leftover `ingestRingCentralQualifiedCall`. Do not invent an adoption **adapter** beside leftover `attemptRingCentralCallLeadConvergence`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `classify.ts`. Those are persistence verbs, not the owner story. Do not move this classify into leftover ingest so “one file owns promote and Duplicate Lead.” Do not move this classify into leftover convergence so “one file owns adopt and Duplicate Lead.” Do not silently classify after leftover adopt on leftover ingest so “the knowledge outline wins” — leftover ingest already recommended that leftover convergence classifies inside leftover adopt. Do not silently query by `source_company` so “the file comment becomes true.”

**External interface** stays small (this is the test surface). Refuse, look up, drop-self, and say unique-or-duplicate are one story’s classify, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `classifyRingCentralCallLeadDuplicate` | `sayWhetherThisAlreadyQualifiedInboundCallIsABusinessDuplicateLead` | leftover ingest **asks** after leftover adopt failed; leftover convergence **asks** inside leftover adopt |
| `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS` | `ninetyEarlierDays` | file tests lock the earlier-only window; leftover config hours are not this number |
| `RingCentralDuplicateClassification` | `WhetherThisCallIsABusinessDuplicateLead` | `{ isDuplicate, reason, existingLeadId, windowDays, matchCount }` |
| `RingCentralDuplicateInput` | `AlreadyQualifiedCallToClassify` | leftover ingest and leftover convergence already build this bag |
| `RingCentralDuplicateDeps` | `InjectableEarlierCallLeadLookupForFileTests` | file tests replace Mongo |

Keep the old names as one-line aliases until leftover ingest, leftover convergence, and the file test migrate. Do not make callers learn `findRecentCallLeads` / `$nor` / `toFloridaTimestamp` as the domain language.

**Principle: old exports stay as aliases.** `classifyRingCentralCallLeadDuplicate` remains the imported name until leftover ingest and leftover convergence migrate.

**No class for the workflow.** The type that *does* earn a name is the answer leftover ingest and leftover convergence already apply:

```ts
type WhetherThisCallIsABusinessDuplicateLead = {
  isDuplicate: boolean
  reason: "no_caller_phone" | "unique" | "same_source_phone_within_window"
  existingLeadId: string | null
  windowDays: 90
  matchCount: number
}

type AlreadyQualifiedCallToClassify = {
  sourceGranularityId: string
  callerPhoneNumber: string | null
  telephonySessionId?: string | null
  sessionId?: string | null
  callLogId?: string | null
  callLeadIdToExclude?: string | null  // leftover adopt only
  callTimestamp?: Date
}
```

That is the handoff from “this inbound call already qualified” to “leftover ingest / leftover convergence may stamp `duplicate` and zero CPL.” Do **not** add `writeMode` so “this file can replace leftover ingest,” do **not** add `rawWebhookBody` so “this file can replace leftover evaluate,” and do **not** add `formLeadId` so “this file can replace leftover Form Fill.”

Do not add `sourceCompany` as a required story field — leftover callers still pass the slug, the default lookup does not query it, knowledge says Source Company alone is never the boundary. Do not export `isUnresolvedGranotCandidate` as a public **seam** — it exists so the parent reads. Do not add `getRingCentralDuplicateWindowHours` as a public **seam** — leftover config already owns that debug number.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-duplicate-guard.ts
// A webhook session or a Call Log record has already qualified.
// Is this a second call from the same caller at this
// exact Source Granularity, or the first one we should pay for?
// Look only at earlier non-duplicate Call Leads
// in the ninety days before this call.
// The same physical call is not a Duplicate Lead of itself.
// The Lead leftover convergence is about to adopt
// is not a Duplicate Lead of itself.
// An unresolved Granot candidate is not a prior Lead.
// Do not evaluate. Do not create. Do not adopt.

// ── 1. Say whether this already-qualified inbound call is a business Duplicate Lead ──

export async function sayWhetherThisAlreadyQualifiedInboundCallIsABusinessDuplicateLead(
  call: AlreadyQualifiedCallToClassify,
  deps?: InjectableEarlierCallLeadLookupForFileTests,
)

function refuseWithoutExactSourceGranularity(call)
function noCallerPhoneMeansNotADuplicateLead()
function pickTheEarlierOnlyNinetyDayWindow(callTimestamp)
async function lookUpEarlierNonDuplicateCallLeadsAtThisExactGranularityAndPhone(call, window)
function dropThisPhysicalCallTheAdoptedLeadAndUnresolvedGranotCandidates(leads, call)
function sayUnique()
function saySameSourcePhoneWithinTheWindow(matches)
function thisLeadIsAnUnresolvedGranotCandidate(lead)  // private; pending/conflict + no identity
```

Read the primary path out loud: *Refuse without an exact Source Granularity. If the caller phone will not normalize, say no-caller-phone and do not query. Fold the call timestamp into Florida time. Look up earlier non-duplicate Call Leads at this exact Source Granularity and phone in `[call time - 90 days, call time)`. Drop this physical call, the adopted Lead, and unresolved Granot candidates. If none remain, say unique. If any remain, say same-source-phone-within-window and name the newest prior Lead. Do not evaluate the two-minute rule. Do not create a Call Lead. Do not adopt. Do not write `duplicate` or zero CPL. Do not scope by Source Company alone. Do not read `RINGCENTRAL_DUPLICATE_WINDOW_HOURS`.*

That is the operation. `classifyRingCentralCallLeadDuplicate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file comment still says “same source company.”** Classify throws without `sourceGranularityId`. Default lookup queries `source_granularity_id` and ignores `sourceCompany`. `leadSourceCompany` is unused. Knowledge says Source Company alone is never the boundary. The file test named “different source is scoped out by the duplicate lookup” captures the forwarded slug on the injectable **adapter**; it does **not** prove Mongo scopes by company. Do not silently add `source_company` to the query so “the comment wins.” Do not silently drop `sourceCompany` from the input type without a paired leftover-ingest / leftover-convergence test.

2. **Config hours are not this window.** Leftover `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` (default 24) is debug metadata. This file hardcodes `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90`. Knowledge already names that gap. Do not silently read `getRingCentralDuplicateWindowHours` so “config owns the window.”

3. **`call-lead.md` says “±90 days” in one idempotency row.** The same file also says “inclusive prior 90-day window.” This file is earlier-only (`$lt` call time). A later Lead is not a prior Lead. Do not silently widen `to` past call time so “plus-or-minus wins.”

4. **Three double sieves.** Mongo `$nor` unresolved Granot **and** in-memory `isUnresolvedGranotCandidate`. Mongo `_id $ne` **and** in-memory `_id` drop. Mongo `normalized_phone_number` **and** in-memory `phone_number` re-normalize. File tests inject unresolved Granot rows through the injectable **adapter**, so the in-memory drop is the proof those tests own. Do not silently delete the in-memory drop so “Mongo already filtered” without a paired default-query test.

5. **Already-duplicate Call Leads cannot be a match target.** `duplicate: { $ne: true }`. A third call still matches the first unique Lead. Do not silently include already-duplicate rows so “every prior call counts.”

6. **Leftover ingest does not classify on leftover adopt.** Knowledge step 3 lists classify after leftover convergence “for adoption, exclude the adopted Lead.” Leftover ingest returns on leftover adopt. Leftover convergence **asks** this file inside `applyAdoption`. Already parked in `CONTRADICTIONS.md` for leftover ingest. Do not silently **ask** this file from leftover ingest after leftover adopt so “the knowledge outline wins.”

7. **This file never writes `duplicate` or prices.** Leftover ingest passes `duplicate.isDuplicate` into leftover Call Lead begin. Leftover convergence stamps `duplicate` and **asks** `resolveLeadCplSnapshot({ duplicate: true })` on leftover adopt. Do not silently price here so “one file owns Duplicate Lead and CPL.”

8. **Leave sibling modules alone.** Leftover evaluate, leftover Call Log vet, leftover ingest, leftover convergence candidates, leftover processed-call ledger, leftover Form Lead classify, leftover Form Fill, leftover Call Lead write, leftover config names, leftover shadow, leftover analytics already live at the right **depth**. This file orchestrates Mongo lookup only.

## Testing

The **interface** is the test surface: `sayWhetherThisAlreadyQualifiedInboundCallIsABusinessDuplicateLead`.

Today’s `ringcentral-duplicate-guard.test.ts` names first call unique, second call duplicate, same telephony session unique, same call-log identity unique, no caller phone, phone-format match, earlier-only 90-day window, exactly 90 days duplicate, more than 90 days unique, forwarded source slug, adopted Lead id excluded, unresolved Granot not a match, adopted Granot from another physical call eligible, future Leads outside the window. That is the classify **seam**. Leftover ingest tests prove who **asks**. Leftover replica tests prove leftover default create after this file answers.

**Say whether this already-qualified inbound call is a business Duplicate Lead**
- Missing `sourceGranularityId` → throw.
- No normalized caller phone → `no_caller_phone`, Mongo never **asked**.
- First call / empty lookup → `unique`.
- Same exact Source Granularity + same normalized phone + a different earlier non-duplicate Call Lead inside `[call time - 90 days, call time)` → `same_source_phone_within_window`, `existingLeadId` is the newest match.
- Same `telephonySessionId` / `sessionId` / `callLogId` is unique (this physical call).
- `callLeadIdToExclude` drops the adopted Lead even when the injectable **adapter** returns it.
- Unresolved `granot_lead_created` `pending` / `conflict` with no RingCentral identity is not a match.
- An adopted Granot Lead from another physical call is a match.
- Exactly 90 days earlier is a Duplicate Lead (`$gte from`).
- More than 90 days earlier is unique.
- A Lead at or after this call is unique (`$lt to`).
- Default lookup queries `source_granularity_id`, not `source_company`. `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` is never **asked**.
- This beat never **asks** leftover evaluate / leftover Call Log vet / leftover ingest write / leftover Form Fill.

Do **not** add a test per helper (`thisLeadIsAnUnresolvedGranotCandidate`, `pickTheEarlierOnlyNinetyDayWindow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover evaluate, leftover Call Log vet, leftover ingest promote, leftover default create, leftover analytics, leftover Form Lead classify, leftover Form Fill, leftover processed-call skip, leftover subscribe, or Wave B `ingestSessionLead` as this file’s proof. Leftover ingest and leftover convergence stay on those **adapters** — they **ask** this interface; they do not own leftover refuse, leftover earlier-only window, or leftover unresolved-Granot drop.

## What I would not do

- A `RingCentralDuplicateGuardService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `CallLead.find`.
- Moving this into a CRUD folder (`create.ts` / `classify.ts` / `duplicate.ts`) “for cleanliness,” or a `duplicates/` folder that also swallows leftover Form Lead classify and leftover Form Fill.
- Breaking the leftover ingest / leftover adopt classify **seam**, the earlier-only window **seam**, or the unresolved-Granot drop **seam**.
- Treating leftover `ingestRingCentralQualifiedCall`, leftover `attemptRingCentralCallLeadConvergence`, leftover `findProcessedCall`, leftover `evaluateRingCentralCallCandidate`, leftover `vetRingCentralCallLogRecord`, or already-recommended `classifyDuplicateFormLead` as this story. Those are different **adapters**.
- Inventing a classify-then-create **seam** that has only one **adapter** (this file never writes a Lead).
- Silently adding `source_company` to the query, silently reading `RINGCENTRAL_DUPLICATE_WINDOW_HOURS`, silently widening the window to ±90 days, silently classifying after leftover adopt on leftover ingest, or silently pricing here, while recommending a rename.
- Jumping to leftover convergence while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
