# Granot Cancellation Intake prototype

Status: executable domain prototype and production design recommendation. No
live systems, database, email, dashboard, or Sheet Sync are invoked.

Provider meaning confirmed 2026-08-13 by Granot (Eyal, Granot Inc.). Live
`booking_status_changed` receipts in `granot_webhook_receipts` match that
explanation. Counts below contain no customer identifiers.

## Question being prototyped

When Granot delivers `booking_status_changed` with payload `event_type`
`Releas` or `Release`, how can Vantage give the owner a chance to finish an
official Cancellation **or** update the existing Booking for that Job Number
without treating the Granot button-click as cancellation authority, inventing
a refund, minting a second Booking, or forcing the owner to act?

The CRM has one button for booking a job or releasing a job from booking.

- `event_type=Booked` means a Rep booked a job (move) with a customer. A job
  can have **multiple Booked actions** — the Rep releases first when a change
  requires it, then books again.
- `event_type=Release` means the Rep released the job from booked status.
  That can happen when the Rep needs to make changes **or** when the customer
  decides to cancel. A job can have **multiple Release actions**.

Captured payloads truncate `Release` to `Releas`. Treat `Releas` and
`Release` as the same Granot Booking Action.

`Booked` on `booking_status_changed` often arrives with, or seconds after, a
`priority_updated` of `5`. The identity key is `job_no`. Stay idempotent on
that Job Number: one Vantage Booking, owner-updatable, never a second Booking
for the same job.

The owner is given the chance to update Vantage. The owner is not required to.

The answer tested here is a dedicated **Granot Cancellation Intake Case**
that offers two owner paths plus dismiss:

1. **Confirm Granot Cancellation** — customer cancelled the move.
2. **Update Granot Booking** — official facts on the existing Booking changed.
3. **Dismiss Granot Cancellation Intake** — leave the Vantage Booking as-is.

The same notification pinnacle already exists for booking a lead: dashboard
exposure plus optional email with a link to the intake case. Release uses that
shape, with its own named work item.

Run the owner-facing terminal prototype:

```powershell
pnpm prototype:granot-lifecycle
```

Then press `p` → `b` to book, `c` to receive Release (`Releas` in the fixture),
`u` to update the Booking, `x` to confirm a Cancellation, or `d` to dismiss.
Official refund starts empty; Granot payment is shown as context only.

Run the executable scenario assertions:

```powershell
pnpm prototype:granot-lifecycle -- --scenarios
```

## Exact names

| Name | Meaning | Not the same as |
| --- | --- | --- |
| **Granot Booking Action** | CRM button Granot reports as `Booked` or `Release` (`Releas` alias) | Vantage Booking, Cancellation, Granot Priority |
| **Granot Cancellation Intake Case** | Durable work item saying “Granot released this Job Number from booked; the owner may cancel, update the existing Booking, or dismiss” | Cancellation, discrepancy, booking intake |
| **Linked Cancellation Booking** | The existing Booking resolved from the Granot Record Link / Job Number | A Suggested Booking Lead the owner can casually replace |
| **Confirm Granot Cancellation** | Owner command that supplies official Refund, Cancel Date, and optional Reason/Notes | Accepting a webhook or auto-cancel |
| **Update Granot Booking** | Owner command that supplies official Book Date, Agent Allocations, Binder, Deposit, and Merchant on the existing Job Number Booking | Confirm Granot Booking (creates the first Booking) |
| **Dismiss Granot Cancellation Intake** | Owner command that closes the case with no Vantage Booking or Cancellation change | Ignoring the Observation (the Observation is still retained) |
| **Cancellation Intake Notification** | Optional dashboard/email delivery pointing to an open intake case | The intake case itself |
| **Granot Cancellation Discrepancy** | Conflict such as Release with no Booking, a mismatched Record Link, or `Booked` after an official Cancellation | Merely an unacted Release offer |

The split matters. Missing refund and cancel date is expected owner work, not
an error. A discrepancy means two durable truths conflict, or there is no
Booking to cancel or update. Leaving an open case untouched is also valid:
the owner was given a chance, not an obligation.

## Provider meaning, confirmed

Granot: the payload `event_type` on `booking_status_changed` is the **name of
the CRM button action that just happened**, not Vantage Booked/Cancelled
state and not Granot Priority.

