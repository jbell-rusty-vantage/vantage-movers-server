# 03 — Server pipeline, jobs, and LLM processing points

Status: build contract, not implemented. Revised September 17, 2026. Pack index: [`README.md`](README.md). Models: [`02-domain-models.md`](02-domain-models.md). Routes: [`04-server-routes.md`](04-server-routes.md).

## 0. Module map (`vantage-main-server`)

```
src/config/domain/salesIntelligence.ts        flags, enums, policy defaults, model allowlist, budgets
src/models/                                   ContactNumber, CallInteraction, NumberLeadAttachment, OutreachRecord,
                                              OutreachFollowup, IntelligenceFinding, RepIdentityLink,
                                              RingCentralDirectorySnapshot, OwnerRepNudge,
                                              SalesIntelligenceSyncState, SalesIntelligenceSyncWindow, SalesIntelligenceAiBudget
                                              (+ additive fields on LeadConversation)

src/services/numberActivity/                  DEEP MODULE 1 — capture + timeline (no Lead knowledge beyond ids)
  phone.ts                                    toE164 / toNationalTenDigit / kind detection (withheld, service code, malformed)
  directory.ts                                directory sync → RingCentralDirectorySnapshot; role resolution helpers
  interactionProjection.ts                    pure: webhook party events | Call Log record → CallInteraction projection (no I/O)
  observeWebhookEvents.ts                     idempotent upsert from normalized webhook party events (all directions)
  reconcileCallLog.ts                         all-direction Detailed Call Log worker (own cursor, own lease)
  backfill.ts                                 fixed-window backfill with manifests
  contactNumbers.ts                           upsert Contact Number, kind, rollups, search terms
  contactType.ts                              provider evidence/unknown; transcript interpretation via MCP agent
  timeline.ts                                 getNumberTimeline (merges interactions, Lead Messages, conversations, outreach events, nudges)
  search.ts                                   searchNumberActivity (digits, suffix, names, job no, filters, cursor)
  rebuild.ts                                  recompute rollups/search terms for one number or all

src/services/salesIntelligence/               DEEP MODULE 2 — sales meaning on top of Number Activity
  attachment/suggest.ts                       pure precedence + window logic → proposed edges
  attachment/refresh.ts                       lead watermark scan → suggest → persist edges; ambiguity fan-in
  attachment/commands.ts                      attach_lead / reject_lead / detach (Owner)
  outreach/ensure.ts                          create records for new eligible Leads; close ineligible ones
  outreach/transitions.ts                     system transitions from interactions (attributable outbound, inbound, voicemail)
  outreach/derive.ts                          pure: derived signals + attention_rank (policy_version)
  outreach/commands.ts                        open_number_review, mark_worked, set_waiting, close, reopen, assign, add_note
  outreach/staffing.ts                        staffed-clock math (America/New_York, configured hours)
  followups/commands.ts                       create / complete / snooze / cancel
  conversations/discover.ts                   interaction recording → LeadConversation discovered + analysis_eligibility
  conversations/media.ts                      bounded RC recording fetch → private Blob (streams; digest)
  conversations/transcribe.ts                 STT via AI Gateway; segments; redaction; persist
  conversations/extract.ts                    AI SDK agent + scoped Vantage MCP; submit versioned envelope
  conversations/numberSummary.ts              recompute running summary from evidence set
  findings/commands.ts                        confirm / correct / retract; immediate Owner effects
  repIdentity/propose.ts                      directory × Agents → proposed links
  repIdentity/commands.ts                     review / retire / set channels
  nudges/preview.ts                           preconditions + template render
  nudges/send.ts                              command + provider adapters + fallback + audit
  nudges/templates.ts                         versioned templates
  coverage.ts                                 Coverage Watermark, gaps, capability matrix, hygiene counts
  overview.ts                                 counters for the Owner header
  attention.ts                                Attention query (state filters + derive + rank + cursor)
  live.ts                                     SSE runner (Mongo watermark poll over call_interactions/outreach_records/findings)
  aiBudget.ts                                 reserve / reconcile / month rollover
  policy.ts                                   policy_version constant + defaults resolved from config

src/services/ringcentral/messaging/           provider adapters, no business rules
  teamMessaging.ts                            listChats, ensureDirectChat, postToChat
  sms.ts                                      sendSmsFromJwtDid
  pager.ts                                    sendCompanyPager
  recordings.ts                               getRecordingMeta, streamRecordingContent (Range + Retry-After aware)
  presence.ts                                 readPresence (later phase; read-only)

src/routes/
  sales-intelligence-admin.routes.ts          Owner reads + commands (after the /api/v1 guard)
  sales-intelligence-cron.routes.ts           crons (before v1): reconcile, directory, media, transcription, extraction, derive, budget rollover
  ringcentral-webhook.routes.ts (edit)        after capture: fan out normalized party events to numberActivity.observeWebhookEvents when flag on

api/queues/sales-intelligence-consumer.ts     durable-job wake-up: { job_id }
scripts/migrations/sales-intelligence-indexes.ts
scripts/dev_ops/ringcentral/ (existing probes stay)
docs/knowledge/services/call-sales-intelligence.md   OKF service card (pointer to this pack)
```

Import rules (lint-enforced by a test that greps imports):

- `numberActivity/**` may import `ringcentral/client`, `ringcentral/webhook-event-normalizer`, `ringcentral/phone-normalization`, `operationsRegistry` (read snapshot), `durableWork`, `observability`. It must **not** import `ringcentral-call-lead-ingest.service`, `call-log-vetting`, `call-candidate-*`, `call-session-*`, `callLeadConvergence.service`, or any `leads/*` write service.
- `salesIntelligence/**` may import `numberActivity/**`, models, `conversations/redaction`, `conversations/media`, `durableWork`, `observability`, `operationsRegistry` (actor gates). Same forbidden list.
- Routes import services only.

## 1. Configuration (`src/config/domain/salesIntelligence.ts`)

