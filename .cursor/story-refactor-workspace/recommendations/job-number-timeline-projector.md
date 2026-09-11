# Stamp Each Assembled Event With Dual Clocks Stage Evidence And Correlation, Group Related Rows Into Activities So An Observation Wave Stays Together And Official Booking And Official Cancellation Keep Their Own Activity, Link Cause And Result Inside Each Activity, Cap The Page At 250 Later Events And Name The Drop, Then Ask Current Outcome Stages Attention And Limitations And Stamp The Owner-Facing V2 Page — Never Mutate, Never Invent Events, Never Drop Silently, Never Treat Intake As Official, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 2 of this service — `projector.ts`
- Remaining in this service: `clocks.ts`, `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/projector.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; JTE-02 v2 wrap + JTE-03 evaluators; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 chain: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` **asks** this file on `ok` only and hands `cancellationViaSnapshot`). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover clocks: sibling `clocks.ts` (`selectEventTime`, `compareOccurredThenPriority` — this file **asks** those). Distinct from leftover evidence labels: sibling `evidence.ts` (`stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor`, `evidenceRefsFor` — this file **asks** those; `formSnapshotForLead` stays on assemble). Distinct from leftover evaluators: siblings `outcome.ts` / `attention.ts` (`evaluateCurrentOutcome`, `assessStages`, `outcomeHeadline`, `evaluateAttention`, `evaluateLimitations`, `evaluateFreshness`, `hasProcessingEvidenceGap` — this file **asks** those after events and activities are finalized; it does not decide booked vs cancelled). Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts`. Distinct from leftover Owner sample: sibling `recent-official-bookings.ts`. Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover Job Number identity: already-recommended [bookings-booking-identity.md](bookings-booking-identity.md). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **one runtime import site in `src/`.** Already-recommended `assemble.ts` **asks** `projectEnhancedPage` on every `ok` and passes `{ page, rows, now, cancellationViaSnapshot }`. Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests never import this file: `v2.test.ts` (schema v2, dual clocks, observation-wave activity, grouping does not drop events, official Booking and official Cancellation keep different activity ids, 250-cap `TIMELINE_TRUNCATED`, no `inferred` evidence, v1 fields remain, golden origin / official-fact shapes) and `evaluators.test.ts` (current outcome, stages, §8 attention / limitations including snapshot-only `OFFICIAL_BOOKING_UNAVAILABLE` and `WORDPRESS_RECEIPT_UNAVAILABLE`) **ask** `module.read`. `module.test.ts` stamps `assembled_at` from `input.now`. `assemble.test.ts` / `masking.test.ts` see the v2 page only because assemble already **asks** this file. CLI `render` / `discover` / `proof` **ask** `module.read`, not this file. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `createJobNumberTimelineModule`, `selectEventTime`, `evaluateCurrentOutcome`, `evaluateAttention`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: v1 chain vs enhanced page (assemble **asks** this file on `ok` only); injected `now` vs last-event / epoch `assembled_at` (module always passes `now`); snapshot Cancellation vs Booking-linked Cancellation (`cancellationViaSnapshot` is the handoff sibling `correlationFor` needs); kept events vs dropped later events (`JOB_TIMELINE_EVENT_CAP` 250, named `TIMELINE_TRUNCATED`); observation-wave activity vs independent official-fact activity. There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no redact **seam** in this file (module redacts after). There is no loader **seam** in this file. There is no outcome **adapter** in this file. Owner-actor lives on the route, not here. Admin displays the arrays; it does not recompute them.
- Split later (only if the file outgrows one sitting): this ~303-line file is one sitting if you read it as stamp each assembled event — group related rows into activities — link cause and result — cap at 250 later events and name the drop — ask outcome / attention and stamp the v2 page. If it later splits by **story**: `stampEachAssembledEvent.ts` / `groupRelatedRowsIntoActivities.ts` / `capLaterEventsAndNameTheDrop.ts` — never `create.ts` / `update.ts` / `delete.ts`. Clocks / evidence / outcome / attention / assemble stay siblings. `module.read` stays the HTTP/CLI **seam**.

`projectEnhancedPage` is executor mechanics. The owner question is: *The v1 chain is already assembled. Stamp each event with when it occurred versus when we recorded it, which stage it belongs to, how strong the evidence is, and how it correlates to this Job Number — including a snapshot-only Cancellation that is still exact. Group related rows into one activity so a Granot observation, its receipt, its latest Decision, the same-wave Lead change, and the same-wave Sheet Sync stay together. Keep lead created on its own activity. Keep official Booking and official Cancellation on their own activities. Inside each activity, link cause and result in occurred-then-priority order. If more than 250 events remain, keep the first 250, drop the later ones, and name `TIMELINE_TRUNCATED` with the omitted ids and stage counts — never a silent drop. Then ask current outcome, the seven stages, attention, freshness, and limitations, and stamp `schema_version: "job_timeline.v2"`. This file does not emit events. This file does not decide booked versus cancelled. This file does not redact. This file does not load Mongo. This file does not write. This file does not call the forensic Granot timeline.*

Who emits the v1 chain already lives in already-recommended `assemble.ts`. Who picks occurred versus recorded already lives in sibling `clocks.ts`. Who labels stage / evidence / correlation already lives in sibling `evidence.ts`. Who decides current outcome and stages already lives in sibling `outcome.ts`. Who names §8 attention and limitations already lives in sibling `attention.ts`. Who redacts already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Five “wrap the already-assembled chain as the owner-facing v2 page” stories in one sitting, not “a projector CRUD service,” and not Assemble The Chain / Decide Booked Versus Cancelled / Redact The Page:

1. **Stamp each assembled event with dual clocks, stage, evidence, and correlation** — `projectEnhancedPage` maps every v1 event. **Asks** sibling `selectEventTime` for `time` (occurred stays the assembled clock; recorded comes from the loaded receipt / observation / lead / booking / cancellation / sheet job when present). Overwrites `event_at` with `time.occurred_at` and `clock_field` with `time.occurred_at_field` so v1 fields remain populated. **Asks** sibling `stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor` (passes `proof_shape`, `job_number_at_create`, and `cancellation_via_snapshot` from assemble’s `cancellationViaSnapshot`), and `evidenceRefsFor`. This beat does **not** invent an event. This beat does **not** emit `inferred` evidence (goldens lock that). This beat does **not** decide `current_outcome`.

2. **Group related rows into activities so an observation wave stays together and official facts keep their own activity** — `assignActivityIds`. For each loaded observation, the activity id is `activity:observation:<id>`. A still-unassigned event joins that wave when it shares the observation id, shares the receipt id, is a `lead_updated` / `job_number_acquired` at the wave time (`decision.event_at ?? observation.captured_at`), or is a `sheet_sync` at that wave time or whose `requested_at` matches. `lead_created`, `official_booking`, and `official_cancellation` are skipped in that pass. Leftovers: RingCentral `source_received` → `activity:source:ringcentral:<event.id>`; official Booking → `activity:booking:<booking_id>`; official Cancellation → `activity:cancellation:<cancellation_id>`; lead created → `activity:lead:<event.id>`; anything else → `activity:event:<event.id>`. Grouping does **not** delete events. This beat does **not** merge official Booking and official Cancellation into one activity.

3. **Link cause and result inside each activity** — `applyCausality`. Sort each activity by sibling `compareOccurredThenPriority`. Each event’s previous neighbor is `caused_by_event_ids`; the next neighbor is `resulting_event_ids`. Cross-activity links are empty. This beat does **not** invent a new sort. This beat does **not** drop events that have no neighbor.

4. **Cap the page at 250 later events and name the drop** — if the stamped list is longer than `JOB_TIMELINE_EVENT_CAP` (250), keep the first 250, drop the later ones, and push one `TIMELINE_TRUNCATED` limitation with the omitted ids and `counts_by_stage`. After the cap, strip causality ids that point at dropped events. `buildActivities` and every evaluator **ask** run on **kept** events only. Never a silent drop. This beat does **not** raise the cap. This beat does **not** drop from the front.

5. **Ask current outcome, stages, attention, and limitations, then stamp the owner-facing v2 page** — `assembled_at` is `now` when assemble passed it; else the last v1 `event_at`; else `1970-01-01T00:00:00.000Z`. Freshness **asks** sibling `evaluateFreshness` (`mongo_read_at` = `assembled_at`, `consistency` stays `multi_query_best_effort`, `google_destination_readback` stays `not_performed`). Current outcome **asks** sibling `evaluateCurrentOutcome` on kept events plus assemble’s coverage. Processing gap **asks** sibling `hasProcessingEvidenceGap`. Stages **ask** sibling `assessStages`. Attention **asks** sibling `evaluateAttention`. Limitations **ask** sibling `evaluateLimitations` with the truncation row already in `existing`. Summary headline **asks** sibling `outcomeHeadline`. Origin label is granularity → company → proof_shape (`WordPress` / `Granot` / `RingCentral`) → `Unknown origin`. Stamp `schema_version: "job_timeline.v2"`. Spread the v1 page so every v1 field remains. This beat does **not** recompute booked versus cancelled in this file. This beat does **not** redact. This beat does **not** write.

There is no sixth emit, load, or redact operation. `originLabel` / `observationIdOf` / `receiptIdOf` / `activityHeading` / `countByStage` / `truncationLimitation` / `assembledAt` are beats inside stories 1–5.

## Organization

Keep one file. This is the screenplay for “stamp the assembled events, group them into activities, name a 250-event drop, then ask the evaluators and stamp v2.” Dual clocks already live in sibling `clocks.ts`. Stage / evidence / correlation already live in sibling `evidence.ts`. Current outcome / stages already live in sibling `outcome.ts`. §8 attention / limitations / freshness already live in sibling `attention.ts`. v1 emit already lives in already-recommended `assemble.ts`. Redact already lives in sibling `masking.ts` via `module.ts`. Mongo hop already lives in sibling `mongo-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineProjectorService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second clock **adapter** so “the projector can pick recorded_at.” Do not invent a second outcome **adapter** so “the projector can decide booked.” Do not invent a CRUD folder so “each stamp gets a file.”

