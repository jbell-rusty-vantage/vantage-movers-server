# RRF-01 completion

**Closed:** 2026-09-14  
**Repo / branch:** `vantage-main-server` / `main`  
**Reviewed by:** coordinator after [RRF-01 implementer](bdb7b86b-40ba-42fc-a148-26f58c8ea2b1) and [code review](32416940-2039-48b6-9838-2f5dfd07c3bd)

## Helper diff summary

Predicate-only. `assertActiveReferralPolicy` still loads `evidence[0]`, still requires a live Decision, activation, `captured_at >= activated_at`, and Job Number match. Only the action conjunct changed:

- before: `observation.booking_action?.normalized !== "booked"`
- after: `!isAcceptedReferralPolicyAction(observation.booking_action?.normalized)`

`isAcceptedReferralPolicyAction` accepts only `booked` | `release`. Missing Observation, `priority_5`, empty, and unknown still fail. Live Referral Registry query and 422 `GRANOT_POLICY_BLOCKED` are unchanged.

Comment on the helper: minting Booked-only lives in `referralBooking.ts`; this helper is policy liveness only.

## Test file paths

- `src/services/granotLifecycle/bookingOwnerCommands.ts`
- `src/services/granotLifecycle/bookingOwnerCommands.test.ts`
- `src/services/granotLifecycle/bookingOwnerCommands.replica.test.ts`

`referralBooking.ts` and `referralBooking.replica.test.ts` were not edited.

## Command output

Unit (`pnpm exec tsx --test src/services/granotLifecycle/bookingOwnerCommands.test.ts`):

```
▶ assertBookingIntakeCancelAllowed
  ✔ allows open review_existing_booking with latest Release
  ✔ rejects create_missing_booking even when latest action is Release
  ✔ rejects create_referral_booking even when latest action is Release
  ✔ rejects review_existing_booking when latest action is Booked
  ✔ rejects a resolved review case even when latest action is Release
✔ assertBookingIntakeCancelAllowed
▶ isAcceptedReferralPolicyAction
  ✔ [AC-RRF-01] review_existing_booking + first action release → accept
  ✔ [AC-RRF-02] review_existing_booking + first action booked → accept
  ✔ [AC-RRF-01] create_referral_booking + first action booked → accept
  ✔ [AC-RRF-01] first action priority_5 / missing / unknown / empty → reject
✔ isAcceptedReferralPolicyAction
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0
ℹ todo 0
```

Typecheck (`pnpm typecheck`): `tsc --noEmit` exit 0.

Replica files: written. Opt-in suite skipped here (`TEST_MODE` Mongo replica not set). Existing skip gate unchanged.

## Confirmation

- `referralBooking.ts` minting was not edited. First-evidence Booked check remains at the minting helper.
- Persist `$push` and `assertActiveSourceScope` were not edited.

## What this issue did not do

- Admin 409 copy (RRF-02)
- Knowledge restamp (RRF-03)
- Production evidence rewrite or Owner close of Job 5558690
- Create Referral Booking mint-from-Release
