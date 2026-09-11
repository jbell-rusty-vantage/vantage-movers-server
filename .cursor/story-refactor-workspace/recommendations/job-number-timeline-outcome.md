# Decide The Current Outcome By Official Precedence — Contradictory When The Official Cancellation Clock Is Before The Official Booking Clock, Cancelled Including Snapshot-Only Without A Live Booking, Cancellation Intake Open Only When Official Booking Is Present, Then Booked, Booking Intake Open, Lead Active, Or Unknown — Never Last-Event-Wins, Never Treat Intake As Official — Then Assess The Seven Stages Including Policy-Skip Engagement, Injected Processing Gap, Booking Unavailable After Cancellation, And Delivery Always Unverifiable, And Name The Owner Headline From The Decided Outcome — Never Invent Events, Never Infer An Official Booking, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 5 of this service — `outcome.ts`
- Remaining in this service: `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/outcome.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; JTE-03 evaluators — `evaluateCurrentOutcome` uses specification §4.2 precedence, not last-event-wins; intake is never the official outcome; `assessStages` emits one assessment per §4.1 stage; snapshot-only official Cancellation is `ok` / `cancelled` plus booking-stage `BOOKING_UNAVAILABLE_AFTER_CANCELLATION`, not `contradictory`; delivery stays `unverifiable` even when every outbox job is synced; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` stamps `coverage.lead` / `booking_intake` / `cancellation_intake` / `official_booking` / `official_cancellation` and emits official events — this file **reads** those flags and the kept events; it does **not** emit). Distinct from leftover v2 wrap: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md) (`projectEnhancedPage` **asks** `evaluateCurrentOutcome`, `assessStages`, and `outcomeHeadline` after events and activities are finalized and after the 250 cap — this file is not the wrap **seam**). Distinct from leftover clocks: already-recommended [job-number-timeline-clocks.md](job-number-timeline-clocks.md) (this file compares assembled `event_at` strings; it does not pick recorded). Distinct from leftover evidence labels: already-recommended [job-number-timeline-evidence.md](job-number-timeline-evidence.md) (`stageForKind` names which stage an event belongs to; this file **assesses** whether that stage is complete / active / attention — it does not label a single event). Distinct from leftover §8 attention: sibling `attention.ts` (`evaluateAttention` / `evaluateLimitations` / `evaluateFreshness` / `hasProcessingEvidenceGap` — this file **asks** nothing from attention; projector **asks** `hasProcessingEvidenceGap` and **hands** the boolean into `assessStages`; attention **asks** `officialFactsContradict` for `CONTRADICTORY_OFFICIAL_STATE`). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts`. Distinct from leftover Owner sample: sibling `recent-official-bookings.ts`. Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). Distinct from leftover official Booking write: already-recommended [bookings-booked-lead.md](bookings-booked-lead.md). Distinct from leftover official Cancellation write: already-recommended [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **two runtime import sites in `src/`.** Already-recommended `projector.ts` **asks** `evaluateCurrentOutcome({ coverage, events: kept })`, `assessStages({ coverage, events: kept, processingGap })` (gap already computed by sibling `hasProcessingEvidenceGap`), and `outcomeHeadline(current_outcome)` for `summary.headline`. Sibling `attention.ts` **asks** `officialFactsContradict(events)` inside `evaluateContradictoryOfficialState`. Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests never import this file: `evaluators.test.ts` (open booking intake, official cancelled, contradictory chronology, snapshot-only cancelled, policy-skip engagement, resolved-without-fact stages, unresolved lead → `unknown`, delivery always unverifiable) **asks** `module.read`. `v2.test.ts` / `assemble.test.ts` / `module.test.ts` / `masking.test.ts` do **not** **ask** this **interface**. CLI `render` / `discover` / `proof` **ask** `module.read`, not this file. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `evaluateAttention`, `hasProcessingEvidenceGap`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: assemble coverage vs kept events (projector **asks** this file on **kept** events only — a dropped later official Cancellation must not decide outcome); official-fact clocks vs coverage flags (`officialFactsContradict` reads `official_booking` / `official_cancellation` **events** and their `event_at`; `evaluateCurrentOutcome` then prefers coverage for cancelled / booked / intake); snapshot-only Cancellation vs contradictory (no live Booking event → not contradictory; coverage `official_cancellation` still yields `cancelled`); open cancellation intake vs official cancelled (`cancellation_intake_open` only when `official_booking` is true **and** intake is open); injected processing gap vs stage assessment (projector computes the gap in sibling `attention.ts` and **hands** the boolean here — this file does not hop Mongo). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no loader **seam**. There is no attention **adapter** in this file. Owner-actor lives on the route, not here. Admin displays `current_outcome` / `stage_assessments` / `summary.headline`; it does not recompute them.
- Split later (only if the file outgrows one sitting): this ~354-line file is one sitting if you read it as decide current outcome by official precedence — assess the seven stages — name the owner headline. If it later splits by **story**: `decideTheCurrentOutcomeByOfficialPrecedence.ts` / `assessTheSevenStages.ts` — never `create.ts` / `update.ts` / `delete.ts` / `booking.ts` / `cancellation.ts`. Assemble / projector / evidence / attention stay siblings. `module.read` stays the HTTP/CLI **seam**.

`evaluateCurrentOutcome` / `assessStages` / `outcomeHeadline` are executor mechanics. The owner question is: *The v1 chain is already assembled and the v2 wrap already kept the first 250 events. Say what this Job Number is right now. If an official Cancellation clock is earlier than an official Booking clock, the page is contradictory — not whichever event arrived last. If an official Cancellation is present, including a snapshot-only Cancellation whose Booking document is gone, the page is cancelled — not unknown, not contradictory, and not an invented official Booking. Open cancellation intake is cancellation-intake-open only when an official Booking is still there; otherwise it is not official cancelled. Then booked, then booking intake open, then a resolved Lead, else unknown. Intake is never the official outcome. Then assess the seven stages the owner can walk: origin recorded or unresolved; engagement delivered, skipped by policy, failed, pending, or none; Job Number known or not; Granot processing complete, gapped, or not started; booking official, unavailable after cancellation, intake open, resolved without a fact, or not started; cancellation official, intake open, resolved without a fact, or none; delivery always Google not verified even when every Sheet Sync job is synced. Name the headline from that decided outcome. This file does not emit events. This file does not invent an official Booking. This file does not name §8 attention codes. This file does not load Mongo. This file does not write. This file does not call the forensic Granot timeline.*

Who stamps coverage and official events already lives in already-recommended `assemble.ts`. Who **asks** this file after the 250 cap already lives in already-recommended `projector.ts`. Who names which stage an event belongs to already lives in already-recommended `evidence.ts`. Who names §8 attention and computes the processing-gap boolean already lives in sibling `attention.ts`. Who redacts the page already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Three “say what this Job Number is right now, then walk the seven stages” stories in one sitting, not “an outcome CRUD service,” and not Assemble The Chain / Wrap The V2 Page / Name §8 Attention:

1. **Decide the current outcome by official precedence** — `evaluateCurrentOutcome({ coverage, events })` plus the shared beat `officialFactsContradict(events)`:
   - Contradictory only when **both** official kinds are present **and** the first official Cancellation `event_at` is **strictly before** the first official Booking `event_at`. First clock is `events[0]` of each filtered kind — projector hands the already-sorted kept list, so that is the earliest occurred official of that kind. Missing either kind is **not** contradictory. Snapshot-only Cancellation (coverage `official_cancellation`, no `official_booking` event) is **not** contradictory.
   - Else official Cancellation coverage → `cancelled`. Snapshot-only cancel is this branch.
   - Else open cancellation intake **and** official Booking coverage → `cancellation_intake_open`. Open cancel intake **without** official Booking does **not** take this branch.
   - Else official Booking coverage → `booked`.
   - Else open booking intake → `booking_intake_open`.
   - Else resolved Lead coverage → `lead_active`.
   - Else `unknown`.
   This beat does **not** last-event-wins. This beat does **not** treat intake as official. This beat does **not** invent an `official_booking` so a snapshot cancel “has a booking.” Sibling `attention.ts` **asks** the same contradict beat for `CONTRADICTORY_OFFICIAL_STATE` — one clock rule, two callers.

2. **Assess the seven stages** — `assessStages({ coverage, events, processingGap? })` walks origin → engagement → qualification → processing → booking → cancellation → delivery. States are expectation-aware (`complete`, `active`, `not_started`, `not_applicable`, `attention`, `unverifiable`). Labels follow knowledge §9.2 / `STAGE_REASON`:
   - Origin: `coverage.lead === "resolved"` → complete / `LEAD_RECORDED`; else attention / `LEAD_UNRESOLVED`. Origin is never `not_started`.
   - Engagement: any text `accepted` / `sent` / `delivered` → complete / `TEXT_DELIVERED`. Else policy skip (`skipped` + consent/policy/quiet-hours/gate reason, or that reason on a non-successful text) → `not_applicable` / `TEXT_POLICY_SKIP` (not attention — goldens lock no TEXT attention). Else `failed` / `undelivered` → attention / `TEXT_FAILED`. Else `scheduled` / leftover `accepted` → active / `TEXT_PENDING`. Else `not_started` / `TEXT_NOT_RECORDED`. `accepted` sits in both the successful and pending sets; successful is checked first, so `accepted` is delivered.
   - Qualification: any `job_number_acquired` → complete / `JOB_NUMBER_KNOWN`; else `not_started`. Event ids are every `stage === "qualification"` row (includes `lead_updated`).
   - Processing: injected `processingGap` → attention / `PROCESSING_EVIDENCE_GAP`. Else any processing-stage event → complete / `GRANOT_EVIDENCE_EVALUATED`. Else `not_started`. This file does **not** compute the gap; projector **asks** sibling `hasProcessingEvidenceGap` and **hands** the boolean.
   - Booking: official Booking coverage → complete / `BOOKING_OFFICIAL`. Else official Cancellation coverage → attention / `BOOKING_UNAVAILABLE_AFTER_CANCELLATION` (“Official Booking no longer present”). Else open intake → active. Else resolved intake → attention / `BOOKING_RESOLVED_WITHOUT_FACT`. Else `not_started`.
   - Cancellation: official Cancellation coverage → complete / `CANCELLATION_OFFICIAL`. Else open intake → active. Else resolved intake → attention / `CANCELLATION_RESOLVED_WITHOUT_FACT`. Else `not_started` / “No cancellation activity.”
   - Delivery: always `unverifiable` / `GOOGLE_DESTINATION_UNVERIFIED`, even when coverage `sheet_sync === "synced"`. Event ids are the `sheet_sync` rows. Move completion is **not** a stage.

3. **Name the owner headline from the decided outcome** — `outcomeHeadline` reads `OUTCOME_HEADLINE` (`Lead recorded` / `Booking intake open` / `Booked` / `Cancellation intake open` / `Cancelled` / `Contradictory official state` / `Outcome unknown`). Projector stamps `summary.headline` from this. This beat does **not** read events. This beat does **not** invent a second outcome.

There is no fourth emit, load, or §8 operation. `eventsOf` / `idsOf` / `firstClock` / `isPolicySkipMessage` / the seven `assess*` functions are beats inside stories 1–2. `stageState` is a leftover export with **no** `src/` caller.

## Organization

Keep one file. This is the screenplay for “decide current outcome by official precedence, assess the seven stages, name the headline.” v1 emit already lives in already-recommended `assemble.ts`. v2 wrap already lives in already-recommended `projector.ts`. Dual clocks already live in already-recommended `clocks.ts`. Event labels already live in already-recommended `evidence.ts`. §8 attention / limitations / freshness / processing-gap boolean already live in sibling `attention.ts`. Page redact already lives in sibling `masking.ts` via `module.ts`. Mongo hop already lives in sibling `mongo-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineOutcomeService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second emit **adapter** so “outcome can invent `official_booking`.” Do not invent a second attention **adapter** so “stage attention becomes a §8 code.” Do not invent a CRUD folder so “each stage gets a file.”

