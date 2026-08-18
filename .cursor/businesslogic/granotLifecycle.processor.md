**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/processor.ts`, `src/services/granotLifecycle/leadDesiredState.ts`, `src/services/granotLifecycle/granotTemporal.ts`, `src/config/domain/granotLifecycle.ts`, `src/models/SynchronizationDecision.ts`, `src/models/GranotLifecycleActivation.ts`, `src/models/GranotRecordLink.ts`
**Domain terms used:** Synchronization Decision, Granot Record Link, Granot Observation, Granot Observation Receipt, System of Record

# Granot lifecycle processor (`granotLifecycle/processor`)

**Role:** Channel-neutral production orchestrator. One receipt becomes one Observation, one Unit 14 identity result, one desired-state plan, and one Synchronization Decision. Historical shadow may also establish or confirm a **job-level** Granot Record Link. This module does not mutate Lead business fields, target links, official Booking/Cancellation facts, cases, Commands, Entity Changes, or Sheet Sync.

**Stack:** callable module `processor.ts`. Capture does not invoke it. Queue, cron, and the synchronous claim-and-poll seam invoke it only after a fenced receipt claim (`drainer.ts`). Routes pass receipt identity (and optional initiator); they do not plan patches.

## Orchestration

```text
load receipt -> upsert/reuse Observation -> classify stored execution mode
-> terminal normalization -> resolve Registry policy -> Unit 14 identity
-> temporal compare -> desired-state plan -> evaluate exact gates
-> persist one Decision for observation/attempt -> finalize through Unit 08 fence
```

The processor actor is always `{ actor_type:"system", actor_id:"granot-lifecycle-processor" }`. Receipt `initiator` is threaded in module context for later commands; a webhook may omit it. Clients never supply the processor actor.

Same observation/attempt with identical causal meaning replays the stored Decision. Different meaning is `DecisionIntegrityError`. Technical dependency failures create no Decision.

## Temporal tuple

Ordering is latest accepted Vantage `captured_at`; equal times use the lexicographically greater lowercase 24-character Observation ObjectId hex. No source, channel, or Priority outranks that tuple. Missing stored winner is newer. Exact same tuple is replay/`already_current`. Older is `stale` / `older_than_temporal_winner` with no desired-state effect or winner advance.

## Desired-state planner

`leadDesiredState.ts` returns a plan, not a database patch and never contact values inside a Decision. Rules:

- every temporally accepted valid Priority plans `granot_priority`; only `1`/`5` plan broad enrichment and `quoted=true`; no Priority plans false
- malformed Priority Update is `invalid` / `invalid_priority_update`; the same issue on Lead Created/Booked/Release skips Priority and continues
- WordPress primary contact and both ingested snapshots never enter `changed_paths`; qualified Granot contact stays on `granot_contact_snapshot`; qualified move may plan current location/date/cubic feet and derived `local`; Vantage `move_size` is never planned
- RingCentral-created and Granot-created qualified contact/move plan current fields plus a bounded `last_granot_contact_change.changed_paths` summary; no Entity Change is claimed
- one Unit 14 Agent suggestion may fill an empty receiver at any valid Priority via `granot_username_match`; conflicts and existing receivers never overwrite
- Duplicate Form has no target; Bad exact Form is Priority plus safe link evidence only
- `link_only` no-match is `pending_match` until the Unit 08 24h clock, then `unmatched` / `match_window_expired`; incomplete creation data is terminal `insufficient_creation_data` and is never pending
- `create_if_missing` evaluates Section 16.3 minimum data in shadow and stays `shadow_effect_suppressed` with no `created` claim; Unit 19 owns creation

Source Company, Source Granularity, Ingestion Origin, CPL, Booking/Cancellation refs, and official money never enter `desired_values`.

## Shadow and effects

- Pre-activation and `captured_at < activated_at` stay `historical_shadow` forever. Live-shadow Decisions are never promoted.
- Historical shadow may create safe job-level Record Link evidence when Job/scope agree. It does not add `lead_ref`, `booking_ref`, source scope, or disputed state.
- Live shadow persists Decisions only. Eligible matched writes become `shadow_effect_suppressed`.
- Effect rows are empty unless a safe job-level Record Link establish/confirm actually occurs.
- Production starting/ending flags stay processing true, shadow true, and all eight effect flags false.

## Temporal compare-and-swap seam

For a newer Observation whose authorized desired state is already current, injected **`live` + Lead-writes-enabled test posture only** may insert `already_current` / `desired_state_already_current` and atomically advance `last_accepted_granot_observation` with a filter that accepts only an older `(captured_at, observation_id)` tuple. That write does not increment `domain_revision`, write `last_change_*`, create Entity Change, request Sheet Sync, or emit `lead_updated`. Zero matched rows abort the proposed Decision, reload, and re-evaluate; the loser is normally `stale`. Production shadow never invokes this Lead write. Unit 18 owns changed-field command transactions.

## Flags

Defaults: processing true, shadow true, all eight effect flags false. Processing false refuses this module unless a test supplies config.

## Out of scope here

Matched Lead field writes and target-link mutation (Unit 18). Authorized Lead creation (Unit 19). Booking/Release cases and commands. Extension/automation adapters. RingCentral adoption.

## Related

- Identity: [`granotLifecycle.identity.md`](granotLifecycle.identity.md)
- Desired-state planner: [`granotLifecycle.desiredState.md`](granotLifecycle.desiredState.md)
- Policy/gates: [`granotLifecycle.sourcePolicy.md`](granotLifecycle.sourcePolicy.md)
- Drain/pending clock: [`granotLifecycle.drainer.md`](granotLifecycle.drainer.md)
- Software map: [`granot-lifecycle-capture.mdc`](../rules/granot-lifecycle-capture.mdc)
