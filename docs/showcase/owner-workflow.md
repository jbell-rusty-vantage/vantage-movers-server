# Vantage Quotes Lead Workflow Showcase

This document explains how the Vantage Quotes landing page system works across the website, server API, MongoDB, Granot CRM, Google Sheets, Google Forms, and the browser extension.

The goal of the system is to make every lead traceable from first contact through quoting, booking, cancellation, and reporting.

## System Parts

The workflow has four main parts:

1. **Landing pages**: `vantagequotes.com` and advertiser landing pages collect form lead information.
2. **Main server API**: receives form leads, call leads, bookings, cancellations, and browser extension updates.
3. **MongoDB**: stores the official lead, booking, and cancellation records.
4. **Google Sheets** : provide the owner-facing reporting and sales workflow.
5. Granot CRM is a conduit for lead and customer data and is extended in order to update the database and hence the sheets

The browser extension connects Granot CRM back to MongoDB. It allows the owner to update form leads and call leads from CRM rows without manually copying data between systems.

## Core Rule

MongoDB is the system of record.

Google Sheets are synchronized from MongoDB.  The Granot CRM is posted to from the server route. When the API creates or updates a lead, booking, or cancellation, it stores the record first and then syncs the connected sheets. The API can return successfully while Google Sheets sync is still pending, so a short delay in the sheets is normal.

## Form Leads

### 1. Visitor Submits A Landing Page Form

A visitor lands on either:

- `https://vantagequotes.com/?ref_no=<tracking-ref>`
- `https://vantagequotes.com/<advertiser-landing>/?ref_no=<tracking-ref>`

The landing page JavaScript reads the submitted form fields:

- Pickup zip
- Destination zip
- Move date
- Move size
- First name
- Last name
- Email
- Phone
- Tracking reference from `ref_no`, when available

The page sends this data to the server route:

```text
POST /api/v1/form-leads
```

The server validates the payload, normalizes the source company, derives local vs long-distance when possible, and prepares the lead for MongoDB.

### 2. Duplicate Form Lead Handling

Before posting to Granot CRM, the server checks whether this is a duplicate form lead.

A form lead is considered a duplicate when all of these match an existing non-duplicate form lead:

- Same `source_company`
- Same email
- Same phone number

If it is a duplicate:

- The lead is still saved in MongoDB.
- The lead is marked `duplicate: true`.
- The server forces `post_to_granot: false`.
- The lead is **not posted to Granot CRM**.
- The lead syncs to the `Duplicates` tab on the Master Leads Sheet and the matching source-specific sheet.

This is intentional. The owner instructed that exact duplicate form leads should be visible in reporting but should not create duplicate CRM records.

**SHOWCASE:** Submit the same form twice with the same email and phone number. The first lead follows the normal path. The second lead appears in `Duplicates` and does not post to Granot.

### 3. Non-Duplicate Form Lead Handling

If the form lead is not a duplicate:

1. The lead is saved in MongoDB first.
2. MongoDB generates the lead's unique `_id`.
3. The server posts the lead to Granot CRM.
4. The persisted Tracking Reference (`FormLead.ref_no`) is sent to Granot as the CRM `leadno`.
5. Granot shows that Tracking Reference as the CRM `ref_no`.
6. The lead syncs to Google Sheets.

The Mongo `_id` remains the permanent Vantage Lead ID used by MongoDB, Google Sheets, bookings, and cancellations. For Granot matching, exact `FormLead.ref_no` is primary; a valid Mongo `_id`-shaped Granot `ref_no` is retained as a compatibility fallback only after exact lookup misses.

After a successful non-duplicate submission, the lead should appear in:

- Granot CRM
- Master Leads Sheet, `Forms` tab
- Source-specific leads sheet, `Forms` tab

**SHOWCASE:** Submit one valid form lead and show that its submitted Tracking Reference becomes the Granot `ref_no`, while the API-generated Mongo ID remains the Google Sheets `Mongo ID`.

### 4. Browser Extension Updates Form Leads

After the form lead is in Granot CRM, the owner can use the browser extension while viewing Follow Up Estimates.

