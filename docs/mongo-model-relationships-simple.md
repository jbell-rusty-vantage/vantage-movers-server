# Mongo Model Relationships - Simple View

This is a simpler, owner-friendly view of how the current MongoDB models connect.
The system is built around a lead lifecycle: a lead comes in, it may become booked,
and a booked move may later become cancelled.

## Simple Text Diagram

```text
                         +----------------+
                         |    Customer    |
                         |----------------|
                         | full_name      |
                         | phone_number   |
                         | email          |
                         +-------+--------+
                                 |
                                 | customer
                                 v
+----------------+       +-------+--------+       +-----------------+
|    FormLead    |       |   BookedLead   |       |      Agent      |
|----------------|       |----------------|       |-----------------|
| source_company |       | book_date      |       | name            |
| name           |       | job_no         |       | normalized_name |
| pickup_zip     |       | customer       |       | active          |
| destination_zip|       | lead_ref       |       | role            |
| move_size      |       | lead_model     |       +--------+--------+
| move_date      |       | agent_allocs   |                ^
| phone_number   |       | binder_amount  |                |
| email          |       | deposit_amount |                | agent
| booked         |<----->| cancelled      |                |
| cancelled      |       | sheet_sync     |       +--------+--------+
+-------+--------+       +-------+--------+       | AgentAllocation |
        ^                        |                |-----------------|
        | lead_ref               | booked_lead    | agent           |
        | when lead_model        |                | agent_snapshot  |
        | is FormLead            v                | binder_amount   |
        |                +-------+--------+       +-----------------+
        |                | CancelledLead  |
        |                |----------------|
        |                | booked_lead    |
        |                | customer       |
        |                | lead_ref       |
        |                | lead_model     |
        |                | cancel_date    |
        |                | refund_amount  |
        |                | reason         |
        |                | sheet_sync     |
        |                +-------+--------+
        |                        ^
        |                        |
+-------+--------+               |
|    CallLead    |---------------+
|----------------| lead_ref
| source_company | when lead_model
| name           | is CallLead
| phone_number   |
| email          |
| duration       |
| start_time     |
| end_time       |
| booked         |
| cancelled      |
| sheet_sync     |
+----------------+
```

## Main Idea

The database is organized around the movement of a lead through the business.
A lead starts as either a `FormLead` or a `CallLead`. These are the two source lead
types. A form lead usually comes from a web form or lead provider, while a call lead
comes from phone activity.

When a source lead turns into a booked job, the system creates a `BookedLead`.
That booking points back to the original source lead using two fields:
`lead_ref` stores the original lead's Mongo ID, and `lead_model` says whether that
ID belongs to `FormLead` or `CallLead`.

## Customers and Bookings

`Customer` stores the normalized customer identity: name, phone number, and email.
`BookedLead` points to `Customer` through its `customer` field. This allows multiple
bookings or cancellations to be connected back to the same person when needed.

In plain terms, the customer is the person, and the booked lead is the job that was
sold for that person.

## Form Leads and Call Leads

`FormLead` and `CallLead` are separate collections because they come from different
sources and have different data. A form lead has moving details like pickup zip,
destination zip, move size, and move date. A call lead has call details like duration,
start time, and end time.

Both lead types can point forward to a booking through their `booked` field. Both can
also point forward to a cancellation through their `cancelled` field. These fields make
it easy to see the current lifecycle state of the original lead.

## Booked Leads

`BookedLead` is the central model once a sale happens. It stores the booking date,
job number, customer, original lead reference, binder amount, deposit amount, merchant,
source, local or long-distance classification, and Google Sheets sync status.

The booking can come from either a form lead or a call lead. That is why the booking
uses both `lead_ref` and `lead_model`. Together, those fields answer: "Which original
lead produced this booking?"

## Agents and Agent Allocations

`Agent` stores the people or sales agents connected to booked jobs. A booking does not
store just one simple agent name. Instead, it stores an embedded list called
`agent_allocations`.

Each allocation points to an `Agent`, stores a snapshot of the agent name at the time
of booking, and stores the binder amount credited to that agent. This supports split
bookings where more than one agent receives credit.

## Cancelled Leads

`CancelledLead` is created when a booked job is cancelled. It points back to the
`BookedLead`, the `Customer`, and the original source lead. Like bookings, it uses
`lead_ref` and `lead_model` to know whether the original source was a `FormLead` or
a `CallLead`.

It also stores cancellation-specific information such as cancellation date, refund
amount, reason, notes, and who cancelled it.

## Google Sheets Sync

Several models include an embedded `sheet_sync` list. This is not a separate top-level
Mongo collection. It is stored inside each lead, booking, or cancellation record.

The purpose of `sheet_sync` is to track where that record was synced in Google Sheets,
including the spreadsheet, tab, row number, sync status, last sync time, and any sync
error.

## Short Summary

```text
FormLead or CallLead
        |
        | becomes booked
        v
BookedLead ---- belongs to ----> Customer
        |
        | credited through
        v
AgentAllocations ---- point to ----> Agent
        |
        | may become cancelled
        v
CancelledLead ---- points back to ----> BookedLead, Customer, and original lead
```

The most important relationship is:

```text
BookedLead.lead_ref + BookedLead.lead_model = original FormLead or CallLead
CancelledLead.lead_ref + CancelledLead.lead_model = original FormLead or CallLead
```

This lets the system keep one booking and cancellation workflow while still supporting
multiple lead sources.
