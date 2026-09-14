# RRF-03 — Knowledge restamp

> **Contract maturity: implementation-ready.** Session 3. docs-keeper
> only after RRF-01 is green. **No behavior change.**

## 1. Authority and required reading

- **Pack specification:** [`../referral-review-release-first-specification.md`](../referral-review-release-first-specification.md)
  — §10.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **docs-keeper** skill / `docs/agents/domain.md` if present.

## 2. Objective

`booking-reconciliation.md` and this pack’s knowledge pointer describe
the helper that actually shipped: Referral review revalidates
first-evidence Decision/policy; first action may be Booked or Release;
latest action still gates Confirm Granot Cancellation.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` docs / knowledge.
- **Prerequisites:** RRF-01 `complete`.
- Do not invent a new Service file. Pointer + restamp only.

## 4. Current-state evidence to verify

- [`booking-reconciliation.md`](../../knowledge/granot-lifecycle/booking-reconciliation.md)
  Owner commands: Referral review “revalidates the Referral
  Decision/source policy” — does not yet say first action may be
  Release.
- Pointer
  [`../../knowledge/granot-lifecycle/referral-review-release-first.md`](../../knowledge/granot-lifecycle/referral-review-release-first.md)
  was authored as proposed. Mark landed after RRF-01.

## 5. Locked decisions and invariants at risk

- Pointers do not copy helper code.
- FINAL SPEC still wins uniqueness / Referral-has-no-Lead.
- Release-into-intake still wins routing.

## 6. Deliverables and exact contract

1. Invoke docs-keeper for the booking-reconciliation / owner-command
   layer only.
2. One or two sentences on the Referral review bullet in
   `booking-reconciliation.md` (spec §10).
3. Pointer status → landed; `stale_after` unchanged unless the
   keeper restamps dates.
4. Do not copy this pack’s diagnosis into `CONTEXT.md`.

## 7. Out of scope

- Server or Admin code.
- New glossary terms.
- Production runbook beyond “deploy then No Action 5558690.”

## 8. Tests

None. Knowledge-only.

## 9. Knowledge updates after this issue ships

This issue *is* the knowledge update.

## 10. Acceptance criteria

- [x] `booking-reconciliation.md` states first-evidence Booked or
      Release for Referral policy revalidation.
- [x] Latest-action Cancel gate is still explicit.
- [x] Pointer marks the leftover booked-first check as shipped.
- [x] No new invented domain synonym.

## 11. Commands

None required beyond the docs-keeper pass. If `pnpm okf:query` is
used, record the command.

## 12. Risks

- Copying FINAL SPEC §19 Booked-only review language back into the
  Service and undoing Release-into-intake.

## 13. Rollback

Revert the knowledge sentences.

## 14. Handoff list for the completion report

- Files restamped.
- Exact sentences added.
- Confirmation that persist / minting docs were not rewritten.
