# Employee Booking Submission and Booking Lead Reconciliation

**Status:** Approved implementation plan  
**Approved revision:** 2026-07-23 — catalog-channel Lead type mapping,
configurable positive auto-match policy, and Form contact fallbacks  
**Scope:** `vantage-main-server` and `vantage-admin`  
**Source design:** `docs/employee-booking-reconciliation-handoff.md`  
**Companion test plan:** `docs/employee-booking-reconciliation-testing-plan.md`  
**System of Record:** MongoDB  
**Owner-facing projections:** Master Booked and Master Leads Reporting Sheets

## 1. Outcome

Vantage employees receive a public, no-login page under the `vantage-admin`
domain for recording a sale without knowing Mongo IDs, lead models, matching
rules, or Sheet Sync behavior.

Every valid, non-duplicate submission creates exactly one Booking. The backend
then either attaches a single, high-confidence source Lead and refreshes the
full Booking Chain, or leaves the Booking leadless, writes it to Master Booked
immediately, and creates a pending Booking Lead Reconciliation Case.

The owner receives an authenticated Reconciliation tab in the Bookings area.
There the owner can search current Leads with comprehensive filters, edit the
pending Booking or a candidate Lead, attach an existing Lead, create and attach
a Lead, dismiss a case, reopen it, or correct an earlier attachment. Every
mutation keeps MongoDB authoritative and uses the existing Sheet Sync outbox.

The employee path never posts to Granot CRM and never sends Lead Messages.

## 2. Requirements and invariants

### 2.1 Non-negotiable product behavior

- Employees never select `FormLead` versus `CallLead`.
- Employees never enter a Mongo Lead ID.
- Lead Source options come from active `LeadSourceCompany.granularities`.
- Primary and Secondary Agent options come from active Agents.
- Merchant options come from active Merchants.
- The full Binder is entered once. Two selected Agents receive equal Agent
  Allocations through `deriveBookedLeadAgentAllocations`.
- A valid new submission creates a Booking even when matching finds no Lead,
  multiple Leads, a source conflict, a channel conflict, or an internal
  matching error.
- Only a deterministic high-confidence result may auto-attach.
- Reconciliation decides which Lead belongs to an existing Booking. It never
  decides whether the Booking should exist.
- MongoDB is authoritative. Reporting Sheets are eventually consistent.
- No server-side Granot CRM posting occurs anywhere in this workflow.

### 2.2 Technical invariants

- Exactly one Booking exists for one employee `submission_id`.
- A normalized Job Number identifies at most one Booking across all booking
  origins after the uniqueness migration is complete.
- At most one Booking Lead Reconciliation Case exists for a Booking.
- A Lead cannot be attached to two Bookings.
- A cancelled Lead cannot be attached.
- A duplicate Lead is never auto-attached. The owner may explicitly override a
  duplicate warning, but not cancellation or already-booked conflicts.
- Booking creation, Lead attachment, Lead mirroring, case state transition, and
  durable Sheet Sync intent commit atomically when they are part of one command.
- External effects—Google Sheets, Vercel Queue publishing, CRM, SMS, and email—
  stay outside Mongo transactions.
- Public responses do not expose candidate Leads or reconciliation details.

### 2.3 Explicitly excluded

- Replacing the existing precise operator form at `/bookings/new`.
- Teaching employees the Lead Lifecycle or exposing matching choices to them.
- Merging this workflow with Granot booked-call-lead CSV reconciliation.
- Reading from or writing directly to Reporting Sheets during matching.
- Automatically fabricating an Unmatched Call Lead.
- Creating a Form Lead with placeholder ZIPs, move size, or other fake required
  fields.
- Posting a reconciliation-created Form Lead to Granot or sending it an SMS.
- Adding a “Pending Reconciliation” column to Master Booked in the first
  release. Pending state lives in MongoDB and the Admin Dashboard.

## 3. Current-state evidence

The design is anchored to these existing modules:

| Existing path | Current behavior | Required use or change |
|---|---|---|
| `src/models/BookedLead.ts` | Supports linked, referral, and leadless Bookings; has non-unique `submission_id` and `job_no` indexes | Add employee origin, normalization, and safe uniqueness indexes |
| `src/services/bookings/bookedLead.service.ts` | Creates or upserts Lead-attached Bookings, mirrors to Lead, writes `booking_chain` intent | Extract reusable booking preparation; do not call it recursively from the employee orchestrator |
| `src/services/bookings/leadlessBooking.service.ts` | Creates a standalone row but does not persist `submission_id` | Reuse its standalone projection pattern, not its whole public service |
| `src/services/bookings/bookingMirror.service.ts` | Owns `mirrorBookingToLead` and `clearBookingFromLead` | Reuse for attachment and reassignment |
| `src/services/bookings/bookingSourceResolver.ts` | Globally ranks Call Leads by Phone and creates `created_on_unmatched` stubs | Do not use for employee matching |
| `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` | Contains source-compatibility and eligible-Call-Lead patterns | Extract shared source compatibility; keep the workflows separate |
| `src/services/leads/leadPhoneMatching.ts` | Provides normalized Phone matching but is globally scoped | Reuse regex/normalization helpers; add source-aware candidate queries |
| `src/services/leads/leadSourceCompany.ts` | Resolves a label/key into canonical source assignment | Use with `requireActive: true` at submission time |
| `src/services/sheetSync/sheetSyncCoordinator.ts` | Provides transaction-aware outbox writes | Use `runSheetSyncWrite`, `persistSheetSyncIntent`, and `finalizeSheetSync` |
| `src/services/sheetSync/drainer/jobPlanner.ts` | A `booking_chain` already projects Booking plus Lead when linkage exists | No new Sheet Sync resource type is needed |
| `src/services/cancellations/cancellationResolver.ts` | Rejects leadless Bookings | Extend for unresolved employee Bookings |
| `vantage-admin/app/api/proxy/[...path]/route.ts` | Generic proxy requires an authenticated Admin | Keep protected; create fixed-purpose public route handlers |
| `vantage-admin/server/auth/routeGuard.ts` | Dashboard routes require auth; public employee route is not explicit | Explicitly declare `/employee-booking` public |
| `vantage-admin/lib/api/sourceCompanies.ts` | Has company and granularity types, but the ordinary picker returns company-level options | Add active granularity options for the employee form |
| `vantage-admin/components/forms/booking-form.tsx` | Precise operator form asks for Lead model and Mongo identity | Leave intact |

The handoff describes the RingCentral cron as roughly 15 minutes. The deployed
`vercel.json` currently schedules call-log sync every two hours
(`0 */2 * * *`). This discrepancy can explain some `no_match` cases, but it
does not trigger automatic rematching in the initial release; the owner has
explicitly chosen to resolve business no-matches through Reconciliation.

## 4. Settled product decisions

### 4.1 Public employee form fields

The visible form contains:

| Label | Request field | Required | Rule |
|---|---|---:|---|
| Lead Source | `lead_source_company_id` + `source_granularity_key` | Yes | One picker displaying the active granularity owner label, such as “Top 10 Inbounds” |
| Primary Agent | `agent` | Yes | Active Agent name, revalidated on submit |
| Secondary Agent | `split_agent` | No | Must differ from Primary Agent |
| Lead Name | `lead_name` | Yes | Stored as Booking customer override and used for matching display |
| Binder Amount | `binder_amount` | Yes | Non-negative money; split evenly when Secondary Agent exists |
| Deposit Amount | `deposit_amount` | Yes | Non-negative money; drives threshold flags |
| Merchant | `merchant` | Yes | Active Merchant name, revalidated on submit |
| Phone Number | `phone_number` | Yes | Normalized for matching and Customer upsert |
| Email | `email` | No | Normalized for matching; enables stronger Form Lead contact rules |
| LID | `lid` | No | Employee-facing Granot/WordPress identifier; never label this “Lead ID” |
| Job Number | `job_no` | Yes | Granot job identifier and Booking uniqueness key |

`book_date` is not shown in the slim first release. The server defaults it to
the current Florida calendar date. The owner may correct it from
Reconciliation. `submission_id` is a required client-generated UUID but is not
shown to the employee.

Job Number is included even though it was absent from the short initial field
list. It is required by the detailed handoff, appears in Master Booked, is the
strongest Call Lead match key, and is the existing guard against recording the
same sale twice.

### 4.2 Lead type derivation from source granularity

`LeadSourceCompany.granularities[].channel` is the authoritative mapping that
already exists:

```text
granularity.channel = "form"  -> preferred Lead model = FormLead
granularity.channel = "call"  -> preferred Lead model = CallLead
```

Examples are data, not hardcoded application rules:

```text
Top 10 Forms    -> channel "form" -> FormLead
Top 10 Inbounds -> channel "call" -> CallLead
TBM Forms       -> channel "form" -> FormLead
TBM Inbounds    -> channel "call" -> CallLead
```

The employee chooses only the granularity label. The browser submits
`lead_source_company_id` plus `source_granularity_key`; the backend loads that
exact active embedded granularity, verifies that it belongs to the company, and
derives the preferred Lead model from `channel`. The client may display the
channel for clarity but must not submit an independent `lead_model` or
`lead_type`.

Do not create a second label-to-model mapping in `vantage-admin` or the booking
module. Catalog administration is the single place where a granularity’s
channel changes.

### 4.3 Public success behavior

Every successful new or idempotent request displays **“Booking created.”**

- Auto-attached secondary text: **“Lead connected.”**
- Unresolved secondary text: **“Lead connection is pending owner review.”**
- Idempotent retry secondary text: **“This submission was already received.”**

The public response contains the Booking ID, outcome, and a short confirmation
code. It does not expose candidate IDs, conflict details, or the reconciliation
case payload.

### 4.4 Reconciliation ownership

- The public employee page can submit and view only its immediate receipt.
- Only an authenticated owner can view or mutate reconciliation cases.
- Ordinary Admin users retain existing booking and Lead permissions but do not
  receive the Reconciliation tab.
- A dismissed case leaves the Booking leadless unless the owner reopens it.
- One case document is retained per Booking. Reopen and reassignment append
  history rather than replacing audit data.

### 4.5 Automated delayed rematching

Delayed rematching is configuration-driven. The initial production
configuration retries only `matching_unavailable`.

`matching_unavailable` means the matching module or one of its candidate-read
operations failed, timed out, or was temporarily unavailable while the core
Booking write path remained usable. It does **not** mean that matching completed
successfully and returned zero candidates. A total MongoDB outage that prevents
the Booking transaction from committing returns `503` and cannot create this
case.

Initial configuration:

```text
BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED=true
BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS=matching_unavailable
BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES=5,30,120
BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE=25
```

Parse and validate these settings in
`src/config/domain/bookingReconciliation.ts`. An empty or unknown reason list is
a startup/configuration error, not permission to retry every reason.

`no_match` cases receive no automatic `next_attempt_at` under this
configuration. They remain pending for the owner, who can search, attach,
create-and-attach, or explicitly run Refresh Candidates. Adding `no_match` to
the configured reason allowlist later is a deliberate operational change, not
a code change.

If a retry finds a high-confidence, still-eligible match, it may auto-attach and
resolve the case as `auto_attach_delayed`. Conflicts are never resolved
automatically. The owner can run “Refresh candidates” at any time.

### 4.6 Candidate retention

The case stores compact snapshots of each match attempt for audit. Case detail
also reloads the current Lead state before allowing an action. Snapshots never
substitute for live validation.

### 4.7 Source correction

Auto-attachment never silently changes a conflicting source assignment.

During an owner override, the owner must choose one of:

- `preserve_lead_source`: use the Lead’s current source for the Booking; or
- `apply_submission_source`: write the submission’s source assignment to the
  Lead and Booking.

This choice is stored in resolution history.

## 5. Domain model

### 5.1 Employee Booking Submission

An Employee Booking Submission is an intake command, not a long-lived business
record. Its durable results are one Booking, zero or one attached Lead, zero or
one Booking Lead Reconciliation Case, and Operational Events plus Sheet Sync
jobs.

The exact submitted values are snapshotted on the reconciliation case when a
case is needed. The Booking retains only booking-owned values and provenance.

### 5.2 Booking Lead Reconciliation Case

A Booking Lead Reconciliation Case is the owner work item for connecting an
already-created Booking to the correct source Lead. It is not an Operational
Incident and must not live in the observability collections.

State transitions:

```text
                         attach / create+attach
                    +------------------------------+
                    |                              v
submission ----> pending ---- dismiss --------> dismissed
                    |                              |
                    | delayed high-confidence      | reopen
                    | match                        |
                    +--------------------------> resolved
                                                   |
                                                   | reassign/correct
                                                   +----> resolved
```

`resolved` and `dismissed` are terminal for automated work, but an owner command
may reopen or reassign while preserving history.

## 6. Data model

### 6.1 `BookedLead`

Add:

```ts
booking_origin?: "employee_booking";
normalized_job_no?: string;
employee_source_snapshot?: {
  lead_source_company: ObjectId;
  source_granularity_id: ObjectId;
  source_granularity_key: string;
  source_company: string;
  source_company_label_snapshot: string;
  source_granularity_label_snapshot: string;
  crm_source_label_snapshot: string;
  channel: "form" | "call";
};
auto_match?: {
  rule:
    | "form_lid_exact"
    | "call_job_no_exact"
    | "form_contact_triple_exact"
    | "form_email_phone_exact"
    | "channel_phone_exact";
  policy_version: string;
  enabled_rules_snapshot: string[];
  attached_at: Date;
};
```

Continue using:

- `submission_id` for employee idempotency;
- `is_leadless_booking` for projection behavior;
- `lead_ref` and `lead_model` for the final attachment;
- `agent_allocations`, `total_binder_amount`, `deposit_amount`, `merchant`,
  `source`, and threshold fields as the canonical booking values.

Do not add `pending_lead_reconciliation` or `reconciliation_case_id`. Pending
state is derived from the unique case for the Booking, avoiding two mutable
sources for the same fact.

Indexes:

```ts
BookedLeadSchema.index(
  { submission_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      booking_origin: "employee_booking",
      submission_id: { $type: "string" },
    },
  },
);

BookedLeadSchema.index(
  { normalized_job_no: 1 },
  {
    unique: true,
    partialFilterExpression: {
      normalized_job_no: { $type: "string" },
    },
  },
);
```

`normalized_job_no` is trimmed and normalized consistently in a shared helper.
Before creating the unique index, run a production preflight that reports all
collisions. Do not silently merge or delete collisions. Resolve them with the
owner, backfill the normalized field, and then create the unique index.

### 6.2 `FormLead`

Add:

```ts
normalized_lid?: string;
normalized_phone_number?: string;
normalized_contact_name?: string;
```

Normalize LID by trimming and applying only formatting rules confirmed by
fixtures. Do not remove meaningful internal characters merely because some
examples contain dashes. Populate normalized Phone with the existing shared
Phone normalizer and normalized contact name with the deterministic name
normalizer defined for matching. Existing `email` is already trimmed,
lowercased, and indexed; use it as normalized Email after backfill verification.

Indexes:

```ts
FormLeadSchema.index({ normalized_lid: 1 }, { sparse: true });
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_lid: 1,
});
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_phone_number: 1,
});
FormLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  email: 1,
  normalized_contact_name: 1,
});
```

Backfill all three normalized fields before relying on the compound indexes.
These indexes are not unique because historical collisions are a
reconciliation condition, not a migration failure.

### 6.3 `CallLead`

Add `normalized_job_no?: string` using the same shared Job Number normalizer as
`BookedLead`, plus:

```ts
CallLeadSchema.index({ normalized_job_no: 1 });
CallLeadSchema.index({
  lead_source_company: 1,
  source_granularity_key: 1,
  normalized_job_no: 1,
});
```

Backfill existing Call Leads before enabling employee matching. Do not make
this index unique: multiple historical Call Leads with one Job Number are a
`multiple_matches` reconciliation condition.

### 6.4 `BookingLeadReconciliationCase`

Create `src/models/BookingLeadReconciliationCase.ts` with:

```ts
type BookingLeadReconciliationCase = {
  booking: ObjectId; // unique ref BookedLead
  status: "pending" | "resolved" | "dismissed";
  reason:
    | "no_match"
    | "multiple_matches"
    | "identity_conflict"
    | "source_conflict"
    | "channel_conflict"
    | "duplicate_lead"
    | "lead_already_booked"
    | "lead_cancelled"
    | "matching_unavailable";

  submission: {
    submission_id: string;
    lead_name: string;
    phone_number: string;
    normalized_phone_number: string;
    email?: string;
    normalized_email?: string;
    lid?: string;
    normalized_lid?: string;
    job_no: string;
    normalized_job_no: string;
    binder_amount: number;
    deposit_amount: number;
    merchant: string;
    agent: string;
    split_agent?: string;
    book_date: Date;
    source_assignment: {
      lead_source_company: ObjectId;
      source_granularity_id: ObjectId;
      source_granularity_key: string;
      source_company: string;
      source_company_label_snapshot: string;
      source_granularity_label_snapshot: string;
      crm_source_label_snapshot: string;
      channel: "form" | "call";
    };
  };

  latest_candidates: Array<{
    lead_model: "FormLead" | "CallLead";
    lead_id: ObjectId;
    confidence: "high" | "medium" | "low";
    match_methods: Array<
      | "lid"
      | "job_no"
      | "phone"
      | "email"
      | "normalized_name"
    >;
    eligibility: "eligible" | "duplicate" | "booked" | "cancelled";
    source_compatibility:
      | "exact_granularity"
      | "same_company"
      | "unassigned"
      | "conflict";
    warnings: string[];
    snapshot: {
      name?: string;
      phone_number?: string;
      email?: string;
      lid?: string;
      job_no?: string;
      source_company?: string;
      source_granularity_key?: string;
      booked?: string;
      cancelled?: string;
      duplicate?: boolean;
    };
  }>;

  match_attempts: Array<{
    attempted_at: Date;
    trigger: "initial" | "delayed_retry" | "owner_refresh";
    outcome: "high_confidence" | "conflict" | "no_match" | "error";
    reason: string;
    candidate_count: number;
    candidate_snapshot_hash: string;
    auto_match_policy_version: string;
    enabled_auto_match_rules: string[];
  }>;

  retry: {
    attempt_count: number;
    next_attempt_at?: Date;
    leased_until?: Date;
    lease_owner?: string;
    last_error?: string;
  };

  resolution_history: Array<{
    action:
      | "auto_attach_delayed"
      | "attach_existing"
      | "create_and_attach"
      | "dismiss"
      | "reopen"
      | "reassign"
      | "update_submission"
      | "booking_cancelled";
    lead_model?: "FormLead" | "CallLead";
    lead_id?: ObjectId;
    source_resolution?:
      | "preserve_lead_source"
      | "apply_submission_source";
    overridden_warnings?: string[];
    actor: string;
    notes?: string;
    occurred_at: Date;
  }>;

  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
```

Indexes:

- unique `{ booking: 1 }`;
- `{ status: 1, createdAt: -1 }`;
- `{ status: 1, "retry.next_attempt_at": 1 }`;
- `{ reason: 1, status: 1, updatedAt: -1 }`;
- search-supporting fields from the submission snapshot as needed by the queue
  list.

Use Mongoose optimistic concurrency or an explicit `revision` compare in owner
commands. A stale browser tab receives `409` and reloads instead of overwriting
a newer resolution.

## 7. Deep module and seams

Create:

```text
src/services/employeeBookings/
  index.ts
  submitEmployeeBooking.service.ts
  employeeBookingPreparation.ts
  employeeBookingCommit.ts
  leadMatchEvaluator.ts
  leadCandidateQueries.ts
  bookingLeadAttachment.service.ts
  bookingLeadReconciliation.service.ts
  reconciliationRematch.service.ts
```

The route-facing interface stays small:

```ts
submitEmployeeBooking(input, context): Promise<EmployeeBookingResult>
listBookingLeadReconciliationCases(query): Promise<Page<CaseSummary>>
getBookingLeadReconciliationCase(id): Promise<CaseDetail>
searchBookingLeadCandidates(caseId, query): Promise<Page<Candidate>>
refreshBookingLeadCandidates(caseId, context): Promise<CaseDetail>
resolveBookingLeadReconciliation(caseId, command, context): Promise<CaseDetail>
updatePendingEmployeeBooking(caseId, patch, context): Promise<CaseDetail>
runDueBookingLeadRematches(context): Promise<DrainSummary>
```

Complexity remains behind this interface: catalog validation, normalization,
idempotency, Booking construction, matching, conflict classification, Lead
eligibility, source policy, transactions, mirroring, case transitions, Sheet
Sync intent, and Operational Events.

### 7.1 Shared internal helpers

Extract rather than duplicate:

- source compatibility from
  `bookedCallLeadReconciliation.service.ts` into
  `src/services/leads/leadSourceCompatibility.ts`;
