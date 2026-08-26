# Say Whether This Observation Is Newer Than The Last Accepted One — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 9 of this service — `granotTemporal.ts`
- Remaining in this service: `leadDesiredState.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/granotTemporal.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md` (Temporal comparator) and `docs/knowledge/granot-lifecycle/processor.md` (Temporal tuple + Temporal compare-and-swap seam). Distinct from desired-state field planning: next module `leadDesiredState.ts`. Distinct from matched-Lead writes / metadata-only CAS callers: `synchronizeLeadFromGranot.ts`, `processor.ts`. Distinct from Priority-5 pairing: `bookingPriorityPairing.ts`. Distinct from the Unit 08 retry clock: sibling `schedules.ts`. Distinct from calendar-date fold: `recommendations/granot-lifecycle-normalization.md` (`calendarDateInBusinessTimezone` stays there). Distinct from identity / Registry policy / Observation fold: `recommendations/granot-lifecycle-identity.md`, `recommendations/granot-lifecycle-source-policy.md`, `recommendations/granot-lifecycle-normalization.md`. This checkout’s `CONTEXT.md` does not define Granot Observation / last accepted Observation / temporal winner — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` (`compareGranotTemporal` then passes `temporal_order` into the planner; `defaultAdvanceTemporalWinner` always spreads `olderTemporalWinnerFilter`). `leadDesiredState.ts` (fallback compare when the caller omitted `temporal_order`). `synchronizeLeadFromGranot.ts` (compare before write; filter only when a stored winner already exists). `bookingPriorityPairing.ts` (preceding / later / latest Priority 5). `projections.ts` (later Priority 5 vs the creating Booked row). Tests: `granotTemporal.test.ts` (AC-32). Planner / processor tests consume the same order without re-implementing it. Not callers: `capture.ts`, `identity.ts`, `sourcePolicy.ts`, `schedules.ts`, `normalization.ts`.
- Seams callers need: in-memory order vs Mongo filter that only matches an older stored stamp; missing stored winner is newer in memory and is **not** encoded in the filter
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. If it later splits: `sayWhetherThisObservationIsNewerThanTheLastAcceptedOne.ts` / `onlyAcceptThisObservationIfTheStoredWinnerIsOlder.ts` — story files, never `compare.ts` / `filter.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`compareGranotTemporal` / `olderTemporalWinnerFilter` are executor mechanics. The owner question is: *Granot sent another statement about this Lead. Have we already accepted a later one? Look at the clock first. If the clocks match, the bigger Observation id wins. The same statement twice is not a second win. Source, channel, and Priority do not get a vote. When we stamp a new winner, only overwrite an older stamp.*

Desired-state patches, Lead sync/create, Booking Priority pairing, and the retry clock already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one story, not “a temporal CRUD service,” and not desired-state / sync / pairing:

1. **Say whether this Observation is newer than the last accepted one** — take `{ captured_at, observation_id }` for the incoming Observation and the optional stored `last_accepted_granot_observation`. No stored stamp → `newer`. Compare `captured_at` first. Equal clocks fold both ids (`trim` + lowercase) and compare that hex: same id → `same`; greater id → `newer`; lesser id → `older`. The tuple has no source, channel, or Priority. This function does not write. It does not throw on a non-hex id. It does not plan `quoted` or a Lead patch.

2. **Only accept this Observation as the winner if the stored stamp is older** — fold the incoming id the same way, then refuse unless it is 24-character ObjectId hex. Return a Mongo `$or` on `last_accepted_granot_observation`: stored `captured_at` is earlier, or the clocks match and the stored `observation_id` ObjectId is less than the incoming one. No `$exists`. No `$eq` / `$lte` on the id (exact same tuple cannot win again). No source / channel / Priority clause. This function does not update a Lead. Callers attach it to their own `_id` / `domain_revision` filter and `$set`.

There is no third mutate operation. `normalizeTemporalObservationId` is the shared fold, not a public story. In-memory order and the Mongo filter are two **adapters** for one winner rule.

## Organization

