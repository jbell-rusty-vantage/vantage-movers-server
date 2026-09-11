# Hop This Company's Granularity Ids So A Typed Company Filter Can Refuse Before The Job Hop, Hop The First Facts That Can Found This Job Number Including Observations On Identity.normalized_job_no, Record Links, Bookings, Booking And Release Cases, And Discrepancies Plus The Account RingCentral Cursor, Hop Decisions And Granot Receipts Those Observations Point At With A Safe Projection, Hop Cancellations By Live Booking And By Indexed Snapshot Then Merge So A Snapshot-Only Cancel Is A First-Hop Survivor, Resolve The Lead Active-Link Then Booking Then Applied-Or-Created Decision Then Hop Lead-Scoped Texts WordPress Receipts And Processed Calls, Then Hop Official-Fact EntityChanges And Sheet Sync By Entity Id Never Job Number — Never Collection-Scan, Never Invent An Official Booking, Never $lookup, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 7 of this service — `mongo-evidence-loader.ts`
- Remaining in this service: `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/mongo-evidence-loader.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; Mongo loader hops observations, latest decisions, record links, bookings, cancellations, booking/release cases, discrepancies, leads, entity changes, lead messages, sheet sync jobs, Granot CRM sources, and granularities; also hops `granot_webhook_receipts` with a safe projection, `wordpress_form_submission_receipts` by indexed `lead_ref.id` when the resolved lead is a Form Lead, processed-call ledger via `getRingCentralCollectionName("processedCalls")`, and the account call-log cursor via `getRingCentralCollectionName("callLogSyncState")` `{ key: "account" }`; Cancellations load by Booking id merged with an indexed hop on `cancelled_leads.normalized_job_no_snapshot` via `equivalentNormalizedJobSnapshotFilter`; a snapshot-matching Cancellation is a first-hop survivor; assemble still refuses orphans without a durable job snapshot; snapshot-recovered Cancellation without a live Booking is `cancelled` plus `OFFICIAL_BOOKING_UNAVAILABLE`, not `contradictory`; do not invent an `official_booking` event; safe projections only — no payload, headers, phone, transcript, recording, `last_error`, or `spreadsheet_id`; no `$lookup` on the hot route; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` is a pure function over **already-loaded** rows — this file **loads**; it does **not** emit, refuse `not_found`, or stamp coverage). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** `loader.loadCompanyGranularityIds` then `loader.loadRows`, then assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover test **adapter**: sibling `memory-evidence-loader.ts` (`createMemoryEvidenceLoader` — **implements** the same port; tests **ask** it, not this file). Distinct from leftover loader **port**: sibling `evidence-loader.port.ts` (type-only — skipped). Distinct from leftover v2 wrap: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md). Distinct from leftover clocks / evidence / outcome / attention: already-recommended [job-number-timeline-clocks.md](job-number-timeline-clocks.md), [job-number-timeline-evidence.md](job-number-timeline-evidence.md), [job-number-timeline-outcome.md](job-number-timeline-outcome.md), [job-number-timeline-attention.md](job-number-timeline-attention.md) (those files **read** rows this file already hopped; they do not hop). Distinct from leftover Owner sample: sibling `recent-official-bookings.ts` (`listRecentOfficialBookingExamples` / `createMongoRecentOfficialBookingLister` — at most three official Booking Job Numbers from `booked_leads`; **not** `loadJobNumberTimelineRows`; **not** `module.read`). Distinct from leftover Job Number identity: already-recommended [bookings-booking-identity.md](bookings-booking-identity.md) (this file **asks** `equivalentNormalizedJobFilter` / `equivalentNormalizedJobSnapshotFilter` via sibling `normalize.ts`; it does not fold a Job Number). Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md) (capture of a [WordPress Form Submission Receipt](../../../../CONTEXT.md) — this file only hops the receipt by indexed `lead_ref.id`). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). Distinct from leftover official Booking write: already-recommended [bookings-booked-lead.md](bookings-booked-lead.md). Distinct from leftover official Cancellation write: already-recommended [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from leftover Sheet Sync drain: already-recommended [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (this file hops `sheet_sync_jobs` by `entity_id`; it does not drain). Distinct from leftover Domain Command evidence: already-recommended [domain-commands-entity-change.md](domain-commands-entity-change.md) (this file hops `entity_changes`; it does not append). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **two runtime import sites in `src/` plus two leftover script sites.** Wave B `job-number-timeline-admin.routes.ts` **asks** `createMongoEvidenceLoader({ db })` inside `defaultRead`, then `createJobNumberTimelineModule({ loader }).read`. CLI `scripts/prototypes/job-number-timeline/src/cli.ts` **asks** the same factory for `render` / `discover` / `proof`. Leftover `scripts/prototypes/lifecycle-assurance/src/load.ts` **asks** `loadJobNumberTimelineRows(db, jobNo)` then `assembleJobNumberTimeline` — it **bypasses** `module.read` and redact. Barrel `jobNumberTimeline/index.ts` does **not** re-export this file. Sibling `module.ts` **asks** the port, not this file. Tests never import this file except `src/utils/objectId.test.ts`, which **scans the source** so it does not value-import `ObjectId` from `mongodb`. `assemble.test.ts` / `module.test.ts` / `evaluators.test.ts` / `v2.test.ts` / `masking.test.ts` **ask** `createMemoryEvidenceLoader` or inject rows into assemble. `recent-official-bookings.test.ts` does **not** **ask** this **interface**. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `evaluateCurrentOutcome`, `evaluateAttention`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: evidence-loader **port** vs Mongo **adapter** (HTTP/CLI bind this file; tests bind sibling `memory-evidence-loader.ts`; `module.read` never knows collection names); company-granularity hop vs job hop (module **asks** `loadCompanyGranularityIds` first and may return `filtered_out` with empty `scopes` before `loadRows`); job-scoped first hop vs Lead-scoped later hop (WordPress receipts, processed calls, Lead messages, and Lead EntityChanges stay empty until a Form Lead or Call Lead resolves); Booking-linked Cancellation vs snapshot Cancellation (two finds, merge by id — snapshot-only is a first-hop survivor; this file does **not** invent an `official_booking` row); equivalent Job Number filter vs observation identity remap (`observationJobFilter` rewrites `equivalentNormalizedJobFilter` onto `identity.normalized_job_no`); RingCentral collection names vs TEST_MODE suffix (`getRingCentralCollectionName`); safe mapped rows vs full-document `find` (receipts / WordPress / processed calls / company-granularity `_id` use `.project()`; several other hops load the document then map). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no redact **seam**. There is no outcome / attention **adapter** in this file. Owner-actor lives on the route, not here. Admin displays the assembled page; it does not hop Mongo.
- Split later (only if the file outgrows one sitting): this ~559-line file is one sitting if you read it as name this company’s granularities — hop the first facts that can found this Job Number — hop the evidence those facts point at including snapshot Cancellation — hop the side-effect facts those entities requested. If it later splits by **story**: `nameThisCompanysGranularityIds.ts` / `hopTheSafeEvidenceForThisJobNumber.ts` — never `create.ts` / `update.ts` / `delete.ts` / `observation.ts` / `cancellation.ts` / `lead.ts`. Assemble / projector / attention stay siblings. `module.read` stays the HTTP/CLI **seam**. `createMongoEvidenceLoader` stays the port **adapter**.

`loadJobNumberTimelineRows` / `loadCompanyGranularityIds` / `createMongoEvidenceLoader` are executor mechanics. The owner question is: *The owner typed a Job Number. If they also typed a Source Company, name that company’s granularity ids so the module can refuse a granularity the company does not own before anyone hops the job. Then hop the first facts that can found this Job Number: Granot observations on `identity.normalized_job_no` (equivalent Job Number, not a collection scan), record links, official Bookings, booking and release cases, booking and release discrepancies, and the account RingCentral Call Log cursor. Hop the Decisions and Granot Observation Receipts those observations point at — receipts with a safe projection, never payload or credentials. Hop Cancellations two ways and merge: live Booking id, and indexed `normalized_job_no_snapshot`. A snapshot-only Cancellation whose Booking document is gone is still a first-hop survivor. Do not invent an official Booking row so that cancel “has a booking.” Resolve which Lead this job points at: active record link, else Booking `lead_ref` / `lead_model`, else an applied or created Decision whose target is a Form Lead or Call Lead. Only then hop the Lead document, that Lead’s EntityChanges, its texts, a WordPress Form Submission Receipt by indexed `lead_ref.id` when the Lead is a Form Lead, and the processed-call ledger when the Lead is a Call Lead. Then hop Booking and Cancellation EntityChanges, Sheet Sync jobs by those entity ids — never by Job Number — Granot CRM sources, and Source Granularities. Return the bag. This file does not assemble the page. This file does not redact. This file does not decide booked versus cancelled. This file does not name §8 codes. This file does not list three recent official Bookings. This file does not write. This file does not call the forensic Granot timeline.*

Who walks the owner-facing chain from these rows already lives in already-recommended `assemble.ts`. Who **asks** the port already lives in sibling `module.ts`. Who wraps v2, outcome, and attention already live in already-recommended `projector.ts` / `outcome.ts` / `attention.ts`. Who lists three recent official Bookings already lives in sibling `recent-official-bookings.ts`. Who redacts contact / SMS / Sheet id already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Four “hop the safe evidence this Job Number already stored” stories in one sitting, not “a Mongo CRUD service,” and not Assemble The Chain / Wrap The V2 Page / Name §8 Attention / List Three Recent Bookings:

1. **Name this company’s granularity ids** — `loadCompanyGranularityIds(db, sourceCompanyId)` finds `lead_source_granularities` whose `source_company` matches (`asMongoId`), projects `_id` only, and returns hex strings. Sibling `module.ts` **asks** this before `loadRows` when the owner typed `source_company_id`. A typed `source_granularity_id` that is not in this list is `filtered_out` with **empty** `scopes` — assemble never runs. This beat does **not** hop the job. This beat does **not** resolve scopes.

2. **Hop the first facts that can found this Job Number** — the first `Promise.all` inside `loadJobNumberTimelineRows`:
   - Observations: `granot_observations` via `observationJobFilter` (rewrites `equivalentNormalizedJobFilter` onto `identity.normalized_job_no` — equivalent digit-core, not a collection scan).
   - Record links, official Bookings, booking cases, release cases, booking discrepancies, release discrepancies: the same equivalent filter on `normalized_job_no`.
   - RingCentral Call Log cursor: `getRingCentralCollectionName("callLogSyncState")` `findOne({ key: "account" })`. Always. Not job-scoped. Sibling freshness **reads** `lastSyncTo`.
   A Lead that already stores this Job Number is **not** in this wave. A Lead Message is **not** in this wave. An orphan Cancellation with no snapshot and no live Booking is **not** in this wave. This beat does **not** emit events. This beat does **not** decide `not_found` — assemble does that after the bag returns.

3. **Hop the evidence those first facts point at** — second and third waves:
   - Decisions by `observation_id: { $in }` (empty observation ids → no hop).
   - Granot Observation Receipts by `_id: { $in receipt_id }` with `.project({ captured_at, createdAt, route_event_class, observation_channel, channel_operation_kind, "processing.state" })`. No payload. No headers. No credentials.
   - Cancellations: `cancelled_leads` where `booked_lead` is in the loaded Booking ids, **and** `cancelled_leads` where `equivalentNormalizedJobSnapshotFilter` matches `normalized_job_no_snapshot`. Merge by id. Snapshot-only (Booking document gone, durable snapshot present) is still in the bag — assemble treats that as a first-hop survivor and emits `official_cancellation` without inventing `official_booking`. This beat does **not** attach an orphan without a snapshot; that cancel is not found by either hop.
   - Resolve the Lead: first active record link with `lead_ref` FormLead/CallLead → else Booking `lead_ref` + `lead_model` → else a Decision whose outcome is `applied` or `created` and whose target is a Form Lead or Call Lead. Same order assemble later uses. Missing Lead document → empty Lead-scoped bags; the resolved `{ model, id }` is not invented as a Lead row.
   - When a Form Lead or Call Lead document exists: hop that Lead; hop `entity_changes` for that Lead id; hop `lead_messages` (`FormLead`: `lead_ref.id` **or** leftover `form_lead`; `CallLead`: `lead_ref.id` only); hop WordPress receipts only for Form Lead by indexed `lead_ref.id` with `.project({ received_at, createdAt, processing_status, "lead_ref.id" })`; hop processed calls only for Call Lead via `getRingCentralCollectionName("processedCalls")` `{ callLeadId }` with a safe projection (`status`, `qualificationReason`, `firstProcessedAt`, `updatedAt`, `ingestionSource`, `duplicate`, `callLeadId`). No collection scan. A later Granot receipt hop does **not** invent a WordPress receipt.

4. **Hop the side-effect facts those entities requested** — Booking EntityChanges (`entity.model: "BookedLead"`), Cancellation EntityChanges (`CancelledLead`), then `sheet_sync_jobs` whose `entity_id` is in the resolved Lead / Booking / Cancellation ids — never `normalized_job_no`. Then Granot CRM sources from observation `granot_crm_source_id`, then Source Granularities from the Lead / links / Decisions / sources. Return `JobTimelineRows` including mapped receipts, WordPress receipts, processed calls, and the account cursor. This beat does **not** join Sheet Sync by Job Number. This beat does **not** drain the outbox.

There is no fifth assemble, redact, or sample-booking operation. `createMongoEvidenceLoader` is the port **adapter** (`loadRows` / `loadCompanyGranularityIds`). `asId` / `asMongoId` / `asIso` / `mapObservation` / `mapDecision` / `mapCase` / `mapEntityChange` / `mapIngestedContact` / `mapIngestedMove` / `observationJobFilter` are beats inside stories 2–4. The Lead mapper **keeps** `ingested_contact_snapshot` / `ingested_move_snapshot` so already-recommended assemble can stamp the origin card; sibling `masking.ts` redacts after.

## Organization

Keep one file. This is the screenplay for “name this company’s granularities, hop the first facts that can found this Job Number, hop what those facts point at including snapshot Cancellation, hop the side-effect facts those entities requested.” v1 emit already lives in already-recommended `assemble.ts`. v2 wrap already lives in already-recommended `projector.ts`. Outcome / attention already live in already-recommended `outcome.ts` / `attention.ts`. Page redact already lives in sibling `masking.ts` via `module.ts`. The test **adapter** already lives in sibling `memory-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Job Number fold already lives in already-recommended `bookingIdentity.ts` via sibling `normalize.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineMongoLoaderService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an emit **adapter** so “the loader can invent `official_booking`.” Do not invent a `$lookup` **adapter** so “one aggregation owns the page.” Do not invent a CRUD folder so “each collection gets a file.”

Do not move `loadJobNumberTimelineRows` into assemble so “one function owns hop and emit.” Do not move `listRecentOfficialBookingExamples` into this file so “one Mongo module lists Bookings.” Do not teach Admin to hop these collections so “the desk can paint without the server bag.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `observation.ts` / `cancellation.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `loadCompanyGranularityIds` | `nameThisCompanysGranularityIds` | module **asks** it before the job hop when the owner typed a company |
| `loadJobNumberTimelineRows` | `hopTheSafeEvidenceForThisJobNumber` | HTTP/CLI **ask** it through `createMongoEvidenceLoader`; leftover lifecycle-assurance **asks** it raw |
| `createMongoEvidenceLoader` | `bindTheMongoHopsToTheEvidenceLoaderPort` | Wave B route and CLI bind `{ db }` to the port `module.read` already **asks** |

Keep the old names as one-line aliases until Wave B `job-number-timeline-admin.routes.ts`, CLI `cli.ts`, and leftover `lifecycle-assurance/src/load.ts` migrate. Do not make callers learn `observationJobFilter` / `mapObservation` / `mapIngestedContact` / `asMongoId` as the domain language — those stay internal beats. Do **not** put these names onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** re-export this file from `jobNumberTimeline/index.ts` so “HTTP can skip `module.read`.” Do **not** start returning a Booking row invented from `booking_created_at_snapshot` so “snapshot cancel has a booking.” Do **not** add `phone_number` / `payload` / `last_error` / `spreadsheet_id` onto the mapped bags so “the desk can debug.”

**No workflow class.** The one type that *does* earn a name is the first-hop bag this file already builds before Lead-scoped hops:

```ts
type FirstHopDocsForThisJobNumber = {
  observations: ObservationRow[]
  record_links: RecordLinkRow[]
  bookings: BookingRow[]
  booking_cases: CaseRow[]
  release_cases: CaseRow[]
  booking_discrepancies: DiscrepancyRow[]
  release_discrepancies: DiscrepancyRow[]
  call_log_cursor: CallLogCursorRow | null
}
```

That is the handoff from “Mongo found a durable job-scoped fact (or the account cursor)” to “hop what those facts point at, including a snapshot Cancellation.” Today the waves are inline locals. Do **not** add a Mongo `ClientSession` onto `hopTheSafeEvidenceForThisJobNumber` so “the page is one snapshot” — knowledge already stamps `MULTI_QUERY_READ` / `consistency: "multi_query_best_effort"`. Do **not** add `$lookup` so “one round-trip owns the company.”

Leave `assembleJobNumberTimeline` on already-recommended `assemble.ts`. Leave `createMemoryEvidenceLoader` on sibling `memory-evidence-loader.ts`. Leave `listRecentOfficialBookingExamples` on sibling `recent-official-bookings.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// mongo-evidence-loader.ts
// The owner typed a Job Number. Hop the safe evidence Mongo already stored.
// Do not assemble. Do not invent an official Booking. Do not scan a collection.

// ── 1. This company's granularities ───────────────────────

export async function nameThisCompanysGranularityIds(db, sourceCompanyId)
  // lead_source_granularities.source_company, _id only

export function bindTheMongoHopsToTheEvidenceLoaderPort({ db })
  // loadRows / loadCompanyGranularityIds

// ── 2. First facts that can found this Job Number ─────────

export async function hopTheSafeEvidenceForThisJobNumber(db, normalizedJobNo)
function hopObservationsOnIdentityNormalizedJobNo(db, normalizedJobNo)
  // leftover observationJobFilter — equivalent digit-core on identity.normalized_job_no
function hopRecordLinksBookingsCasesAndDiscrepancies(db, normalizedJobNo)
function hopTheAccountRingCentralCallLogCursor(db)
  // key: "account"; collection name is mode-aware

// ── 3. Evidence those first facts point at ────────────────

function hopDecisionsForThoseObservations(db, observationIds)
function hopGranotReceiptsWithASafeProjection(db, receiptIds)
  // no payload, headers, credentials
function hopCancellationsByLiveBookingAndByIndexedSnapshotThenMerge(db, bookingIds, normalizedJobNo)
  // snapshot-only is a first-hop survivor; orphan without snapshot is not found
function resolveWhichLeadThisJobPointsAt(links, bookings, decisions)
  // active record link → booking lead_ref → applied/created Decision target
function hopLeadScopedTextsReceiptsAndProcessedCalls(db, leadRef)
  // WordPress only Form Lead by lead_ref.id; processed calls only Call Lead

// ── 4. Side-effect facts those entities requested ─────────

function hopOfficialFactEntityChangesAndSheetSyncByEntityId(db, leadIds, bookingIds, cancellationIds)
  // never sheet_sync_jobs.normalized_job_no
function hopCrmSourcesAndSourceGranularities(db, observations, links, decisions, leads)
```

Read the hop path out loud: *hop this company’s granularity ids so a typed company filter can refuse before the job hop, hop the first facts that can found this Job Number including observations on identity.normalized_job_no, record links, bookings, booking and release cases, and discrepancies plus the account RingCentral cursor, hop Decisions and Granot receipts those observations point at with a safe projection, hop Cancellations by live Booking and by indexed snapshot then merge so a snapshot-only cancel is a first-hop survivor, resolve the Lead active-link then Booking then applied-or-created Decision then hop Lead-scoped texts WordPress receipts and processed calls, then hop official-fact EntityChanges and Sheet Sync by entity id never Job Number.*

That is the operation. `loadJobNumberTimelineRows` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Tests never **ask** this interface.** `assemble.test.ts` / `evaluators.test.ts` / `v2.test.ts` already name snapshot-only cancel, orphan-without-snapshot `not_found`, WordPress receipt by `lead_ref.id`, qualified processed-call statuses, and Sheet Sync by entity id — but they **ask** `createMemoryEvidenceLoader` or inject rows. `objectId.test.ts` only scans the import line. Bring hop proofs onto `hopTheSafeEvidenceForThisJobNumber` / `nameThisCompanysGranularityIds` with an injected `Db` (or the existing TEST_MODE replica **seam**). Leave emit / outcome / §8 on their already-recommended **interfaces**.

2. **Lead resolution is copied.** This file’s `leadRef` walk (active link → Booking → applied/created Decision) is the same order already-recommended assemble later uses on the mapped rows. Do not invent a third copy on the route. Do not move resolve into assemble so “the loader returns raw docs and assemble hops again.” One beat, two **depths**: hop needs the id to fetch; assemble needs the row to emit. Keep the order identical. Do not switch Mongo to “any Decision target” so “a skipped Decision founds a Lead.”

3. **`observationJobFilter` reimplements `remapNormalizedJobFilter`.** Already-recommended `bookingIdentity.ts` already remaps `equivalentNormalizedJobFilter` onto another field. This file inlines the same `$or` rewrite for `identity.normalized_job_no`. **Ask** the existing remap. Do not add a second digit-core regex so “observations can be special.”

4. **Knowledge says safe projections; several hops `find()` the full document.** Receipts, WordPress, processed calls, and company-granularity `_id` use `.project()`. Observations, Decisions, record links, Bookings, cases, discrepancies, Leads, EntityChanges, messages, Sheet jobs, CRM sources, and job-page granularities load the document then map a subset. The Lead mapper **keeps** ingested phone / email / name so assemble can stamp `form_snapshot`; sibling masking redacts after. Do not drop the ingested snapshot so “the loader never sees contact” — the origin card needs it. Do not add `payload` / `last_error` / `spreadsheet_id` onto the mapped bags. Adding `.project()` on the full-doc hops is a later hardening pass, not a silent rename fix.

5. **This file cannot load an orphan-only Cancellation.** Linked hop needs a loaded Booking id. Snapshot hop needs `normalized_job_no_snapshot`. A cancel with `booked_lead: "missing-booking"` and no snapshot is not returned. Attention’s `ORPHAN_CANCELLATION_REFERENCE` is reachable when another first-hop fact exists **and** a cancel row is already in the bag (memory-injected in `evaluators.test.ts`). Do not add a `cancelled_leads` collection scan so “mongo can paint orphan attention,” and do not delete the attention code so “mongo never produces it.”

6. **Snapshot + linked merge by id.** The same Cancellation can match both hops. `cancellationsById` keeps one. Do not emit two mapped rows so “linked and snapshot both count,” and do not drop the snapshot hop when any Booking exists so “live Booking hides a second snapshot cancel.”

7. **WordPress receipts hop only after a Form Lead document exists.** No resolved Form Lead → empty `wordpress_form_submission_receipts` → assemble cannot emit WordPress `source_received` → attention keeps `WORDPRESS_RECEIPT_UNAVAILABLE` on a WordPress-born page. Indexed `lead_ref.id` only. Do not scan `wordpress_form_submission_receipts` by Job Number so “a missing Lead still finds the receipt.” Do not treat a loaded Granot receipt as a WordPress receipt.

8. **Processed calls hop only after a Call Lead document exists.** Collection name is `getRingCentralCollectionName("processedCalls")` (TEST_MODE suffix). This file does **not** filter qualified statuses — already-recommended assemble does (`lead_created` / `lead_created_duplicate` / `lead_adopted` / `lead_adopted_duplicate`). Do not copy that filter here so “the loader owns ingress,” and do not hop `processedCalls` for a Form Lead.

9. **Sheet Sync is by entity id, never Job Number.** Empty Lead + Booking + Cancellation ids → no `sheet_sync_jobs` hop. Unresolved Lead therefore has no source-lead Sheet Sync — assemble already locks that. Do not add `normalized_job_no` onto the Sheet filter so “a job without a Lead still shows outbox rows.”

10. **The account cursor is always hopped.** First-wave `findOne({ key: "account" })`, even for WordPress-born or Granot-born jobs. Freshness stamps `ringcentral_covered_through` from `lastSyncTo` whether the page is RingCentral-born or not; attention emits `RINGCENTRAL_CURSOR_BOUNDED` only when `proof_shape === "ringcentral_born"`. Do not skip the cursor hop on non-RC pages so “freshness is empty,” and do not emit the limitation here.

11. **Leftover lifecycle-assurance **asks** `loadJobNumberTimelineRows` then assemble.** That bypasses `module.read` and redact. Do not put redact into this file so “the leftover script is safe.” Unexport the raw function after that script **asks** the port.

12. **Leave sibling modules alone.** Assemble first-hop / emit, module port **ask**, memory **adapter**, recent-official-bookings sample are already the right **depth**. This file does not orchestrate them; module orchestrates this file. Do not silently change snapshot-cancel merge, WordPress `lead_ref.id`, Sheet-by-entity-id, or no-`$lookup` while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `hopTheSafeEvidenceForThisJobNumber`, `nameThisCompanysGranularityIds`, and `bindTheMongoHopsToTheEvidenceLoaderPort` (today `loadJobNumberTimelineRows`, `loadCompanyGranularityIds`, `createMongoEvidenceLoader`).

Today’s `assemble.test.ts` / `evaluators.test.ts` / `v2.test.ts` already name snapshot-only cancel, orphan-without-snapshot, WordPress receipt, and Sheet-by-entity-id — but they **ask** the memory **adapter**. That is the right assertion style on the wrong **seam**. Add proofs onto this **interface** with an injected `Db` (or TEST_MODE replica) so an assemble rename cannot hide a hop miss.

Name the operation:

**Company granularities**
- `source_company` match → those granularity `_id`s. No match → `[]`. Module uses `[]` plus a typed granularity as `filtered_out`.

**First hop**
- Observation stored as `identity.normalized_job_no` equivalent to the typed Job Number is returned. A Lead-only document with that Job Number is **not** returned from this wave (and this file never hops Leads by Job Number).
- Account cursor `{ key: "account" }` is present or null. Collection name follows `getRingCentralCollectionName("callLogSyncState")`.

**Cancellations**
- Booking-linked cancel is returned when that Booking was hopped.
- Snapshot-only cancel (`normalized_job_no_snapshot` matches, `booked_lead` missing from hopped Bookings) is returned. No invented Booking row.
- Same cancel matching both hops appears once.
- Orphan-only cancel (no snapshot, no hopped Booking) is **not** returned.

**Lead-scoped**
- No resolved Form Lead / Call Lead → empty `leads`, `lead_messages`, `wordpress_form_submission_receipts`, `processed_calls`, and Lead `entity_changes`.
- Form Lead document → WordPress receipts by `lead_ref.id` only; `processing_status` is `lead_created` / `received` or dropped. No processed-call hop.
- Call Lead document → processed calls by `callLeadId`; no WordPress hop.
- Form Lead messages match `lead_ref.id` **or** leftover `form_lead`.

**Side effects**
- `sheet_sync_jobs` match Lead / Booking / Cancellation ids. A job whose `entity_id` is only the typed Job Number is **not** returned.
- Granot receipts omit payload / headers. Mapped row has `captured_at` / `processing_state` / channel fields only.

**Port**
- `createMongoEvidenceLoader({ db }).loadRows(job)` equals `loadJobNumberTimelineRows(db, job)`.
- `loadCompanyGranularityIds` is the same function the port **asks**.

Do **not** add a test per helper (`asId`, `mapObservation`, `observationJobFilter`, `mapIngestedContact`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. The existing `objectId.test.ts` source-scan may stay; it is not this **interface**.

`assembleJobNumberTimeline` / `evaluateAttention` / `listRecentOfficialBookingExamples` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineMongoLoaderService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `asId(row._id)` or `collection.find(filter).toArray()`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `collections/` folder of one-export files.
- Breaking the loader **port**. `module.read` must still **ask** `loadCompanyGranularityIds` then `loadRows`; HTTP/CLI must still bind this **adapter**; tests must still bind the memory **adapter**.
- Breaking the snapshot-cancel **seam**. Snapshot-only Cancellation must still be hopped without inventing a Booking row.
- Breaking the no-`$lookup` / no-collection-scan **seam**. WordPress stays `lead_ref.id`. Cancellations stay Booking id + indexed snapshot. Sheet Sync stays entity id.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts`, `projector.ts`, `clocks.ts`, `evidence.ts`, `outcome.ts`, or `attention.ts` as this story.
- Treating sibling `recent-official-bookings.ts` as this story — the next pass owns that checklist.
- Inventing an emit **seam** that has only these mapped rows as an **adapter**.
- Inventing an official Booking row from `booking_created_at_snapshot` so “cancelled always has a booking.”
- Silently “fixing” full-document `find`s into projections, merging Lead resolve into assemble, scanning `cancelled_leads` for orphans, or joining Sheet Sync by Job Number while renaming.
- Teaching Admin to hop these collections.
- Teaching leftover lifecycle-assurance to skip redact by putting redact in this file.
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
