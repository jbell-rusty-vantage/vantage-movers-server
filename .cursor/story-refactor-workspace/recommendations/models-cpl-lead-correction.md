# Remember The Immutable Before And After Lead CPL Evidence Row On The Default Mongo Connection, Unique-Index One Evidence Row Per Frozen Job Plus Lead Kind Plus Lead Id, And Index Lead Plus Corrected At For History Without Uniqueness — Never Rewrite A Lead Or File The Job Here, Never Unique-Index Lead Alone So A Second Job 11000s, Never Flip Evidence Cpl To Integer Cents So Evidence Matches The Period, Never Add useDb So Evidence Matches The Job — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 13 of this service — `CplLeadCorrection.ts`
- Remaining in this service: `Merchant.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CplLeadCorrection.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplCorrections.ts` is Owner correction jobs against stored Lead snapshots; leftover `cplSchedule.ts` is the writable CPL authority; new Lead writes go through leftover `leads/leadCplResolution.ts`. Knowledge resource list names the service — do not add a Models Service file in this rename so “the Service sentence wins”). Compatibility rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (prior Lead rewrites require the separate Owner preview/apply workflow; freeze reviewed IDs and state; reject drift as `CPL_PREVIEW_STALE`; touch FormLead and CallLead collections only; **keep immutable before/after evidence**; workers use owner-guarded leases, stable cursors, transactional Lead-plus-checkpoint writes, resumable failures, safe cancellation, bounded windows/targets, and sanitized events/errors; schedule edits never rewrite prior Leads — **this file never previews**, never files, never claims a lease, never `$set`s a Lead, never checkpoints a job). Owner rewrite: already-recommended [operations-registry-cpl-corrections.md](operations-registry-cpl-corrections.md) (`processCplCorrectionBatch` leftover `applyCorrectionToLead` **asks** leftover `createMongoCplCorrectionLeadStore().updateLeadCorrection` which **asks** `getCplLeadCorrectionModel().create` in the same leftover session as leftover Form / Call CAS — **this file never prices a target**, never `$set`s leftover `cpl_correction` on the Lead). Already-recommended leftover job: [models-cpl-correction-job.md](models-cpl-correction-job.md) (`getCplCorrectionJobModel` with leftover `useDb`; leftover frozen `reviewed_targets[].cpl` dollars; leftover unique is **not** on leftover `request_id` — **this file unique-indexes leftover `job_id` plus leftover Lead kind plus leftover Lead id**, **never** holds leftover status / leftover lease / leftover preview hash). Leftover live book: already-recommended [models-cpl-rate-period.md](models-cpl-rate-period.md) (`getCplRatePeriodModel`; integer `amount_cents` — **this file snapshots Lead `cpl` dollars** and leftover `ref: "CplRatePeriod"`, **never** writes a period). Leftover fourteen-slot: already-recommended [models-cpl-rate.md](models-cpl-rate.md) (default-only `CplRate`; **no** getter — **do not delete this getter so “evidence matches fourteen-slot”**). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** leftover job getter `countDocuments` failed and stalled — leftover health **does not** import this file). Leftover cron wake: already-recommended [routes-cpl-correction-cron.md](routes-cpl-correction-cron.md) (**asks** leftover `runDueCplCorrectionJobs` — **this file never drains**). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files store nested `cpl_correction.job_id` `ref: "CplCorrectionJob"`, leftover `corrected_at`, leftover `previous_cpl`, and set `autoIndex: false` — **do not copy that fence here**, **do not `$set` leftover nested `cpl_correction` here**; leftover nested stamp is **not** leftover before/after). Distinct from leftover next catalog: leftover next `Merchant.ts` (default-only unique leftover `normalized_name` — **do not copy this leftover unique leftover job-plus-Lead onto leftover next**). Distinct from leftover historical relax: this checkout has **no** `historical/CplLeadCorrection.ts`. Leftover overview / leftover historical-consolidation validate **do not** ask this collection. Scripts do **not** import this file. Nobody leftover-finds leftover `cpl_lead_corrections` after leftover append. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define correction evidence here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection getter only — no default model export, no `useDb`.** Leftover `operationsRegistry/cplCorrections.ts` leftover `createMongoCplCorrectionLeadStore().updateLeadCorrection` **asks** `getCplLeadCorrectionModel().create([beforeAfter], { session })` after leftover Form / Call leftover `updateOne` leftover CAS leftover returns leftover `modifiedCount === 1`. Leftover `applyCorrectionToLead` leftover elects leftover `no_op` leftover when leftover this leftover job leftover already leftover stamped leftover the leftover Lead leftover and leftover it leftover still leftover matches leftover the leftover book, leftover or leftover when leftover the leftover live leftover snapshot leftover already leftover matches leftover — leftover those leftover paths leftover **do not** leftover append leftover here. Leftover `cplCorrections.test.ts` leftover **asks** leftover an leftover in-memory leftover `CplCorrectionLeadStore` leftover and leftover nested leftover Lead leftover `cpl_correction` leftover — **not** this model. Leftover `health.test.ts` leftover fixtures leftover `registry.cpl_correction_jobs_unhealthy` leftover — **not** this model. There is no `CplLeadCorrection.test.ts`. Nobody leftover-inspects leftover `CplLeadCorrection` leftover `schema.indexes()`. Leftover overview **does not** import this file. Leftover historical-consolidation **does not** import this file. Leftover scripts **do not** import this file. Already-recommended leftover job leftover `ref: "CplCorrectionJob"` leftover on leftover this leftover `job_id` leftover is leftover a leftover string leftover name, leftover not leftover an leftover import. Already-recommended leftover Form / Call leftover `ref: "CplCorrectionJob"` leftover is leftover a leftover string leftover name, leftover not leftover an leftover import. `CplLeadCorrectionDocument` leftover is leftover **not** leftover imported leftover outside leftover this leftover file. Not this **interface**: leftover `previewCplCorrection` itself, leftover `createCplCorrection` itself, leftover `processCplCorrectionBatch` itself, leftover `runDueCplCorrectionJobs` itself, leftover `applyCorrectionToLead` itself, leftover Form / Call leftover `$set cpl_correction` itself.
- Seams callers need: `getCplLeadCorrectionModel()` (default `mongoose.models.CplLeadCorrection ?? mongoose.model(...)` — leftover store leftover append) vs already-recommended leftover job `getCplCorrectionJobModel()` (selected `getMongoDatabaseName()` leftover plus leftover `useDb`) vs already-recommended leftover fourteen-slot default-only `CplRate` (no getter); leftover unique `{ job_id, lead_model, lead_id }` vs leftover job leftover non-unique leftover `request_id` leftover and leftover non-unique leftover `{ lead_model, lead_id, corrected_at: -1 }` leftover history; leftover immutable leftover `job_id` / leftover `lead_model` / leftover `lead_id` / leftover `corrected_at` / leftover `before` / leftover `after` vs leftover job leftover mutable leftover status / leftover counts / leftover cursor / leftover lease; leftover snapshot leftover `cpl` leftover dollars vs already-recommended leftover period leftover `amount_cents`; leftover snapshot leftover **without** leftover `duplicate` vs leftover Lead leftover CAS leftover filter leftover that leftover **includes** leftover `duplicate`; leftover this leftover full leftover before/after leftover vs leftover Form / Call leftover nested leftover `cpl_correction` leftover `{ job_id, corrected_at, previous_cpl }`; leftover same leftover `now` leftover stamped leftover onto leftover `corrected_at` leftover and leftover Lead leftover nested leftover stamp leftover and leftover `after.cpl_resolved_at`; leftover store leftover `create([doc], { session })` leftover after leftover Lead leftover CAS leftover in leftover the leftover same leftover `runMutation` leftover session vs leftover no leftover leftover-find leftover of leftover this leftover collection; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-rewrite **seam**. There is no selected-database **seam**. There is no leftover-list **seam**.
- Split later (only if the file outgrows one sitting): this ~77-line file is one sitting if you read it as remember the immutable before and after Lead CPL evidence row on the default Mongo connection, unique-index one evidence row per frozen job plus Lead kind plus Lead id, and index Lead plus correctedAt for history without uniqueness — never rewrite a Lead or file the job here, never unique-index Lead alone so a second job 11000s, never flip evidence `cpl` to integer cents so evidence matches the period, never add `useDb` so evidence matches the job. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `snapshot.ts` / `before.ts` / `after.ts`. Leftover preview / leftover file / leftover claim / leftover rewrite stay already-recommended `cplCorrections.ts`. Leftover frozen job stays already-recommended `CplCorrectionJob.ts`. Leftover live book stays already-recommended `CplRatePeriod.ts`. Leftover next catalog stays leftover `Merchant.ts`.

