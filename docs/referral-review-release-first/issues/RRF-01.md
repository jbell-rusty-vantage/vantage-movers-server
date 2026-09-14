# RRF-01 — Server policy helper + tests

> **Contract maturity: implementation-ready.** Session 1. Relax
> `assertActiveReferralPolicy` action check. **No Admin UI. Do not
> change Create Referral Booking minting.**

## 1. Authority and required reading

- **Pack specification:** [`../referral-review-release-first-specification.md`](../referral-review-release-first-specification.md)
  — §1, §3–§5, §8, §9 AC-RRF-01–06, §11. Wins on the helper.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Service:** [`../../knowledge/granot-lifecycle/booking-reconciliation.md`](../../knowledge/granot-lifecycle/booking-reconciliation.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

Owner No Action and Update Existing Booking succeed on an open
Referral `review_existing_booking` whose `evidence[0]` is a Release
Granot Observation, when the first-evidence Decision still names a
live Referral Registry source. Confirm Granot Cancellation still
requires latest action `release`. Create Referral Booking still
refuses first-evidence Release.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current server desk branch, or
  `referral-review-release-first` if isolating. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- No 21st.dev in this issue.
- No commit, push, deploy, or live Mongo write unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-14; **reverify before coding.**

- `assertActiveReferralPolicy` in
  `src/services/granotLifecycle/bookingOwnerCommands.ts` loads
  `row.evidence[0]` and requires
  `observation.booking_action?.normalized !== "booked"` (fail when
  not Booked).
- Callers: `applyNoAction` when `!caseRow.source_scope`;
  `applyUpdate` / `applyConfirmCancellation` when
  `is_referral_booking === true`.
- `createReferralBooking` in `referralBooking.ts` inlines the same
  Booked check. Leave it.
- `assertBookingIntakeCancelAllowed` already requires latest action
  `release`. Leave it.
- Existing replica seeds for Referral review use Booked
  `evidence[0]`. No test locks Release-first review to 409.

## 5. Locked decisions and invariants at risk

- First-evidence chain stays `evidence[0]` (Receipt / Observation /
  Decision). Do not walk to latest Booked.
- Accepted actions on that Observation: `booked` | `release`.
- Live Referral Registry query and 422 `POLICY_BLOCKED` stay.
- No Action still writes no EntityChange / Sheet Sync / Booking.
- One Booking per Job Number.
- Create minting stays Booked-only in `referralBooking.ts`.

## 6. Deliverables and exact contract

1. Failing unit tests (spec §8.1) then the predicate / helper change
   (spec §4).
2. Replica seed that mirrors Release-first Referral review
   (spec §8.2): No Action, Update, Cancel-when-latest-Booked,
   Cancel-when-latest-Release, dead policy, job/activation miss.
3. Comment at the helper: minting Booked-only lives in
   `referralBooking.ts`; this helper is policy liveness only.
4. Existing Booked-first Referral / source-scoped tests stay green.

## 7. Out of scope

- Any `vantage-admin` file (RRF-02).
- Knowledge restamp (RRF-03).
- `bookingReconciliation.ts` persist / classifier.
- `assertActiveSourceScope`.
- Production evidence rewrite for 5558690.

## 8. Tests

Spec §8.1 and §8.2. Do not skip the Cancel latest-Booked 409.

## 9. Knowledge updates after this issue ships

None in this issue. RRF-03 / docs-keeper owns the Service sentence.

## 10. Acceptance criteria

- [x] Unit: first-evidence `release` and `booked` accepted; `priority_5`
      rejected.
- [x] Replica: Release-first Referral review No Action → `no_action`;
      Booking count 1; no EntityChange / Sheet Sync.
- [x] Replica: Update succeeds; still one Booking.
- [x] Replica: latest Booked → Cancel 409 `GRANOT_CASE_REVISION_CONFLICT`.
- [x] Replica: latest Release → Cancel can create Cancellation.
- [x] Replica: dead Referral policy → 422 `GRANOT_POLICY_BLOCKED`.
- [x] Existing `referralBooking` minting tests still require Booked.
- [x] Package tests + typecheck for the touched files.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/granotLifecycle/bookingOwnerCommands.test.ts src/services/granotLifecycle/bookingOwnerCommands.replica.test.ts src/services/granotLifecycle/referralBooking.replica.test.ts
```

Adjust paths if the replica lives in only one of those files. Paste
output in the completion report. Run the package typecheck this repo
uses.

## 12. Risks

- Loosening `referralBooking.ts` by accident so mint-from-Release
  ships. Do not.
- Retargeting policy to latest Booked so chatter flips Decision
  identity. Keep `evidence[0]`.
- A replica that calls `createReferralBooking` on the review case.

## 13. Rollback

Revert the helper. Create minting and persist are untouched.

## 14. Handoff list for the completion report

- Helper diff summary (action predicate only).
- Test file paths and command output.
- Confirmation that `referralBooking.ts` minting was not edited.
- What you did not do (Admin copy, knowledge, production 5558690).
