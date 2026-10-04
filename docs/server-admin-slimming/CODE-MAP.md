# Inspected code map

Inspected October 3, 2026 against the local revisions in [README](README.md). Paths in tables are repository-relative. [SOURCE-INVENTORY](SOURCE-INVENTORY.md) records the wider reference set; it is an inventory of dependencies, not a file deletion instruction. Re-run reference searches after each work package, including scripts, migrations, api entry points, package manifests and sibling consumers.

## 1. Authority and documentation

Read first: workspace `CONTEXT.md`, `docs/agents/domain.md`, `docs/adr/0001-mongodb-system-of-record.md`; server `AGENTS.md`, `docs/index.md`, applicable `.cursor/rules`; Admin `CONTEXT.md`, `.cursor/rules/project-organization.mdc`.

Service docs inspected for the retained boundaries: `customer`, `daily-operations`, `number-activity-capture`, `sales-intelligence-foundation`, `sales-intelligence-attachment`, `sales-intelligence-rep-identity`, `sales-intelligence-live`, `mongodb-backup`, and Granot lifecycle `observability`/`live-receipts`. The new-desk README, code map, decisions, and relevant deterministic-only/restriction/migration portions of SPECIFICATION were consulted. Detailed new-desk policy is not duplicated here.

Documentation drift: server `docs/knowledge/environment.md` is pointed to by workspace instructions and the Admin inventory but is absent in this checkout. Read the present Admin inventory; restore/rebuild the server inventory from the maintained configuration schema as part of SLIM-01, without exposing values or searching `process.env` to guess names. Several Daily Operations public links point to absent files; the actual local pack is `internal_hidden_docs/daily-operations/` and imported copies in the new-desk packet. Preserve that local pack before creating isolated implementation checkouts. No blanket claim that documentation matches deployment is made.

## 2. Admin surgery

| Path | Change / protected dependency |
| --- | --- |
| `components/layout/dashboard-nav.tsx` | Remove Live Events, Lead Conversations, Customers, Agents, Agent Sales Report, Exports, Observational, Audit Log. Keep remaining destinations; Granot Lifecycle goes to Health. Remove retired titles/icons/children/preloads. |
| `components/layout/database-scope-selector.tsx`, `scope-aware-header-controls.tsx`; `lib/state/database-scope.tsx`; `lib/constants/domain.ts`; `lib/api/types.ts`, `filters.ts` | Remove historical/combined scope UI/state; normalize old persisted URLs; migrate DTO/query scope handling coherently. |
| `components/operational/operational-{resource-page,detail-panel,configs,copy}.tsx/ts` | Retire Customer/Agent standalone configurations; retain shared six Lead/Booking/Cancellation routes. Remove historical-only conditions, dead customer/agent navigation, retired SI links and “audit logged” CSV success copy. |
| `app/(dashboard)/{customers,agents,exports,audit-log,conversations,live-events,observational}` | Delete exclusive route trees, with normal missing-route handling. Do not remove shared OperationalResourcePage components used by kept lists. |
| `app/(dashboard)/reports/agent-sales`; `components/reports` | Delete dedicated report and exclusive query/client helpers. Analytics Agent performance survives. |
| `app/(dashboard)/granot-lifecycle/{page,receipts/page}.tsx`; `components/granot-lifecycle/{receipt-search,live-webhooks,granot-lifecycle-copy}` | Health default; remove receipt browse/live UI and payload SidePanel. Keep `lifecycle-health.tsx` and case/intake/timeline components. |
| `app/api/granot-live-receipts/route.ts` | Remove Live Events-only BFF. Daily and SI streams are separate. |
| `app/api/audit-log/route.ts`; `server/models/AdminAuditLog.ts`; `server/audit` | Remove Admin-local audit storage/read endpoint and exclusive payload helpers. Keep proxy auth/signatures and redact/log only required retained diagnostic fields. |
| `app/api/auth/{login,logout,refresh}/route.ts`; `app/api/proxy/[...path]/route.ts`; `server/models/index.ts` | Remove writeAuditLog imports/calls/exports; keep authentication, sessions, role permissions, command idempotency headers and CSV handling. |
| `components/conversations`; conversation API/query helpers | Remove transcript/summary/media page and all mounts. |
| `components/sales-intelligence/desk/{desk,closed-list,view-tabs}`; `data/{url-state,use-attention,use-closed-history,use-conversations}` | Interim two-view shell. Remove mounted Attention/snapshot/Closed/AI/legacy work reads, metrics and pollers. Old URL selection normalizes to Numbers. |
| `app/(dashboard)/sales-intelligence/route-viewer.ts`, `desk-root.tsx`; `server/auth/authorization.ts`, proxy guards | Retain trusted Owner/Rep boundary for any kept access; current Rep rights cannot widen to all Numbers by removing old Outreach scoping. Define explicit number ownership scope or deny interim Rep Numbers rather than trusting browser filters. New Manager permissions belong to new-desk implementation. |
| `components/sales-intelligence/{numbers*,reps*,running-summary-panel,stored-call-analyses,outreach,assessment*,_legacy}` | Retain Numbers + Accounts rendered metadata only; delete retired AI panels after checking shared primitives. Accounts attach/review and directory-context messaging must not import Outreach. |
| `lib/api/salesIntelligence*.ts`, `lib/query/salesIntelligence.ts`; SI SSE hooks/server | Split DTO/query dependencies. Remove retired watch topics; preserve versioned reconnect/refetch and no browser-derived business policy. |
| `components/daily/**`, `app/(dashboard)/daily/**`, `app/api/daily-operations-live`, `lib/api/dailyOperations*` | Protected. No slimming edits to board, colour helpers, counts, cards or timing. Live Events shares Daily colour constants: remove its import/caller, not those constants. |