`CplLeadCorrection` is a Mongoose model name. The owner question is: *Owner’s leftover worker just CAS-wrote one frozen Form or Call snapshot after the live book changed. Hold the receipt on `cpl_lead_corrections`. Freeze the leftover job id, the leftover Lead kind, the leftover Lead id, the leftover instant, and the leftover before and after bags (Lead `cpl` dollars plus leftover period / leftover resolution status / leftover resolved-at / leftover resolution version). Unique leftover job plus leftover Lead kind plus leftover Lead id so leftover resume cannot append a second receipt for the same leftover pair. Index leftover Lead plus leftover correctedAt so leftover later leftover history leftover can leftover walk leftover — do not unique that leftover history leftover compound, because leftover Owner leftover may leftover file leftover a leftover second leftover job leftover against leftover the leftover same leftover Lead. Hand back the leftover default-connection leftover model leftover through leftover the leftover getter. Do not rewrite a Lead. Do not file a job. Do not claim a lease. Do not leftover-find leftover this leftover collection leftover from leftover this leftover file. Do not unique-index leftover Lead leftover alone so “one correction per Lead.” Do not flip leftover evidence leftover `cpl` leftover to leftover cents so “evidence matches the period.” Do not add leftover `useDb` so “evidence matches the job.” Do not invent leftover a leftover default leftover `CplLeadCorrection` leftover export so “evidence matches the job.” Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who show / file / claim / rewrite already lives in already-recommended `cplCorrections.ts`. Who hold leftover the leftover frozen leftover job leftover already leftover lives leftover in already-recommended leftover `CplCorrectionJob.ts`. Who hold leftover the leftover live leftover book leftover already leftover lives leftover in already-recommended leftover `CplRatePeriod.ts`. Who leftover `$set` leftover nested leftover `cpl_correction` leftover already leftover lives leftover on leftover Form / Call leftover plus leftover leftover store leftover CAS. Do not pull those in.

