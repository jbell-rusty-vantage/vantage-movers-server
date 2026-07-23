# Employee Booking Submission & Lead Reconciliation — Implementation Handoff

> **Superseded for implementation:** The settled, code-grounded implementation
> plan is
> [`employee-booking-reconciliation-implementation-plan.md`](./employee-booking-reconciliation-implementation-plan.md).
> This handoff remains as design-conversation history and edge-case input.

This document captures the full design conversation for the **employee abstracted
booking flow** and the **owner reconciliation** workflow. It is the starting point
for a new agent implementing the feature end-to-end in `vantage-main-server` and
`vantage-admin`.

**Status:** Design agreed in conversation; **no implementation code exists yet**
for this flow (as of handoff). Models, services, routes, and admin UI remain to
be built.

**Related docs:**

- Platform glossary: `../../CONTEXT.md` (Lead ID vs Tracking Reference vs `lid`)
- Owner workflow showcase: `docs/showcase/owner-workflow.md`
- Existing booking behavior: `.cursor/businesslogic/bookings.service.md`
- Existing call-lead reconciliation (Granot CSV / extension): `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`
- Current operator booking form (precise, not employee-slim): `vantage-admin/components/forms/booking-form.tsx`

---

## Product goal

Vantage Movers employees must record booked deals through a **slim form** that
does **not** require:

- Mongo Lead ID (`form_lead_id`)
- Explicit lead type (`FormLead` vs `CallLead`)
- CRM internals

The **backend** performs best-effort lead matching and source resolution. When
matching is ambiguous or impossible, the **booking is still created** and synced
to the Master Booked Sheet (`Booked Deals` tab). The owner later **attaches** (or
creates + attaches) the correct source lead in a dedicated **Reconciliation**
area of the admin dashboard.

This is an **owner-mandated constraint** (employees should not need precise
identifiers). It is not the theoretically optimal data-entry flow, but it is
the required product behavior.

---

## Owner constraints (non-negotiable)

1. **Do not post to Granot CRM from the server** for this flow. WordPress posts
   to Granot directly in parallel with the Vantage webhook. Server-side
   `post_to_granot` is already off for WordPress form ingestion; employee
   booking must not call `submitFormLeadToCrm`.

2. **Naming matters.** Use the field names and terms below consistently in code,
   API payloads, UI labels, and operational events.

3. **Booking always wins.** A valid employee submission **always** creates a
   `BookedLead` and syncs to Master Booked / `Booked Deals`. Reconciliation
   only governs **lead connection**, not whether the sale row exists.

4. **Reconciliation is different from normal lead edit.** The owner can still
   edit leads in the existing operational tables. Reconciliation is specifically
   for connecting an already-booked deal to the right (or a new) source lead.

---

## Upstream system context (temporal flow)

Understanding **when** data exists in MongoDB is essential for matching logic
and for explaining `no_match` reconciliation cases.

### 1. WordPress form submission (parallel webhooks)

When a visitor submits a landing-page form, **two things happen in parallel**:

| Path | Destination | What gets stored |
|------|-------------|------------------|
| **A. Granot CRM** | Posted directly from WordPress (not via Vantage server) | Full CRM fields; `ref_no` column often contains a random ~13-digit tracking-style value with dashes; **`lid`** is the identifier employees know |
| **B. Vantage server** | `POST /api/v1/form-leads` | `FormLead` in MongoDB: `lid` (very likely), `source_company`, name, email, phone, move data, `ref_no` (tracking reference from URL `?ref_no=`), etc. |

After this step, Mongo typically has a `FormLead` with:

- `lid` (employee-facing Granot lead id)
- `source_company` / granularity snapshots
- `name`, `email`, `phone_number`
- Move fields (`pickup_zip`, `destination_zip`, `move_size`, …)
- `ref_no` = **Tracking Reference** (partner click id), **not** the same as
  Granot CRM row `ref_no` in all deployments

