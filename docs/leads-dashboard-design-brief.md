# Leads Dashboard Design Brief

**Audience:** Claude Design App (component fidelity) + frontend engineers integrating with `vantage-main-server`.  
**Scope:** Everything about **leads** — list/search/filter, book, cancel, mark bad, move-date urgency, and on-demand contact.  
**Source of truth:** models, admin browse/search APIs, and operational admin workflows as of this document.

---

## 0. The two lead types (explicit)

There are exactly **two** lead models in the operational system:

| Type | Mongo collection | Model name | How it enters the system | Primary identity |
|------|------------------|------------|--------------------------|------------------|
| **Form Lead** | `form_leads` | `FormLead` | Web quote forms / CRM form ingest | Mongo `_id`, phone, email, `ref_no` / `lid` |
| **Call Lead** | `call_leads` | `CallLead` | RingCentral (webhook or call-log sync), or created at booking time | Mongo `_id`, phone and/or `job_no` |

**UI rule:** Treat them as sibling record types with a shared lifecycle vocabulary (`booked`, `cancelled`, source company, receiver agent) but **different field sets and different actions**.

- **Form leads** support: quote metadata (`move_size`, `move_date`, `quoted`, `cubic_feet`), **bad lead** marking, automatic **SMS confirmation** (when consent + messaging mode allow), and booking by `form_lead_id`.
- **Call leads** support: call metadata (`duration`, `start_time`/`end_time`, RingCentral ids), `job_no`, optional move location fields, **no `bad_lead` field**, and booking by phone / job number.

Duplicates are the same underlying models with `duplicate: true`. The admin UI splits them into separate pages (`form-leads` vs `duplicate-form-leads`, `call-leads` vs `duplicate-call-leads`) so operators never mix billable and quarantined leads.

```text
LeadType = "FormLead" | "CallLead"
```

Analytics and bookings use the same enum via `LEAD_MODELS` / `lead_model` / `lead_type`.

---

## 1. Complete filter and search inventory

Design the leads list as:

1. A **type switch or separate routes** (`Form Leads` | `Call Leads`)
2. A **global search** (`q`) plus **sidebar filters**
3. A **date range** on the resource’s date field
4. Optional **sort**

All list browsing goes through admin browse:

`GET /api/v1/admin/{form-leads|call-leads}`  
(proxied via admin `/api/proxy/...`)

Global cross-resource search:

`GET /api/v1/admin/search?q=...`

### 1.1 Shared chrome (both lead types)

| Control | Param | Behavior |
|---------|-------|----------|
| Free-text search | `q` | Case-insensitive contains across configured `qFields`. If `q` is a valid Mongo ObjectId, also matches `_id`. |
| Date from / to | `from`, `to` | Inclusive range on `date_field` (default `timestamp`) |
| Date field override | `date_field` | Form: `timestamp` \| `createdAt` \| `move_date`. Call: `timestamp` \| `createdAt` \| `start_time` \| `end_time` |
| Sort | `sort`, `direction` | See allowed sorts below |
| Pagination | `page`, `limit` | Default `limit=50`, max `250` |
| Database scope | `database_scope` | `production` (default) \| `historical` \| `combined` |
| Duplicate partition | `duplicate` | UI pages fix this: normal lists force `duplicate=false`; duplicate pages force `true` |

### 1.2 Form Lead filters (complete)

| UI label | Query param | Control type | Notes |
|----------|-------------|--------------|-------|
| Source company | `source_company` | select | Matches company slug **or** label snapshots |
| Source granularity | `source_granularity_key` | select | Exact, case-insensitive |
| Lead source company id | `lead_source_company` | select (advanced) | ObjectId of `LeadSourceCompany` |
| Receiver agent (Sales Rep) | `receiver_agent` | select | ObjectId of `Agent`; hidden on historical scope |
| Name | `name` | text | Searches `name`, `first_name`, `last_name` |
| Email | `email` | text | |
| Phone | `phone_number` | text | Also matches `normalized_phone_number` |
| Ref number | `ref_no` | text | Also matches `normalized_ref_no` |
| Booked | `booked` | Yes/No | Presence of `booked` ObjectId ref |
| Cancelled | `cancelled` | Yes/No | Presence of `cancelled` ObjectId ref |
| Move date before created | `past_move_date` | Yes/No | Form-only: `move_date` calendar day is ≥1 day before submission `timestamp` |
| Move size | `move_size` | select | Enum: Studio, 1–4 Bedrooms, 5+ Bedrooms, Office |
| Pickup city / state / zip | `pickup_city`, `pickup_state`, `pickup_zip` | text | Available to API; may be secondary in UI |
| Delivery city / state / zip | `delivery_city`, `delivery_state`, `delivery_zip` | text | Delivery zip also matches `destination_zip` |
| Local type | `local` | select | `local` \| `long_distance` (API-supported) |

