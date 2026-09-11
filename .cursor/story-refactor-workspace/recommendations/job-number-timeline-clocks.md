# Keep The Assembled Occurred Clock, Then Pick Recorded From The Loaded Receipt Observation Processed Call Lead Message Booking Cancellation Or Sheet Job And Name How Precise That Recorded Clock Is — Capture For WordPress And Granot Ingress, Domain For RingCentral Ingress, Provider For A Delivered Or Sent Text, Storage Fallback For Command-Less Lead Created — Then Order By Occurred Then Type Then Id — Never Recompute Occurred, Never Invent Events, Never Sort By Recorded, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 3 of this service — `clocks.ts`
- Remaining in this service: `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/clocks.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; JTE-02 dual clocks; default order is `occurred_at` ASC, then type priority, then id; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` stamps `event_at` / `clock_field` and sorts the v1 chain with its own `sortEvents` — this file **does not import** assemble; it **does not** recompute occurred). Distinct from leftover v2 wrap: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md) (`projectEnhancedPage` **asks** this file for `time` on every stamped event and **asks** `compareOccurredThenPriority` when linking cause and result — this file is not the wrap **seam**). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover evidence labels: sibling `evidence.ts` (`stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor`, `evidenceRefsFor` — projector **asks** those next to this file; this file does not label stage). Distinct from leftover evaluators: siblings `outcome.ts` / `attention.ts`. Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts`. Distinct from leftover Owner sample: sibling `recent-official-bookings.ts`. Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **one runtime import site in `src/`.** Already-recommended `projector.ts` **asks** `selectEventTime(event, input.rows)` while stamping each assembled event and **asks** `compareOccurredThenPriority` twice (link cause and result inside an activity; build activity headings). Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests never import this file: `v2.test.ts` (“dual clocks order by occurred time and preserve recorded time” — Granot `source_received` `occurred_at` is `T0`, `recorded_at` is `T_RECORDED`, `event_at` stays occurred) **asks** `module.read`. `assemble.test.ts` / `evaluators.test.ts` / `module.test.ts` / `masking.test.ts` do **not** **ask** this **interface**. CLI `render` / `discover` / `proof` **ask** `module.read`, not this file. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `stageForKind`, `evaluateCurrentOutcome`, `evaluateAttention`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: assembled occurred vs recorded from the loaded row (occurred is always `event.event_at` / `event.clock_field`; this file never rewrites it); capture vs domain vs provider vs storage-fallback precision; WordPress / Granot ingress vs RingCentral ingress (RingCentral stays domain); command-backed lead created (`applied_at` → recorded equals occurred) vs official-fact-only lead created (`storage_fallback`); projector causality sort vs assemble v1 `sortEvents` (same three keys, two copies). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no redact **seam**. There is no loader **seam**. There is no outcome **adapter**. Owner-actor lives on the route, not here. Admin displays `time`; it does not recompute it.
- Split later (only if the file outgrows one sitting): this ~186-line file is one sitting if you read it as keep occurred — pick recorded and precision per kind — then order by occurred then type then id. If it later splits by **story**: do not. One pick plus one compare. Never `create.ts` / `update.ts` / `delete.ts` / `wordpress.ts` / `granot.ts`. Assemble / projector / evidence stay siblings. `module.read` stays the HTTP/CLI **seam**.

`selectEventTime` is executor mechanics. The owner question is: *The v1 chain already says when this event occurred. Keep that clock. Then say when we recorded it from the loaded WordPress receipt, Granot receipt, RingCentral processed call, observation, lead, text, Booking, Cancellation, or Sheet Sync job — and how precise that recorded clock is. WordPress and Granot ingress are capture. RingCentral ingress stays domain. A text whose assembled clock already used delivered or sent is provider. A lead created with no command is storage fallback. If the loaded row is missing, recorded falls back to occurred — never invent a second instant. Then, when the projector links cause and result inside an activity, order by occurred, then type priority, then id. This file does not emit events. This file does not recompute occurred. This file does not sort by recorded. This file does not decide booked versus cancelled. This file does not redact. This file does not load Mongo. This file does not write. This file does not call the forensic Granot timeline.*

Who stamps `event_at` already lives in already-recommended `assemble.ts`. Who copies `time` onto the v2 event already lives in already-recommended `projector.ts`. Who labels stage / evidence / correlation already lives in sibling `evidence.ts`. Who decides current outcome already lives in sibling `outcome.ts`. Who redacts already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Two “name when it occurred versus when we recorded it, then keep the three-key order” stories in one sitting, not “a clock helper CRUD service,” and not Assemble The Chain / Wrap The V2 Page / Decide Booked Versus Cancelled:

1. **Keep the assembled occurred clock, then pick recorded from the loaded row and name how precise that recorded clock is** — `selectEventTime(event, rows)`. `occurred_at` / `occurred_at_field` are always `event.event_at` / `event.clock_field`. This beat does **not** walk assemble’s emit again. Recorded and precision then branch on kind / ingress / coverage:
   - WordPress `source_received`: find the WordPress receipt by `data.receipt_id`. Recorded is `createdAt` else `received_at` else occurred. Field name is `wordpress_receipt.createdAt` when `createdAt` won, else `wordpress_receipt.received_at` even when both are missing. Precision is `capture`.
   - Granot `source_received`: find the Granot receipt by `data.receipt_id`. Recorded is `createdAt` else `captured_at` else occurred. Field name is `receipt.createdAt` when `createdAt` won, else `receipt.captured_at`. Precision is `capture`.
   - RingCentral `source_received`: slice `source_received:ringcentral:` off `event.id` and find that processed-call row. Recorded is `updatedAt` else `firstProcessedAt` else occurred. Field name follows which one won. Precision is **`domain`**, not capture.
   - `granot_observation`: find the observation by `data.observation_id`. Recorded is `createdAt` else occurred. Precision is `capture` only when `createdAt` exists **and** differs from occurred; otherwise `domain`.
   - `lead_message`: slice `lead_message:` off `event.id`. Recorded is `createdAt` else occurred. Precision is `provider` when the assembled `clock_field` includes `delivered` or `sent`; otherwise `domain`.
   - `lead_created` with `coverage === "official_fact_only"`: slice `lead_created:` off `event.id`. Recorded is `lead.createdAt` else occurred. Precision is `storage_fallback`. Command-backed lead created (`entity_change.applied_at`) does **not** take this branch.
   - `sheet_sync`: find the job by `data.job_id` else the id suffix. Recorded is `createdAt` else occurred. Field name is **always** `sheet_sync_job.createdAt`, even when the job is missing or assemble’s occurred clock was `sheet_sync_job.updatedAt` for a terminal job.
   - `official_booking` / `official_cancellation`: recorded is the document `createdAt` else occurred. Precision is `domain` even when coverage is `official_fact_only`.
   - Assembled `clock_field` contains `applied_at` or `decided_at` (command-backed create, Job Number acquire, lead update, latest Decision): recorded equals occurred, precision `domain`.
   - Everything else (`job_number_acquired` without those substrings, `lead_updated`, booking / cancellation intake, default): recorded equals occurred, precision `domain`.
   Empty or whitespace ISO strings are treated as missing (`asIso`). This beat does **not** invent an event. This beat does **not** return `recorded_at: null` in practice — the type allows null, every branch falls back to occurred. This beat does **not** change `event_at`.

2. **Order by occurred, then type priority, then id** — `compareOccurredThenPriority`. Locale-compare `time.occurred_at`, then numeric `type_priority`, then `id`. Does **not** read `recorded_at`. Does **not** read `precision`. Projector **asks** this when linking cause and result inside one activity and when building activity headings. Already-recommended `assemble.ts` already sorts the v1 chain with the same three keys on `event_at` / `type_priority` / `id` (`sortEvents`). Those are two copies, not two policies. This beat does **not** reorder the v1 page. This beat does **not** drop events.

There is no third emit, load, or redact operation. `receiptForEvent` / `processedCallForEvent` / `asIso` are beats inside story 1.

## Organization

Keep one file. This is the screenplay for “keep occurred, pick recorded and precision per kind, then keep the three-key order.” v1 emit already lives in already-recommended `assemble.ts`. v2 wrap already lives in already-recommended `projector.ts`. Stage / evidence / correlation already live in sibling `evidence.ts`. Current outcome / stages already live in sibling `outcome.ts`. §8 attention already lives in sibling `attention.ts`. Redact already lives in sibling `masking.ts` via `module.ts`. Mongo hop already lives in sibling `mongo-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineClocksService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second emit **adapter** so “clocks can invent `source_received`.” Do not invent a second sort **adapter** so “recorded can win the page.” Do not invent a CRUD folder so “each ingress gets a file.”

