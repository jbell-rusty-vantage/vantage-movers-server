# When A Best Relocation Sheet Row We Already Applied Changes, Patch Only Source-Owned Contact And Move Fields Mongo Still Matches — Protected Money, Attribution, And A Vantage Edit Since Last Apply Conflict And Empty The Patch — Never Write A Lead, Never Walk The Plan, Never Hash, Never Adopt — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 11 of this service — `updatePolicy.ts`
- Remaining in this service: `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/updatePolicy.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Recurring preview / manual / schedule planning applies receipt skip then adopt-before-create. Receipt skip **asks** this file when a Form / Call create already has a successful receipt and the sheet hash changed. Bootstrap **asks** this file only as an equality gate (`unchanged` or not) and **never** emits `update_source_owned_lead`. Adopt is receipt-only: no field upsert. Domain mutations go through `canonicalDomainCommands` with origin `external_sheet_ingestion` — later `applyPlan.ts` **asks** `updateSourceOwnedLead` with this file’s patch; this file never walks. Knowledge does not name this file or the three-way tables — do not add a second Ingestion Service so “the allowlist owns inspect.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (`normalizeZip` is a sibling fold; this file copies a last-five pad locally). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (types list `update_source_owned_lead` / `safe_update`; this file is the decide). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md) (hashes `source_owned_values`; this file **compares** last receipt vs sheet vs Mongo). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md) (**asks** this file; remaps `safe_update` → `update_source_owned_lead`). Distinct from already-recommended recurring adopt: [`best-relocation-sheet-ingest-canonical-lead-adoption.md`](best-relocation-sheet-ingest-canonical-lead-adoption.md) (does **not** **ask** this file; adopt drops the body and never patches). Distinct from already-recommended first-run adopt: [`best-relocation-sheet-ingest-bootstrap.md`](best-relocation-sheet-ingest-bootstrap.md) (**asks** this file; accepts only `unchanged`; does not patch). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (never imports this file). Distinct from already-recommended walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (`update_source_owned_lead` **asks** the Domain Command; this file never walks). Distinct from later HTTP apply: `apply.ts`. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes HTTP `apply.ts` as the live path and never names this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `sourceChangePolicy.ts` **asks** `evaluateSourceOwnedLeadUpdate` (`originated_from_best_relocation: true`, `last_applied` from the last successful receipt, `current_source` `source_owned_values ?? command_payload`, `current_canonical` the live Form / Call). `bootstrap.ts` **asks** `sourceOwnedPaths` (Mongo `.select` + bag the sheet keys that exist) and `evaluateSourceOwnedLeadUpdate` (`last_applied` and `current_canonical` both the Mongo document; only `classification === "unchanged"` stays). `ingestion/ingestion.test.ts` **asks** `evaluateSourceOwnedLeadUpdate` for three Form cases (deposit is protected, name diverged in Vantage, name still matches last apply). Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. CLI `scripts/best-relocation-sheet-ingest.ts` does **not** import this file (it **asks** receipt skip, which **asks** this file). Barrel `index.ts` `export *`. `adapter.ts` does not import this file. `apply.ts` / `applyPlan.ts` / `canonicalLeadAdoption.ts` / `identity.ts` / `worker.ts` do not import this file. Wave B `src/routes/ingestion.routes.ts` does not import this file. Domain Command `updateSourceOwnedLead` does **not** import this file — it re-parses the patch through Form / Call update Zod and `requireBestRelocationImportSource`.
- Seams callers need: this-file / receipt skip (three-way decide); this-file / first-run adopt (equality gate, not a patch); this-file / later apply (command walks the patch; this file never walks); this-file / identity hash (hash vs compare; do not unify); this-file / Domain Command (execute vs decide; do not unify). There is no sheet-write **seam**. There is no receipt-write **seam**. There is no Domain Command **seam** on this file. There is no adopt **seam**. There is no Booking / Cancellation **seam**.
- Split later (only if the file outgrows one sitting): this ~169-line file is one sitting if you read it as when a Best Relocation sheet row we already applied changes, patch only source-owned contact and move fields Mongo still matches. Do **not** split into `form.ts` / `call.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `sourceChangePolicy.ts`, `bootstrap.ts`, `applyPlan.ts`, `identity.ts`, or `domainCommands/leads.ts` here. If it later splits: `nameTheFormAndCallFieldsBestRelocationStillOwns.ts` / `compareLastReceiptTodaysSheetAndMongo.ts` only as later story files, never CRUD.