Do not move `evaluateCurrentOutcome` into projector so “one function owns the page.” Do not move `hasProcessingEvidenceGap` into this file so “processing owns the gap.” Do not move `officialFactsContradict` into attention so “§8 owns the clock rule” — projector and attention both need the same beat. Do not teach Admin to recompute `current_outcome` or `stage_assessments` so “the desk can paint without the server stamp.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `booking.ts` / `cancellation.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateCurrentOutcome` | `decideTheCurrentOutcomeByOfficialPrecedence` | projector **asks** it on kept events + assemble coverage |
| `officialFactsContradict` | `officialCancellationClockIsBeforeOfficialBookingClock` | this file **and** sibling `attention.ts` **ask** the same clock rule |
| `assessStages` | `assessTheSevenStages` | projector **asks** it with an injected processing-gap boolean |
| `outcomeHeadline` | `nameTheOwnerHeadlineFromTheDecidedOutcome` | projector stamps `summary.headline` |

Keep the old names as one-line aliases until already-recommended `projector.ts` and sibling `attention.ts` migrate. Do not make callers learn `assessOrigin` / `assessEngagement` / `isPolicySkipMessage` / `stageState` / `STAGE_REASON` / `OUTCOME_HEADLINE` as the domain language — those stay internal beats (`isPolicySkipMessage`, `STAGE_REASON`, and `OUTCOME_HEADLINE` are leftover exports with no other `src/` caller; `stageState` has none). Do **not** put these names onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted `current_outcome` strings (`lead_active` / `booking_intake_open` / `booked` / `cancellation_intake_open` / `cancelled` / `contradictory` / `unknown`) or stage `reason_code` strings (`BOOKING_UNAVAILABLE_AFTER_CANCELLATION`, `TEXT_POLICY_SKIP`, `GOOGLE_DESTINATION_UNVERIFIED`). Do **not** start returning a new outcome so “snapshot cancel can be `cancelled_without_booking`.”

