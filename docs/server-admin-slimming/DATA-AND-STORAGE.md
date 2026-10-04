# Physical deletion and retained storage runbook

This is an execution specification, not an executed migration. No production database or object store was inspected or modified in the planning session. Deletion targets below come from model/config source; actual names/counts/indexes/bytes and custom/test namespaces require the read-only manifest. Do not use these tables directly as a shell drop script.

## 1. Collection decisions

### 1.1 Exclusive targets to drop after code retirement

| Database | Collection/target | Preconditions |
| --- | --- | --- |
| `vantagemovershistorical` | Entire database, every discovered collection | Historical/combined readers/importers disabled; exact DB assertion and separate verified backup |
| Selected main runtime DB (`vantagemovers` in production; verify configuration) | `operational_events`, `operational_incidents`, `notification_deliveries`, `operational_report_runs` | Health/provenance replaced; all instrumentation and notification/report workers retired; resolve configured namespaces |
| Selected main runtime DB | `lead_conversations` | No transcript/playback/STT/summary/media/analysis readers or workers; exclusive objects manifested |
| Selected main runtime DB | `intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `intelligence_owner_assessments` | Run tokens/submissions/applications/reanalysis fenced; minimal human/provider restriction facts preserved |
| Selected main runtime DB | `move_assessment_artifacts` | Number/Lead detail no longer depends on assessments; all assessment producers removed |
| Selected main runtime DB | `sales_intelligence_ai_budget`, `sales_intelligence_ai_reservations` | In-flight leases/vendor attempts settled or revoked; shared retained jobs independent of AI accounting |
| Selected main runtime DB | `sales_intelligence_attention_snapshots`, `sales_intelligence_attention_artifacts` | Attention publishers/readers/watchers/janitors retired; external chunks/objects manifested |
| Selected main runtime DB | `outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days` | Legacy planner removed, Numbers independent, human instructions/callbacks/reference disposition complete; old URLs retired/mapped |
| Configured Admin auth DB | `admin_audit_logs` | Admin page/API/auth/proxy writers removed; no other auth data targeted |
| Resolved test/custom namespaces | Proven aliases of exclusive targets above | Exact owner/model/config evidence plus manifest; never prefix-based collection deletion |

Dropping a collection removes its indexes too. Do not create placeholder empty collections or retain old migration/seed commands that will recreate them. Unknown production namespaces are not included by resemblance. No Export-only or Live-Events-only collection was found in this source revision.

### 1.2 Protected collection families

| Data | Protection |
| --- | --- |
| Main `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `customers`, `agents`, testimonials, merchants/carriers | Official records, analytics, registry and relationship linkage |
| Source company/granularity/label mapping, Granot CRM sources, CPL rates/periods/corrections/jobs, inbound number routes/assignments | Attribution, pricing, source policy, ingestion and retained Registry |
| `daily_operations_events`, `daily_operations_days` and resolved runtime/test aliases | Daily Operations untouched; existing retention/closed-day rules prevail |
| `granot_webhook_receipts`, `granot_observations`, Synchronization Decisions, record links, reconciliation cases/discrepancies, lifecycle activations | Durable lifecycle evidence, dedupe/retry, Health, intakes and timeline |
| `entity_changes`, `domain_command_executions`, `operations_registry_changes` | Timeline, revision/provenance, Registry history and command replay |
| `contact_numbers`, `call_interactions`, `call_interaction_aliases`, `number_lead_attachments`, `rep_identity_links`, active directory state | Retained Numbers/Accounts and new desk evidence |
| `sales_intelligence_jobs`, `_sync_state`, `_sync_windows`, `_audit_events`, `_command_executions`, `_policy_versions`, `_policy_pointers` | Mixed infrastructure; targeted dead-stage/field/document cleanup only |
| `sales_intelligence_contact_restrictions`, necessary `_owner_instructions`/`_review_items`, Accounts-related `owner_rep_nudges` | Minimal authoritative human/provider facts and uncertain message outcomes; migrate references before shrinking |
| RingCentral account credentials, webhook receipts/subscriptions, ingest idempotency, rate-limit and lease state | Canonical provider capture and Call Lead ingest |
| Sheet Sync, Lead Message/rate-limit, Booking reconciliation, WordPress ingress/throttle, ingestion conflicts/runs, Granot automation/CSV state | Retained integrations and durable recovery |
| All `reporting_*`, external/Google connections and picker/OAuth state | Retained Reporting; operational-report collections above are different |
| Admin users, sessions/refresh data and invites; Extension Users | Authentication and Extension remain |
| New narrow Granot health state | Aggregate health replacement; bounded dimensions/history |

