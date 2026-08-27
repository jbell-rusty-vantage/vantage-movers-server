# Show The Jobs Where Granot And Vantage Fight — Then Open One Fight So The Owner Can See Evidence Versus Current Facts — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 31 of this service — `discrepancyProjections.ts`
- Remaining in this service: `observability.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/discrepancyProjections.ts`
- Knowledge: There is **no** standalone Service file in `docs/knowledge/granot-lifecycle/` for this queue. [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) lists `GET .../discrepancies` and `GET .../discrepancies/:id` on the Owner/Admin read surface and says Primary code is `projections.ts` / `creatingObservation.ts` / `bookingPriorityPairing.ts` / `alerts.ts` / the admin routes / Zod — it does **not** name this file. Owner list/detail contract: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md) (masked label; evidence ≠ current facts; server-derived candidates + capabilities; raw payload / headers / credentials / address / unmasked contact absent). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`maskContactLabel` survives for the discrepancy queue; contact follows the work, not the surface; Admin routes compose allowlisted DTOs). Persist that opened the row: [recommendations/granot-lifecycle-discrepancies.md](granot-lifecycle-discrepancies.md). Owner review that may resolve it: [recommendations/granot-lifecycle-discrepancy-owner-commands.md](granot-lifecycle-discrepancy-owner-commands.md). Case / Job / Lead / health DTOs: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Candidate identity **adapter**: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md) (`searchBookingLeadCandidates`). Distinct from Owner-only case candidate browse (normalized contact): `listGranotLifecycleCaseCandidates`. Distinct from official Book / Cancel: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md), [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). This checkout’s `CONTEXT.md` does not define Granot Booking Discrepancy / Granot Release Discrepancy / Granot Record Link — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **two HTTP callers.** `routes/granot-lifecycle-admin.routes.ts` (`GET .../discrepancies` → `listGranotLifecycleDiscrepancies` after `requireRegistryReadActor` + `granotLifecycleDiscrepancyListQuerySchema`; `GET .../discrepancies/:id` → `getGranotLifecycleDiscrepancyDetail` after the same Read actor + `granotLifecycleDiscrepancyParamsSchema`; always 200 with `{ ok, data }`). Route unit stubs `deps.listDiscrepancies` / `deps.getDiscrepancyDetail` and locks Admin-signed list filters plus `masked_contact_label: "Contact masked"` (`[AC-35][AC-36] discrepancy list/detail are signed reads with strict filters`; unknown `contact=` is 400). Not callers: `discrepancyOwnerCommands.ts` (mutations; Owner-only), `discrepancies.ts` (persist), `projections.ts` (case / Job / Lead / health), `processor.ts`, `drainer.ts`, `bookingOwnerCommands.ts`, `releaseOwnerCommands.ts`, public Book / Cancel. There is no `discrepancyProjections.test.ts` and no replica file for this module.
- Seams callers need: Owner/Admin queue+detail vs Owner-only mutations; Booking vs Release collections as two **adapters** of one read rule; merged timestamp-plus-id cursor vs one-collection `kind`; source filter via Decision ids vs a field this row does not store; hardcoded masked label vs intake-visible contact vs `maskContactLabel` (sibling comment claims this queue; this file never calls it); `capabilities` as server-derived ads vs route policy; candidates only when correction is possible **and** the sibling 24-hour refresh window still holds; `canCorrect` here vs `isLinkConflict` on Owner review
- Split later (only if the file outgrows one sitting): keep one file — this ~128-line module is one screenplay for “show the jobs where Granot and Vantage fight, then open one fight so the owner can see evidence versus current facts.” If it later splits: `showTheJobsWhereGranotAndVantageFight.ts` / `openOneFightSoTheOwnerCanSeeEvidenceVersusCurrentFacts.ts` — story files, never `list.ts` / `get.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge persist, Owner review, or case/Job/health DTOs into this file

`listGranotLifecycleDiscrepancies` / `getGranotLifecycleDiscrepancyDetail` are executor mechanics. The owner question is: *Granot and Vantage disagree about some Jobs. Those disagreements are already discrepancy rows. Show Admin and the Owner the queue: kind, state, reason, Job, a contact label nobody phones from, how much evidence, both revisions, when it opened, when evidence last landed. Then open one fight. Keep the append-only Observation evidence visibly separate from the live Record Link, Lead, Booking, and Cancellation refs. If this open fight can still correct a disputed active link, attach the current identity-only Lead suggestions from the newest Observation. Advertise what they may do: ask again, point the Job at a Lead, or close with no official write. Never write `BookedLead`. Never write `CancelledLead`. Never `$set` a Lead. Never resolve the row. Never unmask a phone.*

Automatic persist, Owner review, case / Job / health DTOs, and official Book / Cancel already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one Admin-read story, not “a discrepancy CRUD service,” and not the automatic persist / Owner review / the Booking-case queue:

1. **Show the jobs where Granot and Vantage fight** — apply the signed filters the route already parsed: optional `kind`, `state`, exact `reason_code`, `normalized_job_no`, `source_id`, opened range, `sort` (`last_evidence_at` | `opened_at`, default newest evidence), `order` (default desc), opaque cursor, limit (default 25, max 100). `state` is **not** defaulted to open — an unfiltered page includes resolved rows. `source_id` is not a field on the discrepancy: load Synchronization Decision ids whose `source_scope.granot_crm_source_id` matches, then filter `evidence.decision_id $in` those ids (empty `$in` matches nothing). Decode the cursor or 400 `GRANOT_VALIDATION_FAILED`. Query Booking, Release, or both collections (`kind` drops one stream). Fetch `limit+1` per stream, merge-sort by the selected timestamp then `_id`, take `limit`. Each row is a masked queue card: id, kind, state, reason, Job, literal `masked_contact_label: "Contact masked"`, evidence count, both revisions, opened / last-evidence ISO times, optional `resolved_at`. `next_cursor` is set only when the merged page overflowed. This function does not return evidence arrays, Record Links, Leads, candidates, or capabilities. This function does not resolve a row.

2. **Open one fight so the owner can see evidence versus current facts** — load Booking by id first, else Release. Missing both is `GRANOT_DISCREPANCY_NOT_FOUND`. Compose the same masked card, plus `reason_fingerprint`, optional live `lead_ref` / `booking_id` / `cancellation_id`, optional current Record Link (`id`, `state`, `disputed`, `domain_revision`, optional Lead / Booking refs), append-only evidence tuples (Observation id, Decision id, captured-at, `priority_5` | `booked` | `release`), optional resolution metadata, identity-only candidates, and `capabilities`. `canCorrect` is true only when the row is `open`, the named link is still `active` and `disputed`, and the reason is not `booked_after_official_cancellation` or `release_without_vantage_booking`. Candidates load only when `canCorrect` and newest evidence exist, through sibling `searchBookingLeadCandidates({ observation_id, opened_at })` — that **adapter** returns `[]` when the fight is older than 24 hours, and the suggestions are `lead_ref` + confidence + match method + reason codes + `suggested` (no name, phone, or email). `re_evaluate` and `no_action` are true when `state === "open"`. `correct_record_link` is `canCorrect`. There is no discrepancy command flag and no Booking / Release effect-flag check. This function does not write a Command. This function does not `$set` a Lead. This function does not confirm a Booking. This function does not call `assertProjectionSafe`.

There is no third mutate operation. `listItem` / `encodeCursor` / `decodeCursor` are folds, not public stories. Booking vs Release models are two **adapters** of one read rule. The sibling candidate search is a real **seam** because case browse also uses it, and because it opens a transaction to reread identity — this file must not invent a second matcher.

## Organization

Keep one file as the screenplay for “show the jobs where Granot and Vantage fight, then open one fight so the owner can see evidence versus current facts.” Persist, Owner review, case / Job / health DTOs, and identity already live in deeper **modules**. Do not pull those in. Do not invent a `GranotDiscrepancyProjectionService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — these are reads; there is no after-read persist. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `projections.ts` so “every Admin list lives together.” Do not move this into `discrepancyOwnerCommands.ts` so “the queue can resolve itself.” Do not move this into `discrepancies.ts` so “one discrepancy sitting.” Do not split `list.ts` / `get.ts` / `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listGranotLifecycleDiscrepancies` | `showTheJobsWhereGranotAndVantageFight` | Owner/Admin queue; merged cursor |
| `getGranotLifecycleDiscrepancyDetail` | `openOneFightSoTheOwnerCanSeeEvidenceVersusCurrentFacts` | Owner/Admin detail; evidence ≠ current facts |
| `GranotDiscrepancyListItem` | `AMaskedDiscrepancyQueueRow` | bounded card; contact is a constant |
| `GranotDiscrepancyDetail` | `OneFightWithEvidenceCurrentFactsAndWhatTheyMayDo` | evidence + live refs + candidates + capabilities |

