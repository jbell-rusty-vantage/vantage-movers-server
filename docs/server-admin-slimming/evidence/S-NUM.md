# Lane S-NUM evidence: independent Numbers and RingCentral Accounts (SLIM-05)

October 3, 2026. Server repo `vantage-main-server`, branch `slim/server-admin`, uncommitted (the coordinator commits). The interim HTTP contract the Admin lane builds against is [S-NUM-CONTRACT.md](S-NUM-CONTRACT.md).

## What changed and why

### Deterministic Numbers read facade (SPEC §7.4)

- **New `src/services/numberActivity/leadContext.ts`.** One batched read per page: attached edges from `number_lead_attachments`, then `form_leads` / `call_leads`, the Lead's exact `booked_leads` rows (`lead_model` + `lead_ref`) and their `cancelled_leads`. `resolveAttachedLead` keeps none/multiple/resolved identity (only exactly one `attached` edge resolves; candidates/ambiguous/rejected never lend a Lead; several attached = `multiple`, no Lead field). `officialLeadState` = Lead flags first, then newest exact Booking and its Cancellation, else `open_lead`.
- **`search.ts` / `contactNumbers.ts`** no longer import `salesIntelligence/outreach/reads`. List items carry `attached_lead`; detail carries attachments (with snapshot display and Owner decision provenance), read-only restrictions, connections and `allowed_actions`. Removed: `attached_lead_progress`, `outreach_records`, `running_analysis`, `review_items`, Outreach connection counts, the `has_outreach` filter, Outreach/analysis rollups.
- **`numberActivity/dto.ts`** rewritten as a self-contained Numbers DTO module (no import of Outreach, assessment or analysis-envelope schemas). The slim `coverageDtoSchema` + `ownerReadSchema` moved to the **new `salesIntelligence/coverageDto.ts`**, re-exported by `salesIntelligence/dto.ts`. `numberDetailDtoSchema` (CSI-01 frozen shape with Outreach records) was deleted from `salesIntelligence/dto.ts`.
- **`timeline.ts`** sources are now canonical Call Interactions and Lead Messages only (conversation, legacy-conversation fallback and Outreach timeline sources removed). Each call carries `rep` (resolved from the Rep Identity Link effective at the call start, `resolveRepIdentityAt`; only reviewed sales-rep links name an Agent) and `legs[]` / `legs_overflow_count`. The route serves this read regardless of `SALES_INTELLIGENCE_TIMELINE_V2`.
- **`coverage.ts`** derives only from the Call Log and webhook sync-state rows: no `lead_conversations` counts, no recording-discovery counts, no paused-AI-job count. `coverage` = `{ known_through, gaps, capabilities: { call_log, webhook } }`.
- **`ownerCoverage.ts`**: removed stages, AI budget, analysis admission, models/flags/settings/backfill blocks and every analysis/AI import; keeps `call_log_capture`, `capture_health` (now always present), `mapping_hygiene`. The webhook renewal outcome no longer reads `OperationalEvent`: `webhookSubscriptionCron.ts` stores each run's outcome on the `webhook_subscription_maintenance` sync-state row (`last_run.error_code` = null | `subscription_missing` | error class name), and `composeCaptureHealth` reads it with the same 26 h lookback and the same "missing is not down while a live owned subscription exists" rule. The staffed-minute clock moved to **new `numberActivity/staffedClock.ts`** (copy of the two functions health needs; no Outreach import). `readCaptureHealthStatus` (Overview only) was deleted.

### ContactNumber schema (SPEC §7.4, DATA §1.3)

Removed from `src/models/ContactNumber.ts`: `running_summary`, `intelligence_schedule`, `content_purge_pending`, `retention_epoch`, `evidence_fence`, `rollups.open_outreach_count`, `rollups.conversations_analyzed_total`, `rollups.last_analyzed_at`, `rollups.outreach_records_total`, `rollups.last_meaningful_contact_at`. Writers in my files removed (`persistInteraction.rollupsFor`, `rebuild.recountNumber`). `rebuild` reads only interactions and attachments and rewrites the whole `rollups` object; a stored rollup with a retired key counts as a change, so a rebuild drops it. Kept: provider recording ids on interactions and `rollups.recordings_total` (provider metadata), classification/eligibility/evidence_ref, provider names, search terms, created_via, purged_at.