**Form `q` fields:** name, first/last name, email, phone, source company + label snapshots, `ref_no`, `lid`, pickup/delivery city.

**Form allowed sorts:** `createdAt`, `timestamp`, `move_date`, `source_company`, `name`, `ref_no`.

**Form table columns (current operational UI):** Created, Name, First, Last, Phone, Email, Source, Pickup City, Delivery City, Ref, Move size, Bad Lead, SMS Sent, Booked, Cancelled — plus action columns Book / Bad when eligible.

### 1.3 Call Lead filters (complete)

| UI label | Query param | Control type | Notes |
|----------|-------------|--------------|-------|
| Source company | `source_company` | select | Same snapshot-aware matching as forms |
| Source granularity | `source_granularity_key` | select | Exact |
| Lead source company id | `lead_source_company` | select (advanced) | ObjectId |
| Receiver agent | `receiver_agent` | select | ObjectId |
| Name | `name` | text | |
| Email | `email` | text | |
| Phone | `phone_number` | text | + normalized |
| Job number | `job_no` | text | + `normalized_job_no` |
| Booked | `booked` | Yes/No | |
| Cancelled | `cancelled` | Yes/No | |
| Local type | `local` | select | `local` \| `long_distance` |
| Pickup / delivery location | city/state/zip params | text | Optional location fields on call leads |

**Call `q` fields:** name, first/last, email, phone (+ normalized), source company + snapshots, `job_no`, pickup/delivery city.

**Call allowed sorts:** `createdAt`, `timestamp`, `start_time`, `end_time`, `source_company`, `job_no`.

**Call table columns:** Created, Name, First, Last, Phone, Email, Job, Source, Pickup City, Delivery City, Local, Booked, Cancelled — plus Book action when not booked.

### 1.4 Global search badges (design cues)

When a lead appears in global search, badge vocabulary includes lifecycle flags such as `booked` / `cancelled` (and related lead badges from `adminSearch.service`). Deep-link:

- Form → `/form-leads?record={id}`
- Call → `/call-leads?record={id}`

### 1.5 Analytics-adjacent lead filters (not the list UI, but related)

`analyticsFilters.leadMatch` supports analytics queries with:

- `lead_type`: `FormLead` \| `CallLead`
- `from` / `to` on lead `timestamp`
- `local`
- `source_company`
- `source_granularity_key`

Use these for dashboard **charts**, not for the operational lead table (which uses admin browse).

### 1.6 Component contract — `LeadListFilters`

```ts
type LeadListFilters = {
  leadType: "FormLead" | "CallLead";
  q?: string;
  from?: string; // ISO / Florida calendar date string as used by admin
  to?: string;
  date_field?: string;
  source_company?: string;
  source_granularity_key?: string;
  receiver_agent?: string; // Agent ObjectId
  name?: string;
  email?: string;
  phone_number?: string;
  // Form-only
  ref_no?: string;
  move_size?: string;
  past_move_date?: boolean;
  // Call-only
  job_no?: string;
  local?: "local" | "long_distance";
  // Shared lifecycle
  booked?: boolean;
  cancelled?: boolean;
  duplicate: boolean; // fixed by page
  sort?: string;
  direction?: "asc" | "desc";
  page: number;
  limit: number;
};
```

---

## 2. Booking flow and smart pre-fills

### 2.1 Mental model

Booking **imbues a lead into a booking**. The booking (`BookedLead`) stores money/agent/merchant/job data and points back at the lead via:

- `lead_ref` → FormLead or CallLead `_id`
- `lead_model` → `"FormLead"` | `"CallLead"`

The lead stores the reverse pointer:

- `lead.booked` → BookedLead `_id`
- plus mirrored flags `over_2000`, `over_4000`, and often `local`

There are four booking entry modes in the current booking form; for **leads**, only the first matters:

| Mode | Lead required? | API |
|------|----------------|-----|
| **From source lead** | Yes (Form or Call) | `createBookedLeadFromSource` |
| Referral | No | `createReferralBooking` |
| Leadless | No | `createLeadlessBooking` |

### 2.2 Operator path (design this as one composition)

```text
Lead detail / list row
  → CTA "Book this lead" (hidden if already booked)
  → /bookings/new?...prefill query...
  → BookingForm sections:
       1. Lead Source (type + identity fields)
       2. Booking Details (date, agents, binder, deposit, merchant)
       3. Customer (optional overrides)
  → Submit → POST booked-from-source
  → Invalidate lists/details/search/analytics
```

### 2.3 Smart pre-fills (what the dashboard must pass)

Current admin deep-link builder (`getBookingQuery`):

**From a Form Lead**

| Prefill | Query param | Form field |
|---------|-------------|------------|
| Lead type | `lead_type=FormLead` | Lead type select |
| Form lead Mongo ID | `lead_id` → `form_lead_id` | Form lead Mongo ID |

Still required (not prefilled today): `job_no`, `book_date` (defaults to **today Florida**), primary `agent`, `merchant`, `binder_amount`, `deposit_amount`.

**From a Call Lead**

| Prefill | Query param | Form field |
|---------|-------------|------------|
| Lead type | `lead_type=CallLead` | Lead type select |
| Phone | `call_phone_number` | Call phone number |

Still required: `call_job_no` (job number), booking money/agent/merchant fields.  
**Design opportunity:** also prefill `call_job_no` from `record.job_no` when present (UI copy already implies job + phone; wire both for fidelity).

**Recommended richer pre-fills for Claude Design (safe, lead-owned fields)**

These are not all wired today, but they map cleanly to lead documents and reduce operator typing:

| Field | FormLead source | CallLead source | Booking form usage |
|-------|-----------------|-----------------|--------------------|
| Customer name | `name` / first+last | `name` / first+last | Optional `customer_name` override |
| Customer phone | `phone_number` | `phone_number` | Optional `customer_phone` |
| Source company | `source_company` or label snapshot | same | Optional override select |
| Local type | derived `local` | `local` | Shown for referral/leadless; for source bookings `local` is taken from the lead |
| Job number | _(usually empty until booking)_ | `job_no` | Call: `call_job_no`; Form: operator-entered Granot job |

Do **not** pretend booking owns `move_date` — that stays on the FormLead (see §6).

### 2.4 Submit payload shapes (backend contract)

**FormLead booking**

```json
{
  "lead_type": "FormLead",
  "form_lead_id": "<ObjectId>",
  "job_no": "<string>",
  "book_date": "YYYY-MM-DD",
  "agent": "<agent name>",
  "split_agent": "<optional>",
  "binder_amount": 0,
  "deposit_amount": 0,
  "merchant": "<string>",
  "source_company": "<optional override>",
  "customer_name": "<optional>",
  "customer_phone": "<optional>"
}
```

**CallLead booking**

```json
{
  "lead_type": "CallLead",
  "call_job_no": "<string>",
  "call_phone_number": "<string>",
  "book_date": "YYYY-MM-DD",
  "agent": "<agent name>",
  "split_agent": "<optional>",
  "binder_amount": 0,
  "deposit_amount": 0,
  "merchant": "<string>",
  "source_company": "<optional override>",
  "customer_name": "<optional>",
  "customer_phone": "<optional>"
}
```

### 2.5 Backend resolution behavior (so UI can explain failures)

For **FormLead**: load by `form_lead_id` (404 if missing).

For **CallLead**:

1. If `call_job_no` matches exactly one call lead → use it (refresh phone if submitted).
2. If multiple job matches → **409**.
3. Else match best open call lead by normalized phone.
4. Else **create** a new CallLead with `created_on_unmatched: true` and compute `form_fill`.

Then `createBookedLead` mirrors booking onto the lead and enqueues sheet sync.

### 2.6 Component contract — `BookLeadFlow`

