# Remember The Sheet Sync In The Same Write, Then After Commit Wake The Drain Or Run The Old Background Refresh — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 1 of this service — `sheetSyncCoordinator.ts`
- Remaining in this service: `sheetSyncOutbox.service.ts`, `sheetSyncQueue.service.ts`, `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts` (`sheetSyncJobs.ts` / `index.ts` / `drainer/types.ts` / `drainer/index.ts` / `drainer/leases.ts` skipped on open)
- Target: `src/services/sheetSync/sheetSyncCoordinator.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (mode-aware scheduling; Mongo is System of Record; sheets update after the API response). Distinct from later outbox coalesce / tombstone: `sheetSyncOutbox.service.ts`. Distinct from later wake-up publish gate: `sheetSyncQueue.service.ts`. Distinct from later `sheet_sync[]` merge-and-save: `sheetSyncPersistence.ts`. Distinct from later lookup-then-write (legacy path this file only dispatches to): `sheetSyncSourceLookup.ts`. Distinct from later drain / plan / batch / quota: `drainer/`. Distinct from Google Sheets tabs / projections / dual Source Company writes: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Distinct from Form Lead remember-then-dispatch (that file calls this **seam**; it does not own mode): [recommendations/form-lead.md](form-lead.md). Distinct from Lead Messaging persist + send-or-wake: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from admin retry / health (starts drain, does not publish): later Wave A `admin`. This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already flags Granot / RingCentral `enqueueSheetSyncJob` (mode-blind) as a labeled gap; do not “fix” that in this rename.
- Callers: **migrated persist + finalize via the barrel, plus two unmigrated schedule sites, plus the labeled gap.** Public writes: `leads/formLead.service.ts` / `callLead.service.ts`, `bookings/bookedLead.service.ts` / `referralBooking.service.ts` / `leadlessBooking.service.ts`, `cancellations/cancelledLead.service.ts`, `enrichment/callLeadEnrichment.service.ts`, `employeeBookings/` submit / rematch / recon — `runSheetSyncWrite` + `persistSheetSyncIntent` inside the write, `finalizeSheetSync` / `finalizeSheetSyncDelete` after commit. Canonical adapters: `domainCommands/existingWrites.ts` and `domainCommands/bookings.ts` persist inside the executor txn and pass `finalizeSheetSync` as the post-commit finalizer; a no-op / replay writes no outbox and does not finalize. Granot Owner Booking / Release / Referral persist + finalize the same way (checked-in effect flags stay false). Unmigrated: `v1.service.ts` re-exports the three `schedule*` wrappers; `reconciliation/bookedCallLeadReconciliation.service.ts` still calls `scheduleBookingChainSheetSync` / `scheduleCallLeadSheetSync`. Labeled gap (do not silently reroute): `granotLifecycle/createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, and `ringcentral/callLeadConvergence.service.ts` call `enqueueSheetSyncJob` then `finalizeSheetSync`. Barrel: `sheetSync/index.ts`. Test: `sheetSyncOutbox.service.test.ts` (persist is queued-only). `domainCommands.test.ts` asserts command adapters do not call `runSheetSyncWrite`. Not this **interface**: cron / queue consumer (`runSheetSyncDrain`), admin retry, later outbox / queue / lookup / persist siblings, `googleSheets/` writes.
- Seams callers need: persist (inside the Mongo write) vs finalize (after commit); public `runSheetSyncWrite` vs executor-owned txn (commands must not open a second transaction); upsert finalize vs delete-tombstone finalize; migrated persist+finalize vs unmigrated `schedule*`; queued (outbox + wake-up) vs legacy (`waitUntil` refresh now) vs disabled (log only); `forceTransaction` is Form Lead messaging / WordPress receipt, not a Sheet Sync decision
- Split later (only if the file outgrows one sitting): `holdTheDomainWriteForSheetSync.ts` / `rememberTheSheetSyncIntent.ts` / `afterCommitTellTheSheets.ts` / `scheduleTheUnmigratedSheetSync.ts` / `refreshTheSheetsNow.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `schedule.ts`, and never merge outbox coalesce, queue publish, source lookup, drain, or Google Sheets projections into this file

`persistSheetSyncIntent` / `finalizeSheetSync` / `runSheetSyncWrite` are executor mechanics. The owner question is: *The Lead (or Booking, or Cancellation) is already being saved. If we are using the durable outbox, write the sheet-sync job in the same Mongo transaction so we cannot forget. After that transaction commits, either wake the drain or — if we are still on the old path — kick the background sheet refresh. Never talk to Google Sheets inside the transaction. A successful API response does not mean the sheets are updated yet. If sheets are turned off, just say so in the log.*

Outbox coalesce, queue publish, source lookup, drain, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “remember the sheet sync in the same write, then after commit tell the sheets” story, not “a sheet-sync CRUD service,” and not the outbox / drain / Google write:

1. **Hold the domain write so the outbox can ride along** — `runSheetSyncWrite`. Queued mode, or `forceTransaction: true`, opens a real Mongo transaction and passes the session into `fn`. Legacy / disabled connects and calls `fn(undefined)` so the default path does not change. Callers must keep Google Sheets, queue publish, CRM, and email **out** of `fn`. `forceTransaction` exists for Form Lead confirmation SMS and the authorized WordPress receipt — it is not “always persist an outbox job.”

2. **Remember the sheet-sync intent** — `persistSheetSyncIntent`. Queued only: ask the later outbox sibling to enqueue this `FullSheetSyncJob` on the caller’s session (`createdBy: "api"`). Legacy / disabled is a no-op; those modes wait for operation 3. This beat does not publish. This beat does not write a sheet row.

3. **After commit, tell the sheets** — `finalizeSheetSync`. Disabled: log `${operation}.sheet_sync.disabled`. Queued: publish a `domain_write` wake-up (later queue sibling; never throws). Legacy: fall through to operation 5. The durable job, if any, is already committed. A replay / no-op command must not call this.

4. **After a delete tombstone commits, wake the drain** — `finalizeSheetSyncDelete`. Queued: publish a `domain_delete` wake-up. Legacy / disabled is a no-op — those modes delete the sheet row inline in the domain service, not through the outbox. This beat does not accept a job. This beat does not enqueue. Tombstone itself is the later outbox sibling, and it must run **before** the hard Mongo delete.

5. **Schedule the unmigrated path** — `scheduleFullSheetSyncProcess` plus three job-shape wrappers (`scheduleCallLeadSheetSync`, `scheduleBookingChainSheetSync`, `scheduleBookedLeadSheetSync`). Disabled: log and return. Queued: `waitUntil(enqueue + publish)` — **not** inside the caller’s domain transaction; knowledge already calls this the unmigrated fallback. Legacy: `waitUntil(refresh now)`. Log shapes stay `${operation}.sheet_sync.{disabled,queued,scheduled,enqueue_failed,failed}` so existing searches keep working. Enrichment / booked-call-lead recon and the `v1.service` facade still live here.

6. **Refresh the sheets now** — `runFullSheetSyncProcess`. Connect Mongo, then dispatch on `job.resource` to the later source-lookup sibling (`source_lead` / `booked_lead` / `booking_chain` / `cancellation_chain`). Tests, scripts, and the legacy `waitUntil` path await this. This beat does not write the outbox. This beat does not publish.

There is no seventh mutate operation. Coalesce keys, tombstone supersede, quota, and tab routing are other files.

## Organization

Keep one file as the screenplay for “remember the sheet sync in the same write, then after commit wake the drain or run the old background refresh.” Outbox, queue, lookup, persist-on-document, and drain already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncService` class. Do not invent a second begin / complete **seam** beside persist / finalize — canonical commands already own the transaction; this file is the remember / after-commit story inside that **seam**. Do not invent a second queue **adapter** beside later `publishSheetSyncWakeup`. Do not invent a second outbox **adapter** beside later `enqueueSheetSyncJob`. Do not invent a drain **adapter** here.

