# Phase 7 — Live Events `intake_link` + SSE `receipt_updated` (AC-L1–L5)

**Branches:** `vantage-main-server` `lead-lifecycle`, `vantage-admin` `lead-lifecycle`  
**Status:** done  
**Date:** 2026-09-01

Not committed. No production flags. FINAL SPEC untouched. Knowledge docs (Phase 8 / spec §16) are out of scope.

Never resolve by `job_no`. Empty / unsupported `event_type` never qualifies. `lead_created` / `priority_updated` never get a non-null `intake_link`.

## Index report (read-only first)

Current booking-case catalog (before this phase) had **five** named indexes and **no** index on `evidence.observation_id` (also noted in spec §2 / uniqueness table). Join would have been a collection scan on `granot_booking_reconciliation_cases`.

**Definition applied in this PR** (same as other case indexes):

| Name | Key | Unique |
| --- | --- | --- |
| `granot_booking_case_evidence_observation_id` | `{ "evidence.observation_id": 1 }` | no |

Added to `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES`. Existing apply/verify CLIs already consume that array (`granot-lifecycle-indexes.ts`, `granot-lifecycle-indexes-remaining.ts`). No new production apply CLI. **Not applied to production.**

## Files

### Server

- `src/services/granotLifecycle/liveReceipts.ts` — `LiveWebhookIntakeLink`, `observation_id` / `intake_link` on the DTO, `resolveLiveReceiptIntakeLink`, batch `enrichLiveWebhookReceipts`, `listLiveWebhookReceiptsUpdated`
- `src/services/granotLifecycle/liveReceipts.test.ts` — AC-L1, AC-L2, AC-L3, AC-L5 + fail-closed duplicate cases
- `src/services/granotLifecycle/liveReceiptStream.ts` — `receipt_updated`; capture cursor unchanged
- `src/services/granotLifecycle/liveReceiptStream.test.ts` — AC-L4 + no update for brand-new `receipt`
- `src/routes/granot-lifecycle-admin.routes.ts` — SSE deps include `listUpdated`
- `src/models/GranotBookingReconciliationCase.ts` (+ unit test) — sixth named index
- `scripts/migrations/granot-lifecycle-indexes.test.ts` — non-unique count 3→4, missing 5→6

### Admin

- `lib/api/granotLiveReceipts.ts` (+ test) — wire type, incoming `intake_link` replaces null, `applyLiveWebhookSsePayload` for `receipt` / `receipt_updated`
- `components/granot-lifecycle/live-webhooks.tsx` — `receipt_updated` listener; **Open booking intake** iff `intake_link.kind === "booking"`
- `tests/granot-lifecycle-components.test.ts` — card + listener path

## Join / batch

`projectLiveWebhookReceipt` still maps the receipt row. `enrichLiveWebhookReceipts` (used by snapshot / `listAfter` / `listUpdated`) then:

1. One Observation find: `receipt_id ∈ page ids`.
2. One booking-case find: `evidence.observation_id ∈ those observation ids`.
3. In memory: unique case → `{ case_id, kind: "booking", state, matched_via: "evidence_observation_id" }`. Two cases → `intake_link: null` + operational event `granot_lifecycle.live_receipt.ambiguous_intake_link`. No `$lookup` loop. No job-number match.

`observation_id` is set whenever the Observation exists (including non-booking routes). `intake_link` stays null unless §11.3 holds.

Tests inject stores; no live Mongo.

## SSE late update

In-memory map of `{ processing_state, intake_link }` keyed by `receipt_id` for receipts still in the 30-minute window. After each `listAfter`, `listUpdated` re-lists the window. Emit `receipt_updated` (no `id:`) when those two fields change. Do not emit for a receipt just sent as `receipt`. Do not advance `Last-Event-ID` (`captured_at:receipt_id` remains new receipts only). Still Mongo-polled; no in-process emit.

## Admin

`mergeLiveWebhookReceipts` incoming-first already replaces by `receipt_id`. Test: later `intake_link` overwrites `null`. `LiveWebhooks` listens for `receipt_updated` and uses the same merge. Card: **Open booking intake** → `intakeCaseHref(case_id, { state, job })` beside **Open job timeline**. No disabled button. No “no intake yet.” Owner-only unchanged.

## Tests

```
cd vantage-main-server
pnpm exec node --import tsx --test src/services/granotLifecycle/liveReceipts.test.ts src/services/granotLifecycle/liveReceiptStream.test.ts src/models/GranotBookingReconciliationCase.test.ts
pnpm exec tsc --noEmit
```

17 passed, 0 failed. `tsc --noEmit` clean.

```
cd vantage-admin
pnpm exec node --import tsx --test lib/api/granotLiveReceipts.test.ts tests/granot-lifecycle-components.test.ts
pnpm exec tsc --noEmit
```

44 passed, 0 failed. `tsc --noEmit` clean.

Index catalog test (`granot-lifecycle-indexes.test.ts`) 25 passed.

| AC | Coverage |
| --- | --- |
| AC-L1 | `lead_created` / `priority_updated` → `intake_link` null (even if a case row is injected) |
| AC-L2 | `booking_status_changed` + Observation on case evidence → `intake_link.case_id` (open and resolved) |
| AC-L3 | empty `event_type`, unsupported `Released`, discrepancy-only (no case) → null |
| AC-L4 | snapshot `intake_link: null`, later `receipt_updated` same `receipt_id` with link; cursor unchanged |
| AC-L5 | two receipts same job; only the Observation on the case gets the link |

## Follow-ups for Phase 8

Knowledge docs in spec §16: `live-receipts.md` (`intake_link`, `receipt_updated`), processor / booking-reconciliation / release-reconciliation / projections / spec-hub; Admin `uxdocs/live-events-tab-specification.md` pointer only. Apply the new booking-case index in production via the existing indexes CLI when ops is ready — not this phase.
