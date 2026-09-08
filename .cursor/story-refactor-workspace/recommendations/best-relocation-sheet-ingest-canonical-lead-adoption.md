# Adopt The Existing Best Relocation Form Lead, Call Lead, Booking, Or Cancellation Before Minting A Second One — Tracking Reference Then Phone+Name+New York Day For Forms, Phone+Florida Second For Calls, Job For Bookings, Booking Map For Refunds — Leave Receipt Outcomes Alone — Never Write A Lead, Never Upsert Fields, Never Run On Bootstrap — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 9 of this service — `canonicalLeadAdoption.ts`
- Remaining in this service: `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/canonicalLeadAdoption.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Recurring preview / manual / schedule planning applies receipt skip then **adopt-before-create** (`applyCanonicalAdoptionPolicy`). Bootstrap remaps creates to receipt-only `adopt_existing` and **does not** run this file. Adopt is receipt-only: no field upsert. Granot-minted Form Leads keep Ingestion Origin `granot_lead_created`. CLI dry-run **asks** this file after optional receipt skip. Primary-code list **names** this file with `sheets.ts` / `dryRunReports.ts` — do not add a second Ingestion Service so “Mongo adopt owns inspect.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (this file **asks** `BEST_RELOCATION_CUTOFF` / `BEST_RELOCATION_TIMEZONE`). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file copies Job fold locally; it does **not** **ask** `normalizeJobNo`). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md) (sheet Booking ↔ Lead / Refund; this file matches a remaining create to **Mongo**). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (emits `create_*`; this file may rewrite those). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md) (names the sheet row; this file finds the Mongo document). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md) (this file **leaves** `unchanged` / `adopt_existing` / `update_source_owned_lead` / `record_conflict`). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (**asks** this file only when trigger is not `bootstrap`). Distinct from already-recommended walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (`adopt_existing` writes a receipt and puts the id on the apply dependency map; this file never walks). Distinct from later first-run adopt: `bootstrap.ts` (identity-only Form, source-owned values must match, **never** create). Distinct from later three-way allowlist: `updatePolicy.ts`. Distinct from later HTTP apply: `apply.ts`. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes HTTP `apply.ts` as the live path and never names this file). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `ingestion/worker.ts` **asks** `applyCanonicalAdoptionPolicy` after `applySourceChangePolicy` when trigger is not `bootstrap` (no store — Mongo default). CLI `scripts/best-relocation-sheet-ingest.ts` **asks** it after optional receipt skip, even when no connection exists. `canonicalLeadAdoption.test.ts` **asks** `decideFormLeadAdoption` (six Form cases) and `applyCanonicalAdoptionPolicy` (one walk: already-adopted stays, Form + Booking remap). Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. `ingestion/ingestion.test.ts` does **not** import this file. Barrel `index.ts` `export *`. `adapter.ts` does not import this file. Wave B `src/routes/ingestion.routes.ts` does not import this file. `createMongoCanonicalAdoptionStore` has **no** external caller.
- Seams callers need: this-file / Form decide (exported; walk **asks** it); this-file / injectable store (tests inject; worker / CLI use Mongo default); this-file / worker (after receipt skip; never bootstrap); this-file / CLI (always, connection or not); this-file / later apply (receipt-only `adopt_existing`); this-file / later bootstrap (do not unify); this-file / sheet pair (do not unify); this-file / identity (row name vs Mongo find); this-file / receipt skip (already-adopted stay). There is no sheet-write **seam**. There is no receipt-write **seam**. There is no Domain Command **seam**. There is no field-upsert **seam**.
- Split later (only if the file outgrows one sitting): this ~491-line file is one sitting if you read it as adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation before minting a second one. Do **not** split into `form.ts` / `call.ts` / `booking.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `bootstrap.ts`, `sourceChangePolicy.ts`, `matching.ts`, `updatePolicy.ts`, `applyPlan.ts`, or `identity.ts` here. If it later splits: `decideWhetherThisFormCreateAdoptsAnExistingBestRelocationFormLead.ts` / `adoptARemainingCallOnPhoneAndFloridaSecond.ts` / `adoptARemainingBookingOnUniqueJob.ts` only as later story files, never CRUD.

