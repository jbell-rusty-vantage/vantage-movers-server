# Refuse A Job Number That Does Not Normalize, Refuse A First-Hop Miss Including A Lead-Only Row Or An Orphan Cancellation Without A Snapshot, Filter Out A Company Or Granularity That Does Not Own This Job, Then Assemble The Owner-Facing Chain From The Loaded Rows — Source Received Only From A Loaded Receipt, Latest Decision Attempt Only, Sheet Sync By Entity Id Never Job Number, Snapshot-Only Cancellation Without Inventing A Booking — Never Mutate, Never Infer Events, Never Treat Intake As Official, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 1 of this service — `assemble.ts`
- Remaining in this service: `projector.ts`, `clocks.ts`, `evidence.ts`, `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/assemble.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain from already-loaded rows; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** this file, then redacts). Distinct from leftover v2 wrap: sibling `projector.ts` (`projectEnhancedPage` — this file **asks** it on `ok` only). Distinct from leftover evaluators: siblings `outcome.ts` / `attention.ts` (current outcome, stages, §8 codes — projector **asks** those; this file does not). Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts` (safe projections; snapshot Cancellation hop; WordPress receipt by `lead_ref.id`). Distinct from leftover Owner sample: sibling `recent-official-bookings.ts` (at most three official Booking Job Numbers — **not** `assembleJobNumberTimeline`). Distinct from leftover Job Number identity: already-recommended [bookings-booking-identity.md](bookings-booking-identity.md) (sibling `normalize.ts` re-exports `normalizeJobNo` / `jobNumbersEquivalent`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md) (capture of a [WordPress Form Submission Receipt](../../../../CONTEXT.md) — this file only emits `source_received` when that row is already loaded). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). CLI `discover.ts` is the only caller of leftover `hasSuccessfulLeadMessage`; it is not an HTTP catalog. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Job Number Timeline Service file in this rename.
- Callers: **one runtime import site in `src/`.** Sibling `module.ts` **asks** `assembleJobNumberTimeline` after the loader returns rows (and after it may have already refused a company/granularity mismatch with empty `scopes`). Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests: `assemble.test.ts` (WordPress walk-back, Granot-born, latest Decision attempt only, granularity `filtered_out`, no contact match, Priority 5 is not Booked, case is not a Booking, equivalent Job Number, Sheet Sync by entity id, unresolved Lead has no source-lead Sheet Sync, orphan cancellation without snapshot is `not_found`, Lead-only typed search is `not_found`, blank Job Number is `invalid_job_number`, assemble is pure). `module.test.ts` compares module headlines to this file’s headlines and repeats not-found / filter / redact proofs on `module.read`. `masking.test.ts` **asks** this file then serializes. Snapshot-only Cancellation, WordPress `source_received`, and `WORDPRESS_RECEIPT_UNAVAILABLE` live on `evaluators.test.ts` / `v2.test.ts` through `module.read`, not this **interface**. CLI: `scripts/prototypes/job-number-timeline/src/discover.ts` **asks** leftover `hasSuccessfulLeadMessage`; `discover.test.ts` and `scripts/prototypes/lifecycle-assurance/src/load.ts` **ask** `assembleJobNumberTimeline`. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `createJobNumberTimelineModule`, `projectEnhancedPage`, `evaluateCurrentOutcome`, `evaluateAttention`, `listRecentOfficialBookingExamples`, `loadJobNumberTimelineRows`, leftover `projections.ts`.
- Seams callers need: injected rows vs Mongo hop (this file never loads); v1 chain vs enhanced page (`ok` **asks** sibling `projectEnhancedPage`); first-hop found vs `not_found` vs `filtered_out` vs `invalid_job_number`; Booking-linked Cancellation vs snapshot-only Cancellation (`cancellationViaSnapshot` is the handoff the projector needs). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no redact **seam** in this file (module redacts after). There is no loader **seam** in this file. Owner-actor lives on the route, not here.
- Split later (only if the file outgrows one sitting): this ~1,009-line file is one sitting if you read it as refuse an unnormalizable Job Number — refuse a first-hop miss — filter out a company or granularity that does not own this job — assemble the owner-facing chain from the loaded rows. If it later splits by **story**: `refuseAFirstHopMiss.ts` / `emitTheOwnerFacingJobNumberChain.ts` — never `create.ts` / `update.ts` / `delete.ts`. Projector / outcome / attention / Mongo loader / recent-official-bookings stay siblings. `module.read` stays the HTTP/CLI **seam**.

