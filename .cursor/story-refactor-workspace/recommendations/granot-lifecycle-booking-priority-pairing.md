# Say How Priority 5 Sits Next To This Booked Observation — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 25 of this service — `bookingPriorityPairing.ts`
- Remaining in this service: `referralBooking.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/bookingPriorityPairing.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) lists this file as primary code beside `bookingReconciliation.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, the case model, and `processor.ts` — they are siblings, not this pass. The same file is also listed as primary code on [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) beside `projections.ts`, `creatingObservation.ts`, and `alerts.ts` — also siblings. Pairing authority: [`docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md`](../../../docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) §4.8 / §6.1 / AC-P1–P4 (this file is pure; persist snapshot and list later-query live in the callers). Temporal compare: [recommendations/granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Distinct from opening the case: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md). Distinct from creating-observation envelope: [recommendations/granot-lifecycle-creating-observation.md](granot-lifecycle-creating-observation.md). Distinct from list/detail DTO wrap: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from Owner confirm / replace / Referral mint: `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, next module `referralBooking.ts`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (pairing is the audit projection on Booking-case persist and Owner reads). This checkout’s `CONTEXT.md` does not define Booking Priority Pairing / Granot Booking Reconciliation Case — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three service callers, one type-only model.** `bookingReconciliation.ts` (`computePersistedPriorityPairing` → `projectBookingPriorityPairing` then `toPersistedPriorityPairing`; drops `later_priority_5`; same transaction as Booked open / new Booked append). `creatingObservation.ts` (`projectCreatingObservationPairing` → classify + `toBookingPriorityPairingProjection`; loads preceding Observation for `paired_priority_5_observation`; Release never calls). `projections.ts` (case-detail `projectCasePriorityPairing` wraps classify + wire; `compactCaseListPriorityPairing` prefers live pairing then snapshot; `listPriorityPairingByCase` recomputes `has_later_priority_5` itself and may classify only when the snapshot is missing). Model: `GranotBookingReconciliationCase.ts` imports `BookingPriorityPairingClass` only. Tests: `bookingPriorityPairing.test.ts` (AC-P1–P4 plus equal-tuple / other-job / latest-older / throw / wire). `projections.test.ts` builds a pairing for list/detail. Not callers: `processor.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, `releaseReconciliation.ts`, `releaseOwnerCommands.ts`, `granotTemporal.ts` (this file calls it), public `/api/v1/booked-leads`.
- Seams callers need: in-memory pairing (Dates, both neighbors) vs persist snapshot (ObjectIds, preceding only, no later); full wire DTO vs list pill; canonical-5 fold shared by class and neighbor filters; callers load job observations — this file does not
- Split later (only if the file outgrows one sitting): keep one file — this ~237-line module is one screenplay for “Granot booked this Job; say how Priority 5 sits next to that Booked Observation.” If it later splits: `sayHowPriorityFiveSitsNextToThisBookedObservation.ts` / `putThisPairingOnTheWire.ts` / `foldThisPairingIntoAListPill.ts` — story files, never `classify.ts` / `project.ts` / `list.ts`, and never merge case persist / creating-observation / list DTO into this file

`projectBookingPriorityPairing` / `toBookingPriorityPairingProjection` / `toListPriorityPairing` are executor mechanics. The owner question is: *Granot booked this Job. Did a standalone Priority Update set 5 first, did the Booked payload merely carry 5, or did we never get a valid 5 on that Booked row? Pair the creating Booked Observation with the latest same-job `priority_updated` canonical 5 on either side of the clock. A later 5 after Booked-without-5 is read-time only — never stored, never a trigger. Pairing never opens, refreshes, or sequences a case. Never treat `lead_created` with Priority 5 as the pair. Never treat another Job as the pair.*

Case open, Owner commands, list/detail DTO wrap, creating-observation envelope, and the temporal compare already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one audit-pairing story, not “a priority CRUD service,” and not the case open / the Owner confirm / the list DTO:

1. **Say how Priority 5 sits next to this Booked Observation** — refuse unless the creating row is an actual Booked Observation with a Job Number. Keep only same-job rows. Keep only `priority_updated` rows whose Priority is valid canonical `5`. The preceding neighbor is the latest of those that `compareGranotTemporal` calls older than Booked. The later neighbor is the latest that Booked is older than. Equal clock + equal Observation id is neither side. Class is locked: not valid canonical 5 on Booked → `booked_without_priority_5` even when a preceding 5 exists; else a preceding 5 → `priority_5_then_booked`; else `booked_carries_priority_5`. This function does not load Observations. This function does not write a case. This function does not increment `case_revision`.

