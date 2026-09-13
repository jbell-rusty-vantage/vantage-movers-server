# Remember The Shared Granot Lifecycle Word Catalog, Lead Provenance And Revision Field Bags, Receipt Processing Shape, And Channel-Operation Identity Rules — Never Persist A Collection Here, Never Capture Normalize Or Decide Here, Never Assign Ingestion Origin Here, Never Merge `types.ts`, Never Merge The Shared Discrepancy Factory — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 29 of this service — `granotLifecycleSchemas.ts`
- Remaining in this service: `granotDiscrepancyModel.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/granotLifecycleSchemas.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) (`granotLifecycleSchemas.ts` is **Primary code** for Unit 09 / Unit 12 storage: `domain_revision` default `0`, paired `last_change_id` / `last_changed_at`, write-once server `change_history_started_at`; public/admin DTOs reject revision **and** Lead provenance fields; shared provenance / temporal / convergence sub-schemas are **storage only**; `__v` is not the lifecycle contract; historical collections are **not** write targets — **this file never CAS-es**, never migrates). Related capture / channel ID: [`docs/knowledge/granot-lifecycle/capture.md`](../../../docs/knowledge/granot-lifecycle/capture.md) (webhook: `route_event_class`, no `channel_operation_kind` / `channel_operation_id`; extension: lowercase operation id + `extension_session`; automation: `` `${run_id}:${action_id}` `` + `automation_owner_approval`; unique on the **envelope** is `{ observation_channel, channel_operation_id }` partial on string id — **this file never inserts**, never uniques). Related already-recommended envelope: [models-granot-observation-receipt.md](models-granot-observation-receipt.md) (**asks** `assertReceiptChannelShape` / `assertChannelOperationId` / `granotReceiptProcessingSchema` — **do not merge the envelope here**). Related already-recommended Form / Call / Booking / Cancellation desks: [models-form-lead.md](models-form-lead.md) / [models-call-lead.md](models-call-lead.md) / [models-booked-lead.md](models-booked-lead.md) / [models-cancelled-lead.md](models-cancelled-lead.md) (**spread** `formLeadProvenanceSchemaFields` / `callLeadProvenanceSchemaFields` / `aggregateRevisionSchemaFields` and **ask** the two guard functions — **do not pull those desks in**). Related already-recommended Decision / Record Link / activation / cases / desks: [models-synchronization-decision.md](models-synchronization-decision.md) / [models-granot-record-link.md](models-granot-record-link.md) / [models-granot-lifecycle-activation.md](models-granot-lifecycle-activation.md) / [models-granot-booking-reconciliation-case.md](models-granot-booking-reconciliation-case.md) / [models-granot-release-reconciliation-case.md](models-granot-release-reconciliation-case.md) / [models-granot-booking-discrepancy.md](models-granot-booking-discrepancy.md) / [models-granot-release-discrepancy.md](models-granot-release-discrepancy.md) (**ask** outcome / reason / entity-ref / evidence-action / mode / state catalogs — **do not merge those collections here**). Related leftover Wave A type dump: leftover `granotLifecycle/types.ts` (Wave A **skipped** as type-only; this file `satisfies` those unions — **do not merge that file here**). Related leftover assign / strip: already-recommended [leads-ingestion-provenance.md](leads-ingestion-provenance.md) (`ASSIGNABLE_*` + `omitForbiddenLeadLifecycleFields` **asks** `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` — **this file never assigns origin**, never strips HTTP). Related leftover CAS: already-recommended [granot-lifecycle-aggregate-revision.md](granot-lifecycle-aggregate-revision.md) (`{ _id, domain_revision: expected }` — **this file never increments**). Related leftover later shared factory: leftover later `granotDiscrepancyModel.ts` (**asks** `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` / `GRANOT_LEAD_MODELS` / `GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES` — **do not pull that factory in**). Related already-recommended field helpers: [models-schema-helpers.md](models-schema-helpers.md) (`LEAD_MODELS` is a **different** leftover tuple for Booking / Cancellation `lead_model` — **do not merge**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) names Form / Call revision + provenance **on those collections** and does **not** name this file as a collection — do not add a Core Collections paragraph from this rename. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Ingestion Origin / Job Number; this checkout does **not** define them — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on revisions; do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **schema desks vs leftover assign/strip vs leftover envelope/normalize/Zod vs leftover metrics vs leftover migration.** Already-recommended `FormLead.ts` / `CallLead.ts` **spread** the provenance + revision bags and **ask** both guards; already-recommended `BookedLead.ts` / `CancelledLead.ts` **spread** revision only and **ask** `applyAggregateRevisionGuards`. Already-recommended `GranotObservationReceipt.ts` **asks** channel / payload / auth catalogs plus `granotReceiptProcessingSchema` / `assertChannelOperationId` / `assertReceiptChannelShape`. Already-recommended `GranotObservation.ts` **asks** kind / route / booking-action / normalization catalogs. Already-recommended `SynchronizationDecision.ts` **asks** outcomes / reasons / match methods / effect kinds / execution modes / dispositions / `ENTITY_REF_MODELS`. Already-recommended cases / leftover later `granotDiscrepancyModel.ts` / leftover later `EntityChange.ts` **ask** entity-ref / evidence-action / mode / outcome / no-action / Lead-model / revision-integer catalogs. Already-recommended leftover `leadIngestionProvenance.ts` **asks** `ASSIGNABLE_*` and `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS`. Leftover `normalization.ts` **asks** `assertReceiptChannelShape`. Leftover Wave B later `validation/v1/granotLifecycle.validation.ts` **asks** `assertChannelOperationId(..., "browser_extension")`. Leftover `granotHttpCollector/lifecycleStatement.ts` **asks** `assertChannelOperationId(..., "granot_http_automation")`. Leftover `metrics.ts` **asks** channels / routes / outcomes / reasons. Leftover `drainer.ts` **asks** `SYNCHRONIZATION_OUTCOMES`. Leftover `projections.ts` **asks** `RECEIPT_WORK_STATES`. Migration libs **ask** `isNonnegativeIntegerRevision` and the assignable / forbidden / field-name catalogs. There is **no** `granotLifecycleSchemas.test.ts`. Proofs live on `FormLead.test.ts` / `CallLead.test.ts` / `GranotObservationReceipt.test.ts` / `GranotObservation.test.ts` / `SynchronizationDecision.test.ts` / `granotAggregateRevisions.test.ts`. Not this **interface**: leftover `captureGranotLifecycleWebhookReceipt` itself, leftover `captureChannelOperationReceipt` itself, leftover `upsertGranotObservation` itself, leftover `persistDecisionAndLink` itself, leftover `createLeadFromGranot` itself, leftover `applyLeadCAS` itself, leftover `deriveFormLeadIngestionOrigin` itself, leftover `createGranotDiscrepancyModel` itself.
- Seams callers need: mongoose `enum: THE_TUPLE` vs leftover `types.ts` union (`satisfies readonly Type[]`); assignable origins (no `legacy_unknown`) vs stored origins (migration may write `legacy_unknown`); `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` (includes `normalized_job_no` + revision names, **excludes** public `job_no`) vs `LEAD_PROVENANCE_FIELD_NAMES` (includes `job_no`); Form provenance bag (has `ingested_move_snapshot`, no `quoted` / no convergence) vs Call provenance bag (has `quoted` + `ringcentral_convergence`, no move snapshot); mongoose `pre("validate")` guards vs leftover `.collection.updateOne` (hooks **do not** run); webhook channel (required `route_event_class`, **forbids** `channel_operation_kind`) vs extension / automation (required kind + id, **forbid** route class); extension id = lowercase UUID v4 vs automation id = first-colon `` `${run_id}:${action_id}` ``; `granotReceiptProcessingSchema` nested on the envelope vs this file having **no** collection / **no** selected-database getter / **no** `autoIndex` / **no** named-index catalog; `GRANOT_LEAD_MODELS` here vs leftover `schemaHelpers` `LEAD_MODELS`; `GRANOT_BOOKING_ACTIONS` vs `GRANOT_RECONCILIATION_ACTION_KINDS` (same two words, different desks). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no collection **seam**.
- Split later (only if the file outgrows one sitting): this ~728-line file is one sitting if you read it as remember the shared Granot lifecycle word catalog, Lead provenance and revision field bags, receipt processing shape, and channel-operation identity rules — never persist a collection here, never capture / normalize / decide here, never assign Ingestion Origin here, never merge `types.ts`, never merge the shared discrepancy factory. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `enums.ts` / `provenance.ts` / `revision.ts` / `channel.ts` / `processing.ts`. Envelope stays already-recommended `GranotObservationReceipt.ts`. Form / Call / Booking / Cancellation stay those files. Leftover assign / strip stays `leadIngestionProvenance.ts`. Leftover CAS stays `aggregateRevision.ts`. Leftover `types.ts` stays type-only. Leftover later factory stays `granotDiscrepancyModel.ts`.

`granotLifecycleSchemas` is a filename. The owner question is: *When Granot evidence or a Lead write needs a legal word, a nested provenance snapshot, a revision pair, or a channel-operation id, hold those contracts here. Form and Call spread the field bags. Booking and Cancellation spread revision only. The envelope leftover-asks the processing shape and the channel rules. New Leads cannot be `legacy_unknown`. Ingested snapshots cannot change after insert. `change_history_started_at` is server-stamped and write-once. Webhook receipts must look like route deliveries. Extension ids must be lowercase UUID v4. Automation ids must be run plus action. This file is not a collection. Do not capture. Do not normalize. Do not decide. Do not assign Ingestion Origin. Do not merge the type dump. Do not merge the leftover later discrepancy factory.*

Who leftover-capture already lives in leftover `capture.ts`. Who leftover-normalize already lives in leftover `normalization.ts`. Who leftover-decide already lives in leftover `processor.ts`. Who leftover-assign origin already lives in leftover `leadIngestionProvenance.ts`. Who leftover-CAS already lives in leftover `aggregateRevision.ts`. Who leftover-hold the envelope already lives in already-recommended `GranotObservationReceipt.ts`. Who leftover-own the TypeScript unions already lives in leftover `types.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the shared Granot lifecycle word catalog, Lead provenance and revision field bags, receipt processing shape, and channel-operation identity rules” story, not “a schema helpers CRUD dump,” and not Capture The Envelope / Assign Ingestion Origin / Compare-And-Swap Revision themselves:

