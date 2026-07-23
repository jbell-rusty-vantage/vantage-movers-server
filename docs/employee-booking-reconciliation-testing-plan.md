# Employee Booking Reconciliation — Local Testing Plan

**Status:** Companion acceptance plan  
**Companion to:** `docs/employee-booking-reconciliation-implementation-plan.md`  
**Runtime:** local Vercel-compatible server with `TEST_MODE=true`  
**Data targets:** `testvantagemovers` and the configured `TEST_*` Google Sheets  
**Primary test surface:** the same fixed-purpose `vantage-admin` API routes used by
the public employee form

## 1. Purpose

This document tells the implementing agent how to prove the employee booking
and reconciliation workflow locally.

The acceptance environment is intentionally realistic:

```text
test client or public employee page
        |
        v
vantage-admin local API
  /api/employee-booking/options
  /api/employee-booking/submit
        |
        | server-side secret
        v
vantage-main-server via `vercel dev`
        |
        +--> testvantagemovers
        |
        +--> TEST_* Google Sheets
```

`TEST_MODE=true` is a hard gate for every local acceptance run. In
`src/config/domain/runtime.ts`, it selects the `testvantagemovers` database and
changes each Sheet container lookup to its `TEST_`-prefixed environment
variable. The agent must never change this flag to test the feature locally.

Unit and integration tests remain required. The HTTP scenarios below supplement
them by exercising the deployed route shape, validation, transactions, matching,
idempotency, reconciliation, and Sheet Sync together.

## 2. Required implementation seam in `vantage-admin`

Add this optional, server-only environment variable:

```text
EMPLOYEE_BOOKING_API_BASE_URL
```

Only the two fixed-purpose employee handlers use it:

```text
app/api/employee-booking/options/route.ts
app/api/employee-booking/submit/route.ts
```

Their backend URL resolution is:

```ts
EMPLOYEE_BOOKING_API_BASE_URL ?? VANTAGE_API_BASE_URL
```

Requirements:

- validate it as an absolute `http:` or `https:` URL when present;
- keep it server-only; do not use a `NEXT_PUBLIC_` variable;
- use the existing server-side `VANTAGE_API_SECRET`;
- use the same resolver for both options and submit;
- do not change the generic authenticated proxy's backend mapping;
- reject caller-supplied backend URLs or paths;
- add tests for configured override, fallback, invalid URL, and origin-safe path
  joining.

For local acceptance:

```dotenv
# vantage-admin/.env.local
EMPLOYEE_BOOKING_API_BASE_URL=http://127.0.0.1:3001
```

When the variable is omitted, employee traffic follows the existing
`VANTAGE_API_BASE_URL`. This makes the local switch an environment change
rather than a code edit.

## 3. Local environment

### 3.1 Main server

In `vantage-main-server/.env`:

```dotenv
TEST_MODE=true
VANTAGE_API_SECRET=<same value used by vantage-admin>
SHEET_SYNC_MODE=legacy
WRITE_SOURCE_LEAD_SHEETS=<same policy intended for production>

TEST_MASTER_LEADS_SHEET_ID=<test container>
TEST_MASTER_BOOKED_SHEET_ID=<test container>
# Supply the applicable TEST_<SOURCE>_LEADS_SHEET_ID values when
# WRITE_SOURCE_LEAD_SHEETS=true.
```

Keep the existing `MONGO_URI`, Google service-account configuration, catalog
configuration, and other required settings. Do not copy production sheet IDs
into any `TEST_*` variable.

Use `SHEET_SYNC_MODE=legacy` for the normal local acceptance pass because it
allows the real test sheets to be inspected without a local Vercel Queue
consumer. Also run the dedicated outbox scenarios with `SHEET_SYNC_MODE=queued`.
`SHEET_SYNC_MODE=disabled` is acceptable only for fast API diagnostics; it does
not satisfy Sheet Sync acceptance.

The configured Mongo deployment must support transactions. A standalone Mongo
process is insufficient; use the existing replica-set-capable test database.

### 3.2 Admin

In `vantage-admin/.env.local`:

```dotenv
EMPLOYEE_BOOKING_API_BASE_URL=http://127.0.0.1:3001
VANTAGE_API_SECRET=<same value as the main server>
```

Retain the existing Admin auth and database variables. Restart `next dev` after
changing environment variables because the server environment is cached.

### 3.3 Start and verify

Use separate terminals.

Terminal 1:

```powershell
cd vantage-main-server
pnpm exec vercel dev --listen 3001
```

Terminal 2:

```powershell
cd vantage-admin
pnpm dev
```

