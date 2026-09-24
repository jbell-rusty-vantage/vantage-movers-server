---
type: Service
title: Number Activity capture (all-direction Call Interaction projection)
description: CSI-02 projection of RingCentral webhook parties and Detailed Call Log records into canonical, account-scoped Call Interactions with honest coverage and durable downstream job intent.
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
---

# Number Activity capture

**Role:** turns every RingCentral telephony observation — inbound, outbound, missed, unanswered, transferred, internal, withheld — into one canonical [Call Interaction](../../../../CONTEXT.md) per provider session, keyed by provider account plus session/Call Log aliases. It feeds Number Activity; it never widens [Call Qualification](../../../../CONTEXT.md), never imports `ingestRingCentralQualifiedCall`, and never writes Leads.

**System of record:** `call_interactions`, `call_interaction_aliases`, `contact_numbers`, `sales_intelligence_sync_state` (scopes `call_log_all_directions` and `call_log_sweep`), CSI audit events and `sales_intelligence_jobs`. Indexes come from the CSI migration; writers fail closed without the unique fences.

## Modules

| Module | Responsibility |
| --- | --- |
| `interactionProjection.ts` | Pure. `fromWebhookParties`, `fromCallLogRecord`, `mergeProjections`, `sameProjection`, identity/alias helpers. No I/O. |
| `persistInteraction.ts` | One Mongo transaction per observation: alias reservation, insert or revision-CAS update, merge-with-proof tombstones, Contact Number rollups, `interaction` audit invalidation, `enqueueCsiJob` intent. Bounded retry on duplicate key / revision conflict. |
| `observeWebhookEvents.ts` | `normalizeWebhookPartyObservations(payload, receivedAt)` and `observeRingCentralWebhookEvents(observations, deps)`. Interface CSI-03 calls from its durable capture-projection job. |
| `reconcileCallLog.ts` | `runCallLogReconcileOnce(deps)`: fenced lease, Call Log Sync step, start-time window with settle horizon, per-row skip, oldest-first projection, quarantine retries, straggler settles, gaps, gap repair, cursor and `known_complete_through`. |
| `callLogQuarantine.ts` | Pure quarantine bookkeeping (`record_failures` → `quarantined_records`, backoff, bounds, error classification, bounded failure log fields). |
| `callLogSyncDriver.ts` | `runCallLogSyncStep`: account Call Log Sync (`FSync` bootstrap, `ISync` chain, expiry fallback, token-storage rule, shadow counting). |
| `callLogSweep.ts` | `runCallLogSweepOnce`: nightly authoritative re-read with before/after completeness figures on scope `call_log_sweep`. |
| `callLogClient.ts` | Detailed Call Log page fetch without a direction filter, one record by id, and account Call Log Sync, over the shared RingCentral client/token store. GET only. |
| `phone.ts`, `directory.ts`, `accountIdentity.ts` | Endpoint classification (`external`, `company_did`, `extension`, `service_code`, `withheld`, `malformed`), read-only directory lookup, provider account resolution that never fabricates. |
| `fixtures.ts` | Synthetic deliveries and records for CSI-03/04/C tests. |

## Invariants

