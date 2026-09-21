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

**System of record:** `call_interactions`, `call_interaction_aliases`, `contact_numbers`, `sales_intelligence_sync_state` (scope `call_log_all_directions`), CSI audit events and `sales_intelligence_jobs`. Indexes come from the CSI migration; writers fail closed without the unique fences.

## Modules

| Module | Responsibility |
| --- | --- |
| `interactionProjection.ts` | Pure. `fromWebhookParties`, `fromCallLogRecord`, `mergeProjections`, `sameProjection`, identity/alias helpers. No I/O. |
| `persistInteraction.ts` | One Mongo transaction per observation: alias reservation, insert or revision-CAS update, merge-with-proof tombstones, Contact Number rollups, `interaction` audit invalidation, `enqueueCsiJob` intent. Bounded retry on duplicate key / revision conflict. |
| `observeWebhookEvents.ts` | `normalizeWebhookPartyObservations(payload, receivedAt)` and `observeRingCentralWebhookEvents(observations, deps)`. Interface CSI-03 calls from its durable capture-projection job. |
| `reconcileCallLog.ts` | `runCallLogReconcileOnce(deps)`: fenced lease, rolling window, oldest-first projection, gaps, gap repair, cursor and `known_complete_through`. |
| `callLogClient.ts` | Detailed Call Log page fetch without a direction filter over the shared RingCentral client/token store. |
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
- The reconcile window is a **watermark**, not a floor: `max(cursor.last_sync_to − overlap, now − safety)`, with the full lookback reserved for a cold start (no cursor). When the safety clamp bites, the range it did not reach is opened as a `watermark_clamp` gap and repaired oldest-first with the leftover page budget — a bounded window is honest only if what it left behind is recorded (CSI-14 §4). Previously the cursor could move the window only *earlier*, so every run re-fetched and re-projected a full twelve hours and each record was processed ~72 times before it aged out.
- A record whose `lastModifiedTime` is at or before the stored `provider_modified_watermark` **and** whose every provider identity already resolves to a stored alias is counted as a no-op without opening a transaction: it could only rediscover `noop: true` after reading aliases and canonical rows. The watermark advances only when every window completed, so a record whose previous apply failed is never skipped. The lease renews on a clock (`ttl/3`), not once per record.
- Reconcile cursor and `known_complete_through = windowTo − 15 min` advance only when every page was fetched and every record projected. Any interruption records a gap `{from, to, reason}` (`provider_throttled`, `provider_request_failed`, `page_limit`, `projection_failed`, `account_unresolved`, `account_mismatch`); gaps close only when a later complete window covers them. Gaps are bounded at 50 by coalescing, never dropping. A 429 anywhere in a run ends the run (no further gap repair); `cursor.provider_modified_watermark` advances only when every window of the run completed. The shared client exposes no `Retry-After`, so `throttle_retry_after_observed` is false and the wait is the documented default.
- Provider account comes from party `accountId`, the event path, or the Call Log record `uri`; `RINGCENTRAL_ACCOUNT_ID` is the verified configured fallback. Disagreement fails the observation.

## Configuration

`SALES_INTELLIGENCE_CAPTURE_CALL_LOG` gates `runCallLogReconcileOnce` (default off). `SALES_INTELLIGENCE_CALL_LOG_ROLLING_LOOKBACK_MINUTES` (floor 720 — cold-start reach and the outer bound on a repaired gap, no longer the size of every window), `SALES_INTELLIGENCE_CALL_LOG_SAFETY_LOOKBACK_MINUTES` (90 — how far one incremental window may reach back), `SALES_INTELLIGENCE_CALL_LOG_OVERLAP_MINUTES` (15), `SALES_INTELLIGENCE_CALL_LOG_MAX_PAGES` (20). The cron runs `3-59/5` — a smaller window buys fresher capture at lower total provider cost. `RINGCENTRAL_ACCOUNT_ID` optional configured account. Cron/queue registration, the webhook fan-out that calls `observeRingCentralWebhookEvents` from a durable job, and the all-direction subscription lifecycle are wired by CSI-03: see [sales-intelligence-webhook-fanout.md](sales-intelligence-webhook-fanout.md).

## Tests

- `src/services/numberActivity/*.test.ts` — pure projection, phone, account, coverage math, import boundary.
- `pnpm test:csi:capture:replica` — isolated single-node replica proofs: atomic persistence and rollback, concurrent duplicates, account-scoped identity, merge-with-proof, reconcile cursor/gaps/429/page limit/lease fencing, qualified cursor collection untouched. Provider pages are synthetic; these are not live capability proofs.