```ts
type BookLeadPrefill = {
  leadType: "FormLead" | "CallLead";
  formLeadId?: string;
  callPhoneNumber?: string;
  callJobNo?: string;
  customerName?: string;
  customerPhone?: string;
  sourceCompany?: string;
};

type BookLeadFormState = BookLeadPrefill & {
  bookDate: string; // default Florida today
  agent: string;
  splitAgent?: string;
  binderAmount: number;
  depositAmount: number;
  merchant: string;
  jobNo?: string; // FormLead job_no
};
```

UI sections should mirror the existing form: Lead Source → Booking Details → Customer → review strip → submit.

---

## 3. Booked leads: cannot mark bad, cannot book again

### 3.1 Cannot mark bad

**Form leads only** have `bad_lead`.

Eligibility (must all be true):

```text
!duplicate && !booked && !cancelled
```

Backend enforcement (`updateFormLead`):

- If the patch includes `bad_lead` and the lead is duplicate, booked, or cancelled → **409**  
  `"Cannot mark a duplicate, booked, or cancelled form lead as bad"`

UI enforcement:

- Compact Bad control returns `null` when ineligible.
- Full control shows warning: *Bad Lead can only be changed for non-booked, non-cancelled form leads.*

**Design rule:** If `record.booked` is set, hide Mark Bad entirely (or show disabled + reason tooltip). Never offer a reason picker on booked rows.

### 3.2 Cannot book again (product rule)

**Dashboard rule (current UI):** list Book CTA is omitted when `item.booked` is truthy:

```text
item.booked ? null : <Book link>
```

Duplicate lead pages are read-only for booking.

**Design rule for Claude Design:**

- Booked → show status badge **Booked**, link to booking detail if populated, **no Book CTA**.
- Cancelled → show **Cancelled**; booking/cancel workflows follow cancellation rules (§4).
- Prefer hard-disable over silent upsert in the new dashboard UX.

**Note for integrators:** `createBookedLead` historically **upserts** if a booking already exists for the same `lead_ref` + `lead_model` (same submission_id returns duplicate-ignored). The **owner-facing product rule** for the new dashboard is still: **do not offer booking twice**. Treat “already booked” as a blocked state in the component, and surface the linked booking instead of opening a create form.

Employee booking reconciliation separately warns with `lead_already_booked` when matching candidates that already have bookings — use the same language in UI copy.

### 3.3 Component states

```ts
type LeadLifecycleState =
  | "open"        // not booked, not cancelled, not duplicate
  | "booked"
  | "cancelled"
  | "duplicate"
  | "bad";        // FormLead only: bad_lead set (and still open)

function canBook(lead): boolean {
  return leadTypePage && !lead.duplicate && !lead.booked;
}

function canMarkBad(lead): boolean {
  return lead.leadType === "FormLead" && !lead.duplicate && !lead.booked && !lead.cancelled;
}
```

---

## 4. How a lead is cancelled

Cancellation does **not** delete the lead. It creates a `CancelledLead` attached to the **booking**, then mirrors `cancelled` onto the source Form/Call lead.

### 4.1 Operator path

```text
From booking row/detail  → /cancellations/new?booked_lead={bookingId}
From booked form/call lead → /cancellations/new?lead_id={leadId}
  → CancellationForm
  → createCancellation API
  → mirrors cancelled onto booking + lead
  → sheet sync cancellation_chain
```

### 4.2 Form fields

| Field | Required | Prefill | Notes |
|-------|----------|---------|-------|
| Booking Mongo ID | one of booking/lead | `booked_lead` from bookings | Prefer when starting from a booking |
| Lead Mongo ID | one of booking/lead | `lead_id` from form/call lead | Backend requires the lead to already be booked |
| Cancellation date | optional | Florida today | Stored as Florida calendar date |
| Refund amount | required | — | ≥ 0 |
| Reason | required in UI | — | See enum below |
| Cancelled by | optional | — | Free text (e.g. Owner) |
| Notes | optional | — | |

**Cancellation reasons (UI enum):**

- `customer_cancelled`
- `price_too_high`
- `booked_with_competitor`
- `duplicate_booking`
- `bad_lead`
- `not_serviceable`
- `other`

### 4.3 Backend invariants (surface as error toasts)

