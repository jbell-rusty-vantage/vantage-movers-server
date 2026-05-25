# Skipping the Phone-Only Call Lead: A Cleaner Alternative

This is the companion document to "Why the Book Form Must Require Phone Number."
It describes a more ambitious option that removes the duplicate problem at
the root, instead of merely working around it.

It is meant to be read in two minutes.

## The Idea in One Sentence

> Stop creating a customer record the moment a phone call ends. Only
> create a customer record when there is an actual booking, so that
> every record in the database is already attached to a real deal.

That single change makes the orphan problem impossible by design,
because there is no orphan to leave behind.

## What We Stop Doing Today

Right now, the moment a customer calls, the system automatically saves a
small record — a "sticky note" with only a phone number on it. Every
call gets one of these sticky notes, whether or not the call ever turns
into a booking.

Most of these sticky notes never become anything. People call, ask
questions, hang up. The sticky note stays in the database and the
Google Sheet forever, marked "did not book."

The proposal is simple: **stop creating that sticky note.**

The call still happens. Invoca still records the call in its own
dashboards (where call duration, recordings, and source tracking already
live). But the moving company's database does not get a record for every
call. It only gets a record once a booking actually happens.

## Two Ways to Make a Booking Without the Invoca Sticky Note

If we stop creating sticky notes when calls come in, we need another way
to produce one when a deal is booked. There are two clean ways to do
this, and both eliminate the duplicate problem.

### Option 1 — Book Directly From the Browser Extension

When the owner finishes processing a payment in the Granot CRM, the row
moves into the Booked Jobs table. The browser extension is already
watching that table.

The extension sends one single message to the system that says: "Here
is a new booked job. Here is the customer's name, phone number, job
number, cubic feet, source, agent, binder amount, deposit, merchant,
and book date — all at once."

The system creates the customer record and the booking record together,
in one step, with all the information already filled in. There is no
"wait for the form" step. There is no "sync later" step. The data is
correct the moment the booking exists.

This is the cleanest possible flow. The Google booking form would be
retired entirely or kept only as a manual backup.

### Option 2 — Book From the Form, Fill in the Rest Later

If the owner prefers to keep using the Google booking form, the form
can still create the booking with only the job number. The system would
create a booking record and a minimal customer record at the same time,
with only the job number filled in.

The browser extension then runs a sync against the Booked Jobs table.
For each row it sees, it finds the matching booking by job number,
finds the minimal customer record attached to that booking, and fills
in the phone number, name, email, cubic feet, and so on.

This is slower than Option 1 — there is a window where the customer
record is missing its phone number and name. But it is still **clean,**
because there is only ever one customer record per booking. No duplicate.
No orphan. The eventual sync fills in the blanks on the **same** record
that the booking is already attached to.

## What We Trade Away

Both options give up the same thing: **the ability to track unbooked
calls inside this system.**

Today, if someone calls and never books, there is still a sticky note in
the leads sheet that says "this person called us." If we stop creating
sticky notes at call time, that visibility is lost from this system.

Two things to know about this trade:

1. The call data does not disappear. Invoca still has the call in its
   own platform, with recording, duration, source, and timestamps.
   Looking up "how many calls came in last week and how many converted"
   is still possible — it just lives in Invoca rather than in the
   leads sheet.

2. The cost-per-lead number changes meaning. Today, cost-per-lead is
   computed as advertising cost divided by the count of leads (including
   the unbooked sticky notes). Under this proposal, the database would
   only count booked calls. To preserve the old metric, the call count
   would have to be pulled from Invoca and used for the calculation.

If the owner relies heavily on the unbooked-call sticky notes for daily
work, this trade is too expensive and we should not do it. If the owner
mainly cares about bookings and only occasionally checks call volume,
this trade is fine and worth it.

## Why This Eliminates the Orphan Problem Entirely

The orphan problem in the current setup is caused by having two ways for
a customer record to be created:

- One way: a phone call comes in (creates a record with only the phone
  number).
- Another way: a booking is submitted (creates a record with only the
  job number, if no phone-only record was matched).

Two creation paths means two records can exist for the same customer.
That is the root cause.

Under this proposal, there is only **one** creation path: the booking.
A customer record can only come into existence as part of a booking.
There is no second path that can produce a competing record. There is
nothing to orphan, because nothing exists before the booking.

## How This Compares to Requiring Phone Number on the Form

Both proposals fix the orphan problem, but they fix it differently.

**Requiring Phone Number on the form** keeps the current setup and uses
the phone number as a safety net so the booking can always find the
original invoca sticky note. The trade-off is that the owner has to
type the phone number every time he books.

**Skipping the invoca sticky note entirely** removes the safety net by
removing the thing that needed saving. The trade-off is that unbooked
calls are no longer tracked in this system — they live in Invoca only.

| Concern | Require Phone on Form | Skip Invoca Sticky Note |
|---|---|---|
| Orphan rows | Prevented | Impossible |
| Owner types more | Yes (phone field) | No (or less, if extension does it) |
| Unbooked calls visible in leads sheet | Yes | No |
| Cost-per-lead formula stays the same | Yes | No (needs Invoca count) |
| Smallest change to current system | Yes | No |
| Cleanest end-state | Acceptable | Best |

## In One Sentence

> The duplicate problem comes from creating two kinds of customer
> records — one when the call arrives, and one when the booking
> arrives. Stop creating the first kind, and the duplicate becomes
> impossible.

That is the entire idea.
