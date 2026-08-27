# Hand The Owner The Granot Statement That Opened This Intake — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 16 of this service — `creatingObservation.ts`
- Remaining in this service: `drainer.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/creatingObservation.ts`
- Knowledge: no dedicated `creating-observation.md`. The Creating-observation section lives on [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md). That Service file also lists `projections.ts`, `bookingPriorityPairing.ts`, `alerts.ts`, the admin routes, and Zod as primary code — they are siblings, not this pass. Pairing DTO contract: [`docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md`](../../../docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) §7.4 / AC-P1 / AC-P3 / AC-P6 / AC-P7. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`creatingObservation.ts` row). Distinct from Admin queue / case / candidates / timelines / health: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from pairing class: next-but-later `bookingPriorityPairing.ts`. Distinct from receipt insert: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md). Distinct from credential redact: `receiptEvidence.ts` (already skipped). Distinct from fenced claim / pending clock: next module `drainer.ts`. Distinct from official Booking / Cancellation Owner commands: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / Granot Booking Reconciliation Case / Job Number — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/granot-lifecycle-admin.routes.ts` (`GET .../cases/:case_id/creating-observation` → `getIntakeCreatingObservation` after `requireRegistryOwnerActor`; missing envelope → `GRANOT_CASE_NOT_FOUND`). `projections.ts` (`selectCreatingObservationEvidence` only — case detail / compact list / list pairing wrappers; it does not call the envelope getters). Tests: `creatingObservation.test.ts` (prefer Booked / latest-creating fallback / redacted Booked statement / Booking miss does not fall through to Release / AC-P1 pairing+paired snapshot / AC-P3 Booked-without-5 / AC-P6 historical Priority-5-only / prefer Release / redacted Release + null pairing / unified Booking-first / neither case null). Route: `granot-lifecycle-admin.routes.test.ts` (Owner-only 403 for Admin; Booked statement 200; missing 404; Release statement 200). No replica file. Not callers: `processor.ts`, `drainer.ts`, `bookingReconciliation.ts`, `releaseReconciliation.ts`, `bookingOwnerCommands.ts`, `discrepancyProjections.ts`.
- Seams callers need: Owner-only route vs Admin 403; Booking-case getter vs Release-case getter vs Booking-first route default; prefer-Booked vs prefer-Release vs `latest_creating` fallback; credential-redacted `granot_statement` vs paired Priority 5 snapshot without a second payload; pairing only when Booking evidence is Booked **and** the Observation’s action is Booked **and** the Job Number is present; injected `CreatingObservationLoaders` for tests
- Split later (only if the file outgrows one sitting): keep one file — this ~351-line Owner-intake screenplay is one sitting. If it later splits: `chooseWhichBookedEvidenceOpenedThisCase.ts` / `handTheOwnerTheBookedGranotStatement.ts` / `handTheOwnerTheReleaseGranotStatement.ts` — never `get.ts` / `list.ts` / `create.ts` / `update.ts` / `delete.ts`

`getIntakeCreatingObservation` / `getBookingIntakeCreatingObservation` / `getCancellationIntakeCreatingObservation` are executor mechanics. The owner question is: *Hand the Owner the Granot statement that opened this intake so they can see what Granot said — Booked or Release — before they confirm, update, or take No Action. Prefer the Booked (or Release) evidence. If this is an old Priority-5-only Booking case, show the latest creating evidence and do not invent a pairing. Redact credentials. A preceding Priority 5 may ride along as a snapshot without a second raw payload. This read never confirms. It never cancels. It never attaches a Lead.*

Case list/detail, pairing class, credential-key tables, and Owner commands already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one Owner-intake-read story, not “a creating-observation CRUD service,” and not the Admin queue / pairing class / confirm command:

1. **Choose which Booking-case evidence opened the intake** — from the case’s evidence array, take the newest `booked` row (`selection: "preferred_booked"`). If none, take the newest row of any action (`latest_creating`) so a historical Priority-5-only case still reads. Empty evidence is null. This function does not load Mongo. This function does not pair Priority 5.

2. **Choose which Release-case evidence opened the intake** — same clock, other action: newest `release` (`preferred_release`), else newest creating (`latest_creating`). Empty evidence is null. This function does not load Mongo. This function does not pair Priority 5.

3. **Hand the Owner the Booked Granot statement for this Booking intake** — load the Booking case. If the case is missing, stop (null; the route 404s). Pick creating evidence. Load that Observation; if it is gone, stop. Load the receipt payload when it exists and run the sibling credential redact. Project identity, contact, move, booking action. Pair Priority 5 only when the selected evidence is `booked`, the Observation’s normalized action is `booked`, and the Job Number is present; then ask the sibling pairing class and optionally load the preceding Priority 5 snapshot **without** a second `granot_statement`. Historical Priority-5-only stays `latest_creating` with `priority_pairing: null`. Booked-without-5 is still 200 with the Booked statement. This function does not look at the Release collection. This function does not confirm a Booking.

4. **Hand the Owner the Release Granot statement for this Cancellation intake** — load the Release case. Pick Release creating evidence. Load Observation + redacted receipt. Project the same snapshot shape. `priority_pairing` is always `null`. Do not call job-observation pairing. This function does not look at the Booking collection. This function does not create a Cancellation.

5. **Find the intake for this case id** — Booking first, then Release. The Owner-only route default. A Booking hit wins even if a Release row could also match. Neither collection → null → `GRANOT_CASE_NOT_FOUND`. This function does not invent a third collection.

There is no sixth mutate operation. `compareEvidenceNewestFirst`, `iso`, `projectObservation`, `jsonSafe`, and `projectCreatingObservationPairing` are shared folds, not public stories. `CreatingObservationLoaders` is the test **adapter**, not a second persistence.

## Organization

Keep one file as the screenplay for “hand the Owner the Granot statement that opened this intake.” Admin queue/detail, pairing class, credential-key tables, and Owner confirm already live in deeper **modules**. Do not pull those in. Do not invent a `CreatingObservationService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this is a read. Do not invent a channel **seam** that has only one **adapter** here.

