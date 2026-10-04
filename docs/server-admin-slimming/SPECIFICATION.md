# Server and Admin slimming specification

Date: October 3, 2026. Status: proposed engineering implementation contract derived from the Owner's explicit removal request. This document authorizes planning only in this session. Production deletion is a later execution task using the reviewed manifest in [the runbook](DATA-AND-STORAGE.md).

## 1. Outcome and boundaries

Remove unused product surfaces, their exclusive server capabilities, their producers, and their stored data. Keep the official Lead → Booking → Cancellation workflows, integrations, Operations Registry, reporting, ingestion, and Daily Operations working. Retain canonical Contact Numbers, provider call metadata, Number↔Lead attachment evidence, RingCentral directory accounts and reviewed Rep Identity Links for future connections.

The interim `/sales-intelligence` has **Numbers and RingCentral Accounts only**. The old All Outreach/Needs Attention, Closed, Attention snapshots, Running Summary, analyses, assessments, AI suggestions, and legacy outreach commands are removed. This is the working interpretation of “remove outreach intelligence snapshots” plus the explicit retained list. It is broader than deleting a Closed filter: legacy planners must stop producing records. The new desk is implemented against its own specification, not reshaped from the retired planner.

No production capacity figures, collection counts, deployed flags, or provider permissions were measured during this planning task. All storage savings are unquantified until the read-only inventory. Source establishes dependencies; it does not establish live deployment state.

Out of scope: implementation now, deleting the Vantage MCP package, changing new desk cadence policy, altering official booking/cancellation rules, bulk importing the historical database, changing Daily Operations, removing operational Google Sheets, deleting provider-owned RingCentral recordings, or deleting shared Mongo/Redis/Blob/GCS accounts.

## 2. Dashboard destination contract

| Destination | Final interim behavior | Server/data consequence |
| --- | --- | --- |
| Overview `/` | Keep weekly/all-time pulse, Waiting for you intakes and create actions | Keep overview analytics and open Booking case projection; remove historical scope choices |
| Daily Operations `/daily` | Keep completely, including Arrivals, panels, colours, snapshot/events/SSE, close/rebuild and Sheet Sync controls | Preserve its own models, collections, hooks, Redis doorbell, routes and retention rules |
| Sales Intelligence `/sales-intelligence` | Numbers + RingCentral Accounts; default Numbers | Split retained reads from old outreach/analysis modules; keep stored metadata and coverage needed to make those reads honest |
| Intakes `/intakes` | Keep all current supported Booking/Release review commands and candidate search | Keep lifecycle receipts, observations, decisions, cases, record links and idempotency |
| Manual `/manual` | Keep Create a Lead and Connect Booking to Lead | Keep canonical commands, catalog, candidates and attachment behavior |
| Form Leads + Duplicate Form Leads | Keep lists, filters, contacts, actions, details and current filtered CSV | Production scope only; preserve duplicate and bad-lead rules |
| Call Leads + Duplicate Call Leads | Keep lists, filters, provenance, actions, details and CSV | Preserve qualification, duplicate window and enrichment |
| Bookings + Cancellations | Keep lists, creates, detail/actions, reconciliation and CSV | Keep customer linkage, Agent allocations, Customer upserts and cancellation unwind |
| Job Timeline `/job-timeline` | Keep evidence-aware timeline | Keep `entity_changes`, lifecycle decisions and command history; remove only links to retired surfaces |
| Testimonials | Keep | Keep testimonial model and public/API reads |
| Analytics | Keep all currently supported reports and in-context CSV, including Agent performance/receiver attribution | Remove historical/combined merge branches; dedicated Agent Sales Report is separate |
| Reporting | Keep custom reports, definitions/revisions, previews, runs, Sheets/destinations, delivery and health | Keep `reporting_*`, Google authorization/selection, queues, cleanup and delivery workers |
| Operations Registry | Keep including Agents, merchants, sources, carriers, CPL and Changes | Keep production `agents`, registry mutations and `operations_registry_changes` |
| Granot Lifecycle | Health is the default and only browse tab | Remove receipt-search and Live Events browse transport; keep backend receipts and Owner repair endpoints |
| Ingestion | Keep Granot HTTP Automation and Best Relocation | Preserve all ingestion state, ingress capture, fencing and durable recovery |
| Extension | Keep user management and extension apply/enrichment APIs | Preserve extension accounts/auth/session invalidation and receipt capture |

Remove sidebar destinations AND direct routes for `/customers`, `/agents`, `/observational/**`, `/exports`, `/audit-log`, `/reports/agent-sales`, `/conversations`, `/live-events`, and `/granot-lifecycle/receipts`. Remove their exclusive code, BFFs, hooks, query keys and tests; retain shared primitives used by kept destinations.