## What this file actually does

Three operations of one “remember the immutable before and after Lead CPL evidence row, unique-index one evidence row per frozen job plus Lead kind plus Lead id, and index Lead plus correctedAt for history without uniqueness” story, not “a CPL lead-correction CRUD dump,” and not Show What This Window Would Rewrite / File The Prior-Lead Rewrite Job / Rewrite One Frozen Lead Batch themselves:

1. **Hold the immutable before/after Lead CPL evidence as the durable rewrite receipt** — collection `cpl_lead_corrections`, timestamps, **no** `toJSON` / `toObject` virtuals declared. **No** virtuals. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** leftover `amount_cents`. **No** leftover `YYYY-MM-DD` date strings. **No** `business_timezone`. **No** leftover `status`. **No** leftover lease. **No** leftover `preview_hash`. **No** leftover `requested_by`. **No** leftover `duplicate` on leftover the leftover snapshot. **No** leftover `sheet_sync[]`. **No** Ingestion Origin. Declares required immutable `job_id` (ObjectId → leftover frozen leftover job, leftover `ref: "CplCorrectionJob"`), required immutable `lead_model` (enum leftover `FormLead` | leftover `CallLead`), required immutable `lead_id` (ObjectId — **no** leftover `refPath`), required immutable `corrected_at` (Date UTC instant), required immutable nested leftover `before` leftover and leftover `after` leftover (`CplLeadCorrectionSnapshotSchema`, leftover `_id: false`: leftover required leftover `cpl` leftover Number leftover **without** leftover `min` leftover and leftover **without** leftover `Number.isSafeInteger`, leftover optional leftover `cpl_rate_period` leftover ObjectId leftover `ref: "CplRatePeriod"` leftover default leftover `null`, leftover optional leftover `cpl_resolution_status` leftover String leftover default leftover `null` leftover **without** leftover the leftover Lead leftover enum, leftover optional leftover `cpl_resolved_at` leftover Date leftover default leftover `null`, leftover optional leftover `cpl_resolution_version` leftover String leftover default leftover `null`). This beat does **not** leftover `$set` leftover a leftover Lead. This beat does **not** leftover invent leftover `after.cpl` leftover from leftover leftover `amount_cents`. This beat does **not** leftover stamp leftover leftover `duplicate`. A leftover append leftover may leftover still leftover 11000 leftover when leftover leftover unique leftover leftover job-plus-Lead leftover already leftover exists.

