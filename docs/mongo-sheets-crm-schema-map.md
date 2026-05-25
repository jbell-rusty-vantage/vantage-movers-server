# Mongo, Sheets, and CRM Schema Map

This document describes how the Vantage Movers backend coordinates MongoDB collections, Google Sheets reporting, and Granot CRM identifiers.

## High-Level Coordination

```text
WordPress Form
  -> Vantage API
  -> Mongo form_leads
  -> Granot CRM lead post
       leadno = Mongo FormLead _id
       Granot ref_no = Mongo FormLead _id
  -> Google Sheets sync

Granot CRM + Browser Extension
  -> Reads ref_no / job_no / phone / est_cf / priority
  -> Updates Mongo form_leads or call_leads
  -> Google Sheets sync

Booking / Cancellation Forms
  -> Vantage API
  -> Mongo booked_leads / cancelled_leads
  -> Source lead status updated
  -> Google Sheets sync
```

## Domain Constants

| Domain Area | Values / Meaning |
|---|---|
| Mongo database | `vantagemovers` |
| Lead models | `FormLead`, `CallLead` |
| Local types | `local`, `long_distance` |
| Sheet sync statuses | `pending`, `synced`, `failed` |
| Move sizes | `Studio`, `2 Bedrooms`, `3 Bedrooms`, `4 Bedrooms`, `5+ Bedrooms`, `Office` |

### Source Companies

| Source Company | Label | Lead Sheet Env Var | CPL Rule | Bad Tabs |
|---|---|---|---|---|
| `tbm_leads` | TBM Leads | `TBM_LEADS_SHEET_ID` | `TBM_LEADS_CPL`, default `190` | Yes |
| `tbm_prime_leads` | TBM Prime Leads | `TBM_PRIME_LEADS_SHEET_ID` | `TBM_PRIME_LEADS_CPL`, default `190` | Yes |
| `top10_leads` | Top 10 Leads | `TOP10_LEADS_SHEET_ID` | `TOP10_LEADS_CPL`, default `190` | Yes |
| `best_relocation_leads` | Best Relocation Leads | `BEST_RELOCATION_LEADS_SHEET_ID` | local default `40`, long distance default `195` | Yes |
| `main_site` | main site | `MAINSITE_LEADS_SHEET_ID` | `MAINSITE_CPL`, default `0` | No |
| `not_provided` | not provided | none | `0` | No |

Source labels from Granot or forms are normalized into these source company slugs before storage and reporting.

## Mongo Collections

### `form_leads`

Primary record for leads submitted through website forms.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Canonical form lead ID; sent to Granot as `leadno` and later used as Granot `ref_no`. |
| `source_company` | source enum | Normalized provider/source. |
| `name` | string | Customer name. |
| `source_company_site` | string | Website/domain source. |
| `timestamp` | date | Lead creation/submission time. |
| `lid` | string, unique sparse | Lead ID / tracking notes value. |
| `pickup_zip` | string | Origin zip. |
| `destination_zip` | string | Destination zip. |
| `pickup_state` | string | Derived or submitted pickup state. |
| `delivery_state` | string | Derived or submitted delivery state. |
| `move_size` | move size enum | Customer-selected move size. |
| `move_date` | date | Requested move date. |
| `ref_no` | string | Original form/provider reference if supplied; not the canonical internal ID. |
| `booked` | ObjectId -> `booked_leads` | Booking linked to this lead. |
| `over_2000` | boolean | Deposit threshold flag mirrored from booking. |
| `over_4000` | boolean | Deposit threshold flag mirrored from booking. |
| `local` | `local` / `long_distance` | Derived from pickup/delivery states. |
| `email` | string | Customer email. |
| `phone_number` | string | Customer phone. |
| `cpl` | number | Cost-per-lead resolved from source and local type. |
| `quoted` | boolean | Quote status, often updated by the browser extension from Granot priority. |
| `post_to_granot` | boolean | Whether the server should post this lead to Granot. |
| `cancelled` | ObjectId -> `cancelled_leads` | Cancellation linked to this lead. |
| `cubic_feet` | number | Estimated cubic feet, usually synced from Granot. |
| `sheet_sync` | sync entries | Per-sheet sync status and row tracking. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

