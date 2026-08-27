# Traversal

Stock-taking board for the **entire** `vantage-main-server` `src/` tree. The unit of work is a **service folder**. Large services take many passes. One pass writes one recommendation (or finishes a thin folder).

Do not put `type:` YAML here. Do not copy Service invariants here.

## Scope

| Wave | Tree | When |
| --- | --- | --- |
| **A (current)** | `src/services/` — every folder, then leftover root barrels | Now. Domain-tour order below. Do not reorder. |
| **B (locked)** | Remaining `src/`: `routes/`, `models/`, `validation/`, `config/domain/`, `middleware/`, `auth/` | Locked until every Wave A service is `visited`. |

Out of scope: `scripts/`, `docs/`, `.cursor/`, tests as targets. Tests are evidence for a recommendation, not their own row.

Production module = a `.ts` file that is not `*.test.ts`, `*.replica.test.ts`, or an empty `index.ts` barrel.

## Stock (rewrite every run)

- Wave: A
- Services visited / in-progress / unvisited: **11 / 1 / 26**
- Recommendations on disk: **54** (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`, `bookings-booked-lead-from-source.md`, `bookings-referral-booking.md`, `bookings-leadless-booking.md`, `bookings-booking-mirror.md`, `bookings-booking-source-resolver.md`, `bookings-booking-identity.md`, `cancellations-cancelled-lead.md`, `cancellations-cancellation-resolver.md`, `cancellations-cancellation-mirror.md`, `customers-customer.md`, `customers-customer-from-lead.md`, `agents-agent-allocation.md`, `agents-receiver-agent-crm-username.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, `search-form-lead-search.md`, `search-form-lead-browse.md`, `search-call-lead-search.md`, `search-call-lead-browse.md`, `enrichment-call-lead-enrichment.md`, `enrichment-call-lead-enrichment-rows.md`, `reconciliation-booked-call-lead.md`, `reconciliation-booked-call-lead-rows.md`, `granot-lifecycle-capture.md`, `granot-lifecycle-queue-publisher.md`, `granot-lifecycle-extension-apply.md`, `granot-lifecycle-automation-apply.md`, `granot-lifecycle-automation-compatibility.md`, `granot-lifecycle-normalization.md`, `granot-lifecycle-source-policy.md`, `granot-lifecycle-identity.md`, `granot-lifecycle-granot-temporal.md`, `granot-lifecycle-lead-desired-state.md`, `granot-lifecycle-authorized-desired-state.md`, `granot-lifecycle-lead-contact-projection.md`, `granot-lifecycle-processor.md`, `granot-lifecycle-operations.md`, `granot-lifecycle-projections.md`, `granot-lifecycle-creating-observation.md`, `granot-lifecycle-drainer.md`)
- Current service: `granotLifecycle` (in-progress)
- Next module: `aggregateRevision.ts`
- Last session: `story-granot-lifecycle-drainer-2026-08-27T0110Z`

## How to read a service row

Status: `unvisited` | `in-progress` | `visited`.

- `unvisited` — no pass has opened the folder. First pass **enumerates** production modules, then recommends or skips the first story-worthy one.
- `in-progress` — checklist exists; unchecked production modules remain. **Stay here.** Do not open the next service.
- `visited` — every production module is `recommended` or `skipped`.

Size is a hint, not a quota: `large` expects several passes.

## Wave A — `src/services/`

Order is the domain tour from `project-organization`. Next work is the first `in-progress` service’s next unchecked module, or the first `unvisited` service if none are in progress.

### 1. `leads` — large — **visited**

Folder: `src/services/leads/`

| Module | Verdict |
| --- | --- |
| `formLead.service.ts` | recommended → [recommendations/form-lead.md](recommendations/form-lead.md) |
| `callLead.service.ts` | recommended → [recommendations/leads-call-lead.md](recommendations/leads-call-lead.md) |
| `duplicateLead.service.ts` | recommended → [recommendations/leads-duplicate-lead.md](recommendations/leads-duplicate-lead.md) |
| `leadIngestionProvenance.ts` | recommended → [recommendations/leads-ingestion-provenance.md](recommendations/leads-ingestion-provenance.md) |
| `leadSourceCompany.ts` | recommended → [recommendations/leads-source-company.md](recommendations/leads-source-company.md) |
| `leadCplResolution.ts` | recommended → [recommendations/leads-cpl-resolution.md](recommendations/leads-cpl-resolution.md) |
| `leadLocation.service.ts` | recommended → [recommendations/leads-lead-location.md](recommendations/leads-lead-location.md) |
| `leadName.service.ts` | recommended → [recommendations/leads-lead-name.md](recommendations/leads-lead-name.md) |
| `leadPhoneMatching.ts` | recommended → [recommendations/leads-lead-phone-matching.md](recommendations/leads-lead-phone-matching.md) |
| `sourceLeadLookup.service.ts` | recommended → [recommendations/leads-source-lead-lookup.md](recommendations/leads-source-lead-lookup.md) |
| `callLeadSourceMatch.ts` | recommended → [recommendations/leads-call-lead-source-match.md](recommendations/leads-call-lead-source-match.md) |
| `leadSourceCompatibility.ts` | recommended → [recommendations/leads-lead-source-compatibility.md](recommendations/leads-lead-source-compatibility.md) |
| `index.ts` | skip — barrel |