Keep the old names as one-line aliases until the admin router and the route-unit stubs migrate. Do not make callers learn `listItem` / `canCorrect` / `encodeCursor` as the domain language.

**Principle: old exports stay as aliases.** `listGranotLifecycleDiscrepancies` and `getGranotLifecycleDiscrepancyDetail` remain the imported names until `granot-lifecycle-admin.routes.ts` points at the story names.

**No class for the workflow.** The type that *does* earn a name is the capability bag:

```ts
type WhatTheOwnerMayDoWithThisFight = {
  re_evaluate: boolean
  correct_record_link: boolean
  no_action: boolean
}
```

That is the handoff from “we loaded the open row and the current link” to “advertise the three Owner reviews.” Do **not** add `name` / `phone_number` / `email` so “detail can call the customer,” and do **not** add `raw_payload` so “the Owner can see Granot.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// discrepancyProjections.ts
// Granot and Vantage disagree about some Jobs.
// Those disagreements are already discrepancy rows.
// Show the queue. Then open one fight.
// Evidence stays separate from current facts.
// Contact stays a constant nobody phones from.
// This file does not open the discrepancy.
// This file does not resolve the discrepancy.

// ── 1. Show the jobs where Granot and Vantage fight ───────

export async function showTheJobsWhereGranotAndVantageFight(query)
  filterByStateReasonJobAndOpenedRange()
  ifSourceId, findDecisionIdsForThatGranotSource()   // not a field on the row
  decodeTheCursorOrRefuse()
  queryBookingAndOrRelease()                         // kind drops one stream
  mergeSortAndTakeOnePage()                          // limit+1 per stream
  eachRowIsAMaskedQueueCard()                        // "Contact masked"
  advertiseNextCursorOnlyWhenTheMergedPageOverflowed()