Server form ingestion may also send SMS, record operational events, and run
sheet sync — see `src/services/leads/formLead.service.ts`.

### 2. RingCentral call leads (cron ~15 min)

Calls arrive at RingCentral. A cron job ingests qualified calls and creates
minimal `CallLead` records: **phone number + source company** (and RingCentral
metadata).

### 3. Granot browser extension enrichment (call leads)

The Granot CRM extension finds call leads by phone number and, when matched,
**enriches** the `CallLead` with name, email, `job_no`, zips, cubic feet, etc.

At any point before employee booking, the database may contain:

- **CallLead only** — phone + source (no job yet)
- **CallLead enriched** — phone, source, name, email, `job_no`, …
- **FormLead only** — from WordPress webhook
- **Both** — same person called and submitted a form (`form_fill` linkage exists
  in duplicate/form-fill services)

### 4. Employee booking submission (this feature)

Employee fills the slim form → server **always** books → optionally auto-attaches
lead → otherwise queues reconciliation.

---

## Identity terminology (critical for matching)

| Term | Where | Meaning |
|------|-------|---------|
| **Lead ID** | Mongo `_id` | Canonical Vantage identifier. Used in sheets as "Mongo ID", extension lookup, admin search. **Employees must NOT need this** in the new form. |
| **`lid`** | `FormLead.lid` | Granot / WordPress lead id. **Employees are used to this.** Primary match key for form-channel bookings when present. |
| **Tracking Reference** | `FormLead.ref_no` | Partner click id from `?ref_no=` on landing URL. Often a long random string. Distinct from CRM row display. |
| **CRM Lead Reference** | Granot `ref_no` when Vantage CRM-posted | Mongo `_id` sent as `leadno`. **Not reliable** when WordPress posts to Granot directly and server `post_to_granot` is off. |
| **Job Number** | `CallLead.job_no`, `BookedLead.job_no` | Granot job id. Primary match key for call-channel after enrichment. |
| **Caller Match Key** | `source_company` + phone | Primary key for call leads before job number exists. |

**UI copy rule:** Label the employee field **"LID"**, not "Lead ID".

---

## Core design invariant

```
Employee submits valid payload
    │
    ├─► ALWAYS create BookedLead
    ├─► ALWAYS sync Master Booked → Booked Deals tab
    │
    └─► Lead linkage decision:
            │
            ├─ Confident single match, no hard conflict
            │     → attach lead immediately (lead_ref + lead_model)
            │     → mirrorBookingToLead
            │     → booking_chain sheet sync (Booked Deals + source lead row)
            │
            └─ No match OR ambiguous / conflict
                  → booking stays unlinked (is_leadless_booking: true)
                  → booked_lead / leadless-style sheet sync (Booked Deals only)
                  → create BookingReconciliationCase (pending)
```

**Reconciliation is NOT "should we create this booking?"**  
It is **"which lead does this existing booking belong to?"**

---

## Employee form fields

Employees enter **one** source selector with granularity (not separate lead type +
source company). Granularity determines **preferred lead channel** (`form` vs
`call`) via `resolveLeadSourceAssignment`.

| Field | Required | Notes |
|-------|----------|-------|
| Lead source granularity | Yes | e.g. `"Top 10 Inbounds"`, `"TBM Forms"`. Maps to `LeadSourceCompany` + granularity via catalog. Derives lead channel; employee does not pick `FormLead` / `CallLead`. |
| `name` | No* | Customer name; used as booking customer override when provided. |
| `phone_number` | No* | Normalized for matching. *At least one of `phone_number` or `lid` strongly recommended for form path. |
| `job_no` | Yes | Granot job number. |
| `lid` | No | Form-channel match key; employees know this from Granot. |
| `merchant` | Yes | Active merchant catalog. |
| `binder_amount` | Yes | Full binder; split across agents if two agents. |
| `deposit_amount` | Yes | Drives `over_2000` / `over_4000`. |
| `agent` | Yes | Primary agent (catalog). |
| `split_agent` | No | If omitted and only one agent → 100% to primary. If provided → existing `deriveBookedLeadAgentAllocations` 50/50 split behavior. |
| `book_date` | No | Default Florida calendar today (same as current `booking-form.tsx`). |
| `submission_id` | No | Client idempotency key → maps to `BookedLead.submission_id`. |