Do not move `evaluateCurrentOutcome` / `evaluateAttention` into this file so “one function owns the page.” Do not move `assignActivityIds` into assemble so “emit owns grouping.” Do not teach Admin to recompute outcome / attention / limitations so “the desk can paint without the server arrays.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `projectEnhancedPage` | `wrapTheAssembledChainAsTheOwnerFacingV2Page` | assemble **asks** it on `ok`; tests should **ask** it with an injected v1 page |
| `ProjectEnhancedPageInput` | `AssembledChainReadyForTheOwnerFacingPage` | `{ page, rows, now?, cancellationViaSnapshot? }` — the assemble handoff |

Keep the old names as one-line aliases until already-recommended `assemble.ts` migrates. Do not make callers learn `assignActivityIds` / `applyCausality` / `buildActivities` / `assembledAt` as the domain language. Do **not** put `projectEnhancedPage` onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted `schema_version: "job_timeline.v2"`, `JOB_TIMELINE_EVENT_CAP`, activity-id prefixes, or §8 codes. Do **not** return the v1 page from assemble so “assemble stops asking the projector” — that handoff is load-bearing.

**No workflow class.** The one type that *does* earn a name is the assemble handoff this file already consumes:

```ts
type AssembledChainReadyForTheOwnerFacingPage = {
  page: JobTimelinePage
  rows: JobTimelineRows
  now?: Date
  cancellationViaSnapshot?: boolean
}
```

