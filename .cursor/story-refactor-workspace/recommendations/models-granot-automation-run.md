# Remember Each Granot HTTP Automation Run — Whether It Only Previews Or Waits For Owner Approval, Which Of The Eight Status Words It Is At, Hold The Sealed Plan Plus Approval Plus Per-Action Receipt Pointers, Stamp The Named Queue TTL Recovery And Plan-Identity Indexes, And Embed The Durable-Work Fence Nest — Never Collect HTML Here, Never Approve Here, Never Capture A Receipt Here, Never Merge This Into The CSV Apply Pass Or The Automation Source — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 35 of this service — `GranotAutomationRun.ts`
- Remaining in this service: `GranotAutomationSource.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotAutomationRun.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (`GranotAutomationRun` stores the immutable plan, approval, lease, checkpoint, and per-action receipts `{ action_id, lifecycle_receipt_id, observation_id?, decision_id?, outcome, applied_at, error_code? }`; lifecycle receipts / Observations / Decisions remain if the run later expires; run-level `receipts` are **not** the Observation Receipt document; Preview never writes a lifecycle receipt; Approved apply captures one `granot_http_automation` receipt per selected action — **this file never collects, never approves, never captures**). Software map: [`.cursor/rules/granot-http-automation.mdc`](../../../.cursor/rules/granot-http-automation.mdc) (Owner `/api/v1/admin/granot-automation/*`; workflows `preview` / `apply`; apply needs `GRANOT_AUTOMATION_APPLY_ENABLED` plus Owner approval; queue topic `granot-automation-events`; cron recovers leased runs). Already-recommended leftover walk: [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (`create` `queued` then leftover-plan / leftover-approve / leftover-walk — **this file never queues**). Already-recommended leftover capture: [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) (**does not import this file**; leftover walk leftover-stamps `receipts[]` after leftover-asks leftover capture). Already-recommended leftover nest: [durable-work-schema.md](durable-work-schema.md) (`...durableRunControlFields()` — **this file leftover-spreads it; leftover nest leftover-does leftover-not leftover-persist**). Already-recommended leftover account clock: [durable-work-leases.md](durable-work-leases.md) (`granot:automation:account` on leftover later `SheetSyncLease` — **not these columns**). Already-recommended leftover HTTP: [routes-granot-automation.md](routes-granot-automation.md) / [routes-granot-automation-cron.md](routes-granot-automation-cron.md) (**ask** leftover walk, **not** this file). Already-recommended leftover CSV pass: [models-granot-crm-sync-run.md](models-granot-crm-sync-run.md) (collection `granot_crm_sync_runs`, three statuses, **no** lease, selected-database getter — **do not merge**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `granot_automation_runs`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the HTTP run.” Distinct from leftover later `GranotAutomationSource.ts` (label + `supported_operations` catalog — **do not merge**). Distinct from leftover later Best Relocation `IngestionRun` / leftover later `ReportingRun` (those leftover-later files leftover-also leftover-spread leftover `durableRunControlFields` — **do not merge**). Distinct from leftover later `SheetSyncLease` (named-scope row leftover walk leftover-asks — **do not merge**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Form Lead / Call Lead Enrichment / Granot Observation Receipt / System of Record; do not invent a glossary copy for Granot HTTP automation run. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only.** Already-recommended leftover `runWorkflow.ts` **asks** `GranotAutomationRun` after leftover `connectMongo()` — `create` / `insertMany` `queued`; leftover-worker leftover-expires leftover-stale leftover-`awaiting_approval`; leftover-claim leftover-`$set` leftover-fence leftover-plus leftover-`$inc attempt_count`; leftover-plan leftover-locks leftover-`plan_snapshot` / leftover-`plan_checksum` / leftover-`plan_locked_at`; leftover-approve leftover-CAS leftover-to leftover-`applying`; leftover-walk leftover-`$set receipts` leftover-then leftover-`completed` / leftover-`completed_with_errors`; leftover-fail leftover-writes leftover-`failed` leftover-or leftover-requeues leftover-`queued`; leftover-list leftover-sorts leftover-`createdAt: -1`; leftover-recover / leftover-continue leftover-`exists` leftover-queued leftover-or leftover-stale leftover-planning / leftover-applying. Admin / cron / queue leftover-ask leftover walk — **not** this file. Barrel `granotHttpCollector/index.ts` leftover-does leftover-not leftover-re-export leftover this leftover file. Tests: `granot-automation.routes.test.ts` leftover-asks leftover `GranotAutomationRun.schema.path` for `operation` / `run_group_id` / `workflow` / `plan_snapshot` / `plan_checksum` / `plan_locked_at` / `expires_at` / `approval` / `receipts` / `checkpoint` / `lease_epoch` and leftover-asks leftover index name `granot_run_plan_identity`. There is **no** `GranotAutomationRun.test.ts`. `runWorkflow.test.ts` leftover-does leftover-not leftover-import leftover this leftover file. Nobody imports `GRANOT_RUN_STATUSES`. There is no selected-database getter and no migration script for these named indexes. Not this **interface**: leftover `createGranotRun` itself, leftover `approveGranotRun` itself, leftover `runGranotWorker` itself, leftover `applyAutomationPlanAction` itself, leftover `collectGranotReport` itself, leftover `sealAutomationPlan` itself, leftover `resolveGranotAutomationSources` itself, leftover `MongoLeaseStore.acquire` itself.
- Seams callers need: default `GranotAutomationRun` (first-registered connection — leftover walk leftover-asks leftover it leftover after leftover `connectMongo()`; leftover routes leftover-test leftover-asks leftover `schema.path`) vs **no** `getGranotAutomationRunModel()` (already-recommended leftover CSV pass leftover-has leftover a leftover getter; this file leftover-does leftover-not); `workflow: "preview"` (leftover walk leftover-completes leftover at leftover plan leftover-lock; no approval) vs `workflow: "apply"` (leftover walk leftover-waits leftover `awaiting_approval` leftover when leftover any leftover approvable leftover action leftover exists); eight leftover status leftover words vs leftover CSV leftover three leftover (`running` / `completed` / `failed`); run-document leftover fence leftover columns leftover (`lease_owner` / `leased_until` / `lease_epoch`) vs leftover account leftover clock leftover `granot:automation:account` leftover on leftover later leftover `SheetSyncLease` (leftover walk leftover-constructs leftover `new MongoLeaseStore(SheetSyncLease)` — **not these columns**); run-level Mixed `receipts[]` vs leftover Observation Receipt leftover document; card `schema_version` default `1` vs leftover sealed leftover plan leftover `schema_version: 2`; `expires_at` (24h leftover plan leftover TTL; leftover approve leftover and leftover lock leftover refuse leftover when leftover past) vs `purge_at` (7-day leftover Mongo leftover TTL leftover `expireAfterSeconds: 0`); named leftover indexes leftover `granot_run_queue_claim` / leftover `granot_run_retention_ttl` / leftover `granot_run_recovery` / leftover `granot_run_plan_identity` vs mongoose leftover default leftover `autoIndex: true` (this file leftover-omits leftover `autoIndex: false`); Mixed leftover `request_snapshot` / leftover `initiator` / leftover `collection_summary` / leftover `plan_snapshot` / leftover `approval` / leftover `receipts` / leftover `counters` vs leftover typed leftover durable leftover nest. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no collect **seam**. There is no approve **seam**. There is no capture **seam**. There is no selected-database **seam**.
- Split later (only if the file outgrows one sitting): this ~95-line file is one sitting if you read it as remember each Granot HTTP automation run — whether it only previews or waits for Owner approval, which of the eight status words it is at, hold the sealed plan plus approval plus per-action receipt pointers, stamp the named queue TTL recovery and plan-identity indexes, and embed the durable-work fence nest — never collect HTML here, never approve here, never capture a receipt here, never merge this into the CSV apply pass or the automation source. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `preview.ts` / `apply.ts` / `lease.ts`. Leftover walk stays already-recommended `runWorkflow.ts`. Leftover capture stays already-recommended `automationApply.ts`. Leftover nest stays already-recommended `durableWork/schema.ts`. Leftover later automation source stays leftover later `GranotAutomationSource.ts`.

`GranotAutomationRun` is a Mongoose model name. The owner question is: *The owner just asked for a durable Granot HTTP automation run — Form tables or Call tables, preview or apply. Remember the run on `granot_automation_runs`. Say whether it only previews or waits for Owner approval (`preview` / `apply`). Say which of the eight status words it is at (`queued` / `planning` / `awaiting_approval` / `applying` / `completed` / `completed_with_errors` / `failed` / `expired`). Hold the request snapshot, the sealed plan plus checksum, the approval bag, and the per-action receipt pointers (lifecycle ids and bounded outcomes — not the Observation Receipt document). Stamp the named queue, seven-day TTL, recovery, and one-checksum-per-run indexes. Embed the durable-work fence nest so leftover-walk leftover-may leftover-claim leftover this leftover row leftover under leftover the leftover account leftover clock. Do not collect HTML. Do not approve selected actions. Do not capture a `granot_http_automation` receipt. Do not invent a selected-database getter so “CSV matches HTTP.” Do not merge this into the leftover CSV apply pass or the leftover later automation source.*

Who leftover-queues / leftover-plans / leftover-approves / leftover-walks already lives in already-recommended `runWorkflow.ts`. Who leftover-captures leftover each leftover selected leftover action already lives in already-recommended `automationApply.ts`. Who leftover-hands leftover the leftover fence leftover nest already lives in already-recommended `durableWork/schema.ts`. Who leftover-holds leftover the leftover account leftover clock already lives in leftover later `SheetSyncLease`. Do not pull those in.

## What this file actually does

Three operations of one “remember each Granot HTTP automation run — whether it only previews or waits for Owner approval, which of the eight status words it is at, hold the sealed plan plus approval plus per-action receipt pointers, stamp the named queue TTL recovery and plan-identity indexes, and embed the durable-work fence nest — never collect HTML here, never approve here, never capture a receipt here, never merge this into the CSV apply pass or the automation source” story, not “an automation-run CRUD dump,” and not Queue The Durable Granot Automation Run itself:

1. **Hold the Granot HTTP automation run card** — collection `granot_automation_runs`, `timestamps: true`, `toJSON` / `toObject` `{ virtuals: true }` (this file defines **no** virtuals). **No** `autoIndex: false` (mongoose default creates the named clocks and the field indexes on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required `schema_version` (`Number`, default `1`, `min: 1`) — this is the **card** version, not leftover sealed leftover plan leftover `schema_version: 2`. Required `operation` (`form_leads` | `call_leads`). Optional trimmed indexed `run_group_id` (default `null`). Mixed required `request_snapshot` / `initiator`. Mixed optional `collection_summary` / `plan_snapshot` / `approval`. Optional trimmed `plan_checksum` (default `null`). Optional `plan_locked_at` (default `null`). Required indexed `expires_at`. Required `purge_at`. Mixed `receipts` array (default `[]`) and Mixed `counters` (default `{}`). `GranotAutomationRunDocument` is `InferSchemaType` plus `_id`. This beat does **not** collect HTML. This beat does **not** seal a plan. This beat does **not** write a receipt.

2. **Remember whether this run only previews and which status word it is at** — required `workflow` (`preview` | `apply`). `GRANOT_RUN_STATUSES` (`queued` | `planning` | `awaiting_approval` | `applying` | `completed` | `completed_with_errors` | `failed` | `expired`, required, default `"queued"`). Already-recommended leftover walk writes `queued` on create, `planning` while leftover-collecting, `awaiting_approval` when leftover-apply leftover-has leftover approvable leftover actions, `applying` after leftover-approve, `completed` / `completed_with_errors` when leftover-walk leftover-finishes, `failed` on leftover-structural leftover-fail, `expired` when leftover-stale leftover-`awaiting_approval` leftover-passes leftover `expires_at`, and leftover-requeues leftover-`queued` on leftover-transient leftover-provider leftover-fail while leftover `attempt_count < 3`. Leftover `failed` / leftover `expired` / leftover `completed_with_errors` **have** runtime writers here. This beat does **not** elect preview vs apply. This beat does **not** elect the next leftover status leftover word.

3. **Stamp the named clocks and embed the durable-work fence nest** — default export `GranotAutomationRun` is `mongoose.models.GranotAutomationRun ?? mongoose.model(...)`. There is **no** `getGranotAutomationRunModel()`. Named indexes: `granot_run_queue_claim` `{ status: 1, createdAt: 1 }`; `granot_run_retention_ttl` `{ purge_at: 1 }` `expireAfterSeconds: 0`; `granot_run_recovery` `{ status: 1, leased_until: 1 }`; `granot_run_plan_identity` unique `{ _id: 1, plan_checksum: 1 }` partial `{ plan_checksum: { $type: "string" } }`. Spread `...durableRunControlFields()` (leftover already-recommended leftover nest: leftover `lease_owner` / leftover `leased_until` / leftover `lease_epoch` / leftover `checkpoint` / leftover `attempt_count` / leftover `last_attempt_at` / leftover `started_at` / leftover `completed_at` / leftover typed leftover `failure`). Leftover walk **asks** the default model. This beat does **not** `syncIndexes`. This beat does **not** acquire leftover `granot:automation:account`. This beat does **not** delete the default export so “everyone must call a getter.”

There is no leftover-queue-the-run operation. Leftover `createGranotRun` elects that. There is no leftover-approve operation. Leftover `approveGranotRun` elects that. There is no leftover-capture operation. Leftover `applyAutomationPlanAction` elects that.

## Organization

Keep one file. This is the screenplay for “remember each Granot HTTP automation run — whether it only previews or waits for Owner approval, which of the eight status words it is at, hold the sealed plan plus approval plus per-action receipt pointers, stamp the named queue TTL recovery and plan-identity indexes, and embed the durable-work fence nest — never collect HTML here, never approve here, never capture a receipt here, never merge this into the CSV apply pass or the automation source.” Leftover walk / leftover collect / leftover seal / leftover approve / leftover capture / leftover account clock already live in deeper **modules**. Leftover nest already lives in a sibling **module**. Leftover CSV pass already lives in a sibling **module**. Leftover later automation source already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotAutomationRunService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the leftover CSV pass” without a paired leftover-walk leftover-migration leftover-to leftover-the leftover-getter. Do not invent an `autoIndex: false` **adapter** so “this matches the leftover Source card” without a paired leftover migration apply path. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `status.ts` / `preview.ts` / `apply.ts` / `lease.ts` each get a file.

Do not move leftover `createGranotRun` into this file so “the row owns the walk.” Do not merge this file into already-recommended leftover `GranotCrmSyncRun.ts` so “one schema owns CSV apply and HTTP automation.” Do not merge this file into leftover later `GranotAutomationSource.ts` so “one file owns the run and the label catalog.” Do not merge this file into leftover later `IngestionRun.ts` or leftover later `ReportingRun.ts` so “one file owns every durable-work run.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotAutomationRun` | `granotHttpAutomationRunOnTheDefaultConnection` | leftover walk create / claim / lock / approve / fail leftover-asks the default model after leftover `connectMongo()`; leftover routes leftover-test leftover-asks leftover `schema.path` |
| `GranotAutomationRunDocument` | `GranotHttpAutomationRunRow` | inferred document + `_id` |
| `GRANOT_RUN_STATUSES` | `WhichOfTheEightStatusWordsThisRunIsAt` | leftover schema enum; leftover walk leftover-writes leftover all leftover eight leftover words |

Keep the old names as one-line aliases until leftover walk, leftover routes leftover-test, and any later script migrate. Do not make callers learn `useDb` / `durableRunControlFields` / `expireAfterSeconds` as the only domain language until those sites move. Do **not** add a `getGranotAutomationRunModel` export so “CSV matches HTTP” without a paired leftover-walk leftover-proof leftover that leftover `connectMongo()` leftover-already leftover-binds leftover the leftover selected leftover database. Do **not** re-export leftover `createGranotRun` from this file so “the row leftover-collects HTML.”

**No class for the workflow.** The one type that *does* earn a name is the run-identity contract:

```ts
type GranotHttpAutomationRunIdentity = {
  collection: "granot_automation_runs"
  whether_this_run_only_previews: "preview" | "apply"
  operation: "form_leads" | "call_leads"
  whether_this_run_is_still_walking:
    | "queued"
    | "planning"
    | "awaiting_approval"
    | "applying"
    | "completed"
    | "completed_with_errors"
    | "failed"
    | "expired"
  failed_has_a_runtime_writer: true
  expired_has_a_runtime_writer: true
  completed_with_errors_has_a_runtime_writer: true
  selected_database_getter: false
  account_lease_lives_on: "SheetSyncLease"
  run_document_has_durable_fence: true
  run_receipts_are_observation_receipts: false
  card_schema_version_default: 1
  sealed_plan_schema_version: 2
  plan_ttl_hours: 24
  purge_ttl_days: 7
  autoIndex: true
  named_indexes: [
    "granot_run_queue_claim",
    "granot_run_retention_ttl",
    "granot_run_recovery",
    "granot_run_plan_identity",
  ]
}
```

That is the handoff from “this process remembered an HTTP automation run” to “leftover-walk leftover-may leftover-claim leftover this leftover row leftover under leftover the leftover account leftover clock, leftover-lock leftover one leftover checksum, leftover-expire leftover stale leftover approval, leftover-TTL leftover-delete leftover the leftover card leftover after leftover seven leftover days, and leftover-boot leftover-creates leftover the leftover named leftover indexes.” Do **not** add `{ selected_database_getter: true }` so “this leftover-matches leftover the leftover CSV leftover pass.” Do **not** add `{ run_receipts_are_observation_receipts: true }` so “one array leftover-owns leftover capture.” Do **not** add `{ autoIndex: false }` so “this leftover-matches leftover the leftover Source leftover card.”

Leave already-recommended leftover `GranotCrmSyncRun.ts` on that file. Leave leftover later `GranotAutomationSource.ts` on that file. Leave leftover later `IngestionRun.ts` / leftover later `ReportingRun.ts` / leftover later `SheetSyncLease.ts` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotAutomationRun.ts
// The owner just asked for a durable Granot HTTP automation run —
// Form tables or Call tables, preview or apply.
// Remember the run on granot_automation_runs.
// Say whether it only previews or waits for Owner approval.
// Say which of the eight status words it is at.
// Hold the sealed plan, the approval bag,
// and the per-action receipt pointers.
// Stamp the named queue, seven-day TTL, recovery,
// and one-checksum-per-run indexes.
// Embed the durable-work fence nest.
// Do not collect HTML.
// Do not approve selected actions.
// Do not capture a granot_http_automation receipt.
// Do not invent a selected-database getter
// so "CSV matches HTTP."
// Do not merge this into the CSV apply pass
// or the later automation source.

export const WhichOfTheEightStatusWordsThisRunIsAt =
  GRANOT_RUN_STATUSES

export { WhichOfTheEightStatusWordsThisRunIsAt as GRANOT_RUN_STATUSES }

export const granotHttpAutomationRunOnTheDefaultConnection =
  GranotAutomationRun
export type GranotHttpAutomationRunRow = GranotAutomationRunDocument

export { granotHttpAutomationRunOnTheDefaultConnection as GranotAutomationRun }
export type { GranotHttpAutomationRunRow as GranotAutomationRunDocument }

// ── 1. Hold the Granot HTTP automation run card ───────────

export const GranotAutomationRun =
  rememberTheGranotHttpAutomationRunOnTheDefaultConnection()

function rememberTheGranotHttpAutomationRunOnTheDefaultConnection() {
  return (
    mongoose.models.GranotAutomationRun ??
    mongoose.model("GranotAutomationRun", GranotAutomationRunSchema)
  )
}

function theCardSaysFormTablesOrCallTables()                // form_leads | call_leads
function theCardMayShareARunGroupId()                       // indexed; default null
function theCardHoldsTheRequestAndWhoAsked()                // Mixed request_snapshot + initiator
function theCardHoldsTheSealedPlanOnceLocked()              // plan_snapshot / plan_checksum / plan_locked_at
function theCardHoldsApprovalAndPerActionReceiptPointers()  // Mixed; not Observation Receipts
function theCardKeepsATwentyFourHourPlanClock()             // expires_at
function theCardKeepsASevenDayPurgeClock()                  // purge_at
function theCardVersionIsNotTheSealedPlanVersion()          // schema_version default 1 vs plan 2

// ── 2. Remember whether this run only previews and which status word it is at

function whetherThisRunOnlyPreviews()                       // preview | apply
function whichOfTheEightStatusWordsThisRunIsAt()            // queued … expired
function failedAndExpiredAndCompletedWithErrorsHaveWriters()
function leftoverWalkWritesEveryStatusWord()

// ── 3. Stamp the named clocks and embed the durable-work fence nest

function stampTheQueueClaimClock()                          // granot_run_queue_claim
function stampTheSevenDayTtlClock()                         // granot_run_retention_ttl
function stampTheRecoveryClock()                            // granot_run_recovery
function stampTheOneChecksumPerRunClock()                   // granot_run_plan_identity
function embedTheDurableWorkFenceNest()                     // leftover durableRunControlFields()
function theAccountClockLivesOnSheetSyncLease()             // not these columns
```

Read the primary path out loud: leftover walk calls `GranotAutomationRun.create()` as `queued` and `preview` or `apply` after leftover `connectMongo()`. When the leftover worker leftover-holds leftover `granot:automation:account`, it leftover-copies leftover that leftover clock leftover onto leftover this leftover row leftover and leftover-plans leftover or leftover-walks. Preview leftover-finishes leftover at leftover plan leftover-lock. Apply leftover-waits leftover until leftover the leftover owner leftover-approves leftover selected leftover actions leftover against leftover the leftover checksum, then leftover-stamps leftover Mixed leftover `receipts[]` leftover and leftover-closes leftover as leftover `completed` leftover or leftover `completed_with_errors`. A leftover-stale leftover approval leftover becomes leftover `expired`. A leftover-structural leftover fail leftover becomes leftover `failed`. Seven leftover days leftover later leftover Mongo leftover-TTL leftover-deletes leftover this leftover card leftover — leftover lifecycle leftover receipts leftover stay. This file never opens Granot HTML.

That is the operation. `GranotAutomationRun` as "an automation-run schema dump" is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **There is no selected-database getter.** Already-recommended leftover CSV pass leftover-asks `getGranotCrmSyncRunModel()`. Already-recommended leftover Source card leftover-asks `getGranotCrmSourceModel()`. This file leftover-exports only the default model. Leftover walk leftover-calls `connectMongo()` first and leftover-then leftover-asks `GranotAutomationRun`. Name `selected_database_getter: false`. Do not add a getter in this pass so “CSV matches HTTP.”

2. **`GRANOT_RUN_STATUSES` drops “Automation.”** The leftover collection and leftover model say `GranotAutomationRun`. The leftover tuple says `GRANOT_RUN_STATUSES`. Nobody leftover-imports it except this schema enum. After the rename, keep the old name as an alias of `WhichOfTheEightStatusWordsThisRunIsAt`. Do not silently leftover-widen the leftover tuple so “CSV `running` lives here too.”

3. **The card version is not the sealed-plan version.** Leftover `buildQueuedRun` leftover-does not leftover-set `schema_version`; mongoose leftover-defaults `1`. Leftover seal leftover-writes plan `schema_version: 2`. Leftover checksum envelope still leftover-says `schema_version: 1`. Name `card_schema_version_default: 1` and `sealed_plan_schema_version: 2`. Do not leftover-bump the leftover card default to `2` so “the two leftover versions leftover-match.”

4. **Two leftover clocks leftover-hold the leftover worker.** Leftover walk leftover-acquires `granot:automation:account` on leftover later `SheetSyncLease`, leftover-then leftover-copies `lease_owner` / `leased_until` / `lease_epoch` onto this leftover row so leftover `fenced()` leftover-matches both. This file leftover-owns only the leftover row fence. Name `account_lease_lives_on: "SheetSyncLease"` and `run_document_has_durable_fence: true`. Do not leftover-import `SheetSyncLease` here so “one leftover file leftover-owns both leftover clocks.”

5. **Run-level `receipts[]` are not Observation Receipts.** Knowledge leftover-says that in those words. Mixed leftover array leftover-holds `action_id` plus leftover lifecycle ids and a leftover bounded `outcome`. Leftover capture leftover-writes the leftover Observation Receipt elsewhere. Name `run_receipts_are_observation_receipts: false`. Do not leftover-ref `"GranotObservationReceipt"` here so “the leftover array leftover-owns leftover capture.”

6. **Mongo leftover-TTL leftover-deletes the leftover card.** `granot_run_retention_ttl` leftover-is `{ purge_at: 1 }` `expireAfterSeconds: 0`. Leftover create leftover-sets `purge_at` seven leftover days out. Knowledge leftover-says leftover lifecycle leftover receipts leftover-remain if the leftover run leftover-expires or leftover-purges. Do not leftover-drop the leftover TTL so “ops can leftover-reread every leftover run.”

7. **Plan identity is one checksum per run, not unique across runs.** `granot_run_plan_identity` leftover-is unique `{ _id: 1, plan_checksum: 1 }` leftover partial when `plan_checksum` is a leftover string. Two leftover runs may leftover-share a leftover checksum. One leftover run may leftover-lock only one leftover string leftover checksum. Do not leftover-unique `plan_checksum` alone so “two leftover owners cannot leftover-plan the same leftover tables.”

8. **Indexes create on boot.** This file leftover-does not leftover-set `autoIndex: false`. Already-recommended leftover Source card leftover-uses `autoIndex: false` plus a leftover named leftover migration. There leftover-is no `pnpm migration:granot-automation*` leftover command. Do not leftover-flip this leftover file in the same leftover PR as the leftover rename. Name `autoIndex: true`.

9. **The leftover recovery query is richer than the leftover recovery index.** Leftover `recoverGranotRuns` leftover-asks `queued` **or** `{ status: { $in: ["planning", "applying"] }, leased_until` missing / null / `<= now` `}`. The leftover named leftover index leftover-is `{ status: 1, leased_until: 1 }`. Do not leftover-rewrite leftover recover from this leftover model leftover pass so “the leftover index leftover-owns the leftover query.”

10. **`toJSON` / `toObject` leftover-ask virtuals this leftover file leftover-does not leftover-define.** Leave that off the leftover identity leftover type until a leftover later leftover virtual leftover-lands. Do not leftover-add an `id` leftover virtual here so “the leftover DTO leftover-owns the leftover schema.”

11. **Mixed leftover bags sit next to a leftover typed leftover nest.** Leftover `counters` leftover-is Mixed leftover default `{}`. Leftover later `IngestionRun` leftover-types its leftover counters. Leftover `failure` leftover-is the leftover typed leftover nest. Do not leftover-type `counters` here so “this leftover-matches leftover later Best Relocation.”

12. **Software-map leftover gap.** `schema-and-crud-inputs.mdc` leftover-does not leftover-name `granot_automation_runs`. Knowledge leftover-does. Do not leftover-invent that leftover rule leftover line from this leftover rename.

## Testing

The interface of this file is the default-connection model, the eight-word tuple, the inferred-row type, the four named indexes, and the leftover durable-work nest spread. There is no `GranotAutomationRun.test.ts` today. Leftover `granot-automation.routes.test.ts` leftover-already leftover-asks eleven schema paths plus `granot_run_plan_identity`.

I would add one model-interface test file next to this module (or keep growing that leftover routes test if that is the house style by then). I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GranotAutomationRun ?? mongoose.model(...)`; there is no `getGranotAutomationRunModel`
- leftover walk leftover-asks `GranotAutomationRun` only after leftover `connectMongo()`
- the whether-this-run-only-previews field enum is exactly `preview | apply`
- the whether-this-run-is-still-walking tuple is exactly the eight words (`queued` / `planning` / `awaiting_approval` / `applying` / `completed` / `completed_with_errors` / `failed` / `expired`)
- leftover walk leftover-writes all eight status words
- leftover `failed` / leftover `expired` / leftover `completed_with_errors` have runtime writers
- named indexes are exactly `granot_run_queue_claim` / `granot_run_retention_ttl` / `granot_run_recovery` / `granot_run_plan_identity`
- leftover TTL is `{ purge_at: 1 }` `expireAfterSeconds: 0`
- leftover plan identity is unique `{ _id: 1, plan_checksum: 1 }` partial `{ plan_checksum: { $type: "string" } }`
- leftover card `schema_version` defaults to `1`; leftover sealed plan is `2`
- leftover `receipts` is Mixed array default `[]` and leftover-does not leftover-ref `"GranotObservationReceipt"`
- leftover spread leftover-includes `lease_owner` / `leased_until` / `lease_epoch` / `checkpoint` / `attempt_count`
- leftover walk leftover-copies the leftover account clock onto those columns and leftover-does not leftover-store the leftover account scope on this row
- leftover file leftover-omits `autoIndex: false`
- `schema-and-crud-inputs.mdc` still leftover-does not name `granot_automation_runs`; this pass leftover-does not invent that rule line
- already-recommended leftover `GranotCrmSyncRun` is a different collection; that file is out of this story
- leftover later `GranotAutomationSource` is out of this story

I would not test HTML collect, Owner approve, leftover capture, leftover Form correction, leftover Call enrichment write, or leftover Booked reconciliation from this file.

Do not add a test per helper (`theCardMayShareARunGroupId`, `theAccountClockLivesOnSheetSyncLease`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GranotAutomationRunService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `preview.ts` / `apply.ts` / `lease.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating leftover `createGranotRun` / leftover `approveGranotRun` / leftover `runGranotWorker` / leftover `applyAutomationPlanAction` / leftover `GranotCrmSyncRun` / leftover later `GranotAutomationSource` / leftover later `IngestionRun` / leftover later `ReportingRun` / leftover later `SheetSyncLease` as this story.
- Inventing a selected-database seam that has only the leftover CSV getter as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, unique-ing `plan_checksum` alone, typing Mixed `counters`, ref-ing `receipts` at `GranotObservationReceipt`, or merging the account clock onto this schema while recommending a rename.
- Pulling `createGranotRun` into this file.
- Merging this collection into `GranotCrmSyncRun`, leftover later `GranotAutomationSource`, leftover later `IngestionRun`, leftover later `ReportingRun`, or leftover later `SheetSyncLease`.
- Silently reordering leftover `connectMongo` versus leftover `create`, leftover account leftover acquire versus leftover row leftover claim, leftover plan leftover lock versus leftover Owner leftover approve, or leftover capture versus leftover `receipts[]` leftover stamp.
- Dropping the default export or leftover `GRANOT_RUN_STATUSES` in the same PR as the story names.
- Opening Wave B (`src/validation/`) or leftover later `GranotAutomationSource.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `GranotAutomationSource.ts` while writing this file.
