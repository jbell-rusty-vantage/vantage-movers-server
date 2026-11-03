---
type: Service
title: Google Sheets Service
description: Tab routing, projections, upsert/delete, and master versus source writes.
tags: [sheet-sync, google-sheets]
status: draft
stale_after: 2026-12-03
resource: src/services/googleSheets/googleSheets.service.ts
applies_to:
  - src/services/googleSheets/googleSheets.service.ts
  - src/services/googleSheets.service.ts
  - src/services/googleSheets/targets.ts
  - src/services/googleSheets/syncRows.ts
  - src/services/googleSheets/deleteRows.ts
  - src/services/googleSheets/projections/formLeadRow.ts
  - src/services/googleSheets/projections/callLeadRow.ts
  - src/services/googleSheets/leadReportingTargets.ts
  - src/services/googleSheets/tabMigration.ts
  - src/services/sheetSync/writerFence.ts
  - src/services/googleSheets/expectedSheetTabs.ts
  - src/services/googleSheets/sheetContains.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/googleSheets/googleSheets.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T03:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/googleSheets/googleSheets.service.ts` (facade: `src/services/googleSheets.service.ts`)  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md), [Source Company Sheet](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Bad Lead](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md)

# Google Sheets Service

**Role:** Projects Mongo Form Leads, qualified Call Leads, official Bookings and Cancellations into Reporting Sheets. Mongo remains the System of Record. November 3 reporting corrections are implemented in this checkout; deployment, physical tab migration, derivative formulas and production membership qualification require separate release evidence.

**Facade:** `src/services/googleSheets.service.ts` re-exports `googleSheets/googleSheets.service.ts`. Legacy sync uses the facade; queued `sheetSync/drainer/jobPlanner.ts` uses the same reporting policy and target definitions through the batch writer.

## Lead classifications and stable targets

| Entity / primary disposition | Master Leads tab | Stable target | Headers |
| --- | --- | --- | --- |
| Ordinary Form | Forms | `master_forms` | `FORM_SHEET_HEADERS` |
| Duplicate Form | Duplicate Forms | `master_duplicates` | `FORM_SHEET_HEADERS` |
| Supplemental bad Form | Bad Form Leads | `master_bad_leads` | `FORM_SHEET_HEADERS` |
| Ordinary qualified Call | Calls | `master_calls` | `CALL_SHEET_HEADERS` |
| Effective duplicate Call | Duplicate Calls | `master_duplicate_calls` | `CALL_SHEET_HEADERS` |
| Bad qualified Call | Bad Call Leads | `master_bad_calls` | `CALL_SHEET_HEADERS` |

`getCallLeadReportingDecision` in `leads/callLeadReportingDisposition.ts` owns Call disposition. Saved RingCentral qualification is mandatory. Unmatched/unqualified Calls are excluded even through direct facade sync. Effective duplicate means canonical repeat-call `duplicate`, canonical `form_fill`, or a trusted imported duplicate review; it takes precedence over bad. Bad includes a trusted imported bad review or an evidenced final caller-side missed result arriving during `[01:00, 07:00)` on the `America/New_York` clock. This layer does not change qualification, fabricate duration, or rewrite the repeat-call `duplicate` flag.

Forms retain their primary Forms/Duplicate Forms row. Canonical `bad_lead` or a fully trusted imported `bad_form` review adds a Bad Form Leads row, including booked/cancelled/duplicate Forms. Imported `raw_value` is displayed in the existing Bad Lead column as inert text under `USER_ENTERED`; no new columns are added. Clearing the bad fact deletes both old/new supplemental titles even when `sheet_sync[]` is empty.

Ordinary `no_sync` leads are suppressed. Effective duplicate/bad Calls and bad/duplicate Forms still project. An ordinary No-Sync Call cleans all three Call destinations; ordinary No-Sync Forms retain the existing normal-Forms-only delete behavior. Excluded Call sync returns no writes; an operator removing preexisting excluded rows must explicitly invoke `deleteCallLeadFromSheets`.

## Bookings and Cancellations

Official Bookings project to Master Booked / Booked Deals (`master_booked`), and Cancellations to Cancelled Deals (`master_cancelled`). Their financial values and independent reporting eligibility do not change with source Lead disposition. Booking/Cancellation Chain jobs refresh the official rows and then use the current source Lead policy. Referral/leadless jobs can write only the official row.

## Delivery and recovery

- All three Call destinations use the same `callLeadToRow` and exact 15-column `CALL_SHEET_HEADERS`; missing duration stays blank. Form headers retain their 22-column order. `Sales Rep` remains the saved `receiver_agent_name_snapshot`.
- Desired membership is upserted by the **Mongo ID column**, then that ID is removed from the other two Call tabs. Row numbers are hints; phone numbers and foreign IDs elsewhere in a row are never move identities.
- A failed/deferred destination fences stale deletes. The queued writer completes upserts first, then deletes. A destination-written/stale-delete-failed interruption remains pending and retries without another append.
- Physical duplicate IDs are repaired from canonical Mongo values: update one desired row, remove extra copies, and remove every stale copy in descending row order. Repairs are logged. Overlapping jobs for the same ID and identical payload share a physical write while each job receives an outcome; conflicting current payloads fail closed.
- Missing tabs are an idempotent no-op on deletes and are never auto-provisioned by a delete. Upserts ensure only their written tab; bootstrap handles full provisioning. Append requires Google confirmation.
- Hard Call deletes and tombstones enumerate all three destinations. Form deletes enumerate primary/supplemental destinations plus both transitional Form titles. Historical `sheet_sync[]` locations participate, including source locations when current dual writing is disabled. Booking/Cancellation rows are not lead-move targets.
- A durable command or outbox receipt does not prove sheet membership. Owner contains and the release verifier read live rows by ID. Contains checks the other two Call tabs so stale membership is visible.

## Title compatibility and migration

Canonical `SHEET_TAB_NAMES` are Forms, Calls, Duplicate Forms, Duplicate Calls, Bad Form Leads and Bad Call Leads. Stable target keys are retained. `Duplicates` and `Bad Leads` are historical Form titles; unused `Bad Calls` is not provisioned.

`resolveCompatibleSheetTitle` temporarily uses the existing old Form tab before cutover and resolves historical old-title requests to the new title afterwards. Both titles existing is an explicit topology conflict; writers do not silently pick one. Legacy aliases are never cached, so warm remote isolates observe cutover without an operator-local reset. Canonical resolution/header caches are cleared with `resetEnsuredTabsCache` after migration.

`tabMigration.ts` provides a pure checksummed numeric-ID plan, read-only inspection, and explicit fenced apply. Existing tabs are renamed in place, preserving formatting, filters, protections and history; only the new Bad Call Leads tab is added when needed. The apply helper rejects topology drift/conflicts, repairs headers, verifies topology, and a repeated successful apply does no writes. Legacy source Bad Calls can be renamed in place. Derivative IMPORTRANGE/QUERY strings require a separate inventory/repair and representative readback; the helper does not claim that qualification.

## Temporary writer fence

`sheetSync/writerFence.ts` reads the durable `SheetSyncLease` scope **`lead-reporting:tab-migration`**, active while `leased_until` is in the future. Every legacy/direct lead upsert and delete boundary checks it before Google writes; bootstrap provisioning checks it too. A held lease raises retryable `lead_sheet_tab_migration_in_progress`. Failure to read the lease fails closed. No env toggle, cached result or public bypass disables this guard. Direct official Booked/Cancelled targets remain independent.

Queued drains skip before claiming jobs while the fence is held; a drain already planning rechecks immediately before delivery, releasing claims for retry on rejection. The outbox is retained. Operator order is deploy compatible writers, acquire the topology fence plus `sheet-sync:drain` lease, wait out older invocations, rename by numeric ID and repair derivatives through operator Google APIs, clear caches, verify headers/formulas/membership, then release both leases. Renew leases throughout the operation. The fence alone does not abort Google requests already in flight.

## Master and Source Company Sheets

Master targets always come first. Source Company Sheets are normally derivatives; dual writes occur only when `WRITE_SOURCE_LEAD_SHEETS` is the literal trimmed/lowercased `true`. This setting is not changed by retirement. When enabled, source Calls use the same three-way disposition and source provisioning contains no duplicate tab definitions. The retired external tracker is not a reporting destination.

`not_provided` and `paid_overflow` have no source container. Mode-aware env names and TEST prefixes remain in `config/domain/{sheets,runtime}.ts`; existing credential and Master IDs are retained.

## Public operations and verification

`syncFormLeadToSheets`, `syncCallLeadToSheets`, `syncBookedLeadToSheets`, `syncCancelledLeadToSheets` return target outcomes. Corresponding delete functions remove matching IDs. `ensureAllConfiguredSheetTabs` provisions reporting containers. Owner-only `POST /api/v1/admin/sheet-sync/contains` is read-only and does not trust metadata or enqueue writes (maximum 25 IDs).

Focused offline tests: `googleSheets/**/*.test.ts` and `sheetSync/**/*.test.ts`, including migration replay, ambiguous titles, qualification/no-sync routing, inert imported notes, destination/delete interruption recovery, physical duplicate repair and writer-fence lease boundaries. Production release still requires independent per-ID membership, formula and billing readback.

## Related services

- [Sheet Sync](./sheet-sync.md): scheduling, leases, queued retries and metadata.
- [Call Leads](./call-lead.md), [Form Leads](./form-lead.md): domain writes and qualification.
- [Bookings](./bookings.md), [Cancellations](./cancelled-lead.md): official outcome chains.
- [Sheet Sync rule](../../../.cursor/rules/sheet-sync-process.mdc): modes, envs and quotas.