Important indexes: `source_company + createdAt`, `phone_number`, `ref_no`, `email`.

### `call_leads`

Primary record for inbound phone leads, often incomplete at creation.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Canonical call lead ID. |
| `source_company` | source enum | Normalized source/provider. |
| `source_company_site` | string | Website/source context if available. |
| `timestamp` | date | Call lead creation time. |
| `job_no` | string | Granot job number; required for call lead booking. |
| `name` | string | Customer name, often enriched later. |
| `email` | string | Customer email, often enriched later. |
| `phone_number` | string | Caller phone number. |
| `normalized_phone_number` | string | Phone normalized for matching; set automatically before validation. |
| `duration` | number | Call duration if available. |
| `start_time`, `end_time` | date | Call timing if available. |
| `booked` | ObjectId -> `booked_leads` | Booking linked to this call lead. |
| `cancelled` | ObjectId -> `cancelled_leads` | Cancellation linked to this call lead. |
| `over_2000` | boolean | Deposit threshold flag mirrored from booking. |
| `over_4000` | boolean | Deposit threshold flag mirrored from booking. |
| `local` | optional local enum | Local/long-distance status, often enriched from zips. |
| `pickup_zip` | string | Origin zip, often enriched from Granot. |
| `delivery_zip` | string | Destination zip, often enriched from Granot. |
| `pickup_state` | string | Derived pickup state. |
| `delivery_state` | string | Derived delivery state. |
| `cubic_feet` | number | Estimated cubic feet from Granot. |
| `cpl` | number | Cost-per-lead resolved from source/local type. |
| `sheet_sync` | sync entries | Per-sheet sync status and row tracking. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

Important indexes: `source_company + createdAt`, `phone_number`, `normalized_phone_number + createdAt`.

### `booked_leads`

Operational booking record linked to either a form lead or call lead.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Booking ID. |
| `timestamp` | date | Booking submission time. |
| `book_date` | date | Business booking date. |
| `job_no` | string | Granot job number. |
| `customer` | ObjectId -> `customers` | Customer record created/upserted from the source lead. |
| `lead_ref` | ObjectId | Linked source lead ID. |
| `lead_model` | `FormLead` / `CallLead` | Which collection `lead_ref` belongs to. |
| `agent_allocations` | array | One or two agent allocations with agent ID, name snapshot, and binder amount. |
| `total_binder_amount` | number | Total binder amount across allocations. |
| `deposit_amount` | number | Deposit amount used for threshold flags. |
| `merchant` | string | Payment merchant. |
| `source` | string | Source shown in booking reports. |
| `submission_id` | string | Optional idempotency key from form submission. |
| `local` | local enum | Local/long-distance classification. |
| `over_2000` | boolean | Deposit exceeds 2000. |
| `over_4000` | boolean | Deposit exceeds 4000. |
| `cancelled` | ObjectId -> `cancelled_leads` | Cancellation linked to this booking. |
| `sheet_sync` | sync entries | Per-sheet sync status and row tracking. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

Important indexes: `job_no`, `customer`, `lead_ref`, `lead_ref + lead_model`, `submission_id`.

### `cancelled_leads`

Operational cancellation record linked to a booked deal and source lead.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Cancellation ID. |
| `timestamp` | date | Cancellation submission time. |
| `booked_lead` | ObjectId -> `booked_leads` | Booking being cancelled. |
| `customer` | ObjectId -> `customers` | Customer associated with the booking. |
| `lead_ref` | ObjectId | Source lead ID. |
| `lead_model` | `FormLead` / `CallLead` | Which source lead collection is linked. |
| `reason` | string | Cancellation reason. |
| `notes` | string | Additional notes. |
| `cancelled_by` | string | Person/user submitting cancellation. |
| `cancel_date` | date | Business cancellation date. |
| `agent` | string | Primary booking agent snapshot. |
| `book_date` | date | Original booking date snapshot. |
| `job_no` | string | Granot job number snapshot. |
| `customer_name` | string | Customer name snapshot. |
| `refund_amount` | number | Refund amount. |
| `merchant` | string | Merchant snapshot. |
| `source` | string | Source snapshot. |
| `sheet_sync` | sync entries | Per-sheet sync status and row tracking. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