`applyCanonicalAdoptionPolicy` / `decideFormLeadAdoption` are executor mechanics. The owner question is: *A remaining Best Relocation create would mint a second Lead, Booking, or Cancellation. First look up the one we already have. A Form adopts on unique Tracking Reference or LID; if that misses, unique phone + name + same America/New_York day on or after the cutoff. A Call adopts on unique phone + persisted Florida timestamp. A Booking adopts on unique Job Number. A Refund adopts the Cancellation already hanging off the Booking this walk just adopted. Two matches are a conflict. Zero stays a create. Receipt-skip and already-adopted rows stay as they are. Adopt drops the create body. This file does not write a Lead. This file does not upsert fields. This file does not run on bootstrap.*

Receipt skip, sheet pair, identity mint, first-run adopt, three-way allowlist, and the apply walk already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation before minting a second one” story, not “an adoption CRUD helper,” and not inspect / receipt skip / bootstrap / apply.

1. **Decide whether a remaining Form Lead create adopts an existing Best Relocation Form Lead** — `decideFormLeadAdoption`. Sheet `ref_no` / `lid` (Tracking Reference / LID) first: unique hit → `adopt` `lid_or_ref`. Two hits → `ambiguous_lead_match`. Zero hits, or no identities: unique phone + comparison name + same America/New_York day, on or after `BEST_RELOCATION_CUTOFF`, skipping Duplicate Leads → `adopt` `phone_name_date`. Two contact hits → conflict. Incomplete contact or zero hits → `create`. Identity does **not** skip Duplicate Leads and does **not** apply the cutoff. This function does not write a Lead.

2. **Adopt a remaining Call Lead create on unique phone + Florida second** — private `adoptCallLead`. Missing phone or timestamp → leave the create. Store query: `best_relocation_leads`, not Duplicate, `normalized_phone_number`, timestamp ±1s around `toFloridaTimestamp`. One hit → `adopt_existing` `phone_timestamp`. Two → `ambiguous_lead_match`. Zero → leave the create. This function does not use name. This function does not use the New York day key.

3. **Adopt a remaining Booking create on unique Job Number** — private `adoptBooking`. Shared by `create_booked_from_source` and `create_leadless_booking`. Job is `job_no ?? call_job_no` folded locally (`uppercase`, strip non-alphanumerics). Missing Job → leave the create. Store query: `BookedLead.normalized_job_no` with **no** Source Company filter. One hit → `adopt_existing` `job_no`. Two → conflict. Zero → leave the create. This function does not check binder, merchant, book date, or Lead ownership.

4. **Adopt a remaining Cancellation create from the Booking already on this walk** — private `adoptCancellation`. `bookingId` is the first `adoptedIds` hit from `depends_on` (ids this walk already adopted, including receipt-skip / already-adopted). No Booking id → leave the create. Store query: `CancelledLead.booked_lead`. One hit → `adopt_existing` `booking_refund`. Two → conflict. This function does not check refund amount. This function does not invent a Cancellation.

5. **Walk remaining creates, leave receipt outcomes alone, then recount** — `applyCanonicalAdoptionPolicy`. Pass through `unchanged` / `record_conflict` / `adopt_existing` / `update_source_owned_lead` (still remember `adopted_entity_refs[0]` for later Refunds). Remap Form / Call / Booking / Cancellation creates. Adopt **drops** `command_payload`, stamps `matching` (`phone_name_date` score `0.95`, everything else `1`, `MATCH_CALIBRATION_VERSION`). Conflict **keeps** the payload. Action keys and `depends_on` stay. Counters rebuild from `classification`. Default store is `createMongoCanonicalAdoptionStore`. This function does not append a receipt. This function does not execute a Domain Command.

Shared beats, not owner operations: `CanonicalAdoptionStore` (injectable lookup), `remapLeadAction` / `asAdopted` / `asConflict`, `uniqueIdentities`, `formPhoneNameDateMatches`, `normalizeJob`, `newYorkDateKey`, `asLeadDoc`.

## Organization

