# Lane S-AI evidence: remove all server-owned AI and media processing (SLIM-06)

October 4, 2026. Server repo `vantage-main-server`, branch `slim/server-admin`, uncommitted (the coordinator commits). Lane S-OUT worked in the same checkout at the same time. Where S-OUT took a shared file over, this report says so instead of describing its changes.

## What changed and why

### Retained canonical history, extracted before the AI modules were deleted (SPEC §7.1, CODE-MAP §7.1)

The MCP lane retired `get_subject_story`, `list_analyses`, `get_analysis`, `get_conversation`, `get_move_assessment` and `get_prior_analyses`. It kept `find_contact_number`, `find_lead_candidates` and `get_lead_history`, which read `/api/v1/internal/sales-intelligence/history/{contact-number,lead-candidates,lead}`. Their deterministic readers moved into the new module `src/services/salesIntelligence/history/`:

- `reads.ts`: `readContactNumberHistory`, `readLeadHistory` and `serialize`, taken from `analysis/history.ts`.
  - The Contact Number read no longer returns `running_summary`, `content_purge_pending` or Outreach records.
  - `rollups` is projected to the ten retained provider-metadata keys, so a stored retired key (`conversations_analyzed_total`, `last_analyzed_at`, `open_outreach_count`, `outreach_records_total`) is never returned.
  - The Lead read no longer returns `conversations` (lead_conversations) or `outreach` (outreach_records).
  - Lead projection, attachments, EntityChanges, Granot observations, Bookings, Cancellations and Lead Message metadata are unchanged.
- `candidates.ts`: `findLeadCandidates` (from `story/candidates.ts`, same bases, bounds, ordering and output) and `resolveHistorySubject` (phone or Contact Number id to `{ contact_number_id, e164, as_of }`). The `lead-candidates` response `subject` no longer carries `lead_refs`, `outreach_record_ids`, `conversation_ids` or `focus`.
- `redaction.ts`: the string redactor (`redactSensitiveText`, from `services/conversations/redaction.ts`), unchanged.
- `moveViews.ts`: `moveViewsForLead`, from `assessment/views.ts`, unchanged.

`src/routes/sales-intelligence-history.routes.ts` now registers only those three GET routes. The same guards stay: the flag, the broad secret or a signed-in user only, a signed rep refused, validation before connect, `null` → 404. The status-table helper it used to import from the deleted internal router is now local (`historyRouteFailure`). Removed: `/story`, `/analyses`, `/analyses/:id`, `/conversations/:id`, `/move-assessment`, `/prior` (each now answers 404).

### Retained human and provider facts split out of the AI models (SPEC §7.3, HUMAN-FACTS)

- New `src/models/salesIntelligence/review.ts` holds `sales_intelligence_owner_instructions`, `sales_intelligence_review_items` and `sales_intelligence_contact_restrictions`. Schemas, indexes and the append-only flag are byte-identical. `run_id`, `finding_id` and `followup_id` stay as opaque retired provenance.
- The facades `SalesIntelligence{ContactRestriction,OwnerInstruction,ReviewItem}.ts`, `models/salesIntelligence/index.ts` and `registry.ts` point at `review.ts`.
- Deleted `models/salesIntelligence/intelligence.ts` (`intelligence_runs`, `_evidence_snapshots`, `_submissions`, `_findings`, `_effects`, `_owner_assessments`) and `models/salesIntelligence/assessment.ts` (`move_assessment_artifacts`).
- Removed their registry entries, plus `SalesIntelligenceAiBudget` and `SalesIntelligenceAiReservation`. S-OUT deleted those two schemas from `infrastructure.ts`. The registry feeds the local index migration, so a removed entry can no longer create its collection's indexes.

### Scoped AI-run surface removed (SPEC §7.1)