`evaluateSourceOwnedLeadUpdate` / `sourceOwnedPaths` are executor mechanics. The owner question is: *We already applied this Best Relocation Form Lead or Call Lead. The sheet changed. Last successful receipt vs today’s sheet vs Mongo. Only Best Relocation–owned contact and move fields that Mongo still matches last apply may enter the patch. Binder, deposit, refund, merchant, agent, Job, source, quoted, booked, cancelled, CPL, or a Lead that did not come from Best Relocation is a conflict. A Vantage edit since last apply is a conflict. One conflict empties the whole patch. Values that still match stay off the patch. This file does not write a Lead. This file does not walk a plan. This file does not hash. This file does not adopt.*

Receipt skip, first-run adopt, identity hash, Domain Command patch, and the apply walk already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “when a Best Relocation sheet row we already applied changes, patch only source-owned contact and move fields Mongo still matches” story, not “an update CRUD helper,” and not receipt skip / bootstrap / apply.

1. **Name the Form fields vs the Call fields Best Relocation still owns** — private `FORM_SOURCE_OWNED_PATHS` / `CALL_SOURCE_OWNED_PATHS`. Form: `name`, `phone_number`, `email`, `pickup_city`, `pickup_zip`, `delivery_city`, `destination_zip`, `move_date`, `move_size`, `local`. Call: `name`, `phone_number`, `email`, `pickup_city`, `pickup_zip`, `delivery_city`, `delivery_zip`, `local`. Call has no `move_date` / `move_size`. Form zip is `destination_zip`; Call zip is `delivery_zip`. Belt `FINANCIAL_OR_PROTECTED` (`binder` / `deposit` / `refund` / `amount` / `merchant` / `agent` / `job_no` / `source_company` / `quoted` / `booked` / `cancelled` / `cpl` / `receiver_agent`) still conflicts even if someone later adds that path to an allowlist. This function does not name Booking or Cancellation fields.

2. **Compare last receipt, today’s sheet, and Mongo for each changed path** — `evaluateSourceOwnedLeadUpdate` walks `Object.entries(current_source)` only (a key missing from today’s bag is not a change). `equal(path, last_applied, current_source)` after `normalize` → skip. Else: `originated_from_best_relocation` is false, or the path is not on that model’s allowlist, or the financial regex hits → `changed_protected_field`. Else `!equal(path, current_canonical, last_applied)` → `canonical_divergence` (Mongo moved since last apply). Else the path enters `patch` via `normalizeForWrite`. This function does not write a Lead.

3. **Collapse to unchanged, a safe patch, or an all-or-nothing conflict** — any conflict → `{ classification: "conflict", patch: {}, conflicts }`. No patch keys → `unchanged`. Else `safe_update` with the written patch. A name change plus a deposit change is a conflict and the name is not patched. This function does not emit a plan action. This function does not choose `update_source_owned_lead` vs `adopt_existing`.

4. **List the source-owned paths for callers that select or bag them** — `sourceOwnedPaths`. Sorted frozen copy of the Form or Call set. Bootstrap **asks** it for Mongo `.select` and to keep only sheet keys that exist before the equality gate. Receipt skip does **not** **ask** it (it sends the whole bag). This function does not hash.

Shared beats, not owner operations: `equal` / `normalize` / `normalizeForWrite`. Compare folds `name` / `*_city` to lowercase and collapsed space, `email` lowercase, `phone_number` last-10 digits, `*_zip` pad-5, `move_date` to `YYYY-MM-DD` (Date objects only here). Write keeps name / city casing, still folds email / phone / zip / move_date, does not accept Date objects. Neither **asks** `normalizeLeadName` or `normalizePhoneNumberForMatch`.

## Organization

