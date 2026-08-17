**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/normalization.ts`, `src/models/GranotObservation.ts`  
**Domain terms used:** Granot Observation, Granot Observation Receipt, Granot Priority, Granot Booking Action, Observation Channel

# Granot Observation normalization (`granotLifecycle/normalization`)

**Role:** Convert one immutable **Granot Observation Receipt** into one immutable-in-meaning **Granot Observation**. This module owns every Section 10 field, result, and issue rule. It does **not** match Leads, resolve Registry policy, write Decisions, or mutate a Lead, Booking, or Cancellation.

**Stack:** callable module only. Capture, routes, and later consumers pass a receipt ID (or an already-read typed receipt). They must not normalize fields themselves. No processor, worker, or flag module exists yet.

## Public interface

- `normalizeGranotReceipt(receipt)` — pure candidate from typed receipt evidence.
- `upsertGranotObservation({ receipt_id } | { receipt })` — persist with one-row-per-`receipt_id` upsert.
- Invalid and unsupported results **persist**. They are completed business classifications, not thrown parse failures.
- Technical database failures throw and create no second row.
- If a concurrent or later candidate differs from the stored row, `ObservationIntegrityError` is thrown. Evidence is never overwritten.

## Channel authority

- Webhook kind comes from `route_event_class`. Payload `event_type` cannot reroute it.
- Extension/automation kind comes from `channel_operation_kind`:
  - `lead_snapshot_apply` → `lead_snapshot`; a Booked/Release payload event is `invalid` + `route_payload_event_conflict`.
  - `booking_action_apply` → `booking_action_snapshot` and requires a supported Booking Action.
- `lead_created` accepts absent or case-insensitive exact `lead_created`.
- `priority_updated` accepts absent, `priority_update`, or `priority_updated`.
- Absence of a compatible payload event type is warning `missing_payload_event_type`.
- Case-insensitive exact `Booked` → `booked`. Exact `Releas` or `Release` → `release`. `Released` and every other well-formed action are `unsupported`. Never prefix-match.

## Priority and result precedence

- Accept a JSON nonnegative safe integer or trimmed `^[0-9]{1,12}$`. Canonical strips leading zeroes (`05` → `5`, all-zero → `0`). Exact raw remains evidence.
- Every valid canonical is retained. Only `1` and `5` later authorize broad enrichment and `quoted = true`; this module applies neither effect.
- Priority Update missing/malformed Priority → `invalid` + `invalid_priority`.
- Lead Created / Booked / Release with malformed Priority → `valid_with_issues` + `invalid_priority`.
- Non-object payload or route/event conflict stays `invalid`. Unsupported Booking Action stays `unsupported`. Priority cannot change those primary outcomes.

## Scalar, source, and display rules

- Only scalars participate in scalar fields. Arrays/objects never stringify to `[object Object]`.
- Strings are Unicode NFKC, trimmed, and bounded. Over-bound input emits the applicable issue and does not manufacture a valid identity.
- Source lookup label = NFKC + trim + collapsed whitespace + lowercase. Empty/control/bidi/invalid → `invalid_source_label`.
- Job Number uses `normalizeJobNo`. Form reference sentinels `not provided` / `not_provided` / blank become absent identities.
- Phone uses `normalizePhoneNumberForMatch`. Email is trim/lowercase with `invalid_email` on malformed input.
- Move date is strict `MM/DD/YYYY` in `America/New_York` (Vantage business timezone decision). Impossible dates → `invalid_move_date`.
- Display money is evidence only and never domain-command input.
- `user` / `rep` are preserved raw. Agent lookup and `granot_agent_identity_conflict` are later policy.
- Payload `type` is stored only at `provider_context.type_raw`. `type=AUTO` never supplies source label, Registry ID, route, or disposition.

## Persistence

- Collection: `granot_observations`. Unique index: `receipt_id` only.
- `granot_crm_source_id` is optional future linkage and is not populated here.
- Observation rows contain no processing state, target, source policy, desired state, or effect.

## Related

- Capture remains receipt-only ([`granotLifecycle.capture.md`](granotLifecycle.capture.md)).
- HTTP automation still mutates directly ([`granotHttpCollector.service.md`](granotHttpCollector.service.md)).