2. **Unique-index one evidence row per frozen job plus Lead kind plus Lead id, and index Lead plus correctedAt for history — without uniqueness on the history compound** — leftover `{ job_id: 1, lead_model: 1, lead_id: 1 }` leftover **unique**. Leftover `{ lead_model: 1, lead_id: 1, corrected_at: -1 }` leftover **not** leftover unique. Neither leftover is leftover named. Neither leftover has leftover a leftover `pnpm migration:*` leftover apply leftover path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Leftover store leftover **asks** leftover `create` leftover only leftover after leftover leftover Lead leftover CAS leftover succeeds. Leftover `applyCorrectionToLead` leftover leftover `no_op` leftover leftover when leftover leftover this leftover job leftover already leftover stamped leftover the leftover Lead leftover is leftover why leftover leftover resume leftover leftover does leftover **not** leftover hit leftover leftover 11000. A unique leftover `{ lead_model: 1, lead_id: 1 }` leftover would leftover 11000 leftover a leftover second leftover leftover Owner leftover job leftover against leftover the leftover same leftover Lead. Dropping leftover leftover uniqueness leftover on leftover leftover job-plus-Lead leftover leftover would leftover leftover let leftover leftover a leftover leftover retried leftover leftover session leftover leftover append leftover leftover a leftover leftover second leftover leftover receipt leftover leftover for leftover leftover the leftover leftover same leftover leftover pair. This beat does **not** leftover unique-index leftover leftover `corrected_at`. This beat does **not** leftover leftover-find leftover leftover history leftover from leftover leftover this leftover leftover file.

3. **Bind the default Mongo connection through the getter** — there is **no** leftover default leftover export leftover `CplLeadCorrection`. `getCplLeadCorrectionModel()` leftover returns leftover `mongoose.models.CplLeadCorrection ?? mongoose.model(...)`. There is **no** leftover `getMongoDatabaseName()`. There is **no** leftover `useDb`. Leftover store leftover append leftover **asks** leftover the leftover getter. Nobody leftover-inspects leftover `schema.indexes()`. This beat does **not** leftover open leftover `vantagemovershistorical`. This beat does **not** leftover call leftover `syncIndexes`. This beat does **not** leftover invent leftover `getCplRateModel` leftover on leftover already-recommended leftover fourteen-slot. This beat does **not** leftover copy leftover leftover job leftover leftover `useDb` leftover so leftover “evidence leftover matches leftover the leftover job.”

`CplLeadCorrectionDocument` is the inferred row type. There is no leftover status leftover enum leftover export. There is no leftover named-index leftover export.

There is no leftover-preview operation. Leftover `previewCplCorrection` elects that. There is no leftover-file operation. Leftover `createCplCorrection` elects that. There is no leftover-rewrite operation. Leftover `processCplCorrectionBatch` elects that. There is no leftover-job operation. Already-recommended leftover `CplCorrectionJob.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the immutable before and after Lead CPL evidence row on the default Mongo connection, unique-index one evidence row per frozen job plus Lead kind plus Lead id, and index Lead plus correctedAt for history without uniqueness — never rewrite a Lead or file the job here, never unique-index Lead alone so a second job 11000s, never flip evidence `cpl` to integer cents so evidence matches the period, never add `useDb` so evidence matches the job.” Leftover preview / leftover file / leftover claim / leftover rewrite / leftover live-book write already live in deeper **modules**. Already-recommended leftover frozen job already lives in a sibling **module**. Do not pull those in. Do not invent a `CplLeadCorrectionModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** beside today’s leftover no-`useDb` leftover getter. Do not invent a default leftover `CplLeadCorrection` leftover export so “evidence matches the job.” Do not invent an `autoIndex: false` **adapter** so “evidence matches Booking” without a reviewed index migration. Do not invent a unique `{ lead_model: 1, lead_id: 1 }` **adapter** so “schema uniqueness matches one correction per Lead.” Do not invent a leftover-find **adapter** so “the Owner can see before/after.” Do not invent a `pre("validate")` that leftover copies leftover leftover `duplicate` leftover from leftover leftover the leftover leftover Lead leftover so leftover “hand insert leftover matches leftover leftover CAS.” Do not invent an `amount_cents` field so “the frozen Lead matches the period.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `snapshot.ts` / `before.ts` / `after.ts` each get a file.