**No workflow class.** The one type that *does* earn a name is the projector handoff this file already consumes:

```ts
type KeptEventsReadyForCurrentOutcome = {
  coverage: JobTimelinePage["coverage"]
  events: EnhancedJobTimelineEvent[]  // kept after the 250 cap
  processingGap?: boolean             // projector hands sibling hasProcessingEvidenceGap
}
```

That is the handoff from “the owner-facing chain is capped” to “say booked versus cancelled, then walk the seven stages.” Today the two exports take overlapping inline objects. Do **not** add contact, SMS body, Sheet id, or `last_error` onto the assessment so “the desk can debug.” Do **not** add a Mongo `Db` onto `decideTheCurrentOutcomeByOfficialPrecedence` so “outcome can hop.”

Leave `projectEnhancedPage` on already-recommended `projector.ts`. Leave `hasProcessingEvidenceGap` / `evaluateAttention` on sibling `attention.ts`. Leave coverage emit on already-recommended `assemble.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// outcome.ts
// The v1 chain is assembled and the wrap kept the first 250 events.
// Decide what this Job Number is right now by official precedence.
// Then walk the seven stages. Name the headline from that decision.

// ── 1. Current outcome by official precedence ─────────────

export function officialCancellationClockIsBeforeOfficialBookingClock(events)
  // both official kinds present AND first cancel event_at < first booking event_at
  // snapshot-only cancel (no booking event) → false

export function decideTheCurrentOutcomeByOfficialPrecedence({ coverage, events })
  // contradict → cancelled (incl. snapshot-only) →
  // cancel intake open AND official booking → booked →
  // booking intake open → lead resolved → unknown
  // intake is never official; last event does not win

export function nameTheOwnerHeadlineFromTheDecidedOutcome(outcome)
  // OUTCOME_HEADLINE[outcome]

// ── 2. Seven stages ───────────────────────────────────────

export function assessTheSevenStages({ coverage, events, processingGap })
function assessWhetherTheLeadIsRecorded(coverage, events)          // leftover assessOrigin
function assessWhetherATextWasDeliveredSkippedFailedOrPending(events)
function thisTextWasSkippedByPolicy(event)                         // leftover isPolicySkipMessage
function assessWhetherTheJobNumberIsKnown(events)
function assessWhetherGranotEvidenceIsComplete(events, processingGap)
  // processingGap is injected — do not hop
function assessWhetherTheJobIsBookedOrIntakeOrUnavailable(coverage, events)
  // official cancel without live booking → BOOKING_UNAVAILABLE_AFTER_CANCELLATION
function assessWhetherTheJobIsCancelledOrIntake(coverage, events)
function assessDeliveryAsAlwaysUnverifiable(events)
  // even when every sheet job is synced
```