### 2. `bookings` — large — **visited**

Folder: `src/services/bookings/`

| Module | Verdict |
| --- | --- |
| `bookedLead.service.ts` | recommended → [recommendations/bookings-booked-lead.md](recommendations/bookings-booked-lead.md) |
| `bookedLeadFromSource.service.ts` | recommended → [recommendations/bookings-booked-lead-from-source.md](recommendations/bookings-booked-lead-from-source.md) |
| `referralBooking.service.ts` | recommended → [recommendations/bookings-referral-booking.md](recommendations/bookings-referral-booking.md) |
| `leadlessBooking.service.ts` | recommended → [recommendations/bookings-leadless-booking.md](recommendations/bookings-leadless-booking.md) |
| `bookingMirror.service.ts` | recommended → [recommendations/bookings-booking-mirror.md](recommendations/bookings-booking-mirror.md) |
| `bookingSourceResolver.ts` | recommended → [recommendations/bookings-booking-source-resolver.md](recommendations/bookings-booking-source-resolver.md) |
| `bookingIdentity.ts` | recommended → [recommendations/bookings-booking-identity.md](recommendations/bookings-booking-identity.md) |
| `bookingWarnings.ts` | skip — thin warning helper |
| `bestRelocationImportGuard.ts` | skip — import fence |
| `index.ts` | skip — barrel |

### 3. `cancellations` — medium — **visited**

Folder: `src/services/cancellations/`

| Module | Verdict |
| --- | --- |
| `cancelledLead.service.ts` | recommended → [recommendations/cancellations-cancelled-lead.md](recommendations/cancellations-cancelled-lead.md) |
| `cancellationResolver.ts` | recommended → [recommendations/cancellations-cancellation-resolver.md](recommendations/cancellations-cancellation-resolver.md) |
| `cancellationMirror.service.ts` | recommended → [recommendations/cancellations-cancellation-mirror.md](recommendations/cancellations-cancellation-mirror.md) |
| `index.ts` | skip — barrel |

### 4. `customers` — small — **visited**

Folder: `src/services/customers/`

| Module | Verdict |
| --- | --- |
| `customer.service.ts` | recommended → [recommendations/customers-customer.md](recommendations/customers-customer.md) |
| `customerFromLead.service.ts` | recommended → [recommendations/customers-customer-from-lead.md](recommendations/customers-customer-from-lead.md) |
| `index.ts` | skip — barrel |

### 5. `agents` — small — **visited**

Folder: `src/services/agents/`

| Module | Verdict |
| --- | --- |
| `agentAllocation.service.ts` | recommended → [recommendations/agents-agent-allocation.md](recommendations/agents-agent-allocation.md) |
| `receiverAgentCrmUsername.ts` | recommended → [recommendations/agents-receiver-agent-crm-username.md](recommendations/agents-receiver-agent-crm-username.md) |
| `agentName.ts` | skip — name fold |
| `index.ts` | skip — barrel |

### 6. `leadSourceCompanies` — small — **visited**

Folder: `src/services/leadSourceCompanies/`

| Module | Verdict |
| --- | --- |
| `leadSourceCompany.service.ts` | recommended → [recommendations/lead-source-companies-lead-source-company.md](recommendations/lead-source-companies-lead-source-company.md) |
| `index.ts` | skip — barrel |

### 7. `cpl` — small — **visited**

Folder: `src/services/cpl/`

| Module | Verdict |
| --- | --- |
| `cplRate.service.ts` | recommended → [recommendations/cpl-cpl-rate.md](recommendations/cpl-cpl-rate.md) |

### 8. `catalog` — small — **visited**

Folder: `src/services/catalog/`