`assembleJobNumberTimeline` is executor mechanics. The owner question is: *I typed a Job Number. If that value does not normalize, say invalid. If the first hop finds no observation, record link, Booking, booking/release case, discrepancy, or snapshot-matching Cancellation, say not found — a Lead sitting alone, a text sitting alone, or an orphan Cancellation without a durable job snapshot is not a hop. If I asked for a company or granularity that none of the resolved scopes match, say filtered out and show me those scopes. Otherwise walk the chain I can read out loud: source received only when a WordPress, Granot, or RingCentral receipt actually loaded; lead created; texts for that Lead; Job Number acquired; lead updates that are more than the job-number stamp; Granot observations; the latest Decision attempt only; booking and release intake opened, refreshed, and resolved; official Booking; official Cancellation, including a snapshot-only cancel without inventing a Booking; Sheet Sync joined by entity id, never by Job Number. Sort by clock, then type priority, then id. Hand the v1 page to the projector. This file does not load Mongo. This file does not redact the page. This file does not decide `current_outcome`. This file does not write. This file does not call the forensic Granot timeline.*

Who hops Mongo already lives in sibling `mongo-evidence-loader.ts`. Who wraps v2 clocks, activities, outcome, attention, and the 250 cap already lives in sibling `projector.ts`. Who redacts contact / SMS / Sheet id already lives in sibling `masking.ts` via `module.ts`. Who lists three recent official Bookings already lives in sibling `recent-official-bookings.ts`. Do not pull those in.

## What this file actually does

Four “tell the owner what this Job Number already recorded” stories in one sitting, not “a timeline CRUD service,” and not Load The Mongo Rows / Decide The Current Outcome / Redact The Page:

1. **Refuse a Job Number that does not normalize** — `assembleJobNumberTimeline` when `normalizeTypedJobNo(rawJobNo)` is empty (blank, whitespace). Return `{ status: "invalid_job_number", normalized_job_no: null }`. Sibling `module.ts` already refused the same blank before load; this beat refuses again so the pure function stays closed. This beat does **not** load. This beat does **not** emit events.

2. **Refuse a first-hop miss** — after flattening nested row shapes, keep observations / record links / bookings / booking cases / release cases / booking discrepancies / release discrepancies whose stored Job Number is equivalent to the typed value. Also keep Cancellations whose `normalized_job_no_snapshot` (or normalized `job_no_snapshot`) matches. If every one of those bags is empty → `{ status: "not_found", normalized_job_no }`. A Lead that already stores this Job Number is **not** a hop. A Lead Message is **not** a hop. An orphan Cancellation whose `booked_lead` is missing and that has no durable job snapshot is **not** a hop (`orphan cancellation without snapshot is not a first-hop survivor`). A discrepancy row with no later event kind still keeps the job **found**. This beat does **not** invent an `official_booking` event. This beat does **not** attach the orphan.

3. **Filter out a company or granularity that does not own this job** — resolve scopes from the Lead, the active record link, the latest Decision, and observation → Granot CRM source routes. If the caller asked for `source_granularity_id` and/or `company_granularity_ids` and none of those scopes match → `{ status: "filtered_out", normalized_job_no, scopes }`. Sibling `module.ts` may have already returned `filtered_out` with **empty** `scopes` when the typed granularity is not in the company’s list, before this file runs. This beat returns the scopes it resolved. This beat does **not** hide a found job as `not_found`.

4. **Assemble the owner-facing chain from the loaded rows** — the `ok` path. Latest Decision attempt only (`latestDecisions`). Resolve the Lead: active record link with `lead_ref` → Booking `lead_ref` / `lead_model` → latest applied Decision whose target is a Form Lead or Call Lead; a missing Lead document still yields `{ id, model }` so later emits can run. Select Cancellations: Booking-linked first; else snapshot-matching (`viaSnapshot`). Sheet Sync jobs only when a Lead, Booking, or Cancellation resolved, and only when `entity_id` is that Lead / Booking / Cancellation — never by Job Number. Then emit, in this order, before the clock sort: `source_received` (WordPress receipt whose `lead_id` matches a Form Lead; Granot receipt only when the observation’s `receipt_id` is in the loaded receipts; RingCentral processed-call only when `callLeadId` matches a Call Lead and status is `lead_created` / `lead_created_duplicate` / `lead_adopted` / `lead_adopted_duplicate`); `lead_created` (command-backed EntityChange, else official-fact clock); Lead Messages for that Lead (`lead_id` or Form Lead `form_lead`); `job_number_acquired` (Job Number EntityChange, else `createLeadFromGranot`, else earliest record-link `established_at`, else first observation — never inferred from the typed query); `lead_updated` (update commands, skipping the create row and a job-number-only acquire row); Granot observations; latest Decisions; booking intake and release intake (opened / refreshed / resolved — a case is not a Booking); official Booking if a Booking row exists (Priority 5 is not Booked); official Cancellation if a selected Cancellation exists (snapshot-only is still `official_cancellation`, never an invented `official_booking`); Sheet Sync. Sort by `event_at`, then type priority (5–110), then id. Stamp `proof_shape`, coverage, and `current` refs. Hand `{ page, rows, now, cancellationViaSnapshot }` to sibling `projectEnhancedPage`. This beat does **not** redact. This beat does **not** evaluate `current_outcome`. This beat does **not** write.