2. **Put that pairing on the wire** — ISO-stringify the three clocks. Keep Observation ids, receipt ids, route, raw event type, and Priority flags. Drop contact, payload, headers, and Authorization. This function does not hide `later_priority_5` because a snapshot omitted it.

3. **Fold that pairing into a list pill** — class plus three booleans: Booked carries 5, a preceding 5 exists, a later 5 exists. This function does not query Mongo. Callers may overwrite `has_later_priority_5` after their own later-only query.

There is no fourth mutate operation. `isCanonicalPriorityFive` is the shared fold, not a public story. `latestWhere` / `temporal` / `toPairingRef` are beats. In-memory pairing, wire DTO, and list pill are three **adapters** of one “how does Priority 5 sit next to this Booked” rule. Persist snapshot lives in `bookingReconciliation.ts` — a fourth **adapter**, not this file.

## Organization

Keep one file as the screenplay for “say how Priority 5 sits next to this Booked Observation, then show the owner the pair without making pairing a trigger.” Case persist, creating-observation envelope, list/detail wrap, temporal compare, and Owner commands already live in deeper **modules**. Do not pull those in. Do not invent a `BookingPriorityPairingService` class. Do not invent a begin / complete **seam** — this is a pure classify plus two read folds, not a Domain Command. Do not invent a load **seam** that has only one **adapter** here; callers already load.

Do not move this into `bookingReconciliation.ts` so “knowledge lists both as primary code.” Do not move this into `projections.ts` so the other Primary-code line “wins.” Do not move this into `creatingObservation.ts` so “pairing lives with the envelope.” Do not move `compareGranotTemporal` here so “pairing owns time.” Do not split `classify.ts` / `project.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `projectBookingPriorityPairing` | `sayHowPriorityFiveSitsNextToThisBookedObservation` | persist snapshot, creating-observation, case detail, list fallback |
| `toBookingPriorityPairingProjection` | `putThisPairingOnTheWire` | case detail + creating-observation DTO |
| `toListPriorityPairing` | `foldThisPairingIntoAListPill` | queue pill; later boolean may be overwritten |
| `isCanonicalPriorityFive` | `thisPriorityIsValidCanonicalFive` | shared fold; keep exported until an accidental caller appears |
| `BookingPriorityPairingClass` | `HowPriorityFiveSitsNextToThisBooked` | locked three-way class |
| `BookingPriorityPairing` | `ThePairingForThisBookedObservation` | in-memory Dates + both neighbors |
| `BookingPriorityPairingProjection` | `ThePairingOnTheWire` | ISO clocks for Admin |
| `BookingPriorityPairingListItem` | `ThePairingOnTheQueue` | class + three booleans |
| `BookingPriorityPairingRef` | `ANeighborPriorityFiveObservation` | preceding or later Priority Update |
| `BookingPriorityPairingJobObservation` | `ASameJobObservationTheCallerAlreadyLoaded` | caller-owned load shape |

Keep the old names as one-line aliases until `bookingReconciliation.ts`, `creatingObservation.ts`, `projections.ts`, and the case model migrate. Do not make callers learn `latestWhere` / `temporal` as the domain language.

**Principle: old exports stay as aliases.** `projectBookingPriorityPairing`, `toBookingPriorityPairingProjection`, and `toListPriorityPairing` remain the imported names until those three callers point at the story names.

**No class for the workflow.** The type that *does* earn a name is the in-memory pairing both read **adapters** and the persist sibling share:

```ts
type ThePairingForThisBookedObservation = {
  pairing: "priority_5_then_booked" | "booked_carries_priority_5" | "booked_without_priority_5"
  creating_booked: { /* ids, clock, route, Priority flags */ }
  preceding_priority_5?: ANeighborPriorityFiveObservation
  later_priority_5?: ANeighborPriorityFiveObservation
}
```

That is the handoff from “we already have a creating Booked Observation and the same-job rows” to “persist preceding only, or show the owner both neighbors.” Do **not** add contact or payload so “the pair is complete,” do **not** drop `later_priority_5` from this type so “persist is the only shape,” and do **not** add a case id so “pairing can open the intake.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingPriorityPairing.ts
// Granot booked this Job.
// Did a standalone Priority Update set 5 first,
// did the Booked payload merely carry 5,
// or did we never get a valid 5 on that Booked row?
// Pair the creating Booked Observation with the latest
// same-job Priority Update on either side of the clock.
// A later 5 is read-time only.
// Pairing never opens a case.
// This file does not load Observations.
// This file does not write a Booking.

// ── 1. Say how Priority 5 sits next to this Booked Observation ──

export function sayHowPriorityFiveSitsNextToThisBookedObservation(input)
  refuseUnlessThisIsACreatingBookedObservation()
  refuseUnlessTheBookedRowNamesAJob()
  keepOnlyTheSameJob()
  keepOnlyStandalonePriorityFiveUpdates()
  pickTheLatestOlderPriorityFive()     // preceding; equal tuple is not older
  pickTheLatestNewerPriorityFive()     // later; equal tuple is not newer
  sayWhetherTheBookedRowItselfIsValidFive()
  chooseTheLockedClass()               // without-5 wins even if preceding exists

export function thisPriorityIsValidCanonicalFive(priority)
  // valid === true && canonical === "5"

export type HowPriorityFiveSitsNextToThisBooked =
  | "priority_5_then_booked"
  | "booked_carries_priority_5"
  | "booked_without_priority_5"

export type ThePairingForThisBookedObservation = { /* today's BookingPriorityPairing */ }
export type ANeighborPriorityFiveObservation = { /* today's BookingPriorityPairingRef */ }

// ── 2. Put that pairing on the wire ───────────────────────

export function putThisPairingOnTheWire(pairing)
  // ISO clocks; ids, route, Priority only
  // do not hide later_priority_5

export type ThePairingOnTheWire = { /* today's BookingPriorityPairingProjection */ }

// ── 3. Fold that pairing into a list pill ─────────────────

export function foldThisPairingIntoAListPill(pairing)
  // class + three booleans
  // callers may overwrite has_later_priority_5

export type ThePairingOnTheQueue = { /* today's BookingPriorityPairingListItem */ }
```