These are logical protections, not a claim that every deployed namespace has been enumerated. Resolve exact names from models and live read-only listCollections. Protect every unknown collection until classified. Preserve unique identity and idempotency indexes even if they consume material storage.

### 1.3 Targeted cleanup in retained documents

Remove stored transcripts/analysis summaries/assessment/Attention content, running_summary/intelligence schedules and obsolete AI/Outreach rollup fields on ContactNumber and any retained model found to embed them. Recompute canonical call counts from canonical non-merged interactions, not by decrementing guessed totals. Preserve classification/restrictions, Owner decisions, provider IDs and effective-time facts.

Shared jobs: classify by exact stage + dataset + subject/reference ownership; terminalize/revoke old leased/pending work first, then delete eligible legacy rows with a checkpointed bounded scan. Never drop or broadly purge capture/attachment/rebuild/identity jobs. Do not expire pending/leased/retry/dead-letter/paused work merely because its creation date is old.

Shared audit/command/policy/review/nudge rows: strip AI content only after preserving required decision metadata and dedupe/replay authority. Delete only proven exclusive documents. Preserve historical suppression even where its source transcript is removed; record provenance as retired evidence, not a fabricated new human decision. Keep delivery uncertainty and finite reconciliation until it is resolved. Policy versions referenced by kept jobs/commands remain.

## 2. Read-only inventory manifest

For each environment, record without credential values:

- Logical cluster/environment identity, database name, collection UUID/name, model owner, deployed server/Admin/MCP SHAs and observation time.
- `listCollections`, document count, data/storage/index bytes, index definitions/TTL, average/max sampled BSON size, date range and daily growth; bounded samples, no PII in report output.
- Every configured Observability production/test/custom alias and runtime/test model selector. Namespace includes DB + collection; identical collection names in historical/main databases are not interchangeable.
- Job counts by stage/status/dataset, live lease owner/epoch/expiry, run/admission/vendor-attempt state and latest producer activity. Source stage enums are not evidence of actual job presence.
- Retained foreign/reference edges to target IDs, embedded retired content and human fact disposition results; exact orphan queries and counts.
- Exclusive object URI/key/store/owner/content-type/size/hash/version and referencing record IDs; include Attention content-addressed artifacts/caches and feature-owned audio. Objects shared with retained data are excluded.
- Expected post-cut storage savings as **measured allocated/data/index bytes**, separately from logical deleted bytes and provider billable capacity. Dropping records does not guarantee immediate filesystem/billing reduction.

Produce `keep`, `drop`, `migrate`, `unknown` sections and deterministic manifest hash. Every drop entry includes actual database/name/UUID or object store/key/version, writer/reader proof, backup reference, dependency gate and expected pre-drop count/size. Exact counts may change before freeze; refresh the manifest after quiescence. Reject unexpected additions/UUID changes rather than silently broadening the scope.

## 3. Backup and restore boundary

Existing backup Service covers **only `vantagemovers`** via a daily logical mongodump to GCS (`vantage-mongodb-backups-496816`). It explicitly refuses a different database. It does not prove historical/Admin auth DB or conversation/Attention object backup. Do not weaken that invariant to slip other DBs into the existing job.

Before purge, create separate finite pre-deletion backups for historical DB, exact main exclusive/mixed migration targets, configured Admin audit collection and exclusive external objects if rollback is needed. Record namespace, counts, indexes, dump/hash, object generations, timestamps and source manifest hash. Restore into an isolated database/store and demonstrate readability/reference match. Store credentials in existing secret facilities, never document or argv output.

Preserve current backups of retained official records. Proposed removed-data recovery window: 30 days, then expire the special recovery copy and obsolete removed-data object versions under the agreed storage lifecycle. That duration is an engineering recommendation for the later execution, not an already applied policy. If the Owner wants immediate deletion of recovery copies as well, make that explicit in the execution manifest. Existing immutable backup/provider recovery lifecycles may outlive active-data deletion; report the exact expiry rather than claiming universal instantaneous erasure.

