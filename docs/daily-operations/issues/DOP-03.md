# DOP-03 — Granot hooks (receipt, decision, intake)

> **Contract maturity: implementation-ready.** Session 2/3. After-commit
> Granot facts only. **No Admin UI. Do not increment `leads.*` from
> `granot.minted`.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §13 (mint vs Lead create, receipt vs outcome, booking-status rule),
  §15.3–15.5.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Knowledge:** [`../../knowledge/granot-lifecycle/capture.md`](../../knowledge/granot-lifecycle/capture.md),
  [`processor.md`](../../knowledge/granot-lifecycle/processor.md),
  [`booking-reconciliation.md`](../../knowledge/granot-lifecycle/booking-reconciliation.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

A webhook-channel Granot Observation Receipt becomes a Granot-panel
card. Processor outcomes become paired cards (`parent_receipt_id`).
A Booked / Release observation opens or refreshes an intake card.
Lead volume still comes from DOP-02 finalize, not from `granot.minted`.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** DOP-01 `complete`.
- May run in parallel with DOP-02.
- No 21st.dev.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- `captureGranotLifecycleWebhookReceipt` persists then returns 202
  `{ receipt_id }`. Hook after persist, before 202. Receipts only.
- Do not hook `captureChannelOperationReceipt`.
- `createLeadFromGranot` finalize writes the Lead and may send a
  confirmation Lead Message (DOP-02 owns the text). This issue records
  `granot.minted` + provenance for pairing.
- `synchronizeLeadFromGranot` `pending` today is `{ leadModel, leadId }`
  only — **extend `pending`** with outcome + `source_receipt_id` /
  `decision_id` / `job_no`.
- `logProcessingCompletion` is the observe / pending / unmatched seam
  when no lead finalize ran.
- `reconcilePreparedObservation` already emits
  `granot_lifecycle.booking_case.opened` / `.refreshed`.
- Live Events SSE is unchanged.

## 5. Locked decisions and invariants at risk

- Capture increments webhook class counts only.
- Processor increments `booked` / `release` and decision / intake kinds.
  Do not double-count `booking_status_changed`.
- `granot.minted` does **not** increment `leads.*`.
- Extension / HTTP-automation receipts are out of this board.
- After-commit only. Never 202 for Lead / Booking / Decision counts.
- Pair receipt + outcome by `parent_receipt_id`.

## 6. Deliverables and exact contract

1. Capture hook: `granot.lead_created` | `priority_updated` |
   `booking_status_changed`. If raw payload already has Booked/Release,
   emit `granot.booked` / `granot.release` at capture and do not
   increment those buckets again at process (spec §13 locked rule).
2. `createLeadFromGranot` finalize → `granot.minted` (decision only)
   with `parent_receipt_id`. Lead create remains DOP-02.
3. Extend `synchronizeLeadFromGranot` `pending`; record
   `granot.linked` / related outcomes.
4. `logProcessingCompletion` → `granot.observed` / `pending_match` /
   `unmatched` when no lead finalize ran. Dead letter →
   `exception.dead_letter`.
5. `reconcilePreparedObservation` → `intake.opened` / `.refreshed`
   with `normalized_job_no` and `intake_case_id`.
6. Tests: capture increments webhook only; mint + form finalize do not
   double-count Leads; pair ids; replay skipped; channel receipts ignored.

## 7. Out of scope

- Form / Call / Booking / text hooks (DOP-02).
- HTTP / SSE (DOP-04 / DOP-05).
- Admin UI. Live Events accordion unchanged.
- Confirm Granot Booking (not a Daily Operations write).

## 8. Tests

Spec §19 Granot capture vs finalize row. Add focused tests next to
capture / processor / bookingReconciliation as touched.

## 9. Knowledge updates after this issue ships

None required. DOP-08 owns pointers.

## 10. Acceptance criteria

- [x] `lead_created` capture increments `webhooks.lead_created` only.
- [x] `createLeadFromGranot` finalize increments `decisions.minted`
      and does **not** increment `leads.*`.
- [x] Outcome card has `parent_receipt_id` of the receipt card.
- [x] Booked / Release increment `webhooks.booked` / `.release` once.
- [x] Intake opened increments `intakes.opened`; refresh does not.
- [x] Extension / automation capture is not hooked.
- [x] Replay does not increment.
- [x] Focused tests + typecheck.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/granotLifecycle/capture.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/dailyOperations/
```

Adjust to files you touch. Paste output.

## 12. Risks

- Double-counting Leads from mint + finalize.
- Double-counting Booked at capture and process.
- Hooking channel receipts.
- `pending` too thin to write a useful card — extend it, do not guess
  Source Company later.

## 13. Rollback

Remove Granot `recordDailyOperationsFact` calls and the `pending`
field additions if unused.

## 14. Handoff list for the completion report

- How Booked vs Release is classified (capture vs process).
- `pending` fields added for DOP-04 snapshot / rebuild.
- Pairing field names.

**Unblocks:** DOP-08 (with DOP-02 + DOP-07).