**Not on employee form:** `lead_type`, `form_lead_id`, `call_phone_number` as
required identity fields, `local` (derive from lead on attach when possible).

---

## Submission outcomes

| Outcome | HTTP | Booking | Lead linked | Sheet sync (initial) | Reconciliation case |
|---------|------|---------|-------------|----------------------|------------------------|
| **Auto-attached** | 200 | Created | Yes | `booking_chain` / `booked_lead.create` | None |
| **Pending lead** | 200 | Created | No (`is_leadless_booking: true`) | `booked_lead` / `leadless_booking.create` or new `employee_booking.create` op | `pending`, reason `no_match` |
| **Conflict queued** | 200 | Created | No | Same as pending | `pending`, reason = conflict type |
| **Duplicate submission** | 200 | Existing | Unchanged | None (idempotent) | None |
| **Validation error** | 400 | Not created | — | — | — |
| **job_no already booked** | 409 | Not created | — | — | — (existing `createLeadlessBooking` guard) |

Employee-facing success copy should always say **"Booking created"** when a new
or idempotent booking exists. Add **"Lead connected"** vs **"Pending lead
connection"** as secondary status.

---

## Match cascade (auto-attach only)

Run tiers in order. **Stop at the first tier that yields exactly one eligible
candidate.** If a tier yields 0, continue. If a tier yields 2+, go to
reconciliation (booking already created as leadless).

Implement as shared helpers (suggested module:
`src/services/employeeBookings/leadMatchCascade.ts`) reusing patterns from:

- `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`
  (`isLeadSourceCompatible`, `selectSourceCompatibleLead`, phone scoped queries)
- `src/services/leads/duplicateLead.service.ts` (source-scoped phone/email)
- `src/services/leads/leadPhoneMatching.ts` (`findBestCallLeadMatchByPhone` —
  **must be source-scoped** for this flow; current booking resolver is global)

### Tier 0 — Idempotency

- If `submission_id` matches existing `BookedLead.submission_id` → return
  existing booking (`duplicate_submission`).
- Consider: same `job_no` + same submission fingerprint → idempotent (optional).

### Tier 1 — `lid` (form channel)

```
FormLead.find({
  lid: normalizedLid,
  duplicate: { $ne: true },
  booked: null,
  cancelled: null,
})
```

- **1 match + source compatible** → auto-attach `FormLead`, `match_method: "lid"`.
- **0** → continue.
- **>1** → reconciliation, `reason: "multiple_lid_matches"`.
- **Duplicate form lead (`duplicate: true`)** → **never auto-attach** → reconciliation, `reason: "duplicate_form_lead"`.

Add **sparse index** on `FormLead.lid` (live model; historical model already has
this pattern in `src/models/historical/FormLead.ts`).

### Tier 2 — `job_no` on existing `BookedLead`

If `BookedLead` already exists for submitted `job_no`:

- If linked to a lead and job/customer data is consistent → idempotent path.
- If linked lead conflicts with match context → reconciliation (do not create
  second booking — **409 at create** should already prevent duplicate `job_no`).

### Tier 3 — `job_no` on `CallLead` (call channel preferred)

Reuse reconciliation's eligible call lead query:

- Unbooked, not cancelled, `created_on_unmatched: { $ne: true }`
- Source-compatible with selected granularity
- **1 candidate** → auto-attach `CallLead`, `match_method: "job_no"`.
- **Multiple** → reconciliation, `reason: "multiple_matches"`.

### Tier 4 — Phone + source scope (channel-aware)

Order: preferred channel first (`granularity.channel`), then other channel only
for **candidate listing**, not auto-attach.