## 4. Destructive execution sequence

1. Verify the release gates and test evidence from SLIM-09. Identify the exact production target and establish a separate command/operator context from ordinary app work. Mutation tools are not part of this planning session.
2. Fence legacy producers, scoped run submission/application, jobs and send/lease effects globally; disable retired schedules/triggers and prevent old deployments/preview jobs/backfill tools from writing. Keep provider capture, metadata recovery, ingestion, Sheet Sync, Reporting and Daily on.
3. Wait for or revoke old leases with epoch/commit guards; reconcile in-flight external attempts and uncertain messages. Late messages must be safely acknowledged by the retained consumer. Record zero-runnable/zero-write evidence at cutover and over the observation window.
4. Refresh current manifest and verify cluster/DB/UUID/backup/hash against the explicit allowlist. Assertion failures abort before any mutation. Assert that main/auth/retained namespaces are **not** database-drop targets. Never use collection prefixes, wildcard databases or “all unused collections”.
5. Perform required minimal-fact transfer and retained-document cleanup in bounded, checkpointed, idempotent batches. Verify no forbidden content or functional dangling reference remains and kept data counts reconcile. Unresolved human facts hold only their relevant purge; independent proven targets may proceed.
6. Delete exact exclusive object keys/versioned references while source records/manifest still support enumeration; checkpoint results and retry only safe idempotent deletes. Invalidate dedicated retired cache keys/topics, not the shared Redis instance or Daily doorbell.
7. Drop the explicitly authorized exclusive collections, Admin audit collection in its resolved DB, and exact historical database. The order may vary by backup dependency, but verification is after each target. Do not run a full main-db drop or restore.
8. Verify targets absent, protected namespaces/indexes/counts present, retained flow health and zero retired provider activity. Capture storage/index statistics before/after. Re-run recreation checks after cron/queue/old-request replay and the post-purge observation window.
9. Save redacted execution evidence and final manifest/result hashes. Remove remaining recreating scripts/schema exports/secrets/config, decommission only proven exclusive subscriptions/buckets/objects, and schedule finite recovery-copy expiry through the approved operational process.

Rollback after dropping data is a separate restore operation. Old code must not be redeployed against purged data. Restore a backup in isolation, reconcile with post-cut official data, then explicitly select which removed data to recover. Retired producers remain fenced throughout.

## 5. Retention and capacity policy

“No storage problems for the next few years” requires a measured budget and ongoing limits. The cuts reduce unnecessary growth; they cannot promise unlimited retention at a fixed tier. This table proposes engineering defaults for implementation review. Existing business/evidence contracts win until an explicit retention migration satisfies consumers. In particular **Daily Operations is unchanged by this project**.