## 3. Server historical and tab-only capabilities

| Path | Change |
| --- | --- |
| `src/models/historical/{index,Agent,Customer,FormLead,CallLead,BookedLead,CancelledLead,schemaHelpers}.ts` | Remove dedicated database registration and all models. Main production models stay. |
| `src/services/admin/{adminScope,adminBrowse,adminSearch,adminFacets,filterCatalog}.service.ts` (filterCatalog is `.ts`) | Remove historical/combined models and union/merge/pagination branches; remove standalone Customer/Agent browse/search targets when unused. Keep required catalog, intake contact search and production filters. |
| `src/validation/v1/admin.validation.ts`; Admin/Analytics DTOs | Reject historical/combined instead of falling back; shrink resource enums without breaking registry catalog contracts. |
| `src/services/analytics/analyticsMerge.ts`, historical branches in report services | Production-only reports; preserve Agent performance/receiver attribution and overview semantics. Remove exclusive `agentSalesReport.service.ts` exports/routes. |
| `src/services/historicalConsolidation`; `scripts/historical`; `scripts/historical_production_db_staged_merge_ingestion`; related package scripts | Retire executable historical import/stage/apply/rollback and legacy database recreators. Retain finite migration evidence outside runtime if needed for provenance. |
| `src/services/admin/adminExport.service.ts`; `src/routes/v1.routes.ts` export loops | Keep in-context exports for retained resources/Analytics; no exclusive Export collection. Drop retired resources/report routes from registration. |
| `src/models/{Agent,Customer}.ts`; `src/services/{agents,customers}`; booking upsert/allocation helpers | Preserve production entity linkage. Remove only exclusively unused tab CRUD/metrics (`agentBrowseMetrics.service.ts` may retire if no catalog caller needs its enrichment). |

## 4. OperationalEvents and Health

| Path | Change |
| --- | --- |
| `src/services/observability/**`; `src/config/domain/observability.ts`; `src/models/{OperationalEvent,OperationalIncident,NotificationDelivery,OperationalReportRun,observabilityModelFactory}.ts`; `src/validation/v1/observability.validation.ts` | Delete exclusive subsystem after all kept diagnostic consumers use logger/metrics and shared mail transport is extracted. Runtime namespaces are resolved by config, not fixed prefix deletion. |
| `src/routes/v1.routes.ts` around observability route registration + sendError/captureRouteFailureEvent | Remove `/admin/observability/**`; preserve sendError HTTP contract and logging without Mongo event writes. |
| `src/routes/notification-cron.routes.ts`; application route registration; `vercel.json` | Remove digest transport/schedule and retries. Keep lead messaging/report delivery schedules. |
| `src/middleware/requireApiSecret.ts` | Remove operational auth-event persistence. Keep timing-safe API-secret/signed role behavior. |
| `src/services/granotLifecycle/projections.ts` | Replace event-backed conflict/failure/recovery counts and latest-run queries; keep domain-backed aggregates. |
| `src/services/granotLifecycle/operations.ts` | Replace direct transactional OperationalEvent create for requeue/activation with appropriate retained command provenance; preserve transaction atomicity. |
| `src/services/granotLifecycle/{observability,metrics,drainer,processor}.ts`; queue/cron routes | Keep closed metric keys and Health semantics; route diagnostics to logger and bounded Health aggregates. All retained failure paths need working Health after events are absent. |
| `src/services/reporting/{reportingAudit,reportingObservability}.ts` | Replace only generic OperationalEvents writes; preserve actual Reporting model history and health/delivery behavior. |
| `src/services/adminInvites/inviteEmail.service.ts` | Confirmed import of `getSendgridConfig`/`SendgridConfig` from Observability config. Extract those retained mail settings before deleting that config. Invitations are independent of old notification flags and do not write NotificationDelivery; preserve that behavior. |
| `src/services/dailyOperations/**`; `DailyOperations{Event,Day}.ts`; `dailyOperationsModelFactory.ts`; `config/domain/dailyOperations.ts` | Protected independent board, not observability. No matching OperationalEvent/EntityChange dependency was found in its service source search; also protect each external Daily fact producer during diagnostic surgery. |