- Deleted `src/routes/sales-intelligence-internal.routes.ts` (`/runs/:id/{context,read,submit,submission}`) and its test.
- `sales-intelligence-boundary.routes.ts`: the `/api/v1/internal/sales-intelligence` run branch is removed. Only the Owner boundary remains, so the factory takes no arguments; 5 test call sites were updated.
- `src/middleware/requireApiSecret.ts`: the Sales Intelligence scoped key (`SALES_INTELLIGENCE_SCOPED_KEY_NAME`) is now refused with `403 RUN_SCOPE_DENIED` on every route. It served only the retired run endpoints. The `/runs/:id/*` template expansion is removed from `isRouteAllowed`. This is the retirement guard that refuses an old run submission. The broad secret finds no run route (404).
- S-OUT removed the run-token functions from `services/salesIntelligence/auth.ts` and the `CSI_TOOLS`/`isCsiServiceRoute` config.

### Conversations, media, transcription, analysis, assessment and AI budget deleted (SPEC §7.1)

- Directories: `src/services/conversations/**`, `src/services/salesIntelligence/{analysis,assessment,conversations,story}/**`.
- Files: `src/services/salesIntelligence/{evidence,companyContext,aiBudget,budgetPeriod}.ts` and their tests, `src/models/LeadConversation.ts` and its test, `src/routes/conversations-admin.routes.ts` and its test, `src/config/domain/conversations.ts`, `src/validation/intelligence/**` (the analysis envelope contract and its fixtures; no retained importer remained).
- Model facades: `src/models/{IntelligenceRun,IntelligenceEvidenceSnapshot,IntelligenceSubmission,IntelligenceFinding,IntelligenceEffect,IntelligenceOwnerAssessment,MoveAssessmentArtifact,SalesIntelligenceAiBudget,SalesIntelligenceAiReservation}.ts`.
- `src/routes/v1.routes.ts`: the internal run router and `conversationsAdminRoutes` (`/api/v1/admin/conversations*`, which served playback, audio URLs and transcripts) are unmounted.
- `src/config/domain.ts` no longer re-exports the conversations config.
- `src/routes/sales-intelligence-cron.routes.ts`: removed the `extract`, `apply`, `media-fetch` and `transcribe` routes and the `intelligence`, `application`, `move_assessment`, `recording_discovery`, `media_fetch` and `transcription` job-recovery steps. S-OUT edited the same file for the Outreach crons and the retired-stage fence.
- `vercel.json`: removed the `sales-intelligence-extract`, `-apply`, `-transcribe` and `-media-fetch` schedules.
- `package.json`: removed 21 script entries for producers, replicas and migrations of transcription, media, analysis, assessment and the conversation-index migration. Removed: `ops:transcribe-recordings`, `ops:transcribe-booked-calls`, `ops:blob-upload-mp3`, `ops:seed-conversation`, `migration:conversations:indexes`, `test:csi:full-backfill:replica`, `test:csi:intelligence:replica`, `test:csi:runtime:replica`, `test:csi:intelligence-reads:replica`, `generate:csi:intelligence-contract`, `measure:csi:rejections`, `probe:intelligence-mcp`, `test:csi:media:replica`, `test:csi:transcription:replica`, `test:csi:move-assessment:replica`, `test:csi:move-assessment-backfill:replica`, `test:csi:call-log-repair:replica`, `test:si:findings:replica`, `test:si:conversations:replica`, `test:si:presentation:replica`, `migration:csi:conversation-number`.

### Files S-OUT took over during this run

These shared files also referenced AI or media code. S-OUT rewrote them, and this lane did not change them further:

- `jobDispatch.ts`, `jobs.ts`, `config/domain/salesIntelligence.ts` (the retired-stage fence `CSI_RETIRED_JOB_STAGES` + `retireLegacyCsiJobs`; producers fenced in `enqueueCsiJob` and `claimCsiJob`).
- `policy.ts`, `settings.ts` (AI budget, models display).
- `validation/v1/salesIntelligence.ts` (finding, run and reanalysis commands).
- `dto.ts`, `infrastructure.ts`, `auth.ts`, `live.ts`.
- `retention.ts` and `retentionPolicy.ts`. This lane first rewrote them to activity-only retention. S-OUT then rewrote them to the same scope: no Blob audio delete, no transcript or analysis purge, no conversation writes.
- The ops sweep: `ops/backfill-csi-full-personal.ts`, `full-backfill*`, `lib/full-backfill*`, `lib/backfill-csi-structured-analysis.lib*`, `repair-call-log-capture.ts`, `lib/call-log-repair*`. S-OUT deleted these AI producers too.
- `foundation.test.ts`: this lane removed the run-template, run-token, analysis-command and envelope tests and kept the trusted-actor and scope assertions. S-OUT edited the Outreach and policy parts.

## Retained behavior and how it was verified

- The canonical history reads (`find_contact_number`, `find_lead_candidates`, `get_lead_history`) keep the same guards, validation, 404 and redaction. Verified by `src/routes/sales-intelligence-history.routes.test.ts` (rewritten), which covers:
  - credential boundary: missing and wrong secret 401, scoped key 403 `RUN_SCOPE_DENIED`, signed rep 403;
  - flag-off 404, validation before connect, not-found 404, dependency wiring;
  - every retired history path and every `/runs/:id/*` path is 404 with zero reader calls;
  - failure mapping 400/500 with no message leak.
- The projection is narrowed. `src/services/salesIntelligence/history/reads.test.ts` (new) checks that a stored `running_summary`, `content_purge_pending`, `intelligence_schedule` and retired rollup keys are not returned, that evidence is reduced to its retained keys, that purged or missing numbers return null, and that every string is redacted.
- The redactor and move views keep their previous tests (`history/redaction.test.ts`, `history/moveViews.test.ts`, ported verbatim).
- Owner boundary authority is unchanged. `sales-intelligence-boundary.routes.test.ts` (rewritten) checks:
  - the broad secret alone, the Admin role and the scoped key never reach an Owner route;
  - the signed Owner does; `scope=historical` is 403; flag-off is 404;
  - the scoped key is 403 on its old run routes and on a broad route it is still configured for;
  - an old `POST /runs/:id/submit` is 404 under the broad secret.
- New invariant test `history/aiRetirement.test.ts` scans every non-test module under `src/` and `api/`. No module imports `ai`, `openai`, `@ai-sdk/*` or `@vercel/blob`. No module names a dropped AI or media collection, and none imports a deleted AI or media module.
- `v1.routes.test.ts`: the conversation-route registration test became an absence test. No `/api/v1/admin/conversations*`, no `/internal/sales-intelligence/runs*`, and the history routes are exactly the three retained paths.
- Daily Operations: no protected file was edited.

## Checks run (real results)

- **Server typecheck**: `bash …/heavy.sh env NODE_OPTIONS=--max-old-space-size=6144 node node_modules/typescript/bin/tsc --noEmit` returned **0 errors**. This is the whole checkout, with S-OUT's in-flight edits, on 2026-10-04.
- **Tests**: `bash …/heavy.sh env DOTENV_CONFIG_PATH=C:/nonexistent.env NODE_OPTIONS=--max-old-space-size=6144 node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/routes/*.test.ts" "src/services/salesIntelligence/**/*.test.ts" "src/services/numberActivity/*.test.ts" "api/queues/**/*.test.ts"` returned **418 tests, 418 pass, 0 fail**.
- **Focused tests**, each green:
  - `history/{redaction,moveViews,aiRetirement,reads}.test.ts`: 3, 3, 3 and 2 tests;
  - `sales-intelligence-history.routes.test.ts`: 3;
  - `sales-intelligence-boundary.routes.test.ts`: 1;
  - `v1.routes.test.ts`: 12;
  - `numberActivity/efficiency.test.ts`: 9;
  - `sales-intelligence-cron.routes.test.ts`: 7;
  - `foundation.test.ts`: 6;
  - `sales-intelligence-rep-access.test.ts`: 3;
  - `sales-intelligence-admin.routes.test.ts`: 3;
  - `sales-intelligence-admin.timeline.test.ts`: 1;
  - `nudges/routes.test.ts`: 2;
  - `api/queues/sales-intelligence-consumer.test.ts`: 7.