Read the outcome path out loud: *decide the current outcome by official precedence — contradictory when the official Cancellation clock is before the official Booking clock, cancelled including snapshot-only without a live Booking, cancellation intake open only when official Booking is present, then booked, booking intake open, lead active, or unknown — never last-event-wins, never treat intake as official — then assess the seven stages including policy-skip engagement, injected processing gap, booking unavailable after cancellation, and delivery always unverifiable, and name the owner headline from the decided outcome.*

That is the operation. `evaluateCurrentOutcome` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Tests never **ask** this interface.** `evaluators.test.ts` already names open booking intake, official cancelled, contradictory chronology, snapshot-only cancelled, policy-skip `not_applicable`, resolved-without-fact stages, unresolved → `unknown`, and delivery always unverifiable — but it **asks** `module.read`. Bring those proofs onto `decideTheCurrentOutcomeByOfficialPrecedence` / `assessTheSevenStages` / `nameTheOwnerHeadlineFromTheDecidedOutcome` (inject coverage + kept events, and an optional `processingGap`). Leave §8 codes (`OFFICIAL_BOOKING_UNAVAILABLE`, `CONTRADICTORY_OFFICIAL_STATE`, `WORDPRESS_RECEIPT_UNAVAILABLE`) on the next `attention.ts` pass.