- Call: scoped phone match (not global `findBestCallLeadMatchByPhone`).
- Form: adapt duplicate-detection-style query; exclude booked/cancelled/duplicate.

- **1 match** → auto-attach.
- **>1** (e.g. two call leads, same phone, same source) → reconciliation,
  `reason: "multiple_matches"`.

### Tier 5 — Cross-channel (reconciliation only)

If granularity says **call** but only **FormLead** matches (or vice versa):

- **Do not auto-attach.**
- Queue reconciliation with both candidates in search space,
  `reason: "cross_channel"`.

### Hard conflicts (never auto-attach)

| Condition | Reconciliation reason |
|-----------|------------------------|
| `lid` matches lead A, phone matches lead B | `identity_conflict` |
| Multiple candidates at same tier | `multiple_matches` |
| FormLead `duplicate: true` | `duplicate_form_lead` |
| Source assigned on lead conflicts with granularity | `source_conflict` |
| Lead already booked by different booking | `already_booked_conflict` |
| Zero candidates | `no_match` |

### Never auto-create `created_on_unmatched` CallLead

The existing `resolveBookingSourceLead` creates unmatched call leads when booking
from the operator form. **This flow must not** silently create unmatched stubs.
Unresolved identity → leadless booking + reconciliation. Owner decides create +
attach.

---

## Source compatibility

Port or share `isLeadSourceCompatible` / `selectSourceCompatibleLead` from
`bookedCallLeadReconciliation.service.ts` into a shared module (e.g.
`src/services/leads/leadSourceCompatibility.ts`) so employee booking and Granot
CSV reconciliation do not diverge.

Compatibility order:

1. Same `lead_source_company` ObjectId
2. Same `source_granularity_key`
3. Same `source_company` slug
4. Lead has `not_provided` / unassigned source → claimable with warning

---

## Reconciliation: what the owner can do

Every resolve action that mutates data must run through `runSheetSyncWrite` +
`finalizeSheetSync` like existing booking/lead services.

### 1. Attach existing lead

Pick `FormLead` or `CallLead` from precomputed `candidates[]` or admin search.

**Validations:**

- Lead exists
- Lead not `cancelled`
- Lead not already `booked` by a **different** `BookedLead`
- Duplicate FormLead → warn in UI; **allow** owner override
- Source compatibility → warn if weak match

**Server actions:**

1. Set `booking.lead_ref`, `booking.lead_model`
2. Set `booking.is_leadless_booking = false`
3. `mirrorBookingToLead` (sets `lead.booked`, thresholds, CPL, optional source correction)
4. Sheet sync: `booking_chain` / `employee_booking.lead_attached`
5. Close case: `status: "resolved"`, `resolution.action: "attach_existing"`

**Sheet effect:** Booked Deals row gets lead ref columns filled; source lead
sheet row gets booked columns.

### 2. Create lead + attach

When no candidate is suitable.

**CallLead (minimal):** `phone_number`, source assignment from submission
granularity, `job_no`, optional `name`/`email`, `timestamp`.

**FormLead (harder):** Schema requires `pickup_zip`, `destination_zip`,
`move_size`, `phone_number`, `name`, etc. **Do not** auto-create thin FormLeads
without owner supplying required fields in reconciliation UI.

**Server actions:**

1. Create lead (`createFormLead` / direct `CallLead.create` — decide in open questions)
2. Attach (same as above)
3. Sheet sync: `source_lead.create` + `booking_chain`

### 3. Edit before attach (optional UX)

| Target | Mechanism |
|--------|-----------|
| Candidate lead fields | Existing `PATCH /api/v1/form-leads/:id`, `PATCH /api/v1/call-leads/:id` |
| Submission snapshot | Patch case `submission` for audit (booking already written) |
| Booking amounts/agents | **Not supported today** for leadless bookings (`updateBookedLead` 409) — needs new patch path or attach-first |

### 4. Reassign lead (correction)

