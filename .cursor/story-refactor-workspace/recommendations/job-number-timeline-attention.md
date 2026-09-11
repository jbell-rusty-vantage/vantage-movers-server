# Flag Job-Scoped Facts Without A Safely Resolved Lead, A Resolved Booking Or Cancellation Case Without An Official Fact, An Orphan Cancellation Without A Durable Snapshot, Official Cancellation Whose Booking Document Is Gone, A Live Sheet Job Older Than One Hour Or Terminally Failed, Contradictory Official Clocks, Disagreeing Source Scopes, And A Claimed Applied Decision Without Its EntityChange — Always Name Multi-Query Read, Move Completion Unavailable, And Google Destination Unverified, Keep A Named 250-Cap Truncation, Name A Missing WordPress Receipt And A RingCentral Cursor Bound, Stamp Freshness Including Cursor Lag, And Say Whether There Is A Processing Evidence Gap For The Stage Assessment — Never Invent §8 Codes, Never Treat Intake As Official, Never Invent An Official Booking, Never Treat Synced Sheet As Google Equality, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 6 of this service — `attention.ts`
- Remaining in this service: `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/attention.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; JTE-03 evaluators — `attention.ts` owns one evaluator per specification §8 attention and limitation code plus freshness; always emit `MULTI_QUERY_READ`, `MOVE_COMPLETION_UNAVAILABLE`, `GOOGLE_DESTINATION_UNVERIFIED`; keep `TIMELINE_TRUNCATED` when the 250 cap hits; `OFFICIAL_BOOKING_UNAVAILABLE` when official Cancellation is present and the Booking document is not; WordPress-born pages keep `WORDPRESS_RECEIPT_UNAVAILABLE` until a WordPress `source_received` exists — a later Granot receipt does not clear it; RingCentral-born pages emit `RINGCENTRAL_CURSOR_BOUNDED` and fill cursor freshness; Sheet `synced` is not Google equality; move completion is a limitation, never a stage or event; do not invent other §8 codes; Admin displays these arrays and does not recompute them; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` stamps `coverage.lead` / `booking_intake` / `cancellation_intake` / `official_booking` / `official_cancellation` / `proof_shape` and emits official events — this file **reads** those flags, the kept events, and the loaded rows; it does **not** emit). Distinct from leftover v2 wrap: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md) (`projectEnhancedPage` **asks** `evaluateFreshness`, `hasProcessingEvidenceGap`, `evaluateAttention`, and `evaluateLimitations` after events and activities are finalized and after the 250 cap — this file is not the wrap **seam**; projector **hands** `TIMELINE_TRUNCATED` in `existing` and **hands** the processing-gap boolean into already-recommended `assessStages`). Distinct from leftover clocks: already-recommended [job-number-timeline-clocks.md](job-number-timeline-clocks.md) (this file ages a live Sheet job from `requested_at` or `event_at`; it does not pick recorded). Distinct from leftover evidence labels: already-recommended [job-number-timeline-evidence.md](job-number-timeline-evidence.md) (`stageForKind` names which stage an event belongs to; this file names page-level §8 codes, not a single-event label). Distinct from leftover current outcome: already-recommended [job-number-timeline-outcome.md](job-number-timeline-outcome.md) (`evaluateCurrentOutcome` / `assessStages` / `outcomeHeadline` — this file **asks** `officialFactsContradict` for `CONTRADICTORY_OFFICIAL_STATE`; outcome **asks** nothing from this file; projector **asks** `hasProcessingEvidenceGap` here and **hands** the boolean into `assessStages`; stage reason `BOOKING_UNAVAILABLE_AFTER_CANCELLATION` is not this file’s `OFFICIAL_BOOKING_UNAVAILABLE`). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts`. Distinct from leftover Owner sample: sibling `recent-official-bookings.ts`. Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). Distinct from leftover official Booking write: already-recommended [bookings-booked-lead.md](bookings-booked-lead.md). Distinct from leftover official Cancellation write: already-recommended [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from leftover Sheet Sync drain: already-recommended [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (this file names a live or failed outbox job; it does not drain). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **one runtime import site in `src/` plus one sibling import of the contradict beat the other way.** Already-recommended `projector.ts` **asks** `evaluateFreshness({ assembled_at, rows })`, `hasProcessingEvidenceGap({ rows, events: kept })`, `evaluateAttention({ page, events: kept, rows, now })`, and `evaluateLimitations({ page, events: kept, existing: truncated, ringcentral_covered_through })`. This file **asks** already-recommended `officialFactsContradict(events)` inside `evaluateContradictoryOfficialState`. Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests almost never import this file: `evaluators.test.ts` imports only `SHEET_SYNC_PENDING_TOO_LONG_MS` to age a pending Sheet job past (and just inside) the one-hour default; every §8 proof (unresolved Lead, resolved-without-fact cases, orphan Cancellation, snapshot-only `OFFICIAL_BOOKING_UNAVAILABLE`, pending-too-long, terminal Sheet failure, source-scope conflict, processing-evidence gap and its linked-change negative, contradictory official clocks, always-on limitations, WordPress receipt missing / not cleared by a later Granot receipt, RingCentral cursor bound + lag) **asks** `module.read`. `v2.test.ts` (WordPress `source_received` clears `WORDPRESS_RECEIPT_UNAVAILABLE`; goldens lock always-on codes) **asks** `module.read`. `assemble.test.ts` / `module.test.ts` / `masking.test.ts` do **not** **ask** this **interface**. CLI `render` / `discover` / `proof` **ask** `module.read`, not this file. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `evaluateCurrentOutcome`, `assessStages`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: kept events vs dropped later events (projector **asks** this file on **kept** events only — a dropped later failed Sheet job must not raise attention); assemble coverage / `proof_shape` vs loaded rows (unresolved Lead, resolved-without-fact, official-booking-unavailable, and WordPress / RingCentral limitations read coverage and `proof_shape`; orphan, source-scope, and processing-gap hop the loaded rows); official-fact clocks vs coverage flags (this file **asks** sibling `officialFactsContradict` — it does not re-compare clocks); injected `now` vs module-constant one-hour Sheet age (`SHEET_SYNC_PENDING_TOO_LONG_MS` is not `process.env`; projector does **not** pass `pendingTooLongMs`); projector-owned truncation vs this file’s keep (`evaluateLimitations` keeps only `existing` rows whose code is `TIMELINE_TRUNCATED` — it does not recompute the 250 cap); processing-gap boolean vs stage assessment (projector **asks** `hasProcessingEvidenceGap` here and **hands** the boolean into sibling `assessStages` — this file does not assess stages). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no loader **seam**. There is no outcome **adapter** in this file beyond the shared contradict **ask**. Owner-actor lives on the route, not here. Admin displays `attention` / `limitations` / `freshness`; it does not recompute them.
- Split later (only if the file outgrows one sitting): this ~371-line file is one sitting if you read it as name the ten §8 attention codes — always name the standing limitations and keep a named truncation — stamp freshness — say whether there is a processing evidence gap. If it later splits by **story**: `nameThePageLevelAttention.ts` / `nameTheStandingLimitationsAndFreshness.ts` — never `create.ts` / `update.ts` / `delete.ts` / `lead.ts` / `booking.ts` / `cancellation.ts` / `sheet.ts`. Assemble / projector / outcome stay siblings. `module.read` stays the HTTP/CLI **seam**.

`evaluateAttention` / `evaluateLimitations` / `evaluateFreshness` / `hasProcessingEvidenceGap` are executor mechanics. The owner question is: *The v1 chain is already assembled and the v2 wrap already kept the first 250 events. Say what the owner should look at on this Job Number. Job-scoped facts without a safely resolved Lead. A resolved Booking case or a resolved Cancellation case that never became an official fact. A Cancellation that points at a missing Booking and has no durable Job snapshot. An official Cancellation whose Booking document is gone — not contradictory, not an invented official Booking. A live Sheet Sync job older than one hour, or a terminally failed one. Official clocks that cannot produce one coherent outcome. Source scopes that disagree. A claimed applied Decision that lacks the EntityChange it required. Always say this page was assembled across multiple reads, that no move-completion system-of-record fact exists, and that Sheet Sync completion is not current Google destination equality — even when every outbox job is synced. If the wrap already named a 250-event drop, keep that named truncation. If this page is WordPress-born and there is no WordPress submission receipt, say the independent receipt is unavailable — a later Granot receipt does not clear that. If this page is RingCentral-born, bound call completeness by the provider cursor and stamp how stale that cursor is. Then tell the wrap, in one boolean, whether a processing evidence gap exists so the processing stage can show it. This file does not emit events. This file does not decide booked versus cancelled. This file does not invent an official Booking. This file does not invent a §8 code. This file does not load Mongo. This file does not write. This file does not call the forensic Granot timeline.*

Who stamps coverage, `proof_shape`, and official events already lives in already-recommended `assemble.ts`. Who **asks** this file after the 250 cap already lives in already-recommended `projector.ts`. Who decides current outcome and assesses the seven stages already lives in already-recommended `outcome.ts`. Who names which stage an event belongs to already lives in already-recommended `evidence.ts`. Who redacts the page already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Four “say what the owner should look at on this already-assembled page” stories in one sitting, not “an attention CRUD service,” and not Assemble The Chain / Wrap The V2 Page / Decide Booked Versus Cancelled:

1. **Name the page-level attention** — `evaluateAttention({ page, events, rows, now, pendingTooLongMs? })` walks ten catalog codes and drops the nulls. Order is the walk, not last-event-wins:
   - `LEAD_UNRESOLVED` — `coverage.lead === "unresolved"`. Event ids are origin or processing stage rows.
   - `BOOKING_CASE_RESOLVED_WITHOUT_FACT` — booking intake is `resolved` and there is no official Booking coverage. Event ids are `booking_intake`. Intake is not official.
   - `CANCELLATION_CASE_RESOLVED_WITHOUT_FACT` — cancellation intake is `resolved` and there is no official Cancellation coverage. Event ids are `cancellation_intake`.
   - `ORPHAN_CANCELLATION_REFERENCE` — a loaded Cancellation’s `booked_lead` is missing from loaded Bookings **and** it has no durable `normalized_job_no_snapshot` / `job_no_snapshot`. Event ids are `cancellation_intake` plus `official_cancellation` (often empty — assemble still refuses the official event). Snapshot-only cancel is **not** this code.
   - `OFFICIAL_BOOKING_UNAVAILABLE` — official Cancellation coverage is true and official Booking coverage is false. Event ids are `official_cancellation`. This is **not** sibling stage reason `BOOKING_UNAVAILABLE_AFTER_CANCELLATION`. This is **not** `CONTRADICTORY_OFFICIAL_STATE`.
   - `SHEET_SYNC_PENDING_TOO_LONG` — a `sheet_sync` event whose status is `pending` / `retrying` / `processing` and whose age from `data.requested_at` (else `event_at`) exceeds `pendingTooLongMs ?? SHEET_SYNC_PENDING_TOO_LONG_MS` (1 hour, module constant, not `process.env`). Projector does not pass the override; tests age `now`.
   - `SHEET_SYNC_TERMINAL_FAILURE` — a `sheet_sync` event whose status is `failed`.
   - `CONTRADICTORY_OFFICIAL_STATE` — **asks** sibling `officialFactsContradict(events)`. Event ids are official Booking plus official Cancellation. Snapshot-only cancel is **not** contradictory.
   - `SOURCE_SCOPE_CONFLICT` — unique source-granularity ids from `page.source`, kept Decision rows (`source_granularity_id` or `source_scope.source_granularity_id`), and active record links exceed one. Event ids are `lead_created` plus `synchronization_decision`. Decisions not kept after the 250 cap do not count.
   - `PROCESSING_EVIDENCE_GAP` — a kept Decision that requires a Lead change (`applied` / `created` on Form Lead or Call Lead, plus created or a lead-write reason / effect) has no matching EntityChange: `created` needs a create-command change; `applied` needs `decision_id` or `applied_at === decided_at`. Event ids are the kept Decision events. A Decision that does not require a Lead change is not a gap.
   This beat does **not** invent a code outside the catalog. This beat does **not** treat intake as official. This beat does **not** invent an `official_booking` so a snapshot cancel “has a booking.”

2. **Name the standing limitations and keep a named truncation** — `evaluateLimitations({ page, events, existing, ringcentral_covered_through })`:
   - Keep only `existing` rows whose code is `TIMELINE_TRUNCATED` (projector already named the 250-event drop). Do not recompute the cap.
   - Always emit `MULTI_QUERY_READ` (empty event ids) — this page is not one database snapshot.
   - Always emit `MOVE_COMPLETION_UNAVAILABLE` (empty event ids) — move completion is never a stage or event.
   - Always emit `GOOGLE_DESTINATION_UNVERIFIED` (Sheet Sync event ids, which may be empty) — outbox `synced` is not Google equality.
   - `WORDPRESS_RECEIPT_UNAVAILABLE` only when `proof_shape === "wordpress_born"` and there is no `source_received` with `ingress: "wordpress"`. A later Granot `source_received` does **not** clear it. Event ids are `lead_created`.
   - `RINGCENTRAL_CURSOR_BOUNDED` only when `proof_shape === "ringcentral_born"`. Label names the last successful cursor when `ringcentral_covered_through` is present; otherwise it says the cursor is not on this page. Event ids are RingCentral `source_received` rows.
   This beat does **not** emit `TIMELINE_TRUNCATED` on its own. This beat does **not** invent a limitation code.

3. **Stamp freshness** — `evaluateFreshness({ assembled_at, rows })` returns `mongo_read_at` = `assembled_at`, `consistency` = `multi_query_best_effort`, `google_destination_readback` = `not_performed`, `ringcentral_covered_through` = `rows.call_log_cursor.lastSyncTo` or null, and `ringcentral_cursor_lag_seconds` = floor seconds from that cursor to `assembled_at` (or null when either clock is missing). This beat does **not** read Google. This beat does **not** hop Mongo.

4. **Say whether there is a processing evidence gap** — `hasProcessingEvidenceGap({ rows, events })` is the story-1 gap beat as a boolean so projector can **hand** it into sibling `assessStages`. Same Decision / EntityChange rule. This beat does **not** assess the processing stage.

There is no fifth emit, load, or outcome operation. `item` / `limitation` / `idsForKind` / `sheetAgeMs` / `hasDurableSnapshot` / `decisionRequiresLeadChange` and the per-code `evaluate*` functions are beats inside stories 1–4. `reason_code` is always a copy of `code`.

## Organization

Keep one file. This is the screenplay for “name the ten §8 attention codes, always name the standing limitations and keep a named truncation, stamp freshness, say whether there is a processing evidence gap.” v1 emit already lives in already-recommended `assemble.ts`. v2 wrap already lives in already-recommended `projector.ts`. Dual clocks already live in already-recommended `clocks.ts`. Event labels already live in already-recommended `evidence.ts`. Current outcome / seven stages already live in already-recommended `outcome.ts`. Page redact already lives in sibling `masking.ts` via `module.ts`. Mongo hop already lives in sibling `mongo-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineAttentionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second contradict **adapter** so “attention can re-compare official clocks.” Do not invent a second emit **adapter** so “attention can invent `official_booking`.” Do not invent a CRUD folder so “each §8 code gets a file.”

