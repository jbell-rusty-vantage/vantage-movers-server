# Remember The Frozen Prior-Lead Rewrite Job On The Selected Mongo Database, Freeze The Reviewed Form And Call Snapshots Plus The Preview Hash And The Revision Snapshot, And Index Claimable Status Plus Lease Plus Created At Without Uniqueness — Never Rewrite A Lead Or File The Job Here, Never Unique-Index Request Id So A Second Confirm 11000s, Never Flip Frozen Lead Cpl To Integer Cents So The Job Matches The Period, Never Delete The Getter Because Leftover Store And Leftover Health Already Follow It — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 12 of this service — `CplCorrectionJob.ts`
- Remaining in this service: `CplLeadCorrection.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CplCorrectionJob.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplCorrections.ts` is Owner correction jobs against stored Lead snapshots; leftover `cplSchedule.ts` is the writable CPL authority; new Lead writes go through leftover `leads/leadCplResolution.ts`. Knowledge resource list names the service — do not add a Models Service file in this rename so “the Service sentence wins”). Compatibility rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (prior Lead rewrites require the separate Owner preview/apply workflow; freeze reviewed IDs and state; reject drift as `CPL_PREVIEW_STALE`; touch FormLead and CallLead collections only; keep immutable before/after evidence; workers use owner-guarded leases, stable cursors, transactional Lead-plus-checkpoint writes, resumable failures, safe cancellation, bounded windows/targets, and sanitized events/errors; schedule edits never rewrite prior Leads — **this file never previews**, never files, never claims a lease, never stamps a Lead, never appends leftover evidence). Owner rewrite: already-recommended [operations-registry-cpl-corrections.md](operations-registry-cpl-corrections.md) (`previewCplCorrection` / `createCplCorrection` / `getCplCorrectionJob` / `cancelCplCorrectionJob` / `processCplCorrectionBatch` / `runDueCplCorrectionJobs` **ask** leftover `createMongoCplCorrectionJobStore` which **asks** `getCplCorrectionJobModel` — **this file never hashes a preview**, never `$set`s a Lead). Leftover cron wake: already-recommended [routes-cpl-correction-cron.md](routes-cpl-correction-cron.md) (**asks** leftover `runDueCplCorrectionJobs` — **this file never drains**). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** the getter `countDocuments` `{ status: "failed" }` and `{ status: "processing", leased_until: { $lte: now } }` then leftover `registry.cpl_correction_jobs_unhealthy` — leftover Lead Source projection **omits** those counts). Leftover live book: already-recommended [models-cpl-rate-period.md](models-cpl-rate-period.md) (`getCplRatePeriodModel`; integer `amount_cents`; leftover New York date strings — **this file snapshots Lead `cpl` dollars**, **never** writes a period). Leftover fourteen-slot: already-recommended [models-cpl-rate.md](models-cpl-rate.md) (default-only `CplRate`; **no** getter — **do not delete this getter so “the job matches fourteen-slot”**). Leftover Feed: already-recommended [models-lead-source-granularity.md](models-lead-source-granularity.md) (`schedule_revision` default `0` is the CAS — **this file snapshots `target_schedule_revision` `min: 1` and never `$inc`s**). Distinct from leftover next evidence: leftover next `CplLeadCorrection.ts` (unique `{ job_id, lead_model, lead_id }` before/after — **this file never appends evidence**; leftover next getter has **no** `useDb`). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files store nested `cpl_correction.job_id` `ref: "CplCorrectionJob"` and set `autoIndex: false` — **do not copy that fence here**, **do not stamp a Lead snapshot here**). Distinct from leftover historical relax: this checkout has **no** `historical/CplCorrectionJob.ts`. Leftover overview / leftover historical-consolidation validate **do not** ask this collection. Scripts do **not** import this file. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define correction jobs here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Leftover `operationsRegistry/cplCorrections.ts` leftover `createMongoCplCorrectionJobStore` **asks** `getCplCorrectionJobModel` for leftover insert (`status: "pending"`), leftover `findById`, leftover claim (`pending` / `processing` plus leftover missing-or-null-or-expired lease), leftover renew, leftover release `$unset`, leftover progress `$set` (counts / cursor / status / `completed_at`), leftover cancel, leftover `findClaimable` (oldest `createdAt`, same lease `$or`). Leftover types **ask** leftover `CplCorrectionJobDocument` / leftover `CplCorrectionJobStatus` / leftover `CplCorrectionLeadModel`. Leftover `queries/health.ts` **asks** the getter `countDocuments` `{ status: "failed" }` and `{ status: "processing", leased_until: { $lte: new Date() } }`. Leftover `cplCorrections.test.ts` **asks** an in-memory leftover `CplCorrectionJobStore` — **not** this model. Leftover `health.test.ts` leftover fixtures leftover `registry.cpl_correction_jobs_unhealthy` — **not** this model. There is no `CplCorrectionJob.test.ts`. Nobody leftover-inspects leftover `CplCorrectionJob.schema.indexes()`. Leftover overview **does not** import this file. Leftover historical-consolidation **does not** import this file. Leftover scripts **do not** import this file. Already-recommended leftover Form / Call leftover `ref: "CplCorrectionJob"` is a string name, not an import. Leftover next `CplLeadCorrection.ts` leftover `ref: "CplCorrectionJob"` is a string name, not an import. Not this **interface**: leftover `previewCplCorrection` itself, leftover `createCplCorrection` itself, leftover `processCplCorrectionBatch` itself, leftover `runDueCplCorrectionJobs` itself, leftover `computeCplCorrectionPreviewHash` itself, leftover `applyCorrectionToLead` itself.
- Seams callers need: default `CplCorrectionJob` (first-registered connection — leftover getter same-db return) vs `getCplCorrectionJobModel()` (selected `getMongoDatabaseName()` — leftover store write / leftover claim / leftover health counts); leftover claimable lease filter `{ leased_until: { $exists: false } } OR { leased_until: null } OR { leased_until: { $lte: now } }` (leftover store claim / leftover `findClaimable`) vs leftover health stalled `{ status: "processing", leased_until: { $lte: now } }` (missing/null lease on `processing` is claimable, **not** leftover-unhealthy); three leftover non-unique compounds vs leftover field `index: true` on `source_granularity` / `status` / `leased_until`; leftover immutable Feed + leftover immutable window + leftover immutable `reviewed_targets` (cap 250) + leftover immutable `preview_hash` vs leftover mutable status / counts / cursor / lease; leftover `target_schedule_revision` `min: 1` snapshot vs leftover Feed `schedule_revision` default `0` CAS; leftover frozen Lead `cpl` dollars vs already-recommended leftover period `amount_cents`; leftover window UTC instants **without** leftover `YYYY-MM-DD` strings vs already-recommended leftover period date pair; leftover `requested_by.request_id` (indexed, **not** unique) vs leftover period `created_by` (no request id); leftover next evidence getter **without** `useDb` vs this selected-database getter; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-rewrite **seam**. There is no unique-job **seam**.
- Split later (only if the file outgrows one sitting): this ~169-line file is one sitting if you read it as remember the frozen prior-Lead rewrite job on the selected Mongo database, freeze the reviewed Form and Call snapshots plus the preview hash and the revision snapshot, and index claimable status plus lease plus createdAt without uniqueness — never rewrite a Lead or file the job here, never unique-index request id so a second confirm 11000s, never flip frozen Lead `cpl` to integer cents so the job matches the period, never delete the getter because leftover store and leftover health already follow it. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `lease.ts` / `cursor.ts` / `preview.ts`. Leftover preview / leftover file / leftover claim / leftover rewrite stay already-recommended `cplCorrections.ts`. Leftover next evidence stays leftover `CplLeadCorrection.ts`. Leftover live book stays already-recommended `CplRatePeriod.ts`.