Verify the main server before creating fixtures:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:3001/db
```

`GET /db` must report `name: "testvantagemovers"`. Stop immediately if it
reports `vantagemovers`.

Then request:

```text
GET http://localhost:3000/api/employee-booking/options
```

The response must contain only active source granularities, Agents, and
Merchants from the test database. This proves the public route is using the
local main server and the same catalog data the submit route will validate.

## 4. Test interfaces

### 4.1 Primary: public-form API surface

Acceptance requests go through:

```http
GET  http://localhost:3000/api/employee-booking/options
POST http://localhost:3000/api/employee-booking/submit
```

These are the routes the browser uses. They prove nonce/cookie behavior,
same-origin enforcement, honeypot handling, throttling, response sanitization,
and server-side secret forwarding. Use a cookie-preserving client or the local
employee page because the options request may establish the submission nonce.

Every scenario that represents employee behavior must pass through this
surface. Do not declare acceptance based only on calling a service function or
writing directly to Mongo.

### 4.2 Diagnostic: main-server route

When a public-route scenario fails, isolate the backend with:

```http
POST http://127.0.0.1:3001/api/v1/employee-booking-submissions
Content-Type: application/json
x-api-secret: <VANTAGE_API_SECRET>
```

Example body:

```json
{
  "submission_id": "replace-with-a-new-uuid",
  "lead_source_company_id": "replace-from-options",
  "source_granularity_key": "replace-from-options",
  "agent": "replace-from-options",
  "lead_name": "EBR Exact Form",
  "binder_amount": 1200,
  "deposit_amount": 500,
  "merchant": "replace-from-options",
  "phone_number": "2125550101",
  "email": "ebr.exact.form@example.test",
  "lid": "EBR-LID-001",
  "job_no": "EBR-JOB-001"
}
```

Direct calls are diagnostic and useful for matcher matrices and concurrency
tests. They do not replace the corresponding public-route acceptance scenario.

### 4.3 Owner reconciliation surface

Owner actions should normally go through the authenticated local Admin UI or
its authenticated API proxy. Direct main-server calls are permitted for
diagnosis and automated setup, but must include the trusted owner headers the
Admin proxy is designed to provide. Never invent `resolved_by` in a browser
payload.

## 5. Fixture strategy

Use a unique run ID in every value, for example:

```text
EBR-20260723-153000
```

Derive fixture values from it:

```text
Job Number: <run>-JOB-01
LID:        <run>-LID-01
Email:      <run>.form@example.test
Name:       <run> Exact Form
```

Before submitting:

1. Fetch employee options and choose active Form-channel and Call-channel
   granularities.
2. Choose active Primary and Secondary Agents and one active Merchant.
3. Create only the Form Leads and Call Leads needed by the scenario through
   existing test APIs or an idempotent fixture script.
4. Record every created Mongo ID.
5. Confirm the normalized Job Numbers are unused.
6. Record the pre-test row counts in test Master Booked and test Master Leads.

Fixtures must be deterministic and independently identifiable. Do not reuse
real-looking customer PII. Prefer `example.test` email addresses, reserved test
phone ranges, and the run ID in names, LIDs, and Job Numbers.

Do not globally clear the test database or test sheets. Other work may share
them. Cleanup, if desired, must target only documents created by the current run
and must use normal delete/cancellation behavior when that behavior is part of
the feature being verified.

## 6. Core submission scenarios

For each scenario, capture the HTTP request/response, Booking ID, case ID when
present, attached Lead ID when present, Sheet Sync job or execution evidence,
and final test-sheet rows.

| ID | Setup and request | Expected result |
|---|---|---|
| S01 | Form granularity; one eligible exact-granularity Form Lead with exact LID | `201 booked_and_linked`; Booking links that Form Lead; no case |
| S02 | Call granularity; one eligible exact-granularity Call Lead with exact Job Number | `201 booked_and_linked`; Booking links that Call Lead; no case |
| S03 | No LID hit; one Form Lead matches exact normalized Name + Email + Phone | Linked only when that configured rule is enabled |
| S04 | Multiple same-Phone Form Leads; one exact Email + Phone candidate with no contradictory Name | Linked only when that configured rule is enabled |
| S05 | Valid submission with no candidate | `201 booked_pending_lead`; leadless Booking and one `no_match` case |
| S06 | Two candidates at the same strongest confidence | Booking persists; one `multiple_matches` case; no attachment |
| S07 | Identity signals point to different Leads | Booking persists; `identity_conflict`; no attachment |
| S08 | Only a conflicting source or channel candidate exists | Booking persists with the appropriate conflict case |
| S09 | Best candidate is duplicate, already booked, or cancelled | Booking persists; candidate is not auto-attached; hard eligibility reason is retained |
| S10 | Preferred high-confidence rule is disabled or policy is `none` | Booking persists pending; no accidental fallback auto-attach |
| S11 | Primary and Secondary Agents are distinct | Two equal Agent Allocations sum exactly to the Binder |
| S12 | No Secondary Agent | One allocation equals the full Binder |
| S13 | Same Agent in both fields | `400`; no Booking, case, or sheet intent |
| S14 | Inactive/mismatched source, Agent, or Merchant | `400`; no durable writes |
| S15 | Missing/invalid UUID, money, Phone, Job Number, or extra forbidden field | `400`; strict sanitized error; no durable writes |
| S16 | A different Booking owns the normalized Job Number | `409`; no second Booking or case |
| S17 | Matcher throws while Mongo remains writable | `201 booked_pending_lead`; Booking and `matching_unavailable` case commit |
| S18 | Same valid `submission_id` sent again | `200 duplicate_submission`; original IDs returned; no new case or sync job |
| S19 | Two simultaneous requests use the same `submission_id` | Exactly one Booking; both responses converge on it |
| S20 | Two simultaneous requests use different IDs but the same normalized Job Number | Exactly one Booking; the loser receives `409` |

For S03, S04, and S10, run once with the relevant configuration enabled and
once disabled. Confirm the Booking's policy snapshot records the rule order and
version used for the decision.

## 7. Public route and abuse scenarios

| ID | Request | Expected result |
|---|---|---|
| P01 | Load `/employee-booking` while logged out | Page loads without Dashboard shell or login redirect |
| P02 | Fetch options | Only active catalog entries; no Mongo credentials, API secret, or generic proxy capability |
| P03 | Submit with valid nonce/cookie and same origin | Request reaches the local backend and returns the sanitized receipt |
| P04 | Submit without or with a stale nonce | Rejected; no Booking |
| P05 | Submit with a foreign `Origin` | Rejected; no Booking |
| P06 | Fill the honeypot | Rejected or silently discarded per implementation; no Booking |
| P07 | Exceed per-client or global rolling limit | `429`; no Booking for rejected attempts |
| P08 | Oversized body or unknown keys | Rejected; no Booking |
| P09 | Backend returns conflict, validation error, or internal error | Public response contains no candidate IDs, stack, database name, or secret |
| P10 | Send an arbitrary backend path to either fixed handler | It cannot be proxied |

Inspect browser network traffic and built client assets. `VANTAGE_API_SECRET`
and `EMPLOYEE_BOOKING_API_BASE_URL` must not appear in either.

## 8. Reconciliation scenarios

Start from independently created pending cases and record the case `revision`
before each command.

| ID | Owner action | Expected result |
|---|---|---|
| R01 | List/filter pending cases by every documented filter | Correct cases, cursor, sort, and counts |
| R02 | Search candidates by Mongo ID, LID, Job Number, Phone, name, email, source, model, status, and date | Current Form and Call Leads are returned consistently |
| R03 | Refresh candidates | New snapshot/history entry; Booking remains intact |
| R04 | Edit pending Booking fields | Atomic Booking update, revision increment, and correct sync intent |
| R05 | Attach an eligible existing Lead | Booking and Lead mirror atomically; case resolves; one booking chain |
| R06 | Attach with a soft duplicate/source warning and explicit override | Allowed only for documented override; warning and source choice audited |
| R07 | Attempt cancelled or already-booked attachment | Rejected even with an override; case stays pending |
| R08 | Create and attach Form Lead | Atomic result; no Granot request, SMS, or Lead Message |
| R09 | Create and attach Call Lead | Atomic result with required provenance; no fabricated call-log data |
| R10 | Dismiss, then reopen | Booking stays leadless; status and history are preserved |
| R11 | Reassign a resolved Booking | Old Lead is cleared, new Lead mirrored, case history appended, both projections refresh |
| R12 | Submit a stale revision | `409`; reload required; no partial mutation |
| R13 | Delete candidate after search but before attach | Command fails; case remains pending |
| R14 | Force a transaction failure during create/attach or reassign | No partial Lead, mirror, case transition, or outbox state |
| R15 | Ordinary Admin attempts list/detail/mutation | Forbidden; owner succeeds |

For source conflicts, exercise both `preserve_lead_source` and
`apply_submission_source` and verify the resulting Booking, Lead, and history.

## 9. Delayed rematch and cancellation

With the initial configuration, only `matching_unavailable` is eligible for
automatic rematching.

1. Create both `matching_unavailable` and `no_match` cases.
2. Confirm only the technical-failure case receives a due `next_attempt_at`.
3. Run the authenticated local rematch cron after making a unique eligible
   candidate available.
4. Confirm one delayed attachment, one resolution history entry, and no second
   attachment on replay.
5. Confirm the `no_match` case is never claimed.
6. Change the allowlist in local env, restart, and prove eligibility changes
   without a code change.
7. Make a technical retry complete normally as `no_match`; confirm automatic
   retries stop unless `no_match` is independently allowlisted.
8. Exhaust the configured retry schedule; confirm the case remains pending for
   owner action.

For cancellation:

1. Create an unresolved employee Booking.
2. Cancel it by Booking ID.
3. Confirm the Booking is cancelled, the pending case is dismissed with
   `booking_cancelled` history, and no Lead reference is fabricated.
4. Confirm the Booked and Cancelled test-sheet projections.
5. Replay the cancellation and prove idempotency.
6. Confirm unrelated legacy leadless/referral behavior did not broaden.

## 10. Sheet Sync acceptance

Run the core acceptance suite with `SHEET_SYNC_MODE=legacy` and actual test
sheet credentials.

Verify by Mongo ID, never row position alone:

| Domain result | Test-sheet expectation |
|---|---|
| Pending employee Booking | One Master Booked `Booked Deals` row; no Lead row created |
| Linked Form Booking | Booked row plus refreshed Master Leads `Forms` row |
| Linked Call Booking | Booked row plus refreshed Master Leads `Calls` row |
| Duplicate Form attachment | Correct `Duplicates` projection |
| Reassign | Old Lead refresh, Booking refresh, new Lead refresh |
| Unresolved cancellation | Booked row updated and one `Cancelled Deals` row |
| Idempotent submission retry | No duplicate row or new sync execution |

If `WRITE_SOURCE_LEAD_SHEETS=true`, verify the corresponding `TEST_*` source
container as well. If false, confirm no source-specific write occurred.

Then repeat representative pending, linked, reassigned, and cancelled cases
with `SHEET_SYNC_MODE=queued`:

- the domain mutation and durable outbox intent commit together;
- queue publishing failure does not undo the domain write;
- the local authenticated drain/cron processes the intent;
- replay does not duplicate rows;
- failed writes retain retry evidence.

## 11. Required assertions after every scenario

Do not rely on the HTTP status alone. Check:

1. **HTTP:** exact status and sanitized response contract.
2. **Booking:** origin, normalized Job Number, values, allocations, leadless or
   attached state, auto-match policy snapshot, and cancellation state.
3. **Lead:** correct model, eligibility, source, booking mirror, and absence of
   unintended mutation.
4. **Case:** zero or one per Booking, correct reason/status/revision, submission
   snapshot, candidate snapshot, attempts, and history.
5. **Atomicity:** no orphan Lead, partial mirror, duplicate Booking, duplicate
   case, or outbox intent without its domain write.
6. **Side effects:** expected Sheet Sync only; no Granot, CRM, SMS, email, or
   Lead Message from employee/reconciliation paths.
7. **Observability:** correct event key and IDs without raw request bodies,
   secrets, raw IPs, or unnecessary PII.

## 12. Automated verification

The implementing agent must add:

- pure unit tests for normalization, source compatibility, policy parsing, rule
  ordering, candidate ranking, and public response mapping;
- Mongo integration tests against a replica set for transactions, unique
  indexes, idempotency races, attachment claims, rollback, and outbox atomicity;
- route tests for schemas, authentication, owner authorization, and cron
  authentication;
- `vantage-admin` tests for employee backend URL override/fallback, fixed route
  allowlisting, nonce/origin/honeypot/throttle behavior, and secret containment;
- browser tests for the public form and the owner's primary reconciliation
  workflow.

Run:

```powershell
pnpm --dir vantage-main-server typecheck
pnpm --dir vantage-main-server test
pnpm --dir vantage-admin typecheck
pnpm --dir vantage-admin test
pnpm --dir vantage-admin build
```

Also run focused HTTP tests against both local Vercel-compatible routes, render
the employee page at phone and desktop widths, and execute the concurrency
requests more than once.

## 13. Acceptance record

Create one acceptance record per run containing:

```text
Run ID:
Commit:
Date/time:
Agent:
TEST_MODE confirmed:
Mongo database reported by /db:
Main-server URL:
Admin URL:
Sheet Sync mode:
Auto-match policy/version:
Auto-rematch configuration:
WRITE_SOURCE_LEAD_SHEETS:
Selected Form granularity:
Selected Call granularity:
Selected Agents:
Selected Merchant:
Scenario results:
Created Booking/Lead/case IDs:
Test-sheet evidence:
Automated command results:
Known failures:
Owner sign-off:
```

Redact secrets and customer data. IDs from the test database are acceptable.

## 14. Stop conditions

Stop the run immediately if:

- `/db` reports anything other than `testvantagemovers`;
- `TEST_MODE` is false or missing;
- a `TEST_*` Sheet ID resolves to a production Sheet;
- the local Admin employee routes resolve to a non-local backend unexpectedly;
- a request posts to Granot, sends SMS/Lead Messages, or exposes the API secret;
- a transaction test is running against standalone Mongo;
- a test would require deleting unrelated shared test data.

The feature is accepted only when the automated suite passes, all applicable
HTTP scenarios pass through the public-form API surface, Mongo invariants hold,
the correct test-sheet rows are visible, and the owner completes the
reconciliation acceptance flow.