### `customers`

Customer identity record created/upserted during booking.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Customer ID. |
| `full_name` | string | Customer name. |
| `phone_number` | string | Customer phone; used for customer upsert. |
| `email` | string | Customer email. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

Virtual relationships: `booked_leads`, `cancelled_leads`.

### `agents`

Agent identity record created/upserted from booking submissions.

| Field | Type / Shape | Purpose |
|---|---|---|
| `_id` | ObjectId | Agent ID. |
| `name` | string | Display name. |
| `normalized_name` | string, unique | Lowercase normalized name used for deduplication. |
| `active` | boolean | Active flag. |
| `role` | string | Defaults to `agent`. |
| `created_from` | string | Defaults to `booked_lead`. |
| `createdAt`, `updatedAt` | date | Mongo timestamps. |

### Embedded `sheet_sync`

`form_leads`, `call_leads`, `booked_leads`, and `cancelled_leads` store sheet sync history.

| Field | Purpose |
|---|---|
| `target` | Logical sheet target, such as `master_forms`, `source_forms`, `master_booked`. |
| `spreadsheet_id` | Google Spreadsheet ID. |
| `tab_name` | Sheet tab name. |
| `row_number` | Last known row number for updates/deletes. |
| `status` | `pending`, `synced`, or `failed`. |
| `last_synced_at` | Last successful sync time. |
| `last_error` | Last sync error, if any. |
| `updated_since_last_sync` | Whether stored data still needs sync attention. |

## Google Sheets Structure

### Sheet Containers

| Container | Env Var | Purpose |
|---|---|---|
| Master Leads Sheet | `MASTER_LEADS_SHEET_ID` | Central lead reporting for form and call leads. |
| Master Booked Sheet | `MASTER_BOOKED_SHEET_ID` | Central booked and cancelled deal reporting. |
| Source Lead Sheets | source-specific env vars | Provider-level forms/calls reporting. |

### Tabs by Container

| Container | Tabs |
|---|---|
| Master Leads Sheet | `Forms`, `Calls` |
| Master Booked Sheet | `Booked Deals`, `Cancelled Deals` |
| Source Lead Sheets with bad tabs enabled | `Forms`, `Calls`, `Bad Leads`, `Bad Calls` |
| Source Lead Sheets without bad tabs | `Forms`, `Calls` |

Note: `Bad Leads` and `Bad Calls` tabs are structurally supported for some source sheets, but the current operational workflow does not classify or sync bad leads.

## Sheet Columns and Mongo Mapping

### `Forms` Tab

| Column | Mongo Source |
|---|---|
| Timestamp | `form_leads.timestamp` |
| Name | `form_leads.name` |
| Pickup Zip | `form_leads.pickup_zip` |
| Destination Zip | `form_leads.destination_zip` |
| Pickup State | `form_leads.pickup_state` |
| Delivery State | `form_leads.delivery_state` |
| Move Size | `form_leads.move_size` |
| Move Date | `form_leads.move_date` |
| Phone Number | `form_leads.phone_number` |
| Mongo ID | `form_leads._id` |
| Ref No | `form_leads.ref_no`, or `not provided` |
| Booked | `booked` if `form_leads.booked` exists |
| OVER 2000 | `>2k` if `form_leads.over_2000` is true |
| OVER 4000 | `>4k` if `form_leads.over_4000` is true |
| Cancelled | `cancelled` if `form_leads.cancelled` exists |
| Local | `form_leads.local` |
| Cubic Feet | `form_leads.cubic_feet` |
| Lead ID | `form_leads.lid` |
| Source Company | display label for `form_leads.source_company` |
| Source Company Site | `form_leads.source_company_site` |
| Quoted | `quoted` if `form_leads.quoted` is true |

### `Calls` Tab

