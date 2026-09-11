# Name The Stage For This Kind, Name How Strong The Evidence Is Without Inferring, Write The Owner-Readable Summary Including Grouped Lead Updates From Granot, Name Whether This Event Is Completed Active Pending Failed Or Informational, Say How This Event Correlates To This Job Number Including A WordPress Walk-Back And A Snapshot Cancellation, List The Safe Evidence Refs, And Mask The Ingested Form Snapshot For The Origin Card — Never Invent Events, Never Infer Evidence, Never Leak Contact, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, in-progress)
- Pass: 4 of this service — `evidence.ts`
- Remaining in this service: `outcome.ts`, `attention.ts`, `mongo-evidence-loader.ts`, `recent-official-bookings.ts`
- Target: `src/services/jobNumberTimeline/evidence.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; JTE-02 event labels — `evidence_level`, `stage`, `correlation`, never `inferred`; not a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` **asks** `formSnapshotForLead` while emitting `lead_created` — this file does **not** emit the event). Distinct from leftover v2 wrap: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md) (`projectEnhancedPage` **asks** `stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor`, `evidenceRefsFor` while stamping each assembled event — this file is not the wrap **seam**). Distinct from leftover clocks: already-recommended [job-number-timeline-clocks.md](job-number-timeline-clocks.md) (`selectEventTime` — projector **asks** that next to this file; this file does not pick occurred versus recorded). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — **asks** assemble, then redacts; this file is not the HTTP **seam**). Distinct from leftover page redact: sibling `masking.ts` (`maskName` / `maskPhone` / `maskEmail` — this file **asks** those for the origin snapshot only; module redacts the whole page after). Distinct from leftover evaluators: siblings `outcome.ts` / `attention.ts` (current outcome, stages, §8 codes — projector **asks** those after events are finalized; this file does not decide booked versus cancelled). Distinct from leftover Mongo hop: sibling `mongo-evidence-loader.ts`. Distinct from leftover Owner sample: sibling `recent-official-bookings.ts`. Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover WordPress ingress write: already-recommended [form-lead.md](form-lead.md). Distinct from leftover RingCentral ledger write: already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **two runtime import sites in `src/`.** Already-recommended `projector.ts` **asks** `stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor` (passes `proof_shape`, `job_number_at_create`, and `cancellation_via_snapshot` from assemble’s `cancellationViaSnapshot`), and `evidenceRefsFor` while stamping each assembled event. Already-recommended `assemble.ts` **asks** `formSnapshotForLead(lead)` inside `leadCreatedData` and puts the snapshot on `lead_created.data` when any masked field exists. Barrel `jobNumberTimeline/index.ts` does **not** re-export this file — HTTP **asks** `createJobNumberTimelineModule`. Tests never import this file: `assemble.test.ts` (“WordPress walk-back” locks `data.form_snapshot` through `assembleJobNumberTimeline`; “Lead updated headline omits changed paths” locks **headline**, not `summary`) **asks** assemble. `v2.test.ts` (every golden has `evidence_level`, none is `inferred`; snapshot Cancellation `correlation.method` is `direct_job_number` / `exact`) **asks** `module.read`. `evaluators.test.ts` / `module.test.ts` / `masking.test.ts` do **not** **ask** this **interface**. CLI `render` / `discover` / `proof` **ask** `module.read`, not this file. Wave B `job-number-timeline-admin.routes.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `selectEventTime`, `evaluateCurrentOutcome`, `evaluateAttention`, `listRecentOfficialBookingExamples`, leftover `projections.ts`.
- Seams callers need: assembled event vs owner-facing labels (projector **asks** this file; this file never invents a kind); assemble `cancellationViaSnapshot` vs booking-linked Cancellation (projector hands that flag into `correlationFor`); WordPress-born lead created before Job Number vs exact lead reference (`walked_back` only when `proof_shape === "wordpress_born"` and `job_number_at_create` is false); command-backed vs official-fact-only vs evidence-only coverage (verified change vs official record vs recorded evidence); RingCentral ingress acknowledgement vs WordPress / Granot recorded evidence; ingested contact/move vs masked origin card (`formSnapshotForLead` — assemble **asks** it; module redacts the page later). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no clock **adapter**. There is no outcome **adapter**. There is no loader **seam**. Owner-actor lives on the route, not here. Admin displays `stage` / `evidence_level` / `summary` / `status` / `correlation` / `evidence`; it does not recompute them.
- Split later (only if the file outgrows one sitting): this ~338-line file is one sitting if you read it as name stage / strength / summary / status — say how it correlates and list safe refs — then mask the ingested form for the origin card. If it later splits by **story**: `labelTheAssembledEvent.ts` / `maskTheIngestedFormSnapshot.ts` — never `create.ts` / `update.ts` / `delete.ts` / `stage.ts` / `correlation.ts`. Assemble / projector / clocks / outcome stay siblings. `module.read` stays the HTTP/CLI **seam**.

`stageForKind` / `evidenceLevelFor` / `eventSummary` / `eventStatus` / `correlationFor` / `evidenceRefsFor` / `formSnapshotForLead` are executor mechanics. The owner question is: *The v1 chain is already assembled. For each event, say which stage it belongs to, how strong the evidence is without inferring a row we do not have, what happened in a sentence the owner can read, and whether that row is completed, still open, still pending, failed, or just informational. Then say how we know this event belongs to this Job Number — a WordPress-born lead created before the Job Number is a walk-back; a snapshot-only Cancellation is still exact on the durable job snapshot; Sheet Sync joins by entity id. List only safe refs: receipt, observation, Decision, EntityChange, Lead Message, Booking, Cancellation, Sheet Sync job, case, command name, changed path, processed-call ledger. Never contact, never SMS body, never Sheet id. Separately, when assemble emits lead created, mask the ingested name, phone, and email for the origin card and keep the move date, size, and places. This file does not emit events. This file does not pick occurred versus recorded. This file does not decide booked versus cancelled. This file does not load Mongo. This file does not write. This file does not call the forensic Granot timeline.*

Who emits the v1 chain already lives in already-recommended `assemble.ts`. Who copies these labels onto the v2 event already lives in already-recommended `projector.ts`. Who picks occurred versus recorded already lives in already-recommended `clocks.ts`. Who decides current outcome already lives in sibling `outcome.ts`. Who names §8 attention already lives in sibling `attention.ts`. Who redacts the whole page already lives in sibling `masking.ts` via `module.ts`. Do not pull those in.

## What this file actually does

Three “label what the owner can see about an already-assembled event” stories in one sitting, not “an evidence CRUD service,” and not Assemble The Chain / Wrap The V2 Page / Decide Booked Versus Cancelled:

1. **Name the stage, how strong the evidence is, the owner-readable summary, and whether this event is completed, active, pending, failed, or informational** — four sibling exports projector **asks** on every stamped event:
   - `stageForKind` is a complete kind → stage map. `source_received` / `lead_created` are `origin`. `lead_message` is `engagement`. `job_number_acquired` / `lead_updated` are `qualification`. `granot_observation` / `synchronization_decision` are `processing`. `booking_intake` / `official_booking` share `booking`. `cancellation_intake` / `official_cancellation` share `cancellation`. `sheet_sync` is `delivery`. Intake and official fact share a stage. This beat does **not** invent a kind. This beat does **not** assess whether the stage is complete — that is sibling `assessStages`.
   - `evidenceLevelFor` never returns `inferred` and never returns typed `limitation`. RingCentral `source_received` is `external_acknowledgement`. Command-backed `lead_created` / `lead_updated` / `job_number_acquired` / `official_booking` / `official_cancellation` are `verified_change`. `official_fact_only` is `official_record`. A text whose `data.status` is `delivered`, `sent`, or `undelivered` is `external_acknowledgement`; other texts are `recorded_evidence`. Everything else — including WordPress and Granot `source_received` — is `recorded_evidence`. This beat does **not** invent an event so “ingress can become verified.”
   - `eventSummary` writes a sentence for `lead_updated` by grouping `changed_paths` (`leadUpdateSummary`: Contact / Move details / Assignment / Attribution / Job identity / Booking state / Other, Oxford-comma join, plus ` from Granot` when `command_name === "synchronizeLeadFromGranot"`). WordPress / Granot / RingCentral `source_received` get dedicated capture sentences. Every other kind returns assemble’s `headline`. This beat does **not** rewrite the headline.
   - `eventStatus` is `completed` for a resolved intake, a `synced` Sheet Sync job, a text that is not failed or still queued, and every other non-informational kind. Intake `state === "open"` is `active`. Sheet Sync `pending` / `retrying` / `processing` is `pending`; `failed` is `failed`. A text `failed` / `undelivered` is `failed`; `scheduled` / `accepted` is `pending`. `granot_observation` and `source_received` are `informational`. This beat does **not** decide `current_outcome`.

2. **Say how this event correlates to this Job Number and list the safe evidence refs** — projector **asks** both after story 1:
   - `correlationFor(event, { proof_shape, job_number_at_create, cancellation_via_snapshot })`. WordPress / Granot / RingCentral `source_received` are exact (`lead_reference` / `observation_reference` / `lead_reference`). WordPress-born `lead_created` with `job_number_at_create === false` is `lead_reference` / **`walked_back`**. Other `lead_created` / `lead_message` / `lead_updated` are exact `lead_reference`. `job_number_acquired` whose `clock_field === "record_link.established_at"` is `record_link`. Observation / Decision / intake cases are `direct_job_number`. Sheet Sync is `sheet_entity_reference`. Official Booking is `booking_reference`. Official Cancellation is `direct_job_number` when assemble said snapshot, else `booking_reference`. Default leftover is exact `direct_job_number`. Confidence is almost always `exact`. Typed `limited`, `equivalent_job_number`, and `entity_change_reference` are never returned. This beat does **not** invent an `official_booking` so a snapshot cancel can “have a booking reference.”
   - `evidenceRefsFor` pushes only present string ids: WordPress receipt vs Observation Receipt, observation, Decision, EntityChange id sliced from `lead_created:` / `lead_updated:` event ids, Lead Message id sliced from `lead_message:`, Booking, Cancellation, Sheet Sync job, reconciliation case, lead-update command name plus each changed path, RingCentral processed-call id sliced from `source_received:ringcentral:`. Empty strings are skipped. This beat does **not** add contact, SMS body, Sheet id, `last_error`, or a provider payload.

3. **Mask the ingested form snapshot for the origin card** — `formSnapshotForLead(lead)`. Assemble **asks** this while emitting `lead_created`. Name is `ingested_contact_snapshot.name` else first + last, then `maskName`. Phone and email **ask** sibling `maskPhone` / `maskEmail`. Move date, move size, pickup (`pickup_city` / `pickup_state` / `pickup_zip`), and delivery (`delivery_city` / `delivery_state` / **`destination_zip`**) stay unmasked places. Empty snapshot is `null` and assemble omits the key. This beat does **not** emit `lead_created`. This beat does **not** redact the rest of the page — module **asks** sibling `masking.ts` after assemble returns.

There is no fourth emit, load, or outcome operation. `ownerGroupsForPaths` / `ownerGroupForPath` / `placeLine` / `leadUpdateSummary` are beats inside stories 1 and 3.

## Organization

Keep one file. This is the screenplay for “label the assembled event, say how it correlates, mask the origin form.” v1 emit already lives in already-recommended `assemble.ts`. v2 wrap already lives in already-recommended `projector.ts`. Dual clocks already live in already-recommended `clocks.ts`. Current outcome / stages already live in sibling `outcome.ts`. §8 attention already lives in sibling `attention.ts`. Page redact already lives in sibling `masking.ts` via `module.ts`. Mongo hop already lives in sibling `mongo-evidence-loader.ts`. Recent official Bookings already live in sibling `recent-official-bookings.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `JobNumberTimelineEvidenceService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second emit **adapter** so “labels can invent `source_received`.” Do not invent a second outcome **adapter** so “status can decide booked.” Do not invent a CRUD folder so “each label gets a file.”

Do not move `formSnapshotForLead` into assemble so “emit owns masking.” Do not move `correlationFor` into projector so “the wrap owns walk-back.” Do not teach Admin to recompute `evidence_level` / `correlation` so “the desk can paint without the server stamp.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `stage.ts` / `refs.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `stageForKind` | `nameTheStageForThisKind` | projector **asks** it on every stamped event; intake and official share a stage |
| `evidenceLevelFor` | `nameHowStrongTheEvidenceIsWithoutInferring` | projector **asks** it; goldens lock no `inferred` |
| `eventSummary` | `writeTheOwnerReadableSummary` | projector **asks** it; lead-update groups plus ingress sentences; else headline |
| `eventStatus` | `nameWhetherThisEventIsCompletedActivePendingOrFailed` | projector **asks** it; not `current_outcome` |
| `correlationFor` | `sayHowThisEventCorrelatesToThisJobNumber` | projector **asks** it with assemble’s proof / walk-back / snapshot flags |
| `evidenceRefsFor` | `listTheSafeEvidenceRefs` | projector **asks** it; safe labels only |
| `formSnapshotForLead` | `maskTheIngestedFormSnapshotForTheOriginCard` | assemble **asks** it on `lead_created` |

