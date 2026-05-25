# Why the Book Form Must Require Phone Number

This is a short explanation, written in plain language, of why the
"Job Number + Phone Number" pair must both be required on the booking form,
rather than Job Number alone.

It is meant to be read in two minutes.

## The Setup

Every time a customer calls the moving company, the system automatically
creates a small record in the database. That record contains **only the
phone number** at first. Nothing else. Just the phone number, the date,
the time, and which company the call came from.

Think of it as a sticky note that says "someone with this phone number
called us today." Nothing more.

The browser extension is the tool that can later attach the rest of the
information to that sticky note: the customer's name, the email, the
job number, the cubic feet, and so on. The owner does this while looking
at the Follow Up Estimates table in the Granot CRM.

## The Two Ways a Deal Gets Booked

There are two paths a deal can take from "phone call" to "booked job."

**Path A — The browser extension was used before booking.**

The owner used the browser extension to attach the job number (and the
rest of the customer information) to the original sticky note. Now the
sticky note has both a phone number and a job number on it.

When the booking form is submitted with the job number, the system looks
through all the sticky notes, finds the one with that job number, and
stamps it "booked." This is clean and correct.

**Path B — The browser extension was skipped.**

The owner never opened the browser extension. The original sticky note
still has only a phone number on it. There is nothing on it that mentions
the job number yet.

When the booking form is submitted with only the job number, the system
looks for a sticky note with that job number and **does not find one.**
It does not know about the original phone-only sticky note, because that
note has no job number written on it.

## What Goes Wrong in Path B

Because the system cannot find the original sticky note, it has to create
a brand new sticky note that says "this job number was booked." It then
stamps that new note "booked."

Now there are **two sticky notes for the same customer**:

1. The original one that came from the phone call. Only has a phone number.
   Says "not booked." Lives in the call leads sheet, forever.
2. The new one created from the booking. Only has a job number.
   Says "booked." Also lives in the call leads sheet.

Both end up in the Google Sheets. Both show up in reports. The original
one is now orphaned — it will never become anything. It just sits there
making the data look messier than it really is.

Later, if the owner runs a sync from the browser extension, the system
can fill in the missing information on the new sticky note (name, phone,
email, etc.) — but **the original orphan stays.** It can only be removed
by a manual cleanup step that costs more API calls, more Google Sheets
writes, and introduces more chances for things to go wrong.

## The Simple Fix

**Add a required Phone Number field to the booking form, right next to
the Job Number field.**

When the booking form is submitted with both a job number and a phone
number, the system tries to find the original sticky note in two ways:

1. First, it looks for a sticky note with that job number.
2. If it does not find one, it looks for a sticky note with that phone
   number.

Either way, it finds the original sticky note from the phone call and
stamps it "booked." No duplicate is created. No orphan is left behind.
The data stays clean from the very first moment the deal is booked.

## What This Saves Us From

Requiring Phone Number on the form is a 5-second change for whoever fills
out the form. In exchange, it prevents:

- Duplicate rows in the call leads Google Sheet.
- Orphaned records that linger in the database forever.
- Wrong cost-per-lead numbers, because the same phone call shows up as
  two leads.
- Wrong "did this lead book?" reports, because the original phone-only
  lead always says "did not book" even when it did.
- Expensive cleanup logic that has to find duplicates, delete the wrong
  one, re-point the booking, and re-write the sheets afterward.

## Why Not Just Use the Browser Extension Sync Afterwards?

The browser extension sync is still useful and will still exist. It is
the right tool for fixing data that came in messy, or for catching up
when the booking form was filled in too quickly.

But the browser extension sync is **eventual** — it only runs when someone
remembers to run it. In the meantime, the Google Sheets are wrong.
Reports made during that window are wrong. Other people looking at the
data are looking at duplicates and orphans.

Requiring Phone Number on the form makes the data **immediately correct**
the moment the booking is submitted. It removes the dependency on
"someone remembering to run the sync later."

## In One Sentence

> Without Phone Number on the form, every booking where the extension
> was skipped permanently creates a duplicate customer record. With
> Phone Number on the form, no duplicate is ever created, even when the
> extension is skipped.

That is the entire reason for the constraint.
