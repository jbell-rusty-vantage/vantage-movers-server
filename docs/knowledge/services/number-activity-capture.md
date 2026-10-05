---
type: Service
title: Number Activity capture (all-direction Call Interaction projection)
description: CSI-02 projection of RingCentral webhook parties and Detailed Call Log records into canonical, account-scoped Call Interactions with honest coverage, and the All Numbers call summary of every touched Contact Number. Its only downstream job is the number's lead-link recompute when a settled call joins it.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2026-12-17
resource: src/services/numberActivity/
applies_to:
  - src/services/numberActivity/
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
  - id: models
    resource: docs/call-sales-intelligence/02-domain-models.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-02/HANDOFF.md
  - id: review
    resource: docs/call-sales-intelligence/workspace/evidence/csi-02/INDEPENDENT-REVIEW.md
  - id: call-log-completeness
    resource: ../CALL-LOG-CAPTURE-COMPLETENESS-SPECIFICATION.md
---

# Number Activity capture

**2026-10 All Numbers phase B.** The Contact Number rollups, the attachment refresh job and the rollup rebuild are gone: capture recomputes each touched number's [call summary](#all-numbers-call-summary) from its calls in the observation's transaction and nominates a `lead_link` job ([number-activity-reads.md](number-activity-reads.md#lead-link-leadlinkts)).

**2026-10 server/admin slimming.** Capture is retained. It no longer nominates `outreach_ensure` or `recording_discovery` work, the ContactNumber rollups lost their Outreach and analysis counters, and the old capture-recovery repair tooling was removed ([slimming specification](../../server-admin-slimming/SPECIFICATION.md) §7.3–7.4). Provider recording metadata stays on `call_interactions.recordings[]`; the server never downloads audio.

**Role:** turns every RingCentral telephony observation — inbound, outbound, missed, unanswered, transferred, internal, withheld — into one canonical [Call Interaction](../../../../CONTEXT.md) per provider session, keyed by provider account plus session/Call Log aliases. It feeds Number Activity; it never widens [Call Qualification](../../../../CONTEXT.md), never imports `ingestRingCentralQualifiedCall`, and never writes Leads.

**System of record:** `call_interactions`, `call_interaction_aliases`, `contact_numbers`, `sales_intelligence_sync_state` (scopes `call_log_all_directions` and `call_log_sweep`), CSI audit events and `sales_intelligence_jobs`. Indexes come from the CSI migration; writers fail closed without the unique fences.

## Modules

| Module | Responsibility |
| --- | --- |
| `interactionProjection.ts` | Pure. `fromWebhookParties`, `fromCallLogRecord`, `mergeProjections`, `sameProjection`, identity/alias helpers, `classifyCallLogRecordState` / `provisionalCallLogRule` (CC-04). No I/O. |
| `persistInteraction.ts` | One Mongo transaction per observation: alias reservation, insert or revision-CAS update, merge-with-proof tombstones, the Contact Number observation (caller-ID names, search-term addition, activity window), the call summary of every touched number (`callSummary.ts`), `interaction` audit invalidation, the `lead_link` job intent. Bounded retry on duplicate key / revision conflict / transient transaction error. |
| `observeWebhookEvents.ts` | `normalizeWebhookPartyObservations(payload, receivedAt)` and `observeRingCentralWebhookEvents(observations, deps)`. Interface CSI-03 calls from its durable capture-projection job. |
| `reconcileCallLog.ts` | `runCallLogReconcileOnce(deps)`: fenced lease, Call Log Sync step, start-time window with settle horizon, per-row skip, oldest-first projection, quarantine retries, straggler settles, gaps, gap repair, cursor and `known_complete_through`. |
| `callLogApplier.ts` | The reconcile's per-record half, shared with the minute ISync lane: account/directory/route context once per run, CC-02 per-row skip (`unchangedRecords`), oldest-first apply, CC-01 quarantine counting, and the `call_interactions` rows a batch changed (for the Sales Outreach Desk wake). |
| `callLogIsyncLane.ts` | Staffed-hours minute Call Log ISync lane (RINGCENTRAL-CAPTURE §4); see [Account Call Log Sync driver](#account-call-log-sync-driver). |
| `callLogQuarantine.ts` | Pure quarantine bookkeeping (`record_failures` → `quarantined_records`, backoff, bounds, error classification, bounded failure log fields). |
| `callLogSyncDriver.ts` | `runCallLogSyncStep`: account Call Log Sync (`FSync` bootstrap, `ISync` chain, expiry fallback, token-storage rule, shadow counting). |
| `callLogSweep.ts` | `runCallLogSweepOnce`: nightly authoritative re-read with before/after completeness figures on scope `call_log_sweep`. |
| `callLogClient.ts` | Detailed Call Log page fetch without a direction filter, one record by id, and account Call Log Sync, over the shared RingCentral client/token store. GET only. |
| `phone.ts`, `directory.ts`, `accountIdentity.ts` | Endpoint classification (`external`, `company_did`, `extension`, `service_code`, `withheld`, `malformed`), read-only directory lookup, provider account resolution that never fabricates. |
| `fixtures.ts` | Synthetic deliveries and records for CSI-03/04/C tests. |
| `callLogStateFixtures.ts` | Synthetic snapshot-shaped and settled Call Log records for the CC-04 gate (24 stored Internal snapshots, 2 live-watch snapshots and their final versions, 3 `Accepted` snapshots, 37 settled records). |

## Invariants

- Identity is `(provider, provider_account_id, alias)`; aliases are `telephony_session_id` → `session_id` → `call_log_id`. Two rows merge only when one provider record names both identities; the earlier-created row is canonical, the other gets `merged_into_id`, aliases re-point, and both numbers' summaries are recomputed. Phone and time similarity never merge.
- Each party is fenced by its own `last_webhook_sequence`. `terminal` and `provider_connected` never regress (a provisional Call Log record leaves `terminal` as it was; it never sets it). A Call Log record with an older `lastModifiedTime` adds ids/legs/recordings only and never overwrites stored leg-level result/duration. Once a Call Log record has been applied, its result/duration/ended_at outrank later webhook events. `legs_overflow_count` is a monotone lower bound.
- Identical semantic input is a no-op: no write, revision, audit row or job. `call_log_state` is part of the projection, so a change of state alone is a revision.
- **A Call Log record is observed, not final** (CC-04). RingCentral lists a queue call as soon as its unanswered ring-out legs end, then rewrites the same record id when the call ends. `classifyCallLogRecordState(record, directory, { now, settleHorizonMinutes })` is pure and returns `provisional` when either rule holds:
  - **P-a**: the top-level `result` is `Stopped`, `IP Phone Offline` or `In Progress`.
  - **P-b**: RingCentral's `direction` is `Inbound`/`Outbound` (a live snapshot says `Outbound`: it copies the ring-out leg), the top-level `to` classifies as company side, every leg is a company ring-out (a `PstnToSip`/`SipToSip` leg that is not `Inbound`, with an `extension.id` or a company-side `to`; so no `Accept` or customer leg), **and** the call carries PSTN evidence (a `PstnToSip` leg, or a top-level number that is not a company DID). The top-level `from` may be the rep's extension (the 24 stored snapshots: both sides company, stored `Internal`) or the PSTN caller id (live watch 2026-09-24). The PSTN condition keeps a genuine extension-to-extension call settled.

  Otherwise `settled`. Any record with `now − lastModifiedTime ≥ settleHorizonMinutes` (default 240; start time when `lastModifiedTime` is absent) is `settled`. An `Inbound`/`Accepted` record with a short `Accept` leg is **deliberately settled**: its `lastModifiedTime` does not move while the call continues, so it cannot be told from a genuine short answered queue call; the re-read corrects duration and adds recordings. The rules gate downstream work only; the reconcile re-reads every record inside the horizon regardless. Pinned by `callLogState.test.ts` (24 stored-shape and 2 live-shape snapshot fixtures provisional; 3 `Accepted` snapshots and 37 settled fixtures of every result family settled).
- `call_interactions.call_log_state`: `null` (never seen in the Call Log: webhook-only or stored before CC-04), `provisional`, `settled`. A provisional record does not set `terminal`, `ended_at` or `duration_seconds` from the snapshot, gets **no Contact Number**, and schedules **no** downstream job. `settled` never regresses: a stale record keeps the stored state (a provisional row quiet past the horizon still settles), and a settled row stays settled. Webhook projection never sets the field; only a settled Call Log record, or the settle from store below, settles a row.
- **A terminal row never moves to provisional.** When a row is already `terminal` (a webhook `Disconnected`, or any earlier final observation) and is not provisional, a Call Log record that classifies as a snapshot is applied like a stale record: it adds ids, legs and recordings only. It does not change `call_log_state`, direction, endpoints, result, duration or `provider_last_modified_at`, so the Contact Number, its summary and downstream work already created are never withdrawn and re-run. This covers the provider's rewrite lag after webhook capture has ended a session, and a newer snapshot-looking record on a settled row.
- The **one allowed regression**: a later Call Log version of a provisional row may change `direction` (`Internal` or the snapshot's `Outbound` to the final `Inbound`/`Outbound`) and `started_at` and set `external_e164`, `external_endpoint_kind` and the Contact Number. It is refused on a `settled` Internal row (a row stored before CC-04, `null`, may still change, so historical repair can fix frozen snapshots). The Contact Number appears on the settle transition and the call is counted once (the summary is recomputed from the calls). The first settled revision of a provisional row (`newly_settled`) is treated like a creation downstream: `outreach_ensure` for that revision, the number's `lead_link` job, `recording_discovery` for every recording id (or `:pending` when none).
- `contact_numbers.search_terms` has one cap and one owner (`numberActivity/searchTerms.ts`, `MAX_SEARCH_TERMS = 50`). The All Numbers lead-link recompute owns the set and replaces it wholesale (caller-ID names, then the Leads' names, Job Numbers and reps); capture (`observeOnNumber`) may only *add* an observed caller-ID name and never truncates, reorders or evicts a term it did not write — at the cap it declines the addition, and the name still reaches the set through `provider_names` on the next recompute (CSI-14 §6).
- `contact_type` here is `unknown` or provider-declared `voicemail`; human conversation is never inferred from connection or duration. Transcript/Owner values are preserved.
- `Internal` requires company-side evidence on **both** endpoints (directory extension/DID, or a provider-supplied extension id/number). An unknown short dial string is `malformed`, not a fabricated extension. A party event with no `direction` projects `Unknown` until later evidence; the party's own extension is never injected into an endpoint merely assumed to be the company side.
- Internal, withheld, malformed and service-code endpoints keep raw provider evidence on the interaction (`external_endpoint_kind`, party `phone_number_raw`) and never create a Contact Number or downstream job.
- Every audit row (`interaction.created|updated|merged`) carries `current.proof_ref` (receipt uuids or Call Log record id), `input_kind`, and `request_id_generated`; callers pass their durable job/run id as `request_id` so `actor.request_id` ties back to real work. Alias rows keep the `proof_ref` that originally proved them; the merge proof is on the `interaction.merged` row. Tombstones keep `contact_number_id`; recounts must filter `merged_into_id: null`.
- Downstream intent (`scheduleDownstream` in `persistInteraction.ts`): only `csi:lead-link:lead-link-v1:number:<id>:call:<interaction id>`, when a settled call joined the number (a new number, a new call, a call re-pointed or merged onto it) and `SALES_INTELLIGENCE_ENABLED` is on. Capture nominates no other stage. A provisional row enqueues nothing; its first settled revision counts as joining. The retired `attachment_refresh`, `outreach_ensure` and `recording_discovery` stages are terminalized as `retired` by job recovery.
- A Call Log record is **observed, not final**. RingCentral lists a queue call while its ring-out legs are still ending and rewrites the same record when the call ends; `/call-log` filters on **start** time. Every run therefore re-reads a trailing settle horizon, and nothing assumes a record read once is its final version.
- The reconcile window is `from = min(incremental_from, now − settle horizon)`, where `incremental_from = max(cursor.last_sync_to − overlap, now − safety)` is a **watermark**. A first run with no cursor uses the full cold-start lookback. When the safety clamp bites, the range `incremental_from` did not reach is opened as a `watermark_clamp` gap and repaired oldest-first with the leftover page budget; the horizon does not change that rule.
- **Per-row skip.** A record is counted as a no-op without opening a transaction only when **every** alias it carries resolves to **one** canonical row, its `lastModifiedTime` is at or before **that row's** `provider_last_modified_at`, and the row is not `call_log_state: "provisional"` (absent counts as not provisional). Two batched reads per window (aliases, then canonical rows following `merged_into_id`). `cursor.provider_modified_watermark` is diagnostic only; it advances only when every window of the run completed and is never read for skipping.
- **Stragglers.** Each run re-reads by id (first `call_log_ids` entry) up to 10 canonical provisional rows whose `started_at` is older than the settle horizon — no start-time window reaches them any more — and applies them, so a provisional row settles after it has left the window. Quarantined ids and ids this run already applied are skipped. Each read counts against the page budget.
- **Settle from store.** A provisional row whose stored `provider_last_modified_at` is past the horizon settles from its **stored projection** (`settleProvisionalFromStore`, observation kind `settle_stored` through `applyInteractionObservation`) when the provider cannot settle it: its by-id read returned 404 or failed deterministically, its record is quarantined, or it is still provisional 60 minutes past the horizon (the straggler re-read gets the first chance at final provider values). The result equals a stale record arriving past the horizon: the last observed values become final, `terminal` is set, direction and endpoints stay as stored, and the first settled revision drives downstream work once. Up to 50 per reconcile run, no provider traffic; a settled row's record leaves quarantine. Job recovery runs the same pass (no grace) when `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` is on and `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` is off, because then no reconcile exists to settle rows.
- Reconcile cursor and `known_complete_through` advance only when every page of the rolling window was fetched and every record projected **or quarantined**. `known_complete_through = min(windowTo − 15 min, oldest provisional start inside the horizon, ISync sync time − 15 min when Call Log Sync drives)` and never moves backwards. Because it never moves backwards, a provisional row that first appears with a start before the current value cannot lower it; instead `known_complete_through` is **not raised** while any older provisional row exists inside the horizon. Any interruption records a gap `{from, to, reason}` (`provider_throttled`, `provider_request_failed`, `page_limit`, `projection_failed`, `account_unresolved`, `account_mismatch`, `quarantine_overflow`); gaps close only when a later complete window covers them. Gaps are bounded at 50 by coalescing, never dropping. A 429 anywhere in a run ends the run's provider traffic. The shared client carries the provider's `Retry-After` (else `X-Rate-Limit-Window`) on the error, so `throttle_retry_after_observed` is true for a provider 429 and for a send the shared rate gate refused (see [RingCentral rate gate](#ringcentral-rate-gate)). The lease renews on a clock (`ttl/3`), not once per record.
- Provider account comes from party `accountId`, the event path, or the Call Log record `uri`; `RINGCENTRAL_ACCOUNT_ID` is the verified configured fallback. Disagreement fails the observation.

## Failure isolation (quarantine)

One record that keeps failing never holds the window. State lives on the `call_log_all_directions` row:

- `record_failures` (bounded 500, oldest dropped): `{call_log_id, failures, last_error_code}`, the consecutive failures before quarantine. A record counts at most once per run, even when a gap repair re-reads it.
- `quarantined_records` (bounded 200; the oldest is evicted into a `quarantine_overflow` gap over its start so it is re-read): `{call_log_id, telephony_session_id, start_time, error_code, error_name, failures, first_failed_at, last_failed_at, next_retry_at}`. `error_code` is `projection_failed`, `account_mismatch`, `retry_exhausted`, `persist_failed` (Mongo/Mongoose rejections such as `StrictModeError`), `provider_not_found` or `provider_request_failed`.

At `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_AFTER` (3) consecutive failures a record with a deterministic error (`projection_failed`, `account_mismatch`, `provider_not_found`) moves to quarantine with `next_retry_at = now + 60 min`; a transient error (`persist_failed`, `retry_exhausted`, `provider_request_failed`) gets twice as many attempts (6). A window whose only failures are quarantined records is complete. A quarantined record found in a window before its retry time is held, not attempted. Due entries are re-read by id (`GET /account/~/call-log/{id}?view=Detailed`), at most `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_RETRIES_PER_RUN` (5) per run; success anywhere removes the entry, failure doubles the delay up to 12 h. Every record failure logs `errorName` and the first 200 characters of the error message (schema paths and codes, no PII).

Escalation (structured log lines `sales_intelligence.call_log_reconcile.<kind>`; nothing is persisted or emailed since the Operational Events ledger was retired): `consecutive_failures ≥ 3` makes the `failed` event `error` level; a newly quarantined record raises `record_quarantined` (warn); a quarantine older than 2 h raises `quarantine_stale` (warn) each run. The Owner Coverage read (`call_log_capture`) shows `quarantined_count` and `oldest_quarantined_at`.

## RingCentral rate gate

Every server path authenticates as one JWT user, and RingCentral limits each app + user pair per API group, so all crons, queue consumers and jobs share one bucket per group. Production answered the Heavy group on 2026-09-25 with `429 CMN-301`, `X-Rate-Limit-Group: heavy`, `X-Rate-Limit-Limit: 10`, `X-Rate-Limit-Window: 60`, `Retry-After: 60`. Call Log list/by id, Call Log Sync, recording metadata/content, Active Calls (account or extension) and account presence are Heavy. Per-extension message list / message by id, message sync, extension presence and subscription renew are Light (Sales Outreach Desk rep SMS capture).

`ringcentral/rateLimitGate.ts` keeps one document per group in `ringcentral_rate_limit_gates` (`ringcentral:heavy`, `ringcentral:light`, `ringcentral:other`), decided by one atomic pipeline `findOneAndUpdate`:

- `open_until`: any provider 429 (from `ringCentralRequest` or `ringCentralReadResponse`; the scoped analysis read left with the 2026-10 slimming) sets it to `now + Retry-After` (else the window, 60 s) and never shortens it. While it is in the future nobody sends in that group.
- `grants`: Heavy send times inside a sliding 60 s window. High-priority callers (reconcile, sweep, Call Log Sync, qualified-call sync) may send while fewer than `RINGCENTRAL_HEAVY_REQUESTS_PER_MINUTE` (8) were sent and wait up to `RINGCENTRAL_RATE_GATE_MAX_WAIT_MS` (70 s) for a slot. Low-priority callers (`call_log_refresh`; the `media_fetch` and analysis readers were retired) may send only while fewer than `RINGCENTRAL_HEAVY_LOW_PRIORITY_PER_MINUTE` (4) were sent, and never wait.
- Light grants use the same sliding window with a fixed budget (RINGCENTRAL-CAPTURE §7): 40/min for high-priority callers (webhook-driven rep SMS syncs, which wait at most 10 s) and 10/min for low-priority callers (the 5-minute SMS safety poll, which never waits). A provider 429 whose `X-Rate-Limit-Group` is `light` closes the Light gate for its `Retry-After`.
- A refused send is never sent. `ringCentralRequest` throws a `RingCentralApiError` 429 with `throttle.gated = true` and `retryAfterMs` = the gate's wait; `ringCentralReadResponse` answers a local 429 with `Retry-After`. Callers treat it exactly like a provider throttle: a deferral that spends no attempt and dead-letters nothing.
- No Mongo connection (unit tests) or `RINGCENTRAL_RATE_GATE=off`: no-op. A gate read failure fails open.

`call_log_refresh` under throttle: the deferral is the gate/provider wait plus up to 5 min jitter; a job older than 45 min (`CALL_LOG_REFRESH_MAX_AGE_MS`) completes `expired` and a row the reconcile already settled completes `already_settled`, both without a provider read. With `SALES_INTELLIGENCE_CALL_LOG_SYNC=on` the refresh is narrowed to sessions ISync has not confirmed: due 5 min after hang-up, retried after 5 and 15 min, and a row already present in the Call Log (`call_log_state: provisional`) completes `already_confirmed` without a provider read. The job-recovery drain stops at the first throttle. Processes outside this database (a local script with the production JWT) share RingCentral's bucket but not the gate.

## Account Call Log Sync driver

`SALES_INTELLIGENCE_CALL_LOG_SYNC` = `off` (default) | `shadow` | `on`. Account Call Log Sync returns records **modified** since a durable `syncToken`, regardless of start time. The step runs inside the reconcile lease, before the window, and shares the page budget:

- No token, or a token whose `sync_time` is older than 24 h: `FSync` (`syncType=FSync&view=Detailed&recordCount=250&dateFrom=min(cursor.last_sync_to, now − settle horizon)`), then `ISync` with each returned token while a page comes back full.
- Otherwise `ISync` (`syncType=ISync&syncToken=…&view=Detailed`). A 400 or `CLG-*` error is token expiry: `FSync` in the same run, `consecutive_expiries + 1`, `sync_token_expired` (warn).
- Non-voice entries are ignored. A throttle or provider error changes nothing and applies nothing.
- `shadow`: counts records whose stored row would change (the per-row skip) and applies nothing; the token chain still advances. The window keeps the full settle horizon and stays authoritative.
- `on`: applies every record through the window's path (per-row skip, quarantine). The new token is stored only when every record applied or was quarantined. With a stored token the window narrows to the safety lookback (90) as a net; if the step failed, the window keeps the full settle horizon.

**Minute ISync lane** (`callLogIsyncLane.ts`, cron `/api/cron/sales-intelligence-call-log-isync`, `* * * * *`, under `SALES_INTELLIGENCE_CAPTURE_CALL_LOG`, only when the mode is `on`): while New York time is in [07:45, 20:30) it sends one `ISync` with the stored token every minute (Heavy, high lane, gate wait at most 10 s), follows pages only while full (budget 3), and applies records through `callLogApplier.ts`. It shares this state row, token chain, quarantine and lease with the reconcile: it never bootstraps a token (missing: `token_missing`, the reconcile FSyncs), skips when the lease is held, and yields on the reconcile's own minutes (UTC minute 3 mod 5) and outside staffed hours, where the reconcile's step carries ISync. The reconcile waits up to 20 s for a lease the lane holds. The lane writes `isync_lane: {last_run_at, last_success_at, last_error_code, last_records, last_applied}`. It never moves `known_complete_through` (the window owns it). After each applied batch both lanes call the Sales Outreach Desk wake (`salesOutreach/capture/contactChangeWake.ts`) for the changed rows; the seam is inert until the desk consumer exists.

State: `call_log_sync: {token, sync_time, last_full_sync_at, consecutive_expiries}`. The token never appears in logs, events or summaries. `last_run` carries `sync_mode`, `sync_type`, `sync_records`, `sync_changed`, `sync_applied`, `sync_token_stored`, `sync_error_code`.

## Nightly sweep

`/api/cron/sales-intelligence-call-log-sweep` at `40 7 * * *` UTC under `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` (`runCallLogSweepOnce`). It takes the reconcile lease (a held lease is a `lease_held` skip) and never writes the reconcile cursor, gaps or quarantine. Window `[now − SWEEP_LOOKBACK_HOURS (36), now − settle horizon]`, full paging (at least 40 pages), **no skip**: every record goes through `applyInteractionObservation`.

Records held in the reconcile's `quarantined_records` are skipped: neither measured nor applied, counted as `quarantined`. They are the reconcile's to retry, and one of them must not fail every sweep and stall the drift streak. Before applying, each other provider record is compared with its stored canonical row exactly as `scripts/dev_ops/diff-call-log-vs-interactions.ts` does: **missing** when no row matches its `telephony_session_id` or Call Log ids; **stale** when the provider `lastModifiedTime` is newer than `provider_last_modified_at`, or the result, duration or a recording id differs. Scope `call_log_sweep` records `last_run: {from, to, provider_records, stored_in_latest_version, applied_changes, missing_before, stale_before, provisional_after_horizon, quarantined, failures, …}` and `consecutive_drift_runs`. A complete sweep with `missing_before + stale_before > 0` raises `sweep_found_drift` (warn), a notification candidate on the second consecutive night; an interrupted sweep leaves the streak unchanged. The Owner Coverage read shows the last sweep's figures (`call_log_capture.last_sweep`).

## All Numbers call summary

`callSummary.ts` (all-numbers CONTRACT §2–§3). `contact_numbers.calls {inbound, outbound, missed}`, `last_call {interaction_id, at, direction, result, duration_seconds, rc_extension_id}`, `last_inbound_at`, `last_outbound_at` and `waiting_since` are **recomputed from the number's calls, never incrementally**, so late or out-of-order Call Log reconciles, merges and re-pointed calls land correctly.

- **Counted calls**: canonical (`merged_into_id: null`), unpurged, `Inbound`/`Outbound`, settled — `terminal` and not a provisional Call Log snapshot. A ringing call or a mid-call snapshot is ignored until it ends (index `call_interaction_number_started_id`).
- **Result**: `answered` when `provider_connected`; `voicemail` when `contact_type: voicemail` or the provider result matches /voicemail/i; else `missed`. Only an inbound call counts as missed (voicemail included); an unanswered outbound call keeps result `missed` but never counts and never opens a wait.
- **Waiting on us**: handled = any outbound call (connected or not) or an answered inbound call; `waiting_since` = the start of the **earliest** missed/voicemail inbound call after the **latest** handled call, else null. An outbound text does not clear it (v1).
- `last_call.rc_extension_id` is our side (the answering, else first, user party); reads resolve the Agent at the call time (`callRep.ts`).
- **Writers**: capture, for every number an observation touched (the number it is on, the one it left, merged losers' numbers), inside the observation's transaction; retention after purging a call; the v2 migration. The write sets the summary paths only, without a `revision` bump (the revision fences the Owner's lead-link command), and only when something changed.
- Capture's own number write (`observeOnNumber`) adds caller-ID names and a search term and widens `first_observed_at`/`last_activity_at`; it no longer bumps `revision` — concurrent writers of the row all run in transactions, where a write conflict aborts and retries.
- Retention's Number activity purge clears the v2 fields with the identity (`lead: null`, zero `calls`, no `last_call`, no wait).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` | off | Gates the reconcile and the nightly sweep |
| `SALES_INTELLIGENCE_CALL_LOG_ROLLING_LOOKBACK_MINUTES` | 720 (floor 720) | Cold-start reach and the outer bound on a repaired gap |
| `SALES_INTELLIGENCE_CALL_LOG_SAFETY_LOOKBACK_MINUTES` | 90 | How far the incremental (cursor) start may reach back; the window net when Call Log Sync drives |
| `SALES_INTELLIGENCE_CALL_LOG_OVERLAP_MINUTES` | 15 | Cursor overlap |
| `SALES_INTELLIGENCE_CALL_LOG_MAX_PAGES` | 20 | Provider requests per run (pages, by-id reads, sync requests) |
| `SALES_INTELLIGENCE_CALL_LOG_SETTLE_HORIZON_MINUTES` | 240 (floor 60) | Trailing re-read reach; must exceed the longest expected call |
| `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_AFTER` | 3 | Consecutive failures before quarantine |
| `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_RETRIES_PER_RUN` | 5 | By-id re-reads of due quarantined records per run |
| `SALES_INTELLIGENCE_CALL_LOG_SYNC` | `off` | `off`, `shadow` or `on` account Call Log Sync driver |
| `SALES_INTELLIGENCE_CALL_LOG_SWEEP_LOOKBACK_HOURS` | 36 | Nightly sweep reach |
| `RINGCENTRAL_ACCOUNT_ID` | unset | Optional configured account |

The reconcile cron runs `3-59/5`; the sweep `40 7 * * *`. All provider calls are `GET`. Cron/queue registration, the webhook fan-out that calls `observeRingCentralWebhookEvents` from a durable job, and the all-direction subscription lifecycle are wired by CSI-03: see [sales-intelligence-webhook-fanout.md](sales-intelligence-webhook-fanout.md).

`PersistDependencies.settleHorizonMinutes` passes the same horizon to `fromCallLogRecord`, so the provisional gate and the re-read window agree. Index `call_interaction_call_log_state_started` `{call_log_state: 1, started_at: 1}` finds provisional rows oldest first.

## Tests

- `src/services/numberActivity/*.test.ts` — pure projection, phone, account, coverage math, import boundary; `callLogCompleteness.test.ts` covers the quarantine lifecycle and bounds, the Call Log Sync token chain, expiry fallback and token-storage rule with a fake fetcher, configuration, and the Owner Coverage figures.
- `src/services/numberActivity/callLogState.test.ts` — the CC-04 gate against the snapshot and settled fixture corpus, the horizon override, the provisional projection semantics, a terminal row that a snapshot never makes provisional, and `settleStoredProjection`.
- `pnpm test:numbers:replica` (`ops/numbers-v2/all-numbers.replica.test.ts`, csi01) drives Call Log records through `applyInteractionObservation` and proves the call summary (missed, voicemail, answered clears the wait, unanswered outbound never missed) and the `lead_link` nomination, beside the migration, reads, Owner commands, Accounts and the cleanup. `numberActivity/allNumbers.test.ts` pins the summary rules.

## S5c-RECOVERY: `capture_recovery` provenance (2026-09-24)

`call_interactions.capture_recovery: { run_id, at, kind: "added" | "completed" }`, absent or null for a normally captured call. It records that a call was added or completed by a past Call Log repair.

- **Writers.** The repair tool (`ops/lib/call-log-repair.ts`) was deleted in the 2026-10 slimming. `ops/stamp-capture-recovery.ts --manifest <call-log-repair manifest>` (with `ops/lib/call-log-repair-recovery.ts`) still stamps the calls of a past repair. The write is provenance only: one `$set` on a row without one, with `timestamps: false`; it never bumps `projection_revision` or `updatedAt`, touches no summary and creates no job. Re-running is a no-op.
- **Readers.** None in `src/` since the 2026-10 slimming: the timeline v2 `observed_reason` and Case File readers were retired with Outreach. The field stays on the model as stored provenance.
