# Pair Each Best Relocation Booking With A Form Or Call Lead, Then Pair Each Refund With Its Booking — Never Apply The 0.9 Cut, Never Treat LID_BestRelo As A Lead, Never Let Weak Refund Evidence Steal The Job — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 3 of this service — `matching.ts`
- Remaining in this service: `plan.ts`, `applicationPlan.ts`, `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/matching.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Happy-path step 3: leftover `LID_BestRelo` is matching evidence only — never an action. Skip/fail: unmatched Booking → leadless Booking **plus** one reconciliation conflict; unmatched / below-threshold refund → blocking conflict, never invent a Cancellation. Primary-code list names leftover `canonicalLeadAdoption.ts` / leftover `sheets.ts` / leftover `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the matcher owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md) (that file windows; this file never windows). Distinct from already-recommended leftover parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file **asks** leftover `nameTokens` / leftover `normalizePersonName` / leftover `toDateKeyFromRaw`; it does not parse). Distinct from later leftover plan / collapse / 0.9 cut: leftover `plan.ts` (`DEFAULT_MATCH_THRESHOLD = 0.9`; leftover `buildIngestPlan` **asks** all three exports, then drops leftover `lid_best_relo` and every score below the cut). Distinct from later leftover application plan: leftover `applicationPlan.ts` (`AUTO_LINK_THRESHOLD = 0.9`, leftover `MATCH_CALIBRATION_VERSION = "best-relocation-conservative-v2"`; **asks** leftover refund pair + leftover refund keep; lead pairing only through leftover `buildIngestPlan`). Distinct from later leftover Mongo adopt: leftover `canonicalLeadAdoption.ts` (existing Vantage Form / Call / Booking / Cancellation; sheet `ref_no` / `lid` / phone+name+day). This file pairs **sheet rows to sheet rows**. Do **not** unify. Distinct from already-recommended Duplicate Lead: [`leads-duplicate-lead.md`](leads-duplicate-lead.md). Distinct from already-recommended Granot form matcher: [`granot-http-collector-form-lead-matcher.md`](granot-http-collector-form-lead-matcher.md). Distinct from already-recommended booked Call Lead recon: [`reconciliation-booked-call-lead.md`](reconciliation-booked-call-lead.md). Distinct from already-recommended Booking Identity Job fold: [`bookings-booking-identity.md`](bookings-booking-identity.md) — leftover `plan.ts` / leftover `applicationPlan.ts` fold Jobs; this file compares already-folded leftover `normalized_job_no`. Distinct from already-recommended Lead phone sieve: [`leads-lead-phone-matching.md`](leads-lead-phone-matching.md) + `src/utils/phone.ts` `normalizePhoneNumberForMatch` — this file **asks** that fold on leftover `form_fill_checker` phones. Folder `HANDOFF.md` is not knowledge — do not copy it (it still says leftover threshold `0.5` and a refund order the code does not run). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: leftover `plan.ts` `buildIngestPlan` → `matchLeadsToBookings(data)`, `matchRefundsToBookings(data.refunds, data.booked)`, `selectBestRelocationRefundObservations(data.refunds, data.booked)` — leftover `leadMatchResult.unmatchedBookings` is unused; leftover plan rebuilds leadless Jobs from leftover accepted matches after the 0.9 cut. Leftover `applicationPlan.ts` → leftover `matchRefundsToBookings` + leftover `selectBestRelocationRefundObservations` a second time (unmatched / review-only refunds become leftover `unmatched_refund` blocking conflicts; lead pairing only via leftover `buildIngestPlan`). Barrel `index.ts` re-exports all three. Folder test `bestRelocationSheetIngest.test.ts` → leftover `matchRefundsToBookings` on contradictory LID / unique-Job review evidence; leftover `buildIngestPlan` proves leftover Form leftover `lid_exact` attach. Leftover `ingestion/ingestion.test.ts` does **not** import this file. Leftover `adapter.ts` / leftover CLI / leftover `provider.ts` / leftover `apply.ts` / Wave B `src/routes/ingestion.routes.ts` do not import this file.
- Seams callers need: pair-then-threshold (this file never applies 0.9); leftover `lid_best_relo_only` is evidence, not a Lead (leftover plan plans it leadless); review-only refunds (`confidence < 0.9`) must not consume the Booking; Forms and Local Forms are one lead pool; only leftover `is_best_relocation_source` Bookings enter; Call pairing only leftover Inbounds Bookings that are still free; one Booking, one pairing. There is no Domain Command seam. There is no window seam. There is no apply seam. There is no Mongo-adopt seam.
- Split later (only if the file outgrows one sitting): this ~550-line file is one sitting if you read it as pair each Best Relocation Booking with a Form or Call Lead, then pair each Refund with its Booking. Do **not** split into `match.ts` / `score.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `plan.ts` threshold, leftover `applicationPlan.ts` conflicts, leftover `canonicalLeadAdoption.ts`, leftover `parsing.ts`, or leftover `sheets.ts` here. If it later splits: `pairEachBestRelocationBookingWithAFormOrCallLead.ts` / `pairEachBestRelocationRefundWithItsBookingWithoutLettingWeakEvidenceStealTheJob.ts` / `keepOnlyRefundsThatBelongToABestRelocationBooking.ts` only as later story files, never CRUD.

`matchLeadsToBookings` / `matchRefundsToBookings` / `selectBestRelocationRefundObservations` are executor mechanics. The owner question is: *The leftover reader already windowed the tabs and leftover parse already typed every row. Pair each Best Relocation Booked Deal with a Form or a Call when the sheet says so. Try Lead ID, then Tracking Reference, then name and date, then a fuzzy name, then a phone bridge through Calls. Leftover Inbounds Bookings that are still free may pair with a booked Call on the same day or the next day. LID_BestRelo can only say “this LID is in the book” — it is not a Lead, and leftover plan will still book that Job leadless. Then pair each Refund that belongs to a Best Relocation Booking. Job plus Agent, Job plus customer, or the same LID may auto-cancel. A unique Job alone, or matching money, is review evidence and must not steal the Job from a later Refund that can auto-cancel. This file does not apply the 0.9 cut. This file does not window. This file does not adopt a Mongo Lead. This file does not apply.*

Leftover window / leftover parse / leftover threshold / leftover collapse / leftover Mongo adopt / leftover apply already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “pair each Best Relocation Booking with a Form or Call Lead, then pair each Refund with its Booking” story, not “a match CRUD helper,” and not leftover window / leftover parse / leftover 0.9 cut / leftover apply.

1. **Pair each Best Relocation Booking with a Form or Call Lead** — leftover `matchLeadsToBookings({ forms, localForms, calls, booked, lidBestRelo })`. Pool Forms and Local Forms. Keep only leftover `is_best_relocation_source` Booked Deals. One Booking, one pairing (`matchedBookings` is leftover `sheet_row`). Walk leftover methods in this order and stop when the Booking is taken:
   - leftover `lid_exact` (1) — Booking leftover `lid` equals a Form leftover `lead_id` (newest timestamp wins the index).
   - leftover `ref_no_exact` (0.95) — same leftover `lid` equals a Form leftover `ref_no`.
   - leftover `name_date_window` (0.75) — leftover `normalized_customer_name` equals leftover `normalized_name`, and leftover Form leftover `timestamp_ms` sits from book-minus-90-days through book-plus-one-day.
   - leftover `name_token_date_window` (0.65) — a leftover `customer_name_tokens` hit plus the same date window.
   - leftover `name_fuzzy_date_window` (min(0.8, score)) — leftover `fuzzyNameScore` ≥ 0.88 plus the same date window.
   - leftover `phone_form_bridge` (0.7) — leftover fuzzy name ≥ 0.88, Form leftover `normalized_phone` has Calls, prefer a leftover `booked` Call within two days of leftover `Book Date`, else seven days, else any unused Call. The Call is then consumed so it cannot pair later.
   - leftover `call_same_day_unique` (0.62) / leftover `call_same_day_amount_tier` (0.55 + 0.03×score) / leftover `call_date_window_unique` (0.58 same day, 0.5 next day) — only leftover Inbounds Bookings still free, only Calls whose leftover `booked_flag` matches `/booked/i`. Amount tiers are 0 / 2 / 4 from leftover Binder/Deposit vs leftover `over_2000` / leftover `over_4000`. ±1 calendar day. Unique pair or leftover clear winner (score margin +2).
   - leftover `lid_best_relo_only` (0.55) — Booking leftover `lid` is in leftover `LID_BestRelo`. Lead kind is leftover `lid_best_relo`, not a Form or Call. Leftover plan **drops** this from leftover accepted matches and still books the Job leadless.

   A Form already used may be reused only for leftover `lid_exact` / leftover `ref_no_exact`. A Call is never reused. Leftover `form_fill_checker` phones are folded through leftover `normalizePhoneNumberForMatch` **after** leftover `phone_form_bridge`, so they only help the leftover Inbounds Call methods. This function does not apply 0.9. This function does not collapse two agents on the same Job.

2. **Pair each Best Relocation Refund with its Booking without letting weak evidence steal the Job** — leftover `matchRefundsToBookings(refunds, bookings)`. First leftover `selectBestRelocationRefundObservations`. Index leftover BR Bookings by leftover `normalized_job_no`. For each Refund, try leftover methods in **this** order (not leftover `HANDOFF.md`):
   - leftover `job_no_agent` (1) — unique leftover Job plus leftover `normalized_agent`.
   - leftover `job_no_customer` (0.9) — unique leftover Job plus leftover `normalized_customer_name`.
   - leftover `lid_exact` (0.9) — unique leftover Booking leftover `lid`, and either no Job candidates or that Booking is already among them.
   - leftover `job_no_unique` (0.85) — unique leftover Job alone. Comment: leftover `AUTO_LINK_THRESHOLD` 0.9; auto-cancel needs Agent, customer, or LID.
   - leftover `job_no_amounts` (0.85) — unique leftover Job plus leftover Binder and Deposit within leftover `0.02`.
   - leftover `customer_book_date` (0.7) — unique leftover customer plus leftover `book_date` calendar day, even without a Job.

   Leftover `push` writes leftover `usedRows` **only when leftover `confidence >= 0.9`**. Review-only evidence must not consume the Booking before a later Refund with corroborated evidence can reach the unattended cut. Folder test: leftover Job `P100` plus a contradictory leftover LID stays leftover `job_no_unique` 0.85; a later leftover LID on the same Booking still reaches leftover `lid_exact` 0.9. This function does not invent a Cancellation. This function does not apply.

3. **Keep only Refunds that belong to a Best Relocation Booking** — leftover `selectBestRelocationRefundObservations(refunds, bookings)`. Keep a Refund when leftover `is_best_relocation_source` **or** its leftover `normalized_job_no` is already on a leftover BR Booking **or** its leftover `lid` is already on a leftover BR Booking. A leftover Other Source Refund with no Job and no LID on a leftover BR Booking is dropped before pairing. Leftover `matchRefundsToBookings` **asks** this function. Leftover `plan.ts` **asks** it again for leftover `summary.refunds`. Leftover `applicationPlan.ts` **asks** it again for leftover unmatched-refund conflicts.

Shared beats, not owner operations: leftover `daysBetweenKeys` (UTC midnight on leftover date keys), leftover `bookingDateKey` (leftover raw leftover `Book Date` then leftover `book_date`), leftover `callDateKey` (leftover `date` then leftover `timestamp`), leftover `withinNameDateWindow` (book − 90 days through book + 1 day), leftover `levenshtein` / leftover `fuzzyNameScore` (last name length ≥ 3 and equal; first exact 0.95; first edit-distance ≤ 1 → 0.88; token exact 0.98), leftover `truthyFlag` / leftover `amountTier` / leftover `callAmountTier` / leftover `bookingAmountTier`, leftover `extractPhones`, leftover `moneyClose`.

## Organization

Keep one file as the screenplay for “pair each Best Relocation Booking with a Form or Call Lead, then pair each Refund with its Booking — never apply the 0.9 cut, never treat LID_BestRelo as a Lead, never let weak refund evidence steal the Job.” Leftover window, leftover parse, leftover 0.9 cut, leftover collapse, leftover Mongo adopt, leftover apply already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationMatchService` class. Do not invent a begin / complete **seam** here — pair is not a Domain Command. Do not invent a threshold **adapter** here — leftover `plan.ts` / leftover `applicationPlan.ts` already own leftover `0.9`. Do not invent a second phone **adapter** beside leftover `normalizePhoneNumberForMatch`. Do not invent a Mongo-adopt **adapter** here.