Only needed if auto-attach was wrong (keep auto tier strict to minimize this):

1. `clearBookingFromLead` on old lead
2. Attach new lead
3. `booking_chain` sync for both leads + booking

### 5. Dismiss case

- `status: "dismissed"`
- Booking remains on Booked Deals as leadless
- No additional sheet sync

---

## Sheet sync map

| Event | Resource | Operation (suggested) | Tabs |
|-------|----------|----------------------|------|
| Submit, no lead link | `booked_lead` | `employee_booking.create` or reuse `leadless_booking.create` | Master Booked → Booked Deals |
| Submit, auto-attached | `booking_chain` | `booked_lead.create` | Booked Deals + source lead |
| Owner attach lead | `booking_chain` | `employee_booking.lead_attached` | Booked Deals + source lead |
| Owner create lead + attach | `source_lead` + `booking_chain` | `form_lead.create` / `call_lead.create` + attach op | New lead row + booked rows |
| Idempotent resubmit | — | none | — |

Do not bypass `runSheetSyncWrite`, `persistSheetSyncIntent`, `finalizeSheetSync`.

---

## Proposed data model changes

### `BookedLead` (extend existing)

```ts
// Suggested new fields — names not cemented; pick one reconciliation flag strategy
{
  // Existing:
  is_leadless_booking: boolean;
  submission_id?: string;

  // New (optional):
  employee_submission_id?: string;       // alias or duplicate of submission_id?
  pending_lead_reconciliation?: boolean; // true until lead attached OR case dismissed
  reconciliation_case_id?: ObjectId;   // ref to open/last case
  employee_booking_source?: string;    // snapshot: granularity label at submit
  match_method?: string;               // when auto-attached: "lid" | "job_no" | "phone" | ...
}
```

**Open:** Whether `pending_lead_reconciliation` is redundant with
`is_leadless_booking && reconciliation case open`. Could use case status only.

### `BookingReconciliationCase` (new collection)

```ts
{
  status: "pending" | "resolved" | "dismissed";
  reason:
    | "no_match"
    | "multiple_matches"
    | "multiple_lid_matches"
    | "duplicate_form_lead"
    | "identity_conflict"
    | "source_conflict"
    | "cross_channel"
    | "already_booked_conflict";

  booking_id: ObjectId;              // ALWAYS set — booking exists before case
  submission: {
    source_granularity_label: string;
    name?: string;
    phone_number?: string;
    job_no: string;
    lid?: string;
    merchant: string;
    binder_amount: number;
    deposit_amount: number;
    agent: string;
    split_agent?: string;
    book_date: string;
    submission_id?: string;
    // snapshots from resolveLeadSourceAssignment at submit time:
    source_assignment?: { ... };
    preferred_lead_model: "FormLead" | "CallLead";
  };

  candidates: Array<{
    lead_model: "FormLead" | "CallLead";
    lead_id: string;
    match_method: string;
    score: number;
    warnings: string[];
    snapshot: {
      name?: string;
      phone_number?: string;
      lid?: string;
      job_no?: string;
      source_company?: string;
      source_granularity_label_snapshot?: string;
      booked?: boolean;
      duplicate?: boolean;
      cancelled?: boolean;
    };
  }>;

  resolution?: {
    action: "attach_existing" | "create_and_attach" | "dismiss";
    lead_id?: string;
    lead_model?: "FormLead" | "CallLead";
    resolved_by?: string;           // admin user id / email — if available
    resolved_at: Date;
    notes?: string;
  };

  createdAt, updatedAt
}
```

### `FormLead` (index only)

- Add sparse index on `lid` on live model (`src/models/FormLead.ts`).

---

## Proposed API surface

### Employee submit

```http
POST /api/v1/employee-booking-submissions
```

**Response shapes:**