1. **Hold the shared Granot lifecycle word catalog** — const tuples mongoose desks and leftover metrics leftover-ask: receipt work states, authentication methods, payload kinds, observation channels, route event classes, channel-operation kinds, observation kinds, normalization results / issue codes / severities, booking actions, synchronization outcomes / reason codes / match methods / effect kinds, execution modes, entity-ref models, reconciliation states / action kinds / evidence actions (`priority_5` plus booked / release) / booking modes / booking outcomes / release outcomes / no-action reasons, dispositions, Lead models, Record Link states, activation key `"granot_lifecycle"`, receiver-agent sources. Most tuples `satisfies` leftover `types.ts`. `release_case_opened` / `release_case_refreshed` remain on the reason catalog after the live processor stopped opening Release cases. Effect kinds use generic `discrepancy_opened` / `discrepancy_refreshed`; reason codes split `booking_*` / `release_*`. This beat does **not** persist a collection. This beat does **not** write a Decision. This beat does **not** open a case.

2. **Hold the Lead provenance and aggregate-revision field bags, and refuse illegal mutation** — `formLeadProvenanceSchemaFields` (Form origins + shared snapshots + `ingested_move_snapshot`). `callLeadProvenanceSchemaFields` (Call origins + required `quoted` default `false` + `ringcentral_convergence` + shared snapshots, **no** move snapshot). `aggregateRevisionSchemaFields` (`domain_revision` required default `0` min `0` via `isNonnegativeIntegerRevision`; optional paired `last_change_id` / `last_changed_at`; optional `change_history_started_at`). `applyLeadProvenanceGuards`: new rows refuse `legacy_unknown` origin and `legacy_baseline` snapshots; existing rows refuse mutation of `ingestion_origin` / `ingested_contact_snapshot` / `ingested_move_snapshot` when the path exists. `applyAggregateRevisionGuards`: `last_change_id` and `last_changed_at` both present or both absent; new rows stamp `change_history_started_at` to server now (client supply is overwritten); existing rows refuse changing that boundary. `ASSIGNABLE_*` drop `legacy_unknown`. `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` is the strip list leftover assign leftover-asks (includes `normalized_job_no` + revision names, **excludes** public `job_no`). This beat does **not** derive origin from a command. This beat does **not** increment `domain_revision`. This beat does **not** build the ingested snapshot.

