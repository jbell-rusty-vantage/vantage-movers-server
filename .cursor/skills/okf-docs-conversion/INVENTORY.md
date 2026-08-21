# Conversion inventory (vantage-main-server)

36 Service files + 3 ADRs + 1 Reference hub. Paths are relative to `vantage-main-server/` except ADRs and `CONTEXT.md`.

Machine copy: `.cursor/okf-workspace/units.json`. Session board: `.cursor/okf-workspace/`. Progress: `pnpm okf:progress`. Do not track conversion status in this file.

Do not add files that are not listed. Do not convert Archives.

## Leave in place (do not stamp as knowledge)

| Path | Why |
| --- | --- |
| `../CONTEXT.md` | Canonical glossary. Every Service links here. |
| `CONTEXT.md` | Repo-local terms only. |
| `AGENTS.md` / `CLOUD_AGENTS.md` / `../docs/agents/domain.md` | Routers. Point them at `docs/index.md`. |
| `docs/granot-lead-lifecycle/**` long-form | Linked from the Reference hub. |
| `scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` | Locked contract. Hub links it. |
| `docs/owner-daily-operations/**`, `docs/showcase/**`, `docs/historical_production_db_staged_merge_ingestion_plans/**`, `docs/mongodb-backup-automation/**` | Archives. Index links only. |
| `docs/agent-documentation-maintenance-strategy.md` | Draft strategy. Not a Service. |

## Reference hub (Pass 0)

| Target | type | tags | `stale_after` |
| --- | --- | --- | --- |
| `docs/knowledge/granot-lifecycle/spec-hub.md` | Reference | granot-lifecycle, spec | +180d |

Title: `Granot lead-lifecycle spec hub`. Body: short paragraph + links to the FINAL SPEC, `docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md`, `docs/granot-lead-lifecycle/production-operator-runbook.md`, and `docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md`. No copied spec rules.

## ADRs (Pass 1 stamp only)

Workspace paths. `type: ADR`. `stale_after` +180d. `resource` is the ADR's own path.

| File | title | tags |
| --- | --- | --- |
| `../docs/adr/0001-mongodb-system-of-record.md` | MongoDB as system of record | mongodb, system-of-record |
| `../docs/adr/0002-granot-crm-post-despite-downstream-failures.md` | CRM Posting survives downstream failures | crm-posting, form-lead |
| `../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md` | Lead ID as Granot leadno | lead-id, crm-posting, tracking-reference |

## Pass 2 slices (move first)

| Current | Target | tags | freshness |
| --- | --- | --- | --- |
| `.cursor/businesslogic/ringcentral-call-lead-qualification.service.md` | `docs/knowledge/services/ringcentral-call-lead-qualification.md` | ringcentral, call-lead, qualification | +30d |
| `.cursor/businesslogic/operationsRegistry.service.md` | `docs/knowledge/services/operations-registry.md` | operations-registry, cpl, catalog | +90d |

Matching rules to thin after the move: `ringcentral-call-lead-candidates.mdc` + `ringcentral-integration.mdc`; `operations-registry.mdc` + `cpl-operations.mdc` if it only restates the Service.

## Pass 3 clusters

### leads

| Current | Target | tags | freshness |
| --- | --- | --- | --- |
| `form-lead.service.md` | `docs/knowledge/services/form-lead.md` | form-lead, ingestion, crm-posting | +90d |
| `call-lead.service.md` | `docs/knowledge/services/call-lead.md` | call-lead, ingestion | +90d |
| `enrichment.service.md` | `docs/knowledge/services/enrichment.md` | call-lead, enrichment | +30d |

Current files live under `.cursor/businesslogic/`.

### bookings