Keep one file as the screenplay for “when a Best Relocation sheet row we already applied changes, patch only source-owned contact and move fields Mongo still matches — protected money, attribution, and a Vantage edit since last apply conflict and empty the patch — never write a Lead, never walk the plan, never hash, never adopt.” Receipt skip, first-run adopt, identity hash, Domain Command patch, and the apply walk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationUpdatePolicyService` class. Do not invent a begin / complete **seam** here — three-way decide is not a Domain Command. Do not invent a second hash **adapter** beside `identity.sourceOwnedContentHash`. Do not invent a second phone **adapter** beside `normalizePhoneNumberForMatch`. Do not invent a receipt-write **adapter** here. Do not invent a second three-way **adapter** that receipt skip or bootstrap would copy.

**External interface** stays small (this is the test surface). Faces `sourceChangePolicy.ts` / `bootstrap.ts` / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateSourceOwnedLeadUpdate` | `decideWhetherTodaysSheetMayPatchThisBestRelocationLead` | receipt skip three-way; bootstrap equality gate |
| `sourceOwnedPaths` | `listTheSourceOwnedFieldsBestRelocationStillOwns` | bootstrap select / bag |
| `ThreeWayUpdateDecision` | keep | unchanged / safe_update / conflict card |

Keep the old names as one-line aliases until receipt skip, bootstrap, the barrel, and `ingestion.test.ts` migrate. Do not export `normalize` / `normalizeForWrite` / `FORM_SOURCE_OWNED_PATHS` as a new public story. Do not make callers learn `InTransaction` or CRUD verbs. Do not make apply or the Domain Command import this file.

**No class for the workflow.** The one type that earns a name is the three cards this file is allowed to return:

```ts
type ThreeWayUpdateDecision =
  | { classification: "unchanged"; patch: Record<string, never>; conflicts: [] }
  | { classification: "safe_update"; patch: Record<string, unknown>; conflicts: [] }
  | {
      classification: "conflict"
      patch: Record<string, never>
      conflicts: Array<{
        path: string
        type: "changed_protected_field" | "canonical_divergence"
        previous_source_value: unknown
        current_source_value: unknown
        canonical_value: unknown
      }>
    }
```

That is the handoff from “last receipt, today’s sheet, and Mongo disagree” to “skip, patch these paths, or refuse the whole row.” Do not put `plan_checksum` on that type so “the allowlist owns approve.” Do not put `action_key` on that type so “the allowlist owns receipt skip.” Do not put Booking money on that type so “the allowlist owns first-run Job match.”

`BestRelocationApplicationPlan` / `BestRelocationPlanAction` stay on sibling `applicationPlan.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// updatePolicy.ts
// We already applied this Best Relocation Form Lead or Call Lead.
// The sheet changed.
// Last successful receipt vs today’s sheet vs Mongo.
// Only Best Relocation–owned contact and move fields that Mongo
// still matches last apply may enter the patch.
// Binder, deposit, Job, source, or a Lead that did not come from
// Best Relocation is a conflict.
// A Vantage edit since last apply is a conflict.
// One conflict empties the whole patch.
// This file does not write a Lead.
// This file does not walk a plan.
// This file does not hash.
// This file does not adopt.

// ── 1. Name the fields Best Relocation still owns ─────────

const FORM_FIELDS_BEST_RELOCATION_STILL_OWNS = /* name, phone, email, cities, zips, move_date, move_size, local */
const CALL_FIELDS_BEST_RELOCATION_STILL_OWNS = /* name, phone, email, cities, delivery_zip, local — no move_date / move_size */
const MONEY_ATTRIBUTION_AND_LIFECYCLE_STAY_PROTECTED = /* binder / deposit / refund / amount / merchant / agent / job / source / quoted / booked / cancelled / cpl / receiver_agent */

export function listTheSourceOwnedFieldsBestRelocationStillOwns(leadModel)

// ── 2–3. Compare last receipt, today’s sheet, and Mongo ───

export function decideWhetherTodaysSheetMayPatchThisBestRelocationLead(input: {
  lead_model: "FormLead" | "CallLead"
  originated_from_best_relocation: boolean
  last_applied: Record<string, unknown>
  current_source: Record<string, unknown>
  current_canonical: Record<string, unknown>
}): ThreeWayUpdateDecision

function thisPathStillMatchesLastApply(path, lastApplied, todaysSheet)
function thisPathIsProtectedOrNotOurs(path, originatedFromBestRelocation, leadModel)
function vantageEditedThisPathSinceLastApply(path, mongo, lastApplied)
function foldForCompare(path, value)   // lowercase name/city; last-10 phone; pad zip; ISO date
function foldForWrite(path, value)     // keep name/city case; still fold email/phone/zip/date
```

