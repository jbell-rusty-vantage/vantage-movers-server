# Lane S-OUT evidence: job fencing and legacy Outreach model removal (SLIM-06 fence, SLIM-07)

October 4, 2026. Server repo `vantage-main-server`, branch `slim/server-admin`, uncommitted (the coordinator commits). Lane S-AI edited the same checkout at the same time. Where we both touched a shared file, I read the current version before each edit and kept S-AI's changes (see "Shared-file notes").

## What changed and why

### 1. Fence first: only retained stages can be enqueued, claimed or dispatched (SPEC §7.4)

- **`src/config/domain/salesIntelligence.ts`.** `CSI_JOB_STAGES` now holds only the retained stages: `capture_projection`, `call_log_reconcile`, `call_log_refresh`, `directory`, `attachment_refresh`, `rebuild`, `nudge_repair`. The new `CSI_RETIRED_JOB_STAGES` lists the stages earlier releases wrote: `outreach_ensure`, `outreach_derive`, `recording_discovery`, `media`, `media_fetch`, `transcription`, `analysis`, `application`, `number_refresh`, `backfill`, `retention`, `rep_identity_reevaluate`, `move_assessment`. The helper is `isRetainedCsiJobStage`.
- **`src/services/salesIntelligence/jobs.ts`**
  - `enqueueCsiJob` refuses a retired stage before it reads anything: `CsiError("INVALID_INPUT", [{ path: "stage", code: "stage_retired" }])`.
  - `claimCsiJob` refuses a retired `stage` argument. An undirected claim, or a claim by id, filters on `stage ∈ CSI_JOB_STAGES`, so a retired row is never leased.
  - **New `retireLegacyCsiJobs({ jobId?, limit? })`.** It finds up to 500 rows of a retired stage in `pending`/`leased`/`retry`/`paused` and sets `status: "retired"`, `reason: "stage_retired"`, `lease_owner: null`, `leased_until: null`, `completed_at: now`, and `$inc lease_epoch`. Bumping the epoch revokes a lease an older deployment still holds: its renew/continue/complete/fail writes all require `status: "leased"` with the epoch it claimed, so they find no row and its transaction rolls back. `completed_at` hands the row to the existing 14-day completed TTL. The sweep never touches `completed` or `dead_letter` rows. It uses the raw collection because retired values are outside the retained schema enum on purpose.
  - Removed: the AI live-priority claim gate, `minPriority`/`historical` claims, `owner_reanalysis` and `rep_identity_window` inputs, `checkpointCsiJob` (the analysis evidence fence), and the `permission_denied`/`budget_exhausted`/`per_recording_ceiling`/`recording_pending`/`eligibility_pending` fail reasons. Retained fail reasons: `transient`, `schema_invalid`, `throttled`. `resumeAt` is kept because Call Log refresh uses it.
- **`src/models/salesIntelligence/infrastructure.ts` (Job schema).** The stage enum is retained-only. The status enum gains `retired`. Removed fields: `evidence_fence`, `result_ref`, `owner_reanalysis`, `rep_identity_window`. The Job model no longer imports analysis envelopes, Attention DTOs or the Attention manifest.
- **`src/services/numberActivity/jobDispatch.ts`.** Retained handlers only: `capture_projection`, `rebuild`, `attachment_refresh`, `nudge_repair`, `call_log_refresh`. A wake-up for a row of any non-retained stage returns `{ status: "retired", job_id, stage, retired }`, terminalizes that row through `retireLegacyCsiJobs({ jobId })`, and never reaches a handler. The queue message is acknowledged (no throw), with no provider call and no effect. Injectable `loadJob`/`retire` make this unit-testable.
- **`api/queues/sales-intelligence-consumer.ts`**: unchanged. It delegates to the dispatcher.
- **Job recovery cron.** The first step after `connect` is `retireLegacyCsiJobs()`. Its result is in the response as `retired_jobs`. A failed sweep is logged (`sales_intelligence.cron.retire_legacy_jobs.failed`) and recovery continues, because claims exclude retired stages anyway. The `extraRecovery` defaults are now `nudge_repair` (`NUDGE_ENABLED`), `attachment_refresh` (`ATTACHMENT_REFRESH`) and `call_log_refresh` (`CAPTURE_WEBHOOK`). The rep-identity, Outreach ensure and backfill activation drains are gone.

