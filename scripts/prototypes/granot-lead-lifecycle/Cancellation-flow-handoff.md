# Handoff — Granot cancellation intake after `booking_status_changed`

Created 2026-08-13. Updated the same day after Granot confirmed `Booked` /
`Release` as CRM button actions. No credentials, live payloads, or customer
identifiers are included.

## Status

Implemented in the disposable prototype and design docs. Granot (Eyal,
Granot Inc., 2026-08-13) confirmed:

- `Booked` = Rep booked a job. Multiple Booked actions per job are expected
  after a Release for changes.
- `Release` = Rep released the job from booked status, either to make
  changes or because the customer cancelled. Multiple Release actions per
  job are expected.
- Captured payloads still send truncated `Releas`. Keep `Release` as an alias.

Current prototype behavior:

- `domain.ts` opens a Granot Cancellation Intake Case from
  `booking_status_changed` / `Releas`|`Release` against an active Booking.
- Owner paths: `confirm_granot_cancellation`, `update_granot_booking`,
  `dismiss_granot_cancellation_intake`. None is required.
- Stay idempotent on `job_no`: later `Booked` does not mint a second Booking.
- Terminal actions: `[c]` receive Release, `[u]` update Booking, `[x]`
  confirm Cancellation, `[d]` dismiss.
- Walkthrough: [`GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`](./GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md).

Production absorption is still later work.

## Confusion that is now settled

Do not collapse `event_type` and `priority` into one meaning. Granot and the
live receipts agree they are independent:

- `event_type` names the CRM button action (`Booked` / `Release`).
- `priority` is the sales follow-up code on the same row snapshot.
- `Booked` + Priority `0` is not unbooked. One captured job went
  Booked(0) → Releas(0) → Booked(5).
- `Releas` + Priority `5` is not “still booked.” Release is the button;
  Priority can remain 5 on the row.
- Checking whether the Lead's last stored Priority was `5` is useful owner
  context, not a decision rule.

## Objective

Prototype and document the final Granot lifecycle step: a
`booking_status_changed` Observation whose payload `event_type` is `Releas`
(believed to mean “Release”) and whose Granot Priority has returned to `0`.
Design a safe, low-friction owner workflow that can finish an official Vantage
Cancellation and its Cancellation Chain without treating the Granot assertion
as sufficient cancellation authority.

Extend the existing disposable prototype in:

`vantage-main-server/scripts/prototypes/granot-lead-lifecycle/`

Then update:

`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`

with the accepted cancellation model, collection relationships, concrete
Mongoose sketches, owner flow, notification behavior, rollout, and unresolved
choices.

## Read first

- `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/GRANOT-BOOKING-INTAKE-PROTOTYPE.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/domain.ts`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/scenarios.ts`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/src/models/CancelledLead.ts`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/src/services/cancellations/cancelledLead.service.ts`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/src/services/domainCommands/cancellations.ts`

Preserve the current dirty worktree and all user-owned changes.

## Facts and invariants already settled

- MongoDB is authoritative; Granot is observational evidence.
- `Releas` is an observed truncated raw value. Do not assert that it means
  Cancellation until the provider vocabulary or business behavior is verified.
- Granot Priority returning to `0` must not undo quoted, Booked, or Cancelled
  Vantage facts.
- A Vantage Cancellation requires an existing Booking and official owner facts,
  especially `refund_amount` and `cancel_date`; `reason`, `notes`, and
  `cancelled_by` are also supported.
- Cancellation is additive: the Lead retains `booked` and gains `cancelled`;
  the Booking gains its Cancellation reference.
- Only the canonical `createCancellation` command may create the Cancellation,
  write mirrors/evidence, and enqueue the Cancellation Chain.
- Granot `payment`, `balance`, `estimate`, or Priority may be displayed as
  context but must not silently become the official refund.
- Replayed/already-reflected observations should be `already_current`, not
  duplicate owner work or duplicate Cancellation records.

## Naming direction to prototype

Bind the generic concepts to this operation, parallel to booking intake:

- **Granot Cancellation Intake Case** — durable owner work item saying Granot
  may have released/cancelled an existing Vantage Booking, but official
  cancellation facts are missing.
- **Linked Cancellation Booking** — the existing Booking reached through the
  Granot Record Link / normalized Job Number. Unlike Suggested Booking Lead,
  this should normally be deterministic, not freely changeable.
- **Confirm Granot Cancellation** — owner command supplying official Refund,
  Cancel Date, and optional Reason/Notes.
- **Cancellation Intake Notification** — dashboard exposure plus optional,
  deduplicated owner email.
- **Granot Cancellation Discrepancy** — reserve for conflict, such as `Releas`
  with no existing Booking, a mismatched Record Link, or Granot reporting
  `Booked` after Vantage has an official Cancellation.

Challenge and refine these names using the `domain-modeling` skill; update
`CONTEXT.md` immediately when they settle.

