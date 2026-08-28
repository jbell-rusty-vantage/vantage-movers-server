# BILA-02 — Confirm without a required Lead; high-confidence auto-attach

> **Contract maturity: implementation-ready.** Session 2. The Owner may
> finish Confirm Granot Booking with no Lead selected. The server attaches
> a Lead only when a unique High-Confidence Booking Lead exists. Anything
> else becomes a Leadless Booking. **No Bookings-tab Connect UI.**

## 1. Authority and required reading

- **Pack specification:** [`../booking-intake-lead-attachment-specification.md`](../booking-intake-lead-attachment-specification.md)
  — §5, §7 (Confirm rows), §8, §9.2, §9.4 (intake browser steps 5–6), §12.2.
- **Command shapes:** [`../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)
  §§6, 8, 10 — wins on persist outcomes, processor follow-through, Sheet
  Sync resource/operation names.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Prerequisite:** BILA-01 `complete`. Review must show the same contact
  story when a Lead is attached.

## 2. Objective

Let the Owner submit official booking details without attaching a Lead.
Attach automatically only for a unique High-Confidence Booking Lead.
Medium-confidence Source Scope contact never auto-attaches and is never
pre-selected. A Granot-created Leadless Booking is official and later
Booked evidence opens `review_existing_booking`.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` then `vantage-admin`.
- **Branch:** same as BILA-01.
- **Prerequisites:** BILA-01 `complete`.
- Ordinary checks use redacted synthetic data. Replica tests stay on the
  existing test database pattern.
- No commit, push, deploy, production flag change, or live payload read.

## 4. Current-state evidence to verify

Observed 2026-08-28; **reverify at implementation**.

- `granotLifecycleConfirmBookingCommandSchema.selected_lead` is required
  (`.strict()` object) in `src/validation/v1/granotLifecycle.validation.ts`.
- `bookingConfirmation.ts` always writes `is_leadless_booking: false` and
  fails without an eligible Lead.
- `bookingOwnerCommands.ts` treats `is_leadless_booking` as
  `IDENTITY_CONFLICT` on update.
- Processor Booked + missing Booking / existing employee case still
  follows the current AC-28 / AC-39 fail-closed path for “Booking without
  Lead.” That must change only for a **Granot-created** Leadless Booking.
- `BookingCommandForm` pushes “Choose the customer this booking belongs
  to before you file it” and always sends `selected_lead`.
- `pickBestCandidate` ranks `suggested` first even when medium, then
  high, then in-scope. `useMatchedLead` pre-fills that result.
- Admin `POST /api/v1/leadless-bookings` and employee submit already
  create Leadless Bookings. Do not reuse the employee reconciliation case.

## 5. Locked decisions and invariants at risk

- Official details stay required and blank until the Owner types them.
- Attachment resolution is **server-owned**, order in pack spec §5.2.
- Unique high only. Zero / two-or-more high → Leadless.
- `source_scoped_contact` is medium. Never auto-attach. Never pre-select.
- Explicit Owner `selected_lead` always wins (eligibility + override).
- Lost claim fails the command. It does not fall through to Leadless.
- Do not open a Booking Lead Reconciliation Case from Confirm.
- Employee `booking_origin=employee_booking` pending path is unchanged.
- Referral stays no-Lead by definition (`is_leadless_booking: false`,
  no `lead_ref`). Do not stamp leadless on Referral.
- Even Binder is already shipped. Do not reopen official field shape.

## 6. Deliverables and exact contract

### 6.1 Server

1. Make `selected_lead` optional on the Confirm Zod schema.
2. Implement §5.2 attachment resolution inside the Confirm transaction.
3. Persist attached vs Leadless outcomes and Sheet Sync intents in §5.3 / §7.
4. Return Owner-readable copy when the Booking is Leadless.
5. Processor: Actual Booked + one active Granot Leadless Booking opens
   or refreshes `review_existing_booking`. Do not delegate to employee
   reconciliation. Do not fail closed.
6. `updateExistingBooking` allows Granot official Leadless Bookings
   (official fields only; Master Booked sheet job).
7. Confirm Granot Cancellation succeeds on a Granot Leadless Booking
   (no Lead mirror).

### 6.2 Admin

1. `pickBestCandidate` returns a high-confidence item only (prefer
   `suggested` when that suggestion is itself high).
2. `BookingCommandForm` enables Review without a Lead once official
   details are valid. Review states the attached Lead or
   **No lead — Master Booked only**.
3. Empty / medium-only state copy from pack spec §5.4, in `intake-copy.ts`.
4. `intakeNextStep` / `intakeCaseHowToFinish` no longer say “choose a
   lead” as if required.
5. Success notice distinguishes attached vs Leadless (“connect later
   from Bookings”).

## 7. Out of scope

- Connect Booking to Lead route and Bookings-tab UI (BILA-03).
- Connect on `/intakes` finished cases.
- Ingestion case redirect, intake accordion rewrite, Daily.
- Auto-creating a Lead. Auto-attaching medium.
- Changing even Binder or Referral official fields.

## 8. Tests

Pack spec §9.2. Keep existing replica confirm cases passing when
`selected_lead` is sent. Add omit / high-auto / medium-leadless /
Owner-medium / lost-claim / processor / update / cancel cases.

## 9. Knowledge updates after this issue ships

- `docs/knowledge/granot-lifecycle/owner-booking-intake.md`
- `docs/knowledge/services/bookings.md` — Granot Leadless Booking is official
- `docs/knowledge/granot-lifecycle/booking-reconciliation.md` if the
  processor path is documented there

Do not claim Connect from Bookings is current until BILA-03 ships.

## 10. Acceptance criteria

- [ ] Zod accepts omitted `selected_lead` and still rejects unknown keys.
- [ ] No `selected_lead` + unique high → attach + `booking_chain`.
- [ ] No `selected_lead` + medium-only or ambiguous high → Leadless +
      Master Booked only. Medium Lead is not attached.
- [ ] Explicit Owner `selected_lead` attaches even when medium
      (eligibility and override still apply).
- [ ] Lost claim returns the current conflict envelope, not Leadless.
- [ ] Later Booked on a Granot Leadless Booking opens
      `review_existing_booking` and does not require an employee case.
- [ ] Update Existing Booking and Confirm Granot Cancellation succeed on
      a Granot Leadless Booking.
- [ ] Admin form submits with no Lead once official details are valid.
      Medium is not pre-selected. Review names the Lead or
      **No lead — Master Booked only**.
- [ ] Browser steps 5–6 in pack spec §9.4 pass.

## 11. Commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck
```

Plus the browser walk for steps 5–6. Paste output in the report.

## 12. Risks

- Client-side auto-attach that disagrees with the server.
- Falling through to Leadless after a lost claim.
- Treating Referral as Leadless.
- Breaking the employee pending Leadless path.

## 13. Rollback

Revert Confirm Zod and `bookingConfirmation` first (removes Leadless
mint from intake). Revert the Admin form affordance. Preview Leadless
Bookings remain valid Mongo documents and can be connected after BILA-03.

## 14. Handoff list for the completion report

- Attachment-resolution test names and results.
- Sheet intent evidence for attached vs Leadless.
- Processor / update / cancel evidence.
- Browser notes for steps 5–6.
- What you did not do (BILA-03).
- Any §4 drift you corrected.