Do not move `selectEventTime` into assemble so “emit owns recorded.” Do not move it into projector so “the wrap owns clocks.” Do not teach Admin to recompute `time` so “the desk can paint without the server stamp.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `wordpress.ts` / `ringcentral.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `selectEventTime` | `keepOccurredAndPickRecordedFromTheLoadedRow` | projector **asks** it on every stamped event; tests should **ask** it with an injected v1 event + rows |
| `compareOccurredThenPriority` | `orderByOccurredThenTypeThenId` | projector causality / activity headings; same three keys as assemble `sortEvents` |

Keep the old names as one-line aliases until already-recommended `projector.ts` migrates. Do not make callers learn `receiptForEvent` / `processedCallForEvent` / `asIso` as the domain language. Do **not** put `selectEventTime` onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted `time.occurred_at` / `time.recorded_at` / `precision` strings (`capture` / `domain` / `provider` / `storage_fallback`). Do **not** return `recorded_at: null` so “missing stays visible” without an **interface** proof — today every branch falls back to occurred.

**No workflow class.** The one type that *does* earn a name is the dual-clock stamp this file already returns:

```ts
type OccurredVersusRecordedForThisAssembledEvent = {
  occurred_at: string
  occurred_at_field: string
  recorded_at: string
  recorded_at_field: string
  precision: "provider" | "domain" | "capture" | "storage_fallback"
}
```

That is the handoff from “assemble already named when it occurred” to “projector can stamp `time`.” Today’s `TimelineEventTime` allows `recorded_at` / `recorded_at_field` to be null; this file never writes null. Do **not** add contact, SMS body, Sheet id, or `last_error` onto the stamp so “the desk can debug.” Do **not** add a Mongo `Db` onto `keepOccurredAndPickRecordedFromTheLoadedRow` so “clocks can hop.”

Leave `projectEnhancedPage` on already-recommended `projector.ts`. Leave `event_at` emit on already-recommended `assemble.ts`. Leave `stageForKind` on sibling `evidence.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// clocks.ts
// The v1 chain already says when this event occurred.
// Keep that clock. Pick recorded from the loaded row.
// Name how precise that recorded clock is.
// Then order by occurred, then type, then id.