function findDecisionIdsForThatGranotSource(sourceId)
  distinctSynchronizationDecisionIdsByReviewedSource()
  filterEvidenceDecisionIdInThoseIds()               // empty $in matches nothing

function eachRowIsAMaskedQueueCard(kind, row)
  idKindStateReasonJob()
  contactIsTheLiteralMaskedLabel()
  evidenceCountAndBothRevisions()
  openedAndLastEvidenceIso()
  resolvedAtOnlyWhenTheRowAlreadyClosed()

// ── 2. Open one fight so the owner can see evidence vs facts

export async function openOneFightSoTheOwnerCanSeeEvidenceVersusCurrentFacts(id)
  loadBookingFirstElseRelease()
  ifNeither, notFound()
  composeTheMaskedCard()
  attachTheFingerprintAndLiveRefs()
  attachTheCurrentRecordLinkIfNamed()
  keepAppendOnlyEvidenceSeparateFromThoseRefs()
  ifCanCorrectAndNewestEvidence, attachIdentityOnlyCandidates()
  advertiseWhatTheOwnerMayDo()

function thisOpenFightCanStillCorrectALink(row, link)
  rowIsOpen()
  namedLinkIsStillActiveAndDisputed()
  reasonIsNotBookedAfterOfficialCancellation()
  reasonIsNotReleaseWithoutAVantageBooking()

function attachIdentityOnlyCandidates(newest, openedAt)
  askTheBookingCandidateAdapter()                    // sibling; 24h window
  leadRefConfidenceMatchMethodReasonCodesSuggested()
  doNotAddNamePhoneOrEmail()

function advertiseWhatTheOwnerMayDo(row, canCorrect)
  reEvaluateAndNoActionWhenOpen()
  correctRecordLinkWhenCanCorrect()
  doNotReadADiscrepancyCommandFlag()                 // there is none