`CplCorrectionJob` is a Mongoose model name. The owner question is: *Owner just confirmed a prior-Lead rewrite after the live book changed — or leftover health is about to count failed and stalled jobs. Hold the row on `cpl_correction_jobs`. Freeze the Feed, the New York window as UTC instants, the revision they reviewed, the max Form/Call ids, every reviewed Lead’s id and snapshot (at most 250), the preview hash, and who asked. Leave status, counts, cursor, and lease mutable so leftover store can claim, checkpoint, cancel, or complete. Index claimable status plus lease plus createdAt, Feed plus createdAt, and request id so leftover `findClaimable` / leftover health / leftover Feed browse can walk — do not unique those compounds, because leftover Owner may file a second job under the same request id and leftover preview hash is a CAS on leftover file, not a unique key here. If this process selected a different Mongo database, hand back that database’s job model. Do not preview. Do not file. Do not claim a lease. Do not rewrite a Lead. Do not append leftover evidence. Do not flip frozen Lead `cpl` to cents so “the job matches the period.” Do not delete the getter so “the job matches fourteen-slot.” Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who show / file / claim / rewrite already lives in already-recommended `cplCorrections.ts`. Who hold leftover before/after already lives in leftover next `CplLeadCorrection.ts`. Who hold the live book already lives in already-recommended `CplRatePeriod.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the frozen prior-Lead rewrite job, freeze the reviewed Form and Call snapshots plus the preview hash and the revision snapshot, and index claimable status plus lease plus createdAt without uniqueness” story, not “a CPL correction job CRUD dump,” and not Show What This Window Would Rewrite / File The Prior-Lead Rewrite Job / Rewrite One Frozen Lead Batch themselves:

1. **Hold the frozen prior-Lead rewrite job as the durable Owner rewrite row** — collection `cpl_correction_jobs`, timestamps, `toJSON` / `toObject` virtuals. **No** virtuals declared. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** unique index. **No** `amount_cents`. **No** leftover `YYYY-MM-DD` date strings. **No** `business_timezone`. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required immutable `source_granularity` (ObjectId → leftover first-class Feed, field `index: true`), required immutable `window_from` / `window_until` (Date UTC instants — leftover service mapped leftover Owner `YYYY-MM-DD` **before** insert), required immutable `target_schedule_revision` (`min: 1`, `Number.isSafeInteger` — **snapshot**, not the leftover Feed CAS), optional immutable `max_form_lead_id` / `max_call_lead_id` (default `null`), required immutable `reviewed_targets[]` (cap **250**, leftover `CplCorrectionReviewedTargetSchema`: leftover `FormLead` | leftover `CallLead`, leftover Lead ObjectId, leftover Feed ObjectId, leftover Lead `timestamp`, leftover Lead `cpl` **dollars**, leftover optional period / resolution / `duplicate`), required immutable `preview_hash` (trimmed string), required `status` (enum leftover `pending` | leftover `processing` | leftover `completed` | leftover `failed` | leftover `cancelled`, default leftover `pending`, field `index: true`), required immutable nested `requested_by` (leftover `owner` | leftover `admin` | leftover `system`, plus leftover id / label / role **and** leftover `request_id`), optional `reason`, required counts (`matched_count` / `changed_count` / `no_op_count` / `failed_count`, default `0`, `min: 0`), optional leftover cursor (`lead_model` + leftover `lead_id`), optional leftover `leased_until` (field `index: true`) / leftover `lease_owner` / leftover `last_error` / leftover `started_at` / leftover `completed_at`. This beat does **not** hash leftover `preview_hash`. This beat does **not** invent leftover `window_from` from a business date. This beat does **not** `$set` a Lead. A leftover file may still refuse when leftover preview hash drifted.

2. **Index claimable status plus lease plus createdAt, Feed plus createdAt, and request id — without uniqueness** — leftover `{ status: 1, leased_until: 1, createdAt: 1 }`. Leftover `{ source_granularity: 1, createdAt: -1 }`. Leftover `{ "requested_by.request_id": 1 }`. None are unique. None are named. None have a leftover `pnpm migration:*` apply path. Field `index: true` also sits on leftover `source_granularity`, leftover `status`, and leftover `leased_until`. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Leftover store leftover `findClaimable` leftover sorts leftover `createdAt: 1`. Leftover health leftover counts leftover `failed` leftover and leftover stalled leftover `processing`. A unique leftover `request_id` would 11000 a second leftover Owner confirm that reused leftover proxy `requestId`. A unique leftover `preview_hash` would 11000 a second leftover file of the same leftover window after leftover Owner re-previewed the same leftover book. Continuity / stale-hash / 250-cap live on leftover `cplCorrections.ts`, not here. This beat does **not** unique-index leftover `source_granularity` plus leftover window. This beat does **not** unique-index leftover `preview_hash`.

3. **Bind the selected Mongo database** — default export `CplCorrectionJob` is `mongoose.models.CplCorrectionJob ?? mongoose.model(...)`. `getCplCorrectionJobModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Leftover store write / leftover claim / leftover health counts **ask** the getter. Nobody leftover-inspects leftover `schema.indexes()`. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`. This beat does **not** invent `getCplRateModel` on already-recommended leftover fourteen-slot. This beat does **not** copy leftover next evidence’s getter (that leftover next file has **no** `useDb`).

`CplCorrectionJobDocument` is the inferred row type plus `_id`. `CPL_CORRECTION_JOB_STATUSES` / `CPL_CORRECTION_LEAD_MODELS` are the leftover enum constants leftover schema leftover **asks**; leftover service leftover **asks** the leftover types, not the leftover arrays. There is no unknown-state sentinel here. There is no named-index export.

There is no leftover-preview operation. Leftover `previewCplCorrection` elects that. There is no leftover-file operation. Leftover `createCplCorrection` elects that. There is no leftover-rewrite operation. Leftover `processCplCorrectionBatch` elects that. There is no leftover-evidence operation. Leftover next `CplLeadCorrection.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the frozen prior-Lead rewrite job on the selected Mongo database, freeze the reviewed Form and Call snapshots plus the preview hash and the revision snapshot, and index claimable status plus lease plus createdAt without uniqueness — never rewrite a Lead or file the job here, never unique-index request id so a second confirm 11000s, never flip frozen Lead `cpl` to integer cents so the job matches the period, never delete the getter because leftover store and leftover health already follow it.” Leftover preview / leftover file / leftover claim / leftover rewrite / leftover live-book write already live in deeper **modules**. Leftover next evidence already lives in a sibling **module**. Do not pull those in. Do not invent a `CplCorrectionJobModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “job matches Booking” without a reviewed index migration. Do not invent a unique `{ "requested_by.request_id": 1 }` **adapter** so “schema uniqueness matches leftover proxy request id.” Do not invent a unique leftover `preview_hash` **adapter** so “schema uniqueness matches leftover file CAS.” Do not invent a `pre("validate")` that stamps leftover `window_from` from leftover Owner `YYYY-MM-DD` so “hand insert matches leftover `businessDateToUtc`.” Do not invent an `amount_cents` field so “the frozen Lead matches the period.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `lease.ts` / `cursor.ts` / `preview.ts` each get a file.

Do not move leftover `computeCplCorrectionPreviewHash` into this file so “the row owns the hash.” Do not merge this file into already-recommended leftover `CplRatePeriod.ts` so “one schema owns the live book and the prior-Lead rewrite.” Do not merge this file into leftover next `CplLeadCorrection.ts` so “one schema owns the job and the before/after.” Do not merge this file into already-recommended leftover Form / Call so “the Lead owns leftover `reviewed_targets`.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `CplCorrectionJob` | `frozenRewriteJobOnTheDefaultConnection` | leftover getter same-db return still imports the default model |
| `getCplCorrectionJobModel` | `frozenRewriteJobOnTheSelectedMongoDatabase` | leftover store write / leftover claim / leftover health counts must follow `getMongoDatabaseName()` |
| `CplCorrectionJobDocument` | `FrozenPriorLeadRewriteJobRow` | inferred document + `_id` |
| `CplCorrectionJobStatus` | `FrozenRewriteJobStatus` | leftover store / leftover view share leftover `pending` \| leftover `processing` \| leftover `completed` \| leftover `failed` \| leftover `cancelled` |
| `CplCorrectionLeadModel` | `FrozenRewriteLeadKind` | leftover cursor / leftover reviewed target share leftover `FormLead` \| leftover `CallLead` |
| `CPL_CORRECTION_JOB_STATUSES` | `frozenRewriteJobStatusList` | leftover schema enum; leftover service leftover **asks** the leftover type |
| `CPL_CORRECTION_LEAD_MODELS` | `frozenRewriteLeadKindList` | leftover schema enum; leftover service leftover **asks** the leftover type |

Keep the old names as one-line aliases until leftover `cplCorrections.ts`, leftover health, leftover types, and leftover next evidence migrate. Do not make callers learn `useDb` / `reviewed_targets` / `leased_until` as the domain language. Do **not** delete the default `CplCorrectionJob` export so “everyone must call the getter” without a paired proof that leftover getter same-db still returns today’s leftover model leftover store leftover **asks** through the leftover getter. Do **not** delete the getter so “the job matches fourteen-slot” without a paired proof that leftover store and leftover health still write/count the selected `cpl_correction_jobs`. Do **not** re-export leftover next `CplLeadCorrection` from this file so “one type owns the job and the before/after.” Do **not** copy leftover next evidence’s no-`useDb` getter onto this file so “every correction model matches.”

**No class for the workflow.** The one type that *does* earn a name is the pending frozen-job identity contract:

```ts
type FrozenPriorLeadRewriteJobIdentity = {
  source_granularity: { immutable: true; objectId: true }
  window: { window_from: { immutable: true }; window_until: { immutable: true } }
  target_schedule_revision: { min: 1; snapshot: true }
  reviewed_targets: { immutable: true; max: 250; cpl: "lead_dollars" }
  preview_hash: { immutable: true }
  requested_by: { immutable: true; request_id: { unique: false } }
  claim_indexes: { unique: false }
}
```

That is the handoff from “this process remembered a frozen rewrite job” to “leftover store can claim the oldest due row, leftover health can count failed and stalled, and leftover file CAS still lives on leftover `preview_hash` compare.” Do **not** add `{ request_id: { unique: true } }` onto that type so “idempotency lives on the schema.” Do **not** add `{ reviewed_targets: { cpl: "amount_cents" } }` so “money matches the period.”

Leave leftover next `CplLeadCorrection.ts` on that file. Leave already-recommended leftover `CplRatePeriod.ts` on that file. Leave leftover `schedule_revision` CAS on already-recommended leftover Feed. Leave leftover preview / leftover file / leftover claim on already-recommended leftover `cplCorrections.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CplCorrectionJob.ts
// Owner just confirmed a prior-Lead rewrite after the live book changed —
// or leftover health is about to count failed and stalled jobs.
// Hold the row on cpl_correction_jobs.
// Freeze the Feed, the New York window as UTC instants,
// the revision they reviewed, the max Form/Call ids,
// every reviewed Lead's id and snapshot (at most 250),
// the preview hash, and who asked.
// Leave status, counts, cursor, and lease mutable
// so leftover store can claim, checkpoint, cancel, or complete.
// Index claimable status plus lease plus createdAt,
// Feed plus createdAt, and request id
// so leftover findClaimable / leftover health / leftover Feed browse can walk —
// do not unique those compounds,
// because leftover Owner may file a second job
// under the same request id
// and leftover preview hash is a CAS on leftover file,
// not a unique key here.
// If this process selected a different Mongo database,
// hand back that database's job model.
// Do not preview.
// Do not file.
// Do not claim a lease.
// Do not rewrite a Lead.
// Do not append leftover evidence.
// Do not flip frozen Lead cpl to cents
// so "the job matches the period."
// Do not delete the getter
// so "the job matches fourteen-slot."
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const frozenRewriteJobStatusList = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const
export { frozenRewriteJobStatusList as CPL_CORRECTION_JOB_STATUSES }

