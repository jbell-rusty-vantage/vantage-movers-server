# Bookings & Revenue Dashboard Design Brief

**Audience:** Claude Design App (component fidelity) + frontend engineers integrating with `vantage-main-server`.  
**Scope:** Everything about **bookings**, **cancellations**, and **revenue analytics** — list/search/filter, create/edit booking modes, cancel-with-imbuement, move-date urgency on official bookings, and derived revenue metrics.  
**Source of truth:** models, admin browse/search APIs, cancellation resolver, and analytics reports as of this document.  
**Companion brief:** [leads-dashboard-design-brief.md](./leads-dashboard-design-brief.md) (booking *from* a lead; this brief owns the booking once it exists).

---

## 0. Record kinds in this slice (explicit)

| Kind | Mongo collection | Model | What it is |
|------|------------------|-------|------------|
| **Booked Lead** | `booked_leads` | `BookedLead` | Official booking: money, agents, merchant, job, book date; optionally linked to a Form/Call lead |
| **Cancelled Lead** | `cancelled_leads` | `CancelledLead` | Cancellation of a booking: refund + reason + snapshots copied off the booking |
| **Customer** | `customers` | `Customer` | Contact identity populated on bookings; not the primary list of this tab, but linked |
| **Source lead** | `form_leads` / `call_leads` | `FormLead` / `CallLead` | Upstream of most bookings via `lead_ref` + `lead_model` |

### 0.1 Booking origin variants (UI must distinguish)

| Variant | Flags | Linked lead? | Edit? | Cancel? |
|---------|-------|--------------|-------|---------|
| **Source booking** | default | Yes (`lead_ref` + `lead_model`) | Yes (production) | Yes |
| **Referral booking** | `is_referral_booking: true` | No | **409** “Referral booking edits are not supported yet” | **409** / UI hides Cancel |
| **Leadless booking** | `is_leadless_booking: true` | No | **409** “Leadless booking edits are not supported yet” | Classic leadless: **409**; employee leadless (`booking_origin: "employee_booking"`) **is** cancellable |
| **Employee booking** | `booking_origin: "employee_booking"` | Often yes after reconciliation; may start leadless | Follow linked/edit rules | Employee leadless: yes |

```text
BookingKind =
  | "source"      // lead_ref + lead_model present
  | "referral"    // is_referral_booking
  | "leadless"    // is_leadless_booking (classic owner form)
  | "employee"    // booking_origin === "employee_booking"
```

**Design rule:** Badge the kind on every row and detail. CTAs (Edit / Cancel / Delete) follow the table above — never invent client-only lifecycle states.

### 0.2 Money vocabulary (server field names)

| Field | Meaning |
|-------|---------|
| `total_binder_amount` | Sum of agent binder allocations (virtual `binder_amount` aliases this) |
| `deposit_amount` | Deposit taken at booking |
| `agent_allocations[]` | `{ agent, agent_name_snapshot, binder_amount }` — at least one required |
| `over_2000` / `over_4000` | Derived booleans: `deposit_amount > 2000` / `> 4000` (mirrored onto the source lead) |
| `refund_amount` | On `CancelledLead` only |

Revenue charts treat **deposit** and **binder** as the two primary booked-money series; **refund** is the cancellation outflow.

---

## 1. Complete filter and search inventory

Design the Bookings & Revenue area as:

1. **Sub-tabs / routes:** `Bookings` | `Cancellations` | `Revenue` (analytics)
2. **Global search** (`q`) plus **sidebar filters** on the operational lists
3. **Date range** on the resource’s date field
4. **Analytics chrome** (shared query params) on the Revenue tab

### 1.1 Shared operational chrome

| Control | Param | Behavior |
|---------|-------|----------|
| Free-text search | `q` | Case-insensitive contains across resource `qFields`. If `q` is a valid Mongo ObjectId, also matches `_id`. |
| Date from / to | `from`, `to` | Inclusive range on `date_field` |
| Date field override | `date_field` | Must be in the resource’s allowed list |
| Sort | `sort`, `direction` | See allowed sorts below |
| Pagination | `page`, `limit` | Default `limit=50`, max `250` |
| Database scope | `database_scope` | `production` (default) \| `historical` \| `combined` |

List browsing:

`GET /api/v1/admin/{booked-leads|cancelled-leads}`

Global search:

`GET /api/v1/admin/search?q=...`

Facets for filter selects (agents, merchants, sources):

`GET /api/v1/admin/facets?database_scope=...`

### 1.2 Bookings (`booked-leads`) — complete filters

**Defaults (current admin UI):** sort `book_date` desc; date field `book_date`.

| UI label | Query param | Control type | Server behavior |
|----------|-------------|--------------|-----------------|
| Free-text search | `q` | text | Searches: `job_no`, `normalized_job_no`, `customer_name`, `customer_name_snapshot`, `source`, `merchant`, `agent_allocations.agent_name_snapshot` (+ `_id` if ObjectId) |
| Book date / Timestamp / Created | `from`, `to`, `date_field` | date range + select | Allowed `date_field`: `book_date` (default), `timestamp`, `createdAt` |
| Source | `source` **or** `source_label` **or** `source_company` | select | Exact case-insensitive match on booking `source` (slug **or** label variants resolved via `resolveSourceCompany`) |
| Agent | `agent` | select (facets) | Contains match on `agent_allocations.agent_name_snapshot` |
| Customer name | `customer_name` | text | Contains on `customer_name` **or** `customer_name_snapshot` |
| Job number | `job_no` | text | Contains on `job_no` **or** `normalized_job_no` |
| Merchant | `merchant` | select (facets) | Contains on `merchant` |
| Local type | `local` | select | `local` \| `long_distance` (API-supported; not always shown in current UI sidebar) |
| Leadless | `leadless` | Yes/No | `true` → `is_leadless_booking: true`; `false` → not leadless / missing flag |
| Cancelled | `cancelled` | Yes/No | Presence of `cancelled` ObjectId ref |
| Deposit range | `deposit_min`, `deposit_max` | number | On `deposit_amount` |
| Binder range | `binder_min`, `binder_max` | number | On `total_binder_amount` |

**Bookings `q` fields (authoritative):**

```text
job_no, normalized_job_no, customer_name, customer_name_snapshot,
source, merchant, agent_allocations.agent_name_snapshot
```

**Allowed sorts:** `createdAt`, `timestamp`, `book_date`, `job_no`, `deposit_amount`, `total_binder_amount`.

**Populate on browse/detail:** `customer`, `lead_ref`, `cancelled`, `agent_allocations.agent`.

**Current operational table columns:** Book Date, Job, Customer, Phone, Source, Binder, Deposit, Merchant, Cancelled — plus Cancel / Edit / Delete affordances by state.

#### Gaps to call out in Design (UI today vs API)

| Control shown in admin UI | Wired in `adminBrowse` for `booked-leads`? | Design guidance |
|---------------------------|-------------------------------------------|-----------------|
| Customer phone filter | **No** dedicated string filter (phone lives on populated `customer`) | Either drop from sidebar **or** propose `customer_phone` join filter as a server add |
| Referral-only toggle | **No** `is_referral_booking` filter | Propose `referral=true|false` boolean filter |
| Employee-origin toggle | **No** `booking_origin` filter | Propose `booking_origin=employee_booking` |
| Over-$2k / Over-$4k | Flags exist on document; **no** browse filter | Propose `over_2000` / `over_4000` Yes/No |
| Lead model (Form vs Call) | **No** browse filter | Propose `lead_model=FormLead\|CallLead` (analytics already supports `lead_type`) |

### 1.3 Cancellations (`cancelled-leads`) — complete filters

**Defaults (current admin UI):** sort `cancel_date` desc; date field `cancel_date`.

| UI label | Query param | Control type | Server behavior |
|----------|-------------|--------------|-----------------|
| Free-text search | `q` | text | `job_no`, `normalized_job_no`, `customer_name`, `reason`, `cancelled_by`, `source`, `merchant`, `agent` (+ `_id`) |
| Cancel / Book / Timestamp / Created | `from`, `to`, `date_field` | date range + select | Allowed: `cancel_date` (default), `timestamp`, `createdAt`, `book_date` |
| Source company / Source label | `source_company` / `source` / `source_label` | select | Same booking-source clause as bookings (exact CI on `source`) |
| Agent | `agent` | select | Contains on snapshot `agent` string |
| Customer name | `customer_name` | text | Contains on `customer_name` / `normalized_customer_name` |
| Job number | `job_no` | text | `job_no` / `normalized_job_no` |
| Merchant | `merchant` | select | Contains |
| Reason | `reason` | select | Contains on `reason` (UI enum below) |
| Cancelled by | `cancelled_by` | text | Contains (API; optional in UI) |
| Refund range | `refund_min`, `refund_max` | number | On `refund_amount` |

