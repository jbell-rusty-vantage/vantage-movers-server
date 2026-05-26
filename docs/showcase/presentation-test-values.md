# Presentation Test Values And Scenarios

Use this document during the owner presentation as a quick set of values and expected outcomes.

## Shared Setup

Production API base:

```text
https://vantage-movers-main-server.vercel.app
```

Required API header for direct API calls:

```text
x-api-secret: <VANTAGE_API_SECRET>
content-type: application/json
```

Booked lead Google Form:

```text
https://docs.google.com/forms/d/e/1FAIpQLSe8l3mC7V5VQ4Oeo2I8kOTDeQlQACxihDe2KLaRlIN6Yv7o7Q/viewform
```

Use a short run ID so values are unique during the demo:

```text
RUN_ID=0526A
```

When using the website form, put the run ID in the first name, last name, email, or notes if the landing page has a notes field. For example, use `owner.demo+0526A.form1@example.com`.

## Reusable Lead Values

### Valid Form Lead

Use this for the normal form lead showcase.

```text
Landing URL: https://vantagequotes.com/?ref_no=SHOWCASE-0526A-FORM1
Source: Main Site Forms
First Name: Olivia
Last Name: Showcase
Full Name: Olivia Showcase
Email: owner.demo+0526A.form1@example.com
Phone: 202-555-0101
Pickup Zip: 10001
Destination Zip: 33101
Move Size: 3 Bedrooms
Move Date: 06/15/2026
Expected Local Type: long_distance
```

Expected result:

- Lead saves to MongoDB.
- Lead posts to Granot CRM.
- Granot `ref_no` equals the Mongo `_id`.
- Lead syncs to Master Leads `Forms`.
- Lead syncs to Main Site source sheet `Forms`.

Save after submission:

```text
FORM_LEAD_MONGO_ID=<copy from API response, sheet Mongo ID, or Granot ref_no>
GRANOT_JOB_NO=<copy once CRM job exists>
```

### Duplicate Form Lead

Submit the same values twice.

```text
Landing URL: https://vantagequotes.com/?ref_no=SHOWCASE-0526A-DUP
Source: Main Site Forms
First Name: Olivia
Last Name: Duplicate
Full Name: Olivia Duplicate
Email: owner.demo+0526A.duplicate@example.com
Phone: 202-555-0102
Pickup Zip: 10001
Destination Zip: 33101
Move Size: 2 Bedrooms
Move Date: 06/16/2026
```

Expected result for first submission:

- Saves to MongoDB.
- Posts to Granot CRM.
- Syncs to `Forms`.

Expected result for second submission:

- Saves to MongoDB.
- Does not post to Granot CRM.
- Syncs to `Duplicates`.
- Shows duplicate behavior exactly as instructed.

### Browser Extension Form Lead Update

Use the CRM row from the valid form lead.

```text
Mongo ID / Granot ref_no: <FORM_LEAD_MONGO_ID>
Cubic Feet: 865
Quoted: true
```

Expected result:

- Extension finds the form lead by Granot `ref_no`.
- Server updates the Mongo form lead.
- Sheets update `Cubic Feet` and `Quoted`.

### Form Lead Booking

Use this in the booked lead Google Form after the valid form lead exists.

```text
Booking Path: Form lead / Mongo ID path
Mongo Id: <FORM_LEAD_MONGO_ID>
Job Number: P0526F01
Agent: Josh
SplitAgent: Austin
Binder Amount: 1800
Expected Split: 900 / 900
Book Date: 06/17/2026
Deposit Amount: 2500
Merchant: Cardpointe
Source Label: Main Site Forms
```

Expected result:

- Booking attaches to the form lead.
- Master Booked `Booked Deals` receives the booking.
- Master Leads `Forms` row marks the lead as booked.
- Binder is split evenly between the two agents.

Save after booking:

```text
BOOKED_LEAD_MONGO_ID=<copy from booked sheet if needed>
LEAD_ID_FOR_CANCELLATION=<FORM_LEAD_MONGO_ID>
```

### Cancellation

Use the cancellation form or direct cancellation route with the lead ID from the lead sheet.

```text
Lead ID: <LEAD_ID_FOR_CANCELLATION>
Cancel Date: 06/18/2026
Refund Amount: 500
Reason: Showcase cancellation test
Cancelled By: Owner Demo
```