- One mid-run failure in `repIdentity/routes.test.ts` ("minute recovery invokes registered bounded rep stage") came from S-OUT's in-flight edit of that test. The later 418/418 run includes the file and passes.
- **Lint**: `eslint --max-warnings 0` over every file this lane created or edited reported clean.
- **Not run: replica suites.** Docker did not answer: `docker version` and `docker ps` produced no output within 20 s, so the `csi01` replica on 27189 was unavailable. The history reads were verified with model-level stubs, not against Mongo. `findLeadCandidates` keeps the same queries as `story/candidates.ts`; there is no unit test for its raw-driver path.

## AI/vendor source scan (`generateObject|generateText|streamText|ToolLoopAgent|createGateway|@ai-sdk|transcri|media_fetch|recording_discovery`)

**`src`, `api`, `ops` (tracked).** No call or import of an AI SDK or vendor remains. The remaining hits:

| Hit | Reason it stays |
| --- | --- |
| `src/config/domain/salesIntelligence.ts`: `recording_discovery`, `media_fetch`, `transcription` in `CSI_RETIRED_JOB_STAGES` | The retired-stage fence (S-OUT): late rows are terminalized, never run |
| `src/models/CallInteraction.ts:37,200` `recording_discovery` index/sub-document; `:170` `contact_type_basis` comment "transcript:<version>" | Retained model, not owned by this lane. Discovery state is dead metadata; see the cross-lane and data sections |
| `src/routes/sales-intelligence-cron.routes.ts:47` | Doc comment that lists the retired crons |
| `src/routes/sales-intelligence-history.routes.ts:20`, `src/services/numberActivity/{dto,timeline}.ts` | Comments saying no transcript is returned |
| `src/validation/v1/salesIntelligence.ts:121` | Comment: retired policy fields are ignored when read |
| Tests `jobNumberTimeline/v2.test.ts`, `numberActivity/{interactionProjection,reads}.test.ts`, `salesIntelligence/settings.test.ts` | Assertions that no transcript appears; a stored legacy capability name filtered on read |
| `ops/slimming/{policy,inventory}.ts` | The purge tooling names retired stages, audit kinds and the `conversations/` Blob prefix on purpose |
| `ops/quality/cli.mjs:32` | Comment in the developer quality tool |

**`scripts/` (gitignored local tooling).** 49 local files match. None is tracked or deployed.

- These call an AI vendor directly: `dev_ops/probe-intelligence-mcp-agent.ts`, `dev_ops/replay-citation-handles.ts`, `dev_ops/ringcentral/{sales-intelligence-ai,sales-intelligence-extract-v2,sales-intelligence-text-ai,transcribe-booked-call-leads,transcribe-matched-booked-samples,transcribe-recording-samples}.ts`, `dev_ops/test-csi-runtime.replica.test.ts`.
- `dev_ops/blob/upload-ringcentral-mp3.ts` writes Blob audio.
- Their `package.json` entries are removed.
- 71 local scripts no longer load, because they import deleted modules.
- This lane deleted no gitignored file. Wave 1 lost local reports that way; see the open risks.

## Cross-lane items

1. **S-OUT / coordinator: `CallInteraction` model.** `recordings[].lead_conversation_id` still has `ref: "LeadConversation"`, and there are the `recording_discovery` sub-document and the `call_interaction_discovery_state` index. Nothing retained writes them. `numberActivity/efficiency.test.ts` still asserts that the index exists.
2. **MCP lane.**
   - The `/history/contact-number` response no longer has `contact_number.running_summary`, `contact_number.content_purge_pending` or the top-level `outreach`.
   - `rollups` holds exactly the ten retained keys.
   - The `/history/lead` response no longer has `conversations` or `outreach`.
   - The `/history/lead-candidates` `subject` is `{ contact_number_id, e164, as_of }`.
   - `/history/{story,analyses,conversations,move-assessment,prior}` return 404.
   - The Sales Intelligence scoped key is refused everywhere: the deployed `/api/intelligence-mcp` can no longer reach any server route.