Keep one file as the screenplay for “adopt the existing Best Relocation Form Lead, Call Lead, Booking, or Cancellation before minting a second one — Tracking Reference then phone+name+New York day for Forms, phone+Florida second for Calls, Job for Bookings, Booking map for Refunds — leave receipt outcomes alone — never write a Lead, never upsert fields, never run on bootstrap.” Receipt skip, sheet pair, identity mint, first-run adopt, three-way allowlist, and the apply walk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationCanonicalAdoptionService` class. Do not invent a begin / complete **seam** here — adopt-before-create is not a Domain Command. Do not invent a second Job **adapter** beside `parsing.normalizeJobNo`. Do not invent a second pair **adapter** beside `matching.ts`. Do not invent a receipt-write **adapter** here — `applyPlan.persistReceipt` already owns apply-time persist. Do not invent a second adopt **adapter** that replaces `planBootstrapAdoption` — name the two adopts.

**External interface** stays small (this is the test surface). Faces `worker.ts` / CLI / `canonicalLeadAdoption.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applyCanonicalAdoptionPolicy` | `adoptExistingCanonicalsBeforeMintingASecondOne` | worker recurring plan; CLI dry-run |
| `decideFormLeadAdoption` | `decideWhetherThisFormCreateAdoptsAnExistingBestRelocationFormLead` | Form decide; folder tests inject a store |
| `createMongoCanonicalAdoptionStore` | `lookUpBestRelocationCanonicalsInMongo` | default store; no external caller yet |
| `CanonicalAdoptionStore` | keep | injectable lookup **seam** |
| `FormLeadAdoptionDecision` | keep | Form decide result |
| `CanonicalLeadDoc` / `CanonicalBookingDoc` | keep | store cards |

Keep the old names as one-line aliases until `worker.ts`, the CLI, the barrel, and `canonicalLeadAdoption.test.ts` migrate. Do not export `adoptCallLead` / `adoptBooking` / `adoptCancellation` / `asAdopted` as a new public story. Do not make callers learn `InTransaction` or CRUD verbs. Do not make bootstrap learn this file.

**No class for the workflow.** The one type that earns a name is the lookup this file is allowed to trust:

```ts
type CanonicalAdoptionStore = {
  findFormLeadsByIdentity(identities: string[]): Promise<CanonicalLeadDoc[]>
  findFormLeadsByPhoneNameDate(input: { phone: string; name: string; timestamp: Date }): Promise<CanonicalLeadDoc[]>
  findCallLeadsByPhoneTimestamp(input: { phone: string; timestamp: Date }): Promise<CanonicalLeadDoc[]>
  findBookingsByJob(normalizedJobNo: string): Promise<CanonicalBookingDoc[]>
  findCancellationsByBooking(bookingId: string): Promise<Array<{ id: string; booked_lead: string }>>
}
```

That is the handoff from “the plan still wants to create” to “Mongo already has one, two, or none.” Do not put source-owned field equality on that type so “bootstrap owns recurring.” Do not put `plan_checksum` on the return so “adopt owns approve.” Do not put `LID_BestRelo` on the Form identities so “the membership tab is a Lead.”

`BestRelocationApplicationPlan` / `BestRelocationPlanAction` stay on sibling `applicationPlan.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// canonicalLeadAdoption.ts
// A remaining Best Relocation create would mint a second Lead, Booking, or Cancellation.
// First look up the one we already have.
// A Form adopts on unique Tracking Reference or LID.
// If that misses: unique phone + name + same New York day after the cutoff.
// A Call adopts on unique phone + persisted Florida timestamp.
// A Booking adopts on unique Job Number.
// A Refund adopts the Cancellation already hanging off the Booking this walk just adopted.
// Two matches are a conflict. Zero stays a create.
// Receipt-skip and already-adopted rows stay as they are.
// Adopt drops the create body.
// This file does not write a Lead.
// This file does not upsert fields.
// This file does not run on bootstrap.

// ── 1. Decide whether this Form create adopts ─────────────

export async function decideWhetherThisFormCreateAdoptsAnExistingBestRelocationFormLead(input)
function identitiesOnTheSheet(payload)                     // ref_no / lid
async function adoptTheUniqueFormByTrackingReferenceOrLid(identities, store)
async function adoptTheUniqueFormByPhoneNameAndNewYorkDay(payload, store)
function thisFormMatchesPhoneNameAndNewYorkDay(doc, phone, name, timestamp)

// ── 2. Adopt a remaining Call on phone + Florida second ───

async function adoptARemainingCallOnPhoneAndFloridaSecond(action, store)

// ── 3. Adopt a remaining Booking on unique Job ────────────

async function adoptARemainingBookingOnUniqueJob(action, store)
function foldTheJobTheBestRelocationWay(value)              // local copy of parsing.normalizeJobNo

// ── 4. Adopt a remaining Cancellation from this walk ──────

async function adoptARemainingCancellationFromTheBookingOnThisWalk(action, store, bookingId)

// ── 5. Walk remaining creates and leave receipt outcomes ──

