# JTE-02 — v2 evidence contract

> **Contract maturity: implementation-ready.** First half of session 2.
> Add the v2 event fields, dual clocks, correlation, activities, and the
> one new event kind. Keep every addition backward compatible.

## 1. Authority and required reading

- **Enhancement specification:** §4.1 (`source_received` only), §5, §6
  enhanced event fields and `activities`, §7, §13.2 tests 1–5, 14–17.
- **JTE-01 completion report:** `../reports/JTE-01-completion.md` — read
  before editing. The module interface is already the test surface.
- **Prototype specification:** event truth, locked headlines, walk-back,
  latest Decision attempt, Sheet Sync by entity ID.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

The module still returns `JobTimelineAssembleResult`. On `ok`, `page` is
an `EnhancedJobTimelinePage` that **keeps every v1 field** and adds
`schema_version: "job_timeline.v2"` plus the evidence fields in
specification §6. Outcome, stage assessments, attention, limitations, and
freshness evaluators are **declared and defaulted** only if needed for
types; JTE-03 fills them with real rules. Prefer shipping empty arrays /
honest placeholders over inventing those evaluators here — and say so in
the report if you stub them.

This issue owns: event enrichment, `source_received`, dual clocks,
correlation, causality / `activity_id`, and activity grouping that does
not delete rows.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** same `job-timeline-enhancement` branch.
- **Prerequisite:** JTE-01 `complete`.
- No Admin UI. Admin may still render the v1 fields.

## 4. Current-state evidence to verify

Reverify after JTE-01. At pack creation (2026-08-27):

- Eleven event kinds. `JOB_TIMELINE_TYPE_PRIORITY` is 10–110. Insert
  `source_received` as a new origin-stage kind **without** relabelling
  `lead_created`.
- Observation rows carry `receipt_id`. The loader does not load
  `granot_webhook_receipts` / `GranotObservationReceipt` as first-class
  evidence.
- RingCentral processed-call ledger is
  `ringcentral_processed_calls` via `getRingCentralCollectionName("processedCalls")`.
  Call Log cursor is `ringcentral_call_log_sync_state`. Neither is read
  today.
- WordPress has no durable independent form-submission receipt. Do not
  invent one.
- Cancellation rows have no `job_no_snapshot` / `lead_ref_snapshot` yet
  (JTE-06). Orphan cancellations stay unattached unless a durable snapshot
  already exists.

## 5. Locked decisions and invariants at risk

- **`source_received` only when a durable ingress fact exists.** Granot:
  Observation Receipt captured. RingCentral: processed qualified-call
  ledger entry. WordPress: no event; JTE-03 will name the limitation.
- **A stored Lead is still `lead_created`.** Never relabel it
  `source_received` to fill the origin stage.
- **No `inferred` evidence level.** Preserve internal `coverage` values
  and add `evidence_level`.
- **Default order remains `occurred_at ASC`, then type priority, then ID.**
  `event_at` stays for compatibility and equals `time.occurred_at`.
- **`activity_id` groups rows without collapsing them.** Official Booking
  and official Cancellation stay independently visible.
- **Orphan historical Cancellation** whose Booking is gone is `limited`
  correlation and is not attached unless a durable Job snapshot exists.
- Cap remains 250 events. If you hit the cap, emit the named truncation
  limitation shape even if JTE-03 owns the evaluator catalog — do not
  silently truncate.

## 6. Deliverables and exact contract

### 6.1 Types

Extend `types.ts` with specification §5–§6 types. Keep v1 fields. Add
`source_received` to `JobTimelineEventKind` with a type priority **below**
`lead_created` (recommended `5`) so oldest-first origin reads receipt
then Lead.

### 6.2 Loader additions

Mongo + memory adapters both grow, or the seam is fake:

- Granot Observation Receipts for observations already on the page.
- RingCentral processed-call ledger rows that correlate to the resolved
  Call Lead (safe fields only: qualification outcome, processed time,
  status — never phone, transcript, or recording).
- Call Log cursor watermark (JTE-03 publishes it as freshness; this issue
  may load it so JTE-03 does not reopen the adapter).

Do not read `OperationalEvent`. Do not query Google.

### 6.3 Projector / clocks / evidence / activities

Split or add files as specification §10.2 names them when the logic
lands: `projector.ts`, `evidence.ts`, `clocks.ts`. Keep the module
interface unchanged.

Each event gains `stage`, `evidence_level`, `time`, `summary`, `status`,
`correlation`, `causality`, and safe `evidence[]`.

Lead-update events stay **one per EntityChange**. Translate changed paths
into owner groups in `summary` / expanded evidence: Contact, Move,
Assignment, Attribution, Job identity, Booking state, Other. Values stay
hidden.

### 6.4 Golden pages

Synthetic golden pages for the main origin shapes that current data can
support: WordPress-born (no receipt event), Granot-born (receipt + Lead),
RingCentral-born (ledger + Lead), booked chain, cancelled chain. Store
them next to the module tests. JTE-03 and JTE-04 reuse them.

## 7. Explicitly out of scope

- Outcome precedence, stage-assessment labels, attention evaluators,
  limitation catalog, freshness object semantics — JTE-03. You may leave
  typed placeholders (`current_outcome: "unknown"`, empty `attention`)
  if that keeps the page type stable; document it.
- Admin UI.
- Cancellation snapshot writes (JTE-06).
- WordPress receipt writes (JTE-07).
- Move completion.

## 8. Flags and runtime posture

No new flag. Read-only. Prefer parallel bounded reads after the first
Job-scoped hop. No `$lookup`.

## 9. Migration and indexes

None required. If a new read is unusable without an index, report it and
do not apply to production.

## 10. Acceptance criteria

- [ ] `schema_version` is `"job_timeline.v2"` on `ok` pages.
- [ ] Named test: `source receipt and lead creation remain separate events`.
- [ ] Named test: `wordpress creation reports no invented receipt event`.
- [ ] Named test: `dual clocks order by occurred time and preserve recorded time`.
- [ ] Named test: `related receipt decision change and sheet rows share activity id`.
- [ ] Named test: `activity grouping does not remove original evidence events`.
- [ ] Named test: `orphan cancellation is not attached without durable job snapshot`.
- [ ] Named test: `event cap returns explicit truncation limitation`.
- [ ] Named test: `serialized v2 page contains no forbidden fields or contact`.
- [ ] All JTE-01 / prototype regressions still pass.
- [ ] v1 fields (`event_at`, `clock_field`, `coverage`, `headline`, safe
      `data`) remain populated.

## 11. Required tests and commands

```bash
pnpm test -- src/services/jobNumberTimeline src/routes/job-number-timeline-admin.routes.test.ts
pnpm test:prototype:job-number-timeline
pnpm typecheck
```

## 12. Live/staging verification

Not required. Golden pages are synthetic.

## 13. Rollback

Revert the v2 field population and loader additions. The module seam from
JTE-01 stays. No data was written.

## 14. Required completion handoff

Report: new event kind priority; which receipt/ledger reads landed; golden
page list; which §6 page-level fields were stubbed for JTE-03; named-test
output.

**Unblocks:** JTE-03.