Expected result:

- Cancellation record is created.
- Booking is marked cancelled.
- Original lead row is marked cancelled.
- Master Booked `Cancelled Deals` receives the cancellation.
- Master Booked `Booked Deals` updates its cancelled status.

## Direct API Payloads

Use these if you want to hit the production API directly during the presentation.

### Create Form Lead

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/form-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "source_company": "Main Site Forms",
    "name": "Olivia Showcase",
    "pickup_zip": "10001",
    "destination_zip": "33101",
    "move_size": "3 Bedrooms",
    "move_date": "2026-06-15",
    "ref_no": "SHOWCASE-0526A-FORM1",
    "email": "owner.demo+0526A.form1@example.com",
    "phone_number": "202-555-0101"
  }'
```

### Create Call Lead

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/call-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "source_company": "Best Relocation Inbounds",
    "phone_number": "202-555-0201",
    "timestamp": "2026-05-26T19:00:00.000Z"
  }'
```

Expected result:

- Call lead saves to MongoDB.
- Call lead syncs to Master Leads `Calls`.
- Call lead syncs to Best Relocation source sheet `Calls`.

### Create Call Lead That Matches A Form Fill

First create this form lead:

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/form-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "source_company": "Best Relocation Forms",
    "name": "Felix Formfill",
    "pickup_zip": "90001",
    "destination_zip": "89101",
    "move_size": "2 Bedrooms",
    "move_date": "2026-06-20",
    "ref_no": "SHOWCASE-0526A-FORMFILL",
    "email": "owner.demo+0526A.formfill@example.com",
    "phone_number": "202-555-0202"
  }'
```

Then create the call lead with the same phone and matching source:

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/call-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "source_company": "Best Relocation Inbounds",
    "phone_number": "202-555-0202",
    "timestamp": "2026-05-26T19:05:00.000Z"
  }'
```

Expected result:

- Call lead saves.
- `FormFill` is true because a matching non-duplicate form lead exists for the same phone and source company.

### Book A Form Lead By Mongo ID

Replace `lead_ref` with the Mongo ID from the form lead response. This is the same path the Apps Script uses when the booked deal Google Form includes a Mongo ID.

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/booked-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "lead_ref": "<FORM_LEAD_MONGO_ID>",
    "lead_model": "FormLead",
    "job_no": "P0526F01",
    "book_date": "2026-06-17",
    "agent_allocations": [
      {
        "agent_name": "Josh",
        "binder_amount": 900
      },
      {
        "agent_name": "Austin",
        "binder_amount": 900
      }
    ],
    "total_binder_amount": 1800,
    "deposit_amount": 2500,
    "merchant": "Cardpointe",
    "source": "main_site",
    "submission_id": "showcase-0526A-form-booking"
  }'
```

Expected result:

- Booking attaches to the form lead.
- Binder amount splits 50/50 across Josh and Austin.
- Booked and source lead sheets update.

### Book A Call Lead By Phone And Job Number

Use this after creating a phone-only call lead.

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/booked-leads/from-source" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "lead_type": "CallLead",
    "call_job_no": "P0526C01",
    "call_phone_number": "202-555-0201",
    "book_date": "2026-06-19",
    "agent": "Brian",
    "split_agent": "Dylan",
    "binder_amount": 2200,
    "deposit_amount": 3000,
    "merchant": "Elavon",
    "source_company": "Best Relocation Inbounds",
    "submission_id": "showcase-0526A-call-booking"
  }'
```

Expected result:

- Server looks for job number first.
- If no job match exists, server finds the existing call lead by phone.
- Server adds the job number to that call lead.
- Booking attaches to the call lead.
- Sheets synchronize.

### Book A Call Lead With A Non-Matching Phone

Use this to show the phone-number-switch edge case.

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/booked-leads/from-source" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "lead_type": "CallLead",
    "call_job_no": "P0526C99",
    "call_phone_number": "202-555-0299",
    "book_date": "2026-06-20",
    "agent": "Jason",
    "binder_amount": 1400,
    "deposit_amount": 1400,
    "merchant": "Maverick",
    "source_company": "Best Relocation Inbounds",
    "submission_id": "showcase-0526A-unmatched-call-booking"
  }'