- Job Number normalization into
  `src/services/bookings/bookingIdentity.ts`;
- reusable booking preparation (active Merchant, Agent Allocations, Binder
  total, warnings, threshold flags) from existing booking services;
- a policy-driven Form Lead persistence core from `formLead.service.ts` so
  reconciliation can create a real Form Lead atomically without CRM or SMS.

Granot CSV reconciliation and employee matching consume the same
source-compatibility implementation but retain separate orchestrators and
separate public interfaces.

## 8. Submission transaction

### 8.1 Validation and preparation

Before the write transaction:

1. Strictly parse the request.
2. Validate `submission_id` as UUID.
3. Normalize Phone, Email, LID, Job Number, and the comparison form of Lead
   Name.
4. Resolve the selected active source company and exact active granularity with
   `requireActive: true`.
5. Reject a company/granularity pair that does not belong together.
6. Resolve active Agents and Merchant.
7. Reject the same Agent in both positions.
8. Derive equal Agent Allocations.
9. Default `book_date` to Florida today.
10. Build Booking customer contact, source, and auto-match policy snapshots.

Catalog values are revalidated on every submit. A stale browser option that was
deactivated after page load returns `400` and creates nothing.

### 8.2 Idempotency lookup

Lookup `BookedLead` by employee `submission_id` before matching.

- Existing: return `duplicate_submission`; do not rematch and do not enqueue a
  second Sheet Sync job.
- Missing: continue.

The unique partial index is the concurrent-submit guard. If two requests race,
one insert succeeds and the other handles duplicate-key by loading and
returning the existing Booking.

Repeat the idempotency and normalized Job Number checks inside the transaction;
the preflight lookup is an optimization, not the concurrency guarantee.

### 8.3 Match evaluation

Gather all candidate evidence before choosing a result. Expected ambiguity is a
value, never an exception. If an unexpected candidate-query error occurs while
Mongo remains writable, classify it as `matching_unavailable` and continue with
a leadless Booking and case.

The authoritative evaluation runs with the transaction session so candidate
reads and the attachment write share one Mongo snapshot. Any optional
pre-transaction evaluation is advisory only. Immediately before save, use
conditional Lead/Booking checks so a stale or concurrently claimed candidate
falls back to a pending conflict case rather than overwriting linkage.

### 8.4 Atomic commit

Use:

```ts
runSheetSyncWrite(callback, { forceTransaction: true })
```

Inside the transaction, recheck idempotency and Job Number uniqueness, run the
authoritative evaluator, and conditionally claim any selected Lead.

For a high-confidence result:

1. Create Booking with `lead_ref`, `lead_model`,
   `is_leadless_booking: false`, and `booking_origin: "employee_booking"`.
2. Upsert Customer from submitted name and Phone.
3. `mirrorBookingToLead`.
4. Persist `booking_chain` intent with
   `employee_booking.create_linked`.
5. Do not create a reconciliation case.

For an unresolved result:

1. Create Booking with `is_leadless_booking: true` and
   `booking_origin: "employee_booking"`.
2. Upsert Customer from submitted name and Phone.
3. Create the unique pending case with submission and candidate snapshots.
4. Persist `booked_lead` intent with
   `employee_booking.create_pending`.

After commit, call `finalizeSheetSync` exactly once for the selected job and
record the corresponding Operational Event.

If the transaction cannot commit, no Booking exists and the request fails.
“Always creates” applies to valid domain submissions when the system of record
is available; it cannot promise success during a database outage.

## 9. Match evaluator

### 9.1 Candidate queries

Run the independent identity queries in parallel:

1. exact normalized LID against Form Leads;
2. exact normalized Job Number against Call Leads;
3. exact normalized Phone against Form Leads;
4. exact normalized Phone against Call Leads;
5. exact normalized Email against Form Leads when Email was submitted;
6. normalized exact Lead Name against Form Leads when Email was submitted.

Each query returns all plausible candidates up to a defensive cap and includes
booked, cancelled, and duplicate records so conflicts are visible. Do not
exclude conflicting candidates so early that the evaluator mistakes a
conflict for `no_match`.

Phone queries use the existing Mongo regex sieve plus an exact in-memory
normalized comparison. They are constrained by source company/granularity for
positive selection, while out-of-source matches remain conflict evidence.

Do not query Reporting Sheets or Granot.

For composite Form Lead rules, union candidates from LID, Phone, Email, and
normalized-name queries, then evaluate all required signals on each live
candidate. This permits Email/Name to disambiguate multiple Leads sharing a
Phone without allowing one query to hide contradictory evidence from another.

### 9.2 Source compatibility

Classify source relationship in this order:

1. `exact_granularity`: same `lead_source_company` and
   `source_granularity_key`;
2. `same_company`: same `lead_source_company` or canonical
   `source_company`, but missing/different granularity;
3. `unassigned`: no assigned source or `not_provided`;
4. `conflict`: a different assigned source company.

For auto-attachment:

- `exact_granularity` is strong.
- `same_company` is acceptable only for a legacy Lead missing granularity, with
  an exact primary identity and no contradictory evidence.
- `unassigned` and `conflict` require owner review.

### 9.3 Channel policy

The selected source granularity determines the preferred channel.

- Form granularity may auto-attach only a Form Lead.
- Call granularity may auto-attach only a Call Lead.
- A candidate only in the other channel produces `channel_conflict`.
- Cross-channel candidates are displayed to the owner.

### 9.4 Positive rules

Positive auto-match rules are a validated, ordered allowlist. Ship with:

```text
EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION=employee-booking-v1
EMPLOYEE_BOOKING_AUTO_MATCH_RULES=form_lid_exact,call_job_no_exact,form_contact_triple_exact,form_email_phone_exact,channel_phone_exact
```

Parse this in `src/config/domain/employeeBookingMatching.ts`. Rule names are
closed enums backed by tested implementations, not a free-form expression
language. Configuration order is evaluation priority. Unknown/duplicate rule
names are a startup error. The explicit value `none` disables all positive
auto-attachment and sends every valid Booking to Reconciliation.

The initial rule registry is:

| Rule | Preferred channel | Required evidence |
|---|---|---|
| `form_lid_exact` | Form | Exact LID + compatible source; submitted contact evidence must not identify another Lead |
| `call_job_no_exact` | Call | Exact Job Number + compatible source; submitted contact evidence must not identify another Lead |
| `form_contact_triple_exact` | Form | LID produced no candidate; exact normalized Name + Email + Phone + exact granularity identify exactly one eligible Form Lead |
| `form_email_phone_exact` | Form | LID produced no candidate; exact Email + Phone + exact granularity identify exactly one eligible Form Lead, and submitted Name does not contradict it |
| `channel_phone_exact` | Form or Call | Exact Phone + exact granularity + preferred channel identify exactly one eligible Lead |

The two composite Form rules run before `channel_phone_exact`. This lets
Name/Email disambiguate multiple Leads that share a household Phone. If LID
matches a Lead, the fallback rules cannot override it; contradictory evidence
creates `identity_conflict`.