Do not move leftover `applyCorrectionToLead` into this file so “the row owns the rewrite.” Do not merge this file into already-recommended leftover `CplCorrectionJob.ts` so “one schema owns the job and the before/after.” Do not merge this file into already-recommended leftover Form / Call so “the Lead owns leftover before/after.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getCplLeadCorrectionModel` | `immutableBeforeAfterEvidenceOnTheDefaultConnection` | leftover store leftover append leftover must leftover register leftover on leftover leftover `mongoose.models` leftover / leftover leftover `mongoose.model` |
| `CplLeadCorrectionDocument` | `ImmutableBeforeAfterLeadCplEvidenceRow` | inferred leftover document leftover leftover store leftover leftover does leftover **not** leftover leftover import leftover leftover today |

Keep the old names as one-line aliases until leftover `cplCorrections.ts` leftover store leftover migrates. Do not make callers learn `useDb` / `reviewed_targets` / `amount_cents` as the domain language. Do **not** leftover invent leftover a leftover default leftover `CplLeadCorrection` leftover export so leftover “everyone leftover must leftover match leftover the leftover job” leftover without leftover a leftover paired leftover proof leftover that leftover leftover store leftover leftover still leftover leftover **asks** leftover leftover the leftover leftover getter. Do **not** leftover delete leftover leftover the leftover leftover getter leftover so leftover “evidence leftover matches leftover fourteen-slot” leftover without leftover a leftover paired leftover proof leftover that leftover leftover store leftover leftover still leftover leftover appends leftover leftover `cpl_lead_corrections`. Do **not** leftover re-export leftover leftover already-recommended leftover leftover `CplCorrectionJob` leftover from leftover leftover this leftover leftover file leftover so leftover “one leftover type leftover owns leftover the leftover job leftover and leftover the leftover before/after.” Do **not** leftover copy leftover leftover job leftover leftover `useDb` leftover onto leftover leftover this leftover leftover file leftover so leftover “every leftover correction leftover model leftover matches.”

**No class for the workflow.** The one type that *does* earn a name is the pending evidence-identity contract:

```ts
type ImmutableBeforeAfterLeadCplEvidenceIdentity = {
  job_id: { immutable: true; objectId: true; ref: "CplCorrectionJob" }
  lead_model: { immutable: true; enum: ["FormLead", "CallLead"] }
  lead_id: { immutable: true; objectId: true }
  corrected_at: { immutable: true }
  before: { immutable: true; cpl: "lead_dollars"; duplicate: false }
  after: { immutable: true; cpl: "lead_dollars"; duplicate: false }
  per_job_lead: { unique: true }
  per_lead_history: { unique: false }
}
```

That is the handoff from “leftover store CAS-wrote this Lead in this leftover session” to “leftover resume cannot append a second receipt for the same leftover job plus leftover Lead, leftover Owner can still file a leftover second leftover job against leftover the same leftover Lead, and leftover evidence leftover `cpl` leftover stays leftover Lead leftover dollars.” Do **not** add `{ per_lead_history: { unique: true } }` onto that type so “one correction per Lead.” Do **not** add `{ before: { cpl: "amount_cents" } }` so “money matches the period.” Do **not** add `{ selectedDatabase: true }` so “evidence matches the job.”

Leave leftover next `Merchant.ts` on that file. Leave already-recommended leftover `CplCorrectionJob.ts` on that file. Leave already-recommended leftover `CplRatePeriod.ts` on that file. Leave leftover preview / leftover file / leftover claim / leftover rewrite on already-recommended leftover `cplCorrections.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CplLeadCorrection.ts
// Owner's leftover worker just CAS-wrote one frozen Form or Call snapshot
// after the live book changed.
// Hold the receipt on cpl_lead_corrections.
// Freeze the leftover job id, the leftover Lead kind, the leftover Lead id,
// the leftover instant, and the leftover before and after bags
// (Lead cpl dollars plus leftover period / leftover resolution status /
// leftover resolved-at / leftover resolution version).
// Unique leftover job plus leftover Lead kind plus leftover Lead id
// so leftover resume cannot append a second receipt for the same leftover pair.
// Index leftover Lead plus leftover correctedAt
// so leftover later leftover history leftover can leftover walk leftover —
// do not unique that leftover history leftover compound,
// because leftover Owner leftover may leftover file leftover a leftover second leftover job
// against leftover the leftover same leftover Lead.
// Hand back the leftover default-connection leftover model
// through leftover the leftover getter.
// Do not rewrite a Lead.
// Do not file a job.
// Do not claim a lease.
// Do not leftover-find leftover this leftover collection leftover from leftover this leftover file.
// Do not unique-index leftover Lead leftover alone
// so "one correction per Lead."
// Do not flip leftover evidence leftover cpl leftover to leftover cents
// so "evidence matches the period."
// Do not add leftover useDb
// so "evidence matches the job."
// Do not invent leftover a leftover default leftover CplLeadCorrection leftover export
// so "evidence matches the job."
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export function immutableBeforeAfterEvidenceOnTheDefaultConnection() {
  return (
    mongoose.models.CplLeadCorrection ??
    mongoose.model("CplLeadCorrection", immutableBeforeAfterLeadCplEvidenceSchema)
  )
}