2. **Outcome and stage can diverge on open cancellation intake.** Page-level `cancellation_intake_open` requires official Booking coverage. Open cancel intake **without** official Booking still marks the cancellation **stage** `active`. Do not force that page outcome to `cancellation_intake_open` so “stage and outcome match,” and do not force the stage to `not_started` so “intake without a booking disappears.”

3. **Snapshot-only cancel is `cancelled`, not `contradictory`.** `officialFactsContradict` needs both official **events**. Coverage `official_cancellation` without a Booking event takes the cancelled branch. Booking stage is `BOOKING_UNAVAILABLE_AFTER_CANCELLATION`. Sibling attention adds `OFFICIAL_BOOKING_UNAVAILABLE`. Do not invent an `official_booking` event so “cancelled always has a booking,” and do not return `contradictory` so “missing booking looks like a clock fight.”

4. **Contradict is cancel-before-booking, not cancel-and-book.** Official Cancellation **after** official Booking is `cancelled` (official cancel coverage wins). Only `cancellationAt < bookingAt` is contradictory. `firstClock` does not sort — it trusts the kept list’s occurred order. Do not switch to last-event-wins so “the later stamp owns the page,” and do not treat equal clocks as contradictory so “same-second book-and-cancel fights.”

5. **`accepted` is in both successful and pending text sets.** Successful is checked first, so `accepted` is `TEXT_DELIVERED` / `complete`. The pending branch never sees it. Rename the sets so that overlap stays visible. Do not move `accepted` to pending-only so “Twilio accepted looks queued,” and do not delete the pending copy “for cleanliness” without an **interface** proof.

6. **Policy skip is `not_applicable`, not attention.** Goldens lock no TEXT / MESSAGE attention code. Do not emit `TEXT_FAILED` for a consent/quiet-hours skip so “every skip looks failed.”

7. **Processing gap is injected.** Projector **asks** sibling `hasProcessingEvidenceGap` and **hands** the boolean. This file must not import `JobTimelineRows` so “outcome can see the Decision.” Do not inline the gap so “one file owns processing.”

8. **Delivery stays unverifiable when Sheet Sync is synced.** Sheet `synced` is outbox completion, not Google equality. Knowledge and goldens lock `GOOGLE_DESTINATION_UNVERIFIED` plus stage `unverifiable`. Do not mark delivery `complete` so “a synced job looks verified.”

9. **Evaluators run on kept events only.** That handoff lives on already-recommended `projector.ts` (cap **before** the **ask**). This file must not re-read the uncapped list so “outcome sees events the owner cannot.”

10. **`stageState` / `isPolicySkipMessage` / `STAGE_REASON` / `OUTCOME_HEADLINE` are leftover exports.** No other `src/` file imports the last three; only `officialFactsContradict` / `evaluateCurrentOutcome` / `assessStages` / `outcomeHeadline` have callers. Do not put `STAGE_REASON` on the HTTP barrel so “the desk can paint reason chips,” and do not add helper-unit tests that freeze the policy-skip regex.