Name matching is deterministic normalization—Unicode normalization, trim,
case-fold, collapsed whitespace, and punctuation normalization—not fuzzy
similarity. Email uses trim plus lowercase. “Name does not contradict” means
the candidate has no usable name or its normalized name equals the submitted
name.

Every enabled rule still requires exactly one eligible candidate after its
filters. An eligible candidate is unbooked, uncancelled, non-duplicate, and not
a `created_on_unmatched` Call Lead.

Configuration controls only which positive rules may attach. It cannot disable
candidate gathering, hard-conflict detection, eligibility checks,
source/channel compatibility, or the rule that one Lead cannot belong to two
Bookings.

Persist the policy version, ordered enabled-rule snapshot, and winning rule on
the Booking auto-match audit fields and Operational Event. Persist the same
policy snapshot on unresolved match attempts. This makes a later policy change
explainable without mutating historical decisions.

Changing the allowlist affects new submissions and later explicitly configured
technical rematches. It does not silently reopen or rematch existing business
cases. The owner can always use Refresh Candidates for a current view.

### 9.5 Hard-conflict precedence

Evaluate these before accepting a positive rule:

| Condition | Case reason |
|---|---|
| LID, Job Number, and Phone point to different Leads | `identity_conflict` |
| Submitted Email/Name evidence identifies a different Lead than Phone, LID, or Job Number | `identity_conflict` |
| A candidate matches Email/Phone but has a contradictory usable Name | `identity_conflict` |
| More than one eligible candidate satisfies the same strongest evidence | `multiple_matches` |
| Strong candidate has a different assigned source | `source_conflict` |
| Only the non-preferred channel matches | `channel_conflict` |
| Candidate is duplicate | `duplicate_lead` |
| Candidate is attached to another Booking | `lead_already_booked` |
| Candidate is cancelled | `lead_cancelled` |
| No candidate | `no_match` |
| Candidate lookup fails but Booking can still be persisted | `matching_unavailable` |

Hard conflicts override a unique result from any one query. This prevents the
false-positive pattern “LID matched A, so stop before noticing Phone matched B.”

Do not persist an opaque numerical confidence score. Persist named evidence,
eligibility, source compatibility, channel, and warnings.

## 10. Owner reconciliation commands

Every command requires owner authorization, checks the case `revision`, reloads
live Booking/Lead state, runs cross-document changes in a forced transaction,
persists Sheet Sync intent inside the transaction, finalizes it after commit,
emits an Operational Event, and appends `resolution_history`.

### 10.1 Refresh candidates

Re-run the evaluator, replace `latest_candidates`, append a match attempt, and
clear stale retry errors. Owner refresh never auto-attaches. It does not alter
the Booking or Sheets.

### 10.2 Attach existing Lead

Validate that the case is pending, Booking remains leadless, Lead exists in
production, Lead is not cancelled or attached elsewhere, named warning
overrides match current warnings, and source conflicts include a source choice.

Transaction:

1. set `booking.lead_ref` and `booking.lead_model`;
2. set `booking.is_leadless_booking = false`;
3. update Booking `source` and `local` according to source choice and Lead data;
4. `mirrorBookingToLead`;
5. resolve the case and append history;
6. persist `booking_chain` intent with
   `booking_reconciliation.attach_existing`.

### 10.3 Create and attach Call Lead

Owner supplies at least Phone or Job Number. Default missing values from the
case snapshot and use its immutable source assignment. The new Call Lead is not
`created_on_unmatched`, has normal source/CPL/identity fields, and is created and
attached in the same transaction. Persist one `booking_chain` job.

### 10.4 Create and attach Form Lead

Require real owner input for name, Phone, pickup ZIP, destination ZIP, move
size, and move date; email and LID are optional.

Use the extracted Form Lead persistence core with:

```ts
{
  origin: "booking_reconciliation",
  post_to_granot: false,
  send_lead_message: false,
}
```

Run normal name, Phone, location, move type, duplicate, form-fill, source, and
CPL logic. Create and attach in one transaction. Do not invent move data.

### 10.5 Edit pending submission and Booking

The owner can change Name, Phone, Email, LID, Job Number, source granularity,
book date, Agents, Binder, Deposit, and Merchant.

The command revalidates catalogs/uniqueness, updates Booking-owned fields and
the case snapshot, re-evaluates candidates without auto-attachment, and
persists `booked_lead` operation `employee_booking.update_pending`.

This is a dedicated path. Do not weaken `updateBookedLead` for arbitrary
referral/leadless Bookings. Candidate Lead edits continue through existing Lead
PATCH services, followed by Refresh Candidates.

### 10.6 Dismiss and reopen

- Dismiss changes case state only. Booking stays leadless. No Sheet Sync.
- Reopen returns the case to pending, runs a fresh candidate evaluation, and
  appends history. It does not attach automatically.

### 10.7 Reassign an attached Lead

Owner correction is included because a wrong automatic attachment otherwise
has no safe repair path.

In one transaction:

1. validate the replacement Lead;
2. `clearBookingFromLead` on the old Lead with inline sync disabled;
3. attach and mirror to the replacement Lead;
4. append `reassign` history;
5. persist a `source_lead` refresh for the old Lead;
6. persist `booking_chain` for the Booking and new Lead.

Finalize both jobs after commit.

## 11. Delayed rematch worker

Add a cron route, rematch service, and Vercel cron entry every five minutes.

The drain acquires a global lease, claims due pending cases with per-case
leases, processes a configured bounded batch, reloads state, and skips:

- terminal, attached, or cancelled cases;
- any case whose reason is not in
  `BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS`; and
- any case with no due `next_attempt_at`.

For an eligible technical-failure case, it runs the evaluator, auto-attaches
only a high-confidence result, otherwise updates candidates and the next due
time, and releases leases on all failure paths. If the rematch now completes
normally with `no_match` or a conflict, retain the case for the owner and stop
automatic retries unless that resulting reason is independently allowlisted.

Reuse Sheet Sync drainer lease/recovery patterns. The endpoint requires
`CRON_SECRET`. Retry delays and batch size come only from the validated config.
Once configured attempts are exhausted, the case remains pending for owner
action.

## 12. HTTP interface

All main-server routes remain behind `requireApiSecret`.

### 12.1 Employee submission

```http
POST /api/v1/employee-booking-submissions
```

```ts
{
  submission_id: string; // UUID
  lead_source_company_id: string; // ObjectId
  source_granularity_key: string;
  agent: string;
  split_agent?: string;
  lead_name: string;
  binder_amount: number;
  deposit_amount: number;
  merchant: string;
  phone_number: string;
  email?: string;
  lid?: string;
  job_no: string;
}
```

Response:

```ts
{
  outcome:
    | "booked_and_linked"
    | "booked_pending_lead"
    | "duplicate_submission";
  booking_id: string;
  confirmation_code: string;
  lead_connection: "connected" | "pending";
}
```

Status codes:

- `201` new Booking;
- `200` idempotent duplicate;
- `400` invalid/inactive/mismatched fields;
- `409` different Booking already owns normalized Job Number;
- `429` public throttle;
- `503` Mongo cannot commit.

### 12.2 Reconciliation