// ── 1. Keep occurred, pick recorded and precision ─────────

export function keepOccurredAndPickRecordedFromTheLoadedRow(event, rows)
function keepTheAssembledOccurredClock(event)          // event_at / clock_field only
function pickWordPressRecordedFromTheLoadedReceipt(event, rows)
  // createdAt else received_at else occurred; precision capture
function pickGranotRecordedFromTheLoadedReceipt(event, rows)
  // createdAt else captured_at else occurred; precision capture
function pickRingCentralRecordedFromTheLoadedProcessedCall(event, rows)
  // updatedAt else firstProcessedAt else occurred; precision domain
function pickObservationRecordedAndCaptureOnlyWhenCreatedDiffers(event, rows)
function pickLeadMessageRecordedAndProviderWhenDeliveredOrSent(event, rows)
function pickStorageFallbackRecordedForCommandLessLeadCreated(event, rows)
function pickSheetJobCreatedAtAsRecordedEvenWhenOccurredWasUpdatedAt(event, rows)
function pickOfficialFactCreatedAtAsDomainRecorded(event, rows)
function recordEqualsOccurredForAppliedOrDecidedClocks(event)
function recordEqualsOccurredForEverythingElse(event)

// ── 2. Order by occurred, then type, then id ──────────────

export function orderByOccurredThenTypeThenId(left, right)
  // does not read recorded_at
