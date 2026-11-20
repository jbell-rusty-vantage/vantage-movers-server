---
type: Service
title: Number Activity capture (all-direction Call Interaction projection)
description: CSI-02 projection of RingCentral webhook parties and Detailed Call Log records into canonical, account-scoped Call Interactions with honest coverage, and the All Numbers call summary of every touched Contact Number. Its only downstream job is the number's lead-link recompute when a settled call joins it.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2026-12-19
resource: src/services/numberActivity/
applies_to:
  - src/services/numberActivity/
  - src/services/ringcentral/webhook-capture.ts
  - src/models/CallInteraction.ts
  - src/models/ContactNumber.ts
  - src/models/salesIntelligence/capture.ts
owners: [team:main-server]
sources:
  - id: release-2026-11-19
    resource: docs/operations/OUTREACH-NUMBERS-RELEASE-2026-11-19.md
    title: Sales Outreach and RingCentral Capture and Numbers release (2026-11-19)
  - id: jobs-release-2026-11-19
    resource: docs/operations/SALES-INTELLIGENCE-JOBS-RELEASE-2026-11-19.md
    title: Sales Intelligence jobs release (2026-11-19)
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
    title: Removed from main 2026-10-29 (fc8166bf); read it from git history
  - id: models
    resource: docs/call-sales-intelligence/02-domain-models.md
    title: Removed from main 2026-10-29 (fc8166bf); read it from git history
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-02/HANDOFF.md
    title: Removed from main 2026-10-29 (fc8166bf); read it from git history
  - id: review
    resource: docs/call-sales-intelligence/workspace/evidence/csi-02/INDEPENDENT-REVIEW.md
    title: Removed from main 2026-10-29 (fc8166bf); read it from git history
  - id: call-log-completeness
    resource: ../CALL-LOG-CAPTURE-COMPLETENESS-SPECIFICATION.md
    title: Workspace-root specification; not present in the current workspace checkout
---

# Number Activity capture

