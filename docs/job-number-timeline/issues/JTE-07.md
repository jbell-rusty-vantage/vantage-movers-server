# JTE-07 — WordPress durable receipt capture

> **Contract maturity: specified and authorized on the test form path /
> `testvantagemovers` only.** Separate source-assurance issue. Does **not**
> block the enhanced timeline. Historical WordPress Leads without a receipt
> keep `WORDPRESS_RECEIPT_UNAVAILABLE`.

Owner source-assurance approval is recorded in
[`../PROGRESS.md`](../PROGRESS.md) Open questions (2026-08-27). Production
form injection, production index apply, and backfilling receipts onto
historical WordPress Leads remain unauthorized.

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

- **Repository:** `vantage-main-server` only.
- **`vantage-movers-clients`:** does **not** participate. Production form
  injection is unauthorized. The existing quote BFF already posts to
  `POST /api/v1/form-leads` without a submission key; this issue does not
  add one there.
- **`vantage-admin`:** touch only if a rendered golden or limitation
  actually changes. The no-receipt WordPress golden stays; Admin already
  renders `WORDPRESS_RECEIPT_UNAVAILABLE` from the server array.
- **Prerequisite:** source-assurance approval recorded in
  [`../PROGRESS.md`](../PROGRESS.md) Open questions.
- Stack on `job-timeline-enhancement`. No extra feature branches.
- JTE-02/03 already name the limitation; this issue flips WordPress from
  bounded to verified ingress **only when the new receipt exists**.

## 4. Current-state evidence to verify

Reverified 2026-08-27 before any runtime edit:

- No durable independent WordPress form-submission receipt collection
  exists. Public `POST /api/v1/form-leads` → `runExistingCreateFormLead`
  → `createFormLeadInTransaction` assigns `ingestion_origin:
  "wordpress_form"`. Lead save is the first Vantage persist.
- `createFormLeadSchema` is `.strict()` and has no submission-key field.
  Incoming `lid` is Lead identity, not a source receipt.
- Timeline `emitSourceReceived` has Granot (loaded Observation Receipt)
  and RingCentral (qualified processed-call ledger) only. No WordPress
  branch.
- `evaluateWordpressReceiptUnavailable` drops the limitation when **any**
  `source_received` exists. Enhancement §7.1 / §8 require an independent
  **WordPress** submission receipt. JTE-07 must not treat a later Granot
  receipt as WordPress proof.
- `goldenWordpressRows` / `wordpressRows()` job `9001001` stays the
  no-receipt golden.
- CRM Posting still sends `FormLead.ref_no` as `leadno`. Sheet Sync still
  enqueues after Lead persist. Neither may change.

## 5. Locked decisions and invariants at risk

- Receipt is captured **before** Lead creation, not inferred from the
  Lead.
- Idempotent on the submission key. Duplicate posts do not create a
  second receipt.
- Timeline must not emit WordPress `source_received` until this receipt
  exists for that Lead.
- Historical WordPress Leads without a receipt still show
  `WORDPRESS_RECEIPT_UNAVAILABLE`. Never invent an event.
- Do not weaken CRM Posting or Sheet Sync invariants.
- Fail closed: if the authorized path attempts capture and the write
  fails, Lead create does not run.
- Do not reuse `granot_webhook_receipts` or the Granot processor.

## 6. Deliverables and exact contract

### 6.1 Authored schema (after Owner approval; implement this, do not invent another)

Collection: `wordpress_form_submission_receipts`.
Model: `WordpressFormSubmissionReceipt`.
`autoIndex: false`. No contact, payload, CRM, or Sheet fields.

```ts
type WordpressFormSubmissionReceipt = {
  _id: ObjectId;
  source_system: "wordpress";
  submission_key: string; // unique idempotency key; request-supplied
  received_at: Date;      // capture time; before Lead create
  processing_status: "received" | "lead_created";
  lead_ref: { model: "FormLead"; id: ObjectId } | null;
  form_path: "test";      // this authorization writes "test" only
  createdAt: Date;
  updatedAt: Date;
};
```

| Field | Rules |
| --- | --- |
| `source_system` | Literal `wordpress`. Immutable after insert. |
| `submission_key` | Incoming `wordpress_submission_key` on public Form Lead create. 8–128 trimmed characters. Never inferred from a persisted Lead, never minted from phone / email / payload / Tracking Reference / `lid`. |
| `received_at` | Server `tx.now` at capture. Immutable after insert. |
| `processing_status` | `received` at insert; `lead_created` only after `lead_ref` is attached. No other transitions. |
| `lead_ref` | Write-once `null` → `{ model: "FormLead", id }`. Not guessed for historical Leads. |
| `form_path` | Literal `test` on this authorized write. Immutable. |