Keep one file. This is the screenplay for “say whether this Observation is newer than the last accepted one, and only stamp it when the stored winner is older.” Desired-state planning, matched-Lead writes, Priority pairing, and the retry clock already live in deeper **modules**. Do not pull those in. Do not invent a `GranotTemporalService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a pure compare plus a filter fragment, not a Domain Command. Do not invent a third “winner store” **seam** that has only one **adapter** here.

Do not split this ~55-line file into compare / filter folders. Those are two beats of one owner question. Do not move the compare into `leadDesiredState.ts` “because knowledge lists both as primary code.” Do not move the filter into `synchronizeLeadFromGranot.ts` or `processor.ts` so “CAS lives with the write.” Do not move `calendarDateInBusinessTimezone` here so “every date lives together.” Do not merge this file with `schedules.ts` so “every clock lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `compareGranotTemporal` | `sayWhetherThisObservationIsNewerThanTheLastAcceptedOne` | processor, planner fallback, sync race, Priority pairing |
| `olderTemporalWinnerFilter` | `onlyAcceptThisObservationIfTheStoredWinnerIsOlder` | processor metadata CAS; sync Lead update |
| `normalizeTemporalObservationId` | `foldTheObservationIdForTemporalCompare` | shared fold; keep exported until an accidental caller appears |
| `GranotTemporalTuple` | `AcceptedObservationStamp` | incoming vs stored winner |
| `GranotTemporalOrder` | `WhetherThisObservationIsNewer` | `newer` / `same` / `older` |

Keep the old names as one-line aliases until `processor.ts`, `leadDesiredState.ts`, `synchronizeLeadFromGranot.ts`, and `bookingPriorityPairing.ts` migrate. Do not make callers learn `$or` / ObjectId `$lt` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the stamp both **adapters** share:

```ts
type AcceptedObservationStamp = {
  captured_at: Date
  observation_id: string
}
```

That is the handoff from “we kept an Observation” to “the planner may treat it as stale, already current, or newer, and a later write may stamp it only if the stored winner is older.” Do **not** add `priority`, `source`, or `channel` so “Booked outranks Follow Up,” and do **not** add processing state so “the stamp can be claimed.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotTemporal.ts
// Granot sent another statement about this Lead.
// Have we already accepted a later one?
// Clock first. Same clock, bigger Observation id wins.
// The same statement twice is not a second win.
// Source, channel, and Priority do not get a vote.
// When we stamp a new winner, only overwrite an older stamp.
// This file does not plan a Lead patch.
// This file does not write a Lead.
// This file does not pair Priority 5.

// ── 1. Say whether this Observation is newer than the last accepted one ──

export function sayWhetherThisObservationIsNewerThanTheLastAcceptedOne(
  incoming,
  stored?,
)

function noStoredStampIsNewer(stored)
function theClockIsLater(incoming, stored)
function theClockIsEarlier(incoming, stored)
function theSameStatementIsNotASecondWin(incomingId, storedId)
function theBiggerObservationIdWinsWhenClocksMatch(incomingId, storedId)

export type AcceptedObservationStamp = { /* today's GranotTemporalTuple */ }
export type WhetherThisObservationIsNewer = "newer" | "same" | "older"

// ── 2. Only accept this Observation as the winner if the stored stamp is older ──

export function onlyAcceptThisObservationIfTheStoredWinnerIsOlder(incoming)
  // $or: earlier captured_at, or same clock + lesser stored ObjectId
  // no $exists — a first winner is the caller's job
  // no source / channel / Priority

function refuseUnlessThisIsATwentyFourCharacterObservationId(id)
```

Read the primary path out loud: *The processor already kept the Observation and already asked which Form or Call Lead it is. Now ask: is this statement newer than the last one we accepted on that Lead? If we have never stamped a winner, it is newer. If Granot’s clock is later, it is newer — even when the Observation id is smaller. If the clocks match, fold both ids and let the bigger hex win. If it is the same id at the same clock, say same — do not treat replay as a second win. An older clock is stale. Source, channel, and Priority are not on the stamp. When the processor or the matched-Lead command later writes `last_accepted_granot_observation`, they may only overwrite a stored stamp that this filter still calls older. A Lead with no stamp yet is not this filter’s problem: sync omits the clause; do not add `$exists` so the filter “also claims first winners.”*

That is the operation. `compareGranotTemporal` is not. `planLeadDesiredState` is not this compare.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`olderTemporalWinnerFilter` names the stored row, not the incoming one.** The filter matches Leads whose last accepted stamp is older than incoming, so incoming may become the winner. A reader hears “filter for older winners” and expects to *select* stale Observations. Do not invert `$lt` so “the name matches incoming,” and do not rename only the export while leaving the `$or` comments as “older winner” without saying *stored*.

2. **The in-memory compare can claim a first winner; the filter cannot.** Missing / null stored → `newer`. The filter has no `$exists: false` (AC-32 locks that). `synchronizeLeadFromGranot` omits the filter when `last_accepted_granot_observation` is absent. `processor.ts` `defaultAdvanceTemporalWinner` always spreads the filter. A metadata-only first stamp through that processor path will not match. Do not add `$exists` so “both callers match,” and do not make sync always spread the filter so “CAS is one shape.”

3. **`same` is never a second winner, but callers disagree on the word.** Compare returns `same`. The planner maps `same` to `already_current` / `desired_state_already_current` and will not advance. Sync treats `same` as `SynchronizeLeadRaceError("temporal")` — the same rule as `older`. Knowledge says exact same tuple is replay / `already_current`. Do not make sync accept `same` so “already current can write,” and do not make the planner return `stale` so “same is older.”