3. **Coordinator: dependencies.** After a reference check of tracked `src`, `api`, `ops`, configs and tests:
   - Remove `ai`, `@ai-sdk/gateway` and `@ai-sdk/mcp` (dependencies) and `openai` (devDependency). Only gitignored local scripts import them.
   - Keep `@vercel/blob`: only the purge tool `ops/slimming/lib/blob.ts` uses it now. Reclassify it after SLIM-10.
   - `@cursor/sdk` has no tracked reference. It is developer tooling, not the server AI pipeline, so this lane leaves it out of the classification.
   - Keep `googleapis` and `google-spreadsheet` (Reporting and Sheets).
4. **Coordinator / environment inventory: obsolete env names.**
   - Runtime env names the server no longer reads: `AI_GATEWAY_API_KEY`, `BLOB_STORE_ID`, `BLOB_STORE_NAME`, `SALES_INTELLIGENCE_MCP_ENDPOINT`, `SALES_INTELLIGENCE_MCP_API_SECRET`, `SALES_INTELLIGENCE_EXTRACTION_MODEL`, `SALES_INTELLIGENCE_STT_MODEL`, `SALES_INTELLIGENCE_STT_CENTS_PER_SECOND`, `SALES_INTELLIGENCE_MEDIA_MAX_BYTES`, `SALES_INTELLIGENCE_RETENTION_AUDIO_DAYS`, `SALES_INTELLIGENCE_RETENTION_TRANSCRIPT_DAYS`, `SALES_INTELLIGENCE_AI_MONTHLY_CEILING_CENTS`, `SALES_INTELLIGENCE_AI_PER_RECORDING_CEILING_CENTS`, `SALES_INTELLIGENCE_PERSONAL_LEDGER`, `SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION`, `SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION`, `SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION`, `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON`, `SALES_INTELLIGENCE_ANALYSIS_V3`, `SALES_INTELLIGENCE_CASE_FILE`, `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`.
   - Obsolete flags: `SALES_INTELLIGENCE_{MEDIA_ENABLED,STT_ENABLED,EXTRACTION_ENABLED,EXACT_EVIDENCE_VERIFICATION,PROVIDER_READS,MOVE_ASSESSMENT,CITATION_HANDLES}`.
   - Operator-only names: `PERSONAL_AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`.
   - `BLOB_READ_WRITE_TOKEN` stays until the purge runs; only `ops/slimming` reads it.
   - `SALES_INTELLIGENCE_SCOPED_KEY_NAME` stays as the refusal fence until the Sales Intelligence key entry is removed from `VANTAGE_SCOPED_API_KEYS`. After that both go.
5. **Wave 3 docs.** These describe deleted modules: `docs/knowledge/services/sales-intelligence-analysis*.md`, `sales-intelligence-move-assessment.md`, the conversation docs, `number-activity-capture.md` §repair (deleted repair tool), and the environment inventory.
6. **Coordinator: local migration.** The gitignored `scripts/migrations/sales-intelligence.lib.ts` (`migration:csi:indexes`, entry kept) no longer loads, because it imports `LeadConversation`. As written it would build `lead_conversations` indexes, which recreates the collection, and back-fill conversation account ids. Rewrite it to the retained registry or delete it locally. Do not just fix its import.
7. **Process note.** At the start of the lane, one `git rm -q` deleted 13 model files and staged those deletions in the index: `src/models/{IntelligenceEffect,IntelligenceEvidenceSnapshot,IntelligenceFinding,IntelligenceOwnerAssessment,IntelligenceRun,IntelligenceSubmission,MoveAssessmentArtifact,SalesIntelligenceAiBudget,SalesIntelligenceAiReservation,LeadConversation,LeadConversation.test}.ts` and `src/models/salesIntelligence/{intelligence,assessment}.ts`. The index matches the working tree. No other index, stash or history operation was run.