**Allowed sorts:** `createdAt`, `timestamp`, `cancel_date`, `book_date`, `job_no`, `refund_amount`.

**Populate:** `booked_lead`, `customer`, `lead_ref`.

**Current table columns:** Cancelled (date), Job, Customer, Source, Merchant, Refund, Reason, By.

### 1.4 Global search badges (design cues)

| Resource | Primary label | Secondary | Badges | Deep-link |
|----------|---------------|-----------|--------|-----------|
| Bookings | `job_no` or “Booking” | customer name, source, merchant | `booked`, and `cancelled` if set | `/bookings?record={id}` |
| Cancellations | `job_no` or “Cancellation” | customer, reason, source | `cancelled` | `/cancellations?record={id}` |

### 1.5 Revenue / analytics filters (complete)

Shared analytics query (`analyticsQuerySchema`) for **all** booking/revenue reports:

| UI label | Query param | Notes |
|----------|-------------|-------|
| Database scope | `database_scope` | Same enum as browse |
| Date from / to | `from`, `to` | Applied to booking `book_date` (or cancellation `cancel_date` for cancel reports) |
| Source company | `source_company` | Derived via lead lookup + booking `source` |
| Source granularity | `source_granularity_key` | Exact on derived key |
| Source label | `source` | Exact on booking/cancellation `source` |
| Agent | `agent` | Exact on allocation snapshot (bookings) or cancellation `agent` |
| Merchant | `merchant` | Exact |
| Local type | `local` | Exact on booking `local` |
| Lead type | `lead_type` | `FormLead` \| `CallLead` (also accepts `form` / `call`) |
| Trend bucket | `granularity` | `day` \| `month` (default `month`) — revenue trend |

**Reports that belong on the Revenue tab**

| Report path | What it answers |
|-------------|-----------------|
| `GET .../analytics/summary` | Totals: bookings, active, cancelled, deposit, binder, refund, rates |
| `GET .../analytics/revenue-trend` | Time series: bookings, cancelled, deposit, binder, cancellation_rate |
| `GET .../analytics/agent-performance` | Per-agent binder/deposit/cancels + over_2000/over_4000 counts |
| `GET .../analytics/booking-cancellation-ratio` | Overall + by source company |
| `GET .../analytics/cancellation-reasons` | Reason breakdown with refund + affected deposit/binder |
| `GET .../analytics/source-company-performance` | Source funnel / booked performance |
| `GET .../analytics/local-vs-long-distance` | Local classification split |
| `GET .../analytics/overview` | All-time + last-7-days rollup (production last-7) |
| `GET .../reports/agent-sales` | Production agent sales table (requires `from`/`to`; optional `agents[]`) |

CSV mirrors: `/api/v1/admin/exports/analytics/:report.csv` and agent-sales export.

### 1.6 Component contract — list filters

```ts
type BookingListFilters = {
  q?: string;
  from?: string;
  to?: string;
  date_field?: "book_date" | "timestamp" | "createdAt";
  source?: string; // also accepts source_company / source_label aliases
  agent?: string;
  customer_name?: string;
  job_no?: string;
  merchant?: string;
  local?: "local" | "long_distance";
  leadless?: boolean;
  cancelled?: boolean;
  deposit_min?: number;
  deposit_max?: number;
  binder_min?: number;
  binder_max?: number;
  // Proposed
  referral?: boolean;
  booking_origin?: "employee_booking";
  over_2000?: boolean;
  over_4000?: boolean;
  lead_model?: "FormLead" | "CallLead";
  sort?: string;
  direction?: "asc" | "desc";
  page: number;
  limit: number;
  database_scope: "production" | "historical" | "combined";
};

type CancellationListFilters = {
  q?: string;
  from?: string;
  to?: string;
  date_field?: "cancel_date" | "timestamp" | "createdAt" | "book_date";
  source?: string;
  source_company?: string;
  agent?: string;
  customer_name?: string;
  job_no?: string;
  merchant?: string;
  reason?: CancellationReason;
  cancelled_by?: string;
  refund_min?: number;
  refund_max?: number;
  sort?: string;
  direction?: "asc" | "desc";
  page: number;
  limit: number;
  database_scope: "production" | "historical" | "combined";
};

type RevenueAnalyticsFilters = {
  database_scope: "production" | "historical" | "combined";
  from?: string;
  to?: string;
  source_company?: string;
  source_granularity_key?: string;
  source?: string;
  agent?: string;
  merchant?: string;
  local?: "local" | "long_distance";
  lead_type?: "FormLead" | "CallLead";
  granularity?: "day" | "month";
};
```

