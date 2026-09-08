# EJBA-01 — Job-only employee match and rematch

> **Contract maturity: implementation-ready.** Session 1. Exact Job
> Booking Attach on Employee Booking Submission and rematch. **No
> Precise Booking Form. No Connect fence.**

## 1. Authority and required reading

- **Pack specification:** [`../exact-job-booking-attach-specification.md`](../exact-job-booking-attach-specification.md)
  — §3, §4.1, §6, §8, §9 Employee tests. Wins on the rule list.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** [Exact Job Booking Attach](../../../../CONTEXT.md),
  [Employee Booking Submission](../../../../CONTEXT.md),
  [Booking Lead Reconciliation Case](../../../../CONTEXT.md)
- **Seams:** `employeeBookingMatching.ts`, `leadMatchEvaluator.ts`,
  `submitEmployeeBooking.service.ts`, `reconciliationRematch.service.ts`,
  `bookingReconciliation.ts` (config defaults)

## 2. Objective

Employee Booking Submission attaches a Lead only when a unique Job
Number matches the preferred-channel Lead. Phone, LID, email, and name
never attach. The Booking still files. Rematch uses the same policy and
may attach later when a unique job appears (`no_match` is a default
rematch reason).

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current server desk branch, or `exact-job-booking-attach`
  if that is how this desk is isolated.
- **Prerequisites:** none. This is the only startable issue.

## 4. Current-state evidence to verify

Observed 2026-09-08; **reverify at implementation**.

- Default rules are the five-rule list including `channel_phone_exact`.
- Policy version default is `employee-booking-v1`.
- Rematch default reasons are only `matching_unavailable`.
- Rematch calls `evaluateEmployeeBookingMatch` +
  `queryEmployeeBookingCandidates`.

## 5. Locked decisions

- Default enabled rules: `call_job_no_exact,form_job_no_exact`.
- Policy version default: `exact-job-v1`.
- Old rule names are rejected by the parser (no phone backdoor).
- `none` still means no automatic attach.
- Rematch default reasons: `matching_unavailable,no_match`.
- Lost claim still opens a pending case. Do not fail the Booking.

## 6. Deliverables

1. Add `form_job_no_exact` to the allowed-rule enum. Implement it as
   unique Form Lead job at exact Source Granularity, form channel only.
2. Remove the four retired rules from the allowed list (or reject them
   at parse). Update evaluator + tests.
3. Bump default policy version and rematch reason default.
4. Tests in specification §9 Employee.

## 7. Out of scope

- `resolveBookingSourceLead`, leadless Owner create, `owner_booking`
  (EJBA-02).
- Admin form (EJBA-03).
- Knowledge bodies (EJBA-04).
- Confirm Granot Booking. Best Relocation import.

## 8. Acceptance criteria

- [ ] Unique Call Lead job still links.
- [ ] Unique Form Lead job on form channel links.
- [ ] Same phone, no job → 201 pending, Leadless, case `no_match`.
- [ ] Parser rejects `channel_phone_exact` (or equivalent tested refuse).
- [ ] Rematch attaches only after a unique job appears.
- [ ] `pnpm test` and `pnpm typecheck` recorded.

## 9. Commands

```bash
pnpm test -- src/services/employeeBookings src/config/domain
pnpm typecheck
```