`/granot-lifecycle` redirects to `/granot-lifecycle/health`. Old receipt browse URLs may also redirect to Health without retaining old query state. Other retired destinations return the normal unavailable/not-found page; do not silently mount old panels. Existing new-desk URLs are not enabled by this project. Remove retired destinations from global search, related-record chips, command palettes, contextual links, page titles, permissions and preload behavior.

Removing Customers and Agents **tabs** does not remove their domain models. Production `Customer` is referenced by Bookings, cancellation/customer detail and upserts. Production `Agent` is needed by Operations Registry, allocation/receiver attribution, Analytics and reviewed Rep identity. Remove public/admin CRUD or browse handlers only when the consumer inventory proves they serve exclusively the removed surfaces; retain catalogs, required detail/population helpers and mutations used by kept forms/Registry.

The Exports page is a directory of links to existing CSV endpoints. Inspection found no exclusive Export model/collection. Keep filtered exports on retained lists and Analytics; remove Customer/Agent browse exports when no kept caller requires them, and the dedicated Agent Sales Report export. Reporting's persisted export/delivery artifacts are part of retained Reporting. Change the CSV success text that currently claims “audit logged”. The extension is a confirmed caller of Agent catalog/create/update endpoints; those survive tab removal.

## 3. Historical database removal