```ts
type EmployeeBookingSubmissionResponse =
  | {
      outcome: "booked_and_linked";
      booking_id: string;
      lead_model: "FormLead" | "CallLead";
      lead_id: string;
      match_method: string;
    }
  | {
      outcome: "booked_pending_lead";
      booking_id: string;
      case_id: string;
      reason: string;
      candidate_count: number;
    }
  | {
      outcome: "duplicate_submission";
      booking_id: string;
    };
```

### Reconciliation (owner)

```http
GET  /api/v1/booking-reconciliation-cases?status=pending
GET  /api/v1/booking-reconciliation-cases/:id
POST /api/v1/booking-reconciliation-cases/:id/resolve
```

**Resolve body (sketch):**

```ts
type ResolveBookingReconciliationInput =
  | { action: "attach_existing"; lead_id: string; lead_model: "FormLead" | "CallLead"; notes?: string }
  | { action: "create_and_attach"; lead_model: "FormLead" | "CallLead"; lead_fields: Record<string, unknown>; notes?: string }
  | { action: "dismiss"; notes?: string };
```

Auth: same `requireApiSecret` / admin patterns as other `v1` routes.

---

## Proposed service layout

```
src/services/employeeBookings/
  index.ts
  submitEmployeeBooking.service.ts      # orchestrator: book always, then match
  attachLeadToBookedLead.service.ts     # NEW — graduate leadless → linked
  leadMatchCascade.service.ts           # tiered matching
  bookingReconciliationCase.service.ts  # CRUD + resolve
  employeeBookingSheetSync.ts           # job builders (optional)
```

**Reuse (do not duplicate business logic):**

| Existing | Use for |
|----------|---------|
| `resolveLeadSourceAssignment` | Granularity → source assignment + channel |
| `deriveBookedLeadAgentAllocations` | Agent / split / binder |
| `resolveAgentAllocations`, `resolveActiveMerchantName` | Catalog resolution |
| `createBookedLead` | Auto-attached path |
| `createLeadlessBooking` patterns | Unlinked path (may extract shared `createBookedLeadDocument`) |
| `mirrorBookingToLead`, `clearBookingFromLead` | Attach / reassign |
| `bookedCallLeadReconciliation.service.ts` | Source compatibility + phone/job matching |
| `recordOperationalEvent` | Workflow observability |

---

## Admin UI (`vantage-admin`)

### New: slim employee booking form

Replace mental model of `components/forms/booking-form.tsx` for employees:

1. **Source** — single granularity dropdown (`fetchLeadSourceCompanies` /
   `toLeadSourceCompanyOptions` with granularities).
2. **Customer** — `name`, `phone_number`, `lid`, `job_no`.
3. **Deal** — `agent`, `split_agent`, `binder_amount`, `deposit_amount`,
   `merchant`, `book_date` (default today).

Submit via `POST employee-booking-submissions` proxy.

### New: Reconciliation tab

- Queue table: pending cases, `job_no`, customer name, reason, submitted at,
  booking link.
- Detail: submission snapshot, candidate cards (search space), actions:
  attach / create+attach / dismiss.
- Distinct from operational resource browse/edit flows.

---

## Operational events (suggested)

| Event key | When |
|-----------|------|
| `booking.employee_submission.created` | Booking created (any outcome) |
| `booking.employee_submission.auto_attached` | Match + link in one step |
| `booking.employee_submission.pending_lead` | Leadless + case opened |
| `booking.reconciliation.resolved` | Owner attached or created lead |
| `booking.reconciliation.dismissed` | Owner dismissed without attach |

Category: `booking` or new `employee_booking` — **not cemented**.

---

## Known gaps in existing code (must implement)

1. **`attachLeadToBookedLead`** — does not exist. `updateBookedLead` throws 409
   for `is_leadless_booking`. Reconciliation attach needs a dedicated transactional
   path: set `lead_ref` / `lead_model`, flip `is_leadless_booking`, `mirrorBookingToLead`,
   enqueue `booking_chain`.

