---
type: Service
title: Best Relocation Ingestion
description: Retired recurring Best Relocation ingestion; read-only evidence and a scoped final-reconciliation engine remain.
tags: [ingestion, best-relocation]
status: retired
stale_after: 2026-11-20
resource: src/services/ingestion/applyPlan.ts
applies_to:
  - src/services/ingestion/applyPlan.ts
  - src/services/ingestion/worker.ts
  - src/services/ingestion/repository.ts
  - src/services/ingestion/health.ts
  - src/services/bestRelocationSheetIngest/
  - src/services/domainCommands/bestRelocationFinalLead.ts
  - src/services/domainCommands/bestRelocationFinalCall.ts
  - ops/best-relocation-retirement/
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

Recurring ingestion is permanently fenced. The Owner-directed final reconciliation is complete in production through November 3, 2026 at 7:49:27 p.m. New York, including canonical application, physical financial readback, independent verification and unchanged same-plan replay. The connection records complete final reconciliation; the Source Company remains active for separate Owner deactivation. See the [final report](../../lead-reporting-retirement/FINAL-RECONCILIATION-2026-11-03.md) for the released checksum and qualification evidence. The operator contracts below do not release a further import.

The old queue worker acknowledges delayed deliveries with `status: retired` before Mongo or source reads. The publisher cannot send; the Vercel queue trigger and heartbeat cron are removed. The compatibility heartbeat acknowledges `reason: retired` without work. Old HTTP mutations return `410 / BEST_RELOCATION_RETIRED` after Owner authentication; stored connection/run/conflict GETs remain readable. Admin Setup and the old ingestion dashboard have no activation, preview, apply, retry or identity-repair controls. Setting the old environment flag cannot resume ingestion. Legacy direct HTTP apply throws before any request.

MongoDB remains the System of Record. Historical Leads, source routes, receipts, links, Bookings and Cancellations remain; legitimate Granot matching and lifecycle updates continue.

## Scoped final reconciliation

`applyBestRelocationPlan` remains the canonical command/checkpoint engine for archived operator tooling. The retired default rejects callers without an explicit `final_reconciliation: { run_id, plan_checksum }` matching the input, an Owner initiator, and an `assertApplicationEnabled` callback. That callback must check the live connection retirement marker and held final-run lease. It runs before processing and before every action/checkpoint. No HTTP or recurring worker exposes this exception. Replay repairs physical Sheet membership independently because canonical command replay correctly emits no new outbox intent.

The final import creates Forms with CRM posting and SMS consent forced off at the canonical create boundary. New imported Forms and final imported Calls carry the protected immutable `outreach_automation_suppressed` audit marker. Shared `isImportOutreachSuppressed` holds new automatic intake, expansion and Pool admission until a protected accepted Granot observation has a capture time strictly after the Lead's `createdAt`. Missing, old or simultaneous observation evidence stays held; the imported business timestamp never releases it. A later accepted observation restores the ordinary eligibility/closure/source/identity checks, rather than granting admission by itself. Existing historical subjects, Pool membership, explicit Owner-reviewed enrollment/selected-ID activation and ordinary intake retain their contracts.

The [November 3 Owner clarification](../../lead-reporting-retirement/OWNER-CLARIFICATION.md) supersedes the earlier universal RingCentral-only assumption for Best Relocation Calls. `admitBestRelocationFinalCall` (`src/services/domainCommands/bestRelocationFinalCall.ts`) is a narrow final-import command, integrated into the apply engine as `admit_final_best_relocation_call`. It compares the complete action to the approved stored frozen plan, pins the tracker Calls tab and canonical Best Relocation company/feed, and holds the applying run, unretired connection and ingestion lease epoch inside the Mongo transaction. The resulting immutable `external_call_admission` records real source arrival, stable source identity/hash, run and receipt; it never invents RingCentral metadata. Live Granot, manual and recurring external Call creation remain blocked.

Existing Calls require exact receipt ownership or normalized phone plus real arrival in the same canonical company/feed. If an identity group contains one original and duplicate copies, the original is the primary; separately approved `call_aliases` actions can admit the existing duplicate copies only after verifying their original group and primary action. Adoption preserves RingCentral metadata, duplicate flags, thresholds and historical lifecycle fields, adding only admission and factual Form Fill. Newly created exception Calls derive their review fact from the frozen checker and reuse the normal duplicate/Form Fill, CPL, revision and Sheet Sync pipeline. Newly created ordinary Calls additionally require `reviewed_for_insert=true` and `approval.normal_call_insert_approval` equal to the final source plan checksum. Without that explicit Owner approval they remain held; a preview is not authorization to insert.