Do not move `evaluateAttention` into projector so “one function owns the page.” Do not move `officialFactsContradict` into this file so “§8 owns the clock rule” — outcome and this file both need the same beat. Do not move `hasProcessingEvidenceGap` into outcome so “stages own the gap hop.” Do not teach Admin to recompute `attention` / `limitations` / `freshness` so “the desk can paint without the server stamp.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `lead.ts` / `booking.ts` / `sheet.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateAttention` | `nameThePageLevelAttention` | projector **asks** it on kept events + assemble coverage + loaded rows + `now` |
| `evaluateLimitations` | `nameTheStandingLimitationsAndKeepANamedTruncation` | projector **asks** it with already-built `TIMELINE_TRUNCATED` and cursor freshness |
| `evaluateFreshness` | `stampHowFreshThisMultiQueryPageIs` | projector **asks** it before limitations so the RingCentral cursor can be handed in |
| `hasProcessingEvidenceGap` | `sayWhetherAClaimedAppliedDecisionLacksItsEntityChange` | projector **asks** it and **hands** the boolean into sibling `assessStages` |
| `SHEET_SYNC_PENDING_TOO_LONG_MS` | `oneHourLiveSheetJobThreshold` | tests age `now` past / inside this module constant; not `process.env` |

Keep the old names as one-line aliases until already-recommended `projector.ts` migrates. Do not make callers learn `evaluateLeadUnresolved` / `evaluateProcessingEvidenceGap` / `decisionRequiresLeadChange` / `sheetAgeMs` / `item` / `limitation` as the domain language — those stay internal beats. Do **not** put these names onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted §8 code strings (`LEAD_UNRESOLVED`, `OFFICIAL_BOOKING_UNAVAILABLE`, `PROCESSING_EVIDENCE_GAP`, `WORDPRESS_RECEIPT_UNAVAILABLE`, `RINGCENTRAL_CURSOR_BOUNDED`, `GOOGLE_DESTINATION_UNVERIFIED`, `MULTI_QUERY_READ`, `MOVE_COMPLETION_UNAVAILABLE`, `TIMELINE_TRUNCATED`). Do **not** merge `OFFICIAL_BOOKING_UNAVAILABLE` into sibling stage reason `BOOKING_UNAVAILABLE_AFTER_CANCELLATION` so “one code paints both the stage and the attention chip.” Do **not** start returning a new §8 code so “snapshot cancel can be `CANCELLED_WITHOUT_BOOKING`.”