## Required behavior matrix

| Observation / Vantage state                      | Expected result                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `Booked`, no Vantage Booking                     | Existing Granot Booking Intake Case flow                                 |
| `Booked`, matching active Booking                | `already_current`; no new work                                           |
| `Booked`, Vantage Booking already cancelled      | Record evidence; likely Granot Cancellation Discrepancy, never un-cancel |
| `Releas`, matching active Booking, not cancelled | Open/refresh Granot Cancellation Intake Case and notification            |
| `Releas`, Booking already cancelled              | `already_current`; refresh evidence only                                 |
| `Releas`, no Booking or conflicting link         | Do not fabricate/cancel; explicit discrepancy or blocked decision        |
| Priority returns to `0`                          | No downgrade of Vantage Lead/Booking facts                               |
| Duplicate delivery                               | One open intake case, one notification per configured channel            |

## Owner flow to prototype

```text
booking_status_changed / Releas
→ normalize raw Granot assertion
→ resolve Granot Record Link and existing Booking
→ open/refresh Granot Cancellation Intake Case
→ dashboard exposure + optional email
→ show Linked Cancellation Booking and Granot context
→ owner enters official refund amount and cancel date
→ owner optionally enters reason and notes
→ Confirm Granot Cancellation
→ canonical createCancellation
→ Cancellation + Booking/Lead mirrors + Entity Change + Cancellation Chain
→ case completed; notifications acted
```

The owner screen should hide routine synchronization state. It should show the
Booking identity and useful read-only context, then only the official fields
needed to finish cancellation. If the linked Booking is wrong, do not offer a
casual dropdown that repoints it; route that conflict through an explicit
resolution/discrepancy path with provenance.

## Prototype deliverables

1. Extend the pure `advanceLeadLifecycle` prototype with cancellation-intake
   state and a specifically named `confirm_granot_cancellation` action.
2. Extend the terminal shell so the owner can receive a masked `Releas`
   Observation and confirm the Cancellation while routine state remains hidden.
3. Add executable scenarios covering every row in the behavior matrix,
   including invalid missing official facts, replay, already cancelled, no
   Booking, and Priority `0` non-downgrade.
4. Add a focused Markdown walkthrough beside the prototype.
5. Update `SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`, `README.md`, `NOTES.md`,
   the handoff, relevant lifecycle docs, and canonical glossary terminology.
6. Use masked prototype fixtures only; do not copy live customer values.

## Suggested collection shape

Explore a `GranotCancellationIntakeCase` with:

- unique open normalized Job Number / Booking reference;
- opening/latest Observation and Synchronization Decision references;
- Linked Cancellation Booking snapshot/reference;
- compact Granot release context, including raw `Releas`, Priority, payment,
  balance, and estimate as display-only values;
- `open|completed|dismissed` state and optimistic revision;
- completed Cancellation reference;
- owner resolution evidence and dismissal reason.

Notification can parallel `BookingIntakeNotification`, or the agent may justify
a shared, explicitly named lifecycle-intake notification model. Do not use a
generic abstraction merely to reduce file count.

## Acceptance scenarios

- `Releas` never creates a Cancellation without owner confirmation.
- Confirm requires a current eligible Booking, non-negative official Refund,
  official Cancel Date, owner actor, idempotency key, and current case revision.
- Granot payment/balance/estimate never become refund automatically.
- Successful confirmation retains `Lead.booked`, adds `Lead.cancelled`, sets
  `Booking.cancelled`, persists the Cancellation, completes the intake case,
  marks notifications acted, records causal evidence, and requests exactly one
  Cancellation Chain.
- Repeat confirmation/delivery is idempotent.
- `Booked` after official Cancellation never reverses it.
- No-Booking or Record-Link conflicts remain explicit and owner-resolvable.

## Verification

Run:

```powershell
pnpm prototype:granot-lifecycle -- --scenarios
pnpm typecheck
git diff --check
```

Also inspect the terminal prototype manually and verify Markdown fences and
that no live customer identifiers appear in prototype/docs.

## Suggested skills

- `domain-modeling` — settle the cancellation-specific language and update the
  glossary as terms resolve.
- `codebase-design` — retain a deep Granot Cancellation Intake Module with a
  small owner-facing Interface.
- `prototype` — extend the existing pure logic + terminal prototype.
- `tdd` — use when absorbing validated behavior into production code; the
  disposable prototype itself uses executable scenario assertions.

## Open business decisions to keep explicit

- Confirm the full provider meaning/vocabulary of `Releas`.
- Decide whether dashboard cases open immediately or only after repeat/timeout.
- Decide whether email is immediate, digest-only, or disabled by default.
- Decide whether Granot payment can merely suggest a refund value or must remain
  read-only with an empty official Refund field; default to read-only.
- Decide required cancellation reasons and dismissal reasons.

Do not hide these uncertainties behind automatic cancellation behavior.