That is the handoff from “the owner-facing chain is emitted” to “stamp clocks, group activities, cap later events, ask outcome / attention.” Do **not** add contact, SMS body, Sheet id, or `last_error` onto the stamped event so “the desk can debug.” Do **not** add a Mongo `Db` onto `wrapTheAssembledChainAsTheOwnerFacingV2Page` so “the projector can hop.”

Leave `selectEventTime` on sibling `clocks.ts`. Leave `evaluateCurrentOutcome` on sibling `outcome.ts`. Leave `evaluateAttention` on sibling `attention.ts`. Leave redact on `module.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// projector.ts
// The v1 chain is already assembled.
// Stamp each event, group related rows, name a 250-event drop,
// ask outcome / attention, stamp the owner-facing v2 page.

// ── 1. Stamp each assembled event ─────────────────────────

export function wrapTheAssembledChainAsTheOwnerFacingV2Page(input)
function stampDualClocksStageEvidenceAndCorrelation(event, page, rows, viaSnapshot)
  // asks selectEventTime / stageForKind / evidenceLevelFor /
  // eventSummary / eventStatus / correlationFor / evidenceRefsFor

// ── 2. Group related rows into activities ─────────────────

function groupRelatedRowsIntoActivities(events, rows)
function joinTheObservationWaveWhenSameObservationReceiptOrWaveTime(observation, event, waveTime)
function keepLeadCreatedOnItsOwnActivity(event)
function keepOfficialBookingOnItsOwnActivity(event)
function keepOfficialCancellationOnItsOwnActivity(event)
function keepRingCentralSourceOnItsOwnActivity(event)

// ── 3. Link cause and result inside each activity ─────────

function linkCauseAndResultInsideEachActivity(events)
  // asks compareOccurredThenPriority; no cross-activity links

// ── 4. Cap later events and name the drop ─────────────────

function keepTheFirst250AndNameTheLaterDrop(events)   // TIMELINE_TRUNCATED + counts_by_stage
function stripCausalityIdsThatPointAtDroppedEvents(kept, keptIds)
function buildActivityHeadingsFromKeptEvents(kept)

// ── 5. Ask outcome / attention and stamp the v2 page ──────

function assembledAtFromNowOrLastEventOrEpoch(page, now)
function originLabelFromGranularityCompanyOrProofShape(page)
function askFreshnessOutcomeStagesAttentionAndLimitations(kept, page, rows, now, truncated)
  // asks evaluateFreshness / evaluateCurrentOutcome / hasProcessingEvidenceGap /
  // assessStages / evaluateAttention / evaluateLimitations / outcomeHeadline
```