**No workflow class.** The one type that *does* earn a name is the projector handoff this file already consumes:

```ts
type KeptPageReadyForAttention = {
  page: JobTimelinePage                 // coverage + proof_shape from assemble
  events: EnhancedJobTimelineEvent[]    // kept after the 250 cap
  rows: JobTimelineRows                 // loaded decisions / changes / cancellations / cursor
  now: Date
  existingTruncation: TimelineLimitation[]
  ringcentral_covered_through: string | null
}
```

That is the handoff from “the owner-facing chain is capped” to “say what the owner should look at, how stale the page is, and whether processing is gapped.” Today the four exports take overlapping inline objects. Do **not** add contact, SMS body, Sheet id, or `last_error` onto an attention row so “the desk can debug.” Do **not** add a Mongo `Db` onto `nameThePageLevelAttention` so “attention can hop.”

Leave `projectEnhancedPage` on already-recommended `projector.ts`. Leave `evaluateCurrentOutcome` / `officialFactsContradict` / `assessStages` on already-recommended `outcome.ts`. Leave coverage emit on already-recommended `assemble.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// attention.ts
// The v1 chain is assembled and the wrap kept the first 250 events.
// Say what the owner should look at. Always name the standing limits.
// Stamp how fresh this multi-query page is. Say whether processing is gapped.

// ── 1. Page-level attention ────────────────────────────────

export function nameThePageLevelAttention({ page, events, rows, now, pendingTooLongMs })
function flagJobScopedFactsWithoutASafelyResolvedLead(coverage, events)
function flagAResolvedBookingCaseWithoutAnOfficialFact(coverage, events)
function flagAResolvedCancellationCaseWithoutAnOfficialFact(coverage, events)
function flagAnOrphanCancellationWithoutADurableSnapshot(rows, events)
function thisCancellationHasADurableJobSnapshot(row)               // leftover hasDurableSnapshot
function flagOfficialCancellationWhoseBookingDocumentIsGone(coverage, events)
function flagALiveSheetJobOlderThanTheOneHourThreshold(events, now, threshold)
function flagATerminallyFailedSheetJob(events)
function flagContradictoryOfficialClocks(events)                   // asks officialFactsContradict
function flagDisagreeingSourceScopes(page, rows, events)
function thisAppliedDecisionRequiresALeadChange(decision)          // leftover decisionRequiresLeadChange
function flagAClaimedAppliedDecisionWithoutItsEntityChange(rows, events)

// ── 2. Standing limitations + named truncation ─────────────

export function nameTheStandingLimitationsAndKeepANamedTruncation({
  page, events, existing, ringcentral_covered_through,
})
function keepTheNamedTwoHundredFiftyEventDrop(existing)            // TIMELINE_TRUNCATED only
function alwaysNameMultiQueryRead()
function alwaysNameMoveCompletionUnavailable()
function alwaysNameGoogleDestinationUnverified(events)
function nameAMissingWordpressSubmissionReceipt(page, events)
  // wordpress_born and no ingress:wordpress — Granot receipt does not clear
function nameTheRingcentralCursorBound(page, events, coveredThrough)

// ── 3. Freshness ───────────────────────────────────────────

export function stampHowFreshThisMultiQueryPageIs({ assembled_at, rows })
  // mongo_read_at, multi_query_best_effort, not_performed Google readback,
  // cursor + lag from call_log_cursor.lastSyncTo

// ── 4. Processing-gap boolean for the stage assessment ─────

export function sayWhetherAClaimedAppliedDecisionLacksItsEntityChange({ rows, events })
  // same gap beat as story 1 — projector hands the boolean into assessStages

export const oneHourLiveSheetJobThreshold = 60 * 60 * 1000         // leftover SHEET_SYNC_PENDING_TOO_LONG_MS
```