Keep the old names as one-line aliases until already-recommended `projector.ts` and `assemble.ts` migrate. Do not make callers learn `ownerGroupsForPaths` / `leadUpdateSummary` / `ownerGroupForPath` / `placeLine` as the domain language — those stay internal beats (today they are leftover exports with no other `src/` caller). Do **not** put these names onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** rename persisted `evidence_level` / `stage` / `correlation.method` / `correlation.confidence` strings (`verified_change` / `official_record` / `recorded_evidence` / `external_acknowledgement`, `walked_back`, `direct_job_number`, `sheet_entity_reference`). Do **not** start returning `inferred` or typed `limitation` so “the union becomes true.”

**No workflow class.** The one type that *does* earn a name is the assemble-via-projector handoff `correlationFor` already consumes:

```ts
type JobNumberCorrelationContext = {
  proof_shape: string
  job_number_at_create: boolean
  cancellation_via_snapshot: boolean
}
```

That is the handoff from “assemble already knows WordPress-born, Job-at-create, and snapshot cancel” to “this file can say walk-back versus exact.” Today the parameter is an inline object. Do **not** add contact, SMS body, Sheet id, or `last_error` onto the correlation or the refs so “the desk can debug.” Do **not** add a Mongo `Db` onto `sayHowThisEventCorrelatesToThisJobNumber` so “labels can hop.”