The extension reads the Granot row and looks for `ref_no`. For form leads, it resolves exact `FormLead.ref_no` first, then accepts a valid Mongo `_id` as a compatibility fallback.

The extension can then update fields such as:

- `cubic_feet`
- `quoted`

The server route used for the update is:

```text
PATCH /api/v1/form-leads/:id
```

After the update, MongoDB is updated first and the sheets sync again. The owner can confirm the updated `Cubic Feet` and `Quoted` columns in the relevant lead sheet.

**SHOWCASE:** Use the browser extension on the CRM row created during the demo and update `cubic_feet` and `quoted`.

## Booking Form Leads

When the owner wants to book a form lead, he uses the booked lead Google Form:

[https://docs.google.com/forms/d/e/1FAIpQLSe8l3mC7V5VQ4Oeo2I8kOTDeQlQACxihDe2KLaRlIN6Yv7o7Q/viewform](https://docs.google.com/forms/d/e/1FAIpQLSe8l3mC7V5VQ4Oeo2I8kOTDeQlQACxihDe2KLaRlIN6Yv7o7Q/viewform)  

(URL Subject to change)

For a form lead booking, the important value is the form lead Mongo ID. When the Google Form submission includes Mongo ID, the Apps Script treats it as a form lead booking.

The booking form sends form lead bookings to:

```text
POST /api/v1/booked-leads
```

For the Mongo ID path, the Apps Script builds the request with:

- `lead_ref`: Mongo ID of the original form lead
- `lead_model`: `FormLead`
- `agent_allocations`: built from agent, split agent, and binder amount
- `total_binder_amount`: the full binder amount entered on the form
- `source`: resolved from the selected source label
- Optional job number

The owner enters these values in the Google Form:

- Mongo ID of the original form lead
- Optional job number
- Agent
- Optional split agent
- Full binder amount
- Book date
- Deposit amount
- Merchant
- Optional source label

The server finds the original form lead by Mongo ID and creates or updates the connected booking record.

If two agents are selected, the owner enters the full binder amount once. The server splits that binder amount evenly between the two agents and stores both agent allocations.

After booking:

- The source form lead is marked booked.
- The booking is written to MongoDB.
- The Master Leads Sheet updates the source lead row.
- The Master Booked Sheet updates the `Booked Deals` tab.

**SHOWCASE:** Book the form lead created earlier by entering its Mongo ID in the booked lead Google Form. Use two agents to show the 50/50 binder split.

## Cancellations

When the owner cancels a booked deal, the cancellation is attached back to the original source lead and booking.

The cancellation process sends data to:

```text
POST /api/v1/cancelled-leads
```

The owner enters the lead ID from the lead sheet. The server uses that lead ID to find the attached booking.

When the cancellation is created:

- A cancellation record is saved in MongoDB.
- The booking is marked cancelled.
- The original form or call lead is marked cancelled.
- The Master Booked Sheet updates `Booked Deals`.
- The Master Booked Sheet updates `Cancelled Deals`.
- The source lead sheet updates the lead row cancellation columns.

The system prevents the same booking from being cancelled twice.

**SHOWCASE:** Cancel a booked form lead or call lead by entering the lead ID from the lead sheet, then show the cancellation in `Cancelled Deals` and the updated source lead row.

## Call Leads

### 1. Initial Invoca Call Lead Intake

The Invoca retrieval process creates call leads as phone calls arrive.

For the presentation, this can be mocked by calling the production API directly and creating a call lead with only:

- Phone number
- Source company
- Timestamp, if provided

The route is:

```text
POST /api/v1/call-leads
```

At this point, the call lead may not have a customer name, email, job number, cubic feet, or quote information. It is intentionally a small initial record that says: this phone number called from this source company at this time.

**SHOWCASE:** Create a call lead through the production API with just phone number and source company.

### 2. Form Fill Detection

When a call lead is created, the server checks whether the same phone number already exists on a non-duplicate form lead from the same source company.

If it finds a match, the call lead is marked:

```text
form_fill: true
```

The Google Sheets call lead row shows this in the `FormFill` column.

This helps the owner with advertiser payment attribution. It shows that a phone call may also have had a matching form submission, so lead spend can be reviewed more accurately.

**SHOWCASE:** Create a form lead with a phone number, then create a call lead with the same phone number and source company. Show that the call lead has `FormFill` marked.

### 3. Browser Extension Enriches Call Leads

A call lead often starts with only a phone number. Later, a customer service representative may enter that caller into Granot CRM.

When the owner sees the call lead in Granot CRM, he can run the browser extension sync.

The extension sends CRM row data to:

```text
POST /api/v1/call-leads/enrichment/preview
POST /api/v1/call-leads/enrichment/sync
```

The server attempts to match  the existing call lead by job number first and phone number second. This ensures we match initial un-enriched call leads and also already enriched or already enriched AND booked call leads . The owner can use the browser extension before or after he submits a booked deal form.  



The call lead will be updated with:  

- Job number
- Customer name
- Phone
- Email
- From zip
- To zip
- Estimated cubic feet     


The most important enrichment field is `job_no`, because bookings can later be matched by job number. Per the owner's request we do not put customer name or email in the Calls tab of the Leads sheets; but they are stored in the database. 

If the extension finds the matching call lead, it updates the MongoDB call lead and then syncs the sheets.

## Call Lead Booking Scenarios

Call lead booking is designed to be safe whether the owner runs the browser extension before or after the booking.

When the booked deal Google Form does **not** include Mongo ID, the Apps Script treats the submission as a call lead booking and sends it to:

```text
POST /api/v1/booked-leads/from-source
```

### Scenario A: Extension Sync Before Booking

1. A call lead exists with phone number and source company.
2. The owner finds the lead in Granot CRM.
3. The owner runs the browser extension sync.
4. The existing call lead is updated with job number and CRM details.
5. The owner submits the booked lead form with phone number and job number.
6. The server finds the call lead by job number.
7. The booking is attached to the existing call lead.
8. Sheets synchronize.

This is the cleanest path.

### Scenario B: Booking Before Extension Sync

1. A call lead exists with only phone number and source company.
2. The owner books the deal before running the extension.
3. The owner submits the booked lead form with phone number and job number.
4. The server first searches for a call lead by job number.
5. No job number match exists yet.
6. The server then searches by phone number.
7. The existing phone-only call lead is found.
8. The server attaches the job number and booking to that call lead.
9. Sheets synchronize.
10. Later, the owner runs the browser extension sync from Granot CRM.
11. The call lead is enriched with customer details, (name, email if exists) and cubic feet.
12. Sheets synchronize again.

This means the owner is safe whether he syncs before or after booking.

### Scenario C: Phone Number Switch Or No Matching Call Lead

Sometimes the phone number changes during the sales process. The number entered in the booked deal form may not match any existing call lead.

In that case:

1. The owner submits the booked deal form with a phone number that does not match an existing call lead.
2. The server cannot find a call lead by job number.
3. The server cannot find a call lead by phone number.
4. The server creates an internal call lead stub.
5. The booking is attached to that internal stub.
6. The booking still syncs to the Master Booked Sheet.
7. The internal stub call lead does **not** sync to the lead sheets yet.

This is intentional. It preserves the booked deal record without creating a misleading extra call lead row in the call leads sheet. The owner can resolve the unmatched call lead later when he has the correct phone number or CRM row.

**SHOWCASE:** Submit a booked deal form with a call lead phone number that does not match any existing call lead. Show that the booked deal is retained, while the unmatched call stub is not pushed into the call lead sheet.

## Owner Summary

For form leads:

- The website submits the lead.
- MongoDB saves it first.
- Duplicates go to `Duplicates` and skip Granot.
- Non-duplicates go to Granot and sheets.
- The browser extension can update quoted status and cubic feet.
- Bookings and cancellations stay attached to the original Mongo lead ID.

For call leads:

- Invoca or the test API creates a phone-only call lead.
- The server marks `FormFill` when the same phone number already submitted a form.
- The browser extension can enrich the call lead from Granot CRM.
- Booking works whether enrichment happens before or after booking.
- If the phone number does not match, the booking is preserved without creating a misleading lead sheet row.

The main promise to the owner is simple: every lead can be tracked from source to CRM to sheet to booking to cancellation, and the system protects against duplicates, missed bookings, and reporting confusion.