Read the attention path out loud: *flag job-scoped facts without a safely resolved Lead, a resolved Booking or Cancellation case without an official fact, an orphan Cancellation without a durable snapshot, official Cancellation whose Booking document is gone, a live Sheet job older than one hour or terminally failed, contradictory official clocks, disagreeing source scopes, and a claimed applied Decision without its EntityChange — always name multi-query read, move completion unavailable, and Google destination unverified, keep a named 250-cap truncation, name a missing WordPress receipt and a RingCentral cursor bound, stamp freshness including cursor lag, and say whether there is a processing evidence gap for the stage assessment.*

That is the operation. `evaluateAttention` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Tests never **ask** this interface.** `evaluators.test.ts` already names every catalog code and the always-on limitations — but it **asks** `module.read`. It imports only `SHEET_SYNC_PENDING_TOO_LONG_MS`. Bring those proofs onto `nameThePageLevelAttention` / `nameTheStandingLimitationsAndKeepANamedTruncation` / `stampHowFreshThisMultiQueryPageIs` / `sayWhetherAClaimedAppliedDecisionLacksItsEntityChange` (inject coverage + kept events + rows + `now`). Leave current-outcome strings and seven-stage labels on the already-recommended `outcome.ts` **interface**.

2. **`OFFICIAL_BOOKING_UNAVAILABLE` is not `BOOKING_UNAVAILABLE_AFTER_CANCELLATION`.** Attention names the missing Booking document. Sibling `assessStages` names the booking-stage reason. Snapshot-only cancel is `cancelled` + this attention code + that stage reason, **not** `contradictory`. Do not invent an `official_booking` event so “cancelled always has a booking,” and do not collapse the two codes so “one string paints the chip and the stage.”