| Module | Verdict |
| --- | --- |
| `catalog.service.ts` | recommended → [recommendations/catalog-catalog.md](recommendations/catalog-catalog.md) |
| `index.ts` | skip — barrel |

### 9. `search` — medium — **visited**

Folder: `src/services/search/`

| Module | Verdict |
| --- | --- |
| `formLeadSearch.service.ts` | recommended → [recommendations/search-form-lead-search.md](recommendations/search-form-lead-search.md) |
| `formLeadBrowse.service.ts` | recommended → [recommendations/search-form-lead-browse.md](recommendations/search-form-lead-browse.md) |
| `callLeadSearch.service.ts` | recommended → [recommendations/search-call-lead-search.md](recommendations/search-call-lead-search.md) |
| `callLeadBrowse.service.ts` | recommended → [recommendations/search-call-lead-browse.md](recommendations/search-call-lead-browse.md) |
| `leadBrowseShared.ts` | skip — browse helpers |
| `index.ts` | skip — barrel |

### 10. `enrichment` — medium — **visited**

Folder: `src/services/enrichment/`

| Module | Verdict |
| --- | --- |
| `callLeadEnrichment.service.ts` | recommended → [recommendations/enrichment-call-lead-enrichment.md](recommendations/enrichment-call-lead-enrichment.md) |
| `callLeadEnrichmentRows.ts` | recommended → [recommendations/enrichment-call-lead-enrichment-rows.md](recommendations/enrichment-call-lead-enrichment-rows.md) |
| `index.ts` | skip — barrel |

### 11. `reconciliation` — medium — **visited**

Folder: `src/services/reconciliation/`

| Module | Verdict |
| --- | --- |
| `bookedCallLeadReconciliation.service.ts` | recommended → [recommendations/reconciliation-booked-call-lead.md](recommendations/reconciliation-booked-call-lead.md) |
| `bookedCallLeadRows.ts` | recommended → [recommendations/reconciliation-booked-call-lead-rows.md](recommendations/reconciliation-booked-call-lead-rows.md) |
| `index.ts` | skip — barrel |

### 12. `granotLifecycle` — large — **in-progress**

Folder: `src/services/granotLifecycle/` — many passes. Do not treat as one recommendation.

| Module | Verdict |
| --- | --- |
| `types.ts` | skip — type-only |
| `receiptEvidence.ts` | skip — redact helpers |
| `receiptCompatibility.ts` | skip — legacy fill |
| `errors.ts` | skip — error types |
| `applyItem.ts` | skip — apply hints |
| `safeLogging.ts` | skip — log mask |
| `synchronizeLeadTypes.ts` | skip — type-only |
| `sourceLabel.ts` | skip — label fold |
| `lastError.ts` | skip — error sanitize |
| `schedules.ts` | skip — retry clock |
| `capture.ts` | recommended → [recommendations/granot-lifecycle-capture.md](recommendations/granot-lifecycle-capture.md) |
| `queuePublisher.ts` | recommended → [recommendations/granot-lifecycle-queue-publisher.md](recommendations/granot-lifecycle-queue-publisher.md) |
| `extensionApply.ts` | recommended → [recommendations/granot-lifecycle-extension-apply.md](recommendations/granot-lifecycle-extension-apply.md) |
| `automationApply.ts` | recommended → [recommendations/granot-lifecycle-automation-apply.md](recommendations/granot-lifecycle-automation-apply.md) |
| `automationCompatibility.ts` | recommended → [recommendations/granot-lifecycle-automation-compatibility.md](recommendations/granot-lifecycle-automation-compatibility.md) |
| `normalization.ts` | recommended → [recommendations/granot-lifecycle-normalization.md](recommendations/granot-lifecycle-normalization.md) |
| `sourcePolicy.ts` | recommended → [recommendations/granot-lifecycle-source-policy.md](recommendations/granot-lifecycle-source-policy.md) |
| `identity.ts` | recommended → [recommendations/granot-lifecycle-identity.md](recommendations/granot-lifecycle-identity.md) |
| `granotTemporal.ts` | recommended → [recommendations/granot-lifecycle-granot-temporal.md](recommendations/granot-lifecycle-granot-temporal.md) |
| `leadDesiredState.ts` | recommended → [recommendations/granot-lifecycle-lead-desired-state.md](recommendations/granot-lifecycle-lead-desired-state.md) |
| `authorizedDesiredState.ts` | recommended → [recommendations/granot-lifecycle-authorized-desired-state.md](recommendations/granot-lifecycle-authorized-desired-state.md) |
| `leadContactProjection.ts` | recommended → [recommendations/granot-lifecycle-lead-contact-projection.md](recommendations/granot-lifecycle-lead-contact-projection.md) |
| `processor.ts` | recommended → [recommendations/granot-lifecycle-processor.md](recommendations/granot-lifecycle-processor.md) |
| `operations.ts` | recommended → [recommendations/granot-lifecycle-operations.md](recommendations/granot-lifecycle-operations.md) |
| `projections.ts` | recommended → [recommendations/granot-lifecycle-projections.md](recommendations/granot-lifecycle-projections.md) |
| `creatingObservation.ts` | recommended → [recommendations/granot-lifecycle-creating-observation.md](recommendations/granot-lifecycle-creating-observation.md) |
| `drainer.ts` | recommended → [recommendations/granot-lifecycle-drainer.md](recommendations/granot-lifecycle-drainer.md) |
| `aggregateRevision.ts` | |
| `trustedLeadCreateValidation.ts` | |
| `synchronizeLeadFromGranot.ts` | |
| `createLeadFromGranot.ts` | |
| `bookingReconciliation.ts` | |
| `bookingConfirmation.ts` | |
| `bookingOwnerCommands.ts` | |
| `bookingPriorityPairing.ts` | |
| `referralBooking.ts` | |
| `releaseReconciliation.ts` | |
| `releaseOwnerCommands.ts` | |
| `discrepancies.ts` | |
| `discrepancyOwnerCommands.ts` | |
| `discrepancyProjections.ts` | |
| `observability.ts` | |
| `metrics.ts` | |
| `alerts.ts` | |