**External interface** stays small (this is the test surface). Three faces leftover plan / leftover application plan / leftover tests already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `matchLeadsToBookings` | `pairEachBestRelocationBookingWithAFormOrCallLead` | leftover `buildIngestPlan`; returns every pairing including leftover review scores and leftover `lid_best_relo_only` |
| `matchRefundsToBookings` | `pairEachBestRelocationRefundWithItsBookingWithoutLettingWeakEvidenceStealTheJob` | leftover plan + leftover application-plan unmatched-refund conflicts; folder test |
| `selectBestRelocationRefundObservations` | `keepOnlyRefundsThatBelongToABestRelocationBooking` | leftover plan summary + leftover application-plan conflict walk; leftover refund pair **asks** it first |

Keep the old names as one-line aliases until leftover `plan.ts`, leftover `applicationPlan.ts`, the barrel, and the folder test migrate. Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the pairing leftover plan already filters:

```ts
type BestRelocationSheetPairing = {
  method: LeadMatchMethod | RefundMatchMethod
  confidence: number
  booking: ParsedBookedDeal
  // today's LeadBookingMatch.lead | RefundBookingMatch.refund
}
```

That is the handoff from “these two sheet rows belong together” to “leftover `plan.ts` may keep it if leftover `confidence >= 0.9` and the Lead is not leftover `lid_best_relo`.” Do **not** put leftover `in_window` on that object so “match owns the cutoff,” do **not** put leftover `accepted: confidence >= 0.9` so “match owns the unattended cut,” and do **not** put leftover `lead_ref` so “match can apply.”