3. **Hold the receipt processing shape and assert channel-operation identity** — `granotReceiptLastErrorSchema` / `granotReceiptProcessingSchema` (`state` enum `RECEIPT_WORK_STATES`, attempt counters, lease, `latest_decision_id`, `manual_requeue_count`). `assertChannelOperationId`: string, trim 1–300, no Unicode control / bidi; `browser_extension` must be lowercase UUID v4; `granot_http_automation` must pass `isAutomationOperationId` (first colon splits `run_id` / `action_id`; extra colons stay on the action). `assertReceiptChannelShape`: webhook requires `route_event_class` and forbids `channel_operation_kind`; extension / automation forbid a pretend route class and require kind + id. Webhook may omit `channel_operation_id`. This beat does **not** insert the envelope. This beat does **not** claim `processing.*`. This beat does **not** unique `{ observation_channel, channel_operation_id }` — that catalog lives on already-recommended `GranotObservationReceipt.ts`.

There is no capture operation. `capture.ts` elects that. There is no assign-ingestion-origin operation. `leadIngestionProvenance.ts` elects that. There is no compare-and-swap operation. `aggregateRevision.ts` elects that. There is no hold-the-Form-Lead operation. `FormLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the shared Granot lifecycle word catalog, Lead provenance and revision field bags, receipt processing shape, and channel-operation identity rules — never persist a collection here, never capture / normalize / decide here, never assign Ingestion Origin here, never merge `types.ts`, never merge the shared discrepancy factory.” Envelope / Form / Call / Booking / Cancellation / leftover assign / leftover CAS / leftover type dump / leftover later factory already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleSchemasService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a collection **adapter** so “the catalog owns a desk.” Do not invent a selected-database getter **adapter** so “catalog matches Receipt.” Do not invent a CRUD folder so `enums.ts` / `provenance.ts` / `revision.ts` / `channel.ts` each get a file.

Do not move `assertChannelOperationId` into leftover `capture.ts` so “the inserter owns the id rule.” Do not move `applyLeadProvenanceGuards` into leftover `FormLead.ts` so “Form owns immutability.” Do not merge this file into leftover `types.ts` so “one file owns unions and mongoose enums.” Do not merge this file into leftover later `granotDiscrepancyModel.ts` so “the factory owns the word catalog.” Do not merge this file into already-recommended `schemaHelpers.ts` so “one helper owns every shared field.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `OBSERVATION_CHANNELS` / `ROUTE_EVENT_CLASSES` / `CHANNEL_OPERATION_KINDS` / `OBSERVATION_KINDS` / `RECEIPT_WORK_STATES` / `SYNCHRONIZATION_OUTCOMES` / `SYNCHRONIZATION_REASON_CODES` / `EXECUTION_MODES` / `GRANOT_LIFECYCLE_DISPOSITIONS` | `theLegalGranotLifecycleWords` | mongoose enums and leftover metrics share one tuple |
| `FORM_LEAD_INGESTION_ORIGINS` / `CALL_LEAD_INGESTION_ORIGINS` / `ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS` / `ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS` | `storedVsAssignableIngestionOrigins` | new rows refuse `legacy_unknown`; leftover migration may still write it |
| `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` | `fieldsPublicLeadDtosMustStrip` | leftover `omitForbiddenLeadLifecycleFields` deletes these keys |
| `formLeadProvenanceSchemaFields` / `callLeadProvenanceSchemaFields` / `aggregateRevisionSchemaFields` | `leadProvenanceAndRevisionFieldBags` | Form / Call / Booking / Cancellation still spread storage-only fields |
| `applyLeadProvenanceGuards` / `applyAggregateRevisionGuards` | `refuseIllegalProvenanceAndRevisionMutation` | mongoose `pre("validate")` on those desks |
| `granotReceiptProcessingSchema` / `granotReceiptLastErrorSchema` | `receiptDurableWorkShape` | already-recommended envelope nests `processing.*` |
| `assertChannelOperationId` / `assertReceiptChannelShape` / `isAutomationOperationId` | `channelOperationIdentityRules` | envelope validate, leftover extension Zod, leftover automation statement, leftover normalize |
| `ENTITY_REF_MODELS` / `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` / `GRANOT_BOOKING_RECONCILIATION_MODES` / `GRANOT_LEAD_MODELS` / `RECORD_LINK_STATES` / `GRANOT_LIFECYCLE_ACTIVATION_KEY` / `RECEIVER_AGENT_SOURCES` | `leftoverDeskCatalogs` | already-recommended desks leftover-ask these tuples |

Keep the old names as one-line aliases until Form / Call / envelope / leftover metrics / leftover assign / leftover Zod migrate. Do not make callers learn `satisfies` / `CONTROL_OR_BIDI` / `useDb` as the domain language. Do **not** delete `isAutomationOperationId` so “only `assertChannelOperationId` exists” until leftover tests that import the helper migrate. Do **not** re-export leftover `types.ts` unions from this file so “Zod should import the catalog.” Do **not** export a selected-database getter so “catalog matches Receipt.”

**No class for the workflow.** The one type that *does* earn a name is the pending catalog identity contract:

```ts
type SharedGranotLifecycleCatalogIdentity = {
  collection: false
  selected_database_getter: false
  types_ts: "satisfies_unions_does_not_own_them"
  new_lead_origin: "never_legacy_unknown"
  ingested_snapshots: "immutable_after_insert"
  change_history_started_at: "write_once_server_stamped"
  last_change_id_and_at: "both_or_neither"
  public_job_no: "not_forbidden"
  webhook_channel: { route_event_class: true; channel_operation_kind: false }
  extension_channel: { lowercase_uuid_v4: true; route_event_class: false }
  automation_channel: { first_colon_run_then_action: true }
}
```

That is the handoff from “this process remembered the legal words and the storage-only bags” to “Form / Call / the envelope leftover-ask those contracts, leftover assign leftover-strips the forbidden list, and leftover capture leftover-inserts only after the channel rules pass.” Do **not** add `{ collection: "granot_lifecycle_schemas" }` so “the catalog is a desk.” Do **not** add `{ ingestion_origin: { client_writable: true } }` so “public create can prove origin.” Do **not** add `{ channel_operation_id: { unique_here: true } }` so “the catalog owns envelope uniqueness.”

Leave already-recommended `FormLead.ts` / `CallLead.ts` / `GranotObservationReceipt.ts` on those files. Leave leftover `types.ts` on that file. Leave leftover `leadIngestionProvenance.ts` on that file. Leave leftover later `granotDiscrepancyModel.ts` on that file. Leave leftover CAS on `aggregateRevision.ts`. Leave leftover capture on `capture.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotLifecycleSchemas.ts
// When Granot evidence or a Lead write needs a legal word,
// a nested provenance snapshot, a revision pair,
// or a channel-operation id, hold those contracts here.
// Form and Call spread the field bags.
// Booking and Cancellation spread revision only.
// The envelope leftover-asks the processing shape and the channel rules.
// New Leads cannot be legacy_unknown.
// Ingested snapshots cannot change after insert.
// change_history_started_at is server-stamped and write-once.
// Webhook receipts must look like route deliveries.
// Extension ids must be lowercase UUID v4.
// Automation ids must be run plus action.
// This file is not a collection.
// Do not capture.
// Do not normalize.
// Do not decide.
// Do not assign Ingestion Origin.