Do not move persist into `formLead.service.ts` so “ingestion owns sheets.” Do not move finalize into the executor so “one command owns every side effect.” Do not move `runFullSheetSyncProcess` into `googleSheets/` so “one write folder.” Do not split `create.ts` / `update.ts` / `delete.ts`. Do not silently enqueue from finalize. Do not silently publish from persist. Do not silently route Granot / RingCentral through persist.

**External interface** stays small (this is the test surface). Hold, remember, after-commit tell, after-commit delete wake, unmigrated schedule, and refresh-now are one story’s Sheet Sync scheduling, not six CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runSheetSyncWrite` | `holdTheDomainWriteForSheetSync` | public / legacy services that still own their own write; queued or `forceTransaction` opens the txn |
| `persistSheetSyncIntent` | `rememberTheSheetSyncIntent` | inside the write; queued only |
| `finalizeSheetSync` | `afterCommitTellTheSheets` | after commit; wake-up or legacy schedule |
| `finalizeSheetSyncDelete` | `afterCommitWakeTheDrainForTheDelete` | after a committed tombstone; queued only |
| `scheduleFullSheetSyncProcess` | `scheduleTheUnmigratedSheetSync` | callers that never learned persist + finalize |
| `scheduleCallLeadSheetSync` | `askForACallLeadRowRefresh` | enrichment / recon job-shape **adapter** |
| `scheduleBookingChainSheetSync` | `askForABookingChainRefresh` | booked-call-lead recon job-shape **adapter** |
| `scheduleBookedLeadSheetSync` | `askForABookedRowOnlyRefresh` | referral / leadless “no source row” job-shape **adapter** |
| `runFullSheetSyncProcess` | `refreshTheSheetsNow` | legacy `waitUntil`, tests, scripts |

Keep the old names as one-line aliases until Form Lead / Call Lead / Booking / Cancellation / enrichment / employee bookings / canonical adapters / the `v1.service` facade migrate. Do not make callers learn `waitUntil` / `SHEET_SYNC_MODE` / `enqueueAndPublish` as the domain language.

**Principle: old exports stay as aliases.** `persistSheetSyncIntent` and `finalizeSheetSync` remain the imported names until public writes and `existingWrites` point at the story names.

**No class for the workflow.** The type that *does* earn a name is the in-memory job the write already built and the after-commit beat still needs:

```ts
type SheetSyncRememberedJob = FullSheetSyncJob
```

That is the handoff from “we remembered (or skipped) the outbox row” to “after commit, tell the sheets.” Do **not** add `published: true` so “finalize can prove the queue,” do **not** add `sheet_sync[]` so “the coordinator owns the row hint,” and do **not** add `tombstone` so “one job owns delete.” Delete is a different outbox shape (`enqueueSheetSyncTombstone`), not a `FullSheetSyncJob`.

`forceTransaction` stays an option on hold-the-write. It is not a public operation.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheetSyncCoordinator.ts
// The Lead (or Booking, or Cancellation) is already being saved.
// Remember that the sheets still need to hear about it.
// After commit, wake the drain or run the old background refresh.
// Never talk to Google Sheets inside the Mongo write.

// ── 1. Hold the domain write ──────────────────────────────

export async function holdTheDomainWriteForSheetSync(fn, options)
  // queued or forceTransaction → withTransaction(fn)
  // else connect and fn(undefined)

// ── 2. Remember the sheet-sync intent ─────────────────────

export async function rememberTheSheetSyncIntent(job, session)
  // queued → later enqueueSheetSyncJob(job, { session, createdBy: "api" })
  // legacy / disabled → return

// ── 3. After commit, tell the sheets ──────────────────────

export async function afterCommitTellTheSheets(job)
  // disabled → log
  // queued → later publishSheetSyncWakeup({ reason: "domain_write" })
  // legacy → scheduleTheUnmigratedSheetSync(job)

export async function afterCommitWakeTheDrainForTheDelete()
  // queued → later publishSheetSyncWakeup({ reason: "domain_delete" })
  // else return

// ── 4. Unmigrated schedule ────────────────────────────────

export function scheduleTheUnmigratedSheetSync(job)
  // disabled → log
  // queued → waitUntil(enqueueAndPublish)  // not in the domain txn
  // legacy → waitUntil(refreshTheSheetsNow)

export function askForACallLeadRowRefresh(leadId, operation)
export function askForABookingChainRefresh(bookingId, operation)
export function askForABookedRowOnlyRefresh(bookingId, operation)

async function enqueueAndPublish(job)  // later outbox + later wake-up

// ── 5. Refresh the sheets now ─────────────────────────────

export async function refreshTheSheetsNow(job)
  // dispatch to later source-lookup sibling by resource
```