---

## 2. Primary flows

### 2.1 Create booking (four modes)

```text
/bookings/new
  → mode switch: Source | Referral | Leadless
  → BookingForm
  → POST /api/v1/booked-leads/from-source
     or POST /api/v1/referral-bookings
     or POST /api/v1/leadless-bookings
  → invalidate lists / search / analytics
```

Employee bookings enter via a separate employee submission + reconciliation path (`booking_origin: "employee_booking"`). Design the main Bookings tab to **surface** those rows (badge + link to reconciliation when pending), but keep reconciliation as its own owner-only surface (`/bookings/reconciliation`).

Prefills from leads are specified in the leads brief §2. This tab owns:

| Mode | Required identity | Money / ops |
|------|-------------------|-------------|
| Source FormLead | `form_lead_id`, `job_no` | `book_date`, `agent`, `binder_amount`, `deposit_amount`, `merchant` |
| Source CallLead | `call_job_no` and/or `call_phone_number` | same |
| Referral | `job_no`, `customer_name` | same + `local` |
| Leadless | `job_no`, `source_company` | same + `local` |

Warnings on create/update: any agent with **zero binder** → `"${name} has a zero binder amount"`.

### 2.2 Edit booking

```text
Booking detail (production, non-referral, non-leadless, has lead metadata)
  → patch fields: book_date, job_no, deposit, binder/allocations, merchant, source, local
  → PATCH /api/v1/booked-leads/:id
```

Blocked states → §5.

### 2.3 Cancel booking (imbue into cancellation form) — **core UX**

Cancellation **does not delete** the booking. It creates a `CancelledLead`, sets `booking.cancelled`, mirrors onto the source lead when linked, dismisses pending reconciliation cases, and syncs sheets.

#### Operator path

```text
Booking row / detail
  → CTA "Cancel this booking" (hidden if referral OR already cancelled)
  → /cancellations/new?booked_lead={bookingId}
       optional richer query (design opportunity): see §3
  → CancellationForm
       Section 1: identity (booked_lead and/or lead_id)
       Section 2: cancel_date, refund_amount, reason, cancelled_by, notes
       Section 3: imbued booking context (read-only)
  → POST /api/v1/cancelled-leads
  → invalidate bookings, cancellations, leads, search, analytics
```

Alternate entry (from a booked lead):

```text
Form/Call lead detail → /cancellations/new?lead_id={leadId}
```

Backend accepts **either** `booked_lead` **or** `lead_id` (or both if they agree). Prefer `booked_lead` when starting from this tab.

#### What “imbue” means for Design

**Current behavior:** only Mongo IDs are deep-linked (`booked_lead` or `lead_id`). The form does **not** yet show booking money/customer context.

**Design requirement for Claude Design:** when `booked_lead` is present, load booking detail and **imprint** a read-only context strip into the cancellation form so the operator never cancels blind:

| Imbued field | Source on `BookedLead` | Display |
|--------------|------------------------|---------|
| Job number | `job_no` | Text |
| Book date | `book_date` | Florida calendar date |
| Customer | `customer.full_name` or `customer_name` | Text |
| Phone | `customer.phone_number` | Text |
| Source | `source` | Text |
| Merchant | `merchant` | Text |
| Primary agent | `agent_allocations[0].agent_name_snapshot` (virtual `agent`) | Text |
| Binder | `total_binder_amount` | Money |
| Deposit | `deposit_amount` | Money |
| Over flags | `over_2000`, `over_4000` | Badges |
| Linked lead | `lead_model` + `lead_ref` | Link to lead detail |
| Move urgency | derived (§6) | Chip when FormLead-linked |