### Nominations (SPEC §7.4)

- `persistInteraction.scheduleDownstream` nominates only `attachment_refresh` for a newly created Number (and the existing backfill attachment job). `outreach_ensure` and `recording_discovery` nominations are gone.
- `attachment/hooks.ts` **deleted** (`onAttachmentChanged` → Outreach mirror + `attachment-change:` job → Outreach replay + recording rediscovery). An attachment change's retained effects (search terms, attached/candidate counts) already happen in its own transaction. A queued `attachment-change:` job from an earlier release completes with 0 and no effect (`refresh.ts`).
- **New `attachment/leadTrigger.ts`** (independent deterministic trigger, extracted from `outreach/worker.ts` without editing it): `changeTriggersAttachment` (same path set), `leadChangeNomination` (the `attachment-lead:` job identity shared with the watermark backstop), `scanLeadChangesForAttachments` (bounded `(applied_at, _id)` EntityChange cursor on new scope `attachment_entity_changes`, 2-minute commit-lag re-scan, 100/page, IDEMPOTENCY_CONFLICT skipped+logged, first pass seeds at now − 2 min), `wakeLeadAttachmentsAfterChange` (fast path). `runAttachmentRefreshOnce` runs one scan pass before its `updatedAt` watermark backstop.
- `granotLifecycle/processor.ts`: `wakeOutreachAfterGranotApply` / `boundedOutreachWake` / `OUTREACH_WAKE_TIMEOUT_MS` replaced by `wakeLeadAttachmentsAfterChange` behind `boundedLeadAttachmentWake` / `LEAD_ATTACHMENT_WAKE_TIMEOUT_MS` (same 2 s bound, never throws, never changes the decision). Gated by `ATTACHMENT_REFRESH` instead of `OUTREACH_ENSURE`. Only the wake region was edited; the static import replaces the old lazy import.
- `webhookFanout.publishOutreachWakeup` renamed `publishLeadAttachmentWakeup`.
- `refresh.ts` no longer imports `conversations/workerSupport` (inline canonical-interaction loader).
- `attachment/sources.ts` no longer imports `outreach/store.jsonValue` (inline JSON round trip; fingerprints and dedupe keys are byte-identical).
- Rep identity: `reviewRepLink` no longer enqueues `rep_identity_reevaluate` (response drops `reevaluation_job_id`); `repIdentity/scheduling.ts` **deleted**. `repIdentity/worker.ts` only acknowledges jobs queued before this release (no Outreach, discovery, eligibility or conversation writes) until wave 2 retires the stage in the dispatcher.

### Accounts messaging (nudges)

Directory `review_context` messages only. `csiNudgeCommandSchema` / `csiNudgeInputSchema` narrowed (no `outreach_record_id`, `followup_id`, `expected_revision(s)`, `call_suggestion`, `sms_to_rep`; `body` required). `eligibility.ts` keeps only the directory branch; `templates.ts` keeps the versioned review template; `commands.ts` drops the Outreach record/number fence and Outreach audit subjects (audit subject `directory:<account>:<extension>`); `reads.ts` drops the `outreach_record_id` filter/field. Single-attempt send, `unknown_delivery` without retry and receipt-only `nudge_repair` are unchanged. Historical rows (`call_suggestion`, `sms_to_rep`, Outreach linkage) still read.

### OperationalEvents → structured logger (my files)

`numberActivity/{callLogRefresh,callLogSweep,captureProjectionWorker,directorySync,observeWebhookEvents,reconcileCallLog,webhookFanout,webhookRecovery,webhookSubscriptionCron}.ts` and `nudges/{commands,repair}.ts`: every `recordOperationalEvent` call and `recordEvent` seam removed. Event keys are kept as the log `msg` with the same bounded details (run ids, owner hashes, error codes/names, counts). Escalations kept as log level: reconcile `failed` at `error` after 3 consecutive failures; sweep drift at `error` on the 2nd consecutive night (was the notification candidate).

### Routes and access

