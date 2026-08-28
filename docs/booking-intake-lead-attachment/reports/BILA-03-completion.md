---
type: Completion report
title: BILA-03 — Connect Booking to Lead from the Bookings tab
status: complete
closed: 2026-08-28
---

# BILA-03 completion

Repos: `vantage-main-server`, `vantage-admin`. Both desks were on `main`. No extra feature branch.

## Command test names and results

Always-running unit tests in `connectLead.test.ts` (all pass):

- Connect sheet intent is `booking_chain` / `booked_lead.connect_lead`
- Leadless non-referral non-cancelled Bookings are connectable
- Eligible Connect Leads exclude Duplicate, Bad, cancelled, booked, and unmatched Call Leads
- evaluateConnectPreconditions attaches an eligible unbooked Lead
- `already_satisfied` when the Booking already has this exact Lead
- `IDENTITY_CONFLICT` when the Booking already has a different Lead
- `IDENTITY_CONFLICT` when another Booking already owns the Lead
- Referral, cancelled, Duplicate, Bad, and unmatched Call Leads are rejected
- Stale booking revision fails closed
- Out-of-scope without override is rejected; with reason it connects

Zod (`Connect Booking to Lead input is strict and requires selected_lead`): `selected_lead` required; unknown keys reject; override reason 10–500.

Replica (`connectBookingToLead.replica.test.ts`, opt-in `GRANOT_LIFECYCLE_REPLICA_TESTS=true`) were **skipped** in this run, same pattern as BILA-01/02. Names:

- Connect happy path attaches the Lead, writes EntityChange, and queues `booking_chain`
- Connect `already_satisfied` on the exact same Lead writes no new Change
- Connect exact Idempotency-Key replay returns the durable result
- Connect rejects Referral, cancelled, already-booked Lead, and stale revision
- Connect flag-off is `POLICY_BLOCKED`

## Candidate filter evidence

`connectLeadCandidates.test.ts` (all pass):

- Empty `q` returns `{ items: [], next_cursor: null }` and does not query Form/Call collections
- Form `q` includes `granot_contact_snapshot.name` and eligibility filters (`duplicate`, `bad_lead`, `booked`, `cancelled`)
- DTO `known_contacts.granot` is present; `observation_id` is omitted; headline stays Form submitted
- Call `q` omits snapshot paths and includes `created_on_unmatched`
- Referral and cancelled Bookings fail closed (`GRANOT_IDENTITY_CONFLICT`)

## Proxy ACL evidence

`authorization.test.ts`: Owner can GET/POST `.../bookings/:id/connect-lead-candidates` and `.../connect-lead`. Admin role cannot (GET and POST both false).

## Browser notes (steps 7–11)

This desk’s Owner Admin is **http://localhost:3000** (API on **http://localhost:3001**). Commands were enabled. No live Connect was submitted. No live customer names, phones, or emails are repeated here.

7. Filtered Leadless = Yes. Opened a leadless non-referral booking. Table showed **No stored lead** chips (31 leadless rows). Detail **Stored lead** section: “This booking has no stored lead”, **No stored lead** badge, and **Connect a lead**.
8. Opened search in place. Searched job `5563344` (unbooked Form Lead with a Granot snapshot). One result: Form submitted + Granot cards, cycle line, headline stayed Form submitted. Selected it. Review titled **Review this connection** with **Connect lead**. Did not submit. Copy module success string is “Master Leads and Master Booked will update.” Page never said the sheet already updated.
9. Opened a Referral booking. **Stored lead** showed **Referral**. No **Connect a lead**.
10. `/form-leads` still lists Form Leads with Granot chips. No Stored-lead column. No Connect.
11. `/bookings/reconciliation` is still the employee-booking queue (Pending / Queue / attach-existing language). No Connect.

`leadless=yes` is an invalid URL value (`Invalid request payload`). The filter control’s real value is `true`.

## What this issue did not do

- Connect on `/intakes`, Daily Completed, or Ingestion case redirect
- `/bookings/reconciliation` changes (`attach_existing` untouched)
- Auto-creating a Lead
- Changing Confirm, even Binder, or scored search
- New Mongo indexes
- Replica Connect runs (`GRANOT_LIFECYCLE_REPLICA_TESTS` off)
- Live Connect submit on a real Leadless Booking (would attach a stored Lead)

## §4 drift corrected

Issue §4 matched the repo at pickup: no Connect routes, no proxy paths, `/bookings` had Leadless filter and no Stored-lead chip or Connect section. This issue is the change. BILA-02 Leadless official Bookings remain the prerequisite; Update still allows Granot official Leadless.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| Focused server tests (eligibility + candidates + Zod + sheet intent) | 40 pass |
| `vantage-main-server` `pnpm test` | 1722 pass, 0 fail, 98 skipped |
| `vantage-admin` `pnpm test` | 347 pass |
| `vantage-admin` `pnpm typecheck` | pass |

Full server suite footer:

```text
ℹ tests 1820
ℹ pass 1722
ℹ fail 0
ℹ skipped 98
```

Knowledge docs restamped by docs-keeper after ship.