| Family | Proposed steady-state control | Dependency gate |
| --- | --- | --- |
| Official Leads/Bookings/Cancellations, customer/Agent/source catalog | No blanket TTL; forecast annual growth, compact only unused fields, retain required financial/provenance facts | Existing system-of-record policy; schema migrations preserve references |
| Daily Operations | Keep existing retention and closed-day/snapshot/event rules exactly | Slimming does not shorten retention or alter board |
| Canonical Call Interactions + aliases | Initial forecast assumes all retained metadata for 3 years; after new desk evidence/late-correction policy is settled, consider cold archive for old calls | No TTL until dedupe, late provider settle, attribution and replay horizon proven; archive aliases together |
| Contact Numbers/attachments/Rep effective-date identity | One current endpoint/projection; paginated historical edges; bounded embedded histories; reference-aware archival | Preserve reviewed decisions and new desk evidence; never expire a number still attached to kept records |
| Directory snapshots | Keep latest usable per account plus proposed 30-day recent snapshots; retain compact effective identity intervals independently | No kept reader resolves old identity by deleted snapshot ID; historical attribution remains valid |
| Completed shared SI jobs | Existing completed-only TTL is 14 days; keep it after schema cuts | Only a genuine completed_at date expires; pending/retry/leased/paused/dead-letter stay; durable consumer/dedupe horizon validated |
| Sync windows/coverage | Compact old completed windows after proposed 30 days to a bounded coverage summary; retain cursors/open gaps/leases | Completeness/replay proof and late-correction consumers permit it |
| Lifecycle receipts/raw payloads | Reference-aware proposal: remove heavy raw payload after 90 days for fully terminal unreferenced receipts; keep minimal transport identity/hash/status and required normalized facts | Intakes/timeline/requeue/decision/dedupe contracts certified; no deletion of pending/retry/dead-letter/open-case evidence |
| Granot observations/decisions/EntityChange/domain command replay | No generic TTL; use minimal facts, bounded value payloads and explicit archival that preserves Job Timeline/command identity | Timeline, provenance, new desk received/priority/assignment consumers and idempotency all prove archive behavior |
| Granot aggregate Health state | Suggested 48h bounded minute buckets plus latest-run rows; finite code/trigger dimensions | Existing lookback/cooldown parity; upsert and stale coverage tested |
| Reporting previews/delivery temp artifacts/ingestion uploads/OAuth nonce state | Keep existing domain janitors/expiry; measure stale/failed backlog, add reference-aware limits where missing | Report revision/run proofs and restore links retained; no deletion of active deliveries |
| Shared CSI audit/command/policy history/human handoff | Remove heavy AI payload, retain minimal facts; later archive in bounded pages | Reviewed decisions, capture identity and command replay survive; handoff expiry after disposition |
| Logger/platform logs | Finite platform retention, bounded field sizes and error sampling with coverage alerts | Keep required useful diagnostic signals after OperationalEvents deletion |
| Special removed-data backup | Proposed 30-day recovery copy, finite object version retention | Verified isolated restore and explicit execution-manifest policy |
| New deterministic desk | Admission/storage budget, minimal Call/SMS evidence, bounded task/history projections and retention policy before activation | New desk E05, late-evidence/correction/replay/assignment contracts; no transcript or AI artifacts |

Do not add a TTL on createdAt to a mixed-work collection. TTL is asynchronous and does not enforce reference checks. Use TTL only for independently expirable terminal work/temp state; use fenced, resumable reference-aware janitors for evidence. A TTL index on heavily expired existing data must be introduced after bounded backfill deletion to avoid an uncontrolled deletion surge. Dropping unused indexes requires explain evidence for kept query shapes; preserve unique/index fences.

## 6. Forecast and monitoring contract

At baseline and 7/30 days after cutover, measure per-family documents/day, BSON + index bytes/day, retained payload distribution, object bytes, write operations, scan/query latency, oplog window/lag, queue backlog, oldest pending/retry/dead-letter age and health freshness. Measure canonical call metadata capture separately from qualified Call Lead ingest so an apparent reduction is not lost evidence.

Calculate a 3-year footprint per family:

`forecast = current retained footprint + daily growth × min(1095, retention days) + index growth + archive/object/backup footprint`,

with finite rolling-retention families modeled at steady-state and non-expiring official data at full 1095-day growth. Apply at least 2× observed arrival-rate/burst scenario; choose storage capacity and reserved headroom explicitly from measured results. Track Mongo hot data/index, cold objects and backup generations separately. No fabricated GB estimate or saving percentage is accepted.

Proposed alerts to configure in existing platform monitoring (not a new Mongo event ledger): 70% storage capacity warning, 85% urgent, forecast exhaustion within 90 days, material growth regression versus the agreed baseline, stale health state, failed retention/backup runs, queue age beyond domain SLA and oplog lag/window outside new-desk E05 thresholds. Final values depend on measured tier/traffic and are recorded in the release evidence. Alerting must remain operational after the old email notification subsystem is removed.

Janitors use page/byte/time budgets, checkpoint/CAS/lease fences, incremental scans and closed predicates; errors pause the affected purge rather than expanding it. Avoid full collection scans/rebuilds on each dashboard GET. Retained Number detail stays batched and paginated. Cap embedded arrays/provider payloads/history and store overflow/completeness markers rather than silently dropping evidence. New cadence projections should coalesce repeat nominations and write only on semantic change.

## 7. Required deletion acceptance report

The final report contains deployed SHAs, exact manifest/hash, authorization context for the execution task, cutoff/fence/lease evidence, isolated restore proof, before/after namespace/count/index/storage/object statistics, protected-data reconciliation, retained-workflow results, old-job/request/provider negative proof, observation-window results, remaining backup-copy expiry and measured 3-year budget. Unknowns/skips are explicit. No claim of successful deletion, permanent erasure, immediate billing savings or multi-year capacity is made without those measurements.