Flags are read at call time and default off. Owner-editable policy is persisted/versioned; env values bootstrap it rather than override it on every request. Operational limits below are engineering defaults, not new Owner decisions. A 25-cent per-recording budget is a visible configurable admission limit; it must not masquerade as duration ineligibility.

| Env | Default | Meaning |
| --- | --- | --- |
| `SALES_INTELLIGENCE_ENABLED` | `false` | Master read switch. Off → admin routes return 404 `feature_disabled`. |
| `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` | `false` | Fan out webhook party events (all directions) into Number Activity. |
| `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` | `false` | All-direction Call Log reconcile cron. |
| `SALES_INTELLIGENCE_CALL_LOG_CADENCE_MINUTES` | `10` | Informational (cron schedule lives in `vercel.json`). |
| `SALES_INTELLIGENCE_CALL_LOG_ROLLING_LOOKBACK_MINUTES` | `720` | 12-hour floor, same rationale as the qualified-call sync. |
| `SALES_INTELLIGENCE_CALL_LOG_OVERLAP_MINUTES` | `15` | Cursor overlap. |
| `SALES_INTELLIGENCE_CALL_LOG_MAX_PAGES` | `20` | Per run, 250 per page. |
| `SALES_INTELLIGENCE_BACKFILL_DAYS` | `0` | > 0 plans daily windows back this far (Owner-triggered). |
| `SALES_INTELLIGENCE_DIRECTORY_SYNC` | `false` | Daily directory snapshot. |
| `SALES_INTELLIGENCE_ATTACHMENT_REFRESH` | `false` | Lead watermark → attachment suggestions. |
| `SALES_INTELLIGENCE_OUTREACH_ENSURE` | `false` | Create/close Outreach Records from Leads and interactions. |
| `SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES` | `30` | Accepted initial default; persisted Owner policy overrides env bootstrap. |
| `SALES_INTELLIGENCE_MISSED_CALLBACK_DUE_STAFFED_MINUTES` | `15` | Missed inbound deadline. |
| `SALES_INTELLIGENCE_GOING_COLD_STAFFED_MINUTES` | `1440` | Two 12-hour sales days in the default schedule; independent of unequal weekday shifts. |
| `SALES_INTELLIGENCE_STAFFED_HOURS` | `Mon-Sat 08:00-20:00` | America/New_York. Parsed by `outreach/staffing.ts`. |
| `SALES_INTELLIGENCE_UNANSWERED_INBOUND_REVIEW_HOURS` | `24` | Batch scan window only; durable missed-call work never expires merely after 24 hours. |
| `SALES_INTELLIGENCE_COOLDOWN_ATTEMPTS_24H` | `3` | Cooldown threshold. |
| `SALES_INTELLIGENCE_MEDIA_ENABLED` | `false` | Fetch recordings into Blob. |
| `SALES_INTELLIGENCE_MEDIA_MAX_BYTES` | `26214400` | 25 MB; larger → `unavailable:media_too_large`. |
| `SALES_INTELLIGENCE_MEDIA_MAX_PER_RUN` | `10` | Bounded per cron run. |
| `SALES_INTELLIGENCE_STT_ENABLED` | `false` | Transcription. |
| `SALES_INTELLIGENCE_STT_MODEL` | `openai/gpt-4o-mini-transcribe` (proposed) | Gateway STT starting proposal; verify API, lifecycle, format/timestamps and actual pricing per 12. |
| `SALES_INTELLIGENCE_EXTRACTION_ENABLED` | `false` | Findings extraction. |
| `SALES_INTELLIGENCE_EXTRACTION_MODEL` | `openai/gpt-5-mini` (proposed) | Owner prefers GPT-5 mini/nano; evaluate `openai/gpt-5-nano` as lower-cost alternative per 12. No unbounded escalation. |
| `SALES_INTELLIGENCE_CLASSIFY_MODEL` | optional deployment-selected | If a separate classifier is used, it uses the same Vantage MCP agent architecture. |
| `SALES_INTELLIGENCE_EXTRACTION_VERSION` | `csi-extract-v1` | Prompt + schema version stamp. |
| `SALES_INTELLIGENCE_AI_MONTHLY_CEILING_CENTS` | `8000` | $80/month admission ceiling; Owner-editable in Coverage. |
| `SALES_INTELLIGENCE_AI_PER_RECORDING_CEILING_CENTS` | `25` | Per recording reserve cap. |
| `SALES_INTELLIGENCE_EXACT_EVIDENCE_VERIFICATION` | `false` | Deferred locator/entailment policy; never a first-release gate. |
| `SALES_INTELLIGENCE_NUDGE_ENABLED` | `false` | Owner Rep Nudge command. |
| `SALES_INTELLIGENCE_NUDGE_CHANNELS` | `team_messaging` | Comma list ⊆ `team_messaging,sms_to_rep,pager`. |
| `SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR` | `6` | Rate limit. |
| `SALES_INTELLIGENCE_LIVE_SSE` | `false` | Live stream route. |
| `SALES_INTELLIGENCE_QUEUE_TOPIC` | env-scoped | Vercel Queue wake-up topic; scheduled recovery uses the same durable jobs. |
| `SALES_INTELLIGENCE_RETENTION_*` | see §12 | Raw/audio/transcript/findings/activity retention days. |
| `AI_GATEWAY_API_KEY` | existing | Vercel AI Gateway. |
| `BLOB_STORE_ID`, `BLOB_STORE_NAME`, `BLOB_READ_WRITE_TOKEN` | Owner reports existing | Reuse private Blob when suitable; NAME is descriptive. Verify ID/token binding and isolation per 12. |

`policy.ts` exports `SALES_INTELLIGENCE_POLICY_VERSION = "csi-policy-v1"` and a `resolvePolicy()` that freezes the numeric defaults above into an object stamped onto Outreach Records at creation and used by `derive.ts`.

## 2. Capture — webhook path (all directions)

### 2.1 Subscription

The prior code inspection found an inbound subscription builder for `/restapi/v1.0/account/~/telephony/sessions?direction=Inbound`; it did not establish an active production subscription (zero were visible to this app on Sept 14). Add mode `"all"` to the builder/ops command using the same path without a direction filter. Preserve existing qualified-call capture while proving parity. Deduplicate receipts by provider UUID and interactions by canonical identity. Verify current subscription ownership, validation echo and renewal during deployment; do not use `withRecordings=true`, which would exclude traffic needed for missed-call work.