| Condition | Status | Message (paraphrased) |
|-----------|--------|------------------------|
| Neither `booked_lead` nor `lead_id` | 400 | Either must be provided |
| Lead has no `booked` | 409 | Source lead is not booked |
| Booking already cancelled | 409 | Booked lead is already cancelled |
| `booked_lead` disagrees with lead’s booking | 409 | booked_lead does not match… |
| Lead model/id mismatch vs booking | 409 | Booked lead does not match the source lead |
| Classic referral / unsupported standalone | 409 | Standalone/referral cancellation not supported yet |

Successful create:

1. Writes `CancelledLead` (snapshots job, agent, book date, source, merchant, customer name).
2. Sets `booking.cancelled = cancellation._id`.
3. Sets `lead.cancelled = cancellation._id` when a linked lead exists.
4. Dismisses pending booking-lead reconciliation cases with action `booking_cancelled`.
5. Syncs sheets.

### 4.4 Component contract — `CancelLeadFlow`

```ts
type CancelLeadPrefill = {
  bookedLeadId?: string;
  leadId?: string;
};

type CancelLeadFormState = CancelLeadPrefill & {
  cancelDate: string;
  refundAmount: number;
  reason: typeof CANCELLATION_REASONS[number];
  cancelledBy?: string;
  notes?: string;
};
```

Enable Cancel CTA when the lead is **booked and not yet cancelled** (or from the booking itself). Hide for referral bookings in the current product.

---

## 5. How a lead is marked bad (with reason)

**Applies to Form Leads only.** Call leads have no `bad_lead` field.

### 5.1 Reasons (canonical enum)

| Value | Owner-facing label |
|-------|--------------------|
| `disconnected_number` | D/C number |
| `bad_phone_email_name` | Bad Phone-Email-Name |
| `auto_only` | Auto Only |
| `international_move` | International Move |

Clearing bad: send `bad_lead: null` (removes from Master Bad Leads sheet sync path).

### 5.2 Interaction pattern

1. Operator opens Bad control (table compact popover or detail panel).
2. Chooses a reason (or empty to clear if already marked).
3. Saves → `PATCH` form lead with `{ bad_lead: reason | null }`.
4. On success: invalidate lists/details; sheet sync writes/deletes Master Bad Leads row.

### 5.3 Side effects

- Sheet planner includes `master_bad_leads` when `bad_lead` is set; clears when unset.
- Bad is independent of CPL/quoting rules except: duplicates cannot be marked bad.

### 5.4 Component contract — `MarkBadLeadControl`

```ts
type BadLeadReason =
  | "disconnected_number"
  | "bad_phone_email_name"
  | "auto_only"
  | "international_move";

type MarkBadLeadProps = {
  leadId: string;
  current: BadLeadReason | null;
  eligible: boolean; // !duplicate && !booked && !cancelled
  onSave: (next: BadLeadReason | null) => Promise<void>;
};
```

Visual: destructive when marked; reason label shown on the button when compact.

---

## 6. Computing “move coming up” urgency

### 6.1 What exists today

| Entity | Move date field? | Existing computed filter |
|--------|------------------|--------------------------|
| **FormLead** | `move_date` (required Florida calendar date) | `past_move_date` — move day is before submission day |
| **CallLead** | **No** `move_date` | — |
| **BookedLead** | **No** `move_date` | — |

So “this lead’s stated move date is coming up” is naturally a **FormLead** concept today. “This booked lead’s move is coming up” must **join** the booking to its FormLead (when `lead_model === "FormLead"`) and read that lead’s `move_date`.

### 6.2 Recommended derived fields (design + API proposal)

Compute in Florida calendar days (same timezone discipline as `book_date` / `move_date` storage):

```ts
type MoveUrgency = {
  move_date: string | null;          // YYYY-MM-DD
  days_until_move: number | null;    // negative = already past
  urgency_bucket:
    | "none"          // no move_date
    | "overdue"       // days_until_move < 0
    | "today"
    | "within_3_days"
    | "within_7_days"
    | "within_14_days"
    | "later";
  context: "stated_by_lead" | "booked_via_form_lead";
};
```

**Unbooked FormLead**

```text
days_until_move = calendarDays(move_date, todayFlorida)
context = "stated_by_lead"
```

