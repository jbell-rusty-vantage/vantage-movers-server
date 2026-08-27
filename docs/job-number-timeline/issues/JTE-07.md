# JTE-07 — WordPress durable receipt capture

> **Contract maturity: specified, not authorized.** Deferred. Separate
> source-assurance issue. Does **not** block the enhanced timeline.

**Do not start until source-assurance approval is recorded.** Until then
the timeline shows `WORDPRESS_RECEIPT_UNAVAILABLE` and does not invent a
`source_received` event for WordPress (JTE-02 / JTE-03).

## 1. Authority and required reading

- **Enhancement specification:** §4.1, §7.1, §11.2, §16 `JTE-07`.
- Form Lead create path and CRM posting docs — do not change posting
  semantics here.
- **Pack rules:** [`../README.md`](../README.md)

## 2. Objective

Capture a durable WordPress submission receipt **before** Lead creation,
with an idempotency key, received time, processing status, and resulting
Lead reference. After that exists, the timeline may emit `source_received`
for WordPress the same way it does for Granot receipts.

## 3. Repository, branch, and prerequisites

- **Repositories:** likely `vantage-main-server` and
  `vantage-movers-clients` (quote / form seam). Confirm at approval.
- **Prerequisite:** separate source-assurance approval in
  [`../PROGRESS.md`](../PROGRESS.md).
- JTE-02/03 already name the limitation; this issue flips WordPress from
  bounded to verified ingress.

## 4. Current-state evidence to verify

No durable independent WordPress form-submission receipt exists today.
Lead creation is the first Vantage fact. Reverify the public Form Lead
write path and client-site quote seam before designing the collection.

## 5. Locked decisions and invariants at risk

- Receipt is captured **before** Lead creation, not inferred from the
  Lead.
- Idempotent on the submission key. Duplicate posts do not create a
  second receipt.
- Timeline must not emit WordPress `source_received` until this receipt
  exists for that Lead.
- Do not weaken CRM posting or Sheet Sync invariants.

## 6. Deliverables and exact contract

Specify and implement the receipt collection, the capture seam on the
public form path, and the timeline loader read. Then flip the WordPress
limitation to a receipt event on goldens that have the new fact.

Exact schema is **not** invented in this pack. Author it in this issue
after approval, then implement.

## 7. Explicitly out of scope

- Google destination verification.
- Daily Assurance population completeness.
- Backfilling fake receipts onto historical WordPress Leads.

## 8. Flags and runtime posture

New write path. Fail closed. Test database first.

## 9. Migration and indexes

Unique idempotency index. Report-first.

## 10. Acceptance criteria

- [ ] Receipt exists before Lead create on the authorized path.
- [ ] Duplicates collapse on the idempotency key.
- [ ] Timeline emits `source_received` only when the receipt exists.
- [ ] Historical WordPress Leads without a receipt still show the
      limitation, never a invented event.

## 11. Required tests and commands

Focused Form Lead + timeline tests. Typecheck in every repo touched.

## 12. Live/staging verification

Test form path only. No production form injection from this issue.

## 13. Rollback

Stop capturing receipts; timeline falls back to the limitation. Do not
delete historical receipts if any were written.

## 14. Required completion handoff

Report: schema, capture seam, idempotency evidence, timeline golden
update, remaining historical limitation count.