export async function adoptExistingCanonicalsBeforeMintingASecondOne(input)
export function lookUpBestRelocationCanonicalsInMongo()
function rememberAdoptedIdsForLaterRefunds(action, adoptedIds)
function asAdoptedReceiptOnly(action, refs, method)         // drops command_payload
function asAmbiguousMatchConflict(action, refs)             // keeps command_payload
function recountClassifications(actions)
```

Read the primary path out loud: *A remaining Form create looks up Tracking Reference or LID on Best Relocation Form Leads. One hit adopts that Lead. Two hits conflict. Zero hits — unique phone, name, and New York day after the cutoff adopts; Duplicate Leads and pre-cutoff rows do not count. A remaining Call create adopts on unique phone plus the persisted Florida second. A remaining Booking create adopts on unique Job Number. A remaining Refund create adopts the one Cancellation already hanging off the Booking this walk just adopted. Receipt-skip, already-adopted, three-way, and conflict rows stay. Adopt drops the create body. Do not write a Lead. Do not upsert fields. Do not run on bootstrap.*

That is the operation. `applyCanonicalAdoptionPolicy` is not.

## Precise logic I would tighten while renaming

1. **Two adopt stories.** Bootstrap is identity-only on Forms, requires source-owned values to match, and **never** leaves a create. This file falls through to phone+name+date, ignores field equality, and **may** leave a create. Do not start **asking** `leadSourceValuesMatch` here so “one adopt owns first run.” Do not start calling this from bootstrap so “one file owns both.”

2. **Identity does not skip Duplicate Leads.** Contact query is `duplicate: { $ne: true }`. `findFormLeadsByIdentity` is not. A Duplicate Lead with the same Tracking Reference can be adopted on `lid_or_ref`. Knowledge only says contact match skips duplicates. Do not silently add the filter so “one skip owns both.”

3. **Identity does not apply the cutoff.** Contact match refuses pre-cutoff timestamps twice (store `timestamp >= CUTOFF`, then `formPhoneNameDateMatches`). A pre-cutoff Form Lead with the same LID still adopts. Do not silently add the cutoff to identity so “one window owns Form.”

4. **`findFormLeadsByPhoneNameDate` lies.** The Mongo **adapter** queries phone after the cutoff and returns up to 20 rows. Name and New York day are filtered in the parent. The test memory store returns every Form. Do not start pushing name/day into the query so “the store owns the day.” Do not start trusting the store’s `limit(20)` as uniqueness.

5. **Two clocks.** Form contact uses America/New_York calendar day. Call uses `toFloridaTimestamp` ±1s. Do not silently put Calls on the New York day key so “one clock owns adopt.” Do not start requiring a Call name.

6. **Two Job folds.** This file copies `uppercase` + strip locally. `parsing.normalizeJobNo` is the same fold (`trim` already happened in `stringValue`). `bookingIdentity.normalizeJobNo` keeps a space. Do not start **asking** parse here in this rename so “one Job owns naming and adopt.” Do not switch onto Booking Identity so “one Job owns both.”

7. **Booking and Cancellation queries have no Source Company.** Form / Call are `best_relocation_leads`. A Job from another company can be adopted. Do not silently add the slug so “one company owns every tab.”

8. **Refund adopt is walk-order + in-memory map.** `depends_on` is not rewritten. The Booking must already have an id in `adoptedIds` from an earlier action on this same walk. Apply’s later `resolved` map is a different **adapter**. Do not start writing receipts here so “adopt owns the apply map.”

9. **Adopt drops the body; conflict keeps it.** `asAdopted` strips `command_payload`. `asConflict` spreads the original action. Do not start keeping the create body on adopt so “apply can still mint.”

10. **Action keys stay.** Receipt skip rewrites `:revision:`. This file does not. The folder walk test asserts the Form key is unchanged. Do not start rewriting keys here so “one revision owns both.”

11. **CLI always **asks** this file.** Receipt skip runs only when the connection exists. Worker skips this file on bootstrap. Name the drift. Do not add `evidenceKeysForConnection` here so “CLI matches worker.”

12. **Leave sibling modules alone.** `sourceChangePolicy.ts` receipt skip, `bootstrap.ts` first-run adopt, `matching.ts` sheet pair, `identity.ts` row name, `updatePolicy.ts` allowlist, `applyPlan.ts` receipt-only walk, `parsing.normalizeJobNo`, `bookingIdentity.normalizeComparisonName`, `normalizePhoneNumberForMatch` are already the right **depth**.

13. **Do not silently fix `HANDOFF.md`.** It still describes HTTP `apply.ts` as the live path and never names this file. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `adoptExistingCanonicalsBeforeMintingASecondOne`, `decideWhetherThisFormCreateAdoptsAnExistingBestRelocationFormLead`.

Today’s `canonicalLeadAdoption.test.ts` already names unique Tracking Reference adopt, two-ref conflict, phone+name+New York day when Tracking Reference misses, two contact hits conflict, zero stay create, pre-cutoff ignored on contact, and one walk that leaves receipt-adopted alone while remapping Form + Booking. `ingestion.test.ts` never **asks** this file. Folder `bestRelocationSheetIngest.test.ts` never imports this file. That is close on Form decide, and it does not name Call / Booking / Cancellation / pass-through operations.

Replace the Form-only decide style with tests that name the operation:

**Decide whether this Form create adopts**
- Unique Tracking Reference / LID → `adopt` `lid_or_ref`. Contact is unused when identity hits one.
- Two Forms sharing a Tracking Reference → `ambiguous_lead_match`. Contact is not a fallback.
- Identity misses, unique phone + name + same New York day after the cutoff → `adopt` `phone_name_date` (Granot-minted row may have a different `ref_no`).
- Two contact hits → conflict, not create.
- No identity and no contact match → `create`.
- Pre-cutoff Form is ignored on contact. Prove identity can still adopt a pre-cutoff LID — do not unify.
- Contact skips `duplicate: true`. Prove identity can still adopt a Duplicate Lead with the same LID — do not unify.

**Adopt a remaining Call**
- Unique phone + Florida second → `adopt_existing` `phone_timestamp`, payload dropped.
- Two Calls in the ±1s window → `ambiguous_lead_match`.
- Missing phone or timestamp → leave `create_call_lead`.
- Name / New York day do not change the Call door.

**Adopt a remaining Booking**
- Unique `normalized_job_no` (`P-100` → `P100`) → `adopt_existing` `job_no` for both `create_booked_from_source` and `create_leadless_booking`.
- Two Bookings on that Job → conflict.
- Missing Job → leave the create.
- Binder / merchant / book date / Lead ownership are ignored.

**Adopt a remaining Cancellation**
- Booking already on `adoptedIds` from `depends_on` + one Cancellation → `adopt_existing` `booking_refund`.
- Two Cancellations on that Booking → conflict.
- No Booking id on the map → leave `create_cancelled_lead`.
- Refund amount is ignored.

**Walk remaining creates and leave receipt outcomes**
- `unchanged` / `adopt_existing` / `update_source_owned_lead` / `record_conflict` pass through; first adopted id is still remembered for a later Refund.
- Adopt does not rewrite `action_key` or `depends_on`.
- Counters match the rewritten classifications.
- Worker still does not **ask** this file on `bootstrap`.
- Runtime callers still work when `createMongoCanonicalAdoptionStore` has no external import.

Do **not** add a helper-unit test that has to change when `uniqueIdentities` is inlined. Do not add a test per store `limit` if the parent already proves one vs two vs zero.

Caller to keep green: worker still **asks** this file only when trigger is not `bootstrap`, and still **asks** receipt skip first; CLI still **asks** this file even without a connection; later `applyPlan.ts` still treats `adopt_existing` as receipt-only; later `bootstrap.ts` still never imports this file; Granot-minted `ingestion_origin` is still not rewritten here.

## What I would not do

- A `BestRelocationCanonicalAdoptionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `find`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `form.ts` / `call.ts` / `booking.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on a later apply, or pair-then-threshold, or inspect 409.
- Treating `sourceChangePolicy.ts` receipt skip, `bootstrap.ts` first-run adopt, `matching.ts` sheet pair, `identity.ts` row name, `updatePolicy.ts` allowlist, or `applyPlan.ts` walk as this story.
- Starting this file from bootstrap, writing a Lead, upserting fields, appending a receipt, or executing a Domain Command.
- Making `LID_BestRelo` a Form identity, falling back to sheet row, or unifying the New York day with the Florida second.
- Silently “fixing” the two adopt stories, identity vs contact Duplicate / cutoff filters, the lying phone-name-date store, the unscoped Booking query, the local Job fold, CLI-without-connection, or `HANDOFF.md`.
- Starting Owner approve, Sheets write, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