**Writable fields remain:**

| Field | Required | Default |
|-------|----------|---------|
| `booked_lead` / `lead_id` | one of | from query |
| `cancel_date` | optional | Florida today |
| `refund_amount` | required | **Design opportunity:** soft-default to `deposit_amount` (operator can change; never hard-force) |
| `reason` | required in UI | enum below |
| `cancelled_by` | optional | e.g. “Owner” |
| `notes` | optional | |

**Cancellation reasons (UI enum — exact values):**

```text
customer_cancelled
price_too_high
booked_with_competitor
duplicate_booking
bad_lead
not_serviceable
other
```

#### Backend invariants (error toasts)

| Condition | Status | Message (paraphrased) |
|-----------|--------|------------------------|
| Neither `booked_lead` nor `lead_id` | 400 | Either must be provided |
| Booking not found | 404 | Booked lead not found |
| Already cancelled | 409 | Booked lead is already cancelled |
| Lead has no `booked` | 409 | Source lead is not booked |
| `booked_lead` ≠ lead’s booking | 409 | booked_lead does not match the source lead booking |
| Lead model/id ≠ booking linkage | 409 | Booked lead does not match the source lead |
| Classic referral / unsupported standalone | 409 | Standalone / referral cancellation not supported yet |

On success the server **snapshots** onto `CancelledLead`: `agent`, `book_date`, `job_no`, `customer_name`, `merchant`, `source`, plus operator `reason` / `notes` / `cancelled_by` / `refund_amount`.

### 2.4 Delete booking / cancellation

Destructive, production-gated in admin auth:

- Booking with cancellation requires `cascade=true` or **409**.
- Deletes tombstone sheet rows and clear booking columns on surviving leads.

Design: confirm dialog with job + customer context; never soft-hide cascade rules.

---

## 3. Smart prefills

### 3.1 Current deep-links

| From | Query | Form field |
|------|-------|------------|
| Booking row/detail | `booked_lead={id}` | Booking Mongo ID |
| Booked form/call lead | `lead_id={id}` | Lead Mongo ID |

### 3.2 Recommended richer cancellation deep-link (safe, booking-owned)

These reduce typing and power the imbued strip without changing create payload shape:

```ts
// URL for Claude Design mocks — server create still only needs IDs + refund fields
type CancelBookingDeepLink = {
  booked_lead: string;          // required when from bookings
  // Display-only query hints (optional):
  job_no?: string;
  customer_name?: string;
  deposit_amount?: string;      // suggest refund default
  merchant?: string;
  agent?: string;
  book_date?: string;
};
```

Prefer **fetching** booking detail by `booked_lead` over trusting query hints for money fields (hints can stale). Use hints only for instant skeleton UI before the detail request resolves.

### 3.3 Component contract — `CancelBookingFlow`

```ts
type CancellationReason =
  | "customer_cancelled"
  | "price_too_high"
  | "booked_with_competitor"
  | "duplicate_booking"
  | "bad_lead"
  | "not_serviceable"
  | "other";

type CancelBookingPrefill = {
  bookedLeadId?: string;
  leadId?: string;
};

type ImbuedBookingContext = {
  job_no?: string | null;
  book_date?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  source?: string | null;
  merchant?: string | null;
  agent?: string | null;
  total_binder_amount: number;
  deposit_amount: number;
  over_2000: boolean;
  over_4000: boolean;
  lead_model?: "FormLead" | "CallLead" | null;
  lead_ref?: string | null;
  moveUrgency?: MoveUrgency | null; // §6
};

type CancelBookingFormState = CancelBookingPrefill & {
  cancelDate: string; // Florida today default
  refundAmount: number;
  reason: CancellationReason;
  cancelledBy?: string;
  notes?: string;
  context?: ImbuedBookingContext; // read-only
};
```

UI sections: **Identity → Details → Imbued booking context → Review → Submit**.

---

## 4. Blocked / mutually exclusive states

