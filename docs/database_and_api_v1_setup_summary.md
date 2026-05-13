# Database and API v1 Setup Summary

This document summarizes the database/API planning chat for the Vantage Movers server refactor and records the clarifications made after reviewing `complete_workflow_and_architecture_documentation.md`.

## Original Goal

The server is being refactored from the current lead webhook-oriented API into a production-grade Express REST API deployed on Vercel, backed by MongoDB/Mongoose and synchronized with Google Sheets.

The Mongo database is the source of truth. Google Sheets are derived owner and lead-source views used for reporting and tracking.

The target unit of work is to implement:

- Mongo/Mongoose schemas, relationships, virtuals, middleware where useful, and validation.
- REST CRUD routes for the new domain resources.
- Google Sheets synchronization for form leads, call leads, and booked deals.
- Server-side maps/config for source companies, sheet IDs, CPL values, tab names, and sheet headers.
- Postman-testable local and production API flows before connecting the current sites.

## Main Architecture Clarification

The chat clarified that this is a destructive refactor, not a backwards-compatible extension of the old single-lead flow.

The old single `Lead` model/webhook implementation should be replaced for the new v1 surface. The new API should use separate domain collections:

- `form_leads`
- `call_leads`
- `booked_leads`
- `cancelled_leads`
- `customers`

The target Mongo database is `vantagemovers`. The server should guarantee this by forcing `dbName: "vantagemovers"` in the Mongoose connection options, rather than relying only on the path inside `MONGO_URI`.

## API v1 Contract

The new API should be mounted under `/api/v1`.

Routes should use plural kebab-case resource names:

- `/api/v1/form-leads`
- `/api/v1/call-leads`
- `/api/v1/booked-leads`
- `/api/v1/cancelled-leads`
- `/api/v1/customers`

Each resource should support:

- `POST`
- `PATCH /:id`
- `DELETE /:id`
- `GET /` find-all for now

New API payloads and Mongo fields should use `snake_case`, matching the walkthrough and collection naming. Sheet projections convert to Title Case owner-facing headers only at the Google Sheets boundary.

All v1 routes should be protected with a shared API secret:

- Env var: `VANTAGE_API_SECRET`
- Header: `x-api-secret`

The old webhook-specific secret naming should not drive the new v1 API surface.

## Source Company and CPL Rules

`source_company` should be stored as a stable enum slug in Mongo, not as an owner-facing display label.

Canonical values:

- `tbm_leads`
- `tbm_prime_leads`
- `top10_leads`
- `best_relocation_leads`
- `main_site`
- `not_provided`

The server should hold maps for display names, CPL values, sheet env vars, and sheet containers.

CPL should be stored on `form_leads` and `call_leads`, but it must be computed server-side from the source-company map. Clients should not be trusted to send CPL directly.

Best Relocation has two CPL values:

- `long_distance`: `BEST_RELOCATION_LEADS_CPL`
- `local`: `BEST_RELOCATION_LOCALS_CPL`

## Local Classification

The original walkthrough used inconsistent shapes for `local`. The clarified rule is:

- Store `local` as an enum, not a boolean.
- Values: `local` or `long_distance`.
- For form leads, derive it strictly from pickup and delivery state/zip data.
- For call leads and booked leads, derive it when enough location data exists, but allow an explicit enum when location fields are incomplete.
- Sheet columns named `Local` can display a boolean or owner-friendly value derived from the enum.

## Collection and Relationship Decisions

### Form Leads

`form_leads` should include the original walkthrough fields such as source company, customer identity, pickup/destination data, move details, phone/email, ref number, legacy LID, CPL, local classification, booking-derived flags, cancellation-derived state, and sheet sync metadata.

New form leads should generate a legacy `lid` when one is missing, using the existing-style `LID...` format. It remains useful for backfill compatibility and syncs to the `Lead ID` sheet column.

### Call Leads

The walkthrough omitted `source_company` from call leads, but the chat clarified that call leads must include:

- `source_company`
- optional `source_company_site`
- derived `cpl`

Call leads should also support optional `name` and optional `email`. A call lead can exist with only a phone number, but creating a booking from a call lead requires enough customer identity to create/link a customer, specifically `name` and `phone_number`.

### Booked Leads

Bookings must require a valid linked source lead at creation time.

The relation should be polymorphic:

- `lead_ref`
- `lead_model`, with values for form lead or call lead

This was chosen over two nullable fields like `form_lead_mongo_id` and `call_lead_mongo_id` to avoid invalid states where both or neither are set.

`booked_leads` should include a required `job_no`, because the booked and calls sheet projections include `Job No`.

When a booking is created or updated, the service should:

- Validate that the linked source lead exists.
- Create or link the customer from the linked lead.
- Compute `over_2000` and `over_4000` from `deposit_amount`.
- Mirror `booked`, threshold flags, and relevant local/cancelled state back to the source lead.
- Sync both the booked row and the affected source lead row.