## DATA-MANIFEST NEEDS

Drop after the slim server is deployed and quiesced. All are already `MAIN_DROP_COLLECTIONS` in `ops/slimming/policy.ts`. This lane confirms no retained reader or writer:

- Main runtime DB collections: `lead_conversations`, `intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `intelligence_owner_assessments`, `move_assessment_artifacts`, `sales_intelligence_ai_budget`, `sales_intelligence_ai_reservations`.
- The purge backup must keep `intelligence_findings` and `intelligence_runs` (HUMAN-FACTS: the only source of the 16 restriction findings).

Blob objects (server-owned conversation media):

- Every key under `conversations/` that is referenced by `lead_conversations.media.blob_pathname`.
- **Also** every `sales_intelligence_jobs.result.pending_blob_delete` string, on `{ stage: "media_fetch", status: "completed", "result.pending_blob_delete": { $type: "string" } }`. These are superseded audio objects the retired retention cron was still due to delete. They may not be referenced by any `lead_conversations` row, so the key manifest must take its union with them.
- Paths seen in code: `conversations/<providerRecordingId>.mp3` and `conversations/<account>/recording-<sid>/<digest>.wav`.
- Never delete RingCentral recordings or other prefixes.

Field cleanup in retained documents:

- `call_interactions`, filter `{}`: `$unset` the `recording_discovery` sub-document (discovery state) and `recordings.$[].lead_conversation_id` (pointer into the dropped collection). Keep `recordings[].id`, uri, duration and other provider metadata, and `contact_type_basis`. The index `call_interaction_discovery_state` is dead once nothing reads discovery state; dropping it is optional, coordinate with item 1 above.
- `contact_numbers`: the S-NUM list (`running_summary` holds AI text, so purging it is required), plus `content_purge_pending`, `retention_epoch`, `evidence_fence` (C1/C5).
- `sales_intelligence_jobs`, retired AI and media stages: `recording_discovery`, `media`, `media_fetch`, `transcription`, `analysis`, `application`, `number_refresh`, `move_assessment`. S-OUT's fence terminalizes them as `retired`; purge C2 then deletes them.
- `sales_intelligence_jobs`, all rows: `$unset` the job fields `owner_reanalysis`, `evidence_fence`, `result_ref` (removed from the schema by S-OUT).
- `sales_intelligence_sync_state`: `{ scope: "intelligence_source_scan" }` (already in `RETIRED_SYNC_SCOPES`).
- `sales_intelligence_audit_events`: the AI and media kinds in `RETIRED_AUDIT_EVENT_KINDS`, `worker`/`intelligence` actors only. The deleted code wrote `intelligence.submitted`, `intelligence.published`, `analysis.suggestion_applied`, `move_assessment_published`, `media_played` and the `conversation.*` and `recording_discovery.*` kinds. `analysis.suggestion_applied` is **missing** from `RETIRED_AUDIT_EVENT_KINDS`: add it for worker/intelligence rows, or leave it for human actors.

Must NOT be removed:

- `sales_intelligence_contact_restrictions`, every row, including `origin: "intelligence"` with dangling `run_id`/`finding_id`.
- `sales_intelligence_owner_instructions`, `sales_intelligence_review_items`, `owner_rep_nudges`, `number_lead_attachments`, `rep_identity_links`, `contact_numbers`, `call_interactions` (documents), `call_interaction_aliases`, `entity_changes`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `granot_observations`, `lead_messages` (the retained history reads use them).
- `sales_intelligence_command_executions` rows of command `reanalyze` (765) and any of the retired `process_conversation`. They are Owner replay and idempotency authority (HUMAN-FACTS).
- Owner and Rep `sales_intelligence_audit_events` rows of retired kinds (`analysis.reanalysis_requested`, `media_played`).