`OwnerFormSnapshot` already names the origin-card bag. Leave it. Do **not** add unmasked phone or email onto it so “the desk can click to call.”

Leave `projectEnhancedPage` on already-recommended `projector.ts`. Leave `event_at` emit on already-recommended `assemble.ts`. Leave `selectEventTime` on already-recommended `clocks.ts`. Leave `evaluateCurrentOutcome` on sibling `outcome.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// evidence.ts
// The v1 chain is already assembled.
// Name the stage, how strong the evidence is, the sentence,
// and whether this row is done, open, pending, or failed.
// Say how it belongs to this Job Number. List only safe refs.
// When assemble emits lead created, mask the ingested form.

// ── 1. Stage, strength, summary, status ───────────────────

export function nameTheStageForThisKind(kind)
  // intake and official share booking / cancellation

export function nameHowStrongTheEvidenceIsWithoutInferring(event)
  // RC ingress + delivered/sent/undelivered text → external_acknowledgement
  // command-backed create/update/job/official → verified_change
  // official_fact_only → official_record
  // else recorded_evidence — never inferred, never limitation

export function writeTheOwnerReadableSummary(event)
function groupChangedPathsForTheOwner(paths)           // leftover ownerGroupsForPaths
function writeTheLeadUpdateSentence(commandName, paths)
  // "booking state and move details updated from Granot."

export function nameWhetherThisEventIsCompletedActivePendingOrFailed(event)
  // intake resolved/open; sheet failed/pending/synced;
  // text failed/pending/completed; observation + source_received informational

// ── 2. Correlation and safe refs ──────────────────────────

export function sayHowThisEventCorrelatesToThisJobNumber(event, context)
  // WordPress-born lead created before Job Number → walked_back
  // snapshot Cancellation → exact direct_job_number
  // booking-linked Cancellation → booking_reference
  // Sheet Sync → sheet_entity_reference

export function listTheSafeEvidenceRefs(event)
  // receipt / observation / decision / entity_change / message /
  // booking / cancellation / sheet job / case / command / path /
  // processed call — skip empty strings

// ── 3. Mask the ingested form for the origin card ─────────

export function maskTheIngestedFormSnapshotForTheOriginCard(lead)
  // asks maskName / maskPhone / maskEmail
  // delivery zip is destination_zip
  // empty → null; assemble omits the key
```