11. **Leave sibling modules alone.** Assemble coverage, projector cap-then-ask, `hasProcessingEvidenceGap`, `evaluateAttention` are already the right **depth**. This file does not orchestrate them; projector orchestrates this file, attention **asks** the contradict beat. Do not silently change §4.2 precedence, snapshot-cancel `cancelled`, or always-unverifiable delivery while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `decideTheCurrentOutcomeByOfficialPrecedence`, `officialCancellationClockIsBeforeOfficialBookingClock`, `assessTheSevenStages`, and `nameTheOwnerHeadlineFromTheDecidedOutcome` (today `evaluateCurrentOutcome`, `officialFactsContradict`, `assessStages`, `outcomeHeadline`).

Today’s `evaluators.test.ts` already names those outcomes and stages — but it **asks** `module.read`. That is the right assertion style on the wrong **seam**. Add (or move) those proofs onto this **interface** with injected coverage + kept events (and optional `processingGap`) so an assemble or attention rename cannot hide an outcome miss.

Name the operation:

**Current outcome**
- Official Cancellation `event_at` before official Booking `event_at` → `contradictory`. Headline `Contradictory official state`.
- Official Cancellation after official Booking → `cancelled`, not `contradictory`.
- Snapshot-only official Cancellation, no Booking event → `cancelled`. `officialFactsContradict` is false.
- Open cancellation intake + official Booking, no official Cancellation → `cancellation_intake_open`. Not `cancelled`.
- Official Booking, no cancel, no open cancel intake → `booked`.
- Open booking intake, no official Booking → `booking_intake_open`. No `official_booking` event required here (coverage drives it).
- Resolved Lead, no official fact, no open booking intake → `lead_active`.
- Unresolved Lead, no official fact → `unknown`.

**Seven stages**
- Always seven assessments, one per stage, in origin → delivery order.
- Policy-skip text → engagement `not_applicable` / `TEXT_POLICY_SKIP`.
- `accepted` / `sent` / `delivered` → engagement `complete` / `TEXT_DELIVERED`.
- Snapshot-only cancel → booking `attention` / `BOOKING_UNAVAILABLE_AFTER_CANCELLATION` / “Official Booking no longer present”; cancellation `complete`.
- Resolved booking intake without official Booking → booking `attention` / `BOOKING_RESOLVED_WITHOUT_FACT`; page outcome stays `lead_active` when that is the coverage story.
- Injected `processingGap: true` → processing `attention` / `PROCESSING_EVIDENCE_GAP`. `false` + processing events → `complete`.
- Synced Sheet Sync jobs → delivery still `unverifiable` / `GOOGLE_DESTINATION_UNVERIFIED`.

**Headline**
- `outcomeHeadline("cancelled")` → `Cancelled`. `booked` → `Booked`. `unknown` → `Outcome unknown`.

Do **not** add a test per helper (`assessOrigin`, `thisTextWasSkippedByPolicy`, `firstClock`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`evaluateAttention` / `hasProcessingEvidenceGap` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineOutcomeService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `coverage.official_booking` or `OUTCOME_HEADLINE[outcome]`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `stages/` folder of one-export files.
- Breaking the projector **ask**. Wrap must still **ask** this file after the 250 cap, on kept events only.
- Breaking the attention **ask**. Sibling `evaluateContradictoryOfficialState` must still **ask** `officialFactsContradict`.
- Breaking the injected processing-gap **seam**. This file must not hop Mongo to decide `PROCESSING_EVIDENCE_GAP`.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts`, `projector.ts`, `clocks.ts`, or `evidence.ts` as this story.
- Treating sibling `attention.ts` as this story — the next pass owns that checklist.
- Inventing an emit **seam** that has only these assessments as an **adapter**.
- Silently “fixing” `accepted` overlapping the pending set, snapshot-cancel `cancelled`, cancel-before-book-only contradict, always-unverifiable delivery, or open-intake-without-booking page outcome while renaming.
- Teaching Admin to recompute `current_outcome` or `stage_assessments`.
- Returning `contradictory` for snapshot-only Cancellation so “missing booking looks like a clock fight.”
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