Do not move this into `projections.ts` so “knowledge lists both as primary code.” Do not move `projectBookingPriorityPairing` here so “pairing lives with the envelope.” Do not merge `receiptEvidence.ts` here so “redact lives with the statement.” Do not merge `bookingOwnerCommands.ts` here so “the Owner can confirm from the same file.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `selectCreatingObservationEvidence` | `chooseWhichBookedEvidenceOpenedThisCase` | Booking prefer-Booked; leaked to list/detail pairing |
| `selectReleaseCreatingObservationEvidence` | `chooseWhichReleaseEvidenceOpenedThisCase` | Release prefer-Release; not used by projections |
| `getBookingIntakeCreatingObservation` | `handTheOwnerTheBookedGranotStatement` | Booking collection only; may pair Priority 5 |
| `getCancellationIntakeCreatingObservation` | `handTheOwnerTheReleaseGranotStatement` | Release collection only; pairing stays null |
| `getIntakeCreatingObservation` | `findTheIntakeForThisCaseId` | route default; Booking first |

Keep the old names as one-line aliases until the admin router and `projections.ts` migrate. Do not make callers learn `CreatingObservationLoaders` / `projectObservation` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the envelope Admin already treats as “what Granot said when this intake opened”:

```ts
type TheGranotStatementThatOpenedThisIntake = {
  /* today's BookingIntakeCreatingObservation */
}
```

That is the handoff from “we picked an evidence row” to “here is the redacted statement, the selection reason, and (on Booking) the Priority pair.” Do **not** add a second `granot_statement` on the paired Priority 5 so “the Owner can see the Priority Update JSON,” and do **not** add `official_booking_details` so “the Owner can confirm from here.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// creatingObservation.ts
// Hand the Owner the Granot statement that opened this intake.
// Prefer Booked on a Booking case. Prefer Release on a Release case.
// An old Priority-5-only Booking case still reads. Do not invent a pair.
// Redact credentials. The preceding Priority 5 has no second payload.
// This read never confirms. It never cancels. It never attaches a Lead.

// ── 1. Choose which Booking-case evidence opened the intake ─

export function chooseWhichBookedEvidenceOpenedThisCase(evidence)
  // newest booked → preferred_booked
  // else newest row → latest_creating
  // empty → null

function newestEvidenceFirst(left, right)              // time, then observation id

// ── 2. Choose which Release-case evidence opened the intake ─

export function chooseWhichReleaseEvidenceOpenedThisCase(evidence)
  // newest release → preferred_release
  // else newest row → latest_creating
  // empty → null

// ── 3. Hand the Owner the Booked Granot statement ─────────

export async function handTheOwnerTheBookedGranotStatement(caseId, loaders?)

async function loadTheBookingCaseOrStop(caseId)
async function loadTheObservationOrStop(observationId)
async function redactTheReceiptPayload(receiptId)       // sibling redactCredentialKeys
function projectTheObservationTheOwnerWillRead(observation, fallbackTime)
async function pairPriorityFiveOnlyOnABookedCreatingStatement(selected, observation, jobNo)
  // else { priority_pairing: null }
  // sibling projectBookingPriorityPairing / toBookingPriorityPairingProjection
  // paired snapshot has no granot_statement