## 5. Granot search/live transport

| Path | Change |
| --- | --- |
| `src/routes/granot-lifecycle-admin.routes.ts` | Remove GET receipt search/live only. Keep Health, requeue, activation, candidates/cases, discrepancies, official commands, lifecycle projections and creating-observation routes. |
| `src/services/granotLifecycle/{receiptSearch,liveReceiptStream,liveReceipts}.ts` + dedicated query validation | Delete search/live-only readers after full consumer search; leave receipt model/capture/processor. |
| `src/models/GranotObservationReceipt.ts` | Protected collection `granot_webhook_receipts`; not a Live Events model. |
| `src/services/jobNumberTimeline/mongo-evidence-loader.ts` | Protected EntityChange and lifecycle evidence reads. Remove retired deep links in renderer/UI only. |

## 6. Sales Intelligence dependency cuts

| Path | Change |
| --- | --- |
| `src/services/numberActivity/{search,contactNumbers}.ts` | Current imports `loadAttachedLeadProgressForNumbers`/`readNumberOutreach` from `outreach/reads`; replace with direct deterministic attachment + canonical data projection. Remove number `running_analysis`. |
| `src/services/numberActivity/{persistInteraction,rebuild,reconcileCallLog,callLogSweep,callLogRefresh,settleProvisional}.ts` | Preserve canonical call/alias/number identity, settle/rollup semantics, throttling and coverage; remove Outreach/media nominations and analysis rollup fields. Audit rebuild's actual dependency graph before keeping it. |
| `src/services/salesIntelligence/attachment/{hooks,refresh,formLeadNumber,sources,store}.ts` | Preserve reviewed attachments/ambiguity/exact matching and Form Lead Numbers. Detach Outreach/media hooks, move Lead-side nomination/recovery out of ensure. |
| `src/services/granotLifecycle/processor.ts` | Current post-commit Outreach wakeup reads EntityChanges. Split retained attachment/number wakeup from legacy outreach wakeup; leave decision/apply and Daily hooks unchanged. |
| `src/services/salesIntelligence/outreach/**` | Remove Attention/artifacts/manifests, Closed, old ensure/derive/transitions/effects/timeline. Extract retained contact/official/attachment projections first; no legacy planner reuse. |
| `src/services/salesIntelligence/{analysis,assessment,conversations,casefile,story,overview,followups}` | Remove retired AI/media/outreach-only processing and views. Extract deterministic canonical history/metadata helpers used by Numbers/Accounts/MCP before deletion; directory names alone do not prove exclusivity. |
| `src/services/conversations/**`; `src/models/LeadConversation.ts`; `src/routes/conversations-admin.routes.ts`; `config/domain/conversations.ts` | Remove playback/transcripts/STT/summaries, media URLs, seeds, provider calls and model. Manifest stored audio objects first. |
| `src/routes/sales-intelligence-{admin,internal,boundary,history,cron}.routes.ts` | Keep Owner-authorized metadata/attachment/account paths; remove scoped AI-run router and its branch, exclusive analysis/history/Closed/Attention/outreach paths and workers. Split history canonical reads for MCP. |
| `api/queues/sales-intelligence-consumer.ts`; `src/config/domain/salesIntelligence.ts`; `jobs.ts`; `vercel.json` | Retire dead stages, enforce allowlisted dispatch, keep capture/attachment/rep recovery. Old queued jobs cannot run. Remove six AI/Attention/ensure schedules, legacy backfill and overview refresh; retain metadata capture cron family. |
| `src/models/salesIntelligence/{infrastructure,intelligence,outreach,assessment,attentionArtifact,overview}.ts` + model facade files | Drop exclusive models and split shared infrastructure schema imports (Job imports analysis envelope/Attention schemas today). Retain deterministic policies/jobs/command and capture audit fences. |
| `src/models/ContactNumber.ts`; SI DTO/validation/common modules | Remove summary/schedule/AI and old outreach fields and references; preserve classification/restriction/attachment/provenance and provider call rollups. |
| `src/services/salesIntelligence/{live,retention,backfill,policy,settings,auth,evidence,budget*}` | Narrow live/cleanup to kept data; remove AI budgeting; split mixed policy/config readers. Legacy retention mutates multiple mixed collections and cannot run unchanged against deleted schemas. Backfill activation is not safe metadata-only work. |
| `src/services/salesIntelligence/repIdentity/**`; `src/services/numberActivity/directory*`; `src/services/salesIntelligence/nudges/**` | Keep reviewed identity and directory reads. Keep only Accounts `review_context` messaging and required delivery repair; remove old Outreach eligibility branch. |
| `scripts/conversations`, transcription/media/analysis/reanalysis/assessment/Attention ops/migrations and package tasks | Remove executable producers and schema recreation paths; preserve inert finite retirement evidence. |