3. **Orphan and snapshot-only are different loaded Cancellations.** Orphan = missing Booking **and** no durable snapshot → `ORPHAN_CANCELLATION_REFERENCE` (assemble still refuses the official event). Snapshot-only = durable snapshot, no live Booking → `OFFICIAL_BOOKING_UNAVAILABLE`. Do not flag snapshot-only as orphan so “every cancel without a live Booking looks broken,” and do not drop orphan attention because assemble already refused `not_found` on a first-hop miss — the observation-backed page in `evaluators.test.ts` is `ok` and still names the orphan.

4. **Contradict is the sibling clock rule, not a second compare.** This file **asks** `officialFactsContradict`. Do not re-read `event_at` here so “attention can disagree with outcome,” and do not move the beat here so “§8 owns chronology.”

5. **Processing gap is one beat, two exports.** `hasProcessingEvidenceGap` is `evaluateProcessingEvidenceGap !== null`. Projector **asks** the boolean and **hands** it into `assessStages`. `created` is satisfied by a create-command EntityChange; `applied` is satisfied by `decision_id` or `applied_at === decided_at`. A Decision that does not require a Lead change is not a gap. Do not treat every `applied` Decision as a gap so “policy-skip or no-op looks broken,” and do not inline the hop into outcome so “stages own the Decision rows.”