This admission extension has focused unit/apply tests and a disposable local replica proof for lease rollback, legacy revision initialization, immutable attach, exception creation and replay. Those tests do not qualify a production import. The Owner has returned and authorized completion under the confirmed [Booking restriction](../../lead-reporting-retirement/NEXT-SESSION-INGESTION.md); the new exact source plan and live execution evidence are recorded separately in [RELEASE](../../lead-reporting-retirement/RELEASE.md). The old preview and its checksum remain unreleased.

### Booking restriction and frozen source accounting

`ops/best-relocation-retirement/bookingGraph.ts` builds the final graph from the frozen capture, including older Lead evidence. Each Booking is scoped by its own event timestamp, independently of whether a Lead exists or is in the Lead date window. Responses are grouped by normalized Job Number; repeated same-agent responses with consistent identity and financial values are counted once, while distinct split-agent allocations retain their source amounts. Conflicting customer, source, date, merchant, LID, deposit or same-agent Binder values remain explicit conflicts. The current leadless create boundary supports equal splits; an unequal split requires reconciliation instead of silently changing allocations.

Every ready Booking produces a financial action without a Lead dependency. The canonical adoption pass reuses saved Bookings and retains their existing attachments. Source-row identity and canonical Booking identity stay separate, so repeated submissions never authorize repeated money or physical rows. Refunds match a unique Booking identity with exact job/LID and corroborating source/customer/agent evidence. Matching does not consume physical split-agent rows in source order. Conflicting identities and distinct competing refund requests remain review entries; identical repeated requests share one Cancellation action with all response provenance.

Financial readback accepts the canonical company slug and the closed recognized Best Relocation Forms/Locals/Inbounds display labels. Saved historical `source` fields are preserved; qualification still requires the selected canonical identity, exact amounts and physical official row, rather than rewriting a valid display label into a slug.

`finalLeadSelection.ts` records explicit non-executable skips for normal source rows without a definite in-scope Booking match. An absent canonical Lead is not itself permission to create. A new normal Form requires a unique exact LID/ref plus consistent customer/source evidence; the configured generic Forms source may resolve a Local Form, but the selected dataset remains part of the evidence. A new normal Call requires explicit source job/contact evidence. Phone alone, a Booked flag, nearest date and fuzzy name do not qualify either model. Existing saved attachments are retained conservatively. Selected earlier nonduplicate Form creates contribute to later canonical duplicate planning; excluded normal rows do not.

`bestRelocationFinalLead.ts` revalidates the stored released plan checksum and the literal approved Form action in the canonical transaction. A normal create must have a persisted Booking edge to a ready financial action. The Call command requires the same Booking evidence in addition to its separate normal-Call insert approval. Bad Form review facts are constructed from the frozen checker and stored during the Form insert, before the first Sheet Sync intent can become visible; exception-only creation cannot first appear in Forms. Canonical duplicate flags, official Bookings/Cancellations and the established Form billing rule are preserved.

The source partitioner can collapse copied bad Form responses with one durable identity, consistent contact/move/protected facts and a bounded timestamp difference into one Lead. Both raw annotations and physical source rows remain checksum-bound in `source_identity_collapses`; this does not invent a duplicate flag or erase a response from accounting. Other conflicting source identities remain quarantined.

Distinct approved source identities can also resolve to one existing Form. If an earlier action in the same frozen plan has already applied the identical genuine bad annotation to that target, `reviewAliases.ts` permits a later equivalent row to adopt that fact through its own append-only source receipt. It preserves the first protected review stamp and canonical revision. The current revision must equal the frozen base plus this run's recorded changes; the primary stamp and successful primary receipt must match the exact plan, source tab and run. Verification requires the explicit adopted alias receipt and primary reference. Different annotations, unexplained revisions, source scopes or canonical targets remain conflicts.

The capture retains resolved checker values. `sourceCellEvidence.ts` additionally reads exact phone error cells with an International Number annotation: it accepts only an independently observed formula-parse error whose original user-entered value is a literal `+` telephone number. The supplemental evidence is frozen and revalidated with the snapshot; no formula is evaluated, digit inferred or source cell written. Other formula errors and structural/header sentinels remain review conflicts.

`run.ts plan --source-only`, `apply-source`, `verify-source` and `source-evidence` keep this one-time source phase independent of the already completed November 1 general Call backfill. `verify-source` checks actual Mongo review facts, all six Master Leads destinations and official financial membership; `source-evidence` captures protected entity/revision, receipt/command and physical-membership evidence for before/after replay comparison. Operator flags, bounds and completion requirements are in the [runbook](../../lead-reporting-retirement/README.md#operator-tooling).

The graph, selection and strict canonical payload tests are local implementation proof. New normal-create authorization, atomic exception classification and replay also have a disposable replica harness in `src/services/domainCommands/bestRelocationFinalLead.replica.ts`. Deployment, approved-plan application, physical delivery and unchanged same-plan replay must be evidenced independently; no completion follows from these modules existing or a dry run passing.

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