**2026-10 All Numbers phase B.** The Contact Number rollups, the attachment refresh job and the rollup rebuild are gone: after a contribution changes, capture recomputes each touched number's [call summary](#all-numbers-call-summary) from its calls in the observation's transaction and nominates a `lead_link` job ([number-activity-reads.md](number-activity-reads.md#lead-link-leadlinkts)).

**2026-10 server/admin slimming.** Capture is retained. It no longer nominates `outreach_ensure` or `recording_discovery` work, the ContactNumber rollups lost their Outreach and analysis counters, and the old capture-recovery repair tooling was removed (slimming specification §7.3–7.4, removed from main on 2026-10-29; the Admin keeps a pointer in `vantage-admin/docs/server-admin-slimming/README.md`). Provider recording metadata stays on `call_interactions.recordings[]`; the server never downloads audio.

**Role:** turns every RingCentral telephony observation — inbound, outbound, missed, unanswered, transferred, internal, withheld — into one canonical [Call Interaction](../../../../CONTEXT.md) per provider session, keyed by provider account plus session/Call Log aliases. It feeds Number Activity; it never widens [Call Qualification](../../../../CONTEXT.md), never imports `ingestRingCentralQualifiedCall`, and never writes Leads.

**System of record:** `call_interactions`, `call_interaction_aliases`, `contact_numbers`, `sales_intelligence_sync_state` (scopes `call_log_all_directions` and `call_log_sweep`) and `sales_intelligence_jobs`. Capture reads `ringcentral_webhook_events` receipts through the [fan-out job](sales-intelligence-webhook-fanout.md). [Storage, indexes and read paths](#storage-indexes-and-read-paths) lists every index and the queries that use it.

**Disk trim (2026-10-07).** Capture writes no `sales_intelligence_audit_events` row. The per-observation `interaction.created|updated|merged` rows and the `capture_projection.completed` / `call_log_refresh.completed` completion rows were worker exhaust (about 10 MB a day) that no screen read; the stored backlog was deleted by `ops/disk-trim/trim.ts`. The call row, its aliases, `projection_revision` and the bounded `result` on the job row are the evidence. Owner and desk commands still write audit rows, and those now expire after 90 days (`csi_audit_happened_ttl` on `happened_at`).

## Modules

| Module | Responsibility |
| --- | --- |
| `interactionProjection.ts` | Pure. `fromWebhookParties`, `fromCallLogRecord`, `mergeProjections`, `sameProjection`, identity/alias helpers, `classifyCallLogRecordState` / `provisionalCallLogRule` (CC-04). No I/O. |
| `persistInteraction.ts` | One Mongo transaction per observation: alias reservation, insert or revision-CAS update, merge-with-proof tombstones, the Contact Number observation (caller-ID names, search-term addition, activity window), the call summary when the counted contribution changes (`callSummary.ts`), the `lead_link` job intent. No audit row (disk trim). Bounded retry on duplicate key / revision conflict / transient transaction error. |
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
- Each party is fenced by its own `last_webhook_sequence`. `terminal` and `provider_connected` never regress (a provisional Call Log record leaves `terminal` as it was; it never sets it). A Call Log record with an older `lastModifiedTime` adds ids/legs/recordings only and never overwrites stored leg-level result/duration. Once a Call Log record has been applied, its result/duration/ended_at outrank later webhook events. On a settled row, a delayed party webhook may add party evidence while the stored Call Log direction and endpoints continue to identify the customer. Each subsequent Call Log batch checks provider evidence against the resolved account, including by-ID recovery. `legs_overflow_count` is a monotone lower bound.
- Identical semantic input is a no-op: no write, revision or job. `call_log_state` is part of the projection, so a change of state alone is a revision.
- A row that retention purged (`purged_at` set) keeps its identifiers and aliases. A late provider replay that resolves to it returns a no-op and never restores content.
- Aliases are account-scoped. The same `telephony_session_id` or Call Log id in two provider accounts resolves to two separate interactions (replica proof, `ops/numbers-v2/all-numbers.replica.test.ts`, `fdc799dc`).
- **A Call Log record is observed, not final** (CC-04). RingCentral lists a queue call as soon as its unanswered ring-out legs end, then rewrites the same record id when the call ends. `classifyCallLogRecordState(record, directory, { now, settleHorizonMinutes })` is pure and returns `provisional` when either rule holds:
  - **P-a**: the top-level `result` is `Stopped`, `IP Phone Offline` or `In Progress`.
  - **P-b**: RingCentral's `direction` is `Inbound`/`Outbound` (a live snapshot says `Outbound`: it copies the ring-out leg), the top-level `to` classifies as company side, every leg is a company ring-out (a `PstnToSip`/`SipToSip` leg that is not `Inbound`, with an `extension.id` or a company-side `to`; so no `Accept` or customer leg), **and** the call carries PSTN evidence (a `PstnToSip` leg, or a top-level number that is not a company DID). The top-level `from` may be the rep's extension (the 24 stored snapshots: both sides company, stored `Internal`) or the PSTN caller id (live watch 2026-09-24). The PSTN condition keeps a genuine extension-to-extension call settled.

  Otherwise `settled`. Any record with `now − lastModifiedTime ≥ settleHorizonMinutes` (default 240; start time when `lastModifiedTime` is absent) is `settled`. An `Inbound`/`Accepted` record with a short `Accept` leg is **deliberately settled**: its `lastModifiedTime` does not move while the call continues, so it cannot be told from a genuine short answered queue call; the re-read corrects duration and adds recordings. The rules gate downstream work only; the reconcile re-reads every record inside the horizon regardless. Pinned by `callLogState.test.ts` (24 stored-shape and 2 live-shape snapshot fixtures provisional; 3 `Accepted` snapshots and 37 settled fixtures of every result family settled).
- `call_interactions.call_log_state`: `null` (never seen in the Call Log: webhook-only or stored before CC-04), `provisional`, `settled`. A provisional record does not set `terminal`, `ended_at` or `duration_seconds` from the snapshot, gets **no Contact Number**, and schedules **no** downstream job. `settled` never regresses: a stale record keeps the stored state (a provisional row quiet past the horizon still settles), and a settled row stays settled. Webhook projection never sets the field; only a settled Call Log record, or the settle from store below, settles a row.
- **A terminal row never moves to provisional.** When a row is already `terminal` (a webhook `Disconnected`, or any earlier final observation) and is not provisional, a Call Log record that classifies as a snapshot is applied like a stale record: it adds ids, legs and recordings only. It does not change `call_log_state`, direction, endpoints, result, duration or `provider_last_modified_at`, so the Contact Number, its summary and downstream work already created are never withdrawn and re-run. This covers the provider's rewrite lag after webhook capture has ended a session, and a newer snapshot-looking record on a settled row.
- The **one allowed regression**: a later Call Log version of a provisional row may change `direction` (`Internal` or the snapshot's `Outbound` to the final `Inbound`/`Outbound`) and `started_at` and set `external_e164`, `external_endpoint_kind` and the Contact Number. It is refused on a `settled` Internal row (a row stored before CC-04, `null`, may still change, so historical repair can fix frozen snapshots). The Contact Number appears on the settle transition and the call is counted once (the summary is recomputed from the calls). The first settled revision of a provisional row (`newly_settled`) counts as the call joining its number, so it nominates the number's `lead_link` job. It nominates no other stage.
- `contact_numbers.search_terms` has one cap and one owner (`numberActivity/searchTerms.ts`, `MAX_SEARCH_TERMS = 50`). The All Numbers lead-link recompute owns the set and replaces it wholesale (caller-ID names, then the Leads' names, Job Numbers and reps); capture (`observeOnNumber`) may only *add* an observed caller-ID name and never truncates, reorders or evicts a term it did not write — at the cap it declines the addition, and the name still reaches the set through `provider_names` on the next recompute (CSI-14 §6).
- `contact_type` here is `unknown` or provider-declared `voicemail`; human conversation is never inferred from connection or duration. Transcript/Owner values are preserved.
- `Internal` requires company-side evidence on **both** endpoints (directory extension/DID, or a provider-supplied extension id/number). An unknown short dial string is `malformed`, not a fabricated extension. A party event with no `direction` projects `Unknown` until later evidence; the party's own extension is never injected into an endpoint merely assumed to be the company side.
- Internal, withheld, malformed and service-code endpoints keep raw provider evidence on the interaction (`external_endpoint_kind`, party `phone_number_raw`) and never create a Contact Number or downstream job.
- Provenance lives on the rows themselves: alias rows keep the `proof_ref` that originally proved them, a merged row's tombstone carries `merged_into_id`, and callers still pass their durable job/run id as `request_id` (accepted, not persisted, since the disk trim removed the per-observation audit row). Tombstones keep `contact_number_id`; recounts must filter `merged_into_id: null`.
- Downstream intent (`scheduleDownstream` in `persistInteraction.ts`): only `csi:lead-link:lead-link-v1:number:<id>:call:<interaction id>`, when a settled call joined the number (a new number, a new call, a call re-pointed or merged onto it) and `SALES_INTELLIGENCE_ENABLED` is on. Capture nominates no other stage. A provisional row enqueues nothing; its first settled revision counts as joining. The retired `attachment_refresh`, `outreach_ensure` and `recording_discovery` stages are terminalized as `retired` by job recovery.
- A Call Log record is **observed, not final**. RingCentral lists a queue call while its ring-out legs are still ending and rewrites the same record when the call ends; `/call-log` filters on **start** time. Every run therefore re-reads a trailing settle horizon, and nothing assumes a record read once is its final version.
- The reconcile window is `from = min(incremental_from, now − settle horizon)`, where `incremental_from = max(cursor.last_sync_to − overlap, now − safety)` is a **watermark**. A first run with no cursor uses the full cold-start lookback. When the safety clamp bites, the range `incremental_from` did not reach is opened as a `watermark_clamp` gap and repaired oldest-first with the leftover page budget; the horizon does not change that rule.
- **Per-row skip.** A record is counted as a no-op without opening a transaction only when **every** alias it carries resolves to **one** canonical row, its `lastModifiedTime` is at or before **that row's** `provider_last_modified_at`, and the row is not `call_log_state: "provisional"` (absent counts as not provisional). Two batched reads per window (aliases, then canonical rows following `merged_into_id`). `cursor.provider_modified_watermark` is diagnostic only; it advances only when every window of the run completed and is never read for skipping.
- **Stragglers.** Each run re-reads by id (first `call_log_ids` entry) up to 10 canonical provisional rows whose `started_at` is older than the settle horizon — no start-time window reaches them any more — and applies them, so a provisional row settles after it has left the window. Quarantined ids and ids this run already applied are skipped. Each read counts against the page budget.
- **Settle from store.** A provisional row whose stored `provider_last_modified_at` is past the horizon settles from its **stored projection** (`settleProvisionalFromStore`, observation kind `settle_stored` through `applyInteractionObservation`) when the provider cannot settle it: its by-id read returned 404 or failed deterministically, its record is quarantined, or it is still provisional 60 minutes past the horizon (the straggler re-read gets the first chance at final provider values). The result equals a stale record arriving past the horizon: the last observed values become final, `terminal` is set, direction and endpoints stay as stored, and the first settled revision drives downstream work once. Up to 50 per reconcile run, no provider traffic; a settled row's record leaves quarantine. Job recovery runs the same pass (no grace) when `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` is on and `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` is off, because then no reconcile exists to settle rows.
- Reconcile cursor and `known_complete_through` advance only when every page of the rolling window was fetched and every record projected **or quarantined**. `known_complete_through = min(windowTo − 15 min, oldest provisional start inside the horizon, ISync sync time − 15 min when Call Log Sync drives)` and never moves backwards. Because it never moves backwards, a provisional row that first appears with a start before the current value cannot lower it; instead `known_complete_through` is **not raised** while any older provisional row exists inside the horizon. Beside it the reconcile writes `observed_complete_through` (outreach lifecycle repair A3, decision D-A3) = the same value without the provisional-row cap (the 15-minute lag and the ISync cap stay); it is seeded from `known_complete_through`, never moves backwards, never sits below it, and does not move on an incomplete rolling window. The Sales Outreach Desk counts today's calls against it and keeps the capped value for cadence verdicts (`salesOutreach/evidence/coverage.ts`). When the run's own Call Log Sync step stores a token in mode `on`, the reconcile also stamps `reconcile_sync_success_at` (sticky). Any interruption records a gap `{from, to, reason}` (`provider_throttled`, `provider_request_failed`, `page_limit`, `projection_failed`, `account_unresolved`, `account_mismatch`, `quarantine_overflow`); gaps close only when a later complete window covers them. Gaps are bounded at 50 by coalescing, never dropping. A 429 anywhere in a run ends the run's provider traffic. The shared client carries the provider's `Retry-After` (else `X-Rate-Limit-Window`) on the error, so `throttle_retry_after_observed` is true for a provider 429 and for a send the shared rate gate refused (see [RingCentral rate gate](#ringcentral-rate-gate)). The lease renews on a clock (`ttl/3`), not once per record.
- Provider account comes from party `accountId`, the event path, or the Call Log record `uri`; `RINGCENTRAL_ACCOUNT_ID` is the verified configured fallback. Disagreement fails the observation.

## Failure isolation (quarantine)

One record that keeps failing never holds the window. State lives on the `call_log_all_directions` row:

- `record_failures` (bounded 500, oldest dropped): `{call_log_id, failures, last_error_code}`, the consecutive failures before quarantine. A record counts at most once per run, even when a gap repair re-reads it.
- `quarantined_records` (bounded 200; the oldest is evicted into a `quarantine_overflow` gap over its start so it is re-read): `{call_log_id, telephony_session_id, start_time, error_code, error_name, failures, first_failed_at, last_failed_at, next_retry_at}`. `error_code` is `projection_failed`, `account_mismatch`, `retry_exhausted`, `persist_failed` (Mongo/Mongoose rejections such as `StrictModeError`), `provider_not_found` or `provider_request_failed`.

At `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_AFTER` (3) consecutive failures a record with a deterministic error (`projection_failed`, `account_mismatch`, `provider_not_found`) moves to quarantine with `next_retry_at = now + 60 min`; a transient error (`persist_failed`, `retry_exhausted`, `provider_request_failed`) gets twice as many attempts (6). A window whose only failures are quarantined records is complete. A quarantined record found in a window before its retry time is held, not attempted. Due entries are re-read by id (`GET /account/~/call-log/{id}?view=Detailed`), at most `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_RETRIES_PER_RUN` (5) per run; success anywhere removes the entry, failure doubles the delay up to 12 h. Every record failure logs `errorName` and the first 200 characters of the error message (schema paths and codes, no PII).

Escalation (structured log lines `sales_intelligence.call_log_reconcile.<kind>`; nothing is persisted or emailed since the Operational Events ledger was retired): `consecutive_failures ≥ 3` makes the `failed` event `error` level; a newly quarantined record raises `record_quarantined` (warn); a quarantine older than 2 h raises `quarantine_stale` (warn) each run. The Owner Coverage read (`call_log_capture`) shows `quarantined_count` and `oldest_quarantined_at`.

## RingCentral rate gate

Every server path authenticates as one JWT user, and RingCentral limits each app + user pair per API group, so all crons, queue consumers and jobs share one bucket per group. Production answered the Heavy group on 2026-09-25 with `429 CMN-301`, `X-Rate-Limit-Group: heavy`, `X-Rate-Limit-Limit: 10`, `X-Rate-Limit-Window: 60`, `Retry-After: 60`. Call Log list/by id, Call Log Sync, recording metadata/content, Active Calls (account or extension) and account presence are Heavy. No server path calls the recording endpoints since the unused recording adapter (`ringcentral/recordings.ts`) was retired on 2026-11-18 (`afa626bc`); the gate still classifies those paths. Per-extension message list / message by id, message sync, extension presence and subscription renew are Light (Sales Outreach Desk rep SMS capture).

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

**Minute ISync lane** (`callLogIsyncLane.ts`, cron `/api/cron/sales-intelligence-call-log-isync`, `* * * * *`, under `SALES_INTELLIGENCE_CAPTURE_CALL_LOG`, only when the mode is `on`): while New York time is in [07:45, 20:30) it sends one `ISync` with the stored token every minute (Heavy, high lane, gate wait at most 10 s), follows pages only while full (budget 3), and applies records through `callLogApplier.ts`. It shares this state row, token chain, quarantine and lease with the reconcile: it never bootstraps a token (missing: `token_missing`, the reconcile FSyncs), skips when the lease is held, and yields on the reconcile's own minutes (UTC minute 3 mod 5) and outside staffed hours, where the reconcile's step carries ISync. The reconcile waits up to 20 s for a lease the lane holds. The lane writes `isync_lane.{last_run_at, last_success_at, last_error_code, last_records, last_applied}` field by field (`isyncLaneSetOf`), so `last_success_at` is sticky: a run that stores no token leaves the previous success in place (A3). It never moves `known_complete_through` (the window owns it). After each applied batch both lanes call the Sales Outreach Desk wake (`salesOutreach/capture/contactChangeWake.ts`) for the changed rows (`wakeOutreachForTouchedCalls`). It enqueues one deduplicated `outreach_contact_change` job per call revision only while the persisted desk configuration is active with `desk_enabled` or `goal_metrics_enabled` on; the desk's contact sweep is the net for a lost wake.

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
- **Writers**: capture inside the observation transaction; retention after purging a call; the v2 migration. Capture skips the recount (W7, `477703d3`) only when all of these hold: the call was already on the same Number, this observation did not create the Number, the stored summary is initialized (`hasInitializedCallSummary`: `summary_version` 1 and well-formed `calls`, dates and `last_call`), no row merged, and `sameCallSummaryContribution` finds the call's contribution unchanged (Number, direction, start, result, duration, our extension, counted or not). A new recording or fresher provider evidence on the same call then costs no Number summary read and no counted-call query. Creation, a move, a merge, a purge, settlement and a corrected counted field still recount every touched Number. An identical replay exits earlier, before any Number work. The write sets the summary paths only, without a `revision` bump (the revision fences the Owner's lead-link command), and only when something changed.
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

## Storage, indexes and read paths

Index declarations are the source of truth. The CSI collections declare theirs in `src/models/salesIntelligence/registry.ts` (`CSI_MODEL_REGISTRY`) with `autoIndex` off. Every CSI write first checks that the collection's unique fences exist (`defineCsiModel`, `INDEX_REQUIRED`). The receipt collection builds its own indexes on first use (`ensureRingCentralWebhookEventIndexes`).

### Collections and indexes

**`ringcentral_webhook_events`** (`ringcentral/webhook-capture.ts`, unnamed indexes get the driver's default name):

| Name | Keys and options | Used by |
| --- | --- | --- |
| `provider_1_receivedAt_-1` | `{provider: 1, receivedAt: -1}` | Owner Coverage latest receipt and one-hour count; subscription health `{provider, receivedAt > since, subscriptionId}` |
| `uuid_1` | `{uuid: 1}`, unique, sparse | Duplicate delivery fence on insert; duplicate lookup `findOne({uuid})` |
| `telephonySessionId_1` | `{telephonySessionId: 1}` | No `src/` reader (observation) |
| `sessionId_1` | `{sessionId: 1}` | No `src/` reader (observation) |
| `provider_1_receivedAt_1__id_1` | `{provider: 1, receivedAt: 1, _id: 1}`, partial `{telephonySessionId: {$type: "string"}}` | Watermark recovery keyset scan (`listWebhookReceiptsBetween`); Desk newest telephony receipt (`readLastCallWebhookAt`, newest first, limit 1) |
| `ringcentral_webhook_event_received_ttl` | `{receivedAt: 1}`, `expireAfterSeconds` 604,800 (7 days) | TTL; the bounded dev monitor (`find({})` newest first, limit 1–100) |

The capture job loads its receipt by `_id`. A stored receipt keeps `provider`, `receivedAt`, `validationTokenPresent`, sanitized `headers`, `rawBody` and the indexed identities `uuid`, `subscriptionId`, `event`, `timestamp`, `ownerId`, `telephonySessionId`, `sessionId`, `sequence`. It stores no `normalizedPreview` and no credential header (`WEBHOOK_CREDENTIAL_HEADERS`: `authorization`, `cookie`, `x-api-secret`, `verification-token`, `validation-token`, `x-vercel-oidc-token`, `x-vercel-proxy-signature`) since `477703d3` and `ed8db9b5`. The route verifies the delivery against the request before it stores. The monitor (`GET /api/dev/ringcentral/webhook-events`) rebuilds the preview from `rawBody` on read.

**`call_interactions`** (`CALL_INTERACTION_INDEXES`):

| Name | Keys and options | Used by |
| --- | --- | --- |
| `call_interaction_session_unique` | `{provider: 1, provider_account_id: 1, telephony_session_id: 1}`, unique, partial `{telephony_session_id: {$type: "string"}}` | Identity fence; nightly sweep `$or` arm `telephony_session_id: {$in}`; `numbersForLead` (without the account, see observations) |
| `call_interaction_session_id` | `{provider: 1, provider_account_id: 1, session_id: 1}`, sparse | No `src/` filter on `session_id` (identity lookup goes through aliases; observation) |
| `call_interaction_call_log_ids` | `{provider: 1, provider_account_id: 1, call_log_ids: 1}` | Nightly sweep `$or` arm `call_log_ids: {$in}` |
| `call_interaction_number_started_id` | `{contact_number_id: 1, started_at: -1, _id: -1}` | Summary recount (`summaryCallFilter`, every counted call of the number); Number detail (newest 101 calls); lead-link session page (newest 200) |
| `call_interaction_started_window` | `{started_at: -1, _id: -1}` | Retention scan `{started_at <= cutoff, purged_at: null}` oldest first |
| `call_interaction_extension_started` | `{"parties.extension_id": 1, started_at: -1}` | No `src/` filter on `parties.extension_id` (observation) |
| `call_interaction_recording` | `{"recordings.provider_recording_id": 1}`, sparse | No `src/` filter since recording discovery was retired (observation) |
| `call_interaction_provider_modified` | `{provider_last_modified_at: -1}` | Candidate for the settle-from-store scan (sorted by `provider_last_modified_at`) |
| `call_interaction_updated` | `{updatedAt: -1, _id: -1}` | Sales Outreach contact sweep `(updatedAt, _id)` cursor |
| `call_interaction_call_log_state_started` | `{call_log_state: 1, started_at: 1}` | Provisional stragglers and the `known_complete_through` cap; settle from store (`call_log_state: "provisional"`) |

**`call_interaction_aliases`**: `csi_alias_unique` `{provider: 1, provider_account_id: 1, kind: 1, value: 1}` unique; `csi_alias_interaction` `{interaction_id: 1}` (merge re-point `updateMany({interaction_id})`).

**`contact_numbers`**: the seven `CONTACT_NUMBER_INDEXES` and their read paths are in [number-activity-reads.md](number-activity-reads.md#storage-indexes-and-read-paths). Capture uses `contact_number_e164_unique` (`findOne({e164})` before create) and writes by `_id`.

**`sales_intelligence_sync_state`**: `sales_intelligence_sync_state_scope_unique` `{scope: 1}`. Capture scopes: `call_log_all_directions` (reconcile and ISync lane), `call_log_sweep`, `webhook_receipts`, the retention lease, `lead_link_entity_changes`. Rep SMS reads scopes by prefix regex.

**`ringcentral_directory_snapshots`**: `csi_directory_digest_unique` `{provider_account_id: 1, digest: 1}` unique; `csi_directory_taken` `{taken_at: -1}`. Append-only.

**`ringcentral_rate_limit_gates`**: one document per group, addressed by `_id` (`ringcentral:heavy|light|other`). No secondary index.

### Main query shapes

- **Receipt insert and dedupe.** `insertOne`; a duplicate `uuid` (E11000) is answered with the stored `_id` from `findOne({uuid})`.
- **Watermark scan.** `{provider, receivedAt in [from, to], telephonySessionId: {$type: "string"}}` plus a strict `(receivedAt, _id)` keyset, sorted `{receivedAt: 1, _id: 1}`, batch 200, at most 10 pages. It projects `_id`, `receivedAt`, `uuid` only.
- **Interaction upsert** (`persistInteraction.ts`, one transaction): alias `find({provider, provider_account_id, $or: [{kind, value}…]})`; canonical rows by `_id: {$in}` following `merged_into_id`; Number `findOne({e164})`; interaction `updateOne({_id, projection_revision})` CAS with `$inc`, or `create`; merge tombstone CAS and alias re-point; `insertMany` for new aliases; the summary recount when W7 does not skip it; `enqueueCsiJob` for `lead_link`.
- **Per-row skip** (`callLogApplier.ts`): one batched alias read per window, then canonical rows by `_id: {$in}` (at most four `merged_into_id` hops), projecting `provider_last_modified_at`, `call_log_state`, `merged_into_id`.
- **Summary recount.** Number `findById` (summary fields), then `find(summaryCallFilter)` with no limit, then `updateOne({_id}, {$set})` only on change.
- **Nightly sweep.** `{provider, provider_account_id, $or: [{telephony_session_id: {$in}}, {call_log_ids: {$in}}]}` in chunks of 500.
- **Settle from store.** `{call_log_state: "provisional", merged_into_id: null, provider_last_modified_at < horizon, $or: [...]}` sorted by `provider_last_modified_at`, limit 50.

### Retention and what stays in MongoDB

- Receipts: TTL 7 days on `receivedAt`. `rawBody` serves the capture job, the 12-hour watermark replay and debugging inside that window. A preview is reproducible from `rawBody`, so it is not stored.
- `call_interactions` and `call_interaction_aliases`: kept until retention. Retention (`salesIntelligence/retention.ts`) purges calls older than the active Owner policy's `retention.audit_days` (730 days on 2026-11-19, cutoff `2024-11-19T23:51:22Z`, zero eligible rows). A purged call keeps its provider identifiers and aliases so replay cannot resurrect it; parties, legs, recordings, `external_e164` and `provider_names` are cleared. Aliases are never deleted.
- `contact_numbers`: a Number idle past the same cutoff becomes a `purged:<id>` tombstone with an empty summary and no Lead.
- Sync state, directory snapshots and rate gates are small operational rows.
- `sales_intelligence_jobs` is shared; its retention is in [sales-intelligence-foundation.md](sales-intelligence-foundation.md).

### Measured baseline

Window 2026-11-18T23:07Z to 2026-11-19T23:59Z, primary `01` ([stock before cleanup](../../operations/evidence/outreach-numbers-stock-before.json)). Bytes are logical BSON, WiredTiger allocated data and total index size. Reads and writes are server operation counters over the window.

| Collection | Documents | Logical | Allocated | Indexes | Reads | Writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ringcentral_webhook_events` | 34,775 | 159,607,634 | 62,193,664 | 6,213,632 | 11,921 | 5,583 |
| `call_interactions` | 37,494 | 117,001,327 | 23,195,648 | 11,481,088 | 24,722 | 6,527 |
| `call_interaction_aliases` | 112,492 | 29,246,842 | 7,892,992 | 5,885,952 | 8,362 | 1,214 |
| `contact_numbers` | 11,231 | 8,946,205 | 3,928,064 | 4,292,608 | 35,783 | 2,073 |

The four together held 119.27 MiB allocated data plus indexes. After the 2026-11-19 preview and header cleanup the receipts held 91,574,867 logical bytes ([stock after](../../operations/evidence/outreach-numbers-stock-after.json), 2026-11-20T00:13Z). On 2026-11-18 (New York day) capture took in 5,162 receipts (22.62 MiB), 582 interactions, 1,746 aliases and 99 Numbers, and ran 4,916 `capture_projection` jobs (p50/p95 185/428 ms), 580 `call_log_refresh` jobs (309/488 ms) and 732 `lead_link` jobs (26.654/56.269 s) ([observations](../../operations/evidence/outreach-numbers-observations.json), [release record](../../operations/OUTREACH-NUMBERS-RELEASE-2026-11-19.md#ringcentral-capture-and-numbers)). Per-index sizes and per-query counts are unmeasured.

### Observations for the index and read phase

- Declared indexes with no `src/` query: receipts `telephonySessionId_1` and `sessionId_1`; `call_interaction_session_id`, `call_interaction_extension_started`, `call_interaction_recording`. Check `ops/` scripts and `$indexStats` before dropping any.
- The summary recount reads every counted call of a number with no limit. W7 removes the unchanged case; a busy number still pays a full read on each counted change.
- `numbersForLead` looks up a Call Lead's session without `provider_account_id`, so `call_interaction_session_unique` is walked across all accounts. Production has one account (2026-11-19).
- Settle from store filters `call_log_state` and sorts by `provider_last_modified_at`; no compound index has both. The provisional set is small, so this is cheap today.
- Retention scans `started_at` oldest first with `purged_at: null` as a residual filter. Purged tombstones stay in that range, so the scan cost grows once purges begin.

## Tests

- `src/services/numberActivity/*.test.ts` — pure projection, phone, account, coverage math, import boundary; `callLogCompleteness.test.ts` covers the quarantine lifecycle and bounds, the Call Log Sync token chain, expiry fallback and token-storage rule with a fake fetcher, configuration, and the Owner Coverage figures.
- `src/services/numberActivity/callLogState.test.ts` — the CC-04 gate against the snapshot and settled fixture corpus, the horizon override, the provisional projection semantics, a terminal row that a snapshot never makes provisional, and `settleStoredProjection`.
- `pnpm test:numbers:replica` (`ops/numbers-v2/all-numbers.replica.test.ts`, csi01) drives Call Log records through `applyInteractionObservation` and proves the call summary (missed, voicemail, answered clears the wait, unanswered outbound never missed) and the `lead_link` nomination, beside the migration, reads, Owner commands, Accounts and the cleanup. `numberActivity/allNumbers.test.ts` pins the summary rules.

## S5c-RECOVERY: `capture_recovery` provenance (2026-09-24)

`call_interactions.capture_recovery: { run_id, at, kind: "added" | "completed" }`, absent or null for a normally captured call. It records that a call was added or completed by a past Call Log repair.

- **Writers.** The repair tool (`ops/lib/call-log-repair.ts`) was deleted in the 2026-10 slimming. `ops/stamp-capture-recovery.ts --manifest <call-log-repair manifest>` (with `ops/lib/call-log-repair-recovery.ts`) still stamps the calls of a past repair. The write is provenance only: one `$set` on a row without one, with `timestamps: false`; it never bumps `projection_revision` or `updatedAt`, touches no summary and creates no job. Re-running is a no-op.
- **Readers.** None in `src/` since the 2026-10 slimming: the timeline v2 `observed_reason` and Case File readers were retired with Outreach. The field stays on the model as stored provenance.