Read the wrap path out loud: *stamp each assembled event with dual clocks, stage, evidence, and correlation — including snapshot-only Cancellation as exact — group the observation wave together and keep lead created, official Booking, and official Cancellation on their own activities, link cause and result inside each activity, keep the first 250 events and name `TIMELINE_TRUNCATED` for the later ones, ask freshness, current outcome, the seven stages, attention, and limitations, then stamp `job_timeline.v2`.*

That is the operation. `projectEnhancedPage` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`assemble` also projects.** Every `ok` already **asks** this file. The assemble export name says v1 chain; the return is already `EnhancedJobTimelinePage`. Keep the handoff. Do not inline this file into assemble so “one function owns v1 and v2.” Do not stop calling this file so “assemble becomes v1 again.”

2. **Tests never **ask** this interface.** `v2.test.ts` and `evaluators.test.ts` go through `module.read`. That hides an assemble miss inside a projector rename and an evaluator miss inside a wrap rename. Bring dual-clock, observation-wave, independent official-fact activity, and 250-cap proofs onto `wrapTheAssembledChainAsTheOwnerFacingV2Page` (inject a v1 page + rows). Leave current-outcome / §8 proofs on the next `outcome.ts` / `attention.ts` passes.

3. **`assembledAt` falls through to epoch.** When `now` is missing and the v1 page has no events, the stamp is `1970-01-01T00:00:00.000Z`. Sibling `module.ts` always passes `input.now ?? new Date()`. That is the module **seam**, not a bug. Do not require `now` so “epoch disappears,” and do not have this file call `new Date()` so “the projector owns wall time.”

4. **Same-wave join is string equality.** `lead_updated` / `job_number_acquired` / `sheet_sync` join the observation wave when `event.event_at === waveTime` (or `requested_at === waveTime`). `waveTime` is `decision.event_at ?? observation.captured_at`. Rename the beat so the exact-string join stays visible. Do not switch to a clock range so “nearby Sheet Sync joins,” and do not drop the wave join so “every event is its own activity.”

5. **Lead created never joins the observation wave.** Even a Granot-born create that shares the observation receipt stays `activity:lead:<id>`. Goldens lock source received and lead created as separate events; grouping must not delete either. Do not fold lead created into the observation wave so “one activity owns ingress.”

