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
- Services visited / in-progress / unvisited: **0 / 1 / 37**
- Recommendations on disk: **1** (`form-lead.md`)
- Current service: `leads`
- Next module: `callLead.service.ts`
- Last session: seed — `formLead.service.ts` is the quality bar

## How to read a service row

Status: `unvisited` | `in-progress` | `visited`.

- `unvisited` — no pass has opened the folder. First pass **enumerates** production modules, then recommends or skips the first story-worthy one.
- `in-progress` — checklist exists; unchecked production modules remain. **Stay here.** Do not open the next service.
- `visited` — every production module is `recommended` or `skipped`.

Size is a hint, not a quota: `large` expects several passes.

## Wave A — `src/services/`

Order is the domain tour from `project-organization`. Next work is the first `in-progress` service’s next unchecked module, or the first `unvisited` service if none are in progress.

### 1. `leads` — large — **in-progress**

Folder: `src/services/leads/`

| Module | Verdict |
| --- | --- |
| `formLead.service.ts` | recommended → [recommendations/form-lead.md](recommendations/form-lead.md) |
| `callLead.service.ts` | **next** |
| `duplicateLead.service.ts` | |
| `leadIngestionProvenance.ts` | |
| `leadSourceCompany.ts` | |
| `leadCplResolution.ts` | |
| `leadLocation.service.ts` | |
| `leadName.service.ts` | |
| `leadPhoneMatching.ts` | |
| `sourceLeadLookup.service.ts` | |
| `callLeadSourceMatch.ts` | |
| `leadSourceCompatibility.ts` | |
| `index.ts` | skip — barrel |

### 2. `bookings` — large — unvisited

`src/services/bookings/` — Booked create/update/delete, from-source, referral, leadless, mirrors.

### 3. `cancellations` — medium — unvisited

`src/services/cancellations/`

### 4. `customers` — small — unvisited

`src/services/customers/`

### 5. `agents` — small — unvisited

`src/services/agents/`

### 6. `leadSourceCompanies` — small — unvisited

`src/services/leadSourceCompanies/`

### 7. `cpl` — small — unvisited

`src/services/cpl/`

### 8. `catalog` — small — unvisited

`src/services/catalog/`

### 9. `search` — medium — unvisited

`src/services/search/` — extension browse/search. Thin facades may skip; enumerate first.

### 10. `enrichment` — medium — unvisited

`src/services/enrichment/`

### 11. `reconciliation` — medium — unvisited

`src/services/reconciliation/`

### 12. `granotLifecycle` — large — unvisited

`src/services/granotLifecycle/` — many passes. Enumerate on first open. Do not treat as one recommendation.

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