Read the queued public path out loud: *Hold the domain write. Inside that write, remember the sheet-sync intent so the Lead and the outbox job commit together. After commit, wake the drain. Do not write Google Sheets in the callback. Cron will still find the work if the wake-up never leaves this host.*

Read the legacy public path out loud: *Hold the write with no transaction. Remember is a no-op. After commit, schedule the old background refresh, which looks up the document and writes the sheets now.*

Read the canonical-command path out loud: *The executor already holds the transaction. Remember inside the operation. Finalize only after a successful non-replay commit. A no-op writes nothing and does not wake anyone.*

That is the operation. `persistSheetSyncIntent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two enqueue paths.** `rememberTheSheetSyncIntent` writes the outbox inside the caller’s session. `scheduleTheUnmigratedSheetSync` in queued mode `waitUntil`s enqueue + publish **after** the domain write, with no session. Knowledge already names this the unmigrated fallback. Keep both **adapters**. Do not silently make schedule call persist. Do not silently make persist publish.

2. **Granot / RingCentral skip remember.** `createLeadFromGranot`, `synchronizeLeadFromGranot`, and `callLeadConvergence` call later `enqueueSheetSyncJob` (mode-blind) then `afterCommitTellTheSheets`. Knowledge already labels the gap. Rename so the bypass is visible. Do not silently route them through persist in this pass. Checked-in Granot effect flags still keep those HTTP / processor paths off.

3. **Legacy finalize is a double hop.** `afterCommitTellTheSheets` in legacy calls `scheduleTheUnmigratedSheetSync`, which `waitUntil`s `refreshTheSheetsNow`. That is the load-bearing old path, not a bug. Name the hops. Do not inline refresh into finalize so “one function owns legacy.”

4. **The three `schedule*` wrappers only shape the job.** Call Lead row, Booking Chain, booked-row-only. Keep them thin. Do not invent a fourth `scheduleCancellationChainSheetSync` that has no caller. Do not fold them into one `schedule(resource)` so “one helper owns every shape.”

5. **`forceTransaction` is not a Sheet Sync flag.** Form Lead Ingestion forces a transaction when confirmation SMS is in play, and the authorized WordPress receipt path forces one too. Hold-the-write honors that. Do not rename the option as `alwaysRememberOutbox`. Do not persist from hold-the-write.

6. **Log message shapes are load-bearing.** `${operation}.sheet_sync.disabled|queued|scheduled|enqueue_failed|failed|started|completed`. Rename functions; keep the strings until log searches are migrated on purpose.

7. **Persist does not publish; queued finalize does not enqueue.** Collapsing them would put a network call inside the write, or lose the outbox when publish is skipped. Preview / local / tests never publish; cron still drains.

8. **No coordinator-owned test file.** The persist mode gate lives in `sheetSyncOutbox.service.test.ts`. `domainCommands.test.ts` only proves commands do not call `runSheetSyncWrite`. That is not enough for a story this long — see Testing.

9. **Leave sibling modules alone.** `enqueueSheetSyncJob`, `publishSheetSyncWakeup`, `syncSourceLeadById` / `syncBookedLeadById` / `syncBookingChainById` / `syncCancellationChainById`, and `runSheetSyncDrain` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `holdTheDomainWriteForSheetSync`, `rememberTheSheetSyncIntent`, `afterCommitTellTheSheets`, `afterCommitWakeTheDrainForTheDelete`, `scheduleTheUnmigratedSheetSync`, `refreshTheSheetsNow`.

Today there is no `sheetSyncCoordinator` test. The outbox test stubs `findOneAndUpdate` and proves persist writes once in queued mode and never in legacy / disabled. Command tests prove adapters do not call `runSheetSyncWrite`. That leaves finalize, delete-wake, hold-the-write, unmigrated schedule, and refresh-now unproved at this **interface**.

Add tests that name the operation. Inject the later outbox / queue / lookup **adapters**; do not boot Google Sheets.

**Hold the write**
- Queued mode calls `fn` with a session (transaction).
- Legacy / disabled calls `fn(undefined)` after connect.
- `forceTransaction: true` opens a transaction even in legacy (Form Lead messaging / WordPress receipt).

**Remember**
- Queued: one outbox enqueue with the caller’s session and `createdBy: "api"`.
- Legacy / disabled: zero enqueues (already in the outbox test — keep it as this **interface**, or move the assertion here and leave a one-line pointer).

**After commit**
- Queued finalize publishes `reason: "domain_write"` and does not enqueue.
- Legacy finalize schedules refresh-now via `waitUntil` and does not publish.
- Disabled finalize logs and does neither.
- Delete-wake publishes `reason: "domain_delete"` only in queued mode.
- A command replay / `pending: undefined` must not finalize (belongs to the executor test, not a second copy here).

**Unmigrated schedule / refresh now**
- Queued schedule `waitUntil`s enqueue + publish (not the caller’s session).
- Legacy schedule `waitUntil`s refresh-now.
- Refresh-now dispatches `source_lead` / `booked_lead` / `booking_chain` / `cancellation_chain` to the lookup sibling.

Do **not** add a test per helper (`enqueueAndPublish`). That name exists so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`scheduleCallLeadSheetSync` / `scheduleBookingChainSheetSync` / `scheduleBookedLeadSheetSync` stay exported because enrichment / recon / the `v1.service` facade are real **adapters**, not a test leak.

## What I would not do

- A `SheetSyncService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the persist-before-commit / finalize-after-commit **seam**. Google Sheets, queue publish, CRM, and email must not sit inside the Mongo write.
- Treating later `enqueueSheetSyncJob` / `publishSheetSyncWakeup` / `runSheetSyncDrain` / `syncSourceLead` as this story.
- Inventing a queue **seam** that has only one **adapter** here.
- Silently “fixing” the labeled Granot / RingCentral enqueue-direct gap, or silently putting enqueue inside finalize.
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Reordering Form Lead sheets-before-CRM (that labeled ADR order lives on the Form Lead recommendation, not here).