### 2.2 Route change (`ringcentral-webhook.routes.ts`)

After durable `captureRingCentralWebhookEvent`, ensure a deduplicated capture-projection job references that receipt when the intelligence capture flag is enabled, independently of the qualified-call evaluation flag. Commit durable work before acknowledging; where the existing receipt transaction cannot include the job, a receipt watermark recovery scan closes that gap. Queue publish is post-commit and may fail without losing work. The worker loads and normalizes stored evidence, never trusts the queue to carry raw provider state. No unawaited in-process projection is the only delivery path. The qualification evaluator remains unchanged and inbound-only.

### 2.3 `observeRingCentralWebhookEvents(events)`

For each `telephonySessionId` in the batch:

1. Resolve the current `CallInteraction` by account-scoped aliases (02 §2); fallback session/Call Log aliases have their own unique fence.
2. Build the projection with `interactionProjection.fromWebhookParties(existing, events, directorySnapshot)`:
   - external party = the party whose `phoneNumber` is not a company number / extension (per directory snapshot); `direction` from Vantage's perspective (customer calling Vantage is inbound); `queue_fanout` when ≥ 1 queue party or ≥ 3 user parties ringing. Monitoring/internal legs are identified from supported provider leg metadata, not invented webhook status codes.
   - `provider_connected` when any user party reaches `Answered`; `answered_at` = earliest.
   - `terminal` when every party is terminal (`Disconnected`, `Gone`, `Finished`, `Voicemail`, `Missed`, `NoCall`) — reuse `isLikelyTerminalRingCentralStatus`.
   - Track sequence per party. Process every party in a delivery before advancing its own fence; a session-level max is diagnostic only.
3. Upsert with `$setOnInsert` identity/first_observed_at and revision-CAS on changes; identical semantic projection is a no-op and does not increment `projection_revision`. On conflict reload/recompute with bounded retry. Append provider provenance without replaying operational effects.
4. `contactNumbers.upsertForInteraction(interaction)` — creates/updates the Contact Number (`kind`, `last_activity_at`, rollups, provider name).
5. A newly terminal or materially updated interaction durably schedules operational-transition and recording-discovery jobs with interaction revision dedupe. Provider contact-type evidence is applied per §9.1; human contact is not inferred from connected status. A delayed recording pointer schedules discovery even after the terminal event was already handled. Queue and cron invoke the same handlers; no in-process hook is the source of truth.

Everything is idempotent; the reconcile may redo the same steps.

## 3. Capture — Call Log reconcile (authoritative)

`reconcileCallLog.runOnce({ now })`, cron `*/10 * * * *` at `/api/cron/sales-intelligence-call-log-reconcile`:

1. **Claim** lease `scope: "call_log_all_directions"` via `MongoLeaseStore` (5-minute TTL, renew before each page). Loser returns `{ skipped: true, reason: "lease_held" }`.
2. **Window**: `windowTo = claim instant`; `windowFrom = min(cursor.last_sync_to − overlap, now − rolling lookback)`; first run = `now − rolling lookback`.
3. **Fetch** `GET /restapi/v1.0/account/~/call-log?view=Detailed&type=Voice&dateFrom=…&dateTo=…&perPage=250&page=n` — **no `direction` filter**. Honor `Retry-After` on 429 (`durableWork/providerRetry.ts`); a throttle ends the run without cursor advance and records `throttled_count`. Never call the qualified-call sync's fetch helper; a shared low-level `ringcentral/call-log-client.ts` may be extracted **from** `call-log-sync.service.ts` in a separate refactor commit owned by that Service, otherwise duplicate the ~30-line fetch.
4. **Order** records oldest-first by `startTime`.
5. **Project** each record with `interactionProjection.fromCallLogRecord(existing, record, directorySnapshot)`: legs → `legs[]` (bounded 40), all recording IDs from the record and every leg into `recordings[]`, `result` → `provider_result`, `provider_connected` from the answered result set, `provider_last_modified_at = lastModifiedTime`. Identity: `telephonySessionId` → `sessionId` → `id`. `call_log_ids` gains the record id and every leg id.
6. **Upsert** as in §2.3 (sources `+ "call_log_reconcile"`), then Contact Number upsert, rule-based contact type, hooks.
7. **Cursor** advances only in the fenced full-success write after every page and upsert completes; `known_complete_through = windowTo − 15 min` (RingCentral finalization lag) and any previously recorded gap inside the window is closed. Any failure leaves the cursor and opens/extends a `gaps[]` entry `{ from: windowFrom, to: windowTo, reason: error_code }`.
8. **Telemetry**: `sales_intelligence_call_log_runtime_ms`, `_pages`, `_upserts`, `_throttled_total`, `_lease_contention_total`. Events `sales_intelligence.call_log_reconcile.{started,completed,failed,lease_contended}` with masked owner hash, window, counts, bounded error code only.

Provider rate posture: Detailed Call Log is a Heavy endpoint. The qualified-call sync runs `*/30`; this runs `*/10` offset by 3 minutes (`3-59/10 * * * *`) to reduce scheduled overlap; long-running or retried work can still overlap and must honor shared provider throttling. Both use the same JWT and the same token store; a 429 in either run is counted and the run ends. Backfill (§3.1) runs only from the Owner command and only when no reconcile lease is held.

### 3.1 Backfill

`POST /api/v1/admin/sales-intelligence/backfill` (Owner) plans `SALES_INTELLIGENCE_BACKFILL_DAYS` daily windows into `sales_intelligence_sync_windows` (status `planned`). The cron `/api/cron/sales-intelligence-backfill-step` (every 15 min) claims lease `backfill`, takes the oldest `planned|partial` window, pages it with a per-page checkpoint, and marks `complete` only after the last page. `known_complete_through` never moves backwards; backfilled windows populate `coverage.backfill` separately. Recordings older than provider retention will show `no_recording`; that is expected and labelled.