6. **Source-scope conflict counts kept Decisions only.** A Decision dropped by the 250 cap must not add a granularity. Active record links still count. `page.source.source_granularity_id` counts. One id is not a conflict.

7. **Live Sheet age uses `requested_at`, then `event_at`.** Status set is `pending` / `retrying` / `processing`. `failed` is the other code. Threshold default is the module constant (1 hour), not env. `sheetAgeMs` returns 0 on a bad clock, so a NaN date never exceeds the threshold. Do not switch the default to env so “ops can tune it from Vercel,” and do not count `synced` as live so “a finished job looks stuck.”

8. **Always-on limitations are not events and not stages.** Goldens lock no `move_completion` event or stage. `GOOGLE_DESTINATION_UNVERIFIED` still emits when every Sheet job is `synced`. Do not mark delivery complete so “a synced job looks verified,” and do not skip `MULTI_QUERY_READ` when the loader happens to be memory.

9. **WordPress limitation clears only on WordPress ingress.** `proof_shape === "wordpress_born"` plus a Granot `source_received` still keeps `WORDPRESS_RECEIPT_UNAVAILABLE`. `v2.test.ts` locks a loaded WordPress receipt clearing it. Do not treat Granot capture as the independent submission receipt.

10. **RingCentral limitation emits even when the cursor is missing.** The label changes; the code does not. Freshness may still have `ringcentral_covered_through: null` and `ringcentral_cursor_lag_seconds: null`. Do not hide the limitation when the cursor row is absent so “no cursor looks complete.”