| Column | Mongo Source |
|---|---|
| Timestamp | `call_leads.timestamp` |
| Phone Number | `call_leads.phone_number` |
| Duration | `call_leads.duration` |
| Booked | `booked` if `call_leads.booked` exists |
| Over 2000 | `>2k` if `call_leads.over_2000` is true |
| Over 4000 | `>4k` if `call_leads.over_4000` is true |
| Cancelled | `cancelled` if `call_leads.cancelled` exists |
| Local | `call_leads.local`, blank if unknown |
| Cubic Feet | `call_leads.cubic_feet` |
| Mongo ID | `call_leads._id` |
| Source Company | display label for `call_leads.source_company` |

### `Booked Deals` Tab

| Column | Mongo Source |
|---|---|
| Timestamp | `booked_leads.timestamp` |
| Agent | first `agent_allocations.agent_name_snapshot` |
| SplitAgent | second `agent_allocations.agent_name_snapshot`, if present |
| Binder Amount | `booked_leads.total_binder_amount` |
| Split | `TRUE` when two named allocations exist with a non-zero amount |
| Book Date | `booked_leads.book_date` |
| Job No | `booked_leads.job_no` |
| Customer Name | populated `customers.full_name` |
| Deposit Amount | `booked_leads.deposit_amount` |
| Merchant | `booked_leads.merchant` |
| Source | `booked_leads.source` |
| Mongo ID | `booked_leads._id` |
| Mongo Lead ID | `booked_leads.lead_ref` |
| Local | `booked_leads.local` |
| Cancelled | `cancelled` if `booked_leads.cancelled` exists |

### `Cancelled Deals` Tab

| Column | Mongo Source |
|---|---|
| Timestamp | `cancelled_leads.timestamp` |
| Agent | `cancelled_leads.agent` |
| Cancel Date | `cancelled_leads.cancel_date` |
| Job No | `cancelled_leads.job_no` |
| Customer Name | `cancelled_leads.customer_name` |
| Refund Amount | `cancelled_leads.refund_amount` |
| Source | `cancelled_leads.source` |
| Mongo ID | `cancelled_leads._id` |
| Lead Mongo ID | `cancelled_leads.lead_ref` |

## CRM Coordination

### Form Lead Post to Granot

When a form lead is created and `post_to_granot` is true, the server posts to the Granot lead gateway.

| Granot Payload Field | Source |
|---|---|
| `label` | Submitted `crm_company_label`, default `Get Movers` |
| `firstname` | First token from `form_leads.name` |
| `lastname` | Last token from `form_leads.name`; single-word names are duplicated |
| `ozip` | `form_leads.pickup_zip` |
| `dzip` | `form_leads.destination_zip` |
| `email` | `form_leads.email` |
| `phone1` | `form_leads.phone_number` |
| `movesize` | `form_leads.move_size` |
| `movedte` | `form_leads.move_date` formatted as `M/D/YYYY` |
| `notes` | `form_leads.lid`, or a generated lead ID |
| `leadno` | `form_leads._id` |

Critical identifier rule:

```text
Mongo form_leads._id
  -> Granot leadno
  -> Granot ref_no
  -> Browser extension lookup key
  -> Mongo form_leads._id
```

### Form Lead Extension Updates

The extension treats Granot Form Lead rows as syncable only when:

- `ref_no` is a valid Mongo ObjectId.
- Granot priority is supported.
- Priority `0` maps to `quoted = false`.
- Priority `1` maps to `quoted = true`.
- `est_cf`, when present, maps to `form_leads.cubic_feet`.

### Call Lead Extension Updates

For call leads, Granot does not start with the Mongo ID. The extension bridges the records by phone number.

```text
Granot call row phone
  -> normalized phone search
  -> Mongo call_leads candidate
  -> if clean match, update job_no/name/email/zips/cubic_feet/local
  -> Sheets sync
```

Call lead enrichment can return statuses such as `updateable`, `updated`, `unchanged`, `conflict`, `no_match`, `invalid`, or `failed`.

## Sheet Sync Behavior

Sheets are synchronized as upserts keyed by Mongo ID:

1. The sync process checks the document’s stored `sheet_sync.row_number`.
2. If that row still contains the same Mongo ID, the row is updated.
3. If not, the sheet is searched by the `Mongo ID` column.
4. If found, the existing row is updated.
5. If not found, a new row is appended.

This keeps Sheets aligned with Mongo even when rows are updated later, while still allowing the system to recover if a stored row number becomes stale.

