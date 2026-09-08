# On First-Run Bootstrap, Adopt The Existing Best Relocation Form Lead, Call Lead, Booking, Or Cancellation When Identity And Source-Owned Values Already Match — Tracking Reference Or LID For Forms, Phone Plus Florida Second For Calls, Job Plus Money And Ownership For Bookings, Booking Map Plus Refund Facts For Cancellations — Zero Or Two Matches Block — Never Leave A Create, Never Write A Lead, Never Upsert Fields, Never Run Recurring Adopt — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 10 of this service — `bootstrap.ts`
- Remaining in this service: `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/bootstrap.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Bootstrap remaps creates to receipt-only `adopt_existing` and **does not** run `applyCanonicalAdoptionPolicy`. Recurring preview / manual / schedule planning applies receipt skip then adopt-before-create instead. Adopt is receipt-only: no field upsert. `BEST_RELOCATION_INGEST_ENABLED` / `application_enabled` may skip non-bootstrap apply; bootstrap still plans. `application_enabled` also requires `bootstrap_completed_at` (stamped by the worker after a completed bootstrap apply — not this file). CLI dry-run **asks** receipt skip + recurring adopt and **never** **asks** this file. Primary-code list **names** `canonicalLeadAdoption.ts` / `sheets.ts` / `dryRunReports.ts` — do not add a second Ingestion Service so “first-run adopt owns inspect.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (this file **asks** `toFloridaTimestamp` only; it does **not** **ask** `BEST_RELOCATION_CUTOFF`). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file copies Job fold locally; it does **not** **ask** `normalizeJobNo`). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md) (sheet Booking ↔ Lead / Refund; this file matches a remaining create to **Mongo**). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (emits `create_*`; this file **must** rewrite those). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md) (names the sheet row; this file finds the Mongo document). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md) (worker **never** **asks** that file on bootstrap). Distinct from already-recommended recurring adopt: [`best-relocation-sheet-ingest-canonical-lead-adoption.md`](best-relocation-sheet-ingest-canonical-lead-adoption.md) (phone+name+New York day fallback, may leave a create, drops the body, ignores field equality). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (**asks** this file on the **unmapped** snapshot when trigger is `bootstrap`). Distinct from already-recommended walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (`adopt_existing` writes a receipt and puts the id on the apply dependency map; this file never walks). Distinct from later three-way allowlist: `updatePolicy.ts` (this file **asks** `evaluateSourceOwnedLeadUpdate` / `sourceOwnedPaths` as an equality gate; it does not patch). Distinct from later HTTP apply: `apply.ts`. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes HTTP `apply.ts` as the live path and never names this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `ingestion/worker.ts` **asks** `planBootstrapAdoption(initialPlanSnapshot)` when trigger is `bootstrap` (not `withEvidence`; no receipt skip; no recurring adopt). `ingestion/ingestion.test.ts` **asks** `planBootstrapAdoption` twice: one test only `typeof` plus a **local remap** that never calls the function; one DST Call test **asks** summer + winter windows. Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. CLI `scripts/best-relocation-sheet-ingest.ts` does **not** import this file. Barrel `index.ts` `export *`. `adapter.ts` does not import this file. Wave B `src/routes/ingestion.routes.ts` does not import this file.
- Seams callers need: this-file / worker (bootstrap trigger only; unmapped snapshot); this-file / later apply (receipt-only `adopt_existing`; worker stamps `bootstrap_completed_at` after a completed walk); this-file / later three-way allowlist (equality gate, not a patch); this-file / recurring adopt (do not unify); this-file / receipt skip (do not unify); this-file / sheet pair (do not unify); this-file / identity (row name vs Mongo find). There is no sheet-write **seam**. There is no receipt-write **seam**. There is no Domain Command **seam**. There is no field-upsert **seam**. There is no injectable-store **seam**.
- Split later (only if the file outgrows one sitting): this ~394-line file is one sitting if you read it as on first-run bootstrap, adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation when identity and source-owned values already match. Do **not** split into `form.ts` / `call.ts` / `booking.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `canonicalLeadAdoption.ts`, `sourceChangePolicy.ts`, `updatePolicy.ts`, `matching.ts`, `applyPlan.ts`, or `identity.ts` here. If it later splits: `adoptTheUniqueFormWhenTrackingReferenceAndSourceOwnedValuesAlreadyMatch.ts` / `adoptTheUniqueCallOnPhoneAndFloridaSecondWhenSourceOwnedValuesAlreadyMatch.ts` / `adoptTheUniqueBookingWhenJobMoneyAndOwnershipAlreadyMatch.ts` only as later story files, never CRUD.