## 7. Schedule decisions

Checked-in `vercel.json` is the evidence source. Remove: `sales-intelligence-extract`, `-apply`, `-transcribe`, `-media-fetch`, `-attention-publish`, `-outreach-ensure`, `-overview-refresh`, legacy `-backfill-step`, and `notifications-digest-daily`. Remove their route imports, startup references, worker dispatcher cases and recovery hooks too.

Keep: `sales-intelligence-call-log-reconcile`, `-call-log-sweep`, `-job-recovery`, `-directory-sync`, `-attachment-refresh`, `-webhook-subscription`; keep `-nudge-repair` only for retained Accounts sends/unknown outcomes. Replace `sales-intelligence-retention` implementation with metadata/shared-infrastructure-safe retention rather than dropping all cleanup. Call Log backfill may receive a new metadata-only operator flow; the old activation flow retires.

Keep every non-retired functional schedule: RingCentral qualified Call Lead sync/reconcile, Sheet Sync, Daily close, Booking reconciliation, Lead Message drain, CPL corrections, Best Relocation, all Reporting delivery/health/janitors, Granot automation and lifecycle drain. Preserve the shared SI queue topic/consumer for retained jobs; do not unsubscribe the RingCentral capture subscriptions or delete the queue wholesale.

## 7.1 Confirmed sibling consumers

The Granot extension `src/api/agents.ts` calls `GET /api/v1/admin/catalog/agents`, `POST /api/v1/admin/agents`, and `PATCH /api/v1/admin/agents/:id` for receiver-Agent attribution/create/edit. These are protected endpoints even though the standalone Agents dashboard tab is removed. Do not delete by the `/admin/agents` path prefix.

Vantage MCP `lib/tools/history.ts` forwards to `/api/v1/internal/sales-intelligence/history/*`. Its registered tools include `list_analyses`, `get_analysis`, `get_conversation`, `get_move_assessment`, and `get_prior_analyses`: retire these capability entries with the server removal. `find_contact_number`, `get_subject_story` and `get_lead_history` currently describe/read analysis, conversations, assessments or Outreach as well as canonical data; narrow their server projections and tool descriptions to retained metadata/history. `find_lead_candidates` remains deterministic. `app/api/mcp/route.ts` invokes the tool registrar. The MCP package/service remains; a small compatible consumer update is an explicit release dependency, not permission to delete it.

Attention artifacts in the inspected `attentionArtifactStore.ts` live in Mongo (`sales_intelligence_attention_artifacts`) with an `attention_artifacts:<deployment>:<database>` fence row in shared sync state. Remove the exclusive fence row/cache after publishers are retired. External Attention artifact storage is only a deployment-inventory contingency, not a claim that this source uses Blob for Attention. Conversation media does use Vercel Blob via `services/conversations/media.ts`.

## 8. Source audit queries

Run with `rg` from each repository; use globs rather than Windows wildcard path arguments. Search production source AND `api`, `ops`, `scripts`, package/config manifests. Classify each result before editing.

```powershell
rg -n 'vantagemovershistorical|registerHistoricalModels|database_scope|combined' src scripts ops package.json
rg -n 'recordOperationalEvent|recordOperationalEventsBulk|getOperationalEventModel|getOperationalIncidentModel|getNotificationDeliveryModel|getOperationalReportRunModel' src api ops scripts
rg -n 'LeadConversation|lead_conversations|IntelligenceRun|intelligence_runs|MoveAssessment|attention_snapshots|attention_artifacts|outreach_records|outreach_followups' src api ops scripts
rg -n 'generateText|streamText|generateObject|ToolLoopAgent|WorkflowAgent|@ai-sdk' src api ops scripts package.json
rg -n 'writeAuditLog|AdminAuditLog|admin_audit_logs|audit logged' app components lib server
```

Final source scan may retain explicit retirement guards, migration evidence and tests asserting absence. It must find no active import, registration, runtime read/write, provider invocation, scheduled producer or worker for a retired capability. Follow all sibling runtime callers, including MCP/extension/clients; preserve their kept API contracts or coordinate explicit capability retirement.