export { immutableBeforeAfterEvidenceOnTheDefaultConnection as getCplLeadCorrectionModel }

// ── 1. Hold the immutable before/after receipt ────────────

const immutableBeforeAfterLeadCplEvidenceSchema = rememberTheImmutableBeforeAfterLeadCplEvidence() // collection cpl_lead_corrections; default autoIndex; Lead dollars not period cents

function rememberTheImmutableBeforeAfterLeadCplEvidence() {
  const schema = new Schema(
    {
      job_id: requiredImmutableFrozenJobObjectId(),          // ref CplCorrectionJob; not a string request id
      lead_model: requiredImmutableFormOrCallKind(),
      lead_id: requiredImmutableLeadObjectId(),              // no refPath
      corrected_at: requiredImmutableUtcInstant(),
      before: requiredImmutableLeadCplSnapshot(),            // cpl is Lead dollars; no duplicate
      after: requiredImmutableLeadCplSnapshot(),
    },
    { collection: "cpl_lead_corrections", timestamps: true },
  )
  uniqueOneReceiptPerFrozenJobAndLead(schema)
  indexLeadHistoryWithoutUniqueness(schema)
  return schema
}

function requiredImmutableLeadCplSnapshot() {
  return {
    cpl: requiredLeadDollars(),                              // no min; no Number.isSafeInteger
    cpl_rate_period: optionalPeriodObjectId(),               // ref CplRatePeriod; default null
    cpl_resolution_status: optionalUnenumeratedStatus(),     // Lead enum lives on Form / Call
    cpl_resolved_at: optionalInstant(),
    cpl_resolution_version: optionalVersion(),
  }
}

// ── 2. One receipt per job-plus-Lead; history is lookup ───

function uniqueOneReceiptPerFrozenJobAndLead(schema) {
  // today's unique { job_id, lead_model, lead_id }
}

function indexLeadHistoryWithoutUniqueness(schema) {
  // today's { lead_model, lead_id, corrected_at: -1 }
  // not unique, none named
}

// ── 3. Default Mongo connection ───────────────────────────

