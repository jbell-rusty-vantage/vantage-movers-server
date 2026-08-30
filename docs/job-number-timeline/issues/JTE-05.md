# JTE-05 — Proof, security, accessibility, performance, deep links

> **Contract maturity: implementation-ready.** Session 4. Certify the
> enhanced timeline and add deep links from surfaces that already know a
> Job Number. No new semantics.

## 1. Authority and required reading

- **Enhancement specification:** §9.6, §12, §13 (especially §13.3),
  §15 Phase 4, §17 remaining boxes.
- **JTE-04 completion report** and JTE-01–03 reports.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

Prove the page is safe, readable, and fast enough to be the canonical
single-Job owner read, then let existing Owner surfaces link to
`/job-timeline?job=`. Daily Assurance is not built; the link contract
must be ready for it.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` and `vantage-admin`.
- **Branch:** same pack branch in both.
- **Prerequisite:** JTE-04 `complete`.
- Live production reads require explicit user approval and the existing
  CLI confirm flag. Default is masked reads against `testvantagemovers`.

## 4. Current-state evidence to verify

Reverified 2026-08-27 after JTE-04 on `job-timeline-enhancement` in both
repos.

- `buildJobTimelineHref` already exists. Home overview and Granot
  navigation already link to `/job-timeline`.
- `/intakes` reference drawers still mount forensic
  `components/granot-lifecycle/job-timeline.tsx`.
- Call Lead, Booking, and Cancellation list/detail show Job Numbers as
  plain text and do not deep-link to the owner timeline.
- Form Lead list/detail columns do not include `job_no` today even when
  the record has one. This issue adds the Job cell and link only when
  `job_no` is present — not a catalog.
- Owner Daily (`/daily`) does not exist. Do not create it.
- Performance target in the spec is a **recommended** warm p95 under
  750 ms after measurement — measure first, do not invent an alert.
- Owner vs Admin 403 tests already exist on the server route and Admin
  proxy; this issue re-runs them.
- Named forbidden-field test covers the WordPress golden only; this
  issue serializes all v2 goldens.

## 5. Locked decisions and invariants at risk

- **No contact-based timeline search. No Job catalog.**
- **Deep links are URL-only:** `/job-timeline?job=<typed-or-normalized-job-number>`.
- **Live proof is read-only, masked, and count-stable.** No collection
  count may change during the run.
- **Owner-only at both gates**, independently re-proven.
- **Do not remove v1 client fallback** until you have evidence every
  deployed client consumes v2. This issue may keep the fallback.
- Timeline still sends no notification.

## 6. Deliverables and exact contract

### 6.1 Deep links

Add `buildJobTimelineHref({ job })` where the surface already has a Job
Number and an Owner can click it:

- Lead search / lead detail (Form and Call) when `job_no` is present
- Booking list/detail
- Cancellation list/detail
- Intake workbench / reference when the case has a Job Number (in
  addition to, not instead of, the forensic drawer)
- Keep the existing Home and Granot-nav entries

Do not add links from employee-facing or non-Owner pages.

### 6.2 Security certification

Serialize v2 goldens and at least one live masked page (test DB, or
production only with approval). Assert the forbidden-field list from
specification §12. Re-run Owner vs Admin 403 on server and Admin proxy.

### 6.3 Accessibility

Keyboard path through search, stage strip, attention, filters, expand
evidence, proof boundaries. Screen-reader names on outcome, attention
count, and evidence buttons. Color is not the only status cue.

### 6.4 Live masked proof

A read-only script or documented CLI sequence that answers specification
§13.3. Write `reports/JTE-05-live-proof.md` (redacted). Required answers:

- each origin shape can render
- at least one pre-Job-number Lead chain walks back
- at least one chain includes Booking intake and official Booking
- at least one chain includes Cancellation intake
- at least one historical chain includes official Cancellation
- activity grouping preserves event counts
- attention codes correspond to inspected source rows
- no database collection count changes
- no forbidden data in serialized output

### 6.5 Performance

Measure warm p95 on the test database (or approved production). Record
the number. Do not turn 750 ms into an alert in this issue.

## 7. Explicitly out of scope

- JTE-06 / JTE-07 writes.
- Removing v1 fallback from all clients.
- Daily Assurance module, notifications, Google read-back.
- Feature-flag work unless a rollout gate is explicitly requested.

## 8. Flags and runtime posture

No new flag by default. Owner-only remains the gate.

## 9. Migration and indexes

None unless measurement proves a missing index. Report-first only; no
production apply.

## 10. Acceptance criteria

- [x] Specification §17 boxes that remain open are evidenced or honestly
      leftover (JTE-06/07 items stay leftover).
- [x] Deep links land on `/job-timeline?job=` and do not invent a catalog.
- [x] Owner-only proven again at both gates.
- [x] Live proof report exists, redacted, count-stable.
- [x] Forbidden-field scan is green on goldens and the live sample.
- [x] Keyboard and screen-reader checks recorded.
- [x] Latency measurement recorded; no alert added from an unmeasured
      target.
- [x] `pnpm test && pnpm typecheck` in both repos; Admin `pnpm lint`.

## 11. Required tests and commands

```bash
cd vantage-main-server && pnpm test && pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm lint
pnpm prototype:job-number-timeline -- render --job-no <redacted-test-job>
```

Production render, if authorized:

```bash
pnpm prototype:job-number-timeline -- --confirm-production-db=vantagemovers render --job-no <redacted>
```

## 12. Live/staging verification

This issue **is** the verification. Preview deploys only if the user
asks. Default proof target is `testvantagemovers`.

## 13. Rollback

Remove the new deep-link buttons first. The module and UI remain. No
data to reverse.

## 14. Required completion handoff

Report: deep-link call sites; live proof path; count-stability evidence;
forbidden-field scan; a11y notes; measured latency; leftover §17 items.

**Unblocks:** later Daily Assurance deep links. Does not unblock JTE-06
or JTE-07 — those need separate approval.