// ── 4. Hand the Owner the Release Granot statement ────────

export async function handTheOwnerTheReleaseGranotStatement(caseId, loaders?)

async function loadTheReleaseCaseOrStop(caseId)
  // same Observation + redact + project
  // priority_pairing: null
  // do not ask for job observations

// ── 5. Find the intake for this case id ───────────────────

export async function findTheIntakeForThisCaseId(caseId, loaders?)
  // Booking first, else Release
```

Read the primary path out loud: *The Owner opens the creating-observation accordion on an intake. Admin is refused. The route asks for this case id and looks in Booking first. If this is a Booking case, take the newest Booked evidence. Load that Observation. Strip Authorization from the receipt. Hand over identity, contact, move, and the Booked statement. If a Priority 5 on the same Job came before this Booked row, name the pair and show that Observation’s fields — not a second raw payload. If Granot booked without a 5, still return 200 with the Booked statement and no paired snapshot. If this case is an old Priority-5-only row, say `latest_creating` and leave pairing null. If the case is a Release intake, do the same with the newest Release evidence and never pair. Missing case, empty evidence, or a gone Observation is not found. A missing receipt is not not-found — the statement is just empty. Do not confirm. Do not cancel. Do not `$set` a Lead.*

That is the operation. `getIntakeCreatingObservation` is not. `getCancellationIntakeCreatingObservation` is not a cancel story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getCancellationIntakeCreatingObservation` names a Cancellation.** The loader is `findReleaseCase`. The route test says “cancellation intake.” Knowledge says Release Reconciliation Case. Do not start writing a `CancelledLead` so the function name “wins,” and do not delete the Release path so “this file is Booking-only.”

2. **One envelope type named `BookingIntakeCreatingObservation` carries Release.** Release rows reuse the Booking type and force `priority_pairing: null`. Do not invent a second DTO in this rename unless a caller already needs the discriminant, and do not add pairing on Release so “the type has a field.”

3. **Two envelope builders reprint the same beats.** Booking and Release both: load case → select → load Observation → redact receipt → `iso` → `projectObservation`. Pairing is the only Booking extra. Shared beats beat a third copy. Do not split `get.ts` / `releaseGet.ts` so each collection owns a file.

4. **Three absences, one 404.** Missing case, empty evidence, and missing Observation all return null. The route stamps `GRANOT_CASE_NOT_FOUND` for every null. A missing receipt does **not** 404 — `redactCredentialKeys(undefined)` yields `granot_statement: undefined`. Do not 404 a missing receipt so “every miss is a case miss,” and do not invent `GRANOT_OBSERVATION_NOT_FOUND` in this rename.

5. **Bad time is 400, not 404.** `iso` throws `VALIDATION_FAILED` when `captured_at` is not a date. Knowledge’s “missing → CASE_NOT_FOUND” list does not mention it. Do not map that throw to 404 so “every creating-observation miss is a case miss.”

6. **Knowledge lists this file as `projections.md` primary code.** `GET .../creating-observation` lives here. List/detail only import the Booking selector. Do not move the envelope getters into `projections.ts` so the Primary-code line “wins.” See [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md).

7. **Pairing is computed twice for the same creating Booked Observation.** This file loads job observations and calls the sibling. `projections.ts` selects with the same function, then pairs on list/detail. AC-P7 wants the same class. Do not import `getBookingIntakeCreatingObservation` from detail so “one function owns pairing,” and do not copy `projectBookingPriorityPairing` into this file so “the envelope is self-contained.”

8. **Pairing is stricter than selection.** `preferred_booked` can still yield `priority_pairing: null` when the Observation’s `booking_action.normalized` is not `booked` or the Job Number is missing. AC-P6 is the historical Priority-5 path (`latest_creating`). Do not pair on `latest_creating` so “every Booking envelope has a class,” and do not 404 Booked-without-5 so “no 5 means no intake.”

9. **The paired Priority 5 snapshot has no `granot_statement`.** AC-P1 locks `"granot_statement" in paired_priority_5_observation === false`. Pairing JSON must not contain contact or Authorization. Do not attach the Priority Update payload so “the Owner can see Granot,” and do not strip contact from the **creating** Observation so Unit 31 “wins.”

10. **This is the Owner-only receipt-payload exception.** Unit 31 still says case-detail contact is masked. Knowledge carves this read out: credential-redacted `granot_statement` plus the whole Observation contact. Do not remask the snapshot so the Unit-31 paragraph “wins,” and do not send raw `Authorization` so “the statement is complete.”