6. **Official Booking and official Cancellation keep independent activity ids.** The cancelled golden locks `activity:booking:*` ≠ `activity:cancellation:*`. Do not merge them so “one official-fact activity owns the job.”

7. **Causality is neighbor-only inside one activity.** After the 250 cap, links that pointed at a dropped later event are stripped. Do not keep dangling ids so “the chain still points forward,” and do not add cross-activity cause so “the page reads as one story.”

8. **Evaluators run on kept events only.** A dropped later official Cancellation would change outcome if evaluators saw the full list. That is why the cap sits **before** the **asks**. Do not evaluate first and cap second so “outcome sees events the owner cannot.”

9. **`originLabel` guesses from `proof_shape`.** After granularity / company labels, `wordpress_born` → `WordPress`, `granot_born` → `Granot`, `ringcentral_born` → `RingCentral`, else `Unknown origin`. Assemble’s `proofShape` may itself have guessed WordPress from clocks. Rename the beat (`guessOriginLabelFromProofShapeWhenSourceLabelsAreEmpty`) so the guess stays visible. Do not delete it so “only a loaded granularity counts.”

10. **Leave sibling modules alone.** `selectEventTime`, `stageForKind`, `correlationFor`, `evaluateCurrentOutcome`, `evaluateAttention`, `evaluateFreshness` are already the right **depth**. This file orchestrates them. Do not silently change §4.2 outcome precedence, always-on limitations, or snapshot-cancel correlation while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `wrapTheAssembledChainAsTheOwnerFacingV2Page` (today `projectEnhancedPage`).

Today’s `v2.test.ts` already names dual clocks, observation-wave grouping, “grouping does not remove events,” independent official-fact activities, the 250-cap limitation, and “no inferred evidence” — but it **asks** `module.read`. That is the right assertion style on the wrong **seam**. Add (or move) those proofs onto this **interface** with an injected v1 page + rows so an assemble rename cannot hide a wrap miss.

Name the operation:

**Stamp**
- Every kept event has `time.occurred_at` === `event_at`, a `clock_field`, `stage`, `evidence_level` (never `inferred`), `correlation.method`, and `causality.activity_id`.
- Snapshot-only official Cancellation stamps `correlation.method: "direct_job_number"` / `confidence: "exact"` when `cancellationViaSnapshot` is true.
- Booking-linked official Cancellation stamps `booking_reference` when the flag is false.

**Group**
- Granot golden: receipt, observation, Decision, same-wave acquire, and same-wave Sheet Sync share `activity:observation:<id>`.
- Lead created stays `activity:lead:*` and remains on the page.
- Official Booking and official Cancellation have different activity ids.
- Grouping does not drop `source_received` or `lead_created`.

**Cap**
- 260 observations → 250 events, `summary.event_count` 250, one `TIMELINE_TRUNCATED` with omitted ids and `counts_by_stage.processing > 0`.
- Causality ids on kept events do not name dropped events.

**Stamp the page**
- `schema_version` is `job_timeline.v2`.
- Injected `now` becomes `assembled_at`.
- Missing `now` and empty events → epoch `assembled_at` (do not “fix” this in the rename).
- This file does not invent a `source_received` or an `official_booking`.

Do **not** add a test per helper (`joinTheObservationWaveWhenSameObservationReceiptOrWaveTime`, `originLabelFromGranularityCompanyOrProofShape`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`evaluateCurrentOutcome` / `evaluateAttention` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineProjectorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `stamp/` folder of one-field files.
- Breaking the v1 → projector **seam**. Assemble `ok` must still **ask** this file.
- Breaking the injected-`now` **seam**. This file must not call `new Date()` so it can stamp `assembled_at`.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating sibling `outcome.ts`, `attention.ts`, `clocks.ts`, or `evidence.ts` as this story — next passes own those checklists.
- Treating sibling `module.read` redact or `recent-official-bookings.ts` as this story.
- Inventing an outcome **seam** that has only one **adapter**.
- Silently “fixing” the epoch `assembled_at` fallback, the exact-string wave join, or assemble’s WordPress-born clock guess while renaming.
- Teaching Admin to recompute `current_outcome` / `attention` / `limitations`.
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
