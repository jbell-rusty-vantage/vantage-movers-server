# JTE-06 — Cancellation correlation snapshots

> **Contract maturity: specified and authorized on the test database.**
> Improves future Job traceability. Does **not** block the enhanced timeline.

**Do not start this issue until the Owner authorizes a write-path change
and a report-first backfill.** The honest timeline ships without it
(JTE-02 already refuses to attach orphan Cancellations).

## 1. Authority and required reading

- **Enhancement specification:** §11.1, §15 Phase 3, §16 `JTE-06`.
- **Cancellation Service:** `docs/knowledge/services/cancelled-lead.md`
- **Pack rules:** [`../README.md`](../README.md)

## 2. Objective

Stamp immutable safe correlation snapshots on Cancellation creation so a
later Booking delete cannot orphan the Job Number. Backfill only rows
with deterministic surviving evidence. Report the irreducible remainder.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`.
- **Prerequisites:** JTE-02 `complete` (timeline already reads the fields
  when present) **and** explicit write approval recorded in
  [`../PROGRESS.md`](../PROGRESS.md) Open questions.
- New branch only if the enhancement branch has already shipped; otherwise
  stack on the pack branch after approval.

## 4. Current-state evidence to verify

Reverified 2026-08-27 after JTE-05, report-only, before any apply:

| Database | Historical | Recoverable Booking links | Remainder | Already stamped |
| --- | --- | --- | --- | --- |
| `vantagemovers` | **48** | **11** | 37 | 0 |
| `testvantagemovers` | 25 | 4 | 21 | 0 |

Production 48 / 11 did not drift from the enhancement spec. Authorized apply
target is `testvantagemovers` only.

JTE-02 2026-08-27: assemble already attaches an orphan Cancellation when
`normalized_job_no_snapshot` / `job_no_snapshot` is present on an injected
row. The Mongo loader mapped those fields on booking-linked rows only and did
**not** query `cancelled_leads` by snapshot — the field was absent and had no
index. After the write + index land, add that hop. Do not collection-scan.

`CancelledLead` did not yet carry (pre-JTE-06):

```ts
job_no_snapshot: string | null;
normalized_job_no_snapshot: string | null;
lead_ref_snapshot: { model: "FormLead" | "CallLead"; id: string } | null;
booking_created_at_snapshot: Date | null;
```

## 5. Locked decisions and invariants at risk

- Snapshots are **immutable** after create.
- Timeline **must not guess** snapshots for historical rows.
- Backfill is report-first, then explicit authorized apply.
- No silent Job Number inference from contact or Sheet rows.

## 6. Deliverables and exact contract

1. Schema + create-path stamp on official Cancellation write.
2. Report-only historical analysis (counts, deterministic vs remainder).
3. Authorized backfill of deterministic rows only.
4. Named tests: `cancellation snapshot restores exact job correlation`
   (already reserved in specification §13.2 #15).

## 7. Explicitly out of scope

- Guessing snapshots for the irreducible remainder.
- WordPress receipts (JTE-07).
- Changing timeline attach rules to be optimistic.

## 8. Flags and runtime posture

Write path. Needs Owner approval. Test database first.

## 9. Migration and indexes

Report-first migration script. No implicit `autoIndex`. No production
apply from issue authorship alone.

## 10. Acceptance criteria

- [x] New Cancellations persist the four snapshot fields.
      Evidence: `CancelledLead persists the four correlation snapshot fields`;
      both official create paths spread `snapshotsForCancelledLeadCreate`.
- [x] Historical report names deterministic count and remainder.
      Evidence: test 25 / 4 / 21; production report-only 48 / 11 / 37.
- [x] Backfill applied only to deterministic rows, after approval.
      Evidence: test apply updated 4; remainder ids unchanged on verify.
- [x] Timeline uses snapshots when present and still refuses orphans
      without them.
      Evidence: named tests §13.2 #14–15; loader hop by indexed
      `normalized_job_no_snapshot`.
- [x] Named test 15 passes.
      Evidence: `cancellation snapshot restores exact job correlation`.

## 11. Required tests and commands

`pnpm test` focused on cancellations + jobNumberTimeline. Migration
report mode only until apply is authorized.

## 12. Live/staging verification

Test database report first. Production apply is a separate Owner action.

## 13. Rollback

Stop stamping new fields; leave existing snapshots. Backfill reverse only
if the apply report defined one.

## 14. Required completion handoff

Report: create-path files; inventory counts; remainder list (ids only);
apply authorization record.