`src/routes/sales-intelligence-admin.routes.ts` now registers only the interim contract (21 method/path pairs, pinned by the rep-access test). Every route uses the Owner guard: Admin role, scoped keys and signed reps (REP_ACCESS on or off) get `403 OWNER_REQUIRED`. `/live` is Owner-only. `src/services/salesIntelligence/repScope.ts` **deleted** (every check read Outreach/conversation/run/artifact collections and only retired routes used it). Retired routes (Attention, Outreach, follow-ups, review items, restrictions resolve, contact-type, open-review, conversations, analysis runs, findings, assessments, roster, Overview) are unregistered (404).

## Deleted files

- `src/services/salesIntelligence/attachment/hooks.ts`
- `src/services/salesIntelligence/repIdentity/scheduling.ts`
- `src/services/salesIntelligence/repScope.ts`
- `src/services/granotLifecycle/processor.outreachWake.test.ts` (replaced by `processor.leadAttachmentWake.test.ts` + `attachment/leadTrigger.test.ts`)
- `src/routes/sales-intelligence-overview.routes.test.ts` (only retired Closed/Overview routes)

## New files

`numberActivity/leadContext.ts`, `numberActivity/staffedClock.ts`, `salesIntelligence/coverageDto.ts`, `salesIntelligence/attachment/leadTrigger.ts` (+ test), `granotLifecycle/processor.leadAttachmentWake.test.ts`, `ops/numbers-slim.replica.test.ts` + runner `ops/numbers-slim.replica.ts`, `evidence/S-NUM-CONTRACT.md`, this file.

## Retained behavior preserved and how it was verified

- Capture identity, alias fencing, merge tombstones, settle semantics and capture-owned rollups: unchanged code paths; `capture`, `interactionProjection`, `persistInteraction`, `callLogState`, `callLogCompleteness`, `callLogRefresh`, `fanout` unit suites pass.
- Rebuild recount equals incremental capture; retired rollup keys are dropped: `rebuild.test.ts`.
- Search filters, sorts, cursors, hints (LP-06, S2, G7): `search.test.ts`, `reads.test.ts` (has_outreach now rejected by the strict schema).
- None/multiple/resolved, official status precedence, rep attribution at call time: `reads.test.ts`.
- Capture health semantics (degraded/down/quarantine/DST/off/missing-vs-failed) with the sync-state outcome: `ownerCoverage.test.ts`; maintenance outcome stored on every run, store failure never changes the provider outcome: `webhookSubscriptionCron.test.ts`.
- Lead trigger: path set, one wake per job, replay/no-op nominates nothing, failures never thrown: `leadTrigger.test.ts`; processor bound: `processor.leadAttachmentWake.test.ts`.
- Owner-only access matrix and exact route list, signed-rep refusal, tampered signatures: `sales-intelligence-rep-access.test.ts`; Numbers/coverage/settings routes: `sales-intelligence-admin.routes.test.ts`; timeline route: `sales-intelligence-admin.timeline.test.ts`; live: `live.test.ts`.
- Nudge directory-only command, template, single-attempt adapter, receipts: `nudges.test.ts`, `nudges/routes.test.ts`; rep routes: `repIdentity/routes.test.ts`, `identity.test.ts`; attachments: `attachment/*.test.ts`.
- Daily Operations: no protected file edited.

## Checks run (real results)