- Identity is `(provider, provider_account_id, alias)`; aliases are `telephony_session_id` → `session_id` → `call_log_id`. Two rows merge only when one provider record names both identities; the earlier-created row is canonical, the other gets `merged_into_id`, aliases re-point, rollups move. Phone and time similarity never merge.
- Each party is fenced by its own `last_webhook_sequence`. `terminal` and `provider_connected` never regress. A Call Log record with an older `lastModifiedTime` adds ids/legs/recordings only and never overwrites stored leg-level result/duration. Once a Call Log record has been applied, its result/duration/ended_at outrank later webhook events. `legs_overflow_count` is a monotone lower bound.
- Identical semantic input is a no-op: no write, revision, audit row or job.
- `contact_numbers.search_terms` has one cap and one owner (`numberActivity/searchTerms.ts`, `MAX_SEARCH_TERMS = 50`). `rebuildAttachmentSearchTerms` and `recountNumber` own the set and may replace it wholesale; capture (`applyRollupDelta`) may only *add* an observed caller-ID name and never truncates, reorders or evicts a term it did not write — at the cap it declines the addition, and the name still reaches the set through `provider_names` on the next rebuild. Capture previously capped at 20 while the rebuild paths capped at 50, so the next call on a number silently dropped the thirty oldest lead-derived terms — usually the Job Numbers and customer names that make it findable (CSI-14 §6).
- `contact_type` here is `unknown` or provider-declared `voicemail`; human conversation is never inferred from connection or duration. Transcript/Owner values are preserved.
- `Internal` requires company-side evidence on **both** endpoints (directory extension/DID, or a provider-supplied extension id/number). An unknown short dial string is `malformed`, not a fabricated extension. A party event with no `direction` projects `Unknown` until later evidence; the party's own extension is never injected into an endpoint merely assumed to be the company side.
- Internal, withheld, malformed and service-code endpoints keep raw provider evidence on the interaction (`external_endpoint_kind`, party `phone_number_raw`) and never create a Contact Number or `outreach_ensure` job. Internal calls schedule no discovery.
- Every audit row (`interaction.created|updated|merged`) carries `current.proof_ref` (receipt uuids or Call Log record id), `input_kind`, and `request_id_generated`; callers pass their durable job/run id as `request_id` so `actor.request_id` ties back to real work. Alias rows keep the `proof_ref` that originally proved them; the merge proof is on the `interaction.merged` row. Tombstones keep `contact_number_id`; recounts must filter `merged_into_id: null`.
- Downstream intent keys: `csi:outreach_ensure:interaction:<id>:<revision>` (material changes with a Contact Number), `csi:attachment_refresh:number:<id>:1` (new Contact Number), `csi:recording_discovery:interaction:<id>:recording:<rid>` (each recording once, terminal), `csi:recording_discovery:interaction:<id>:pending` (terminal with no recording id yet). Missing consumers leave pending jobs; nothing here completes them.
- A Call Log record is **observed, not final**. RingCentral lists a queue call while its ring-out legs are still ending and rewrites the same record when the call ends; `/call-log` filters on **start** time. Every run therefore re-reads a trailing settle horizon, and nothing assumes a record read once is its final version.
- The reconcile window is `from = min(incremental_from, now − settle horizon)`, where `incremental_from = max(cursor.last_sync_to − overlap, now − safety)` is a **watermark**. A first run with no cursor uses the full cold-start lookback. When the safety clamp bites, the range `incremental_from` did not reach is opened as a `watermark_clamp` gap and repaired oldest-first with the leftover page budget; the horizon does not change that rule.
- **Per-row skip.** A record is counted as a no-op without opening a transaction only when **every** alias it carries resolves to **one** canonical row, its `lastModifiedTime` is at or before **that row's** `provider_last_modified_at`, and the row is not `call_log_state: "provisional"` (absent counts as not provisional). Two batched reads per window (aliases, then canonical rows following `merged_into_id`). `cursor.provider_modified_watermark` is diagnostic only; it advances only when every window of the run completed and is never read for skipping.
- **Stragglers.** Each run re-reads by id (first `call_log_ids` entry) up to 10 canonical provisional rows whose `started_at` is older than the settle horizon — no start-time window reaches them any more — and applies them, so a provisional row settles after it has left the window. Quarantined ids and ids this run already applied are skipped. Each read counts against the page budget.
- Reconcile cursor and `known_complete_through` advance only when every page of the rolling window was fetched and every record projected **or quarantined**. `known_complete_through = min(windowTo − 15 min, oldest provisional start inside the horizon, ISync sync time − 15 min when Call Log Sync drives)` and never moves backwards. Any interruption records a gap `{from, to, reason}` (`provider_throttled`, `provider_request_failed`, `page_limit`, `projection_failed`, `account_unresolved`, `account_mismatch`, `quarantine_overflow`); gaps close only when a later complete window covers them. Gaps are bounded at 50 by coalescing, never dropping. A 429 anywhere in a run ends the run's provider traffic. The shared client exposes no `Retry-After`, so `throttle_retry_after_observed` is false and the wait is the documented default. The lease renews on a clock (`ttl/3`), not once per record.
- Provider account comes from party `accountId`, the event path, or the Call Log record `uri`; `RINGCENTRAL_ACCOUNT_ID` is the verified configured fallback. Disagreement fails the observation.

## Failure isolation (quarantine)

One record that keeps failing never holds the window. State lives on the `call_log_all_directions` row:

- `record_failures` (bounded 500, oldest dropped): `{call_log_id, failures, last_error_code}`, the consecutive failures before quarantine. A record counts at most once per run, even when a gap repair re-reads it.
- `quarantined_records` (bounded 200; the oldest is evicted into a `quarantine_overflow` gap over its start so it is re-read): `{call_log_id, telephony_session_id, start_time, error_code, error_name, failures, first_failed_at, last_failed_at, next_retry_at}`. `error_code` is `projection_failed`, `account_mismatch`, `retry_exhausted`, `persist_failed` (Mongo/Mongoose rejections such as `StrictModeError`), `provider_not_found` or `provider_request_failed`.