```

Read the primary path out loud: *Granot already said something about a Job that does not match Vantage. That fight is a discrepancy, not a Booking case. Admin and the Owner open the queue. They can filter by kind, state, reason, Job, source, or when it opened. We do not default to open-only. A source filter walks Synchronization Decisions because the row does not store a source id. We merge Booking and Release streams with a timestamp-plus-id cursor so a page neither duplicates nor omits a cross-collection row. Every card says “Contact masked.” Nobody phones the customer from this list. Then they open one fight. We show the append-only Observation evidence next to the live link, Lead, Booking, and Cancellation refs. If the row is still open and the named link is still active and disputed, and this is not “booked after we already cancelled” or “release with no Vantage Booking,” we attach the current identity-only Lead suggestions from the newest Observation — unless that fight is older than a day, in which case the list is empty and they type an id. We advertise ask-again, correct-the-link, and no-action when those moves are still legal. We do not write a Booking. We do not write a Cancellation. We do not `$set` a Lead. We do not resolve the row. We do not unmask a phone.*

That is the operation. `listGranotLifecycleDiscrepancies` is not a CRUD list. `getGranotLifecycleDiscrepancyDetail` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This queue is not the Booking-case queue.** Case list defaults to `state=open`. This list does not. An unfiltered discrepancy page includes resolved rows. Do not default `state:"open"` so “every Admin queue matches,” and do not hide resolved rows so “the owner only sees work.” The spec enumerates `state` as an optional filter.

2. **`source_id` is not on the discrepancy.** The filter distincts Synchronization Decision ids by `source_scope.granot_crm_source_id`, then `$in`s `evidence.decision_id`. A row matches when **any** evidence Decision came from that reviewed source. Empty `$in` matches nothing. Do not denormalize `source_id` onto the row in this rename so “the query is simpler,” and do not filter `record_link.source_scope` so “the current link is the source.”

3. **The contact label is a constant, not `maskContactLabel`.** `projections.ts` comments that `maskContactLabel` “still serves the discrepancy queue.” This file never imports it. The literal `"Contact masked"` is stronger than an initial / last-four / first-letter-email. The owner spec asks for a masked label and forbids unmasked contact. Do not start calling `maskContactLabel` so “the sibling comment is true” — that would put a reachable hint on an Admin list. Leave the constant. The lying comment is a sibling edit, not this pass.

4. **`canCorrect` here is not `isLinkConflict` on Owner review.** Detail: open + named link `active` and `disputed` + reason is not the two non-link reasons. Command: reason substring `record_link_conflict` / `job_number_conflict` / `source_scope_conflict` or exact `booked_booking_lead_conflict`, plus a `record_link_id`, then a CAS load of that disputed active link. Today’s reason enum makes them agree. Do not share one helper so “one matcher” until a test proves a reason that would advertise `correct_record_link: true` and then 409. Do not widen detail so “every open row can correct.”

5. **Candidates can be empty while `correct_record_link` is still true.** Sibling `searchBookingLeadCandidates` returns `[]` when `opened_at` is older than 24 hours, or when identity has no eligible targets. The owner spec says candidate buttons populate the draft; a typed eligible Lead is still server-validated. Do not hide `correct_record_link` when candidates are empty so “the button matches the list,” and do not invent a second search so “discrepancy can browse like a case.”

6. **Those candidates are identity-only. Case browse is not.** `BookingLeadCandidateProjection` is `lead_ref` + confidence + match method + reason codes + `suggested`. Case `listGranotLifecycleCaseCandidates` adds normalized `contact` and is Owner-only for that reason. This detail stays Owner/Admin. Do not add `name` / `phone_number` / `email` so “the owner can tell two Leads apart,” and do not make this GET Owner-only so “candidates match the case browser.”

7. **The candidate **adapter** opens a transaction on a GET.** `searchBookingLeadCandidates` → `store.withTransaction` → `loadCurrentContext` + `projectBookingLeadCandidates`. Leave that in `bookingReconciliation.ts`. Do not copy a non-transactional reread into this file so “reads stay read-only,” and do not drop the call so “GET must not start a session.”

8. **Capabilities do not read an effect flag.** Booking / Release case `capabilities.commands` require the matching command flag. There is no `GRANOT_LIFECYCLE_DISCREPANCY_COMMANDS_ENABLED`. Open is enough for ask-again and no-action. Do not AND a Booking / Release flag so “every Owner button has a door,” and do not invent the missing flag in this rename.

9. **`assertProjectionSafe` is unused here.** Case, Job, Lead, and health DTOs run the forbidden-key guard. This file does not. Candidates and evidence are already allowlisted ids. Do not add the guard in this rename so “every DTO is guarded” without a test that names a leaked key, and do not skip the constant mask so “the guard will catch contact.”

10. **Merged pagination fetches `limit+1` per collection, then sorts in memory.** Same pattern as the case queue. A later page reapplies the timestamp-plus-id cursor on each stream. Do not “fix” the fan-out in this rename, and do not share the case-list cursor codec so “one cursor helper” — a bad shared decode would 400 the wrong queue.

11. **Booking id wins when both collections could match.** `findById` on Booking, else Release. ObjectIds are not reused across collections in practice. Do not query `$or` across both so “one round-trip,” and do not 409 if both exist so “kind is required.”

12. **Newest evidence is the last append.** `row.evidence.at(-1)` feeds the candidate **adapter**. Persist dedupes by Observation id and appends only. Do not max-by-`captured_at` so “clock skew is safer” in this rename.

13. **List does not advertise capabilities.** The owner spec puts action capabilities on detail. The route unit only asserts the masked label. Do not put `re_evaluate` on every queue card so “the list can render buttons,” and do not drop capabilities from detail so “the route owns policy.”

14. **Knowledge lists the routes and omits this file.** `projections.md` Primary code does not include `discrepancyProjections.ts`. That is a docs contradiction, not a reason to merge this module into `projections.ts`. Do not treat the knowledge index as permission to move the code.

15. **Leave sibling modules alone.** Persist stays in `discrepancies.ts`. Owner review stays in `discrepancyOwnerCommands.ts`. Case / Job / Lead / health stay in `projections.ts`. Candidate identity stays in `bookingReconciliation.ts`. `maskContactLabel` stays in `projections.ts` for outbound SMS. Owner events stay in `observability.ts`.

16. **Do not treat persist, Owner review, case browse, or official Book / Cancel as this story.** Those open the row, resolve it, attach a Lead, or write `BookedLead` / `CancelledLead`. This file only shows a row that already exists.

17. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `showTheJobsWhereGranotAndVantageFight` (today `listGranotLifecycleDiscrepancies`) and `openOneFightSoTheOwnerCanSeeEvidenceVersusCurrentFacts` (today `getGranotLifecycleDiscrepancyDetail`).

Today there is no `discrepancyProjections.test.ts`. Route unit already names two beats: Admin-signed list with `kind` + `state`; detail returns `masked_contact_label: "Contact masked"`; unknown `contact=` is 400. Keep those. Add module-level names for the gaps:

**Show the jobs where Granot and Vantage fight**
- Unfiltered page includes resolved rows (add this; do not assume open-only).
- `kind=booking` / `kind=release` drops the other stream (add this).
- `source_id` with no matching Decisions returns an empty page (add this).
- `source_id` matches a row whose **later** evidence Decision is from that source (add this).
- Merged Booking + Release page orders by `last_evidence_at` then `_id` (add this).
- `next_cursor` is set only when merged rows exceed `limit` (add this).
- A second page using that cursor neither duplicates nor omits a cross-collection row (add this).
- Invalid cursor is `GRANOT_VALIDATION_FAILED` (add this).
- Every item’s `masked_contact_label` is the literal `"Contact masked"` (already locked on detail; add it on list).
- List items have no `evidence`, `candidates`, or `capabilities` (add this).
- Do not add a test that this path writes a discrepancy or `$set`s a Lead.

**Open one fight so the owner can see evidence versus current facts**
- Booking id is found even if a Release id is never queried second (add this).
- Missing both collections is `GRANOT_DISCREPANCY_NOT_FOUND` (add this).
- Evidence tuples stay ids + action + captured-at; no payload / headers / address (add this).
- Live link / Lead / Booking / Cancellation refs are current, not copied onto evidence (add this).
- Open + active disputed link + `booked_record_link_conflict` → `correct_record_link: true` and candidates asked (add this).
- `booked_after_official_cancellation` / `release_without_vantage_booking` → `correct_record_link: false` and no candidate call (add this).
- Open row older than 24 hours still advertises `correct_record_link` when the link is disputed, but `candidates` is `[]` (add this).
- Resolved row: `re_evaluate` and `no_action` false; no candidates (add this).
- Candidates never include `name`, `phone_number`, or `email` (add this).
- Do not add a test that this GET writes a Command or resolves the row.

Do **not** add a test per helper (`listItem`, `encodeCursor`, `thisOpenFightCanStillCorrectALink`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test automatic persist, Owner review, case/Job/health DTOs, or Lead-sync establish here. Do not add a test that this file CRM-posts, `$set`s a Lead, writes `BookedLead`, or lists Booking cases.

## What I would not do

- A `GranotDiscrepancyProjectionService` class with `list` / `get` / `create`.
- Thirty two-line functions that only wrap `find`.
- Moving this into a CRUD folder, or into `projections.ts` / `discrepancies.ts` / `discrepancyOwnerCommands.ts` “for cleanliness.”
- Splitting `list.ts` / `get.ts` / `create.ts` / `update.ts` / `delete.ts`.
- Calling `maskContactLabel` so “the sibling comment is true.”
- Defaulting the queue to `state=open` so “it matches the case list.”
- Adding name / phone / email on candidates so “the owner can tell two Leads apart.”
- Making detail Owner-only so “candidates match the case browser.”
- Writing `BookedLead` or resolving the row so “the fight is finished.”
- Inventing `GRANOT_LIFECYCLE_DISCREPANCY_COMMANDS_ENABLED` to hide the buttons.
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` are absent.
- Writing a whole-folder recommendation for `granotLifecycle`.