### 13. `granotHttpCollector` — medium — unvisited

`src/services/granotHttpCollector/`

### 14. `granotCrmCsv` — medium — unvisited

`src/services/granotCrmCsv/`

### 15. `crm` — medium — unvisited

`src/services/crm/`

### 16. `leadMessaging` — medium — unvisited

`src/services/leadMessaging/`

### 17. `sheetSync` — large — unvisited

`src/services/sheetSync/` — coordinator, outbox, persist, drainer. Several passes.

### 18. `googleSheets` — large — unvisited

`src/services/googleSheets/`

### 19. `googleAuth` — small — unvisited

`src/services/googleAuth/`

### 20. `googleDriveOAuth` — medium — unvisited

`src/services/googleDriveOAuth/`

### 21. `googleMaps` — small — unvisited

`src/services/googleMaps/`

### 22. `operationalWorkbooks` — small — unvisited

`src/services/operationalWorkbooks/`

### 23. `ringcentral` — large — unvisited

`src/services/ringcentral/` — qualify, ingest, call-log sync, analytics reconcile. Several passes.

### 24. `operationsRegistry` — large — unvisited

`src/services/operationsRegistry/`

### 25. `admin` — large — unvisited

`src/services/admin/`

### 26. `analytics` — large — unvisited

`src/services/analytics/`

### 27. `observability` — large — unvisited

`src/services/observability/`

### 28. `reporting` — large — unvisited

`src/services/reporting/`

### 29. `ingestion` — medium — unvisited

`src/services/ingestion/`

### 30. `bestRelocationSheetIngest` — medium — unvisited

`src/services/bestRelocationSheetIngest/`

### 31. `employeeBookings` — medium — unvisited

`src/services/employeeBookings/`

### 32. `domainCommands` — large — unvisited

`src/services/domainCommands/`

### 33. `durableWork` — small — unvisited

`src/services/durableWork/`

### 34. `historicalConsolidation` — small — unvisited

`src/services/historicalConsolidation/`

### 35. `testimonials` — small — unvisited

`src/services/testimonials/`

### 36. `movingCarriers` — small — unvisited

`src/services/movingCarriers/`

### 37. `errors` — small — unvisited

`src/services/errors/`

### 38. `legacy-root` — medium — unvisited

Leftover files on `src/services/` itself: `v1.service.ts`, `v1ServiceError.ts`, and compatibility barrels (`formLeadSearch.service.ts`, `callLeadSearch.service.ts`, `crm.service.ts`, `googleSheets.service.ts`, `callLeadEnrichment.service.ts`, `bookedCallLeadReconciliation.service.ts`). Enumerate; most should skip as facades. Visit last in Wave A.

## Wave B — locked

Do not open until every Wave A service is `visited`.

- `src/routes/`
- `src/models/`
- `src/validation/`
- `src/config/domain/`
- `src/middleware/`
- `src/auth/`