`LeadBookingMatch` / `RefundBookingMatch` / `LeadMatchMethod` / `RefundMatchMethod` / `LidBestReloEntry` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// matching.ts
// The leftover reader already windowed the tabs.
// Leftover parse already typed every row.
// Pair each Best Relocation Booked Deal with a Form or a Call.
// Try Lead ID, then Tracking Reference, then name and date,
// then a fuzzy name, then a phone bridge through Calls.
// Leftover Inbounds Bookings still free may pair with a booked Call
// on the same day or the next day.
// LID_BestRelo can only say “this LID is in the book.”
// It is not a Lead. Leftover plan will still book that Job leadless.
// Then pair each Refund that belongs to a Best Relocation Booking.
// Job plus Agent, Job plus customer, or the same LID may auto-cancel.
// A unique Job alone must not steal the Job from a later Refund.
// This file does not apply the 0.9 cut.
// This file does not window. This file does not adopt. This file does not apply.

// ── 1. Pair each Booking with a Form or Call Lead ─────────

export function pairEachBestRelocationBookingWithAFormOrCallLead(input)
function keepOnlyBestRelocationBookedDeals(booked)
function poolFormsAndLocalForms(forms, localForms)
function rememberTheNewestFormByLeadIdAndTrackingReference(forms)
function pairByExactLeadId(booking, byLid)            // lid_exact / 1
function pairByExactTrackingReference(booking, byRef) // ref_no_exact / 0.95
function pairBySameNameInsideTheNinetyDayWindow(booking, byName)
function pairByASharedNameTokenInsideTheNinetyDayWindow(booking, byToken)
function pairByAFuzzyNameInsideTheNinetyDayWindow(booking, forms)
function pairByTheFormPhoneAndANearbyBookedCall(booking, forms, callsByPhone)
function pairLeftoverInboundsBookingsWithBookedCallsOnTheSameDay(bookings, calls)
function pairLeftoverInboundsBookingsWithBookedCallsByAmountTier(bookings, calls)
function pairLeftoverInboundsBookingsWithBookedCallsInsideOneDay(bookings, calls)
function rememberLidBestReloMembershipOnly(booking, lidBestRelo) // not a Lead
function refuseASecondPairingOnTheSameBooking(booking)
function aFormMayBeReusedOnlyForExactLeadIdOrTrackingReference(form, method)