There is no fifth load, redact, or outcome operation. `hasSuccessfulLeadMessage` is a leftover CLI discover score (`accepted` / `sent` / `delivered`). It is exported today because `scripts/prototypes/job-number-timeline/src/discover.ts` treats it as the **interface** — that is a leak, not a fifth owner story. `flattenRows` / `firstHop` / `resolveLead` / `emit*` are beats inside stories 2–4.

## Organization

Keep one file. This is the screenplay for “refuse the three closed statuses, then walk the owner-facing chain from rows someone else already loaded.” Mongo hop already lives in sibling `mongo-evidence-loader.ts`. v2 clocks / activities / 250-cap already live in sibling `projector.ts`. Outcome / attention already live in siblings `outcome.ts` / `attention.ts`. Redact already lives in sibling `masking.ts` via `module.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Job Number fold already lives in already-recommended `bookingIdentity.ts` via sibling `normalize.ts`. Masked form snapshot already lives in sibling `evidence.ts` (`formSnapshotForLead` — this file **asks** it). Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a loader **adapter** so “assemble can query Mongo.” Do not invent a redact **adapter** so “assemble can return the HTTP page.” Do not invent an outcome **adapter** so “assemble can decide booked vs cancelled.” Do not invent a CRUD folder so “each emit gets a file.”

Do not move `projectEnhancedPage` into this file so “one function owns v1 and v2.” Do not teach `adminBrowse.service.ts` a `job-number-timeline` resource so “one desk owns every collection.” Do not merge sibling `recent-official-bookings.ts` so “assemble can also list three Bookings.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assembleJobNumberTimeline` | `assembleTheOwnerFacingJobNumberChainFromTheLoadedRows` | pure function; HTTP/CLI **ask** it through `module.read`; tests inject rows |
| `JobTimelineAssembleResult` | `OwnerJobNumberChainResult` | `ok` / `invalid_job_number` / `not_found` / `filtered_out` |
| `hasSuccessfulLeadMessage` | leftover CLI discover leak | `discover.ts` only — unexport after discover reads `lead_message` status on the page |

Keep the old names as one-line aliases until sibling `module.ts`, `assemble.test.ts`, `module.test.ts`, `masking.test.ts`, CLI `discover.ts`, and leftover `lifecycle-assurance/src/load.ts` migrate. Do not make callers learn `firstHop` / `flattenRows` / `viaSnapshot` / `QUALIFIED_PROCESSED_CALL_STATUSES` as the domain language. Do **not** keep `hasSuccessfulLeadMessage` as a public **seam** after discover migrates. Do **not** put `assembleJobNumberTimeline` onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted event `kind` strings, type priorities, or `schema_version: "job_timeline.v2"`. Do **not** return the v1 page from `ok` so “assemble stops asking the projector” — that handoff is load-bearing.

**No workflow class.** The one type that *does* earn a name is the first-hop bag plus the snapshot-cancellation handoff the projector already needs:

```ts
type FirstHopForThisJobNumber = {
  observations: ObservationRow[]
  record_links: RecordLinkRow[]
  bookings: BookingRow[]
  booking_cases: CaseRow[]
  release_cases: CaseRow[]
  booking_discrepancies: DiscrepancyRow[]
  release_discrepancies: DiscrepancyRow[]
}

type SelectedCancellations = {
  cancellations: CancellationRow[]
  viaSnapshot: boolean
}
```

That is the handoff from “this Job Number has a durable first hop” to “emit official Cancellation without inventing a Booking when the hop was the snapshot.” Do **not** add contact, SMS body, Sheet id, or `last_error` onto the emitted `data` so “the desk can debug.” Do **not** add a Mongo `Db` onto `assembleTheOwnerFacingJobNumberChainFromTheLoadedRows` so “assemble can hop.”