```http
GET   /api/v1/admin/booking-lead-reconciliations
GET   /api/v1/admin/booking-lead-reconciliations/:id
POST  /api/v1/admin/booking-lead-reconciliations/:id/candidates/search
POST  /api/v1/admin/booking-lead-reconciliations/:id/candidates/refresh
PATCH /api/v1/admin/booking-lead-reconciliations/:id/booking
POST  /api/v1/admin/booking-lead-reconciliations/:id/resolve
POST  /api/v1/admin/booking-lead-reconciliations/:id/reopen
```

Case-list filters include status, reason, free text over Job Number/name/Phone/
LID/source/Booking ID, source company/granularity, dates, sort, cursor, and
limit.

Candidate search supports:

```ts
{
  q?: string;
  lead_model?: "FormLead" | "CallLead";
  mongo_id?: string;
  lid?: string;
  job_no?: string;
  phone_number?: string;
  name?: string;
  email?: string;
  lead_source_company?: string;
  source_granularity_key?: string;
  duplicate?: boolean;
  booked?: boolean;
  cancelled?: boolean;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}
```

Candidate search is production-only because historical records are read-only.
Extract common filter builders from Admin browse instead of maintaining two
incompatible search grammars.

Resolve is a strict discriminated union:

```ts
type ResolveCommand =
  | {
      action: "attach_existing";
      revision: number;
      lead_model: "FormLead" | "CallLead";
      lead_id: string;
      source_resolution?:
        | "preserve_lead_source"
        | "apply_submission_source";
      overridden_warnings?: string[];
      notes?: string;
    }
  | {
      action: "create_and_attach";
      revision: number;
      lead_model: "FormLead" | "CallLead";
      lead_fields: Record<string, unknown>;
      notes?: string;
    }
  | {
      action: "dismiss";
      revision: number;
      notes?: string;
    }
  | {
      action: "reassign";
      revision: number;
      lead_model: "FormLead" | "CallLead";
      lead_id: string;
      source_resolution?:
        | "preserve_lead_source"
        | "apply_submission_source";
      overridden_warnings?: string[];
      notes?: string;
    };
```

Add strict Zod modules under `src/validation/v1/` and export through the
compatibility barrel.

## 13. Public `vantage-admin` architecture

### 13.1 Routes

```text
app/(public)/employee-booking/page.tsx
app/api/employee-booking/options/route.ts
app/api/employee-booking/submit/route.ts
components/employee-booking/employee-booking-form.tsx
lib/api/employeeBooking.ts
```

The page is explicitly public in `routeGuard.ts` and has no Dashboard shell. It
is mobile-first, single-column, and uses no Lead Lifecycle terminology.

### 13.2 Fixed-purpose backend-for-frontend

Do not make `/api/proxy/[...path]` public.

The two fixed-purpose handlers:

- call only allowlisted main-server endpoints;
- attach `VANTAGE_API_SECRET` server-side through `requestVantageApi`;
- never accept a caller-supplied backend path;
- strip options to active source granularities, Agents, and Merchants;
- forward a hashed/signed client-network identifier for throttling without
  storing raw IP;
- return sanitized errors.

The options handler loads active source companies/granularities, Agents, and
Merchants in parallel. The submit handler forwards only the parsed employee
schema.

### 13.3 Public abuse controls

Implement:

- strict same-origin checks;
- a SameSite submission nonce rotated after successful POST;
- a hidden honeypot;
- configurable persistent per-IP-hash and global rolling limits;
- request body size limit;
- no raw PII or raw IP in access/audit logs;
- `429` with a simple retry message;
- feature flag `EMPLOYEE_BOOKING_PUBLIC_ENABLED`.

Idempotency is not a rate limiter; both are required.

Persist rate limits in an infrastructure collection such as
`public_submission_throttle_buckets`:

```ts
{
  key_hash: string;       // HMAC of IP-derived key or "global"
  window_start: Date;
  count: number;
  expires_at: Date;       // TTL cleanup
}
```

Use a unique `{ key_hash, window_start }` index, an atomic `$inc` upsert, and a
TTL index on `expires_at`. Only the fixed Admin backend-for-frontend may forward
the client-network hash; the main server trusts it only on a request carrying
the primary API secret.

## 14. Owner Admin Dashboard

### 14.1 Navigation and route

Add owner-only Bookings sub-navigation:

- All Bookings;
- Reconciliation;
- Precise Booking Form.

Routes remain `/bookings`, `/bookings/reconciliation`, and `/bookings/new`.
Settings may display a copyable public employee link.

### 14.2 Queue view

Show pending count, oldest age, Job Number, Lead Name/masked Phone, source
granularity, reason, candidate count, submission time, retry state, and Booking
link. Default is pending, oldest first. Resolved/dismissed remain searchable.

### 14.3 Detail workspace

Show Booking/submission, matcher evidence, candidate cards, comprehensive Lead
search, Booking edit panel, actions, match/resolution history, and Sheet Sync
links.

Warnings are explicit confirmation checkboxes. The UI sends only warnings from
the latest server response. After mutation, invalidate reconciliation,
Booking, Lead, search, analytics, audit, and Sheet Sync query keys.

Attachment and edit commands always schedule the correct projection
automatically. When a related Sheet Sync job is failed/retrying, the detail
workspace links to its Observational record and offers the existing owner-only
retry command; it never writes a Sheet directly.

### 14.4 Owner identity

Extend the authenticated Admin proxy to forward owner ID/email in trusted
internal headers alongside `VANTAGE_API_SECRET`. Main-server reconciliation
routes derive `actor` there. The browser may not supply `resolved_by`.

Admin audit remains the application access audit; case resolution history is
the domain audit.

## 15. Sheet Sync behavior

| Event | Resource | Operation | Projected rows |
|---|---|---|---|
| New unresolved employee Booking | `booked_lead` | `employee_booking.create_pending` | Booked Deals |
| New auto-attached Booking | `booking_chain` | `employee_booking.create_linked` | Booked Deals + Lead |
| Edit unresolved Booking | `booked_lead` | `employee_booking.update_pending` | Booked Deals |
| Attach existing Lead | `booking_chain` | `booking_reconciliation.attach_existing` | Booked Deals + Lead |
| Delayed auto-attach | `booking_chain` | `booking_reconciliation.auto_attach_delayed` | Booked Deals + Lead |
| Create and attach Lead | `booking_chain` | `booking_reconciliation.create_and_attach` | Booked Deals + new Lead |
| Reassign Lead | `source_lead` + `booking_chain` | `booking_reconciliation.detach_old` + `booking_reconciliation.reassign` | old Lead + Booked Deals + new Lead |
| Dismiss/reopen/refresh | none | none | none |
| Idempotent resubmit | none | none | none |

The job planner already treats `booking_chain` as Booking plus Lead and
`booked_lead` as Booking only. New operation names add observability without a
new outbox resource.

For a linked Form Lead, the source portion refreshes Master Leads `Forms` (or
`Duplicates` when applicable). For a linked Call Lead, it refreshes Master
Leads `Calls`. Source-company sheet writes continue to follow
`WRITE_SOURCE_LEAD_SHEETS`; no reconciliation command bypasses that policy.