// ── 2. Pair each Refund without letting weak evidence steal the Job ─

export function pairEachBestRelocationRefundWithItsBookingWithoutLettingWeakEvidenceStealTheJob(
  refunds,
  bookings,
)
function pairByJobAndAgent(refund, candidates)        // 1 — consumes
function pairByJobAndCustomer(refund, candidates)     // 0.9 — consumes
function pairByTheSameLidWhenTheJobAgreesOrIsMissing(refund, bookings)
function pairByUniqueJobAsReviewEvidenceOnly(refund, candidates) // 0.85 — does not consume
function pairByJobAndMatchingMoneyAsReviewEvidenceOnly(refund, candidates)
function pairByCustomerAndBookDateAsReviewEvidenceOnly(refund, bookings)
function consumeTheBookingOnlyWhenTheScoreClearsUnattended(confidence) // >= 0.9

// ── 3. Keep only Refunds that belong to a Best Relocation Booking ─

export function keepOnlyRefundsThatBelongToABestRelocationBooking(refunds, bookings)
function theRefundIsItselfABestRelocationSource(refund)
function theRefundJobAlreadySitsOnABestRelocationBooking(refund, jobs)
function theRefundLidAlreadySitsOnABestRelocationBooking(refund, lids)
```

Read the primary path out loud: *Pool Forms and Local Forms. Keep only Best Relocation Booked Deals. For each Booking, try Lead ID, then Tracking Reference, then the same folded name inside ninety days before the book date and one day after, then a name token, then a fuzzy first name with the same last name, then a Form whose phone has a nearby booked Call. One Booking, one pairing. A Form already used may be reused only for an exact Lead ID or Tracking Reference. Leftover Inbounds Bookings that are still free may pair with a booked Call on the same day, or by amount tier, or on the next day when the pair is unique or clearly better. If the Booking’s LID is only on LID_BestRelo, remember that as evidence — leftover plan will still book the Job leadless. Then keep only Refunds that are Best Relocation, or that already share a Job or LID with a Best Relocation Booking. Pair those Refunds by Job plus Agent, Job plus customer, or the same LID. A unique Job alone is review evidence and must not consume the Booking. Leftover plan applies 0.9. This file never does.*

That is the operation. `matchLeadsToBookings` is not.

## Precise logic I would tighten while renaming

1. **This file never applies 0.9.** Leftover `plan.DEFAULT_MATCH_THRESHOLD` and leftover `applicationPlan.AUTO_LINK_THRESHOLD` are both `0.9`. Leftover `HANDOFF.md` still says leftover `0.5` and leftover `BR_MATCH_CONFIDENCE_THRESHOLD`. Do not start filtering leftover `matches` here so “the matcher owns unattended.” Do not silently rewrite leftover `HANDOFF.md` in this rename.

2. **Leftover `lid_best_relo_only` is not a Lead.** This file marks the Booking paired. Leftover `buildIngestPlan` drops leftover `lead.kind === "lid_best_relo"` from leftover accepted matches and warns that those Jobs were planned leadless. Knowledge: leftover `LID_BestRelo` is matching evidence only — never an action. Do not attach a Form or invent a Call from leftover `LID_BestRelo` in this rename.

3. **Leftover `unmatchedBookings` is unused.** Leftover `plan.ts` reads leftover `leadMatchResult.matches` and rebuilds leftover leadless Jobs after the 0.9 cut and leftover Job collapse. A leftover `lid_best_relo_only` Booking is **not** in leftover `unmatchedBookings` and **is** leftover leadless in leftover plan. Name the two leftover “unmatched” meanings. Do not switch leftover plan onto leftover `unmatchedBookings` in this rename.

4. **Refund consume vs leftover HANDOFF order.** Code: leftover `job_no_agent` → leftover `job_no_customer` → leftover `lid_exact` → leftover `job_no_unique` → leftover `job_no_amounts` → leftover `customer_book_date`. Leftover `HANDOFF.md` lists leftover `job_no_unique` before leftover `job_no_customer`. Review-only (`< 0.9`) does not write leftover `usedRows`. Folder test locks leftover contradictory LID as leftover `job_no_unique` 0.85 then leftover `lid_exact` 0.9 on the same leftover `P100`. Do not consume on leftover `0.85`. Do not reorder leftover HANDOFF so “the handoff wins.”

5. **Leftover `lid_exact` on Refunds is not free-floating.** Unique leftover Booking leftover `lid`, **and** (`candidates.length === 0` **or** that Booking is already a leftover Job candidate). Folder test leftover Refund 1 (leftover Job `P100`, leftover LID of leftover `P200`) fails that gate and falls through to leftover `job_no_unique`. Do not drop the leftover Job-agrees clause so “LID always wins.”

6. **Call pairing is leftover Inbounds only.** Leftover `availableBookings` requires leftover `/inbounds/i` on leftover `lead_source` **and** the Booking still free. Leftover Forms / leftover Locals Bookings never enter leftover `call_same_day_*`. Leftover `form_fill_checker` phones are indexed **after** leftover `phone_form_bridge`. Do not let leftover Forms Bookings pair by leftover Call same-day in this rename.

7. **Name window is book − 90 days through book + 1 day.** Leftover `withinNameDateWindow`. Leftover fuzzy last name must be length ≥ 3 and equal. Do not widen to leftover RingCentral ±12 hours or leftover Duplicate Lead 90-day-earlier-only. Do not silently reuse leftover `leads/duplicateLead.service.ts`.

8. **Newest Form wins leftover `byLid` / leftover `byRef`.** Leftover `timestamp_ms` descending. Leftover `byName` / leftover `byToken` keep every Form and sort newest first; leftover `name_date_window` takes the first unused inside the window. Do not make leftover name indexes also newest-wins-only so “one Form per name.”

9. **Leave sibling modules alone.** Leftover `parsing.ts` folds, leftover `plan.ts` 0.9 + leftover collapse, leftover `applicationPlan.ts` leftover `unmatched_refund` conflicts + leftover leadless leftover `matching` evidence, leftover `canonicalLeadAdoption.ts` Mongo adopt, leftover `sheets.ts` window are already the right **depth**.

10. **Never start pairing Local Calls.** Leftover `sheets.ts` never reads that tab. This file has no Local Calls path. Do not add one.

11. **This is not leftover Mongo adopt.** Leftover `canonicalLeadAdoption.ts` pairs a windowed sheet create with an existing Vantage Form / Call / Booking / Cancellation. This file never opens Mongo. Do not import leftover adopt here so “one matcher.”

## Testing

The **interface** is the test surface: leftover `pairEachBestRelocationBookingWithAFormOrCallLead`, leftover `pairEachBestRelocationRefundWithItsBookingWithoutLettingWeakEvidenceStealTheJob`, leftover `keepOnlyRefundsThatBelongToABestRelocationBooking`.

Today’s leftover `bestRelocationSheetIngest.test.ts` proves leftover Form leftover `lid_exact` attach through leftover `buildIngestPlan`, and leftover refund leftover `job_no_unique` 0.85 plus leftover `lid_exact` 0.9 on leftover contradictory LID. Leftover `ingestion.test.ts` does not **ask** this file. That is not enough for a story this long.

Replace the stub-as-plan-fixture style with tests that name the operation:

**Pair each Booking with a Form or Call Lead**
- Leftover Booking leftover `lid` equals leftover Form leftover `lead_id` → leftover `lid_exact` / 1. Newest leftover Form wins the index.
- Leftover Booking leftover `lid` equals leftover Form leftover `ref_no` → leftover `ref_no_exact` / 0.95.
- Same leftover folded name inside leftover book − 90 days through leftover book + 1 day → leftover `name_date_window` / 0.75. Outside the window, no pair.
- Leftover fuzzy last-name match with leftover first-name edit-distance 1 → leftover `name_fuzzy_date_window` and leftover `confidence === min(0.8, score)`. Last name shorter than 3 does not pair.
- Leftover `phone_form_bridge` consumes the leftover Call so leftover `call_same_day_unique` cannot take it later.
- Leftover Inbounds leftover Booking, one leftover booked Call on that leftover `Book Date` → leftover `call_same_day_unique` / 0.62. Leftover Forms leftover Lead Source does **not** enter this method.
- Leftover `lid_best_relo_only` / 0.55 when leftover `LID_BestRelo` has the leftover LID and no Form/Call paired. Leftover `matches[].lead.kind === "lid_best_relo"`.
- A leftover Booking that is not leftover `is_best_relocation_source` is absent from leftover `matches` and leftover `unmatchedBookings`.
- A leftover Form already used is reused only for leftover `lid_exact` / leftover `ref_no_exact`.
- Leftover `unmatchedBookings` lists leftover BR Bookings with no pairing at all — including none of the leftover `lid_best_relo_only` Bookings.

**Pair each Refund without letting weak evidence steal the Job**
- Leftover Job plus leftover Agent → leftover `job_no_agent` / 1 and the Booking is consumed.
- Leftover Job plus leftover customer, different Agent → leftover `job_no_customer` / 0.9 and the Booking is consumed.
- Folder-test leftover contradictory LID: leftover `job_no_unique` / 0.85 does **not** consume; later leftover `lid_exact` / 0.9 on the same leftover `P100` still pairs.
- Leftover unique Job alone is leftover `0.85`. Leftover `buildIngestPlan` leftover `summary.unmatched_refunds` still counts it (0.9 cut lives in leftover plan).
- Leftover Binder / Deposit within leftover `0.02` on a leftover multi-row leftover Job → leftover `job_no_amounts` / 0.85 and does not consume.

**Keep only Refunds that belong to a Best Relocation Booking**
- Leftover Other Source, leftover Job on a leftover BR Booking → kept.
- Leftover Other Source, leftover LID on a leftover BR Booking, leftover Job missing from leftover BR Bookings → kept.
- Leftover Other Source, leftover Job not on a leftover BR Booking, no leftover LID → dropped. Folder-test leftover `OTHER` Refund is this case (`unmatched.length === 0` because it never entered pairing).

Do **not** add a helper-unit test that has to change when leftover `refuseASecondPairingOnTheSameBooking` is inlined. Do **not** add a test per leftover `levenshtein` / leftover `truthyFlag` / leftover `amountTier`.

Caller to keep green: leftover `buildIngestPlan` still attaches leftover `lid_exact` Form Bookings and still plans leftover `lid_best_relo_only` leadless; leftover `applicationPlan.ts` still opens leftover `unmatched_refund` on leftover review-only / leftover unmatched Refunds; leftover folder contradictory-LID test; leftover Form leftover `lid_exact` plan test.

## What I would not do

- A `BestRelocationMatchService` class with `match` / `score` / `select`.
- Thirty two-line functions that only wrap leftover `daysBetweenKeys`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `match.ts` / `score.ts` split “for cleanliness.”
- Breaking leftover pair-then-threshold. Leftover `plan.ts` / leftover `applicationPlan.ts` own leftover `0.9`. This file must not start filtering leftover `matches`.
- Treating leftover `canonicalLeadAdoption.ts` as this story. Sheet-to-sheet pairing is not Mongo adopt.
- Treating leftover Duplicate Lead, leftover Granot form matcher, leftover booked Call Lead recon, or leftover RingCentral duplicate guard as this story.
- Making leftover `LID_BestRelo` a Lead, windowing it, or reading Local Calls.
- Silently “fixing” leftover `HANDOFF.md` leftover `0.5` / leftover refund order, leftover unused leftover `unmatchedBookings`, or leftover `applicationPlan.ts` leftover second leftover refund walk.
- Applying leftover Bookings or leftover Cancellations from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