At `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_AFTER` (3) failures a record moves to quarantine with `next_retry_at = now + 60 min`. A window whose only failures are quarantined records is complete. A quarantined record found in a window before its retry time is held, not attempted. Due entries are re-read by id (`GET /account/~/call-log/{id}?view=Detailed`), at most `SALES_INTELLIGENCE_CALL_LOG_QUARANTINE_RETRIES_PER_RUN` (5) per run; success anywhere removes the entry, failure doubles the delay up to 12 h. Every record failure logs `errorName` and the first 200 characters of the error message (schema paths and codes, no PII).

Escalation: `consecutive_failures ≥ 3` makes the `failed` event `error` level and a notification candidate; a newly quarantined record raises `record_quarantined` (warn); a quarantine older than 2 h raises `quarantine_stale` (warn) each run. The Owner Coverage read (`call_log_capture`) shows `quarantined_count` and `oldest_quarantined_at`.

## Account Call Log Sync driver

`SALES_INTELLIGENCE_CALL_LOG_SYNC` = `off` (default) | `shadow` | `on`. Account Call Log Sync returns records **modified** since a durable `syncToken`, regardless of start time. The step runs inside the reconcile lease, before the window, and shares the page budget:

- No token, or a token whose `sync_time` is older than 24 h: `FSync` (`syncType=FSync&view=Detailed&recordCount=250&dateFrom=min(cursor.last_sync_to, now − settle horizon)`), then `ISync` with each returned token while a page comes back full.
- Otherwise `ISync` (`syncType=ISync&syncToken=…&view=Detailed`). A 400 or `CLG-*` error is token expiry: `FSync` in the same run, `consecutive_expiries + 1`, `sync_token_expired` (warn).
- Non-voice entries are ignored. A throttle or provider error changes nothing and applies nothing.
- `shadow`: counts records whose stored row would change (the per-row skip) and applies nothing; the token chain still advances. The window keeps the full settle horizon and stays authoritative.
- `on`: applies every record through the window's path (per-row skip, quarantine). The new token is stored only when every record applied or was quarantined. With a stored token the window narrows to the safety lookback (90) as a net; if the step failed, the window keeps the full settle horizon.

State: `call_log_sync: {token, sync_time, last_full_sync_at, consecutive_expiries}`. The token never appears in logs, events or summaries. `last_run` carries `sync_mode`, `sync_type`, `sync_records`, `sync_changed`, `sync_applied`, `sync_token_stored`, `sync_error_code`.

## Nightly sweep

`/api/cron/sales-intelligence-call-log-sweep` at `40 7 * * *` UTC under `SALES_INTELLIGENCE_CAPTURE_CALL_LOG` (`runCallLogSweepOnce`). It takes the reconcile lease (a held lease is a `lease_held` skip) and never writes the reconcile cursor, gaps or quarantine. Window `[now − SWEEP_LOOKBACK_HOURS (36), now − settle horizon]`, full paging (at least 40 pages), **no skip**: every record goes through `applyInteractionObservation`.

Before applying, each provider record is compared with its stored canonical row exactly as `scripts/dev_ops/diff-call-log-vs-interactions.ts` does: **missing** when no row matches its `telephony_session_id` or Call Log ids; **stale** when the provider `lastModifiedTime` is newer than `provider_last_modified_at`, or the result, duration or a recording id differs. Scope `call_log_sweep` records `last_run: {from, to, provider_records, stored_in_latest_version, applied_changes, missing_before, stale_before, provisional_after_horizon, quarantined, failures, …}` and `consecutive_drift_runs`. A complete sweep with `missing_before + stale_before > 0` raises `sweep_found_drift` (warn), a notification candidate on the second consecutive night; an interrupted sweep leaves the streak unchanged. The Owner Coverage read shows the last sweep's figures (`call_log_capture.last_sweep`).

## Number rollups

`contact_numbers.rollups` holds counts the Numbers list and the desk read without a per-row query. A count is faithful only if exactly one writer keeps it incrementally and the rebuild (`numberActivity/rebuild.ts`, `recountNumber` + `loadRebuildEvidence`) recomputes it from the same definition. The rebuild is the source of truth: it is an idempotent recount, a second run on an unchanged Number writes nothing, and it runs through the durable `rebuild` job (Owner `POST /numbers/:id/rebuild`, rebuild-all fan-out, `queueNumberRollupRebuild`, the one-time sweep below).