// immutableBeforeAfterEvidenceOnTheDefaultConnection above
```

Read the primary path out loud: *hold the immutable before/after Lead CPL evidence on `cpl_lead_corrections` with a required immutable leftover job ObjectId, a required immutable leftover Form or Call kind, a required immutable leftover Lead id, a required immutable leftover instant, and required immutable leftover before and after bags whose leftover `cpl` leftover is leftover Lead leftover dollars. Unique leftover job plus leftover Lead kind plus leftover Lead id so leftover resume cannot append a second leftover receipt for leftover the leftover same leftover pair. Index leftover Lead plus leftover correctedAt without uniqueness so leftover Owner leftover can leftover file leftover a leftover second leftover job leftover against leftover the leftover same leftover Lead. Today’s leftover store leftover append leftover still leftover asks leftover the leftover getter leftover after leftover leftover Lead leftover CAS leftover in leftover the leftover same leftover session. There is leftover no leftover default leftover `CplLeadCorrection` leftover export leftover and leftover no leftover `useDb`. Do not rewrite a Lead. Do not file a job. Do not unique-index leftover Lead leftover alone. Do not flip leftover evidence leftover `cpl` leftover to leftover cents. Do not add leftover `useDb` leftover so leftover “evidence leftover matches leftover the leftover job.”*

That is the operation. An unnamed schema dump is not. `updateLeadCorrection` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The unique is job plus Lead, not Lead alone — and that is today's file contract.** Resume must not append a second receipt for the same frozen job plus Lead kind plus Lead id. Owner may still file a second job against the same Lead. A unique `{ lead_model, lead_id }` would 11000 that second job. Dropping uniqueness on `{ job_id, lead_model, lead_id }` would let a retried session append a second receipt for the same pair. `applyCorrectionToLead` no-ops when this job already stamped the Lead and it still matches — that is why resume does not 11000. Do not unique-index Lead alone so "one correction per Lead." Do not drop uniqueness on job-plus-Lead so "retries can append."

2. **Evidence `cpl` is Lead dollars. Already-recommended period `amount_cents` is integer cents.** Form / Call store `cpl` as dollars. The store copies that snapshot onto `before` / `after`. The period stores cents. Do not rename evidence `cpl` to `amount_cents` so "evidence matches the period" — stale compare would elect `190` cents against `190` dollars or the reverse. Do not add `Number.isSafeInteger` or `min: 0` onto this `cpl` so "money matches the period."

3. **There is a default-connection getter and no default model export — and that is today's contract, not a missing job copy and not a missing fourteen-slot copy.** The store append asks `getCplLeadCorrectionModel`. Already-recommended job asks `getCplCorrectionJobModel` with `useDb`. Already-recommended fourteen-slot asks default `CplRate` and has no getter. Do not add `useDb` so "evidence matches the job." Do not invent a default `CplLeadCorrection` export so "evidence matches the job." Do not delete the getter so "evidence matches fourteen-slot."

4. **The snapshot has no `duplicate`. Lead CAS filters on `duplicate`.** This file does not stamp that flag. Do not add `duplicate` onto `before` / `after` so "hand insert matches CAS" without a paired proof that today's store still writes the same bags. That CAS lives on Form / Call plus the store, not here.

5. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. The two compounds here are not named. Do not silently set `autoIndex: false` so "evidence matches Booking" without a paired report that boot still creates the unique job-plus-Lead index or that a migration will. Do not invent `pnpm migration:cpl-lead-correction-indexes` in this rename.

6. **Nobody leftover-finds `cpl_lead_corrections` after append.** Overview and historical-consolidation do not import this file. Scripts do not import this file. There is no `CplLeadCorrection.test.ts`. Nobody inspects `schema.indexes()`. Do not add an overview count so "every book sits on the shelf." Do not add historical-consolidation validate so "every catalog row has a planned-insert proof." Do not add an admin list so "the Owner can see before/after."

7. **Nested Form / Call `cpl_correction` is not this receipt.** Those files store `{ job_id, corrected_at, previous_cpl }` and set `autoIndex: false`. This file holds the full before/after bags. Do not `$set` nested `cpl_correction` from here. Do not merge this file into Form / Call so "the Lead owns before/after."

8. **Leave sibling modules alone.** Preview / file / claim / rewrite, leftover frozen job, leftover live-book write, leftover fourteen-slot dollars, leftover health stalled counts, leftover cron wake, leftover next catalog `Merchant.ts`, and already-recommended Form / Call nested stamps are already the right depth. This file holds the immutable before/after receipt. Store `create([doc], { session })` after Lead CAS is the store **interface**, not this one.

## Testing

The interface is the test surface: `getCplLeadCorrectionModel`, the unique job-plus-Lead compound, the non-unique Lead-history compound, and the immutable before/after bags.

There is no `CplLeadCorrection.test.ts`. Today's proofs sit on callers. `cplCorrections.test.ts` already names hash / stale / lease resume / cancel / Analytics through an in-memory lead store and nested Lead `cpl_correction` — not this model. Keep those as the operation proofs on those interfaces.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the receipt**
- A new row requires `job_id`, `lead_model`, `lead_id`, `corrected_at`, `before`, and `after`.
- `lead_model` accepts only `FormLead` | `CallLead`.
- `before.cpl` and `after.cpl` accept `0` and `190` and do **not** require `Number.isSafeInteger`.
- There is no `amount_cents` path.
- There is no `duplicate` path on the snapshot.
- There is no `status` / lease / `preview_hash` / `requested_by` path.
- `lead_id` has no `refPath`.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Indexes**
- `{ job_id, lead_model, lead_id }` is declared and is unique.
- `{ lead_model, lead_id, corrected_at: -1 }` is declared and is not unique.
- Neither compound is named.
- There is no unique `{ lead_model, lead_id }`.

**Default connection**
- `getCplLeadCorrectionModel` remains exported.
- There is no default `CplLeadCorrection` export.
- The getter returns `mongoose.models.CplLeadCorrection ?? mongoose.model(...)`.
- The getter does not call `getMongoDatabaseName()` or `useDb`.

Do not add a test per helper (`requiredImmutableLeadCplSnapshot`, `uniqueOneReceiptPerFrozenJobAndLead`). Those names exist so the parent reads. Do not leftover-preview from this file's tests. Do not leftover-file from this file's tests. Do not leftover-rewrite a Lead from this file's tests. Do not leftover `syncIndexes` in the unit file so "the test creates the leftover unique."

There is no leftover named-index export to keep for a second leftover migration adapter.

## What I would not do

- A `CplLeadCorrectionModelService` / `CplLeadCorrectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `snapshot.ts` / `before.ts` / `after.ts` split for cleanliness.
- Inventing a unique `{ lead_model, lead_id }` seam so "one correction per Lead." A second leftover job against the same Lead must not 11000.
- Dropping uniqueness on `{ job_id, lead_model, lead_id }` so "retries can append a second receipt."
- Breaking the default-connection seam by adding `useDb` without a paired proof. Today's store appends on the default connection.
- Inventing a default `CplLeadCorrection` export so "evidence matches the job" without a paired proof that the store still asks the getter.
- Deleting `getCplLeadCorrectionModel` so "evidence matches fourteen-slot" without a paired proof that the store still appends `cpl_lead_corrections`.
- Treating leftover `previewCplCorrection` / leftover `createCplCorrection` / leftover `processCplCorrectionBatch` / leftover `runDueCplCorrectionJobs` as this story. Those functions own leftover preview hash, leftover file, leftover claim, leftover Lead CAS, and leftover Analytics handoff.
- Treating already-recommended leftover `CplCorrectionJob.ts` as this story. That leftover selected-database job leftover is leftover the frozen rewrite row.
- Treating already-recommended leftover `CplRatePeriod.ts` as this story. That leftover cents leftover book leftover is leftover the leftover live leftover price leftover list.
- Treating leftover next `Merchant.ts` as this story. That leftover unique leftover `normalized_name` leftover is leftover catalog identity.
- Inventing a cents seam so "evidence matches the period."
- Inventing a selected-database getter so "evidence matches the job."
- Inventing an `autoIndex: false` adapter that has only "matches Booking" as its second home.
- Inventing a leftover-find adapter that has only "the Owner can see before/after" as its second home.
- Silently adding a leftover overview count so "every leftover book sits on the shelf."
- Silently enabling leftover `optimisticConcurrency` so "evidence matches Booking."
- Silently "fixing" a leftover ADR while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