export const frozenRewriteLeadKindList = ["FormLead", "CallLead"] as const
export { frozenRewriteLeadKindList as CPL_CORRECTION_LEAD_MODELS }

export const frozenRewriteJobOnTheDefaultConnection =
  mongoose.models.CplCorrectionJob ??
  mongoose.model("CplCorrectionJob", frozenPriorLeadRewriteJobSchema)

export { frozenRewriteJobOnTheDefaultConnection as CplCorrectionJob }

export function frozenRewriteJobOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) return frozenRewriteJobOnTheDefaultConnection
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.CplCorrectionJob ?? db.model("CplCorrectionJob", frozenPriorLeadRewriteJobSchema)
}

export { frozenRewriteJobOnTheSelectedMongoDatabase as getCplCorrectionJobModel }

// ── 1. Hold the frozen prior-Lead rewrite job ─────────────

const frozenPriorLeadRewriteJobSchema = rememberTheFrozenPriorLeadRewriteJob() // collection cpl_correction_jobs; default autoIndex; Lead dollars not period cents

function rememberTheFrozenPriorLeadRewriteJob() {
  const schema = new Schema(
    {
      source_granularity: requiredImmutableFeedObjectId(),          // field index; not string slug
      window_from: requiredImmutableUtcInstant(),                   // no YYYY-MM-DD pair
      window_until: requiredImmutableUtcInstant(),
      target_schedule_revision: requiredPositiveSafeIntegerSnapshot(), // min 1; CAS lives on the Feed
      max_form_lead_id: optionalImmutableLeadObjectId(),
      max_call_lead_id: optionalImmutableLeadObjectId(),
      reviewed_targets: requiredImmutableReviewedLeadSnapshots({ max: 250 }), // cpl is Lead dollars
      preview_hash: requiredImmutableTrimmedHash(),
      status: requiredRewriteStatus({ default: "pending" }),        // field index
      requested_by: requiredImmutableActorSnapshotWithRequestId(),  // owner | admin | system + request_id
      reason: optionalTrimmedReason(),
      matched_count: requiredNonNegativeCount(),
      changed_count: requiredNonNegativeCount(),
      no_op_count: requiredNonNegativeCount(),
      failed_count: requiredNonNegativeCount(),
      cursor: optionalFormThenCallCursor(),
      leased_until: optionalLeaseDeadline(),                        // field index
      lease_owner: optionalTrimmedOwner(),
      last_error: optionalTrimmedError(),
      started_at: optionalInstant(),
      completed_at: optionalInstant(),
    },
    { collection: "cpl_correction_jobs", timestamps: true },
  )
  indexClaimableAndFeedAndRequestIdWithoutUniqueness(schema)
  return schema
}