### 2. Schedules (`vercel.json`, `src/routes/sales-intelligence-cron.routes.ts`)

- Removed the schedules, routes, handlers and deps for `sales-intelligence-outreach-ensure`, `-attention-publish`, `-overview-refresh` and `-backfill-step`. S-AI removed `-extract`, `-apply`, `-transcribe` and `-media-fetch` in the same files.
- `sales-intelligence-attachment-refresh` moves from `*/5` to `* * * * *` (wave-1 hand-off 4). It is the durable backstop for Lead attachment wake-ups now that the minute Outreach ensure cron is gone.
- Kept: `call-log-reconcile`, `call-log-sweep`, `job-recovery`, `directory-sync`, `attachment-refresh`, `webhook-subscription`, `nudge-repair` (Accounts `review_context` receipts only) and `retention`.
- **`retention`** is reimplemented (`src/services/salesIntelligence/retention.ts`). It keeps only the Call activity purge over retained provider metadata: `call_interactions` older than `retention.audit_days` lose parties, legs, recordings, external number and provider names, while provider ids and aliases are kept. Stale `contact_numbers` are tombstoned with the **retained** rollup shape, their attachments are deleted, and nudge content tied to that number is redacted.
  - Removed: Blob audio deletion, transcript/analysis content purge, `outreach_followups`/`outreach_records` writes, the writes of the removed ContactNumber fields `running_summary`/`intelligence_schedule`/retired rollups, and `purgeMoveAssessments`.
  - It never touches `sales_intelligence_jobs`. Completed jobs expire by their own `completed_at` TTL; pending/leased/retry/paused/dead-letter rows are never expired.
  - The summary is now `{ skipped, skip_reason, activity_purged, numbers_purged }`.
  - `retentionPolicy.ts` keeps S-AI's `resolveActivityRetentionDays()`. `csiRetentionDays()` returns only `activity_days` (env `SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS`, default 730).

### 3. Legacy Outreach model purge (SLIM-07)

- Deleted `src/services/salesIntelligence/{outreach,overview,followups,casefile,backfill}/**` (102 tracked files: Attention, artifacts and manifests, Closed, ensure/derive, transitions, effects, timeline, reads, band transitions, rep days, Overview, follow-up commands, Team 4 Case File, legacy backfill planner/activation).
- Also deleted `roster.ts` (Overview only), `fixtures.ts` (Attention DTO fixtures), `review/restrictions.ts` (AI spoken-restriction writer) and `repIdentity/worker.ts` (wave-1 hand-off 2).
- Deleted `legacyNumberFields.ts` together with every module it served: `outreach/reads.ts`, `ops/lib/full-backfill.ts`, `ops/full-backfill.replica.test.ts` and `ops/lib/call-log-repair.ts` (wave-1 hand-off 1). After this, no writer of a removed ContactNumber field can be dispatched (ContactNumber is `strict: "throw"`).
- Models: deleted `src/models/salesIntelligence/{outreach,overview,attentionArtifact}.ts` and the facades `src/models/{OutreachRecord,OutreachFollowup,SalesIntelligenceAttentionSnapshot}.ts`. `infrastructure.ts` drops the `sales_intelligence_attention_snapshots`, `sales_intelligence_ai_budget` and `sales_intelligence_ai_reservations` schemas. `registry.ts` and `index.ts` no longer list Outreach, follow-ups, Attention snapshots/artifacts or rep days. S-AI separately removed the AI models and moved the kept owner instruction / review item / restriction models to `models/salesIntelligence/review.ts`.
- `models/salesIntelligence/common.ts`: removed the Outreach/analysis-only `subject`, `assignment` and `dateResolution` sub-schemas. `capture.ts` drops the dead sync-state cursor `audit_recorded_at`/`audit_event_id` (old analysis source scan) and the dead sync-window `activation_*` / `permission_paused` fields (old backfill activation).
- `review/items.ts` is kept (the attachment store opens `identity` reviews for contested auto-attach). `ReviewCause` is narrowed to `"identity"` and it no longer imports the Outreach store. `transactions.appendCsiAudit` accepts only the retained invalidation kinds; the stored enum still accepts the historical ones.
- `auth.ts`: removed the scoped run-token code (`runClaimsSchema`, `signRunToken`, `verifyRunToken`, `requireCsiRun`, `authorizeCsiRun`, `issueCsiRunToken`; their consumers, the internal run router, boundary branch and analysis, are S-AI deletions) and the dead `csiRepScope`. Kept: the Owner/rep boundary (`requireCsiOwner`, `requireCsiReader`, `isCsiRepActor`), `csiOperatorActor` and `csiWorkerActor`.
- `dto.ts` keeps only `ownerCoverageDtoSchema` and `csiSettingsReadDtoSchema` (plus the coverage re-exports). Every Attention/Outreach/follow-up/finding/assessment/timeline DTO is removed.
- `src/validation/v1/salesIntelligence.ts` (shared, targeted edits):
  - `csiCommandSchema` has only `rebuild_number`, `attach_lead`, `reject_attachment`, `detach_attachment`. `expected_revisions.target` is `attachment|number|rep`. `CSI_OWNER_ACTIONS` drops `plan_backfill`.
  - Removed: `csiSubjectSchema`, `csiDateResolutionSchema`, `csiFollowupInputSchema`, `csiListQuerySchema`, `csiBackfillCommandSchema`, `csiSubmissionReceiptSchema`, and the import of the analysis envelope validation.