Read the label path out loud: *name the stage for this kind, name how strong the evidence is without inferring, write the owner-readable summary including grouped lead updates from Granot, name whether this event is completed, active, pending, failed, or informational, say how this event correlates to this Job Number including a WordPress walk-back and a snapshot Cancellation, list the safe evidence refs, and mask the ingested form snapshot for the origin card.*

That is the operation. `evidenceLevelFor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Tests never **ask** this interface.** `v2.test.ts` locks “every event has `evidence_level`” and “none is `inferred`” through `module.read`. Snapshot Cancellation `direct_job_number` / `exact` is the same. `assemble.test.ts` locks `form_snapshot` through assemble and locks lead-update **headline**, not `summary`. Bring WordPress walk-back, RingCentral `external_acknowledgement`, command-backed `verified_change`, official-fact `official_record`, grouped Granot lead-update summary, and snapshot-versus-booking cancellation proofs onto this **interface** (inject a v1 event + correlation context, or a `LeadRow` for the snapshot). Leave wrap / activity / 250-cap proofs on already-recommended `projector.ts`.

2. **Headline and summary are two sentences.** Assemble’s lead-update headline is `Lead updated (synchronizeLeadFromGranot)` and must omit paths. This file’s summary is `booking state and move details updated from Granot.` Do not copy paths onto the headline so “one sentence owns the update,” and do not delete the summary so “headline is enough.”

3. **`limitation` / `inferred` / `limited` / `equivalent_job_number` / `entity_change_reference` are typed and unused.** `EvidenceLevel` includes `limitation`. `TimelineCorrelation` includes `limited`, `equivalent_job_number`, and `entity_change_reference`. This file never returns them. Goldens lock no `inferred` even though that string is not on the union. Do not start returning `limitation` so “the union becomes true,” and do not delete the unused members in this pass without an **interface** proof.

4. **RingCentral ingress is acknowledgement; WordPress and Granot ingress are recorded evidence.** All three are `source_received`. Only `ingress === "ringcentral"` takes the acknowledgement branch. Do not promote WordPress / Granot to `external_acknowledgement` so “every ingress matches,” and do not demote RingCentral to `recorded_evidence` so “every `source_received` matches.”

5. **Walk-back is WordPress-born lead created only.** RingCentral-born or Granot-born `lead_created` with `job_number_at_create === false` stays exact `lead_reference`. Do not walk those back so “every late Job Number is walked_back.”

6. **Snapshot Cancellation stays exact `direct_job_number`.** Booking-linked official Cancellation is `booking_reference`. This file does not invent an `official_booking` event. Do not switch snapshot cancel to `booking_reference` so “every cancel points at a booking.”

7. **`job_number_acquired` without `record_link.established_at` falls through to default `direct_job_number`.** Command-backed acquire that used `entity_change.applied_at` does not take the `record_link` branch. Do not force every acquire onto `record_link` so “Job Number always cites the link.”

8. **Sheet Sync correlation is entity id, never Job Number.** Explanation already says so. Do not change the method to `direct_job_number` so “every row is job-scoped.”

9. **Lead-update groups are regex, not a path catalog.** `source_` / `receiver_agent` keep a name/phone/email path out of Contact. `Move` becomes `Move details`; every other group is lowercased. Empty paths become `Lead fields updated.` Do not add a path allow-list so “unknown fields hide,” and do not treat `synchronizeLeadFromGranot` as a different kind so “Granot updates get their own event.”

10. **Delivery zip is `destination_zip`.** The ingested move snapshot has no `delivery_zip`. Assemble’s WordPress walk-back golden locks `pickup: "NY 10001"` / `delivery: "FL 33101"` (state + zip, no city). Do not read a leftover `delivery_zip` so “the names match,” and do not require city so “the place line looks like an address.”

11. **Refs parse event ids.** EntityChange / Lead Message / processed-call refs are sliced from `event.id` prefixes, not `data`. WordPress / Granot receipts use `data.receipt_id`. Do not invent a processed-call id on emit so “refs can stop parsing,” and do not put raw contact on a ref so “the desk can open Granot.”

12. **`ownerGroupsForPaths` and `leadUpdateSummary` are leftover exports.** No other `src/` file imports them. `eventSummary` already **asks** the sentence. Do not put them on the HTTP barrel so “the desk can group paths,” and do not add helper-unit tests that freeze the regex.

13. **Leave sibling modules alone.** Assemble emit, projector wrap, `selectEventTime`, `evaluateCurrentOutcome` are already the right **depth**. This file does not orchestrate them; projector orchestrates this file, assemble **asks** the snapshot. Do not silently change assemble’s WordPress-receipt emit, snapshot-cancel handoff, or headline-omits-paths rule while renaming. Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `nameTheStageForThisKind`, `nameHowStrongTheEvidenceIsWithoutInferring`, `writeTheOwnerReadableSummary`, `nameWhetherThisEventIsCompletedActivePendingOrFailed`, `sayHowThisEventCorrelatesToThisJobNumber`, `listTheSafeEvidenceRefs`, and `maskTheIngestedFormSnapshotForTheOriginCard` (today `stageForKind`, `evidenceLevelFor`, `eventSummary`, `eventStatus`, `correlationFor`, `evidenceRefsFor`, `formSnapshotForLead`).

Today’s `v2.test.ts` already names “no `inferred` evidence” and “cancellation snapshot restores exact job correlation” — but it **asks** `module.read`. `assemble.test.ts` already names the WordPress `form_snapshot` — but it **asks** assemble. Those are the right assertion style on the wrong **seam**. Add (or move) those proofs onto this **interface** with an injected v1 event + correlation context, or a `LeadRow` for the snapshot, so an assemble or projector rename cannot hide an evidence miss.

Name the operation:

**Stage, strength, summary, status**
- Every kind maps to exactly one stage. `booking_intake` and `official_booking` share `booking`. `cancellation_intake` and `official_cancellation` share `cancellation`.
- RingCentral `source_received` → `external_acknowledgement`. WordPress / Granot `source_received` → `recorded_evidence`.
- `lead_created` / `official_booking` + `command_backed` → `verified_change`. Same kinds + `official_fact_only` → `official_record`.
- `lead_message` `delivered` / `sent` / `undelivered` → `external_acknowledgement`. `accepted` / `scheduled` → `recorded_evidence`.
- Never `inferred`. Never typed `limitation`.
- `lead_updated` + `synchronizeLeadFromGranot` + paths `granot_priority`, `cubic_feet`, `pickup_city` → summary `booking state and move details updated from Granot.` Headline is not this file.
- WordPress / Granot / RingCentral `source_received` use the dedicated capture sentences. Other kinds return `event.headline`.
- Open intake → `active`. Resolved intake → `completed`. Sheet Sync `failed` → `failed`. `pending` / `retrying` / `processing` → `pending`. `synced` → `completed`. Observation and `source_received` → `informational`.

**Correlation and safe refs**
- WordPress-born `lead_created` + `job_number_at_create: false` → `lead_reference` / `walked_back`. Same event on Granot-born or with Job-at-create → `exact`.
- Snapshot official Cancellation → `direct_job_number` / `exact`. Booking-linked official Cancellation → `booking_reference` / `exact`.
- `sheet_sync` → `sheet_entity_reference`. `job_number_acquired` + `clock_field === "record_link.established_at"` → `record_link`. Otherwise default `direct_job_number`.
- WordPress receipt ref uses `wordpress_receipt`. Granot uses `receipt`. RingCentral processed-call ref is the id suffix. Empty strings are omitted. No contact, no SMS body, no `spreadsheet_id`.

**Masked origin snapshot**
- Name / phone / email are masked. Move date, size, pickup, and delivery stay. Delivery zip is `destination_zip`. Empty lead → `null`.
- This file does not emit `lead_created` and does not invent a WordPress `source_received`.

Do **not** add a test per helper (`groupChangedPathsForTheOwner`, `placeLine`, `ownerGroupForPath`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`projectEnhancedPage` / `assembleJobNumberTimeline` are not a second **adapter** on this file. They are sibling **modules**. Do not add helper-unit tests for them here.

## What I would not do

- A `JobNumberTimelineEvidenceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the stage map or `String(event.data.status)`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `labels/` folder of one-export files.
- Breaking the projector **ask**. Wrap must still **ask** this file for stage / strength / summary / status / correlation / refs.
- Breaking the assemble snapshot **ask**. `lead_created` must still **ask** this file for the masked form.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts`, `projector.ts`, or `clocks.ts` as this story.
- Treating sibling `outcome.ts` or `attention.ts` as this story — next passes own those checklists.
- Inventing an emit **seam** that has only these labels as an **adapter**.
- Silently “fixing” unused `limitation` / `limited` / `equivalent_job_number` members, RingCentral-versus-WordPress evidence strength, WordPress-only walk-back, or `destination_zip` while renaming.
- Teaching Admin to recompute `evidence_level` or `correlation`.
- Returning `inferred` so “missing rows stay visible.”
- Jumping to `tariff` or Wave B while this checklist still has unchecked modules.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