Leave `projectEnhancedPage` on sibling `projector.ts`. Leave redact on `module.ts`. Leave the Mongo hop on `mongo-evidence-loader.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// assemble.ts
// The owner typed a Job Number. The rows are already loaded.
// Refuse the three closed statuses, then walk the chain.

// ── 1. Refuse a Job Number that does not normalize ────────

export function assembleTheOwnerFacingJobNumberChainFromTheLoadedRows(input)
function typedJobNumberOrInvalid(rawJobNo)            // empty → invalid_job_number

// ── 2. Refuse a first-hop miss ────────────────────────────

function flattenNestedRowShapes(input)                // leftover nested vs flat compatibility
function firstHopForThisJobNumber(rows, normalized)
function snapshotMatchingCancellations(rows, normalized)
function refuseWhenTheFirstHopIsEmpty(hop, snapshots) // Lead-only / orphan cancel → not_found

// ── 3. Filter out a company or granularity that does not own this job

function latestDecisionAttemptOnly(decisions)
function resolveTheLeadFromTheWalkBack(links, bookings, decisions, leads)
function selectCancellationsLinkedOrBySnapshot(rows, bookingIds, normalized)
function resolveTheScopesThisJobBelongsTo(lead, links, decisions, observations)
function refuseWhenNoResolvedScopeMatchesTheFilter(scopes, requested)

// ── 4. Assemble the owner-facing chain from the loaded rows

function emitSourceReceivedOnlyFromALoadedReceipt(observations, receipts, wordpressReceipts, processedCalls, lead)
function emitLeadCreatedFromTheCommandOrTheOfficialClock(lead, changes)
function emitTextsForThisLead(lead, messages)         // no contact match
function emitJobNumberAcquiredWithoutInferringIt(lead, changes, links, observations)
function emitLeadUpdatesThatAreMoreThanTheJobNumberStamp(changes, create, acquired)
function emitGranotObservations(observations)
function emitLatestDecisions(decisions)
function emitIntakeOpenedRefreshedResolved(kind, cases) // a case is not a Booking
function emitOfficialBookingIfTheBookingRowExists(booking, changes) // Priority 5 is not Booked
function emitOfficialCancellationWithoutInventingABooking(cancellation, changes)
function emitSheetSyncJoinedByEntityId(jobs)          // never by Job Number
function stampCoverageAndProofShape(lead, events, intakes, official)
function handTheV1PageToTheProjector(page, rows, now, viaSnapshot)

export function hasSuccessfulLeadMessage(events)      // leftover CLI discover leak
```

Read the `ok` path out loud: *flatten the leftover nested shapes, refuse a Job Number that does not normalize, take the first hop and the snapshot-matching Cancellations, refuse a miss, keep the latest Decision attempt only, resolve the Lead from the walk-back, take Booking-linked Cancellations or else the snapshot, resolve the scopes and refuse a company or granularity that does not own this job, emit source received only from a loaded receipt, emit lead created, emit texts for this Lead, emit Job Number acquired without inferring it, emit lead updates that are more than the job-number stamp, emit Granot observations, emit the latest Decisions, emit intake opened / refreshed / resolved, emit official Booking if the Booking row exists, emit official Cancellation without inventing a Booking, emit Sheet Sync joined by entity id, sort by clock then type priority, stamp coverage and proof shape, hand the v1 page to the projector.*

That is the operation. `assembleJobNumberTimeline` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`assemble` also projects.** Every `ok` calls sibling `projectEnhancedPage`. The export name says v1 chain; the return is already `EnhancedJobTimelinePage` with `schema_version: "job_timeline.v2"`. Keep the handoff. Do not inline outcome / attention / the 250 cap so “one file owns the page.” Do not stop calling the projector so “assemble becomes v1 again.”

2. **Normalize twice.** Sibling `module.ts` already refused `invalid_job_number` before load. This file normalizes again. That is the pure-function **seam**, not a bug. Do not drop this refuse so “the module already checked.”

3. **Filter twice, two `scopes` shapes.** Module company + granularity mismatch returns `filtered_out` with **empty** `scopes` before this file runs (JTE-01 residual; CLI prints `filtered_out` and exits 0). This file’s granularity miss returns the scopes it resolved. Do not make the module return assemble’s scopes, and do not empty this file’s scopes, so “one filter owns the company.” Rename both beats so the two answers stay visible.

4. **Discrepancies keep the job found and then disappear.** `firstHop` includes booking/release discrepancies. No emit writes a discrepancy event. Do not invent a `discrepancy` kind so “found rows become events.” Do not drop discrepancies from the hop so “not_found matches the page.”