## 16. Cancellation parity

An unresolved employee Booking is a real sale and must be cancellable before a
Lead is attached.

Only for `booking_origin: "employee_booking"`:

- allow cancellation by `booked_lead` ID;
- create `CancelledLead` without `lead_ref`/`lead_model`;
- mark Booking cancelled;
- dismiss any pending reconciliation case with `booking_cancelled` history;
- persist `cancellation_chain`.

`planCancellationChain` already plans a Booking with no Lead and a Cancelled
Deals row. Update legacy helpers and delete-cancellation logic to guard missing
Lead metadata. Do not extend this behavior to referrals or arbitrary legacy
leadless Bookings in this feature.

## 17. Operational events

| Event key | Level | When |
|---|---|---|
| `booking.employee_submission.created_linked` | info | New Booking auto-attached |
| `booking.employee_submission.created_pending` | warn | New leadless Booking and case |
| `booking.employee_submission.duplicate_ignored` | info | Idempotent retry |
| `booking.employee_submission.rate_limited` | warn | Public throttle rejects |
| `booking.employee_submission.matching_unavailable` | error | Matcher failed but Booking/case committed |
| `booking.lead_reconciliation.candidates_refreshed` | info | Owner refresh |
| `booking.lead_reconciliation.resolved` | info | Attach/create/delayed attach |
| `booking.lead_reconciliation.dismissed` | info | Owner dismiss |
| `booking.lead_reconciliation.reopened` | info | Owner reopen |
| `booking.lead_reconciliation.reassigned` | warn | Attachment corrected |
| `booking.lead_reconciliation.retry_failed` | error | Delayed retry fails |

Use category `booking` and workflows `employee_booking_submission` and
`booking_lead_reconciliation`. Include IDs, Job Number, source, outcome, reason,
attempt, and actor; never entire request bodies or candidate snapshots.

Pending cases are business work, not Operational Incidents. Add an alert only
after the owner defines an age/volume threshold.

## 18. Failure and concurrency behavior

| Failure | Required result |
|---|---|
| Validation/catalog failure | `400`, no Booking |
| Public throttle | `429`, no Booking |
| Same `submission_id` retry | Existing Booking, no new case/job |
| Concurrent same `submission_id` | One winner; loser returns winner |
| Existing different Booking with same normalized Job Number | `409`, no second Booking |
| Match ambiguity/conflict | Booking + pending case + Booked Deals job |
| Unexpected matcher error with writable Mongo | Booking + `matching_unavailable` case |
| Mongo transaction failure | No partial state; `503` |
| Queue publish failure after commit | Domain write/outbox remain; cron drains |
| Sheet write failure | Existing retry behavior |
| Attach race | One revision/Lead claim succeeds; stale command gets `409` |
| Lead deleted between search and attach | Error; case remains pending |
| Case cancelled while rematch leased | Rematcher rechecks and skips |
| Create-and-attach validation failure | No Lead or attachment committed |

Use conditional writes and unique indexes as final guards. “Find then insert”
checks alone are insufficient.

## 19. Implementation sequence

### Phase 0 — production data preflight

1. Report duplicate normalized Job Numbers in `booked_leads`.
2. Report duplicate employee-style submission IDs.
3. Report LID formats/collisions to confirm normalization.
4. Profile Form Lead Email/Phone/Name formats and composite-contact collisions
   by source granularity.
5. Confirm every active source granularity has a valid `form` or `call`
   channel and review the resulting Lead-model mapping.
6. Confirm Mongo supports transactions.
7. Confirm active source granularities, Agents, and Merchants.
8. Resolve Job Number collisions with the owner before unique index creation.

Deliver a read-only migration report and approved collision list.

### Phase 1 — schema and shared primitives

1. Add normalization helpers/tests.
2. Add `BookedLead` fields/index declarations.
3. Add Form Lead normalized LID, Phone, and contact-name fields and indexes.
4. Add `CallLead.normalized_job_no` and indexes.
5. Add `BookingLeadReconciliationCase`.
6. Add dry-run/apply backfill and index scripts. The reconciliation migration is
   dry-run by default; test applies use `--apply`, while a production apply
   requires `--apply --production-apply --confirm-production-db=vantagemovers`
   and verifies Mongo's connected database name before any write.
7. Extract shared source compatibility.
8. Extract reusable booking preparation.
9. Add validated employee auto-match policy configuration and rule registry.
10. Add the new domain terms to the platform glossary.

Gate: backfills verified and unique Job Number index exists in test.

### Phase 2 — matcher and submission

1. Implement candidate queries and evaluator.
2. Implement Email/Name normalization and composite Form Lead rules.
3. Implement atomic employee submission.
4. Add validation/route.
5. Add idempotency/race handling.
6. Add Sheet Sync operations/events.

Gate: matcher matrix and submission integration tests pass.

### Phase 3 — reconciliation commands

1. Implement list/detail/search/refresh.
2. Implement attach existing.
3. Refactor policy-driven Form Lead persistence.
4. Implement Call/Form create-and-attach.
5. Implement pending Booking edit.
6. Implement dismiss/reopen/reassign.
7. Implement trusted owner actor propagation.

Gate: rollback tests prove no partial Lead/Booking/case state.

### Phase 4 — delayed rematching and cancellation

1. Add lease-backed drain and cron.
2. Add and validate the delayed-rematch enabled flag, reason allowlist, delay
   schedule, and batch-size configuration; seed the initial reason allowlist
   with only `matching_unavailable`.
3. Extend employee leadless cancellation.
4. Verify cancellation and delayed-attachment projections.

Gate: rematch and cancellation replay idempotently, and a `no_match` case is
never claimed under the initial configuration.

### Phase 5 — Admin Dashboard

1. Add typed client/query keys and owner-only Bookings tabs.
2. Build queue/detail/search/edit/actions/history.
3. Reuse existing Lead edit controls.
4. Add explicit warning/source confirmations.
5. Add authorization/audit tests.

Gate: ordinary Admin is forbidden; owner completes every command.

### Phase 6 — public employee page

1. Add explicit public route and fixed handlers.
2. Add active options and slim form.
3. Add nonce/origin/honeypot/throttling/feature flag.
4. Add success/idempotency/pending states.

Gate: no secret or generic proxy capability reaches the browser.

### Phase 7 — rollout

1. Deploy backend/owner UI with public flag off.
2. Use test database and test Reporting Sheets.
3. Seed every reconciliation reason.
4. Owner tests attach/create/edit/dismiss/reopen/reassign/cancel.
5. Enable delayed worker.
6. Enable a small employee canary.
7. Monitor one week.
8. Publish after owner sign-off.

Rollback disables public submit and delayed rematching. Do not delete records
created during rollout.

## 20. Test plan

The executable local setup, fixture strategy, API scenario catalog, Sheet
evidence, and acceptance record are defined in
`docs/employee-booking-reconciliation-testing-plan.md`. That companion is part
of this plan's definition of done. Local acceptance keeps `TEST_MODE=true`, runs
the main server through `vercel dev`, and exercises the same fixed-purpose
`vantage-admin` API routes used by the public employee form.

