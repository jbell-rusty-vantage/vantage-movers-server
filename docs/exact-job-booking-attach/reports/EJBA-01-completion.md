---
type: Completion report
title: EJBA-01 — Job-only employee match and rematch
status: complete
closed: 2026-09-08
---

# EJBA-01 completion

Repo: `vantage-main-server`. Branch: `exact-job-booking-attach`. No commit, push, or deploy.

## What landed

Exact Job Booking Attach is the only automatic attach on Employee Booking Submission and rematch.

- Allowed rules: `call_job_no_exact`, `form_job_no_exact`.
- Default policy version: `exact-job-v1`.
- Parser rejects `form_lid_exact`, `form_contact_triple_exact`, `form_email_phone_exact`, `channel_phone_exact`.
- `none` still disables automatic attach.
- Rematch default reasons: `matching_unavailable,no_match`.
- Rematch / owner-refresh snapshots use `snapshotEmployeeBookingAutoMatchPolicy()` (parsed config). The old five-rule fallback string is gone.
- Candidate query now also loads Form Lead `normalized_job_no`.
- `BookedLead.auto_match.rule` enum gained `form_job_no_exact`. Retired names stay on the schema so historical documents still validate.

## Command results

`pnpm typecheck` (exit 0):

```text
> vantage_movers_server@1.0.0 typecheck C:\Users\Pinda\Proyectos\vantage\vantage-main-server
> tsc --noEmit
```

`pnpm test -- src/services/employeeBookings src/config/domain` is the package.json `test` script plus those paths, so it would also run the full `src/**/*.test.ts` glob and live-slow `src/config/domain/cpl.test.ts` (operations-registry reads, ~80s per case). Recorded invocation instead (covers every `src/services/employeeBookings/**/*.test.ts` file plus the two domain files this issue changed):

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/employeeBookings/leadMatchEvaluator.test.ts \
  src/services/employeeBookings/leadCandidateQueries.test.ts \
  src/services/employeeBookings/reconciliationRematch.service.test.ts \
  src/services/employeeBookings/bookingLeadReconciliation.service.test.ts \
  src/services/employeeBookings/reconciliationPolicy.test.ts \
  src/services/employeeBookings/getEmployeeBookingOptions.service.test.ts \
  src/services/employeeBookings/migrationApplySafety.test.ts \
  src/services/employeeBookings/migrationPreflight.test.ts \
  src/config/domain/employeeBookingMatching.test.ts \
  src/config/domain/bookingReconciliation.test.ts
```

```text
✔ getBookingReconciliationConfig defaults rematch reasons to matching_unavailable and no_match
✔ parseEmployeeBookingAutoMatchRules rejects retired phone, LID, and email rules
✔ getEmployeeBookingMatchingConfig defaults to Exact Job Booking Attach
✔ snapshotEmployeeBookingAutoMatchPolicy uses parsed config, not a raw env string
✔ candidate query tags a unique Form Lead Job Number as job_no
✔ evaluateEmployeeBookingMatch auto-links a unique Call Lead Job Number
✔ evaluateEmployeeBookingMatch auto-links a unique Form Lead Job Number on form channel
✔ evaluateEmployeeBookingMatch leaves same-phone no-job as pending no_match
✔ evaluateEmployeeBookingMatch never auto-links LID, email, or phone under Exact Job Booking Attach
✔ evaluateEmployeeBookingMatch rematch attaches only after a unique job appears
✔ rematch snapshots Exact Job Booking Attach, not the retired five-rule list
✔ rematch evaluator attaches only when a unique Call Lead job appears
ℹ tests 52
ℹ pass 52
ℹ fail 0
ℹ duration_ms 5571.8379
```

No customer names, phones, or secrets in the recorded output.

## §9 Employee evidence

| Spec test | Evidence |
| --- | --- |
| Unique Call Lead Job Number still links | `leadMatchEvaluator.test.ts` — `call_job_no_exact` |
| Unique Form Lead Job Number on form channel links | `leadMatchEvaluator.test.ts` + Form Lead `job_no` query in `leadCandidateQueries.test.ts` |
| Same phone, no job → pending `no_match` | Evaluator + rematch tests. No new submit HTTP 201 test; `submitEmployeeBooking` still maps pending → Leadless Booking + case |
| Parser rejects `channel_phone_exact` / LID / email+phone | `employeeBookingMatching.test.ts` throws unknown |
| Rematch attaches only when a unique job appears | `reconciliationRematch.service.test.ts` + evaluator rematch case; phone-only Call Lead stays `no_match` |

## Current-state drift

Issue §4 pre-change bullets were still true at pickup (five-rule default, `employee-booking-v1`, rematch reasons `matching_unavailable` only, rematch calls evaluator + query). They are now updated to the landed state. Extra pre-change facts that matched the coordinator brief: hardcoded five-rule fallbacks in rematch and owner-refresh snapshots; no `form_job_no_exact` on the employee matcher.

Local `scripts/dev_ops/.reconcile.env` still listed the old five-rule string (gitignored). Updated on disk so a local rematch run cannot re-enable phone rules or throw at parse.

## What this issue did not do

- Precise Booking Form / `resolveBookingSourceLead` / leadless Owner create / `owner_booking` (EJBA-02)
- Admin UI (EJBA-03)
- Knowledge bodies (EJBA-04). `docs/knowledge/services/employee-bookings.md` still describes the five-rule list and rematch reasons `matching_unavailable` only
- Confirm Granot Booking (`confirmAttachment.ts` / `HIGH_CONFIDENCE_BOOKING_MATCH_METHODS` untouched)
- Best Relocation import
- `identity.ts`
- Connect fence
- Public employee throttle
- Minting Unmatched Call Leads
- A new `submitEmployeeBooking` HTTP integration test

## EJBA-02 risks

- Precise Form must ask this same job-only policy. Do not add a second phone path in `resolveBookingSourceLead`.
- Employee submit still opens a pending case on lost claim / no unique job. Owner create should do the same with `origin=owner_booking`, not reuse employee sheet operation names.
- Knowledge is stale until EJBA-04.
