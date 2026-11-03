---
type: Service
title: Best Relocation Ingestion
description: Retired recurring Best Relocation ingestion; read-only evidence and a scoped final-reconciliation engine remain.
tags: [ingestion, best-relocation]
status: retired
stale_after: 2026-09-21
resource: src/services/ingestion/applyPlan.ts
applies_to:
  - src/services/ingestion/applyPlan.ts
  - src/services/ingestion/worker.ts
  - src/services/ingestion/repository.ts
  - src/services/ingestion/health.ts
  - src/services/bestRelocationSheetIngest/
  - scripts/best-relocation-sheet-ingest.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/ingestion/applyPlan.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-03T18:43:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/ingestion/`, `src/services/bestRelocationSheetIngest/` (`canonicalLeadAdoption.ts`, `sheets.ts`, `dryRunReports.ts`)  
**CLI:** `scripts/best-relocation-sheet-ingest.ts` (`pnpm ingest:best-relocation -- --dry-run`)  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Best Relocation Ingestion

Recurring ingestion is permanently fenced in this build. This is implementation evidence, not a claim that final reconciliation or production cutover has completed.

The old queue worker acknowledges delayed deliveries with `status: retired` before Mongo or source reads. The publisher cannot send; the Vercel queue trigger and heartbeat cron are removed. The compatibility heartbeat acknowledges `reason: retired` without work. Old HTTP mutations return `410 / BEST_RELOCATION_RETIRED` after Owner authentication; stored connection/run/conflict GETs remain readable. Admin Setup and the old ingestion dashboard have no activation, preview, apply, retry or identity-repair controls. Setting the old environment flag cannot resume ingestion. Legacy direct HTTP apply throws before any request.

MongoDB remains the System of Record. Historical Leads, source routes, receipts, links, Bookings and Cancellations remain; legitimate Granot matching and lifecycle updates continue.

## Scoped final reconciliation

`applyBestRelocationPlan` remains the canonical command/checkpoint engine for archived operator tooling. The retired default rejects callers without an explicit `final_reconciliation: { run_id, plan_checksum }` matching the input, an Owner initiator, and an `assertApplicationEnabled` callback. That callback must check the live connection retirement marker and held final-run lease. It runs before processing and before every action/checkpoint. No HTTP or recurring worker exposes this exception. Replay repairs physical Sheet membership independently because canonical command replay correctly emits no new outbox intent.

The final import creates Forms with CRM posting and SMS consent forced off at the canonical create boundary. New imported Forms and final imported Calls carry the protected immutable `outreach_automation_suppressed` audit marker. Shared `isImportOutreachSuppressed` holds new automatic intake, expansion and Pool admission until a protected accepted Granot observation has a capture time strictly after the Lead's `createdAt`. Missing, old or simultaneous observation evidence stays held; the imported business timestamp never releases it. A later accepted observation restores the ordinary eligibility/closure/source/identity checks, rather than granting admission by itself. Existing historical subjects, Pool membership, explicit Owner-reviewed enrollment/selected-ID activation and ordinary intake retain their contracts.

The [November 3 Owner clarification](../../lead-reporting-retirement/OWNER-CLARIFICATION.md) supersedes the earlier universal RingCentral-only assumption for Best Relocation Calls. `admitBestRelocationFinalCall` (`src/services/domainCommands/bestRelocationFinalCall.ts`) is a narrow final-import command, integrated into the apply engine as `admit_final_best_relocation_call`. It compares the complete action to the approved stored frozen plan, pins the tracker Calls tab and canonical Best Relocation company/feed, and holds the applying run, unretired connection and ingestion lease epoch inside the Mongo transaction. The resulting immutable `external_call_admission` records real source arrival, stable source identity/hash, run and receipt; it never invents RingCentral metadata. Live Granot, manual and recurring external Call creation remain blocked.

Existing Calls require exact receipt ownership or normalized phone plus real arrival in the same canonical company/feed. If an identity group contains one original and duplicate copies, the original is the primary; separately approved `call_aliases` actions can admit the existing duplicate copies only after verifying their original group and primary action. Adoption preserves RingCentral metadata, duplicate flags, thresholds and historical lifecycle fields, adding only admission and factual Form Fill. Newly created exception Calls derive their review fact from the frozen checker and reuse the normal duplicate/Form Fill, CPL, revision and Sheet Sync pipeline. Newly created ordinary Calls additionally require `reviewed_for_insert=true` and `approval.normal_call_insert_approval` equal to the final source plan checksum. Without that explicit Owner approval they remain held; a preview is not authorization to insert.

This admission extension has focused unit/apply tests and a disposable local replica proof for lease rollback, legacy revision initialization, immutable attach, exception creation and replay. It has not been qualified as a production import. The latest Owner direction holds the entire Best Relocation source apply, including selective application; no production create/apply is implied by these tests.

## Durable retirement cutover

`retireBestRelocationConnectionAndSources` (`src/services/ingestion/retireBestRelocation.ts`) is operator-only. Final cutover follows captured final-run outcomes (including explicit conflicts) and release of the final runner's apply lease. Input is the inventoried canonical company ID, every applicable Granot CRM Source ID, final-run reference, reconciliation status (`complete` or `incomplete`, defaulting to `incomplete`) and Owner durable actor. It acquires `ingestion:best_relocation:apply`; an active lease or an old run reporting a live lease blocks cutover for checkpoint inspection. Its transaction:

- verifies the canonical `best_relocation_leads` company and the complete source inventory (company IDs plus exact normalized Forms/Locals/Inbounds labels, including joined `BestRelocation` variants);
- persists company/source retirement markers, changes policies to `link_only`, installs the retired source policy version and disables new-lead confirmation texts;
- marks the connection retired with final-run reference and honest reconciliation status, `application_enabled=false`, and `next_due_at=null`;
- terminally skips old queued, inspecting, planning, awaiting-approval, applying and failed runs, preserving their plans/checkpoints as evidence.

The runtime source resolver forces `link_only` for the canonical company slug, durable source/company markers, and exact known labels even if an old migration reinstalls `create_if_missing`. The transactional Granot create executor re-resolves this live policy, so stale decisions cannot mint Leads. Setup/registry semantic validation rejects re-enable, and dispatch rechecks queued Granot confirmation texts against retirement before provider send. Unrelated sources retain legitimate Form creation.

Record live registry before/after IDs, labels, routes and policy versions in restricted final-run evidence. Preserve shared credentials and Master Sheet IDs; ingestion-only workbook IDs remain available only to explicit archived final tooling. Recurring retirement alone is not a clean final ingestion: report **retired; final reconciliation incomplete** while data conflicts, membership proof or second-run idempotency remain unresolved.

Retiring ingestion and Granot creation policies does not deactivate the Best Relocation Source Company. The Owner retains that later decision; keep the company active and preserve historical link/update and official Booking/Cancellation processing.

The separate `shutdownBestRelocationWithoutIngestion` helper (`ops/best-relocation-retirement/shutdown.ts`) supports the Owner's stop-now / inspect-source-later direction. It passes explicit `reconciliation_status: deferred` to the same transactional policy cutover, with a shutdown evidence ID rather than a claimed final ingestion run. It disables scheduling/application, installs company/source creation retirement markers, disables source confirmation SMS and skips old actionable runs while retaining checkpoints. The connection records `retirement_shutdown_at`, `retirement_shutdown_run_id`, `retirement_reconciliation_status: pending_owner_review` and `retirement_ingestion_deferred: true`. It leaves `retired_at` and `retirement_final_run_id` empty so separately approved final manual work remains possible later. A fully retired connection cannot be reopened through deferred shutdown.

While that durable hold is true, every final aggregate write, including selective checker review, rejects an old approval. A future Owner release must set the applying run's `approval.owner_released_deferred_ingestion_checksum` to its exact SHA-256 `plan_checksum`; the ordinary final-run, connection and lease epoch checks still apply. Neither that release nor shutdown clears the hold, reenables scheduling or permits recurring/HTTP creation. Shutdown results explicitly report `source_apply_performed: false` and `source_company_deactivated: false`. Focused tests and the disposable local replica prove this behavior; the operator must separately record deployment and live shutdown verification.

## Local verification (not production qualification)

`node --import tsx ops/best-relocation-retirement/retirement.replica.ts` uses only local `127.0.0.1:27119`, replica `callReportingProof`, and a disposable `testvantagemovers_retirementproof<pid>` database. It proves exact variant/company inventory, active lease and live checkpoint refusal, transactional aggregate rollback on missing final approval/stale epoch/retired connection, null legacy SMS compatibility, durable company/ID policy enforcement, cancellation with checkpoint preservation, skipped queued confirmation before provider send, preserved official Booking, explicit incomplete reconciliation and repeat cutover without extra sources/runs. It drops only its own disposable database and leaves the shared local Mongo process running. Deployment, final source capture, real reconciliation, Sheet membership and former-heartbeat observation remain separate release gates.

## Reporting derivative formula migration

Archived operator helper `ops/best-relocation-retirement/derivativeFormulas.ts` exports `inspectDerivativeFormulas`, `applyDerivativeFormulas`, `verifyDerivativeFormulas` and `derivativeFormulaPlanChecksum`. Inspection resolves Master and every configured Source Company reporting workbook through the domain helpers, deduplicates destinations and records unconfigured destinations. The retired tracker and booked-source workbooks are excluded even if misconfigured as reporting destinations; a protected-ID conflict blocks apply. The distinct `BEST_RELOCATION_LEADS_SHEET_ID` reporting derivative remains eligible.

The checksum-bound restricted plan contains numeric source tab IDs and formula cells with before/after values, never customer cell contents. Reads page at 40,000 cells, with reviewed per-workbook limits of 100,000 rows, 702 columns, five million grid cells and 10,000 formulas; oversized scope fails closed. Exact literal `IMPORTRANGE` source/range arguments and direct local sheet-reference tokens are rewritten; QUERY labels, SQL strings, unrelated imports and arbitrary text remain unchanged. Dynamic affected imports, simultaneous old/new titles, concurrent formula edits and changed topology require review. Local tab renames preserve numeric IDs. A new direct-write `Bad Call Leads` source tab/header is provisioned only when the existing `WRITE_SOURCE_LEAD_SHEETS` setting was enabled and remains enabled; the helper never changes that setting.

The caller must hold both topology and drainer writer fences and supply a renewing `assertLease` callback for every provider call. Apply accepts original or already-applied cells/topology after interruption, writes formula changes with `USER_ENTERED`, and verifies every changed or Master-referencing formula against its recalculated `effectiveValue`, including provider error types and missing/pending results. Verification retries are bounded and returns `complete:false` while calculation errors remain. Local mocked tests cover exact references, protected workbooks, mutation-free inspection, stale plan refusal, effective errors, provisioning, interrupted rename resume and idempotent repeat apply. Real derivative calculation and permissions remain a production release proof.

Provider semantics: [Sheets range/field-mask reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [calculated cell values](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells), and [formula input parsing](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption).