```

Read the pick path out loud: *keep the assembled occurred clock, pick recorded from the loaded WordPress receipt / Granot receipt / RingCentral processed call / observation / lead / text / Booking / Cancellation / Sheet job — capture for WordPress and Granot ingress, domain for RingCentral ingress, provider for a delivered or sent text, storage fallback for a command-less lead created — fall back to occurred when the row is missing, then order by occurred, then type priority, then id.*

That is the operation. `selectEventTime` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Occurred is a copy, not a second walk.** `keepTheAssembledOccurredClock` does not re-read `received_at` / `captured_at` / `firstProcessedAt`. Assemble already chose those. Do not recompute occurred so “clocks own both instants,” and do not have assemble **ask** this file so “emit can stamp `time` before the projector.”

2. **Tests never **ask** this interface.** `v2.test.ts` locks Granot `source_received` occurred `T0` / recorded `T_RECORDED` through `module.read`. That hides an assemble miss inside a clocks rename. Bring WordPress / Granot / RingCentral / official-fact-only lead created / terminal Sheet Sync proofs onto `keepOccurredAndPickRecordedFromTheLoadedRow` (inject a v1 event + rows). Leave wrap / activity / 250-cap proofs on already-recommended `projector.ts`.

3. **Two three-key sorts.** Assemble `sortEvents` compares `event_at` / `type_priority` / `id`. This compare compares `time.occurred_at` / `type_priority` / `id`. Today they match because occurred copies `event_at`. Do not delete this compare so “assemble already sorted,” and do not have assemble import this compare so “one sort owns the company” without proving the v1 page order stays. Do not sort by `recorded_at` so “capture time wins the page.”

4. **WordPress `recorded_at_field` lies when the receipt is missing.** Recorded falls back to occurred, but the field name stays `wordpress_receipt.received_at` because `receipt?.createdAt` is falsy. Same shape for Granot (`receipt.captured_at`) and Sheet Sync (always `sheet_sync_job.createdAt`). Rename the beat so the leftover field name stays visible. Do not null the field so “missing stays honest” without an **interface** proof.

5. **Terminal Sheet Sync recorded is createdAt, occurred may be updatedAt.** Assemble uses `updatedAt || createdAt` when status is `synced` / `failed` / `cancelled`. This file always prefers `job.createdAt` for recorded and always names `sheet_sync_job.createdAt`. Do not switch recorded to `updatedAt` so “the two clocks match,” and do not change assemble’s terminal occurred clock in this pass.

6. **RingCentral ingress is domain, not capture.** WordPress and Granot `source_received` are `capture`. RingCentral uses `updatedAt` / `firstProcessedAt` and stamps `domain`. Do not promote it to `capture` so “every ingress is capture.”

7. **Observation capture requires a different createdAt.** Precision is `capture` only when `observation.createdAt` exists and `!== occurred_at` (assemble’s `observation.captured_at`). Equal clocks stay `domain`. Do not stamp capture whenever `createdAt` exists so “every observation is capture.”

8. **Storage fallback is lead-created official-fact only.** Official Booking and official Cancellation can also be `official_fact_only`; this file still stamps `domain` and uses document `createdAt`. Do not give them `storage_fallback` so “every official-fact clock matches,” and do not give command-backed lead created (`applied_at`) `storage_fallback`.

9. **Lead-message provider is a substring on `clock_field`.** Assemble already chose `lead_message.delivered_at` / `sent_at` / `accepted_at` / `createdAt`. This file does not re-read those columns. `accepted_at` stays `domain`. Do not treat `accepted` as provider so “every Twilio status is provider.”

10. **`recorded_at` is typed nullable and never null.** Every branch falls back to occurred. Do not start returning null so “the type becomes true” without goldens. Do not drop the fallback so “missing recorded hides the event.”

11. **RingCentral row is found by id suffix, not `data`.** Assemble does not put `processed_call_id` on `data`; this file slices `source_received:ringcentral:`. WordPress / Granot use `data.receipt_id`. Do not invent a processed-call id on emit so “clocks can stop parsing,” and do not parse WordPress / Granot ids the same way so “one suffix owns ingress.”

12. **Leave sibling modules alone.** Assemble emit, projector wrap, `stageForKind`, `evaluateCurrentOutcome` are already the right **depth**. This file does not orchestrate them; projector orchestrates this file. Do not silently change assemble’s WordPress `received_at` occurred clock, RingCentral qualified statuses, or snapshot-cancel emit while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `keepOccurredAndPickRecordedFromTheLoadedRow` and `orderByOccurredThenTypeThenId` (today `selectEventTime`, `compareOccurredThenPriority`).

Today’s `v2.test.ts` already names “dual clocks order by occurred time and preserve recorded time” — but it **asks** `module.read`. That is the right assertion style on the wrong **seam**. Add (or move) those proofs onto this **interface** with an injected v1 event + rows so an assemble rename cannot hide a clocks miss.

Name the operation:

**Keep occurred, pick recorded**
- Granot `source_received` with receipt `captured_at: T0` / `createdAt: T_RECORDED` → occurred `T0` / `receipt.captured_at`, recorded `T_RECORDED` / `receipt.createdAt`, precision `capture`.
- WordPress `source_received` with `createdAt` present → recorded is `createdAt`, field `wordpress_receipt.createdAt`, precision `capture`. Missing `createdAt` → `received_at`. Missing receipt → recorded equals occurred, field still `wordpress_receipt.received_at` (do not “fix” this in the rename).
- RingCentral `source_received` with `updatedAt: T_RECORDED` / `firstProcessedAt: T0` → recorded `T_RECORDED`, precision `domain`.
- Observation `createdAt !== captured_at` → precision `capture`. Equal clocks → `domain`.
- `lead_message` whose `clock_field` includes `delivered` or `sent` → precision `provider`. `accepted_at` → `domain`.
- `lead_created` + `official_fact_only` → precision `storage_fallback`. `lead_created` + `command_backed` / `applied_at` → recorded equals occurred, precision `domain`.
- Terminal `sheet_sync` whose occurred clock is `updatedAt` still records `job.createdAt` and names `sheet_sync_job.createdAt`.
- Official Booking / official Cancellation `official_fact_only` stay `domain`.
- This file does not invent a `source_received` or change `event_at`.

**Order by occurred, then type, then id**
- Earlier `occurred_at` sorts first even when recorded is later.
- Same occurred → lower `type_priority` first.
- Same occurred and priority → `id` locale-compare.
- `recorded_at` does not break a tie.

Do **not** add a test per helper (`pickWordPressRecordedFromTheLoadedReceipt`, `keepTheAssembledOccurredClock`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`projectEnhancedPage` / `assembleJobNumberTimeline` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineClocksService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `asIso` or `localeCompare`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or an `ingress/` folder of one-kind files.
- Breaking the assembled-occurred **seam**. This file must not recompute `event_at`.
- Breaking the projector **ask**. Wrap must still **ask** this file for `time`.
- Sorting by `recorded_at` so “capture time wins the page.”
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts` or `projector.ts` as this story.
- Treating sibling `evidence.ts`, `outcome.ts`, or `attention.ts` as this story — next passes own those checklists.
- Inventing an emit **seam** that has only this clock pick as an **adapter**.
- Silently “fixing” the leftover WordPress field name, terminal Sheet Sync `createdAt` recorded clock, RingCentral `domain` precision, or nullable-but-never-null `recorded_at` while renaming.
- Teaching Admin to recompute `time`.
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