```text
same job_no
  Booked  →  Release (changes or customer cancel)  →  Booked (after changes)
             ↑ multiple times                      ↑ multiple times
```

Vantage maps that onto one Booking per normalized Job Number:

```text
Booked, no Vantage Booking     → Granot Booking Intake Case (create)
Booked, Booking already exists → already_current on job_no;
                                 if a Release intake is open, refresh it
Release, active Booking        → open/refresh Granot Cancellation Intake Case
                                 (cancel | update | dismiss; not required)
Release, already cancelled     → already_current
Release, no Booking / conflict → Granot Cancellation Discrepancy
Booked after official Cancellation → Granot Cancellation Discrepancy;
                                 never un-cancel
```

## Supplied payload, safely represented

The executable fixture preserves the captured booking-status shape while
replacing customer identifiers and the Job Number with prototype-only values:

```ts
{
  event_type: "Releas", // alias of provider name Release
  job_no: "PROTO-5562372",
  service_type: "Long Distance",
  source: "BestRelocation Inbounds",
  ref_no: "",
  priority: "0",
  user: "ROY",
  rep: "ROY",
  first_name: "Sara",
  last_name: "Example",
  phone_number: "(555) 010-2372",
  email: "sara.booking@example.test",
  move_date: "08/28/2026",
  est_cf: "390",
  estimate: "2400.00",
  payment: "646.40",
  balance: "1753.60",
}
```

### What each value may do

| Payload fact | Authorized use | Forbidden use |
| --- | --- | --- |
| `event_type=Releas` / `Release` | Open/refresh a Granot Cancellation Intake Case when an active Booking exists | Create a Cancellation or update a Booking by itself |
| `event_type=Booked` | Open booking intake if no Booking; otherwise stay idempotent on `job_no` and offer update only through an already-open Release intake | Mint a second Booking for the same Job Number |
| `job_no` | Resolve the Granot Record Link and the one Vantage Booking for that job | Silently repoint a conflicting link; create a second Booking |
| `priority` | Display as Granot context | Undo quoted, Booked, or Cancelled Vantage facts |
| `payment` / `balance` / `estimate` | Display as Granot context | Become the official Refund, Binder, or Deposit |
| name / phone / route | Read-only owner context | Change the Linked Cancellation Booking |

The scenario confirms Refund `750` while Granot payment stays `646.40`. Those
are different numbers on purpose. The update-booking scenario changes binder
and deposit on the **same** Booking id.

## Owner-hidden policy

Routine synchronization stays automated and hidden. The owner is surfaced only
when policy promotes the observation:

```text
booking_status_changed / Releas|Release
  + matching active Vantage Booking
  + Booking not already cancelled
  → open/refresh Granot Cancellation Intake Case
  → expose dashboard item
  → optionally queue one deduplicated email
  → owner may cancel, update, dismiss, or leave it open
```

`Booked` without a Vantage Booking continues to use the existing Granot
Booking Intake Case. `Booked` against an already-cancelled Booking becomes a
Granot Cancellation Discrepancy and never un-cancels. `Booked` against an
active Booking for that Job Number is `already_current`: identity is
satisfied. If a Release intake is still open, its observed context is
refreshed (often to `Booked` after a change-cycle re-book) and the owner
still has cancel / update / dismiss.

## Seamless owner operation

```mermaid
sequenceDiagram
    participant G as Granot
    participant P as Observation Processor
    participant I as Granot Cancellation Intake Module
    participant N as Notification Projection
    participant O as Owner
    participant C as Canonical domain command
    participant M as MongoDB
    participant S as Sheet Sync Outbox

    G->>P: booking_status_changed / Releas or Release
    P->>P: normalize aliases, source-scope, match, resolve Booking by job_no
    P->>I: openOrRefresh(observation, linked Booking)
    I->>M: persist open intake case with both owner paths
    I->>N: dashboard visible; optional email queued
    N-->>O: Release needs a chance to cancel, update, or dismiss
    O->>I: open case
    I-->>O: Linked Cancellation Booking + Granot context + blank official fields
    alt Confirm Cancellation
      O->>I: Confirm Granot Cancellation(refund, cancel date, revision)
      I->>C: createCancellation
      C->>M: Cancellation + Booking/Lead mirrors + command/change evidence
      C->>S: Cancellation Chain intent
    else Update Booking
      O->>I: Update Granot Booking(official booking facts, revision)
      I->>C: update existing Booking for this job_no
      C->>M: Booking mutation + Entity Change
      C->>S: Booking Chain intent
    else Dismiss
      O->>I: Dismiss Granot Cancellation Intake
      I->>M: mark case dismissed; notifications dismissed
    end
    I->>M: complete or dismiss case
    I-->>O: result; Vantage unchanged if dismissed or ignored
```