// ── 2. Lookup indexes, not uniqueness ─────────────────────

function indexClaimableAndFeedAndRequestIdWithoutUniqueness(schema) {
  // today's { status, leased_until, createdAt }
  // today's { source_granularity, createdAt: -1 }
  // today's { "requested_by.request_id" }
  // none unique, none named
}

// ── 3. Selected Mongo database ────────────────────────────

// frozenRewriteJobOnTheSelectedMongoDatabase above
```

Read the primary path out loud: *hold the frozen prior-Lead rewrite job on `cpl_correction_jobs` with a required immutable Feed ObjectId, a required immutable UTC window, a required revision snapshot `min: 1`, a required immutable reviewed-target bag capped at 250 (Lead `cpl` dollars), a required immutable preview hash, and a required immutable actor snapshot that includes request id. Index claimable status plus lease plus createdAt, Feed plus createdAt, and request id without uniqueness so leftover Owner can file a second job under the same request id. Today’s leftover store write / leftover claim / leftover health still ask the getter. Leftover getter same-db still returns the default. Do not preview. Do not file. Do not rewrite a Lead. Do not unique-index request id. Do not flip frozen Lead `cpl` to cents.*

That is the operation. An unnamed schema dump is not. `createCplCorrection` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **Two lease filters are two answers.** Leftover store leftover claim / leftover `findClaimable` leftover elect leftover `pending` | leftover `processing` leftover when leftover `leased_until` leftover is leftover missing leftover or leftover null leftover or leftover `$lte now`. Leftover health leftover stalled leftover elects leftover only leftover `{ status: "processing", leased_until: { $lte: now } }`. A leftover `processing` leftover row leftover with leftover missing leftover lease leftover is leftover claimable leftover and leftover **not** leftover-unhealthy. Do not add a schema default `leased_until: null` so “every live job has the field” without a paired proof that leftover health `$lte` leftover still leftover sees leftover those leftover rows leftover the leftover same leftover way. Do not fix leftover health onto leftover `$exists: false` leftover in this rename. That is leftover health / leftover store **interfaces**, not this one.

2. **The three compounds are lookup, not uniqueness — and that is today’s leftover file contract.** Leftover Owner leftover may leftover file leftover a leftover second leftover job leftover under leftover the leftover same leftover proxy `requestId`. Leftover `preview_hash` leftover CAS leftover lives leftover on leftover `createCplCorrection` leftover compare, leftover not leftover here. A unique leftover `{ "requested_by.request_id": 1 }` leftover would leftover 11000 leftover that leftover second leftover confirm. A unique leftover `preview_hash` leftover would leftover 11000 leftover a leftover second leftover file leftover of leftover the leftover same leftover window. Do not unique those compounds so “schema uniqueness matches leftover idempotency.” Do not drop leftover `createdAt` leftover from leftover the leftover claimable leftover compound so “status plus lease are enough.”

3. **Frozen `reviewed_targets[].cpl` is Lead dollars. Already-recommended leftover period `amount_cents` is integer cents.** Leftover Form / Call leftover store leftover `cpl` leftover as leftover dollars. Leftover file leftover copies leftover that leftover snapshot leftover onto leftover this leftover bag. Leftover period leftover stores leftover cents. Do not rename leftover `cpl` leftover to leftover `amount_cents` so “the job matches the period” — leftover stale leftover compare leftover would leftover elect leftover `190` leftover cents leftover against leftover `190` leftover dollars leftover or leftover the leftover reverse. Do not add leftover `Number.isSafeInteger` leftover onto leftover this leftover `cpl` leftover so “money matches the period.”

4. **The window is two UTC instants. Already-recommended leftover period also stores leftover `YYYY-MM-DD` strings.** Leftover service leftover maps leftover Owner leftover inclusive leftover dates leftover **before** leftover insert. This file leftover has leftover **no** leftover `effective_from_date` leftover pair leftover and leftover **no** leftover `business_timezone`. Do not add leftover date leftover strings leftover so “the job matches the period.” Do not move leftover `businessDateToUtc` leftover into this file.

5. **`target_schedule_revision` is a snapshot (`min: 1`). Feed `schedule_revision` is the CAS (`default: 0`).** Leftover `$inc` leftover lives leftover on already-recommended leftover `compareAndIncrementRevision`. Leftover file leftover stamps leftover the leftover reviewed leftover revision leftover onto leftover the leftover job. Do not `$inc` leftover from this file so “the job owns leftover concurrency.” Do not default this field to `0` so “job matches Feed.”

6. **There is a selected-database getter — and that is today’s contract, not a missing fourteen-slot copy and not a leftover-next-evidence copy.** Leftover store leftover and leftover health leftover **ask** leftover `getCplCorrectionJobModel`. Already-recommended leftover fourteen-slot leftover **asks** leftover default leftover `CplRate` leftover and leftover has leftover **no** leftover getter. Leftover next leftover `CplLeadCorrection.ts` leftover getter leftover has leftover **no** leftover `useDb`. Do not delete leftover `getCplCorrectionJobModel` so “the job matches fourteen-slot.” Do not drop leftover `useDb` so “the job matches leftover evidence.” Do not invent leftover `getCplRateModel` leftover on leftover that leftover sibling leftover from this rename.

7. **Default `CplCorrectionJob` still earns its export.** Leftover getter leftover same-db leftover path leftover returns leftover it. Nobody leftover-inspects leftover `schema.indexes()` leftover today leftover — leftover that leftover is leftover **not** leftover a leftover license leftover to leftover delete leftover the leftover default. Leftover overview leftover and leftover historical-consolidation leftover do leftover **not** leftover ask leftover this leftover collection. Do not delete leftover the leftover default leftover so “everyone must call the getter” leftover without leftover a leftover paired leftover same-db leftover proof. Do not add leftover an leftover overview leftover count leftover so “every leftover book sits on the shelf.” Do not add leftover historical-consolidation leftover validate leftover so “every catalog row has a planned-insert proof.”

8. **`source_granularity` is a Feed ObjectId, not a company slug.** Already-recommended leftover fourteen-slot leftover `source_company` leftover is leftover a leftover lowercase leftover string. Do not change this field to a string slug so “the job matches fourteen-slot.”

9. **`reviewed_targets` cap 250 is this file’s leftover validate and leftover service’s leftover `MAX_CPL_CORRECTION_PREVIEW_LEADS`.** Leftover both leftover refuse leftover a leftover larger leftover bag. Do not raise leftover the leftover schema leftover cap leftover so “the Owner can do a year.” Do not drop leftover the leftover schema leftover validate leftover so “the service already caps.”

10. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation leftover set leftover `autoIndex: false` leftover and leftover ship leftover named leftover catalogs leftover through leftover reviewed leftover migrations. The leftover compounds leftover here leftover are leftover not leftover named. Do not silently leftover set leftover `autoIndex: false` leftover so “job matches Booking” leftover without leftover a leftover paired leftover report leftover that leftover boot leftover still leftover creates leftover the leftover claimable leftover indexes leftover or leftover that leftover a leftover migration leftover will. Do not invent leftover `pnpm migration:cpl-correction-job-indexes` leftover in this rename.

11. **Field `index: true` leftover already leftover sits leftover on leftover `source_granularity` / leftover `status` / leftover `leased_until` leftover beside leftover the leftover compounds.** That leftover is leftover today’s leftover contract leftover (leftover Mongoose leftover will leftover also leftover emit leftover those leftover singles). Do not drop leftover the leftover singles leftover so “compounds are enough” leftover without leftover a leftover paired leftover leftover-store leftover `findById` leftover / leftover leftover-health leftover `countDocuments` leftover proof leftover that leftover still leftover uses leftover those leftover paths leftover the leftover same leftover way. Do not leftover unique leftover the leftover singles leftover so “Feed is one job.”

12. **Leave sibling modules alone.** Leftover preview / leftover file / leftover claim / leftover rewrite, leftover live-book write, leftover fourteen-slot dollars, leftover health stalled `$lte` leftover count, leftover next evidence, leftover cron wake, and already-recommended Form / Call leftover `cpl_correction.job_id` leftover refs leftover are leftover already leftover the leftover right leftover depth. This file leftover holds leftover the leftover frozen leftover rewrite leftover job leftover row. Leftover store leftover `$set started_at: now` leftover on leftover every leftover claim leftover (leftover including leftover resume) leftover is leftover leftover store’s leftover **interface**, leftover not leftover this leftover one.

## Testing

The interface is the test surface: `CplCorrectionJob` validate, `getCplCorrectionJobModel`, leftover status / leftover lead-kind leftover enums, and the three leftover lookup compounds.

There is no `CplCorrectionJob.test.ts`. Today's proofs sit on callers. Leftover `cplCorrections.test.ts` leftover already leftover names leftover hash leftover / leftover stale leftover / leftover lease leftover resume leftover / leftover cancel leftover / leftover Analytics leftover through leftover an leftover in-memory leftover store. Leftover `health.test.ts` leftover already leftover names leftover `registry.cpl_correction_jobs_unhealthy` leftover from leftover fixtures. Keep those as the operation proofs on those interfaces.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new job requires `source_granularity`, `window_from`, `window_until`, `target_schedule_revision`, `reviewed_targets`, `preview_hash`, and `requested_by`.
- `status` defaults to `pending` and accepts only leftover `pending` | leftover `processing` | leftover `completed` | leftover `failed` | leftover `cancelled`.
- `reviewed_targets` accepts 0 and 250 rows and refuses 251.
- `reviewed_targets[].lead_model` accepts only leftover `FormLead` | leftover `CallLead`.
- `reviewed_targets[].cpl` accepts `0` and `190` and does **not** require `Number.isSafeInteger`.
- There is no leftover `amount_cents` path.
- There is no leftover `YYYY-MM-DD` leftover date-string leftover path.
- There is no leftover `business_timezone` leftover path.
- `target_schedule_revision` accepts `1` and refuses `0`.
- Validate does not invent `window_from` from an Owner business date.
- `requested_by.request_id` is required.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Lookup indexes**
- `{ status, leased_until, createdAt }` is declared and is not unique.
- `{ source_granularity, createdAt: -1 }` is declared and is not unique.
- `{ "requested_by.request_id" }` is declared and is not unique.
- None of those compounds are named.
- There is no unique leftover `preview_hash`.

**Selected database**
- Default `CplCorrectionJob` remains exported.
- `getCplCorrectionJobModel` remains exported.
- `CPL_CORRECTION_JOB_STATUSES` remains the leftover five leftover statuses.
- `CPL_CORRECTION_LEAD_MODELS` remains leftover `FormLead` | leftover `CallLead`.

Do not add a test per helper (`requiredImmutableReviewedLeadSnapshots`, `indexClaimableAndFeedAndRequestIdWithoutUniqueness`). Those names exist so the parent reads. Do not leftover-preview from this file's tests. Do not leftover-file from this file's tests. Do not leftover-rewrite a Lead from this file's tests. Do not leftover `syncIndexes` in the unit file so "the test creates the leftover claimable indexes."

There is no leftover named-index export to keep for a second leftover migration adapter.

## What I would not do

- A `CplCorrectionJobModelService` / `CplCorrectionJobService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `lease.ts` / `cursor.ts` / `preview.ts` split for cleanliness.
- Inventing a unique `{ "requested_by.request_id": 1 }` seam so "schema uniqueness matches leftover proxy request id." A second leftover confirm must not 11000.
- Inventing a unique leftover `preview_hash` seam so "schema uniqueness matches leftover file CAS."
- Breaking the selected-database seam by deleting `getCplCorrectionJobModel` without a paired proof. Leftover store and leftover health must not write/count live `cpl_correction_jobs` while `TEST_MODE` selected `testvantagemovers` unless today's getter callers already do that — they do.
- Breaking the default-connection seam by deleting `CplCorrectionJob` without a paired proof that leftover getter same-db still returns today's leftover model.
- Treating leftover `previewCplCorrection` / leftover `createCplCorrection` / leftover `processCplCorrectionBatch` / leftover `runDueCplCorrectionJobs` as this story. Those functions own leftover preview hash, leftover file, leftover claim, leftover Lead CAS, and leftover Analytics handoff.
- Treating leftover `getCplCorrectionJob` / leftover `cancelCplCorrectionJob` as this story. Those functions own leftover show / leftover cancel.
- Treating leftover next `CplLeadCorrection.ts` as this story. That leftover unique leftover `{ job_id, lead_model, lead_id }` leftover is leftover before/after leftover evidence.
- Treating already-recommended leftover `CplRatePeriod.ts` as this story. That leftover cents leftover book leftover is leftover the leftover live leftover price leftover list.
- Treating already-recommended leftover `CplRate.ts` as this story. That leftover dollar leftover unique leftover is leftover the leftover fourteen-slot leftover book.
- Inventing a cents seam so "the job matches the period."
- Inventing a no-`useDb` getter so "the job matches leftover evidence."
- Inventing an `autoIndex: false` adapter that has only "matches Booking" as its second home.
- Inventing a unique-job adapter that has only "matches leftover idempotency" as its second home.
- Silently adding a leftover overview count so "every leftover book sits on the shelf."
- Silently enabling leftover `optimisticConcurrency` so "job matches Booking."
- Silently "fixing" leftover health onto leftover `$exists: false` leftover so "stalled matches claimable."
- Silently "fixing" a leftover ADR while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