| State | Edit booking | Cancel CTA | Notes |
|-------|--------------|------------|-------|
| Active source booking | Allowed | Show | Happy path |
| Already cancelled (`cancelled` set) | Allowed on booking fields (product may still edit); Cancel CTA **hide** | Backend create → 409 | Show link to cancellation detail |
| Referral | Hide edit / show disabled | Hide | 409 on edit & cancel |
| Classic leadless | Hide edit | Hide | 409 on cancel |
| Employee leadless | Hide classic edit | **Show Cancel** | Explicit exception in resolver |
| Historical scope | Read-only | Hide mutations | Browse/search only |
| Missing `lead_ref`/`lead_model` (non-referral/non-leadless) | 409 | 409 | Data integrity issue — surface as error |

**List Cancel button rule (tighten vs current admin):**

```text
canCancel =
  production
  && !is_referral_booking
  && !cancelled
  && (has lead linkage OR employee leadless)
```

---

## 5. Derived analytics that are powerful

### 5.1 Existing (wire these on the Revenue tab)

| Metric | Definition | Where |
|--------|------------|-------|
| **Active bookings** | `bookings − cancelled_bookings` | summary / overview |
| **Booking rate** | `bookings / total_leads` | summary |
| **Cancellation rate** | `cancelled_bookings / bookings` | summary, revenue-trend, agent, by-source |
| **Booked→cancelled ratio** | `bookings / cancelled` (null if no cancels) | booking-cancellation-ratio |
| **Total deposit / binder** | Sums over filtered bookings | summary, trend, agent |
| **Total refund** | Sum over cancellations | summary, cancellation-reasons |
| **Affected deposit/binder by reason** | Join cancel → booked lead money | cancellation-reasons |
| **Avg binder / avg deposit per agent** | Allocation-aware | agent-performance |
| **Over-$2k / Over-$4k booking counts** | `over_2000` / `over_4000` | agent-performance |
| **Net deposit after refunds** *(compose in UI)* | `total_deposit_amount − total_refund_amount` | overview KPI strip |

**KPI strip recommendation (one composition, not a dashboard of cards):**

```text
Active bookings · Deposit · Binder · Refunds · Cancel rate · Net deposit
```

Trend chart: deposit + binder lines, cancel rate as secondary series, `granularity=day|month`.

### 5.2 Powerful derived computations to add (label as **proposal**)

These are not first-class API fields today; Design should render them from server-computed payloads once added (do **not** invent Florida date math in the browser).

| Derived metric | Formula / idea | Why it matters |
|----------------|----------------|----------------|
| **Net revenue proxy** | `Σ deposit − Σ refund` in range | Owner “cash kept” view |
| **Binder at risk** | Sum `total_binder_amount` where `cancelled` is null **and** move urgency ∈ {overdue, today, within_3_days, within_7_days} | Ops prioritization |
| **Deposit at risk** | Same filter on `deposit_amount` | Collections / confirmations |
| **Days book→cancel** | `calendarDays(cancel_date, book_date)` on cancelled rows | How fast deals fall apart |
| **Refund ratio** | `refund_amount / deposit_amount` (per cancel + aggregate) | Generosity / policy drift |
| **High-ticket share** | `%` of bookings with `over_2000` / `over_4000` | Mix quality |
| **Source yield** | Deposit per source after cancels | Media spend decisions |
| **Agent cancel drag** | Agent cancel rate × deposit | Coaching targets |
| **Leadless / referral share** | Counts by flags | Process health |
| **Employee-origin share** | `booking_origin === "employee_booking"` | Extension vs owner desk mix |

---

## 6. Move-date proximity on the **official booking** (proposal — not in system yet)

### 6.1 Reality check

| Entity | Has `move_date`? |
|--------|------------------|
| FormLead | **Yes** (Florida calendar date) |
| CallLead | **No** |
| BookedLead | **No** — book_date is when it was *sold*, not when the customer moves |

So “how near is the move on this official booking?” is a **join**:

```text
if booking.lead_model === "FormLead" && booking.lead_ref:
  move_date = FormLead(booking.lead_ref).move_date
else:
  move_date = null  // call / referral / leadless — no stated move date
```

### 6.2 Running computation (Florida calendar days)

Compute on the **server** (same discipline as `book_date` / `move_date` storage). Expose on booking browse/detail (and optionally a filter):