import type { ObservationChannel, ReceiptWorkState, /* … */ } from "../services/granotLifecycle/types"

// ── 1. Hold the shared Granot lifecycle word catalog ──────

export const OBSERVATION_CHANNELS = [ /* webhook, extension, automation */ ]
export const ROUTE_EVENT_CLASSES = [ /* lead_created, priority_updated, booking_status_changed */ ]
export const SYNCHRONIZATION_REASON_CODES = [ /* includes leftover release_case_* */ ]
export const ENTITY_REF_MODELS = [ /* Form/Call/Booked/Cancelled + link + cases + desks */ ]
export const GRANOT_RECONCILIATION_EVIDENCE_ACTIONS = [
  "priority_5",
  ...GRANOT_RECONCILIATION_ACTION_KINDS,
]
function rememberTheLegalWordsWithoutOwningACollection()
function leaveReleaseCaseReasonsOnTheCatalogAfterProcessorStoppedOpeningThem()

// ── 2. Hold the Lead provenance and revision bags, refuse illegal mutation

export const formLeadProvenanceSchemaFields
export const callLeadProvenanceSchemaFields
export const aggregateRevisionSchemaFields
export const PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS
export function applyLeadProvenanceGuards(schema)
  // new: refuse legacy_unknown / legacy_baseline
  // existing: refuse ingestion_origin + ingested snapshots when the path exists