Indexes (report-first; apply on `testvantagemovers` only because the write
is unusable without uniqueness, and the timeline hop is unusable without
the Lead-ref index):

```ts
{ name: "wordpress_form_submission_receipt_submission_key_unique",
  key: { submission_key: 1 }, unique: true }
{ name: "wordpress_form_submission_receipt_lead_ref",
  key: { "lead_ref.id": 1 }, unique: false,
  partialFilterExpression: { "lead_ref.id": { $type: "objectId" } } }
```

### 6.2 Capture seam

- Public WordPress Form Lead path only (`ingestion_origin ===
  "wordpress_form"`).
- Authorized write when `TEST_MODE` and the connected database matches
  `^testvantagemovers(?:_[a-z0-9]+)?$` **and** the request supplied
  `wordpress_submission_key`.
- Capture **before** `FormLead.save`. Attach `lead_ref` after persist in
  the same transaction when a session exists.
- Same key + existing `lead_ref` whose Lead still exists: return that
  Lead. Do not insert a second receipt, do not create a second Lead, do
  not enqueue a second Sheet Sync job, do not CRM-post again.
- Same key + `lead_ref` null (prior capture without a completed Lead):
  continue Lead create and attach.
- Unauthorized path, missing key, or production database: no write.
  Timeline stays on the limitation.
- `wordpress_submission_key` is stripped before Form Lead persist. It is
  not a Lead field.

### 6.3 Timeline

- Loader hops `wordpress_form_submission_receipts` by indexed
  `lead_ref.id` for the resolved Form Lead. No collection scan. Do not
  read this collection as Granot receipts.
- Emit `source_received` with `ingress: "wordpress"` only when that
  receipt row is loaded.
- `WORDPRESS_RECEIPT_UNAVAILABLE` stays until a **WordPress**
  `source_received` exists. A later Granot or RingCentral receipt does
  not clear it.
- Flip only goldens that load the new fact. Keep `goldenWordpressRows`
  (`9001001`) as the no-receipt WordPress golden.

## 7. Explicitly out of scope

- Google destination verification.
- Daily Assurance population completeness.
- Backfilling fake receipts onto historical WordPress Leads.
- Production form injection (`vantage-movers-clients` quote / WordPress).
- Production index apply.
- Changing CRM Posting (`leadno` = `FormLead.ref_no`) or Sheet Sync
  tab / outbox semantics.

## 8. Flags and runtime posture

New write path. Fail closed. Test database first. No feature flag name
beyond `TEST_MODE` + test database + request key.

## 9. Migration and indexes

Unique idempotency index plus Lead-ref hop index. Report-first CLI.
Apply on the test database only; the write cannot collapse duplicates
without the unique index.

## 10. Acceptance criteria

- [x] Receipt exists before Lead create on the authorized path.
      Evidence: named test `receipt exists before Lead create on the
      authorized path`; capture insert runs before `createLead`.
- [x] Duplicates collapse on the idempotency key.
      Evidence: named test `duplicates collapse on the idempotency key`;
      test-DB unique index applied.
- [x] Timeline emits `source_received` only when the receipt exists.
      Evidence: `timeline emits wordpress source_received only when the
      receipt exists`; `ingress: "wordpress"`.
- [x] Historical WordPress Leads without a receipt still show the
      limitation, never a invented event.
      Evidence: `wordpress creation reports no invented receipt event`;
      `wordpress-born golden includes wordpress receipt limitation`;
      test-DB receipt_count 0.

## 11. Required tests and commands

Focused Form Lead + timeline tests. Typecheck in every repo touched.

Named behaviors:

- `receipt exists before Lead create on the authorized path`
- `duplicates collapse on the idempotency key`
- `timeline emits wordpress source_received only when the receipt exists`
- keep `wordpress creation reports no invented receipt event`
- keep `wordpress-born golden includes wordpress receipt limitation`

## 12. Live/staging verification

Test form path only. No production form injection from this issue.

## 13. Rollback

Stop capturing receipts; timeline falls back to the limitation. Do not
delete historical receipts if any were written.

## 14. Required completion handoff

Report: schema, capture seam, idempotency evidence, timeline golden
update, remaining historical limitation count.