### Customers

Customer creation should happen as part of booking normalization.

Booking create/update may accept customer fields, but the main expected path is:

- Load the linked form/call lead.
- Use the lead as the customer source.
- Require at minimum a resolvable full name and phone number.
- Store a `customer` reference on the booking.

Customer reverse relationships should be exposed with virtuals where practical instead of maintaining stored arrays.

### Cancelled Leads

`cancelled_leads` must exist in the first v1 data model.

The clarified design is booking-linked cancellation:

- Require a `booked_lead` reference.
- Store optional copied snapshot fields from the booking for stable reporting.
- Do not create a separate cancellation sheet output in this unit.

When a cancellation is created, the service should:

- Save the cancellation.
- Mark the booking as cancelled.
- Mirror cancellation state to the source lead.
- Re-sync the affected Booked Deals row.
- Re-sync the affected Forms or Calls rows.

## Delete Semantics

The chat clarified that deletes should be hard deletes, not soft deletes.

However, cascade behavior should not block the core create/update/sync path. The planned rule is:

- Prevent deleting records with dependents unless the caller explicitly passes `cascade=true`.
- If a booking is deleted, unset booked/threshold fields on the source lead.
- If related cancellations exist, either delete them only with cascade or reject the delete.
- Sheet row deletion is lower priority for this unit; create/update sheet sync is the main target.

## Google Sheets Sync Decisions

The server should perform sheet sync immediately after successful create/update operations, while also storing per-target sync metadata for visibility and retry support.

Each synced document should store a reusable `sheet_sync[]` subdocument array. Each entry should include:

- `target`
- `spreadsheet_id`
- `tab_name`
- `row_number`
- `status`
- `last_synced_at`
- `last_error`
- `updated_since_last_sync`

Mongo `_id` is the canonical row identity in sheets:

- Use `Mongo ID` consistently for the synced document id.
- Booked rows also include `Mongo Lead ID` for the linked form/call lead.
- Store row metadata after append.
- If row metadata is missing, scan the tab by `Mongo ID` as a fallback.

## Sheet Containers and Tabs

Use the env var names from the walkthrough exactly:

- `MASTER_LEADS_SHEET_ID`
- `MASTER_BOOKED_SHEET_ID`
- `TBM_LEADS_SHEET_ID`
- `TBM_PRIME_LEADS_SHEET_ID`
- `TOP10_LEADS_SHEET_ID`
- `BEST_RELOCATION_LEADS_SHEET_ID`
- `MAINSITE_LEADS_SHEET_ID`

Missing required sheet IDs should be treated as configuration errors.

Forms sync should write to:

- `MASTER_LEADS_SHEET_ID`, tab `Forms`
- The matching source-company sheet container, tab `Forms`

Calls sync should write to:

- `MASTER_LEADS_SHEET_ID`, tab `Calls`
- The matching source-company sheet container, tab `Calls`

Booked sync should write to:

- `MASTER_BOOKED_SHEET_ID`, tab `Booked Deals`

Non-main source-company sheet containers should initialize these tabs:

- `Forms`
- `Calls`
- `Bad Leads`
- `Bad Calls`

The main site sheet container should initialize only:

- `Forms`
- `Calls`

`Bad Leads` and `Bad Calls` are created for non-main source containers but should not receive rows in this unit.

## Header Normalization

The walkthrough contains duplicate or variant headers, such as repeated phone columns and inconsistent Mongo ID naming. The chat clarified that v1 should define canonical headers in code instead of preserving duplicates.

Examples:

- Forms should have one `Phone Number`.
- Forms should use `Mongo ID` for the Mongo document id.
- Forms should use `Lead ID` for the legacy LID.
- Booked should use `Mongo ID` for the booking document id.
- Booked should use `Mongo Lead ID` for the linked source lead id.

## Implementation Plan Snapshot

The agreed implementation plan is:

1. Replace legacy API wiring with `/api/v1` routers and API secret middleware.
2. Create typed source-company, CPL, sheet-container, tab, and header maps.
3. Create the five Mongoose models and shared schema helpers.
4. Add Zod validators and service functions for CRUD plus relation-derived updates.
5. Rebuild Google Sheets helpers for tab/header creation, row upsert by `Mongo ID`, and `sheet_sync[]` metadata.
6. Remove or stop using the old single `Lead` model, route, validation, and service code.
7. Verify with typecheck and Postman/local smoke tests.

## Verification Targets

The first smoke-test flows should cover:

- Create a form lead.
- Create a call lead.
- Create a booking from a form lead.
- Create a booking from a call lead with sufficient customer identity.
- Create a cancellation from a booking.
- Update lead and booking records.
- Confirm source lead rows re-sync after booking/cancellation changes.
- Confirm Mongo writes land in `vantagemovers`.
- Confirm sheet tabs and canonical headers are created.
- Confirm row updates use `Mongo ID`.
- Confirm delete behavior with and without `cascade=true`.

