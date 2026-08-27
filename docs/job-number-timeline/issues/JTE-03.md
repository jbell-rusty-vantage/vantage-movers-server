# JTE-03 — Outcome, stages, attention, limitations, freshness

> **Contract maturity: implementation-ready.** Second half of session 2.
> The server becomes the only evaluator of current outcome, stage
> assessment, attention, and limitations.

## 1. Authority and required reading

- **Enhancement specification:** §3 (owner questions), §4.2–4.3, §6 page
  fields, §8, §13.2 tests 6–13.
- **JTE-02 completion report:** which page-level fields were stubbed.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

Fill `current_outcome`, `summary`, `freshness`, `stage_assessments`,
`attention`, and `limitations` using one evaluator per code, inside the
module. Admin must not recreate the conditions. After this issue the
server can answer every section-3 question that current data supports,
and it names every unsupported edge.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** same pack branch.
- **Prerequisite:** JTE-02 `complete`.
- No Admin UI. Produce golden pages JTE-04 can render.

## 4. Current-state evidence to verify

Reverify after JTE-02.

- JTE-02 2026-08-27: `ok` pages are `job_timeline.v2`. Event fields,
  `source_received`, dual clocks, correlation, and activities are real.
  `current_outcome` is the stub `"unknown"`; `stage_assessments` /
  `attention` are empty; `limitations` is empty except
  `TIMELINE_TRUNCATED`. `freshness.ringcentral_covered_through` may be
  filled; `ringcentral_cursor_lag_seconds` is `null`. Golden pages live
  in `src/services/jobNumberTimeline/golden-pages.ts`.
- v1 `page.coverage` still uses present/absent chips. Keep those fields
  for compatibility. Owner-facing meaning moves to `stage_assessments`.
- Attention and limitation catalogs are specification §8. Do not invent
  extra codes in this issue.
- RingCentral cursor and Google destination are proof boundaries, not
  per-Job failures.
- Move completion is **not** a stage. The header/summary may carry the
  `MOVE_COMPLETION_UNAVAILABLE` limitation.

## 5. Locked decisions and invariants at risk

- **Outcome is not last-event-wins.** Specification §4.2 precedence is
  exact. An intake case never becomes the official outcome.
- **Expectation-aware stages.** No text because policy blocked it is
  `not_applicable`, not attention. No cancellation on an active Booking
  is `not_started`, not a gap. Google row not read back is delivery
  `unverifiable` even when every outbox job is `synced`.
- **Attention is actionable for this Job.** Limitations are system proof
  boundaries and may not be actionable.
- **Every code has one server evaluator.** Admin only displays the arrays.
- **`assembled_at` is set after all reads complete.**
- **`freshness.google_destination_readback` is always `"not_performed"`**
  in this pack.
- **`freshness.consistency` is `"multi_query_best_effort"`.** Always emit
  `MULTI_QUERY_READ`.

## 6. Deliverables and exact contract

### 6.1 Files

As named in specification §10.2:

```text
src/services/jobNumberTimeline/outcome.ts
src/services/jobNumberTimeline/attention.ts
```

Stage assessment can live in `outcome.ts` or `projector.ts`. Do not put
evaluation in the route or in Admin.

### 6.2 Outcome

Implement `JobTimelineOutcome` exactly. Named cases:

- official Cancellation after official Booking → `cancelled`
- open Cancellation intake + official Booking → `cancellation_intake_open`
- official Booking without official Cancellation → `booked`
- open Booking intake without official Booking → `booking_intake_open`
- resolved Lead with none of the above → `lead_active`
- incompatible official facts or chronologies → `contradictory` +
  `CONTRADICTORY_OFFICIAL_STATE`
- unresolved Lead and no official fact → `unknown`

### 6.3 Stage assessments

One `StageAssessment` per stage in §4.1. Labels follow specification §9.2
recommended set. `reason_code` is stable and testable.

### 6.4 Attention and limitations

Implement every initial code in §8. `SHEET_SYNC_PENDING_TOO_LONG` uses a
module-local configured age threshold with a tested default; do not read
`process.env` in the evaluator if a constant will do.

### 6.5 Freshness and summary

```ts
freshness: {
  mongo_read_at: string;
  consistency: "multi_query_best_effort";
  ringcentral_covered_through: string | null;
  ringcentral_cursor_lag_seconds: number | null;
  google_destination_readback: "not_performed";
}
```

`summary` carries headline, origin label, latest activity time, event
count, and attention count.

### 6.6 Golden pages for Admin

Update JTE-02 goldens so each origin/outcome shape has filled assessments
and expected attention/limitation codes. JTE-04 treats these as fixtures.

## 7. Explicitly out of scope

- Admin rendering (JTE-04).
- Notification delivery or acknowledgement.
- Google Sheets read-back.
- New attention codes beyond §8.
- JTE-06 snapshot writes. If a snapshot field is already present, you may
  read it.

## 8. Flags and runtime posture

No new flag. Read-only. Short cache by normalized Job Number + source
scope is optional and must never cross authorization scopes; skip it
unless tests need it.

## 9. Migration and indexes

None.

## 10. Acceptance criteria

- [ ] Named test: `text policy skip is not applicable rather than attention`.
- [ ] Named test: `open booking intake yields active stage and no official booking`.
- [ ] Named test: `resolved finalizing booking case without fact yields attention`.
- [ ] Named test: `ordinary booked job has no cancellation attention`.
- [ ] Named test: `resolved release case without cancellation yields attention`.
- [ ] Named test: `official cancellation determines cancelled outcome`.
- [ ] Named test: `contradictory official chronology yields contradictory outcome`.
- [ ] Named test: `synced sheet job still reports google destination unverified`.
- [ ] WordPress-born golden includes `WORDPRESS_RECEIPT_UNAVAILABLE`.
- [ ] RingCentral-born golden bounds confidence with the cursor fields.
- [ ] `MOVE_COMPLETION_UNAVAILABLE` and `MULTI_QUERY_READ` appear as
      limitations, not stages or events.
- [ ] Admin-facing arrays are complete enough that JTE-04 can render
      without recomputing codes.
- [ ] JTE-01 and JTE-02 regressions still pass.

## 11. Required tests and commands

```bash
pnpm test -- src/services/jobNumberTimeline src/routes/job-number-timeline-admin.routes.test.ts
pnpm typecheck
```

## 12. Live/staging verification

Not required.

## 13. Rollback

Revert evaluator files. v2 event fields from JTE-02 stay. No data written.

## 14. Required completion handoff

Report: outcome decision table with fixture IDs; every attention and
limitation code with the test that hits it; golden page paths for JTE-04;
confirmation that the route still only calls `module.read`.

**Unblocks:** JTE-04.