`planBootstrapAdoption` is executor mechanics. The owner question is: *This is the first Best Relocation run. Every remaining create must point at the Lead, Booking, or Cancellation we already have. A Form adopts on unique Tracking Reference or LID only when the source-owned contact and move fields already match Mongo. A Call adopts on unique phone plus the persisted Florida second, same field match, skipping Duplicate Leads. A Booking adopts on unique Job Number only when binder, deposit, merchant, book date, source, and Lead ownership already match. A Refund adopts the one Cancellation already hanging off the Booking this walk just adopted, only when refund, cancel date, and reason already match. One match adopts. Two matches are an ambiguous conflict. Zero is a blocking divergence — never a create. Then tell the owner how binder, deposit, and refund on the sheet compare to the documents we adopted. This file does not write a Lead. This file does not upsert fields. This file does not run recurring adopt.*

Receipt skip, recurring adopt, sheet pair, identity mint, three-way allowlist, and the apply walk already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “on first-run bootstrap, adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation when identity and source-owned values already match” story, not “a bootstrap CRUD helper,” and not inspect / receipt skip / recurring adopt / apply.

1. **Refuse any plan that is not first-run bootstrap** — `planBootstrapAdoption` throws `Bootstrap adoption requires a bootstrap plan` when `trigger !== "bootstrap"`. Recurring preview / manual / schedule / retry never enter this file. This function does not rewrite a non-bootstrap plan. This function does not run receipt skip.

2. **Adopt a unique Form Lead on Tracking Reference or LID when source-owned values already match** — private `findCandidates` for `create_form_lead`. Identities are `ref_no` / `lid` on the payload. No identities → `[]` (later a blocking divergence). Store query: `FormLead` `source_company: "best_relocation_leads"`, `$or` on `ref_no` / `lid` / `normalized_lid`. Then **ask** `leadSourceValuesMatch`: `evaluateSourceOwnedLeadUpdate` with `originated_from_best_relocation: true`, `last_applied` and `current_canonical` both the Mongo document, `current_source` the paths from `sourceOwnedPaths("FormLead")` that the sheet bag actually has (`source_owned_values ?? payload`). Only `classification === "unchanged"` stays. There is **no** phone + name + New York day fallback. There is **no** cutoff. Duplicate Leads are **not** filtered in the query. This function does not write a Lead.

3. **Adopt a unique Call Lead on phone + Florida second when source-owned values already match** — missing last-10 digits or a finite timestamp → `[]`. Store query: `best_relocation_leads`, `duplicate: { $ne: true }`, `normalized_phone_number`, timestamp ±1s around `toFloridaTimestamp`. Same source-owned equality gate on `CallLead` paths. This function does not use name. This function does not use the New York day key.

4. **Adopt a unique Booking on Job when money, merchant, book date, source, and ownership already match** — shared by `create_booked_from_source` and `create_leadless_booking`. Job is `job_no ?? call_job_no` folded locally (`uppercase`, strip non-alphanumerics). Missing Job → `[]`. Store query: `BookedLead.normalized_job_no` with **no** Source Company filter. Then require binder / deposit money-equal (`< 0.001`), folded merchant, same ISO date (`YYYY-MM-DD`), folded source, and `bookingOwnershipMatches`. Leadless: `is_leadless_booking === true`, no `lead_ref`, folded customer name, agent **names** in order (`agent` then `split_agent`). From-source: exactly one adopted Lead already on `depends_on` in this walk’s map, `lead_ref` equals that id, `lead_model` equals the payload, agent **allocations** match name + binder. This function does not invent a Booking.

5. **Adopt a unique Cancellation from the Booking already on this walk when refund facts already match** — `depends_on` must resolve to exactly one `BookedLead` on `adoptedByAction`. Else `[]`. Store query: `CancelledLead.booked_lead`. Then require refund money-equal, same cancel date, folded reason. This function does not invent a Cancellation.