```

Expected result:

- Booking is preserved.
- Internal call lead stub is created.
- Booked deal appears in Master Booked `Booked Deals`.
- Stub call lead does not sync to the call lead sheets until resolved.

### Cancel A Booked Lead

Replace `lead_id` with the source lead Mongo ID from the lead sheet.

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/cancelled-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: <VANTAGE_API_SECRET>" \
  -d '{
    "lead_id": "<SOURCE_LEAD_MONGO_ID>",
    "cancel_date": "2026-06-18",
    "refund_amount": 500,
    "reason": "Showcase cancellation test",
    "notes": "Presentation demo cancellation",
    "cancelled_by": "Owner Demo"
  }'
```

Expected result:

- Cancellation attaches to the existing booking.
- Master Booked `Cancelled Deals` updates.
- Master Booked `Booked Deals` marks the booking cancelled.
- Source lead row marks the lead cancelled.

## Showcase Order

### 1. Duplicate Form Lead

Action:

- Submit the duplicate form lead values twice.

Expected talking point:

- The first form lead goes to normal `Forms` and Granot.
- The second form lead is preserved in `Duplicates`.
- The second form lead does not post to Granot.

### 2. Normal Form Lead To CRM And Sheets

Action:

- Submit the valid form lead values once.
- Copy the Mongo ID from the response, sheet, or Granot `ref_no`.

Expected talking point:

- MongoDB creates the permanent ID first.
- Granot receives that ID as `ref_no`.
- Google Sheets receives the same Mongo ID.

### 3. Browser Extension Updates Form Lead

Action:

- Open the Granot CRM row for the valid form lead.
- Run the browser extension update with `cubic_feet: 865` and `quoted: true`.

Expected talking point:

- The extension uses the Granot `ref_no` to find the Mongo lead.
- Mongo and sheets update without manual sheet editing.

### 4. Book The Form Lead

Action:

- Submit the booked lead form using the form lead Mongo ID.
- Use Josh and Austin with binder amount `1800`.

Expected talking point:

- Booking links back to the original form lead.
- Binder splits `900 / 900`.
- Master Leads and Master Booked both update.

### 5. Cancel The Booked Lead

Action:

- Submit cancellation with the source lead Mongo ID.

Expected talking point:

- Cancellation finds the attached booking.
- Booked and cancelled tabs update.
- Source lead row marks the cancellation.

### 6. Create A Basic Call Lead

Action:

- Create a call lead with only phone number and source company.

Expected talking point:

- This mimics Invoca.
- The call starts as a lightweight phone-only record.

### 7. Create A Call Lead With FormFill

Action:

- Create the form-fill form lead.
- Create the call lead with the same phone number and matching source.

Expected talking point:

- The server marks `FormFill`.
- This helps prevent bad advertiser payment attribution.

### 8. Book A Call Lead Before Extension Sync

Action:

- Create the basic call lead first.
- Book it with phone number and job number.

Expected talking point:

- The server tries job number first.
- Since the phone-only call lead has no job number yet, it then finds the call by phone.
- The booking still attaches correctly.

### 9. Extension Sync After Booking

Action:

- Later, run the browser extension sync against the CRM row for the call lead.

Expected talking point:

- The booked call lead can still be enriched after booking.
- Sheets synchronize again after enrichment.

### 10. Non-Matching Phone Booking

Action:

- Submit a call lead booking with a phone number that does not match an existing call lead.

Expected talking point:

- The booked deal is not lost.
- The internal call lead stub is not pushed to call lead sheets.
- This prevents misleading duplicate call lead spend when phone numbers switch.

## Quick Demo Checklist

- `FORM_LEAD_MONGO_ID`: copied after valid form submission.
- `CALL_LEAD_MONGO_ID`: copied after call lead creation if needed.
- `BOOKED_LEAD_MONGO_ID`: copied after booking if needed.
- `SOURCE_LEAD_MONGO_ID`: use the original form or call lead Mongo ID for cancellation.
- `JOB_NO_FORM`: `P0526F01`.
- `JOB_NO_CALL`: `P0526C01`.
- `JOB_NO_UNMATCHED`: `P0526C99`.
- `FORM_UPDATE_CUBIC_FEET`: `865`.
- `FORM_UPDATE_QUOTED`: `true`.