Read the primary path out loud: *We already applied this Best Relocation Form Lead or Call Lead. The sheet changed. For each value on today’s bag that no longer matches last apply: if the Lead did not come from Best Relocation, or the path is money, Job, source, quoted, booked, cancelled, or not on that model’s allowlist, refuse it as a protected-field conflict. If Mongo no longer matches last apply, refuse it as a Vantage edit. If Mongo still matches last apply and the path is a Form or Call contact or move field Best Relocation still owns, put the folded write value on the patch. One conflict empties the patch. Nothing left to write is unchanged. Do not write a Lead. Do not walk the plan. Do not hash. Do not adopt.*

That is the operation. `evaluateSourceOwnedLeadUpdate` is not.

## Precise logic I would tighten while renaming

1. **Two callers, two uses.** Receipt skip treats `safe_update` as `update_source_owned_lead` and `conflict` as a blocking row. Bootstrap treats anything except `unchanged` as “not a match” (`last_applied` === `current_canonical`, so `canonical_divergence` never fires). Do not start emitting `update_source_owned_lead` from bootstrap so “first run can also patch.” Do not start **asking** this file from recurring adopt so “one three-way owns mint.”

2. **`originated_from_best_relocation` is always `true`.** Both runtime callers hardcode it. The false branch (every changed path is `changed_protected_field`) has no caller and no test. Name the unused door. Do not delete the flag so “one origin owns every Lead” without proving a non-BR Lead can never reach this file.

3. **All-or-nothing patch.** A safe name plus a protected `deposit_amount` is a conflict and the name is dropped. Receipt skip then opens one row conflict. Do not start returning a partial patch so “safe fields still write.”

4. **Only today’s keys are seen.** `Object.entries(current_source)` — a path on last apply or Mongo that the new bag omits is not a change. Bootstrap already bags only `sourceOwnedPaths` the sheet has. Receipt skip sends `source_owned_values ?? command_payload`. Do not start walking the allowlist so “a missing name is a clear.”

5. **Two folds.** Compare lowercases name / city; write keeps that casing. Phone here is always last-10 digits. `normalizePhoneNumberForMatch` refuses `<8`, strips a leading `1`, and may keep international. Do not start **asking** `leadName` / `phone` helpers here so “one fold owns ingest and three-way.” Do not silently write the lowercase compare value.

6. **Form `destination_zip` vs Call `delivery_zip`.** A Form bag that still says `delivery_zip` is a protected field. Do not silently alias the two so “one zip owns both models.”

7. **Financial regex is belt-and-suspenders.** No current allowlist path matches it. `deposit_amount` conflicts because it is not allowlisted **and** because `amount` hits the regex. Do not drop the regex so “the set is enough” without a test that a future allowlist add of `deposit_amount` still conflicts.

8. **This file does not own Bookings or Cancellations.** Receipt skip already refuses those remaining commands as `changed_protected_field`. Bootstrap Job / refund equality is local to `bootstrap.ts`. Do not start comparing binder here so “one allowlist owns first-run money.”

9. **Decide vs execute.** `applyPlan` **asks** `updateSourceOwnedLead`, which re-parses the patch through Form / Call update Zod and `requireBestRelocationImportSource`. This file never sees the command. Do not start importing this file from `existingWrites.ts` so “one allowlist owns apply.” Do not start writing the Lead here.

10. **Hash vs compare.** `identity.sourceOwnedContentHash` checksums the bag. This file compares three snapshots. Receipt skip **asks** hash first, then this file. Do not start hashing here so “one checksum owns three-way.”

11. **Tests name three Form cases and stop.** No Call allowlist, no `unchanged`, no `originated_from_best_relocation: false`, no zip / phone / email / date fold, no missing-key silence, no `sourceOwnedPaths` sort. Folder tests never import this file. Name the gap. Do not treat the deposit + name trio as the whole story.

12. **Leave sibling modules alone.** `sourceChangePolicy.ts` receipt skip, `bootstrap.ts` equality gate, `identity.ts` hash, `applyPlan.ts` command walk, `canonicalLeadAdoption.ts` mint-or-adopt, `leads/leadName.service.ts`, `normalizePhoneNumberForMatch` are already the right **depth**.