6. **Walk remaining creates: unique match adopts (keep the body), zero or two block, then stamp financial reconciliation** — `planBootstrapAdoption`. Pass through `record_conflict` / `unchanged` / `adopt_existing`. Any other command **asks** `findCandidates`. Exactly one candidate → `adopt_existing` `classification: "adoption"`, `adopted_entity_refs`, **keeps** `command_payload`, remembers the candidates for later Bookings / Refunds, adds that document’s binder / deposit / refund to `canonical_financial`. Zero → `record_conflict` `canonical_divergence` `blocking` (empty refs). Two → `ambiguous_lead_match` `blocking` (refs kept). Action keys and `depends_on` stay. Counters rebuild from `classification`. `bootstrap_reconciliation` counts non-conflict source actions, adoptions, blocking discrepancies, sheet financials (unique `dataset_key:stable_source_row_id:content_hash`, payload binder / deposit / refund), adopted financials, and the difference. This function does not append a receipt. This function does not execute a Domain Command. This function does not leave a create.

Shared beats, not owner operations: `leadSourceValuesMatch` (three-way **asked** as equality, not as a patch), `bookingOwnershipMatches` / `agentNamesMatch` / `agentAllocationsMatch`, `financialSummary` / `entityRefs`, `moneyEqual` / `sameDate` / `normalizedText` / `numeric`.

## Organization

Keep one file as the screenplay for “on first-run bootstrap, adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation when identity and source-owned values already match — Tracking Reference or LID for Forms, phone plus Florida second for Calls, Job plus money and ownership for Bookings, Booking map plus refund facts for Cancellations — zero or two matches block — never leave a create, never write a Lead, never upsert fields, never run recurring adopt.” Receipt skip, recurring adopt, sheet pair, identity mint, three-way allowlist, and the apply walk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationBootstrapService` class. Do not invent a begin / complete **seam** here — first-run adopt is not a Domain Command. Do not invent a second Job **adapter** beside `parsing.normalizeJobNo`. Do not invent a second pair **adapter** beside `matching.ts`. Do not invent a receipt-write **adapter** here — `applyPlan.persistReceipt` already owns apply-time persist. Do not invent a second adopt **adapter** that replaces `applyCanonicalAdoptionPolicy` — name the two adopts. Do not invent an injectable store so “one store owns both.” Do not invent a second three-way **adapter** beside `updatePolicy.ts`.

**External interface** stays small (this is the test surface). Faces `worker.ts` / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planBootstrapAdoption` | `adoptExistingCanonicalsOnFirstRunOrBlock` | worker first-run plan; never CLI |

Keep the old name as a one-line alias until `worker.ts`, the barrel, and `ingestion.test.ts` migrate. Do not export `findCandidates` / `leadSourceValuesMatch` / `bookingOwnershipMatches` / `financialSummary` as a new public story. Do not make callers learn `InTransaction` or CRUD verbs. Do not make recurring adopt learn this file. Do not make the CLI learn this file.

**No class for the workflow.** The one type that earns a name is the candidate this walk is allowed to remember:

```ts
type BootstrapCandidate = {
  model: string
  id: string
  binder_amount?: number
  deposit_amount?: number
  refund_amount?: number
}
```

That is the handoff from “this first-run create found one Mongo document” to “a later Booking or Refund on this same walk may bind that id, and the owner can see the money difference.” Do not put phone+name+date on that type so “recurring owns first run.” Do not put `plan_checksum` on the return so “adopt owns approve.” Do not put `LID_BestRelo` on the Form identities so “the membership tab is a Lead.” Do not put `bootstrap_completed_at` on the return so “this file owns the gate.”