### 20.1 Matcher matrix

Cover:

1. unique Form Lead by LID/exact granularity;
2. unique Call Lead by Job Number/exact granularity;
3. no LID match, unique exact Name+Email+Phone Form Lead;
4. no LID match, Email+Phone disambiguates multiple same-Phone Form Leads;
5. Email+Phone candidate with contradictory Name becomes a conflict;
6. Email/Name points to A while Phone points to B;
7. unique preferred-channel Phone/exact granularity;
8. no candidates;
9. multiple same-strength candidates;
10. duplicate Form and Call Leads;
11. LID→A/Phone→B and Job→A/Phone→B;
12. cross-channel only;
13. source conflict;
14. legacy same-company/missing-granularity source;
15. unassigned source;
16. already-booked/cancelled candidates;
17. `created_on_unmatched` Call Lead;
18. formatted Phone, Email, Name, and LID normalization fixtures;
19. active/inactive source aliases and granularities;
20. each granularity channel derives exactly one preferred Lead model;
21. reordered/disabled auto-match rule allowlists behave deterministically;
22. `none` sends otherwise-high-confidence matches to Reconciliation;
23. unknown or duplicate configured rule names fail configuration validation;
24. policy snapshots retain the rule/version used for historical decisions.

### 20.2 Service integration

Prove:

- linked and pending submissions commit the correct documents/outbox job;
- matcher error still commits Booking/case;
- sequential and concurrent idempotency;
- normalized Job Number conflict;
- equal two-Agent allocation;
- catalog revalidation;
- atomic attach/create/edit/reassign;
- Form create has no CRM/SMS;
- source choice is honored/audited;
- dismiss/reopen history;
- configured `matching_unavailable` rematches and attaches at most once;
- `no_match` receives no due time and is never claimed by the initial worker;
- changing the reason allowlist changes eligibility without a code change;
- a technical rematch that completes as `no_match` stops retrying and remains
  pending for the owner;
- unresolved employee cancellation;
- stale revision `409`;
- transaction rollback leaves no partial state.

Use a replica-set-capable Mongo test environment. Mocks cannot prove the
cross-document invariant.

### 20.3 Sheet Sync

Prove pending Booking writes only Master Booked; attachment/create writes
Booking plus correct Lead; reassignment refreshes old/new Leads; standalone
employee cancellation writes Booked and Cancelled rows; idempotency creates no
job; queued/legacy/disabled modes retain documented behavior.

### 20.4 Route/security

Test strict schemas, protected main-server routes, fixed public paths, active
options only, origin/nonce/honeypot/size/throttle controls, sanitized public
responses, owner-only access, trusted actor propagation, and no browser secret.

### 20.5 UI acceptance

- mobile use without horizontal scrolling;
- no Mongo ID/Lead model;
- distinct Agents;
- double click produces one Booking;
- success always leads with “Booking created”;
- owner search by Mongo ID, LID, Job Number, Phone, name, email, source, status,
  and date;
- explicit warning confirmation;
- stale cases reload;
- commands update visible Booking/Lead/Sheet Sync state.

### 20.6 Verification commands

```powershell
pnpm --dir vantage-main-server typecheck
pnpm --dir vantage-main-server test
pnpm --dir vantage-admin typecheck
pnpm --dir vantage-admin test
pnpm --dir vantage-admin build
```

Also run migrations in production dry-run and test-database apply modes, and
render the employee page at phone and desktop breakpoints.

## 21. File-level worklist

### `vantage-main-server`

Create:

- `src/models/BookingLeadReconciliationCase.ts`
- `src/models/PublicSubmissionThrottleBucket.ts`
- `src/config/domain/bookingReconciliation.ts`
- `src/config/domain/employeeBookingMatching.ts`
- `src/services/employeeBookings/*`
- `src/validation/v1/employeeBookings.validation.ts`
- `src/routes/booking-reconciliation-cron.routes.ts`
- matcher/transaction/route/rematch/cancellation/projection tests
- dry-run/apply migration scripts

Modify:

- `src/models/BookedLead.ts`
- `src/models/FormLead.ts`
- `src/models/CallLead.ts`
- `src/services/bookings/bookedLead.service.ts`
- `src/services/bookings/leadlessBooking.service.ts`
- `src/services/bookings/bookingMirror.service.ts`
- `src/services/leads/formLead.service.ts`
- `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`
- `src/services/cancellations/cancellationResolver.ts`
- `src/services/cancellations/cancelledLead.service.ts`
- `src/routes/v1.routes.ts`
- `src/validation/v1.validation.ts`
- `vercel.json`
- root `CONTEXT.md`

### `vantage-admin`

Create:

- `app/(public)/employee-booking/page.tsx`
- `app/api/employee-booking/options/route.ts`
- `app/api/employee-booking/submit/route.ts`
- `app/(dashboard)/bookings/reconciliation/page.tsx`
- reconciliation detail route/components
- `components/employee-booking/*`
- `components/reconciliation/*`
- `lib/api/employeeBooking.ts`
- `lib/api/bookingLeadReconciliation.ts`

Modify:

- `server/auth/routeGuard.ts`
- `server/auth/authorization.ts`
- `app/api/proxy/[...path]/route.ts`
- `components/layout/dashboard-nav.tsx`
- Bookings page/sub-navigation
- `lib/api/sourceCompanies.ts`
- `lib/query/keys.ts`
- related tests

Leave `components/forms/booking-form.tsx` and its precise operator workflow
available.

## 22. Definition of done

Completion requires evidence that:

- the public employee URL works without login and exposes no backend secret;
- visible options use active catalogs and server revalidation;
- the selected granularity’s catalog `channel` is the sole source of preferred
  Lead model derivation;
- a valid submission creates exactly one Booking and Master Booked intent;
- two Agents receive equal Binder allocations;
- only enabled, documented high-confidence rules auto-attach;
- auto-match rule order/allowlist is validated, configurable, and snapshotted
  with each decision;
- the LID fallback can use the configured exact Name+Email+Phone and
  Email+Phone Form Lead rules without bypassing hard conflicts;
- every no-match/conflict creates a searchable pending case;
- delayed rematching is validated, allowlisted, and initially limited to
  `matching_unavailable`;
- `no_match` remains owner-managed unless explicitly enabled by configuration;
- owner search covers both Lead models and all named filters;
- owner can edit, attach, create-and-attach, dismiss, reopen, reassign, and
  cancel an unresolved employee Booking;
- cross-document mutations are transactionally safe;
- every mutation uses the Sheet Sync coordinator;
- no employee/reconciliation path posts to Granot or sends SMS;
- idempotency/Job Number uniqueness withstand concurrency;
- actor and resolution history are durable;
- ordinary Admin cannot access reconciliation;
- both projects pass typecheck/tests and Admin build;
- test Reporting Sheets show correct Booking, Lead, reassignment, and
  cancellation rows;
- production migration dry-run has no unresolved uniqueness collisions;
- owner signs off in the test environment.