**Booked lead (booking list or booked FormLead)**

```text
if booking.lead_model === "FormLead":
  move_date = FormLead(booking.lead_ref).move_date
  context = "booked_via_form_lead"
else:
  move_date = null  // CallLead path — show "No move date" unless later product adds one
```

### 6.3 UI placement suggestions

| Surface | Copy pattern |
|---------|--------------|
| Form lead list chip | “Move in 5 days” / “Move overdue” |
| Form lead detail | “Stated move date: Jun 1 · in 5 days” |
| Booking detail (form-sourced) | “Customer move date: Jun 1 · in 5 days” |
| Call lead / call-sourced booking | Omit or “Move date not captured on call leads” |

### 6.4 Filter extensions (optional, for the new dashboard)

Beyond existing `past_move_date`:

| Filter | Meaning |
|--------|---------|
| `move_within_days=7` | `0 ≤ days_until_move ≤ 7` |
| `move_overdue=true` | `days_until_move < 0` |
| Bookings: `upcoming_move=true` | Join form leads where move is within N days |

Keep date math in the **server** (Florida calendar) so Design App components only render `urgency_bucket` + label.

---

## 7. On-demand text / email to a lead

### 7.1 What exists today

**SMS (Twilio) — Form leads**

- On **create form lead**, if `sms_consent === true` and messaging mode allows, server persists a `LeadMessage` (`purpose: quote_request_confirmation`) and dispatches (live or queued).
- Duplicates / disabled mode / rate limits → `skipped`.
- Admin can **list / detail / retry** messages:
  - `GET /api/v1/admin/lead-messages`
  - `GET /api/v1/admin/lead-messages/:id`
  - `POST /api/v1/admin/lead-messages/:id/retry` (manual retry with cap)
- Form lead detail shows SMS status (`sms_message_sent`, body, Twilio SIDs) and links to observational messaging events.

**Email**

- SendGrid is used for **owner/ops notifications** (observability), not for arbitrary customer lead email from the dashboard today.

**Call leads**

- No automatic confirmation SMS path equivalent to form `sms_consent`.

### 7.2 Design the “Contact lead” component against a future-friendly API

For Claude Design, ship a **ContactLeadPanel** that assumes a thin admin action API (to be added or wrapped) with these capabilities:

```ts
type ContactChannel = "sms" | "email";

type ContactLeadRequest = {
  lead_type: "FormLead" | "CallLead";
  lead_id: string;
  channel: ContactChannel;
  template_key?: string;     // e.g. "quote_follow_up", "move_reminder"
  body_override?: string;    // optional freeform when allowed
  to_override?: string;      // rare; default from lead.phone_number / lead.email
};

type ContactLeadResult = {
  message_id: string;
  channel: ContactChannel;
  status: "queued" | "sent" | "skipped" | "failed";
  skip_reason?: string;
};
```

### 7.3 Guardrails the UI must encode

| Guard | SMS | Email |
|-------|-----|-------|
| Destination present | Require `phone_number` | Require `email` |
| Consent / compliance | Prefer explicit SMS consent flag when present; show warning if unknown | Show “confirm recipient” step |
| Duplicate lead | Disable or warn (auto path skips duplicates) | Same |
| Rate limits / cooldown | Show skip reason from server | Same |
| Audit | Link to observational events (`category=messaging`) | Link similarly |
| Templates | Start from `buildLeadConfirmationMessage`-style templates | Use approved templates only |

### 7.4 Suggested templates for design mocks

1. **Quote confirmation** (existing): “Hi {first}, this is Vantage Movers. We received your request…”
2. **Follow-up** (proposed): short nudge to call / continue quote.
3. **Move reminder** (proposed): uses §6 `days_until_move` — “Your move date is in {n} days…”
4. **Booking confirmation** (proposed): only when `booked` is set.

### 7.5 Component contract — `ContactLeadPanel`

```ts
type ContactLeadPanelProps = {
  leadType: "FormLead" | "CallLead";
  leadId: string;
  phone?: string | null;
  email?: string | null;
  smsConsent?: boolean | null;
  lastSms?: { status: string; body: string; sent_at?: string } | null;
  moveUrgency?: MoveUrgency | null;
  onSend: (req: ContactLeadRequest) => Promise<ContactLeadResult>;
};
```