2. **Cancellation on leadless employee bookings** — `getBookedLeadForCancellation`
   rejects `is_leadless_booking` (`cancellationResolver.ts`). Until lead is
   attached, cancellation by `lead_id` won't work. May need cancel-by-`booked_lead`
   id for employee bookings.

3. **FormLead create from reconciliation** — `createFormLead` requires zips,
   move_size, SMS/sheet side effects. Thin create path or UI wizard required.

4. **Global vs scoped phone match** — `bookingSourceResolver` uses global
   `findBestCallLeadMatchByPhone`. Employee flow **must** scope by source
   (reconciliation rules).

5. **`FormLead.lid` index** — add on live model for match performance.

---

## Relationship to existing booking form

`vantage-admin/components/forms/booking-form.tsx` remains the **operator-precise**
form (`lead_type`, Mongo ID, call phone). The employee form is a **separate**
route/component. Both can coexist.

Existing endpoints unchanged:

- `POST /api/v1/booked-leads/from-source`
- `POST /api/v1/leadless-bookings`
- `POST /api/v1/referral-bookings`

---

## Relationship to Granot booked-call-lead reconciliation

`src/services/reconciliation/bookedCallLeadReconciliation.service.ts` is the
**CRM → Mongo** backfill path (extension / Granot CSV Booked Jobs rows). It
updates existing bookings and call leads from CRM exports.

The **employee booking reconciliation** is the inverse problem: **Mongo booking
exists first**; owner connects the source lead later. Share matching helpers;
do not merge the two workflows into one service.

---

## Suggested implementation order

1. **Validation** — `employeeBookingSubmission` Zod schema in
   `src/validation/v1/` (new file or `bookings.validation.ts`).
2. **Models** — `BookingReconciliationCase`; `BookedLead` extensions; `FormLead`
   lid index.
3. **`attachLeadToBookedLead`** + unit tests (leadless → linked + mirror).
4. **`submitEmployeeBooking`** + match cascade tests (mirror
   `bookedCallLeadReconciliation.service.test.ts` style).
5. **Reconciliation case service** + resolve endpoint + tests.
6. **Routes** in `src/routes/v1.routes.ts`.
7. **Operational events**.
8. **Admin:** employee form + reconciliation tab.
9. **Postman / proxy** entries if project uses them.

---

## Open questions (NOT cemented — decide during implementation)

### Product / UX

1. **Exact employee-facing success messages** for pending vs linked.
2. **Whether employees see reconciliation case id** or only "pending lead
   connection".
3. **Permissions:** can employees view reconciliation queue or owner-only?
4. **Auto-attach tier strictness:** confirm tier list with owner before shipping.
5. **Dismiss semantics:** does dismissed booking stay leadless forever or flag
   for analytics?

### Data model

6. **`pending_lead_reconciliation` on BookedLead** vs inferring from open case only.
7. **`employee_submission_id` vs `submission_id`** — one field or two?
8. **Case history:** one case per booking or allow reopen if dismissed then owner
   changes mind?
9. **Candidate retention:** store full snapshots vs live-query on case detail GET.

### Create + attach

10. **FormLead minimal create:** required field defaults, `post_to_granot: false`,
    skip SMS?, placeholder zips?
11. **CallLead create:** use `CallLead.create` directly vs a thin service to avoid
    sheet sync surprises.
12. **Whether create+attach runs `createFormLead`** (full pipeline) or a
    reconciliation-only minimal insert.

### Booking edits

13. **Can owner edit binder/deposit/merchant on leadless employee booking before
    attach?** Current `updateBookedLead` blocks leadless.
14. **Reassign lead** after auto-attach — support in v1 or defer?

### Cancellation

15. **Cancel leadless employee booking** — extend cancellation resolver or require
    attach first?
16. **Referral vs employee leadless** — same cancellation rules?

### Sheet sync

17. **New operation strings** (`employee_booking.create` vs reuse
    `leadless_booking.create`) — owner/reporting distinction?
18. **Whether Booked Deals row should flag "pending reconciliation"** in a column
    (sheet projection change) or only in admin.