`BestRelocationApplicationPlan` / `BestRelocationPlanAction` stay on sibling `applicationPlan.ts`. Do not move those cards here. `evaluateSourceOwnedLeadUpdate` / `sourceOwnedPaths` stay on later `updatePolicy.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bootstrap.ts
// This is the first Best Relocation run.
// Every remaining create must point at the Lead, Booking, or Cancellation we already have.
// A Form adopts on unique Tracking Reference or LID
// only when the source-owned contact and move fields already match Mongo.
// A Call adopts on unique phone plus the persisted Florida second, same field match.
// A Booking adopts on unique Job Number
// only when binder, deposit, merchant, book date, source, and Lead ownership already match.
// A Refund adopts the one Cancellation already hanging off the Booking this walk just adopted
// only when refund, cancel date, and reason already match.
// One match adopts. Two matches are an ambiguous conflict.
// Zero is a blocking divergence — never a create.
// Then tell the owner how binder, deposit, and refund on the sheet
// compare to the documents we adopted.
// This file does not write a Lead.
// This file does not upsert fields.
// This file does not run recurring adopt.

// ── 1. Refuse any plan that is not first-run bootstrap ────

export async function adoptExistingCanonicalsOnFirstRunOrBlock(sourcePlan)
function refuseUnlessThisIsTheFirstRun(sourcePlan)          // trigger === "bootstrap"

// ── 2. Adopt a unique Form when identity and fields match ─

async function adoptTheUniqueFormWhenTrackingReferenceAndSourceOwnedValuesAlreadyMatch(action)
function identitiesOnTheSheet(payload)                     // ref_no / lid only
function sourceOwnedValuesAlreadyMatchTheLead(leadModel, source, canonical)

// ── 3. Adopt a unique Call on phone + Florida second ──────

async function adoptTheUniqueCallOnPhoneAndFloridaSecondWhenSourceOwnedValuesAlreadyMatch(action)

// ── 4. Adopt a unique Booking when Job, money, and ownership match

async function adoptTheUniqueBookingWhenJobMoneyAndOwnershipAlreadyMatch(action, adoptedByAction)
function foldTheJobTheBestRelocationWay(value)              // local copy of parsing.normalizeJobNo
function bookingOwnershipAlreadyMatches(action, payload, doc, adoptedLead)

// ── 5. Adopt a unique Cancellation from this walk ─────────

async function adoptTheUniqueCancellationFromTheBookingOnThisWalkWhenRefundFactsAlreadyMatch(action, adoptedByAction)

// ── 6. Walk creates, block zero or two, stamp the money ───

function asAdoptedKeepingTheCreateBody(action, candidates)
function asBlockedDivergenceOrAmbiguousMatch(action, candidates)
function recountClassifications(actions)
function sheetFinancialsFromUniqueEvidence(actions)
function stampBootstrapReconciliation(sourcePlan, actions, canonicalFinancial)
```

Read the primary path out loud: *This is the first Best Relocation run. A remaining Form create looks up Tracking Reference or LID on Best Relocation Form Leads. One hit whose source-owned fields already match Mongo adopts that Lead. Two hits conflict. Zero identities or zero matching documents block — they do not become a create, and phone plus name plus New York day is not a second door. A remaining Call create adopts on unique phone plus the persisted Florida second when those fields already match, skipping Duplicate Leads. A remaining Booking create adopts on unique Job Number only when binder, deposit, merchant, book date, source, and Lead ownership already match. A remaining Refund create adopts the one Cancellation already hanging off the Booking this walk just adopted, only when refund, cancel date, and reason already match. Already-adopted, unchanged, and conflict rows stay. Adopt keeps the create body. Then show the owner the sheet money versus the adopted documents. Do not write a Lead. Do not upsert fields. Do not run recurring adopt.*

That is the operation. `planBootstrapAdoption` is not.

## Precise logic I would tighten while renaming

1. **Two adopt stories.** Recurring adopt falls through to phone+name+date, ignores field equality, **may** leave a create, and **drops** the body. This file is identity-only on Forms, requires source-owned values to already match, **never** leaves a create, and **keeps** the body. Do not start **asking** `decideFormLeadAdoption` here so “one adopt owns first run.” Do not start calling this from the worker’s recurring branch so “one file owns both.”

2. **Worker feeds the unmapped snapshot.** `planBootstrapAdoption(initialPlanSnapshot)` still sees creates that `evidenceKeysForConnection` would have remapped to `unchanged`. Recurring `applySourceChangePolicy` uses `withEvidence`. Name the two inputs. Do not silently feed `withEvidence` into this file so “one snapshot owns both triggers.”

3. **Adopt keeps the create body.** Recurring `asAdopted` strips `command_payload`. This file spreads the original action. Later apply still treats `adopt_existing` as receipt-only. Do not start dropping the body here so “one strip owns both” without proving apply never reads bootstrap payloads.