UI: channel toggle → template select → preview → Send. Disable Send when destination missing. Show last message status for form leads (reuse current SMS detail section).

Until a dedicated on-demand endpoint ships, Design can:

- Wire **Retry** to existing lead-message retry for the last failed/skipped confirmation.
- Mock Send for new templates; keep the payload shape above so backend integration is drop-in.

---

## 8. Shared status vocabulary for Design tokens

| State | Form | Call | Visual cue |
|-------|------|------|------------|
| Open | default | default | Neutral |
| Booked | `booked` set | `booked` set | Success badge; hide Book |
| Cancelled | `cancelled` set | `cancelled` set | Warning/muted; cancel already done |
| Duplicate | `duplicate` | `duplicate` | Quarantine page; no book/bad |
| Bad | `bad_lead` reason | n/a | Destructive badge + reason label |
| SMS sent | `sms_message_sent` | n/a | Boolean column |
| Move urgency | from `move_date` | rare/none | Chip from §6 |

---

## 9. Primary API map (integration cheat sheet)

| Action | Method / path (main-server) |
|--------|-----------------------------|
| List form leads | `GET /api/v1/admin/form-leads` |
| List call leads | `GET /api/v1/admin/call-leads` |
| Lead detail | `GET /api/v1/admin/{form-leads\|call-leads}/:id` |
| Global search | `GET /api/v1/admin/search?q=` |
| Update form lead (incl. bad) | `PATCH /api/v1/form-leads/:id` |
| Update call lead | `PATCH /api/v1/call-leads/:id` |
| Book from lead | `POST` booked-from-source (admin client: `createBookingFromSource`) |
| Cancel | `POST` cancelled lead create (`createCancellation`) |
| List/retry SMS | `/api/v1/admin/lead-messages` (+ `/:id/retry`) |

Always go through the admin proxy in `vantage-admin`; never read Mongo from the Design App.

---

## 10. Suggested Claude Design component inventory

Build these as named components so backend wiring stays 1:1:

1. `LeadTypeTabs` — Form vs Call
2. `LeadListFilters` — §1 inventory
3. `LeadTable` — columns + Book / Bad / Cancel affordances by state
4. `LeadDetailDrawer` — fields + lifecycle badges + SMS section (form)
5. `BookLeadFlow` — §2 prefill + three sections
6. `CancelLeadFlow` — §4
7. `MarkBadLeadControl` — §5
8. `MoveUrgencyChip` — §6
9. `ContactLeadPanel` — §7

Each component should accept **server-shaped props** (ObjectIds, enums, Florida dates) rather than inventing parallel client-only models.

---

## 11. Key source files

| Concern | Path |
|---------|------|
| Form lead model | `src/models/FormLead.ts` |
| Call lead model | `src/models/CallLead.ts` |
| Booked lead model | `src/models/BookedLead.ts` |
| Admin list filters | `src/services/admin/adminBrowse.service.ts` |
| Admin validation | `src/validation/v1/admin.validation.ts` |
| Global search | `src/services/admin/adminSearch.service.ts` |
| Analytics lead match | `src/services/analytics/analyticsFilters.ts` |
| Book from source | `src/services/bookings/bookedLeadFromSource.service.ts` |
| Booking source resolve | `src/services/bookings/bookingSourceResolver.ts` |
| Bad lead gate | `src/services/leads/formLead.service.ts` |
| Cancellation | `src/services/cancellations/cancelledLead.service.ts` |
| Cancellation resolve | `src/services/cancellations/cancellationResolver.ts` |
| SMS messaging | `src/services/leadMessaging/` |
| Bad reason enums | `src/config/domain/sheets.ts` (`FORM_LEAD_BAD_LEAD_REASONS`) |
| Admin UI filters / CTAs | `vantage-admin/components/operational/operational-resource-page.tsx` |
| Booking form | `vantage-admin/components/forms/booking-form.tsx` |
| Cancellation form | `vantage-admin/components/forms/cancellation-form.tsx` |

---

*End of brief. Prefer this document over inventing parallel field names; when Design needs a new derived field (urgency, on-demand send), keep the request/response shapes in §6–§7 so server work stays additive.*