```ts
type MoveUrgency = {
  move_date: string | null;       // YYYY-MM-DD Florida calendar
  days_until_move: number | null; // negative = already past relative to todayFlorida
  urgency_bucket:
    | "none"           // no joinable move_date
    | "overdue"        // days_until_move < 0
    | "today"          // 0
    | "within_3_days"  // 1..3
    | "within_7_days"  // 4..7
    | "within_14_days" // 8..14
    | "later";         // > 14
  context: "booked_via_form_lead";
};
```

```text
days_until_move = floridaCalendarDaysBetween(todayFlorida, move_date)
```

**Running** means: every list/detail response (or a lightweight enrichment endpoint) recompute against **today**, not a stale stored bucket. Sorting/filtering by urgency must use server-side `$lookup` + date math, not client clocks.

### 6.3 UI placement

| Surface | Pattern |
|---------|---------|
| Booking table chip | “Move in 5 days” / “Move today” / “Move overdue” / omit if `none` |
| Booking detail | “Customer move date: Jun 1 · in 5 days” |
| Cancellation imbued strip | Same chip — reinforces timing when refunding |
| Revenue “at risk” panel | Filter active bookings by `urgency_bucket` ∈ near set |
| Call / referral / leadless | Quiet empty state: “No move date on this booking” |

### 6.4 Proposed filters

| Filter | Meaning |
|--------|---------|
| `upcoming_move=true` | Active booking, FormLead-linked, `0 ≤ days_until_move ≤ 7` (parametrizable) |
| `move_within_days=N` | `0 ≤ days_until_move ≤ N` |
| `move_overdue=true` | `days_until_move < 0` |
| Sort `days_until_move` | Ascending = soonest moves first |

Keep Math on the server; Design only renders `urgency_bucket` + label.

---

## 7. On-demand / adjacent actions

| Action | Exists? | Notes |
|--------|---------|-------|
| Create / update / delete booking | Yes | §2 |
| Create / update / delete cancellation | Yes | §2.3 |
| Export CSV (bookings / cancellations) | Yes | `/api/v1/admin/exports/{resource}.csv` |
| Analytics CSV | Yes | exports under analytics |
| Agent sales report | Yes | production-only date range |
| Contact customer from booking | **No** dedicated booking contact API | Design opportunity: reuse lead Contact panel when `lead_ref` present; otherwise customer phone/email |
| Move reminder SMS | **Proposed** | Template keyed off §6 `days_until_move` |

---

## 8. Component inventory (Claude Design)

Build named components with **server field names**:

1. `BookingsRevenueTabs` — Bookings | Cancellations | Revenue  
2. `BookingListFilters` — §1.2 inventory  
3. `BookingTable` — columns + kind badges + Cancel/Edit  
4. `BookingDetailDrawer` — money, allocations, linked lead, move urgency, cancelled link  
5. `BookingKindBadge` — source / referral / leadless / employee  
6. `MoneyFlagsChip` — `over_2000` / `over_4000`  
7. `CancellationListFilters` — §1.3  
8. `CancellationTable`  
9. `CancelBookingFlow` — §3 imbued form  
10. `ImbuedBookingContextStrip` — read-only booking imprint on cancel  
11. `MoveUrgencyChip` — §6  
12. `RevenueKpiStrip` — active, deposit, binder, refund, cancel rate, net  
13. `RevenueTrendChart` — deposit/binder/cancel rate  
14. `AgentRevenueTable` — agent-performance / agent-sales  
15. `CancellationReasonBreakdown` — reasons report  
16. `BookingCreateFlow` — four modes (can deep-link from leads brief)

```ts
type BookingRowProps = {
  _id: string;
  book_date: string;
  job_no?: string | null;
  customer?: { full_name?: string; phone_number?: string } | null;
  customer_name?: string | null;
  source: string;
  merchant: string;
  total_binder_amount: number;
  deposit_amount: number;
  over_2000: boolean;
  over_4000: boolean;
  cancelled?: string | null;
  is_referral_booking: boolean;
  is_leadless_booking: boolean;
  booking_origin?: "employee_booking" | null;
  lead_model?: "FormLead" | "CallLead" | null;
  lead_ref?: string | null;
  moveUrgency?: MoveUrgency | null;
  agent_allocations: Array<{
    agent_name_snapshot: string;
    binder_amount: number;
  }>;
};
```

---

## 9. API cheat sheet

