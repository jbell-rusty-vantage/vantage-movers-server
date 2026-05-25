# Vantage Movers Operational Rollout Report

## 1. System Overview

The system centralizes lead intake, CRM synchronization, booking/cancellation workflows, and sales processing automation for Vantage Movers.

It consists of:

- **Custom server/API:** The production backend receives leads, validates requests, stores records, posts form leads to Granot CRM, and triggers reporting syncs.
- **MongoDB lead storage:** Mongo stores form leads, call leads, booked deals, cancellations, customers, agents, and sheet sync status.
- **Browser extension:** Sales-side tool used inside Granot CRM to read CRM rows and synchronize updates back to the internal system.
- **Booking and cancellation forms:** Simple operational forms for creating booked deals and cancellations.
- **Granot CRM integration:** Form leads are sent to Granot using the Mongo lead ID as the CRM `leadno`, which appears in Granot as `ref_no`.
- **Google Sheets synchronization:** Leads, bookings, and cancellations are written to master and source-specific sheets.
- **WordPress form integrations:** Website forms submit directly to the backend through custom JavaScript handlers.

The owner and sales team will interact mainly with the WordPress forms, Granot CRM, the browser extension, the booking form, the cancellation form, and the new reporting sheets. The server and MongoDB operate in the background.

Current operational forms:

- Book Form: [https://docs.google.com/forms/d/e/1FAIpQLSfiIe3SQrmUoOwFevYsf444f2qqIXNZtZvH_HR3iXIkC_yf_w/viewform](https://docs.google.com/forms/d/e/1FAIpQLSfiIe3SQrmUoOwFevYsf444f2qqIXNZtZvH_HR3iXIkC_yf_w/viewform)
- Cancel Form: [https://docs.google.com/forms/d/e/1FAIpQLSf29ToC8Si078ML7n_rSduMnO6BAaNlX8-N1tkIoQmvCxuzMA/viewform](https://docs.google.com/forms/d/e/1FAIpQLSf29ToC8Si078ML7n_rSduMnO6BAaNlX8-N1tkIoQmvCxuzMA/viewform)

## 2. Primary Workflows

### Workflow A - Form Lead

1. A customer visits a source-specific website URL, for example:
  `vantagequotes.com/<source-provider>/?ref_no=445`
2. The WordPress form has a custom JavaScript submission handler attached to it. When the customer submits the form, that handler maps the form fields into the backend lead format and sends the lead to the Vantage API.
3. Lead data is validated twice:
  - In the browser before the request is sent.
  - On the server before anything is stored or forwarded.
4. The server creates a **Form Lead** in MongoDB. The Mongo `_id` becomes the canonical internal lead identifier.
5. The server sends the lead to Granot CRM. The Mongo `_id` is sent as the Granot `leadno`, which becomes `ref_no` inside the Granot CRM row.
6. The browser extension later uses that `ref_no` value, which is the Mongo `_id`, to update the matching internal lead record. The browser extension, when applied to form leads,  can and will  update:
  - Cubic feet
  - Quoted (Prior 1) 
7. After the frontend receives its response, the server continues background work using Vercel `waitUntil()` behavior. This keeps the form experience responsive while the system continues to:
  - Synchronize Google Sheets
  - Persist/update reporting data
8. Sheets are synchronized upon all lead and booking related (create, read, update) operations.

This design keeps the customer-facing form fast while still preserving the operational data trail across MongoDB, Granot CRM, and Google Sheets.

### Workflow B - Call Lead

Call leads currently work differently from form leads.

The system does **not** currently receive full caller information automatically because advertiser companies own the Invoca accounts and complete call tracking API access is not yet available.

Current call workflow:

1. A customer calls instead of filling out a form.
2. The system creates a mocked or incomplete call lead containing the available details:
  - Phone number
  - Source company
  - Timestamp
3. This mirrors the real sales process: a sales agent answers the phone, then later fills out customer and move details inside Granot CRM.  
4. The agent adds information in Granot, such as: 
  - Customer name
  - Pickup zip
  - Delivery zip
  - Job number (**)
5. The browser extension scans Granot call lead tables and searches for matching phone numbers in MongoDB.
6. If there is a clean phone match without conflict, the extension enriches the stored call lead, especially with the Granot-generated `job_no`.
7. For call leads, `job_no` becomes the key identifier required to create bookings.

This workflow bridges the gap between inbound phone calls and structured CRM/reporting data until full advertiser-side call tracking API access is available.

## 3. Booking and Cancellation Operations

The system now supports operational booking workflows.

The booking form is intentionally simple. Sales agents do not need to manage internal database details beyond entering the correct lead identifier for the lead type.

Form Lead Booking requires:

- Mongo Form Lead `_id`
- Job number
- Booking date
- Agent
- Optional split agent
- Binder/deposit/merchant/source details

Call Lead Booking requires:

- `job_no`
- Phone number
- Booking date
- Agent
- Optional split agent
- Binder/deposit/merchant/source details

The system supports up to two sales agents splitting binder/agent responsibility. When a split agent is supplied, the binder amount is split across the two agent allocations.

Cancellation workflows are also supported. A cancellation links back to an existing booked deal and records refund amount, cancellation date, reason/notes, and related reporting data. Cancellation records update the booked deal and source lead status, then synchronize to the booked/cancelled reporting sheets.

## 4. Browser Extension Responsibilities

The browser extension is the synchronization bridge between Granot CRM and the internal Mongo lead records.

It is used to: 

FORMS 

- Read Form Lead rows from Granot Follow Up Estimates.
- Confirm that Granot `ref_no` contains a valid Mongo lead ID.
- Update quoted status based on Granot priority level.
- Update cubic feet when available.
- Read the current Granot form edit page and sync that individual lead. (Can Ignore as you will use the full table view)  
- CALLS
- Read call lead tables and enrich incomplete call leads.
- Associate call leads with Granot `job_no` when a clean phone match exists.
- Preview conflicts before syncing, so agents can avoid bad updates.

For form leads, the extension depends on `ref_no` being the Mongo `_id`.

For call leads, the extension depends on a clean phone match and then uses `job_no` for downstream booking operations.

## 5. Go Live Plan

The system is effectively ready to go live and integrate directly into the WordPress website forms.

Going live means enabling production form submission handlers so new website leads automatically flow through:

- MongoDB storage
- Granot CRM posting
- Google Sheets synchronization

Operational rollout should include:

- Switching the team to the new reporting sheets.
- Processing bookings through the new booking form.
- Processing cancellations through the new cancellation form.
- Updating quoted status, cubic feet, and call lead enrichment through the browser extension.
- Confirming source-company mappings for each live form/provider.

Recommended next step: set aside a short guided onboarding/testing session on the owner’s device. Use that session to walk through the full workflow, verify production behavior, gather final edits or feature requests, and make sure the owner and sales team are comfortable before full rollout.

## 6. Important Limitations

- The current system does **not** support determining or representing “bad leads.” Some sheet tabs for bad leads exist structurally, but the live workflow does not classify leads as bad.
- Call lead automation is partially limited until advertiser-side Invoca/API access is available.
- Call lead matching depends on phone number quality. Duplicate or inconsistent phone numbers may require manual review.
- Background Google Sheets synchronization can fail independently of the frontend response. The system records sync status, but operational review is still needed if sheet data appears delayed or incomplete.

## 7. Additional Operational Suggestions

Missing operational concerns to confirm before full rollout:

- Confirm the production WordPress form handlers are installed on every source-provider form.
- Confirm all production environment variables are set: MongoDB, Granot CRM credentials, API secret, and Google Sheets IDs/service account access.
- Confirm the new sheets are shared with the Google service account used by the server.
- Confirm source-company naming is final for all providers, because reports and CPL logic depend on it.
- Confirm who is responsible for reviewing failed sheet syncs or CRM posting failures.

Potentially confusing workflow areas:

- Form lead bookings use Mongo Form Lead `_id`; call lead bookings use `job_no` plus phone number.
- Granot `ref_no` is expected to be the Mongo `_id` for form leads, not the original provider reference number.
- Call leads may start incomplete by design; this is expected until the sales agent fills out Granot and the extension enriches the record.

Rollout risks:

- A missing or incorrect WordPress handler could allow a lead to reach Granot but not Mongo, or vice versa.
- If agents forget to run the extension sync, quoted/cubic-feet/call-lead enrichment may lag behind Granot.
- If phone numbers are duplicated across call leads, the extension may flag conflicts instead of updating automatically.
- If the owner continues using old sheets during rollout, reporting may appear inconsistent.