5. **`flattenRows` is a leftover nested-shape adapter.** It copies `identity.normalized_job_no`, `priority.canonical`, `booking_action.normalized`, `cases` → booking/release, `entity.model` / `entity.id`, `lead_ref.id`, and `lifecycle_routes[0]`. The story name should say leftover compatibility, not “assemble.” Do not silently require flat rows only.

6. **`hasSuccessfulLeadMessage` is a CLI discover leak.** HTTP never **asks** it. Unexport after `discover.ts` reads `lead_message` status on the page. Do not put it on the barrel so “every helper is public.”

7. **`proofShape` infers WordPress.** After origin / create-command checks, `created.event_at < acquired.event_at` becomes `wordpress_born`. That is a silent walk-back guess. Rename the beat (`guessWordpressBornWhenTheLeadPredatesTheJobNumber`) so the guess stays visible. Do not delete it so “only `ingestion_origin` counts,” and do not treat a later Granot receipt as clearing WordPress-born.

8. **`emitIntakes` leftover `verbOpen = "opened"`.** Dead local. Delete it while renaming. Do not add a `verbRefresh` / `verbResolve` trio so “every headline has a variable.”

9. **Sheet Sync and intake are not official facts.** Named tests already lock Priority 5 is not Booked, a case is not a Booking, and unresolved Lead has no source-lead Sheet Sync. Do not join Sheet Sync by Job Number so “the outbox is easier to find.” Do not emit `official_booking` from `booking_action_normalized: "booked"`.

10. **Leave sibling modules alone.** `formSnapshotForLead`, `projectEnhancedPage`, `normalizeTypedJobNo`, `createMongoEvidenceLoader`, `redactTimelineValue`, `listRecentOfficialBookingExamples` are already the right **depth**. This file orchestrates the first two and **asks** the third. Do not silently change first-hop / snapshot-cancel / WordPress-receipt rules while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `assembleTheOwnerFacingJobNumberChainFromTheLoadedRows` (today `assembleJobNumberTimeline`).

Today’s `assemble.test.ts` already names most refuse / emit beats and proves assemble is pure over injected rows. That is the right style. Gaps sit on other files: snapshot-only Cancellation, WordPress `source_received` only when the receipt exists, and `WORDPRESS_RECEIPT_UNAVAILABLE` are locked through `module.read` in `evaluators.test.ts` / `v2.test.ts`. Bring those proofs onto this **interface** (inject the same rows) so a projector rename cannot hide an assemble miss.

Name the operation:

**Refuse**
- Blank / whitespace Job Number → `invalid_job_number`.
- Lead-only typed search → `not_found`.
- Orphan Cancellation without a durable job snapshot and no other hop → `not_found`.
- Snapshot-only Cancellation → `ok` with `official_cancellation` and **no** `official_booking`.
- Requested granularity that no resolved scope matches → `filtered_out` with scopes.

**Assemble**
- WordPress walk-back: lead created, text, Job Number acquired, booking intake; `proof_shape: wordpress_born`; `job_number_at_create: false`; `form_snapshot` already masked; no invented `source_received` until a WordPress receipt row is loaded.
- WordPress receipt loaded → `source_received` with `ingress: "wordpress"` before lead created.
- Granot-born: Job Number present at create; latest Decision attempt only; Granot `source_received` only when the observation’s receipt is loaded.
- RingCentral `source_received` only for qualified processed-call statuses on the resolved Call Lead.
- Equivalent `P5562924` / `5562924` emit the same event ids.
- No contact match: unresolved Lead emits neither `lead_created` nor someone else’s text.
- Priority 5 is not Booked. A booking case is intake, not official Booking.
- Sheet Sync joins by entity id; `spreadsheet_id` / `last_error` stay off `data`. Unresolved Lead has no source-lead Sheet Sync.
- Same rows twice → deep-equal (pure).

Do **not** add a test per helper (`flattenNestedRowShapes`, `typedJobNumberOrInvalid`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`hasSuccessfulLeadMessage` is not a second **adapter**. It is a leftover leak. Do not add helper-unit tests for it.

## What I would not do

- A `JobNumberTimelineService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or an `emit/` folder of one-kind files.
- Breaking the injected-rows **seam**. Assemble must not grow a Mongo `Db`.
- Breaking the v1 → projector **seam**. `ok` must still **ask** `projectEnhancedPage`.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating sibling `recent-official-bookings.ts` as this story.
- Treating sibling `module.read` redact, `outcome.ts`, or `attention.ts` as this story.
- Inventing a loader **seam** that has only one **adapter**.
- Silently “fixing” the module’s empty-`scopes` company mismatch, the WordPress-born clock guess, or first-hop discrepancy-without-event while renaming.
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