Read the primary path out loud: *The processor already opened or refreshed a Booking case from an actual Booked Observation — Priority 5 did not open it. The persist sibling already loaded same-job Observations. Now ask: how does Priority 5 sit next to this Booked row? Throw if the creating row is not Booked or has no Job Number. Ignore other jobs. Ignore `lead_created` that happens to carry 5. A preceding pair is only a `priority_updated` valid canonical 5 whose clock-then-id is older than Booked; when several qualify, keep the latest. A later pair is the same test on the other side of the clock. The same Observation at the same clock is neither neighbor. If the Booked row itself is not valid canonical 5, the class is `booked_without_priority_5` even when a preceding 5 exists — the alert wins; the preceding ref may still be named. If the Booked row is 5 and a preceding Update exists, that is the best case. If the Booked row is 5 and nothing older qualifies, the payload merely carried 5. Persist only class, creating flags, and preceding — never later. After commit, detail and creating-observation put both neighbors on the wire with ISO clocks and no contact. The queue pill uses the snapshot for the first three fields and always recomputes later so an Owner-fix after Booked-without-5 shows up without rewriting the case.*

That is the operation. `projectBookingPriorityPairing` is not. `maybeReconcileBooking` is not this classify.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`project` names a DTO fold and the classify.** Persist calls `projectBookingPriorityPairing` then throws away `later_priority_5`. Detail calls the same function then `toBookingPriorityPairingProjection`. A reader hears “project” and expects the wire shape. Do not drop `later_priority_5` from the in-memory type so “project matches persist,” and do not make persist store later so “one snapshot is complete.”

2. **`later_priority_5` is computed here, then computed again in `projections.ts`.** List `listPriorityPairingByCase` queries Priority 5 rows and runs `compareGranotTemporal` itself for `has_later_priority_5`, then may classify only when the snapshot is missing. Do not delete this file’s later neighbor so “list already knows,” and do not make list call classify on every row so “one function owns later” if the snapshot already has the first three fields.

3. **`booked_without_priority_5` still names a preceding 5.** AC-P3 locks the class as the alert and still returns `preceding_priority_5` when an older Update exists. Do not clear the ref so “without means no pair,” and do not promote that preceding 5 into `priority_5_then_booked` so “a 5 existed somewhere.”

4. **Equal temporal tuple is neither neighbor.** Pairing uses `compareGranotTemporal`, not `Date <`. A Priority Update with the same `captured_at` and the same Observation id as Booked is not older and not newer. Do not treat `<=` as preceding so “same-second counts,” and do not special-case Booked’s own id here — the temporal **module** already says `same`.

5. **`lead_created` with Priority 5 is not preceding.** Spec §4.5 locks preceding to `route_event_class === "priority_updated"`. A Booked payload that merely carries 5 is the class `booked_carries_priority_5`, not a neighbor. Do not accept any valid-5 row as preceding so “the owner can see the 5,” and do not treat the creating Booked row as its own preceding pair.

6. **This file does not load Observations.** Spec §6.1: callers load. Persist fabricates a creating Booked row from context (`creatingBookedFromContext`) and appends it onto `listJobObservations`. Creating-observation loads the real Observation. List may pass only Priority 5 rows when classifying a missing snapshot. Do not add a Mongo find here so “pairing is self-contained,” and do not change the persist fabricator in this rename so “the creating row looks like a real Observation.”