export function applyAggregateRevisionGuards(schema)
  // last_change_id and last_changed_at both or neither
  // new: stamp change_history_started_at
  // existing: write-once boundary

// ── 3. Hold the receipt processing shape and assert channel-operation identity

export const granotReceiptProcessingSchema
export function assertChannelOperationId(value, channel)
export function isAutomationOperationId(value)
  // first colon splits run_id / action_id
export function assertReceiptChannelShape(input)
  // webhook: route class, no kind
  // extension / automation: kind + id, no pretend route
```

Read the primary path out loud: *When Granot evidence or a Lead write needs a legal word, a nested provenance snapshot, a revision pair, or a channel-operation id, hold those contracts here. Form and Call spread the field bags. Booking and Cancellation spread revision only. The envelope leftover-asks the processing shape and the channel rules. New Leads cannot be `legacy_unknown`. Ingested snapshots cannot change after insert. `change_history_started_at` is server-stamped and write-once. Webhook receipts must look like route deliveries. Extension ids must be lowercase UUID v4. Automation ids must be run plus action. This file is not a collection. Do not capture. Do not normalize. Do not decide. Do not assign Ingestion Origin. Do not merge the type dump. Do not merge the leftover later discrepancy factory.*

That is the operation. `granotLifecycleSchemas` as “a bag of enums” is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the shared catalog. It is not a desk, not capture, and not assign.** Already-recommended envelope / Form / Call own collections. Leftover `capture.ts` leftover-inserts. Leftover `leadIngestionProvenance.ts` leftover-assigns origin. Do not move those in so “the catalog owns leftover persist.” Do not add `getGranotLifecycleSchemasModel()` so “catalog matches Receipt.”

2. **Dual catalog: leftover `types.ts` unions vs these `satisfies` tuples.** Wave A skipped `types.ts` as type-only. Leftover metrics leftover-imports tuples here and leftover-imports types there. Leftover persist leftover-types `reason_code` from `types.ts`. Do not merge `types.ts` into this file from this rename so “one file owns unions and mongoose enums.” Do not drop the `satisfies` so “the tuples can drift.” Leave both until a later catalog pass.

3. **`GRANOT_BOOKING_ACTIONS` and `GRANOT_RECONCILIATION_ACTION_KINDS` are the same two words.** One enums Observation booking action. The other builds evidence actions with `priority_5`. Do not delete one so “one booked/release tuple owns every desk.” Do not add `priority_5` onto `GRANOT_BOOKING_ACTIONS` so “Observation matches the case.”

4. **`GRANOT_LEAD_MODELS` here vs leftover `schemaHelpers` `LEAD_MODELS`.** Both are `FormLead` / `CallLead`. Booking / Cancellation leftover-ask the helper. Record Link / leftover later factory leftover-ask this tuple. Do not merge them so “one Lead-model enum owns Sheet hints and Record Links.”

5. **`release_case_opened` / `release_case_refreshed` remain on the reason catalog.** Live processor no longer opens Release cases. New Release evidence lands on the Booking case. Historical leftover persist / leftover Owner reads can still name those reasons. Do not delete them from this rename so “the processor retirement wins.” Do not start opening Release cases from this file so “the catalog still lists the reason.”

6. **Effect kinds are generic `discrepancy_opened` / `discrepancy_refreshed`. Reason codes split booking / release.** Leftover Decision leftover-enums both. Do not split effect kinds from this rename so “effects match reasons.” Do not collapse reason codes so “one discrepancy word owns both desks.”

7. **`job_no` is in `LEAD_PROVENANCE_FIELD_NAMES` and not in `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS`.** Public Form / Call / Booking DTOs still accept Job Number. `normalized_job_no` is forbidden on public create/update. Do not add `job_no` to the strip list so “public create cannot name the Job.” Do not drop `normalized_job_no` from the strip list so “clients can stamp the fold.”

8. **`applyLeadProvenanceGuards` leftover-checks `ingested_move_snapshot` on Call via `schema.path(path)`.** Call has no that path, so the immutable loop leftover-skips it. New Call leftover-still leftover-refuses `legacy_baseline` on a move snapshot **if one were set** (`this.get` does not require the path). Do not add `ingested_move_snapshot` onto `callLeadProvenanceSchemaFields` so “Call matches Form.” Do not drop the `schema.path` guard so “Call validate leftover-invents a move snapshot field.”

9. **`quoted` lives on `callLeadProvenanceSchemaFields` and is also a leftover public Call business field.** Leftover assign leftover-forces `quoted: false` on trusted Granot create. Public Call DTOs still send `quoted`. `PUBLIC_LEAD_FORBIDDEN` does **not** include `quoted`. Do not add `quoted` to the strip list so “extension cannot mark quoted.” Do not move `quoted` out of the Call bag so “provenance matches Form.”

10. **`RECEIVER_AGENT_SOURCES` lives here though it is Lead attribution, not Granot evidence.** Form / Call leftover-enum `receiver_agent_source` from this tuple (`granot_username_match` plus leftover extension / sheet / manual). CallLead comment still says `receiverAgentSourceEnum`. Do not move this tuple into leftover `schemaHelpers.ts` from this rename so “attribution matches Source Company.” Do not drop `extension_crm_username_match` so “only Granot username remains.”

11. **`AUTHENTICATION_METHODS` allows `legacy_unknown`. Leftover capture never writes it on a new webhook.** Proven methods are `body_secret` / `header_secret` / `extension_session` / `automation_owner_approval`. Do not delete `legacy_unknown` from this rename so “every stored receipt leftover-matches live capture.” Do not let leftover webhook capture write `legacy_unknown` so “the catalog allows it.”

12. **Automation identity leftover-splits on the first colon.** Leftover receipt test leftover-accepts `run-1:booked_reconciliation:row-1`. `isAutomationOperationId` leftover-puts leftover extra leftover-colons leftover-on leftover `action_id`. Do not require exactly one colon from this rename so “action ids cannot nest.” Do not move the helper into leftover `lifecycleStatement.ts` so “automation owns the rule.”

13. **There is no `granotLifecycleSchemas.test.ts`.** Channel proofs live on `GranotObservationReceipt.test.ts`. Provenance / revision proofs live on Form / Call / `granotAggregateRevisions.test.ts`. Do not move those desk tests here so “the catalog owns leftover Form validate.” Add catalog-level proofs on **this** interface later (tuples `satisfies` / assignable excludes `legacy_unknown` / forbidden list excludes `job_no` and includes revision names).

14. **This file has no collection, no getter, no `autoIndex`, no named-index catalog.** Envelope / Form / Decision own those. Do not add `autoIndex: false` onto a nonexistent schema so “catalog matches Form.” Do not add `GRANOT_LIFECYCLE_SCHEMA_INDEXES` so “migration leftover-asks every file.”

15. **Leave sibling modules alone.** `captureChannelOperationReceipt`, `omitForbiddenLeadLifecycleFields`, `compareAndSwapAggregateRevision`, `createGranotDiscrepancyModel` are already the right **depth**. This file holds the shared words and bags.

## Testing

The **interface** is the test surface: the exported catalogs, field bags, two guard functions, processing schemas, and `assertChannelOperationId` / `assertReceiptChannelShape` / `isAutomationOperationId`.

Today there is **no** `granotLifecycleSchemas.test.ts`. Neighbor desks already name part of the operation:

**Hold the shared word catalog**
- `SynchronizationDecision.test.ts` leftover-asks leftover invented outcome refuse and leftover `historical_shadow` / `record_link_established` membership.
- `GranotObservation.test.ts` leftover-asks leftover kind / issue-code tuples.

**Hold the provenance and revision bags, refuse illegal mutation**
- `FormLead.test.ts` / `CallLead.test.ts` leftover-ask leftover new-row `legacy_unknown` / `legacy_baseline` refuse, leftover immutable origin / ingested contact, leftover origin tuples, leftover `PUBLIC_LEAD_FORBIDDEN` includes `ingestion_origin`, leftover `RECEIVER_AGENT_SOURCES` deep-equal.
- `granotAggregateRevisions.test.ts` leftover-asks leftover default `domain_revision` `0`, leftover one-sided `last_change_*` refuse, leftover server history boundary, leftover write-once boundary, leftover public Zod reject of `AGGREGATE_REVISION_FIELD_NAMES`, leftover historical schemas gain **no** revision fields.

**Hold the receipt processing shape and assert channel-operation identity**
- `GranotObservationReceipt.test.ts` leftover-asks leftover extension UUID / leftover automation first-colon / leftover control-bidi / leftover webhook-forbids-kind / leftover extension-requires-id.

Add on **this** interface (do not invent helper-unit tests):

- `ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS` / `ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS` exclude `legacy_unknown` and stay subsets of the stored origin tuples.
- `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` includes every `AGGREGATE_REVISION_FIELD_NAMES` entry and `normalized_job_no`, and excludes `job_no`.
- `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS` is `priority_5` plus `GRANOT_RECONCILIATION_ACTION_KINDS`.
- `assertReceiptChannelShape` leftover-refuses leftover webhook + leftover kind, leftover extension + leftover route class, leftover automation without leftover id.

Do **not** add a test per helper (`rememberTheLegalWordsWithoutOwningACollection`, `leaveReleaseCaseReasonsOnTheCatalogAfterProcessorStoppedOpeningThem`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** move `FormLead.test.ts` / `GranotObservationReceipt.test.ts` / `granotAggregateRevisions.test.ts` onto this file so “the catalog owns leftover Form validate.” Those stay on those desk **interfaces**.

Do **not** add a leftover capture replay / leftover CAS conflict / leftover origin-derive test here. Those live on leftover `capture.ts` / leftover `aggregateRevision.ts` / leftover `leadIngestionProvenance.ts`.

## What I would not do

- A `GranotLifecycleSchemasService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `enums.ts` / `provenance.ts` / `revision.ts` / `channel.ts` / `processing.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Leftover capture already inserts the envelope before `202`; leftover assign already stamps origin before commit; leftover CAS already filters `{ _id, domain_revision }` inside the command transaction — do not move those writes into this file so “the catalog owns leftover persist.”
- Treating `captureGranotLifecycleWebhookReceipt` / `captureChannelOperationReceipt` / `upsertGranotObservation` / `deriveFormLeadIngestionOrigin` / `compareAndSwapAggregateRevision` / `createGranotDiscrepancyModel` as this story.
- Inventing a collection **seam** that has only one **adapter**.
- Silently "fixing" the dual `types.ts` catalog / leftover `release_case_*` reasons / dual booked-release tuples / dual Lead-model tuples / first-colon automation split / missing dedicated test file while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into leftover `types.ts` so “one file owns unions and mongoose enums.”
- Merging this file into leftover later `granotDiscrepancyModel.ts` so “the factory owns the word catalog.”
- Merging this file into already-recommended `schemaHelpers.ts` so “one helper owns every shared field.”
- Merging this file into already-recommended `GranotObservationReceipt.ts` so “the envelope owns the channel rules.”
- Adding `getGranotLifecycleSchemasModel()` so “catalog matches Receipt.”
- Adding `job_no` to `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` so “public create cannot name the Job.”
- Deleting `release_case_opened` / `release_case_refreshed` so “the processor retirement wins.”
- Requiring exactly one colon on automation ids so “action ids cannot nest.”
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
- Treating leftover later `granotDiscrepancyModel.ts` as this story.