## 4. Attachment refresh

Cron `/api/cron/sales-intelligence-attachment-refresh` every 5 minutes (lease `attachment_suggest`), also invoked inline after an interaction creates a **new** Contact Number.

1. Scan `form_leads` and `call_leads` with `updatedAt > cursor.provider_modified_watermark` (bounded 500 per run), plus Contact Numbers with `last_activity_at > cursor` that have no edge.
2. For each Lead, collect phone evidence: `normalized_phone_number` (live), `ingested_contact_snapshot.normalized_phone_number`, `granot_contact_snapshot.phone` (when present), `ringcentral.original_caller.normalized_phone_number`; normalize to E.164; resolve Contact Numbers (create none).
3. `suggest.ts` applies §01 §5.2 precedence and returns `{ contact_number_id, lead_ref, state, certainty, evidence[] }` per pair. Exact identity (`ringcentral.telephony_session_id` on a Call Lead equals an interaction's session) → `attached/exact`.
4. Ambiguity fan-in: for a Contact Number, if ≥ 2 Leads have `candidate` edges whose windows overlap (Form: −36 h/+14 d around Lead timestamp; Call: ± 12 h), set all to `ambiguous/unsure`. Non-overlapping candidates on the same number stay `candidate` (two different moves, months apart).
5. Persist with upsert on the pair; never downgrade `attached`, never touch `rejected`. Record `history[]`.
6. After persist: `contactNumbers.rebuildSearchTerms(number)` and `outreach.transitions.onAttachmentChanged(edge)` (identity_review in/out; `primary_contact_number_id` on the Lead's Outreach Record).

Lead snapshots refresh in attachment/context workers. GETs may join current records in memory but do not persist refreshes or cause business effects. Read freshness and snapshot timestamps remain explicit.

## 5. Outreach ensure and transitions

Trigger from durable Vantage EntityChange records, attachment/call changes, and scheduled watermark recovery. Ensure one Outreach Record per subject; official ineligible Leads are Closed. Never import qualification write services. Relevant flag changes close atomically with cancellation of outstanding obligations, audit and analysis-refresh job; they never automatically reopen.

An attributable outbound attempt opens Unworked, whether answered or not, with actual outcome. An attributable inbound human conversation with a Sales Rep also opens it. Voicemail/unknown connected is not meaningful human contact. A waiting customer calling back ends the matching wait; a missed callback adds missed-inbound work with the original assigned rep. Other active actions are retained. Auto-assignment only fills unassigned work using one reliably mapped rep; per-promise action assignment can differ from overall owner. Owner revision/assignment/correction wins.

Mapped missed inbound creates Number Review only when it cannot be attributed to an eligible Lead and does not evade closed/ambiguous work. Remove the old 24-hour expiry as a visibility rule: missed work remains outstanding until resolved. `UNANSWERED_INBOUND_REVIEW_HOURS` may bound a scan batch, never eligibility or retention; durable events/backfill discover older misses.

`derive(record, {now, policy, staffing, followups, restrictions, reviewItems, coverage})` is pure. Returns overdue, missing responsibility at record/action level, no next step, cooldown, meaningful-contact age, one highest-priority band plus all reasons, review badges, and call blockers. Use all active actions, not only one next_action or accepted findings. Rank per 01 §8; due dates do not depend on Owner confirmation. Recompute projections after every action mutation and on due-time boundaries.

## 6. Conversation discovery and media

### 6.1 Discovery

Terminal Call Interactions with recording IDs upsert each recording in `recordings[]` as an account-scoped LeadConversation; use the verified legacy-account migration in 02 §6. A missing recording ID creates pending recording discovery on the interaction, not a fabricated recording row. Detailed Call Log reconcile supplies delayed IDs. Preserve direction/time/contact number and a single valid Lead reference when known; ambiguous/unlinked remains number-level.

Eligibility is 01 §7: linked Form/Call Lead, Number Review, mapped sales inbound, reviewed-rep outbound, or ambiguous Lead context for analysis only. Internal/company and known non-customer are excluded from automatic analysis. There is no minimum duration, no random-sample gate for eligible calls, no exclusion for closed/Booked/Cancelled work, and no voicemail skip. Owner force-process is audited and does not bypass contact restrictions or official mutation rules.

Store the eligibility decision and policy version. Persist a media job before waking its worker. Capture/missing-call/assignment/deadline behavior continues independently of recording availability.

### 6.2 Media fetch (`conversations/media.ts`)

Cron `/api/cron/sales-intelligence-media-fetch` every 5 minutes wakes bounded media-stage jobs, using the same `sales_intelligence_jobs` lease/epoch claim as queue processing. Conversation compatibility claim fields never elect workers. Order by live priority then job next_attempt_at; process one bounded recording unit per invocation:

1. `GET /restapi/v1.0/account/~/recording/{id}` → metadata (`contentUri`, `duration`, `contentType`). Never persist `contentUri`.
2. `GET /restapi/v1.0/account/~/recording/{id}/content` with the Bearer token, streamed, `Content-Length` checked against `MEDIA_MAX_BYTES`. Compute SHA-256 while streaming. Upload through a new private streaming adapter to an immutable `conversations/{accountId}/{recordingId}/{digest}.{extension}` key, preserving verified provider content type and using multipart as needed. Existing uploadConversationMp3 remains a seed-artifact helper; never relabel arbitrary audio as MP3 or overwrite prior run evidence. Vercel function payload limits do not apply because the body never enters a request; keep the function under the deployed duration limit by processing one recording per invocation when the file is > 10 MB.
3. Initial 404 → retry as recording pending with bounded backoff and Call Log reconciliation; only confirmed absence/expiry or exhausted documented availability window becomes `no_recording` (retain reason). 403 → `unavailable` with `permission_denied`, `unavailable_until = +24 h`, and Coverage capability `recording_content = "denied"`. 429 → `unavailable:throttled` with `unavailable_until` from `Retry-After` (default +10 min). Other transient errors increment the media job attempt count and back off; after 8 failures dead-letter that job and project conversation failure. Use §14 policy consistently; do not maintain a conflicting conversation-level counter.
4. Success → `media_stored`, `media{ blob_pathname, bytes, content_type, stored_at }`, `media_digest_sha256`, `next_attempt_at = now`.

### 6.3 Transcription (`conversations/transcribe.ts`)

Cron `/api/cron/sales-intelligence-transcribe` every 5 minutes wakes at most 5 transcription-stage jobs through the common job claimer:

1. `aiBudget.reserve({ kind: "stt", estimate = duration_seconds × rate })`; on failure → `unavailable:budget_exhausted`, `unavailable_until = next budget period`; raising the cap may wake it sooner. Keep the pending stage and job.
2. Download the Blob server-side (private read via signed token), send to the AI Gateway STT model with `timestamps: segment` where supported. Raw text stays in memory only.
3. Segment into stable text units (`sid` 1..n, nullable `start_ms`/`end_ms`, timing source provider/unavailable); preserve actual provider timing and never invent sentence timestamps, run `conversations/redaction.ts` (existing deterministic redactor) on every sentence **before** anything is persisted; count `redactions`. Add targeted spoken-digit-run redaction (≥ 7 consecutive spoken digits, card/CVV/expiry phrases) in `redaction.ts` as a strict extension with tests.
4. Speaker attribution: if the STT model returns diarization use it; otherwise leave `speaker: "unknown"` (do not guess from turn order).
5. Persist `transcript{ text (joined redacted), model, chars, redactions, created_at }`, `transcript_segments[]`, `cost_cents.stt` (actual), state `transcribed`, `next_attempt_at = now`. Reconcile budget actual.
6. Persist immutable transcript-version evidence and enqueue analysis. The MCP agent may infer contact type; server application updates conversation/interaction with provenance and triggers transitions. Do not invoke an untracked standalone LLM here.

### 6.4 Analysis and application

The canonical protocol is [10](10-intelligence-agent-contract.md). Claim an analysis job, reserve budget, create run and initial evidence snapshot, fetch the pinned MCP prompt, expose only scoped read tools plus submit, and run the AI SDK agent. Snapshot each tool response. Transcript and notes are untrusted evidence. All LLM steps use this architecture. Stop after successful idempotent submission.

The submit endpoint validates the strict envelope and run-scoped evidence, stores it with an application job atomically, and returns a receipt. No exact locator or entailment gate in v1. Structured-output errors are visible/retryable within bounds; operational uncertainty produces review/undated work, not invented facts.

The application worker resolves dates/amounts, reconciles newer evidence, reads current revisions, and applies the allowed effects in 10 §5 with audit and semantic commitment dedupe. A single assertion can create an action and assign it; a single run may have applied, blocked, or review-required effects. Final run status is completed once publication and effect evaluation finish, with effect counts/results separate; it does not mean every effect was allowed. Submitted alone is not completed analysis/application. Store each result. Publish summary/findings even when identity/Owner/closure blocks their effects. Current successful analysis remains visible during reruns/failures.

Do not create a Lead, Booking, Cancellation, rep message, permanent suppression, attachment, or AI closure. AI recommendations remain suggestions until Owner Apply. Clear call restrictions pause the affected channel and open review. Callback completion records actual outcome and never completes unrelated tasks.

## 7. Owner review and intervention

Confirm one finding or the current run without reapplying effects. Correct/retract changes the targeted action immediately in a Mongo transaction, preserving prior values and an Owner instruction. Re-analyze original evidence or current context as requested; both modes revalidate effects against current state. New assertions do not inherit confirmation. Preserve model Agrees/Disagrees/Cannot determine assessments against exact instruction revisions.

An Owner note is context only. Explicit commands set dates, assign, mark worked, wait, close/reopen, or change restrictions. Owner Close cancels remaining active actions with history; later requests produce Needs review. Official record mutations use existing Vantage workflows opened from the UI. More than one active action and undated actions are first-class, not exceptions to the schema.

## 8. Owner Rep Nudge (`nudges/*`)

### 8.1 Preconditions (`preview.ts`, also enforced in `send.ts`)

1. `SALES_INTELLIGENCE_NUDGE_ENABLED` and channel ∈ `NUDGE_CHANNELS` ∩ `link.nudge_channels_allowed`.
2. Owner may message a reviewed rep about any active Outreach Record, including identity review or future-due work. Do not require overdue status to ask a rep a question. Closed-work messaging is disabled in v1; Owner can inspect/reopen if eligible. Context/review nudges are distinct from call suggestions: blocked/ambiguous contact must never render a “call now” template.
3. A call-suggestion nudge requires contact eligibility and no active call blocker. An internal review-context message may discuss a restriction without asking the rep to contact the customer. The selected template purpose and blockers are revalidated on Send; this never sends to the customer.
4. Rep Identity Link `status = reviewed`, `effective_to = null`, `role_kind = sales_rep`.
5. Per-rep rate limit: < `NUDGE_PER_REP_PER_HOUR` nudges in the last hour (`owner_rep_nudges` by link id).
6. Destination resolution per channel; the resolved destination must not equal (E.164) the Contact Number, any Lead phone on the record, or any Lead Message `to` for those Leads. Violation → 422 `nudge_destination_is_customer` and an operational event `level: "error"`.
7. Idempotency-Key required; replay returns the stored nudge.

### 8.2 Template (`templates.ts`, `template_version: 1`)

```
{{agent_first_name}} — {{reason_sentence}}
{{lead_line}}
Number ending {{last4}} · last contact {{last_contact_relative}} · {{source_label}}
Open in Vantage: {{admin_url}}/sales-intelligence?record={{outreach_record_id}}
— sent by {{owner_label}} via Vantage
```

`reason_sentence` from the derived reason code (e.g. "this Form Lead has had no call for 3 h 20 m"). Customer number is **last 4 digits only** in the body. Lead line uses first name + last initial. Owner may edit the body in the dialog; the edited body is what is stored as `body_as_sent` (≤ 1,000 chars, validated against the same customer-number rule: the full customer number is rejected).

### 8.3 Send (`send.ts`) and provider adapters

Order: insert `OwnerRepNudge{ status: pending }` (unique idempotency) → provider call → update status. A crash between insert and update leaves `pending`; the cron `/api/cron/sales-intelligence-nudge-repair` (every 5 min) resolves `pending` older than 2 min by checking the provider (Team Messaging posts list by chat since `createdAt`) or marking `unknown_delivery`. Reconciliation must match a provider message id or another unambiguous receipt; similar body/time alone is not proof. Unknown delivery never triggers automatic resend or fallback.

| Channel | Adapter | Endpoint |
| --- | --- | --- |
| `team_messaging` | `teamMessaging.ensureDirectChat(personId)` then `postToChat(chatId, text)` | `POST /restapi/v1.0/glip/conversations { members:[{id}] }` (idempotent: returns the existing Direct) then `POST /team-messaging/v1/chats/{chatId}/posts { text }` |
| `sms_to_rep` | `sms.sendFromJwtDid(toE164, text)` | `POST /restapi/v1.0/account/~/extension/~/sms { from:{phoneNumber: jwtSmsSenderDid}, to:[{phoneNumber}], text }` |
| `pager` | `pager.send(extensionNumber, text)` | `POST /restapi/v1.0/account/~/extension/~/company-pager { to:[{extensionNumber}], from:{extensionNumber: jwtExt}, text }` |

If Team Messaging definitively fails before any message submission on chat creation and `pager` is allowed → send pager, `status: fallback_sent`, `fallback_channel: pager`. Never fall back to SMS to any number other than the rep DID, and never to the customer.

Audit: `recordOperationalEvent({ eventKey: "sales_intelligence.nudge.sent"|".failed", category: "admin", workflow: "sales_intelligence", entity: OwnerRepNudge, piiPolicy: "none" })` plus an Outreach event `nudge_sent`. The Admin proxy audits the POST as a mutation.

The first live send is a proof step (CSI-14): one Owner-chosen rep, one Direct chat, copy approved in chat.

## 9. Model work versus deterministic work

### 9.1 Contact type

Provider-declared voicemail is evidence; provider-connected or short duration alone is not proof of voicemail or human contact. Transcript interpretation runs through the Vantage MCP agent. Persist speaker identity uncertainty. All voicemail messages continue through substantive analysis.

### 9.2 Sales relevance

Deterministic eligibility is 01 §7. Duration affects cost/priority, never disqualifies the accepted cases. Official ineligibility for outreach is not analysis ineligibility.

### 9.3 Findings and envelope

Use [10 §3](10-intelligence-agent-contract.md#3-envelope), including typed commitments, completion/rescheduling, full sales context, suggestions, and Owner-instruction assessments. The agent searches relevant Vantage context and submits one run-bound envelope. Exact prompt, retrieved evidence, and output are retained under the redaction/retention rules.

### 9.4 Verification

First release enforces schema, valid source snapshot scope, allowed effects, chronology and Owner precedence. Exact transcript positions and entailment are deferred (`not_run`); locator failures alone do not block findings or auto-application. No mandatory second verification model or precision benchmark blocks v1. Functional fixtures still verify all operational boundaries.

### 9.5 Number running summary

Refresh from relevant underlying transcript assertions and current captured Vantage context, including newer events and Owner corrections. Never summarize only prior summaries. Fingerprint meaningful fields/evidence revisions; routine updatedAt changes do not invoke the model. Paginate relevant history; incomplete coverage is explicit, not silently represented as complete by a last-20-calls cutoff. Use the same MCP agent architecture and save the run/version.

### 9.6 Owner summary

Summary references the run's findings and recorded official context. Distinguish said on call, confirmed by Vantage, and inference. Confirmed analysis never certifies a Booking or payment. Conflicting Owner instructions remain in force while model agreement is displayed.

### 9.7 Deterministic responsibilities

Capture, matching/attachment authority, eligibility, clock math, ranking, official closure, assignment precedence, command validation, budget admission, idempotency, and coverage are server rules. AI never emits Outreach state or Attention rank. STT is a bounded media operation; transcription availability does not gate deterministic tracking.

### 9.8 Budget

Default monthly cap **$80 (8000 cents)**, Owner-editable and audited. Reserve for STT and bounded agent steps using current deployment pricing, reconcile actual usage, and retain pending jobs at exhaustion. Budget pauses are not generic failures and do not consume failure retry counts. Real-time work has priority over historical backfill. Per-run limits and selected models are engineering/deployment settings, not copied historical price assumptions.

## 10. Live stream (`live.ts`)

`GET /api/v1/admin/sales-intelligence/live` uses the existing Daily Operations SSE transport patterns, but its durable source is the CSI audit/invalidation stream. Append invalidations for interaction, Outreach, action, analysis, review, restriction, nudge and settings changes in the same transaction as each write. Poll that single stream every 3 seconds with `(recorded_at,_id)` cursor; heartbeat 25 seconds and reconnect after the deployed function limit (never assume a 10-minute function is configured). Use bounded overlap/dedupe plus a periodic full refetch to repair late commits. Client receives invalidations and refetches authoritative scoped DTOs; no ambiguous cursor over several mutable collections. Event payload projections are optional conveniences, not a second state authority. Events:

| event | data |
| --- | --- |
| `interaction` | `NumberActivityEntryDto` (timeline row) + `contact_number_id` |
| `outreach` | `AttentionRowDto` (derived on the server) |
| `finding` | finding/run/subject ids and revision |
| `followup`, `analysis`, `review`, `restriction`, `settings` | target/subject ids, revision and invalidation kind; no raw text |
| `nudge` | `NudgeDto` |
| `coverage` | `{ known_through, gaps_count }` every 60 s |
| `heartbeat` | `{ at }` |

Optional Redis doorbell reuses the existing REST configuration pattern (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or a complete configured Upstash REST pair), with CSI environment/database namespacing. `REDIS_URL`/`KV_URL` are socket URLs, not REST substitutes; the read-only token cannot publish. Retire the earlier standalone `SALES_INTELLIGENCE_LIVE_REDIS_URL` suggestion. Mongo polling remains fully functional without Redis. See 12 for Owner-supplied configuration.

## 11. Crons and queues (`vercel.json`)

| Path | Schedule | Lease key | Flag |
| --- | --- | --- | --- |
| `/api/cron/sales-intelligence-call-log-reconcile` | `3-59/10 * * * *` | `call_log_all_directions` | `CAPTURE_CALL_LOG` |
| `/api/cron/sales-intelligence-backfill-step` | `*/15 * * * *` | `backfill` | `BACKFILL_DAYS > 0` |
| `/api/cron/sales-intelligence-directory-sync` | `20 5 * * *` | `directory` | `DIRECTORY_SYNC` |
| `/api/cron/sales-intelligence-attachment-refresh` | `*/5 * * * *` | `attachment_suggest` | `ATTACHMENT_REFRESH` |
| `/api/cron/sales-intelligence-outreach-ensure` | `*/5 * * * *` | `outreach_derive` | `OUTREACH_ENSURE` |
| `/api/cron/sales-intelligence-media-fetch` | `*/5 * * * *` | `media_fetch` | `MEDIA_ENABLED` |
| `/api/cron/sales-intelligence-transcribe` | `*/5 * * * *` | `transcription` | `STT_ENABLED` |
| `/api/cron/sales-intelligence-extract` | `*/5 * * * *` | `extraction` | `EXTRACTION_ENABLED` |
| `/api/cron/sales-intelligence-nudge-repair` | `*/5 * * * *` | `nudge_repair` | `NUDGE_ENABLED` |
| `/api/cron/sales-intelligence-retention` | `30 4 * * *` | `retention` | always (no-op when disabled) |
| `/api/cron/sales-intelligence-due` | `* * * * *` | `due_transitions` | `OUTREACH_ENSURE` |
| `/api/cron/sales-intelligence-job-recovery` | `* * * * *` | `job_recovery` | master enabled; stages honor their flags |
| `/api/cron/sales-intelligence-apply` | `*/5 * * * *` | `analysis_apply` | `EXTRACTION_ENABLED` |

All cron routes: `Bearer`/`x-cron-secret`, disabled flag → `{ ok: true, skipped: true, reason: "disabled" }`, lease held → `{ ok: true, skipped: true, reason: "lease_held" }`, never throw a provider body. `createSalesIntelligenceCronRouter(deps)` for tests.

Queue consumer `api/queues/sales-intelligence-consumer.ts` (topic env-scoped, `{ job_id }` only) is a wake-up that calls the same claim functions; cron is the recovery path. Consumers re-register any foundations they need (they do not inherit `app.ts` bootstrap). Stage/routing data comes from the authoritative Mongo job, not untrusted queue payload fields.

## 12. Retention (`/api/cron/sales-intelligence-retention`)

| Data | Default | Env |
| --- | --- | --- |
| Raw webhook payloads (`ringcentral_webhook_events`) | existing policy (unchanged) | — |
| Audio in Blob | 90 days → delete Blob, set `media.purged_at` | `SALES_INTELLIGENCE_RETENTION_AUDIO_DAYS=90` |
| Redacted transcript + segments + findings | 365 days → transcript/segments removed, source text and derived claims/summaries removed; non-content audit tombstones retained | `SALES_INTELLIGENCE_RETENTION_TRANSCRIPT_DAYS=365` |
| Call Interactions, Contact Numbers, attachments, outreach, nudges | 730 days | `SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS=730` |

Deletion propagates to derived text and caches and leaves a non-sensitive tombstone (`purged_at`). Retention values are retained engineering defaults, not legal determinations; see 06 §4.

## 13. Observability

Events (`recordOperationalEvent`, `workflow: "sales_intelligence"`, `piiPolicy: "none"` unless noted): `capture.webhook.observe_failed`, `call_log_reconcile.{started,completed,failed,lease_contended,gap_opened,gap_closed}`, `attachment.ambiguity_opened`, `outreach.{created,transitioned,closed}`, `conversation.{media_stored,unavailable,transcribed,complete,failed}`, `finding.{confirmed,corrected,retracted,applied,blocked}`, `nudge.{sent,failed,fallback}`, `ai_budget.{reserved,exhausted}`. Metrics: runtimes, counts, throttles, contention, AI cents reserved/actual, pending findings, overdue count (gauge computed by derive on the overview call).

Health projection for Coverage (`coverage.ts`): `{ known_through, gaps[], capabilities: { call_log: ok, recording_content: ok|denied|unknown, presence: ok|unknown, team_messaging: ok|unknown, sms: ok|unknown, pager: ok|unknown, ringsense: unavailable }, hygiene: { company_numbers, mapped_inbound_numbers, unmapped_inbound_numbers_with_traffic_30d, user_extensions, reviewed_sales_rep_links, proposed_links }, ai: { month, ceiling_cents, reserved_cents, actual_cents, paused: boolean }, queues: { media_pending, stt_pending, extract_pending, unavailable, failed } }`.

## 14. Event → durable job → worker contract

Vercel Queue accelerates execution; Mongo durable jobs are authoritative and cron recovers pending/expired jobs. No filesystem sandbox is required. Add `jobs/enqueue.ts`, `jobs/claim.ts`, `jobs/dispatch.ts`, `analysis/run.ts`, `analysis/submit.ts`, `analysis/apply.ts`, `analysis/evidence.ts`, `review/commands.ts` and `policy/commands.ts` under the main-server module. MCP tools call these services through scoped internal endpoints, not duplicated implementations.

| Trigger | Persisted work and effect |
| --- | --- |
| RingCentral account telephony session webhook | Capture receipt/dedupe; project all-direction interaction; derive operational work promptly; enqueue Call Log detail/recording discovery after terminal observation. Ack without media or LLM work. |
| Detailed Call Log reconciliation (10 minutes) | Authoritative correction/completion/recording IDs; same projection and downstream dedupe as webhook. Separate cursor from qualified-call ingestion. |
| Vantage Lead create or relevant official EntityChange | Ensure/recheck eligibility, attachments and Outreach; refresh affected number context. Read durable EntityChange stream with cursor; existing Lead writers do not depend on intelligence succeeding. |
| Existing writer without usable event / repair | Five-minute updatedAt scans detect meaningful field-digest change, then enqueue the same work. No second Granot webhook implementation. |
| Attachment/Rep Identity Link change | Re-evaluate affected identity, eligibility and prior uncertain speaker evidence; refresh analysis if meaningful. Never silently rewrite reviewed assignments. |
| Recording discovered | Media job → immutable stored audio digest → STT job → redacted transcript version → analysis job. Each completion durably schedules the next stage. |
| Agent submits envelope | Persist submission and application job together; apply allowed effects with current revisions and stable commitment keys. |
| New call / official context / correction | Coalesce number refresh by meaningful input revision; enqueue a newer run when current run's input becomes stale. |
| Owner correction/retraction | Apply immediate correction plus instruction/audit first; then requested reanalysis. Model availability cannot delay Owner control. |
| Deadline/temporary restriction expires | Deterministic due worker (every minute) transitions waits/expires temporary blocks and publishes invalidation; read-time derive uses current clock even if worker lags. |
| Owner message | Explicit send command only; dedicated delivery record and repair, never an analysis side effect. |
| Budget increase/period rollover | Resume eligible budget-paused jobs with fresh reservation. |
| Backfill window complete | Reconcile later known activity before activating historical commitments; low-priority analysis jobs. |

Job payload is `{job_id}` only. Job doc stores stage, input revision, dedupe key, attempts, lease epoch/expiry, next attempt and result. Enqueue/update downstream work atomically with source state where owned; where ingest is external, a durable receipt/outbox and repair scan close the publish gap. A failed queue publish never loses the job. Duplicate queue delivery claims the same job; expired workers cannot complete after a new lease epoch.

Use existing `durableWork` lease conventions. Default retry policy: bounded exponential backoff with jitter, honor provider Retry-After, at most 8 transient failures before dead letter. Schema failure may repair/retry once before surfacing; permission/budget pause awaits capability/policy change rather than burning retries. Separate stages prevent an extraction retry from repeating STT/media. Owner Retry requeues the failed stage with audit and dedupe; no ad hoc generic worker loops.

Register the minute recovery/due and five-minute apply crons listed in §11. Both queues and cron call the same claim/process functions. Process one bounded provider unit per invocation and respect deployed timeout; persist checkpoints for long transcripts/backfill. Do not hold a Mongo transaction during MCP, model, Blob, or RingCentral network calls.

Meaningful-change fingerprints include relevant call revisions, transcript version, scoped Lead/Booking flags, attachment and rep-link revisions, active follow-ups, restrictions and Owner instructions. Include the consumed evidence set, not unrelated updatedAt. Coalesce bursts per subject; after completion compare live fingerprint and schedule at most one newer refresh. Clock-only changes never require an LLM.

Coverage reports pending/running/paused/failed/dead-letter per stage, oldest pending age, known-complete call history, gaps, recording grants, model availability and actual/reserved budget. SSE invalidates review/policy/analysis/follow-up changes as well as interactions and Outreach. A lost SSE event is repaired by refetch; it is not the business event bus.

Retention applies to evidence snapshots, prompts, tool responses, envelope content and summaries as well as audio/transcripts. Never preserve a purged transcript by copying it into a run prompt. Original-evidence reanalysis reports unavailable after purge. Keep minimal non-content audit identifiers/results for the configured audit period.

## 15. Verified server integration details

**Mount/auth:** existing Owner routers, including conversations and Daily Operations, are mounted inside `src/routes/v1.routes.ts` after `router.use("/api/v1", requireApiSecret)`. Mount CSI Owner and internal routers there as well. Owner routes then call requireRegistryOwnerActor; internal routes require the dedicated scoped-key identity plus run-token middleware specified in 04. A standalone run Bearer token is not recognized by the existing extension-user auth guard. Do not bypass the guard or invent a new global auth kind without an explicit contract change.

**EntityChange ingestion:** existing `src/models/EntityChange.ts` uses `applied_at`, `entity.model/id`, `changed_paths`, and revision_before/after; it has no updatedAt cursor or CSI entity enum. Maintain a separate `(applied_at,_id)` cursor, bounded overlap and per-change dedupe; use change as a trigger and read current source models since field values may be redacted/hash-only. Add `(applied_at:1,_id:1)` scan index through migration. Because applied_at is not a commit-order token, scheduled source watermarks/full reconciliation repair late-committed changes; never claim the cursor alone guarantees completeness. Existing writers do not call an in-process CSI hook.

**Lease storage:** `MongoLeaseStore` in `durableWork/leases.ts` requires `scope`, owner and epoch. CSI sync state uses that exact scope field/index. Job records use scope `csi:<stage>:<job_id>` or an explicit adapter; do not pass a model keyed only by `key` into this helper. A lease assert followed by an unrelated update is insufficient: completion/CAS and lease epoch must be fenced together in the state write.

**Queue deployment:** follow `api/queues/granot-lifecycle-consumer.ts` and `vercel.json`: QueueClient.handleNodeCallback, registered env-scoped queue/v2beta topic, standalone connection/bootstrap and `{job_id}` payload. Add the CSI consumer function trigger config as well as cron entries. A file without trigger registration is not wired. Provider per-stage timeouts must fit the deployed consumer/MCP function limits; persist resumable checkpoints and let cron recover.

**Backend reads:** a stale attachment display snapshot can be rejoined in memory; GET is never a write. Existing conversations list intentionally omits transcript/summary text. Preserve that privacy/performance boundary; expose versioned content only in Owner detail/evidence endpoints. Coerce nothing unknown to an empty success or zero duration.

## Owner-supplied deployment inputs

[12 — Deployment inputs and model policy](12-deployment-inputs-and-model-policy.md) records the existing Gateway key, deployed MCP, Blob/Redis reuse, mapping proposals and partly trusted RingCentral probe. These inputs guide implementation; local credentials are not evidence of deployed permissions.