- Config: removed `CSI_CONTRACT_VERSION`, `CSI_ACTION_KINDS`, `CSI_OUTREACH_STATES`, `CSI_EFFECT_STATUSES`, `CSI_EXTRACTION_MODELS`, `CSI_TOOLS`, `csiMediaMaxBytes`, `csiProviderConfiguration`, `csiBackfillDays`, `CSI_LIVE_JOB_PRIORITY`, `CSI_BACKFILL_JOB_PRIORITY`, `csiBootstrapNumbers`, `isCsiServiceRoute`, `matchesCsiServiceRouteTemplate`, and the error codes no retained code raises. `RUN_SCOPE_DENIED` is kept because S-AI's retirement guard uses it.
  - `CSI_FLAGS` = `ENABLED`, `CAPTURE_WEBHOOK`, `CAPTURE_CALL_LOG`, `DIRECTORY_SYNC`, `ATTACHMENT_REFRESH`, `AUTO_ATTACH`, `NUDGE_ENABLED`, `WEBHOOK_AUTO_CREATE`, `FORM_LEAD_NUMBERS`, `NUMBERS_HAS_CALLS_DEFAULT`, `RECEIVER_LATEST_WINS` (read directly by `granotLifecycle/leadDesiredState.ts` for the Lead's `receiver_agent`), and `REP_ACCESS`.

### 4. Admin router, settings, policy, live (SPEC §7.3, wave-1 hand-offs 3, 5, 6)

- `sales-intelligence-admin.routes.ts`: **`POST /backfill` is retired (404).** Its activation could nominate media, AI and Outreach work, and there is no metadata-only Call Log backfill to keep. All 20 other interim routes from S-NUM-CONTRACT are unchanged, with the same Owner-only boundary: Admin, scoped keys and reps get `403 OWNER_REQUIRED`.
- `/settings` carries only retained settings.
  - The policy (`csiPolicySchema`, strict on write) is `{ version, timezone, staffed_hours, enabled_capabilities: ("capture"|"nudges"|"live")[], retention: { audit_days } }`.
  - Older stored versions are read through the new `csiStoredPolicySchema`. It ignores retired fields (AI ceilings, Outreach due times, audio/transcript retention, Attention evolution) and retired capability names. It never rewrites them.
  - The GET DTO drops `models`, and `flags` lists the retained switches only.
  - `PATCH` rejects any retired field.
- `policy.ts` no longer imports `aiBudget`, the AI budget model, the job model or the fanout publisher. A settings change no longer resumes paused AI jobs or touches `sales_intelligence_ai_budget`. Retained readers are `ownerCoverage` (staffed clock), `nudges/eligibility` (`nudges` capability) and `retentionPolicy` (`audit_days`).
- `live.ts` watches only `contact_numbers`, `call_interactions`, `number_lead_attachments`, `sales_intelligence_contact_restrictions`, `rep_identity_links`, `owner_rep_nudges`, `sales_intelligence_audit_events`, `sales_intelligence_sync_state` and the policy collections. Topics are `number`, `attachment`, `restriction`, `rep`, `nudge`, and `other` for unmapped collections. Versioned frames (`version: 2`, `refetch: "all"`) and reconnect/clock resync are unchanged. `REP_LIVE_TOPICS` and the `topics` option are removed (hand-off 5): the router refuses reps on `/live`.

### 5. ops and package scripts

- Deleted the tracked ops tasks (all verified tracked and unmodified before deletion, so git history keeps them):
  - Attention: `attention-read-proof`, `attention-storage`, `inspect-attention-walks`, `test-attention-manifest-replica`, `lib/attention-storage-guard(.test)`.
  - Outreach re-ensure and backfill: `reensure-outreach`, `lib/reensure-outreach`, `backfill-outreach-trigger-instant(+lib)`, `reconcile-priority5`, `lib/priority5-reconcile`, `lib/legacy-outreach-fingerprint(.test)`, `refingerprint-numbers`, `report-si-state`.
  - Finite one-off backfills that re-ensured Outreach: `backfill-sole-match-attachments`, `backfill-form-lead-contact-numbers` + `lib/form-lead-numbers-backfill(.test)`, `backfill-receiver-agent` + `lib/backfill-receiver-agent.lib`.
  - The AI full backfill: `backfill-csi-full-personal`, `full-backfill.replica(.test)`, `lib/full-backfill(.test)`.
  - The capture-and-AI repair pipeline: `repair-call-log-capture`, `lib/call-log-repair(.test)`, `lib/call-log-repair-stages`, `lib/backfill-csi-structured-analysis.lib(.test)`.
- Kept: `ops/test-csi-enqueue-replica.ts`, now on a retained stage with a retired-stage fence proof added, plus `lib/call-log-repair-recovery.ts` + `stamp-capture-recovery.ts`, `stamp-form-created-numbers`, `backfill-rep-team-messaging` and `numbers-slim.replica`.
- The gitignored local `scripts/` tree was **not touched**.
- `package.json`: removed `test:csi:outreach:replica`, `test:csi:lead-progress:replica`, `test:si:desk:replica` and `reconcile:lead-progress`. S-AI removed its own entries, including `test:csi:full-backfill:replica`.

## Retained behavior preserved and how verified

| Behavior | Verification |
| --- | --- |
| Retained stages still enqueue, claim, renew, continue, fail (incl. `throttled` + `resumeAt`) and complete | Call Log refresh, capture, rebuild, attachment and nudge suites below; `ops/test-csi-enqueue-replica.ts` (written, not run, see below) |
| Late wake-up of every retired stage: acknowledged + terminalized, handler never called; an already-terminal retired row is acknowledged with no effect; a retained stage is dispatched and never retired | `api/queues/sales-intelligence-consumer.test.ts` (7/7) |
| Enqueue and claim of every retired stage are refused before any database access | same file |
| Only the five retained handlers exist; no retired stage is in `CSI_JOB_STAGES` | same file; `repIdentity/identity.test.ts` |
| Recovery runs the fence first, reports `retired_jobs`, keeps recovering when the sweep fails; no rep stage in recovery | `sales-intelligence-cron.routes.test.ts` (7/7); `repIdentity/routes.test.ts` (2/2) |
| vercel.json has only retained SI schedules; attachment refresh every minute; queue topic unchanged | cron routes test, `attachment/wiring.test.ts` (3/3), consumer test |
| Exact interim admin route list (20 routes) and the Owner-only access matrix | `sales-intelligence-rep-access.test.ts` (3/3); `sales-intelligence-admin.routes.test.ts` (3/3, `/backfill` asserted 404) |
| Settings: retained policy only, retired fields/capabilities rejected, a legacy stored version reads as its retained part | `settings.test.ts` (4/4), `foundation.test.ts` (6/6) |
| Live: only Numbers/Accounts collections, slug-only frames, coalescing, versioned reconnect | `live.test.ts` (3/3) |
| Numbers timeline route unchanged without `TIMELINE_V2` | `sales-intelligence-admin.timeline.test.ts` (1/1) |
| Accounts messaging, capture health, deployment stamp | `nudges/nudges.test.ts` 10/10, `nudges/routes.test.ts` 2/2, `ownerCoverage.test.ts` 12/12, `deploymentStamp.test.ts` 4/4 |
| Daily Operations | no protected file edited |

## Checks run (real results)

- Server typecheck (`heavy.sh … tsc --noEmit`), on the shared checkout with S-AI's in-flight edits: first run 16 errors, all in my files or tests, all fixed. **Second run: 0 errors (exit 0).**
- Focused unit tests (each file alone, `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test <file>`): all pass. Consumer 7, settings 4, foundation 6, live 3, cron routes 7, admin routes 3, admin timeline 1, rep-access 3, identity 7, repIdentity routes 2, attachment wiring 3, nudges routes 2, nudges 10, ownerCoverage 12, deploymentStamp 4.
- Full server suite (`heavy.sh … --test --test-concurrency=2 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"`): see the result recorded at the end of this file.
- rg proofs, run from the server root over `src api ops`:
  - No import of `salesIntelligence/{outreach,overview,followups,casefile,backfill,roster,fixtures,legacyNumberFields}`, `OutreachRecord`, `OutreachFollowup`, `SalesIntelligenceAttentionSnapshot`, `attentionArtifact`, `repIdentity/worker` or `review/restrictions`.
  - None of those directories exists.
  - The only `stage: "<retired>"` literals are in tests asserting refusal/retirement. The only other retired-stage strings in non-test source are `CSI_RETIRED_JOB_STAGES` itself.
- **Replica proof: NOT RUN.** `ops/test-csi-enqueue-replica.ts` targets the documented local `rs0` on `127.0.0.1:27017`. The Docker CLI hangs (`docker ps` timed out after 30 s, exit 124), the same unresponsive daemon wave 1 reported. The added `proveRetiredStageFence` asserts:
  - pending/retry/paused/unexpired-leased retired rows become `retired` with the epoch bumped and the lease cleared;
  - dead-letter and completed rows are untouched;
  - nothing claims a retired row, by id or undirected;
  - a late wake-up is acknowledged without a handler;
  - the old holder's `completeCsiJob` gets `LEASE_LOST` before its mutation runs;
  - the sweep is idempotent;
  - enqueue refuses the stage and writes nothing;
  - `listCollections` is unchanged.

  Run it with `node --import tsx ops/test-csi-enqueue-replica.ts` once a local replica answers.

## Shared-file notes (concurrent with S-AI)

- S-AI edited files in my ownership while I worked: the cron router and its test, `foundation.test.ts`, `models/salesIntelligence/{index,registry}.ts`, `retentionPolicy.ts`, `vercel.json`, `package.json`. I re-read each before editing and finished only the remaining Outreach/Attention/Overview/backfill parts.
- I overwrote S-AI's `retentionPolicy.ts` once by mistake, restored its `resolveActivityRetentionDays()` API, and now use it. I may also have replaced an S-AI edit of `retention.ts`. My version is the complete retained implementation (no media/transcript/Outreach paths) and uses S-AI's resolver. **S-AI should confirm nothing else it needed in `retention.ts` was lost.**
- `src/validation/v1/salesIntelligence.ts`: I narrowed the command union in one block, including the analysis commands. S-AI should not re-add them.

## Cross-lane items

1. **S-AI:** `retention.ts` no longer deletes conversation audio (`lead_conversations.media.blob_pathname`) or the `result.pending_blob_delete` pointers on completed `media_fetch` jobs. Those Blob objects must be in S-AI's object manifest **before** the 14-day completed TTL removes the job rows that point at them.
2. **S-NUM / integration:** `src/services/numberActivity/reconcileCallLog.ts` still exports `BACKFILL_LEASE_SCOPE = "backfill"`, which is now unused (its only reader was the deleted backfill). Remove it; it is not in my ownership.
3. **S-NUM / integration:** `src/models/OwnerRepNudge.ts` keeps `outreach_record_id` (with `ref: "OutreachRecord"`, a dropped model), `expected_outreach_revision`, `outreach_state` and index `nudge_outreach_created` for historical rows (HUMAN-FACTS: never repaired). Nothing reads by `outreach_record_id` any more. The index is a dead-index candidate; the `ref` is harmless unless populated.
4. **A-SI (Admin):**
   - `POST /api/v1/admin/sales-intelligence/backfill` is gone (404).
   - `GET /settings` no longer has `models`, and `data.policy` is the retained shape above. `flags` keys are only the retained switches.
   - Live frames only carry topics `number|attachment|restriction|rep|nudge|other`.
   - Job recovery responses carry `retired_jobs` (cron-only, not Admin).
5. **DATA / integration (`ops/slimming/policy.ts`, `deletion-manifest.json`):** update the classification per the manifest needs below: the C2 stage list, the C6 cursors now final, the `retired` status, `sync_windows` and the audit kind `rep_identity.reevaluated`.
6. **Docs (wave 3):** the Service docs for Outreach/Attention/Overview/Case File/backfill/live under `docs/knowledge/services/` describe retired behavior. Obsolete env names (no reader left):
   - flags: `SALES_INTELLIGENCE_{OUTREACH_ENSURE,ATTENTION_MANIFEST,ATTENTION_V2,ATTENTION_EVOLUTION,LEAD_PROGRESS,PROGRESS_PLAN,CASE_FILE,CITATION_HANDLES,PRIORITY5_CLOSURE,RECEIVER_ASSIGNMENT,OVERVIEW,TIMELINE_V2,LIVE_SSE,PROVIDER_READS,EXACT_EVIDENCE_VERIFICATION,MOVE_ASSESSMENT,MEDIA_ENABLED,STT_ENABLED,EXTRACTION_ENABLED}`;
   - settings: `SALES_INTELLIGENCE_{BACKFILL_DAYS,FIRST_ACTION_DUE_STAFFED_MINUTES,MISSED_CALLBACK_DUE_STAFFED_MINUTES,GOING_COLD_STAFFED_MINUTES,AI_MONTHLY_CEILING_CENTS,AI_PER_RECORDING_CEILING_CENTS,RETENTION_AUDIO_DAYS,RETENTION_TRANSCRIPT_DAYS}`.

   Still read: `SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS`, `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS`, the nudge settings and `SALES_INTELLIGENCE_DEPLOYMENT_ID`.
7. **Rollback limit:** a policy version written by the slim server has only the retained fields. A pre-slimming build's strict policy reader would reject it. Do not `PATCH /settings` until the observation window has passed, or re-point the policy pointer to a pre-slimming version before rolling code back.

## DATA-MANIFEST NEEDS

Drop, after the slim server is deployed and quiesced:

- Collections in the main runtime DB (`vantagemovers`):
  - `outreach_records` (8,696), `outreach_followups` (585), `outreach_band_transitions` (7,110), `outreach_rep_days` (72): no model, reader or writer remains. Back up `outreach_records` and `outreach_followups` first (HUMAN-FACTS inert handoff).
  - `sales_intelligence_attention_snapshots` (5) and `sales_intelligence_attention_artifacts` (1,025): no publisher, reader, janitor or watcher remains.
  - `sales_intelligence_ai_budget` and `sales_intelligence_ai_reservations`: schemas removed here (S-AI owns the AI evidence; listed for completeness).
- `sales_intelligence_sync_state`: delete documents with `scope` in
  - `attention_artifacts:csi-production:vantagemovers`, `attention_publish`, `attention_publish_fence:csi-production:vantagemovers`, `overview_refresh`, `outreach_repair:OutreachRecord`, `intelligence_source_scan` (C3);
  - **plus, now final (C6 resolved):** `outreach_ensure`, `outreach_entity_changes`, `outreach_repair:FormLead`, `outreach_repair:CallLead`, `outreach_repair:CallInteraction`. The Lead→attachment trigger uses its own scope `attachment_entity_changes` (S-NUM) and the `attachment_watermark:*` rows, so nothing reads the outreach cursors.
  - Also `backfill` (lease) and `backfill:call_log`, if present (none at inventory).
  - Generic form for other datasets: `attention_artifacts:<deployment>:<database>`, `attention_publish_fence:<deployment>:<database>`.
- `sales_intelligence_jobs`, by exact stage (all statuses, once job recovery has retired the runnable ones and no row is `leased`): `outreach_ensure`, `outreach_derive`, `recording_discovery`, `media`, `media_fetch`, `transcription`, `analysis`, `application`, `number_refresh`, `backfill`, `retention`, `rep_identity_reevaluate`, `move_assessment` (= `CSI_RETIRED_JOB_STAGES`).
  - Compared with the inventory's C2 list, **add `number_refresh`** (18,687 rows: the AI number refresh, no retained consumer), **`rep_identity_reevaluate`** (32 rows; S-NUM removed the producer and I removed the consumer), and `backfill`/`retention` (0 at inventory).
  - Rows of these stages that the fence terminalized carry `status: "retired"`, `reason: "stage_retired"` and a `completed_at`, so the TTL also removes them within 14 days.
  - Before purging `media_fetch` rows, enumerate `{ stage: "media_fetch", "result.pending_blob_delete": { $type: "string" } }` for S-AI's Blob manifest.
- Dead fields on retained documents:
  - `sales_intelligence_jobs`: `owner_reanalysis` (765 non-null), `rep_identity_window`, `evidence_fence`, `result_ref`. All are on retired-stage rows only, so the stage purge removes them.
  - `sales_intelligence_sync_state`: `cursor.audit_recorded_at` and `cursor.audit_event_id` (written only under `intelligence_source_scan`, deleted above).
  - `sales_intelligence_sync_windows`: `activation_status`, `permission_paused`, `activation_contact_cursor`, `activation_number_id`, `activation_call_at`, `activation_call_id`. The collection had 0 documents at inventory, and no runtime reader or writer remains after the backfill removal. The model is kept per the brief and SPEC §7.3.
  - `contact_numbers`: the S-NUM list stands (`running_summary`, `intelligence_schedule`, `content_purge_pending`, `retention_epoch`, `evidence_fence`, `rollups.{open_outreach_count,conversations_analyzed_total,last_analyzed_at,outreach_records_total,last_meaningful_contact_at}`). The new retention writes only the retained rollup keys and never re-adds them.
  - `sales_intelligence_policy_versions` (4 versions): `first_action_due_staffed_minutes`, `missed_callback_due_staffed_minutes`, `going_cold_staffed_minutes`, `monthly_ceiling_cents`, `per_recording_ceiling_cents`, `cooldown_attempts_24h`, `retention.audio_days`, `retention.redacted_days`, the seven Attention-evolution fields, and the retired `enabled_capabilities` values `media|transcription|analysis`. These are inert: the reader ignores them. **Keep the documents** (policy history, referenced by commands). Optional unset only if the Owner wants it; not required.
- Retired kinds in audit/command collections:
  - `sales_intelligence_audit_events`: add `rep_identity.reevaluated` (worker actor, producer and consumer gone) to the C4 retired-producer set.
  - Keep `channel_paused`: it is the provenance of the 16 kept restrictions (HUMAN-FACTS).
  - Keep Owner-actor `assign`/`start_call`/`end_call`, and `review_opened` (identity reviews are still written).
  - The invalidation kinds `outreach`, `followup`, `analysis`, `restriction` stay valid in the stored enum (append-only history).
  - `sales_intelligence_command_executions`: keep all 813 rows (replay authority), including the retired `assign`/`start_call`/`end_call`/`reanalyze`/`update_settings` commands.

Must NOT remove:

- `sales_intelligence_jobs` rows of stages `capture_projection`, `call_log_refresh`, `attachment_refresh`, `rebuild`, `nudge_repair` (any status).
- `sales_intelligence_sync_state` scopes `deployment`, `directory`, `webhook_receipts`, `webhook_subscription_maintenance`, `call_log_all_directions`, `call_log_sweep`, `attachment_suggest`, `attachment_entity_changes`, `attachment_watermark:*`, `retention` (the retention lease, still used), `rep_identity:*`.
- `sales_intelligence_policy_versions` and `_policy_pointers` documents (active pointer `csi-policy-bfcdf38dbe19c538021e6b9e`).
- The `sales_intelligence_sync_windows` collection and its unique index (kept per brief; empty).
- `sales_intelligence_review_items` (identity reviews are still opened), `sales_intelligence_contact_restrictions`, `sales_intelligence_owner_instructions`, `owner_rep_nudges`: unchanged from HUMAN-FACTS.
- The indexes `csi_job_dedupe_unique`, `csi_job_due`, `csi_job_lease`, `csi_job_claim`, and the `csi_job_completed_ttl` TTL (14 days), which also expires fenced `retired` rows.

## Full suite result

`heavy.sh env DOTENV_CONFIG_PATH=C:/nonexistent.env NODE_OPTIONS=--max-old-space-size=6144 node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"` (2026-10-04, run on the shared checkout with S-AI's in-flight deletions):

- **2,613 tests, 2,476 pass, 0 fail, 0 cancelled, 137 skipped**, exit 0, 1,597 s.
- Wave 1 recorded 3,146 tests. The difference is the tests deleted with the retired AI/Outreach modules in this wave (both lanes).
- The 137 skipped tests are skip-gated suites that need a live replica or environment.
