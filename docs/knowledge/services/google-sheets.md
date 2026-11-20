---
type: Service
title: Google Sheets Service
description: Tab routing, projections, upsert/delete, and master versus source writes.
tags: [sheet-sync, google-sheets]
status: draft
stale_after: 2026-12-19
resource: src/services/googleSheets/googleSheets.service.ts
applies_to:
  - src/services/googleSheets/googleSheets.service.ts
  - src/services/googleSheets.service.ts
  - src/services/googleSheets/targets.ts
  - src/services/googleSheets/tabs.ts
  - src/services/googleSheets/rowLookup.ts
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
  - src/services/sheetSync/drainer/deliveryRequests.ts
  - src/services/sheetSync/drainer/batchWriter.ts
  - src/services/sheetSync/drainer/tabRowMap.ts
  - src/config/domain/sheets.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/googleSheets/googleSheets.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
  - id: release-2026-11-19
    resource: docs/operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md
    title: Daily commands and Master Sheets release record
generated:
  by: process:docs-keeper
  at: 2026-11-19T23:30:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/googleSheets/googleSheets.service.ts` (facade: `src/services/googleSheets.service.ts`)  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md), [Source Company Sheet](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Bad Lead](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md)

# Google Sheets Service

**Role:** Projects Mongo Form Leads, reporting-eligible Call Leads, official Bookings and Cancellations into Reporting Sheets. Mongo remains the System of Record. On November 19 a read-only production read-back found all eight canonical tabs (Forms, Calls, Duplicate Forms, Duplicate Calls, Bad Form Leads, Bad Call Leads, Booked Deals, Cancelled Deals), and 40 sampled identities matched their canonical projections. That record does not qualify derivative IMPORTRANGE/QUERY formulas. [Release record](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md#master-leads-and-master-booked)

**Best Relocation reconciliation is complete:** the approved final exception cohort and official Bookings are verified in the [final reconciliation report](../../lead-reporting-retirement/FINAL-RECONCILIATION-2026-11-03.md). Recurring ingestion and Granot creation remain retired; this recovery slice authorizes no new import. Keep the Source Company active for the Owner's separate deactivation.

**Facade:** `src/services/googleSheets.service.ts` re-exports `googleSheets/googleSheets.service.ts`. Legacy sync uses the facade; queued `sheetSync/drainer/jobPlanner.ts` uses the same reporting policy and target definitions through the batch writer.

## Lead classifications and stable targets

| Entity / primary disposition | Master Leads tab | Stable target | Headers |
| --- | --- | --- | --- |
| Ordinary Form | Forms | `master_forms` | `FORM_SHEET_HEADERS` |
| Duplicate Form | Duplicate Forms | `master_duplicates` | `FORM_SHEET_HEADERS` |
| Canonical or trusted imported bad Form, including a Duplicate Form | Bad Form Leads only | `master_bad_leads` | `FORM_SHEET_HEADERS` |
| Ordinary qualified Call | Calls | `master_calls` | `CALL_SHEET_HEADERS` |
| Effective duplicate Call | Duplicate Calls | `master_duplicate_calls` | `CALL_SHEET_HEADERS` |
| Bad qualified Call | Bad Call Leads | `master_bad_calls` | `CALL_SHEET_HEADERS` |

`getCallLeadReportingDecision` in `leads/callLeadReportingDisposition.ts` owns Call disposition. Ordinary Calls require saved RingCentral qualification; the approved final Best Relocation import can instead attach protected source admission. Unmatched Calls and Calls lacking either admission are excluded even through direct facade sync. Effective duplicate means canonical repeat-call `duplicate`, canonical `form_fill`, or a trusted imported duplicate review; it takes precedence over bad. Bad includes a trusted imported bad review or an evidenced final caller-side missed result arriving during `[01:00, 07:00)` on the `America/New_York` clock. This layer does not change qualification, fabricate duration, or rewrite the repeat-call `duplicate` flag.

`hasFormBadProjection` and `formLeadTargets` in `leadReportingTargets.ts` route canonical `bad_lead` or a fully trusted imported `bad_form` review exclusively to Bad Form Leads, including booked/cancelled/duplicate Forms. Bad projection takes precedence over the duplicate destination while preserving the canonical duplicate and lifecycle flags. Other Forms keep their ordinary Forms/Duplicate Forms primary destination. The canonical formatted bad reason takes precedence in the existing Bad Lead column; otherwise imported `raw_value` is inert text under `USER_ENTERED`. No columns are added. Clearing the bad fact restores the ordinary primary destination and deletes both old/new bad-Form titles even when `sheet_sync[]` is empty.

Ordinary `no_sync` leads are suppressed. Effective duplicate/bad Calls and bad/duplicate Forms still project. An ordinary No-Sync Call cleans all three Call destinations. An ordinary No-Sync Form cleans Forms, Duplicate Forms and Bad Form Leads, including old Form titles; this also removes stale membership after a bad fact is cleared. Excluded Call sync returns no writes; an operator removing preexisting excluded rows must explicitly invoke `deleteCallLeadFromSheets`.

## Bookings and Cancellations

Official Bookings project to Master Booked / Booked Deals (`master_booked`), and Cancellations to Cancelled Deals (`master_cancelled`). Their financial values and independent reporting eligibility do not change with source Lead disposition. Booking/Cancellation Chain jobs refresh the official rows and then use the current source Lead policy. Referral/leadless jobs can write only the official row.

## Delivery and recovery

- All three Call destinations use the same `callLeadToRow` and exact 15-column `CALL_SHEET_HEADERS`; missing duration stays blank. Form headers retain their 22-column order. `Sales Rep` remains the saved `receiver_agent_name_snapshot`.
- Desired membership is upserted by the **Mongo ID column**, then that ID is removed from the other two Call tabs. Row numbers are hints; phone numbers and foreign IDs elsewhere in a row are never move identities.
- Forms and Duplicate Forms are mutually exclusive: re-delivering a Form whose `duplicate` flag flipped upserts the current primary, then deletes the same Mongo ID from the opposite primary (both old/new Duplicate Forms titles when it is no longer a duplicate) without relying on `sheet_sync[]`.
- Bad Forms are upserted to Bad Form Leads before the same Mongo ID is deleted from Forms and both old/new Duplicate Forms titles. `staleFormTargets`/`staleFormTargetKeys` and the queued planner discover these rows without saved metadata. Form retries replan the current destination and cleanup despite stale `target_hints`.
- A failed/deferred destination fences stale deletes. The queued writer completes upserts first, then deletes. A destination-written/stale-delete-failed interruption remains pending and retries without another append.
- Physical duplicate IDs are repaired from canonical Mongo values: update one desired row, remove extra copies, and remove every stale copy in descending row order. Repairs are logged. Overlapping jobs for the same ID and identical payload share a physical write while each job receives an outcome; conflicting current payloads fail closed.
- Queued append, row-delete and managed-value clear requests are single-attempt per known plan, including transport retries. An unconfirmed structural outcome stops further provider requests for that invocation and defers unresolved work; the next durable drain reloads current Mongo plans and physical IDs. Previously committed appends become updates, and reliably absent deleted IDs require no second positional delete. Missing/malformed confirmation, missing/ambiguous identity headers, failed reads or malformed topology cannot establish delivery/absence. Queued delivery reads the header row and the `Mongo ID` column in one `values.batchGet` per tab. Matching managed headers are not cleared or rewritten. A managed header prefix that differs from the expected headers blocks the upsert for operator correction; confirmed new empty tabs can initialize. Shifted legacy ID lookup still serves deletes. See [queued recovery, limits and rollback](./sheet-sync.md#uncertain-structural-delivery-queued-only).
- The queued request boundary covers tab/header helpers and every explicit safe retry: reserve read/write quota, check deadline, drain lease and topology fence, then send with Google transport retry disabled. The legacy/direct retry helper is unchanged. A request already in flight can finish after ownership loss; no further writes or old-owner completion follow. No exactly-once network guarantee is made.
- Queued row removal rereads the identity and annotations of each row it removes. Plain rows are deleted. A row with operator values, notes, formulas or validation stays in place with its reporting `Mongo ID` and eligible managed values cleared. A protected row stops that removal until an operator resolves it. See [row removal](./sheet-sync.md#row-removal-and-operator-cells).
- Missing tabs are an idempotent no-op on deletes and are never auto-provisioned by a delete. Upserts ensure only their written tab; bootstrap handles full provisioning. Append requires Google confirmation.
- Hard Call deletes and tombstones enumerate all three destinations. Form deletes enumerate all three Form destinations plus both transitional Form titles. Historical `sheet_sync[]` locations participate, including source locations when current dual writing is disabled. Booking/Cancellation rows are not lead-move targets.
- A durable command or outbox receipt does not prove sheet membership. Owner contains and the release verifier read live rows by ID. Contains checks the other two Call tabs so stale membership is visible.

## Title compatibility and migration

Canonical `SHEET_TAB_NAMES` are Forms, Calls, Duplicate Forms, Duplicate Calls, Bad Form Leads and Bad Call Leads. Stable target keys are retained. `Duplicates` and `Bad Leads` are historical Form titles; unused `Bad Calls` is not provisioned.

`resolveCompatibleSheetTitle` temporarily uses the existing old Form tab before cutover and resolves historical old-title requests to the new title afterwards. Both titles existing is an explicit topology conflict; writers do not silently pick one. Legacy aliases are never cached, so warm remote isolates observe cutover without an operator-local reset. Canonical resolution/header caches are cleared with `resetEnsuredTabsCache` after migration.

`tabMigration.ts` provides a pure checksummed numeric-ID plan, read-only inspection, and explicit fenced apply. Existing tabs are renamed in place, preserving formatting, filters, protections and history; only the new Bad Call Leads tab is added when needed. The apply helper rejects topology drift/conflicts, repairs headers, verifies topology, and a repeated successful apply does no writes. Legacy source Bad Calls can be renamed in place. Derivative IMPORTRANGE/QUERY strings require a separate inventory/repair and representative readback; the helper does not claim that qualification.

## Temporary writer fence

`sheetSync/writerFence.ts` reads the durable `SheetSyncLease` scope **`lead-reporting:tab-migration`**, active while `leased_until` is in the future. Every legacy/direct lead upsert and delete boundary checks it before Google writes; bootstrap provisioning checks it too. A held lease raises retryable `lead_sheet_tab_migration_in_progress`. Failure to read the lease fails closed. No env toggle, cached result or public bypass disables this guard. Direct official Booked/Cancelled targets remain independent.

Queued drains skip before claiming jobs while the fence is held; a drain already planning rechecks immediately before delivery, releasing claims for retry on rejection. Queued requests also recheck at every provider boundary, including helpers and safe retries; newly fenced unfinished work is deferred. The outbox is retained. Operator order is deploy compatible writers, acquire the topology fence plus `sheet-sync:drain` lease, wait out older invocations, rename by numeric ID and repair derivatives through operator Google APIs, clear caches, verify headers/formulas/membership, then release both leases. Renew leases throughout the operation. The fence alone does not abort Google requests already in flight.

## Master and Source Company Sheets

Master targets always come first. Source Company Sheets are normally derivatives; dual writes occur only when `WRITE_SOURCE_LEAD_SHEETS` is the literal trimmed/lowercased `true`. This setting is not changed by retirement. When enabled, source Calls use the same three-way disposition and source provisioning contains no duplicate tab definitions. The retired external tracker is not a reporting destination.

`not_provided` and `paid_overflow` have no source container. Mode-aware env names and TEST prefixes remain in `config/domain/{sheets,runtime}.ts`; existing credential and Master IDs are retained.

## Public operations and verification

`syncFormLeadToSheets`, `syncCallLeadToSheets`, `syncBookedLeadToSheets`, `syncCancelledLeadToSheets` return target outcomes. Corresponding delete functions remove matching IDs. `ensureAllConfiguredSheetTabs` provisions reporting containers. Owner-only `POST /api/v1/admin/sheet-sync/contains` is read-only and does not trust metadata or enqueue writes (maximum 25 IDs).

Focused offline tests: `googleSheets/**/*.test.ts` and `sheetSync/**/*.test.ts`, including migration replay, ambiguous titles, qualification/no-sync routing, inert imported notes, destination/delete interruption recovery, physical duplicate repair and writer-fence lease boundaries. Production release still requires independent per-ID membership, formula and billing readback.

## Storage, indexes and read paths

This service owns no MongoDB collection. It writes Google Sheets and returns target outcomes; Sheet Sync stores them in `sheet_sync[]` on the domain document and in `sheet_sync_attempts`. Sheet Contains reads canonical documents by `_id` and open `sheet_sync_jobs` by `entity_model` and `entity_id` (index `entity_model_1_entity_id_1_status_1`). Collections, indexes and retention are in [Sheet Sync storage](./sheet-sync.md#storage-indexes-and-read-paths).

Google read paths:

| Caller | Identity read per tab | Notes |
|---|---|---|
| Queued drainer (`drainer/tabRowMap.ts`) | `values.batchGet` of row 1 plus the `Mongo ID` column | One read per tab group; two when the identity column has shifted |
| Legacy/direct sync (`rowLookup.ts`) | `values.get` of `A:ZZ` | Reads the whole tab for each lookup |
| Sheet Contains (`sheetContains.ts`) | `values.get` of `A:ZZ` | Reads whole tabs, up to 25 IDs per request |

On November 19, across the first 101 rows or fewer of each of the eight tabs, the wide and narrow responses were 124,885 and 21,055 uncompressed UTF-8 bytes. Identity counts that day were Forms 8,364, Calls 1,677, Duplicate Forms 195, Duplicate Calls 359, Bad Form Leads 1,040, Bad Call Leads 19, Booked Deals 1,071 and Cancelled Deals 47. The queued identity read grows with these counts. Legacy and Contains reads grow with full tab width as well. [Eight-tab baseline](../../operations/evidence/operations-command-sheets-verified-before.json)

Observation for the read phase: the legacy/direct facade and Sheet Contains still read `A:ZZ`. Their call frequency is unmeasured.

## Related services

- [Sheet Sync](./sheet-sync.md): scheduling, leases, queued retries and metadata.
- [Call Leads](./call-lead.md), [Form Leads](./form-lead.md): domain writes and qualification.
- [Bookings](./bookings.md), [Cancellations](./cancelled-lead.md): official outcome chains.
- [Sheet Sync rule](../../../.cursor/rules/sheet-sync-process.mdc): modes, envs and quotas.

**November 4 Call parity review:** [canonical billing policy](../../call-lead-billing.md#form-fill-convergence-and-final-evidence-ordering) owns company-scoped Form Fill, bounded transactional follow-up and final-result ordering. Reporting exclusions remain separate from Booking/Cancellation reporting and Desk eligibility. [Evidence and release limits](../../call-billing-review-2026-11-04.md).