- `pnpm typecheck` (server): my owned files have **zero errors**. Remaining errors are all in files other lanes delete or own (see cross-lane list): `salesIntelligence/{analysis,assessment,outreach,overview,story,casefile}/**`, `ops/{lib/full-backfill,full-backfill.replica.test,lib/call-log-repair,inspect-number-rollups,report-si-state,test-attention-manifest-replica}.ts`, `granotLifecycle/drainer.replica.test.ts` and `ops/slimming/inventory.ts` (other lanes' in-flight edits).
- Unit tests, `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test …`:
  - `src/services/numberActivity/*.test.ts` in one run: 73/79 passed; the 6 failing files failed at file level (`Cannot find module './transcoder'` from googleapis and 900 s file timeouts under machine-wide load from parallel lanes; the module file exists). Each of the 6 re-run alone: search 22/22, capture 10/10, fanout 11/11, interactionProjection 19/19, callLogRefresh 13/13, callLogCompleteness 11/11, all pass.
  - Individually, all pass: attachment `formLeadNumber` 2, `leadTrigger` 6, `matchSet` 9, `sources` 1, `suggest` 5, `wiring` 3; repIdentity `identity` 7, `routes` 2; nudges `nudges` 10, `routes` 2; `ownerCoverage` 12; `foundation` 8; `live` 2; routes `admin.routes` 3, `admin.timeline` 1, `rep-access` 3; `processor.leadAttachmentWake` 2.
- Replica suites:
  - `test:csi:numbers:replica`, `test:csi:attachment:replica`, `test:si:numbers:replica`, `test:csi:capture:replica`: **cannot run in this checkout** (pre-existing): their runners or `*.replica.test.ts` files are missing from `scripts/dev_ops/`, and the runners point at the removed `./scripts/test-setup.ts`. `test:csi:rep-identity:replica` has its test file but the same stale runner path; its suite still asserts the old reevaluation fan-out (Outreach/discovery/eligibility) and is legacy behavior wave 2 deletes or rewrites.
  - Replacement proof written: `ops/numbers-slim.replica.test.ts` (runner `node --import tsx ops/numbers-slim.replica.ts`, loopback `csi01` only, external `fetch` mocked to throw). See the run result below.

**Replica result: NOT RUN TO COMPLETION.** Two attempts of `node --import tsx ops/numbers-slim.replica.ts` failed at `connectMongo` with `MongooseServerSelectionError ... ReplicaSetNoPrimary (setName csi01)` after 5 s. `docker ps` shows `csi01 Up 4 days 127.0.0.1:27189->27189/tcp`, but `docker exec csi01 mongosh --port 27189 --eval rs.status()` hung past 90 s (container unresponsive under the machine-wide load). The proof is written and type-checks; it must be run once the replica answers. It asserts: none/multiple/resolved + official cancelled status, restriction and attachment detail, reviewed rep and legs on the timeline, no retired collection before or after the reads, one `attachment-lead:` job per fingerprint from the wake-up and the durable scan, no other stage nominated.

## Open cross-lane items

1. **Wave 2 (S-AI / S-OUT)** deletes the modules that now fail typecheck because of removed Numbers symbols/fields: `outreach/{reads,timelineRead,timeline}.ts` and tests, `analysis/{apply,capture,run,structuredArtifacts,reads,ownerReads,ownerCommands,ownerConversations,prior,sources,scheduling}.ts`, `overview/read.ts` (used `readCaptureHealthStatus`), `story/*`, `casefile/fixtures/sources.ts`, `assessment/*` tests. Until then, any legacy writer that `$set`s a removed ContactNumber field through Mongoose (`analysis/apply`, Outreach ensure, `retention.ts` uses the raw driver) would hit `strict: "throw"`; nothing ships between waves.
2. **Wave 2 stage retirement** (jobs.ts / jobDispatch / cron / vercel.json): remove `rep_identity_reevaluate` from the dispatcher and the job-recovery cron, then delete `repIdentity/worker.ts`; `outreach_ensure`, `recording_discovery` etc. per plan. The minute `sales-intelligence-outreach-ensure` cron used to give Form Lead creates/phone changes ~1-minute attachment latency; it now comes from `sales-intelligence-attachment-refresh` (`*/5`). Recommend changing that schedule to `* * * * *` when the outreach-ensure cron is removed.
3. **`live.ts`** owner: `REP_LIVE_TOPICS` and the `topics` option are now unused by the router (rep access refused); remove them with the Outreach topics.
4. **`settings.ts` / `backfill/**` / `policy.ts`**: `/settings` and `/backfill` stay registered unchanged; their narrowing/retirement belongs to wave 2. `ownerCoverage` uses `resolvePolicy()` for staffed hours only; `policy.ts` still imports `aiBudget` (split in wave 2).
5. **ops scripts**: `ops/inspect-number-rollups.ts`, `ops/lib/call-log-repair.ts`, `ops/lib/full-backfill.ts`, `ops/full-backfill.replica.test.ts`, `ops/report-si-state.ts`, `ops/test-attention-manifest-replica.ts` reference removed fields/exports; retire or update with the AI/Outreach scripts.
6. **MCP** (`find_contact_number`): any server projection it reads from the Number detail must use the new DTO (`attached_lead`, no `running_analysis`).
7. `models/salesIntelligence/intelligence.ts` hosts `SalesIntelligenceContactRestriction` (retained, read by Number detail): keep that model when the AI models in the same file are deleted.
8. Admin (A-SI): build against S-NUM-CONTRACT.md (new `attached_lead`, `coverage.capabilities`, timeline `rep`/`legs`, nudge body required, no rep access).
9. Process note: I ran `git rm --cached` once on `src/services/granotLifecycle/processor.outreachWake.test.ts` (index now holds that file's deletion, consistent with the working tree). No other index or history operation was run.

## DATA-MANIFEST NEEDS

Remove (after the slim server is deployed and quiesced):

- `contact_numbers` (main runtime DB), filter `{}`: `$unset` `running_summary`, `intelligence_schedule`, `content_purge_pending`, `retention_epoch`, `evidence_fence`, `rollups.open_outreach_count`, `rollups.conversations_analyzed_total`, `rollups.last_analyzed_at`, `rollups.outreach_records_total`, `rollups.last_meaningful_contact_at`. Do not bump `revision` (no semantic change). `running_summary.text` is AI content: this is a required content purge, not optional.
- `sales_intelligence_jobs`: rows `{ stage: "attachment_refresh", subject_key: /^attachment-change:/ }` once none are pending/leased/retry (acknowledged no-op work); rows `{ stage: "rep_identity_reevaluate" }` once none are pending/leased/retry (no producer remains); `outreach_ensure` / `recording_discovery` rows produced by capture/attachment belong to wave 2's stage purge.
- `sales_intelligence_sync_state`: `{ scope: "outreach_entity_changes" }` (old cursor of the Outreach scan; replaced by `attachment_entity_changes`) together with wave 2's Outreach scopes.
- `sales_intelligence_coverage_projections`: optional — rows stored before deploy have the old coverage shape and are ignored (strict parse) until the minute recovery cron rewrites them; deleting them is safe and only forces one re-derive.
- `call_interactions` (optional, coordinate with S-AI): `recording_discovery` sub-document (discovery state; no retained reader in my files) and `recordings[].lead_conversation_id` (pointer into dropped `lead_conversations`; retained code treats null as absent).

Must NOT remove:

- `contact_numbers` documents and `rollups.{interactions_total,inbound_total,outbound_total,human_conversations_total,last_inbound_at,last_outbound_at,last_human_conversation_at,attached_lead_count,candidate_lead_count,recordings_total}`, `classification*`, `contact_eligibility` (incl. `evidence_ref`), `provider_names`, `search_terms`, `created_via`, `purged_at`; the indexes `contact_number_kind_*` and `contact_number_e164_unique`.
- `number_lead_attachments`, `rep_identity_links`, `call_interactions`, `call_interaction_aliases`, `entity_changes` (the Lead trigger reads them), `form_leads`/`call_leads`/`booked_leads`/`cancelled_leads`.
- `sales_intelligence_contact_restrictions`: every row, including `origin: "intelligence"` (shown on Number detail); `run_id`/`finding_id` may dangle after the intelligence purge — keep them as retired provenance, never clear the restriction.
- `owner_rep_nudges`: every row (uncertain-delivery history and Accounts messages), including historical `outreach_record_id`/`contact_number_id`/`lead_ref`/`authorized_command` fields; never re-validate or re-send.
- `sales_intelligence_sync_state` scopes `attachment_entity_changes` (new trigger cursor), `webhook_subscription_maintenance` (new health outcome), `attachment_watermark:*`, `attachment_suggest`, `call_log_all_directions`, `call_log_sweep`, `webhook_receipts`, directory/lease rows.
- `sales_intelligence_jobs` rows with stages `capture_projection`, `call_log_refresh`, `attachment_refresh` (other subjects), `rebuild`, `nudge_repair`.