| Rollup | Definition | Incremental writer | Rebuild | Trigger for rebuild |
| --- | --- | --- | --- | --- |
| `interactions_total`, `inbound_total`, `outbound_total`, `last_inbound_at`, `last_outbound_at` (and top-level `last_activity_at`, `first_observed_at`) | canonical interactions (`merged_into_id: null`) | `persistInteraction.ts` `applyRollupDelta` (`captureRollupDelta`), revision CAS | yes | any projection rebuild |
| `recordings_total` | Σ `recordings.length` over canonical interactions with `purged_at: null` | `applyRollupDelta`: `+ next.recordings.length − prev.recordings.length`; a merged-away or re-pointed interaction removes its recordings from the Number it leaves; retention's activity purge gives a purged canonical call's recordings back (clamped at 0) | Σ over canonical interactions (a purged row holds `recordings: []`) | existing |
| `human_conversations_total`, `last_human_conversation_at` | `contact_type === "human_conversation"` | none (capture never labels a human conversation) | yes | `queueNumberRollupRebuild` when `contact_type` crosses the boundary (`outreach/store.ts`) |
| `attached_lead_count`, `candidate_lead_count` | attachment edges by state | `attachment/store.ts` | yes | attachment refresh |
| `open_outreach_count` | non-closed Outreach Records on the Number | none | yes | none (stale by design; read by no final-spec surface) |
| `conversations_analyzed_total`, `last_analyzed_at` | Lead Conversations on the Number with `latest_completed_run_id != null && content_purged_at == null`; newest `started_at` | `analysis/apply.ts` `countNewlyAnalyzedConversation`: `$inc` / `$max` exactly when the publish CAS moves `latest_completed_run_id` from null to a run (not on re-analysis). Retention's content purge `$set`s `0` / `null`: in the same transaction it nulls `latest_completed_run_id` on every conversation of that Number, so zero is exact | `countDocuments` + newest row over `lead_conversation_number_started` | existing |
| `outreach_records_total` | Outreach Records with this Number as `primary_contact_number_id` or `subject.contact_number_id`, `purged_at: null`; a record naming the Number both ways counts once | `outreach/ensure.ts` `countOutreachRecordOnNumber` (`$inc`) on `outreach_created` with a primary, `outreach_number_linked`, and `number_review_opened` (in `ensureInteraction` and `outreach/numberReview.ts`) | `countDocuments` with `$or` | existing |

Retention's Number activity purge zeroes every rollup on the suppressed Number (existing convention).

**Concurrency.** Capture and the rebuild are read-modify-write writers fenced by the `revision` CAS. Apply, ensure and retention are out-of-band writers that `$inc`/`$max`/`$set` single dotted paths **without** bumping `revision` (a bump would invalidate Owner `expected_revision` commands and add capture retries). An increment cannot be lost: (1) capture writes only the dotted paths it owns and never the whole `rollups` object, so it never names the fields the out-of-band writers keep; (2) every writer runs in a Mongo transaction in which the counter moves together with its fact (the conversation CAS, the record insert or link, the purge), and a transaction that writes the Contact Number after another write to it committed since its snapshot aborts with `WriteConflict` (`TransientTransactionError`) and is retried from a fresh read. The rebuild replaces the whole `rollups` object from a snapshot of the evidence; an increment that commits between its read and its write conflicts on the same document, and one that commits after it is counted on top of a recount that did not include its fact. Proof: `scripts/dev_ops/test-si-rollups.ts` (concurrent captures and Outreach creations on one Number).

**Backfill.** Numbers written before these fields existed read the schema default until rebuilt. `scripts/dev_ops/sweep-number-rollups.ts` enqueues the existing `rebuild` job (`csi:rebuild:number:<id>:all:<sweep id>`, `input_revision: 1`) for every Number with `rollups.interactions_total > 0`; a dry run by default, `--confirm-write` to enqueue, `--allow-production` outside a loopback `testvantagemovers_*` database, `--inline` (loopback test databases only) to drain in-process. A rerun with the same sweep id creates nothing.

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

## Tests

- `src/services/numberActivity/*.test.ts` — pure projection, phone, account, coverage math, import boundary; `callLogCompleteness.test.ts` covers the quarantine lifecycle and bounds, the Call Log Sync token chain, expiry fallback and token-storage rule with a fake fetcher, configuration, and the Owner Coverage figures.
- `pnpm test:csi:capture:replica` — isolated single-node replica proofs: atomic persistence and rollback, concurrent duplicates, account-scoped identity, merge-with-proof, reconcile cursor/gaps/429/page limit/lease fencing, qualified cursor collection untouched; the per-row skip hole (L1 < L2 < L3), a snapshot re-read inside the horizon, quarantine lifecycle and escalation, straggler settles and the provisional cap on `known_complete_through`, Call Log Sync `on`/`shadow` wiring, and the sweep's before/after figures and drift streak. Provider pages are synthetic; these are not live capability proofs.
