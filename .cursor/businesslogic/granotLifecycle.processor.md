**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/processor.ts`, `src/services/granotLifecycle/operations.ts`, `src/services/granotLifecycle/projections.ts`, `src/config/domain/granotLifecycle.ts`, `src/models/SynchronizationDecision.ts`, `src/models/GranotLifecycleActivation.ts`, `src/models/GranotRecordLink.ts`  
**Domain terms used:** Synchronization Decision, Granot Record Link, Granot Observation, Granot Observation Receipt, System of Record

# Granot lifecycle Decision skeleton (`granotLifecycle/processor`)

**Role:** Turn one receipt's Observation into one causal Synchronization Decision and, only when safe, one job-level Granot Record Link. This is evidence and operational inspectability. It does not match or mutate a Lead, open a case, or create an official Booking or Cancellation fact.

**Stack:** callable module `processor.ts`. When invoked it upserts the Observation through the existing normalization module, then writes one Decision. No HTTP route processes a receipt. Admin routes accept an activation command, a Job Number path, or a health read. Capture does not invoke this module. Unit 08 owns claiming, draining, and retries.

## Execution mode

`classifyExecutionMode` is pure. Channel never changes mode. A stored Decision's mode is never recomputed or promoted.

- no activation row → `historical_shadow`
- `captured_at < activated_at` → permanently `historical_shadow`
- `captured_at >= activated_at` and shadow true → `live_shadow`
- `captured_at >= activated_at` and shadow false → `live`

## Safe historical Record Link

Only a valid Observation whose source policy resolves successfully, in `historical_shadow`, with a normalized Job Number may establish or confirm a job-level link. Referral may establish a job-only link without Source Scope. Deferred, disabled, unclassified, ambiguous, or invalid policy establishes none. Post-cutoff `live_shadow` / `live` attempts persist a Decision and do not mutate a Record Link. A successful Decision stamps `processing.latest_decision_id` on the receipt; it does not claim or drain the receipt.

Incompatible job/source evidence records `conflict` / `record_link_conflict` and does not alter, mark, or supersede the active link. Unit 29 owns disputed marking and correction.

## Activation

`POST /api/v1/admin/granot-lifecycle/activation` is Owner-only and write-once. The server supplies `activated_at` and the verified actor. Success is `201`. An existing row returns `409 GRANOT_ALREADY_ACTIVATED`. The command exists; the activation row stays absent until separately approved.

## Projections

Job and health reads are Owner/Admin, raw-free, and explicitly incomplete (`complete_timeline`, `cases`, and `official_facts` are false; queue/cron timestamps stay null).

## Flags

Defaults: processing true, shadow true, all eight effect flags false. Capture ignores these flags. Processing false refuses this module unless a test supplies config. This unit applies no Lead, Booking, or Cancellation effects.

## Out of scope here

Claim/fencing, consumer, cron, identity ladders, desired state, Lead writes, post-cutoff link mutation, Entity Changes, Sheet Sync, cases, discrepancies, and notifications.

## Related

- Capture remains receipt-only ([`granotLifecycle.capture.md`](granotLifecycle.capture.md)).
- Observation upsert uses [`granotLifecycle.normalization.md`](granotLifecycle.normalization.md).
- Policy resolution: [`granotLifecycle.sourcePolicy.md`](granotLifecycle.sourcePolicy.md).
- Software map: [`granot-lifecycle-capture.mdc`](../rules/granot-lifecycle-capture.mdc).