| Action | Method / path |
|--------|---------------|
| Browse bookings | `GET /api/v1/admin/booked-leads` |
| Booking detail | `GET /api/v1/admin/booked-leads/:id` |
| Browse cancellations | `GET /api/v1/admin/cancelled-leads` |
| Cancellation detail | `GET /api/v1/admin/cancelled-leads/:id` |
| Global search | `GET /api/v1/admin/search?q=` |
| Facets | `GET /api/v1/admin/facets` |
| Create from source | `POST /api/v1/booked-leads/from-source` |
| Create referral | `POST /api/v1/referral-bookings` |
| Create leadless | `POST /api/v1/leadless-bookings` |
| Update booking | `PATCH /api/v1/booked-leads/:id` |
| Delete booking | `DELETE /api/v1/booked-leads/:id?cascade=` |
| Create cancellation | `POST /api/v1/cancelled-leads` |
| Update cancellation | `PATCH /api/v1/cancelled-leads/:id` |
| Delete cancellation | `DELETE /api/v1/cancelled-leads/:id` |
| Analytics reports | `GET /api/v1/admin/analytics/{report}` |
| Overview | `GET /api/v1/admin/analytics/overview` |
| Agent sales | `GET /api/v1/admin/reports/agent-sales` |
| CSV exports | `GET /api/v1/admin/exports/...` |

Always go through the admin proxy in `vantage-admin`; never read Mongo from the Design App.

---

## 10. Shared status vocabulary (tokens)

| State | Signal | Visual |
|-------|--------|--------|
| Active booking | `cancelled` empty | Success / neutral “Booked” |
| Cancelled booking | `cancelled` ObjectId | Warning badge + link to cancellation |
| Referral | `is_referral_booking` | Muted “Referral” — no Cancel |
| Leadless | `is_leadless_booking` | “Leadless” |
| Employee | `booking_origin === "employee_booking"` | “Employee” |
| High deposit | `over_2000` / `over_4000` | Emphasis chips |
| Move soon / overdue | §6 bucket | Urgency chip |
| Zero-binder warning | create/update `warnings[]` | Non-blocking alert |

---

## 11. Key source files

| Concern | Path |
|---------|------|
| Booked lead model | `src/models/BookedLead.ts` |
| Cancelled lead model | `src/models/CancelledLead.ts` |
| Booking create/update/delete | `src/services/bookings/bookedLead.service.ts` |
| Book from source | `src/services/bookings/bookedLeadFromSource.service.ts` |
| Referral / leadless | `src/services/bookings/referralBooking.service.ts`, `leadlessBooking.service.ts` |
| Booking validation | `src/validation/v1/bookings.validation.ts` |
| Cancellation create/update | `src/services/cancellations/cancelledLead.service.ts` |
| Cancellation resolve gates | `src/services/cancellations/cancellationResolver.ts` |
| Cancellation validation | `src/validation/v1/cancellations.validation.ts` |
| Admin browse filters | `src/services/admin/adminBrowse.service.ts` |
| Admin query schema | `src/validation/v1/admin.validation.ts` |
| Global search | `src/services/admin/adminSearch.service.ts` |
| Facets | `src/services/admin/adminFacets.service.ts` |
| Analytics filters | `src/services/analytics/analyticsFilters.ts` |
| Summary / revenue trend | `src/services/analytics/summary.service.ts`, `revenueTrend.service.ts` |
| Cancel analytics | `src/services/analytics/cancellationAnalytics.service.ts` |
| Agent performance / sales | `src/services/analytics/agentPerformance.service.ts`, `agentSalesReport.service.ts` |
| Analytics query schema | `src/validation/v1/analytics.validation.ts` |
| Admin UI lists / Cancel CTA | `vantage-admin/components/operational/operational-resource-page.tsx` |
| Cancellation form | `vantage-admin/components/forms/cancellation-form.tsx` |
| Booking form | `vantage-admin/components/forms/booking-form.tsx` |
| Cancellation reasons enum | `vantage-admin/lib/constants/domain.ts` (`CANCELLATION_REASONS`) |
| Companion leads brief | `docs/leads-dashboard-design-brief.md` |

---

*End of brief. Prefer this document over inventing parallel field names. When Design needs move urgency or richer cancel imbuement, keep the request/response shapes in §3 and §6 so server work stays additive.*