4. **Compare folds strings; the filter compares ObjectIds.** Stored `observation_id` is `Schema.Types.ObjectId`. Processor / sync stringify before compare. The filter lowercases then `toObjectId` and `$lt`s the stored ObjectId. Hex lexicographic order matches ObjectId byte order for valid 24-character hex. Do not switch compare to ObjectId so “one type wins” if pairing still stringifies `_id`, and do not `$lt` a string against the ObjectId field so “the fold is enough.”

5. **Compare never throws; the filter throws on a non-hex id.** Pairing and projections always pass Observation `_id`. A junk string still gets an in-memory order. CAS refuses it. Do not start throwing from compare so “both adapters validate,” and do not swallow the filter throw so “pairing can reuse the filter.”

6. **No source, channel, or Priority may join the tuple.** AC-32 locks the filter keys to `$or` plus the two stored paths. Booked / Priority 5 / webhook vs extension do not outrank a later clock. Do not add `priority_canonical` so “Booked wins ties,” and do not special-case `route_event_class` here — pairing uses this compare; it does not replace it.

7. **Processor compares, then the planner may compare again.** Processor always passes `temporal_order`. The planner still falls back to this file when the argument is omitted. Tests call the planner both ways. Do not delete the fallback so “one compare site wins,” and do not have the planner ignore a passed order so “the Lead row is fresher.”

8. **`normalizeTemporalObservationId` is exported and unused outside this file.** Tests hit it only through the two operations. Do not persist folded ids on the Lead, and do not make callers fold before calling.

9. **Leave sibling modules alone.** Desired-state `quoted` / contact / Job stay in `leadDesiredState.ts`. Metadata-only CAS write and matched-Lead `$set` stay in `processor.ts` / `synchronizeLeadFromGranot.ts`. Preceding / later Priority 5 stay in `bookingPriorityPairing.ts`. Retry offsets stay in `schedules.ts`. Calendar dates stay in `normalization.ts`. ObjectId construction stays in `utils/objectId.ts`.

10. **Do not treat desired-state `quoted`, `synchronizeLeadFromGranot` field writes, Priority-5 pairing, or the Unit 08 retry clock as this story.** Those plan a patch, write a Lead, pick a Booked neighbor, or schedule another match. This file only orders two stamps and builds the filter that protects the stored winner.

11. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayWhetherThisObservationIsNewerThanTheLastAcceptedOne` (today `compareGranotTemporal`) and `onlyAcceptThisObservationIfTheStoredWinnerIsOlder` (today `olderTemporalWinnerFilter`). `AcceptedObservationStamp` is part of that **interface**.

Today’s `granotTemporal.test.ts` already locks missing stored → `newer`, `captured_at` before id, uppercase id fold, exact same tuple → `same`, and a filter with only `$or` / earlier clock / same clock + lesser ObjectId and no `$exists`. Keep those. Add the gaps that name the operation:

**Say whether this Observation is newer than the last accepted one**
- Equal clocks, incoming id lesser → `older` (already locked).
- Trim / mixed-case id vs stored lowercase → `same` when the hex matches.
- A later clock with a lesser id is still `newer` (already locked; keep it named as clock-first).
- The tuple type cannot carry Priority / source / channel (type + filter-key lock is enough; do not add a runtime reject list).

**Only accept this Observation as the winner if the stored stamp is older**
- Exact same clock + same id is **not** in the filter (`$lt`, not `$lte`).
- Non-24-character id throws (current contract; do not “fix”).
- Filter paths stay `last_accepted_granot_observation.captured_at` / `.observation_id` — callers add `_id`.
- This function does not `$set` a Lead.

Do **not** add a test per helper (`theClockIsLater`, `theBiggerObservationIdWinsWhenClocksMatch`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test planner `quoted`, processor Decision persist, sync field writes, or Priority-5 pairing here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, climbs an identity ladder, or stamps `last_accepted_granot_observation`. Do not add a test that Booked outranks an older Follow Up.

## What I would not do

- A `GranotTemporalService` class with `create` / `update` / `compare`.
- Thirty two-line functions that only wrap `getTime`.
- Moving this into a CRUD folder, or into `leadDesiredState.ts` / `processor.ts` “for cleanliness.”
- Adding `$exists: false` so the filter can claim a first winner.
- Adding Priority, source, or channel to the stamp so “Booked wins ties.”
- Making `same` a write, or making `same` `stale`.
- Switching compare to ObjectId, or the filter to string `$lt`, so “one type wins.”
- Moving `calendarDateInBusinessTimezone` or the retry clock into this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