| Current | Target | tags |
| --- | --- | --- |
| `bookings.service.md` | `docs/knowledge/services/bookings.md` | booking, sheet-sync |
| `bookedCallLeadReconciliation.service.md` | `docs/knowledge/services/booked-call-lead-reconciliation.md` | call-lead, booking, enrichment |
| `cancelledLead.service.md` | `docs/knowledge/services/cancelled-lead.md` | cancellation, booking |
| `cancellationMirror.service.md` | `docs/knowledge/services/cancellation-mirror.md` | cancellation, sheet-sync |
| `customer.service.md` | `docs/knowledge/services/customer.md` | customer, booking |
| `agentAllocation.service.md` | `docs/knowledge/services/agent-allocation.md` | agent-allocation, booking |

`stale_after` +90d unless noted.

### sheets

| Current | Target | tags | freshness |
| --- | --- | --- | --- |
| `sheetSync.service.md` | `docs/knowledge/services/sheet-sync.md` | sheet-sync, outbox | +90d |
| `googleSheets.service.md` | `docs/knowledge/services/google-sheets.md` | sheet-sync, google-sheets | +30d |
| `domainCommands.service.md` | `docs/knowledge/services/domain-commands.md` | domain-commands, system-of-record | +90d |

### search

| Current | Target | tags |
| --- | --- | --- |
| `formLeadSearch.service.md` | `docs/knowledge/services/form-lead-search.md` | form-lead, search |
| `callLeadSearch.service.md` | `docs/knowledge/services/call-lead-search.md` | call-lead, search |
| `leadBrowse.service.md` | `docs/knowledge/services/lead-browse.md` | search, form-lead, call-lead |
| `adminSearch.service.md` | `docs/knowledge/services/admin-search.md` | search, admin |
| `analytics.service.md` | `docs/knowledge/services/analytics.md` | analytics, reporting |

+90d.

### catalog

| Current | Target | tags | freshness |
| --- | --- | --- | --- |
| `catalog.service.md` | `docs/knowledge/services/catalog.md` | catalog, operations-registry | +90d |
| `testimonial.service.md` | `docs/knowledge/services/testimonial.md` | testimonial, main-site | +90d |
| `granotHttpCollector.service.md` | `docs/knowledge/services/granot-http-collector.md` | granot-lifecycle, automation | +30d |

### granot-lifecycle

All current files: `.cursor/businesslogic/granotLifecycle.<name>.md` → `docs/knowledge/granot-lifecycle/<name>.md`. Tags always include `granot-lifecycle`. +90d.

| Current suffix | Target |
| --- | --- |
| `capture` | `docs/knowledge/granot-lifecycle/capture.md` |
| `extensionApply` | `docs/knowledge/granot-lifecycle/extension-apply.md` |
| `automationApply` | `docs/knowledge/granot-lifecycle/automation-apply.md` |
| `normalization` | `docs/knowledge/granot-lifecycle/normalization.md` |
| `sourcePolicy` | `docs/knowledge/granot-lifecycle/source-policy.md` |
| `identity` | `docs/knowledge/granot-lifecycle/identity.md` |
| `desiredState` | `docs/knowledge/granot-lifecycle/desired-state.md` |
| `processor` | `docs/knowledge/granot-lifecycle/processor.md` |
| `drainer` | `docs/knowledge/granot-lifecycle/drainer.md` |
| `revisions` | `docs/knowledge/granot-lifecycle/revisions.md` |
| `bookingReconciliation` | `docs/knowledge/granot-lifecycle/booking-reconciliation.md` |
| `releaseReconciliation` | `docs/knowledge/granot-lifecycle/release-reconciliation.md` |
| `projections` | `docs/knowledge/granot-lifecycle/projections.md` |
| `observability` | `docs/knowledge/granot-lifecycle/observability.md` |

`granotHttpCollector` is in **catalog**, not this folder.

## Counts

| Kind | Count |
| --- | --- |
| Service (businesslogic) | 36 |
| ADR | 3 |
| Reference hub | 1 |
| Pass 2 moves | 2 |
| Pass 3 remaining Service moves | 34 |