### Idempotency

19. **`submission_id` generation** — client-generated UUID vs server hash of
    `(job_no, phone, book_date, agent)`.
20. **Double-submit same job_no different agents** — 409 vs upsert?

### Observability

21. **Incident / notification** when reconciliation queue depth exceeds threshold?
22. **Category name** for operational events.

### Testing

23. **Integration tests against sheet sync** — mock only or e2e with test sheets?
24. **Fixture strategy** for WordPress-delay scenario (form lead arrives after
    employee booking).

---

## Test scenarios (minimum)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Unique `lid` → unbooked FormLead | Auto-attach, `booking_chain` |
| 2 | Unique `job_no` → unbooked CallLead, source compatible | Auto-attach |
| 3 | Unique phone + source, call granularity | Auto-attach CallLead |
| 4 | Zero candidates | Leadless booking + case `no_match` |
| 5 | Two CallLeads, same phone + source | Leadless + `multiple_matches` |
| 6 | FormLead `duplicate: true` matches `lid` | Leadless + `duplicate_form_lead` |
| 7 | `lid` → lead A, phone → lead B | Leadless + `identity_conflict` |
| 8 | Call granularity, only FormLead matches phone | Leadless + `cross_channel` |
| 9 | Resubmit same `submission_id` | `duplicate_submission`, no new sheet job |
| 10 | Duplicate `job_no` | 409, no second booking |
| 11 | Owner attach existing | `is_leadless_booking` false, `mirrorBookingToLead`, `booking_chain` |
| 12 | Owner dismiss | Case dismissed, booking stays leadless |
| 13 | Source conflict on unique match | Leadless + `source_conflict` |

---

## Key file references

| Path | Relevance |
|------|-----------|
| `src/services/bookings/bookedLead.service.ts` | Core booking create/update |
| `src/services/bookings/leadlessBooking.service.ts` | Leadless create + sheet sync |
| `src/services/bookings/bookedLeadFromSource.service.ts` | Operator from-source bridge |
| `src/services/bookings/bookingSourceResolver.ts` | Current lead resolution (do not copy global phone match) |
| `src/services/bookings/bookingMirror.service.ts` | `mirrorBookingToLead`, `clearBookingFromLead` |
| `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` | Match + source compatibility patterns |
| `src/services/leads/formLead.service.ts` | Form lead ingest (`lid`, `post_to_granot` off) |
| `src/models/FormLead.ts` | `lid` field |
| `src/models/CallLead.ts` | `job_no`, `created_on_unmatched` |
| `src/models/BookedLead.ts` | `is_leadless_booking`, `submission_id` |
| `src/services/cancellations/cancellationResolver.ts` | Leadless cancellation gap |
| `src/services/leadSourceCompanies/` | Granularity catalog |
| `vantage-admin/components/forms/booking-form.tsx` | Current precise booking UI |
| `.cursor/businesslogic/bookings.service.md` | Booking lifecycle documentation |
| `CONTEXT.md` | Domain language |

---

## Conversation summary (one paragraph)

Vantage employees need a slim booking form (granularity, name, phone, job number,
lid, merchant, binder, deposit, agents) that hides lead type and Mongo IDs.
WordPress posts to Granot directly while the server ingests `FormLead` records
(often with `lid`); RingCentral and the Granot extension later enrich `CallLead`
rows. The server must **always** create a booking and sync Master Booked
immediately, auto-attaching a lead only on a confident unique match (`lid`,
`job_no`, or scoped phone). Ambiguous cases (duplicate form lead, multiple call
leads on same phone/source, cross-channel ambiguity, identity conflicts) still
create the booking as leadless and open a **reconciliation case** for the owner to
attach an existing lead, create+attach, or dismiss. Granot CRM posting from the
server stays off. Implementation requires new models, `attachLeadToBookedLead`,
match cascade services, API routes, operational events, and admin UI
(employee form + reconciliation tab), with several product and schema details
left open in the section above.