11. **`evaluateLimitations` does not invent truncation.** It keeps projector’s `TIMELINE_TRUNCATED`. Do not re-run the 250 cap here so “attention can drop events,” and do not drop a truncation row whose `counts_by_stage` you dislike.

12. **`reason_code` is a copy of `code`.** Do not invent a second vocabulary so “the desk can paint a friendlier chip.” Do not export `item` / `limitation` so “callers can mint codes.”

13. **Evaluators run on kept events only.** That handoff lives on already-recommended `projector.ts` (cap **before** the **ask**). This file must not re-read the uncapped list so “attention sees events the owner cannot.”

14. **Leave sibling modules alone.** Assemble coverage, projector cap-then-ask, `officialFactsContradict`, `assessStages` are already the right **depth**. This file does not orchestrate them; projector orchestrates this file, this file **asks** the contradict beat. Do not silently add a §8 code, treat intake as official, or treat Sheet `synced` as Google equality while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `nameThePageLevelAttention`, `nameTheStandingLimitationsAndKeepANamedTruncation`, `stampHowFreshThisMultiQueryPageIs`, and `sayWhetherAClaimedAppliedDecisionLacksItsEntityChange` (today `evaluateAttention`, `evaluateLimitations`, `evaluateFreshness`, `hasProcessingEvidenceGap`). `SHEET_SYNC_PENDING_TOO_LONG_MS` stays the injected-threshold default, not a second **adapter**.

Today’s `evaluators.test.ts` already names those codes — but it **asks** `module.read`. That is the right assertion style on the wrong **seam**. Add (or move) those proofs onto this **interface** with injected coverage + kept events + rows + `now` so an assemble or outcome rename cannot hide an attention miss.

Name the operation:

**Attention**
- Unresolved Lead coverage → `LEAD_UNRESOLVED`.
- Resolved booking intake, no official Booking → `BOOKING_CASE_RESOLVED_WITHOUT_FACT`. Page outcome may still be `lead_active`.
- Resolved cancellation intake, no official Cancellation → `CANCELLATION_CASE_RESOLVED_WITHOUT_FACT`. Page outcome may still be `booked`.
- Cancellation whose Booking id is missing and which has no durable snapshot → `ORPHAN_CANCELLATION_REFERENCE`. Official Cancellation coverage stays false.
- Snapshot-only official Cancellation, no Booking event → `OFFICIAL_BOOKING_UNAVAILABLE`. Not `CONTRADICTORY_OFFICIAL_STATE`. Not `ORPHAN_CANCELLATION_REFERENCE`.
- Official Cancellation `event_at` before official Booking `event_at` → `CONTRADICTORY_OFFICIAL_STATE` (via sibling contradict). Official Cancellation after official Booking → no contradict attention.
- Ordinary booked page → empty attention.
- Live `pending` / `retrying` / `processing` Sheet job older than `SHEET_SYNC_PENDING_TOO_LONG_MS` → `SHEET_SYNC_PENDING_TOO_LONG`. Age equal to the threshold → no code. `failed` → `SHEET_SYNC_TERMINAL_FAILURE`, not pending-too-long.
- Kept Decision granularities disagreeing with `page.source` → `SOURCE_SCOPE_CONFLICT`.
- Applied Decision that requires a Lead change and lacks a matching EntityChange → `PROCESSING_EVIDENCE_GAP` and `hasProcessingEvidenceGap === true`. Linked `decision_id` change → no gap.

**Limitations**
- Every page emits `MULTI_QUERY_READ`, `MOVE_COMPLETION_UNAVAILABLE`, `GOOGLE_DESTINATION_UNVERIFIED`.
- Synced Sheet jobs still emit `GOOGLE_DESTINATION_UNVERIFIED`.
- `existing: [{ code: "TIMELINE_TRUNCATED", ... }]` is kept. Other `existing` codes are dropped.
- WordPress-born, no WordPress `source_received` → `WORDPRESS_RECEIPT_UNAVAILABLE`. Same page plus a Granot receipt → still present. WordPress `source_received` → cleared.
- RingCentral-born → `RINGCENTRAL_CURSOR_BOUNDED` whether the cursor is present or not.

**Freshness**
- `consistency` is `multi_query_best_effort`. `google_destination_readback` is `not_performed`.
- Cursor `lastSyncTo` plus `assembled_at` one hour later → `ringcentral_cursor_lag_seconds === 3600`.
- Missing cursor → `ringcentral_covered_through` null and lag null.

**Catalog**
- No invented attention or limitation code. No `TEXT_*` / `MESSAGE_*` attention on a policy-skip page.

Do **not** add a test per helper (`flagJobScopedFactsWithoutASafelyResolvedLead`, `thisAppliedDecisionRequiresALeadChange`, `sheetAgeMs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`evaluateCurrentOutcome` / `assessStages` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineAttentionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `item(code, label, ids)` or copy `reason_code: code`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `codes/` folder of one-export files.
- Breaking the projector **ask**. Wrap must still **ask** this file after the 250 cap, on kept events only, and must still **hand** `hasProcessingEvidenceGap` into `assessStages`.
- Breaking the outcome **ask**. This file must still **ask** `officialFactsContradict` rather than re-compare clocks.
- Breaking the injected one-hour Sheet **seam**. Do not read `process.env` for the threshold.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts`, `projector.ts`, `clocks.ts`, `evidence.ts`, or `outcome.ts` as this story.
- Treating sibling `mongo-evidence-loader.ts` or `recent-official-bookings.ts` as this story — later passes own those checklists.
- Inventing an emit **seam** that has only these codes as an **adapter**.
- Inventing a §8 code that is not on the catalog, including a merged `CANCELLED_WITHOUT_BOOKING`.
- Silently “fixing” snapshot-cancel attention into contradictory, WordPress limitation cleared by a Granot receipt, always-unverifiable Google destination, or orphan-vs-snapshot while renaming.
- Teaching Admin to recompute `attention`, `limitations`, or `freshness`.
- Returning `CONTRADICTORY_OFFICIAL_STATE` for snapshot-only Cancellation so “missing booking looks like a clock fight.”
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