7. **`isCanonicalPriorityFive` is exported and unused outside this file.** Tests hit it directly. Persist / creating-observation / list go through classify. Do not persist the boolean on the Observation, and do not make callers fold before calling.

8. **Pairing is computed twice for the same creating Booked Observation.** Creating-observation loads job observations and classifies. Detail classifies again with the same selector. AC-P7 wants the same class. Already named on [recommendations/granot-lifecycle-creating-observation.md](granot-lifecycle-creating-observation.md). Do not import the envelope getter from detail so “one function owns pairing,” and do not copy classify into `projections.ts` so “the DTO is self-contained.”

9. **Knowledge lists this file on two Services.** `booking-reconciliation.md` and `projections.md` both say primary code. This file neither persists a case nor builds list/detail. Do not move it into either sibling so a Primary-code line “wins.”

10. **Pairing never increments `case_revision`.** Snapshot rides along with Booked open / new Booked append. Exact Observation replay does not rewrite it. Historical Priority-5-only cases have no snapshot. Do not bump `case_revision` so “the owner sees a new pair,” and do not backfill historical rows in this rename.

11. **Leave sibling modules alone.** Case open / snapshot persist stay in `bookingReconciliation.ts`. Wire wrap and later-only list query stay in `projections.ts`. Creating-observation envelope stays in `creatingObservation.ts`. Clock-then-id compare stays in `granotTemporal.ts`. Confirm / replace / Referral mint stay in their Owner command files. ObjectId construction stays in `utils/objectId.ts`.

12. **Do not treat case open, Owner confirm, Referral mint, or list contact masking as this story.** Those write a case, mint a Booking, or build a DTO. This file only classifies one Booked Observation against same-job Priority Updates.

13. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayHowPriorityFiveSitsNextToThisBookedObservation` (today `projectBookingPriorityPairing`), `putThisPairingOnTheWire` (today `toBookingPriorityPairingProjection`), and `foldThisPairingIntoAListPill` (today `toListPriorityPairing`). `HowPriorityFiveSitsNextToThisBooked` is part of that **interface**.

Today’s `bookingPriorityPairing.test.ts` already locks AC-P1 preceding Update → `priority_5_then_booked`, AC-P2 Booked-carries-5 with no preceding, AC-P3 missing/invalid/non-5/`valid:false` canonical 5 → `booked_without_priority_5` with preceding still named, AC-P4 later 5 is not preceding, equal tuple is neither, other jobs and `lead_created` 5 ignored, latest older wins, throw without Booked or Job Number, wire has no contact / phone / payload / Authorization, and list booleans match the pair. Keep those. Add the gaps that name the operation:

**Say how Priority 5 sits next to this Booked Observation**
- Booked valid 5 + preceding 5 + later 5 → class stays `priority_5_then_booked`; both neighbors named (class table does not let later change the pill).
- Several later 5s → latest newer wins (symmetric with the already-locked latest older).
- A Booked row that is itself `priority_updated` still throws — creating must be `booking_action.normalized === "booked"`.
- Same-job filter is `identity.normalized_job_no`, not raw Job.

**Put that pairing on the wire**
- `later_priority_5.captured_at` is ISO when present (AC-P4 already names the id; keep the clock).
- Wire type cannot carry contact / payload (JSON lock is enough; do not add a runtime reject list here).

**Fold that pairing into a list pill**
- `has_later_priority_5` follows this file’s later neighbor; callers may overwrite after their own query — do not assert Mongo here.

Do **not** add a test per helper (`keepOnlyTheSameJob`, `pickTheLatestOlderPriorityFive`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test case persist, creating-observation 404, list later-query, or Owner confirm here. Do not add a test that this file reads `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`, opens a case, or `$set`s `priority_pairing`. Do not add a test that Priority 5 without Booked opens an intake.

## What I would not do

- A `BookingPriorityPairingService` class with `create` / `update` / `project`.
- Thirty two-line functions that only wrap `compareGranotTemporal`.
- Moving this into a CRUD folder, or into `bookingReconciliation.ts` / `projections.ts` / `creatingObservation.ts` “for cleanliness.”
- Storing `later_priority_5` on the case so “one snapshot is complete.”
- Treating `lead_created` Priority 5, or the Booked payload’s own 5, as the preceding pair.
- Making pairing a case trigger, a `case_revision` bump, or a Domain Command.
- Loading Observations from this file so “pairing is self-contained.”
- Copying `compareGranotTemporal` into this file so “pairing owns time.”
- Writing a whole-folder recommendation for `granotLifecycle`.