4. **Three-way is an equality gate, not a patch.** `leadSourceValuesMatch` **asks** `evaluateSourceOwnedLeadUpdate` and accepts only `unchanged`. `last_applied` and `current_canonical` are the same Mongo document, so `canonical_divergence` never fires and any differing allowlisted path becomes `safe_update` — which this file treats as “not a match.” Do not start emitting `update_source_owned_lead` here so “first run can also patch.” Do not pull the allowlist tables into this file.

5. **Form identity does not skip Duplicate Leads.** Call query is `duplicate: { $ne: true }`. Form identity is not. A Duplicate Lead with the same Tracking Reference can be adopted on first run. Recurring identity has the same hole; recurring contact does not. Do not silently add the filter so “one skip owns both.”

6. **Form identity does not apply the cutoff.** Recurring contact refuses pre-cutoff timestamps. This file never **asks** `BEST_RELOCATION_CUTOFF`. A pre-cutoff Form Lead with the same LID still adopts. Do not silently add the cutoff so “one window owns Form.”

7. **Two clocks, two phone folds.** Call uses `toFloridaTimestamp` ±1s and a local last-10-digit fold. Recurring Call uses the same clock; recurring Form contact uses America/New_York. This file never **asks** `normalizePhoneNumberForMatch`. Do not silently put Calls on the New York day key so “one clock owns adopt.” Do not start requiring a Call name.

8. **Two Job folds.** This file copies `uppercase` + strip locally. `parsing.normalizeJobNo` is the same fold. `bookingIdentity.normalizeJobNo` keeps a space. Do not start **asking** parse here in this rename so “one Job owns naming and first-run adopt.” Do not switch onto Booking Identity so “one Job owns both.”

9. **Booking and Cancellation queries have no Source Company.** Form / Call are `best_relocation_leads`. A Job from another company can be adopted if money and ownership also match. Recurring Booking adopt is even looser (Job only). Do not silently add the slug so “one company owns every tab.”

10. **Booking / Refund are stricter than recurring adopt.** Recurring Booking adopt ignores binder, merchant, book date, and Lead ownership. Recurring Refund adopt ignores refund amount. This file requires those facts. Do not silently drop the checks so “one Job owns both adopts.”

11. **Refund / from-source Booking are walk-order + in-memory map.** `depends_on` is not rewritten. The Lead or Booking must already have candidates in `adoptedByAction` from an earlier action on this same walk. Apply’s later `resolved` map is a different **adapter**. Do not start writing receipts here so “adopt owns the apply map.”

12. **Zero is a conflict, not a create.** Missing identities, missing Job, missing Booking on the map, or a filtered-out field mismatch all become `canonical_divergence`. Two hits become `ambiguous_lead_match`. Do not silently leave those as `create_*` so “first run can mint.”

13. **CLI never **asks** this file.** Worker is the only runtime caller. CLI always **asks** recurring adopt, even without a connection. Name the drift. Do not add `planBootstrapAdoption` to the CLI so “dry-run matches first run.”

14. **The “remaps creates” test never **asks** this file.** It `typeof`s the export, then remaps a leadless Booking **in the test**. Only the DST Call test actually invokes `planBootstrapAdoption`. Name the gap. Do not treat that test as proof of Form / Booking / Refund / zero-match.

15. **Leave sibling modules alone.** `canonicalLeadAdoption.ts` recurring adopt, `sourceChangePolicy.ts` receipt skip, `updatePolicy.ts` allowlist, `matching.ts` sheet pair, `identity.ts` row name, `applyPlan.ts` receipt-only walk, `parsing.normalizeJobNo`, `toFloridaTimestamp` are already the right **depth**.

16. **Do not silently fix `HANDOFF.md`.** It still describes HTTP `apply.ts` as the live path and never names this file. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `adoptExistingCanonicalsOnFirstRunOrBlock`.

Today’s `ingestion.test.ts` already names “bootstrap adoption remaps creates to receipt-only `adopt_existing`” without calling the function, plus one DST Call window (summer `2026-05-01T09:59:59Z`–`10:00:01Z`, winter `2026-01-15T09:59:59Z`–`10:00:01Z`, `duplicate: { $ne: true }`). Folder `bestRelocationSheetIngest.test.ts` never imports this file. CLI never **asks** this file. That is close on the Call clock, and it does not name Form / Booking / Cancellation / zero-match / money operations.

Replace the typeof-and-local-remap style with tests that name the operation:

**Refuse any plan that is not first-run bootstrap**
- `trigger: "manual"` / `"preview"` / `"schedule"` throws `Bootstrap adoption requires a bootstrap plan`.
- Worker still does not **ask** this file when trigger is not `bootstrap`.

**Adopt a unique Form when identity and fields match**
- Unique Tracking Reference / LID + source-owned paths already equal Mongo → `adopt_existing`, payload kept, refs stamped.
- Two Forms sharing a Tracking Reference → `ambiguous_lead_match` `blocking`.
- No `ref_no` / `lid` → `canonical_divergence` `blocking`, not a create, no phone+name+date fallback.
- Unique identity whose name / zip / move_date already differs → still `canonical_divergence` (three-way would have said `safe_update`).
- Prove a Duplicate Lead with the same LID can still adopt — do not unify with the Call skip.
- Prove a pre-cutoff LID can still adopt — do not add the window.

**Adopt a unique Call**
- Unique phone + Florida second + source-owned match → `adopt_existing`.
- Two Calls in the ±1s window that both pass the field gate → `ambiguous_lead_match`.
- Missing phone or timestamp → `canonical_divergence`, not `create_call_lead`.
- Name / New York day do not open a second door.
- `duplicate: true` is excluded from the query.

**Adopt a unique Booking**
- Unique `normalized_job_no` (`P-100` → `P100`) plus binder / deposit / merchant / book date / source / ownership → `adopt_existing` for both `create_booked_from_source` and `create_leadless_booking`.
- Unique Job whose binder differs → `canonical_divergence`.
- From-source with no adopted Lead yet on `depends_on` → `canonical_divergence`.
- Two Bookings on that Job that both pass the facts → conflict.
- Missing Job → `canonical_divergence`.

**Adopt a unique Cancellation**
- Booking already on `adoptedByAction` from `depends_on` + one Cancellation whose refund / cancel date / reason match → `adopt_existing`.
- Same Booking, refund amount differs → `canonical_divergence`.
- Two Cancellations that both pass the facts → conflict.
- No Booking id on the map → `canonical_divergence`.

**Walk creates, block zero or two, stamp the money**
- `unchanged` / `adopt_existing` / `record_conflict` pass through; first adopted id is still remembered for a later Refund.
- Adopt does not rewrite `action_key` or `depends_on`.
- Adopt keeps `command_payload`; recurring adopt still drops it — do not unify.
- Counters match the rewritten classifications. No leftover `create` remains.
- `bootstrap_reconciliation.financial_difference` is sheet unique-evidence money minus adopted Booking / Cancellation money.
- Worker still **asks** this file on the **unmapped** snapshot and still does not **ask** receipt skip / recurring adopt on bootstrap.
- CLI still never imports this file.
- Runtime callers still work with no injectable store.

Do **not** add a helper-unit test that has to change when `normalizedText` is inlined. Do not add a test per `limit(2)` if the parent already proves one vs two vs zero.

Caller to keep green: worker still **asks** this file only when trigger is `bootstrap`, still on `initialPlanSnapshot`, still stamps `bootstrap_completed_at` only after a completed apply; later `applyPlan.ts` still treats `adopt_existing` as receipt-only; later `canonicalLeadAdoption.ts` still never imports this file; later `updatePolicy.ts` still owns the allowlist; Granot-minted `ingestion_origin` is still not rewritten here.

## What I would not do

- A `BestRelocationBootstrapService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `find`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `form.ts` / `call.ts` / `booking.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on a later apply, or pair-then-threshold, or inspect 409.
- Treating `canonicalLeadAdoption.ts` recurring adopt, `sourceChangePolicy.ts` receipt skip, `matching.ts` sheet pair, `identity.ts` row name, later `updatePolicy.ts` allowlist, or `applyPlan.ts` walk as this story.
- Starting this file from recurring planning, writing a Lead, upserting fields, appending a receipt, or executing a Domain Command.
- Making `LID_BestRelo` a Form identity, falling back to sheet row, or unifying the New York day with the Florida second.
- Silently “fixing” the two adopt stories, identity vs Call Duplicate / cutoff filters, the unmapped snapshot, the kept create body, the unscoped Booking query, the local Job fold, CLI-without-bootstrap, the typeof-only test, or `HANDOFF.md`.
- Starting Owner approve, Sheets write, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
