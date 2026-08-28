# JTE-07 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-main-server`
(existing pack branch; no extra feature branches; not pushed until pack
ship). `vantage-movers-clients` did not participate. `vantage-admin` was
not touched: the no-receipt WordPress golden still renders
`WORDPRESS_RECEIPT_UNAVAILABLE` from the server array.

Owner source-assurance authorization was this session's message: new
WordPress receipt write path on the test form path / `testvantagemovers`
only. Unique idempotency index is report-first; applied on the test DB
because the write cannot collapse duplicates without it. Production form
injection, production index apply, and historical backfill remain
unauthorized.

## Schema (authored in JTE-07.md, then implemented)

Collection `wordpress_form_submission_receipts`. Not
`granot_webhook_receipts`. No contact, payload, CRM, or Sheet fields.

| Field | Contract |
| --- | --- |
| `source_system` | `wordpress`, immutable |
| `submission_key` | request `wordpress_submission_key` (8–128). Never inferred from a Lead, `lid`, phone, email, payload, or Tracking Reference |
| `received_at` | `tx.now` at capture, before Lead persist |
| `processing_status` | `received` → `lead_created` after `lead_ref` |
| `lead_ref` | write-once `{ model: "FormLead", id }` |
| `form_path` | `test` only on this authorization |

## Capture seam

Public WordPress Form Lead path (`createFormLeadInTransaction` with
`ingestion_origin: "wordpress_form"`). Write only when `TEST_MODE` and
the connected database matches `^testvantagemovers(?:_[a-z0-9]+)?$`
**and** the request supplied `wordpress_submission_key`. Capture runs
before `FormLead.save`. Fail closed: capture failure aborts Lead create.

Same key with an existing `lead_ref` whose Lead still exists: return that
Lead. No second receipt, no second Lead, no second Sheet Sync job, no
second CRM Post. `wordpress_submission_key` is stripped before Form Lead
persist.

CRM Posting still sends `FormLead.ref_no` as `leadno`. Sheet Sync still
enqueues only on a new persist.

| File | Role |
| --- | --- |
| `docs/job-number-timeline/issues/JTE-07.md` | Authored schema and seam |
| `src/models/WordpressFormSubmissionReceipt.ts` | Collection, write-once fields, `autoIndex: false` |
| `src/services/leads/wordpressFormSubmissionReceipt.ts` | Authorization, key, capture-then-create |
| `src/services/leads/formLead.service.ts` | Public WordPress create hook |
| `src/validation/v1/leads.validation.ts` | Optional `wordpress_submission_key` |
| `src/services/domainCommands/existingWrites.ts` | Skip EntityChange on reused Lead |
| `src/services/jobNumberTimeline/assemble.ts` | WordPress `source_received` only from loaded receipt |
| `src/services/jobNumberTimeline/attention.ts` | Limitation until **WordPress** ingress exists |
| `src/services/jobNumberTimeline/mongo-evidence-loader.ts` | Hop by indexed `lead_ref.id` |
| `scripts/migrations/wordpress-form-submission-receipts.ts` | Report-first indexes |

## Idempotency evidence

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/leads/wordpressFormSubmissionReceipt.test.ts
# 4 pass, 0 fail

✔ receipt exists before Lead create on the authorized path
✔ duplicates collapse on the idempotency key
✔ unauthorized or keyless WordPress create does not write a receipt
✔ capture failure aborts Lead create
```

## Timeline golden

`goldenWordpressRows` / `wordpressRows()` job `9001001` stays the
no-receipt WordPress golden. `wordpressReceiptRows()` is the only golden
that loads the new fact.

```text
✔ wordpress creation reports no invented receipt event
✔ wordpress-born golden includes wordpress receipt limitation
✔ timeline emits wordpress source_received only when the receipt exists
✔ later Granot receipt does not clear wordpress receipt limitation
```

## Index report / apply

Report-only, before apply:

| Database | Receipts | Unique index | Lead-ref index | Historical backfill |
| --- | --- | --- | --- | --- |
| `testvantagemovers` | **0** | missing | missing | 0 (not authorized) |

Apply (authorized test DB only):

| Fact | Value |
| --- | --- |
| Authorizing message | Owner source-assurance approval for JTE-07 on the test form path / `testvantagemovers` only |
| Recorded in | `PROGRESS.md` Open questions, 2026-08-27 |
| Apply command | `TEST_MODE=true pnpm migration:wordpress-form-submission-receipts -- --apply --confirm-production=testvantagemovers` |
| Database | `testvantagemovers` |
| Indexes created | `wordpress_form_submission_receipt_submission_key_unique`, `wordpress_form_submission_receipt_lead_ref` |
| Rows backfilled | 0 |
| Production apply | not run |
| Gitignored manifests | `scripts/output/wordpress-form-submission-receipts/report-1787876259717.json`, `apply-1787876268087.json`, `verify-1787876270826.json` |

Verify after apply: both indexes present; receipt_count 0.

## Remaining historical limitation count

**Every historical WordPress Lead still lacks a receipt.** Test-DB
`wordpress_form_submission_receipts` count is **0**. No backfill was
authorized. Those pages keep `WORDPRESS_RECEIPT_UNAVAILABLE`. Never an
invented `source_received`.

## Named-test output

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  "src/services/jobNumberTimeline/**/*.test.ts" \
  "src/services/leads/wordpressFormSubmissionReceipt.test.ts" \
  "src/services/leads/formLead.service.test.ts" \
  "src/validation/v1.validation.test.ts" \
  "src/services/domainCommands/domainCommands.test.ts" \
  "scripts/migrations/wordpress-form-submission-receipts.lib.test.ts"
# 157 pass, 0 fail

pnpm typecheck
# tsc --noEmit exit 0
```

## What this issue did not do

- Production form injection (`vantage-movers-clients` quote / WordPress).
- Production index apply or `vantagemovers` writes.
- Backfilling receipts onto historical WordPress Leads.
- Changing CRM Posting or Sheet Sync semantics.
- Treating a later Granot receipt as WordPress proof.
- Touching `vantage-admin` (no-receipt golden / limitation copy unchanged).
- Google destination verification, Daily Assurance, `/daily`, notifications.

JTE-01 residual stands: CLI company/granularity mismatch prints
`filtered_out` (exit 0). JTE-02 residuals stand: `assembled_at` /
qualified RingCentral receipts. JTE-05 residual stands: v1 fallback kept.

No Command, EntityChange, case, outbox row, or notification was added
beyond the existing official Form Lead create path (reuse skips those).