11. **Release never asks for job observations.** The Release unit loader throws if `findJobObservations` runs. Do not “helpfully” pair Release so AC-P7 “covers every envelope.”

12. **Booking getter does not fall through to Release.** The Booking-miss unit throws if `findReleaseCase` runs. Fall-through is only `findTheIntakeForThisCaseId`. Do not merge the two getters so “one function is simpler.”

13. **Leave sibling modules alone.** Pairing class stays in `bookingPriorityPairing.ts`. List/detail stay in `projections.ts`. Credential keys stay in `receiptEvidence.ts`. ObjectId construction stays in `utils/objectId.ts`. Claim/lease stays in `drainer.ts`. Confirm/cancel stay in the Owner command files.

14. **Do not treat confirm, cancel, attach, or drain as this story.** Those write official facts or claim a receipt. This file only shows what Granot said.

15. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `handTheOwnerTheBookedGranotStatement` (today `getBookingIntakeCreatingObservation`), `handTheOwnerTheReleaseGranotStatement` (today `getCancellationIntakeCreatingObservation`), `findTheIntakeForThisCaseId` (today `getIntakeCreatingObservation`), `chooseWhichBookedEvidenceOpenedThisCase` (today `selectCreatingObservationEvidence`), and `chooseWhichReleaseEvidenceOpenedThisCase` (today `selectReleaseCreatingObservationEvidence`).

Today’s `creatingObservation.test.ts` already locks prefer-Booked, latest-creating fallback, redacted Booked statement, Booking miss does not fall through, AC-P1 pairing + paired snapshot without `granot_statement`, AC-P3 Booked-without-5, AC-P6 historical null pairing, prefer-Release, redacted Release + null pairing, unified Booking-first, and neither-case null. The route file already locks Owner-only 403, Booked 200, missing 404, and Release 200. Keep those. Add the gaps that name the operation:

**Choose the creating evidence**
- Newest `booked` wins over a later `priority_5` (already locked).
- No `booked` → `latest_creating` (already locked).
- Newest `release` wins (already locked).
- Empty evidence is null (add this; today’s units always pass rows).
- Release with only `priority_5` / mixed non-release rows → `latest_creating` (add this; today’s Release unit only tests `preferred_release`).

**Hand the Owner the Booked statement**
- Credentials leave the statement; move dates become ISO (already locked).
- AC-P1 pair + paired snapshot; pairing JSON has no contact / Authorization (already locked).
- AC-P3 still 200 with no paired snapshot (already locked).
- AC-P6 `latest_creating` + `priority_pairing: null` (already locked).
- Missing Observation is null / route 404 (add this; today’s miss is only a missing case).
- Missing receipt is still 200 with no `Authorization` and no CASE_NOT_FOUND (add this).
- `preferred_booked` whose Observation action is not `booked` leaves pairing null (add this).
- This function does not confirm a Booking — do not add a test that it writes `BookedLead`.

**Hand the Owner the Release statement**
- Redacted Release statement + `priority_pairing: null` (already locked).
- Does not call `findJobObservations` (already locked by the throwing loader).
- This function does not create a Cancellation.

**Find the intake**
- Booking wins when that collection hits (already locked).
- Release when Booking misses (already locked).
- Neither is null (already locked).
- Admin 403 / Owner 200 (route already locked).

Do **not** add a test per helper (`newestEvidenceFirst`, `projectTheObservationTheOwnerWillRead`, `jsonSafe`, `iso`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test case-list compact pairing, job timelines, or Owner confirm here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, `$set`s a Lead, or confirms an official Booking. Do not rewrite `projections.test.ts` as if it covered this envelope.

## What I would not do

- A `CreatingObservationService` class with `get` / `select` / `list`.
- Thirty two-line functions that only wrap `findById().lean()`.
- Moving this into a CRUD folder, or into `projections.ts` / `bookingPriorityPairing.ts` / `receiptEvidence.ts` “for cleanliness.”
- Splitting `get.ts` / `releaseGet.ts` so each collection owns a file.
- Remasking Observation contact so the Unit-31 paragraph “wins.”
- Attaching a second `granot_statement` on the paired Priority 5.
- 404ing Booked-without-5, or pairing on `latest_creating`, so “every envelope has a class.”
- Falling the Booking getter through to Release so “one function is simpler.”
- Pairing a Release envelope so AC-P7 “covers every case.”
- Calling `confirmBooking` or `confirmCancellation` from this read.
- Writing a whole-folder recommendation for `granotLifecycle`.