Delete the exact database **`vantagemovershistorical`**, including all collections actually present, after writers/readers are retired and the separate backup is verified. Known models there are `agents`, `customers`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`; these names are not a complete production discovery manifest. The database, not merely those six collections, is the Owner-requested deletion target.

Remove `src/models/historical`, registration via `useDb`, historical-only import/consolidation commands and scripts, and all runtime historical/combined query branches. Retire historical browse/search/facets/filter-catalog/analytics/report merge code and caches. Remove dashboard scope selector, scope provider/persistence and historical read-only presentation. Simplify retained DTOs and query keys coherently; production identifiers keep their values. Do not reinterpret a saved historical record ID as a production record ID.

For a transitional server release, omitted scope and explicit `production` remain valid. Explicit `historical` or `combined` is rejected with a clear 400; never map it to production or allow a broad fallback. Admin clears persisted old scope values and removes database-scope query parameters from ordinary navigation. Preserve the distinct Granot `historical_shadow` execution mode, historical facts already inside the main database, timestamp provenance and late-evidence semantics. A lexical search for “historical” is not a deletion command.

Historical consolidation manifests/ledger documents in `vantagemovers`, if any, require actual inventory and reader proof before being classified as removable. Do not delete historical-looking production Leads/Bookings or rewrite analytics totals to simulate deleted data. Production-only Analytics may show lower totals than previously Combined views; record that expected difference.

## 4. OperationalEvents removal and health surgery

Delete the OperationalEvents persistence/report/incident/email notification subsystem, its `/admin/observability/**` endpoints, `/observational` UI and notification-digest cron. Its runtime-configured collection family is `operational_events`, `operational_incidents`, `notification_deliveries`, `operational_report_runs`, plus proven test/custom namespaces selected by that subsystem. Do not drop by prefix or assume an override name; resolve each namespace into the exact manifest.

The event recorder mirrors events into pino then persists events/incidents and notification decisions. Replace kept-workflow diagnostics with the existing structured logger/metric facilities; do not keep a permanent no-op `recordOperationalEvent` facade or re-create a generic event ledger under a new name. Preserve useful event keys, bounded error codes, request IDs and failure severity without copying raw payloads into logs. Keep business errors, retry behavior and transaction ordering unchanged.

This removal affects many retained modules: auth middleware, lead ingestion, CRM, Sheet Sync, RingCentral capture, queues/crons, Reporting and Granot lifecycle. Remove instrumentation-only calls and imports from those modules. Reporting retains its domain delivery/run/definition history, health scan and logger signals; OperationalReportRun is unrelated to ReportingRun. Event-driven owner alert emails/digests disappear with this subsystem. Preserve unrelated invitation mail and retained notification/message delivery functionality; extract any shared email transport/config before deleting its old folder.

### 4.1 Granot health replacement prerequisite

`granotLifecycle/projections.ts` reads OperationalEvents for conflict counts, capture failures, recovered claims and latest queue/cron run. `granotLifecycle/operations.ts` writes OperationalEvents directly inside activation/requeue transactions. Merely disabling `OBSERVABILITY_ENABLED` does not eliminate those writes and breaks health if collections are dropped.

Replace these dependencies before deletion, keeping the existing Health API/UI shape and alert meanings:

| Health fact | Authoritative source after surgery |
| --- | --- |
| Receipt state totals, oldest due, technical retries/dead letters | Existing receipt processing state |
| Cases/discrepancies/link counts, policy outcomes | Existing cases, record links and Synchronization Decisions |
| Capture-to-decision latency | Existing Observation/Decision timestamps |
| Latest queue/cron completed or failed run | Small bounded lifecycle health state, one row per trigger in selected runtime database |
| Rolling capture failures, recovered claims, Owner conflicts by closed code | Bounded time buckets in lifecycle health state, updated at the same owning failure/recovery/conflict seams |
| RingCentral lease/freshness | Existing RingCentral state/rate-gate/lease projection |

Proposed narrow collection: `granot_lifecycle_health_state`; not currently implemented. It stores only aggregate counters, sampled-at/window boundaries, latest-run status and last-run time. No per-event rows, entity payloads, arbitrary details, PII, transcripts or raw receipt bodies. Bound dimensions to the existing closed catalogs, bucket per minute for at least the largest health lookback, suggested 48-hour rolling history, and include a freshness marker. Use atomic bucket increments/CAS and an explicit uniqueness fence. Missing/stale data is unknown, not zero/healthy. Replacement must preserve computed alert windows and cooldown behavior across replicas/restarts; no process-local source of truth.

Migration can seed the current health windows from the soon-to-be-deleted events, then switch writers at a recorded cutover instant. Fence the seeding boundary so dual-write does not double counts; retained windows may also start unseeded with explicit unknown coverage until warm. Choose one method in SLIM-04 evidence. Failed capture before receipt persistence still updates the failure counter when Mongo is available; a database outage falls back to logger/platform metrics and marks health freshness unknown.

Activation retains `granot_lifecycle_activations` with its actor. Requeue keeps actor/reason/transition provenance in bounded receipt command history or an existing appropriate domain command record, with idempotency and revision guards. Do not erase the Owner-command contract to remove the old audit write. Capture `operations.ts` transaction tests before and after. Existing lifecycle metric instrumentation remains; replace the persistence destination only.

Daily Operations does **not** use OperationalEvent as its model. Its separate factory/config/collections and producer hooks remain byte-for-byte protected unless a retained producer's local diagnostic import must be removed. That removal must not touch the Daily fact call or timing.

## 5. Live Events and webhook receipt search

Live Events has no independent business model to delete. It reads Granot Observation Receipts, stored in the legacy-named **`granot_webhook_receipts`** collection, via live SSE. That collection is channel-neutral runtime evidence despite its name. It supports processing, dedupe, retry/dead-letter repair, intakes, provenance and timeline. Keep it, `granot_observations`, decisions, cases, discrepancies, record links and activation history.

Remove only `GET /api/v1/admin/granot-lifecycle/receipts` (search), `GET .../receipts/live` (Live Events SSE), the receipt-search schemas/services, liveReceipt stream/read helpers when no retained consumer remains, Admin `/api/granot-live-receipts`, `live-webhooks.tsx`, receipt search pages/panel and old live links.

Keep `POST .../receipts/:id/requeue`, lifecycle health, ingress `granot-webhook.routes.ts`, extension/automation apply, claim/normalize/process/drain, case creating-observation reads and timeline evidence access. Route removal must be method/path specific: never delete the whole receipts namespace. Daily Operations' `/api/daily-operations-live` and its server SSE remain intact.

## 6. Audit Log model removal

The dashboard Audit Log is **Admin-local**: `server/models/AdminAuditLog.ts`, collection `admin_audit_logs` in the configured `ADMIN_AUTH_DB_NAME` database (example `vantageadmin`, not a hardcoded target). Delete that model/collection, `/api/audit-log`, dashboard page and `writeAuditLog` producers in login/logout/refresh and the API proxy. Remove only audit-only payload construction/tests/copy. Authentication, lockouts/session rotation, user/invite models, trusted proxy signatures, role checks and CSV forwarding remain.

`entity_changes`, `domain_command_executions`, `operations_registry_changes`, and retained CSI capture/attachment/identity audit/idempotency records are separate domain evidence. They are explicitly protected. In particular Job Timeline reads EntityChange, and Form Lead Number/attachment wakeups consume it. Deleting every model whose name includes Audit/Change/Execution would break kept behavior. Legacy AI audit payloads in shared collections are handled by targeted retirement/redaction after the handoff manifest; do not drop the collection.

## 7. Conversations, LLM processing and legacy outreach

### 7.1 Remove all server-owned AI processing

Remove `src/services/conversations` and `salesIntelligence/{analysis,assessment,conversations}` processing, transcription/summarization/extraction/planning, scoped run context/tool reads/submissions, media fetch/storage/playback, AI budget/reservation code and AI-driven effects. Remove the internal scoped run router and its boundary branch, analysis-history reads that return removed data, all owner replay/reanalysis/admission commands, scheduler paths, producer nominations, ops scripts and imports. Separate retained deterministic call/Lead history from `analysis/history.ts` before removing that module if MCP still reads it.

Inspection found production AI SDK callsites in conversation transcriptionProvider, analysis runtime/structuredRuntime/structuredGeneration and assessment generate. Audit scripts/ops/prototypes and manifests too; no runnable server task should invoke these vendors after retirement. Remove AI SDK/vendor packages and dedicated credentials only after whole-repository reference checks. Keep SDKs used by authorized developer quality tooling out of this deletion classification. Do not remove Blob/Google packages needed by retained ingestion/Reporting.

Vantage MCP stays as a package/service. Its client-facing tools for retired analyses/conversations must be removed or return an explicit retired-capability response after the server cuts; retain canonical read-only data tools. Future MCP transcription is outside this work. No production AI fallback or “temporary” background analysis remains.

### 7.2 Remove exclusive stored data and external objects

Drop `lead_conversations`, `intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `intelligence_owner_assessments`, `move_assessment_artifacts`, `sales_intelligence_ai_budget`, `sales_intelligence_ai_reservations`, `sales_intelligence_attention_snapshots`, `sales_intelligence_attention_artifacts`, and legacy `outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days` after dependencies and human facts are detached.

This is physical deletion, not indefinite tombstoning or a flag-only retirement. The last four are scheduled in the final legacy model purge so human commitments and cross-reference consumers can be handled first. A data-derived removal manifest resolves actual collections and references; model absence alone is not proof of zero production data.

Manifest/delete server-owned conversation audio, transcript/analysis/Attention artifact objects and their caches when exclusive to the retired feature. Known conversation path convention is `conversations/<providerRecordingId>.mp3`; enumerate stored object references and confirm owner/store rather than deleting a shared prefix blindly. Do not delete RingCentral's provider recordings, Google reports, ingestion uploads or backups belonging to other retained workflows. Inherited/transcribed summary fields on retained documents must be unset/rebuilt; dropping the analysis collections alone leaves content behind.

### 7.3 Keep the deterministic number/account foundation

Preserve `contact_numbers`, `call_interactions`, `call_interaction_aliases`, `number_lead_attachments`, `rep_identity_links`, current `ringcentral_directory_snapshots`, RingCentral rate-limit state, account tokens/subscriptions and inbound-source assignments. Preserve capture completeness/gap/cursor state, call settle semantics, delayed Call Log refresh, reviewed identity effective dates, attachment revisions/provenance/Owner decisions and contact restrictions.

Do not delete `sales_intelligence_jobs`, `_sync_state`, `_sync_windows`, `_audit_events`, `_command_executions`, `_policy_versions` or `_policy_pointers` wholesale. Their current names cover both kept capture/identity/attachment infrastructure and legacy AI/outreach. Remove dead stages/payload fields and legacy-only documents by proven stage/scope/reference filters. Keep unique fences, durable job recovery, dataset boundaries, command replay and policies still needed by deterministic retained consumers. New-desk configuration uses its own authority from the Sales Outreach Desk contract. Shared schemas must be split so importing a kept Job/Number no longer imports analysis envelopes or Attention DTOs.

Keep human/provider-derived restrictions and number contact-type decisions; a previously recorded suppression is not silently cleared because its AI provenance is being purged. Extract minimal fact/actor/effective-time/reason-code evidence before deleting sensitive source content. Ambiguous restriction authority remains blocked/reviewable. Human callbacks, Owner instructions, assignment intervals, reviewed attachments and messaging delivery uncertainty need a disposition manifest: transfer to the new model under its contract, retain a small inert handoff until reviewed, or explicitly retire them as part of the later execution. They must never be automatically replayed or re-sent. Legacy AI suggestions need no transfer.

`sales_intelligence_owner_instructions`, `_review_items`, `_contact_restrictions` and `owner_rep_nudges` are mixed or human-facing. Keep required minimal history/restrictions while references are migrated; remove old outreach-dependent reads/commands. RingCentral Accounts' existing reviewed-Agent attach and directory `review_context` messaging can stay if required by the retained Accounts tab. Isolate its commands and send-repair from Outreach eligibility; preserve single-attempt sends and unknown-outcome handling. Outreach-specific nudge actions disappear. Do not drop delivery-uncertain nudge rows and accidentally retry a send with a new identity.

The prior sales-rep-tracker pack is not blanket authority to preserve every legacy panel. The retained list excludes old tracker/inbox/goals/assessment surfaces during this interim cut. Inspect actual deployed collection/model presence before any deletion: this checkout does not demonstrate every model named in older planning documents. Human messages, contribution facts, goals, earnings or assignment economics found in another deployed revision must be classified and migrated explicitly, not deleted from a guessed model list.

### 7.4 Read and producer surgery

Numbers currently call `outreach/reads.ts` from `numberActivity/search.ts` and `contactNumbers.ts`. Those reads query Outreach, conversations and assessments. Replace them with direct batched read projections from retained attachments + canonical Leads/Bookings/Cancellations + Call Interactions + restrictions. Preserve none/multiple/resolved attachment identity rather than choosing an arbitrary Lead.

Number list/detail must work with **every retired collection physically absent**. Keep E.164, provider names, classification, counts/times/direction/result/duration, call legs and reviewed rep attribution, attachments, official status/provenance, relevant restrictions and coverage/freshness. Remove Running Summary, stored analysis sections, conversation play/transcript, legacy Outreach status/rank, suggested next steps and AI-derived engagement. Recompute provider-metadata rollups using retained canonical rows. Remove dead summary/schedule/assessment/analysis/Outreach rollup fields from ContactNumber and their writers; keep provider recording IDs as metadata where useful, never server audio/transcript content.

Number capture currently nominates `outreach_ensure` and `recording_discovery`; attachment hooks nominate legacy outreach/media work; EntityChange scanning couples number creation/attachment to outreach ensure. Move necessary Lead Number and attachment nominations into an independent deterministic trigger/recovery path before removing ensure. Preserve fast post-commit wakeup plus the existing bounded durable watermark backstop. Queue consumer and job-recovery dispatch allow **only retained stages** after producer fencing; late old queue messages are acknowledged as retired work without provider calls or recreating collections.

Retained job capabilities: capture_projection, directory, call_log_reconcile/refresh, attachment_refresh, number rebuild and rep_identity_reevaluate as actually used. Keep nudge_repair only for retained Accounts commands/uncertain sends. Remove analysis/application/transcription/media/media_fetch/recording_discovery/move_assessment/outreach_ensure/outreach_derive and legacy Attention publishing. Split `number_refresh`, `backfill`, `retention` and `rebuild`: metadata-only work can remain, but no path may reactivate legacy media/AI/outreach. Rename/reduce configuration after mapping each retained consumer; disabling global CSI ENABLED can break the two kept tabs.

## 8. New Sales Outreach Desk coordination

This request supersedes the older packet's “preserve historical AI evidence” instruction for exclusive transcripts/AI snapshots/models. Preserve minimal required human/provider facts and closure/restriction authority, not an AI pipeline or stored transcript UI. Record this delta in the new-desk coordinator's next packet release; do not independently edit the Admin mirror or bypass its hashes.

New-desk `/outreach/:id` continuity needs an explicit policy because dropping legacy OutreachRecord IDs invalidates old links. Default interim behavior is unavailable/retired. If the new desk requires continuity, build a bounded ID mapping during its migration; never retain the old planner only to keep URLs. “Remove Closed” removes the old Closed browse surface; official Booking/Cancellation and accepted Granot closure evidence remain and the new model still respects them.

Replacement must not consume old Attention, assessment summaries, extracted promises, or old planner timestamps as cadence authority. Build from retained Lead/accepted-priority, provider Call/SMS metadata, assignment and human command evidence. Preserve original received-date quality/age. No bulk legacy backfill activation: it currently can discover media and invoke retired effects. New-desk E01–E06 and remaining Owner policy gates still apply to enforcement; slimming alone does not certify those gates.

## 9. Completion criteria

All removed destinations and exclusive server endpoints are unreachable; Numbers/Accounts perform zero reads/writes against retired collections; no server LLM/media/transcription producer, worker or credential dependency remains; old queue deliveries cannot resurrect data. Granot Health is truthful through failures/restarts with OperationalEvents absent. All listed retained workflows pass representative end-to-end and invariant regression checks. Daily Operations behavior and collections are untouched. Historical database, exact exclusive collection namespaces and feature-owned object files are physically absent after execution. Retained storage has measured budgets, bounded retention/arrays/jobs and monitored capacity. Updated source documentation identifies retired capabilities without deleting source evidence indiscriminately.