### Owner form

The screen should be narrower than a generic cancellation form, and it must
show that this is an **offer**, not a required cancel.

Read-only Linked Cancellation Booking:

- Booking identity, Job Number, book date, deposit, merchant, source Lead.

Read-only Granot context, labeled “context only”:

- raw `Releas` / `Release` (and later `Booked` if a change-cycle re-book
  arrived), Priority, payment, balance, estimate;
- latest observation time and channel;
- a short note that Priority on this snapshot is independent of the button
  action — Priority `0` on a Release is common and is not unbook.

Required official fields for the Cancellation path:

- official Refund, starting empty;
- official Cancel Date.

Optional official fields for the Cancellation path:

- reason, notes, cancelled-by.

Required official fields for the Update Booking path:

- official Book Date, Agent Allocations, Binder, Deposit, Merchant.

Primary actions:

- **Confirm Granot Cancellation**
- **Update Granot Booking**
- **Dismiss** (no Vantage change)

If the Linked Cancellation Booking is wrong, do not offer a casual dropdown.
Route that through an explicit Granot Cancellation Discrepancy.

## Behavior matrix

| Observation / Vantage state | Prototype result |
| --- | --- |
| `Booked`, no Vantage Booking | Existing Granot Booking Intake Case |
| `Booked`, matching active Booking | `already_current` on `job_no`; no second Booking; refresh open Release intake if present |
| `Booked`, Vantage Booking already cancelled | Granot Cancellation Discrepancy; never un-cancel |
| `Releas` or `Release`, matching active Booking, not cancelled | Open/refresh Granot Cancellation Intake Case with cancel and update paths; owner is not required to act |
| `Releas` / `Release`, Booking already cancelled | `already_current`; refresh evidence only |
| `Releas` / `Release`, no Booking or conflicting link | Explicit discrepancy; no Cancellation and no invented Booking |
| Later `Booked` after Release on the same `job_no` | Still one Booking; open intake stays an offer to cancel, update, or dismiss |
| Priority `0` on Booked or Release | Display as Granot context; no downgrade of quoted, Booked, or Cancelled facts |
| Duplicate Release delivery | One open intake case, one notification per channel |
| Owner dismisses, later Release on same `job_no` | Reopen the same intake; still one Booking |
| Empty payload `event_type` | Not a Release or Booked action; no intake |

## Portable prototype interface

The existing pure interface remains:

```ts
advanceLeadLifecycle(
  current: LifecycleWorld,
  action: LifecycleAction,
  catalog: PrototypeCatalog,
): LifecycleResult
```

The Release-intake owner actions are:

```ts
type ConfirmGranotCancellationAction = {
  kind: "confirm_granot_cancellation";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  official_cancellation_details: {
    cancellation_id: string;
    cancel_date: string;
    refund_amount: number;
    reason?: string;
    notes?: string;
    cancelled_by?: string;
  };
};

type UpdateGranotBookingAction = {
  kind: "update_granot_booking";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  official_booking_details: {
    book_date: string;
    agent_allocations: BookingSnapshot["agent_allocations"];
    total_binder_amount: number;
    deposit_amount: number;
    merchant: string;
  };
};

type DismissGranotCancellationIntakeAction = {
  kind: "dismiss_granot_cancellation_intake";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  reason?: string;
};
```

The owner never sends observed payment, balance, estimate, or a replacement
Booking as authoritative data. The Module loads the Linked Cancellation
Booking from the case. Update mutates that Booking; it does not create
another one for the same Job Number.

## Production Module interface

Use a specifically named **Granot Cancellation Intake Module**:

```ts
export interface GranotCancellationIntakeModule {
  openOrRefreshFromObservation(input: {
    observation_id: string;
    synchronization_decision_id: string;
  }): Promise<{
    case_id: string;
    outcome: "opened" | "refreshed" | "reopened" | "already_completed" | "conflict";
  }>;

  confirmGranotCancellation(input: {
    case_id: string;
    expected_revision: number;
    official_cancellation_details: {
      cancel_date: string;
      refund_amount: number;
      reason?: string;
      notes?: string;
      cancelled_by?: string;
    };
    owner: DurableActor;
    idempotency_key: string;
  }): Promise<{
    outcome: "cancelled" | "already_cancelled" | "conflict";
    cancellation_id?: string;
  }>;

  updateGranotBooking(input: {
    case_id: string;
    expected_revision: number;
    official_booking_details: {
      book_date: string;
      agent_allocations: Array<{
        agent_name: string;
        binder_amount: number;
      }>;
      total_binder_amount: number;
      deposit_amount: number;
      merchant: string;
    };
    owner: DurableActor;
    idempotency_key: string;
  }): Promise<{
    outcome: "updated" | "already_current" | "conflict";
    booking_id?: string;
  }>;

  dismiss(input: {
    case_id: string;
    expected_revision: number;
    reason?: string;
    owner: DurableActor;
    idempotency_key: string;
  }): Promise<{
    outcome: "dismissed" | "already_current" | "conflict";
  }>;
}
```

The Module owns intake-case idempotency by normalized Job Number / Booking,
Linked Cancellation Booking identity, alias normalization (`Releas` /
`Release`), optimistic concurrency, official-field validation, invocation of
canonical `createCancellation` or the Booking update command, and
notification state. It does not reimplement Cancellation creation, Booking
identity, Lead/Booking mirrors, Entity Changes, or Sheet Sync chains.

Leaving the case open is a valid owner outcome. Dismiss is only needed when
the owner wants the dashboard item gone without changing Vantage.

## Proposed routes

```text
GET  /api/v1/admin/granot-cancellation-intakes?state=open
GET  /api/v1/admin/granot-cancellation-intakes/:case_id
POST /api/v1/admin/granot-cancellation-intakes/:case_id/confirm
POST /api/v1/admin/granot-cancellation-intakes/:case_id/update-booking
POST /api/v1/admin/granot-cancellation-intakes/:case_id/dismiss
```

The confirm route accepts only official cancellation fields. The update-booking
route accepts only official Booking fields. Neither accepts Granot payment, a
replacement Booking, or arbitrary Lead patches.

Dashboard exposure is the open-case query. Email is optional configuration and
should use a dedupe key such as:

```text
granot-cancellation-intake:{case_id}:opened
```

A failed email must not block or close the dashboard case. The same rule
already applies to Booking Intake Notification.

## Scenario verdicts

The executable prototype establishes these results:

1. `Releas` and `Release` never create a Cancellation or mutate a Booking
   without an owner command.
2. Confirm requires a current eligible Booking, non-negative official Refund,
   official Cancel Date, owner actor, idempotency key, and current case
   revision.
3. Granot payment/balance/estimate never become refund, binder, or deposit.
4. Successful confirmation retains `Lead.booked`, adds `Lead.cancelled`, sets
   `Booking.cancelled`, persists the Cancellation, completes the intake case,
   marks notifications acted, records causal evidence, and requests exactly
   one Cancellation Chain.
5. Update Granot Booking mutates the existing Booking for that Job Number,
   requests a Booking Chain update, completes the intake as `update_booking`,
   and never creates a second Booking or a Cancellation.
6. Dismiss closes the case with no Booking or Cancellation change. A later
   Release on the same Job Number reopens it.
7. Repeat confirmation, duplicate Release delivery, and later `Booked` on the
   same `job_no` stay idempotent: one Booking, one open intake.
8. `Booked` after official Cancellation never reverses it.
9. No-Booking or Record-Link conflicts remain explicit and owner-resolvable.
10. Priority `0` on Booked or Release does not undo Booked facts.

## Confirmed: `Booked` vs `Release` vs Priority

Granot answered the vocabulary question. The remaining work is Vantage
policy, not provider guesswork.

Public Granot / HelloMoving pages still describe Follow Up and Priorities as
a sales feature and do not document this webhook. The public lead-submission
API's `priorityid` 1–5 is a different contract from the CRM workflow codes
Vantage already sees (`0`, `1`, `2`, `3`, `5`, `7`, `8`, `9`).

### What Granot said

The CRM button is the source of `booking_status_changed`:

- `Booked` = Rep booked a job with a customer. Multiple Booked actions per
  job are expected when a change required a Release first.
- `Release` = Rep released the job from booked status. Reasons: make changes,
  or the customer cancelled. Multiple Release actions per job are expected.

Payload truncation: live receipts currently send `Releas`. Keep `Release` as
an alias. Do not treat unknown spellings as Release.

### What captured receipts show

`granot_webhook_receipts` with route `booking_status_changed` (counts only;
no customer values). `event_type` and `priority` are independent snapshot
fields. Every typed receipt also carried `payment` and `balance`.

| Payload `event_type` | Payload `priority` | Count seen |
| --- | --- | ---: |
| `Booked` | `5` | 15 |
| `Releas` | `5` | 4 |
| `Booked` | `0` | 1 |
| `Booked` | `1` | 1 |
| `Releas` | `0` | 1 |
| `Releas` | `1` | 1 |
| *(empty)* | *(empty)* | 1 |

Totals: 17 `Booked` across 12 jobs, 6 `Releas` across 5 jobs, 1 empty action.
No live `Release` spelling yet; the alias is still required.

Several jobs show the change cycle Granot described, seconds apart:

```text
Booked(priority 5) → Releas(5) → Booked(5)
Booked(5) → Releas(5) → Booked(5) → Releas(5) → Booked(5)
Booked(1) → Releas(1) → Booked(5)
Booked(0) → Releas(0) → Booked(5)
```

That last row is the “weird” Priority `0` Release. The job was booked while
the row still showed Priority `0`, released at Priority `0`, then booked
again at Priority `5`. Priority rode along with the CRM row. It did not mean
unbook, and it did not mean cancel.

`Booked` also commonly arrives one to thirty seconds after
`priority_updated` with Priority `5` on the same `job_no`. Treat that as the
expected conjunction, not as two Vantage Bookings.

### What this settles

**Reading A is the provider model.** Booking action and Priority are
independent columns. An employee can book and later change priority, or
release and forget to change priority, or book while priority is still `0`.

**Reading B is rejected.** `Booked` + Priority `0` is not unbooked. The
change-cycle receipts prove a job can be Booked at Priority `0` and later
Booked at Priority `5`.

**Reading C is confirmed for `event_type`.** It names the button action that
just happened (`Booked` / `Release`), not a durable Vantage status. The rest
of the payload is still a current-state snapshot, including Priority.

**Reading D stays owner context only.** Comparing the Lead's last stored
Granot Priority is useful on the form. It is not cancellation or update
authority.

### What Vantage must still not do

- Do not treat `Booked` + Priority `0` as unbook or cancel.
- Do not treat Priority leaving `5` as Cancellation.
- Do not treat `Releas` + Priority `5` as “still booked.” Release is the
  button action; Priority `5` can remain on the row.
- Do not invent a refund from `payment` / `balance` on either event.
- Do not mint a second Booking when another `Booked` arrives for the same
  `job_no`.
- Do not auto-cancel, auto-update, or auto-dismiss. The owner is given a
  chance, not a requirement.
- Do not let a previous Vantage Priority `5` automatically open or skip
  cancellation intake.

The prototype keys Release intake on normalized `Releas` | `Release` against
an active Vantage Booking, and keys first-time booking intake on `Booked` /
Priority `5` when no Booking exists. Those are now aligned with Granot, not
placeholders.

## Remaining owner choices

- Should dashboard cases open immediately or only after repeat/timeout?
- Should email be immediate, digest-only, or disabled by default?
- May Granot payment suggest a refund value, or must the official Refund stay
  empty? Default: read-only context, empty official field.
- May Granot estimate/payment suggest binder/deposit on the Update Booking
  path, or must those official fields start from the current Vantage Booking?
  Default: current Vantage Booking values, Granot figures context-only.
- Which cancellation reasons and dismissal reasons are required?
- Should a later `Booked` after Release auto-complete the intake as “Granot
  re-booked,” or keep the offer open until the owner updates, cancels, or
  dismisses? Default in this prototype: keep the offer open.

These choices change ergonomics, not the core invariants: only Confirm Granot
Cancellation with official facts creates and Sheet-Syncs a Vantage
Cancellation; only Update Granot Booking mutates the existing Job Number
Booking; the owner may do neither.