13. **Do not silently fix `HANDOFF.md`.** It still describes HTTP `apply.ts` as the live path and never names this file. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `decideWhetherTodaysSheetMayPatchThisBestRelocationLead`, `listTheSourceOwnedFieldsBestRelocationStillOwns`.

Today’s `ingestion.test.ts` already names “three-way update permits only unchanged canonical source-owned fields” with three Form cases: `deposit_amount` → `changed_protected_field`; name edited in Vantage → `conflict`; name still `Jane Doe` on Mongo → `safe_update` `{ name: "Jane Smith" }`. Folder `bestRelocationSheetIngest.test.ts` never imports this file. That is close on the happy Form name, and it does not name Call / unchanged / origin / fold / all-or-nothing operations.

Replace the three-assert style with tests that name the operation:

**Name the fields Best Relocation still owns**
- Form list is the ten contact / move paths, sorted, including `destination_zip` / `move_date` / `move_size`.
- Call list is the eight paths, including `delivery_zip`, excluding `move_date` / `move_size` / `destination_zip`.
- Returned array is frozen.

**Patch only when Mongo still matches last apply**
- Form name last apply `Jane Doe`, sheet `Jane Smith`, Mongo `Jane Doe` → `safe_update` `{ name: "Jane Smith" }`.
- Same name, Mongo `Edited in Vantage` → `canonical_divergence`, empty patch.
- Sheet still `Jane Doe` → `unchanged`, empty patch.
- Call `delivery_zip` `33101` → `33401` with Mongo still `33101` → `safe_update`.
- Call `move_date` on the bag → `changed_protected_field` (not on the Call set).

**Refuse protected money, attribution, and non-BR origin**
- `deposit_amount` / `binder` / `job_no` / `source_company` / `quoted` → `changed_protected_field` even when Mongo matches.
- `originated_from_best_relocation: false` plus an allowlisted name change → `changed_protected_field`.
- Form bag `delivery_zip` (Call name) → `changed_protected_field`.

**One conflict empties the patch**
- Name would be safe and `deposit_amount` changed → `conflict`, empty patch, both conflicts listed, name not written.

**Only today’s keys are seen**
- Last apply has `name` + `email`; today’s bag omits `email` and changes `name` → only `name` is decided; omitted `email` is not a conflict.

**Folds**
- `" Jane   DOE "` vs `"jane doe"` on Mongo / last apply → `unchanged` (compare lowercases).
- Safe name write keeps `"Jane Smith"` casing, not `"jane smith"`.
- Phone `(305) 555-1212` equals `3055551212`. Email case folds. Zip `"3311"` writes `"03311"`. `move_date` Date and `"2026-05-01"` compare as the same day.

**Callers still ask; this file still does not walk**
- Receipt skip still remaps `safe_update` → `update_source_owned_lead` and does not import a second allowlist.
- Bootstrap still accepts only `unchanged` and still does not emit a patch.
- Recurring adopt / `apply.ts` / `applyPlan.ts` / CLI still do not import this file.
- Domain Command still does not import this file.

Do **not** add a helper-unit test that has to change when `foldForCompare` is inlined. Do not add a test per regex token if the parent already proves `deposit_amount` and `job_no`.

Caller to keep green: receipt skip still **asks** this file with `originated_from_best_relocation: true`; bootstrap still **asks** `sourceOwnedPaths` + equality-only; later `applyPlan.ts` still **asks** `updateSourceOwnedLead` and still does not import this file; Granot-minted `ingestion_origin` is still not rewritten here.

## What I would not do

- A `BestRelocationUpdatePolicyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Set.has`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `form.ts` / `call.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on a later apply, or pair-then-threshold, or inspect 409.
- Treating `sourceChangePolicy.ts` receipt skip, `bootstrap.ts` first-run adopt, `canonicalLeadAdoption.ts` recurring adopt, `identity.ts` hash, later `apply.ts`, or `applyPlan.ts` walk as this story.
- Starting this file from apply, writing a Lead, hashing a row, appending a receipt, or executing a Domain Command.
- Silently “fixing” the unused origin flag, the all-or-nothing patch, the missing-key silence, the two folds, Form `destination_zip` vs Call `delivery_zip`, the financial regex, CLI-without-direct-import, the three-assert test, or `HANDOFF.md`.
- Starting Owner approve, Sheets write, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
